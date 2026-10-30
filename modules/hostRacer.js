/**
 * HostRacer — единая точка выбора и подключения к API-хостам.
 *
 * Используется и для первого подключения (App.connectAndInit),
 * и для реаконнекта (Api.connect): все кандидаты зовутся параллельно,
 * у каждого свой таймаут, первый открытый сокет побеждает и передаётся
 * дальше ОТКРЫТЫМ (без повторного handshake). Гонка резолвится сразу
 * на первом onopen (остальные кандидаты закрываются) либо когда все
 * кандидаты завершились отказом.
 *
 * Память: localStorage['pwHosts'] = { good: { host, ts, latencyMs } } —
 * последний успешный хост идёт первым (приоритет показа/выбора).
 * Отдельных кулдаунов нет: гонка параллельная — всегда выигрывает
 * самый быстрый из живых, мёртвые просто не успевают открыться.
 *
 * Проба (probeHosts): хост за Cloudflare открывается у всех, но у части
 * игроков провайдер (ТСПУ, РФ) «замораживает» TCP к IP Cloudflare после
 * первых ~16–20 КБ — без RST, сокет остаётся OPEN и молчит. Такой хост
 * побеждает только после пробы: PROBE_FRAMES конвейерных запросов, каждый
 * ответ ~PROBE_FRAME_BYTES. Не дошли до таймаута кандидата — отказ, гонку
 * выигрывает другой хост. Пуши, пришедшие во время пробы, отдаются
 * победителю в `buffered` (Api доставит их по порядку).
 *
 * Штраф (penalize): проверенный хост, соединение с которым позже тихо
 * деградировало (Api: таймауты подряд/watchdog), исключается из гонок на
 * PENALTY_MS. Проигранный раунд снимает штрафы — гонка бессмертная.
 */

const STORAGE_KEY = 'pwHosts';

const PROBE_PREFIX = '__probe';

export class HostRacer {
  // ~48 КБ вниз — заведомо выше порога заморозки (16–20 КБ / ~25 пакетов).
  // Каждый ответ < 15 КБ: бэкенд не пишет LARGE RESPONSE.
  static PROBE_FRAMES = 4;
  static PROBE_FRAME_BYTES = 12000;
  static PENALTY_MS = 10 * 60 * 1000;

  /**
   * @param {string[]} hosts
   * @param {Object} opts
   * @param {Function} [opts.onState] - (phase, data): 'candidate'/'win'/'lose'
   * @param {Function} [opts.getToken] - () => token для URL (как в старой
   *        схеме `${host}/${token}`): привязка сессии при подключении.
   *        На первом подключении token может быть пустым — тогда URL без него.
   * @param {string[]} [opts.probeHosts] - хосты, которым для победы нужна проба
   */
  constructor(hosts, { onState, getToken, probeHosts } = {}) {
    if (!Array.isArray(hosts) || !hosts.length) {
      throw 'HostRacer: не указан массив хостов';
    }

    this.hosts = hosts;
    this.onState = onState || (() => {});
    this.getToken = getToken || (() => '');
    this.probeHosts = new Set(Array.isArray(probeHosts) ? probeHosts : []);
    this.penalties = new Map(); // host -> до какого времени не участвует
    this.memory = this.loadMemory();
    this.pending = null; // промис активной гонки (дедупликация)
    this.sockets = []; // сокеты текущей гонки
    this.timers = []; // таймеры текущей гонки
  }

  buildUrl(host) {
    let token = '';

    try {
      token = `${this.getToken() || ''}`.trim();
    } catch (error) {}

    return token ? `${host}/${token}` : host;
  }

  loadMemory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (raw) {
        const parsed = JSON.parse(raw);

        if (parsed && parsed.good && parsed.good.host) {
          return parsed;
        }
      }
    } catch (error) {}

    return { good: null };
  }

  saveMemory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.memory));
    } catch (error) {}
  }

  lastGood() {
    const good = this.memory.good;

    return good && this.hosts.includes(good.host) ? good.host : null;
  }

  /**
   * Порядок кандидатов: last-good первым, остальные в базовом порядке.
   * Гонка параллельная — порядок влияет на показ и на выбор при равенстве.
   */
  orderedHosts() {
    const good = this.lastGood();

    let ordered = good ? [good, ...this.hosts.filter((host) => host !== good)] : this.hosts.slice();

    // Оштрафованные — вне гонки, но не все сразу (кандидатов не должно стать 0)
    const allowed = ordered.filter((host) => !this.isPenalized(host));

    return allowed.length ? allowed : ordered;
  }

  isPenalized(host) {
    const until = this.penalties.get(host);

    if (!until) {
      return false;
    }

    if (Date.now() >= until) {
      this.penalties.delete(host);
      return false;
    }

    return true;
  }

  /**
   * Хост с пробой выиграл, но его соединение потом тихо деградировало
   * (заморозка у провайдера может сработать и позже пробы) — не звать его
   * в гонки PENALTY_MS. Хосты без пробы не штрафуются: их обрывы — сеть/NAT.
   */
  penalize(host, ms = HostRacer.PENALTY_MS) {
    if (!this.probeHosts.has(host)) {
      return false;
    }

    this.penalties.set(host, Date.now() + ms);
    console.warn(`HostRacer: ${host} исключён из гонки на ${Math.round(ms / 1000)} с (соединение замерзало)`);

    return true;
  }

  /**
   * Проба пропускной способности на открытом сокете: PROBE_FRAMES запросов
   * user.agreementUrl (без токена, есть во всех версиях бэкенда) с длинным
   * request-id — бэкенд возвращает id в ответе, так что ответ весит
   * ~PROBE_FRAME_BYTES. done(true) — все ответы дошли. Прочие сообщения
   * (пуши при подключении) копятся в buffered.
   */
  startProbe(socket, done) {
    const buffered = [];
    const waiting = new Set();
    let finished = false;

    socket.onmessage = (event) => {
      const data = event.data;

      if (typeof data === 'string' && data.includes(PROBE_PREFIX)) {
        let request = '';

        try {
          request = String(JSON.parse(data)?.response?.request ?? '');
        } catch (error) {}

        if (request.startsWith(PROBE_PREFIX)) {
          waiting.delete(request.slice(0, request.indexOf(':')));

          if (!waiting.size && !finished) {
            finished = true;
            // Пуши, пришедшие между пробой и attach, тоже не теряем
            socket.onmessage = (next) => buffered.push(next.data);
            done(true, buffered);
          }

          return;
        }
      }

      buffered.push(data);
    };

    try {
      const padding = 'x'.repeat(HostRacer.PROBE_FRAME_BYTES);

      for (let i = 0; i < HostRacer.PROBE_FRAMES; i++) {
        const key = `${PROBE_PREFIX}${i}`;

        waiting.add(key);
        socket.send(JSON.stringify({ request: `${key}:${padding}`, object: 'user', method: 'agreementUrl', data: {} }));
      }
    } catch (error) {
      finished = true;
      done(false, null);
    }
  }

  recordSuccess(host, latencyMs = 0) {
    this.memory.good = { host: host, ts: Date.now(), latencyMs: latencyMs };
    this.saveMemory();
  }

  /**
   * @param {Object} opts
   * @param {number} opts.timeoutMs - таймаут на одного кандидата
   * @returns {Promise<{ok:true, host:string, socket:Object, latencyMs:number, buffered:Array}|{ok:false, failed:string[]}>}
   *   buffered — сообщения, пришедшие на сокет победителя до передачи в Api
   *   (только у хостов с пробой; иначе пустой массив).
   *
   * Повторный вызов в рамках активной гонки возвращает тот же промис.
   * Таймаут кандидата с пробой покрывает и открытие, и пробу.
   */
  race({ timeoutMs = 3500 } = {}) {
    if (this.pending) {
      return this.pending;
    }

    const ordered = this.orderedHosts();
    const t0 = Date.now();
    let winner = null;
    let pendingCount = ordered.length;
    let settled = false;
    const failures = [];

    this.sockets = [];
    this.timers = [];

    const racePromise = new Promise((resolve) => {
      const finish = (win) => {
        if (settled) {
          return;
        }

        settled = true;

        for (let timer of this.timers) {
          clearTimeout(timer);
        }

        // Закрываем всех, кроме победителя
        for (let socket of this.sockets) {
          if (socket === win?.socket) {
            continue;
          }

          try {
            socket.close();
          } catch (error) {}
        }

        if (win) {
          this.recordSuccess(win.host, win.latencyMs);
          this.onState('win', { host: win.host, latencyMs: win.latencyMs });
          resolve({ ok: true, host: win.host, socket: win.socket, latencyMs: win.latencyMs, buffered: win.buffered || [] });
        } else {
          // Раунд проигран целиком — штрафы снимаем: лучше снова попробовать
          // замерзавший хост, чем ждать окончания штрафа без связи
          this.penalties.clear();
          this.onState('lose', { failed: failures.slice() });
          resolve({ ok: false, failed: failures.slice() });
        }
      };

      const attempts = ordered.map((host) => {
        let socket;

        try {
          socket = new WebSocket(this.buildUrl(host));
        } catch (error) {
          return Promise.resolve().then(() => {
            failures.push(host);
            pendingCount--;

            if (pendingCount === 0) {
              finish(null);
            }
          });
        }

        this.sockets.push(socket);
        this.onState('candidate', { host: host, t0: t0 });

        let candidateSettled = false;
        let resolveCandidate;
        const candidate = new Promise((resolve) => {
          resolveCandidate = resolve;
        });

        const settle = (ok, buffered = null) => {
          if (candidateSettled) {
            return;
          }

          candidateSettled = true;
          clearTimeout(timer);

          if (ok && !winner) {
            winner = { host: host, socket: socket, latencyMs: Date.now() - t0, buffered: buffered };
          } else if (!ok) {
            failures.push(host);
          }

          pendingCount--;

          if (winner || pendingCount === 0) {
            finish(winner);
          }

          resolveCandidate({ host: host, ok: ok });
        };

        const timer = setTimeout(() => {
          settle(false);

          try {
            socket.close();
          } catch (error) {}
        }, timeoutMs);

        this.timers.push(timer);

        socket.onopen = () => {
          if (!this.probeHosts.has(host)) {
            settle(true);
            return;
          }

          if (winner || settled) {
            return; // гонка уже решена — пробу не гоняем, сокет закроет finish
          }

          this.startProbe(socket, (ok, buffered) => settle(ok, buffered));
        };
        socket.onclose = () => settle(false);
        socket.onerror = () => {}; // onclose последует

        return candidate;
      });

      // Страховка: если все кандидаты завершены, а finish не сработал
      Promise.all(attempts).then(() => {
        if (pendingCount > 0) {
          pendingCount = 0;
          finish(winner);
        }
      });
    }).finally(() => {
      this.pending = null;
      this.sockets = [];
    });

    this.pending = racePromise;

    return racePromise;
  }
}

import { App } from './app.js';
import { Lang } from './lang.js';

export class Api {
  // Наблюдатели запросов (phase 'send' | 'done', object, method, data): кэш билдов узнаёт о правках
  // откуда бы они ни шли (окно билда, лобби, админка). Ошибка наблюдателя запрос не ломает.
  static requestObservers = new Set();

  static notifyRequestObservers(phase, object, method, data) {
    for (const observer of Api.requestObservers) {
      try {
        observer(phase, object, method, data);
      } catch {}
    }
  }

  constructor(host, events, initial = {}) {
    if (!('WebSocket' in window)) {
      throw 'Отсутствует поддержка WebSocket';
    }

    if (!Array.isArray(host)) {
      throw 'Необходим массив хостов';
    }

    if (!host.length) {
      throw 'Не указан хост';
    }

    this.host = host;

    this.events = events ? events : new Object();

    this.WebSocket = null;

    this.MAIN_HOST = initial.host || host[0];

    // Телеметрия подключения (уходит в analysis при авторизации)
    this.lastLatencyMs = initial.latencyMs || 0;
    this.lastConnectTs = Date.now();
    this.totalFailures = 0;
    this.reconnects = 0;
    this.lastCloseCode = null;
    this.lastCloseTs = 0;

    this.awaiting = new Object();

    this.requestSeq = 0;

    this.hasConnectedOnce = false;

    // Запущена ли игра (MM.gameRunEvent / gameStopEvent): уходит полем game
    // в каждом запросе — статус игрока в списке идущих матчей (Window.spectate)
    this.gameRunning = false;

    // Watchdog: браузер не доносит WS-уровневые ping/pong в app-код,
    // поэтому половинка TCP (NAT-таймаут, роутер упал без RST) остаётся
    // "OPEN" вечно. Решаем двумя механизмами:
    //  - keepalive: при долгой тишине шлём свой пинг (любой ответ = трафик,
    //    работает со старым бэкендом без systemPing);
    //  - watchdog: тишина дольше WATCHDOG_SILENCE_MS → принудительный
    //    close → реаконнект через гонку.
    // С новым бэкендом гарантированный трафик даёт systemPing (30 с).
    this.KEEPALIVE_INTERVAL_MS = 25000;
    this.KEEPALIVE_SILENCE_MS = 45000;
    this.WATCHDOG_INTERVAL_MS = 10000;
    this.WATCHDOG_SILENCE_MS = 60000;

    this.RECONNECT_DELAY_MS = 1000;

    // Серия таймаутов запросов на OPEN-сокете — признак «тихо деградировавшего»
    // соединения (провайдер «заморозил» TCP к Cloudflare: сокет OPEN, но
    // данные не идут). Лечится сменой хоста через гонку (retry на том же
    // сокете бесполезен); хост с пробой при этом штрафуется (App.racer.penalize).
    this.RECONNECT_ON_TIMEOUTS = 2;
    this._consecutiveTimeouts = 0;
    this._closeReason = null; // 'degraded' — закрыли сами из-за тишины/таймаутов

    this.lastMessageAt = Date.now();
    this._connecting = false;
    this._lastReconnectNotifyTs = 0;

    this.keepaliveTimer = null;
    this.watchdogTimer = null;

    if (initial.socket) {
      // notifyOpen=false: ShowCurrentView нужен после init App.storage,
      // а сокет из гонки уже открыт — onopen «промахнулся»
      this.attach(initial.socket, initial.host, initial.latencyMs, { notifyOpen: false, buffered: initial.buffered });
    }

    this.startKeepalive();
  }

  async init() {
    if (!this.WebSocket || this.WebSocket.readyState !== WebSocket.OPEN) {
      await this.connect();
    } else {
      this.onSocketOpen();
    }
  }

  /**
   * Подключение/реаконнект через общую гонку хостов (App.racer) — та же
   * бессмертная эскалация, что при первом подключении (App.CONNECT_TIMEOUT_SCHEDULE).
   */
  async connect() {
    if (this._connecting) {
      return;
    }

    this._connecting = true;

    try {
      if (this.WebSocket) {
        try {
          this.WebSocket.close();
        } catch (error) {}

        this.WebSocket = null;
      }

      let round = 0;

      while (true) {
        const result = await App.racer.race({ timeoutMs: App.connectTimeoutForRound(round) });

        if (result.ok) {
          this.attach(result.socket, result.host, result.latencyMs, { buffered: result.buffered });
          return;
        }

        round++;
        this.totalFailures++;
        this.notifyReconnecting();
        await new Promise((resolve) => setTimeout(resolve, App.CONNECT_ROUND_BACKOFF_MS));
      }
    } finally {
      this._connecting = false;
    }
  }

  /**
   * Привязать сокет (из гонки) к Api. Скет может быть уже открытым
   * (первое подключение/реаконнект) или ещё подключающимся.
   * buffered — сообщения, пришедшие во время пробы хоста (пуши при
   * подключении): доставляются следующим тиком (после `App.api = ...`),
   * новые до этого копятся за ними — порядок сохраняется.
   */
  attach(socket, host, latencyMs = 0, { notifyOpen = true, buffered = null } = {}) {
    this.WebSocket = socket;
    this.MAIN_HOST = host;
    this.lastLatencyMs = latencyMs;
    this.lastConnectTs = Date.now();
    this.lastMessageAt = Date.now();
    this._consecutiveTimeouts = 0;
    this._closeReason = null;

    const deliver = (data) => {
      this.lastMessageAt = Date.now();
      this.message(data);
    };

    const backlog = Array.isArray(buffered) ? buffered.slice() : [];

    if (backlog.length) {
      this.WebSocket.onmessage = (event) => backlog.push(event.data);

      setTimeout(() => {
        if (this.WebSocket !== socket) {
          return;
        }

        socket.onmessage = (event) => deliver(event.data);

        for (const data of backlog) {
          deliver(data);
        }
      }, 0);
    } else {
      this.WebSocket.onmessage = (event) => deliver(event.data);
    }

    this.WebSocket.onerror = () => {}; // onclose последует

    this.WebSocket.onclose = (event) => {
      // Телеметрия обрыва: 1006 — аномальный (нет close-фрейма: NAT/прокси/
      // тишина), 1000 — штатный (рестарт сервера), 4000 — свой watchdog.
      const code = (event && event.code) || 0;
      const uptimeSec = Math.round((Date.now() - this.lastConnectTs) / 1000);

      console.log(`API close: code=${code} host=${this.MAIN_HOST} uptime=${uptimeSec}s`);

      if (this._closeReason === 'degraded') {
        try {
          App.racer?.penalize?.(this.MAIN_HOST);
        } catch (error) {}
      }

      this._closeReason = null;
      this.reconnects++;
      this.lastCloseCode = code;
      this.lastCloseTs = Date.now();
      this.WebSocket = null;

      setTimeout(() => this.connect(), this.RECONNECT_DELAY_MS);
    };

    this.WebSocket.onopen = () => this.onSocketOpen();

    if (notifyOpen && socket.readyState === WebSocket.OPEN) {
      this.onSocketOpen();
    }
  }

  onSocketOpen() {
    console.log(`Успешно подключились к ${this.MAIN_HOST}...`);

    if (this.hasConnectedOnce) {
      try {
        App.onApiReconnected?.();
      } catch {}
    }

    this.hasConnectedOnce = true;

    // Бэкенд мог перезапуститься посреди боя и забыть, что игра запущена
    if (this.gameRunning) {
      this.reportGame();
    }

    App.ShowCurrentView();
  }

  setGameRunning(running) {
    this.gameRunning = Boolean(running);
    this.reportGame();
  }

  // Сразу сообщить бэкенду, запущена ли игра, не дожидаясь следующего запроса:
  // тот же тихий пинг, что у keepalive (поле game идёт в каждом запросе)
  reportGame() {
    if (App.storage?.data?.token) {
      this.silent(() => {}, 'user', 'nicknameCooldown', {});
    }
  }

  notifyReconnecting() {
    // Один notify на сессию обрыва (дроссль 5 с) — вместо тоста на каждую попытку
    if (Date.now() - this._lastReconnectNotifyTs < 5000) {
      return;
    }

    this._lastReconnectNotifyTs = Date.now();

    App.notify(Lang.text('reconnectingNotify'));
  }

  connectionInfo() {
    return {
      host: this.MAIN_HOST,
      latencyMs: this.lastLatencyMs,
      ts: this.lastConnectTs,
      failures: this.totalFailures,
      reconnects: this.reconnects,
      lastCloseCode: this.lastCloseCode,
      lastCloseTs: this.lastCloseTs,
    };
  }

  startKeepalive() {
    this.keepaliveTimer = setInterval(() => {
      if (this.WebSocket && this.WebSocket.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastMessageAt > this.KEEPALIVE_SILENCE_MS) {
          // Тихий пинг: любой ответ (даже ошибка) = трафик.
          // user.nicknameCooldown существует во всех версиях бэкенда.
          this.silent(() => {}, 'user', 'nicknameCooldown', {});
        }
      }
    }, this.KEEPALIVE_INTERVAL_MS);

    this.watchdogTimer = setInterval(() => {
      if (this.WebSocket && this.WebSocket.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastMessageAt > this.WATCHDOG_SILENCE_MS) {
          console.log(`Watchdog: тишина дольше ${this.WATCHDOG_SILENCE_MS} мс, закрываем соединение ${this.MAIN_HOST}`);

          this._closeReason = 'degraded';

          try {
            this.WebSocket.close(4000);
          } catch (error) {}
        }
      }
    }, this.WATCHDOG_INTERVAL_MS);
  }

  async message(body) {
    let json = JSON.parse(body);

    if (!json) {
      return;
    }

    if ('response' in json) {
      let { request, data, error } = json.response;

      if (!(request in this.awaiting)) {
        return;
      }

      if (error) {
		if (error.includes('|')) {
          const parts = error.split('|');
          const key = parts[0];
          let translated = Lang.text(key);
        
          for (let i = 1; i < parts.length; i++) {
            const [paramName, paramValue] = parts[i].split('=');
            translated = translated.replace(`\${${paramName}}`, paramValue || '');
          }
          try {
            await App.handleAuthPulseSignal(translated);
          } catch {}
        
          this.awaiting[request].reject(translated);
		} else {
        const translated = Lang.text(error);
        try {
          await App.handleAuthPulseSignal(translated);
        } catch {}
        this.awaiting[request].reject(translated);
		}
      } else {
        this.awaiting[request].resolve(data);
      }

      delete this.awaiting[request];
    } else if ('from' in json) {
      // request

      let { action, data } = json.from;

      if ('queue' in json) {
        try {
          this.WebSocket.send(JSON.stringify({ queue: json.queue }));
        } catch (error) {
          console.log('API (queue)', error);
        }
      }

      if (action in this.events) {
        try {
          this.events[action](data);
        } catch (error) {
          console.log('API (events/action)', error);
        }
      }
    } else {
      throw Lang.text('unknownMessageStructure').replace('{json}', JSON.stringify(json));
    }
  }

  async request(object, method, data) {
    for (let key in this.awaiting) {
      if (this.awaiting[key].object == object && this.awaiting[key].method == method) {
        // Типизированная ошибка: вызов может дождаться освобождения метода
        // и повторить запрос (code — не зависит от языка текста).
        const text = Lang.text('requestAlreadyPending').replace('{method}', method).replace('{object}', object);
        const error = new Error(text);
        error.code = 'REQUEST_ALREADY_PENDING';
        error.toString = () => text;
        throw error;
      }
    }

    let identify = this.nextRequestId();

    Api.notifyRequestObservers('send', object, method, data);

    try {
      await this.say(identify, object, method, data);
    } catch (error) {
      Api.notifyRequestObservers('done', object, method, data);
      throw Lang.text('requestFailedConnectionError');
    }

    try {
      return await this.awaitResponse(identify, object, method);
    } finally {
      Api.notifyRequestObservers('done', object, method, data);
    }
  }

  awaitResponse(identify, object, method) {
    return new Promise((resolve, reject) => {
      let rejectTimerId = setTimeout(() => {
        delete this.awaiting[identify];

        this.onRequestTimeout();

        reject(Lang.text('requestTimeoutError').replace('{object}', object).replace('{method}', method));
      }, 15000);

      this.awaiting[identify] = {
        object: object,
        method: method,
        resolve: (data) => {
          clearTimeout(rejectTimerId);

          this._consecutiveTimeouts = 0;

          resolve(data);
        },
        reject: (error) => {
          clearTimeout(rejectTimerId);

          reject(error);
        },
      };
    });
  }

  // Таймаут запроса на OPEN-сокете. Серия (RECONNECT_ON_TIMEOUTS подряд) —
  // закрываем сокет: onclose → connect() → гонка → смена хоста.
  onRequestTimeout() {
    this._consecutiveTimeouts++;

    if (
      this._consecutiveTimeouts >= this.RECONNECT_ON_TIMEOUTS &&
      this.WebSocket &&
      this.WebSocket.readyState === WebSocket.OPEN
    ) {
      console.warn(`API: ${this._consecutiveTimeouts} таймаута подряд, переподключение через гонку (хост ${this.MAIN_HOST})`);

      this._consecutiveTimeouts = 0;
      this._closeReason = 'degraded';

      try {
        this.WebSocket.close();
      } catch (error) {}
    }
  }

  // Пагинированный запрос: сервер отдаёт {items, next, more} (страница тримится
  // под бюджет размера — без многокилобайтных фреймов). Цикл до
  // набора полного набора; возвращается плоский массив (экраны ждут список).
  // Совместимость со старым бэкендом: обычный массив = одна страница.
  async requestPaged(object, method, data) {
    let all = [];
    let page = 0;

    while (true) {
      const part = await this.request(object, method, { ...(data || {}), page: page });

      if (Array.isArray(part)) {
        return all.concat(part);
      }

      const items = Array.isArray(part?.items) ? part.items : [];

      all = all.concat(items);

      if (part?.more !== true) {
        break;
      }

      page = Number(part.next) || all.length;
    }

    return all;
  }

  async silent(callback, object, method, data, infinity = false) {
    let identify = `${method}${this.nextRequestId()}`; // unique id to avoid collisions

    try {
      await this.say(identify, object, method, data);
    } catch (error) {
      if (infinity) {
        setTimeout(() => this.silent(callback, object, method, data, true), 3000);
      }

      return;
    }

    let timerId = setTimeout(() => {
      delete this.awaiting[identify];

      if (infinity) {
        this.silent(callback, object, method, data, true);
      }
    }, 15000);

    this.awaiting[identify] = {
      object: object,
      method: method,
      resolve: (data) => {
        clearTimeout(timerId);

        callback(data, false);
      },
      reject: (error) => {
        clearTimeout(timerId);

        callback(false, error);
      },
    };

    return;
  }

  async ghost(object, method, data) {
    try {
      await this.say(0, object, method, data);
    } catch (error) {}

    return;
  }

  nextRequestId() {
    this.requestSeq = (this.requestSeq + 1) % 1000000;
    return `${Date.now()}_${this.requestSeq}`;
  }

  async say(request, object, method, data = '', retryCount = 0) {
    if (this.WebSocket && this.WebSocket.readyState === this.WebSocket.OPEN) {
      const shouldIgnoreSessionToken =
        object === 'user' &&
        (method === 'authorization' || method === 'registration' || method === 'recover');
      const outgoingToken = shouldIgnoreSessionToken ? '' : App.storage.data.token;
      this.WebSocket.send(
        JSON.stringify({
          token: outgoingToken,
          request: request,
          object: object,
          method: method,
          data: data,
          version: `${App.PW_VERSION}.${App.APP_VERSION}`,
          // канал клиента: бэкенд показывает тестовому (mmtest) закрытых героев (objects/heroAccess.js)
          line: App.CURRENT_MM,
          // запущена ли игра: статус игрока в списке идущих матчей (spectator.live)
          game: this.gameRunning ? 1 : 0,
        }),
      );
    } else {
      if (retryCount < 5) {
        setTimeout(() => this.say(request, object, method, data, retryCount + 1), 3000);
      }
    }
  }
}

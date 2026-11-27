import { App } from './app.js';
import { Lang } from './lang.js';
import { NativeAPI } from './nativeApi.js';
import { ReplayUpload } from './replayUpload.js';
import { CrashReport } from './crashReport.js';
import { BattleLeave } from './battleLeave.js';
import { GameSettingsSync } from './gameSettingsSync.js';
import { renderBackendToken } from './gameRender.js';
import { readExeVersion } from './gameExeVersion.js';
import { findMissingDlls } from './gameDlls.js';

export class PWGame {
  static PATH = '../Game/Bin/PW_Game.exe';

  static WORKING_DIR_PATH = '../Game/Bin/';

  static LUTRIS_EXEC = 'lutris lutris:rungame/prime-world';

  static PATH_UPDATE = '../Tools/PW_NanoUpdater.exe';

  static PATH_UPDATE_LINUX = '../update.sh';

  static PATH_TEST_HASHES = './content/PW_HashTest.exe';

  // Признак раскладки 2.0: только для неё имеет смысл PW_HashTest
  static PATH_LEGACY_PACK = '../Game/Packs/data01.pile';
  
  static PATH_LUA_BRIDGE = '../Game/Bin/bridge';

  static gameConnectionTestIsActive = false;

  static isUpToDate = false;

  static isValidated = false;

  static isUpdateFailed = false;

  // Игра жива (её exe и память-мапнутые Packs/*.pile держат файлы дерева). Апдейтер, запущенный
  // в этот момент, не может дописать дерево — фоновая проверка и старт обновления обязаны это
  // учитывать (иначе прогон съедает трафик и оставляет полузаписанное дерево).
  static isGameRunning = false;

  static isTestHashesFailed = false;

  // Последняя сверка версии exe не прошла: на диске PW_Game.exe другой версии, чем
  // App.PW_VERSION. В отличие от прочих предупреждений об обновлении, это блок: игра
  // с такой строкой запуска сразу закрывается окном «Game update has failed!».
  static exeVersionBlocked = false;

  // Протокол текущего запуска. Формируется в start() из токена сессии бэкенда;
  // до запуска игры протокола нет (дебажной сессии с фиксированным токеном больше нет).
  static currentPlayPwProtocol = '';

  static protocolServer;

  static async openProtocolSocket() {
    try {
      const http = NativeAPI.http;

      if (PWGame.protocolServer) {
        PWGame.protocolServer.close(() => {});
      }

      PWGame.protocolServer = http.createServer((req, res) => {
        if (req.url === '/getConnectionData' && req.method === 'POST') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(JSON.stringify({ protocol: PWGame.currentPlayPwProtocol }));

          //PWGame.protocolServer.close(() => {});
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      });

      PWGame.protocolServer.listen(34980, '127.0.0.1', () => {});
    } catch (e) {
      App.error(e, 30000);
    }
  }

  // options — именованные опции «/key=value» от лаунчера (тренировка с ботами:
  // «/bots=…», trainingBots.js). Ставятся перед render=, как и он — после языка.
  static GetPlayPwProtocol(id, ips, port, method = 'runGame', options = '') {
    // 5th token is the legacy mirror index. Mirror selection is gone: the
    // pool block is pre-sorted by the launcher (fastest reachable first),
    // so the client always starts from index 0.
    // method: runGame (a player) or spectate (live match viewing, the key
    // comes from the backend spectator.watch).
    let protocol = `pwclassic://${method}/${id}/${App.PW_VERSION}/0`;
    if (ips) {
      protocol = `${protocol}/${ips}`;
      // Base port of the target server (6th token). Without it the client
      // falls back to its standard ports (server_ip.h).
      if (port) {
        protocol = `${protocol}/${port}`;
        // Language of the in-game texts (7th token). Only after
        // the IP block and the port: the client takes it from a fixed position.
        if (Lang.target) {
          protocol = `${protocol}/${Lang.target}`;
        }
      }
    }
    // Именованная опция запуска — последний токен, «render=vulkan» (см.
    // gameRender.js). При значении по умолчанию ('d3d9') токен НЕ добавляется:
    // строка протокола остаётся ровно той, что отдавалась раньше, поэтому
    // старые клиенты не видят ничего нового. Новый клиент читает «key=value»
    // в любой позиции после метода (PW_Client/Game.cpp).
    // Пока Vulkan не работает, пункта в настройках нет и всегда идёт d3d9:
    // кто успел включить Vulkan раньше, иначе не смог бы его выключить.
    protocol = `${protocol}${options || ''}${renderBackendToken('d3d9')}`;
    return protocol;
  }

  // UDP login port of the game server (newlogin): the health-check probe
  // sends an RDP INIT here and waits for INIT_ACK/REFUSED.
  static GAME_SERVER_LOGIN_PORT = 27301;

  static decodeIps(hex) {
    if (!hex || typeof hex !== 'string' || hex.length % 8 !== 0) {
      return [];
    }

    let ips = [];

    for (let i = 0; i < hex.length; i += 8) {
      let octets = [];
      for (let j = 0; j < 4; ++j) {
        let octet = parseInt(hex.substr(i + j * 2, 2), 16);
        if (Number.isNaN(octet)) {
          return [];
        }
        octets.push(octet);
      }
      ips.push(octets.join('.'));
    }

    return ips;
  }

  static encodeIps(ips) {
    return ips
      .map((ip) => ip.split('.').map((o) => Number(o).toString(16).padStart(2, '0'))
      .join(''))
      .join('');
  }

  // UDP health probe of the game server: 8-byte RDP INIT to the newlogin
  // login port; INIT_ACK(1) or REFUSED(3) in the answer means the login
  // path (the one the client uses) is alive. Replaces the old HTTP
  // `checkConnection` check to the synchronizer (port 27302).
  // Resolves the response time in ms (fractional, performance.now);
  // null on timeout / ICMP port-unreachable / any other answer.
  static udpGameProbe(ip, port, timeoutMs = 2000) {
    return new Promise((resolve) => {
      const dgram = NativeAPI.dgram;
      if (!dgram) {
        resolve(null);
        return;
      }
      let socket;
      try {
        socket = dgram.createSocket('udp4');
      } catch (e) {
        resolve(null);
        return;
      }
      let done = false;
      const finish = (rtt) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch (e) {}
        resolve(rtt);
      };
      // 8-byte RDP INIT: type=0, seqIdx=0, pad=0, srcMux=32768 (ephemeral), destMux=10 (login)
      const pkt = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0x0A, 0x00]);
      const timer = setTimeout(() => finish(null), timeoutMs);
      socket.once('message', (msg) => {
        if (msg.length >= 1 && (msg[0] === 1 || msg[0] === 3)) {
          finish(performance.now() - t0);
        } else {
          finish(null);
        }
      });
      socket.once('error', () => finish(null)); // ICMP port-unreachable -> fast fail
      const t0 = performance.now();
      socket.send(pkt, port, ip);
    });
  }

  // Сколько проб на адрес при выборе входа и шаг между ними. Одна проба могла
  // попасть во всплеск задержки (на боксах до 200 мс примерно в 10% замеров)
  // и перепутать порядок адресов.
  static GAME_PROBE_COUNT = 3;

  static GAME_PROBE_GAP_MS = 150;

  // Лучшее (минимальное) время ответа из нескольких проб; null — ни одного ответа.
  // Пробы идут внахлёст, а не подряд: адрес без ответа задерживает запуск на
  // таймаут плюс 2 шага, а не на таймаут × число проб.
  static async bestGameProbe(ip, port, timeoutMs = 2000) {
    let rtts = await Promise.all(Array.from({ length: PWGame.GAME_PROBE_COUNT }, async (_, i) => {
      if (i) {
        await new Promise((resolve) => setTimeout(resolve, i * PWGame.GAME_PROBE_GAP_MS));
      }
      return PWGame.udpGameProbe(ip, port, timeoutMs);
    }));
    let answered = rtts.filter((rtt) => typeof rtt === 'number');
    return answered.length ? Math.min(...answered) : null;
  }

  // Orders the pool block for the client: reachable IPs first, sorted by
  // response time (fastest first); unreachable ones appended at the end in
  // their original order. The launcher never drops an address from the
  // block — a false-negative probe (or a broken local UDP path) must not
  // prevent the client from walking the pool itself; a total failure shows
  // up as an in-game error.
  static async orderServerIps(ipsHex, port) {
    let ips = PWGame.decodeIps(ipsHex);
    if (!ips.length) {
      return '';
    }

    // The login port of the pool is the target base port + 1 (all pool
    // servers run the same offsets); without a port — the legacy 27301.
    let loginPort = port ? port + 1 : PWGame.GAME_SERVER_LOGIN_PORT;
    let rtts = await Promise.all(ips.map((ip) => PWGame.bestGameProbe(ip, loginPort)));
    let reachable = [];
    let unreachable = [];
    for (let i = 0; i < ips.length; ++i) {
      if (typeof rtts[i] === 'number') {
        reachable.push({ ip: ips[i], rtt: rtts[i] });
      } else {
        unreachable.push(ips[i]);
      }
    }
    reachable.sort((a, b) => a.rtt - b.rtt);

    return PWGame.encodeIps(reachable.map((r) => r.ip).concat(unreachable));
  }

  // tping-отчёт для выбора сервера (PLAN_server_pick_ping.md): параллельные
  // ПРЯМЫЕ пробы alive-пула (логин-порт base+1, тот же 8-байтный RDP INIT,
  // что orderServerIps) и отчёт бэкенду. Запускающий блок здесь не
  // пересортируется — пробы только для cost-модели (tping-члена).
  static async probePoolForReport(data) {
    if (!data || !data.seq || !Array.isArray(data.pool) || !data.pool.length) {
      return;
    }

    let rtts = await Promise.all(data.pool.map((e) => PWGame.udpGameProbe(e.ip, e.base + 1, 2000)));

    let ips = {};
    for (let i = 0; i < data.pool.length; ++i) {
      ips[data.pool[i].ip] = typeof rtts[i] === 'number' ? Math.round(rtts[i] * 100) / 100 : null;
    }

    App.api.request(App.CURRENT_MM, 'reportPing', { seq: data.seq, ips: ips });
  }

  static async start(id, callback, ips, port, method = 'runGame', options = '') {
    await PWGame.check();

    // бой уже найден, а апдейтер ещё пишет файлы игры (обновление началось во время подтверждения):
    // запускаем игру только после его завершения
    if (NativeAPI.updateInProgress) {
      App.notify(Lang.text('updateGameStartWait'));
      while (NativeAPI.updateInProgress) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // exe не той версии закроется сам окном «Game update has failed! Try to run from web-launcher» —
    // не запускаем его, говорим игроку причину и докачиваем обновление
    const exeProblem = await PWGame.exeVersionProblem();
    if (exeProblem) {
      App.error(exeProblem, 30000);
      callback();
      return;
    }

    // нет DLL, которую грузит exe (обычно её удалил антивирус) — Windows не запустит игру
    const dllProblem = await PWGame.missingDllProblem();
    if (dllProblem) {
      App.error(dllProblem, 60000);
      callback();
      return;
    }

    // копия настроек с сервера на диск (чужие изменения файлов не уходят в базу) — параллельно с замером серверов
    const pulling = Promise.race([GameSettingsSync.pull(), new Promise((resolve) => setTimeout(resolve, 3000))]).catch((e) =>
      console.error('game settings pull before game failed', e),
    );

    if (ips) {
      // The whole block always goes to the client, reordered by the probes:
      // fastest reachable first, unreachable at the end.
      ips = await PWGame.orderServerIps(ips, port);
    }

    await pulling;

    // загрузочный экран «Ярмарки»: каждый бой — случайный из ротации (пишется в user.cfg до запуска игры)
    await import('./fair.js').then(({ syncFairGameFiles }) => syncFairGameFiles()).catch((e) => console.error('fair: sync before game failed', e));

    // что изменится в файлах настроек до выхода из игры — изменения игры (уйдут в копию на сервере)
    const settingsBefore = GameSettingsSync.beforeGame();

    PWGame.currentPlayPwProtocol = PWGame.GetPlayPwProtocol(id, ips, port, method, options);

    PWGame.openProtocolSocket();

    // краш игры (окно «Unhandled Exception») — дамп, лог и реплей на бэкенд, не дожидаясь закрытия окна (crashReport.js)
    CrashReport.watch(id);

    // как игрок уйдёт из боя (кнопка «Выйти», вылет, снятый процесс, сеть) — battleLeave.js
    if (method !== 'spectate') {
      BattleLeave.start(id);
    }

    // игра закрыта — реплей этого боя на бэкенд (replayUpload.js), зрителю не нужно
    const onGameExit = (error = null) => {
      PWGame.isGameRunning = false;
      GameSettingsSync.afterGame(settingsBefore);
      CrashReport.afterGame(error && error.code);
      if (method !== 'spectate') {
        ReplayUpload.afterGame(id);
        BattleLeave.finish(error && error.code).catch((e) => console.warn('leave: finish failed', e));
      }
      // файлы игры освобождены: пропущенный из-за игры апдейт можно догнать сразу, не дожидаясь
      // следующего тика наблюдателя (он и так проверит isSafeToRestart — в поиске/бою не тронет)
      try {
        NativeAPI.checkContentUpdate().catch(() => {});
      } catch {}
      callback();
    };

    PWGame.isGameRunning = true;
    try {
      if (NativeAPI.platform == 'linux') {
        let spawn = await NativeAPI.childProcess.exec(PWGame.LUTRIS_EXEC);
        spawn.on('close', async (code) => {
          onGameExit();
        });
        // запуск не состоялся (нет Lutris/игры) — иначе флаг «игра жива» заблокировал бы обновления
        spawn.on('error', (error) => onGameExit(error || new Error('lutris spawn failed')));
      } else {
        await NativeAPI.exec(PWGame.PATH, PWGame.WORKING_DIR_PATH, ['protocol', PWGame.currentPlayPwProtocol], onGameExit);
      }
    } catch (error) {
      PWGame.isGameRunning = false;
      throw error;
    }
  }

  static async reconnect(id, callback, ips, port) {
    this.start(id, callback, ips, port);
  }

  // Live match viewing: key = <session 32><spectator key 64><user id>
  // options — «/bots=…» для тренировки с ботами (spectator.watch отдаёт data.bots)
  static async spectate(key, callback, ips, port, options = '') {
    return PWGame.start(key, callback, ips, port, 'spectate', options);
  }

  static async check() {
    if (!NativeAPI.status) {
      //throw 'Необходима Windows версия лаунчера';
    }

    await NativeAPI.fileSystem.promises.access(PWGame.PATH);
  }

  // Сверка версии PW_Game.exe с App.PW_VERSION. null — всё в порядке или проверить нечем
  // (нет файла, нет ресурса версии: тогда решает сам exe); иначе текст для игрока.
  // При расхождении заново запускает обновление (если апдейтер есть и сейчас свободен).
  static async exeVersionProblem() {
    PWGame.exeVersionBlocked = false;
    if (!NativeAPI.fileSystem) return null;
    const have = await readExeVersion(NativeAPI.fileSystem, PWGame.PATH);
    const need = App.PW_VERSION;
    if (!have || !need || have === need) return null;

    PWGame.exeVersionBlocked = true;
    const updaterPath = NativeAPI.platform == 'linux' ? PWGame.PATH_UPDATE_LINUX : PWGame.PATH_UPDATE;
    let hasUpdater = false;
    try {
      await NativeAPI.fileSystem.promises.access(updaterPath);
      hasUpdater = true;
    } catch {}
    try {
      NativeAPI.logUpdate('exe-version-mismatch', `exe=${have} launcher=${need} updater=${hasUpdater}`);
    } catch {}
    if (hasUpdater && !NativeAPI.updateInProgress && !PWGame.isGameRunning) {
      try {
        Promise.resolve(NativeAPI.update(null, { background: true })).catch(() => {});
      } catch {}
    }
    return Lang.text(hasUpdater ? 'gameExeOutdated' : 'gameExeOutdatedSteam').replace('{have}', have).replace('{need}', need);
  }

  // DLL из импорта PW_Game.exe, которых нет на диске (gameDlls.js). null — всё на месте;
  // иначе текст для игрока. Апдейтер возвращает удалённые файлы — запускаем его, если он есть.
  static async missingDllProblem() {
    if (!NativeAPI.fileSystem || NativeAPI.platform == 'linux') return null;
    const missing = await findMissingDlls(NativeAPI.fileSystem, PWGame.PATH, PWGame.WORKING_DIR_PATH);
    if (!missing.length) return null;

    let hasUpdater = false;
    try {
      await NativeAPI.fileSystem.promises.access(PWGame.PATH_UPDATE);
      hasUpdater = true;
    } catch {}
    try {
      NativeAPI.logUpdate('game-dll-missing', `${missing.join(',')} updater=${hasUpdater}`);
    } catch {}
    if (hasUpdater && !NativeAPI.updateInProgress && !PWGame.isGameRunning) {
      try {
        Promise.resolve(NativeAPI.update(null, { background: true })).catch(() => {});
      } catch {}
    }
    return Lang.text(hasUpdater ? 'gameDllMissing' : 'gameDllMissingSteam').replace('{files}', missing.join(', '));
  }

  static async checkUpdates() {
    const exeProblem = await PWGame.exeVersionProblem();
    if (exeProblem) {
      throw exeProblem;
    }
    const dllProblem = await PWGame.missingDllProblem();
    if (dllProblem) {
      throw dllProblem;
    }
    if (PWGame.isUpdateFailed) {
      throw 'Не удалось обновить игру! Обратитесь в поддержку PWClassic';
    }
    if (PWGame.isTestHashesFailed) {
      throw 'Файлы игры повреждены! Обратитесь в поддержку PWClassic';
    }
    if (!PWGame.isUpToDate) {
      //throw 'Проверка обновления не завершена! Подождите';
    }
    if (!PWGame.isValidated) {
      //throw 'Проверка файлов не завершена! Подождите';
    }
  }

}

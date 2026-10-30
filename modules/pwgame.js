import { App } from './app.js';
import { Lang } from './lang.js';
import { NativeAPI } from './nativeApi.js';
import { ReplayUpload } from './replayUpload.js';
import { renderBackendToken } from './gameRender.js';

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

  static isTestHashesFailed = false;

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

  static GetPlayPwProtocol(id, ips, port, method = 'runGame') {
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
    protocol = `${protocol}${renderBackendToken('d3d9')}`;
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
    let rtts = await Promise.all(ips.map((ip) => PWGame.udpGameProbe(ip, loginPort)));
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

  static async start(id, callback, ips, port, method = 'runGame') {
    await PWGame.check();

    // бой уже найден, а апдейтер ещё пишет файлы игры (обновление началось во время подтверждения):
    // запускаем игру только после его завершения
    if (NativeAPI.updateInProgress) {
      App.notify(Lang.text('updateGameStartWait'));
      while (NativeAPI.updateInProgress) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // загрузочный экран «Ярмарки»: каждый бой — случайный из ротации (пишется в user.cfg до запуска игры)
    await import('./fair.js').then(({ syncFairGameFiles }) => syncFairGameFiles()).catch((e) => console.error('fair: sync before game failed', e));

    if (ips) {
      // The whole block always goes to the client, reordered by the probes:
      // fastest reachable first, unreachable at the end.
      ips = await PWGame.orderServerIps(ips, port);
    }

    PWGame.currentPlayPwProtocol = PWGame.GetPlayPwProtocol(id, ips, port, method);

    PWGame.openProtocolSocket();

    // игра закрыта — реплей этого боя на бэкенд (replayUpload.js), зрителю не нужно
    const onGameExit = () => {
      if (method !== 'spectate') {
        ReplayUpload.afterGame(id);
      }
      callback();
    };

    if (NativeAPI.platform == 'linux') {
      let spawn = await NativeAPI.childProcess.exec(PWGame.LUTRIS_EXEC);
      spawn.on('close', async (code) => {
        onGameExit();
      });
    } else {
      await NativeAPI.exec(PWGame.PATH, PWGame.WORKING_DIR_PATH, ['protocol', PWGame.currentPlayPwProtocol], onGameExit);
    }
  }

  static async reconnect(id, callback, ips, port) {
    this.start(id, callback, ips, port);
  }

  // Live match viewing: key = <session 32><spectator key 64><user id>
  static async spectate(key, callback, ips, port) {
    return PWGame.start(key, callback, ips, port, 'spectate');
  }

  static async check() {
    if (!NativeAPI.status) {
      //throw 'Необходима Windows версия лаунчера';
    }

    await NativeAPI.fileSystem.promises.access(PWGame.PATH);
  }

  static async checkUpdates() {
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

import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';
import { CrashReport } from './crashReport.js';
import { ReplayUpload } from './replayUpload.js';

// Как игрок ушёл из боя: сам нажал «Выйти», закрыл процесс игры (диспетчер задач),
// игра упала или зависла, выключил сеть или пропала связь, выключился ПК.
// Нужно, чтобы решать, наказывать ли ливера (бэкенд хранит в таблице battle_leave,
// pw-api objects/battleLeave.js; сам ливер — по списку afk игрового сервера).
//
// Пока идёт бой, лончер пишет файл <nw.App.dataPath>\battle-leave\<токен>-<старт>.json:
// события сети (адаптер без адреса, navigator.offline, обрыв WS лончера) и снимки
// адаптеров Windows (Get-NetAdapter, радио WinRT, режим «в самолёте» — без локализации).
// После выхода из игры дописывает, как она закрылась (код выхода, дампы, строки лога
// игры), шлёт на бэкенд (crash.leave) и удаляет файл. Нет связи — досылает, когда
// связь вернётся. Лончер был закрыт во время боя — при следующем запуске дождётся
// конца игры (если ещё идёт) или разберёт по логу игры и времени загрузки Windows.
export class BattleLeave {
  static DIR_NAME = 'battle-leave';

  static POLL_MS = 3000;

  // Процесс игры при «подобранном» бое (лончер перезапускали) проверяем реже
  static PROCESS_POLL_MS = 10000;

  static RETRY_MS = 60 * 1000;

  static TTL_MS = 7 * 24 * 60 * 60 * 1000;

  static MAX_EVENTS = 40;

  static MAX_SNAPSHOTS = 8;

  static SNAPSHOT_TIMEOUT_MS = 15000;

  static LOG_LIMIT = 16 * 1024 * 1024;

  // Код, с которым игра сама выходит при нехватке памяти в системе (MemoryLib/NewHandler.cpp)
  static EXIT_OUT_OF_MEMORY = 0x2000008c;

  static EXIT_HUNG = 0xcfffffff;

  static current = null;

  static running = null;

  static retryTimer = 0;

  static dirCache = null; // подмена папки (тесты)

  static supported() {
    return !!NativeAPI.status && NativeAPI.platform === 'win32';
  }

  static dir() {
    if (BattleLeave.dirCache !== null) return BattleLeave.dirCache;
    try {
      return NativeAPI.path.join(nw.App.dataPath, BattleLeave.DIR_NAME);
    } catch {
      return '';
    }
  }

  // Время загрузки Windows (мс)
  static bootTime(now = Date.now()) {
    try {
      return Math.round(now - NativeAPI.os.uptime() * 1000);
    } catch {
      return 0;
    }
  }

  // ---------- запуск и выход игры (PWGame.start) ----------

  static start(key) {
    if (!BattleLeave.supported()) return;
    const session = ReplayUpload.sessionOf(key);
    if (!session) return;
    BattleLeave.stopWatch();
    const startedAt = Date.now();
    const data = {
      v: 1,
      session,
      line: App.CURRENT_MM || '',
      startedAt,
      bootAt: BattleLeave.bootTime(startedAt),
      baseline: null,
      events: [],
      snapshots: 0,
      finished: false,
    };
    BattleLeave.watch(NativeAPI.path.join(BattleLeave.dir(), `${session}-${startedAt}.json`), data, false);
  }

  // Игра закрыта (exitCode — код выхода процесса, 0/undefined — нормальный выход)
  static finish(exitCode = 0) {
    const cur = BattleLeave.current;
    if (!cur || cur.adopted) return Promise.resolve();
    return BattleLeave.finalize(cur, true, CrashReport.exitCodeOf(exitCode));
  }

  static async finalize(cur, exitSeen, exitCode) {
    BattleLeave.stopWatch();
    if (BattleLeave.current === cur) BattleLeave.current = null;
    const data = cur.data;
    // снимок адаптеров ещё снимается — он нужнее всего (сеть пропала прямо перед выходом)
    await Promise.race([cur.pending || Promise.resolve(), new Promise((resolve) => setTimeout(resolve, BattleLeave.SNAPSHOT_TIMEOUT_MS))]);
    try {
      await BattleLeave.analyze(data, exitSeen, exitCode);
    } catch (error) {
      console.warn('leave: analyze failed', error);
    }
    data.finished = true;
    await BattleLeave.write(cur.file, data);
    BattleLeave.resume();
  }

  // ---------- наблюдение за сетью во время боя ----------

  static watch(file, data, adopted) {
    const cur = {
      file,
      data,
      adopted,
      ifaces: BattleLeave.interfaces(),
      online: BattleLeave.online(),
      api: BattleLeave.apiUp(),
      pending: null,
      timer: 0,
      processCheckAt: 0,
    };
    BattleLeave.current = cur;
    BattleLeave.write(file, data);
    if (!data.baseline) {
      cur.pending = BattleLeave.snapshot().then((snap) => {
        cur.pending = null;
        if (snap && !data.baseline) {
          data.baseline = snap;
          BattleLeave.write(file, data);
        }
      });
    }
    cur.timer = setInterval(() => BattleLeave.tick(cur), BattleLeave.POLL_MS);
  }

  static stopWatch() {
    if (BattleLeave.current) clearInterval(BattleLeave.current.timer);
  }

  static tick(cur, now = Date.now()) {
    if (BattleLeave.current !== cur) return;
    const changes = [];
    const ifaces = BattleLeave.interfaces();
    const lost = cur.ifaces.filter((name) => !ifaces.includes(name));
    const gained = ifaces.filter((name) => !cur.ifaces.includes(name));
    if (lost.length) changes.push({ t: now, type: 'ifaceDown', names: lost });
    if (gained.length) changes.push({ t: now, type: 'ifaceUp', names: gained });
    cur.ifaces = ifaces;

    const online = BattleLeave.online();
    if (online !== cur.online) changes.push({ t: now, type: online ? 'online' : 'offline' });
    cur.online = online;

    const api = BattleLeave.apiUp();
    if (api !== cur.api) changes.push({ t: now, type: api ? 'apiUp' : 'apiDown' });
    cur.api = api;

    for (const event of changes) BattleLeave.addEvent(cur, event);

    const down = changes.find((event) => event.type === 'ifaceDown' || event.type === 'offline' || event.type === 'apiDown');
    if (down) BattleLeave.snapshotFor(cur, down);

    // лончер перезапускали во время боя: кода выхода не узнать, ждём, пока процесс игры пропадёт
    if (cur.adopted && now >= cur.processCheckAt) {
      cur.processCheckAt = now + BattleLeave.PROCESS_POLL_MS;
      BattleLeave.gameRunning().then((alive) => {
        if (!alive && BattleLeave.current === cur) BattleLeave.finalize(cur, false, null);
      });
    }
  }

  static addEvent(cur, event) {
    const events = cur.data.events;
    if (events.length >= BattleLeave.MAX_EVENTS) events.splice(1, 1); // первое событие — самое важное
    events.push(event);
    BattleLeave.write(cur.file, cur.data);
  }

  // Снимок адаптеров к событию «сеть пропала» и причина по сравнению с началом боя
  static snapshotFor(cur, event) {
    if (cur.pending || cur.data.snapshots >= BattleLeave.MAX_SNAPSHOTS) return;
    cur.data.snapshots++;
    cur.pending = BattleLeave.snapshot().then((snap) => {
      cur.pending = null;
      if (!snap) return;
      event.snap = snap;
      event.cause = BattleLeave.netCause(cur.data.baseline, snap);
      BattleLeave.write(cur.file, cur.data);
    });
  }

  // Интерфейсы с рабочим адресом (без loopback, APIPA 169.254 и link-local IPv6)
  static interfaces() {
    let list = {};
    try {
      list = NativeAPI.os.networkInterfaces() || {};
    } catch {
      return [];
    }
    return Object.keys(list)
      .filter((name) =>
        (list[name] || []).some((addr) => {
          if (!addr || addr.internal) return false;
          const address = String(addr.address || '');
          if (addr.family === 'IPv4' || addr.family === 4) return !address.startsWith('169.254.');
          return !/^fe80:/i.test(address);
        }),
      )
      .sort();
  }

  static online() {
    try {
      return navigator.onLine !== false;
    } catch {
      return true;
    }
  }

  static apiUp() {
    try {
      return !!App.api && !!App.api.WebSocket && App.api.WebSocket.readyState === 1;
    } catch {
      return false;
    }
  }

  // Состояние сети Windows: {adapters:[{name, desc, status, admin, media, type}], radios:[{kind, state}], airplane}
  // Значения перечислений — английские при любом языке Windows. Только физические адаптеры.
  static async snapshot() {
    const script = [
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      '$r = @{ adapters = @(); radios = @(); airplane = $null }',
      'try { $r.adapters = @(Get-NetAdapter | Where-Object { -not $_.Virtual } | ForEach-Object { @{ name = $_.Name; desc = $_.InterfaceDescription; status = [string]$_.Status; admin = [string]$_.AdminStatus; media = [string]$_.MediaConnectionState; type = [string]$_.PhysicalMediaType } }) } catch {}',
      'try { Add-Type -AssemblyName System.Runtime.WindowsRuntime; $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq \'AsTask\' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq \'IAsyncOperation`1\' })[0]; $null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]; $t = $asTask.MakeGenericMethod([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]).Invoke($null, @([Windows.Devices.Radios.Radio]::GetRadiosAsync())); if ($t.Wait(3000)) { $r.radios = @($t.Result | ForEach-Object { @{ kind = [string]$_.Kind; state = [string]$_.State } }) } } catch {}',
      "try { $r.airplane = [int](Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\RadioManagement\\SystemRadioState' -ErrorAction Stop).'(default)' } catch {}",
      '$r | ConvertTo-Json -Depth 4 -Compress',
    ].join('; ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const text = await CrashReport.runCapture('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
    try {
      const raw = JSON.parse(String(text || '').trim());
      const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
      return {
        t: Date.now(),
        adapters: list(raw.adapters).map((a) => ({
          name: String(a.name || '').substring(0, 64),
          desc: String(a.desc || '').substring(0, 96),
          status: String(a.status || ''),
          admin: String(a.admin || ''),
          media: String(a.media || ''),
          type: String(a.type || ''),
        })),
        radios: list(raw.radios).map((r) => ({ kind: String(r.kind || ''), state: String(r.state || '') })),
        airplane: raw.airplane === null || raw.airplane === undefined ? null : Number(raw.airplane),
      };
    } catch {
      return null;
    }
  }

  // Почему пропала сеть (снимок в момент события против снимка в начале боя):
  //   airplane       — включён режим «в самолёте»
  //   adapterOff     — адаптер, через который шла сеть, отключён в Windows или извлечён
  //   wifiOff        — выключен Wi-Fi (кнопка/переключатель)
  //   linkLost       — адаптер включён, но отключился от сети (Wi-Fi потерял роутер, кабель, роутер без питания)
  //   connectionLost — адаптеры подключены, связи нет (провайдер, роутер, сервер)
  static netCause(baseline, snap) {
    if (!snap) return '';
    if (Number(snap.airplane) === 1) return 'airplane';
    const before = new Map(((baseline && baseline.adapters) || []).map((a) => [a.name, a]));
    const now = new Map((snap.adapters || []).map((a) => [a.name, a]));
    const wasUp = [...before.values()].filter((a) => a.status === 'Up');
    for (const a of wasUp) {
      const cur = now.get(a.name);
      if (!cur || cur.admin === 'Down' || cur.status === 'Disabled' || cur.status === 'Not Present') return 'adapterOff';
    }
    const radio = (list) => ((list && list.radios) || []).find((r) => r.kind === 'WiFi');
    const wifiBefore = radio(baseline);
    const wifiNow = radio(snap);
    if (wifiNow && wifiNow.state !== 'On' && (!wifiBefore || wifiBefore.state === 'On')) {
      const wifiAdapterWasUp = wasUp.some((a) => /802\.11|wireless|wi-?fi/i.test(`${a.type} ${a.desc}`));
      if (wifiAdapterWasUp || !wasUp.length) return 'wifiOff';
    }
    if (wasUp.some((a) => now.get(a.name) && now.get(a.name).status !== 'Up')) return 'linkLost';
    if (!wasUp.length && !(snap.adapters || []).some((a) => a.status === 'Up')) return 'linkLost';
    return 'connectionLost';
  }

  // ---------- как закрылась игра ----------

  static async analyze(data, exitSeen, exitCode, now = Date.now()) {
    data.exitSeen = !!exitSeen;
    data.exitAt = exitSeen ? now : 0;
    data.exitCode = exitSeen ? exitCode >>> 0 : null;
    data.bootNow = BattleLeave.bootTime(now);

    const run = await BattleLeave.runFolder(data.startedAt);
    let names = [];
    let log = null;
    if (run) {
      try {
        names = await NativeAPI.fileSystem.promises.readdir(run.folderPath);
      } catch {}
      const output = names.find((name) => /-output(\(\d+\))?\.txt$/.test(name));
      if (output) {
        const text = await CrashReport.readTail(NativeAPI.path.join(run.folderPath, output), BattleLeave.LOG_LIMIT);
        if (text) log = BattleLeave.parseGameLog(text.toString('latin1'), CrashReport.parseStamp(run.folder));
      }
      data.logFolder = run.folder;
    }
    data.log = log;
    data.dumps = names.filter((name) => /-(exception|fatal)\.dmp$|-crash\.txt$/.test(name)).length;
    data.exitKind = BattleLeave.exitKind(data, names);
    const net = BattleLeave.explainingNet(data);
    data.netCause = net ? net.cause || '' : '';
    data.netAt = net ? net.t : 0;
  }

  // Папка логов этого запуска игры: первая, созданная не раньше чем за минуту до старта
  // и с логом (после перезапуска лончера самая новая папка уже от другого запуска)
  static async runFolder(since) {
    const root = CrashReport.logsDir();
    if (!root || !since) return null;
    const fs = NativeAPI.fileSystem;
    let folders;
    try {
      folders = await fs.promises.readdir(root);
    } catch {
      return null;
    }
    const candidates = folders
      .filter((name) => CrashReport.FOLDER_RE.test(name))
      .map((name) => ({ folder: name, time: CrashReport.parseStamp(name) }))
      .filter((item) => item.time >= since - 60000 && item.time <= since + 10 * 60000)
      .sort((a, b) => a.time - b.time);
    for (const item of candidates) {
      const folderPath = NativeAPI.path.join(root, item.folder);
      try {
        const names = await fs.promises.readdir(folderPath);
        if (names.some((name) => /-output(\(\d+\))?\.txt$/.test(name))) return { folder: item.folder, folderPath };
      } catch {}
    }
    return null;
  }

  // crash | hang | memory | quit | killed | poweroff
  static exitKind(data, names = []) {
    const code = data.exitCode;
    const exceptionDump = names.some((name) => /-exception\.dmp$/.test(name));
    if (data.exitSeen) {
      if (code === BattleLeave.EXIT_HUNG) return 'hang';
      if (code === BattleLeave.EXIT_OUT_OF_MEMORY) return 'memory';
      if (CrashReport.isCrashExit(code) || exceptionDump) return 'crash';
      if (data.log && data.log.quitAt) return 'quit';
      return 'killed';
    }
    // выхода лончер не видел (был закрыт или выключился ПК)
    if (exceptionDump || names.some((name) => /-fatal\.dmp\.crash$/.test(name))) return 'crash';
    if (data.log && data.log.quitAt) return 'quit';
    // Windows загружалась уже после начала боя: ПК выключался или перезагружался
    if (data.bootNow && data.bootNow > data.startedAt + 30000) return 'poweroff';
    return 'killed';
  }

  // Строки лога игры (время в логе — UTC; дата — из имени папки запуска):
  //   «Lost channel to Game Server» — связь с игровым сервером пропала (если потом нет
  //   успешного реконнекта — так игра и вышла из боя), «combat screen destroyed» — игра
  //   закрыла экран боя сама (кнопка «Выйти» или выход после боя).
  static parseGameLog(text, folderTime) {
    const result = { lostAt: 0, quitAt: 0, reconnects: 0, lastAt: 0 };
    if (!text || !Number.isFinite(folderTime)) return result;
    const base = new Date(folderTime);
    const day = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
    let shift = 0;
    let prev = 0;
    const timeOf = (line) => {
      const m = /^\(\d+\)\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/.exec(line);
      if (!m) return 0;
      let t = day + shift + ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
      if (prev && t < prev - 12 * 60 * 60 * 1000) {
        shift += 24 * 60 * 60 * 1000; // полночь UTC
        t += 24 * 60 * 60 * 1000;
      }
      if (!prev && t < folderTime - 60 * 60 * 1000) {
        shift += 24 * 60 * 60 * 1000;
        t += 24 * 60 * 60 * 1000;
      }
      prev = Math.max(prev, t);
      return t;
    };
    for (const line of text.split(/\r?\n/)) {
      const t = timeOf(line);
      if (!t) continue;
      result.lastAt = t;
      if (line.includes('Lost channel to Game Server')) {
        result.lostAt = t;
      } else if (line.includes('Reconnect: World data applied') || line.includes('Reconnect: Replay join from step')) {
        result.reconnects++;
        result.lostAt = 0; // связь восстановилась
      } else if (line.includes('combat screen destroyed')) {
        result.quitAt = t;
      }
    }
    return result;
  }

  // Сетевое событие, которое объясняет уход: за 3 минуты до потери связи игрой (или до
  // выхода, если игра связь не теряла) и чуть после (снимок мог опоздать)
  static explainingNet(data) {
    const ref = (data.log && data.log.lostAt) || data.exitAt || (data.log && data.log.lastAt) || 0;
    if (!ref) return null;
    const down = (data.events || []).filter((e) => (e.type === 'ifaceDown' || e.type === 'offline' || e.type === 'apiDown') && e.t >= ref - 3 * 60 * 1000 && e.t <= ref + 15000);
    if (!down.length) return null;
    // нарочное отключение важнее «связь пропала»
    const order = ['airplane', 'adapterOff', 'wifiOff', 'linkLost', 'connectionLost'];
    const withCause = down.filter((e) => e.cause).sort((a, b) => order.indexOf(a.cause) - order.indexOf(b.cause));
    return withCause[0] || down[0];
  }

  // ---------- отправка на бэкенд ----------

  static payload(data) {
    const trimSnap = (snap) => (snap ? { t: snap.t, adapters: snap.adapters.slice(0, 8), radios: snap.radios.slice(0, 4), airplane: snap.airplane } : null);
    return {
      session: data.session,
      startedAt: data.startedAt,
      exitAt: data.exitAt || 0,
      exitSeen: !!data.exitSeen,
      exitCode: data.exitCode === null || data.exitCode === undefined ? null : data.exitCode,
      exitKind: data.exitKind || '',
      lostAt: (data.log && data.log.lostAt) || 0,
      quitAt: (data.log && data.log.quitAt) || 0,
      lastLogAt: (data.log && data.log.lastAt) || 0,
      reconnects: (data.log && data.log.reconnects) || 0,
      netCause: data.netCause || '',
      netAt: data.netAt || 0,
      dumps: data.dumps || 0,
      launcherRestarted: !!data.adoptedAt,
      bootAt: data.bootAt || 0,
      bootNow: data.bootNow || 0,
      baseline: trimSnap(data.baseline),
      events: (data.events || []).slice(0, BattleLeave.MAX_EVENTS).map((e) => ({ t: e.t, type: e.type, names: e.names, cause: e.cause, snap: trimSnap(e.snap) })),
    };
  }

  // Дослать всё, что лежит в папке (замок показан, связь вернулась). Вызывать можно сколько угодно.
  static resume() {
    if (!BattleLeave.supported() || BattleLeave.running) return BattleLeave.running;
    BattleLeave.running = BattleLeave.run()
      .catch((error) => console.warn('leave: queue failed', error))
      .finally(() => {
        BattleLeave.running = null;
      });
    return BattleLeave.running;
  }

  static async run(now = Date.now()) {
    const dir = BattleLeave.dir();
    if (!dir) return;
    const fs = NativeAPI.fileSystem;
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return;
    }
    let left = 0;
    let adoptChecked = false;
    // новые первыми: подхватить идущий бой можно только самый свежий
    const files = names.filter((item) => /^[0-9a-f]{32}-\d+\.json$/.test(item)).sort((a, b) => Number(b.split(/[-.]/)[1]) - Number(a.split(/[-.]/)[1]));
    for (const name of files) {
      const file = NativeAPI.path.join(dir, name);
      if (BattleLeave.current && BattleLeave.current.file === file) continue;
      let data;
      try {
        data = JSON.parse(await fs.promises.readFile(file, 'utf8'));
      } catch {
        await BattleLeave.remove(file);
        continue;
      }
      if (!data || !data.session || now - Number(data.startedAt) > BattleLeave.TTL_MS) {
        await BattleLeave.remove(file);
        continue;
      }
      if (!data.finished) {
        // лончер закрывали во время боя: игра ещё идёт — ждём её конца, иначе разбираем по логу
        if (!adoptChecked && !BattleLeave.current && now - Number(data.startedAt) < 6 * 60 * 60 * 1000) {
          adoptChecked = true;
          if (await BattleLeave.gameRunning()) {
            data.adoptedAt = now;
            BattleLeave.watch(file, data, true);
            continue;
          }
        }
        adoptChecked = true;
        try {
          await BattleLeave.analyze(data, false, null, now);
        } catch (error) {
          console.warn('leave: analyze failed', error);
        }
        data.adoptedAt = data.adoptedAt || now;
        data.finished = true;
        await BattleLeave.write(file, data);
      }
      if (!App.storage?.data?.token || !BattleLeave.apiUp()) {
        left++;
        continue;
      }
      try {
        const result = await App.api.request('crash', 'leave', BattleLeave.payload(data));
        console.log(`leave: ${data.session} ${data.exitKind} ${data.netCause || '-'} ${JSON.stringify(result || {})}`);
        await BattleLeave.remove(file); // принято (или бэкенду не нужно) — локально стираем
      } catch (error) {
        const text = String((error && error.message) || error);
        console.warn(`leave: ${data.session} send failed: ${text}`);
        left++;
      }
    }
    clearTimeout(BattleLeave.retryTimer);
    BattleLeave.retryTimer = left ? setTimeout(() => BattleLeave.resume(), BattleLeave.RETRY_MS) : 0;
  }

  static async gameRunning() {
    const list = await CrashReport.runCapture('tasklist.exe', ['/fi', 'IMAGENAME eq PW_Game.exe', '/fo', 'csv', '/nh'], 'latin1');
    return /"PW_Game\.exe"/i.test(list || '');
  }

  // ---------- файлы ----------

  static writes = new Map(); // файл → цепочка записей (по одной за раз)

  static write(file, data) {
    if (!file) return Promise.resolve();
    const text = JSON.stringify(data);
    const next = (BattleLeave.writes.get(file) || Promise.resolve()).then(() => BattleLeave.writeNow(file, text));
    BattleLeave.writes.set(file, next);
    next.finally(() => {
      if (BattleLeave.writes.get(file) === next) BattleLeave.writes.delete(file);
    });
    return next;
  }

  static async writeNow(file, text) {
    try {
      const fs = NativeAPI.fileSystem;
      await fs.promises.mkdir(NativeAPI.path.dirname(file), { recursive: true });
      // через временный файл: выключение ПК посреди записи не оставит обрывок JSON
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, text);
      await fs.promises.rename(tmp, file);
    } catch (error) {
      console.warn('leave: write failed', error);
    }
  }

  static async remove(file) {
    await (BattleLeave.writes.get(file) || Promise.resolve());
    try {
      await NativeAPI.fileSystem.promises.rm(file, { force: true });
    } catch {}
  }
}

import { App } from './app.js';

/*
 * Статистика игрока (аудит) внутри лаунчера.
 *
 * Код аудита — сборка сайта stats (npm run build:launcher в репозитории stats),
 * лежит в content/stats: audit.js (минифицированный, работает на любой NW.js)
 * и, как дополнение, audit.bin (nwjc) с audit.bin.json — версией NW.js, под
 * которую он собран. .bin запускается только на ровно этой версии.
 * Монтируется прямо в экран лаунчера, в своём shadow root: стили сайта и
 * лаунчера друг друга не видят. Данные и картинки берёт с сервера сайта,
 * игрока узнаёт по токену лаунчера — входить отдельно не нужно.
 *
 * Один экземпляр на всё время работы лаунчера: при уходе с экрана он просто
 * отцепляется от DOM и при возвращении показывается в том же состоянии.
 *
 * ОБНОВЛЕНИЕ С САЙТА. Аудит обновляется вместе с сайтом, без нового лаунчера:
 * при открытии экрана лаунчер читает /stats/launcher/audit/manifest.json и,
 * если там другая сборка, скачивает её в папку данных лаунчера: .bin под нашу
 * версию NW.js, если он есть, иначе универсальный JS. Запускается только
 * сборка, чья подпись сходится с ключом ниже (подписывает её машина сборки,
 * ключа на сервере нет) и чей SHA-256 совпал. Нет сети или что-то не
 * сошлось — последняя проверенная скачанная сборка, а без неё — встроенная.
 *
 * СИНХРОННОСТЬ С САЙТОМ. Сайт и аудит выкладываются одной командой (npm run
 * publish в stats), поэтому новая версия сайта = новый манифест. Лаунчер
 * открыт часами, так что манифест сверяется не только при старте: при каждом
 * открытии экрана, если с прошлой проверки прошло REFRESH_MS. Новая сборка
 * скачивается и запускается в фоне, а при следующем открытии экрана аудит
 * перемонтируется уже на ней (на глазах у игрока ничего не пропадает).
 */
export class Stats {
  // Сервер сайта. Для отладки на стенде: localStorage.pw_stats_origin = 'http://localhost:8080'.
  static origin = (() => {
    try {
      return localStorage.getItem('pw_stats_origin') || 'https://pw.zone-play.com';
    } catch {
      return 'https://pw.zone-play.com';
    }
  })();

  // Открытый ключ подписи сборок аудита (frontend/scripts/build-launcher.mjs --publish).
  static AUDIT_PUBLIC_KEY = [
    '-----BEGIN PUBLIC KEY-----',
    'MCowBQYDK2VwAyEAzyYoyjzEZyRL/nnVlySnuYBiXs3P8JtYkg1wlmlF6tY=',
    '-----END PUBLIC KEY-----',
  ].join('\n');

  static element = null;
  static handle = null;
  static token = '';
  static loading = null;
  // Как часто сверяться с сайтом, пока лаунчер открыт.
  static REFRESH_MS = 5 * 60 * 1000;
  // SHA-256 запущенной сборки ('' — неизвестна) и время последней сверки с сайтом.
  static runningSha = '';
  static checkedAt = 0;
  static refreshing = null;
  // Новая сборка уже запущена в фоне: при следующем open() перемонтировать аудит.
  static stale = false;
  // The last token we sent a device fingerprint for — once per account per run.
  static fpSentToken = '';

  static currentToken() {
    const data = App?.storage?.data || {};
    const id = Number(data.id || 0);
    if (id <= 0) return '';
    const signed = `${data.launcherToken || data.auditToken || ''}`.trim();
    if (signed) return signed;
    // The game session token from sign-in: the site checks it against
    // user_session, so no game server change is needed.
    const session = `${data.token || ''}`.trim();
    return /^[0-9a-f]{16,128}$/i.test(session) ? `launcher_s1_${id}_${session}` : `launcher_dev_${id}`;
  }

  static route({ id = 0, login = '' } = {}) {
    const targetId = Number(id) || 0;
    const targetLogin = String(login || '').trim();
    if (targetId > 0) return `/profile/${targetId}`;
    if (targetLogin) return `/p/${encodeURIComponent(targetLogin)}`;
    const ownId = Number(App?.storage?.data?.id) || 0;
    return ownId > 0 ? `/profile/${ownId}` : '/';
  }

  /** Версия NW.js этого лаунчера ('' в браузере). */
  static nwVersion() {
    return (typeof process !== 'undefined' && process.versions && process.versions.nw) || '';
  }

  /**
   * Сборка из манифеста подписана нашим ключом и годится для этого лаунчера.
   *  - kind 'bin': байткод nwjc, только для той же версии NW.js, что у нас
   *    (evalNWBin с чужой версией не бросает исключение, а роняет лаунчер);
   *  - kind 'js':  обычный (минифицированный) скрипт, работает на любой версии.
   */
  static trustedBuild(build) {
    if (!build || typeof build !== 'object') return false;
    const { kind, nw: nwVersion, sha256, file, signature } = build;
    if (!/^[0-9a-f]{64}$/.test(`${sha256}`)) return false;
    let text;
    if (kind === 'bin') {
      if (!nwVersion || nwVersion !== Stats.nwVersion() || !/^audit-[0-9a-f]{16}\.bin$/.test(`${file}`)) return false;
      text = ['pw-audit', nwVersion, sha256];
    } else if (kind === 'js') {
      if (!/^audit-[0-9a-f]{16}\.js$/.test(`${file}`)) return false;
      text = ['pw-audit-js', sha256];
    } else {
      return false;
    }
    try {
      const crypto = require('crypto');
      return crypto.verify(null, Buffer.from(text.join('\n')), Stats.AUDIT_PUBLIC_KEY, Buffer.from(`${signature}`, 'base64'));
    } catch {
      return false;
    }
  }

  /**
   * Что брать из манифеста сайта: .bin строго под нашу версию NW.js, иначе
   * универсальный JS. Манифест:
   *   { js: {file, sha256, signature}, bins: {"0.118.0": {file, sha256, signature}, …},
   *     nw, file, sha256, signature }   ← последние — одна сборка для старых лаунчеров
   */
  static pickBuild(manifest) {
    if (!manifest || typeof manifest !== 'object') return null;
    const version = Stats.nwVersion();
    const bins = manifest.bins && typeof manifest.bins === 'object' ? manifest.bins : {};
    const candidates = [
      version && Object.hasOwn(bins, version) ? { ...bins[version], kind: 'bin', nw: version } : null,
      version && manifest.nw === version
        ? { kind: 'bin', nw: manifest.nw, file: manifest.file, sha256: manifest.sha256, signature: manifest.signature }
        : null,
      manifest.js ? { ...manifest.js, kind: 'js' } : null,
    ];
    return candidates.find((build) => build && Stats.trustedBuild(build)) ?? null;
  }

  static sha256(data) {
    return require('crypto').createHash('sha256').update(data).digest('hex');
  }

  /** Файл сборки в папке данных лаунчера. */
  static cacheFile(dir, build) {
    return require('path').join(dir, build.kind === 'bin' ? 'audit.bin' : 'audit.js');
  }

  /** Скачанная сборка из папки данных лаунчера, если она цела, подписана и годится под нашу NW.js. */
  static cachedBuild(dir) {
    const fs = require('fs');
    const path = require('path');
    try {
      const build = JSON.parse(fs.readFileSync(path.join(dir, 'build.json'), 'utf8'));
      const file = Stats.cacheFile(dir, build);
      if (Stats.trustedBuild(build) && Stats.sha256(fs.readFileSync(file)) === build.sha256) {
        return { ...build, path: file };
      }
    } catch {}
    return null;
  }

  /** Свежая сборка с сайта (или проверенная из кэша); null — брать встроенную. */
  static async updatedBuild() {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(nw.App.dataPath, 'stats-audit');
    const cached = Stats.cachedBuild(dir);
    const base = `${Stats.origin}/stats/launcher/audit/`;

    let build;
    try {
      const response = await fetch(`${base}manifest.json`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return cached;
      build = Stats.pickBuild(await response.json());
    } catch {
      return cached; // нет сети — последняя проверенная
    }
    if (!build) {
      console.warn(`[stats] в манифесте аудита нет подписанной сборки для NW.js ${Stats.nwVersion()}`);
      return cached;
    }
    if (cached?.kind === build.kind && cached.sha256 === build.sha256) return cached;

    try {
      const response = await fetch(base + build.file, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (Stats.sha256(data) !== build.sha256) throw new Error('SHA-256 не совпал');
      const file = Stats.cacheFile(dir, build);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, data);
      fs.renameSync(`${file}.tmp`, file);
      fs.writeFileSync(path.join(dir, 'build.json'), JSON.stringify(build));
      return { ...build, path: file };
    } catch (error) {
      console.warn('[stats] новая сборка аудита не скачалась', error);
      return cached;
    }
  }

  /** Байткод — только если он собран ровно под нашу NW.js, иначе даже не пробуем. */
  static evalBin(bin, builtFor) {
    if (!builtFor || builtFor !== Stats.nwVersion()) return false;
    try {
      nw.Window.get().evalNWBin(null, bin);
    } catch (error) {
      console.warn('[stats] не загрузился', bin, error);
    }
    return !!window.PwAudit;
  }

  /** Универсальная сборка: обычный скрипт, работает на любой версии NW.js. */
  static evalJs(file) {
    try {
      (0, eval)(require('fs').readFileSync(file, 'utf8'));
    } catch (error) {
      console.warn('[stats] не загрузился', file, error);
    }
    return !!window.PwAudit;
  }

  static run(build) {
    return build.kind === 'bin' ? Stats.evalBin(build.path, build.nw) : Stats.evalJs(build.path);
  }

  /** Встроенный .bin, если рядом audit.bin.json с нашей версией NW.js. */
  static bundledBin() {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(nw.__dirname, 'content', 'stats');
    try {
      const { nw: builtFor } = JSON.parse(fs.readFileSync(path.join(dir, 'audit.bin.json'), 'utf8'));
      const bin = path.join(dir, 'audit.bin');
      if (builtFor && builtFor === Stats.nwVersion() && fs.existsSync(bin)) return { kind: 'bin', nw: builtFor, path: bin };
    } catch {}
    return null;
  }

  /**
   * Порядок: сборка с сайта (подписанная) → встроенный .bin, если он под нашу
   * NW.js → встроенный audit.js (любая версия) → «Статистика недоступна».
   */
  static load() {
    if (window.PwAudit) return Promise.resolve();
    Stats.loading ??= (async () => {
      if (typeof nw !== 'undefined') {
        Stats.checkedAt = Date.now();
        const updated = await Stats.updatedBuild().catch(() => null);
        if (updated && Stats.run(updated)) {
          Stats.runningSha = updated.sha256;
          return;
        }
        const bundled = Stats.bundledBin();
        if (bundled && Stats.run(bundled)) {
          Stats.runningSha = Stats.fileSha(bundled.path);
          return;
        }
        Stats.runningSha = Stats.fileSha(require('path').join(nw.__dirname, 'content', 'stats', 'audit.js'));
      }
      // Универсальная встроенная сборка (и разработка в браузере).
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'content/stats/audit.js';
        script.onload = () => (window.PwAudit ? resolve() : reject(new Error('Статистика не загрузилась')));
        script.onerror = () => reject(new Error('Статистика недоступна. Попробуйте позже.'));
        document.head.append(script);
      });
    })().catch((error) => {
      Stats.loading = null;
      throw error;
    });
    return Stats.loading;
  }

  static fileSha(file) {
    try {
      return Stats.sha256(require('fs').readFileSync(file));
    } catch {
      return '';
    }
  }

  /**
   * Сверка с сайтом, пока лаунчер открыт (не чаще REFRESH_MS). Если на сайте
   * другая сборка — скачать, проверить и запустить в фоне: window.PwAudit
   * становится новым, а смонтированный аудит работает на старом до следующего
   * open(). Не запустилась — остаётся прежняя.
   */
  static refresh() {
    if (typeof nw === 'undefined' || !window.PwAudit) return Promise.resolve(false);
    if (Stats.refreshing) return Stats.refreshing;
    if (Date.now() - Stats.checkedAt < Stats.REFRESH_MS) return Promise.resolve(false);
    Stats.checkedAt = Date.now();
    Stats.refreshing = (async () => {
      const build = await Stats.updatedBuild();
      if (!build || build.sha256 === Stats.runningSha) return false;
      const previous = window.PwAudit;
      window.PwAudit = undefined;
      if (Stats.run(build)) {
        Stats.runningSha = build.sha256;
        Stats.stale = true;
        console.info(`[stats] аудит обновлён с сайта (${build.kind}, ${build.sha256.slice(0, 16)})`);
        return true;
      }
      window.PwAudit = previous;
      return false;
    })()
      .catch(() => false)
      .finally(() => {
        Stats.refreshing = null;
      });
    return Stats.refreshing;
  }

  /** Контейнер аудита для экрана «Статистика», открытый на нужном игроке. */
  static async open(target = {}) {
    await Stats.load();
    // С сайта пришла новая сборка: старый аудит снимаем, ниже смонтируется новый.
    if (Stats.stale && Stats.handle) {
      try {
        Stats.handle.unmount();
      } catch {}
      Stats.element?.remove();
      Stats.handle = null;
      Stats.element = null;
    }
    Stats.stale = false;
    const route = Stats.route(target);
    const token = Stats.currentToken();
    // Защита проекта от смурфов/читеров: при открытии аудита отправляем на
    // сервер отпечаток устройства (железо, MAC; IP берёт сам сервер). Без
    // ожидания — экран открывается сразу, сбор идёт в фоне.
    Stats.sendFingerprint(token);
    // Не вышла ли новая версия сайта, пока лаунчер открыт (в фоне).
    Stats.refresh();

    if (!Stats.handle) {
      Stats.element = document.createElement('div');
      Stats.element.className = 'stats-audit';
      Stats.token = token;
      Stats.handle = window.PwAudit.mount(Stats.element, { origin: Stats.origin, token, route });
      return Stats.element;
    }

    if (token !== Stats.token) {
      Stats.token = token;
      Stats.handle.setToken(token);
    }
    Stats.handle.open(route);
    return Stats.element;
  }

  /**
   * Снять отпечаток при входе игрока, не открывая экран статистики. Вызывается,
   * как только у лаунчера появляется игровой аккаунт (первый запуск с
   * сохранённым аккаунтом или вход в сессии), чтобы данные считались сразу,
   * даже если игрок ни разу не открыл аудит. Без окна и без ожидания; один раз
   * на аккаунт за запуск (дальше срабатывает защита fpSentToken).
   */
  static captureOnLogin() {
    Stats.sendFingerprint(Stats.currentToken());
    Stats.preload();
  }

  /**
   * Заранее, в простое, подтянуть сборку аудита (манифест с сайта до 5 с,
   * скачивание, проверка подписи, eval), чтобы первое открытие «Статистики»
   * не ждало сеть. Ошибка не страшна: open() попробует ещё раз.
   */
  static preload() {
    if (window.PwAudit || Stats.loading) return;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2000));
    idle(() => Stats.load().catch(() => {}), { timeout: 10000 });
  }

  /** Открыто ли окно внутри аудита (его закрывает Esc самого аудита). */
  static hasOpenWindow() {
    const root = Stats.element?.shadowRoot;
    if (!root) return false;
    const windows = '.modal-overlay,.report-modal,.pw-notifications-modal,.social-drawer,.pw-settings-window,.audit-image-viewer,.pw-level-window,.audit-charisma-history-modal';
    return [...root.querySelectorAll(windows)].some((node) => node.matches('.show,.is-open') && node.getClientRects().length > 0);
  }

  /** Вход или выход в лаунчере: аудит должен узнать нового игрока. */
  static authChanged() {
    if (!Stats.handle) return;
    const token = Stats.currentToken();
    if (token === Stats.token) return;
    Stats.token = token;
    Stats.handle.setToken(token);
  }

  /**
   * Отпечаток устройства → серверу (один раз на аккаунт за запуск лаунчера).
   * Только из лаунчера (нужен nw и токен лаунчера); ошибки проглатываются,
   * чтобы ничто не мешало открытию статистики.
   */
  static async sendFingerprint(token) {
    if (typeof nw === 'undefined' || !token || token.indexOf('launcher_') !== 0) return;
    if (Stats.fpSentToken === token) return;
    Stats.fpSentToken = token;
    let fp;
    try {
      fp = await Stats.collectFingerprint();
    } catch {
      Stats.fpSentToken = ''; // не вышло собрать — можно попробовать позже
      return;
    }
    if (!fp) return;
    try {
      // Short opaque wire keys so the request body gives nothing away.
      const sp = fp.specs || {};
      const body = {
        m: fp.machineId, u: fp.biosUuid, b: fp.baseboard, c: fp.cpuId,
        n: fp.macs, d: fp.disks, s: fp.monitors,
        h: fp.hostname, o: fp.os, p: fp.cpu,
        x: { nw: Stats.nwVersion(), pn: sp.cpuName, pc: sp.cpuCores, pt: sp.cpuThreads, g: sp.gpus, rm: sp.ramMb, rl: sp.ramModules, bd: sp.board, dk: sp.disks, mo: sp.monitors },
      };
      await fetch(`${Stats.origin}/stats/backend/api/launcher/env`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch {
      Stats.fpSentToken = '';
    }
  }

  /** Сбор идентификаторов устройства средствами Node/NW.js (без сторонних модулей). */
  static async collectFingerprint() {
    const os = require('os');
    const macs = [];
    const ifaces = os.networkInterfaces() || {};
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (ni && ni.mac && !ni.internal && ni.mac !== '00:00:00:00:00:00') macs.push(ni.mac.toUpperCase());
      }
    }
    const fp = {
      hostname: os.hostname(),
      os: `${os.type()} ${os.release()}`,
      cpu: (os.cpus()[0] || {}).model || '',
      macs: [...new Set(macs)],
      disks: [],
      monitors: [],
      machineId: '',
      biosUuid: '',
      baseboard: '',
      cpuId: '',
    };
    if (process.platform === 'win32') {
      try {
        Object.assign(fp, await Stats.winHardware());
      } catch {
        /* нет доступа к PowerShell/CIM — обойдёмся MAC и хостом */
      }
    }
    return fp;
  }

  /** Серийники и UUID железа Windows — одним вызовом PowerShell (CIM), в JSON. */
  static winHardware() {
    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      const script = [
        "$ErrorActionPreference='SilentlyContinue'",
        "$mg=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid",
        '$csp=Get-CimInstance Win32_ComputerSystemProduct',
        '$bb=Get-CimInstance Win32_BaseBoard',
        '$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1',
        '$disks=Get-CimInstance Win32_DiskDrive | ForEach-Object { $_.SerialNumber } | Where-Object { $_ }',
        // Monitor fingerprint: manufacturer + product code + serial from EDID (root\\wmi).
        "$mons=Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID | ForEach-Object { $sn=(($_.SerialNumberID | Where-Object {$_ -gt 0} | ForEach-Object {[char]$_}) -join ''); $mf=(($_.ManufacturerName | Where-Object {$_ -gt 0} | ForEach-Object {[char]$_}) -join ''); $pc=(($_.ProductCodeID | Where-Object {$_ -gt 0} | ForEach-Object {[char]$_}) -join ''); if($sn -or $pc){ ($mf+$pc+'-'+$sn) } }",
        // Модели железа для карточки модератора (в хэши не входят).
        // VRAM: Win32_VideoController.AdapterRAM упирается в 4 ГБ, точное — в реестре драйвера.
        "$vram=@{}; Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' | ForEach-Object { $m=$_.'HardwareInformation.qwMemorySize'; if($_.DriverDesc -and $m){ $vram[$_.DriverDesc]=[int64]$m } }",
        '$gpus=Get-CimInstance Win32_VideoController | ForEach-Object { $m=$vram[$_.Name]; if(-not $m){ $m=[int64]$_.AdapterRAM }; [pscustomobject]@{ name=$_.Name; mb=[int64]($m/1MB) } }',
        '$ram=Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{ maker=$_.Manufacturer; part=$_.PartNumber; mb=[int64]($_.Capacity/1MB); speed=[int]$_.ConfiguredClockSpeed } }',
        '$diskModels=Get-CimInstance Win32_DiskDrive | ForEach-Object { [pscustomobject]@{ model=$_.Model; gb=[int64]($_.Size/1GB) } }',
        "$monNames=Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID | ForEach-Object { (($_.UserFriendlyName | Where-Object {$_ -gt 0} | ForEach-Object {[char]$_}) -join '') } | Where-Object { $_ }",
        "$specs=[pscustomobject]@{ cpuName=$cpu.Name; cpuCores=[int]$cpu.NumberOfCores; cpuThreads=[int]$cpu.NumberOfLogicalProcessors; gpus=@($gpus); ram=@($ram); ramMb=[int64]((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1MB); board=(($bb.Manufacturer,$bb.Product | Where-Object { $_ }) -join ' '); disks=@($diskModels); monitors=@($monNames) }",
        '[pscustomobject]@{ machineId=$mg; biosUuid=$csp.UUID; baseboard=$bb.SerialNumber; cpuId=$cpu.ProcessorId; disks=@($disks); monitors=@($mons); specs=$specs } | ConvertTo-Json -Compress -Depth 5',
      ].join('; ');
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => {
          if (err) return reject(err);
          try {
            const o = JSON.parse(String(stdout).trim());
            const junk = /^(none|default string|to be filled.*|0+|\.+)$/i;
            const clean = (v) => {
              const s = String(v || '').trim();
              return junk.test(s) ? '' : s;
            };
            const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
            const toList = (v) => arr(v).map(clean).filter(Boolean);
            const num = (v) => Math.max(0, Math.round(Number(v) || 0));
            const size = (mb) => (mb >= 1024 ? `${Math.round(mb / 1024)} ГБ` : mb > 0 ? `${mb} МБ` : '');
            const line = (...parts) => parts.filter(Boolean).join(' · ');
            const s = o.specs || {};
            const specs = {
              cpuName: clean(s.cpuName),
              cpuCores: num(s.cpuCores),
              cpuThreads: num(s.cpuThreads),
              gpus: arr(s.gpus).map((g) => line(clean(g && g.name), size(num(g && g.mb)))).filter(Boolean),
              ramMb: num(s.ramMb),
              ramModules: arr(s.ram)
                .map((m) => line(clean(m && m.maker), clean(m && m.part), size(num(m && m.mb)), num(m && m.speed) ? `${num(m.speed)} МГц` : ''))
                .filter(Boolean),
              board: clean(s.board),
              disks: arr(s.disks).map((d) => line(clean(d && d.model), num(d && d.gb) ? `${num(d.gb)} ГБ` : '')).filter(Boolean),
              monitors: toList(s.monitors),
            };
            resolve({
              specs,
              machineId: clean(o.machineId),
              biosUuid: clean(o.biosUuid),
              baseboard: clean(o.baseboard),
              cpuId: clean(o.cpuId),
              disks: toList(o.disks),
              monitors: toList(o.monitors),
            });
          } catch (e) {
            reject(e);
          }
        },
      );
    });
  }
}

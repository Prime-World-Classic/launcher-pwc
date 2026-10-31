import { App } from './app.js';
import { Voice } from './voice.js';
import { VoiceGameBridge } from './voiceGameBridge.js';
import { PWGame } from './pwgame.js';
import { Settings } from './settings.js';
import { Lang } from './lang.js';
import { MM } from './mm.js';
import { CacheIndex } from './cacheIndex.js';
import { isTestManifest, readNwManifest } from './clientChannel.js';

export class NativeAPI {
  static status = false;
  static exitRequested = false;
  static isSteamClient = false;

  static platform;

  static title;
  static updated = false;
  static curLabel;
  static lastBranchV = null;
  static revBefore = null;
  static restartInProgress = false;

  // Фоновая проверка обновлений content и игры, пока лаунчер запущен
  static CONTENT_WATCH_FIRST_MS = 2 * 60 * 1000;
  static CONTENT_WATCH_INTERVAL_MS = 5 * 60 * 1000;
  static CONTENT_WATCH_RESTART_DELAY_MS = 10 * 1000;
  // Репозитории, которые обновляет NanoUpdater (пути от папки Launcher).
  // guardKey — ревизия, ради которой апдейтер уже запускали (защита от петли).
  static WATCH_REPOS = [
    { name: 'content', dir: 'content', guardKey: 'contentWatchRestartRev' },
    { name: 'game', dir: '../Game', guardKey: 'gameWatchUpdateRev' },
  ];
  static contentWatchTimer = 0;
  static watchPendingRevs = {};
  static updateInProgress = false;
  static updateCallback = null;
  static updateBackground = false;
  static restartPending = false;
  static hashTestChild = null;
  static hashTestDone = Promise.resolve();

  // Лог-файлы обновления: лимит 10 МБ, при превышении остаётся хвост ~5 МБ
  static LOG_MAX_BYTES = 10 * 1024 * 1024;
  static LOG_KEEP_BYTES = 5 * 1024 * 1024;

  static testbridgelog = new Array();

  static modules = {
    fileSystem: 'fs',
    childProcess: 'child_process',
    os: 'os',
    path: 'path',
    crypto: 'crypto',
    net: 'net',
    http: 'http',
    https: 'https',
    dgram: 'dgram',
  };

  static setDefaultWindow() {
    NativeAPI.window.width = 1280;

    NativeAPI.window.height = 720;

    NativeAPI.window.setMinimumSize(1280, 720);

    NativeAPI.window.setResizable(true);

    NativeAPI.window.setPosition('center');

    NativeAPI.window.enterFullscreen();
  }

  static init() {
    try {
      if (!nw) {
        return;
      }
    } catch (e) {
      return;
    }

    NativeAPI.status = true;

    NativeAPI.window = nw.Window.get();

    NativeAPI.setDefaultWindow();

    NativeAPI.app = nw.App;

    NativeAPI.altEnterShortcut = new nw.Shortcut({
      key: 'Alt+Enter',
      active: () => {
        Settings.settings.fullscreen = !Settings.settings.fullscreen;
        Settings.ApplySettings();
      },
    });

    NativeAPI.app.registerGlobalHotKey(NativeAPI.altEnterShortcut);
    NativeAPI.refreshVoiceHotkeys();

    // Любая перезагрузка страницы (не только NativeAPI.reset) — снять глобальные хоткеи.
    window.addEventListener('beforeunload', () => NativeAPI.unregisterAllGlobalHotkeys());

    NativeAPI.window.on('close', () => {
      NativeAPI.exit();
    });

    NativeAPI.loadModules();

    NativeAPI.platform = NativeAPI.os.platform();
    NativeAPI.isSteamClient = NativeAPI.detectSteamClientLaunch();

    // Индекс кэша собирается заранее — ко входу уже готов.
    NativeAPI.getCacheIndex();

    window.addEventListener('error', (event) => {
      const msg = event?.error?.stack || event?.error?.toString?.() || String(event?.message || 'Unknown error');
      NativeAPI.write('error.txt', msg);
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event?.reason;
      const msg = reason?.stack || (typeof reason === 'string' ? reason : JSON.stringify(reason)) || 'Unknown rejection';
      NativeAPI.write('unhandledrejection.txt', msg);
    });
  }

  static detectSteamClientLaunch() {
    if (!NativeAPI.status) {
      return false;
    }

    try {
      const steamEnvMarkers = ['SteamAppId', 'SteamGameId'];
      if (steamEnvMarkers.some((key) => String(process?.env?.[key] || '').trim().length > 0)) {
        return true;
      }

      const argvText = Array.isArray(process?.argv) ? process.argv.join(' ').toLowerCase() : '';
      if (argvText.includes('steam://') || argvText.includes(' -steam') || argvText.includes('--steam')) {
        return true;
      }

      // Steam-сборка может идти без локального апдейтера.
      if (NativeAPI.platform === 'win32' && NativeAPI.fileSystem?.existsSync && NativeAPI.path?.join) {
        const updaterPath = NativeAPI.path.join(process.cwd(), PWGame.PATH_UPDATE);
        if (!NativeAPI.fileSystem.existsSync(updaterPath)) {
          return true;
        }
      }
    } catch {}

    return false;
  }

  static loadModules() {
    for (let module in NativeAPI.modules) {
      NativeAPI[module] = require(NativeAPI.modules[module]);
    }
  }

  static formatShortcutFromTokens(tokens, fallback = '') {
    if (!Array.isArray(tokens)) return fallback;
    const cleaned = tokens.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
    if (!cleaned.length) return fallback;
    const modifiers = new Set(['CTRL', 'ALT', 'SHIFT', 'WIN']);
    // NW.js shortcut requires at least one non-modifier key.
    if (!cleaned.some((x) => !modifiers.has(x))) return fallback;
    const map = {
      CTRL: 'Ctrl',
      ALT: 'Alt',
      SHIFT: 'Shift',
      WIN: 'Win',
      UP: 'Up',
      DOWN: 'Down',
      LEFT: 'Left',
      RIGHT: 'Right',
      SPACE: 'Space',
      ENTER: 'Enter',
      ESC: 'Esc',
      TAB: 'Tab',
      BACKSPACE: 'Backspace',
      DELETE: 'Delete',
      INSERT: 'Insert',
      HOME: 'Home',
      END: 'End',
      PG_UP: 'PageUp',
      PG_DOWN: 'PageDown',
    };
    const formatted = cleaned.map((x) => (map[x] ? map[x] : x)).join('+');
    if (!formatted || formatted.includes('_')) return fallback;
    return formatted;
  }

  static unregisterVoiceHotkeys() {
    try {
      if (NativeAPI.voiceShortcut) NativeAPI.app.unregisterGlobalHotKey(NativeAPI.voiceShortcut);
    } catch {}
    try {
      if (NativeAPI.voiceDestroyShortcut) NativeAPI.app.unregisterGlobalHotKey(NativeAPI.voiceDestroyShortcut);
    } catch {}
    try {
      if (NativeAPI.voiceUpVolume) NativeAPI.app.unregisterGlobalHotKey(NativeAPI.voiceUpVolume);
    } catch {}
    try {
      if (NativeAPI.voiceDownVolume) NativeAPI.app.unregisterGlobalHotKey(NativeAPI.voiceDownVolume);
    } catch {}
    NativeAPI.voiceShortcut = null;
    NativeAPI.voiceDestroyShortcut = null;
    NativeAPI.voiceUpVolume = null;
    NativeAPI.voiceDownVolume = null;
  }

  // Глобальные хоткеи регистрируются на всё NW-приложение и переживают перезагрузку
  // страницы (reloadIgnoringCache после фонового обновления). Старая регистрация
  // ведёт в уничтоженный контекст, а новая с тем же ключом не проходит — Ctrl+Z
  // переставал работать до полного перезапуска. Поэтому снимаем всё перед выгрузкой.
  static unregisterAllGlobalHotkeys() {
    if (!NativeAPI.status || !NativeAPI.app) return;
    NativeAPI.unregisterVoiceHotkeys();
    try {
      if (NativeAPI.altEnterShortcut) NativeAPI.app.unregisterGlobalHotKey(NativeAPI.altEnterShortcut);
    } catch {}
  }

  static refreshVoiceHotkeys() {
    if (!NativeAPI.status || !NativeAPI.app) return;
    NativeAPI.unregisterVoiceHotkeys();

    const toggleKey = NativeAPI.formatShortcutFromTokens(Settings.settings?.voiceToggleHotkey, 'Ctrl+Z');
    if (toggleKey) {
      NativeAPI.voiceShortcut = new nw.Shortcut({
        key: toggleKey,
        active: () => {
          Voice.handleVoiceToggleHotkey?.();
        },
        failed: (error) => {
          console.log(error);
        },
      });
      NativeAPI.app.registerGlobalHotKey(NativeAPI.voiceShortcut);
    }

    const dropKey = NativeAPI.formatShortcutFromTokens(Settings.settings?.voiceDropHotkey, 'Ctrl+K');
    if (dropKey) {
      NativeAPI.voiceDestroyShortcut = new nw.Shortcut({
        key: dropKey,
        active: () => {
          Voice.destroy(false, true);
        },
        failed: (error) => {
          console.log(error);
        },
      });
      NativeAPI.app.registerGlobalHotKey(NativeAPI.voiceDestroyShortcut);
    }

    NativeAPI.voiceUpVolume = new nw.Shortcut({
      key: 'Ctrl+Up',
      active: () => {
        Voice.volumeControl(true);
      },
      failed: (error) => {
        console.log(error);
      },
    });
    NativeAPI.app.registerGlobalHotKey(NativeAPI.voiceUpVolume);

    NativeAPI.voiceDownVolume = new nw.Shortcut({
      key: 'Ctrl+Down',
      active: () => {
        Voice.volumeControl(false);
      },
      failed: (error) => {
        console.log(error);
      },
    });
    NativeAPI.app.registerGlobalHotKey(NativeAPI.voiceDownVolume);
  }
  
  static async exec(exeFile, workingDir, args, callback, cwd = process.cwd()) {
    return new Promise((resolve, reject) => {
      if (!NativeAPI.status) {
        reject();
      }

      let workingDirPath = NativeAPI.path.join(cwd, workingDir);
      let executablePath = NativeAPI.path.join(cwd, exeFile);
      NativeAPI.childProcess.execFile(executablePath, args, { cwd: workingDirPath }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        }

        resolve(stdout);

        // error.code — код выхода процесса, если он не 0 (crashReport.js различает по нему краш)
        if (callback) {
          callback(error || null);
        }
      });
    });
  }

  static reset() {
    if (!NativeAPI.status) {
      return;
    }

    NativeAPI.unregisterAllGlobalHotkeys();
    nw.Window.get().reloadIgnoringCache();
  }

  // Перезагрузка после обновления content: апдейтер мог закрыться раньше,
  // чем файлы реально стали доступны (антивирус/индексатор держат их на
  // Windows) — тогда reload показывает страницу ошибки Chromium. Ждём паузу
  // и проверяем, что ключевые файлы читаются, только потом перезагружаем.
  static CONTENT_RELOAD_FILES = ['content/app.js', 'content/modules/_modules.js', 'content/modules/app.js'];

  // Перезагрузка сразу после успешного обновления: апдейтер только что
  // отработал, а повторный запуск на старте (_modules.js → update) в эту же
  // секунду ловил сетевой сбой/заблокированные NW файлы content — NanoUpdater
  // на любой ошибке удаляет .git и клонирует content целиком заново.
  // Поэтому перед reload запоминаем ревизию, и на старте, если она не
  // изменилась, апдейтер не запускаем (следующую проверку сделает content-watch).
  static RELOAD_AFTER_UPDATE_KEY = 'pwUpdateReloadRev';
  static RELOAD_AFTER_UPDATE_TTL_MS = 10 * 60 * 1000;

  static async markReloadAfterUpdate() {
    try {
      const rev = await NativeAPI.readContentRevision();
      if (!rev) return;
      sessionStorage.setItem(NativeAPI.RELOAD_AFTER_UPDATE_KEY, JSON.stringify({ rev, at: Date.now() }));
    } catch {}
  }

  static async takeReloadAfterUpdate() {
    let mark = null;
    try {
      mark = JSON.parse(sessionStorage.getItem(NativeAPI.RELOAD_AFTER_UPDATE_KEY) || 'null');
      sessionStorage.removeItem(NativeAPI.RELOAD_AFTER_UPDATE_KEY);
    } catch {}
    if (!mark || !mark.rev || !(Date.now() - mark.at < NativeAPI.RELOAD_AFTER_UPDATE_TTL_MS)) return false;
    const rev = await NativeAPI.readContentRevision();
    return rev !== null && rev === mark.rev;
  }

  // Колбэк Node (child_process/fs), прилетевший после reload в уничтоженный
  // контекст старой страницы, роняет весь процесс NW (ACCESS_VIOLATION в nw.dll) —
  // лаунчер просто закрывался. Поэтому перед reload ждём проверку хэшей
  // (зависла — убиваем и ждём её close) и не оставляем незаписанный лог.
  static HASH_TEST_RELOAD_WAIT_MS = 60 * 1000;

  static async waitHashTestBeforeReload() {
    const child = NativeAPI.hashTestChild;
    if (!child) return;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    NativeAPI.logUpdate('reload-wait-hash-test');
    await Promise.race([NativeAPI.hashTestDone, sleep(NativeAPI.HASH_TEST_RELOAD_WAIT_MS)]);
    if (!NativeAPI.hashTestChild) return;
    try {
      child.kill();
    } catch {}
    await Promise.race([NativeAPI.hashTestDone, sleep(3000)]);
  }

  // Прочие фоновые процессы с колбэками в странице (сжатие реплея —
  // replayUpload.js): перед reload ждём их, зависшие — убиваем.
  static CHILD_RELOAD_WAIT_MS = 30 * 1000;

  static reloadChildren = new Set();

  static trackChildBeforeReload(child) {
    const entry = { child, done: null };
    entry.done = new Promise((resolve) => {
      child.once('close', resolve);
      child.once('error', resolve);
    }).finally(() => NativeAPI.reloadChildren.delete(entry));
    NativeAPI.reloadChildren.add(entry);
  }

  static async waitChildrenBeforeReload() {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const entry of [...NativeAPI.reloadChildren]) {
      await Promise.race([entry.done, sleep(NativeAPI.CHILD_RELOAD_WAIT_MS)]);
      if (!NativeAPI.reloadChildren.has(entry)) continue;
      try {
        entry.child.kill();
      } catch {}
      await Promise.race([entry.done, sleep(3000)]);
    }
  }

  static async resetWhenContentReady() {
    if (!NativeAPI.status) return;
    const fs = NativeAPI.fileSystem;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await NativeAPI.markReloadAfterUpdate();
    await NativeAPI.waitHashTestBeforeReload();
    await NativeAPI.waitChildrenBeforeReload();
    await sleep(1500);
    for (let attempt = 1; attempt <= 20; attempt++) {
      let missing = '';
      for (const file of NativeAPI.CONTENT_RELOAD_FILES) {
        try {
          const handle = await fs.promises.open(file, 'r');
          const stat = await handle.stat();
          await handle.close();
          if (!stat.size) missing = file;
        } catch {
          missing = file;
        }
        if (missing) break;
      }
      if (!missing) {
        await NativeAPI.logUpdate('reload', `attempt=${attempt}`);
        NativeAPI.reset();
        return;
      }
      NativeAPI.logUpdate('reload-wait', `attempt=${attempt} file=${missing}`);
      await sleep(1000);
    }
    await NativeAPI.logUpdate('reload', 'files-not-ready, reload anyway');
    NativeAPI.reset();
  }

  // Append-запись в лог-файл с лимитом размера (лимит → остаётся хвост).
  // Файлы: update.log (stages) и update-errors.log (исключения целиком).
  static async cappedAppend(file, line) {
    const fs = NativeAPI.fileSystem;
    let size = 0;
    try {
      size = (await fs.promises.stat(file)).size;
    } catch {}
    if (size >= NativeAPI.LOG_MAX_BYTES) {
      try {
        const tail = Buffer.alloc(NativeAPI.LOG_KEEP_BYTES);
        const fd = await fs.open(file, 'r');
        try {
          await fd.read(tail, 0, NativeAPI.LOG_KEEP_BYTES, size - NativeAPI.LOG_KEEP_BYTES);
        } finally {
          await fd.close();
        }
        await fs.promises.writeFile(file, tail);
      } catch {
        try {
          await fs.promises.writeFile(file, '');
        } catch {}
      }
    }
    await fs.promises.appendFile(file, line);
  }

  // Лог обновления (stage), с timestamp, лимит 10 МБ
  static logUpdate(stage, extra = '') {
    const line = `[${new Date().toISOString()}] ${stage}${extra ? ` ${extra}` : ''}\n`;
    return NativeAPI.cappedAppend('update.log', line).catch(() => {});
  }

  // Любое исключение в цепочке обновления: App.error + stack целиком в файл, с timestamp.
  // quiet — только в лог, без окна и звука ошибки (сетевые сбои фоновой проверки).
  static logUpdateError(error, stage = '', { quiet = false } = {}) {
    const msg =
      error instanceof Error
        ? error.stack || `${error.name}: ${error.message}`
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
    const stamp = new Date().toISOString();
    NativeAPI.cappedAppend('update-errors.log', `[${stamp}] ${stage ? `${stage}: ` : ''}${msg}\n`).catch(() => {});
    NativeAPI.logUpdate(`ERROR ${stage}`.trim(), String(msg).split('\n')[0]);
    if (quiet) return;
    try {
      App.error(String(msg).split('\n')[0]);
    } catch {}
  }

  // Сбой сети или зеркала (нет интернета/DNS, таймаут, обрыв, 429/5xx): фоновой проверке
  // это не мешает — через CONTENT_WATCH_INTERVAL_MS она повторится, игроку показывать нечего.
  static NETWORK_ERROR_CODES = new Set([
    'ENOTFOUND',
    'EAI_AGAIN',
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENETDOWN',
    'EPIPE',
    'EPROTO',
  ]);

  static isNetworkError(error) {
    if (!error || typeof error !== 'object') return false;
    if (NativeAPI.NETWORK_ERROR_CODES.has(error.code)) return true;
    const message = String(error.message || '');
    if (message === 'timeout') return true;
    const http = message.match(/^HTTP (\d{3})$/);
    return !!http && (http[1] === '429' || http[1].startsWith('5'));
  }

  // Ревизия репозитория (по умолчанию content) БЕЗ git (в NW.js git-модуля нет и не будет —
  // только чтение файлов): <dir>/.git/HEAD → «ref: <path>» → .git/<path>, fallback — packed-refs;
  // если HEAD сам по себе hash — он и есть ревизия. Не удалось прочитать — null.
  static async readContentRevision(dir = 'content') {
    const fs = NativeAPI.fileSystem;
    const join = NativeAPI.path.join;
    let head = '';
    try {
      head = (await fs.promises.readFile(join(dir, '.git', 'HEAD'), 'utf-8')).trim();
    } catch {
      return null;
    }
    if (/^[0-9a-fA-F]{40}$/.test(head)) {
      return head.toLowerCase();
    }
    const m = head.match(/^ref:\s*(.+)$/);
    if (!m) return null;
    const ref = m[1].trim();
    try {
      return (await fs.promises.readFile(join(dir, '.git', ref), 'utf-8')).trim().toLowerCase();
    } catch {}
    try {
      const packed = await fs.promises.readFile(join(dir, '.git', 'packed-refs'), 'utf-8');
      for (const line of packed.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('^')) continue;
        const parts = t.split(/\s+/);
        if (parts.length >= 2 && parts[1] === ref && /^[0-9a-fA-F]{40}$/.test(parts[0])) {
          return parts[0].toLowerCase();
        }
      }
    } catch {}
    return null;
  }

  static shellEscape(s) {
    return `'${String(s).replace(/'/g, "'\\''")}'`;
  }

  // Настоящий перезапуск процесса (вместо window.reload): detached-relauncher
  // ждёт, пока старый процесс полностью закончится (сброс profile-lock),
  // и запускает новый инстанс. Новый инстанс прогоняет update-проход;
  // content актуален → рестарта нет (лупы нет).
  static restart() {
    if (NativeAPI.restartInProgress) return;
    NativeAPI.restartInProgress = true;

    try {
      const execPath = process.execPath;
      const appDir = process.cwd();
      let cmd;
      let args;
      if (NativeAPI.platform === 'win32') {
        // ping не требует консоли (timeout в GUI-процессе может не работать)
        cmd = process.env.comspec || 'cmd.exe';
        args = ['/c', `ping -n 6 127.0.0.1 >nul && start "" "${execPath}"`];
      } else {
        cmd = 'sh';
        args = ['-c', `sleep 5 && exec ${NativeAPI.shellEscape(execPath)} ${NativeAPI.shellEscape(appDir)}`];
      }
      const relauncher = NativeAPI.childProcess.spawn(cmd, args, {
        cwd: appDir,
        detached: true,
        stdio: 'ignore',
      });
      relauncher.on('error', (e) => NativeAPI.logUpdateError(e, 'relauncher'));
      relauncher.unref();
      NativeAPI.logUpdate('restart-spawned', `pid=${relauncher.pid}`);
    } catch (e) {
      NativeAPI.logUpdateError(e, 'restart');
    }

    NativeAPI.exit();
  }

  static progress(value = 0.0) {
    if (!NativeAPI.status) {
      return;
    }

    NativeAPI.window.setProgressBar(value);
  }

  static attention() {
    if (!NativeAPI.status) {
      return;
    }

    NativeAPI.window.focus();

    NativeAPI.window.requestAttention(true);
  }

  static exit() {
    if (!NativeAPI.status) {
      return false;
    }
    if (NativeAPI.exitRequested) {
      return true;
    }
    NativeAPI.exitRequested = true;

    try {
      Voice.destroy(true);
    } catch {}

    try {
      VoiceGameBridge.stop();
    } catch {}

    setTimeout(() => {
      try {
        NativeAPI.app.quit();
      } catch {}
    }, 150);

    return true;
  }

  static testHashes() {
    if (NativeAPI.platform == 'linux') {
      PWGame.isValidated = true;
      return; // No hash check for linux
    }
    (async () => {
      try {
        try {
          await NativeAPI.fileSystem.promises.access(PWGame.PATH_TEST_HASHES);
        } catch {
          // Бинарника hash-теста нет — проверку пропускаем (это не ошибка обновления)
          PWGame.isValidated = true;
          NativeAPI.logUpdate('hash-test-missing', PWGame.PATH_TEST_HASHES);
          return;
        }

        // PW_HashTest сверяет MD5 файлов раскладки 2.0 (Packs/data01-06.pile,
        // Asks_RU.fsb, Music.fsb). В 3.0 их нет (gamedataNN.pile, Asks01-05_RU,
        // Music01-02), целостность держит git-апдейтер — без них тест всегда
        // возвращает 201 и ложно блокирует поиск боя.
        try {
          await NativeAPI.fileSystem.promises.access(PWGame.PATH_LEGACY_PACK);
        } catch {
          PWGame.isValidated = true;
          NativeAPI.logUpdate('hash-test-skip-v3', PWGame.PATH_LEGACY_PACK);
          return;
        }

        const spawn = NativeAPI.childProcess.spawn(PWGame.PATH_TEST_HASHES);
        let finish;
        NativeAPI.hashTestChild = spawn;
        NativeAPI.hashTestDone = new Promise((resolve) => (finish = resolve));
        const done = () => {
          if (NativeAPI.hashTestChild === spawn) NativeAPI.hashTestChild = null;
          finish();
        };

        spawn.on('error', (e) => {
          done();
          NativeAPI.logUpdateError(e, 'hash-test-spawn');
          PWGame.isTestHashesFailed = true;
          App.error(Lang.text('fileCheckFailed') + ' ' + (e.message || e));
        });

        spawn.on('close', (code) => {
          done();
          if (code == 0) {
            PWGame.isValidated = true;
            App.notify(Lang.text('updateCheckComplete'));
          } else {
            PWGame.isTestHashesFailed = true;
            App.error(Lang.text('fileCheckFailed') + code);
          }
        });
      } catch (e) {
        NativeAPI.logUpdateError(e, 'hash-test');
        PWGame.isValidated = true;
      }
    })();
  }

  // Одна СТРОКА вывода Linux-апдейтера (update.sh). Парсим только полные строки:
  // чанк stdout может резать строку посередине.
  static parseUpdateLineLinux(line, callback) {
    const o = line;
    if (o == 'Updating game files') {
      this.title = Lang.text('gameUpdate');
      this.curLabel = 'game';
      return;
    }
    if (o == 'Updating launcher') {
      this.title = Lang.text('launcherUpdate');
      this.curLabel = 'content';
      return;
    }

    if (o.startsWith('* main')) {
      if (this.lastBranchV == null) {
        this.lastBranchV = o;
      } else {
        this.updated = this.lastBranchV != o;
      }
      return;
    }

    if (o.startsWith('Receiving objects:')) {
      const percent = parseInt(o.substring(19, o.indexOf('%')), 10);
      if (Number.isFinite(percent)) {
        callback({ update: true, title: this.title, total: percent });
        NativeAPI.progress(percent / 100);
      }
    }
  }

  // Одна СТРОКА протокола Windows-апдейтера (NanoUpdater):
  // #{"type":"label"|"bar","data":"..."}. Битая/неполная строка — пропускается.
  static parseUpdateLineWindows(line, callback) {
    let s = line.trim();
    if (s.startsWith('#')) s = s.slice(1);
    if (!s) return;

    let json;
    try {
      json = JSON.parse(s);
    } catch {
      return;
    }
    if (!json || !json.type) return;

    if (json.type == 'bar') {
      if (this.curLabel == 'content') {
        this.updated = true;
      }

      const total = Number(json.data);
      callback({ update: true, title: this.title, total: Number.isFinite(total) ? total : 0 });

      if (Number.isFinite(total)) {
        NativeAPI.progress(total / 100);
      }
    } else if (json.type == 'label') {
      switch (json.data) {
        case 'game':
          this.title = Lang.text('gameUpdate');
          this.curLabel = json.data;
          break;

        case 'content':
          this.title = Lang.text('launcherUpdate');
          this.curLabel = json.data;
          break;

        case 'game_data0':
          this.title = Lang.text('downloadingArchives1');
          this.curLabel = json.data;
          break;
        case 'game_data1':
          this.title = Lang.text('downloadingArchives2');
          this.curLabel = json.data;
          break;
        case 'game_data2':
          this.title = Lang.text('downloadingArchives3');
          this.curLabel = json.data;
          break;
        case 'game_data3':
          this.title = Lang.text('downloadingArchives4');
          this.curLabel = json.data;
          break;
        case 'game_data4':
          this.title = Lang.text('downloadingArchives5');
          this.curLabel = json.data;
          break;
        case 'game_data5':
          this.title = Lang.text('downloadingArchives6');
          this.curLabel = json.data;
          break;
        case 'game_data6':
          this.title = Lang.text('downloadingArchives7');
          this.curLabel = json.data;
          break;
        case 'game_data7':
          this.title = Lang.text('downloadingArchives8');
          this.curLabel = json.data;
          break;

        default:
          this.title = Lang.text('downloadingGameArchives');
          this.curLabel = json.data;
          break;
      }
      // новый этап виден сразу, ещё до первых процентов
      callback({ update: true, title: this.title, total: null });
    }
  }

  // ---- Доставка NanoUpdater ----
  // Сборку апдейтера возит content: content/updater/ (в контент-репо — корневой
  // updater/). Канал задаётся параметром запуска (--branch main|test), отдельных
  // каталогов под канал нет. В ../Tools файлы НЕ копируются: апдейтер запускается
  // прямо из content/updater/ и обновляет ../Tools сам (его конфиг рядом с exe —
  // content/updater/updater_repos.txt: repo ..\..\..\Tools tools). Копирование не
  // работало в защищённой папке (EPERM на rename) и ломало запуск: новой сборке
  // нужен конфиг рядом с exe, а старый билд конфига не знает.
  // Правило выпуска: payload в контент-канале публикуется только тем же коммитом,
  // что и лончер без копирования — иначе старый лончер утащит exe в Tools без
  // конфига и получит «Ошибка обновления: 1» (прецедент 6ab13f0).
  static UPDATER_STAGE1_DIR = 'content/updater';
  static UPDATER_STAGE1_FILES = ['git2.dll', 'PW_NanoUpdaterAdm.exe', 'PW_NanoUpdater.exe'];

  // Legacy-канал content-test держит bootstrap-набор (см. pw-launcher/tools/content-bootstrap-prune.py):
  // UI-ассеты (img, hero, meshes, sounds, …) в нём вырезаны, их доставляет только вторая стадия
  // из launcher-pwc. Маркер кладёт тот же prune-скрипт — по нему лончер понимает, что показывать
  // замок между стадиями нельзя (View.bootstrapContent).
  static BOOTSTRAP_MARKER = 'content/bootstrap.json';

  // Синхронно и молча: вызывается до первого callback'а NativeAPI.update(), ошибка чтения = не bootstrap.
  static bootstrapContent() {
    try {
      if (!NativeAPI.fileSystem?.existsSync || !NativeAPI.path?.join) return false;
      return Boolean(NativeAPI.fileSystem.existsSync(NativeAPI.path.join(NativeAPI.BOOTSTRAP_MARKER)));
    } catch {
      return false;
    }
  }

  static getNwManifest() {
    return readNwManifest();
  }

  // Канал обновления: package.json.name с Dev или Tests -> test; для старых/ручных
  // тестовых установок дополнительно учитываем скрытый refs/testing/*, refs/heads/test
  // или content-test.
  static async updateBranch() {
    if (isTestManifest()) return 'test';
    try {
      const remote = await NativeAPI.readContentRemote('content');
      if (
        remote &&
        (remote.ref.startsWith('refs/testing/') ||
          remote.ref === 'refs/heads/test' ||
          /content-test/i.test(remote.url))
      ) {
        return 'test';
      }
    } catch {}
    return 'main';
  }

  static async isTesterClient() {
    return (await NativeAPI.updateBranch()) === 'test';
  }

  static async fileMd5(file) {
    const data = await NativeAPI.fileSystem.promises.readFile(file);
    return NativeAPI.crypto.createHash('md5').update(data).digest('hex');
  }

  // md5 сборки апдейтера в ../Tools (через пробел, '-' если файла нет) — дешёвый
  // признак «Tools трогали / не трогали» без git: git-репозиторием Tools становится
  // только после первой стадии.
  static async toolsUpdaterFingerprint() {
    return await NativeAPI.updaterFingerprint(NativeAPI.path.dirname(PWGame.PATH_UPDATE));
  }

  // То же для сборки, которую привёз content.
  static async payloadUpdaterFingerprint() {
    return await NativeAPI.updaterFingerprint(NativeAPI.UPDATER_STAGE1_DIR);
  }

  static async updaterFingerprint(dir) {
    const parts = [];
    for (const name of NativeAPI.UPDATER_STAGE1_FILES) {
      let hash = null;
      try {
        hash = await NativeAPI.fileMd5(NativeAPI.path.join(dir, name));
      } catch {}
      parts.push(hash || '-');
    }
    return parts.join(' ');
  }

  // Стадия 1: content/updater/PW_NanoUpdater.exe обновляет ../Tools (и, если Tools
  // ещё не git-репозиторий, делает из него checkout репо updater — вместе с
  // updater_repos.txt, который нужен стадии 2). Запускается только когда сборки
  // различаются: иначе лишний fetch на каждом старте. Неудачу стадии 2 не отменяет:
  // старый билд в Tools обновляет content и Game по своим origin и конфига не требует.
  static async updateToolsUpdater(branch) {
    const result = await NativeAPI.runToolsUpdater(branch);
    NativeAPI.logUpdate('updater-stage1', `branch=${branch} result=${result}`);
    return result;
  }

  static async runToolsUpdater(branch) {
    if (NativeAPI.platform !== 'win32') return 'skip-platform';
    const srcExe = NativeAPI.path.join(NativeAPI.UPDATER_STAGE1_DIR, 'PW_NanoUpdater.exe');
    try {
      await NativeAPI.fileSystem.promises.access(srcExe);
    } catch {
      return 'skip-no-payload'; // в контент-канале сборки нет — ничего не делаем
    }
    if ((await NativeAPI.payloadUpdaterFingerprint()) === (await NativeAPI.toolsUpdaterFingerprint())) {
      return 'skip-uptodate';
    }

    try {
      const child = NativeAPI.childProcess.spawn(srcExe, ['--branch', branch]);
      return await new Promise((resolve) => {
        let buffer = '';
        child.stdout?.on('data', (data) => {
          try {
            buffer += data.toString();
            let idx;
            // Разбираем только полные строки; протокол #{...} (bar/label) не логируем —
            // свой прогресс Tools-апдейтер покажет на стадии 2.
            while ((idx = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 1);
              if (line && !line.startsWith('#{')) NativeAPI.logUpdate('updater-stage1-out', line.slice(0, 200));
            }
          } catch (e) {
            NativeAPI.logUpdateError(e, 'updater-stage1-stdout');
          }
        });
        child.on('error', (e) => {
          NativeAPI.logUpdateError(e, 'updater-stage1-spawn');
          resolve('spawn-error');
        });
        child.on('close', (code) => resolve(code == 0 || code == null ? 'ok' : `fail-${code}`));
      });
    } catch (e) {
      NativeAPI.logUpdateError(e, 'updater-stage1-spawn');
      return 'spawn-error';
    }
  }

  // Ревизии наблюдаемых репозиториев (content, ../Game) — для сверки «до/после»
  // прогона апдейтера.
  static async repoRevisions() {
    const out = {};
    for (const repo of NativeAPI.WATCH_REPOS) {
      try {
        out[repo.name] = await NativeAPI.readContentRevision(repo.dir);
      } catch {
        out[repo.name] = null;
      }
    }
    return out;
  }

  // Какие репозитории апдейтер ОБЯЗАН сдвинуть: локальная ревизия отличается от
  // удалённого ref, либо .git ещё нет (первый прогон — апдейтер его создаст).
  // Сетевой сбой зеркала молча даёт пустой список: гейт не должен ругаться, когда
  // свериться не с чем.
  static async expectedRepoUpdates() {
    const out = [];
    for (const repo of NativeAPI.WATCH_REPOS) {
      try {
        const local = await NativeAPI.readContentRevision(repo.dir);
        if (!local) {
          out.push({ name: repo.name, local: null, remote: null });
          continue;
        }
        const remote = await NativeAPI.readContentRemote(repo.dir);
        if (!remote) continue;
        const remoteRev = await NativeAPI.readRemoteRevision(remote.url, remote.ref);
        if (remoteRev && remoteRev !== local) out.push({ name: repo.name, local, remote: remoteRev });
      } catch {
        // по этому репо изменений не ждём
      }
    }
    return out;
  }

  // Апдейтер не запустился вовсе (нет прав, его сьел антивирус, файл подменён):
  // спавн бросает ИСКЛЮЧЕНИЕ синхронно, поэтому child.on('error') не срабатывает —
  // индикатор «Проверка обновлений…» висел бы навсегда, а PWGame.isUpdateFailed
  // остался бы false (лончер сделал бы вид, что всё в порядке).
  static failUpdaterStart(error, callback, stage) {
    NativeAPI.updateInProgress = false;
    NativeAPI.logUpdateError(error, stage);
    PWGame.isUpdateFailed = true;
    try {
      if (callback) callback({ update: false, title: '', total: 0 });
    } catch {}
    try {
      NativeAPI.progress(-1);
    } catch {}
    App.error(Lang.text('updateError') + ' ' + ((error && error.message) || error));
  }

  // background=true — фоновое обновление из content-watch: после загрузки не
  // перезагружаем окно сами, а показываем кнопку «Перезапустить» (App).
  // При старте (background=false) перезагрузка автоматическая, без подтверждения.
  static async update(callback, { background = false } = {}) {
    if (!NativeAPI.status) {
      return false;
    }
    if (NativeAPI.updateInProgress) {
      return true;
    }
    NativeAPI.updateBackground = Boolean(background);
    if (callback) NativeAPI.updateCallback = callback;
    callback = NativeAPI.updateCallback || (() => {});

    try {
      const isLinux = NativeAPI.platform == 'linux';
      const updaterPath = isLinux ? PWGame.PATH_UPDATE_LINUX : PWGame.PATH_UPDATE;

      // Апдейтера нет (Steam-сборка, dev): обновления нет, рестарта быть
      // не должно, ошибки не показываем — лончер просто стартует.
      let hasUpdater = false;
      try {
        await NativeAPI.fileSystem.promises.access(updaterPath);
        hasUpdater = true;
      } catch {}
      if (!hasUpdater) {
        PWGame.isUpToDate = true;
        PWGame.isValidated = true;
        NativeAPI.logUpdate('updater-missing', updaterPath);
        return true;
      }

      // Окно только что перезагружено после обновления — content уже свежий,
      // повторный прогон апдейтера не нужен (и опасен, см. markReloadAfterUpdate).
      // Проверку хэшей перед reload не запускали (см. close ниже) — делаем её здесь.
      if (!background && (await NativeAPI.takeReloadAfterUpdate())) {
        PWGame.isUpToDate = true;
        NativeAPI.logUpdate('skip-after-reload', `rev=${await NativeAPI.readContentRevision()}`);
        NativeAPI.testHashes();
        NativeAPI.startContentWatch();
        return true;
      }

      // Флаг ставим заранее: пока стадия 1 возит апдейтер, второй update() не должен
      // его запустить
      NativeAPI.updateInProgress = true;
      // Бой уже заблокирован (MM.isBlockedByUpdate) — полосу показываем сразу, без процентов:
      // NanoUpdater шлёт bar только когда что-то качает, а подключение к зеркалам и сверка
      // идут минутами без него.
      NativeAPI.title = Lang.text('updateChecking');
      callback({ update: true, title: NativeAPI.title, total: null });
      const updateBranch = isLinux ? null : await NativeAPI.updateBranch();

      // Стадия 1 (только Windows): сначала довести до ума сам апдейтер в ../Tools.
      let toolsBefore = null;
      if (!isLinux) {
        try {
          toolsBefore = await NativeAPI.toolsUpdaterFingerprint();
          const stage1 = await NativeAPI.updateToolsUpdater(updateBranch);
          // Код 0, но в Tools ничего не поменялось: чаще всего пользователь снял UAC —
          // отказ ShellExecuteEx снаружи не виден (stderr родителя уходит в
          // null_streambuf, admin_rights_exception глотается, main.cpp:1090-1094).
          if (stage1 === 'ok' && toolsBefore === (await NativeAPI.toolsUpdaterFingerprint())) {
            NativeAPI.logUpdate('updater-stage1-incomplete', `branch=${updateBranch}`);
            App.error(Lang.text('updateNeedsAdmin'));
          }
        } catch (e) {
          NativeAPI.logUpdateError(e, 'updater-stage1');
        }
      }

      NativeAPI.updated = false;
      NativeAPI.curLabel = null;
      NativeAPI.title = Lang.text('updateChecking');
      NativeAPI.lastBranchV = null;
      NativeAPI.revBefore = await NativeAPI.readContentRevision();
      NativeAPI.logUpdate(
        'start',
        `updater=${updaterPath} rev=${NativeAPI.revBefore || 'n/a'}${updateBranch ? ` branch=${updateBranch}` : ''}`
      );

      NativeAPI.updateInProgress = true;
      // Ожидаемые сдвиги ревизий — чтобы «вышел 0, но ничего не сделал» не
      // считался успехом (аналог updater-stage1-incomplete для стадии 2).
      const expected = await NativeAPI.expectedRepoUpdates();

      let child;
      try {
        child = NativeAPI.childProcess.spawn(updaterPath, isLinux ? [] : ['--branch', updateBranch]);
      } catch (e) {
        NativeAPI.failUpdaterStart(e, callback, 'updater-spawn-sync');
        return true;
      }

      let buffer = '';
      child.stdout.on('data', (data) => {
        try {
          buffer += data.toString();
          let idx;
          // Разбираем только полные строки — чанк может резать строку посередине
          while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 1);
            if (isLinux) {
              NativeAPI.parseUpdateLineLinux(line, callback);
            } else {
              NativeAPI.parseUpdateLineWindows(line, callback);
            }
          }
        } catch (e) {
          NativeAPI.logUpdateError(e, 'stdout');
        }
      });

      child.on('error', (e) => {
        NativeAPI.failUpdaterStart(e, callback, 'updater-spawn');
      });

      child.on('close', async (code) => {
        NativeAPI.updateInProgress = false;
        try {
          callback({ update: false, title: '', total: 0 });

          NativeAPI.progress(-1);

          const ok = code == 0 || code == null;

          if (ok) {
            PWGame.isUpToDate = true;
          } else {
            PWGame.isUpdateFailed = true;
            App.error(Lang.text('updateError') + code);
          }
          NativeAPI.logUpdate('updater-close', `code=${code} bar=${NativeAPI.updated}`);

          // Рестарт (reset: window.reloadIgnoringCache)
          // только если ревизия content реально изменилась (без git — чтение
          // .git/HEAD до и после; .git не читается — bar-флаг: NanoUpdater
          // шлёт bar по content, только если fetch что-то скачал).
          // При ошибке апдейтера (code != 0) — без рестарта: повторим на следующем старте.
          const revAfter = await NativeAPI.readContentRevision();
          NativeAPI.logUpdate('revision', `before=${NativeAPI.revBefore || 'n/a'} after=${revAfter || 'n/a'}`);

          // Код 0 без изменений там, где они были обязаны появиться: апдейтер
          // ушёл в себя (нет прав на запись, конфиг не прочитан, зеркала молчат).
          // Без этого лончер считает установку актуальной.
          if (ok && expected.length) {
            const revsAfter = await NativeAPI.repoRevisions();
            const moved = expected.filter((r) => revsAfter[r.name] !== r.local);
            if (!moved.length && !NativeAPI.updated) {
              NativeAPI.logUpdate(
                'updater-incomplete',
                `expected=${expected.map((r) => `${r.name}:${r.local || 'none'}->${r.remote || 'init'}`).join(',')} code=${code}`,
              );
              PWGame.isUpdateFailed = true;
              App.error(Lang.text('updateError') + ' 0');
            }
          }

          let changed;
          if (NativeAPI.revBefore !== null && revAfter !== null) {
            changed = NativeAPI.revBefore !== revAfter;
          } else if (NativeAPI.revBefore === null && revAfter !== null) {
            changed = true; // .git появился (свежая инициализация) — content точно обновлён
          } else if (NativeAPI.revBefore !== null && revAfter === null) {
            changed = false; // .git пропал — content скорее всего битый, не рестартим
          } else {
            changed = NativeAPI.updated; // .git не читается — bar-флаг
          }

          // На старте при смене ревизии окно сейчас перезагрузится — хэши
          // проверит уже новая страница (skip-after-reload).
          if (ok && !(changed && !NativeAPI.updateBackground)) {
            NativeAPI.testHashes();
          }

          if (ok && changed && NativeAPI.updateBackground) {
            NativeAPI.restartPending = true;
            NativeAPI.logUpdate('restart-pending', `rev=${revAfter || 'n/a'}`);
            try {
              App.showLauncherRestartButton(true);
            } catch (e) {
              NativeAPI.logUpdateError(e, 'restart-button');
            }
            NativeAPI.startContentWatch();
          } else if (ok && changed) {
            await NativeAPI.resetWhenContentReady();
          } else if (ok) {
            NativeAPI.startContentWatch();
          }
        } catch (e) {
          NativeAPI.logUpdateError(e, 'close');
        }
      });
    } catch (e) {
      NativeAPI.logUpdateError(e, 'update');
    }

    return true;
  }

  // ---- Фоновая проверка обновлений content и игры ----
  // Пока лаунчер открыт, раз в CONTENT_WATCH_INTERVAL_MS сверяем ревизии
  // content/.git и ../Game/.git с веткой на удалённом репозитории (smart-HTTP
  // info/refs, git не нужен; адрес — origin из .git/config, т.е. тестовый клиент
  // смотрит в *-test репозитории). Если вышла новая — ждём, пока игрок не в
  // поиске/лобби/бою, и запускаем тот же апдейтер, что и при старте
  // (NativeAPI.update): он скачает content и игру. Кнопка «Перезапустить» под
  // быстрыми кнопками справа появится только при смене ревизии content —
  // обновление одной игры перезапуска лаунчера не требует.
  // Процесс НЕ перезапускаем: detached-relauncher + exit (restart()) на Windows
  // просто закрывал лаунчер — дочерний процесс погибает вместе с NW.
  // Защита от петли: ради одной и той же ревизии апдейтер запускаем один раз.
  static startContentWatch() {
    if (!NativeAPI.status || NativeAPI.contentWatchTimer) return;
    const tick = async () => {
      try {
        await NativeAPI.checkContentUpdate();
      } catch (e) {
        NativeAPI.logUpdateError(e, 'content-watch', { quiet: NativeAPI.isNetworkError(e) });
      }
      NativeAPI.contentWatchTimer = setTimeout(tick, NativeAPI.CONTENT_WATCH_INTERVAL_MS);
    };
    NativeAPI.contentWatchTimer = setTimeout(tick, NativeAPI.CONTENT_WATCH_FIRST_MS);
  }

  static async readContentRemote(dir = 'content') {
    const fs = NativeAPI.fileSystem;
    const join = NativeAPI.path.join;
    let head = '';
    let config = '';
    try {
      head = (await fs.promises.readFile(join(dir, '.git', 'HEAD'), 'utf-8')).trim();
      config = await fs.promises.readFile(join(dir, '.git', 'config'), 'utf-8');
    } catch {
      return null;
    }
    const refMatch = head.match(/^ref:\s*(refs\/heads\/.+)$/);
    if (!refMatch) return null;
    const ref = refMatch[1].trim();
    const branch = ref.slice('refs/heads/'.length);

    // remote ветки (branch.<name>.remote), по умолчанию origin;
    // branch.<name>.merge — ref на сервере, если он не совпадает с веткой
    // (тестеры: локальная test ← скрытый refs/testing/test, его пишет NanoUpdater)
    let remoteName = 'origin';
    let mergeRef = '';
    let section = '';
    const urls = {};
    for (const raw of config.split(/\r?\n/)) {
      const line = raw.trim();
      const sec = line.match(/^\[(.+)\]$/);
      if (sec) {
        section = sec[1];
        continue;
      }
      const kv = line.match(/^([A-Za-z]+)\s*=\s*(.+)$/);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const value = kv[2].trim().replace(/^"(.*)"$/, '$1');
      const remoteSec = section.match(/^remote\s+"(.+)"$/);
      if (remoteSec && key === 'url' && !urls[remoteSec[1]]) urls[remoteSec[1]] = value;
      if (section === `branch "${branch}"` && key === 'remote') remoteName = value;
      if (section === `branch "${branch}"` && key === 'merge' && value.startsWith('refs/')) mergeRef = value;
    }
    const url = urls[remoteName];
    if (!url || !/^https?:\/\//i.test(url)) return null;
    return { url, ref: mergeRef || ref };
  }

  static fetchText(url, redirects = 3) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https:') ? NativeAPI.https : NativeAPI.http;
      const req = lib.get(url, { headers: { 'User-Agent': 'git/2.40.0 pw-launcher' }, timeout: 15000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          resolve(NativeAPI.fetchText(new URL(res.headers.location, url).toString(), redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(body));
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
    });
  }

  static async readRemoteRevision(url, ref) {
    const base = url.replace(/\/+$/, '');
    const body = await NativeAPI.fetchText(`${base}/info/refs?service=git-upload-pack`);
    // pkt-line: "<4 hex len><sha> <ref>[\0caps]\n"
    const re = /([0-9a-f]{40}) ([^\0\n]+)/g;
    let m;
    while ((m = re.exec(body))) {
      if (m[2] === ref) return m[1];
    }
    return null;
  }

  static isSafeToRestart() {
    return !MM.active && !MM.isInTambur && !MM.isInBattle && !NativeAPI.exitRequested;
  }

  static async checkContentUpdate() {
    if (NativeAPI.restartInProgress || NativeAPI.updateInProgress) return;
    // Без апдейтера (Steam/dev) рестарт ничего не обновит — не проверяем
    const updaterPath = NativeAPI.platform == 'linux' ? PWGame.PATH_UPDATE_LINUX : PWGame.PATH_UPDATE;
    try {
      await NativeAPI.fileSystem.promises.access(updaterPath);
    } catch {
      return;
    }

    // Сбой проверки одного репозитория (таймаут зеркала) не мешает проверить другой
    const found = [];
    for (const repo of NativeAPI.WATCH_REPOS) {
      try {
        const remoteRev = await NativeAPI.findRepoUpdate(repo);
        if (remoteRev) found.push({ repo, remoteRev });
      } catch (e) {
        NativeAPI.logUpdateError(e, `${repo.name}-watch`, { quiet: NativeAPI.isNetworkError(e) });
      }
    }
    if (!found.length) return;

    // Игрок в поиске/лобби/бою — дождёмся следующей проверки
    if (!NativeAPI.isSafeToRestart()) return;

    for (const { repo, remoteRev } of found) {
      try {
        localStorage.setItem(repo.guardKey, remoteRev);
      } catch {}
      delete NativeAPI.watchPendingRevs[repo.name];
      NativeAPI.logUpdate(`${repo.name}-watch-update`, `remote=${remoteRev}`);
    }
    // Качаем в фоне; окно не перезагружаем — если сменился content, по готовности
    // появится кнопка «Перезапустить», если только игра — просто обновится молча.
    await NativeAPI.update(null, { background: true });
  }

  // Новая ревизия репозитория на сервере, ради которой ещё не запускали апдейтер, иначе null
  static async findRepoUpdate(repo) {
    const pending = NativeAPI.watchPendingRevs[repo.name];
    if (pending) return pending;

    const localRev = await NativeAPI.readContentRevision(repo.dir);
    const remote = await NativeAPI.readContentRemote(repo.dir);
    if (!localRev || !remote) return null;

    const remoteRev = await NativeAPI.readRemoteRevision(remote.url, remote.ref);
    if (!remoteRev || remoteRev === localRev) return null;

    let guard = null;
    try {
      guard = localStorage.getItem(repo.guardKey);
    } catch {}
    if (guard === remoteRev) return null; // уже обновлялись ради неё — не помогло
    NativeAPI.watchPendingRevs[repo.name] = remoteRev;
    NativeAPI.logUpdate(`${repo.name}-watch-found`, `local=${localRev} remote=${remoteRev}`);
    return remoteRev;
  }

  static analysis() {
    if (!NativeAPI.status) {
      return false;
    }

    let username = '',
      cpus = NativeAPI.os.cpus();

    try {
      let userInfo = NativeAPI.os.userInfo();

      username = userInfo.username;
    } catch (error) {}

    return {
      hostname: NativeAPI.os.hostname(),
      core: { model: cpus.length ? cpus[0].model : '', total: cpus.length },
      memory: Math.round(NativeAPI.os.totalmem() / 1024 / 1024),
      version: NativeAPI.os.version(),
      release: NativeAPI.os.release(),
      username: username,
    };
  }

  // Индекс кэша клиента (cacheIndex.js); {} вне NW или по таймауту.
  static async getCacheIndex() {
    if (!NativeAPI.status) {
      return {};
    }

    return await CacheIndex.get(NativeAPI);
  }

  static getMACAdress() {
    let result = new Array();

    if (!NativeAPI.status) {
      return result;
    }

    try {
      let networkInterfaces = NativeAPI.os.networkInterfaces();

      for (let key in networkInterfaces) {
        if (['Radmin VPN'].includes(`${key}`)) {
          continue;
        }

        for (let networkInterface of networkInterfaces[key]) {
          if (networkInterface.internal) {
            continue;
          }

          if (!('mac' in networkInterface) || !networkInterface.mac || networkInterface.mac == '00:00:00:00:00:00') {
            continue;
          }

          if (!result.includes(`${networkInterface.mac}`)) {
            result.push(`${networkInterface.mac}`);
          }
        }
      }
    } catch (error) {
      console.log(error);
    }

    return result;
  }

  static getLocale() {
    let result = '';

    if (!NativeAPI.status) {
      return result;
    }

    try {
      result = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch (error) {}

    return result;
  }

  static async ping(hostname, port = 80, timeout = 3000) {
    return new Promise((resolve) => {
      const start = performance.now();

      const socket = NativeAPI.net.createConnection(port, hostname);

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        const end = performance.now();

        socket.end();

        resolve(end - start);
      });

      function handleError() {
        socket.destroy();

        resolve(-1);
      }

      socket.on('timeout', handleError);

      socket.on('error', handleError);
    });
  }

  static async write(file, body, append = false) {
    body = body === undefined ? '' : String(body);
    if (append) {
      await NativeAPI.fileSystem.promises.appendFile(file, body);
    } else {
      await NativeAPI.fileSystem.promises.writeFile(file, body);
    }
  }

  static linkHandler(evt) {
    if (NativeAPI.status) {
      evt.preventDefault();
      let url = evt.target.href;
      if (evt.currentTarget.href) {
        url = evt.currentTarget.href;
      }
      App.OpenExternalLink(url);
    }
  }

  static async bridge(data) {
    NativeAPI.testbridgelog.push(`${data} | ${new Date().toLocaleString()}`);

    await NativeAPI.fileSystem.promises.writeFile(PWGame.PATH_LUA_BRIDGE, data);

    await NativeAPI.fileSystem.promises.writeFile('../Game/Bin/bridgelog', NativeAPI.testbridgelog.join('\n'));
  }

  static getDocumentsDir() {
    if (!NativeAPI.status) return;

    switch (NativeAPI.platform) {
      case 'win32': {
        const regPaths = [
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders',
        ];
        for (const regPath of regPaths) {
          try {
            const out = NativeAPI.childProcess.execFileSync('reg', ['query', regPath, '/v', 'Personal'], {
              encoding: 'utf8',
            });
            const line = out
              .split(/\r?\n/)
              .map((x) => x.trim())
              .find((x) => /^Personal\s+REG_\w+\s+.+$/i.test(x));
            if (!line) continue;
            const m = line.match(/^Personal\s+REG_\w+\s+(.+)$/i);
            if (!m || !m[1]) continue;
            const expanded = m[1].trim().replace(/%([^%]+)%/g, (full, name) => {
              const v = process.env[name] || process.env[String(name).toUpperCase()];
              return v || full;
            });
            if (expanded && !/%[^%]+%/.test(expanded)) {
              return expanded;
            }
          } catch {}
        }

        const home = NativeAPI.os.homedir();
        if (home) {
          return NativeAPI.path.join(home, 'Documents');
        }
        const profile = process.env.USERPROFILE;
        if (profile) {
          return NativeAPI.path.join(profile, 'Documents');
        }
        const sysRoot = process.env.SystemRoot || 'C:\\Windows';
        const ps = NativeAPI.path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        try {
          return NativeAPI.childProcess
            .execFileSync(ps, ['-NoProfile', '-NoLogo', '-Command', '[Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)'], {
              encoding: 'utf8',
            })
            .trim();
        } catch {
          return undefined;
        }
      }

      case 'linux':
        try {
          return NativeAPI.childProcess.execSync('xdg-user-dir DOCUMENTS', { encoding: 'utf-8' }).trim();
        } catch {}

      default:
        return NativeAPI.path.join(NativeAPI.os.homedir(), 'Documents');
    }
  }
}

import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';
import { ChatFilter } from './chatFilter.js';

// Копия файлов настроек игры на сервере по аккаунту (pw-api objects/settings.model.js): user.cfg, input_new.cfg,
// *.ignore из корня папки игры (NativeAPI.getGameUserDir).
//
// Сервер — главная копия. В неё попадает только то, что изменили лончер или игра:
//  - лончер записал файл (UserCfg.set, клавиши) → launcherWrote → settings.put source=launcher;
//  - игра: перед запуском снимаем отпечатки файлов (beforeGame), после выхода (afterGame) всё изменившееся
//    за время боя — изменения игры → source=game.
// Любые другие изменения на диске (облако OneDrive, ручная правка, копирование) в базу не идут: при входе
// в замок и перед каждым запуском игры (pull) файл, отличающийся от копии на сервере, перезаписывается ею.
// Файл, которого на сервере ещё нет, отправляется как есть (source=first, сервер не перезапишет уже
// сохранённый).
// Исключение — админы (App.isAdmin): их файл на диске, отличающийся от копии, считается их правкой и
// уходит на сервер (source=launcher); удалённый файл возвращается из копии, как у всех.
//
// Изменения лончера и игры, которые ещё не дошли до сервера, — в pending (и в localStorage, чтобы пережить
// перезапуск лончера): pull их не перезаписывает, а досылает. Иначе (2026-11-22) правки клавиш в замке
// «не сохранялись»: pull с медленной связью качал старую копию, игрок за это время сохранял клавиши, и копия
// ложилась поверх; а если первый pull не прошёл, правки лончера и игры не слались вовсе, и следующий pull
// перед боем возвращал старую копию.
export class GameSettingsSync {
  static NAME = /^(user\.cfg|input_new\.cfg|[0-9A-F]{16}\.ignore)$/;

  // как Settings.MAX_BYTES на сервере: файл целиком в одном WS-кадре
  static MAX_BYTES = 11000;

  static PULL_TIMEOUT_MS = 5000;

  // get/put: без ответа очередь запросов не должна вставать навсегда
  static REQUEST_TIMEOUT_MS = 15000;

  static STORAGE_KEY = 'pwGameSettingsPending';

  // имя → sha256 копии на сервере (как её знает лончер)
  static known = new Map();

  // имя → {sha256, source}: свои изменения (лончер/игра), ещё не принятые сервером
  static pending = new Map();

  static pendingLoaded = false;

  static pulled = false;

  static gameRunning = false;

  static queue = Promise.resolve();

  static folder() {
    return NativeAPI.status ? NativeAPI.getGameUserDir() : undefined;
  }

  static sha256(bytes) {
    return NativeAPI.crypto.createHash('sha256').update(bytes).digest('hex');
  }

  // имя → {bytes, sha256} для файлов, которые храним
  static readLocal() {
    const files = new Map();
    const folder = GameSettingsSync.folder();
    if (!folder) return files;
    let names = [];
    try {
      names = NativeAPI.fileSystem.readdirSync(folder);
    } catch {
      return files;
    }
    for (const name of names) {
      if (!GameSettingsSync.NAME.test(name)) continue;
      const file = GameSettingsSync.readFile(name);
      if (file) files.set(name, file);
    }
    return files;
  }

  static readFile(name) {
    try {
      const bytes = NativeAPI.fileSystem.readFileSync(NativeAPI.path.join(GameSettingsSync.folder(), name));
      if (!bytes.length || bytes.length > GameSettingsSync.MAX_BYTES) return null;
      return { bytes, sha256: GameSettingsSync.sha256(bytes) };
    } catch {
      return null;
    }
  }

  // файл есть, но в копию не помещается (больше MAX_BYTES) — такой не перезаписываем копией с сервера
  static isOversized(name) {
    try {
      return NativeAPI.fileSystem.statSync(NativeAPI.path.join(GameSettingsSync.folder(), name)).size > GameSettingsSync.MAX_BYTES;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- pending

  static loadPending() {
    if (GameSettingsSync.pendingLoaded) return;
    GameSettingsSync.pendingLoaded = true;
    try {
      const saved = JSON.parse(localStorage.getItem(GameSettingsSync.STORAGE_KEY) || 'null');
      if (!saved || saved.folder !== GameSettingsSync.folder() || !saved.files) return;
      for (const [name, entry] of Object.entries(saved.files)) {
        if (GameSettingsSync.NAME.test(name) && entry && typeof entry.sha256 === 'string') {
          GameSettingsSync.pending.set(name, { sha256: entry.sha256, source: entry.source === 'game' ? 'game' : 'launcher' });
        }
      }
    } catch {}
  }

  static savePending() {
    try {
      if (!GameSettingsSync.pending.size) localStorage.removeItem(GameSettingsSync.STORAGE_KEY);
      else
        localStorage.setItem(
          GameSettingsSync.STORAGE_KEY,
          JSON.stringify({ folder: GameSettingsSync.folder(), files: Object.fromEntries(GameSettingsSync.pending) }),
        );
    } catch {}
  }

  // файл на диске сейчас — своё изменение (лончер/игра): запомнить до отправки
  static markPending(name, source) {
    GameSettingsSync.loadPending();
    const file = GameSettingsSync.readFile(name);
    if (!file) return;
    GameSettingsSync.pending.set(name, { sha256: file.sha256, source });
    GameSettingsSync.savePending();
  }

  // на диске всё ещё своё неотправленное изменение
  static isPendingOnDisk(name, sha256) {
    const entry = GameSettingsSync.pending.get(name);
    return Boolean(entry && sha256 && entry.sha256 === sha256);
  }

  // ---------------------------------------------------------------- запросы

  static request(method, data, ms = GameSettingsSync.REQUEST_TIMEOUT_MS) {
    let timer = null;
    return Promise.race([
      App.api.request('settings', method, data),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`settings.${method} timeout`)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  // запросы к серверу — по одному, чтобы put после pull не обогнал его
  static run(task) {
    const next = GameSettingsSync.queue.then(task, task);
    GameSettingsSync.queue = next.catch(() => {});
    return next;
  }

  static async put(name, file, source) {
    const result = await GameSettingsSync.request('put', {
      name,
      content: file.bytes.toString('base64'),
      sha256: file.sha256,
      source,
    });
    if (result && result.sha256) GameSettingsSync.known.set(name, result.sha256);
    return result;
  }

  // Своё неотправленное — на сервер (внутри run, после pull). Файл, который с тех пор изменил кто-то
  // другой, из pending убирается: это уже не изменение лончера или игры.
  static async flushPending() {
    if (!GameSettingsSync.pulled) return;
    for (const [name, entry] of [...GameSettingsSync.pending]) {
      const file = GameSettingsSync.readFile(name);
      if (!file || file.sha256 !== entry.sha256 || GameSettingsSync.known.get(name) === file.sha256) {
        GameSettingsSync.pending.delete(name);
        continue;
      }
      try {
        await GameSettingsSync.put(name, file, entry.source);
        if (GameSettingsSync.pending.get(name)?.sha256 === entry.sha256) GameSettingsSync.pending.delete(name);
      } catch (e) {
        console.error('game settings put failed', name, e); // останется в pending до следующего pull
      }
    }
    GameSettingsSync.savePending();
  }

  // ---------------------------------------------------------------- pull

  // Копию с сервера — на диск, свои файлы, которых там нет, — на сервер. Возвращает, что перезаписано.
  static pull() {
    return GameSettingsSync.run(async () => {
      const folder = GameSettingsSync.folder();
      if (!folder || GameSettingsSync.gameRunning) return [];
      GameSettingsSync.loadPending();
      const list = await GameSettingsSync.request('list', {}, GameSettingsSync.PULL_TIMEOUT_MS);
      const remote = new Map(((list && list.files) || []).filter((f) => GameSettingsSync.NAME.test(f.name)).map((f) => [f.name, f.sha256]));
      const local = GameSettingsSync.readLocal();
      const restored = [];
      GameSettingsSync.known = new Map(remote);

      for (const [name, sha256] of remote) {
        const before = local.get(name)?.sha256;
        if (before === sha256) continue;
        if (GameSettingsSync.isPendingOnDisk(name, before)) continue; // своё изменение — уйдёт на сервер ниже
        // админам ручная правка файла (user.cfg руками) разрешена: не затирать, а отправить в копию
        if (before && App.isAdmin()) {
          GameSettingsSync.markPending(name, 'launcher');
          continue;
        }
        if (!before && GameSettingsSync.isOversized(name)) {
          console.warn('game settings: local file too big for the server copy, kept as is:', name);
          continue;
        }
        let file = null;
        try {
          file = await GameSettingsSync.request('get', { name });
        } catch (e) {
          console.error('game settings get failed', name, e);
          continue;
        }
        if (!file || !file.content || file.sha256 !== sha256) continue;
        const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
        if (GameSettingsSync.sha256(bytes) !== sha256) continue;
        if (GameSettingsSync.gameRunning) break; // перед боем pull не дождались — игра уже читает файлы
        // пока качали, игрок сохранил настройки (клавиши) — не затирать
        if (GameSettingsSync.isPendingOnDisk(name, GameSettingsSync.readFile(name)?.sha256)) continue;
        NativeAPI.fileSystem.mkdirSync(folder, { recursive: true });
        NativeAPI.fileSystem.writeFileSync(NativeAPI.path.join(folder, name), bytes);
        restored.push(name);
      }

      for (const [name, file] of local) {
        if (!remote.has(name) && !GameSettingsSync.pending.has(name)) await GameSettingsSync.put(name, file, 'first');
      }

      GameSettingsSync.pulled = true;
      await GameSettingsSync.flushPending();
      if (restored.length) console.log('game settings restored from server:', restored);
      if (restored.includes('user.cfg')) ChatFilter.refresh(); // мат-фильтр чата — из user.cfg
      return restored;
    });
  }

  // При входе в замок: копия с сервера на диск и перечитать то, что лончер уже держит в памяти
  static async pullOnLogin() {
    try {
      const restored = await GameSettingsSync.pull();
      if (restored.includes('input_new.cfg')) {
        const { loadKeybinds } = await import('./keybindings/keybindings.io.js');
        await loadKeybinds();
      }
    } catch (e) {
      console.error('game settings pull failed', e);
    }
  }

  // Лончер записал файл (path — полный путь). user — запись по действию игрока (сохранил настройки,
  // сбросил клавиши): она не теряется, даже если pull ещё не прошёл. Автоматические записи до первого
  // pull (починка клавиш при старте) не шлются: pull вернёт копию с сервера, и починка пройдёт по ней.
  static launcherWrote(path, { user = false } = {}) {
    const name = NativeAPI.path.basename(String(path || ''));
    if (!GameSettingsSync.NAME.test(name)) return;
    if (user || GameSettingsSync.pulled) GameSettingsSync.markPending(name, 'launcher');
    GameSettingsSync.run(() => GameSettingsSync.flushPending()).catch((e) => console.error('game settings put failed', e));
  }

  // Перед запуском игры (после записи лончером user.cfg): отпечатки файлов на момент старта
  static beforeGame() {
    GameSettingsSync.gameRunning = true;
    const snapshot = new Map();
    for (const [name, file] of GameSettingsSync.readLocal()) snapshot.set(name, file.sha256);
    return snapshot;
  }

  // Игра закрыта: всё, что изменилось с beforeGame, изменила игра
  static afterGame(snapshot) {
    GameSettingsSync.gameRunning = false;
    ChatFilter.refresh(); // мат-фильтр могли переключить в настройках игры
    if (!snapshot) return;
    for (const [name, file] of GameSettingsSync.readLocal()) {
      if (snapshot.get(name) === file.sha256 || GameSettingsSync.known.get(name) === file.sha256) continue;
      GameSettingsSync.markPending(name, 'game');
    }
    GameSettingsSync.run(() => GameSettingsSync.flushPending()).catch((e) => console.error('game settings put after game failed', e));
  }
}

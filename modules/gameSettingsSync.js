import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';

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
// сохранённый). Пока pull не прошёл (нет связи, не вошли), лончер ничего не шлёт.
export class GameSettingsSync {
  static NAME = /^(user\.cfg|input_new\.cfg|[0-9A-F]{16}\.ignore)$/;

  // как Settings.MAX_BYTES на сервере: файл целиком в одном WS-кадре
  static MAX_BYTES = 11000;

  static PULL_TIMEOUT_MS = 5000;

  // имя → sha256 копии на сервере (как её знает лончер)
  static known = new Map();

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

  // запросы к серверу — по одному, чтобы put после pull не обогнал его
  static run(task) {
    const next = GameSettingsSync.queue.then(task, task);
    GameSettingsSync.queue = next.catch(() => {});
    return next;
  }

  static async put(name, file, source) {
    const result = await App.api.request('settings', 'put', {
      name,
      content: file.bytes.toString('base64'),
      sha256: file.sha256,
      source,
    });
    if (result && result.sha256) GameSettingsSync.known.set(name, result.sha256);
    return result;
  }

  // Копию с сервера — на диск, свои файлы, которых там нет, — на сервер. Возвращает, что перезаписано.
  static pull() {
    return GameSettingsSync.run(async () => {
      const folder = GameSettingsSync.folder();
      if (!folder || GameSettingsSync.gameRunning) return [];
      const list = await Promise.race([
        App.api.request('settings', 'list', {}),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error('settings.list timeout')), GameSettingsSync.PULL_TIMEOUT_MS)),
      ]);
      const remote = new Map(((list && list.files) || []).filter((f) => GameSettingsSync.NAME.test(f.name)).map((f) => [f.name, f.sha256]));
      const local = GameSettingsSync.readLocal();
      const restored = [];
      GameSettingsSync.known = new Map(remote);

      for (const [name, sha256] of remote) {
        if (local.get(name)?.sha256 === sha256) continue;
        const file = await App.api.request('settings', 'get', { name });
        if (!file || !file.content || file.sha256 !== sha256) continue;
        const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
        if (GameSettingsSync.sha256(bytes) !== sha256) continue;
        if (GameSettingsSync.gameRunning) break; // перед боем pull не дождались — игра уже читает файлы
        NativeAPI.fileSystem.mkdirSync(folder, { recursive: true });
        NativeAPI.fileSystem.writeFileSync(NativeAPI.path.join(folder, name), bytes);
        restored.push(name);
      }

      for (const [name, file] of local) {
        if (!remote.has(name)) await GameSettingsSync.put(name, file, 'first');
      }

      GameSettingsSync.pulled = true;
      if (restored.length) console.log('game settings restored from server:', restored);
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

  // лончер записал файл (path — полный путь)
  static launcherWrote(path) {
    const name = NativeAPI.path.basename(String(path || ''));
    if (!GameSettingsSync.NAME.test(name)) return;
    GameSettingsSync.run(async () => {
      if (!GameSettingsSync.pulled) return;
      const file = GameSettingsSync.readFile(name);
      if (!file || GameSettingsSync.known.get(name) === file.sha256) return;
      await GameSettingsSync.put(name, file, 'launcher');
    }).catch((e) => console.error('game settings put failed', e));
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
    if (!snapshot) return;
    GameSettingsSync.run(async () => {
      if (!GameSettingsSync.pulled) return;
      for (const [name, file] of GameSettingsSync.readLocal()) {
        if (snapshot.get(name) === file.sha256 || GameSettingsSync.known.get(name) === file.sha256) continue;
        await GameSettingsSync.put(name, file, 'game');
      }
    }).catch((e) => console.error('game settings put after game failed', e));
  }
}

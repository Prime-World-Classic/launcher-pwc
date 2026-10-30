import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';

// Реплей боя → бэкенд (objects/replay.model.js в pw-api).
//
// Клиент пишет реплей в «Документы\My Games\Prime World Classic\Replays» и
// называет его токеном веб-сессии (первые 32 символа ключа запуска):
//   PW-pwclassic-<версия>-<ГГГГ.ММ.ДД-ЧЧ.ММ.СС UTC>-<token>[-N].pwrp
// После реконнекта у сессии есть ещё файл (с другим временем). После выхода
// из игры берём самый большой файл сессии, сжимаем xz пресетом 9e и шлём по WS:
// replay.begin → replay.chunk × N → replay.finish. Бэкенд хранит на бой один
// реплей (самый большой) и только нужных режимов — лишнее он отсекает на
// begin, до сжатия.
//
// Бой ещё идёт (игрок вышел раньше) — бэкенд отвечает {wait}, повторяем позже.
// Очередь сессий — в localStorage: не отправленное досылается при следующем
// показе замка (в том числе после перезапуска лончера), не дольше суток.
export class ReplayUpload {
  static XZ_PATH = 'content/tools/xz/xz.exe';

  static REPLAYS_SUBDIR = ['My Games', 'Prime World Classic', 'Replays'];

  static STORAGE_KEY = 'pwReplayUploadQueue';

  static ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

  static RETRY_MS = 2 * 60 * 1000;

  static MAX_ATTEMPTS = 5;

  // Словарь пресета 9 — больше реплею не нужно
  static MAX_DICT = 64 * 1024 * 1024;

  // Больше этого бэкенд не примет (REPLAY_MAX_BYTES)
  static MAX_XZ_BYTES = 16 * 1024 * 1024;

  static running = null;

  static timer = 0;

  static replaysDirCache = null;

  // Ключ запуска: <token 32 hex><playerKey 64 hex>
  static sessionOf(key) {
    const session = String(key || '').substring(0, 32);
    return /^[0-9a-f]{32}$/.test(session) ? session : '';
  }

  static supported() {
    return !!NativeAPI.status && NativeAPI.platform === 'win32';
  }

  // После выхода из игры (PWGame.start; не для зрителя)
  static afterGame(key) {
    const session = ReplayUpload.sessionOf(key);
    if (!session || !ReplayUpload.supported()) return;
    const queue = ReplayUpload.load().filter((entry) => entry.session !== session);
    queue.push({ session, added: Date.now(), next: 0, attempts: 0 });
    ReplayUpload.save(queue);
    ReplayUpload.resume();
  }

  // Дослать очередь (замок показан — игрок авторизован). Вызывать можно сколько угодно.
  static resume() {
    if (!ReplayUpload.supported() || ReplayUpload.running) return ReplayUpload.running;
    ReplayUpload.running = ReplayUpload.run()
      .catch((error) => console.warn('replay: queue failed', error))
      .finally(() => {
        ReplayUpload.running = null;
      });
    return ReplayUpload.running;
  }

  static async run() {
    for (;;) {
      const now = Date.now();
      const queue = ReplayUpload.load().filter((entry) => now - entry.added < ReplayUpload.ENTRY_TTL_MS);
      ReplayUpload.save(queue);

      const entry = queue.find((item) => item.next <= now);
      if (!entry) {
        ReplayUpload.schedule(queue);
        return;
      }

      let next = 0;
      try {
        const result = await ReplayUpload.send(entry.session);
        if (result && result.wait) {
          next = Date.now() + Math.max(30, Number(result.wait) || 60) * 1000;
        } else {
          console.log(`replay: ${entry.session} ${JSON.stringify(result || {})}`);
        }
      } catch (error) {
        const text = String((error && error.message) || error);
        console.warn(`replay: ${entry.session} upload failed: ${text}`);
        // старый бэкенд без объекта replay — не повторяем
        if (!/^Not object/.test(text) && entry.attempts + 1 < ReplayUpload.MAX_ATTEMPTS) {
          next = Date.now() + ReplayUpload.RETRY_MS;
        }
        entry.attempts++;
      }

      // очередь могла пополниться, пока шла отправка
      const fresh = ReplayUpload.load().filter((item) => item.session !== entry.session);
      if (next) fresh.push({ ...entry, next });
      ReplayUpload.save(fresh);
    }
  }

  static schedule(queue) {
    clearTimeout(ReplayUpload.timer);
    ReplayUpload.timer = 0;
    if (!queue.length) return;
    const delay = Math.max(1000, Math.min(...queue.map((entry) => entry.next)) - Date.now());
    ReplayUpload.timer = setTimeout(() => ReplayUpload.resume(), delay);
  }

  // {wait} | {skip} | {done}
  static async send(session) {
    const file = await ReplayUpload.findReplay(session);
    if (!file) return { skip: 'no file' };

    const begin = await App.api.request('replay', 'begin', { session, name: file.name, rawSize: file.size });
    if (!begin || !begin.uploadId) return begin || {};

    const xz = await ReplayUpload.compress(file.path, file.size);
    const chunkSize = Number(begin.chunkSize) || 256 * 1024;
    for (let index = 0, offset = 0; offset < xz.length; index++, offset += chunkSize) {
      const data = xz.subarray(offset, offset + chunkSize).toString('base64');
      await App.api.request('replay', 'chunk', { uploadId: begin.uploadId, index, data });
    }

    const sha256 = NativeAPI.crypto.createHash('sha256').update(xz).digest('hex');
    const result = await App.api.request('replay', 'finish', { uploadId: begin.uploadId, size: xz.length, sha256 });
    return { ...(result || {}), name: file.name, rawSize: file.size, size: xz.length };
  }

  static replaysDir() {
    if (ReplayUpload.replaysDirCache === null) {
      const documents = NativeAPI.getDocumentsDir();
      ReplayUpload.replaysDirCache = documents ? NativeAPI.path.join(documents, ...ReplayUpload.REPLAYS_SUBDIR) : '';
    }
    return ReplayUpload.replaysDirCache;
  }

  static namePattern(session) {
    return new RegExp(`^[A-Za-z0-9._-]{1,80}-\\d{4}\\.\\d{2}\\.\\d{2}-\\d{2}\\.\\d{2}\\.\\d{2}-${session}(?:-\\d{1,2})?\\.pwrp$`);
  }

  // Самый большой реплей сессии: {name, path, size} или null
  static async findReplay(session, dir = ReplayUpload.replaysDir()) {
    if (!dir) return null;
    const fs = NativeAPI.fileSystem;
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return null;
    }
    const pattern = ReplayUpload.namePattern(session);
    let best = null;
    for (const name of names) {
      if (!pattern.test(name)) continue;
      const path = NativeAPI.path.join(dir, name);
      try {
        const stat = await fs.promises.stat(path);
        if (stat.isFile() && stat.size > 0 && (!best || stat.size > best.size)) {
          best = { name, path, size: stat.size };
        }
      } catch {}
    }
    return best;
  }

  // xz -9e, но словарь не больше файла: тот же результат, памяти — мегабайты вместо 674 МБ
  static dictSize(rawSize) {
    let dict = 4096;
    while (dict < rawSize && dict < ReplayUpload.MAX_DICT) dict *= 2;
    return dict;
  }

  static compressArgs(file, rawSize) {
    return ['-T1', '-c', `--lzma2=preset=9e,dict=${ReplayUpload.dictSize(rawSize)}`, '--', file];
  }

  static compress(file, rawSize) {
    return new Promise((resolve, reject) => {
      const exe = NativeAPI.path.join(process.cwd(), ReplayUpload.XZ_PATH);
      const child = NativeAPI.childProcess.spawn(exe, ReplayUpload.compressArgs(file, rawSize), { windowsHide: true });
      // reload лончера дождётся (или убьёт) процесс: колбэк в мёртвый контекст роняет NW
      NativeAPI.trackChildBeforeReload(child);
      try {
        NativeAPI.os.setPriority(child.pid, NativeAPI.os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch {}

      const chunks = [];
      let total = 0;
      let stderr = '';
      child.stdout.on('data', (data) => {
        total += data.length;
        if (total > ReplayUpload.MAX_XZ_BYTES) {
          child.kill();
          return;
        }
        chunks.push(data);
      });
      child.stderr.on('data', (data) => {
        stderr += data;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0 && total <= ReplayUpload.MAX_XZ_BYTES) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`xz: code ${code}, ${total} bytes ${stderr.trim()}`));
        }
      });
    });
  }

  static load() {
    try {
      const queue = JSON.parse(localStorage.getItem(ReplayUpload.STORAGE_KEY) || '[]');
      return Array.isArray(queue) ? queue.filter((entry) => entry && /^[0-9a-f]{32}$/.test(entry.session)) : [];
    } catch {
      return [];
    }
  }

  static save(queue) {
    try {
      if (queue.length) localStorage.setItem(ReplayUpload.STORAGE_KEY, JSON.stringify(queue));
      else localStorage.removeItem(ReplayUpload.STORAGE_KEY);
    } catch {}
  }
}

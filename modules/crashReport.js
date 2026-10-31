import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';
import { ReplayUpload } from './replayUpload.js';

// Отчёт о краше игры → бэкенд (objects/crash.model.js в pw-api).
//
// При необработанном исключении PW_Game.exe ещё ДО окна «Unhandled Exception»
// пишет в папку запуска «Документы\My Games\Prime World Classic\Session\Logs\
// <ГГГГ.ММ.ДД-ЧЧ.ММ.СС UTC запуска>» мини-дамп и стек:
//   PW-pwclassic-<версия>-<время краша>-exception.dmp / -exception.log
// Окно висит, пока игрок его не закроет, поэтому лончер не ждёт выхода игры:
// пока игра запущена, раз в WATCH_MS смотрит свежие папки логов и, как только
// дамп дописан, собирает один архив .tar.xz — дамп, exception.log, общий лог
// (*-output.txt), хвост Bin\fastfail.log, реплей боя, meta.json — и шлёт по WS:
// crash.begin → crash.chunk × N → crash.finish. От игрока ничего не нужно.
// На бой бэкенд берёт один архив: у остальных игроков того же боя отказ ещё
// на begin ({skip}), а пока архив боя грузит другой — {retry}, повтор позже.
//
// Отправленный (или отвергнутый бэкендом) дамп помечается файлом
// <дамп>.sent рядом с ним. Не отправленное (нет связи, лончер закрыли) досылается
// при следующем показе замка — дампы не старше MAX_AGE_MS.
export class CrashReport {
  static LOGS_SUBDIR = ['My Games', 'Prime World Classic', 'Session', 'Logs'];

  static FASTFAIL_LOG = '../Game/Bin/fastfail.log';

  static WATCH_MS = 5000;

  // Дамп не трогали столько — дописан (MiniDumpWriteDump закрывает файл до окна)
  static SETTLE_MS = 3000;

  static MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

  static MAX_ATTEMPTS = 3;

  // Сколько берём с конца больших файлов
  static OUTPUT_TAIL = 16 * 1024 * 1024;

  static FASTFAIL_TAIL = 256 * 1024;

  static MAX_REPLAY = 32 * 1024 * 1024;

  static MAX_DUMP = 64 * 1024 * 1024;

  static FOLDER_RE = /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/;

  static DUMP_RE = /^[A-Za-z0-9._-]{1,80}-(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})-exception\.dmp$/;

  static REPLAY_RE = /^[A-Za-z0-9._-]{1,80}-(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})-([0-9a-f]{16,32})(?:-\d{1,2})?\.pwrp$/;

  static running = null;

  static watchTimer = 0;

  static watchSince = 0;

  static watchSession = '';

  static attempts = new Map(); // имя дампа → неудачных попыток за запуск лончера

  static retryAt = new Map(); // имя дампа → не раньше (бэкенд ответил {retry})

  static retryTimer = 0;

  static logsDirCache = null;

  static supported() {
    return !!NativeAPI.status && NativeAPI.platform === 'win32';
  }

  // Игра запущена (PWGame.start): ловим краш, не дожидаясь закрытия окна
  static watch(key) {
    if (!CrashReport.supported()) return;
    CrashReport.unwatch();
    CrashReport.watchSince = Date.now();
    CrashReport.watchSession = ReplayUpload.sessionOf(key);
    CrashReport.watchTimer = setInterval(() => CrashReport.resume(), CrashReport.WATCH_MS);
  }

  // Игра закрыта: последний просмотр (краш мог случиться прямо перед выходом)
  static unwatch() {
    clearInterval(CrashReport.watchTimer);
    CrashReport.watchTimer = 0;
  }

  static afterGame() {
    CrashReport.unwatch();
    // окно краша закрывают сразу — дамп мог только что дописаться
    setTimeout(() => CrashReport.resume(), CrashReport.SETTLE_MS);
  }

  // Найти и отправить неотправленные дампы. Вызывать можно сколько угодно.
  static resume() {
    if (!CrashReport.supported() || CrashReport.running) return CrashReport.running;
    CrashReport.running = CrashReport.run()
      .catch((error) => console.warn('crash: report failed', error))
      .finally(() => {
        CrashReport.running = null;
      });
    return CrashReport.running;
  }

  static async run() {
    for (const dump of await CrashReport.findDumps()) {
      if ((CrashReport.attempts.get(dump.name) || 0) >= CrashReport.MAX_ATTEMPTS) continue;
      if ((CrashReport.retryAt.get(dump.name) || 0) > Date.now()) continue;
      try {
        const result = await CrashReport.send(dump);
        console.log(`crash: ${dump.name} ${JSON.stringify(result || {})}`);
        // архив этого боя сейчас шлёт другой игрок: если у него сорвётся — нужен наш
        if (result && result.retry) {
          const delay = Math.max(10, Number(result.retry) || 60) * 1000;
          CrashReport.retryAt.set(dump.name, Date.now() + delay);
          clearTimeout(CrashReport.retryTimer);
          CrashReport.retryTimer = setTimeout(() => CrashReport.resume(), delay + 1000);
          continue;
        }
        await CrashReport.markSent(dump, result);
      } catch (error) {
        const text = String((error && error.message) || error);
        console.warn(`crash: ${dump.name} upload failed: ${text}`);
        // старый бэкенд без объекта crash — до перезапуска лончера не повторяем
        CrashReport.attempts.set(dump.name, /^Not object/.test(text) ? CrashReport.MAX_ATTEMPTS : (CrashReport.attempts.get(dump.name) || 0) + 1);
      }
    }
  }

  static logsDir() {
    if (CrashReport.logsDirCache === null) {
      const documents = NativeAPI.getDocumentsDir();
      CrashReport.logsDirCache = documents ? NativeAPI.path.join(documents, ...CrashReport.LOGS_SUBDIR) : '';
    }
    return CrashReport.logsDirCache;
  }

  static replaysDir() {
    return ReplayUpload.replaysDir();
  }

  // «2026.10.31-14.23.45» (UTC) → мс
  static parseStamp(stamp) {
    const m = /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(stamp || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
  }

  // Неотправленные дописанные дампы: [{name, path, folder, folderPath, size, crashTime, startTime}], старые первыми
  static async findDumps(now = Date.now()) {
    const root = CrashReport.logsDir();
    if (!root) return [];
    const fs = NativeAPI.fileSystem;
    let folders;
    try {
      folders = await fs.promises.readdir(root);
    } catch {
      return [];
    }
    const dumps = [];
    for (const folder of folders.filter((name) => CrashReport.FOLDER_RE.test(name)).sort()) {
      const startTime = CrashReport.parseStamp(folder);
      // время запуска — по часам игры; запас на расхождение
      if (!(now - startTime < CrashReport.MAX_AGE_MS + 60 * 60 * 1000)) continue;
      const folderPath = NativeAPI.path.join(root, folder);
      let names;
      try {
        names = await fs.promises.readdir(folderPath);
      } catch {
        continue;
      }
      for (const name of names) {
        const match = CrashReport.DUMP_RE.exec(name);
        if (!match || names.includes(`${name}.sent`)) continue;
        const path = NativeAPI.path.join(folderPath, name);
        try {
          const stat = await fs.promises.stat(path);
          if (!stat.isFile() || !stat.size || stat.size > CrashReport.MAX_DUMP) continue;
          if (now - stat.mtimeMs < CrashReport.SETTLE_MS || now - stat.mtimeMs > CrashReport.MAX_AGE_MS) continue;
          dumps.push({ name, path, folder, folderPath, size: stat.size, crashTime: CrashReport.parseStamp(match[1]), startTime, mtime: stat.mtimeMs });
        } catch {}
      }
    }
    return dumps.sort((a, b) => a.mtime - b.mtime);
  }

  // Реплей боя, во время которого упала игра: самый свежий, начатый между запуском и крашем
  static async findReplay(dump, dir = CrashReport.replaysDir()) {
    if (!dir) return null;
    const fs = NativeAPI.fileSystem;
    let names;
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return null;
    }
    let best = null;
    for (const name of names) {
      const match = CrashReport.REPLAY_RE.exec(name);
      if (!match) continue;
      const time = CrashReport.parseStamp(match[1]);
      if (!(time >= dump.startTime - 5000 && time <= dump.crashTime + 5000)) continue;
      const path = NativeAPI.path.join(dir, name);
      try {
        const stat = await fs.promises.stat(path);
        if (!stat.isFile() || !stat.size || stat.size > CrashReport.MAX_REPLAY) continue;
        if (!best || time > best.time || (time === best.time && stat.size > best.size)) {
          best = { name, path, size: stat.size, time, session: match[2].length === 32 ? match[2] : '' };
        }
      } catch {}
    }
    return best;
  }

  // Конец файла (весь, если меньше limit); null — нет файла
  static async readTail(path, limit) {
    const fs = NativeAPI.fileSystem;
    let file;
    try {
      file = await fs.promises.open(path, 'r');
    } catch {
      return null;
    }
    try {
      const { size } = await file.stat();
      const length = Math.min(size, limit);
      const data = Buffer.alloc(length);
      let read = 0;
      while (read < length) {
        const { bytesRead } = await file.read(data, read, length - read, size - length + read);
        if (!bytesRead) break;
        read += bytesRead;
      }
      return data.subarray(0, read);
    } catch {
      return null;
    } finally {
      await file.close().catch(() => {});
    }
  }

  // Файлы архива: [{name, data}]
  static async collect(dump) {
    const fs = NativeAPI.fileSystem;
    const files = [];
    const add = (name, data) => {
      if (data) files.push({ name, data });
    };

    add(dump.name, await CrashReport.readTail(dump.path, CrashReport.MAX_DUMP));

    let names = [];
    try {
      names = await fs.promises.readdir(dump.folderPath);
    } catch {}
    // стек и байты кода в точке краша, затем общий лог запуска
    const exceptionLog = dump.name.replace(/-exception\.dmp$/, '-exception.log');
    const logs = names.sort().filter((name) => name === exceptionLog).concat(names.filter((name) => /-output\.txt$/.test(name)));
    for (const name of logs) {
      add(name, await CrashReport.readTail(NativeAPI.path.join(dump.folderPath, name), CrashReport.OUTPUT_TAIL));
    }

    add('fastfail.log', await CrashReport.readTail(NativeAPI.path.join(process.cwd(), CrashReport.FASTFAIL_LOG), CrashReport.FASTFAIL_TAIL));

    const replay = await CrashReport.findReplay(dump);
    if (replay) add(replay.name, await CrashReport.readTail(replay.path, CrashReport.MAX_REPLAY));

    const watching = CrashReport.watchSession && dump.mtime >= CrashReport.watchSince - 60000;
    const meta = {
      dump: dump.name,
      folder: dump.folder,
      crashTime: new Date(dump.crashTime || dump.mtime).toISOString(),
      session: (watching && CrashReport.watchSession) || (replay && replay.session) || '',
      replay: replay ? replay.name : '',
      os: `${NativeAPI.os.type()} ${NativeAPI.os.release()} ${NativeAPI.os.arch()}`,
      nw: (process.versions && process.versions.nw) || '',
    };
    files.unshift({ name: 'meta.json', data: Buffer.from(JSON.stringify(meta, null, 2)) });
    return { files, meta };
  }

  // Простой ustar: короткие ASCII-имена, обычные файлы
  static tar(files, mtime = Date.now()) {
    const blocks = [];
    const octal = (value, width) => value.toString(8).padStart(width - 1, '0') + '\0';
    for (const { name, data } of files) {
      const header = Buffer.alloc(512);
      header.write(name.substring(0, 99), 0, 'ascii');
      header.write(octal(0o644, 8), 100, 'ascii');
      header.write(octal(0, 8), 108, 'ascii');
      header.write(octal(0, 8), 116, 'ascii');
      header.write(octal(data.length, 12), 124, 'ascii');
      header.write(octal(Math.floor(mtime / 1000), 12), 136, 'ascii');
      header.write('        ', 148, 'ascii');
      header.write('0', 156, 'ascii');
      header.write('ustar\0' + '00', 257, 'ascii');
      let sum = 0;
      for (const byte of header) sum += byte;
      header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
      blocks.push(header, data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) blocks.push(Buffer.alloc(pad));
    }
    blocks.push(Buffer.alloc(1024));
    return Buffer.concat(blocks);
  }

  // {skip} | {done} | {retry}
  static async send(dump) {
    const { files, meta } = await CrashReport.collect(dump);
    const tar = CrashReport.tar(files, dump.mtime);

    const begin = await App.api.request('crash', 'begin', { name: dump.name, rawSize: tar.length, session: meta.session });
    if (!begin || !begin.uploadId) return begin || {};

    const fs = NativeAPI.fileSystem;
    const tmp = NativeAPI.path.join(NativeAPI.os.tmpdir(), `pw-crash-${process.pid}-${Date.now()}.tar`);
    let xz;
    try {
      await fs.promises.writeFile(tmp, tar);
      xz = await ReplayUpload.compress(tmp, tar.length);
    } finally {
      fs.promises.rm(tmp, { force: true }).catch(() => {});
    }

    const chunkSize = Number(begin.chunkSize) || 256 * 1024;
    for (let index = 0, offset = 0; offset < xz.length; index++, offset += chunkSize) {
      const data = xz.subarray(offset, offset + chunkSize).toString('base64');
      await App.api.request('crash', 'chunk', { uploadId: begin.uploadId, index, data });
    }

    const sha256 = NativeAPI.crypto.createHash('sha256').update(xz).digest('hex');
    const result = await App.api.request('crash', 'finish', { uploadId: begin.uploadId, size: xz.length, sha256 });
    return { ...(result || {}), files: files.map((file) => file.name), rawSize: tar.length, size: xz.length };
  }

  static async markSent(dump, result) {
    try {
      await NativeAPI.fileSystem.promises.writeFile(`${dump.path}.sent`, JSON.stringify({ at: new Date().toISOString(), result }));
    } catch {}
  }
}

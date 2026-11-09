import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';
import { ReplayUpload } from './replayUpload.js';

// Отчёт о краше игры → бэкенд (objects/crash.model.js в pw-api).
//
// Отчёты в папке запуска «Документы\My Games\Prime World Classic\Session\Logs\
// <ГГГГ.ММ.ДД-ЧЧ.ММ.СС UTC запуска>» бывают трёх видов:
//  - PW-pwclassic-<версия>-<время>-exception.dmp (+ -exception.log): обычный краш.
//    Игра пишет их ДО окна «Unhandled Exception»; окно висит, пока игрок его не
//    закроет, поэтому, пока игра запущена, лончер раз в WATCH_MS смотрит свежие
//    папки и шлёт такой дамп, не дожидаясь выхода игры;
//  - ...-fatal.dmp: мини-дамп из векторного обработчика (PW_Game.cpp, MiniDump.cpp)
//    — для крашей, после которых процесс исчезает без окна и exception.dmp.
//    Обработчик видит и обработанные исключения, поэтому дамп отправляется, только
//    если игра потом вышла с кодом краша: лончер кладёт рядом <дамп>.crash (код
//    выхода + свежий блок fastfail.log). После нормального выхода дамп удаляется.
//    Такой же дамп пишет сторож главного потока (MiniDump.cpp), если нет кадров и
//    загрузка стоит 8 с: в fastfail.log код E0000BAD и стек главного потока;
//  - ...-crash.txt: игра вышла с кодом краша, а дампа нет (настоящий __fastfail
//    не виден никакому обработчику). Пишет лончер: код выхода + блок fastfail.log;
//  - ...-async.txt: рассинхрон. Пишет игра, как только сервер сообщил о нём
//    (HybridServerNodeImpl.cpp): шаг и контрольные суммы мира всех клиентов.
//    Игра при этом не падает, отчёт уходит, пока окно рассинхрона на экране;
//  - ...-crcdump-<шаг>.bin: контрольные данные мира за шаг рассинхрона, сервер
//    запрашивает их у одного нормального клиента и у разошедшихся
//    (game_crc_data_requests_enabled). Есть async.txt — мы разошлись, иначе
//    нормальная сторона: async.txt появился бы сразу после дампа, ждём PEER_WAIT_MS.
//    Значения шлются отдельно (crash.crc), бэкенд сравнивает стороны и пишет
//    в Telegram, какой герой и какой стат разошлись.
//
// Из каждого отчёта собирается один архив .tar.xz — дамп, exception.log, общий лог
// (*-output.txt), fastfail.log, реплей боя, meta.json — и шлётся по WS:
// crash.begin → crash.chunk × N → crash.finish. От игрока ничего не нужно.
// В crash.begin идёт и краткая сводка (summary): код исключения, штамп exe и стек
// адресами. Имена функций подставляет бэкенд (objects/crashSymbols.js): таблицу имён
// игрокам не раздаём. Отчёт могут дослать уже после обновления игры, поэтому штамп
// exe берётся из дампа, а у отчёта без дампа — из отметки лончера при выходе игры.
// На бой бэкенд берёт один архив: у остальных игроков того же боя отказ ещё
// на begin ({skip}), а пока архив боя грузит другой — {retry}, повтор позже.
//
// Отправленный (или отвергнутый бэкендом) отчёт помечается файлом
// <отчёт>.sent рядом с ним. Не отправленное (нет связи, лончер закрыли) досылается
// при следующем показе замка — отчёты не старше MAX_AGE_MS.
export class CrashReport {
  static LOGS_SUBDIR = ['My Games', 'Prime World Classic', 'Session', 'Logs'];

  static GAME_BIN = '../Game/Bin';

  static WATCH_MS = 5000;

  // Дамп не трогали столько — дописан (MiniDumpWriteDump закрывает файл до окна)
  static SETTLE_MS = 3000;

  static MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

  // fatal.dmp без отметки о краше старше этого — от обработанного исключения, удаляется
  static STALE_FATAL_MS = 24 * 60 * 60 * 1000;

  static MAX_ATTEMPTS = 3;

  // Сколько берём с конца больших файлов
  static OUTPUT_TAIL = 16 * 1024 * 1024;

  static FASTFAIL_TAIL = 256 * 1024;

  static FASTFAIL_BLOCK = 16 * 1024;

  static MAX_REPLAY = 32 * 1024 * 1024;

  static MAX_DUMP = 64 * 1024 * 1024;

  static SUMMARY_FRAMES = 8;

  // Дамп без async.txt столько времени — мы нормальная сторона рассинхрона
  static PEER_WAIT_MS = 60 * 1000;

  // Сколько читаем с начала общего лога, чтобы найти список игроков
  static PLAYERS_LOG_HEAD = 1024 * 1024;

  static FOLDER_RE = /^\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/;

  static REPORT_RE = /^([A-Za-z0-9._-]{1,80})-(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})-(exception\.dmp|fatal\.dmp|crash\.txt|async\.txt|crcdump-\d+\.bin)$/;

  static REPLAY_RE = /^[A-Za-z0-9._-]{1,80}-(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})-([0-9a-f]{16,32})(?:-\d{1,2})?\.pwrp$/;

  // Общий лог запуска: префикс «PW-pwclassic-<версия>» для имени crash.txt
  static OUTPUT_RE = /^([A-Za-z0-9._-]{1,80})-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}-output\.txt$/;

  // Описания кодов исключений для сводки
  static CODE_TEXT = {
    C0000005: 'нарушение доступа',
    C0000006: 'ошибка подкачки страницы',
    C000001D: 'недопустимая инструкция',
    C0000094: 'целочисленное деление на ноль',
    C0000096: 'привилегированная инструкция',
    C00000FD: 'переполнение стека',
    C0000374: 'повреждение кучи',
    C0000409: 'fastfail (переполнение буфера / проверка CRT)',
    C0000420: 'assertion failure',
    C0000602: 'fail fast (RaiseFailFastException)',
    CFFFFFFF: 'игра закрыта как зависшая',
    E0000BAD: 'главный поток не отвечал, стек снят сторожем',
    80000003: 'breakpoint',
    40000015: 'abort()',
    E06D7363: 'необработанное C++-исключение',
    '00000003': 'abort()',
  };

  // Первая строка exception.log (BSExceptionDialog.cpp ExceptionCodeToString) → код
  static LOG_CODES = [
    [/^The thread tried to read from or write to a virtual address/, 'C0000005'],
    [/^The thread used up its stack/, 'C00000FD'],
    [/^The thread tried to divide an integer value/, 'C0000094'],
    [/^The thread tried to execute an invalid instruction/, 'C000001D'],
    [/^The thread tried to execute an instruction whose operation is not allowed/, 'C0000096'],
    [/^The thread tried to access a page that was not present/, 'C0000006'],
    [/^Microsoft C\+\+ Exception/, 'E06D7363'],
    [/^Exception 0x([0-9A-Fa-f]{8})/, null],
  ];

  static running = null;

  static watchTimer = 0;

  static watchSince = 0;

  static watchSession = '';

  static attempts = new Map(); // имя отчёта → неудачных попыток за запуск лончера

  static retryAt = new Map(); // имя отчёта → не раньше (бэкенд ответил {retry})

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

  static unwatch() {
    clearInterval(CrashReport.watchTimer);
    CrashReport.watchTimer = 0;
  }

  // Игра закрыта (exitCode — код выхода процесса, 0/undefined — нормальный выход)
  static afterGame(exitCode = 0) {
    CrashReport.unwatch();
    if (!CrashReport.supported()) return;
    CrashReport.finishRun(CrashReport.exitCodeOf(exitCode), CrashReport.watchSince)
      .catch((error) => console.warn('crash: after game', error))
      .finally(() => {
        // окно краша закрывают сразу — дамп мог только что дописаться
        setTimeout(() => CrashReport.resume(), CrashReport.SETTLE_MS);
      });
  }

  // Код выхода как беззнаковое 32-битное число (0 — не число)
  static exitCodeOf(value) {
    const code = Number(value);
    return Number.isFinite(code) ? code >>> 0 : 0;
  }

  static hex(code) {
    return (code >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  // NTSTATUS-ошибки (0xC…), breakpoint, abort() — краш; прочие коды игра ставит сама
  static isCrashExit(code) {
    return code >= 0xc0000000 || code === 0x80000003 || code === 0x40000015 || code === 3;
  }

  // Папка логов этого запуска: самая новая, созданная после старта игры
  static async runFolder(since) {
    const root = CrashReport.logsDir();
    if (!root || !since) return null;
    let folders;
    try {
      folders = await NativeAPI.fileSystem.promises.readdir(root);
    } catch {
      return null;
    }
    const run = folders
      .filter((name) => CrashReport.FOLDER_RE.test(name) && CrashReport.parseStamp(name) >= since - 60000)
      .sort();
    return run.length ? { folder: run.at(-1), folderPath: NativeAPI.path.join(root, run.at(-1)) } : null;
  }

  static async finishRun(code, since, now = Date.now()) {
    const run = await CrashReport.runFolder(since);
    if (!run) return;
    const fs = NativeAPI.fileSystem;
    const names = await fs.promises.readdir(run.folderPath);
    const fatal = names.filter((name) => /-fatal\.dmp$/.test(name)).sort();
    const remove = (list) => Promise.all(list.map((name) => fs.promises.rm(NativeAPI.path.join(run.folderPath, name), { force: true }).catch(() => {})));

    // нормальный выход или обычный краш с окном (его exception.dmp уже отчёт) — fatal.dmp не нужны
    if (!CrashReport.isCrashExit(code) || names.some((name) => /-exception\.dmp$/.test(name))) {
      await remove(fatal);
      return;
    }

    const note = JSON.stringify({ exitCode: CrashReport.hex(code), exe: await CrashReport.installedExe(), fastfail: await CrashReport.fastfailBlock() }, null, 2);
    if (fatal.length) {
      // последний дамп — ближайший к выходу; ранние — от обработанных исключений
      await fs.promises.writeFile(NativeAPI.path.join(run.folderPath, `${fatal.at(-1)}.crash`), note);
      await remove(fatal.slice(0, -1));
      return;
    }

    const output = names.find((name) => /-output\.txt$/.test(name));
    const prefix = (output && CrashReport.OUTPUT_RE.exec(output)?.[1]) || 'PW-pwclassic';
    await fs.promises.writeFile(NativeAPI.path.join(run.folderPath, `${prefix}-${CrashReport.stampOf(now)}-crash.txt`), note);
  }

  // мс → «2026.10.31-14.23.45» (UTC)
  static stampOf(time) {
    const d = new Date(time);
    const p = (value) => String(value).padStart(2, '0');
    return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}-${p(d.getUTCHours())}.${p(d.getUTCMinutes())}.${p(d.getUTCSeconds())}`;
  }

  // Строки fastfail.log последнего запуска игры (после последнего «handlers installed»)
  static async fastfailBlock() {
    const data = await CrashReport.readTail(NativeAPI.path.join(process.cwd(), CrashReport.GAME_BIN, 'fastfail.log'), CrashReport.FASTFAIL_TAIL);
    if (!data) return '';
    const lines = data.toString('latin1').split(/\r?\n/);
    let start = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('handlers installed')) {
        start = i + 1;
        break;
      }
    }
    const block = lines.slice(start).filter((line) => line && !line.startsWith('fp:')).join('\n');
    return block.length > CrashReport.FASTFAIL_BLOCK ? block.slice(-CrashReport.FASTFAIL_BLOCK) : block;
  }

  // Найти и отправить неотправленные отчёты. Вызывать можно сколько угодно.
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

  // Неотправленные готовые отчёты: [{name, kind, path, folder, folderPath, size, crashTime, startTime, mtime}], старые первыми
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
        const match = CrashReport.REPORT_RE.exec(name);
        if (!match || names.includes(`${name}.sent`)) continue;
        const kind = match[3].replace(/[-.].*$/, '');
        const path = NativeAPI.path.join(folderPath, name);
        try {
          const stat = await fs.promises.stat(path);
          if (!stat.isFile() || !stat.size || stat.size > CrashReport.MAX_DUMP) continue;
          if (kind === 'fatal' && !names.includes(`${name}.crash`)) {
            // дамп обработанного исключения, а лончер не видел выхода игры (был закрыт)
            if (now - stat.mtimeMs > CrashReport.STALE_FATAL_MS) await fs.promises.rm(path, { force: true }).catch(() => {});
            continue;
          }
          if (now - stat.mtimeMs < CrashReport.SETTLE_MS || now - stat.mtimeMs > CrashReport.MAX_AGE_MS) continue;
          if (kind === 'crcdump' && now - stat.mtimeMs < CrashReport.PEER_WAIT_MS && !names.some((item) => /-async\.txt$/.test(item))) continue;
          dumps.push({ name, kind, path, folder, folderPath, size: stat.size, crashTime: CrashReport.parseStamp(match[2]), startTime, mtime: stat.mtimeMs });
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

  // Отметка лончера к fatal.dmp / содержимое crash.txt: {exitCode, fastfail}
  static async readNote(path) {
    try {
      const note = JSON.parse(String(await NativeAPI.fileSystem.promises.readFile(path)));
      return note && typeof note === 'object' ? note : {};
    } catch {
      return {};
    }
  }

  // Файлы архива: [{name, data}]
  static async collect(dump) {
    const fs = NativeAPI.fileSystem;
    const files = [];
    const add = (name, data) => {
      if (data) files.push({ name, data });
    };

    let note = {};
    let asyncData = null;
    if (dump.kind === 'exception') {
      add(dump.name, await CrashReport.readTail(dump.path, CrashReport.MAX_DUMP));
    } else if (dump.kind === 'fatal') {
      add(dump.name, await CrashReport.readTail(dump.path, CrashReport.MAX_DUMP));
      note = await CrashReport.readNote(`${dump.path}.crash`);
    } else if (dump.kind === 'async') {
      asyncData = await CrashReport.readTail(dump.path, CrashReport.MAX_DUMP);
      add(dump.name, asyncData);
      for (const name of await CrashReport.crcDumpsOf(dump)) {
        add(name, await CrashReport.readTail(NativeAPI.path.join(dump.folderPath, name), CrashReport.MAX_DUMP));
      }
    } else {
      note = await CrashReport.readNote(dump.path);
    }

    let names = [];
    try {
      names = await fs.promises.readdir(dump.folderPath);
    } catch {}
    // стек и байты кода в точке краша, затем общий лог запуска
    const exceptionLog = dump.name.replace(/-exception\.dmp$/, '-exception.log');
    let exceptionText = '';
    if (dump.kind === 'exception' && names.includes(exceptionLog)) {
      const data = await CrashReport.readTail(NativeAPI.path.join(dump.folderPath, exceptionLog), CrashReport.OUTPUT_TAIL);
      add(exceptionLog, data);
      exceptionText = data ? data.toString('latin1') : '';
    }
    for (const name of names.filter((item) => /-output\.txt$/.test(item)).sort()) {
      add(name, await CrashReport.readTail(NativeAPI.path.join(dump.folderPath, name), CrashReport.OUTPUT_TAIL));
    }

    // обычный краш и рассинхрон — хвост fastfail.log; без окна — блок этого запуска, снятый при выходе
    let fastfailTail = null;
    if (dump.kind === 'exception' || dump.kind === 'async') {
      fastfailTail = await CrashReport.readTail(NativeAPI.path.join(process.cwd(), CrashReport.GAME_BIN, 'fastfail.log'), CrashReport.FASTFAIL_TAIL);
      add('fastfail.log', fastfailTail);
    } else if (note.fastfail) {
      add('fastfail.log', Buffer.from(String(note.fastfail), 'latin1'));
    }

    const replay = await CrashReport.findReplay(dump);
    if (replay) add(replay.name, await CrashReport.readTail(replay.path, CrashReport.MAX_REPLAY));

    const asyncReport = asyncData ? CrashReport.parseAsyncReport(asyncData.toString('latin1')) : null;
    const crash = dump.kind === 'exception' ? CrashReport.parseExceptionLog(exceptionText) : CrashReport.parseFastfail(String(note.fastfail || ''));
    const exe = CrashReport.dumpExe(files.find((file) => file.name === dump.name)?.data) || note.exe || null;
    const stack = crash.frames.map((rva) => CrashReport.frameAddress(rva));
    const summary = asyncReport
      ? CrashReport.asyncSummary(asyncReport, await CrashReport.exeStamp(), CrashReport.fpHash(fastfailTail))
      : CrashReport.summary(dump.kind, note.exitCode, crash, stack, exe);

    const watching = CrashReport.watchSession && dump.mtime >= CrashReport.watchSince - 60000;
    const meta = {
      report: dump.name,
      kind: dump.kind,
      folder: dump.folder,
      crashTime: new Date(dump.crashTime || dump.mtime).toISOString(),
      exitCode: note.exitCode || '',
      exe: exe ? exe.timestamp : '',
      session: (watching && CrashReport.watchSession) || (replay && replay.session) || '',
      replay: replay ? replay.name : '',
      summary,
      stack,
      async: asyncReport,
      os: `${NativeAPI.os.type()} ${NativeAPI.os.release()} ${NativeAPI.os.arch()}`,
      nw: (process.versions && process.versions.nw) || '',
    };
    files.unshift({ name: 'meta.json', data: Buffer.from(JSON.stringify(meta, null, 2)) });
    return { files, meta };
  }

  // exception.log → {code, detail, frames: [RVA PW_Game.exe]}
  static parseExceptionLog(text) {
    const lines = String(text || '').split(/\r?\n/);
    let code = '';
    for (const [re, value] of CrashReport.LOG_CODES) {
      const m = re.exec(lines[0] || '');
      if (m) {
        code = value || m[1].toUpperCase();
        break;
      }
    }
    const frames = [];
    for (const line of lines) {
      const m = /^@rltv@\s+PW_Game\.exe\s+([0-9A-Fa-f]{1,8})\b/.exec(line);
      if (m) frames.push(parseInt(m[1], 16));
    }
    return { code, detail: '', frames };
  }

  // Последний блок fastfail.log (PW_Game.cpp FastfailVeh) → {code, detail, frames}
  static parseFastfail(text) {
    const lines = String(text || '').split(/\r?\n/);
    let last = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^code=[0-9A-Fa-f]{8}\b/.test(lines[i])) {
        last = i;
        break;
      }
    }
    if (last < 0) return { code: '', detail: '', frames: [] };
    const head = /^code=([0-9A-Fa-f]{8}) addr=[0-9A-Fa-f]+ sub=(\d+) .*?info1=([0-9A-Fa-f]+)/.exec(lines[last]) || [];
    const code = (head[1] || '').toUpperCase();
    let detail = '';
    if (code === 'C0000005' && head[3]) {
      const op = { 0: 'чтение', 1: 'запись', 8: 'исполнение' }[head[2]] || 'доступ';
      detail = `${op} по адресу 0x${parseInt(head[3], 16).toString(16).toUpperCase()}`;
    }
    const frames = [];
    for (const line of lines.slice(last + 1)) {
      if (/^code=/.test(line)) break;
      const m = /^frame\[\d+\]=([0-9A-Fa-f]{1,8})$/.exec(line.trim());
      if (m) frames.push(parseInt(m[1], 16));
    }
    return { code, detail, frames };
  }

  // PW_Game.exe из таблицы модулей минидампа: {timestamp, size} как в peHeader; нет — null
  static dumpExe(data) {
    if (!data || data.length < 32 || data.toString('latin1', 0, 4) !== 'MDMP') return null;
    try {
      const count = data.readUInt32LE(8);
      const directory = data.readUInt32LE(12);
      if (directory + 12 * count > data.length) return null;
      for (let i = 0; i < count; i++) {
        if (data.readUInt32LE(directory + 12 * i) !== 4) continue;
        const list = data.readUInt32LE(directory + 12 * i + 8);
        const modules = data.readUInt32LE(list);
        for (let m = 0; m < modules; m++) {
          const entry = list + 4 + 108 * m;
          const name = data.readUInt32LE(entry + 20);
          const text = data.toString('utf16le', name + 4, name + 4 + data.readUInt32LE(name));
          if (text.toLowerCase().endsWith('pw_game.exe')) {
            return {
              timestamp: data.readUInt32LE(entry + 16).toString(16).padStart(8, '0'),
              size: data.readUInt32LE(entry + 8).toString(16),
            };
          }
        }
      }
    } catch {}
    return null;
  }

  // Заголовок установленного PW_Game.exe: {timestamp, size} | null
  static async installedExe() {
    return CrashReport.peHeader(await CrashReport.readHead(NativeAPI.path.join(process.cwd(), CrashReport.GAME_BIN, 'PW_Game.exe'), 4096));
  }

  static async readHead(path, length) {
    let file;
    try {
      file = await NativeAPI.fileSystem.promises.open(path, 'r');
      const data = Buffer.alloc(length);
      const { bytesRead } = await file.read(data, 0, length, 0);
      return data.subarray(0, bytesRead);
    } catch {
      return null;
    } finally {
      if (file) await file.close().catch(() => {});
    }
  }

  // TimeDateStamp и SizeOfImage из заголовка PE (hex)
  static peHeader(data) {
    if (!data || data.length < 0x40) return null;
    const pe = data.readUInt32LE(0x3c);
    if (pe + 24 + 60 > data.length || data.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
    return {
      timestamp: data.readUInt32LE(pe + 8).toString(16).padStart(8, '0'),
      size: data.readUInt32LE(pe + 24 + 56).toString(16),
    };
  }

  // Адрес кадра; по нему бэкенд находит имя функции
  static frameAddress(rva) {
    return `PW_Game.exe+0x${rva.toString(16).toUpperCase()}`;
  }

  // Короткий текст для Telegram: что случилось и где
  static summary(kind, exitCode, crash, stack, exe) {
    const lines = [];
    if (crash.code) {
      const text = CrashReport.CODE_TEXT[crash.code];
      lines.push(`${crash.code}${text ? ` ${text}` : ''}${crash.detail ? `: ${crash.detail}` : ''}`);
    }
    if (kind !== 'exception') {
      const code = String(exitCode || '');
      const text = CrashReport.CODE_TEXT[code];
      lines.push(`Игра закрылась без окна краша, код выхода ${code || '?'}${text && code !== crash.code ? ` (${text})` : ''}${kind === 'crash' ? ', дампа нет' : ''}`);
    }
    if (exe) lines.push(`exe ${exe.timestamp}`);
    for (const frame of stack.slice(0, CrashReport.SUMMARY_FRAMES)) {
      lines.push(`  ${frame.length > 140 ? `${frame.slice(0, 137)}...` : frame}`);
    }
    return lines.join('\n');
  }

  static async crcDumpsOf(dump) {
    try {
      return (await NativeAPI.fileSystem.promises.readdir(dump.folderPath)).filter((name) => /-crcdump-\d+\.bin$/.test(name)).sort();
    } catch {
      return [];
    }
  }

  // Дамп BinStatsCollector (записи int32 LE): {step, crc, rows: [[путь чанков, значение hex]]}.
  // Поля до 4 байт лежат как есть, длиннее (позиция) — их хэш.
  static parseCrcDump(data) {
    const dump = { step: 0, crc: '', rows: [] };
    const hex = (value) => value.toString(16).toUpperCase().padStart(8, '0');
    const path = [];
    const seen = new Map();
    let offset = 0;
    const next = () => {
      const value = data.readUInt32LE(offset);
      offset += 4;
      return value;
    };
    while (offset + 4 <= data.length) {
      const type = next();
      if (type === 0) {
        if (offset + 8 > data.length) break;
        dump.step = next();
        dump.crc = hex(next());
      } else if (type === 1) {
        if (offset + 12 > data.length) break;
        // идентификатор чанка — один байт, старшие три — мусор выравнивания
        const id = next() & 0xff;
        next();
        const base = [...path, id].join('/');
        const count = seen.get(base) || 0;
        seen.set(base, count + 1);
        dump.rows.push([count ? `${base}#${count}` : base, hex(next())]);
      } else if (type === 2) {
        offset += 8;
      } else if (type === 3) {
        if (offset + 8 > data.length) break;
        path.push(next() & 0xff);
        next();
      } else if (type === 4) {
        path.pop();
      } else {
        break;
      }
    }
    return dump;
  }

  // Строки «Player <ник> with hero <герой> team N ... playerID=M» общего лога (AdventureScreen.cpp)
  static parsePlayers(text) {
    const players = [];
    for (const m of String(text || '').matchAll(/ Player\s+(.*?) with hero (.*?) team (\d+)(?: \(local\))? playerID=(\d+)/g)) {
      players.push({ id: Number(m[4]), nick: m[1].trim().substring(0, 64), hero: m[2].trim().substring(0, 64), team: Number(m[3]) });
    }
    return players;
  }

  // Лог игры — в кодировке системы (NStr::ToMBCS)
  static decodeLog(data) {
    try {
      return new TextDecoder('windows-1251').decode(data);
    } catch {
      return data.toString('latin1');
    }
  }

  // Таблица значений дампа → бэкенд: он сравнит стороны одного боя
  static async sendCrcDump(dump) {
    const fs = NativeAPI.fileSystem;
    const parsed = CrashReport.parseCrcDump(await CrashReport.readTail(dump.path, CrashReport.MAX_DUMP));
    const names = await fs.promises.readdir(dump.folderPath);
    const replay = await CrashReport.findReplay(dump);
    const watching = CrashReport.watchSession && dump.mtime >= CrashReport.watchSince - 60000;
    const session = (watching && CrashReport.watchSession) || (replay && replay.session) || '';
    if (!session) return { skip: 'no session' };
    const output = names.find((name) => /-output\.txt$/.test(name));
    const head = output ? await CrashReport.readHead(NativeAPI.path.join(dump.folderPath, output), CrashReport.PLAYERS_LOG_HEAD) : null;
    return App.api.request('crash', 'crc', {
      name: dump.name,
      session,
      step: parsed.step,
      crc: parsed.crc,
      side: names.some((name) => /-async\.txt$/.test(name)) ? 'bad' : 'good',
      players: head ? CrashReport.parsePlayers(CrashReport.decodeLog(head)) : [],
      rows: parsed.rows,
    });
  }

  // async.txt (HybridServerNodeImpl.cpp WriteAsyncReport) → {step, stepMs, clients: [{client, crc}]}
  static parseAsyncReport(text) {
    const report = { step: 0, stepMs: 0, clients: [] };
    for (const line of String(text || '').split(/\r?\n/)) {
      const value = /^(step|stepMs)=(-?\d+)$/.exec(line);
      if (value) report[value[1]] = Number(value[2]);
      const client = /^client=(\d+) crc=0x([0-9A-Fa-f]{8})$/.exec(line);
      if (client) report.clients.push({ client: Number(client[1]), crc: client[2].toUpperCase() });
    }
    return report;
  }

  // Самотест арифметики процессора (строка fp: в fastfail.log): у разных клиентов должен совпадать
  static fpHash(fastfail) {
    const matches = fastfail ? fastfail.toString('latin1').match(/^fp: .*\bhash=[0-9A-Fa-f]+/gm) : null;
    return matches ? /hash=([0-9A-Fa-f]+)/.exec(matches.at(-1))[1] : '';
  }

  static async exeStamp() {
    const exe = await CrashReport.installedExe();
    return exe ? exe.timestamp : '';
  }

  // Короткий текст о рассинхроне: когда и у кого разошлись суммы
  static asyncSummary(report, exe, fp) {
    const lines = [];
    const seconds = Math.floor((report.step * report.stepMs) / 1000);
    const time = report.stepMs > 0 ? ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} боя)` : '';
    lines.push(`Шаг ${report.step}${time}`);
    const groups = new Map();
    for (const { client, crc } of report.clients) groups.set(crc, [...(groups.get(crc) || []), client]);
    // большинство первым: расходится меньшая группа
    for (const [crc, clients] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`  0x${crc}: клиенты ${clients.join(', ')}`);
    }
    if (exe) lines.push(`exe ${exe}`);
    if (fp) lines.push(`fp ${fp}`);
    return lines.join('\n');
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
    if (dump.kind === 'crcdump') return CrashReport.sendCrcDump(dump);
    const { files, meta } = await CrashReport.collect(dump);
    const tar = CrashReport.tar(files, dump.mtime);

    const begin = await App.api.request('crash', 'begin', { name: dump.name, rawSize: tar.length, session: meta.session, summary: meta.summary });
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

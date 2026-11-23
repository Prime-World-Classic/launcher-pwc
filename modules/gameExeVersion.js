// Версия PW_Game.exe с диска — сверка с App.PW_VERSION до поиска боя и до запуска.
//
// Exe сам сравнивает версию из строки запуска со своей (PW_Client/Game.cpp) и при
// расхождении показывает «Game update has failed! Try to run from web-launcher»:
// бой найден, а игрок в него не попадает. Расхождение бывает, когда лончер
// обновился, а игровая часть нет (обрыв закачки, занятые файлы, повторные сбои
// апдейтера). Бэкенд сверяет только версию лончера, поэтому exe проверяем здесь.
//
// Версия берётся из VS_FIXEDFILEINFO (ресурс VERSIONINFO, Src/Version.rc): там те же
// VERSION_MAJOR/MINOR/PATCH из Version.h, что сравнивает exe.

// Сигнатура VS_FIXEDFILEINFO (0xFEEF04BD, little-endian) и версия структуры 1.0.
const FIXED_FILE_INFO_SIGNATURE = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
const FIXED_FILE_INFO_STRUC_VERSION = 0x00010000;

// 'major.minor.patch' из содержимого exe; null — ресурса версии нет или он битый.
export function parseExeVersion(buffer) {
  if (!buffer || typeof buffer.indexOf !== 'function') return null;
  let pos = buffer.indexOf(FIXED_FILE_INFO_SIGNATURE);
  while (pos >= 0) {
    if (pos + 16 <= buffer.length && buffer.readUInt32LE(pos + 4) === FIXED_FILE_INFO_STRUC_VERSION) {
      const ms = buffer.readUInt32LE(pos + 8);
      const ls = buffer.readUInt32LE(pos + 12);
      return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}`;
    }
    pos = buffer.indexOf(FIXED_FILE_INFO_SIGNATURE, pos + 1);
  }
  return null;
}

// Кэш по размеру и времени изменения: exe 16 МБ, читать его заново на каждую кнопку незачем.
let cache = { key: '', version: null };

// Версия exe по пути или null (файла нет, нет доступа, нет ресурса версии).
export async function readExeVersion(fs, path) {
  try {
    const stat = await fs.promises.stat(path);
    const key = `${stat.size}:${stat.mtimeMs}`;
    if (cache.key === key) return cache.version;
    const version = parseExeVersion(await fs.promises.readFile(path));
    cache = { key, version };
    return version;
  } catch {
    return null;
  }
}

export function resetExeVersionCache() {
  cache = { key: '', version: null };
}

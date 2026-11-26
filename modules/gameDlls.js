// Библиотеки, без которых PW_Game.exe не запускается, — проверка перед боем.
//
// Exe импортирует часть DLL из своей папки Game\Bin (zlib1, ACE, fmod, steam_api…).
// Если такого файла нет (чаще всего его удалил антивирус — так было с zlib1.dll),
// Windows не запускает exe вовсе: бой найден, а игрок в него не попадает. Здесь
// список берётся из таблицы импорта самого exe, а DLL ищутся там же, где их ищет
// загрузчик Windows: папка exe, System32, папка Windows, каталоги из PATH.

// Имена DLL из таблицы импорта PE-файла (обычной и отложенной загрузки), в нижнем
// регистре; null — не PE или таблица битая.
export function parseExeImports(buffer) {
  try {
    if (!buffer || buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) return null;
    const pe = buffer.readUInt32LE(0x3c);
    if (buffer.readUInt32LE(pe) !== 0x4550) return null;
    const sectionCount = buffer.readUInt16LE(pe + 6);
    const optSize = buffer.readUInt16LE(pe + 20);
    const opt = pe + 24;
    const magic = buffer.readUInt16LE(opt);
    const dataDir = opt + (magic === 0x20b ? 112 : 96);
    const sections = [];
    for (let i = 0; i < sectionCount; i++) {
      const s = opt + optSize + i * 40;
      sections.push({
        va: buffer.readUInt32LE(s + 12),
        vsize: buffer.readUInt32LE(s + 8),
        rawSize: buffer.readUInt32LE(s + 16),
        raw: buffer.readUInt32LE(s + 20),
      });
    }
    const toOffset = (rva) => {
      for (const s of sections) {
        if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return rva - s.va + s.raw;
      }
      return -1;
    };
    const readName = (rva) => {
      const at = toOffset(rva);
      if (at < 0) return null;
      const end = buffer.indexOf(0, at);
      return end < 0 ? null : buffer.toString('latin1', at, end);
    };
    const names = new Set();
    // 1 — таблица импорта (20 байт на DLL, имя — 4-е поле), 13 — отложенная загрузка (32 байта, имя — 2-е)
    for (const [index, entrySize, nameField] of [
      [1, 20, 12],
      [13, 32, 4],
    ]) {
      const rva = buffer.readUInt32LE(dataDir + index * 8);
      if (!rva) continue;
      let at = toOffset(rva);
      if (at < 0) return null;
      for (; at + entrySize <= buffer.length; at += entrySize) {
        let empty = true;
        for (let k = 0; k < entrySize; k += 4) {
          if (buffer.readUInt32LE(at + k)) {
            empty = false;
            break;
          }
        }
        if (empty) break;
        const name = readName(buffer.readUInt32LE(at + nameField));
        if (name) names.add(name.toLowerCase());
      }
    }
    return [...names];
  } catch {
    return null;
  }
}

// Кэш по размеру и времени изменения exe.
let cache = { key: '', imports: null };

async function readExeImports(fs, exePath) {
  const stat = await fs.promises.stat(exePath);
  const key = `${stat.size}:${stat.mtimeMs}`;
  if (cache.key !== key) {
    cache = { key, imports: parseExeImports(await fs.promises.readFile(exePath)) };
  }
  return cache.imports;
}

export function resetGameDllsCache() {
  cache = { key: '', imports: null };
}

// Каталоги, где загрузчик Windows ищет DLL после папки exe.
export function systemDllDirs(env = (globalThis.process && globalThis.process.env) || {}) {
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  const dirs = [`${root}\\System32`, root];
  for (const dir of String(env.Path || env.PATH || '').split(';')) {
    if (dir.trim()) dirs.push(dir.trim());
  }
  return dirs;
}

// DLL из импорта exe, которых нет ни в его папке, ни в системных каталогах. Пустой
// список — всё на месте или проверить нечем (нет exe, не удалось прочитать).
export async function findMissingDlls(fs, exePath, binDir, dirs = systemDllDirs()) {
  let imports;
  try {
    imports = await readExeImports(fs, exePath);
  } catch {
    return [];
  }
  if (!imports) return [];
  const exists = async (path) => {
    try {
      await fs.promises.access(path);
      return true;
    } catch {
      return false;
    }
  };
  const missing = [];
  for (const name of imports) {
    // наборы API (api-ms-win-*, ext-ms-*) — виртуальные имена, файлов под ними нет
    if (name.startsWith('api-ms-') || name.startsWith('ext-ms-')) continue;
    let found = await exists(`${binDir}${name}`);
    for (let i = 0; !found && i < dirs.length; i++) {
      found = await exists(`${dirs[i]}\\${name}`);
    }
    if (!found) missing.push(name);
  }
  return missing;
}

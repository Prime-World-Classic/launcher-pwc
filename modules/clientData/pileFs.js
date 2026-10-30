// Файлы игры для лаунчера: те же данные, что читает клиент (pile-архивы Game/Packs),
// без распаковки на диск. Формат — Prime-World PilePack/README.md §2
// (Src/System/FileSystem/FilePileFormat.h, FilePileLoader.cpp):
//   [0] 'Pile' | данные файлов | таблица имён | индекс N × <6I: size, sourceSize, offset,
//   flags, fileNameOffset, crc> | хвост <6I: tag, version, filesNumber, stringsOffset,
//   stringsLength, fileIndexOffset>.
// Таблица имён и индекс обфусцированы SimpleCrypt (каждый своим потоком с нуля),
// хвост — нет. Сжатые записи (flags & 1) — zlib.
//
// Данные игры с 3.0 — только gamedataNNN.pile. Порядок просмотра всё равно как у
// PileFileSystem::ScanForPiles (имена по убыванию без учёта регистра, файл берётся из
// первого pile, где он есть), чтобы лаунчер видел ровно то же, что игра, даже если в
// Packs остался чужой pile. Ключ — путь от Data в нижнем регистре, разделитель '/'.

export const PILE_TAG = 0x656c6950;
export const PILE_VERSION = 0x00010002;
export const PILE_COMPRESSED = 0x0001;
const RECORD = 24; // 6 × UInt32
const CRYPT_BASE = 83;

export function pileCrypt(bytes) {
  const out = new Uint8Array(bytes.length);
  let state = 0;
  for (let i = 0; i < bytes.length; i++) {
    state = (state + CRYPT_BASE) & 0xff;
    out[i] = bytes[i] ^ state;
  }
  return out;
}

export function normalizeKey(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .toLowerCase();
}

// Индекс одного pile: [{ key, size, sourceSize, offset, flags, crc }]
export function parsePileIndex(tail, strings, index) {
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const count = tv.getUint32(8, true);
  const names = pileCrypt(strings);
  const raw = pileCrypt(index);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const decoder = new TextDecoder('utf-8');
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = i * RECORD;
    const nameOffset = view.getUint32(at + 16, true);
    let end = nameOffset;
    while (end < names.length && names[end] !== 0) end++;
    entries.push({
      key: normalizeKey(decoder.decode(names.subarray(nameOffset, end))),
      size: view.getUint32(at, true),
      sourceSize: view.getUint32(at + 4, true),
      offset: view.getUint32(at + 8, true),
      flags: view.getUint32(at + 12, true),
      crc: view.getUint32(at + 20, true),
    });
  }
  return entries;
}

export function readTail(tail) {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  return {
    tag: view.getUint32(0, true),
    version: view.getUint32(4, true),
    count: view.getUint32(8, true),
    stringsOffset: view.getUint32(12, true),
    stringsLength: view.getUint32(16, true),
    indexOffset: view.getUint32(20, true),
  };
}

// Порядок просмотра pile: имена по убыванию без учёта регистра.
export function sortPileNames(names) {
  return [...names].sort((a, b) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? 1 : x > y ? -1 : 0;
  });
}

// Pile-ФС поверх Node fs/zlib (NW.js). Индекс всех pile строится один раз.
export class PileFs {
  constructor({ fs, zlib, path, dir }) {
    this.fs = fs;
    this.zlib = zlib;
    this.path = path;
    this.dir = dir;
    this.files = new Map(); // key -> { file, entry }
    this.piles = []; // [{ name, size, mtimeMs }]
  }

  async open() {
    const fsp = this.fs.promises;
    const names = sortPileNames((await fsp.readdir(this.dir)).filter((name) => /\.pile$/i.test(name)));
    for (const name of names) {
      const file = this.path.join(this.dir, name);
      try {
        const entries = await this.readIndex(file);
        const stat = await fsp.stat(file);
        this.piles.push({ name, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
        for (const entry of entries) {
          if (!this.files.has(entry.key)) this.files.set(entry.key, { file, entry });
        }
      } catch (error) {
        // как ScanForPiles: битый pile пропускается, остальные читаются
        console.warn(`PileFs: не прочитан ${name}`, error);
      }
    }
    return this;
  }

  async readIndex(file) {
    const handle = await this.fs.promises.open(file, 'r');
    try {
      const { size } = await handle.stat();
      const tail = await this.readRange(handle, size - RECORD, RECORD);
      const info = readTail(tail);
      if (info.tag !== PILE_TAG || info.version !== PILE_VERSION) throw new Error('не pile');
      if (info.indexOffset + info.count * RECORD + RECORD !== size) throw new Error('индекс не сходится с размером');
      const strings = await this.readRange(handle, info.stringsOffset, info.stringsLength);
      const index = await this.readRange(handle, info.indexOffset, info.count * RECORD);
      return parsePileIndex(tail, strings, index);
    } finally {
      await handle.close();
    }
  }

  async readRange(handle, position, length) {
    const buffer = new Uint8Array(length);
    let done = 0;
    while (done < length) {
      const { bytesRead } = await handle.read(buffer, done, length - done, position + done);
      if (!bytesRead) throw new Error('файл короче индекса');
      done += bytesRead;
    }
    return buffer;
  }

  async list(prefix = '') {
    const want = normalizeKey(prefix);
    return [...this.files.keys()].filter((key) => key.startsWith(want));
  }

  // Подпись набора pile: меняется при любом обновлении игровых данных.
  signature() {
    return this.piles.map((pile) => `${pile.name}:${pile.size}:${pile.mtimeMs}`).join('|');
  }

  async read(key) {
    const item = this.files.get(normalizeKey(key));
    if (!item) return null;
    const handle = await this.fs.promises.open(item.file, 'r');
    try {
      const blob = await this.readRange(handle, item.entry.offset, item.entry.size);
      if (!(item.entry.flags & PILE_COMPRESSED)) return blob;
      return new Uint8Array(this.zlib.inflateSync(blob));
    } finally {
      await handle.close();
    }
  }
}

// Dev-режим (Vite): несжатая папка Data, которую отдаёт vite.config.js по /__pwdata/.
// Список файлов каталога (рекурсивно) — /__pwdata/__list?prefix=...
export class HttpDataFs {
  constructor(base = '/__pwdata/') {
    this.base = base;
    this.lists = new Map();
  }

  async open() {
    const response = await fetch(`${this.base}__list?prefix=GameLogic/`);
    if (!response.ok) throw new Error(`HttpDataFs: ${response.status}`);
    return this;
  }

  async list(prefix = '') {
    const want = normalizeKey(prefix);
    if (!this.lists.has(want)) {
      this.lists.set(
        want,
        fetch(`${this.base}__list?prefix=${encodeURIComponent(want)}`)
          .then((response) => (response.ok ? response.json() : []))
          .then((keys) => keys.map(normalizeKey)),
      );
    }
    return this.lists.get(want);
  }

  signature() {
    return 'dev';
  }

  // persistentId -> ключ файла одним запросом (vite.config.js, /__pwdata/__pids)
  async persistentIds(prefix, pattern) {
    const response = await fetch(`${this.base}__pids?prefix=${encodeURIComponent(prefix)}&pattern=${encodeURIComponent(pattern.source)}`);
    if (!response.ok) return null;
    return new Map(Object.entries(await response.json()).map(([pid, key]) => [pid, normalizeKey(key)]));
  }

  async read(key) {
    const response = await fetch(this.base + normalizeKey(key).split('/').map(encodeURIComponent).join('/'));
    if (!response.ok || response.status === 204) return null; // 204 — файла нет
    return new Uint8Array(await response.arrayBuffer());
  }
}

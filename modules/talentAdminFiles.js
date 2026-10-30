// Чистые функции для админки талантов: точечная правка content/lang/*.js,
// разбор названия таланта (имя + стоимость/КД), запись talent_data/*.json.
// Без DOM и без fs — запись на диск делает talentAdmin.js через NativeAPI.

// ---------- lang/*.js ----------

// Ищет запись `key: '…'` (значение на той же или следующей строке, кавычки ' или ").
export function findLangEntry(text, key) {
  const re = new RegExp(`^([ \\t]*)${key}:[ \\t]*(?:\\r?\\n[ \\t]*)?(['"])`, 'm');
  const match = re.exec(text);

  if (!match) {
    return null;
  }

  const quote = match[2];
  const literalStart = match.index + match[0].length - 1;
  let i = literalStart + 1;

  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      // \ + перевод строки — продолжение строки в JS, в значение не входит
      i += text[i + 1] === '\r' && text[i + 2] === '\n' ? 3 : 2;
      continue;
    }
    if (c === quote) {
      return { indent: match[1], quote, lineStart: match.index, literalStart, literalEnd: i + 1 };
    }
    if (c === '\n') {
      break;
    }
    i++;
  }

  throw new Error(`lang: не найден конец строки у ${key}`);
}

// Все записи `key: '…'` файла за один проход → { key: значение }.
export function readLangWords(text) {
  const words = {};
  const re = /^[ \t]*([A-Za-z0-9_]+):[ \t]*(?:\r?\n[ \t]*)?(['"])/gm;
  let match;

  while ((match = re.exec(text))) {
    const quote = match[2];
    const start = match.index + match[0].length - 1;
    let i = start + 1;

    while (i < text.length && text[i] !== quote && text[i] !== '\n') {
      i += text[i] === '\\' ? (text[i + 1] === '\r' && text[i + 2] === '\n' ? 3 : 2) : 1;
    }

    if (text[i] === quote) {
      words[match[1]] = unescapeJsString(text.slice(start, i + 1));
      re.lastIndex = i + 1;
    }
  }

  return words;
}

export function escapeJsString(value, quote) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(quote, 'g'), `\\${quote}`)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

const SIMPLE_ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' };

// Значение строкового литерала (вместе с кавычками) — как его прочитает JS.
export function unescapeJsString(literal) {
  return literal
    .slice(1, -1)
    .replace(/\\(\r\n|\n|x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|[\s\S])/g, (m, c) => {
      if (c === '\r\n' || c === '\n') return '';
      if (c in SIMPLE_ESCAPES) return SIMPLE_ESCAPES[c];
      if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
      if (c[0] === 'u' && c.length > 1) return String.fromCodePoint(parseInt(c.replace(/[u{}]/g, ''), 16));
      return c;
    });
}

// Ставит значение ключа. Нет ключа — вставляет новую строку после первого найденного anchor.
export function setLangValue(text, key, value, anchors = []) {
  const entry = findLangEntry(text, key);

  if (entry) {
    // То же значение — файл не трогаем (в том числе исходную разбивку строки).
    if (unescapeJsString(text.slice(entry.literalStart, entry.literalEnd)) === String(value)) {
      return text;
    }

    const literal = entry.quote + escapeJsString(value, entry.quote) + entry.quote;
    return text.slice(0, entry.literalStart) + literal + text.slice(entry.literalEnd);
  }

  for (const anchor of anchors) {
    const found = findLangEntry(text, anchor);
    if (!found) continue;

    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lineEnd = text.indexOf('\n', found.literalEnd);
    const insertAt = lineEnd < 0 ? text.length : lineEnd + 1;
    const line = `${found.indent}${key}: '${escapeJsString(value, "'")}',${eol}`;

    return text.slice(0, insertAt) + line + text.slice(insertAt);
  }

  throw new Error(`lang: некуда вставить ${key}`);
}

// Поднимает ?v= у модуля в importmap index.html, чтобы клиенты не взяли старый файл из кэша.
export function bumpImportVersion(html, modulePath, stamp) {
  const re = new RegExp(`("${modulePath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\?v=)[^"]*`, 'g');
  return html.replace(re, `$1${stamp}`);
}

// ---------- название таланта ----------

// Название = имя + разделитель + хвост с разметкой игры: стоимость (<mana>, <lifecost>, «20<detail>»)
// и перезарядка (<CD>, варианты <mag>…<CD></CD></mag>/<fiz>…). title + sep + tail === исходная строка.
export function splitTalentName(raw) {
  const text = String(raw || '');
  const match = text.match(/^([\s\S]*?)(\d+(?:\.\d+)?<detail>[\s\S]*|<[\s\S]*)$/);

  if (!match) {
    return { title: text, sep: null, tail: '' };
  }

  const title = match[1].replace(/[\s|/]+$/, '');
  return { title, sep: match[1].slice(title.length), tail: match[2] };
}

export function composeTalentName({ title, sep, tail }) {
  if (!tail) return title;
  // sep null — хвоста раньше не было: отделяем пробелом; иначе как в исходной строке («Имя<CD>60</CD>»).
  return title + (sep ?? (title ? ' ' : '')) + tail;
}

export function parseCosts(tail) {
  const all = (re) => [...String(tail || '').matchAll(re)].map((m) => m[1] ?? m[2]).filter((v) => v !== undefined && v !== '');

  return {
    mana: all(/<mana>\s*([\d.]+)\s*<\/mana>/g),
    life: all(/<lifecost>\s*([\d.]+)\s*<\/lifecost>/g),
    detail: all(/([\d.]+)\s*<detail>/g),
    cd: all(/<CD>\s*([\d.]+)\s*<\/CD>|([\d.]+)\s*<CD>\s*<\/CD>/g),
  };
}

// Простой хвост: [<white>] [<mana|lifecost>N</…>] [<CD>N</CD>] [</white>] — правится полями.
// Остальное (варианты mag/fiz, детали, «Гррр») — только разметкой.
export function parseSimpleTail(tail) {
  const text = String(tail || '').trim();

  if (!text) {
    return { white: false, type: '', cost: '', cd: '' };
  }

  const match = text.match(/^(<white>)?\s*(?:<(mana|lifecost)>\s*([\d.]+)\s*<\/\2>)?\s*(?:<CD>\s*([\d.]+)\s*<\/CD>)?\s*(<\/white>)?$/);

  if (!match || Boolean(match[1]) !== Boolean(match[5]) || (!match[2] && !match[4])) {
    return null;
  }

  return { white: Boolean(match[1]), type: match[2] || '', cost: match[3] || '', cd: match[4] || '' };
}

export function buildSimpleTail({ white, type, cost, cd }) {
  const parts = [];
  if (type && String(cost).trim() !== '') parts.push(`<${type}>${String(cost).trim()}</${type}>`);
  if (String(cd).trim() !== '') parts.push(`<CD>${String(cd).trim()}</CD>`);
  if (!parts.length) return '';
  return white ? `<white> ${parts.join(' ')}</white>` : parts.join(' ');
}

// ---------- talent_data/*.json ----------

export function parseStatsString(value, index) {
  if (!value) {
    return value;
  }

  const result = {};

  for (const item of String(value).split(';')) {
    const split = item.split(',');
    result[split[2]] = split[index];
  }

  return result;
}

// Запись talents.json / hero_talents.json — тот же вид, что у stats.js talent-data.
export function talentDataEntry(kind, fields) {
  if (kind === 'hero') {
    return { params: fields.params == null ? '' : String(fields.params) };
  }

  return {
    txtNum: fields.descriptionStat == null ? '' : String(fields.descriptionStat),
    stats: parseStatsString(fields.stats, 0),
    statsRefine: parseStatsString(fields.stats, 1),
  };
}

// Обратно: из записи файла — строка «значение,заточка,стат;…» для редактора.
export function statsStringFromEntry(entry) {
  if (!entry || !entry.stats || typeof entry.stats !== 'object') {
    return '';
  }

  return Object.keys(entry.stats)
    .map((key) => `${entry.stats[key]},${entry.statsRefine?.[key] ?? 0},${key}`)
    .join(';');
}

export function formatTalentDataJson(data, eol = '\n') {
  return JSON.stringify(data, null, 2).replace(/\n/g, eol);
}

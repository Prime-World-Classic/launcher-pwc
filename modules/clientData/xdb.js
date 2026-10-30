// Разбор .xdb (XML редактора PF_Editor) без DOM: узел = { tag, attrs, children, text }.
// В xdb нет CDATA и пространств имён; сущности — стандартные пять и &#N;.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(text) {
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name] ?? match;
  });
}

export function decodeText(bytes) {
  if (typeof bytes === 'string') return bytes;
  // .txt игры — UTF-16 LE с BOM, .xdb — UTF-8 с BOM
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  return new TextDecoder('utf-8').decode(bytes);
}

export function parseXml(source) {
  const xml = decodeText(source);
  const root = { tag: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  const attrRe = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let last = 0;
  let match;
  while ((match = tagRe.exec(xml))) {
    if (match.index > last) stack[stack.length - 1].text += xml.slice(last, match.index);
    last = tagRe.lastIndex;
    if (!match[2]) continue; // <?xml?> / комментарий
    if (match[1]) {
      const node = stack.pop();
      node.text = decodeEntities(node.text);
      continue;
    }
    const attrs = {};
    let attr;
    attrRe.lastIndex = 0;
    while ((attr = attrRe.exec(match[3]))) attrs[attr[1]] = decodeEntities(attr[2] ?? attr[3] ?? '');
    const node = { tag: match[2], attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!match[4]) stack.push(node);
  }
  return root.children[0] || null;
}

export function child(node, tag) {
  if (!node) return null;
  for (const item of node.children) if (item.tag === tag) return item;
  return null;
}

// путь вида 'var/sString'
export function at(node, path) {
  let current = node;
  for (const tag of path.split('/')) {
    current = child(current, tag);
    if (!current) return null;
  }
  return current;
}

export function textAt(node, path, fallback = '') {
  const found = at(node, path);
  return found ? found.text.trim() : fallback;
}

// Элементы списка <list><Item>...</Item></list>
export function items(node, tag) {
  const list = tag ? child(node, tag) : node;
  return list ? list.children.filter((item) => item.tag === 'Item') : [];
}

// Содержимое ссылочного поля: встроенный объект (первый дочерний элемент) или href на файл.
// Возвращает { node, href } — node === null, если объект в отдельном файле.
export function refOf(field) {
  if (!field) return { node: null, href: '' };
  const inline = field.children.find((item) => item.tag !== 'BackLink');
  return { node: inline || null, href: field.attrs.href || '' };
}

// DBID ('/Items/Talents/X.TALENT', возможно с ':id') -> ключ файла в Data
export function dbidToKey(href) {
  const path = String(href || '').split(':')[0].replace(/^\/+/, '');
  if (!path) return '';
  return /\.xdb$/i.test(path) ? path : `${path}.xdb`;
}

// textref ('/Items/.../X_name.txt') -> ключ файла текста нужного языка (_en рядом с ru)
export function textrefToKey(textref, lang = 'ru') {
  const path = String(textref || '').replace(/^\/+/, '');
  if (!path) return '';
  return lang === 'ru' ? path : path.replace(/\.txt$/i, `_${lang}.txt`);
}

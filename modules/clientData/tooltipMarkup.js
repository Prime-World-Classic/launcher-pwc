// Разметка подсказок игры -> HTML. Повторяет клиент:
//   UI::SubstituteText        — $(id): макросы UIRoot/substitutes и свои (commonDescription);
//   PrecompiledTooltips.cpp   — <value=путь format=W.D>, <if=путь>…<else>…</if>;
//   UI-текст                  — <style:имя>…</style>, <image:имя fit=… spaceb=…>, <br>, <br:N>,
//                               <space:N>, <atom>, <f_right>, <left>/<center>/<right>.
// Перевод строки в тексте игры — пробел (строки разбивает только <br>).
// Лаунчер — «замок», а не бой: содержимое <castle> показываем, <session> — нет.

const MACRO_DEPTH = 8;

export function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

export function substituteMacros(text, macros, depth = 0) {
  if (depth > MACRO_DEPTH || text.indexOf('$(') === -1) return text;
  return text.replace(/\$\(([A-Za-z0-9_]+)\)/g, (match, id) => (id in macros ? substituteMacros(String(macros[id] ?? ''), macros, depth + 1) : ''));
}

// Формат значения как NNameMap::ReadonlyVariant::Format: «W.D» — ширина и знаков после
// запятой (по умолчанию 0), лишние нули справа отбрасываются; ведущий «+» — всегда знак.
export function formatValue(value, format = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (!Number.isFinite(value)) return '';
  let forceSign = false;
  let digits = 0;
  const m = /^([+]?)(\d*)(?:\.(\d+))?/.exec(String(format || ''));
  if (m) {
    forceSign = m[1] === '+';
    digits = m[3] ? Math.min(Number(m[3]), 6) : 0;
  }
  let text = value.toFixed(digits);
  if (text.indexOf('.') !== -1) text = text.replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0') text = '0';
  if (forceSign && value >= 0) text = `+${text}`;
  return text;
}

// --- Токены ------------------------------------------------------------------------------

export function tokenizeMarkup(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('<', i);
    if (open === -1) {
      tokens.push({ kind: 'text', text: text.slice(i) });
      break;
    }
    if (open > i) tokens.push({ kind: 'text', text: text.slice(i, open) });
    const close = text.indexOf('>', open);
    if (close === -1) {
      tokens.push({ kind: 'text', text: text.slice(open) });
      break;
    }
    tokens.push(parseTag(text.slice(open + 1, close)));
    i = close + 1;
  }
  return tokens;
}

// Токены первого прохода (PrecompiledTooltip): только <value>, <if>, <else>, </if>;
// остальная разметка — текст для второго прохода.
function tokenizePrecompile(text) {
  const tokens = [];
  const re = /<(value\s*=[^>]*|if\s*=[^>]*|else|\/if)\s*>/gi;
  let last = 0;
  let match;
  while ((match = re.exec(text))) {
    if (match.index > last) tokens.push({ kind: 'text', text: text.slice(last, match.index) });
    const tag = parseTag(match[1]);
    tokens.push(tag.kind === 'close' ? { kind: 'close', name: 'if' } : tag);
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) });
  return tokens;
}

function parseTag(body) {
  const trimmed = body.trim();
  if (trimmed[0] === '/') return { kind: 'close', name: trimmed.slice(1).trim().toLowerCase() };
  const head = /^([A-Za-z_]+)\s*([=:])?/.exec(trimmed);
  if (!head) return { kind: 'text', text: `<${body}>` };
  const name = head[1].toLowerCase();
  let rest = trimmed.slice(head[0].length);
  const sep = head[2] || '';
  let value = '';
  if (sep) {
    // значение до пробела вне скобок/вложенных тегов
    let depth = 0;
    let end = 0;
    for (; end < rest.length; end++) {
      const ch = rest[end];
      if (ch === '(' || ch === '<') depth++;
      else if (ch === ')' || ch === '>') depth--;
      else if (/\s/.test(ch) && depth <= 0) break;
    }
    value = rest.slice(0, end);
    rest = rest.slice(end);
  }
  const params = {};
  for (const m of rest.matchAll(/([A-Za-z_]+)\s*=\s*("[^"]*"|[^\s]+)/g)) params[m[1].toLowerCase()] = m[2].replace(/^"|"$/g, '');
  return { kind: 'tag', name, sep, value, params };
}

// --- Дерево <if> -------------------------------------------------------------------------

function buildTree(tokens) {
  const root = { kind: 'seq', items: [] };
  const stack = [{ node: root, target: root.items }];
  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token.kind === 'tag' && token.name === 'if') {
      const node = { kind: 'if', cond: token.value, then: [], else: null };
      top.target.push(node);
      stack.push({ node, target: node.then });
    } else if (token.kind === 'tag' && token.name === 'else' && top.node.kind === 'if') {
      top.node.else = [];
      top.target = top.node.else;
    } else if (token.kind === 'close' && token.name === 'if' && top.node.kind === 'if') {
      stack.pop();
    } else {
      top.target.push(token);
    }
  }
  return root.items;
}

// --- Вывод -------------------------------------------------------------------------------

// Первый проход: макросы, <if>, <value> -> строка разметки UI.
// Строковое значение (talent.rarityName = '<style:TT_talent_rar_2>') вставляется как есть —
// это разметка для второго прохода, как в игре.
export function precompileMarkup(text, env, macros = {}) {
  const source = substituteMacros(String(text ?? ''), macros);
  let out = '';
  const walk = (list) => {
    for (const item of list) {
      if (item.kind === 'if') {
        const cond = env.cond(item.cond.trim());
        if (cond === null || cond === undefined) continue;
        if (cond) walk(item.then);
        else if (item.else) walk(item.else);
      } else if (item.kind === 'tag' && item.name === 'value') {
        const result = env.value(item.value, item.params);
        if (result !== null && result !== undefined) out += formatValue(result, item.params.format);
      } else if (item.kind === 'text') out += item.text;
    }
  };
  walk(buildTree(tokenizePrecompile(source)));
  return out;
}

// env:
//   cond(path)            -> true | false | null (null — нет такого условия: как в игре, ни одна ветка)
//   value(path, params)   -> число | строка | null
//   styleClass(name)      -> CSS-класс стиля шрифта
//   image(name, params)   -> HTML картинки или ''
export function renderMarkup(text, env, macros = {}) {
  return renderUiMarkup(precompileMarkup(text, env, macros), env);
}

// Второй проход: UI-разметка -> HTML
export function renderUiMarkup(text, env) {
  const out = new Output(env);
  for (const token of tokenizeMarkup(text)) out.token(token);
  return out.finish();
}

class Output {
  constructor(env) {
    this.env = env;
    this.html = '';
    this.open = []; // стек открытых span: 'style' | 'atom' | 'right'
    this.align = '';
    this.hideDepth = 0; // внутри <session>
    this.pendingSpace = false;
  }

  emitText(text) {
    if (this.hideDepth) return;
    const collapsed = text.replace(/\s+/g, ' ');
    if (!collapsed) return;
    let body = collapsed;
    if (body.startsWith(' ')) {
      this.pendingSpace = true;
      body = body.slice(1);
    }
    const trailing = body.endsWith(' ');
    if (trailing) body = body.slice(0, -1);
    if (body) {
      if (this.pendingSpace && !this.atLineStart()) this.html += ' ';
      this.html += escapeHtml(body);
      this.pendingSpace = false;
    }
    if (trailing) this.pendingSpace = true;
  }

  atLineStart() {
    return this.html === '' || /(<br class="pw-tt-br">|<div[^>]*>|<span class="pw-tt-gap"[^>]*><\/span>)$/.test(this.html);
  }

  raw(html) {
    if (this.hideDepth) return;
    if (this.pendingSpace && !this.atLineStart()) this.html += ' ';
    this.pendingSpace = false;
    this.html += html;
  }

  closeUntil(kind) {
    const index = this.open.lastIndexOf(kind);
    if (index === -1) return;
    while (this.open.length > index) {
      this.open.pop();
      this.html += '</span>';
    }
  }

  closeRight() {
    if (this.open.includes('right')) this.closeUntil('right');
  }

  lineBreak(gap = 0) {
    this.closeRight();
    this.pendingSpace = false;
    if (gap) this.html += `<span class="pw-tt-gap" style="--pw-tt-gap:${Math.min(gap, 100) / 100}"></span>`;
    else this.html += '<br class="pw-tt-br">';
  }

  setAlign(align) {
    if (this.align === align) return;
    this.closeRight();
    const stack = [...this.open];
    for (let i = 0; i < stack.length; i++) this.html += '</span>';
    if (this.align) this.html += '</div>';
    this.align = align;
    this.html += `<div class="pw-tt-${align}">`;
    for (const kind of stack) this.html += kind === 'atom' ? '<span class="pw-tt-atom">' : '<span>';
    this.pendingSpace = false;
  }

  token(token) {
    if (token.kind === 'text') return this.emitText(token.text);
    if (token.kind === 'close') {
      if (this.hideDepth && token.name !== 'session') return;
      switch (token.name) {
        case 'style':
          return this.closeUntil('style');
        case 'atom':
          this.closeRight();
          return this.closeUntil('atom');
        case 'session':
          this.hideDepth = Math.max(0, this.hideDepth - 1);
          return;
        case 'cd':
          this.html += '</cd>';
          return;
        default:
          return; // </castle>, </nocompile>, </f_right> …
      }
    }
    const { name, value, params } = token;
    if (this.hideDepth && name !== 'session') return;
    switch (name) {
      case 'style': {
        this.raw('');
        this.html += `<span class="${this.env.styleClass(value)}">`;
        this.open.push('style');
        return;
      }
      case 'image': {
        const html = this.env.image(value, params);
        if (html) this.raw(html);
        return;
      }
      case 'cd':
        // откат таланта: число внутри пересчитывает лаунчер (сеты, «Откат талантов»)
        this.raw('<cd>');
        return;
      case 'br': {
        if (this.hideDepth) return;
        return this.lineBreak(token.sep === ':' ? Number(value) || 0 : 0);
      }
      case 'space':
        return this.raw(`<span class="pw-tt-space" style="--pw-tt-space:${Number(value) || 1}"></span>`);
      case 'atom':
        this.raw('');
        this.html += '<span class="pw-tt-atom">';
        this.open.push('atom');
        return;
      case 'f_right':
        this.closeRight();
        this.raw('');
        this.html += '<span class="pw-tt-right">';
        this.open.push('right');
        return;
      case 'left':
      case 'center':
      case 'right':
        return this.setAlign(name);
      case 'session':
        this.hideDepth++;
        return;
      default:
        return; // castle, nocompile, else вне if и прочие служебные
    }
  }

  finish() {
    while (this.open.length) {
      this.open.pop();
      this.html += '</span>';
    }
    if (this.align) this.html += '</div>';
    return this.html
      .replace(/(<br class="pw-tt-br">)+$/g, '')
      .replace(/^(<br class="pw-tt-br">|<span class="pw-tt-gap"[^>]*><\/span>)+/g, '');
  }
}

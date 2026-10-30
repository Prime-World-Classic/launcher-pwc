// Иконки интерфейса вместо эмодзи: эмодзи есть не во всех ОС (Win7/8, ранняя Win10, Wine) —
// там вместо них квадраты. Картинки лежат в content/icons/ui, стили — .ui-icon в main.css.
// Монохромные иконки красятся цветом текста (CSS mask), остальные — цветные картинки.
const MONO = new Set([
  'check',
  'cross',
  'send',
  'pin',
  'phone',
  'sound-on',
  'sound-off',
  'mic',
  'mic-off',
  'clock',
  'stopwatch',
  'refresh',
  'gear',
  'copy',
]);

export function uiIconClass(name) {
  return `ui-icon ui-icon-${name}${MONO.has(name) ? ' ui-icon-mono' : ''}`;
}

// Разметка для шаблонов, которые идут в innerHTML.
export function uiIconHtml(name, title = '') {
  const titleAttr = title ? ` title="${String(title).replace(/"/g, '&quot;')}"` : '';
  return `<span class="${uiIconClass(name)}"${titleAttr} aria-hidden="${title ? 'false' : 'true'}"></span>`;
}

// DOM-элемент для кода, который собирает узлы вручную.
export function uiIcon(name, title = '') {
  const el = document.createElement('span');
  el.className = uiIconClass(name);
  if (title) {
    el.title = title;
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
  return el;
}

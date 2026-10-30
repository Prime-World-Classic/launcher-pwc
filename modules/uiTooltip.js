// Фирменные подсказки вместо стандартных подсказок браузера (атрибут title).
// Вид — как у кнопок замка («Боевой режим»): тёмная плашка с бирюзовой рамкой.
// Работает во всём лаунчере: при наведении title элемента переносится в data-tip,
// поэтому серая подсказка браузера не появляется.
// Можно добавить картинку, заголовок и доп. строку: data-tip-icon (адрес картинки), data-tip-title,
// data-tip-note — тогда подсказка выглядит как описание таланта в билде.
// Элементы с CSS-подсказкой data-tooltip (замок, билды) не трогаем — у них своя.
export class UiTooltip {
  static ready = false;

  static node = null;

  static target = null;

  static init() {
    if (UiTooltip.ready || typeof document === 'undefined') {
      return;
    }

    UiTooltip.ready = true;

    document.addEventListener('pointerover', (e) => UiTooltip.over(e), true);

    document.addEventListener('pointerout', (e) => UiTooltip.out(e), true);

    document.addEventListener('pointerdown', () => UiTooltip.hide(), true);

    document.addEventListener('wheel', () => UiTooltip.hide(), { capture: true, passive: true });

    window.addEventListener('blur', () => UiTooltip.hide());
  }

  static over(e) {
    const el = e.target?.closest?.('[title], [data-tip]');

    if (!el || el.hasAttribute('data-tooltip')) {
      return;
    }

    // title — в data-tip, чтобы не было стандартной подсказки
    if (el.hasAttribute('title')) {
      const text = el.getAttribute('title');

      el.removeAttribute('title');

      if (text) {
        el.dataset.tip = text;
      }
    }

    if (!el.dataset.tip && !el.dataset.tipTitle && !el.dataset.tipNote) {
      return;
    }

    if (UiTooltip.target !== el) {
      UiTooltip.show(el);
    }
  }

  static out(e) {
    if (UiTooltip.target && !UiTooltip.target.contains(e.relatedTarget)) {
      UiTooltip.hide();
    }
  }

  static show(el) {
    UiTooltip.target = el;

    if (!UiTooltip.node) {
      UiTooltip.node = document.createElement('div');

      UiTooltip.node.className = 'ui-tip';

      document.body.append(UiTooltip.node);
    }

    const node = UiTooltip.node,
      body = document.createElement('div');

    node.replaceChildren();

    if (el.dataset.tipIcon) {
      const icon = document.createElement('img');

      icon.className = 'ui-tip-icon';

      icon.src = el.dataset.tipIcon;

      node.append(icon);
    }

    body.className = 'ui-tip-body';

    if (el.dataset.tipTitle) {
      const title = document.createElement('div');

      title.className = 'ui-tip-title';

      title.textContent = el.dataset.tipTitle;

      body.append(title);
    }

    if (el.dataset.tip) {
      const text = document.createElement('div');

      text.className = 'ui-tip-text';

      text.textContent = el.dataset.tip;

      body.append(text);
    }

    // дополнительная строка (зелёная, как подсказки в описании билда)
    if (el.dataset.tipNote) {
      const note = document.createElement('div');

      note.className = 'ui-tip-note';

      note.textContent = el.dataset.tipNote;

      body.append(note);
    }

    node.append(body);

    node.classList.toggle('ui-tip-rich', !!(el.dataset.tipIcon || el.dataset.tipTitle || el.dataset.tipNote));

    node.style.display = 'flex';

    UiTooltip.place(el);
  }

  // Над элементом по центру; если сверху нет места — под ним; не выходит за края окна
  static place(el) {
    const node = UiTooltip.node,
      r = el.getBoundingClientRect(),
      t = node.getBoundingClientRect(),
      gap = Math.max(6, innerHeight * 0.011);

    let top = r.top - t.height - gap;

    if (top < 4) {
      top = r.bottom + gap;
    }

    const left = Math.min(Math.max(4, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 4);

    node.style.left = `${Math.round(left)}px`;

    node.style.top = `${Math.round(Math.min(top, innerHeight - t.height - 4))}px`;
  }

  static hide() {
    UiTooltip.target = null;

    if (UiTooltip.node) {
      UiTooltip.node.style.display = 'none';
    }
  }
}

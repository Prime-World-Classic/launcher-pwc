// Мышь в окне билда: наведение на талант (подсказка, сет, ряд, куда встанет), перенос
// (библиотека <-> поле <-> панель активных), клики (быстрая установка/снятие), ПКМ и смарткаст.
// Обработчики — на поле, библиотеке и панели, а не на каждой иконке.

import { Castle } from '../castle.js';
import { Lang } from '../lang.js';
import { DOM } from '../dom.js';
import { TalentData } from '../talentData.js';
import { activeTarget, activeIndexOf } from './grid.js';
import { animateMove } from './anim.js';

const CLICK_MS = 200;
const CLICK_DISTANCE = 6;
const LIBRARY_CLICK_COOLDOWN_MS = 50;
const SET_HOVER_DELAY_MS = 30;

const inside = (rect, x, y) => x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;

export class TalentInput {
  constructor(ed) {
    this.ed = ed;
    this.hovered = null;
    this.drag = null;
    this.suppressedUntil = 0;
    this.lastLibraryClick = 0;
  }

  attach() {
    const ed = this.ed;
    for (const root of [ed.fieldView, ed.library.list, ed.activeBarView]) {
      root.addEventListener('mouseover', (e) => this.over(e));
      root.addEventListener('mouseout', (e) => this.out(e));
      root.addEventListener('mousedown', (e) => this.down(e));
      root.addEventListener('touchstart', (e) => this.over(e), { passive: true });
      root.addEventListener('touchend', (e) => this.out(e));
    }
    ed.fieldView.addEventListener('click', (e) => this.fieldClick(e));
    ed.fieldView.addEventListener('contextmenu', (e) => this.fieldMenu(e));
    ed.activeBarView.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const slot = e.target.closest('.build-active-bar-item');
      if (slot) ed.toggleSmartcast(Number(slot.dataset.index));
    });
    ed.activeBarView.addEventListener('mousemove', (e) => this.smartcastTip(e));
    ed.activeBarView.addEventListener('mouseleave', () => this.smartcastTip(null));
  }

  talentOf(node) {
    return this.ed.talents.get(Number(node?.dataset.id)) || null;
  }

  // --- Наведение ----------------------------------------------------------------------------

  over(e) {
    const node = e.target.closest?.('.build-talent-item');
    if (!node || node === this.hovered) return;
    this.enter(node);
  }

  out(e) {
    const node = e.target.closest?.('.build-talent-item');
    if (!node || (e.relatedTarget && node.contains(e.relatedTarget))) return;
    if (this.hovered === node) this.leave(node);
  }

  enter(node) {
    const ed = this.ed;
    this.hovered = node;
    const talent = this.talentOf(node);
    const library = node.dataset.state == 1;
    if (Date.now() < this.suppressedUntil || this.drag || !talent) return ed.tooltip.hide();
    if (library && ed.library.hoverSuppressed) return;
    if (library) {
      // подсветка сета и ряда у библиотеки — с задержкой: быстрый проход мышью не тормозит
      clearTimeout(this.setHoverTimer);
      this.setHoverTimer = setTimeout(() => {
        if (this.hovered !== node || this.drag || !node.isConnected || ed.library.hoverSuppressed) return;
        const set = ed.highlight.talentSet(talent);
        ed.highlight.showRow(talent.level);
        if (!set) ed.highlight.previewTalent(talent);
      }, SET_HOVER_DELAY_MS);
      requestAnimationFrame(() => this.hovered === node && ed.tooltip.showTalent(node, talent));
      return;
    }
    ed.highlight.talentSet(talent);
    ed.tooltip.showTalent(node, talent);
  }

  leave(node) {
    const ed = this.ed;
    this.hovered = null;
    clearTimeout(this.setHoverTimer);
    ed.tooltip.hide();
    ed.highlight.clearRow();
    if (!ed.highlight.hoveredSet) ed.highlight.clearSet();
    if (node.dataset.state == 1) ed.highlight.clearPreviews();
  }

  // подсказка таланта под курсором (после прокрутки, переноса)
  hoverAt(point) {
    if (!point || this.drag) return;
    const node = document.elementFromPoint(point.x, point.y)?.closest?.('.build-talent-item');
    if (node && this.ed.talents.has(Number(node.dataset.id))) {
      this.hovered = null;
      this.enter(node);
    }
  }

  // --- Клики --------------------------------------------------------------------------------

  // боевой режим: ЛКМ по таланту поля — изучить / откатить до него
  fieldClick(e) {
    const ed = this.ed;
    const node = e.target.closest('.build-talent-item');
    if (!ed.combat || !node || node.dataset.state != 2) return;
    e.preventDefault();
    e.stopPropagation();
    if (ed.combat.click(Number(node.parentElement.dataset.position))) ed.combatChanged();
  }

  // ПКМ по таланту поля: боевой режим — снять изученный; иначе активный — на свободную кнопку панели
  fieldMenu(e) {
    const ed = this.ed;
    const node = e.target.closest('.build-talent-item');
    if (!node || node.dataset.state != 2) return;
    const slot = Number(node.parentElement.dataset.position);
    if (ed.combat) {
      if (ed.combat.remove(slot)) {
        e.preventDefault();
        ed.combatChanged();
      }
      return;
    }
    if (ed.addToFreeActive(slot)) e.preventDefault();
  }

  // переключатель смарткаста — правый нижний угол кнопки панели (36% ширины и высоты)
  overSmartcast(slot, x, y) {
    const rect = slot.getBoundingClientRect();
    return x >= rect.right - rect.width * 0.36 && x <= rect.right && y >= rect.bottom - rect.height * 0.36 && y <= rect.bottom;
  }

  canSmartcast(slot) {
    const talent = this.ed.body[activeTarget(this.ed.active[Number(slot.dataset.index)])];
    return !!talent && TalentData.canSmartcast(talent.id);
  }

  smartcastTip(e) {
    const tip = this.ed.activeBarView.parentElement?.querySelector('.build-smartcast-tooltip');
    if (!tip) return;
    const slot = e?.target.closest?.('.build-active-bar-item');
    if (!slot || this.drag || !this.canSmartcast(slot) || !this.overSmartcast(slot, e.clientX, e.clientY)) {
      tip.style.display = 'none';
      return;
    }
    const rect = slot.getBoundingClientRect();
    const host = this.ed.activeBarView.parentElement.getBoundingClientRect();
    const enabled = slot.classList.contains('smartcast');
    tip.replaceChildren(
      document.createTextNode(Lang.text('smartcastLabel')),
      DOM({ tag: 'span', style: enabled ? 'smartcast-state--enabled' : 'smartcast-state--disabled' }, Lang.text(enabled ? 'smartcastEnabled' : 'smartcastDisabled')),
    );
    tip.style.left = `${rect.right - rect.width * 0.18 - host.left}px`;
    tip.style.top = `${rect.bottom - rect.height * 0.36 - host.top - 6}px`;
    tip.style.display = 'block';
  }

  // --- Перенос ------------------------------------------------------------------------------

  down(e) {
    const ed = this.ed;
    const node = e.target.closest('.build-talent-item');
    if (!node || e.button !== 0) return;
    if (ed.combat) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const activeSlot = node.parentElement?.classList.contains('build-active-bar-item') ? node.parentElement : null;
    const source = activeSlot
      ? { kind: 'active', index: Number(activeSlot.dataset.index) }
      : node.dataset.state == 2
        ? { kind: 'field', slot: Number(node.parentElement.dataset.position) }
        : { kind: 'library' };
    if (source.kind === 'library') {
      if (Date.now() - this.lastLibraryClick < LIBRARY_CLICK_COOLDOWN_MS) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      this.lastLibraryClick = Date.now();
    }
    // ЛКМ по переключателю смарткаста меняет его, талант не поднимается
    if (activeSlot && this.canSmartcast(activeSlot) && this.overSmartcast(activeSlot, e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopPropagation();
      ed.toggleSmartcast(source.index);
      this.smartcastTip(e);
      return;
    }
    const talent = this.talentOf(node);
    if (!talent || typeof talent.level !== 'number') return;

    // перенос гасит подсказки и подсветки
    ed.tooltip.hide();
    ed.highlight.clearRow();
    ed.highlight.hoveredSet = null;
    ed.highlight.clearSet();
    node.classList.remove('build-set-highlight', 'build-set-highlight-lib', 'build-stat-filter-hover');
    ed.highlight.updateCount();

    const start = node.getBoundingClientRect();
    const shift = { x: e.clientX - start.left, y: e.clientY - start.top };
    const drag = { node, talent, source, at: Date.now(), from: { x: e.clientX, y: e.clientY }, x: start.left, y: start.top, raf: 0 };
    this.drag = drag;
    drag.row = source.kind !== 'active' ? document.getElementById(`bfr${talent.level}`) : null;
    drag.row?.classList.add('build-field-row--drag-source');
    // колонка и ряд таланта — над панелью активных и соседними рядами, пока талант летит
    drag.lift = [node.closest('.build-field-container, .build-right'), node.closest('.build-field-row')].filter(Boolean);
    drag.lift.forEach((host) => host.classList.add('build-drag-lift'));
    // замок под окном не перерисовываем: на слабых видеокартах талант отставал от курсора
    Castle.toggleRender(Castle.RENDER_LAYER_BUILD_DRAG, false);
    // смарткаст «поднимается» с талантом
    if (activeSlot?.classList.contains('smartcast')) {
      drag.smartSlot = activeSlot;
      activeSlot.dataset.smartcastLifted = '1';
      node.classList.add('build-talent-drag-smartcast');
    }
    Object.assign(node.style, { transformOrigin: 'center center', willChange: 'transform', transition: 'transform 0.1s ease', zIndex: '9999', position: 'fixed', left: `${start.left}px`, top: `${start.top}px` });
    node.style.setProperty('transform', 'scale(1.1)', 'important');

    // курсор двигает талант через translate, не чаще раза за кадр
    drag.move = (event) => {
      drag.x = event.clientX - shift.x;
      drag.y = event.clientY - shift.y;
      drag.raf ||= requestAnimationFrame(() => {
        drag.raf = 0;
        node.style.translate = `${drag.x - start.left}px ${drag.y - start.top}px`;
        this.showDividers(drag.x + shift.x, drag.y + shift.y);
      });
    };
    // бросок ловим на документе: курсор мог обогнать талант
    drag.up = (event) => this.drop(event);
    document.addEventListener('mousemove', drag.move);
    document.addEventListener('mouseup', drag.up);
  }

  // вернуть виду таланта обычное состояние
  release(drag) {
    document.removeEventListener('mousemove', drag.move);
    document.removeEventListener('mouseup', drag.up);
    cancelAnimationFrame(drag.raf);
    this.drag = null;
    drag.smartSlot && delete drag.smartSlot.dataset.smartcastLifted;
    drag.node.classList.remove('build-talent-drag-smartcast');
    drag.row?.classList.remove('build-field-row--drag-source');
    drag.lift.forEach((host) => host.classList.remove('build-drag-lift'));
    this.hideDividers();
    Castle.toggleRender(Castle.RENDER_LAYER_BUILD_DRAG, true);
    Object.assign(drag.node.style, { position: 'static', zIndex: 'auto', left: '', top: '', translate: '', transition: '', willChange: '', transformOrigin: '' });
    drag.node.style.removeProperty('transform');
  }

  cancel() {
    if (this.drag) this.release(this.drag);
  }

  drop(event) {
    const ed = this.ed;
    const drag = this.drag;
    if (!drag) return;
    const { node, talent, source } = drag;
    node.style.translate = '';
    node.style.left = `${drag.x}px`;
    node.style.top = `${drag.y}px`;
    const rect = node.getBoundingClientRect();
    this.release(drag);

    const click = Date.now() - drag.at < CLICK_MS && Math.hypot(event.clientX - drag.from.x, event.clientY - drag.from.y) < CLICK_DISTANCE;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const region = inside(ed.fieldView.getBoundingClientRect(), cx, cy)
      ? 'field'
      : inside(ed.activeBarView.getBoundingClientRect(), cx, cy)
        ? 'bar'
        : inside(ed.library.view.getBoundingClientRect(), cx, cy)
          ? 'library'
          : 'outside';
    const cell = () => {
      const el = document.elementsFromPoint(event.clientX, event.clientY).find((item) => ed.fieldView.contains(item) && !item.classList.contains('build-level'));
      const found = el?.closest?.('.build-hero-grid-item');
      return found ? Number(found.dataset.position) : -1;
    };
    const barSlot = () => {
      let slot = document.elementsFromPoint(event.clientX, event.clientY).map((el) => el.closest?.('.build-active-bar-item')).find((el) => el && ed.activeBarView.contains(el));
      slot ||= this.nearestBarSlot(event.clientX, event.clientY) || this.nearestBarSlot(cx, cy);
      return slot ? Number(slot.dataset.index) : -1;
    };
    const key = source.kind === 'active' ? `a${talent.id}` : `t${talent.id}`;
    const at = { drop: { key, rect } };
    let done = false;

    if (source.kind === 'library') {
      if (click) done = ed.placeFirstFree(talent);
      else if (region === 'field') done = ed.place(talent, cell(), at);
    } else if (source.kind === 'field') {
      if (click) done = ed.remove(source.slot);
      else if (region === 'field') done = ed.move(source.slot, cell(), at);
      else if (region === 'bar') {
        const index = barSlot();
        // уже на панели — новая кнопка летит со старой, иначе — с точки броска
        const already = activeIndexOf(ed.active, source.slot) >= 0;
        done = index >= 0 && ed.assignActive(source.slot, index, already ? {} : { drop: { key: `a${talent.id}`, rect } });
        // оригинал на поле возвращается без полёта: летит одна иконка
        if (done) return this.afterDrop(event, false);
      } else done = ed.remove(source.slot, at); // в библиотеку или мимо окна — снять
    } else if (source.kind === 'active') {
      if (click) done = ed.clearActive(source.index);
      else if (region === 'bar') {
        const index = barSlot();
        done = index >= 0 && index !== source.index && ed.moveActive(source.index, index, at);
      } else done = ed.clearActive(source.index, rect);
    }
    // ничего не поменялось — талант плавно возвращается на место
    if (!done) animateMove(node, rect, 180);
    const transfer = done && (source.kind === 'library' || ((source.kind === 'field') && !ed.inBuild(talent.id)));
    this.afterDrop(event, transfer, click && source.kind === 'library');
  }

  // После броска: подсказка таланта под курсором; после переноса между полем и библиотекой —
  // через паузу (иначе мигает подсказка таланта, вставшего под курсор)
  afterDrop(event, transfer, libraryClick = false) {
    const point = { x: event.clientX, y: event.clientY };
    if (transfer) {
      this.suppressedUntil = Date.now() + 220;
      this.ed.tooltip.hide();
      clearTimeout(this.resumeTimer);
      this.resumeTimer = setTimeout(() => this.hoverAt(point), 240);
      return;
    }
    if (!libraryClick) this.hoverAt(point);
  }

  // кнопка панели под точкой или ближайшая к ней (поверх панели бывают другие слои)
  nearestBarSlot(x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const slot of this.ed.activeSlots) {
      const r = slot.getBoundingClientRect();
      if (!r.width) continue;
      if (inside(r, x, y)) return slot;
      const distance = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (distance < bestDistance && distance <= r.width * 0.9) {
        best = slot;
        bestDistance = distance;
      }
    }
    return best;
  }

  // Крестики-разделители поля видны только при переносе, в круге у курсора (main.css, .build-field::before)
  showDividers(x, y) {
    const field = this.ed.fieldView;
    if (!field.isConnected) return;
    const rect = field.getBoundingClientRect();
    const inset = rect.width / 12;
    field.style.setProperty('--divider-x', `${Math.round(x - rect.left - inset)}px`);
    field.style.setProperty('--divider-y', `${Math.round(y - rect.top - inset)}px`);
    if (field.classList.contains('build-field--dividers')) return;
    // первая точка — без перехода, иначе круг «приедет» с прошлого места
    getComputedStyle(field, '::before').getPropertyValue('--divider-x');
    field.classList.add('build-field--dividers');
  }

  hideDividers() {
    this.ed.fieldView.classList.remove('build-field--dividers');
  }
}

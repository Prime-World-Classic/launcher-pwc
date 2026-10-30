// Расходники окна билда: панель «Расходники» (под сетами, в горизонтальной раскладке библиотеки —
// колонкой справа от сетов) и расходники на кнопках панели активных. В кнопке — до MAX_PER_SLOT
// разных расходников, их иконки срезаны (sliceShapes); при наведении на такую кнопку над ней
// список, где лишний расходник убирается кликом или переносится в другую кнопку. Перенос с
// зажатым Shift на кнопку с расходниками объединяет их (если влезают в MAX_PER_SLOT). Один
// расходник можно поставить в несколько кнопок. Талант и расходники в одной кнопке не стоят:
// поставленный талант вытесняет расходники.
//
// Раскладка — 24 маски (бит N — расходник CONSUMABLES[N]), хранится в билде отдельно от поля
// (build.setConsumables). В бою игра спрашивает её у лаунчера (voiceGameBridge, cbar) и ставит
// купленный расходник в первую свободную из его кнопок. Порядок CONSUMABLES — тот же в pw-api
// (objects/buildConsumables.js) и в игре (PF_GameLogic/InventoryController.cpp).

import { App } from '../app.js';
import { DOM } from '../dom.js';
import { Lang } from '../lang.js';
import { ACTIVE_SLOTS } from './grid.js';

export const CONSUMABLES = [
  'HealingPotion',
  'EnergyPotion',
  'SpeedPotion',
  'TeleportScroll',
  'CleansingPotion',
  'LittleTSightPotion',
  'TrueSightPotion',
  'EyeOfSeeing',
  'KU-Stick',
];
export const MAX_PER_SLOT = 3;

const ALL = (1 << CONSUMABLES.length) - 1;
const SAVE_DELAY_MS = 400;
const POPUP_CLOSE_MS = 220;
const CLICK_MS = 200;
const CLICK_DISTANCE = 6;

export const consumableIcon = (kind) => `content/consumables/${CONSUMABLES[kind]}.webp`;
export const consumableName = (kind) => Lang.text(`consumable_${CONSUMABLES[kind]}_name`);
// расходники кнопки по порядку CONSUMABLES
export const kindsOf = (mask) => CONSUMABLES.map((_, kind) => kind).filter((kind) => mask & (1 << kind));

// 24 маски: лишние биты и расходники сверх MAX_PER_SLOT (последние) отбрасываются
export function normalizeConsumables(slots) {
  return Array.from({ length: ACTIVE_SLOTS }, (_, i) => {
    let mask = (Number(Array.isArray(slots) ? slots[i] : 0) || 0) & ALL;
    while (kindsOf(mask).length > MAX_PER_SLOT) mask &= ~(1 << (31 - Math.clz32(mask)));
    return mask;
  });
}

// Срезы иконок в кнопке (проценты стороны): многоугольники clip-path и линии разреза.
// Два — разрез сверху чуть левее середины, снизу чуть правее; три — «Y» из точки чуть ниже
// центра: тот же наклонный разрез сверху и два вниз, к левому и правому краю.
export function sliceShapes(count) {
  if (count === 2) {
    return {
      pieces: [
        [[0, 0], [45, 0], [55, 100], [0, 100]],
        [[45, 0], [100, 0], [100, 100], [55, 100]],
      ],
      lines: [[[45, 0], [55, 100]]],
    };
  }
  if (count === 3) {
    const center = [52, 56];
    return {
      pieces: [
        [[0, 0], [45, 0], center, [0, 86]],
        [[45, 0], [100, 0], [100, 80], center],
        [[0, 86], center, [100, 80], [100, 100], [0, 100]],
      ],
      lines: [[[45, 0], center], [center, [0, 86]], [center, [100, 80]]],
    };
  }
  return { pieces: [[[0, 0], [100, 0], [100, 100], [0, 100]]], lines: [] };
}

// центр многоугольника — к нему сдвигается иконка куска, чтобы в срезе была её середина
function centroid(points) {
  let area = 0;
  let x = 0;
  let y = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  });
  return area ? [x / (3 * area), y / (3 * area)] : [50, 50];
}

const inside = (rect, x, y) => x > rect.left && x < rect.right && y > rect.top && y < rect.bottom;

export class Consumables {
  constructor(ed) {
    this.ed = ed;
    this.slots = new Array(ACTIVE_SLOTS).fill(0);
    this.server = JSON.stringify(this.slots);
    this.saveTimer = 0;
    this.saving = null;
    this.drag = null;
    this.popup = null; // { index, view }
    this.popupTimer = 0;
    this.items = CONSUMABLES.map((name, kind) =>
      DOM({ style: 'build-consumable-item', data: { kind }, ariaLabel: consumableName(kind) }),
    );
    for (const [kind, item] of this.items.entries()) item.style.backgroundImage = `url("${consumableIcon(kind)}")`;
    this.list = DOM({ style: 'build-consumables' }, ...this.items);
    this.section = DOM(
      { tag: 'fieldset', style: ['build-inventory-fieldset', 'build-consumables-section'] },
      DOM({ tag: 'legend', style: 'build-inventory-legend' }, Lang.text('consumables')),
      this.list,
    );
  }

  load(slots) {
    this.slots = normalizeConsumables(slots);
    this.server = JSON.stringify(this.slots);
  }

  attach() {
    const ed = this.ed;
    ed.listen(this.list, 'mouseover', (e) => {
      const item = e.target.closest?.('.build-consumable-item');
      if (item && !this.drag) ed.tooltip.showConsumable(item, CONSUMABLES[Number(item.dataset.kind)]);
    }, false);
    ed.listen(this.list, 'mouseleave', () => !this.drag && ed.tooltip.hideConsumable(), false);
    ed.listen(this.list, 'mousedown', (e) => {
      const item = e.target.closest?.('.build-consumable-item');
      if (item && e.button === 0) this.startDrag(e, { kind: Number(item.dataset.kind), node: item });
    }, false);
    ed.listen(ed.activeBarView, 'mouseover', (e) => this.overSlot(e), false);
    ed.listen(ed.activeBarView, 'mouseout', (e) => this.outSlot(e), false);
    ed.listen(ed.activeBarView, 'mousedown', (e) => {
      const stack = e.target.closest?.('.build-consumable-stack');
      if (!stack || e.button !== 0 || ed.combat) return;
      e.preventDefault();
      this.startDrag(e, { from: Number(stack.parentElement.dataset.index), node: stack });
    }, false);
  }

  destroy() {
    clearTimeout(this.saveTimer);
    this.flush();
    this.cancelDrag();
    this.closePopup();
  }

  // --- Кнопки панели ----------------------------------------------------------------------

  hasConsumables(index) {
    return !!this.slots[index];
  }

  // Иконки расходников кнопки (без таланта); с талантом — ничего
  renderSlot(slot, index, withTalent) {
    slot.querySelector(':scope > .build-consumable-stack')?.remove();
    const kinds = withTalent ? [] : kindsOf(this.slots[index]);
    slot.classList.toggle('build-active-bar-item--consumables', kinds.length > 0);
    if (!kinds.length) return;
    slot.append(Consumables.stack(kinds));
    if (this.popup?.index === index) this.renderPopup();
  }

  static stack(kinds) {
    const { pieces, lines } = sliceShapes(kinds.length);
    const stack = DOM({ style: ['build-consumable-stack', `build-consumable-stack--${kinds.length}`], data: { kinds: kinds.join(',') } });
    pieces.forEach((points, i) => {
      const [cx, cy] = centroid(points);
      const icon = DOM({ style: 'build-consumable-piece-icon' });
      icon.style.backgroundImage = `url("${consumableIcon(kinds[i])}")`;
      // середина иконки — ближе к середине куска (не до конца: край иконки — пустое поле)
      if (kinds.length > 1) icon.style.transform = `translate(${((cx - 50) * 0.7).toFixed(1)}%, ${((cy - 50) * 0.7).toFixed(1)}%)`;
      const piece = DOM({ style: 'build-consumable-piece' }, icon);
      piece.style.clipPath = `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(', ')})`;
      stack.append(piece);
    });
    if (lines.length) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('class', 'build-consumable-cuts');
      for (const cls of ['build-consumable-cut-shadow', 'build-consumable-cut']) {
        for (const [[x1, y1], [x2, y2]] of lines) {
          const line = document.createElementNS(ns, 'line');
          for (const [name, value] of Object.entries({ x1, y1, x2, y2 })) line.setAttribute(name, value);
          line.setAttribute('class', cls);
          line.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.append(line);
        }
      }
      stack.append(svg);
    }
    return stack;
  }

  // --- Правки -----------------------------------------------------------------------------

  change(slots) {
    this.slots = slots;
    this.closePopupIfEmpty();
    this.ed.renderActive();
    this.scheduleSave();
  }

  // Расходник — в кнопку панели
  add(index, kind) {
    const ed = this.ed;
    if (index < 0 || index >= ACTIVE_SLOTS) return false;
    if (ed.active[index]) {
      App.notify(Lang.text('consumableSlotHasTalent'));
      return false;
    }
    const mask = this.slots[index];
    if (mask & (1 << kind)) return false;
    if (kindsOf(mask).length >= MAX_PER_SLOT) {
      App.notify(Lang.text('consumableSlotFull'));
      return false;
    }
    const slots = this.slots.slice();
    slots[index] = mask | (1 << kind);
    this.change(slots);
    return true;
  }

  // Клик по расходнику панели: в первую кнопку без таланта и расходников
  addFirstFree(kind) {
    const index = this.ed.active.findIndex((item, i) => !item && !this.slots[i]);
    if (index < 0) {
      App.notify(Lang.text('consumableNoFreeSlot'));
      return false;
    }
    return this.add(index, kind);
  }

  remove(index, kind) {
    if (!(this.slots[index] & (1 << kind))) return false;
    const slots = this.slots.slice();
    slots[index] &= ~(1 << kind);
    this.change(slots);
    return true;
  }

  clear(index) {
    if (!this.slots[index]) return false;
    const slots = this.slots.slice();
    slots[index] = 0;
    this.change(slots);
    return true;
  }

  // Расходники mask кнопки from — к расходникам кнопки to (Shift при переносе), если в ней
  // хватает места; одинаковые не повторяются
  merge(from, to, mask = this.slots[from]) {
    if (from === to || !(this.slots[from] & mask)) return false;
    if (this.ed.active[to]) {
      App.notify(Lang.text('consumableSlotHasTalent'));
      return false;
    }
    const joined = this.slots[to] | mask;
    if (kindsOf(joined).length > MAX_PER_SLOT) {
      App.notify(Lang.text('consumableMergeNoRoom'));
      return false;
    }
    const slots = this.slots.slice();
    slots[from] &= ~mask;
    slots[to] = joined;
    this.change(slots);
    return true;
  }

  // Один расходник из списка кнопки -> другая кнопка: в пустую или с Shift — туда (объединение);
  // в кнопку с расходниками — обмен: он встаёт туда, её расходники — к оставшимся в его кнопке
  moveKind(from, to, kind, join) {
    const bit = 1 << kind;
    if (from === to || !(this.slots[from] & bit)) return false;
    if (join || !this.slots[to] || this.slots[to] & bit || this.ed.active[to]) return this.merge(from, to, bit);
    const rest = (this.slots[from] & ~bit) | this.slots[to];
    if (kindsOf(rest).length > MAX_PER_SLOT) {
      App.notify(Lang.text('consumableSlotFull'));
      return false;
    }
    const slots = this.slots.slice();
    slots[from] = rest;
    slots[to] = bit;
    this.change(slots);
    return true;
  }

  // Правки панели активных: талант встал в кнопку — расходники с неё уходят; обмен кнопок —
  // расходники едут вместе с кнопкой. Перерисует commit панели.
  clearSilently(index) {
    if (!this.slots[index]) return;
    this.slots = this.slots.slice();
    this.slots[index] = 0;
    this.scheduleSave();
  }

  swapSilently(from, to) {
    if (this.slots[from] === this.slots[to]) return;
    this.slots = this.slots.slice();
    [this.slots[from], this.slots[to]] = [this.slots[to], this.slots[from]];
    this.scheduleSave();
  }

  // --- Сохранение -------------------------------------------------------------------------

  scheduleSave() {
    if (this.ed.preview || !this.ed.buildId) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  // последняя раскладка — на сервер (пока идёт запрос, следующая ждёт его)
  flush() {
    clearTimeout(this.saveTimer);
    if (this.ed.preview || !this.ed.buildId) return;
    const json = JSON.stringify(this.slots);
    if (json === this.server || this.saving) return;
    const buildId = this.ed.buildId;
    const slots = this.slots.slice();
    this.saving = App.api
      .request('build', 'setConsumables', { buildId, slots })
      .then(() => {
        this.server = json;
      })
      .catch((error) => {
        console.warn('Расходники билда не сохранены', error);
        App.notify(Lang.text('consumablesNotSaved'));
        this.server = json; // не повторять ту же раскладку по кругу
      })
      .finally(() => {
        this.saving = null;
        if (JSON.stringify(this.slots) !== this.server && this.ed.alive) this.scheduleSave();
      });
  }

  // --- Наведение и список кнопки --------------------------------------------------------

  overSlot(e) {
    if (this.drag) return;
    const stack = e.target.closest?.('.build-consumable-stack');
    if (!stack) return;
    const index = Number(stack.parentElement.dataset.index);
    clearTimeout(this.popupTimer);
    const kinds = kindsOf(this.slots[index]);
    if (kinds.length > 1) {
      this.ed.tooltip.hideConsumable();
      if (this.popup?.index !== index) this.openPopup(index);
    } else {
      this.closePopup();
      if (kinds.length) this.ed.tooltip.showConsumable(stack, CONSUMABLES[kinds[0]], { short: true });
    }
  }

  outSlot(e) {
    const stack = e.target.closest?.('.build-consumable-stack');
    if (!stack || (e.relatedTarget && stack.contains(e.relatedTarget))) return;
    if (!this.popup) this.ed.tooltip.hideConsumable();
    this.scheduleClosePopup();
  }

  scheduleClosePopup() {
    clearTimeout(this.popupTimer);
    this.popupTimer = setTimeout(() => this.closePopup(), POPUP_CLOSE_MS);
  }

  openPopup(index) {
    this.closePopup();
    const view = DOM({ style: 'build-consumable-popup', role: 'menu' });
    view.addEventListener('mouseenter', () => clearTimeout(this.popupTimer));
    view.addEventListener('mouseleave', () => {
      this.ed.tooltip.hideConsumable();
      this.scheduleClosePopup();
    });
    document.body.append(view);
    this.popup = { index, view };
    this.renderPopup();
  }

  renderPopup() {
    const popup = this.popup;
    if (!popup) return;
    const { index, view } = popup;
    const slot = this.ed.activeSlots[index];
    const kinds = kindsOf(this.slots[index]);
    if (kinds.length < 2 || !slot?.isConnected) return this.closePopup();
    view.replaceChildren(
      DOM({ style: 'build-consumable-popup-title' }, Lang.text('consumablesInSlot')),
      ...kinds.map((kind) => {
        const icon = DOM({ style: 'build-consumable-popup-icon' });
        icon.style.backgroundImage = `url("${consumableIcon(kind)}")`;
        // мышью: клик — убрать, перенос — в другую кнопку (startDrag/drop); click — для клавиатуры
        const row = DOM(
          {
            tag: 'button', type: 'button', style: 'build-consumable-popup-item', role: 'menuitem',
            ariaLabel: `${consumableName(kind)}: ${Lang.text('consumableRemoveHint')}`,
            event: ['click', (e) => {
              e.stopPropagation();
              this.ed.tooltip.hideConsumable();
              this.remove(index, kind);
            }],
          },
          icon,
          DOM({ tag: 'span', style: 'build-consumable-popup-name' }, consumableName(kind)),
          DOM({ tag: 'span', style: 'build-consumable-popup-remove', ariaHidden: 'true' }, '✕'),
        );
        row.addEventListener('mouseenter', () => this.ed.tooltip.showConsumable(row, CONSUMABLES[kind], { short: true }));
        row.addEventListener('mousedown', (e) => {
          if (e.button !== 0 || this.ed.combat) return;
          e.stopPropagation();
          this.startDrag(e, { from: index, kind, node: icon });
        });
        return row;
      }),
      DOM({ style: 'build-consumable-popup-hint' }, Lang.text('consumableRemoveHint')),
    );
    // над кнопкой, по центру; не влезает сверху — под ней
    Object.assign(view.style, { position: 'fixed', left: '0px', top: '0px', zIndex: 9998 });
    const rect = slot.getBoundingClientRect();
    const width = view.offsetWidth;
    const height = view.offsetHeight;
    const left = Math.max(4, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 4));
    const top = rect.top - height - 4 >= 0 ? rect.top - height - 4 : rect.bottom + 4;
    Object.assign(view.style, { left: `${left}px`, top: `${top}px` });
  }

  closePopup() {
    clearTimeout(this.popupTimer);
    this.popup?.view.remove();
    this.popup = null;
  }

  closePopupIfEmpty() {
    if (this.popup && kindsOf(this.slots[this.popup.index]).length < 2) this.closePopup();
  }

  // --- Перенос ----------------------------------------------------------------------------

  // source: { kind, node } — из панели расходников; { from, node } — все расходники кнопки;
  // { from, kind, node } — один расходник из списка кнопки
  startDrag(e, source) {
    e.preventDefault();
    this.ed.tooltip.hideConsumable();
    // призрак — до закрытия списка: иконка строки уходит вместе с ним
    const node = source.node.getBoundingClientRect();
    const ghost = source.node.cloneNode(true);
    this.closePopup();
    // взяли мимо иконки (строку списка за название) — призрак встаёт серединой под курсор
    const rect = inside(node, e.clientX, e.clientY) ? node : {
      left: e.clientX - node.width / 2, top: e.clientY - node.height / 2, width: node.width, height: node.height,
    };
    ghost.classList.add('build-consumable-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, zIndex: 9999, pointerEvents: 'none' });
    document.body.append(ghost);
    const shift = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const drag = { ...source, ghost, at: Date.now(), from0: { x: e.clientX, y: e.clientY }, raf: 0 };
    drag.move = (event) => {
      drag.x = event.clientX - shift.x;
      drag.y = event.clientY - shift.y;
      drag.raf ||= requestAnimationFrame(() => {
        drag.raf = 0;
        ghost.style.transform = `translate(${drag.x - rect.left}px, ${drag.y - rect.top}px) scale(1.1)`;
      });
    };
    drag.up = (event) => this.drop(event);
    document.addEventListener('mousemove', drag.move);
    document.addEventListener('mouseup', drag.up);
    if (source.from !== undefined) source.node.style.opacity = '0.35';
    this.drag = drag;
  }

  cancelDrag() {
    const drag = this.drag;
    if (!drag) return;
    document.removeEventListener('mousemove', drag.move);
    document.removeEventListener('mouseup', drag.up);
    cancelAnimationFrame(drag.raf);
    drag.ghost.remove();
    drag.node.style.opacity = '';
    this.drag = null;
  }

  drop(event) {
    const drag = this.drag;
    if (!drag) return;
    this.cancelDrag();
    const ed = this.ed;
    const click = Date.now() - drag.at < CLICK_MS && Math.hypot(event.clientX - drag.from0.x, event.clientY - drag.from0.y) < CLICK_DISTANCE;
    const onBar = inside(ed.activeBarView.getBoundingClientRect(), event.clientX, event.clientY);
    const target = () => {
      const slot = document.elementsFromPoint(event.clientX, event.clientY)
        .map((el) => el.closest?.('.build-active-bar-item'))
        .find((el) => el && ed.activeBarView.contains(el)) || ed.input.nearestBarSlot(event.clientX, event.clientY);
      return slot ? Number(slot.dataset.index) : -1;
    };
    if (drag.from === undefined) {
      if (click) this.addFirstFree(drag.kind);
      else this.add(target(), drag.kind);
      return;
    }
    const index = click || !onBar ? -1 : target();
    // строка списка: клик или мимо панели — убрать; на кнопку — перенос (Shift — объединить)
    if (drag.kind !== undefined) {
      if (click || !onBar) this.remove(drag.from, drag.kind);
      else if (index >= 0 && index !== drag.from) this.moveKind(drag.from, index, drag.kind, event.shiftKey);
      return;
    }
    // кнопка с расходниками: клик по единственному — снять; перенос — обмен кнопок (с Shift на
    // кнопку с расходниками — объединить); мимо панели — снять все
    if (click) {
      const kinds = kindsOf(this.slots[drag.from]);
      if (kinds.length === 1) this.remove(drag.from, kinds[0]);
      return;
    }
    if (index >= 0 && index !== drag.from) {
      if (event.shiftKey && (this.slots[index] || ed.active[index])) this.merge(drag.from, index);
      else ed.moveActive(drag.from, index);
    } else if (!onBar) this.clear(drag.from);
  }
}

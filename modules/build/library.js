// Библиотека окна билда (все таланты героя, которых нет на поле) и список сетов: фильтры по
// уровню, редкости, активным, стату и поиску по названию, группировка по сетам, режимы ЛКМ по
// сету (сет первым / только остаток сета), своя полоса прокрутки, популярность сетов.

import { App } from '../app.js';
import { DOM } from '../dom.js';
import { Lang } from '../lang.js';
import { Sound } from '../sound.js';
import { SOUNDS_LIBRARY } from '../soundsLibrary.js';
import { Castle } from '../castle.js';
import { Window } from '../window.js';
import { BuildClientTooltip } from '../buildClientTooltip.js';
import { PreloadImages } from '../preloadImages.js';
import { prepareTalents, iconUrl } from './talents.js';
import { Sets } from './sets.js';
import { BuildStore } from './store.js';
import { rowKeys } from './highlight.js';

const RARITIES = [
  { id: '4', name: 'titleTheRed', image: 'red' },
  { id: '3', name: 'titleTheOrange', image: 'orange' },
  { id: '2', name: 'titleThePurple', image: 'purple' },
  { id: '1', name: 'titleTheBlue', image: 'blue' },
];
const POPULARITY_TTL_MS = 5 * 60 * 1000;
const popularity = { map: new Map(), at: 0, loading: null };

const play = (sound, id) => Sound.play(sound, { id, volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
const normalize = (value) => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

// название таланта для поиска: из данных игры и из lang (находит по любому)
const searchNames = { lang: null, names: new Map() };
function searchName(id) {
  if (searchNames.lang !== Lang.target) Object.assign(searchNames, { lang: Lang.target, names: new Map() });
  if (searchNames.names.has(id)) return searchNames.names.get(id);
  const key = id < 0 ? `htalent_${-id}_name` : `talent_${id}_name`;
  const word = (lang) => Lang.list?.[lang]?.word;
  const own = (lang) => (word(lang) && Object.prototype.hasOwnProperty.call(word(lang), key) ? word(lang)[key] : '');
  const raw = String(own(Lang.target) || own(Lang.default) || '').replace(/<[^>]*>/g, '');
  const client = BuildClientTooltip.loadedName(id);
  const name = normalize(client ? `${client} ${raw}` : raw);
  // данные игры ещё не прочитаны — не запоминаем, чтобы потом найти и по их имени
  if (client || !BuildClientTooltip.available(id)) searchNames.names.set(id, name);
  return name;
}

export class Library {
  constructor(ed) {
    this.ed = ed;
    this.containers = new Map(); // id -> .build-talent-item-container
    this.order = []; // id в порядке библиотеки
    this.defaultOrder = new Map(); // id -> место в справочнике героя
    this.rules = {}; // level / rarity / active / stats: показанные значения (нет ключа — все)
    this.statRows = new Set(); // строки панели героя, включённые фильтром
    this.search = '';
    this.setView = null; // { mode, ids } после ЛКМ по сету
    this.selectedSet = null;
    this.setItems = [];
    this.loaded = false;
  }

  // --- Разметка -----------------------------------------------------------------------------

  build() {
    const ed = this.ed;
    this.list = DOM({ style: 'build-talents' });
    this.setsList = DOM({ style: 'build-sets' });
    const section = (style, legend, list) => DOM({ tag: 'fieldset', style: ['build-inventory-fieldset', style] }, DOM({ tag: 'legend', style: 'build-inventory-legend' }, legend), list);
    this.talentsSection = section('build-talents-section', '', this.list);
    this.setsSection = section('build-sets-section', Lang.text('sets'), this.setsList);
    this.view = DOM({ style: 'build-talent-view' }, this.talentsSection, this.setsSection);
    for (const [part, list, label] of [[this.talentsSection, this.list, 'library'], [this.setsSection, this.setsList, 'sets']]) {
      this.attachScrollbar(part, list, Lang.text(label));
      for (const dir of [-1, 1]) {
        part.append(DOM({
          tag: 'button', type: 'button', style: ['build-scroll-arrow', dir < 0 ? 'build-scroll-arrow-up' : 'build-scroll-arrow-down'],
          ariaLabel: `${Lang.text(label)}: ${dir < 0 ? '↑' : '↓'}`,
          event: ['click', () => list.scrollBy({ top: dir * list.clientHeight * 0.25, behavior: 'smooth' })],
        }, dir < 0 ? '▲' : '▼'));
      }
    }
    this.altHint = DOM({ style: 'build-alt-reset-hint' }, Lang.text('buildAltResetHint'));
    this.applyLayout();
    this.buildLevels();
    this.buildRarity();
    this.searchView = this.buildSearch();
    this.installListScroll();
    this.installSetsWheel();
    this.renderSets();
    if (!ed.preview) this.loadPopularity();
  }

  applyLayout() {
    this.view?.classList.toggle('build-talent-view--row', Number(this.ed.setting('buildTalentViewLayout')) === 1);
  }

  // Своя полоса прокрутки: ползунок (перетаскивание, клавиши), клик по полосе
  attachScrollbar(section, list, label) {
    const thumb = DOM({ style: 'build-scroll-thumb', tabIndex: 0 });
    const rail = DOM({ style: 'build-scroll-rail' }, thumb);
    Library.serial = (Library.serial || 0) + 1;
    list.id ||= `build-scroll-list-${Library.serial}`;
    for (const [name, value] of [['role', 'scrollbar'], ['aria-label', label], ['aria-orientation', 'vertical'], ['aria-valuemin', '0'], ['aria-controls', list.id]]) thumb.setAttribute(name, value);
    section.append(rail);
    list.classList.add('build-custom-scroll');
    const max = () => Math.max(0, list.scrollHeight - list.clientHeight);
    const travel = () => Math.max(0, rail.clientHeight - thumb.offsetHeight);
    let drag = null;
    const update = () => {
      // при перетаскивании ползунок ставит pointermove — сразу под курсор
      if (!drag) thumb.style.top = `${max() ? (list.scrollTop / max()) * travel() : 0}px`;
      thumb.setAttribute('aria-valuemax', String(max()));
      thumb.setAttribute('aria-valuenow', String(Math.round(list.scrollTop)));
      thumb.setAttribute('aria-disabled', String(!max()));
      thumb.tabIndex = max() ? 0 : -1;
      thumb.classList.toggle('is-disabled', !max());
    };
    thumb.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !max()) return;
      e.preventDefault();
      thumb.focus();
      drag = { y: e.clientY, top: parseFloat(thumb.style.top) || 0 };
      thumb.setPointerCapture(e.pointerId);
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!drag || !travel()) return;
      const top = Math.max(0, Math.min(travel(), drag.top + e.clientY - drag.y));
      thumb.style.top = `${top}px`;
      list.scrollTop = (top / travel()) * max();
    });
    const release = () => {
      if (!drag) return;
      drag = null;
      update();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) thumb.addEventListener(type, release);
    rail.addEventListener('pointerdown', (e) => {
      if (e.target === thumb || e.button !== 0) return;
      const rect = rail.getBoundingClientRect();
      const ratio = travel() ? (e.clientY - rect.top - thumb.offsetHeight / 2) / travel() : 0;
      list.scrollTop = Math.max(0, Math.min(1, ratio)) * max();
    });
    thumb.addEventListener('keydown', (e) => {
      const delta = { ArrowUp: -40, ArrowDown: 40, PageUp: -list.clientHeight, PageDown: list.clientHeight }[e.key];
      if (delta === undefined && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      e.stopPropagation();
      list.scrollTop = e.key === 'Home' ? 0 : e.key === 'End' ? max() : list.scrollTop + delta;
    });
    list.addEventListener('scroll', update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(list);
    resize.observe(rail);
    const content = new MutationObserver(update);
    content.observe(list, { childList: true });
    this.ed.cleanups.push(() => (resize.disconnect(), content.disconnect()));
  }

  // Колесо и прокрутка библиотеки гасят подсказку; остановились — подсказка таланта под курсором
  installListScroll() {
    const suppress = () => {
      this.hoverSuppressed = true;
      clearTimeout(this.suppressTimer);
      this.suppressTimer = setTimeout(() => {
        this.hoverSuppressed = false;
        this.ed.input.hoverAt(this.pointer);
      }, 80);
    };
    this.list.addEventListener('wheel', suppress, { passive: true });
    this.list.addEventListener('scroll', suppress, { passive: true });
    this.list.addEventListener('mousemove', (e) => (this.pointer = { x: e.clientX, y: e.clientY }), { passive: true });
  }

  // Список сетов крутится плавно (по трети шага); подсветка сета на время прокрутки снимается
  installSetsWheel() {
    const view = this.setsList;
    let target = null;
    let raf = 0;
    view.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.shiftKey) return;
      const dy = Number(e.deltaY) || 0;
      const max = Math.max(0, view.scrollHeight - view.clientHeight);
      // на краю списка прокручивать некуда — подсветку не трогаем
      if (!dy || !max || (dy < 0 && view.scrollTop <= 0) || (dy > 0 && view.scrollTop >= max)) return;
      this.setsHoverSuppressed = true;
      this.ed.highlight.leaveSet();
      clearTimeout(this.setsScrollTimer);
      const pointer = { x: e.clientX, y: e.clientY };
      this.setsScrollTimer = setTimeout(() => {
        this.setsHoverSuppressed = false;
        const item = document.elementFromPoint(pointer.x, pointer.y)?.closest?.('.build-set-item');
        if (item && view.contains(item)) item.dispatchEvent(new MouseEvent('mouseenter'));
      }, 140);
      // в раскладке «ряд» — обычная прокрутка, как у библиотеки
      if (this.view.classList.contains('build-talent-view--row')) return;
      e.preventDefault();
      target = Math.max(0, Math.min(max, (target ?? view.scrollTop) + dy / 3));
      if (raf) return;
      const step = () => {
        raf = 0;
        const next = view.scrollTop + (target - view.scrollTop) * 0.22;
        view.scrollTop = Math.abs(target - next) > 0.5 ? next : target;
        if (Math.abs(target - next) > 0.5) raf = requestAnimationFrame(step);
        else target = null;
      };
      raf = requestAnimationFrame(step);
    }, { passive: false });
  }

  // --- Уровни, редкость, активные, поиск ----------------------------------------------------

  // Кнопки уровней: светлая — таланты уровня показаны в библиотеке. ЛКМ — показать/скрыть,
  // ПКМ — только этот уровень (повторный ПКМ — все)
  buildLevels() {
    const view = this.ed.levelView;
    ['VI', 'V', 'IV', 'III', 'II', 'I'].forEach((label, i) => {
      const id = String(6 - i);
      const button = DOM({ id: `bl${id}`, data: { id } }, label);
      button.addEventListener('click', () => {
        play(SOUNDS_LIBRARY.CLICK, 'ui-click');
        const shown = this.shownLevels();
        this.setLevels(shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id]);
      });
      button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        play(SOUNDS_LIBRARY.CLICK, 'ui-click');
        const solo = this.rules.level?.length === 1 && this.rules.level[0] === id;
        this.setLevels(solo ? null : [id]);
      });
      view.append(button);
    });
  }

  shownLevels() {
    return ['6', '5', '4', '3', '2', '1'].filter((id) => !this.rules.level || this.rules.level.includes(id));
  }

  setLevels(levels) {
    this.setRule('level', !levels || levels.length >= 6 ? null : levels);
  }

  setRule(key, values) {
    if (values) this.rules[key] = values;
    else delete this.rules[key];
    this.setView = null;
    this.render();
  }

  // фильтр по стату — строки панели героя (ключи их статов вместе)
  toggleStatRow(row, on) {
    if (on) this.statRows.add(row);
    else this.statRows.delete(row);
    const keys = [...new Set([...this.statRows].flatMap((key) => rowKeys(key)))];
    this.setRule('stats', keys.length ? keys : null);
  }

  buildRarity() {
    const view = (this.rarityView = DOM({ style: 'build-rarity' }));
    const prepare = (button, image, kind, tooltip) => {
      button.dataset.filterKind = kind;
      button.dataset.filterImage = image;
      Object.assign(button.style, { backgroundRepeat: 'no-repeat', backgroundPosition: 'center', border: 'none', boxSizing: 'border-box' });
      button.setAttribute('role', 'checkbox');
      button.dataset.tooltip = tooltip;
      button.setAttribute('aria-label', tooltip);
      button.tabIndex = 0;
      button.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        button.click();
      });
      button.addEventListener('click', () => play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, 'ui-small-click'));
      view.append(button);
    };
    // ЛКМ — показать/скрыть, ПКМ — только они
    const active = DOM({ style: 'build-rarity-other' });
    prepare(active, 'active', 'active', Lang.text('buildActiveFilterTooltip'));
    active.addEventListener('click', () => this.setRule('active', active.dataset.active === '1' ? ['0'] : null));
    active.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      delete this.rules.rarity;
      this.setRule('active', ['1']);
    });
    for (const rarity of RARITIES) {
      const button = DOM({ data: { rarityId: rarity.id } });
      prepare(button, rarity.image, 'rarity', Lang.text('talentQualityTitle').replace('{name}', Lang.text(rarity.name)));
      button.addEventListener('click', () => {
        const selected = new Set(this.rules.rarity ?? RARITIES.map((r) => r.id));
        if (selected.has(rarity.id)) selected.delete(rarity.id);
        else selected.add(rarity.id);
        // пусто — скрыты все; все — фильтра нет
        this.setRule('rarity', selected.size === RARITIES.length ? null : [...selected]);
      });
      button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        delete this.rules.active;
        this.setRule('rarity', [rarity.id]);
      });
    }
  }

  syncFilters() {
    for (const button of this.ed.levelView.children) button.classList.toggle('build-level-dim', !this.shownLevels().includes(button.dataset.id));
    for (const button of this.rarityView.querySelectorAll('[data-filter-kind]')) {
      const isActive = button.dataset.filterKind === 'active';
      const on = isActive ? !this.rules.active || this.rules.active.includes('1') : !this.rules.rarity || this.rules.rarity.includes(button.dataset.rarityId);
      if (button.dataset.active === (on ? '1' : '0') && button.style.backgroundImage) continue;
      button.dataset.active = on ? '1' : '0';
      button.setAttribute('aria-checked', String(on));
      // выключено — камень своего цвета на общей серой подложке (build/filter-<цвет>-off.png)
      const image = button.dataset.filterImage;
      const file = isActive
        ? `${image}${on ? 'Show' : 'NoShow'}`
        : on
          ? ['2', '3'].includes(button.dataset.rarityId) ? `build/filter-${image}` : `${image}Show`
          : `build/filter-${image}-off`;
      Object.assign(button.style, {
        backgroundImage: `url("content/img/${file}.png")`,
        backgroundColor: 'transparent',
        backgroundBlendMode: 'normal',
        backgroundSize: isActive ? '92%' : 'cover',
        filter: isActive && on ? 'brightness(1.04) saturate(2.02)' : 'none',
      });
    }
  }

  buildSearch() {
    const input = DOM({ tag: 'input', type: 'text', style: ['build-library-search', 'mm-lobby-hero-search'], placeholder: Lang.text('buildTalentSearchPlaceholder'), spellcheck: false, autocomplete: 'off' });
    input.setAttribute('aria-label', input.placeholder);
    const icon = DOM({ tag: 'span', style: 'build-library-search-icon', event: ['click', () => input.focus()] });
    const clear = DOM({ tag: 'button', type: 'button', style: 'build-library-search-clear' }, '×');
    clear.setAttribute('aria-label', Lang.text('buildTalentSearchClear'));
    const row = DOM({ style: ['build-library-search-row', 'mm-lobby-hero-search-wrap'] }, icon, input, clear);
    let timer = 0;
    const apply = () => {
      row.classList.toggle('build-library-search-row--active', input.value.trim() !== '');
      const query = normalize(input.value);
      if (query === this.search) return;
      this.search = query;
      this.render();
    };
    const reset = () => {
      input.value = '';
      clearTimeout(timer);
      apply();
    };
    input.addEventListener('input', () => {
      row.classList.toggle('build-library-search-row--active', input.value.trim() !== '');
      clearTimeout(timer);
      timer = setTimeout(apply, 80);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        reset();
        input.blur();
      } else if (App.isEnterKey(e)) {
        // Enter — «готово»: фильтр остаётся
        e.preventDefault();
        input.blur();
      }
    });
    for (const type of ['mousedown', 'click', 'contextmenu', 'keyup']) row.addEventListener(type, (e) => e.stopPropagation());
    clear.addEventListener('click', () => (reset(), input.focus()));
    this.searchInput = input;
    this.ed.cleanups.push(() => clearTimeout(timer));
    return row;
  }

  // Enter в окне билда (не в поле ввода) — в поиск библиотеки; Alt — библиотека целиком.
  // Ставится один раз; shown() — окно билда на экране.
  static installKeys(shown) {
    if (Library.keysInstalled) return;
    Library.keysInstalled = true;
    window.addEventListener('keydown', (e) => {
      const library = shown()?.library;
      if (!library) return;
      if ((e.key === 'Alt' || e.code === 'AltLeft' || e.code === 'AltRight') && !e.repeat && !shown().preview) return library.resetSetView();
      const input = library.searchInput;
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !App.isEnterKey(e)) return;
      if (Window.windows?.main?.id !== 'wbuild' || !input?.isConnected || input.offsetParent === null) return;
      const active = document.activeElement;
      if (active === input || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName) || active?.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();
      input.focus();
      input.select();
    }, true);
  }

  // --- Таланты библиотеки -------------------------------------------------------------------

  async load() {
    const ed = this.ed;
    let items = ed.preview
      ? structuredClone(ed.preview.inventory)
      : BuildStore.catalog(ed.heroId, ed.buildId, ed.body) ??
        (await BuildStore.loadCatalog(ed.heroId, ed.buildId, ed.body, () => ed.alive));
    if (!ed.alive || !Array.isArray(items)) return;
    // данные игры для талантов библиотеки
    if (!BuildClientTooltip.talentsReady(items)) {
      await BuildClientTooltip.prepareTalents(items);
      if (!ed.alive) return;
    }
    const fresh = items.filter((item) => item && !ed.talents.has(Number(item.id)));
    prepareTalents(fresh, ed.engine.initial);
    for (const talent of fresh) ed.talents.set(Number(talent.id), talent);
    this.order = items.filter(Boolean).map((item) => Number(item.id));
    this.order.forEach((id, index) => this.defaultOrder.set(id, index));
    this.loaded = true;
    this.groupBySets();
    this.render();
    ed.highlight.refresh();
  }

  containerFor(id) {
    let container = this.containers.get(id);
    if (!container) {
      container = DOM({ style: 'build-talent-item-container' });
      if (this.defaultOrder.has(id)) container.dataset.defaultOrder = this.defaultOrder.get(id);
      this.containers.set(id, container);
    }
    return container;
  }

  // Вернувшийся с поля талант — первым в библиотеке (вытесненный — на место того, кто его вытеснил)
  putFirst(id, insteadOf = null) {
    id = Number(id);
    this.order = this.order.filter((x) => x !== id);
    const at = insteadOf === null ? 0 : Math.max(0, this.order.indexOf(Number(insteadOf)));
    this.order.splice(at, 0, id);
  }

  // Видимость таланта: фильтры, режим сета, поиск
  visible(talent) {
    const id = Number(talent.id);
    const set = this.setView;
    if (set && set.mode !== 1) return set.ids.has(id);
    if (set?.mode === 1 && set.ids.has(id)) return true;
    if (talent.level == 0) return false;
    for (const key in this.rules) {
      if (!(key in talent)) return false;
      if (key === 'stats') {
        if (!talent.stats || !this.rules.stats.some((stat) => stat in talent.stats)) return false;
      } else if (!this.rules[key].includes(`${talent[key]}`)) return false;
    }
    return !this.search || searchName(id).includes(this.search);
  }

  render() {
    if (!this.list) return;
    const ed = this.ed;
    this.syncFilters();
    // режим «остаток сета»: в билде весь сет — обычная библиотека
    if (this.setView && this.setView.mode !== 1 && ![...this.setView.ids].some((id) => !ed.inBuild(id))) this.setView = null;
    let changed = false;
    const levelRows = this.setView && this.setView.mode !== 1;
    for (const id of this.order) {
      const talent = ed.talents.get(id);
      if (!talent) continue;
      const container = this.containerFor(id);
      if (container.parentNode !== this.list) changed = true;
      if (ed.inBuild(id)) {
        container.style.display = 'none';
        continue;
      }
      const node = ed.nodeFor(talent);
      if (node.parentNode !== container) container.append(node);
      node.dataset.state = 1;
      const show = this.visible(talent);
      container.style.display = show ? 'block' : 'none';
      // остаток сета — ряды как на поле (VI сверху)
      container.style.gridRow = levelRows && show ? `${talent.level > 0 ? 7 - talent.level : 1}` : '';
    }
    if (changed || this.orderDirty) this.renderOrder();
  }

  renderOrder() {
    this.orderDirty = false;
    const nodes = this.order.map((id) => this.containers.get(id)).filter(Boolean);
    // те, что уже стоят по порядку, не трогаем
    let index = 0;
    for (const container of nodes) {
      if (this.list.children[index] !== container) this.list.insertBefore(container, this.list.children[index] || null);
      index++;
    }
  }

  setOrder(order) {
    this.order = order;
    this.orderDirty = true;
  }

  // Видимые таланты одного сета — рядом, по порядку в сете (sets.list.js)
  groupBySets() {
    const visible = (id) => !this.ed.inBuild(id) && this.ed.talents.get(id) && this.visible(this.ed.talents.get(id));
    const groups = new Map();
    for (const id of this.order) {
      const group = Sets.groupOf(id);
      if (!group || !visible(id)) continue;
      if (!groups.has(group.set.key)) groups.set(group.set.key, []);
      groups.get(group.set.key).push({ id, order: group.order });
    }
    const used = new Set();
    const order = [];
    for (const id of this.order) {
      if (used.has(id)) continue;
      const group = Sets.groupOf(id);
      const members = group && visible(id) ? groups.get(group.set.key) : null;
      const list = members && members.length > 1 ? members.slice().sort((a, b) => a.order - b.order).map((m) => m.id) : [id];
      for (const member of list) if (!used.has(member)) used.add(member), order.push(member);
    }
    this.setOrder(order);
  }

  byDefaultOrder(ids) {
    return ids.slice().sort((a, b) => (this.defaultOrder.get(a) ?? Infinity) - (this.defaultOrder.get(b) ?? Infinity) || a - b);
  }

  // ЛКМ по сету: 1 — его таланты первыми (видны при любых фильтрах), 2/3 — только остаток сета
  // по рядам поля
  applySetView(set, mode) {
    const ids = new Set(set.ids);
    if (mode === 1) {
      this.setView = { mode, ids };
      const own = set.ids.filter((id) => this.order.includes(id) && !this.ed.inBuild(id));
      this.setOrder([...own, ...this.byDefaultOrder(this.order.filter((id) => !own.includes(id)))]);
      this.render();
      this.list.scrollTop = 0;
      return;
    }
    const scroll = this.list.scrollTop;
    this.setView = { mode, ids };
    const level = (id) => Number(this.ed.talents.get(id)?.level) || 0;
    const leftovers = this.order.filter((id) => ids.has(id) && !this.ed.inBuild(id));
    const byRow = [6, 5, 4, 3, 2, 1, 0].flatMap((lvl) => leftovers.filter((id) => level(id) === lvl));
    this.setOrder([...byRow, ...this.order.filter((id) => !byRow.includes(id))]);
    this.render();
    this.list.scrollTop = scroll;
  }

  // Alt — библиотека снова целиком, сгруппированная по сетам
  resetSetView() {
    this.setView = null;
    this.selectSet(null);
    this.ed.highlight.leaveSet();
    this.groupBySets();
    this.render();
  }

  selectSet(item) {
    this.selectedSet?.classList.remove('build-set-item-selected');
    this.selectedSet = item;
    item?.classList.add('build-set-item-selected');
  }

  // --- Сеты ---------------------------------------------------------------------------------

  setsInOrder() {
    const sets = Sets.list();
    if (Number(this.ed.setting('buildSetSortMode')) !== 1) return sets;
    const value = (set) => popularity.map.get(set.popularityId) || 0;
    return sets.map((set, index) => ({ set, index })).sort((a, b) => value(b.set) - value(a.set) || a.index - b.index).map((x) => x.set);
  }

  renderSets() {
    if (!this.setsList) return;
    const items = new Map(this.setItems.map((entry) => [entry.set.key, entry]));
    this.setItems = [];
    for (const set of this.setsInOrder()) {
      if (set.mainId == null) continue;
      let entry = items.get(set.key);
      if (!entry) entry = { set, item: this.createSetItem(set) };
      this.setItems.push(entry);
    }
    // те же элементы в новом порядке: сет под курсором не теряет подсветку
    this.setItems.forEach(({ item }, index) => {
      if (this.setsList.children[index] !== item) this.setsList.insertBefore(item, this.setsList.children[index] || null);
    });
    if (this.ed.highlight.statRow) this.ed.highlight.enterStatRow(this.ed.highlight.statRow);
  }

  createSetItem(set) {
    const ed = this.ed;
    // иконка главного таланта; нет своей — из данных игры
    const item = DOM({ style: 'build-set-item', data: { id: set.mainId, url: iconUrl(set.mainId), fallback: 'clientTalentIcon' } });
    new PreloadImages().add(item, document.createDocumentFragment());
    item.addEventListener('mouseenter', () => !this.setsHoverSuppressed && ed.highlight.enterSet(set, item));
    item.addEventListener('mouseleave', () => ed.highlight.hoveredSet?.item === item && ed.highlight.leaveSet());
    item.addEventListener('click', (e) => {
      e.preventDefault();
      play(SOUNDS_LIBRARY.CLICK, 'ui-set-down');
      play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, 'ui-set-up');
      const mode = Number(ed.setting('buildSetLmbMode'));
      this.selectSet(item);
      const before = set.ids.filter((id) => ed.inBuild(id)).length;
      if (mode !== 3) ed.applySet(set);
      this.applySetView(set, mode);
      const after = set.ids.filter((id) => ed.inBuild(id)).length;
      if (mode !== 3 && after >= 2 && after > before && set.popularityId && !ed.preview) {
        App.api.request('build', 'addSetPopularity', { id: set.popularityId }).catch(() => {});
      }
      ed.highlight.enterSet(set, item);
    });
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (ed.combat) return;
      play(SOUNDS_LIBRARY.CLICK, 'ui-set-down');
      this.selectSet(item);
      ed.removeSet(set);
      this.applySetView(set, Number(ed.setting('buildSetLmbMode')));
      ed.highlight.enterSet(set, item);
    });
    return item;
  }

  // Популярность сетов (сортировка «популярные»): с сервера не чаще раза в 5 минут, в фоне
  async loadPopularity() {
    if (Date.now() - popularity.at > POPULARITY_TTL_MS) {
      popularity.loading ??= App.api
        .request('build', 'setsPopularity', {})
        .then((raw) => {
          popularity.map = new Map(Object.entries(raw || {}).map(([id, value]) => [Number(id), Number(value) || 0]).filter(([id]) => id > 0));
          popularity.at = Date.now();
        })
        .catch(() => {})
        .finally(() => (popularity.loading = null));
    }
    await popularity.loading;
    if (this.ed.alive) this.renderSets();
  }

  destroy() {
    clearTimeout(this.suppressTimer);
    clearTimeout(this.setsScrollTimer);
    this.altHint?.remove();
  }
}

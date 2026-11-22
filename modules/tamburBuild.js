// Досборка билда в тамбуре. В блоке «Билд героя» пустые слоты — мигающий «+», ЛКМ или ПКМ по
// слоту (пустому или с талантом) открывает поверх списка героев библиотеку: таланты ряда этого
// слота, которых нет в билде. Выбранный талант встаёт в слот (занятый — заменяет), правка уходит
// на сервер так же, как из окна билда (BuildSync -> build.optimisticLayout).
// Данные — те же, что у окна билда: build.data (BuildStore.fetch) и справочник build.inventory.

import { App } from './app.js';
import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { Build } from './build.js';
import { BuildClientTooltip } from './buildClientTooltip.js';
import { PreloadImages } from './preloadImages.js';
import { domAudioPresets } from './domAudioPresets.js';
import { Sound } from './sound.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';
import { Castle } from './castle.js';
import { SLOTS, ACTIVE_SLOTS, levelOfSlot } from './build/grid.js';
import { prepareTalents, isMainTalent, conflictSlots, iconUrl, REFINE_BY_RARITY } from './build/talents.js';
import { StatEngine } from './build/stats.js';
import { Sets } from './build/sets.js';
import { BuildStore } from './build/store.js';
import { BuildSync } from './build/sync.js';
import { Tooltip } from './build/tooltip.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
// как в build/library.js
const RARITIES = [
  { id: '4', name: 'titleTheRed', image: 'red' },
  { id: '3', name: 'titleTheOrange', image: 'orange' },
  { id: '2', name: 'titleThePurple', image: 'purple' },
  { id: '1', name: 'titleTheBlue', image: 'blue' },
];
const toIds = (body) => Array.from({ length: SLOTS }, (_, i) => Number(body?.[i]?.id ?? body?.[i]) || 0);

// Билд, который правят в тамбуре: его поле, панель активных, справочник талантов героя.
// Он же — «окно» для подсказки таланта (build/tooltip.js ждёт token, talents, engine, clientHost…).
class Session {
  constructor({ heroId, buildId, preview }) {
    this.heroId = Number(heroId);
    this.buildId = Number(buildId);
    this.preview = !!preview;
    this.token = ++Session.serial;
    this.destroyed = false;
    this.talents = new Map(); // id -> талант (поле и справочник)
    this.order = []; // id справочника в порядке сервера
    this.body = new Array(SLOTS).fill(null);
    this.active = new Array(ACTIVE_SLOTS).fill(0);
    this.consumables = new Array(ACTIVE_SLOTS).fill(0);
    this.loading = null;
    const session = this;
    this.clientHost = {
      talentRefineByRarity: REFINE_BY_RARITY,
      get installedTalents() {
        return session.body;
      },
      get upgradeTalents() {
        return [];
      },
      get initialStats() {
        return session.engine?.initial || {};
      },
      get heroStatsFromPower() {
        return session.engine?.fromPower || {};
      },
      baseStat: (key) => session.engine?.base(key) ?? 0,
      get profileStats() {
        return session.engine?.profile || {};
      },
      get applyRz() {
        return !!session.engine?.flags.rz;
      },
      totalStat: (key, options) => session.engine?.total(key, options) ?? 0,
    };
  }

  get alive() {
    return !this.destroyed;
  }

  inBuild(id) {
    return this.body.some((talent) => talent && Number(talent.id) === Number(id));
  }

  effectiveBody() {
    return this.body;
  }

  get ids() {
    return toIds(this.body);
  }

  load() {
    this.loading ??= (this.preview ? this.loadPreview() : this.loadServer()).catch((error) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  async loadServer() {
    const data = await BuildStore.fetch(this.heroId, this.buildId, () => this.alive);
    if (!data || !this.alive) return false;
    if (!BuildClientTooltip.prepareSync(data.hero, this.heroId, data.body)) {
      await BuildClientTooltip.prepare(data.hero, this.heroId, data.body);
      if (!this.alive) return false;
    }
    this.engine = new StatEngine(data.hero);
    prepareTalents(data.body, this.engine.initial);
    this.body = Array.from({ length: SLOTS }, (_, i) => data.body[i] || null);
    for (const talent of this.body) if (talent) this.talents.set(Number(talent.id), talent);
    this.active = Array.from({ length: ACTIVE_SLOTS }, (_, i) => Number(data.active?.[i]) || 0);
    this.consumables = Array.from({ length: ACTIVE_SLOTS }, (_, i) => Number(data.consumables?.[i]) || 0);
    this.sync = new BuildSync(this.buildId, this.body, this.active, { onReject: (result) => TamburBuild.onReject(this, result) });
    const items = BuildStore.catalog(this.heroId, this.buildId, data.body) ??
      (await BuildStore.loadCatalog(this.heroId, this.buildId, data.body, () => this.alive));
    if (!this.alive || !Array.isArray(items)) return false;
    if (!BuildClientTooltip.talentsReady(items)) {
      await BuildClientTooltip.prepareTalents(items);
      if (!this.alive) return false;
    }
    this.addCatalog(items);
    this.engine.compute(this.body);
    return true;
  }

  // DEV-превью тамбура (?previewTambur=1): выдуманные таланты, без сервера
  async loadPreview() {
    const fixture = (id, level, index) => ({ id, level, rarity: index % 4 + 1, refine: 0, active: index % 5 === 0 ? 1 : 0, stats: {}, statsRefine: {} });
    this.engine = new StatEngine({ stats: { hp: 6443, mp: 4862, sila: 195, razum: 445, provorstvo: 144, hitrost: 356, stoikost: 93, volia: 166 }, overallModifier: 1 });
    this.body = TamburBuild.previewIds.map((id, slot) => (id ? fixture(id, levelOfSlot(slot), slot) : null));
    for (const talent of this.body) if (talent) this.talents.set(Number(talent.id), talent);
    this.addCatalog(Array.from({ length: 84 }, (_, index) => fixture(index + 37, index % 6 + 1, index)));
    return true;
  }

  addCatalog(items) {
    const fresh = items.filter((item) => item && !this.talents.has(Number(item.id)));
    prepareTalents(fresh, this.engine.initial);
    for (const talent of fresh) this.talents.set(Number(talent.id), talent);
    this.order = items.filter(Boolean).map((item) => Number(item.id));
  }

  // Таланты ряда для библиотеки: нет в билде, порядок сервера, таланты одного сета рядом
  rowTalents(level) {
    const ids = this.order.filter((id) => {
      const talent = this.talents.get(id);
      return talent && Number(talent.level) === level && !this.inBuild(id);
    });
    const groups = new Map();
    for (const id of ids) {
      const group = Sets.groupOf(id);
      if (!group) continue;
      if (!groups.has(group.set.key)) groups.set(group.set.key, []);
      groups.get(group.set.key).push({ id, order: group.order });
    }
    const used = new Set();
    const result = [];
    for (const id of ids) {
      if (used.has(id)) continue;
      const group = Sets.groupOf(id);
      const members = group ? groups.get(group.set.key) : null;
      const list = members && members.length > 1 ? members.slice().sort((a, b) => a.order - b.order).map((m) => m.id) : [id];
      for (const member of list) if (!used.has(member)) used.add(member), result.push(member);
    }
    return result.map((id) => this.talents.get(id));
  }

  // Талант в слот: ссылки панели активных идут за талантами, новый активный — на свободную кнопку
  place(talent, slot) {
    const replaced = this.body[slot];
    if (replaced && isMainTalent(this.heroId, replaced)) {
      App.notify(Lang.text('mainHeroClassTalentLocked'));
      return false;
    }
    const conflicts = conflictSlots(talent, this.body).filter((s) => !(replaced && s === slot));
    if (conflicts.length) {
      App.notify(Lang.text('talentConflict'));
      return false;
    }
    const body = this.body.slice();
    body[slot] = talent;
    const active = this.active.map((item) => {
      const target = Math.abs(Number(item) || 0) - 1;
      const owner = target >= 0 ? this.body[target] : null;
      if (!item || !owner) return 0;
      const moved = body.indexOf(owner);
      return moved < 0 ? 0 : Math.sign(item) * (moved + 1);
    });
    if (Number(talent.active) === 1 && !active.some((item) => Math.abs(item) === slot + 1)) {
      const free = active.findIndex((item, index) => !item && !this.consumables[index]);
      if (free >= 0) active[free] = slot + 1;
    }
    this.body = body;
    this.active = active;
    this.engine.compute(this.body);
    this.sync?.push(this.body, this.active);
    return true;
  }

  destroy() {
    this.destroyed = true;
  }
}
Session.serial = 0;

export class TamburBuild {
  static session = null;
  static view = null; // { field, heroId, buildId, ids, onChange }
  static popup = null; // { root, slot, tooltip, cleanup }
  static previewIds = [];
  static rules = {}; // фильтр библиотеки: rarity / active — показанные значения (нет ключа — все)
  static fieldTooltip = null; // описание таланта поля
  static hovered = null;

  // Поле билда в тамбуре: картинка билда + «+» в пустых слотах + клик по слоту.
  // onChange(ids) — билд поменяли здесь (тамбур держит у себя тела билдов вкладок).
  static show(field, { heroId, buildId, body, preview = false, onChange = null }) {
    const ids = toIds(body);
    const session = TamburBuild.session;
    if (session && (session.heroId !== Number(heroId) || session.buildId !== Number(buildId) || session.preview !== preview ||
      (session.loading && session.ids.join() !== ids.join()))) {
      TamburBuild.dropSession();
    }
    if (TamburBuild.popup && (TamburBuild.view?.field !== field || TamburBuild.view?.buildId !== Number(buildId) || TamburBuild.view?.heroId !== Number(heroId))) TamburBuild.close();
    TamburBuild.fieldTooltip?.hide();
    if (preview) TamburBuild.previewIds = ids;
    TamburBuild.view = { field, heroId: Number(heroId), buildId: Number(buildId), ids, onChange, preview };
    TamburBuild.renderField();
    if (!field.dataset.tamburBuild) {
      field.dataset.tamburBuild = '1';
      const onSlot = (event) => {
        const cell = event.target.closest?.('[data-slot]');
        if (!cell || !field.contains(cell)) return;
        event.preventDefault();
        event.stopPropagation();
        TamburBuild.open(Number(cell.dataset.slot));
      };
      field.addEventListener('click', onSlot);
      field.addEventListener('contextmenu', onSlot);
      // описание таланта поля при наведении — как в окне билда
      field.addEventListener('mouseover', (event) => {
        const cell = event.target.closest?.('[data-slot]');
        if (!cell || !field.contains(cell) || cell.contains(event.relatedTarget)) return;
        TamburBuild.hoverSlot(cell);
      });
      field.addEventListener('mouseleave', () => {
        TamburBuild.hovered = null;
        TamburBuild.fieldTooltip?.hide();
      });
    }
  }

  static async hoverSlot(cell) {
    TamburBuild.hovered = cell;
    const view = TamburBuild.view;
    const id = view?.ids[Number(cell.dataset.slot)];
    if (!id) return TamburBuild.fieldTooltip?.hide();
    if (!view.preview && !(view.buildId > 0)) return;
    const session = TamburBuild.ensureSession();
    try {
      if (!(await session.load())) return;
    } catch {
      return;
    }
    if (TamburBuild.hovered !== cell || !cell.isConnected || TamburBuild.session !== session) return;
    const talent = session.talents.get(Number(id));
    if (!talent) return;
    if (TamburBuild.fieldTooltip?.ed !== session) {
      TamburBuild.fieldTooltip?.destroy();
      TamburBuild.fieldTooltip = new Tooltip(session);
    }
    TamburBuild.fieldTooltip.showTalent(cell, talent);
  }

  static renderField() {
    const view = TamburBuild.view;
    if (!view?.field) return;
    TamburBuild.fieldTooltip?.hide();
    TamburBuild.hovered = null;
    const model = Build.viewModel(view.ids, false, false);
    model.classList.add('tambur-build');
    [...model.querySelectorAll('.build-body-row > div')].forEach((cell, slot) => {
      cell.dataset.slot = slot;
      cell.classList.add('tambur-build-slot');
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', `${Lang.text('library')} ${ROMAN[levelOfSlot(slot)]}`);
      if (TamburBuild.popup?.slot === slot) cell.classList.add('tambur-build-slot--open');
      if (!view.ids[slot]) cell.append(DOM({ style: 'tambur-build-plus' }));
    });
    view.field.replaceChildren(model);
  }

  static dropSession() {
    TamburBuild.fieldTooltip?.destroy();
    TamburBuild.fieldTooltip = null;
    TamburBuild.session?.destroy();
    TamburBuild.session = null;
  }

  static ensureSession() {
    const view = TamburBuild.view;
    if (!TamburBuild.session) TamburBuild.session = new Session({ heroId: view.heroId, buildId: view.buildId, preview: view.preview });
    return TamburBuild.session;
  }

  // Библиотека ряда слота — поверх списка героев
  static async open(slot) {
    const view = TamburBuild.view;
    if (!view?.field?.isConnected) return;
    if (!view.preview && !(view.buildId > 0)) return;
    if (view.ids[slot] && isMainTalent(view.heroId, { id: view.ids[slot] })) {
      App.notify(Lang.text('mainHeroClassTalentLocked'));
      return;
    }
    const column = view.field.closest('.mm-lobby')?.querySelector('.mm-lobby-middle-hero-column');
    if (!column) return;
    if (TamburBuild.popup?.slot === slot) return TamburBuild.close();
    const level = levelOfSlot(slot);
    const session = TamburBuild.ensureSession();
    // окно уже открыто — только другой слот: новая строка и список, без переоткрытия
    const current = TamburBuild.popup;
    if (current && current.session === session && current.root.parentNode === column) {
      current.slot = slot;
      current.row.textContent = `${Lang.text('tamburBuildRow')} ${ROMAN[level]}`;
      TamburBuild.renderField();
      if (current.ready) {
        TamburBuild.renderLibrary();
        current.list.scrollTop = 0;
      }
      return;
    }
    TamburBuild.close();
    const list = DOM({ style: ['build-talents', 'tambur-library-list'] });
    const closeButton = DOM(
      { tag: 'button', type: 'button', style: ['close-button', 'tambur-library-close'], domaudio: domAudioPresets.closeButton, title: Lang.text('titleClose'), ariaLabel: Lang.text('titleClose'), event: ['click', () => TamburBuild.close()] },
      DOM({ tag: 'img', src: 'content/icons/close-cropped.svg', alt: '', style: 'close-image-style' }),
    );
    const row = DOM({ style: 'tambur-library-row' }, `${Lang.text('tamburBuildRow')} ${ROMAN[level]}`);
    const root = DOM(
      { style: 'tambur-library', role: 'dialog', ariaLabel: Lang.text('library') },
      DOM({ style: 'tambur-library-title' }, DOM({ tag: 'span' }, Lang.text('library')), row),
      closeButton,
    );
    const rarityView = TamburBuild.buildRarity();
    root.append(rarityView, list);
    const tooltip = new Tooltip(session);
    const popup = { root, slot, row, tooltip, list, rarityView, session, ready: false, cleanups: [] };
    TamburBuild.popup = popup;
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      popup.cleanups.push(() => target.removeEventListener(type, handler, options));
    };
    listen(document, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      TamburBuild.close();
    }, true);
    listen(document, 'pointerdown', (event) => {
      if (root.contains(event.target) || view.field.contains(event.target)) return;
      TamburBuild.close();
    }, true);
    list.addEventListener('scroll', () => tooltip.hide(), { passive: true });
    column.append(root);
    TamburBuild.renderField();

    list.append(DOM({ style: 'tambur-library-empty' }, Lang.text('tamburBuildLoading')));
    try {
      if (!(await session.load())) return;
    } catch (error) {
      if (TamburBuild.popup === popup) list.replaceChildren(DOM({ style: 'tambur-library-empty' }, Lang.text('tamburBuildLoadError')));
      console.error('tamburBuild', error);
      return;
    }
    if (TamburBuild.popup !== popup || TamburBuild.session !== session) return;
    // билд на сервере отличается от показанного (правка с другого устройства) — показать серверный
    if (session.ids.join() !== view.ids.join()) TamburBuild.applyIds(session.ids);
    popup.ready = true;
    TamburBuild.renderLibrary();
  }

  static renderLibrary() {
    const popup = TamburBuild.popup;
    if (!popup) return;
    const { session, list, slot, tooltip } = popup;
    TamburBuild.syncFilters();
    const rules = TamburBuild.rules;
    // как в библиотеке окна билда: у таланта без поля (классовые без редкости) фильтр его скрывает
    const rowTalents = session.rowTalents(levelOfSlot(slot));
    const talents = rowTalents.filter((talent) =>
      Object.keys(rules).every((key) => key in talent && rules[key].includes(`${talent[key]}`)));
    tooltip.hide();
    if (!talents.length) {
      list.replaceChildren(DOM({ style: 'tambur-library-empty' }, Lang.text(rowTalents.length ? 'tamburBuildFilterEmpty' : 'tamburBuildRowEmpty')));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const talent of talents) {
      const id = Number(talent.id);
      const node = DOM({ domaudio: domAudioPresets.talent, style: 'build-talent-item' });
      node.dataset.id = id;
      node.dataset.active = talent.active;
      node.dataset.state = 1;
      node.dataset.url = iconUrl(id);
      node.dataset.fallback = 'clientTalentIcon';
      node.ondragstart = () => false;
      new PreloadImages().add(node, document.createDocumentFragment());
      node.addEventListener('mouseenter', () => tooltip.showTalent(node, talent));
      node.addEventListener('mouseleave', () => tooltip.hide());
      const pick = (event) => {
        event.preventDefault();
        TamburBuild.pick(talent);
      };
      node.addEventListener('click', pick);
      node.addEventListener('contextmenu', pick);
      fragment.append(DOM({ style: 'build-talent-item-container' }, node));
    }
    list.replaceChildren(fragment);
  }

  // Фильтр по редкости и активным — как в окне билда (build/library.js buildRarity):
  // камень ЛКМ — показать/скрыть редкость, ПКМ — только она; «активные» ЛКМ — только активные,
  // ПКМ — скрыть/показать активные. Выбор держится, пока открыт тамбур.
  static buildRarity() {
    const view = DOM({ style: ['build-rarity', 'tambur-library-rarity'] });
    const rules = () => TamburBuild.rules;
    const setRule = (key, values) => {
      if (values) rules()[key] = values;
      else delete rules()[key];
      TamburBuild.renderLibrary();
    };
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
      button.addEventListener('click', () => Sound.play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, { id: 'ui-small-click', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) }));
      view.append(button);
    };
    const active = DOM({ style: 'build-rarity-other' });
    prepare(active, 'active', 'active', Lang.text('buildActiveFilterTooltip'));
    active.addEventListener('click', () => {
      delete rules().rarity;
      setRule('active', ['1']);
    });
    active.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      setRule('active', active.dataset.active === '1' ? ['0'] : null);
    });
    for (const rarity of RARITIES) {
      const button = DOM({ data: { rarityId: rarity.id } });
      prepare(button, rarity.image, 'rarity', Lang.text('talentQualityTitle').replace('{name}', Lang.text(rarity.name)));
      button.addEventListener('click', () => {
        const selected = new Set(rules().rarity ?? RARITIES.map((r) => r.id));
        if (selected.has(rarity.id)) selected.delete(rarity.id);
        else selected.add(rarity.id);
        setRule('rarity', selected.size === RARITIES.length ? null : [...selected]);
      });
      // ПКМ — только эта редкость; по уже единственной — снова все (как у фильтра рядов)
      button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        delete rules().active;
        const solo = rules().rarity?.length === 1 && rules().rarity[0] === rarity.id;
        setRule('rarity', solo ? null : [rarity.id]);
      });
    }
    return view;
  }

  static syncFilters() {
    const view = TamburBuild.popup?.rarityView;
    if (!view) return;
    const rules = TamburBuild.rules;
    for (const button of view.querySelectorAll('[data-filter-kind]')) {
      const isActive = button.dataset.filterKind === 'active';
      const on = isActive ? !rules.active || rules.active.includes('1') : !rules.rarity || rules.rarity.includes(button.dataset.rarityId);
      if (button.dataset.active === (on ? '1' : '0') && button.style.backgroundImage) continue;
      button.dataset.active = on ? '1' : '0';
      button.setAttribute('aria-checked', String(on));
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

  static pick(talent) {
    const popup = TamburBuild.popup;
    if (!popup) return;
    if (!popup.session.place(talent, popup.slot)) return;
    TamburBuild.close();
    TamburBuild.applyIds(popup.session.ids);
  }

  // Поле тамбура и тело билда вкладки — по новому билду
  static applyIds(ids) {
    const view = TamburBuild.view;
    if (!view) return;
    view.ids = ids.slice();
    if (view.preview) TamburBuild.previewIds = view.ids;
    TamburBuild.renderField();
    view.onChange?.(view.ids.slice());
  }

  // Сервер не принял правку: его состояние — на поле, при следующем открытии билд читается заново
  static onReject(session, { reason, body }) {
    const key = reason ? `${reason}` : 'talentAnomalyUnknown';
    const text = Lang.text(key);
    App.notify(text && text !== key ? text : Lang.text('talentAnomalyUnknown'));
    if (TamburBuild.session !== session) return;
    TamburBuild.dropSession();
    TamburBuild.close();
    if (Array.isArray(body) && TamburBuild.view?.buildId === session.buildId) TamburBuild.applyIds(toIds(body));
  }

  static close() {
    const popup = TamburBuild.popup;
    if (!popup) return;
    TamburBuild.popup = null;
    for (const cleanup of popup.cleanups.splice(0)) cleanup();
    popup.tooltip.destroy();
    popup.root.remove();
    TamburBuild.renderField();
  }

  // Тамбур закрыт
  static reset() {
    TamburBuild.close();
    TamburBuild.dropSession();
    TamburBuild.view = null;
    TamburBuild.rules = {};
  }
}

// тамбур закрылся (бой, отмена, выкинуло) — библиотека и описание уходят вместе с ним
if (typeof window !== 'undefined') window.addEventListener('pw:mm-close', () => TamburBuild.reset());

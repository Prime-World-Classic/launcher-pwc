// Окно билда: состояние (поле, панель активных, справочник талантов героя) и все правки.
// Любое действие строит новое поле/панель и проходит через commit(): перерисовка из состояния,
// анимация перелёта, отправка итога на сервер (BuildSync). Интерфейс — в соседних модулях.

import { App } from '../app.js';
import { View } from '../view.js';
import { Window } from '../window.js';
import { Lang } from '../lang.js';
import { DOM } from '../dom.js';
import { MM } from '../mm.js';
import { Settings } from '../settings.js';
import { PreloadImages } from '../preloadImages.js';
import { KeybindStore } from '../keybindings/keybindings.store.js';
import { TalentData } from '../talentData.js';
import { BuildClientTooltip } from '../buildClientTooltip.js';
import { domAudioPresets } from '../domAudioPresets.js';
import { SLOTS, ACTIVE_SLOTS, emptyActive, levelOfSlot, rowSlots, firstEmptySlot, activeTarget, activeIndexOf } from './grid.js';
import { prepareTalents, isMainTalent, conflictSlots, iconUrl, REFINE_BY_RARITY } from './talents.js';
import { StatEngine } from './stats.js';
import { Combat } from './combat.js';
import { Sets } from './sets.js';
import { sortSetsIntoColumns, mirrorOrGather } from './arrange.js';
import { BuildSync } from './sync.js';
import { BuildStore } from './store.js';
import { capture, play, animateVanish } from './anim.js';
import { Tooltip } from './tooltip.js';
import { Library } from './library.js';
import { HeroPanel, avatarBackground, installHeroNavKeys } from './heroPanel.js';
import { BuildActions } from './actions.js';
import { BuildSettings } from './settings.js';
import { Highlight } from './highlight.js';
import { TalentInput } from './input.js';
import { Consumables } from './consumables.js';

let initCounter = 0;

export class BuildEditor {
  static opening = null; // последнее открываемое окно: более раннее открытие устарело
  static shown = null; // окно на экране
  static onHeroSkinChanged = null; // вкладка «Герой» обновляет кнопку выбора облика

  constructor({ heroId, targetId, isWindow, preview }) {
    BuildEditor.opening = this;
    BuildEditor.installKeys();
    this.token = ++initCounter;
    this.destroyed = false;
    this.heroId = Number(heroId);
    this.targetId = targetId;
    this.isWindow = isWindow;
    this.preview = preview; // данные DEV-превью (?previewBuild=1) — без сервера и правок
    this.talents = new Map(); // id -> талант (справочник героя и поле)
    this.nodes = new Map(); // id -> иконка таланта (одна на талант: поле или библиотека)
    this.body = new Array(SLOTS).fill(null);
    this.active = emptyActive();
    this.combat = null;
    this.cleanups = [];
    this.binds = preview
      ? preview.binds
      : Array.from({ length: ACTIVE_SLOTS }, (_, i) => KeybindStore.getBind(`cmd_action_bar_slot${i + 1}`));

    // разметка окна (View.build собирает её в окно)
    this.fieldView = DOM({ style: 'build-field' });
    this.levelView = DOM({ style: 'build-level' });
    this.activeBarView = DOM({ style: 'build-active-bar' });
    this.activeBarKeybindingsView = DOM({ style: 'build-active-bar' });
    this.cells = [];
    for (let level = 6; level >= 1; level--) {
      const row = DOM({ style: 'build-field-row', id: `bfr${level}`, data: { level } });
      for (const slot of rowSlots(level)) {
        const cell = DOM({ style: 'build-hero-grid-item', data: { position: slot } });
        this.cells[slot] = cell;
        row.append(cell);
      }
      this.fieldView.append(row);
    }
    this.activeSlots = Array.from({ length: ACTIVE_SLOTS }, (_, index) =>
      DOM({ domaudio: domAudioPresets.defaultButton, style: 'build-active-bar-item', data: { index, active: 0 } }),
    );
    this.activeBarView.append(...this.activeSlots);
    this.activeBarKeybindingsView.append(...this.activeSlots.map((_, i) => DOM({ style: 'build-active-bar-key' }, this.keyName(i))));

    this.tooltip = new Tooltip(this);
    this.descriptionView = this.tooltip.view;
    this.highlight = new Highlight(this);
    this.consumables = new Consumables(this);
    this.settings = new BuildSettings(this);
    this.library = new Library(this);
    this.heroPanel = new HeroPanel(this);
    this.actions = new BuildActions(this);
    this.input = new TalentInput(this);

    // Мост для подсказок из данных игры (BuildClientTooltip): герой билда и его статы
    const ed = this;
    this.clientHost = {
      talentRefineByRarity: REFINE_BY_RARITY,
      get installedTalents() {
        return ed.effectiveBody();
      },
      // улучшения от других талантов в подсказке — только в боевом режиме и от изученных
      get upgradeTalents() {
        return ed.combat ? ed.effectiveBody() : [];
      },
      get initialStats() {
        return ed.engine?.initial || {};
      },
      get heroStatsFromPower() {
        return ed.engine?.fromPower || {};
      },
      get profileStats() {
        return ed.engine?.profile || {};
      },
      get applyRz() {
        return !!ed.engine?.flags.rz;
      },
      totalStat: (key, options) => ed.engine?.total(key, options) ?? 0,
    };
  }

  // окно не закрыто (асинхронные ответы ещё нужны)
  get alive() {
    return !this.destroyed;
  }

  // это открытие не устарело: после него не начали открывать другое окно
  get current() {
    return !this.destroyed && BuildEditor.opening === this;
  }

  static installKeys() {
    const shown = () => BuildEditor.shown;
    installHeroNavKeys(shown);
    Library.installKeys(shown);
  }

  // Окно встало на экран: прежнее закрывается, его панели подсказок — тоже
  show() {
    if (BuildEditor.shown !== this) BuildEditor.shown?.destroy();
    BuildEditor.shown = this;
    for (const view of document.querySelectorAll('.build-description')) if (view !== this.descriptionView) view.remove();
  }

  // Облик героя: сервер, список героев, аватар окна, герой внизу замка
  static async changeSkin(heroId, skinId) {
    await App.api.request('build', 'skinChange', { hero: heroId, skin: skinId });
    const hero = MM.hero?.find?.((item) => item.id == heroId);
    if (hero) hero.skin = skinId;
    const shown = BuildEditor.shown;
    if (shown && shown.heroId === Number(heroId) && shown.heroPanel.avatar) avatarBackground(shown.heroPanel.avatar, heroId, skinId);
    BuildEditor.onHeroSkinChanged?.();
    try {
      const item = View.castleBottom.querySelector(`#id${heroId}`);
      item.style.backgroundImage = `url(content/hero/${heroId}/${skinId}.webp)`;
      item.querySelector('.castle-item-hero-name').firstChild.innerText = Lang.heroName(heroId, skinId);
    } catch (e) {
      App.error(e);
    }
  }

  changeSkin(heroId, skinId) {
    return BuildEditor.changeSkin(heroId, skinId);
  }

  keyName(index) {
    const keys = this.binds?.[index]?.keys;
    return Array.isArray(keys) && keys.length ? keys.join('+') : '';
  }

  // --- Загрузка -----------------------------------------------------------------------------

  async open() {
    BuildStore.watch();
    const cached = this.preview ? null : BuildStore.cached(this.heroId, this.targetId);
    const data = this.preview
      ? structuredClone(this.preview)
      : cached
        ? cached.data
        : await BuildStore.fetch(this.heroId, this.targetId, () => this.current);
    if (!this.current || !data) return false;
    this.data = data;
    this.buildId = data.id;
    // базовые статы и прирост героя — из его HROB в данных игры; таланты билда должны быть
    // прочитаны, чтобы поле сразу взяло их статы из игры
    if (!BuildClientTooltip.prepareSync(data.hero, this.heroId, data.body)) {
      await BuildClientTooltip.prepare(data.hero, this.heroId, data.body);
      if (!this.current) return false;
    }
    this.engine = new StatEngine(data.hero);
    this.applyServerBody(data.body, data.active);
    this.consumables.load(data.consumables);
    if (!this.preview) {
      this.sync = new BuildSync(this.buildId, this.body, this.active, { onReject: (result) => this.onReject(result) });
    }

    this.library.build();
    this.heroPanel.build(data);
    this.actions.build(data.build);
    this.render();
    this.library.load();

    if (!this.preview) {
      if (cached) this.confirmCached(cached.json);
      BuildStore.onBodySaved = () => this.schedulePrefetch(1500);
      this.schedulePrefetch();
    }
    return true;
  }

  // поле и панель как пришли с сервера (таланты — с данными talent_data и игры)
  applyServerBody(body, active) {
    prepareTalents(body, this.engine.initial);
    this.body = Array.from({ length: SLOTS }, (_, i) => body[i] || null);
    for (const talent of this.body) if (talent) this.talents.set(Number(talent.id), talent);
    this.active = Array.from({ length: ACTIVE_SLOTS }, (_, i) => Number(active?.[i]) || 0);
  }

  // Окно открыто из кэша: build.data делает билд выбранным на сервере и приносит свежие данные.
  // Отличаются от показанных (правка с другого устройства, рейтинг после боя) — окно заново.
  async confirmCached(shownJson) {
    const gen = BuildStore.gen;
    let fresh = null;
    try {
      fresh = await BuildStore.fetch(this.heroId, this.targetId, () => this.current);
    } catch {
      return;
    }
    if (!fresh || !this.current || BuildStore.gen !== gen || JSON.stringify(fresh) === shownJson) return;
    const at = Date.now();
    // одна перерисовка на билд за 10 с: если ответы сервера «плавают», не крутимся в цикле
    const key = `${this.heroId}:${fresh.id}`;
    if (BuildEditor._redraw?.key === key && at - BuildEditor._redraw.at < 10000) return;
    BuildEditor._redraw = { key, at };
    this.reopen(this.targetId);
  }

  schedulePrefetch(delay = 400) {
    clearTimeout(this._prefetchTimer);
    this._prefetchTimer = setTimeout(() => {
      if (!this.alive || this.preview) return;
      BuildStore.prefetch(this.heroId, this.data.build || [], () => this.alive, () => this.sync?.idle());
    }, delay);
  }

  // Открыть билд героя заново (вкладка, создание, сброс): окно или вид — как сейчас
  reopen(buildId = 0) {
    return this.isWindow ? Window.show('main', 'build', this.heroId, buildId, true) : View.show('build', this.heroId, buildId);
  }

  // --- Состояние --------------------------------------------------------------------------

  inBuild(id) {
    return this.body.some((talent) => talent && Number(talent.id) === Number(id));
  }

  slotOf(id) {
    return this.body.findIndex((talent) => talent && Number(talent.id) === Number(id));
  }

  get mainSlot() {
    return this.body.findIndex((talent) => isMainTalent(this.heroId, talent));
  }

  // таланты, которые сейчас считаются (в боевом режиме — только изученные)
  effectiveBody() {
    if (!this.combat) return this.body;
    const learned = this.combat.learned;
    return this.body.map((talent, slot) => (learned.has(slot) ? talent : null));
  }

  // Ссылки панели идут за талантами: после перестановок поля талант остаётся на своей кнопке
  followActive(body, active = this.active) {
    return active.map((item) => {
      const talent = this.body[activeTarget(item)];
      if (!item || !talent) return 0;
      const slot = body.indexOf(talent);
      return slot < 0 ? 0 : Math.sign(item) * (slot + 1);
    });
  }

  // свободная кнопка: без таланта и без расходников
  freeActiveIndex(active) {
    return active.findIndex((item, index) => !item && !this.consumables.hasConsumables(index));
  }

  // активный талант, поставленный на поле, — на первую свободную кнопку панели
  withAutoActive(body, active, talent) {
    const slot = body.indexOf(talent);
    if (!talent?.active || slot < 0 || activeIndexOf(active, slot) >= 0) return active;
    const free = this.freeActiveIndex(active);
    if (free >= 0) active[free] = slot + 1;
    return active;
  }

  // --- Применение правок --------------------------------------------------------------------

  commit(body, active, { drop = null } = {}) {
    const before = capture(this.animatedNodes());
    this.body = body;
    this.active = active;
    this.combat = null; // поле изменилось — порядок изучения больше не про него
    this.render();
    // летят и те, кто ушёл с поля в библиотеку (снятый, вытесненный)
    const after = new Map(this.animatedNodes());
    for (const key of [...before.keys(), drop?.key]) {
      if (key?.[0] === 't' && !after.has(key)) after.set(key, this.nodes.get(Number(key.slice(1))));
    }
    play(before, after, drop ? new Map([[drop.key, drop.rect]]) : new Map());
    this.sync?.push(this.body, this.active);
    this.afterChange();
  }

  commitActive(active, options) {
    this.commit(this.body, active, options);
  }

  // таланты поля и панели по ключам — для анимации перелёта
  animatedNodes() {
    const entries = [];
    for (const talent of this.body) if (talent) entries.push([`t${talent.id}`, this.nodes.get(Number(talent.id))]);
    this.activeSlots.forEach((slot) => {
      const icon = slot.querySelector(':scope > .build-talent-item');
      if (icon) entries.push([`a${icon.dataset.id}`, icon]);
    });
    return entries;
  }

  afterChange() {
    this.highlight.refresh();
    this.tooltip.refresh();
    this.actions.sync();
  }

  onReject({ reason, body, active }) {
    const key = reason ? `${reason}` : 'talentAnomalyUnknown';
    const text = Lang.text(key);
    App.notify(text && text !== key ? text : Lang.text('talentAnomalyUnknown'));
    if (!this.alive) return;
    const restored = body?.map((id) => (id ? this.talents.get(id) : null));
    if (restored && restored.every((talent, i) => talent || !body[i])) {
      this.body = restored;
      this.active = [...active];
      this.combat = null;
      this.render();
      this.afterChange();
    } else this.reloadFromServer();
  }

  // Билд с сервера заново (сервер отказал, а его состояние неизвестно)
  async reloadFromServer() {
    const token = this.token;
    try {
      const data = await BuildStore.fetch(this.heroId, this.buildId, () => this.alive && token === this.token);
      if (!data || !this.alive) return;
      this.applyServerBody(data.body, data.active);
      this.sync = new BuildSync(this.buildId, this.body, this.active, { onReject: (result) => this.onReject(result) });
      this.combat = null;
      this.render();
      this.afterChange();
    } catch {}
  }

  // --- Отрисовка ----------------------------------------------------------------------------

  nodeFor(talent) {
    const id = Number(talent.id);
    let node = this.nodes.get(id);
    if (!node) {
      node = DOM({ domaudio: domAudioPresets.talent, style: 'build-talent-item' });
      node.dataset.id = id;
      node.dataset.active = talent.active;
      node.dataset.url = iconUrl(id);
      // нет своей иконки (новый талант) — иконка из данных игры
      node.dataset.fallback = 'clientTalentIcon';
      // игра не даёт включить смарткаст этому таланту — у его кнопки на панели нет переключателя
      if (!TalentData.canSmartcast(id)) node.dataset.smartcast = '0';
      if (talent.level == 0) node.style.display = 'none';
      node.ondragstart = () => false;
      this.nodes.set(id, node);
      new PreloadImages().add(node, document.createDocumentFragment());
    }
    return node;
  }

  render() {
    this.renderField();
    this.renderActive();
    this.library.render();
    this.renderStats();
  }

  renderField() {
    const learned = this.combat?.learned;
    this.fieldView.classList.toggle('build-combat-mode-on', !!this.combat);
    this.body.forEach((talent, slot) => {
      const cell = this.cells[slot];
      const node = talent ? this.nodeFor(talent) : null;
      const current = cell.querySelector(':scope > .build-talent-item');
      if (current !== node) {
        current?.remove();
        if (node) cell.append(node);
      }
      if (!node) return;
      node.dataset.state = 2;
      node.querySelector('.build-combat-order-badge')?.remove();
      node.classList.remove('build-combat-learned', 'build-combat-locked', 'build-combat-surrounded-blink');
      if (!learned) return;
      const state = this.combat.slotState(slot);
      if (state.order) {
        node.classList.add('build-combat-learned');
        node.append(DOM({ style: 'build-combat-order-badge' }, String(state.order)));
      } else {
        node.classList.toggle('build-combat-locked', state.locked);
        node.classList.toggle('build-combat-surrounded-blink', state.enclosed);
      }
    });
  }

  renderActive() {
    this.activeSlots.forEach((slot, index) => {
      const item = this.active[index];
      const talent = this.body[activeTarget(item)];
      slot.querySelector(':scope > .build-talent-item')?.remove();
      this.consumables.renderSlot(slot, index, !!(item && talent));
      if (item && talent) {
        const source = this.nodeFor(talent);
        const icon = source.cloneNode(false);
        icon.className = 'build-talent-item';
        icon.dataset.state = 3;
        icon.dataset.position = activeTarget(item);
        Object.assign(icon.style, { opacity: 1, position: 'static', backgroundImage: source.style.backgroundImage || `url("${source.dataset.url}")` });
        slot.append(icon);
      }
      // смарткаст: знак минус; таланту, который игра не смарткастит, — не показываем
      const smart = item < 0 && !!talent && TalentData.canSmartcast(talent.id);
      slot.classList.toggle('smartcast', smart);
      slot.dataset.active = smart ? 1 : 0;
      slot.setAttribute('aria-label', Lang.text(smart ? 'titleSmartcastIsEnabled' : 'titleSmartcastIsDisabled'));
    });
  }

  renderStats() {
    this.engine.combat = this.combat;
    this.engine.compute(this.body);
    this.heroPanel.update();
  }

  // --- Таланты: поле, библиотека, панель ----------------------------------------------------

  notifyLocked() {
    App.notify(Lang.text('mainHeroClassTalentLocked'));
  }

  // Талант из библиотеки — в слот (занят — замена, вытесненный уходит в библиотеку)
  place(talent, slot, { drop } = {}) {
    if (!talent || slot < 0 || levelOfSlot(slot) !== Number(talent.level)) return false;
    const replaced = this.body[slot];
    if (replaced && isMainTalent(this.heroId, replaced)) {
      this.notifyLocked();
      return false;
    }
    // конфликт разрешён, только если конфликтует сам заменяемый талант
    const conflicts = conflictSlots(talent, this.body).filter((s) => !(replaced && s === slot));
    if (conflicts.length) {
      App.notify(Lang.text('talentConflict'));
      return false;
    }
    const body = this.body.slice();
    body[slot] = talent;
    if (replaced) this.library.putFirst(replaced.id, talent.id);
    this.commit(body, this.withAutoActive(body, this.followActive(body), talent), { drop });
    return true;
  }

  // Клик по таланту библиотеки: в первый свободный слот его ряда слева
  placeFirstFree(talent) {
    const slot = firstEmptySlot(this.body, talent.level, true);
    return slot >= 0 && this.place(talent, slot);
  }

  // Талант с поля — в библиотеку (первым в списке)
  remove(slot, { drop } = {}) {
    const talent = this.body[slot];
    if (!talent) return false;
    if (isMainTalent(this.heroId, talent)) {
      this.notifyLocked();
      return false;
    }
    const body = this.body.slice();
    body[slot] = null;
    this.library.putFirst(talent.id);
    this.commit(body, this.followActive(body), { drop });
    return true;
  }

  // Перенос по полю в своём ряду: на пустой слот или обмен
  move(from, to, { drop } = {}) {
    const talent = this.body[from];
    if (!talent || from === to || levelOfSlot(to) !== levelOfSlot(from)) return false;
    const body = this.body.slice();
    body[from] = body[to];
    body[to] = talent;
    this.commit(body, this.followActive(body), { drop });
    return true;
  }

  // Талант поля — на кнопку панели (кнопка занята — прежний талант с неё снимается)
  assignActive(slot, index, { drop } = {}) {
    const talent = this.body[slot];
    if (!talent || Number(talent.active) !== 1) return false;
    const active = this.active.map((item) => (activeTarget(item) === slot ? 0 : item));
    active[index] = slot + 1;
    // талант вытесняет расходники кнопки
    this.consumables.clearSilently(index);
    this.commitActive(active, { drop });
    return true;
  }

  // Кнопка панели -> другая кнопка: обмен или перенос, смарткаст едет с талантом, расходники — с кнопкой
  moveActive(from, to, { drop } = {}) {
    if (from === to) return false;
    const active = this.active.slice();
    [active[from], active[to]] = [active[to], active[from]];
    this.consumables.swapSilently(from, to);
    this.commitActive(active, { drop });
    return true;
  }

  clearActive(index, rect = null) {
    if (!this.active[index]) return false;
    const icon = this.activeSlots[index].firstElementChild;
    if (icon) animateVanish(icon, rect);
    const active = this.active.slice();
    active[index] = 0;
    this.commitActive(active);
    return true;
  }

  toggleSmartcast(index) {
    const talent = this.body[activeTarget(this.active[index])];
    if (!talent || !TalentData.canSmartcast(talent.id)) return;
    const active = this.active.slice();
    active[index] = -active[index];
    this.commitActive(active);
  }

  // ПКМ по активному таланту поля, которого нет на панели, — на первую свободную кнопку
  addToFreeActive(slot) {
    const talent = this.body[slot];
    if (!talent || Number(talent.active) !== 1 || activeIndexOf(this.active, slot) >= 0) return false;
    const free = this.freeActiveIndex(this.active);
    if (free < 0) return false;
    const active = this.active.slice();
    active[free] = slot + 1;
    this.commitActive(active);
    return true;
  }

  // --- Сеты ---------------------------------------------------------------------------------

  // Недостающие таланты сета — в свободные слоты их рядов (справа налево), по приоритету статов
  applySet(set) {
    const body = this.body.slice();
    let active = this.followActive(body);
    for (const id of this.highlight.setOrder(set)) {
      const talent = this.talents.get(id);
      if (!talent || !(talent.level > 0) || body.includes(talent)) continue;
      if (conflictSlots(talent, body).length) {
        App.notify(Lang.text('talentConflict'));
        continue;
      }
      const slot = firstEmptySlot(body, talent.level);
      if (slot < 0) continue;
      body[slot] = talent;
      active = this.withAutoActive(body, active, talent);
    }
    this.commit(body, active);
  }

  removeSet(set) {
    const ids = new Set(set.ids);
    const body = this.body.map((talent) => (talent && ids.has(Number(talent.id)) && !isMainTalent(this.heroId, talent) ? null : talent));
    for (const talent of this.body) if (talent && !body.includes(talent)) this.library.putFirst(talent.id);
    this.commit(body, this.followActive(body));
  }

  // --- Перестановки поля целиком ----------------------------------------------------------

  // ЛКМ по кнопке: таланты сетов — по колонкам (два прохода: второй дотягивает первый)
  sortSets() {
    if (this.combat) return;
    const body = sortSetsIntoColumns(sortSetsIntoColumns(this.body));
    this.commit(body, this.followActive(body));
  }

  // ПКМ по кнопке: зеркало (классовые не на своей стороне — собрать их и разложить сеты)
  mirror() {
    if (this.combat) return;
    const body = mirrorOrGather(this.body);
    this.commit(body, this.followActive(body));
  }

  // --- Боевой режим -------------------------------------------------------------------------

  canCombat() {
    return this.body.every(Boolean) && this.mainSlot >= 0;
  }

  setCombat(enabled) {
    this.combat = enabled && this.canCombat() ? new Combat(this.body, this.mainSlot) : null;
    this.renderField();
    this.renderStats();
    this.afterChange();
  }

  combatChanged() {
    this.renderField();
    this.renderStats();
    this.afterChange();
  }

  listen(target, type, handler, options = true) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (BuildEditor.shown === this) BuildEditor.shown = null;
    clearTimeout(this._prefetchTimer);
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {}
    }
    this.input.cancel();
    this.consumables.destroy();
    this.highlight.destroy();
    this.library.destroy();
    this.heroPanel.destroy();
    this.settings.destroy();
    this.tooltip.destroy();
  }

  // настройки окна (Settings.settings) с проверкой значений
  setting(name) {
    return this.settings.get(name);
  }
}

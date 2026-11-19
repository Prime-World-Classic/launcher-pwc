import { App } from './app.js';
import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { MM } from './mm.js';
import { View } from './view.js';
import { HeroFrame } from './heroFrame.js';
import { Shop } from './shop.js';

// Рамка для отдельного героя: кнопка «Рамка» под портретом в списке героев замка (и у выбора образа
// в тамбуре — для выбранного там героя) и окно выбора из купленных рамок. В тамбуре бэкенд рассылает
// новую рамку союзникам событием MMFrame (mm/mmtest refreshLobbyFrame), в бой она берётся при старте. Хранит бэкенд (pw-api build.heroFrame, таблица hero_user_frame), build.heroAll отдаёт
// у героя frameItem (-1 — как в ярмарке, 0 — без рамки, иначе id товара) и итоговый frameType.
// Рамка из ярмарки — рамка по умолчанию для героев без своей.
//
// Смена рамки (здесь, в ярмарке, уровень рамки у админа) меняет только картинки рамок на месте:
// узлы рамок своих героев помечены data-own-hero (HeroFrame.markOwn), список не перерисовывается.
// Карточку в пати обновляет событие PHero, которое бэкенд шлёт всем участникам, если герой там выбран.
export class HeroFrameSelect {
  static FAIR = -1;
  static NONE = 0;
  static TIER_WINS = [0, 25, 50, 75, 100];

  static picker = null;
  static pickerCleanup = null;

  // ---- данные героев

  static heroLists() {
    const lists = [MM.hero, View.castleHeroAll, View.partyHeroesCache?.list];
    return lists.filter((list, index) => Array.isArray(list) && lists.indexOf(list) === index);
  }

  static heroItems(heroId = 0) {
    const id = Number(heroId) || 0;
    const items = [];
    for (const list of HeroFrameSelect.heroLists()) {
      for (const item of list) {
        if (item && (!id || Number(item.id) === id) && !items.includes(item)) items.push(item);
      }
    }
    return items;
  }

  static hero(heroId) {
    return HeroFrameSelect.heroItems(heroId)[0] || null;
  }

  static frameItemOf(hero) {
    const value = Number(hero?.frameItem);
    return Number.isInteger(value) && value >= 0 ? value : HeroFrameSelect.FAIR;
  }

  // поменять поля героя во всех списках (MM.hero, список замка, кэш пати) и перерисовать его рамки
  static patchHero(heroId, patch) {
    for (const item of HeroFrameSelect.heroItems(heroId)) Object.assign(item, patch);
    HeroFrameSelect.refresh(heroId);
  }

  // Рамки своих героев на экране — только картинки и подписи кнопок, без перерисовки списков
  static refresh(heroId = 0) {
    const id = Number(heroId) || 0;
    document.querySelectorAll('.hero-win-frame[data-own-hero]').forEach((node) => {
      const nodeHero = Number(node.dataset.ownHero) || 0;
      if (id && nodeHero !== id) return;
      HeroFrame.apply(node, HeroFrameSelect.hero(nodeHero));
    });
    document.querySelectorAll('.hero-frame-select[data-hero-id]').forEach((button) => {
      const buttonHero = Number(button.dataset.heroId) || 0;
      if (id && buttonHero !== id) return;
      HeroFrameSelect.updateButton(button, HeroFrameSelect.hero(buttonHero));
    });
    HeroFrameSelect.refreshLobby();
  }

  // ---- тамбур: кнопка «Рамка» у выбора образа, для героя, выбранного сейчас (MM.targetHeroId)

  static lobbyFrameButton = null;

  static lobbyButton() {
    const button = DOM({ tag: 'button', style: 'mm-lobby-frame-button' }, DOM({ tag: 'span' }, Lang.text('heroFrameButton')));
    button.type = 'button';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const heroId = Number(MM.targetHeroId) || 0;
      if (!heroId || MM.preview) return;
      if (HeroFrameSelect.picker && HeroFrameSelect.picker.dataset.heroId === String(heroId)) {
        HeroFrameSelect.closePicker();
        return;
      }
      HeroFrameSelect.openPicker(heroId, button).catch((error) => App.error(error));
    });
    HeroFrameSelect.lobbyFrameButton = button;
    HeroFrameSelect.refreshLobby();
    return button;
  }

  // кнопка тамбура — под выбранного героя; свой портрет в шапке тамбура — рамка героя на нём
  static refreshLobby() {
    const button = HeroFrameSelect.lobbyFrameButton;
    const heroId = Number(MM.targetHeroId) || 0;
    if (button) {
      // сменился герой, а окно открыто для прежнего — закрыть
      if (HeroFrameSelect.picker && button.classList.contains('hero-frame-select--open') && HeroFrameSelect.picker.dataset.heroId !== String(heroId)) {
        HeroFrameSelect.closePicker();
      }
      button.disabled = !heroId || Boolean(MM.preview);
      HeroFrameSelect.updateButton(button, heroId ? HeroFrameSelect.hero(heroId) : null);
    }
    if (MM.preview || !MM.isInTambur) return;
    const player = document.getElementById(`PLAYER${App.storage?.data?.id}`);
    const playerHero = Number(player?.dataset.hero) || 0;
    const hero = playerHero ? HeroFrameSelect.hero(playerHero) : null;
    const frame = player?.querySelector('.mm-frame');
    if (frame && hero) frame.style.backgroundImage = HeroFrame.url(hero.wins, hero.frameType) || 'none';
  }

  // ---- кнопка под портретом

  static button(hero) {
    const button = DOM({ tag: 'span', style: 'hero-frame-select' }, DOM({ tag: 'span', style: 'hero-frame-select-text' }, Lang.text('heroFrameButton')));
    button.dataset.heroId = String(hero.id);
    button.setAttribute('role', 'button');
    HeroFrameSelect.updateButton(button, hero);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (HeroFrameSelect.picker && HeroFrameSelect.picker.dataset.heroId === String(hero.id)) {
        HeroFrameSelect.closePicker();
        return;
      }
      HeroFrameSelect.openPicker(Number(hero.id), button).catch((error) => App.error(error));
    });
    return button;
  }

  static updateButton(button, hero) {
    if (!button) return;
    const frameItem = HeroFrameSelect.frameItemOf(hero);
    button.classList.toggle('hero-frame-select--own', frameItem !== HeroFrameSelect.FAIR);
    button.dataset.tipTitle = Lang.text('heroFrameTitle');
    button.dataset.tip = HeroFrameSelect.choiceName(frameItem, hero);
    button.setAttribute('aria-label', `${Lang.text('heroFrameTitle')}: ${button.dataset.tip}`);
  }

  static choiceName(frameItem, hero) {
    if (frameItem === HeroFrameSelect.FAIR) return Lang.text('heroFrameFair');
    if (frameItem === HeroFrameSelect.NONE) return Lang.text('frame_no_frame');
    const type = Number(hero?.frameType) || 0;
    return type > 0 ? Lang.text(Shop.getName(2, String(type))[0]) : Lang.text('heroFrameTitle');
  }

  // ---- окно выбора

  static async purchasedFrames() {
    const list = await App.api.request('shop', 'purchase', { allCategories: true, categories: [2] });
    const frames = [];
    let fairType = 0;
    for (const item of Array.isArray(list) ? list : []) {
      if (Number(item?.categoryId) !== 2) continue;
      const id = Number(item.id) || 0;
      const type = parseInt(item.externalId, 10) || 0;
      // enabled = false — эта рамка (или «нет рамки», id 0) надета в ярмарке
      if (item.enabled === false || item.enabled === 0) fairType = id > 0 ? type : 0;
      if (id > 0 && type > 0 && !frames.some((frame) => frame.id === id)) frames.push({ id, type });
    }
    frames.sort((a, b) => a.type - b.type);
    return { frames, fairType };
  }

  static frameImage(type, wins) {
    const tier = HeroFrame.tier(wins) || 1;
    return type > 0 ? `url("content/frames/${type + tier - 1}.png")` : '';
  }

  static option({ hero, name, note, type, active, onPick }) {
    const portrait = DOM({ style: 'hero-frame-option-portrait' });
    portrait.style.backgroundImage = `url("content/hero/${hero.id}/${Number(hero.skin) > 0 ? hero.skin : 1}.webp")`;
    const frame = DOM({ style: 'hero-frame-option-frame' });
    const image = HeroFrameSelect.frameImage(type, hero.wins);
    if (image) frame.style.backgroundImage = image;
    portrait.append(frame);
    const option = DOM(
      { tag: 'button', style: ['hero-frame-option', active ? 'hero-frame-option--active' : null].filter(Boolean) },
      portrait,
      DOM({ style: 'hero-frame-option-name' }, name),
    );
    option.type = 'button';
    if (note) option.dataset.tip = note;
    option.addEventListener('click', (event) => {
      event.stopPropagation();
      onPick();
    });
    return option;
  }

  static async openPicker(heroId, anchor) {
    HeroFrameSelect.closePicker();
    const hero = HeroFrameSelect.hero(heroId);
    if (!hero) return;

    const picker = DOM({ style: 'hero-frame-picker' });
    picker.dataset.heroId = String(heroId);
    picker.setAttribute('role', 'dialog');
    picker.addEventListener('click', (event) => event.stopPropagation());
    picker.addEventListener('pointerdown', (event) => event.stopPropagation());
    const heroName = String(Lang.heroName(hero.id, hero.skin) || hero.name || '').replace(/<[^>]*>/g, '').trim();
    picker.append(DOM({ style: 'hero-frame-picker-title' }, heroName ? `${Lang.text('heroFrameTitle')} — ${heroName}` : Lang.text('heroFrameTitle')));
    const body = DOM({ style: 'hero-frame-picker-body' }, DOM({ style: 'hero-frame-picker-loading' }, '…'));
    picker.append(body);
    document.body.append(picker);
    HeroFrameSelect.picker = picker;
    // кнопка видна только при наведении на героя; пока окно открыто — остаётся видимой
    anchor.classList.add('hero-frame-select--open');
    HeroFrameSelect.placePicker(picker, anchor);

    // нажатие вне окна (кроме своей кнопки: она сама открывает/закрывает окно) или Esc — закрыть
    const close = (event) => {
      if (event?.type === 'keydown') {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        event.preventDefault();
      } else if (picker.contains(event?.target) || anchor.contains(event?.target)) {
        return;
      }
      HeroFrameSelect.closePicker();
    };
    const onResize = () => HeroFrameSelect.closePicker();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('resize', onResize);
    View.castleBottom?.addEventListener('scroll', onResize, { passive: true });
    HeroFrameSelect.pickerCleanup = () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('resize', onResize);
      View.castleBottom?.removeEventListener('scroll', onResize);
    };

    let data;
    try {
      data = await HeroFrameSelect.purchasedFrames();
    } catch (error) {
      if (HeroFrameSelect.picker === picker) HeroFrameSelect.closePicker();
      throw error;
    }
    if (HeroFrameSelect.picker !== picker) return;

    const current = HeroFrameSelect.frameItemOf(hero);
    const pick = (frameItem, frameType) => {
      HeroFrameSelect.closePicker();
      HeroFrameSelect.choose(heroId, frameItem, frameType).catch((error) => App.error(error));
    };
    const options = [
      HeroFrameSelect.option({
        hero, name: Lang.text('heroFrameFair'), note: Lang.text('heroFrameFairNote'), type: data.fairType,
        active: current === HeroFrameSelect.FAIR, onPick: () => pick(HeroFrameSelect.FAIR, data.fairType),
      }),
      HeroFrameSelect.option({
        hero, name: Lang.text('frame_no_frame'), type: 0,
        active: current === HeroFrameSelect.NONE, onPick: () => pick(HeroFrameSelect.NONE, 0),
      }),
      ...data.frames.map((frame) =>
        HeroFrameSelect.option({
          hero, name: Lang.text(Shop.getName(2, String(frame.type))[0]), type: frame.type,
          active: current === frame.id, onPick: () => pick(frame.id, frame.type),
        }),
      ),
    ];
    body.replaceChildren(DOM({ style: 'hero-frame-picker-grid' }, ...options));
    if (!data.frames.length) body.append(DOM({ style: 'hero-frame-picker-note' }, Lang.text('heroFrameEmpty')));
    if (HeroFrame.tier(hero.wins) === 0) {
      body.append(DOM({ style: 'hero-frame-picker-note' }, Lang.text('heroFrameWinsHint').replace('{wins}', String(Number(hero.wins) || 0))));
    }
    HeroFrameSelect.placePicker(picker, anchor);
  }

  // над карточкой героя (список героев внизу экрана), по центру кнопки, не вылезая за края окна;
  // сверху не помещается (кнопка в тамбуре у верха экрана) — под кнопкой
  static placePicker(picker, anchor) {
    if (!picker?.isConnected || !anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const card = anchor.closest('.castle-hero-item')?.getBoundingClientRect() || rect;
    const margin = 8;
    const width = picker.offsetWidth;
    const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - width / 2), Math.max(margin, window.innerWidth - width - margin));
    picker.style.left = `${Math.round(left)}px`;
    const above = Math.min(rect.top, card.top) - margin;
    const below = window.innerHeight - rect.bottom - margin;
    if (picker.offsetHeight > above && below > above) {
      picker.style.bottom = '';
      picker.style.top = `${Math.round(rect.bottom + margin)}px`;
    } else {
      picker.style.top = '';
      picker.style.bottom = `${Math.round(window.innerHeight - above)}px`;
    }
  }

  static closePicker() {
    HeroFrameSelect.pickerCleanup?.();
    HeroFrameSelect.pickerCleanup = null;
    HeroFrameSelect.picker?.remove();
    HeroFrameSelect.picker = null;
    document.querySelectorAll('.hero-frame-select--open').forEach((button) => button.classList.remove('hero-frame-select--open'));
  }

  // выбор сразу видно (рамка ставится до ответа сервера), ответ сервера уточняет, ошибка — откат
  static async choose(heroId, frameItem, frameType) {
    const hero = HeroFrameSelect.hero(heroId);
    if (!hero) return;
    const before = { frameItem: hero.frameItem, frameType: hero.frameType };
    HeroFrameSelect.patchHero(heroId, { frameItem, frameType: Number(frameType) || 0 });
    try {
      const result = await App.api.request('build', 'heroFrame', { id: heroId, item: frameItem });
      if (result && typeof result === 'object' && 'frameType' in result) {
        HeroFrameSelect.patchHero(heroId, { frameItem: Number(result.frameItem), frameType: Number(result.frameType) || 0 });
      }
    } catch (error) {
      HeroFrameSelect.patchHero(heroId, before);
      throw error;
    }
  }

  // ---- ярмарка: сменилась рамка по умолчанию — у героев без своей рамки

  static setFairFrame(frameType) {
    const type = Number(frameType) || 0;
    for (const item of HeroFrameSelect.heroItems()) {
      if (HeroFrameSelect.frameItemOf(item) === HeroFrameSelect.FAIR) item.frameType = type;
    }
    HeroFrameSelect.refresh();
  }

  // ---- уровень рамки админа (вкладка «Аккаунт»): 0 — по победам, 1–4 — ступень без учёта побед

  static async loadTier() {
    const result = await App.api.request('build', 'frameTier', {});
    return Number(result?.tier) || 0;
  }

  static async setTier(tier) {
    const value = Number(tier) || 0;
    await App.api.request('build', 'frameTier', { tier: value });
    for (const item of HeroFrameSelect.heroItems()) {
      // winsReal нет только у старого бэкенда — тогда рамки поправит следующая загрузка heroAll
      if (!('winsReal' in item)) continue;
      item.wins = value > 0 ? HeroFrameSelect.TIER_WINS[value] : Number(item.winsReal) || 0;
    }
    HeroFrameSelect.refresh();
    return value;
  }
}

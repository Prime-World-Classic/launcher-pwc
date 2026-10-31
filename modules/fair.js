import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { View } from './view.js';
import { App } from './app.js';
import { MM } from './mm.js';
import { Build } from './build.js';
import { Castle } from './castle.js';
import { Sound } from './sound.js';
import { Splash } from './splash.js';
import { Shop } from './shop.js';
import { Timer } from './timer.js';
import { HelpSplash } from './helpSpalsh.js';
import { domAudioPresets } from './domAudioPresets.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';
import { NativeAPI } from './nativeApi.js';
import { UserCfg } from './battleSettings.js';

// «Ярмарка» в замке: окно в стиле «Настроек боя» (вкладки категорий слева, товары справа).
// Товары берутся из базы: shop.available (ярмарка), shop.purchase (коллекция),
// покупка shop.buy, выбор shop.apply / shop.applyDefault, скины — Build.changeSkinForHero.
//
// Новые категории (shop_item.categoryId, отдельной таблицы категорий в базе нет):
// - Загрузочные экраны (4): externalId = имя картинки: content/img/fair/loadscreens/<имя>.webp (превью лаунчера)
//   и /UI/Styles/LoadingBack/Fair/<имя>.dds в данных игры (1920x1080). Можно выбрать несколько экранов (ротация):
//   перед каждым запуском игры лаунчер берёт случайный экран из ротации и пишет в user.cfg
//   `setvar fair_loadscreen = <имя>` (none — фон карты), игра подменяет фон загрузки только у этого игрока
//   (PW_Game LoadingScreenLogic, FairLoadingBack). Новый экран = webp в лаунчер + dds в Data (патч игры).
// - Похвалы (5): externalId = номер похвалы, текст — Lang `praise_<номер>` (ru/en), название — `praise_<номер>_name`.
//   В бой уходит только номер: user.cfg `setvar praise_id = <номер>` -> CmdPraise (amount), а текст каждый клиент
//   берёт из praises.txt («<номер>\t<текст>», пишет syncFairGameFiles) — PW_Game AdventureScreen::OnPraise.
// - Стили интерфейса (6) — следующим шагом.
// Выбор экрана и похвалы пока хранится в лаунчере (localStorage): на сервере под них нет столбцов
// (у флага и рамки — user.shopItemFlagId / shopItemFrameId), shop.apply их не знает.

const CAT = { flag: 1, frame: 2, skin: 3, loadscreen: 4, praise: 5 };
// с какого числа побед на герое показывается каждый из 4 вариантов рамки (бэкенд: mm.model.js getFrameTypeFromVictoryCount, «>= 25» и т. д.)
const FRAME_WINS = [25, 50, 75, 100];

const CATEGORIES = [
  // single — подпись на карточке товара (множественное число — только в названиях категорий), notes — подсказки раздела
  { id: 'skin', categoryId: CAT.skin, label: 'fairCatSkins', single: 'fairItemSkin', hint: 'fairHintSkins' },
  { id: 'flag', categoryId: CAT.flag, label: 'fairCatFlags', single: 'fairItemFlag', hint: 'fairHintFlags' },
  { id: 'frame', categoryId: CAT.frame, label: 'fairCatFrames', single: 'fairItemFrame', hint: 'fairHintFrames' },
  {
    id: 'loadscreen',
    categoryId: CAT.loadscreen,
    label: 'fairCatLoadscreens',
    single: 'fairItemLoadscreen',
    hint: 'fairHintLoadscreens',
    notes: ['fairNoteLoadscreenPreview', 'fairNoteLoadscreenRotation'],
  },
  { id: 'praise', categoryId: CAT.praise, label: 'fairCatPraises', single: 'fairItemPraise', hint: 'fairHintPraises' },
];

// категории, выбор в которых хранит лаунчер
const LOCAL_CATEGORIES = [CAT.loadscreen, CAT.praise];

// Что этот лончер умеет рисовать — ЕДИНСТВЕННЫЙ рубильник категории: вкладка
// категории в CATEGORIES (или LOCAL_CATEGORIES) = она открыта, убрал вкладку =
// закрыта и для бэкенда, и для «Всего ассортимента»/«Коллекции» (иначе товар
// утечёт туда без вкладки). Трогать только здесь; набор игрока живёт в
// shop_item_available_user сутки, и blocked = 1 задним числом не убирает товар
// из уже выданного набора (он молча потеряет слот из 10, а buy() blocked не
// проверяет). Окна «Магазин»/«Коллекция» (window.js) список не шлют: на
// неизвестной категории Shop.getIcon даёт App.error('Некорректный categoryId N')
// и пустую иконку.
const OPEN_CATEGORIES = Array.from(new Set([...CATEGORIES.map((cat) => cat.categoryId), ...LOCAL_CATEGORIES]));

// allCategories — мост к бэкенду без поддержки categories (там «всё или LEGACY»)
const SHOP_SCOPE = { allCategories: true, categories: OPEN_CATEGORIES };

const isOpenCategory = (categoryId) => OPEN_CATEGORIES.includes(Number(categoryId));

// selected — { categoryId: externalId } (нет записи — стандартный), у загрузочных экранов — список externalId (ротация)
const LOCAL_STORAGE = 'fair_local_v2';

// тестовые товары (купленные только в лаунчере) убраны: их выбор сбрасывается на стандартный
const REMOVED_TEST_ITEMS = {
  'test-ls-1': [CAT.loadscreen, 'winter_rider'],
  'test-ls-2': [CAT.loadscreen, 'moon_garden'],
  'test-ls-3': [CAT.loadscreen, 'pumpkin_fox'],
  'test-ls-4': [CAT.loadscreen, 'violet_blade'],
  'test-pr-1': [CAT.praise, '1'],
  'test-pr-2': [CAT.praise, '2'],
  'test-pr-3': [CAT.praise, '3'],
};

function loadLocalState() {
  try {
    const state = JSON.parse(localStorage.getItem(LOCAL_STORAGE) || '{}');
    const selected = state.selected || {};
    if (Array.isArray(state.owned)) {
      for (const id of state.owned) {
        const [categoryId, name] = REMOVED_TEST_ITEMS[id] || [];
        const value = selected[categoryId];
        if (Array.isArray(value)) selected[categoryId] = value.filter((v) => String(v) !== name);
        else if (value != null && String(value) === name) delete selected[categoryId];
        if (Array.isArray(selected[categoryId]) && !selected[categoryId].length) delete selected[categoryId];
      }
      saveLocalState({ selected });
    }
    return { selected };
  } catch {
    return { selected: {} };
  }
}

function saveLocalState(state) {
  try {
    localStorage.setItem(LOCAL_STORAGE, JSON.stringify(state));
  } catch {}
}

// экраны в ротации; раньше выбирался один экран и хранился строкой
function loadscreenRotation(state) {
  const value = state.selected[CAT.loadscreen];
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(String).filter((name) => /^[A-Za-z0-9_-]{1,64}$/.test(name));
}

// Файлы игры (My Games/Prime World Classic): номер выбранной похвалы и имя загрузочного экрана в user.cfg,
// тексты всех похвал в praises.txt (у получателя похвалы должен быть текст её номера). Вызывается при входе
// в замок, при выборе экрана или похвалы и перед каждым запуском игры (PWGame.start).
export async function syncFairGameFiles() {
  try {
    if (!NativeAPI.status) return;
    const documents = NativeAPI.getDocumentsDir();
    if (!documents) return;
    const words = { ...(Lang.list[Lang.default]?.word || {}), ...(Lang.list[Lang.target]?.word || {}) };
    const lines = [];
    for (const key of Object.keys(words)) {
      const m = /^praise_(\d+)$/.exec(key);
      if (m && typeof words[key] === 'string') lines.push(`${m[1]}\t${words[key].replace(/[\t\r\n]+/g, ' ')}`);
    }
    const folder = NativeAPI.path.join(documents, 'My Games', 'Prime World Classic');
    await NativeAPI.fileSystem.promises.mkdir(folder, { recursive: true });
    await NativeAPI.fileSystem.promises.writeFile(NativeAPI.path.join(folder, 'praises.txt'), lines.join('\n') + '\n', 'utf8');

    const state = loadLocalState();
    const praiseId = Number(state.selected[CAT.praise]) || 0;
    // имя фона /UI/Styles/LoadingBack/Fair/<имя>.dds; none — фон карты. Из ротации экран выбирает лаунчер —
    // случайный при каждом запуске игры: выпущенный PW_Game понимает только одно имя (список через запятую
    // он считает неверным и показывает фон карты)
    const rotation = loadscreenRotation(state);
    const loadscreen = rotation.length ? rotation[Math.floor(Math.random() * rotation.length)] : 'none';
    await UserCfg.load();
    const changes = {};
    if (UserCfg.num('praise_id', 0) !== praiseId) changes.praise_id = praiseId;
    if (UserCfg.get('fair_loadscreen', '') !== loadscreen) changes.fair_loadscreen = loadscreen;
    if (Object.keys(changes).length) await UserCfg.set(changes);
  } catch (e) {
    console.error('fair: game files write failed', e);
  }
}

let shownTab = 'all';
let sortMode = 'default';
let hideOwned = false;

function crystalCount() {
  return Number(View.castleTotalCrystal?.firstChild?.innerText) || 0;
}

function heroOf(item) {
  const [heroId, skinId] = String(item.externalId).split('/');
  return { heroId: Number(heroId), skinId: Number(skinId) };
}

function itemName(item) {
  if (item.categoryId === CAT.loadscreen || item.categoryId === CAT.praise) {
    return Lang.text(`${item.categoryId === CAT.loadscreen ? 'loadscreen' : 'praise'}_${item.externalId}_name`);
  }
  if (item.id == 0) {
    if (item.categoryId === CAT.flag) return Lang.text('flag_no_flag');
    if (item.categoryId === CAT.frame) return Lang.text('frame_no_frame');
  }
  return Lang.text(Shop.getName(item.categoryId, item.externalId)[0]);
}

function praiseText(item) {
  return Lang.text(`praise_${item.externalId}`);
}

function heroName(heroId) {
  return Lang.text(`hero_${heroId}_name`);
}

// ---------------------------------------------------------------- картинки товаров

function circle(url, extraStyle) {
  const el = DOM({ style: extraStyle ? ['fair-circle', extraStyle] : 'fair-circle' });
  el.style.backgroundImage = url;
  return el;
}

function loadscreenImage(item) {
  return item.image || `content/img/fair/loadscreens/${item.externalId}.webp`;
}

function itemPicture(item, ctx) {
  switch (item.categoryId) {
    case CAT.skin: {
      const icon = Shop.getSkinIcon(item.externalId);
      return DOM({ style: 'fair-iconrow' }, circle(icon[1], 'is-gray'), DOM({ style: 'fair-arrow' }), circle(icon[0]));
    }
    case CAT.flag: {
      const flag = DOM({ style: 'fair-circle' });
      if (item.id != 0) flag.style.backgroundImage = Shop.getFlagIcon(item.externalId)[0];
      else flag.classList.add('is-empty');
      return DOM({ style: 'fair-iconrow' }, flag);
    }
    case CAT.frame: {
      const hero = ctx.topHero;
      const frames = item.id == 0 ? [null] : Shop.getFrameIcon(`${item.externalId}/${hero.frameId}`);
      const variants = frames.map((image, index) => {
        const portrait = DOM({ style: 'fair-frame-portrait' });
        portrait.style.backgroundImage = `url("content/hero/${hero.heroId}/${hero.skinId}.webp")`;
        const box = DOM({ style: 'fair-frame' }, portrait);
        if (image) {
          const frame = DOM({ style: 'fair-frame-img' });
          frame.style.backgroundImage = image;
          box.append(frame);
        }
        if (frames.length < 2) return box;
        const wins = FRAME_WINS[index];
        return DOM(
          { style: 'fair-frame-variant', title: Lang.text('fairFrameWinsTitle').replace('{name}', itemName(item)).replace('{n}', index + 1).replace('{total}', frames.length).replace('{wins}', wins) },
          box,
          DOM({ style: 'fair-frame-wins' }, Lang.text('fairFrameWins').replace('{wins}', wins)),
        );
      });
      return DOM({ style: 'fair-iconrow' }, DOM({ style: frames.length > 1 ? 'fair-frame-set' : 'fair-frame-single' }, ...variants));
    }
    case CAT.loadscreen: {
      const thumb = DOM({ style: 'fair-thumb' });
      thumb.style.backgroundImage = `url("${loadscreenImage(item)}")`;
      if (item.id == 0) thumb.classList.add('is-default');
      return thumb;
    }
    case CAT.praise:
      return DOM({ style: 'fair-praise' }, DOM({ style: 'fair-praise-text' }, item.id == 0 ? Lang.text('fairPraiseDefaultText') : praiseText(item)));
  }
  return DOM();
}

// ---------------------------------------------------------------- окно

export async function fair(tab = null, { previewData = null } = {}) {
  const isCollectionTab = (id) => id === 'collection';
  if (tab) shownTab = tab;

  View.castleCrystalContainer?.classList.remove('crystal-container-anim');

  const ctx = { topHero: { heroId: 1, skinId: 1, frameId: 0 }, available: [], purchased: [], local: previewData ? { selected: {} } : loadLocalState() };

  const [available, purchased, topHero] = previewData ? [previewData.available, previewData.purchased, previewData.topHero] : await Promise.all([
    // SHOP_SCOPE: categories — что отдаёт новый бэкенд, allCategories — чтобы ярмарка
    // не осталась без экранов и похвал на старом. Без этого бэкенд режет категории
    // 4 и 5, и товары, уже лежащие в наборе игрока, в ярмарке не видны.
    App.api.request('shop', 'available', SHOP_SCOPE).catch((e) => (App.error(e), [])),
    App.api.request('shop', 'purchase', SHOP_SCOPE).catch((e) => (App.error(e), [])),
    App.api.request(App.CURRENT_MM, 'getHeroWithFrameId').catch((e) => (App.error(e), null)),
  ]);
  if (topHero) ctx.topHero = topHero;
  ctx.available = (available || []).map((item) => ({ ...item, categoryId: Number(item.categoryId) })).filter((item) => isOpenCategory(item.categoryId));
  ctx.purchased = (purchased || []).map((item) => ({ ...item, categoryId: Number(item.categoryId) })).filter((item) => isOpenCategory(item.categoryId));

  for (const categoryId of LOCAL_CATEGORIES) {
    // стандартный экран / похвала — всегда в коллекции
    ctx.purchased.push({ id: 0, categoryId, externalId: 'default', local: true });
  }
  // купленные экраны и похвалы (в shop.available их нет) — тоже в разделах ярмарки, скрываются «Скрыть купленные»
  for (const item of ctx.purchased) {
    if (!LOCAL_CATEGORIES.includes(item.categoryId) || item.id == 0) continue;
    if (!ctx.available.some((a) => a.categoryId === item.categoryId && a.id == item.id)) ctx.available.push({ ...item, enabled: false });
  }

  if (!previewData) await Shop.retrieveLastUpdate();
  const initialTimeLeft = previewData ? 3600000 : Shop.timeBeforeUpdate;

  const sidebar = DOM({ style: 'bs-sidebar' });
  const content = DOM({ style: ['bs-content', 'fair-content', 'wtop-list-scroll'] });
  const detail = DOM({ style: 'fair-detail' });
  const tabButtons = new Map();

  // ---- панель над товарами
  const search = DOM({ tag: 'input', type: 'text', style: 'fair-search', placeholder: Lang.text('fairSearch') });
  const sort = DOM({ tag: 'select', style: ['bs-select', 'fair-sort'], domaudio: domAudioPresets.defaultSelect });
  for (const [value, label] of [
    ['default', 'fairSortDefault'],
    ['name', 'fairSortName'],
    ['priceAsc', 'fairSortPriceAsc'],
    ['priceDesc', 'fairSortPriceDesc'],
    ['new', 'fairSortNew'],
  ]) {
    sort.append(DOM({ tag: 'option', value }, Lang.text(label)));
  }
  sort.value = sortMode;
  const hideCheck = DOM({ tag: 'input', type: 'checkbox', style: 'bs-check', id: 'fair-hide-owned', checked: hideOwned, domaudio: domAudioPresets.defaultSelect });
  const hideRow = DOM(
    { style: ['bs-row', 'bs-row--check', 'fair-hide'] },
    hideCheck,
    DOM({ tag: 'label', style: 'bs-row-label', htmlFor: 'fair-hide-owned' }, Lang.text('fairHideOwned')),
  );
  const balanceValue = DOM({ tag: 'span' }, String(crystalCount()));
  const balance = DOM(
    { style: 'fair-balance' },
    Lang.text('fairBalance'),
    DOM({ tag: 'img', src: 'content/img/queue/DiamondBlue.png', style: 'fair-gem' }),
    balanceValue,
  );
  const toolbar = DOM({ style: 'fair-toolbar' }, search, sort, hideRow, balance);

  const title = DOM({ style: 'bs-header' });
  const quickbar = DOM({ style: 'fair-quickbar' });
  const cards = DOM({ style: 'fair-cards-wrap' });

  // ---- нижняя строка: таймер обновления ассортимента
  const timerValue = DOM({ tag: 'b' }, Timer.getFormattedTimer(initialTimeLeft));
  const footer = DOM({ style: ['bs-footer', 'fair-footer'] }, DOM({ style: 'fair-timer' }, Lang.text('shop_bottom'), ' ', timerValue));

  let selected = null;
  let loadscreenPreview = null;

  const closePreview = () => {
    if (!loadscreenPreview) return;
    const { node, opener } = loadscreenPreview;
    if (Splash.body?.contains(node)) Splash.hide();
    loadscreenPreview = null;
    if (opener?.isConnected) opener.focus();
  };

  const previewLoadscreen = (item, opener) => {
    if (item.categoryId !== CAT.loadscreen || item.id == 0) return;
    closePreview();
    const close = DOM(
      { tag: 'button', type: 'button', style: 'fair-preview-close', title: Lang.text('titleClose'), event: ['click', closePreview] },
      DOM({ tag: 'img', src: 'content/icons/close-cropped.svg', alt: Lang.text('titleClose') }),
    );
    const node = DOM(
      { style: 'fair-loadscreen-preview', event: ['click', (event) => { if (event.target === node) closePreview(); }] },
      DOM({ style: 'fair-loadscreen-preview-body' },
        DOM({ tag: 'h2', id: 'fair-preview-title', style: 'fair-preview-title' }, itemName(item)),
        DOM({ tag: 'img', style: 'fair-preview-image', src: loadscreenImage(item), alt: itemName(item) }),
        close,
      ),
    );
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-labelledby', 'fair-preview-title');
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePreview();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        close.focus();
      }
    });
    loadscreenPreview = { node, opener };
    Splash.show(node, false);
    close.focus();
  };

  const itemsOfTab = () => {
    if (isCollectionTab(shownTab)) return ctx.purchased.slice();
    if (shownTab === 'all') return ctx.available.slice();
    const cat = CATEGORIES.find((c) => c.id === shownTab);
    return ctx.available.filter((item) => item.categoryId === cat.categoryId);
  };

  // в разделах ярмарки enabled = «можно купить», в коллекции — «можно выбрать»
  const isOwned = (item) => !isCollectionTab(shownTab) && !item.enabled;
  const owns = (item) => isCollectionTab(shownTab) || isOwned(item);
  // тот же товар из коллекции (по нему видно, выбран ли купленный товар в разделе ярмарки)
  const purchasedOf = (item) => (ctx.purchased.includes(item) ? item : ctx.purchased.find((p) => p.categoryId === item.categoryId && p.id == item.id));
  const isEquipped = (item) => {
    if (item.categoryId === CAT.loadscreen) {
      const rotation = loadscreenRotation(ctx.local);
      return item.id == 0 ? !rotation.length : rotation.includes(String(item.externalId));
    }
    if (LOCAL_CATEGORIES.includes(item.categoryId)) {
      return String(ctx.local.selected[item.categoryId] ?? 'default') === String(item.externalId);
    }
    const own = purchasedOf(item);
    if (item.categoryId === CAT.skin) {
      const { heroId, skinId } = heroOf(item);
      const hero = MM.hero?.find((h) => h.id == heroId);
      return hero ? hero.skin == skinId : !!own && !own.enabled;
    }
    return !!own && !own.enabled;
  };
  // выбранный экран из ротации снимается той же кнопкой
  const inRotation = (item) => item.categoryId === CAT.loadscreen && item.id != 0 && isEquipped(item);

  const filteredItems = () => {
    let items = itemsOfTab();
    const query = search.value.trim().toLowerCase();
    if (query) {
      items = items.filter((item) => {
        let text = itemName(item);
        if (item.categoryId === CAT.skin) text += ` ${heroName(heroOf(item).heroId)}`;
        if (item.categoryId === CAT.praise && item.id != 0) text += ` ${praiseText(item)}`;
        return text.toLowerCase().includes(query);
      });
    }
    if (hideOwned && !isCollectionTab(shownTab)) items = items.filter((item) => !isOwned(item));
    const byName = (a, b) => itemName(a).localeCompare(itemName(b), Lang.target);
    if (sortMode === 'name') items.sort(byName);
    if (sortMode === 'priceAsc') items.sort((a, b) => (a.price || 0) - (b.price || 0));
    if (sortMode === 'priceDesc') items.sort((a, b) => (b.price || 0) - (a.price || 0));
    if (sortMode === 'new') items.sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew) || (Number(b.id) || 0) - (Number(a.id) || 0));
    return items;
  };

  const badge = (item) => {
    if (owns(item) && isEquipped(item)) return DOM({ style: ['fair-badge', 'is-equipped'] }, Lang.text(inRotation(item) ? 'fairInRotation' : 'shop_in_use'));
    if (isCollectionTab(shownTab)) return DOM();
    if (isOwned(item)) return DOM({ style: ['fair-badge', 'is-owned'] }, Lang.text('fairOwned'));
    if (item.isNew) return DOM({ style: ['fair-badge', 'is-new'] }, Lang.text('fairNew'));
    return DOM();
  };

  const subtitle = (item) => {
    if (item.categoryId === CAT.skin) return heroName(heroOf(item).heroId);
    return Lang.text(CATEGORIES.find((c) => c.categoryId === item.categoryId)?.single || '');
  };

  const action = (item) => {
    if (owns(item)) {
      if (isEquipped(item) && !inRotation(item)) return DOM({ style: 'fair-tag' }, Lang.text('shop_in_use'));
      return DOM(
        { style: 'fair-price', domaudio: domAudioPresets.bigButton, event: ['click', (e) => (e.stopPropagation(), select(item), equip(item))] },
        Lang.text(inRotation(item) ? 'fairRemoveFromRotation' : 'shop_use'),
      );
    }
    return DOM(
      { style: ['fair-price', 'fair-price--crystals'], domaudio: domAudioPresets.bigButton, title: Lang.text('fairBuyFor').replace('{price}', item.price), event: ['click', (e) => (e.stopPropagation(), select(item), buy(item))] },
      DOM({ tag: 'img', src: 'content/img/queue/DiamondBlue.png', style: 'fair-gem' }),
      String(item.price),
    );
  };

  const card = (item) => {
    const el = DOM(
      { style: selected === item ? ['fair-card', 'is-selected'] : 'fair-card', domaudio: domAudioPresets.defaultButton, event: ['click', () => select(item)] },
      badge(item),
      itemPicture(item, ctx),
      DOM({ style: 'fair-name' }, itemName(item)),
      DOM({ style: 'fair-sub' }, subtitle(item)),
      action(item),
    );
    el.fairItem = item;
    if (item.categoryId === CAT.loadscreen && item.id != 0) {
      el.tabIndex = 0;
      el.addEventListener('dblclick', (event) => {
        if (!event.target.closest('.fair-price')) previewLoadscreen(item, el);
      });
      el.addEventListener('keydown', (event) => {
        if (event.target === el && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          previewLoadscreen(item, el);
        }
      });
    }
    return el;
  };

  const grid = (items) => {
    const styles = ['fair-cards'];
    if (items.length && items.every((item) => item.categoryId === CAT.loadscreen)) styles.push('fair-cards--loadscreens');
    if (items.length && items.every((item) => item.categoryId === CAT.frame)) styles.push('fair-cards--frames');
    const el = DOM({ style: styles });
    for (const item of items) el.append(card(item));
    return el;
  };

  // перерисовка после «Выбрать»/«Убрать»/покупки не должна сбрасывать прокрутку в начало
  const renderCards = () => {
    const scroll = content.scrollTop;
    fillCards();
    content.scrollTop = scroll;
  };

  const fillCards = () => {
    const items = filteredItems();
    cards.replaceChildren();
    quickbar.replaceChildren();
    quickbar.classList.add('is-hidden');

    if (!items.length) {
      cards.append(DOM({ style: 'bs-note' }, Lang.text('fairEmpty')));
      return;
    }

    // скины — группами по героям, сверху быстрый переход к герою
    const skins = items.filter((item) => item.categoryId === CAT.skin);
    if (shownTab === 'skin' && skins.length) {
      const groups = new Map();
      for (const item of skins) {
        const { heroId } = heroOf(item);
        if (!groups.has(heroId)) groups.set(heroId, []);
        groups.get(heroId).push(item);
      }
      let order = [...groups.keys()];
      if (sortMode === 'name') order.sort((a, b) => heroName(a).localeCompare(heroName(b), Lang.target));
      quickbar.classList.remove('is-hidden');
      for (const heroId of order) {
        const group = DOM({ style: 'fair-group', data: { hero: heroId } });
        const head = DOM(
          { style: 'fair-group-head' },
          circle(`url("content/hero/${heroId}/1.webp")`, 'fair-group-icon'),
          DOM({ tag: 'span' }, heroName(heroId)),
          DOM({ style: 'fair-count' }, String(groups.get(heroId).length)),
          DOM({ style: 'fair-group-line' }),
        );
        group.append(head, grid(groups.get(heroId)));
        cards.append(group);
        quickbar.append(
          DOM(
            {
              style: 'fair-chip',
              data: { hero: heroId },
              title: heroName(heroId),
              domaudio: domAudioPresets.defaultButton,
              event: [
                'click',
                () => {
                  const top = group.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop - quickbar.offsetHeight;
                  content.scrollTop = top;
                },
              ],
            },
            circle(`url("content/hero/${heroId}/1.webp")`, 'fair-chip-icon'),
            heroName(heroId),
          ),
        );
      }
      return;
    }

    if (isCollectionTab(shownTab) || shownTab === 'all') {
      // Collection and full assortment retain the same category grouping.
      for (const cat of CATEGORIES) {
        const own = items.filter((item) => item.categoryId === cat.categoryId);
        if (sortMode === 'default') own.sort((a, b) => Number(b.id == 0) - Number(a.id == 0)); // стандартный — первым
        if (!own.length) continue;
        cards.append(DOM({ style: 'fair-group-head' }, DOM({ tag: 'span' }, Lang.text(cat.label)), DOM({ style: 'fair-count' }, String(own.length)), DOM({ style: 'fair-group-line' })), grid(own));
      }
      return;
    }
    cards.append(grid(items));
  };

  // подсветка героя в быстром списке при прокрутке
  content.addEventListener('scroll', () => {
    if (shownTab !== 'skin') return;
    let active = null;
    const limit = content.getBoundingClientRect().top + quickbar.offsetHeight + 20;
    for (const group of cards.querySelectorAll('.fair-group')) {
      if (group.getBoundingClientRect().top <= limit) active = group.dataset.hero;
    }
    for (const chip of quickbar.children) chip.classList.toggle('is-active', chip.dataset.hero === active);
  });

  // ---- панель выбранного товара
  const renderDetail = () => {
    detail.replaceChildren();
    detail.classList.toggle('is-visible', !!selected);
    if (!selected) return;
    const item = selected;
    let desc = Lang.text(CATEGORIES.find((c) => c.categoryId === item.categoryId)?.hint || '');
    if (item.categoryId === CAT.skin) desc = `${heroName(heroOf(item).heroId)}: ${desc}`;
    if (item.categoryId === CAT.praise) desc = `«${item.id == 0 ? Lang.text('fairPraiseDefaultText') : praiseText(item)}» — ${desc}`;
    if (item.categoryId === CAT.frame && item.id != 0 && ctx.topHero.frameId == 0) desc += ` ${Lang.text('frame_hint')}`;

    let button = DOM();
    if (owns(item)) {
      if (inRotation(item)) button = fairButton(Lang.text('fairRemoveFromRotation'), () => equip(item));
      else if (!isEquipped(item)) button = fairButton(Lang.text('shop_use'), () => equip(item));
    } else {
      button = fairButton(Lang.text('fairBuyFor').replace('{price}', item.price), () => buy(item));
    }
    detail.append(
      DOM({ style: 'fair-detail-pic' }, itemPicture(item, ctx)),
      DOM({ style: 'fair-detail-text' }, DOM({ style: 'fair-detail-name' }, itemName(item)), DOM({ style: 'fair-detail-desc' }, desc)),
      button,
    );
  };

  const select = (item) => {
    selected = item;
    for (const el of cards.querySelectorAll('.fair-card')) el.classList.toggle('is-selected', el.fairItem === item);
    renderDetail();
  };

  // ---- покупка и выбор
  const confirm = (titleKey, text, item, okText, onOk) => {
    Splash.show(
      DOM(
        {},
        DOM({ style: 'splash-modal-scope-shop-action' }),
        DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, Lang.text(titleKey))),
        DOM({ style: ['splash-item-container', 'fair-splash-item'] }, itemPicture(item, ctx)),
        DOM({ style: 'splash-item-text' }, text),
        DOM(
          {
            domaudio: domAudioPresets.bigButton,
            style: 'splash-content-button',
            event: ['click', async () => (Splash.hide(), await onOk())],
          },
          okText,
        ),
        DOM({ domaudio: domAudioPresets.closeButton, style: 'splash-content-button-red', event: ['click', () => Splash.hide()] }, Lang.text('windowShopCancel')),
      ),
    );
  };

  const buy = (item) => {
    if (previewData) return;
    if (crystalCount() < item.price) {
      Splash.show(DOM({}, Lang.text('fairNotEnough').replace('{price}', item.price).replace('{balance}', crystalCount())));
      return;
    }
    const text = DOM(
      {},
      Lang.text('windowShopBuyItem'),
      DOM({ style: 'splash-shop-item-name' }, itemName(item)),
      DOM({ tag: 'br' }),
      Lang.text('windowShopItemPrice').replace('{rItem.price}', item.price),
      DOM({ tag: 'img', src: 'content/img/queue/DiamondBlue.png', style: ['fair-gem', 'fair-splash-gem'] }),
      '?',
    );
    confirm('buyModalText', text, item, Lang.text('windowShopBuy'), async () => {
      try {
        const crystalLeft = await App.api.request('shop', 'buy', { id: item.id });
        if (item.categoryId === CAT.skin) {
          const { heroId, skinId } = heroOf(item);
          await Build.changeSkinForHero(heroId, skinId);
        }
        if (Number.isInteger(crystalLeft)) {
          View.castleTotalCrystal.firstChild.innerText = crystalLeft;
        } else {
          App.error(`Неизвестное число кристаллов: ${crystalLeft}`);
        }
        // купленный товар появится в коллекции при следующем открытии
        const localPurchased = ctx.purchased.filter((p) => p.local);
        const purchased = await App.api.request('shop', 'purchase', SHOP_SCOPE).catch(() => null);
        if (purchased) {
          ctx.purchased = [...purchased.map((p) => ({ ...p, categoryId: Number(p.categoryId) })), ...localPurchased];
        }
        Sound.play(SOUNDS_LIBRARY.BUY, { id: 'ui-buy', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
      } catch (e) {
        App.error(e);
        return;
      }
      item.enabled = false;
      balanceValue.innerText = String(crystalCount());
      refreshSidebar();
      renderCards();
      renderDetail();
    });
  };

  // купленный товар выбирается сразу, без окна подтверждения
  const equip = async (item) => {
    if (previewData) return;
    try {
      if (item.categoryId === CAT.loadscreen) {
        // ротация: «Выбрать» добавляет экран, «Убрать» снимает; стандартный экран очищает ротацию
        const name = String(item.externalId);
        const rotation = loadscreenRotation(ctx.local);
        const next = item.id == 0 ? [] : rotation.includes(name) ? rotation.filter((n) => n !== name) : [...rotation, name];
        if (next.length) ctx.local.selected[CAT.loadscreen] = next;
        else delete ctx.local.selected[CAT.loadscreen];
        saveLocalState(ctx.local);
        await syncFairGameFiles();
      } else if (LOCAL_CATEGORIES.includes(item.categoryId)) {
        if (item.id == 0) delete ctx.local.selected[item.categoryId];
        else ctx.local.selected[item.categoryId] = String(item.externalId);
        saveLocalState(ctx.local);
        await syncFairGameFiles();
      } else if (item.categoryId === CAT.skin) {
        const { heroId, skinId } = heroOf(item);
        await Build.changeSkinForHero(heroId, skinId);
      } else if (item.id == 0) {
        await App.api.request('shop', 'applyDefault', { categoryId: item.categoryId });
      } else {
        await App.api.request('shop', 'apply', { id: item.id });
      }
    } catch (e) {
      App.error(e);
      return;
    }
    for (const other of ctx.purchased) {
      if (other.categoryId !== item.categoryId) continue;
      if (item.categoryId === CAT.skin && heroOf(other).heroId !== heroOf(item).heroId) continue;
      other.enabled = other.id != item.id;
    }
    renderCards();
    renderDetail();
  };

  // ---- вкладки
  const show = (id) => {
    shownTab = id;
    selected = null;
    for (const [tid, el] of tabButtons) {
      el.classList.toggle('is-active', tid === id);
      el.setAttribute('aria-pressed', String(tid === id));
    }
    hideRow.classList.toggle('is-disabled', isCollectionTab(id));
    const cat = CATEGORIES.find((c) => c.id === id);
    title.replaceChildren(
      DOM({ tag: 'span' }, Lang.text(shownTab === 'all' ? 'fairCatAll' : cat ? cat.label : 'shop_collection')),
      DOM(
        { style: 'fair-title-hint' },
        shownTab === 'all' ? '' : Lang.text(cat ? cat.hint : 'fairHintCollection'),
        ...(cat?.notes || []).map((key) => DOM({ style: 'fair-title-note' }, Lang.text(key))),
      ),
    );
    content.scrollTop = 0;
    renderCards();
    renderDetail();
  };

  const counter = (id) => {
    if (isCollectionTab(id)) return ctx.purchased.filter((item) => item.id != 0).length;
    if (id === 'all') return ctx.available.length;
    const cat = CATEGORIES.find((c) => c.id === id);
    return ctx.available.filter((item) => item.categoryId === cat.categoryId).length;
  };

  const refreshSidebar = () => {
    for (const [id, el] of tabButtons) el.querySelector('.fair-count').innerText = String(counter(id));
  };

  for (const tabDesc of [{ id: 'all', label: 'fairCatAll' }, ...CATEGORIES, { id: 'collection', label: 'shop_collection' }]) {
    const el = DOM(
      {
        domaudio: domAudioPresets.bigButton,
        tag: 'button', type: 'button',
        style: isCollectionTab(tabDesc.id) ? ['wtop-mode-tab', 'fair-cat', 'fair-cat--collection'] : ['wtop-mode-tab', 'fair-cat'],
        event: ['click', () => show(tabDesc.id)],
      },
      DOM({ tag: 'span', style: 'fair-cat-text' }, Lang.text(tabDesc.label)),
      DOM({ tag: 'span', style: 'fair-count' }, String(counter(tabDesc.id))),
    );
    tabButtons.set(tabDesc.id, el);
    sidebar.append(el);
  }

  search.addEventListener('input', renderCards);
  sort.addEventListener('change', () => {
    sortMode = sort.value;
    renderCards();
  });
  hideCheck.addEventListener('change', () => {
    hideOwned = hideCheck.checked;
    renderCards();
  });

  content.append(toolbar, title, quickbar, cards);

  const helpBtn = DOM({
    domaudio: domAudioPresets.defaultButton,
    style: ['help-button', 'fair-help'],
    event: ['click', () => HelpSplash(Lang.text('shop_help_content'))],
  });

  const root = DOM(
    { id: 'wfair', style: ['wcastle-menu--quest-bg'] },
    DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, Lang.text('shop_shop'))),
    helpBtn,
    DOM({ style: 'bs-body' }, sidebar, DOM({ style: 'bs-main' }, content, detail, footer)),
  );

  // таймер обновления ассортимента: по нулю ярмарка открывается заново
  let timeLeft = initialTimeLeft;
  const timer = setInterval(() => {
    if (!root.isConnected) return;
    timeLeft -= 1000;
    if (timeLeft <= 0) {
      clearInterval(timer);
      import('./window.js').then(({ Window }) => Window.show('main', 'shop', shownTab));
      return;
    }
    timerValue.innerText = Timer.getFormattedTimer(timeLeft);
    balanceValue.innerText = String(crystalCount());
  }, 1000);
  root.cleanup = () => {
    clearInterval(timer);
    closePreview();
  };
  if (previewData) {
    for (const control of root.querySelectorAll('.fair-price')) control.setAttribute('aria-disabled', 'true');
  }

  show(shownTab === 'all' || shownTab === 'collection' || CATEGORIES.some((c) => c.id === shownTab) ? shownTab : 'all');
  return root;
}

function fairButton(text, onClick) {
  return DOM(
    {
      domaudio: domAudioPresets.bigButton,
      style: ['castle-menu-item-button', 'bs-button', 'fair-buy'],
      event: ['click', onClick],
    },
    text,
  );
}

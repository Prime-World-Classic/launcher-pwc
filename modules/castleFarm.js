import { App } from './app.js';
import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { Sound } from './sound.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';
import { domAudioPresets } from './domAudioPresets.js';
import { Castle } from './castle.js';

// Ферма замка: три ресурсных здания (light_farm, heavy_farm, food_farm), их
// постройка, улучшение и сбор, кошелёк ресурсов в правом верхнем углу.
// Правила, цены и производство считает бэкенд (pw-api objects/farm.js,
// методы farm.state/build/upgrade/collect); здесь — только показ и досчёт
// накопления по часам между ответами сервера.
//
// Здание стоит в замке (castle-farm.cfg, Castle.CASTLE_FILE) отдельно от того, построено ли оно:
//   * не построено на бэкенде — в панели строительства с ценой, ставится
//     только после успешной покупки (Castle.placePhantomBuilding);
//   * построено, но не стоит (снесли, отменили) — ставится бесплатно;
//   * стоит в castle-farm.cfg, но не построено (старые раскладки, где фермы были
//     бесплатными) — убирается из замка, пока его не купят.
export class CastleFarm {
  static BUILDINGS = { light_farm: 'resource1', heavy_farm: 'resource2', food_farm: 'resource3' };

  static RESOURCES = ['resource1', 'resource2', 'resource3'];

  // иконки content/img/farm/*.png (оригинальные ресурсы фракций)
  static ICONS = {
    doct: { resource1: 'wood', resource2: 'ore', resource3: 'bread' },
    ad: { resource1: 'silk', resource2: 'rubber', resource3: 'mushroom' },
  };

  static state = null;

  // часы сервера минус часы клиента: накопление считаем по времени сервера
  static clockOffset = 0;

  static loadedAt = 0;

  static busy = new Set();

  static preview = false;

  static corner = null;

  static cornerValues = {};

  static bubbles = {};

  static tooltip = null;

  static dialog = null;

  static dialogBuilding = '';

  static clock = 0;

  static isFarm(name) {
    return Object.prototype.hasOwnProperty.call(CastleFarm.BUILDINGS, name);
  }

  static faction() {
    return Castle.currentSceneName === 'ad' ? 'ad' : 'doct';
  }

  // Золотой век и золото — в углу, но пока недоступны (серые, «в будущих обновлениях»).
  // Как в оригинале: золото — медальон с мешком (img/farm/gold_bag.png), за ним серебро —
  // монеты (img/farm/silver.png — Silver48 клиента замка). Серебро — «талант» 763 из
  // фарма «3 в ряд» (pw-api farm.state: wallet.silver), только показ.
  static COMING_SOON = ['golden_age', 'gold'];

  static SILVER = 'silver';

  static iconUrl(resource) {
    if (resource === 'gold') return 'content/img/farm/gold_bag.png';
    if (resource === 'silver' || resource === 'golden_age') return `content/img/farm/${resource}.png`;
    return `content/img/farm/${CastleFarm.ICONS[CastleFarm.faction()][resource]}.png`;
  }

  static resourceName(resource) {
    if (resource === 'gold') return Lang.text('farmGold');
    if (resource === 'silver') return Lang.text('farmSilver');
    if (resource === 'golden_age') return Lang.text('farmGoldenAge');
    return Lang.text(`farm_${resource}_${CastleFarm.faction()}`);
  }

  static buildingName(name) {
    const index = Castle.buildings.indexOf(name);
    return Lang.text(Castle.buildingsNames[index][CastleFarm.faction() === 'ad' ? 0 : 1]);
  }

  // Как в оригинале: от 100 000 — тысячи с буквой («105т»), от 10 млн — миллионы («12м»);
  // округление вниз, чтобы не показывать больше, чем есть. Полное число — в подсказке.
  static format(value) {
    const number = Math.max(0, Math.floor(Number(value) || 0));
    if (number >= 10000000) return `${Math.floor(number / 1000000)}${Lang.text('farmMillionsSuffix')}`;
    if (number >= 100000) return `${Math.floor(number / 1000)}${Lang.text('farmThousandsSuffix')}`;
    return String(number);
  }

  // чч:мм до момента ms (округление вверх до минуты)
  static timer(ms) {
    const minutes = Math.max(0, Math.ceil(ms / 60000));
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  static now() {
    return Date.now() + CastleFarm.clockOffset;
  }

  static building(name) {
    return CastleFarm.state?.buildings?.[name] || null;
  }

  static isBuilt(name) {
    return Number(CastleFarm.building(name)?.level) > 0;
  }

  // Накопление здания к текущему моменту — та же формула, что Farm.stored на бэкенде.
  static stored(name) {
    const b = CastleFarm.building(name);
    if (!b || !(b.level > 0)) return null;
    const elapsed = Math.max(0, CastleFarm.now() - b.collectedAt);
    const amount = Math.min(b.capacity, Math.floor((b.rate * elapsed) / b.periodMs));
    const fillMs = (b.capacity * b.periodMs) / b.rate;
    return {
      amount,
      capacity: b.capacity,
      full: amount >= b.capacity,
      percent: Math.min(100, (100 * elapsed) / fillMs),
      remaining: Math.max(0, fillMs - elapsed),
      collectable: amount > 0 && elapsed >= b.minCollectMs,
      collectIn: Math.max(0, b.minCollectMs - elapsed),
    };
  }

  static affordable(price) {
    const wallet = CastleFarm.state?.wallet || {};
    return Object.entries(price || {}).every(([resource, amount]) => (Number(wallet[resource]) || 0) >= amount);
  }

  // Здания за ресурсы, кроме ферм (Farm.PURCHASES в pw-api — разовая покупка) и
  // склад ресурсов (ставится бесплатно, но тоже через бэкенд: от него лимит).
  // Пока состояние не пришло, список нужен, чтобы их нельзя было поставить даром.
  static PURCHASES = ['crystal_farm', 'silver_farm', 'clan_house', 'house', 'library', 'agility', 'cunning', 'health', 'intelligence', 'strength', 'tavern'];

  static STORAGE = 'storage';

  // Ставится только через бэкенд (фермы, покупки, склад). Старый бэкенд без
  // purchases/storage в состоянии — платные только фермы.
  static isPaid(name) {
    if (CastleFarm.isFarm(name)) return true;
    const state = CastleFarm.state;
    if (!state) return CastleFarm.PURCHASES.includes(name) || name === CastleFarm.STORAGE;
    if (name === CastleFarm.STORAGE) return Boolean(state.storage);
    return Boolean(state.purchases?.[name]);
  }

  // Куплено (ферма построена, здание куплено, склад поставлен).
  static owned(name) {
    if (CastleFarm.isFarm(name)) return CastleFarm.isBuilt(name);
    if (name === CastleFarm.STORAGE) return Number(CastleFarm.state?.storage?.level) > 0;
    return Boolean(CastleFarm.state?.purchases?.[name]?.bought);
  }

  // Цена постановки некупленного (склад — {} : бесплатно).
  static buildPrice(name) {
    if (CastleFarm.isFarm(name)) return CastleFarm.building(name)?.price;
    if (name === CastleFarm.STORAGE) return {};
    return CastleFarm.state?.purchases?.[name]?.price;
  }

  // На складе: здание куплено, но в замке не стоит (снесли, отменили постановку) —
  // лежит во вкладке «Склад» панели строительства и ставится бесплатно.
  static inStorage(name) {
    return CastleFarm.isPaid(name) && CastleFarm.owned(name) && !Castle.isBuildingTaken(Castle.buildings.indexOf(name));
  }

  // Перерисовка вкладки «Склад» (ставит View.bodyCastleBuildings) — после
  // изменений раскладки, если состав склада изменился.
  static onStorageChange = null;

  static storageKey = '';

  static storageChanged() {
    const key = [...Object.keys(CastleFarm.BUILDINGS), ...CastleFarm.PURCHASES, CastleFarm.STORAGE].filter((name) => CastleFarm.inStorage(name)).join();
    if (key === CastleFarm.storageKey) return;
    CastleFarm.storageKey = key;
    CastleFarm.onStorageChange?.();
  }

  // Нужна ли покупка, чтобы поставить здание: платное и не куплено на бэкенде.
  static needsPurchase(name) {
    return CastleFarm.isPaid(name) && !CastleFarm.owned(name);
  }

  // Выбор платного здания в панели строительства: состояния нет — нельзя
  // (не знаем цену), не куплено и не хватает ресурсов — нельзя.
  static selectionError(name) {
    if (!CastleFarm.isPaid(name)) return '';
    if (!CastleFarm.state) return Lang.text('farmUnavailable');
    if (CastleFarm.needsPurchase(name) && !CastleFarm.affordable(CastleFarm.buildPrice(name))) return Lang.text('farmNotEnough');
    return '';
  }

  static errorText(error) {
    const code = String(error?.message || error || '');
    return /^farm[A-Z]\w+$/.test(code) && Lang.text(code) !== code ? Lang.text(code) : code;
  }

  static async request(method, data) {
    if (CastleFarm.preview) return CastleFarm.previewRequest(method, data);
    return await App.api.request('farm', method, data);
  }

  static async load() {
    try {
      CastleFarm.apply(await CastleFarm.request('state'));
    } catch (error) {
      console.error('farm.state', error);
    }
  }

  // Перечитать состояние, если оно старше maxAge (после боя, возврата в замок).
  static refresh(maxAge = 30000) {
    if (Date.now() - CastleFarm.loadedAt > maxAge) CastleFarm.load();
  }

  static apply(state) {
    if (!state || typeof state !== 'object' || !state.buildings) return;
    CastleFarm.state = state;
    CastleFarm.loadedAt = Date.now();
    if (Number.isFinite(Number(state.now))) CastleFarm.clockOffset = Number(state.now) - Date.now();
    CastleFarm.updateCorner();
    CastleFarm.reconcile();
    CastleFarm.refreshPanel();
    CastleFarm.storageChanged();
    CastleFarm.renderDialog();
  }

  // Фермы, которые стоят в castle-farm.cfg, но не куплены, — убрать из замка.
  static reconcile() {
    if (!CastleFarm.state || !Castle.isBuildingsLoaded || CastleFarm.preview) return;
    const before = Castle.placedBuildings.length;
    Castle.placedBuildings = Castle.placedBuildings.filter((b) => !CastleFarm.needsPurchase(Castle.buildings[b.id]));
    if (Castle.placedBuildings.length !== before) {
      Castle.isStaticSMCached = false;
      Castle.WriteBuildings();
      CastleFarm.refreshPanel();
    }
  }

  static async build(name) {
    if (CastleFarm.busy.has(name)) return false;
    CastleFarm.busy.add(name);
    try {
      CastleFarm.apply(await CastleFarm.request('build', { building: name }));
      return true;
    } catch (error) {
      App.error(CastleFarm.errorText(error));
      return false;
    } finally {
      CastleFarm.busy.delete(name);
    }
  }

  static async upgrade(name) {
    if (CastleFarm.busy.has(name)) return;
    CastleFarm.busy.add(name);
    try {
      CastleFarm.apply(await CastleFarm.request('upgrade', { building: name }));
      Sound.play(SOUNDS_LIBRARY.NEW_LEVEL, { id: 'ui-farm-upgrade', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
      CastleFarm.dialog?.classList.add('farm-dialog-upgraded');
      setTimeout(() => CastleFarm.dialog?.classList.remove('farm-dialog-upgraded'), 950);
    } catch (error) {
      App.error(CastleFarm.errorText(error));
    } finally {
      CastleFarm.busy.delete(name);
      CastleFarm.renderDialog();
    }
  }

  static async collect(name) {
    const value = CastleFarm.stored(name);
    if (!value?.collectable || CastleFarm.busy.has(name)) return;
    CastleFarm.busy.add(name);
    try {
      const state = await CastleFarm.request('collect', { building: name });
      CastleFarm.apply(state);
      const amount = Number(state?.collected?.amount) || 0;
      if (amount > 0) {
        Sound.play(SOUNDS_LIBRARY.GOLD_COINS, { id: 'ui-farm-collect', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) * 0.55 });
        CastleFarm.flyout(name, CastleFarm.BUILDINGS[name], amount);
      }
    } catch (error) {
      App.error(CastleFarm.errorText(error));
    } finally {
      CastleFarm.busy.delete(name);
    }
  }

  // ---------------------------------------------------------------------
  // Угол ресурсов (правый верхний угол замка, View.castleBannerOnline)
  // ---------------------------------------------------------------------

  // Ячейки золота и трёх ресурсов для полосы баннера: иконка и число под ней.
  // Кристаллы рядом — прежний View.castleCrystalContainer (его обновляют
  // магазин, ярмарка и «3 в ряд»).
  static createCorner() {
    CastleFarm.cornerValues = {};
    const resources = CastleFarm.faction() === 'ad' ? ['resource3', 'resource2', 'resource1'] : CastleFarm.RESOURCES;
    const items = [...CastleFarm.COMING_SOON, CastleFarm.SILVER, ...resources].map((resource) => {
      const soon = CastleFarm.COMING_SOON.includes(resource);
      const value = DOM({ style: 'farm-corner-value' }, soon ? '' : '-');
      const icon = DOM({ tag: 'img', style: 'farm-corner-icon', src: CastleFarm.iconUrl(resource), alt: '' });
      // клик по ресурсу — свой аудит фермы: откуда ресурсы; недоступные — без клика
      const item = DOM(
        soon
          ? { style: ['farm-corner-item', `farm-corner-item--${resource}`, 'farm-corner-item--soon'] }
          : {
              style: ['farm-corner-item', `farm-corner-item--${resource}`],
              domaudio: domAudioPresets.bigButton,
              event: ['click', () => CastleFarm.openAudit({ id: Number(App.storage?.data?.id) || 0 })],
            },
        icon,
        value,
      );
      CastleFarm.cornerValues[resource] = { item, icon, value };
      return item;
    });
    CastleFarm.updateCorner();
    return items;
  }

  // Смена фракции (Castle.applyScene): иконки и названия ресурсов у фракций свои.
  // Пузыри сбора берут иконку каждый кадр, остальное — перерисовать.
  static factionChanged() {
    CastleFarm.updateCorner();
    CastleFarm.refreshPanel();
    CastleFarm.renderDialog();
  }

  static updateCorner() {
    const wallet = CastleFarm.state?.wallet;
    const resourceOrder = CastleFarm.faction() === 'ad' ? ['resource3', 'resource2', 'resource1'] : CastleFarm.RESOURCES;
    for (const [resource, nodes] of Object.entries(CastleFarm.cornerValues)) {
      const amount = Number(wallet?.[resource]) || 0;
      nodes.icon.src = CastleFarm.iconUrl(resource);
      if (CastleFarm.COMING_SOON.includes(resource)) {
        nodes.item.dataset.tooltip = `${CastleFarm.resourceName(resource)}\n${Lang.text('farmComingSoon')}`;
        continue;
      }
      nodes.value.textContent = wallet ? CastleFarm.format(amount) : '-';
      if (resource === CastleFarm.SILVER) {
        nodes.item.dataset.tooltip = `${CastleFarm.resourceName(resource)}\n${wallet ? amount : '-'}\n${Lang.text('farmSilverHint')}`;
        continue;
      }
      // лимит склада (pw-api Farm.limit): у старого бэкенда его нет
      const limit = Number(CastleFarm.state?.limit) || 0;
      const resourceLimit = limit && CastleFarm.RESOURCES.includes(resource);
      nodes.item.classList.toggle('farm-corner-full', Boolean(wallet && resourceLimit && amount >= limit));
      const shown = wallet ? (resourceLimit ? `${amount} / ${limit}` : amount) : '-';
      nodes.item.dataset.tooltip = `${CastleFarm.resourceName(resource)}\n${shown}${resourceLimit && amount >= limit ? `\n${Lang.text('farmLimitHint')}` : ''}\n${Lang.text('farmAuditHint')}`;
    }
    const ordered = resourceOrder.map((resource) => CastleFarm.cornerValues[resource]?.item).filter(Boolean);
    const parent = ordered[0]?.parentElement;
    if (parent && ordered.every((item) => item.parentElement === parent)) {
      const current = [...parent.children].filter((item) => ordered.includes(item));
      if (current.some((item, index) => item !== ordered[index])) {
        const after = current[current.length - 1].nextSibling;
        for (const item of ordered) parent.insertBefore(item, after);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Пузыри сбора и подсказка над зданиями (каждый кадр, Castle.UpdateBuildingBubbles)
  // ---------------------------------------------------------------------

  static updateScene() {
    if (!Castle.buildingBubbles || !CastleFarm.state) return;
    const placed = new Set();
    for (const building of Castle.placedBuildings) {
      const name = Castle.buildings[building.id];
      if (!CastleFarm.isFarm(name) || !CastleFarm.isBuilt(name)) continue;
      placed.add(name);
      const value = CastleFarm.stored(name);
      let bubble = CastleFarm.bubbles[name];
      if (!bubble) {
        // якорь стоит над зданием, качается только пузырь внутри него
        bubble = DOM(
          { style: 'farm-anchor' },
          DOM(
            {
              style: 'farm-bubble',
              domaudio: domAudioPresets.bigButton,
              event: ['click', () => CastleFarm.collect(name)],
            },
            DOM({ tag: 'img', alt: '' }),
          ),
        );
        CastleFarm.bubbles[name] = bubble;
        Castle.buildingBubbles.append(bubble);
      }
      const visible = value.collectable && !Castle.buildMode;
      bubble.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      bubble.querySelector('img').src = CastleFarm.iconUrl(CastleFarm.BUILDINGS[name]);
      bubble.firstChild.classList.toggle('farm-bubble-full', value.full);
      CastleFarm.placeAt(bubble, CastleFarm.viewPosition(building));
    }
    for (const name of Object.keys(CastleFarm.bubbles)) {
      if (!placed.has(name)) CastleFarm.bubbles[name].style.display = 'none';
    }
    // «+N» после сбора держится над своим зданием, пока летит
    for (const fly of CastleFarm.flyouts) {
      const building = Castle.placedBuildings.find((item) => Castle.buildings[item.id] === fly.name);
      if (building) CastleFarm.placeAt(fly.anchor, CastleFarm.viewPosition(building));
    }
    CastleFarm.updateTooltip();
  }

  // Точка над крышей фермы (по габаритам модели здания).
  static viewPosition(building) {
    return Castle.buildingTopScreenPoint(building);
  }

  // Поставить якорь в точку экрана: transform вместо left/top — без пересчёта
  // раскладки страницы каждый кадр; анимации содержимого якоря его не сдвигают.
  static placeAt(node, position) {
    node.style.transform = `translate3d(${Math.round(position[0])}px, ${Math.round(position[1])}px, 0)`;
  }

  static flyouts = new Set();

  // Кликабельные здания без добычи: в подсказке — название и что откроет клик.
  static INFO_BUILDINGS = ['fair', 'library', 'talent_farm', 'easel'];

  // Подсказка при наведении на ферму: уровень, название, накоплено, таймер, полоса.
  // У кликабельных зданий без добычи (INFO_BUILDINGS, склад) — та же плашка:
  // название и строка-пояснение (.farm-tooltip-info).
  static updateTooltip() {
    const outlined = Castle.outlinedBuilding;
    const name = outlined?.name;
    const info = CastleFarm.INFO_BUILDINGS.includes(name) || (name === CastleFarm.STORAGE && CastleFarm.owned(name));
    const show = !Castle.buildMode && !CastleFarm.dialog?.open && (info || (CastleFarm.isFarm(name) && CastleFarm.isBuilt(name)));
    if (!show) {
      if (CastleFarm.tooltip) CastleFarm.tooltip.style.display = 'none';
      return;
    }
    if (!CastleFarm.tooltip) {
      CastleFarm.tooltip = DOM(
        { style: 'farm-anchor' },
        DOM(
        { style: 'farm-tooltip' },
        DOM({ style: 'farm-tooltip-heading' }, DOM({ style: 'farm-level' }), DOM({ tag: 'strong' })),
        DOM(
          { style: 'farm-tooltip-detail' },
          DOM({ style: 'farm-tooltip-resource' }, DOM({ tag: 'img', alt: '' })),
          DOM({ style: 'farm-tooltip-amount' }),
          DOM({ style: 'farm-tooltip-time' }),
        ),
        DOM({ style: 'farm-progress' }),
        DOM({ style: 'farm-tooltip-note' }),
        ),
      );
    }
    if (CastleFarm.tooltip.parentNode !== Castle.buildingBubbles) Castle.buildingBubbles.append(CastleFarm.tooltip);
    const tip = CastleFarm.tooltip;
    const building = Castle.placedBuildings.find((item) => Castle.buildings[item.id] === name);
    if (!building) {
      tip.style.display = 'none';
      return;
    }
    tip.firstChild.classList.toggle('farm-tooltip-info', info);
    if (info) {
      const storage = name === CastleFarm.STORAGE ? CastleFarm.state?.storage : null;
      tip.querySelector('.farm-level').textContent = storage ? storage.level : '';
      tip.querySelector('.farm-level').hidden = !storage;
      tip.querySelector('strong').textContent = CastleFarm.buildingName(name);
      tip.querySelector('.farm-tooltip-note').textContent = storage
        ? `${Lang.text('farmStorageLimit')}: ${CastleFarm.format(storage.limit)}`
        : Lang.text(`farmHover_${name}`);
      tip.firstChild.classList.remove('farm-full');
      tip.style.display = 'block';
      CastleFarm.placeAt(tip, CastleFarm.viewPosition(building));
      return;
    }
    tip.querySelector('.farm-level').hidden = false;
    const b = CastleFarm.building(name);
    const value = CastleFarm.stored(name);
    tip.querySelector('.farm-level').textContent = b.level;
    tip.querySelector('strong').textContent = CastleFarm.buildingName(name);
    tip.querySelector('img').src = CastleFarm.iconUrl(b.resource);
    tip.querySelector('.farm-tooltip-amount').textContent = `+${value.amount}`;
    tip.querySelector('.farm-tooltip-time').textContent = value.full ? Lang.text('farmReady') : CastleFarm.timer(value.remaining);
    tip.querySelector('.farm-progress').style.setProperty('--fill', `${value.percent}%`);
    tip.firstChild.classList.toggle('farm-full', value.full);
    tip.style.display = 'block';
    CastleFarm.placeAt(tip, CastleFarm.viewPosition(building));
  }

  // «+N» с иконкой, улетающее вверх от пузыря после сбора.
  static flyout(name, resource, amount) {
    const bubble = CastleFarm.bubbles[name];
    const building = Castle.placedBuildings.find((item) => Castle.buildings[item.id] === name);
    if (!Castle.buildingBubbles || !building) return;
    const label = DOM({ style: 'farm-yield' }, DOM({ tag: 'img', src: CastleFarm.iconUrl(resource), alt: '' }), DOM({ tag: 'strong' }, `+${amount}`));
    // якорь едет за зданием (updateScene), «+N» внутри него летит вверх
    const anchor = DOM({ style: 'farm-anchor' }, label);
    const fly = { anchor, name };
    CastleFarm.flyouts.add(fly);
    CastleFarm.placeAt(anchor, CastleFarm.viewPosition(building));
    Castle.buildingBubbles.append(anchor);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const animation = label.animate(
      reduced
        ? [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }]
        : [
            { opacity: 0, transform: 'translate(-50%, 0) scale(.9)' },
            { opacity: 1, transform: 'translate(-50%, -1.2vh) scale(1)', offset: 0.14 },
            { opacity: 1, transform: 'translate(-50%, -6vh) scale(1)', offset: 0.7 },
            { opacity: 0, transform: 'translate(-50%, -8.5vh) scale(.98)' },
          ],
      { duration: 1350, easing: 'ease-out', fill: 'forwards' },
    );
    const done = () => {
      anchor.remove();
      CastleFarm.flyouts.delete(fly);
    };
    animation.finished.then(done, done);
    if (bubble) bubble.style.display = 'none';
  }

  // ---------------------------------------------------------------------
  // Панель строительства: цена постройки на карточке фермы
  // ---------------------------------------------------------------------

  static priceRow(price, className = 'farm-price') {
    return DOM(
      { style: className },
      ...Object.entries(price || {}).map(([resource, amount]) =>
        DOM(
          { style: ['farm-price-item', ...(CastleFarm.affordable({ [resource]: amount }) ? [] : ['farm-price-item-short'])], data: { farmTip: CastleFarm.resourceName(resource) } },
          DOM({ tag: 'img', src: CastleFarm.iconUrl(resource), alt: '' }),
          String(amount),
        ),
      ),
    );
  }

  static decoratePanelItem(element, name) {
    if (!CastleFarm.isPaid(name)) return;
    element.querySelector('.farm-panel-price')?.remove();
    element.classList.remove('castle-building-item-expensive');
    if (!CastleFarm.state || element.classList.contains('castle-building-item-taken')) return;
    const price = CastleFarm.buildPrice(name);
    if (CastleFarm.owned(name) || !Object.keys(price || {}).length) {
      element.append(DOM({ style: ['farm-panel-price', 'farm-panel-owned'] }, Lang.text('farmPlaceFree')));
      element.dataset.tooltip = Lang.text('farmPlaceFreeTooltip');
      return;
    }
    element.append(CastleFarm.priceRow(price, 'farm-panel-price'));
    if (!CastleFarm.affordable(price)) {
      element.classList.add('castle-building-item-expensive');
      element.dataset.tooltip = Lang.text('farmNotEnough');
    } else {
      element.dataset.tooltip = Lang.text('farmBuildTooltip');
    }
  }

  // ---------------------------------------------------------------------
  // Подсказки в окнах фермы (data-farm-tip). Модальный <dialog> лежит поверх
  // слоя подсказок лаунчера, а CSS ::after резали прокрутка тела аудита и
  // края окна. Поэтому одна подсказка на окно, прямо в нём (не в прокрутке):
  // над элементом, если сверху нет места — под ним, по ширине — в рамке окна.
  // ---------------------------------------------------------------------

  static bindTips(dialog) {
    const tip = DOM({ style: 'farm-tip' });
    let target = null;
    const hide = () => {
      target = null;
      tip.style.display = 'none';
    };
    const show = (element) => {
      target = element;
      if (tip.parentNode !== dialog) dialog.append(tip); // renderAudit перерисовывает окно целиком
      tip.textContent = element.dataset.farmTip;
      tip.style.display = 'block';
      const vh = window.innerHeight / 100;
      const margin = 0.8 * vh;
      const gap = 0.6 * vh;
      const box = dialog.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      // координаты внутри окна: absolute считается от его рамки (у окна transform)
      const originX = box.left + dialog.clientLeft;
      const originY = box.top + dialog.clientTop;
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2 - originX, margin), dialog.clientWidth - width - margin);
      let top = rect.top - originY - gap - height;
      if (top < margin) top = rect.bottom - originY + gap;
      tip.style.left = `${Math.max(margin, left)}px`;
      tip.style.top = `${top}px`;
    };
    dialog.addEventListener('pointerover', (event) => {
      const element = event.target.closest?.('[data-farm-tip]');
      if (element && dialog.contains(element) && element.dataset.farmTip) {
        if (element !== target) show(element);
      } else if (target) hide();
    });
    dialog.addEventListener('pointerleave', hide);
    dialog.addEventListener('scroll', hide, true);
    dialog.addEventListener('close', hide);
    hide();
  }

  // Видимость «уже стоит» и цена на карточках: reconcile мог убрать из замка
  // некупленную ферму из castle-farm.cfg, а панель нарисована раньше.
  static refreshPanel() {
    Castle.updateBuildingItemsState();
  }

  // ---------------------------------------------------------------------
  // Окно здания: портрет, уровень, улучшение, производство, вместимость, сбор
  // ---------------------------------------------------------------------

  static openInfo(name) {
    if (!CastleFarm.isFarm(name) && name !== CastleFarm.STORAGE) return;
    if (name === CastleFarm.STORAGE && CastleFarm.state && !CastleFarm.state.storage) return; // старый бэкенд
    if (!CastleFarm.state) {
      App.error(Lang.text('farmUnavailable'));
      CastleFarm.load();
      return;
    }
    if (!CastleFarm.dialog) CastleFarm.createDialog();
    if (!CastleFarm.dialog.isConnected) document.body.append(CastleFarm.dialog);
    CastleFarm.dialogBuilding = name;
    if (!CastleFarm.dialog.open) CastleFarm.dialog.showModal();
    CastleFarm.renderDialog();
    CastleFarm.dialog.querySelector('.farm-dialog-close').focus();
    clearInterval(CastleFarm.clock);
    CastleFarm.clock = setInterval(() => CastleFarm.renderDialog(), 1000);
    CastleFarm.refresh();
  }

  static closeInfo() {
    clearInterval(CastleFarm.clock);
    if (CastleFarm.dialog?.open) CastleFarm.dialog.close();
  }

  static createDialog() {
    const metric = (key, label, framed = true) =>
      DOM(
        { style: 'farm-metric' },
        // подсказка — на обёртке: ::before/::after иконки заняты рамкой
        DOM(
          { style: 'farm-metric-tip', data: { metric: `${key}-tip` } },
          DOM(
            { style: ['farm-metric-icon', framed ? 'farm-metric-icon--framed' : 'farm-metric-icon--timer'] },
            DOM({ tag: 'img', alt: '', ...(framed ? { style: 'farm-metric-resource' } : { src: 'content/img/farm/hourglass.png' }) }),
          ),
        ),
        DOM({ style: 'farm-metric-value', data: { metric: key } }),
        DOM({ style: 'farm-metric-label' }, Lang.text(label)),
      );
    const dialog = DOM(
      { tag: 'dialog', style: 'farm-dialog' },
      DOM(
        { style: 'farm-dialog-header' },
        DOM(
          { style: 'farm-dialog-identity' },
          DOM(
            { style: 'farm-portrait' },
            DOM({ tag: 'img', style: 'farm-portrait-img', alt: '' }),
            DOM({ style: 'farm-portrait-level' }),
          ),
          DOM({ tag: 'h2', style: 'farm-dialog-title' }),
          // «+» улучшения — поверх плашки названия, поэтому не в портрете (у того слой ниже
          // плашки), а в своём слое того же размера и на том же месте
          DOM(
            { style: 'farm-upgrade-anchor' },
            DOM(
              {
                tag: 'button',
                style: 'farm-upgrade',
                event: ['click', () => CastleFarm.upgrade(CastleFarm.dialogBuilding)],
              },
              DOM({ tag: 'img', src: 'content/img/farm/upgrade.png', alt: '' }),
            ),
            // подсказка улучшения, как в оригинале: что даёт и цена с иконками
            DOM({ style: 'farm-upgrade-tip' }, DOM({ style: 'farm-upgrade-tip-title' }), DOM({ style: 'farm-upgrade-tip-price' })),
          ),
        ),
        DOM({
          tag: 'button',
          style: 'farm-dialog-close',
          domaudio: domAudioPresets.closeButton,
          data: { farmTip: Lang.text('farmClose') },
          event: ['click', () => CastleFarm.closeInfo()],
        }),
      ),
      DOM({ tag: 'p', style: 'farm-dialog-description' }),
      DOM(
        { style: 'farm-metrics' },
        metric('rate', 'farmRate'),
        metric('capacity', 'farmCapacity'),
        metric('duration', 'farmFillTime', false),
      ),
      DOM(
        { style: 'farm-dialog-upgrade' },
        DOM({ style: 'farm-dialog-upgrade-label' }),
        DOM({ style: 'farm-dialog-upgrade-price' }),
      ),
      DOM(
        { style: 'farm-dialog-current' },
        DOM({ style: 'farm-dialog-stored' }),
        DOM({ style: 'farm-dialog-remaining' }),
        DOM(
          {
            tag: 'button',
            style: 'farm-dialog-collect',
            domaudio: domAudioPresets.bigButton,
            event: ['click', () => CastleFarm.collect(CastleFarm.dialogBuilding).then(() => CastleFarm.renderDialog())],
          },
        ),
      ),
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      CastleFarm.closeInfo();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) CastleFarm.closeInfo();
    });
    dialog.addEventListener('close', () => clearInterval(CastleFarm.clock));
    CastleFarm.bindTips(dialog);
    CastleFarm.dialog = dialog;
  }

  static renderDialog() {
    const dialog = CastleFarm.dialog;
    const name = CastleFarm.dialogBuilding;
    if (!dialog?.open || !name) return;
    dialog.classList.toggle('farm-dialog-storage', name === CastleFarm.STORAGE);
    if (name === CastleFarm.STORAGE) return CastleFarm.renderStorage(dialog);
    const b = CastleFarm.building(name);
    if (!b) return;
    const q = (selector) => dialog.querySelector(selector);
    const built = b.level > 0;
    const value = CastleFarm.stored(name);
    const title = CastleFarm.buildingName(name);
    q('.farm-dialog-title').textContent = title;
    q('.farm-portrait-img').src = `content/img/buildings/${CastleFarm.faction()}/${name}.png`;
    q('.farm-portrait-level').textContent = built ? b.level : '0';
    q('.farm-dialog-description').textContent = Lang.text(`farmProduces_${name}_${CastleFarm.faction()}`);
    dialog.querySelectorAll('.farm-metric-resource').forEach((image) => {
      image.src = CastleFarm.iconUrl(b.resource);
    });
    for (const key of ['rate', 'capacity']) {
      q(`[data-metric="${key}-tip"]`).dataset.farmTip = CastleFarm.resourceName(b.resource);
    }
    const rate = built ? Math.round(b.rate) : b.nextRate;
    const capacity = built ? b.capacity : b.nextCapacity;
    q('[data-metric="rate"]').textContent = `+${CastleFarm.format(rate)}`;
    q('[data-metric="capacity"]').textContent = CastleFarm.format(capacity);
    q('[data-metric="duration"]').textContent = Lang.text('farmHours').replace('{n}', Math.round((capacity / (rate || 1)) * 10) / 10);

    const max = b.level >= b.maxLevel;
    const upgrade = q('.farm-upgrade');
    const canUpgrade = built && !max && CastleFarm.affordable(b.price) && !CastleFarm.busy.has(name);
    upgrade.disabled = !canUpgrade;
    upgrade.hidden = !built;
    // подсказка «+»: перерисовываем только при смене уровня или кошелька (окно тикает раз в секунду)
    const tipKey = `${b.level}|${JSON.stringify(b.price)}|${JSON.stringify(CastleFarm.state?.wallet)}`;
    const tip = q('.farm-upgrade-tip');
    if (tip.dataset.key !== tipKey) {
      tip.dataset.key = tipKey;
      q('.farm-upgrade-tip-title').textContent = max ? Lang.text('farmMaxLevel') : Lang.text('farmUpgradeTip').replace('{level}', b.level + 1);
      q('.farm-upgrade-tip-price').replaceChildren(
        ...(max ? [] : [DOM({ style: 'farm-upgrade-tip-label' }, Lang.text('farmUpgradeCost')), CastleFarm.priceRow(b.price)]),
      );
    }
    const upgradeRow = q('.farm-dialog-upgrade');
    upgradeRow.hidden = !built;
    if (built) {
      q('.farm-dialog-upgrade-label').textContent = max
        ? Lang.text('farmMaxLevel')
        : Lang.text('farmUpgradeRow').replace('{level}', b.level + 1).replace('{rate}', CastleFarm.format(b.nextRate)).replace('{capacity}', CastleFarm.format(b.nextCapacity));
      q('.farm-dialog-upgrade-price').replaceChildren(...(max ? [] : [CastleFarm.priceRow(b.price)]));
    }

    const collect = q('.farm-dialog-collect');
    if (!built) {
      q('.farm-dialog-stored').textContent = Lang.text('farmNotBuiltHint');
      q('.farm-dialog-remaining').textContent = '';
      collect.hidden = true;
      dialog.classList.remove('farm-full');
      return;
    }
    q('.farm-dialog-stored').textContent = Lang.text('farmStored').replace('{n}', value.amount).replace('{max}', value.capacity);
    q('.farm-dialog-remaining').textContent = value.full ? Lang.text('farmFull') : Lang.text('farmUntilFull').replace('{t}', CastleFarm.timer(value.remaining));
    collect.hidden = false;
    collect.disabled = !value.collectable || CastleFarm.busy.has(name);
    // до следующего сбора (частота — в админке) — таймер вместо «Собрать»
    collect.textContent = value.collectIn > 0
      ? Lang.text('farmCollectIn').replace('{t}', CastleFarm.timer(value.collectIn))
      : `${Lang.text('farmCollect')} +${value.amount}`;
    dialog.classList.toggle('farm-full', value.full);
  }

  // Окно склада ресурсов: уровень, лимит каждого ресурса, улучшение (pw-api
  // Farm.storageView). Показатели добычи и сбор скрыты (.farm-dialog-storage).
  static renderStorage(dialog) {
    const s = CastleFarm.state?.storage;
    if (!s) return;
    const q = (selector) => dialog.querySelector(selector);
    const name = CastleFarm.STORAGE;
    const built = s.level > 0;
    const max = s.level >= s.maxLevel;
    q('.farm-dialog-title').textContent = CastleFarm.buildingName(name);
    q('.farm-portrait-img').src = `content/img/buildings/${CastleFarm.faction()}/${name}.png`;
    q('.farm-portrait-level').textContent = s.level;
    q('.farm-dialog-description').textContent = Lang.text('farmStorageDescription');
    const upgrade = q('.farm-upgrade');
    upgrade.hidden = !built;
    upgrade.disabled = !built || max || !CastleFarm.affordable(s.price) || CastleFarm.busy.has(name);
    const tipKey = `storage|${s.level}|${JSON.stringify(s.price)}|${JSON.stringify(CastleFarm.state?.wallet)}`;
    const tip = q('.farm-upgrade-tip');
    if (tip.dataset.key !== tipKey) {
      tip.dataset.key = tipKey;
      q('.farm-upgrade-tip-title').textContent = max ? Lang.text('farmMaxLevel') : Lang.text('farmStorageUpgradeRow').replace('{level}', s.level + 1).replace('{limit}', CastleFarm.format(s.nextLimit));
      q('.farm-upgrade-tip-price').replaceChildren(
        ...(max ? [] : [DOM({ style: 'farm-upgrade-tip-label' }, Lang.text('farmUpgradeCost')), CastleFarm.priceRow(s.price)]),
      );
    }
    q('.farm-dialog-upgrade').hidden = !built;
    q('.farm-dialog-upgrade-label').textContent = max
      ? Lang.text('farmMaxLevel')
      : Lang.text('farmStorageUpgradeRow').replace('{level}', s.level + 1).replace('{limit}', CastleFarm.format(s.nextLimit));
    q('.farm-dialog-upgrade-price').replaceChildren(...(max ? [] : [CastleFarm.priceRow(s.price)]));
    q('.farm-dialog-stored').textContent = `${Lang.text('farmStorageLimit')}: ${CastleFarm.format(s.limit)}`;
    q('.farm-dialog-remaining').textContent = max ? '' : `${Lang.text('farmStorageNext')}: ${CastleFarm.format(s.nextLimit)}`;
    q('.farm-dialog-collect').hidden = true;
    dialog.classList.remove('farm-full');
  }

  // ---------------------------------------------------------------------
  // Аудит фермы (farm.audit): откуда и сколько ресурсов получил любой игрок.
  // Каждое изменение кошелька на бэкенде пишется в журнал, а сверка «кошелёк =
  // сумма журнала» показывает, если ресурсы попали в кошелёк мимо игры.
  // ---------------------------------------------------------------------

  static audit = null;

  static AUDIT_CURRENCIES = ['gold', 'resource1', 'resource2', 'resource3'];

  static amounts(row, signed = true) {
    const items = CastleFarm.AUDIT_CURRENCIES.filter((currency) => Number(row?.[currency]));
    if (!items.length) return DOM({ style: 'farm-audit-amounts' }, '—');
    return DOM(
      { style: 'farm-audit-amounts' },
      ...items.map((currency) => {
        const value = Number(row[currency]);
        return DOM(
          { style: ['farm-price-item', signed ? (value > 0 ? 'farm-audit-plus' : 'farm-audit-minus') : ''].filter(Boolean), data: { farmTip: CastleFarm.resourceName(currency) } },
          DOM({ tag: 'img', src: CastleFarm.iconUrl(currency), alt: '' }),
          `${signed && value > 0 ? '+' : ''}${value}`,
        );
      }),
    );
  }

  static auditEntryText(entry) {
    const building = entry.building ? CastleFarm.buildingName(entry.building) : '';
    let text = Lang.text(`farmAuditEntry_${entry.action}`)
      .replace('{ref}', entry.ref)
      .replace('{building}', building)
      .replace('{level}', entry.level);
    if (entry.action === 'battle') {
      const parts = [];
      if (Number.isInteger(entry.mode) && entry.mode >= 0 && entry.mode < 6) parts.push(Lang.text(`gm${entry.mode + 1}`));
      if (entry.win === true) parts.push(Lang.text('farmAuditWin'));
      if (entry.win === false) parts.push(Lang.text('farmAuditLoss'));
      if (parts.length) text += ` — ${parts.join(', ')}`;
    }
    return text;
  }

  static auditDate(value) {
    const date = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return String(value || '');
    return date.toLocaleString(Lang.target === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  static async openAudit({ id = 0, nickname = '' } = {}) {
    let data;
    try {
      data = await (CastleFarm.preview ? CastleFarm.previewAudit() : App.api.request('farm', 'audit', { id }));
    } catch (error) {
      App.error(CastleFarm.errorText(error));
      return;
    }
    CastleFarm.audit = { id: data.player?.id || id, data, journal: data.journal || [], more: data.more };
    if (!CastleFarm.auditDialog) {
      CastleFarm.auditDialog = DOM({ tag: 'dialog', style: ['farm-dialog', 'farm-audit'] });
      CastleFarm.auditDialog.addEventListener('close', () => CastleFarm.auditScrollCleanup?.());
      CastleFarm.bindTips(CastleFarm.auditDialog);
      CastleFarm.auditDialog.addEventListener('click', (event) => {
        if (event.target !== CastleFarm.auditDialog) return;
        const box = CastleFarm.auditDialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) CastleFarm.auditDialog.close();
      });
    }
    if (!CastleFarm.auditDialog.isConnected) document.body.append(CastleFarm.auditDialog);
    CastleFarm.renderAudit(nickname);
    if (!CastleFarm.auditDialog.open) CastleFarm.auditDialog.showModal();
  }

  static async auditMore() {
    const audit = CastleFarm.audit;
    if (!audit?.more || CastleFarm.preview) return;
    const before = audit.journal[audit.journal.length - 1]?.id;
    try {
      const data = await App.api.request('farm', 'audit', { id: audit.id, before });
      audit.journal.push(...(data.journal || []));
      audit.more = data.more;
      const top = CastleFarm.auditDialog?.querySelector('.farm-audit-body')?.scrollTop || 0;
      CastleFarm.renderAudit();
      CastleFarm.auditDialog.querySelector('.farm-audit-body').scrollTop = top;
    } catch (error) {
      App.error(CastleFarm.errorText(error));
    }
  }

  static renderAudit(nickname = '') {
    CastleFarm.auditScrollCleanup?.();
    const dialog = CastleFarm.auditDialog;
    const { data, journal, more } = CastleFarm.audit;
    const name = data.player?.nickname || nickname;
    const totals = CastleFarm.AUDIT_ACTIONS.filter((action) => data.totals?.[action]).map((action) =>
      DOM(
        { style: 'farm-audit-row' },
        DOM({ style: 'farm-audit-source' }, Lang.text(`farmAuditSource_${action}`), DOM({ tag: 'small' }, Lang.text('farmAuditCount').replace('{n}', data.totals[action].count))),
        CastleFarm.amounts(data.totals[action]),
      ),
    );
    const mismatch = CastleFarm.AUDIT_CURRENCIES.some((currency) => Number(data.unexplained?.[currency]));
    dialog.replaceChildren(
      DOM(
        { style: 'farm-dialog-header' },
        DOM({ tag: 'h2', style: ['farm-dialog-title', 'farm-audit-title'] }, Lang.text('farmAuditTitle').replace('{nickname}', name)),
        DOM({
          tag: 'button',
          style: 'farm-dialog-close',
          domaudio: domAudioPresets.closeButton,
          data: { farmTip: Lang.text('farmClose') },
          event: ['click', () => dialog.close()],
        }),
      ),
      DOM(
        { style: 'farm-audit-body', tabIndex: 0 },
        DOM({ style: 'farm-audit-heading' }, Lang.text('farmAuditWallet')),
        CastleFarm.amounts(data.wallet, false),
        DOM({ style: ['farm-audit-check', mismatch ? 'farm-audit-check-bad' : 'farm-audit-check-ok'] }, mismatch ? Lang.text('farmAuditMismatch') : Lang.text('farmAuditVerified'), ...(mismatch ? [CastleFarm.amounts(data.unexplained)] : [])),
        DOM({ style: 'farm-audit-heading' }, Lang.text('farmAuditTotals')),
        ...(totals.length ? totals : [DOM({ style: 'farm-audit-empty' }, Lang.text('farmAuditEmpty'))]),
        DOM({ style: 'farm-audit-heading' }, Lang.text('farmAuditJournal')),
        DOM(
          { style: 'farm-audit-journal' },
          ...journal.map((entry) =>
            DOM(
              { style: 'farm-audit-row' },
              DOM({ style: 'farm-audit-date' }, CastleFarm.auditDate(entry.added)),
              DOM({ style: 'farm-audit-source' }, CastleFarm.auditEntryText(entry)),
              CastleFarm.amounts(entry),
            ),
          ),
          ...(more
            ? [DOM({ tag: 'button', style: 'farm-dialog-collect', domaudio: domAudioPresets.defaultButton, event: ['click', () => CastleFarm.auditMore()] }, Lang.text('farmAuditMore'))]
            : []),
        ),
      ),
    );
    const body = dialog.querySelector('.farm-audit-body');
    const scroll = DOM({ style: 'farm-audit-scroll' }, body);
    dialog.append(scroll);
    CastleFarm.bindAuditScrollbar(scroll, body);
  }

  static bindAuditScrollbar(scroll, body) {
    const thumb = DOM({ style: 'farm-audit-scroll-thumb' });
    const rail = DOM({ style: 'farm-audit-scroll-rail' }, thumb);
    const arrow = (direction, label) => DOM({
      tag: 'button',
      type: 'button',
      style: ['farm-audit-scroll-arrow', `farm-audit-scroll-arrow--${direction < 0 ? 'up' : 'down'}`],
      ariaLabel: Lang.text(label),
      title: Lang.text(label),
      event: ['click', () => { body.scrollTop += direction * 40; }],
    });
    const up = arrow(-1, 'bsKeyCameraUp');
    const down = arrow(1, 'bsKeyCameraDown');
    body.id = 'farm-audit-scroll-body';
    for (const [name, value] of [['role', 'scrollbar'], ['aria-label', Lang.text('farmAuditJournal')], ['aria-controls', body.id], ['aria-orientation', 'vertical'], ['aria-valuemin', '0']]) thumb.setAttribute(name, value);
    scroll.append(DOM({ style: 'farm-audit-scrollbar' }, up, rail, down));
    const max = () => Math.max(0, body.scrollHeight - body.clientHeight);
    const travel = () => Math.max(0, rail.clientHeight - thumb.offsetHeight);
    let frame = 0, drag = null;
    const update = () => {
      const limit = max();
      const height = rail.clientHeight;
      const size = Math.min(height, Math.max(24, height * body.clientHeight / Math.max(1, body.scrollHeight)));
      thumb.style.height = `${size}px`;
      thumb.style.top = `${limit ? body.scrollTop / limit * (height - size) : 0}px`;
      thumb.setAttribute('aria-valuemax', String(limit));
      thumb.setAttribute('aria-valuenow', String(Math.round(body.scrollTop)));
      thumb.setAttribute('aria-disabled', String(!limit));
      thumb.tabIndex = limit ? 0 : -1;
      up.disabled = !limit || body.scrollTop <= 0;
      down.disabled = !limit || body.scrollTop >= limit - 0.5;
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(() => { frame = 0; if (body.isConnected) update(); });
    };
    thumb.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !max()) return;
      event.preventDefault();
      thumb.focus();
      drag = { y: event.clientY, top: parseFloat(thumb.style.top) || 0 };
      thumb.classList.add('is-dragging');
      thumb.setPointerCapture(event.pointerId);
    });
    thumb.addEventListener('pointermove', (event) => {
      if (!drag || !travel()) return;
      body.scrollTop = Math.max(0, Math.min(travel(), drag.top + event.clientY - drag.y)) / travel() * max();
    });
    const release = () => { drag = null; thumb.classList.remove('is-dragging'); schedule(); };
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) thumb.addEventListener(name, release);
    rail.addEventListener('pointerdown', (event) => {
      if (event.target === thumb || event.button !== 0 || !max()) return;
      thumb.focus();
      const y = event.clientY - rail.getBoundingClientRect().top - thumb.offsetHeight / 2;
      body.scrollTop = Math.max(0, Math.min(1, y / Math.max(1, travel()))) * max();
    });
    thumb.addEventListener('keydown', (event) => {
      const delta = { ArrowUp: -40, ArrowDown: 40, PageUp: -body.clientHeight, PageDown: body.clientHeight }[event.key];
      if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      event.stopPropagation();
      body.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? max() : body.scrollTop + delta;
    });
    body.addEventListener('scroll', schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(body);
    resize.observe(rail);
    const content = new MutationObserver(schedule);
    content.observe(body, { childList: true, subtree: true });
    CastleFarm.auditScrollCleanup = () => {
      resize.disconnect();
      content.disconnect();
      body.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frame);
      drag = null;
    };
    schedule();
  }

  static AUDIT_ACTIONS = ['start', 'battle', 'collect', 'build', 'upgrade'];

  static previewAudit() {
    const wallet = { ...CastleFarm.previewWallet };
    return {
      player: { id: 1, nickname: 'Коао' },
      wallet,
      totals: {
        start: { gold: 0, resource1: 100, resource2: 100, resource3: 100, count: 1 },
        battle: { gold: 0, resource1: 1162, resource2: 1162, resource3: 1162, count: 60 },
        collect: { gold: 0, resource1: 0, resource2: 644, resource3: 0, count: 1 },
        build: { gold: 0, resource1: -75, resource2: 0, resource3: -35, count: 3 },
      },
      unexplained: { gold: 0, resource1: 0, resource2: 0, resource3: 0 },
      journal: [
        { id: 9, action: 'battle', ref: '50213', mode: 0, win: true, added: '2026-10-28 16:40:12', gold: 0, resource1: 58, resource2: 58, resource3: 58 },
        { id: 8, action: 'collect', building: 'heavy_farm', level: 5, added: '2026-10-28 15:02:41', gold: 0, resource1: 0, resource2: 644, resource3: 0 },
        { id: 7, action: 'battle', ref: '50190', mode: 3, win: false, added: '2026-10-28 14:31:05', gold: 0, resource1: 29, resource2: 29, resource3: 29 },
        { id: 3, action: 'build', building: 'food_farm', level: 1, added: '2026-10-27 20:11:00', gold: 0, resource1: -25, resource2: 0, resource3: 0 },
        { id: 1, action: 'start', added: '2026-10-27 20:10:52', gold: 0, resource1: 100, resource2: 100, resource3: 100 },
      ],
      more: false,
    };
  }

  // ---------------------------------------------------------------------
  // DEV-превью (?previewCastle=1): та же логика на локальных данных, без бэкенда
  // ---------------------------------------------------------------------

  static previewWallet = { gold: 0, resource1: 1240, resource2: 380, resource3: 95, crystal: 126 };

  static previewBuildings = {};

  // Числа превью — опорные точки бэкенда (1 и 10 уровень, −35%), цены — оригинал.
  static previewRow(name, level, ageHours) {
    const rate = (level >= 10 ? 250 : 23 + ((250 - 23) * (level - 1)) / 9) * 0.65;
    return { level, collectedAt: Date.now() - ageHours * 3600000, rate, capacity: Math.floor(rate * 8) };
  }

  static startPreview() {
    CastleFarm.preview = true;
    // в стартовой раскладке замка стоят Штольня и Ферма: одна полная, другая копит
    CastleFarm.previewBuildings = {
      light_farm: null,
      heavy_farm: CastleFarm.previewRow('heavy_farm', 5, 9),
      food_farm: CastleFarm.previewRow('food_farm', 10, 3),
    };
    CastleFarm.apply(CastleFarm.previewState());
  }

  static previewState() {
    const PRICES = {
      light_farm: [{ resource3: 35 }, { resource1: 15, resource3: 20 }],
      heavy_farm: [{ resource1: 50 }, { resource1: 30, resource3: 20 }],
      food_farm: [{ resource1: 25 }, { resource1: 20 }],
    };
    const buildings = {};
    for (const [name, resource] of Object.entries(CastleFarm.BUILDINGS)) {
      const row = CastleFarm.previewBuildings[name];
      const level = row?.level || 0;
      const next = CastleFarm.previewRow(name, level + 1, 0);
      buildings[name] = {
        resource,
        level,
        maxLevel: 180,
        price: PRICES[name][Math.min(level, 1)],
        nextRate: Math.round(next.rate),
        nextCapacity: next.capacity,
        ...(row ? { rate: row.rate, capacity: row.capacity, periodMs: 3600000, minCollectMs: 600000, collectedAt: row.collectedAt } : {}),
      };
    }
    // покупки и склад — как Farm.PURCHASES / Farm.storageView в pw-api (лимиты 1–3 ур. оригинала)
    const PURCHASE_PRICES = { crystal_farm: { resource1: 400 }, silver_farm: { resource3: 90 }, clan_house: { resource3: 3000 }, house: { resource3: 225 }, library: { resource2: 120 }, agility: { resource1: 650 }, cunning: { resource1: 650 }, health: { resource1: 650 }, intelligence: { resource1: 650 }, strength: { resource1: 650 }, tavern: { resource3: 125 } };
    const purchases = Object.fromEntries(Object.entries(PURCHASE_PRICES).map(([name, price]) => [name, { bought: CastleFarm.previewBought.has(name), price }]));
    const LIMITS = [500, 550, 600, 750];
    const level = CastleFarm.previewStorageLevel;
    const storage = { level, maxLevel: 3, limit: LIMITS[level], nextLimit: level < 3 ? LIMITS[level + 1] : null, price: level < 3 ? [{}, {}, { resource1: 25, resource3: 5 }, { resource1: 25, resource3: 5 }][level + 1] : null };
    return { now: Date.now(), wallet: { ...CastleFarm.previewWallet, silver: 33051 }, limit: storage.limit, buildings, purchases, storage };
  }

  static previewBought = new Set(['library', 'house', 'tavern', 'crystal_farm', 'silver_farm']);

  static previewStorageLevel = 1;

  static async previewRequest(method, data) {
    const name = data?.building;
    const state = CastleFarm.previewState();
    const b = state.buildings[name];
    const pay = (price) => {
      if (!CastleFarm.affordable(price)) throw 'farmNotEnough';
      for (const [resource, amount] of Object.entries(price)) CastleFarm.previewWallet[resource] -= amount;
    };
    if (name === CastleFarm.STORAGE) {
      if (method === 'build') CastleFarm.previewStorageLevel = 1;
      if (method === 'upgrade') {
        pay(state.storage.price);
        CastleFarm.previewStorageLevel += 1;
      }
      return CastleFarm.previewState();
    }
    if (state.purchases[name]) {
      if (CastleFarm.previewBought.has(name)) throw 'farmAlreadyBuilt';
      pay(state.purchases[name].price);
      CastleFarm.previewBought.add(name);
      return CastleFarm.previewState();
    }
    if (method === 'build') {
      if (b.level) throw 'farmAlreadyBuilt';
      pay(b.price);
      CastleFarm.previewBuildings[name] = CastleFarm.previewRow(name, 1, 0);
    } else if (method === 'upgrade') {
      const stored = CastleFarm.stored(name)?.amount || 0;
      CastleFarm.previewWallet[b.resource] += stored;
      pay(b.price);
      CastleFarm.previewBuildings[name] = CastleFarm.previewRow(name, b.level + 1, 0);
    } else if (method === 'collect') {
      const value = CastleFarm.stored(name);
      if (!value?.collectable) throw 'farmNothingToCollect';
      CastleFarm.previewWallet[b.resource] += value.amount;
      CastleFarm.previewBuildings[name].collectedAt = Date.now();
      return { ...CastleFarm.previewState(), collected: { building: name, amount: value.amount } };
    }
    return CastleFarm.previewState();
  }
}

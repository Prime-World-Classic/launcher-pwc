import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { View } from './view.js';
import { Window } from './window.js';
import { Rank } from './rank.js';
import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';
import { MM } from './mm.js';
import { PreloadImages } from './preloadImages.js';
import { Game } from './game.js';
import { Splash } from './splash.js';
import { domAudioPresets } from './domAudioPresets.js';
import { Sound } from './sound.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';
import { Castle } from './castle.js';
import { KeybindStore } from './keybindings/keybindings.store.js';
import { TalentSets } from './talentSets.js';
import { TalentData } from './talentData.js';
import { Settings } from './settings.js';
import { getMainHeroTalentId } from './mainHeroTalent.js';
import { uiIcon } from './uiIcon.js';
import { HeroFrame } from './heroFrame.js';

export class Build {
  static loading = false;
  static useOptimisticTalentApi = true;
  static mutationQueue = Promise.resolve();
  static _activeBarRenderScheduled = false;
  static _activeBarRenderData = null;
  static _initDataFetch = null; // фаза main-fetch последнего init (быстрое переключение вкладок)
  // Кэш билдов: ответы build.data по `${heroId}:${buildId}` (как пришли с сервера, до правок init)
  // и справочник библиотеки по герою. Вкладка билда открывается из кэша сразу, сервер догоняет в фоне.
  static buildDataCache = new Map();
  static buildTargetByHero = new Map(); // выбранный на сервере билд героя — для открытия окна без id билда
  static talentCatalogs = new Map();
  static buildCacheGen = 0; // растёт на каждую правку билда: ответы, начатые до неё, в кэш не попадают
  static peekUnsupported = false; // старый бэкенд без build.peek — предзагрузки нет
  static TALENT_CATALOG_TTL_MS = 10 * 60 * 1000;
  static BUILD_READ_METHODS = new Set([
    'data', 'peek', 'inventory', 'get', 'my', 'target', 'sets', 'setsPopularity', 'addSetPopularity',
    'favouriteSet', 'heroData', 'heroAll', 'talentAll', 'talentHeroAll', 'heroAdminAll',
  ]);
  // правки, которые меняют только поле/панель/профиль одного билда (buildId или id в данных)
  static BUILD_BODY_METHODS = new Set([
    'set', 'optimisticSet', 'setZero', 'optimisticRemove', 'setActive', 'optimisticSetActive',
    'setZeroActive', 'optimisticClearActive', 'swap', 'optimisticSwap', 'random', 'clear', 'setProfile',
  ]);
  static SET_POPULARITY_TTL_MS = 5 * 60 * 1000; // мин. интервал обновления setsPopularity

  /** HSL hue для подсветки сетов (как rgba(80,190,255)); толщина рамки в мм (макс. 1.5). */
  static BUILD_HIGHLIGHT_HUE_DEFAULT = 199;
  static BUILD_HIGHLIGHT_BORDER_MM_DEFAULT = 0.42;
  static BUILD_HIGHLIGHT_BORDER_MM_MIN = 0.08;
  static BUILD_HIGHLIGHT_BORDER_MM_MAX = 1.5;
  static REGEN_HP_FROM_MAX_HP_PCT = 0.0015; // 0.15%
  static REGEN_MP_FROM_MAX_MP_PCT = 0.0036; // 0.36%
  // Max talent cooldown reduction percent shown in build hero stats and used in CD calculations.
  static TALENT_COOLDOWN_PCT_MAX = 30;

  /** span с числом подсвеченных по стат-фильтру талантов (см. .build-hero-stats-highlight-count). */
  static statFilterHighlightCountValueEl = null;
  static statFilterHighlightCountWrapEl = null;
  static combatModeButtonEl = null;
  static combatModeButtonCountEl = null;
  static setSortButtonEl = null;
  static sortSetsInProgress = false;
  static sortSetsClassSide = 'left';
  static sortSetsWasApplied = false;
  static libraryTalentClickCooldownMs = 50;
  static _lastLibraryTalentClickAt = 0;
  static inventorySetHoverDelayMs = 30;
  static _inventorySetHoverTimer = 0;
  static _inventorySetHoverTalentId = null;
  static _postMoveRefreshRaf = 0;
  static _postMoveRefreshNeedSort = false;
  static _regroupInventoryBySetsOnNextSort = false;
  static _talentDescriptionSuppressedUntil = 0;
  static animateHeroOnBuildChange = false;
  static _isDraggingTalent = false;
  static combatModeEnabled = false;
  static combatModeLearnOrder = [];
  static combatModeLearnOrderBySlot = new Map();
  static combatModeLearnedSlots = new Set();
  static setPopularityMap = new Map();
  static setPopularityLoadPromise = null;

  static language = {
    sr: 'Сила/Разум',
    hp: 'Здоровье',
    provorstvo: 'Проворство',
    hitrost: 'Хитрость',
    regenmp: 'Регенерация энергии',
    stoikost: 'Стойкость',
    volia: 'Воля',
    ph: 'Проворство/Хитрость',
    sv: 'Стойкость/Воля',
    razum: 'Разум',
    sila: 'Сила',
    speedtal: '%<speedtal></speedtal>',
    srsv: 'Сила/Разум/Стойкость/Воля',
    hpmp: 'Здоровье/Энергия',
    krajahp: 'Кража здоровья',
    regenhp: 'Регенерация здоровья',
    mp: 'Энергия',
    krajamp: 'Кража энергии',
    stoikostrz: 'Стойкость на родной земле',
    voliarz: 'Воля на родной земле',
    speedtalrz: '%<speedtal></speedtal> на родной земле',
    speedtalvz: '%<speedtal></speedtal> на вражеской земле',
    hitrostrz: 'Хитрость на родной земле',
    provorstvorz: 'Проворство на родной земле',
    silarz: 'Сила на родной земле',
    razumrz: 'Разум на родной земле',
    krajahprz: 'Кража здоровья на родной земле',
    regenhpvz: 'Регенерация здоровья на вражеской земле',
    hitrostvz: 'Хитрость на вражеской земле',
    provorstvovz: 'Проворство на вражеской земле',
    regenmpvz: 'Регенерация энергии на вражеской земле',
    silavz: 'Сила на вражеской земле',
    razumvz: 'Разум на вражеской земле',
    svvz: 'Стойкость/Воля на вражеской земле',
    krajahpvz: 'Кража здоровья на вражеской земле',
    vs: 'Воля/Стойкость',
    speed: 'Скорость',
    speedrz: 'Скорость на родной земле',
    speedvz: 'Скорость на вражеской или нейтральной земле',
    dopspeed: 'Дополнительный бонус к скорости',
    speedstak: 'Стак скорости',
  };

  /** Индексы в build.profile для галочек приоритета статов (на сервере массив из 9 слотов; 0–2 не использовались) */
  static heroStatProfileIndex = {
    sila: 3,
    razum: 4,
    provorstvo: 5,
    hitrost: 6,
    stoikost: 7,
    volia: 8,
  };

  static talentRefineByRarity = {
    4: 5.0, //И классовые
    3: 7.0,
    2: 9.0,
    1: 12.0,
  };

  static talentPowerByRarityFirstLevel = {
    4: 53.04,
    3: 47.04,
    2: 43.2,
    1: 36,
    0: 45.12,
  };

  static talentPowerByRarityPerLevel = {
    4: 3.978,
    3: 3.528,
    2: 3.24,
    1: 2.625,
    0: 11.28,
  };

  /** Доля строки билда (слоты сверху вниз) в мощи: суммарно по 6 слотам строки = вклад веса. */
  static TALENT_POWER_LINE_WEIGHTS = {
    5: 33.0 / 600.0,
    4: 23.0 / 600.0,
    3: 16.0 / 600.0,
    2: 13.0 / 600.0,
    1: 9.0 / 600.0,
    0: 6.0 / 600.0,
  };

  static binds = [];

  static async view(user, hero, nickname = '', animate = true, { lobby = false } = {}) {
    const preview = lobby && MM.preview;
    let request = preview ? Array.from({ length: 36 }, (_, index) => index + 1) : await App.api.request('build', 'get', {
      user: user,
      hero: hero,
    });
    if (lobby) {
      if (!MM.isInTambur) return;
      return Window.show('allyBuild', 'allyBuild', { request, user, hero, nickname, preview });
    }

    return Window.show('playerBuild', 'playerBuild', { request, user, hero, nickname, preview: false });
  }

  static viewModel(data, callback, animate = true) {
    let body = DOM({ style: 'build-body' }),
      i = 1,
      row = DOM({ style: 'build-body-row' }),
      elements1 = new Array(),
      elements2 = new Array();

    body.append(row);

    for (let item of data) {
      let talent = DOM();

      if (item != 0) {
        if (animate) {
          talent.style.opacity = 0;

          talent.style.zIndex = 9999;

          if (item > 0) {
            elements2.push(talent);
          } else {
            elements1.push(talent);
          }
        }

        talent.style.backgroundImage = item > 0 ? `url(content/talents/${item}.webp)` : `url(content/htalents/${Math.abs(item)}.webp)`;
      }

      if (i > 6) {
        i = 2;

        row = DOM({ style: 'build-body-row' });

        row.append(talent);

        body.append(row);

        continue;
      } else {
        row.append(talent);
      }

      i++;
    }

    if (!animate) {
      return body;
    }

    elements1 = Game.shuffle(elements1);

    elements2 = Game.shuffle(elements2);

    let delay = 0,
      number = 1;

    for (let element of elements1) {
      delay += 150;

      let animate = element.animate(
        { opacity: [0, 1], transform: ['scale(3)', 'scale(1)'] },
        { delay: delay, duration: 350, fill: 'both', easing: 'ease-out' },
      );

      if (number == elements1.length) {
        animate.onfinish = () => {
          setTimeout(() => {
            let number = 1;

            delay = 0;

            for (let element of elements2) {
              delay += 50;

              let animate = element.animate(
                { opacity: [0, 1], transform: ['scale(3)', 'scale(1)'] },
                {
                  delay: delay,
                  duration: 350,
                  fill: 'both',
                  easing: 'ease-out',
                },
              );

              if (number == elements2.length) {
                animate.onfinish = () => {
                  if (callback) {
                    callback();
                  }
                };
              }

              number++;
            }
          }, 100);
        };
      }

      number++;
    }

    return body;
  }

  static async init(heroId, targetId, isWindow, { previewData = null } = {}) {
    Build.previewData = previewData;
    Build._tabLabelObserver?.disconnect();
    Build._tabLabelObserver = null;
    const initToken = (Number(Build._initToken) || 0) + 1;
    Build._initToken = initToken;

    Build.ensureBuildSettingsDefaults();
    Build.applyBuildHighlightVariablesFromSettings();

    // Кнопку настроек не снимаем: пока грузится другой билд или герой, она остаётся в текущем окне,
    // а новое окно забирает её себе (View.build ставит её перед «?») — без мигания.
    try {
      Build.buildSettingsPanel?.parentNode?.removeChild?.(Build.buildSettingsPanel);
    } catch {}
    Build.buildSettingsPanel = null;

    Build.talents = new Object();

    Build.descriptionView = document.createElement('div');

    Build.CleanInvalidDescriptions();

    Build.descriptionView.classList.add('build-description');

    Build.descriptionView.style.display = 'none';
    Build._hoveredDescriptionTalentEl = null;
    Build.sortSetsWasApplied = false;
    Build._libraryHoverSuppressed = false;
    Build._libraryHoverSuppressTimer = 0;
    Build._libraryPointerX = null;
    Build._libraryPointerY = null;

    const bindCommandsToGet = [
      "cmd_action_bar_slot1",
      "cmd_action_bar_slot2",
      "cmd_action_bar_slot3",
      "cmd_action_bar_slot4",
      "cmd_action_bar_slot5",
      "cmd_action_bar_slot6",
      "cmd_action_bar_slot7",
      "cmd_action_bar_slot8",
      "cmd_action_bar_slot9",
      "cmd_action_bar_slot10",
      "cmd_action_bar_slot11",
      "cmd_action_bar_slot12",
      "cmd_action_bar_slot13",
      "cmd_action_bar_slot14",
      "cmd_action_bar_slot15",
      "cmd_action_bar_slot16",
      "cmd_action_bar_slot17",
      "cmd_action_bar_slot18",
      "cmd_action_bar_slot19",
      "cmd_action_bar_slot20",
      "cmd_action_bar_slot21",
      "cmd_action_bar_slot22",
      "cmd_action_bar_slot23",
      "cmd_action_bar_slot24",
    ]
    this.binds = previewData ? previewData.binds : bindCommandsToGet.map((bindCommand) => {
      return KeybindStore.getBind(bindCommand);
    })

    Build.descriptionView.onmouseover = () => {
      Build.descriptionView.style.display = 'none';
    };

    document.body.append(Build.descriptionView);

    Build.heroView = document.createElement('div');
    Build.heroView.classList.add('build-hero');

    Build.levelView = document.createElement('div');
    Build.levelView.classList.add('build-level');

    Build.fieldView = document.createElement('div');
    Build.fieldView.classList.add('build-field');

    Build.listView = document.createElement('div');
    Build.listView.classList.add('build-list');

    Build.buildActionsView = document.createElement('div');
    Build.buildActionsView.classList.add('build-actions-view');

    Build.fieldConflict = new Object();

    // ================================================

    const buttonTalents = document.createElement('button');
    buttonTalents.innerText = Lang.text('talents');
    buttonTalents.title = Lang.text('todoInProgress');
    buttonTalents.classList.add('btn-talents', 'btn-hover', 'color-1');
    buttonTalents.title = Lang.text('talentLibrary');

    const separator = document.createElement('div');
    separator.innerText = '|';
    separator.classList.add('btn-separator');

    const buttonSets = document.createElement('button');
    buttonSets.innerText = Lang.text('sets');
    buttonSets.title = Lang.text('todoInProgress');
    buttonSets.classList.add('btn-sets', 'btn-hover', 'color-1');

    buttonSets.addEventListener('click', () => Build.sets());

    Build.talentsAndSetsView = document.createElement('div');
    Build.talentsAndSetsView.classList.add('buttons-talents-and-sets');
    Build.talentsAndSetsView.append(buttonTalents, separator, buttonSets);

    const buildTalents = DOM({ style: 'build-talents' });
    buildTalents.addEventListener(
      'wheel',
      () => {
        Build.beginLibraryHoverSuppression();
      },
      { passive: true },
    );
    buildTalents.addEventListener(
      'scroll',
      () => {
        Build.beginLibraryHoverSuppression();
      },
      { passive: true },
    );
    buildTalents.addEventListener(
      'mousemove',
      (e) => {
        Build._libraryPointerX = e.clientX;
        Build._libraryPointerY = e.clientY;
      },
      { passive: true },
    );

    Build.inventoryView = document.createElement('div');
    Build.inventoryView.classList.add('build-talent-view');
    Build.applyTalentViewLayoutFromSettings();

    Build.setsListView = DOM({ style: 'build-sets' });
    Build.setsListView.addEventListener(
      'wheel',
      (e) => {
        if (e.ctrlKey || e.shiftKey) return;
        if (!Build.setsListView) return;

        const view = Build.setsListView;
        const dy = Number(e.deltaY) || 0;
        if (!dy) return;

        const max = Math.max(0, view.scrollHeight - view.clientHeight);
        const cur = view.scrollTop;
        const canScroll = max > 0 && ((dy < 0 && cur > 0) || (dy > 0 && cur < max));
        // If list is already at edge and cannot scroll further, keep current hover preview.
        if (!canScroll) return;

        // Match library behavior: wheel scroll drops current hover visuals.
        Build._setsHoverSuppressed = true;
        Build._setsLastPointerX = e.clientX;
        Build._setsLastPointerY = e.clientY;
        Build.clearEmptySlotPreviews();
        if (Build.descriptionView) Build.descriptionView.style.display = 'none';
        Build._descriptionPinnedBySet = false;
        Build._hoveredSetTalentIds = null;
        Build._hoveredSetAnchorEl = null;
        Build.clearSetHighlights();
        try {
          if (Build._setsScrollStopTimer) clearTimeout(Build._setsScrollStopTimer);
        } catch {}
        Build._setsScrollStopTimer = setTimeout(() => {
          Build._setsScrollStopTimer = 0;
          Build._setsHoverSuppressed = false;
          try {
            const x = Number(Build._setsLastPointerX);
            const y = Number(Build._setsLastPointerY);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const below = document.elementFromPoint(x, y);
            const hoveredSet = below?.closest?.('.build-set-item');
            if (!hoveredSet || !Build.setsListView?.contains?.(hoveredSet)) return;
            hoveredSet.dispatchEvent(
              new MouseEvent('mouseenter', {
                bubbles: false,
                cancelable: false,
                view: window,
                clientX: x,
                clientY: y,
              }),
            );
          } catch {}
        }, 140);

        // In row layout, keep native wheel speed (same feel as library).
        if (Build.inventoryView?.classList?.contains('build-talent-view--row')) return;

        e.preventDefault();

        const scaled = dy / 3;

        if (typeof Build._setsScrollTarget !== 'number') Build._setsScrollTarget = view.scrollTop;
        Build._setsScrollTarget += scaled;

        if (Build._setsScrollTarget < 0) Build._setsScrollTarget = 0;
        if (Build._setsScrollTarget > max) Build._setsScrollTarget = max;

        if (Build._setsScrollRaf) return;
        const step = () => {
          Build._setsScrollRaf = 0;
          if (!Build.setsListView) return;
          const v = Build.setsListView;
          const target = typeof Build._setsScrollTarget === 'number' ? Build._setsScrollTarget : v.scrollTop;
          const cur = v.scrollTop;

          const next = cur + (target - cur) * 0.22;
          v.scrollTop = next;

          if (Math.abs(target - next) > 0.5) {
            Build._setsScrollRaf = requestAnimationFrame(step);
          } else {
            v.scrollTop = target;
          }
        };
        Build._setsScrollRaf = requestAnimationFrame(step);
      },
      { passive: false },
    );

    Build.skinView = DOM(
      {
        tag: 'button',
        domaudio: domAudioPresets.defaultButton,
        style: ['btn-skins', 'btn-hover', 'color-3'],
        event: ['click', async () => Build.skinChange()],
      },
      Lang.text('buildHeroAppearances'),
    );
    Build.setUiTooltip(Build.skinView, Lang.text('titleSkinsForTheHero'));

    Build.training = DOM(
      {
        tag: 'button',
        domaudio: domAudioPresets.defaultButton,
        style: ['btn-skins', 'btn-hover', 'color-3'],
        event: [
          'click',
          async () => {
            try {
              if (MM.isBlockedByUpdate()) {
                return;
              }

              if (NativeAPI.status) {
                await MM.gameStartCheck();

                await App.api.request(App.CURRENT_MM, 'heroParty', {
                  id: MM.partyId,
                  hero: Build.heroId,
                });

                await App.api.request(App.CURRENT_MM, 'start', {
                  version: App.PW_VERSION,
                  mode: 99,
                  mac: NativeAPI.getMACAdress(),
                  cache: await NativeAPI.getCacheIndex(),
                  v: 2,
                });
              } else {
                App.error(Lang.text('windowsLauncherRequired'));
              }
            } catch (error) {
              return App.error(error);
            }
          },
        ],
      },
      Lang.text('training'),
    );
    Build.setUiTooltip(Build.training, Lang.text('titletraining'));

    const talentsSection = DOM({ tag: 'fieldset', style: ['build-inventory-fieldset', 'build-talents-section'] });
    const talentsHeader = DOM({ tag: 'legend', style: 'build-inventory-legend' });
    talentsSection.append(talentsHeader, buildTalents);

    const setsSection = DOM({ tag: 'fieldset', style: ['build-inventory-fieldset', 'build-sets-section'] });
    const setsHeader = DOM({ tag: 'legend', style: 'build-inventory-legend' }, Lang.text('sets'));
    setsSection.append(setsHeader, Build.setsListView);

    for (const [section, list] of [[talentsSection, buildTalents], [setsSection, Build.setsListView]]) {
      Build.attachInventoryScrollbar(section, list);
      for (const direction of [-1, 1]) {
        section.append(DOM({
          tag: 'button', type: 'button',
          style: ['build-scroll-arrow', direction < 0 ? 'build-scroll-arrow-up' : 'build-scroll-arrow-down'],
          ariaLabel: `${section === talentsSection ? Lang.text('library') : Lang.text('sets')}: ${direction < 0 ? '\u2191' : '\u2193'}`,
          event: ['click', () => list.scrollBy({ top: direction * list.clientHeight * 0.25, behavior: 'smooth' })],
        }, direction < 0 ? '\u25b2' : '\u25bc'));
      }
    }

    Build.altResetHintView = DOM({ style: 'build-alt-reset-hint' }, Lang.text('buildAltResetHint'));
    Build.inventoryView.append(talentsSection, setsSection);
    Build.attachAltResetHintBelowInventory();
    if (!previewData) {
      Build.installAltResetHandler();
      Build.installHeroNavKeyboardHandler();
    }
    Build.buildSettingsButton ??= Build.createBuildSettingsButton();
    Build.buildSettingsButton.setAttribute('aria-expanded', 'false');
    Build.buildSettingsPanel = Build.createBuildSettingsPanel();
    Build.attachBuildSettingsToWbuild();
    Build.applyBuildHighlightVariablesFromSettings();

    Build.renderTalentSetsList();

    // Популярность сетов НЕ блокирует main-fetch (быстрое переключение вкладок).
    // Обновляем в фоне (с минимальным интервалом) и перерисовываем список.
    if (!previewData) (async () => {
      try {
        const stale = Date.now() - (Number(Build.setPopularityLoadedAt) || 0) > Build.SET_POPULARITY_TTL_MS;
        await Build.loadSetPopularityCacheFromBackend(stale);
      } catch {}
      Build.renderTalentSetsList();
    })();

    // ================================================

    Build.rarityView = DOM({ style: 'build-rarity' });
    Build.librarySearchView = Build.createLibrarySearchInput();

    Build.activeBarView = DOM({ style: 'build-active-bar' });

    Build.activeBarKeybindingsView = DOM({ style: 'build-active-bar' });

    Build.watchBuildRequests();
    // билд из кэша рисуется сразу, свежий ответ сервера догоняет его (confirmCachedBuildData)
    const cached = previewData ? null : Build.cachedBuildData(heroId, targetId);
    let request = previewData ? structuredClone(previewData) : cached ? cached.request : await Build.fetchBuildDataLatestWins(initToken, heroId, targetId);

    if (Build._initToken !== initToken || request === null) {
      return false;
    }

    Build.dataRequest = request;

    Build.id = request.id;

    Build.heroId = heroId;
    Build.targetId = targetId;

    Build.dataStats = new Object();
    Build.calculationStats = new Object();
    Build.initialStats = new Object();
    Build.heroPower = 0.0;
    Build.heroStatsFromPower = {
      hp: 0.0,
      mp: 0.0,
      regenhp: 0.0,
      regenmp: 0.0,
      sila: 0.0,
      razum: 0.0,
      provorstvo: 0.0,
      hitrost: 0.0,
      stoikost: 0.0,
      volia: 0.0,
    };
    Build.installedTalents = new Array(36).fill(null);
    Build.resetCombatModeState();
    Build.profileStats = new Object();

    Build.applyRz = true;
    Build.applyVz = false;
    Build.applyStak = true;
    Build.applyBuffs = true;

    Build.list(request.build, isWindow);
    Build.buildActions(request.build, isWindow);

    const hs = request.hero.stats;
    hs['damage'] = 0;
    hs['critProb'] = 0;
    hs['attackSpeed'] = 0;
    hs['punching'] = 0;
    hs['protectionBody'] = 0;
    hs['protectionSpirit'] = 0;
    if (hs.regenhp === undefined || hs.regenhp === null) hs.regenhp = 0;
    else hs.regenhp = parseFloat(hs.regenhp) || 0;
    if (hs.regenmp === undefined || hs.regenmp === null) hs.regenmp = 0;
    else hs.regenmp = parseFloat(hs.regenmp) || 0;
    hs.krajahp = 0;
    hs.krajamp = 0;
    hs.speedtal = 0;
    Build.hero(request.hero);

    Build.level();

    Build.field(request.body);
    Build.syncCombatModeButtonState();
    Build.renderCombatOrderBadges();

    Build.inventory();

    Build.rarity();

    Build.activeBar(request.active);

    //	Build.activeBar([35,-35,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);

    Build.ruleSortInventory = new Object();
    Build.scheduleAttachBuildSettings();
    if (!previewData) {
      if (cached) Build.confirmCachedBuildData(initToken, heroId, targetId, isWindow, cached.json);
      Build.scheduleBuildPrefetch();
    }
    return true;
  }

  static attachInventoryScrollbar(section, list) {
    const thumb = DOM({ style: 'build-scroll-thumb', tabIndex: 0 });
    const rail = DOM({ style: 'build-scroll-rail' }, thumb);
    thumb.setAttribute('role', 'scrollbar');
    thumb.setAttribute('aria-label', section.classList.contains('build-talents-section') ? Lang.text('library') : Lang.text('sets'));
    thumb.setAttribute('aria-orientation', 'vertical');
    thumb.setAttribute('aria-valuemin', '0');
    if (!list.id) {
      Build._scrollbarSerial = (Number(Build._scrollbarSerial) || 0) + 1;
      list.id = `build-scroll-list-${Build._scrollbarSerial}`;
    }
    thumb.setAttribute('aria-controls', list.id);
    section.append(rail);
    list.classList.add('build-custom-scroll');
    const maxScroll = () => Math.max(0, list.scrollHeight - list.clientHeight);
    const travel = () => Math.max(0, rail.clientHeight - thumb.offsetHeight);
    let drag = null;
    const update = () => {
      const max = maxScroll();
      // Во время перетаскивания ползунок ставит pointermove — сразу под курсор, не дожидаясь
      // прокрутки: в большой библиотеке кадр перерисовки долгий, и ползунок отставал.
      if (!drag) thumb.style.top = `${max ? (list.scrollTop / max) * travel() : 0}px`;
      thumb.setAttribute('aria-valuemax', String(max));
      thumb.setAttribute('aria-valuenow', String(Math.round(list.scrollTop)));
      thumb.setAttribute('aria-disabled', String(max === 0));
      thumb.tabIndex = max ? 0 : -1;
      thumb.classList.toggle('is-disabled', !max);
    };
    const scrollAt = (clientY) => {
      const rect = rail.getBoundingClientRect();
      const ratio = travel() ? (clientY - rect.top - thumb.offsetHeight / 2) / travel() : 0;
      list.scrollTop = Math.max(0, Math.min(1, ratio)) * maxScroll();
    };
    thumb.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !maxScroll()) return;
      event.preventDefault();
      thumb.focus();
      drag = { y: event.clientY, top: parseFloat(thumb.style.top) || 0 };
      thumb.setPointerCapture(event.pointerId);
    });
    thumb.addEventListener('pointermove', (event) => {
      if (!drag || !travel()) return;
      const top = Math.max(0, Math.min(travel(), drag.top + event.clientY - drag.y));
      thumb.style.top = `${top}px`;
      list.scrollTop = (top / travel()) * maxScroll();
    });
    const release = () => {
      if (!drag) return;
      drag = null;
      update();
    };
    thumb.addEventListener('pointerup', release);
    thumb.addEventListener('pointercancel', release);
    thumb.addEventListener('lostpointercapture', release);
    thumb.addEventListener('blur', release);
    rail.addEventListener('pointerdown', (event) => {
      if (event.target === thumb || event.button !== 0) return;
      scrollAt(event.clientY);
    });
    thumb.addEventListener('keydown', (event) => {
      const delta = { ArrowUp: -40, ArrowDown: 40, PageUp: -list.clientHeight, PageDown: list.clientHeight }[event.key];
      if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      event.stopPropagation();
      list.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? maxScroll() : list.scrollTop + delta;
    });
    list.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(list);
    observer.observe(rail);
    (Build._inventoryScrollObservers ??= []).push(observer);
    const contentObserver = new MutationObserver(update);
    contentObserver.observe(list, { childList: true, subtree: true });
    Build._inventoryScrollObservers.push(contentObserver);
  }

  // Main-fetch init в семантике «последний клик побеждает».
  // При быстром переключении вкладок старый запрос 'build/data' ещё висит в
  // App.api.awaiting, и новый init падал с REQUEST_ALREADY_PENDING; проигравшая
  // гонка дополнительно ломала экран null-шаблоном. Теперь:
  //  - сначала дожидаемся фазу fetch предыдущего init;
  //  - при REQUEST_ALREADY_PENDING (метод держит, например, refresh после
  //    мутации) дожидаемся освобождения и повторяем запрос один раз;
  //  - после каждого await повторно проверяем токен — устаревший init даёт null.
  static fetchBuildDataLatestWins(initToken, heroId, targetId) {
    const phase = (async () => {
      const previous = Build._initDataFetch;
      if (previous) {
        try {
          await previous;
        } catch {}
      }
      if (Build._initToken !== initToken) return null;

      const doFetch = async () => {
        const gen = Build.buildCacheGen;
        const result = await App.api.request('build', 'data', { heroId: heroId, target: targetId });
        Build.storeBuildData(heroId, result, gen, { selected: true });
        return result;
      };

      try {
        return await doFetch();
      } catch (error) {
        if (!error || error.code !== 'REQUEST_ALREADY_PENDING') throw error;
        await Build.waitForApiIdle('build', 5000);
        if (Build._initToken !== initToken) return null;
        return await doFetch();
      }
    })();

    Build._initDataFetch = phase;
    return phase;
  }

  static buildCacheKey(heroId, buildId) {
    return `${Number(heroId)}:${Number(buildId)}`;
  }

  // Ответ build.data/peek — в кэш, если с начала запроса билд никто не правил (gen не сменился).
  // selected: ответ build.data — сервер теперь считает этот билд выбранным (peek выбор не меняет).
  static storeBuildData(heroId, data, gen, { selected = false } = {}) {
    if (gen !== Build.buildCacheGen || !data || typeof data !== 'object' || !Number(data.id)) return;
    const json = JSON.stringify(data);
    Build.buildDataCache.set(Build.buildCacheKey(heroId, data.id), { data: JSON.parse(json), json });
    if (selected) Build.buildTargetByHero.set(Number(heroId), Number(data.id));
  }

  // Копия ответа из кэша; targetId 0 — «выбранный билд», если клиент знает, какой он
  static cachedBuildData(heroId, targetId) {
    const buildId = Number(targetId) || Build.buildTargetByHero.get(Number(heroId));
    const entry = buildId ? Build.buildDataCache.get(Build.buildCacheKey(heroId, buildId)) : null;
    return entry ? { request: JSON.parse(entry.json), json: entry.json } : null;
  }

  static watchBuildRequests() {
    App.api?.constructor?.requestObservers?.add(Build.onBuildRequest);
  }

  // Любая правка билда (окно, лобби, админка) сбрасывает то, что могла устареть
  static onBuildRequest(phase, object, method, data) {
    if (object !== 'build') return;
    if (method === 'target') {
      Build.buildTargetByHero.clear();
      return;
    }
    if (Build.BUILD_READ_METHODS.has(method)) return;
    Build.buildCacheGen++;
    if (method.startsWith('talent')) Build.talentCatalogs.clear();
    const buildId = Number(data?.buildId ?? data?.id);
    if (Build.BUILD_BODY_METHODS.has(method) && buildId) {
      for (const key of [...Build.buildDataCache.keys()]) {
        if (key.endsWith(`:${buildId}`)) Build.buildDataCache.delete(key);
      }
      // правка дошла — подтягиваем билд заново, чтобы возврат на вкладку был мгновенным
      if (phase === 'done') Build.scheduleBuildPrefetch(1500);
      return;
    }
    Build.buildDataCache.clear();
    Build.buildTargetByHero.clear();
  }

  // Билд показан из кэша: build.data с target делает его выбранным на сервере и приносит свежие данные.
  // Если они отличаются от показанных (правка с другого устройства, рейтинг после боя) — окно перерисовывается.
  static async confirmCachedBuildData(initToken, heroId, targetId, isWindow, shownJson) {
    const gen = Build.buildCacheGen;
    let fresh = null;
    try {
      fresh = await Build.fetchBuildDataLatestWins(initToken, heroId, targetId);
    } catch {
      return;
    }
    if (!fresh || Build._initToken !== initToken || Build.buildCacheGen !== gen) return;
    if (JSON.stringify(fresh) === shownJson) return;
    // ответ мог прийти раньше, чем окно билда встало в документ
    if (!(await Build.waitForCondition(() => Build.listView?.isConnected, 1500))) return;
    if (Build._initToken !== initToken || Build.buildCacheGen !== gen) return;
    // одна перерисовка на билд за 10 с: если ответы сервера «плавают», не крутимся в цикле
    const redrawKey = Build.buildCacheKey(heroId, fresh.id);
    if (Build._confirmRedraw?.key === redrawKey && Date.now() - Build._confirmRedraw.at < 10000) return;
    Build._confirmRedraw = { key: redrawKey, at: Date.now() };
    isWindow ? Window.show('main', 'build', heroId, targetId, true) : View.show('build', heroId, targetId);
  }

  static scheduleBuildPrefetch(delayMs = 400) {
    clearTimeout(Build._prefetchTimer);
    Build._prefetchTimer = setTimeout(() => Build.prefetchHeroBuilds(), delayMs);
  }

  // Остальные билды героя — в кэш через build.peek (выбранный билд на сервере не меняется).
  // По одному запросу, когда окно билда ничего не ждёт от сервера.
  static async prefetchHeroBuilds() {
    if (Build.peekUnsupported || Build.previewData) return;
    if (Build._prefetchRunning) {
      Build._prefetchAgain = true;
      return;
    }
    const heroId = Build.heroId;
    const builds = Array.isArray(Build.dataRequest?.build) ? Build.dataRequest.build : [];
    Build._prefetchRunning = true;
    Build._prefetchAgain = false;
    try {
      for (const build of builds) {
        if (Build.heroId !== heroId || Build.previewData) return;
        if (Build.buildDataCache.has(Build.buildCacheKey(heroId, build?.id))) continue;
        await Build.mutationQueue;
        await Build.waitForApiIdle('build', 5000);
        if (Build.heroId !== heroId || Build.buildDataCache.has(Build.buildCacheKey(heroId, build.id))) continue;
        const gen = Build.buildCacheGen;
        try {
          Build.storeBuildData(heroId, await App.api.request('build', 'peek', { heroId: heroId, target: build.id }), gen);
        } catch (error) {
          if (String(error?.message ?? error).includes('Not method')) Build.peekUnsupported = true;
          return;
        }
      }
    } finally {
      Build._prefetchRunning = false;
      if (Build._prefetchAgain) Build.scheduleBuildPrefetch();
    }
  }

  // Библиотека не зависит от билда: это все таланты героя без стоящих на поле. Справочник героя —
  // ответ build.inventory плюс таланты того же билда из build.data, в порядке сервера.
  static rememberTalentCatalog(heroId, buildId, inventory, gen) {
    if (gen !== Build.buildCacheGen || !Array.isArray(inventory)) return;
    const body = Build.buildDataCache.get(Build.buildCacheKey(heroId, buildId))?.data?.body;
    if (!Array.isArray(body)) return;
    const items = structuredClone(inventory);
    const known = new Set(items.map((talent) => Number(talent?.id)));
    // как в build.inventory: классовые по уровню, потом обычные по редкости (по убыванию)
    const rank = (talent) => (Number(talent.id) < 0 ? [0, Number(talent.level) || 0] : [1, -(Number(talent.rarity) || 0)]);
    const after = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
    for (const talent of body) {
      if (!talent || known.has(Number(talent.id))) continue;
      const own = rank(talent);
      const index = items.findIndex((other) => after(rank(other), own));
      items.splice(index < 0 ? items.length : index, 0, structuredClone(talent));
      known.add(Number(talent.id));
    }
    Build.talentCatalogs.set(Number(heroId), { items, at: Date.now() });
  }

  // Библиотека текущего билда из справочника героя; null — справочника ещё нет
  static libraryFromCatalog(heroId) {
    const catalog = Build.talentCatalogs.get(Number(heroId));
    if (!catalog) return null;
    if (Date.now() - catalog.at > Build.TALENT_CATALOG_TTL_MS) Build.refreshTalentCatalog(heroId, Build.id);
    const installed = new Set((Build.installedTalents || []).filter(Boolean).map((talent) => Number(talent.id)));
    return structuredClone(catalog.items.filter((talent) => !installed.has(Number(talent.id))));
  }

  // Справочник устарел (таланты могли поправить в админке) — обновляем в фоне, показанная библиотека не трогается
  static async refreshTalentCatalog(heroId, buildId) {
    if (Build._catalogRefreshing) return;
    Build._catalogRefreshing = true;
    try {
      await Build.waitForApiMethodIdle('build', 'inventory', 5000);
      const gen = Build.buildCacheGen;
      Build.rememberTalentCatalog(heroId, buildId, await App.api.requestPaged('build', 'inventory', { buildId }), gen);
    } catch {
    } finally {
      Build._catalogRefreshing = false;
    }
  }

  static async refreshBuildStateFromServer({ refreshInventory = true } = {}) {
    if (!Build.heroId || Build.targetId === undefined || Build.targetId === null) return;

    // «Последнее действие побеждает»: не перезаписываем билд, который загрузился
    // во время запроса (быстрое переключение вкладок / мутация + смена вкладки).
    const refreshToken = Build._initToken;
    const refreshHeroId = Build.heroId;
    const refreshTargetId = Build.targetId;

    // Не наступаем на main-fetch конкурентного init (requestAlreadyPending).
    await Build.waitForApiIdle('build', 3000);

    if (Build._initToken !== refreshToken || Build.heroId !== refreshHeroId || Build.targetId !== refreshTargetId) return;

    // Ensure the settings button/panel remain attached after rebuilds.
    Build.scheduleAttachBuildSettings(20);

    let highlightedLevels = [];
    try {
      highlightedLevels = Array.from(Build.fieldView?.querySelectorAll?.('.build-field-row.highlight') || [])
        .map((el) => el?.dataset?.level)
        .filter(Boolean);
    } catch {}

    let request = null;
    const cacheGen = Build.buildCacheGen;
    try {
      request = await App.api.request('build', 'data', {
        heroId: refreshHeroId,
        target: refreshTargetId,
      });
    } catch {
      return;
    }
    Build.storeBuildData(refreshHeroId, request, cacheGen, { selected: true });

    if (Build._initToken !== refreshToken || Build.heroId !== refreshHeroId || Build.targetId !== refreshTargetId) return;

    try {
      Build.setCombatMode(false, { force: true });
      Build.fieldConflict = new Object();
      Build.installedTalents = new Array(36).fill(null);
      Build.fieldView?.replaceChildren();
    } catch {}

    try {
      if (request?.body) Build.field(request.body);
    } catch {}

    try {
      for (const lvl of highlightedLevels) {
        const row = Build.fieldView?.querySelector?.(`.build-field-row[data-level="${lvl}"]`);
        if (row) row.classList.add('highlight');
      }
    } catch {}

    if (refreshInventory) {
      try {
        Build.inventory();
      } catch {}
    }

    try {
      if (request?.active) Build.activeBar(request.active);
    } catch {}
    Build.syncCombatModeButtonState();
  }
  
  static resolveTalentById(talentId) {
    const key = `${Number(talentId)}`;
    if (key in Build.talents) return Build.talents[key];
    if (`${talentId}` in Build.talents) return Build.talents[`${talentId}`];
    return null;
  }
  
  static applyRollbackSnapshot(rollback) {
    if (!rollback || !Array.isArray(rollback.body) || !Array.isArray(rollback.active)) {
      return false;
    }
    if (rollback.body.length < 36 || rollback.active.length < 24) {
      return false;
    }
    
    const nextInstalled = new Array(36).fill(null);
    for (let i = 0; i < 36; i++) {
      const id = Number(rollback.body[i]) || 0;
      if (!id) continue;
      const data = Build.resolveTalentById(id);
      if (!data) {
        return false;
      }
      nextInstalled[i] = data;
    }
    
    Build.installedTalents = nextInstalled;
    Build.activeBarItems = rollback.active.slice(0, 24).map((item) => Number(item) || 0);
    Build.rebuildFieldConflictFromInstalledTalents();
    Build.syncFieldSlotsFromInstalledTalents();
    Build.scheduleActiveBarRender(Build.activeBarItems);
    Build.sortInventory();
    Build.updateHeroStats();
    Build.syncCombatModeButtonState();
    return true;
  }
  
  static notifyTalentAnomaly(reason) {
    const key = reason && `${reason}` ? `${reason}` : 'talentAnomalyUnknown';
    const text = Lang.text(key);
    App.notify(text && text !== key ? text : Lang.text('talentAnomalyUnknown'));
  }
  
  static async handleOptimisticResponse(result) {
    if (!result || typeof result !== 'object' || !('ok' in result)) {
      return true;
    }
    if (result.ok) {
      return true;
    }
    
    const restored = Build.applyRollbackSnapshot(result.rollback);
    Build.notifyTalentAnomaly(result.reason);
    if (!restored) {
      await Build.refreshBuildStateFromServer({ refreshInventory: true });
    }
    return false;
  }
  
  static async sendBuildMutation({ optimisticMethod, legacyMethod, data }) {
    const runLegacy = async () => {
      if (!legacyMethod) return false;
      let legacyData = data;
      if (legacyMethod === 'swap' && data && !('id' in data) && 'buildId' in data) {
        legacyData = { ...data, id: data.buildId };
      }
      await App.api.request('build', legacyMethod, legacyData);
      return true;
    };
    
    const runOptimistic = async () => {
      if (!Build.useOptimisticTalentApi) {
        return await runLegacy();
      }
      try {
        const result = await App.api.request('build', optimisticMethod, data);
        return await Build.handleOptimisticResponse(result);
      } catch (error) {
        return await runLegacy();
      }
    };
    
    Build.mutationQueue = Build.mutationQueue
      .then(async () => {
        try {
          await runOptimistic();
        } catch {}
      })
      .catch(() => {});
    
    return true;
  }
  
  static async sendBuildMutationOrThrow(options) {
    const ok = await Build.sendBuildMutation(options);
    if (!ok) {
      throw new Error('Talent action rejected by backend');
    }
    return true;
  }
  
  static scheduleActiveBarRender(data = null) {
    const source = Array.isArray(data) ? data : Build.activeBarItems;
    Build._activeBarRenderData = Array.isArray(source) ? source.slice(0, 24).map((item) => Number(item) || 0) : new Array(24).fill(0);
    if (Build._activeBarRenderScheduled) return;
    Build._activeBarRenderScheduled = true;
    requestAnimationFrame(() => {
      Build._activeBarRenderScheduled = false;
      const nextData = Array.isArray(Build._activeBarRenderData) ? Build._activeBarRenderData : new Array(24).fill(0);
      Build.activeBar(nextData);
    });
  }

  static ensureBuildSettingsDefaults() {
    if (!Settings.settings) return;
    if (!Number.isFinite(Number(Settings.settings.buildSetLmbMode))) {
      Settings.settings.buildSetLmbMode = 1;
    }
    if (Settings.settings.buildSetLmbMode < 1 || Settings.settings.buildSetLmbMode > 3) {
      Settings.settings.buildSetLmbMode = 1;
    }
    if (!Number.isFinite(Number(Settings.settings.buildSetSortMode))) {
      Settings.settings.buildSetSortMode = 0;
    }
    if (Settings.settings.buildSetSortMode !== 0 && Settings.settings.buildSetSortMode !== 1) {
      Settings.settings.buildSetSortMode = 0;
    }
    if (typeof Settings.settings.buildRowHoverHighlight !== 'boolean') {
      Settings.settings.buildRowHoverHighlight = true;
    }
    if (!Number.isFinite(Number(Settings.settings.buildTalentViewLayout))) {
      Settings.settings.buildTalentViewLayout = 0;
    }
    if (Settings.settings.buildTalentViewLayout !== 0 && Settings.settings.buildTalentViewLayout !== 1) {
      Settings.settings.buildTalentViewLayout = 0;
    }
    if (typeof Settings.settings.buildSetOnlyMatchingStats !== 'boolean') {
      Settings.settings.buildSetOnlyMatchingStats = false;
    }
    if (!Number.isFinite(Number(Settings.settings.buildStatFilterHighlightMode))) {
      Settings.settings.buildStatFilterHighlightMode = 1;
    }
    if (Settings.settings.buildStatFilterHighlightMode < 0 || Settings.settings.buildStatFilterHighlightMode > 2) {
      Settings.settings.buildStatFilterHighlightMode = 1;
    }
    if (typeof Settings.settings.buildSetHoverOnTalent !== 'boolean') {
      Settings.settings.buildSetHoverOnTalent = true;
    }
    if (!Number.isFinite(Number(Settings.settings.buildHighlightHue))) {
      Settings.settings.buildHighlightHue = Build.BUILD_HIGHLIGHT_HUE_DEFAULT;
    }
    let bhHue = Number(Settings.settings.buildHighlightHue);
    bhHue = ((bhHue % 360) + 360) % 360;
    Settings.settings.buildHighlightHue = bhHue;
    if (!Number.isFinite(Number(Settings.settings.buildHighlightBorderMm))) {
      Settings.settings.buildHighlightBorderMm = Build.BUILD_HIGHLIGHT_BORDER_MM_DEFAULT;
    }
    const bhMm = Number(Settings.settings.buildHighlightBorderMm);
    Settings.settings.buildHighlightBorderMm = Math.min(
      Build.BUILD_HIGHLIGHT_BORDER_MM_MAX,
      Math.max(Build.BUILD_HIGHLIGHT_BORDER_MM_MIN, bhMm),
    );
  }

  static getBuildHighlightHue() {
    let h = Number(Settings.settings?.buildHighlightHue);
    if (!Number.isFinite(h)) h = Build.BUILD_HIGHLIGHT_HUE_DEFAULT;
    return ((h % 360) + 360) % 360;
  }

  static getBuildHighlightBorderMm() {
    let mm = Number(Settings.settings?.buildHighlightBorderMm);
    if (!Number.isFinite(mm)) mm = Build.BUILD_HIGHLIGHT_BORDER_MM_DEFAULT;
    return Math.min(
      Build.BUILD_HIGHLIGHT_BORDER_MM_MAX,
      Math.max(Build.BUILD_HIGHLIGHT_BORDER_MM_MIN, mm),
    );
  }

  static applyBuildHighlightVariablesFromSettings() {
    try {
      const h = String(Build.getBuildHighlightHue());
      const b = `${Build.getBuildHighlightBorderMm()}mm`;
      document.documentElement.style.setProperty('--build-hl-h', h);
      document.documentElement.style.setProperty('--build-hl-border-mm', b);
    } catch {}
  }

  /** Пока зажата ЛКМ на полосках цвета/толщины подсветки — подсветить все таланты (поле + библиотека). */
  static setHighlightSettingsStripPreviewActive(on) {
    const fieldCls = 'build-highlight-settings-demo';
    const libCls = 'build-highlight-settings-demo-lib';
    const v = !!on;
    try {
      Build.fieldView?.querySelectorAll?.('.build-talent-item')?.forEach((el) => {
        el.classList.toggle(fieldCls, v);
      });
    } catch {}
    try {
      Build.inventoryView?.querySelectorAll?.('.build-talents .build-talent-item')?.forEach((el) => {
        el.classList.toggle(libCls, v);
      });
    } catch {}
  }

  static getBuildStatFilterHighlightMode() {
    const m = Number(Settings.settings?.buildStatFilterHighlightMode);
    if (!Number.isFinite(m) || m < 0 || m > 2) return 1;
    return m;
  }

  static getSetLmbMode() {
    const mode = Number(Settings.settings?.buildSetLmbMode);
    if (!Number.isFinite(mode) || mode < 1 || mode > 3) return 1;
    return mode;
  }

  static getSetSortMode() {
    const mode = Number(Settings.settings?.buildSetSortMode);
    if (!Number.isFinite(mode) || mode < 0 || mode > 1) return 0;
    return mode;
  }

  static isBuildRowHoverHighlightEnabled() {
    return !!Settings.settings?.buildRowHoverHighlight;
  }

  static isBuildSetHoverOnTalentEnabled() {
    return Settings.settings?.buildSetHoverOnTalent !== false;
  }

  static beginLibraryHoverSuppression(timeoutMs = 80) {
    Build._libraryHoverSuppressed = true;
    try {
      if (Build._libraryHoverSuppressTimer) clearTimeout(Build._libraryHoverSuppressTimer);
    } catch {}
    Build._libraryHoverSuppressTimer = setTimeout(() => {
      Build._libraryHoverSuppressTimer = 0;
      Build._libraryHoverSuppressed = false;
      try {
        const x = Number(Build._libraryPointerX);
        const y = Number(Build._libraryPointerY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const below = document.elementFromPoint(x, y);
        const hoveredTalent = below?.closest?.('.build-talents .build-talent-item');
        if (!hoveredTalent) return;
        hoveredTalent.dispatchEvent(
          new MouseEvent('mouseover', {
            bubbles: false,
            cancelable: false,
            view: window,
            clientX: x,
            clientY: y,
          }),
        );
      } catch {}
    }, timeoutMs);
  }

  static applyTalentViewLayoutFromSettings() {
    try {
      const v = Build.inventoryView;
      if (!v) return;
      const mode = Number(Settings.settings?.buildTalentViewLayout) === 1 ? 1 : 0;
      v.classList.toggle('build-talent-view--row', mode === 1);
    } catch {}
  }

  static createBuildSettingsButton() {
    const button = DOM({
      tag: 'button',
      style: 'build-list-settings',
      domaudio: domAudioPresets.defaultButton,
      event: [
        'click',
        (e) => {
          e?.preventDefault?.();
          e?.stopPropagation?.();
          Build.toggleBuildSettingsPanel();
        },
      ],
    });
    button.type = 'button';
    button.textContent = '';
    Build.setUiTooltip(button, Lang.text('buildSettingsTitle'));
    button.setAttribute('aria-label', Lang.text('buildSettingsTitle'));
    button.setAttribute('aria-expanded', 'false');
    return button;
  }

  static createBuildSettingsPanel() {
    const panel = DOM({ style: 'build-settings-panel' });
    panel.style.display = 'none';

    const title = DOM({ style: 'build-settings-title' }, Lang.text('buildSettingsTitle'));

    const modeLabel = DOM({ style: 'build-settings-row-label' }, Lang.text('buildSettingsLmbMode'));
    const modeValue = DOM({ tag: 'span', style: 'build-settings-row-value' });
    modeValue.textContent = Build.getSetLmbModeLabel(Build.getSetLmbMode());
    const modeDots = DOM({ style: 'build-settings-mode-dots' });
    const buildSetModeValue = async (next) => {
      Settings.settings.buildSetLmbMode = next;
      modeValue.textContent = Build.getSetLmbModeLabel(next);
      const items = modeDots.querySelectorAll('.build-settings-mode-dot');
      items.forEach((dot, idx) => dot.classList.toggle('build-settings-mode-dot-active', idx + 1 === next));
      try {
        await Settings.WriteSettings();
      } catch {}
    };

    for (let i = 1; i <= 3; i++) {
      const dotStyle = ['build-settings-mode-dot'];
      if (Build.getSetLmbMode() === i) dotStyle.push('build-settings-mode-dot-active');
      const dot = DOM({
        tag: 'button',
        type: 'button',
        style: dotStyle,
        title: Lang.text(`buildSettingsLmbMode${i}`),
        event: [
          'click',
          async () => {
            await buildSetModeValue(i);
          },
        ],
      });
      modeDots.append(dot);
    }

    const hoverLabel = DOM({ style: 'build-settings-row-label' }, Lang.text('buildSettingsRowHighlight'));
    const hoverValue = DOM({ tag: 'span', style: 'build-settings-row-value' });
    const hoverDots = DOM({ style: 'build-settings-mode-dots' });
    const applyHoverValue = async (enabled) => {
      Settings.settings.buildRowHoverHighlight = enabled;
      hoverValue.textContent = enabled ? Lang.text('buildSettingsOn') : Lang.text('buildSettingsOff');
      if (!enabled) Build.clearBuildRowHoverHighlight();
      const activeIndex = enabled ? 1 : 0;
      const items = hoverDots.querySelectorAll('.build-settings-mode-dot');
      items.forEach((dot, idx) => dot.classList.toggle('build-settings-mode-dot-active', idx === activeIndex));
      try {
        await Settings.WriteSettings();
      } catch {}
    };
    const hoverEnabledNow = Build.isBuildRowHoverHighlightEnabled();
    hoverValue.textContent = hoverEnabledNow ? Lang.text('buildSettingsOn') : Lang.text('buildSettingsOff');
    for (let i = 0; i < 2; i++) {
      const enabled = i === 1;
      const dotStyle = ['build-settings-mode-dot'];
      if ((hoverEnabledNow && enabled) || (!hoverEnabledNow && !enabled)) dotStyle.push('build-settings-mode-dot-active');
      const dot = DOM({
        tag: 'button',
        type: 'button',
        style: dotStyle,
        title: enabled ? Lang.text('buildSettingsOn') : Lang.text('buildSettingsOff'),
        event: ['click', async () => applyHoverValue(enabled)],
      });
      hoverDots.append(dot);
    }

    const layoutLabel = DOM({ style: 'build-settings-row-label' }, Lang.text('buildSettingsLayout'));
    const layoutValue = DOM({ tag: 'span', style: 'build-settings-row-value' });
    const getLayoutText = (n) => (n === 1 ? Lang.text('buildSettingsLayoutRow') : Lang.text('buildSettingsLayoutColumn'));
    layoutValue.textContent = getLayoutText(Number(Settings.settings?.buildTalentViewLayout) === 1 ? 1 : 0);

    const layoutDots = DOM({ style: 'build-settings-mode-dots' });
    const applyLayoutValue = async (next) => {
      Settings.settings.buildTalentViewLayout = next;
      layoutValue.textContent = getLayoutText(next);
      Build.applyTalentViewLayoutFromSettings();
      const items = layoutDots.querySelectorAll('.build-settings-mode-dot');
      items.forEach((dot, idx) => dot.classList.toggle('build-settings-mode-dot-active', idx === next));
      try {
        await Settings.WriteSettings();
      } catch {}
    };
    const layoutNow = Number(Settings.settings?.buildTalentViewLayout) === 1 ? 1 : 0;
    for (let i = 0; i < 2; i++) {
      const dotStyle = ['build-settings-mode-dot'];
      if (layoutNow === i) dotStyle.push('build-settings-mode-dot-active');
      const dot = DOM({
        tag: 'button',
        type: 'button',
        style: dotStyle,
        title: i === 1 ? Lang.text('buildSettingsLayoutRow') : Lang.text('buildSettingsLayoutColumn'),
        event: ['click', async () => applyLayoutValue(i)],
      });
      layoutDots.append(dot);
    }

    const setSortLabel = DOM({ style: 'build-settings-row-label' }, Lang.text('buildSettingsSetSortMode'));
    const setSortValue = DOM({ tag: 'span', style: 'build-settings-row-value' });
    const setSortDots = DOM({ style: 'build-settings-mode-dots' });
    const applySetSortValue = async (next) => {
      Settings.settings.buildSetSortMode = next;
      setSortValue.textContent = Build.getSetSortModeLabel(next);
      const items = setSortDots.querySelectorAll('.build-settings-mode-dot');
      items.forEach((dot, idx) => dot.classList.toggle('build-settings-mode-dot-active', idx === next));
      Build.renderTalentSetsList();
      try {
        await Settings.WriteSettings();
      } catch {}
    };
    const setSortModeNow = Build.getSetSortMode();
    setSortValue.textContent = Build.getSetSortModeLabel(setSortModeNow);
    for (let i = 0; i < 2; i++) {
      const dotStyle = ['build-settings-mode-dot'];
      if (setSortModeNow === i) dotStyle.push('build-settings-mode-dot-active');
      const dot = DOM({
        tag: 'button',
        type: 'button',
        style: dotStyle,
        title: i === 1 ? Lang.text('buildSettingsSetSortModePopular') : Lang.text('buildSettingsSetSortModeDefault'),
        event: ['click', async () => applySetSortValue(i)],
      });
      setSortDots.append(dot);
    }

    const matchLabel = DOM({ style: 'build-settings-row-label' }, Lang.text('buildSettingsSetMatchOnly'));
    const matchValue = DOM({ tag: 'span', style: 'build-settings-row-value' });
    const matchDots = DOM({ style: 'build-settings-mode-dots' });
    const applyMatchValue = async (enabled) => {
      Settings.settings.buildSetOnlyMatchingStats = enabled;
      matchValue.textContent = enabled ? Lang.text('buildSettingsOn') : Lang.text('buildSettingsOff');
      const activeIndex = enabled ? 1 : 0;
      const items = matchDots.querySelectorAll('.build-settings-mode-dot');
      items.forEach((dot, idx) => dot.classList.toggle('build-settings-mode-dot-active', idx === activeIndex));
      try {
        await Settings.WriteSettings();
      } catch {}
    };
    const matchEnabledNow = Boolean(Settings.settings?.buildSetOnlyMatchingStats);
    matchValue.textContent = matchEnabledNow ? Lang.text('buildSettingsOn') : Lang.text('buildSettingsOff');
    for (let i = 0; i < 2; i++) {
      const enabled = i === 1;
      const dotStyle = ['build-settings-mode-dot'];
      if ((matchEnabledNow && enabled) || (!matchEnabledNow && !enabled)) dotStyle.push('build-settings-mode-dot-active');
      const dot = DOM({
        tag: 'button',
        type: 'button',
        style: dotStyle,
        title: enabled ? Lang.text('buildSettingsOn') : Lang.text('buildSettingsOff'),
        event: ['click', async () => applyMatchValue(enabled)],
      });
      matchDots.append(dot);
    }

    const statFiltLabel = DOM({ style: 'build-settings-row-label' }, Lang.text('buildSettingsStatFilterHighlight'));
    const statFiltValue = DOM({ tag: 'span', style: 'build-settings-row-value' });
    const statFiltModeNow = Build.getBuildStatFilterHighlightMode();
    statFiltValue.textContent = Build.getBuildStatFilterHighlightModeLabel(statFiltModeNow);
    const statFiltDots = DOM({ style: 'build-settings-mode-dots' });
    const applyStatFiltMode = async (next) => {
      Settings.settings.buildStatFilterHighlightMode = next;
      statFiltValue.textContent = Build.getBuildStatFilterHighlightModeLabel(next);
      const items = statFiltDots.querySelectorAll('.build-settings-mode-dot');
      items.forEach((dot, idx) => dot.classList.toggle('build-settings-mode-dot-active', idx === next));
      try {
        await Settings.WriteSettings();
      } catch {}
    };
    for (let i = 0; i < 3; i++) {
      const dotStyle = ['build-settings-mode-dot'];
      if (statFiltModeNow === i) dotStyle.push('build-settings-mode-dot-active');
      const dot = DOM({
        tag: 'button',
        type: 'button',
        style: dotStyle,
        title: Build.getBuildStatFilterHighlightModeLabel(i),
        event: ['click', async () => applyStatFiltMode(i)],
      });
      statFiltDots.append(dot);
    }

    const setHoverTalentLabel = DOM({ style: 'build-settings-row-label' }, Lang.text('buildSettingsSetHoverOnTalent'));
    const setHoverTalentValue = DOM({ tag: 'span', style: 'build-settings-row-value' });
    const setHoverTalentDots = DOM({ style: 'build-settings-mode-dots' });
    const applySetHoverTalentValue = async (enabled) => {
      Settings.settings.buildSetHoverOnTalent = enabled;
      setHoverTalentValue.textContent = enabled ? Lang.text('buildSettingsOn') : Lang.text('buildSettingsOff');
      const activeIndex = enabled ? 1 : 0;
      const items = setHoverTalentDots.querySelectorAll('.build-settings-mode-dot');
      items.forEach((dot, idx) => dot.classList.toggle('build-settings-mode-dot-active', idx === activeIndex));
      try {
        await Settings.WriteSettings();
      } catch {}
    };
    const setHoverTalentEnabledNow = Build.isBuildSetHoverOnTalentEnabled();
    setHoverTalentValue.textContent = setHoverTalentEnabledNow ? Lang.text('buildSettingsOn') : Lang.text('buildSettingsOff');
    for (let i = 0; i < 2; i++) {
      const enabled = i === 1;
      const dotStyle = ['build-settings-mode-dot'];
      if ((setHoverTalentEnabledNow && enabled) || (!setHoverTalentEnabledNow && !enabled)) {
        dotStyle.push('build-settings-mode-dot-active');
      }
      const dot = DOM({
        tag: 'button',
        type: 'button',
        style: dotStyle,
        title: enabled ? Lang.text('buildSettingsOn') : Lang.text('buildSettingsOff'),
        event: ['click', async () => applySetHoverTalentValue(enabled)],
      });
      setHoverTalentDots.append(dot);
    }

    const hlBlock = DOM({ style: 'build-settings-hl-block' });
    const hlSliders = DOM({ style: 'build-settings-hl-sliders' });
    const hlHueLabel = DOM({ style: 'build-settings-hl-line-label' }, Lang.text('buildSettingsHighlightHue'));
    const hlHueTrack = DOM({ style: 'build-settings-hl-hue-track' });
    const hlHueThumb = DOM({ style: 'build-settings-hl-thumb' });
    hlHueTrack.append(hlHueThumb);
    const hlBorderLabel = DOM({ style: 'build-settings-hl-line-label' }, Lang.text('buildSettingsHighlightBorder'));
    const hlBorderTrack = DOM({ style: 'build-settings-hl-mm-track' });
    const hlBorderThumb = DOM({ style: 'build-settings-hl-thumb' });
    hlBorderTrack.append(hlBorderThumb);
    hlSliders.append(hlHueLabel, hlHueTrack, hlBorderLabel, hlBorderTrack);

    const hlReset = DOM(
      {
        tag: 'button',
        type: 'button',
        style: 'build-settings-hl-reset',
        title: Lang.text('buildSettingsHighlightReset'),
        domaudio: domAudioPresets.defaultButton,
      },
      '↺',
    );

    const syncHlPanelThumbs = () => {
      const hue = Build.getBuildHighlightHue();
      hlHueThumb.style.left = `${(hue / 360) * 100}%`;
      const mm = Build.getBuildHighlightBorderMm();
      const span = Build.BUILD_HIGHLIGHT_BORDER_MM_MAX - Build.BUILD_HIGHLIGHT_BORDER_MM_MIN;
      const t = span > 0 ? (mm - Build.BUILD_HIGHLIGHT_BORDER_MM_MIN) / span : 0;
      hlBorderThumb.style.left = `${Math.min(1, Math.max(0, t)) * 100}%`;
    };

    const commitHlSettings = async () => {
      Build.applyBuildHighlightVariablesFromSettings();
      try {
        await Settings.WriteSettings();
      } catch {}
    };

    const setHueFromClientX = (clientX) => {
      const r = hlHueTrack.getBoundingClientRect();
      if (r.width <= 0) return Build.getBuildHighlightHue();
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const hue = t * 360;
      Settings.settings.buildHighlightHue = hue;
      hlHueThumb.style.left = `${t * 100}%`;
      Build.applyBuildHighlightVariablesFromSettings();
      return hue;
    };

    const setBorderMmFromClientX = (clientX) => {
      const r = hlBorderTrack.getBoundingClientRect();
      if (r.width <= 0) return Build.getBuildHighlightBorderMm();
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const mm =
        Build.BUILD_HIGHLIGHT_BORDER_MM_MIN +
        t * (Build.BUILD_HIGHLIGHT_BORDER_MM_MAX - Build.BUILD_HIGHLIGHT_BORDER_MM_MIN);
      Settings.settings.buildHighlightBorderMm = mm;
      hlBorderThumb.style.left = `${t * 100}%`;
      Build.applyBuildHighlightVariablesFromSettings();
      return mm;
    };

    let hlHueDrag = false;
    let hlBorderDrag = false;
    const syncHlStripPreview = () => {
      Build.setHighlightSettingsStripPreviewActive(hlHueDrag || hlBorderDrag);
    };
    hlHueTrack.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      hlHueDrag = true;
      hlHueTrack.setPointerCapture(e.pointerId);
      setHueFromClientX(e.clientX);
      syncHlStripPreview();
    });
    hlHueTrack.addEventListener('pointermove', (e) => {
      if (!hlHueDrag) return;
      setHueFromClientX(e.clientX);
    });
    const endHueDrag = async (e) => {
      if (!hlHueDrag) return;
      hlHueDrag = false;
      syncHlStripPreview();
      try {
        hlHueTrack.releasePointerCapture(e.pointerId);
      } catch {}
      setHueFromClientX(e.clientX);
      await commitHlSettings();
    };
    hlHueTrack.addEventListener('pointerup', endHueDrag);
    hlHueTrack.addEventListener('pointercancel', endHueDrag);
    hlHueTrack.addEventListener('lostpointercapture', async () => {
      if (!hlHueDrag) return;
      hlHueDrag = false;
      syncHlStripPreview();
      await commitHlSettings();
    });

    hlBorderTrack.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      hlBorderDrag = true;
      hlBorderTrack.setPointerCapture(e.pointerId);
      setBorderMmFromClientX(e.clientX);
      syncHlStripPreview();
    });
    hlBorderTrack.addEventListener('pointermove', (e) => {
      if (!hlBorderDrag) return;
      setBorderMmFromClientX(e.clientX);
    });
    const endBorderDrag = async (e) => {
      if (!hlBorderDrag) return;
      hlBorderDrag = false;
      syncHlStripPreview();
      try {
        hlBorderTrack.releasePointerCapture(e.pointerId);
      } catch {}
      setBorderMmFromClientX(e.clientX);
      await commitHlSettings();
    };
    hlBorderTrack.addEventListener('pointerup', endBorderDrag);
    hlBorderTrack.addEventListener('pointercancel', endBorderDrag);
    hlBorderTrack.addEventListener('lostpointercapture', async () => {
      if (!hlBorderDrag) return;
      hlBorderDrag = false;
      syncHlStripPreview();
      await commitHlSettings();
    });

    hlReset.addEventListener('click', async (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      Settings.settings.buildHighlightHue = Build.BUILD_HIGHLIGHT_HUE_DEFAULT;
      Settings.settings.buildHighlightBorderMm = Build.BUILD_HIGHLIGHT_BORDER_MM_DEFAULT;
      Build.ensureBuildSettingsDefaults();
      syncHlPanelThumbs();
      await commitHlSettings();
    });

    syncHlPanelThumbs();
    Build.refreshBuildHighlightSettingsPanel = syncHlPanelThumbs;

    hlBlock.append(hlSliders, hlReset);

    // Каждая настройка — отдельная карточка: название, под ним кнопки-сегменты с подписями
    // вариантов (выбранный подсвечен). Отдельная строка значения больше не нужна —
    // раньше она стояла вплотную к названию следующей настройки, и их путали.
    const segmentGroups = [modeDots, hoverDots, layoutDots, setSortDots, matchDots, statFiltDots, setHoverTalentDots];
    for (const dots of segmentGroups) {
      dots.classList.add('build-settings-segments');
      dots.querySelectorAll('.build-settings-mode-dot').forEach((dot) => {
        dot.textContent = dot.title;
        dot.removeAttribute('title');
      });
    }
    const settingsRow = (label, dots) => DOM({ style: 'build-settings-row' }, label, dots);
    hlBlock.classList.add('build-settings-row');
    panel.append(
      title,
      settingsRow(modeLabel, modeDots),
      settingsRow(hoverLabel, hoverDots),
      settingsRow(layoutLabel, layoutDots),
      settingsRow(setSortLabel, setSortDots),
      settingsRow(matchLabel, matchDots),
      settingsRow(statFiltLabel, statFiltDots),
      settingsRow(setHoverTalentLabel, setHoverTalentDots),
      hlBlock,
    );

    return panel;
  }

  static getSetLmbModeLabel(mode) {
    if (mode === 2) return Lang.text('buildSettingsLmbMode2');
    if (mode === 3) return Lang.text('buildSettingsLmbMode3');
    return Lang.text('buildSettingsLmbMode1');
  }

  static getSetSortModeLabel(mode) {
    if (Number(mode) === 1) return Lang.text('buildSettingsSetSortModePopular');
    return Lang.text('buildSettingsSetSortModeDefault');
  }

  static getNumericSetId(set) {
    const key = String(set?.key || '');
    const match = key.match(/^setId_(\d+)$/i);
    return match ? Number(match[1]) : NaN;
  }

  static getSetPopularityValue(set) {
    const setId = Build.getNumericSetId(set);
    if (!Number.isFinite(setId) || setId <= 0) return 0;
    return Number(Build.setPopularityMap.get(setId)) || 0;
  }

  static async loadSetPopularityCacheFromBackend(force = false) {
    if (!force && Build.setPopularityLoadPromise) {
      await Build.setPopularityLoadPromise;
      return Build.setPopularityMap;
    }

    Build.setPopularityLoadPromise = (async () => {
      try {
        const raw = await App.api.request('build', 'setsPopularity', {});
        const map = new Map();
        if (raw && typeof raw === 'object') {
          for (const [idRaw, valueRaw] of Object.entries(raw)) {
            const id = Number(idRaw);
            const value = Number(valueRaw);
            if (!Number.isFinite(id) || id <= 0) continue;
            map.set(id, Number.isFinite(value) ? value : 0);
          }
        }
        Build.setPopularityMap = map;
        Build.setPopularityLoadedAt = Date.now();
      } catch {}
      return Build.setPopularityMap;
    })();

    await Build.setPopularityLoadPromise;
    return Build.setPopularityMap;
  }

  static getSortedSetsForRender() {
    const sets = TalentSets.list();
    if (Build.getSetSortMode() !== 1) return sets;

    return sets
      .map((set, index) => ({ set, index, popularity: Build.getSetPopularityValue(set) }))
      .sort((a, b) => {
        if (b.popularity !== a.popularity) return b.popularity - a.popularity;
        return a.index - b.index;
      })
      .map((x) => x.set);
  }

  static registerSetPopularityClick(set) {
    const setId = Build.getNumericSetId(set);
    if (!Number.isFinite(setId) || setId <= 0) return;
    App.api
      .request('build', 'addSetPopularity', { id: setId })
      .catch(() => {});
  }

  static countInstalledTalentsFromSet(set, installedTalents = Build.installedTalents) {
    const ids = new Set(
      TalentSets.getTalentIds(set)
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id !== 0),
    );
    if (!ids.size) return 0;
    let count = 0;
    for (const talent of installedTalents || []) {
      const tid = Number(talent?.id);
      if (Number.isFinite(tid) && ids.has(tid)) count++;
    }
    return count;
  }

  static getBuildStatFilterHighlightModeLabel(mode) {
    if (mode === 0) return Lang.text('buildSettingsStatFilterHighlightModeOff');
    if (mode === 2) return Lang.text('buildSettingsStatFilterHighlightModeAffectsTotal');
    return Lang.text('buildSettingsStatFilterHighlightModeHasStat');
  }

  static toggleBuildSettingsPanel(force) {
    const panel = Build.buildSettingsPanel;
    if (!panel) return;
    const shouldOpen = typeof force === 'boolean' ? force : panel.style.display === 'none';
    panel.style.display = shouldOpen ? 'flex' : 'none';
    Build.buildSettingsButton?.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) {
      try {
        Build.refreshBuildHighlightSettingsPanel?.();
      } catch {}
    }
  }

  static attachBuildSettingsToWbuild() {
    try {
      // Attach only to the current build window instance.
      // During window re-open, an old #wbuild can still exist briefly.
      const candidates = Array.from(document.querySelectorAll('#wbuild'));
      const wbuild = candidates.find((el) => el?.contains?.(Build.buildActionsView));
      if (!wbuild) return;
      // Кнопка стоит перед «?» (View.build ставит её туда сразу); без «?» — в само окно.
      const help = wbuild.querySelector('#wbuild_help');
      if (Build.buildSettingsButton && help && Build.buildSettingsButton.nextElementSibling !== help) help.before(Build.buildSettingsButton);
      else if (Build.buildSettingsButton && !help && Build.buildSettingsButton.parentNode !== wbuild) wbuild.append(Build.buildSettingsButton);
      if (Build.buildSettingsPanel && Build.buildSettingsPanel.parentNode !== wbuild) wbuild.append(Build.buildSettingsPanel);
      Build.applyBuildHighlightVariablesFromSettings();
    } catch {}
  }

  static scheduleAttachBuildSettings(maxAttempts = 80) {
    try {
      if (Build._buildSettingsAttachTimer) clearTimeout(Build._buildSettingsAttachTimer);
    } catch {}

    let attempts = 0;
    const tick = () => {
      Build._buildSettingsAttachTimer = 0;
      Build.attachBuildSettingsToWbuild();

      let attached = false;
      try {
        const candidates = Array.from(document.querySelectorAll('#wbuild'));
        const wbuild = candidates.find((el) => el?.contains?.(Build.buildActionsView));
        attached =
          !!wbuild &&
          wbuild.contains(Build.buildActionsView) &&
          !!Build.buildSettingsButton && wbuild.contains(Build.buildSettingsButton) &&
          Build.buildSettingsPanel?.parentNode === wbuild;
      } catch {}

      if (attached || attempts >= maxAttempts) return;
      attempts++;
      Build._buildSettingsAttachTimer = setTimeout(tick, 120);
    };

    tick();
  }

  static CleanInvalidDescriptions() {
    let invalidDescriptions = document.getElementsByClassName('build-description');
    for (let descElement in invalidDescriptions) {
      if (invalidDescriptions[descElement].className && invalidDescriptions[descElement].className == 'build-description') {
        console.log('Удалено протухшее описание');
        invalidDescriptions[descElement].remove();
      }
    }
  }

  static async sets() {
    // TODO-экран: данные сетов локальные (modules/sets.list.js + Lang),
    // DB-запрос build.sets (~35 КБ) не нужен — и не должен уходить в эфир:
    // фрейм больше лимита (~23 КБ) у части WS-прокси.
    for (const set of TalentSets.list()) {
      console.log(set.key, set.set_name);
    }
  }

  static async changeSkinForHero(heroId, skinId) {
    await App.api.request('build', 'skinChange', {
      hero: heroId,
      skin: skinId,
    });

    MM.hero.filter((hero) => {
      return hero.id == heroId;
    })[0].skin = skinId;
    if (Build.heroId === heroId) {
      Build.applyBuildHeroAvatarSkin(heroId, skinId);
    }
    // вкладка «Герой» (View.attachBuildHeroesTab) перерисует кнопку выбора облика
    Build.onHeroSkinChanged?.();

    try {
      let heroItem = View.castleBottom.querySelector(`#id${heroId}`);

      heroItem.style.backgroundImage = `url(content/hero/${heroId}/${skinId}.webp)`;

      let heroName = heroItem.querySelector('.castle-item-hero-name');

      heroName.firstChild.innerText = Lang.heroName(heroId, skinId);
    } catch (e) {
      App.error(e);
    }

    //View.bodyCastleHeroes();

    //await App.ShowCurrentViewAsync();
  }

  static applyBuildHeroAvatarSkin(heroId, skinId) {
    if (!Build.heroImg) return;
    const sid = Number.isFinite(Number(skinId)) ? Number(skinId) : 1;
    Build.heroImg.style.backgroundImage = `url(content/hero/${heroId}/${sid}.webp), url(content/hero/background.png)`;
    // Use contain for hero layer so built-in frame inside skin image is not clipped on non-uniform source sizes.
    Build.heroImg.style.backgroundSize = 'contain, 100%';
    Build.heroImg.style.backgroundPosition = 'center, center';
    Build.heroImg.style.backgroundRepeat = 'no-repeat, no-repeat';
  }

  static skinChange() {
    let bodyHero = DOM({ style: 'skin-change' });

    let preload = new PreloadImages(bodyHero);

    for (const i of Build.dataRequest.hero.skin.list) {
      let hero = DOM({ domaudio: domAudioPresets.smallButton });

      hero.dataset.url = `content/hero/${Build.heroId}/${i}.webp`;

      hero.dataset.skin = i;

      hero.addEventListener('click', async () => {
        await Build.changeSkinForHero(Build.heroId, hero.dataset.skin);
        Build.applyBuildHeroAvatarSkin(Build.heroId, hero.dataset.skin);

        Splash.hide();
      });

      preload.add(hero);
    }

    Splash.show(bodyHero, false);
  }

  static buildSelectName(method, btnName, data, isWindow) {
    const close = DOM({
      tag: 'div',
      domaudio: domAudioPresets.closeButton,
      style: 'close-button',
      event: ['click', () => Splash.hide()],
    });

    close.style.backgroundImage = 'url(content/icons/close-cropped.svg)';

    let template = document.createDocumentFragment();
    const modal = DOM({style: 'title-modal'}, DOM({style: 'title-modal-text'}, Lang.text('assembly')));
    let name = DOM({
      id: 'build-create-input',
      domaudio: domAudioPresets.defaultInput,
      tag: 'input',
      placeholder: Lang.text('buildNamePlaceholder'),
    });

    let button = DOM(
      {
        style: [
          'splash-content-button-modal',
          method === 'rename' ? 'splash-nickname-sized-button' : null,
          method === 'rename' ? 'build-rename-button' : null,
        ].filter(Boolean),
        domaudio: domAudioPresets.bigButton,
        event: [
          'click',
          async () => {
            if (!name.value) {
              Splash.hide();
            }

            data['name'] = name.value;

            await App.api.request('build', method, data);

            Splash.hide();

            isWindow ? Window.show('main', 'build', Build.heroId, 0, true) : View.show('build', Build.heroId);
          },
        ],
      },
      btnName,
    );

    template.append(DOM({ style: 'splash-modal-scope-build-action' }), modal, name, button, close);

    Splash.show(template);
  }

  static setUiTooltip(element, text) {
    if (!element) return;
    const tooltip = String(text ?? '').trim();
    if (tooltip) element.dataset.tooltip = tooltip;
    else delete element.dataset.tooltip;
    element.removeAttribute('title');
  }

  static setHeroName(element, text) {
    let label = element.querySelector('.build-hero-name-text');
    if (!label) {
      label = DOM({ tag: 'span', style: 'build-hero-name-text' });
      element.replaceChildren(label);
      element.tabIndex = 0;
      const measureOverflow = () => {
        const style = getComputedStyle(element);
        const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const overflow = Math.max(0, label.scrollWidth - available);
        element.style.setProperty('--nickname-scroll-distance', `${overflow}px`);
        element.style.setProperty('--build-hero-name-scroll-duration', `${Math.max(6, overflow / 30 + 3)}s`);
        element.classList.toggle('build-hero-name--overflowing', overflow > 1);
      };
      element.addEventListener('mouseenter', measureOverflow);
      element.addEventListener('focus', measureOverflow);
    }
    label.textContent = String(text ?? '');
    element.title = label.textContent;
    element.classList.remove('build-hero-name--overflowing');
  }

  static buildActions(builds, isWindow) {
    // Переключаемый боевой режим (симуляция прокачки талантов в текущем билде)
    {
      const combatMode = DOM({
        tag: 'button',
        domaudio: domAudioPresets.defaultButton,
        style: ['build-action-item', 'btn-hover', 'color-1', 'build-action-item-combat-mode'],
        event: [
          'click',
          () => {
            Build.toggleCombatMode();
          },
        ],
      });
      const combatModeBg = DOM({
        style: ['btn-combat-mode', 'build-action-item-background'],
      });
      const combatModeCount = DOM({ tag: 'span', style: 'btn-combat-mode-count' }, '');
      const combatModeGlass = DOM({ tag: 'span', style: 'btn-combat-mode-glass' });
      combatModeBg.append(combatModeCount, combatModeGlass);
      combatMode.append(combatModeBg);
      Build.buildActionsView.append(combatMode);
      Build.combatModeButtonEl = combatMode;
      Build.combatModeButtonCountEl = combatModeCount;
      Build.syncCombatModeButtonState();
    }

    if (builds.length < 6) {
      const create = DOM({
        tag: 'button',
        domaudio: domAudioPresets.defaultButton,
        style: ['build-action-item', 'btn-hover', 'color-1'],
        event: ['click', () => Build.buildSelectName('create', Lang.text('createBuild'), { heroId: Build.heroId }, isWindow)],
      });
      Build.setUiTooltip(create, Lang.text('titleCreateANewBuildTab'));

      let createBg = DOM({
        style: ['btn-create', 'build-action-item-background'],
      });
      createBg.style.backgroundImage = `url('content/img/create.png')`;
      create.append(createBg);
      Build.buildActionsView.append(create);
    }

    // Кнопка дублирования

    const duplicate = DOM({
      tag: 'button',
      domaudio: domAudioPresets.defaultButton,
      style: ['build-action-item', 'btn-hover', 'color-1'],
      event: [
        'click',
        async () => {
          // Сохраняем ID текущего билда до любых действий
          const currentBuildId = Build.id;

          const fragment = document.createDocumentFragment();
          const duplicateBuildText = (builds.length >= 6 ? Lang.text('buildLimitReached') : Lang.text('selectBuildToReplace')).replace(/:\s*$/, '');
          const title = DOM(
            { style: 'splash-text', id: 'duplicateBuildModal'},
            duplicateBuildText,
          );
          fragment.append(DOM({ style: 'splash-modal-scope-build-action' }), title);

          // Показываем все билды кроме текущего
          builds
            .filter((build) => build.id !== currentBuildId)
            .forEach((build) => {
              const btn = DOM(
                {
                  tag: 'button',
                  domaudio: domAudioPresets.defaultButton,
                  style: ['build-replace-btn', 'btn-hover'],
                  event: [
                    'click',
                    async () => {
                      await App.api.request('build', 'duplicate', {
                        id: currentBuildId,
                        target: build.id,
                      });
                      Splash.hide();

                      isWindow ? Window.show('main', 'build', Build.heroId, 0, true) : View.show('build', Build.heroId);
                    },
                  ],
                },
                build.name,
              );
              fragment.append(btn);
            });

          // Если билдов меньше 6, добавляем кнопку создания нового
          if (builds.length < 6) {
            const createNewBtn = DOM(
              {
                tag: 'button',
                domaudio: domAudioPresets.defaultButton,
                style: ['build-replace-btn', 'btn-hover', 'color-1'],
                event: [
                  'click',
                  async () => {
                    Splash.hide();

                    // Создаем форму для имени нового билда
                    const close = DOM({
                      tag: 'div',
                      domaudio: domAudioPresets.closeButton,
                      style: 'close-button',
                      event: ['click', () => Splash.hide()],
                    });
                    close.style.backgroundImage = 'url(content/icons/close-cropped.svg)';
                    let template = document.createDocumentFragment();
                    let name = DOM({
                      domaudio: domAudioPresets.defaultInput,
                      tag: 'input',
                      placeholder: Lang.text('buildNamePlaceholder'),
                    });
                    
                    let button = DOM(
                      {
                        style: 'splash-content-button',
                        domaudio: domAudioPresets.bigButton,
                        event: [
                          'click',
                          async () => {
                            if (!name.value) {
                              Splash.hide();
                              return;
                            }

                            // Сначала создаем новый билд
                            const createData = {
                              heroId: Build.heroId,
                              name: name.value,
                            };
                            const createResponse = await App.api.request('build', 'create', createData);
                            console.log(currentBuildId);
                            console.log(createResponse);
                            // Затем дублируем сохраненный билд в новый

                            await App.api.request('build', 'duplicate', {
                              id: currentBuildId,
                              target: createResponse,
                            });

                            Splash.hide();
                            isWindow ? Window.show('main', 'build', Build.heroId, 0, true) : View.show('build', Build.heroId);
                          },
                        ],
                      },
                      Lang.text('createAndDuplicate'),
                    );
                    
                    template.append(DOM({ style: 'splash-modal-scope-build-action' }), name, button, close);
                    Splash.show(template);
                  },
                ],
              },
              Lang.text('duplicateToNewBuild'),
            );
            fragment.append(createNewBtn);
          }

          // Добавляем крестик для закрытия вместо кнопки "Отмена"
          const closeButton = DOM({
            tag: 'div',
            domaudio: domAudioPresets.closeButton,
            style: 'close-button',
            event: ['click', () => Splash.hide()],
          });

          const modal = DOM({style: 'title-modal'}, DOM({style: 'title-modal-text'}, Lang.text('assembly')));
          closeButton.style.backgroundImage = 'url(content/icons/close-cropped.svg)';
          fragment.append(modal, closeButton);

          Splash.show(fragment);
        },
      ],
    });
    Build.setUiTooltip(duplicate, Lang.text('titleDuplicateTheCurrentBuild'));

    let duplicateBg = DOM({ style: ['btn-duplicate'] });
    duplicateBg.style.backgroundImage = `url('content/img/copy.png')`;
    duplicate.append(duplicateBg);
    Build.buildActionsView.append(duplicate);

    // Кнопка случайного билда
    {
      const random = DOM({
        tag: 'button',
        domaudio: domAudioPresets.defaultButton,
        style: ['build-action-item', 'btn-hover', 'color-1'],
        event: [
          'click',
          async () => {
            await App.api.request('build', 'random', { id: Build.id });
            isWindow ? Window.show('main', 'build', Build.heroId, 0, true) : View.show('build', Build.heroId);
          },
        ],
      });
      Build.setUiTooltip(random, Lang.text('titleGenerateARandomBuild'));

      let randomBg = DOM({
        style: ['btn-random', 'build-action-item-background'],
      });
      randomBg.style.backgroundImage = `url('content/img/random.png')`;
      random.append(randomBg);
      Build.buildActionsView.append(random);
    }

    // Кнопка сброса билда
    {
      const resetBuild = DOM({
        tag: 'button',
        domaudio: domAudioPresets.defaultButton,
        style: ['build-action-item', 'btn-hover', 'color-1'],
        event: [
          'click',
          async () => {
            const fragment = document.createDocumentFragment();
            const modal = DOM({style: 'title-modal'}, DOM({style: 'title-modal-text'}, Lang.text('assembly')));
            const title = DOM({ style: 'splash-text', id: 'resetBuildText' }, Lang.text('resetTalentsTitle'));
            fragment.append(DOM({ style: 'splash-modal-scope-build-action' }), title);

            // Красная кнопка сброса
            const reset = DOM(
              {
                tag: 'button',
                domaudio: domAudioPresets.bigButton,
                style: ['build-replace-btn', 'build-replace-btn--red', 'build-replace-btn--compact', 'btn-hover'],
                event: [
                  'click',
                  async () => {
                    await App.api.request('build', 'clear', { id: Build.id });
                    Splash.hide();
                    isWindow ? Window.show('main', 'build', Build.heroId, 0, true) : View.show('build', Build.heroId);
                  },
                ],
              },
              Lang.text('reset'),
            );

            fragment.append(modal, reset);

            let closeButton = DOM({
              tag: 'div',
              domaudio: domAudioPresets.closeButton,
              style: 'close-button',
              event: ['click', () => Splash.hide()],
            });
            closeButton.style.backgroundImage = 'url(content/icons/close-cropped.svg)';
            fragment.append(closeButton);
            Splash.show(fragment);
          },
        ],
      });
      Build.setUiTooltip(resetBuild, Lang.text('titleResetTalentsInThisBuild'));

      let resetBg = DOM({
        style: ['btn-trash', 'build-action-item-background'],
      });
      resetBg.style.backgroundImage = `url('content/img/remove.png')`;
      resetBuild.append(resetBg);
      Build.buildActionsView.append(resetBuild);
    }

    // Кнопка сортировки сетовых талантов по колонкам
    {
      const sortSets = DOM({
        tag: 'button',
        domaudio: domAudioPresets.defaultButton,
        style: ['build-action-item', 'btn-hover', 'color-1', 'build-action-item-multiline-tooltip'],
        event: [
          'click',
          async () => {
            if (Build.combatModeEnabled || Build.sortSetsInProgress) {
              Build.syncSetSortButtonState();
              return;
            }
            const initialBodySnapshot = (Build.installedTalents || []).map((t) => Number(t?.id) || 0);
            const initialActiveSnapshot = (Build.activeBarItems || []).slice(0, 24).map((v) => Number(v) || 0);
            await Build.sortSetTalentsIntoColumns({
              skipBackendSync: true,
              initialBodySnapshot,
              initialActiveSnapshot,
            });
            if (!Build.combatModeEnabled && !Build.sortSetsInProgress) {
              await Build.sortSetTalentsIntoColumns({
                initialBodySnapshot,
                initialActiveSnapshot,
              });
            }
          },
        ],
      });
      sortSets.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (Build.combatModeEnabled || Build.sortSetsInProgress) {
          Build.syncSetSortButtonState();
          return;
        }
        const hasDetachedClassTalents = Build.hasDetachedClassTalentsFromMajorSide();
        if (!hasDetachedClassTalents) {
          await Build.mirrorBuildOnlyWithSingleSync();
          return;
        }
        await Build.sortSetTalentsIntoColumns({ classEdgeSort: true });
      });
      const sortSetsBg = DOM({
        style: ['btn-combat-mode', 'build-action-item-background'],
      });
      const sortSetsIcon = DOM({ tag: 'span', style: 'btn-sort-sets-icon' });
      const sortSetsGlass = DOM({ tag: 'span', style: 'btn-combat-mode-glass' });
      sortSetsBg.append(sortSetsIcon, sortSetsGlass);
      sortSets.append(sortSetsBg);
      Build.buildActionsView.append(sortSets);
      Build.setSortButtonEl = sortSets;
      Build.syncSetSortButtonState();
    }

  }

  static resetCombatModeState() {
    Build.combatModeButtonEl = null;
    Build.combatModeButtonCountEl = null;
    Build.setSortButtonEl = null;
    Build.sortSetsInProgress = false;
    Build.sortSetsWasApplied = false;
    Build.combatModeEnabled = false;
    Build.combatModeLearnOrder = [];
    Build.combatModeLearnOrderBySlot = new Map();
    Build.combatModeLearnedSlots = new Set();
  }

  static getCombatModeHeroLevel() {
    return Build.combatModeLearnOrder.length;
  }

  static getCombatStackProgressFactor() {
    if (!Build.combatModeEnabled) return 1;
    const level = Math.max(1, Number(Build.getCombatModeHeroLevel()) || 1);
    return Math.max(0, Math.min(1, level / 36));
  }

  static getCombatMainTalentSlotIndex() {
    for (let i = 0; i < (Build.installedTalents || []).length; i++) {
      const t = Build.installedTalents[i];
      if (Build.isMainHeroClassTalent(t)) return i;
    }
    return -1;
  }

  static isBuildCompleteForCombatMode() {
    const list = Build.installedTalents || [];
    if (!Array.isArray(list) || list.length !== 36) return false;
    for (const t of list) {
      if (!t) return false;
    }
    return true;
  }

  static hasMainTalentInBuildForCombatMode() {
    return Build.getCombatMainTalentSlotIndex() >= 0;
  }

  static canEnableCombatMode() {
    return Build.isBuildCompleteForCombatMode() && Build.hasMainTalentInBuildForCombatMode();
  }

  static getCombatModeTooltip() {
    if (!Build.canEnableCombatMode()) {
      return `${Lang.text('combatModeName')}\n${Lang.text('combatModeBuildNotComplete')}`;
    }
    return Lang.text('combatModeName');
  }

  static getSortSetsButtonTooltip() {
    if (Build.sortSetsInProgress) return Lang.text('sortSetsIntoColumnInProgress');
    if (Build.combatModeEnabled) return Lang.text('sortSetsIntoColumnDisabledCombat');
    return `${Lang.text('titleSortSetsIntoColumn')}\n${Lang.text('sortSetsRmbMirrorBuild')}`;
  }

  static syncCombatModeButtonState() {
    const btn = Build.combatModeButtonEl;
    if (!btn) return;
    const canEnable = Build.canEnableCombatMode();
    if (!canEnable && Build.combatModeEnabled) {
      Build.setCombatMode(false, { force: true });
    }
    btn.classList.toggle('build-action-item-active', Build.combatModeEnabled);
    btn.classList.toggle('build-action-item-disabled', !canEnable);
    Build.setUiTooltip(btn, Build.getCombatModeTooltip());
    if (Build.combatModeButtonCountEl) {
      const isRawMode = !Build.combatModeEnabled;
      Build.combatModeButtonCountEl.classList.toggle('btn-combat-mode-count-raw', isRawMode);
      Build.combatModeButtonCountEl.textContent = isRawMode ? '' : String(Build.getCombatModeHeroLevel());
    }
    Build.syncSetSortButtonState();
  }

  static syncSetSortButtonState() {
    const btn = Build.setSortButtonEl;
    if (!btn) return;
    const isDisabled = Build.combatModeEnabled || Build.sortSetsInProgress;
    btn.classList.toggle('build-action-item-disabled', isDisabled);
    btn.disabled = isDisabled;
    Build.setUiTooltip(btn, Build.getSortSetsButtonTooltip());
  }

  static getBuildSlotLevelByIndex(slotIndex) {
    const slot = Number(slotIndex);
    if (!Number.isFinite(slot)) return 0;
    return Math.max(1, Math.min(6, 6 - Math.floor(slot / 6)));
  }

  static getRowSlotIndicesByLevel(level) {
    const lvl = Math.max(1, Math.min(6, Number(level) || 1));
    const rowStart = (6 - lvl) * 6;
    return [rowStart, rowStart + 1, rowStart + 2, rowStart + 3, rowStart + 4, rowStart + 5];
  }

  /**
   * Панель активных после обмена слотов i1/i2 — как на сервере (pw-api build.optimisticSwap):
   * если на панели есть только один из двух слотов, ссылка переезжает за талантом;
   * если оба (или ни одного) — панель не меняется (слоты панели меняются содержимым).
   * Раньше решение принималось по флагу talent.active: при двух активных талантах,
   * из которых на панели только один, он подменялся другим.
   */
  static remapActiveBarAfterSwap(i1, i2) {
    const items = Build.activeBarItems;
    if (!Array.isArray(items)) return false;
    const pos1 = Number(i1) + 1;
    const pos2 = Number(i2) + 1;
    if (!Number.isFinite(pos1) || !Number.isFinite(pos2) || pos1 === pos2) return false;
    let has1 = false;
    let has2 = false;
    for (const v of items) {
      const abs = Math.abs(Number(v) || 0);
      if (abs === pos1) has1 = true;
      else if (abs === pos2) has2 = true;
    }
    if (has1 === has2) return false;
    const from = has1 ? pos1 : pos2;
    const to = has1 ? pos2 : pos1;
    for (let i = 0; i < items.length; i++) {
      const item = Number(items[i]) || 0;
      if (item && Math.abs(item) === from) items[i] = item < 0 ? -to : to;
    }
    return true;
  }

  /**
   * Оба таланта обмена стоят в панели активных: сервер (optimisticSwap) панель не трогает,
   * т.е. слоты остаются на позициях, а таланты в них меняются местами. Чтобы смарткаст
   * «ехал» вместе с талантом, меняем знаки этих двух слотов и синхронизируем их с сервером.
   */
  static swapActiveSmartcastAfterBothSwap(i1, i2) {
    const items = Build.activeBarItems;
    if (!Array.isArray(items)) return false;
    const pos1 = Number(i1) + 1;
    const pos2 = Number(i2) + 1;
    if (!Number.isFinite(pos1) || !Number.isFinite(pos2) || pos1 === pos2) return false;
    const idx1 = items.findIndex((v) => Math.abs(Number(v) || 0) === pos1);
    const idx2 = items.findIndex((v) => Math.abs(Number(v) || 0) === pos2);
    if (idx1 < 0 || idx2 < 0) return false;
    const smart1 = Number(items[idx1]) < 0;
    const smart2 = Number(items[idx2]) < 0;
    if (smart1 === smart2) return false;
    // В слоте idx1 теперь талант, который был на pos2 (и наоборот) — переносим его смарткаст.
    items[idx1] = smart2 ? -pos1 : pos1;
    items[idx2] = smart1 ? -pos2 : pos2;
    for (const index of [idx1, idx2]) {
      Build.sendBuildMutation({
        optimisticMethod: 'optimisticSetActive',
        legacyMethod: 'setActive',
        data: { buildId: Build.id, index, position: items[index] },
      });
    }
    return true;
  }

  /** Слот панели активных под точкой (или ближайший к ней) — не зависит от перекрывающих слоёв. */
  static findActiveBarSlotAt(x, y) {
    const slots = Array.from(Build.activeBarView?.childNodes || []);
    let best = null;
    let bestDist = Infinity;
    for (const slot of slots) {
      const r = slot.getBoundingClientRect?.();
      if (!r?.width) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return slot;
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist && dist <= r.width * 0.9) {
        bestDist = dist;
        best = slot;
      }
    }
    return best;
  }

  static async swapBuildSlotsWithBackend(i1, i2) {
    const slotA = Number(i1);
    const slotB = Number(i2);
    if (!Number.isFinite(slotA) || !Number.isFinite(slotB) || slotA === slotB) return false;
    if (!Array.isArray(Build.installedTalents)) return false;
    if (slotA < 0 || slotA >= Build.installedTalents.length) return false;
    if (slotB < 0 || slotB >= Build.installedTalents.length) return false;

    const talentA = Build.installedTalents[slotA];
    const talentB = Build.installedTalents[slotB];
    Build.installedTalents[slotA] = talentB;
    Build.installedTalents[slotB] = talentA;

    // Во время сортировки DOM двигается одним проходом в endSortDomBatch().
    if (!Build._sortDomBatch) try {
      const cellA = Build.fieldView?.querySelector?.(`.build-hero-grid-item[data-position="${slotA}"]`);
      const cellB = Build.fieldView?.querySelector?.(`.build-hero-grid-item[data-position="${slotB}"]`);
      if (cellA && cellB) {
        const nodeA = cellA.firstElementChild;
        const nodeB = cellB.firstElementChild;
        if (nodeA) cellB.append(nodeA);
        if (nodeB) cellA.append(nodeB);
      }
    } catch {}

    try {
      Build.remapActiveBarAfterSwap(slotA, slotB);
      if (!Build._sortDomBatch) Build.scheduleActiveBarRender(Array.isArray(Build.activeBarItems) ? Build.activeBarItems : new Array(24).fill(0));
    } catch {}

    if (!Build._sortDeferBackendSync) {
      await Build.sendBuildMutationOrThrow({
        optimisticMethod: 'optimisticSwap',
        legacyMethod: 'swap',
        data: {
          buildId: Build.id,
          i1: slotA,
          i2: slotB,
        },
      });
    }
    return true;
  }

  static getClassEdgeColumns(side = 'left') {
    return side === 'right' ? [5, 4, 3] : [0, 1, 2];
  }

  static hasDetachedClassTalentsFromMajorSide() {
    const leftCols = [0, 1, 2];
    const rightCols = [3, 4, 5];
    let globalLeft = 0;
    let globalRight = 0;
    for (let slot = 0; slot < (Build.installedTalents || []).length; slot++) {
      const t = Build.installedTalents?.[slot];
      if (!t || Number(t.id) >= 0) continue;
      const col = slot % 6;
      if (leftCols.includes(col)) globalLeft++;
      else globalRight++;
    }
    if (globalLeft === 0 && globalRight === 0) return false;
    if (globalLeft === globalRight) return false;
    const majorCols = globalLeft > globalRight ? leftCols : rightCols;

    for (let level = 6; level >= 1; level--) {
      const rowSlots = Build.getRowSlotIndicesByLevel(level);
      for (const slot of rowSlots) {
        const t = Build.installedTalents?.[slot];
        if (!t || Number(t.id) >= 0) continue;
        const col = rowSlots.indexOf(slot);
        if (col < 0) continue;
        if (!majorCols.includes(col)) return true;
      }
    }
    return false;
  }

  static async normalizeClassTalentsToMajorSide() {
    const leftCols = [0, 1, 2];
    const rightCols = [3, 4, 5];
    let globalLeft = 0;
    let globalRight = 0;
    for (let slot = 0; slot < (Build.installedTalents || []).length; slot++) {
      const t = Build.installedTalents?.[slot];
      if (!t || Number(t.id) >= 0) continue;
      const col = slot % 6;
      if (leftCols.includes(col)) globalLeft++;
      else globalRight++;
    }
    if (globalLeft === globalRight) return 0;
    const majorCols = globalLeft > globalRight ? leftCols : rightCols;

    let moved = 0;
    for (let level = 6; level >= 1; level--) {
      const rowSlots = Build.getRowSlotIndicesByLevel(level);
      const classSlots = rowSlots.filter((slot) => {
        const t = Build.installedTalents?.[slot];
        return !!t && Number(t.id) < 0;
      });
      if (!classSlots.length) continue;

      const classCols = classSlots.map((slot) => rowSlots.indexOf(slot)).filter((c) => c >= 0);
      if (classCols.every((c) => majorCols.includes(c))) continue;
      const minorSlots = classSlots.filter((slot) => !majorCols.includes(rowSlots.indexOf(slot)));
      if (!minorSlots.length) continue;

      const targetSlots = majorCols
        .map((col) => rowSlots[col])
        .filter((slot) => {
          const t = Build.installedTalents?.[slot];
          return !(t && Number(t.id) < 0);
        });
      if (!targetSlots.length) continue;

      for (const sourceSlot of minorSlots) {
        const targetSlot = targetSlots.shift();
        if (!Number.isFinite(targetSlot)) break;
        const targetTalent = Build.installedTalents?.[targetSlot];
        if (targetTalent && Number(targetTalent.id) < 0) continue;
        await Build.swapBuildSlotsWithBackend(sourceSlot, targetSlot);
        moved++;
      }
    }
    return moved;
  }

  static async mirrorBuildRightToLeft() {
    let moved = 0;
    for (let level = 6; level >= 1; level--) {
      const rowSlots = Build.getRowSlotIndicesByLevel(level);
      const pairs = [
        [rowSlots[0], rowSlots[5]],
        [rowSlots[1], rowSlots[4]],
        [rowSlots[2], rowSlots[3]],
      ];
      for (const [leftSlot, rightSlot] of pairs) {
        const leftTalent = Build.installedTalents?.[leftSlot] || null;
        const rightTalent = Build.installedTalents?.[rightSlot] || null;
        if (!leftTalent && !rightTalent) continue;
        const activeRefs = [];
        try {
          for (let i = 0; i < (Build.activeBarItems || []).length; i++) {
            const item = Number(Build.activeBarItems[i]) || 0;
            if (!item) continue;
            const absPos = Math.abs(item);
            if (absPos !== leftSlot + 1 && absPos !== rightSlot + 1) continue;
            const talentRef = Build.installedTalents?.[absPos - 1] || null;
            activeRefs.push({ i, sign: item < 0 ? -1 : 1, pos: absPos });
            activeRefs[activeRefs.length - 1].talentRef = talentRef;
          }
        } catch {}
        await Build.swapBuildSlotsWithBackend(leftSlot, rightSlot);
        try {
          for (const ref of activeRefs) {
            const leftNow = Build.installedTalents?.[leftSlot] || null;
            const rightNow = Build.installedTalents?.[rightSlot] || null;
            let nextPos = ref.pos;
            if (ref.talentRef && leftNow === ref.talentRef) nextPos = leftSlot + 1;
            else if (ref.talentRef && rightNow === ref.talentRef) nextPos = rightSlot + 1;
            Build.activeBarItems[ref.i] = ref.sign * nextPos;
          }
          if (!Build._sortDomBatch) Build.scheduleActiveBarRender(Array.isArray(Build.activeBarItems) ? Build.activeBarItems : new Array(24).fill(0));
        } catch {}
        moved++;
      }
    }
    return moved;
  }

  /** Начало пакетной сортировки: запоминаем DOM-узел каждого таланта, DOM не трогаем до конца. */
  static beginSortDomBatch() {
    const nodes = new Map();
    try {
      const cells = Build.fieldView?.querySelectorAll?.('.build-hero-grid-item[data-position]') || [];
      for (const cell of cells) {
        const talent = Build.installedTalents?.[Number(cell.dataset.position)];
        const node = cell.firstElementChild;
        if (talent && node) nodes.set(talent, node);
      }
    } catch {}
    Build._sortDomBatch = { nodes };
  }

  /** Конец пакетной сортировки: расставляем узлы по итоговым слотам и один раз рисуем панель активных. */
  static endSortDomBatch(apply = true) {
    const batch = Build._sortDomBatch;
    Build._sortDomBatch = null;
    if (!batch || !apply) return;
    try {
      const cells = Build.fieldView?.querySelectorAll?.('.build-hero-grid-item[data-position]') || [];
      const moves = [];
      for (const cell of cells) {
        const talent = Build.installedTalents?.[Number(cell.dataset.position)];
        const node = talent ? batch.nodes.get(talent) : null;
        if (node && node.parentNode !== cell) moves.push({ node, cell });
      }
      // FLIP: запоминаем старые позиции, переставляем, затем плавно «доезжаем» на новое место.
      const animate = Build.shouldAnimateSortMoves() && moves.length > 0;
      if (animate) {
        for (const m of moves) m.from = m.node.getBoundingClientRect();
      }
      for (const m of moves) m.cell.append(m.node);
      if (animate) Build.playSortMoveAnimation(moves);
    } catch {}
    Build.scheduleActiveBarRender(Array.isArray(Build.activeBarItems) ? Build.activeBarItems : new Array(24).fill(0));
  }

  static SORT_MOVE_ANIMATION_MS = 220;

  static shouldAnimateSortMoves() {
    try {
      if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return false;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return false;
    } catch {
      return false;
    }
    return true;
  }

  /** Анимация перестановки талантов после сортировки/зеркалирования. */
  static playSortMoveAnimation(moves) {
    for (const m of moves) Build.animateTalentMove(m.node, m.from);
  }

  /**
   * Плавно «перевозит» талант из fromRect на его текущее место.
   * Ячейки поля имеют overflow: hidden, поэтому анимируется не сам узел, а его копия
   * в фиксированном слое поверх окна (с теми же размерами ячейки — для cq-единиц);
   * оригинал скрыт до конца анимации. Двигается только transform.
   */
  static ensureTalentMoveAnimStyle() {
    if (Build._talentMoveAnimStyleEl?.isConnected) return;
    const style = document.createElement('style');
    style.textContent =
      '[data-talent-move-anim] > * { visibility: hidden !important; }' +
      // Призрак слота панели активных: без рамки/фона/смарткаста — летит только иконка.
      '.build-talent-move-ghost-neutral { background: none !important; box-shadow: none !important;' +
      ' border-color: transparent !important; animation: none !important; }' +
      '.build-talent-move-ghost-neutral:after { display: none !important; }';
    document.head.append(style);
    Build._talentMoveAnimStyleEl = style;
  }

  /** Фиксированный слой-копия ячейки с копией таланта (для cq-единиц — те же размеры ячейки). */
  static createTalentGhost(node, parent, parentRect) {
    const ghost = document.createElement('div');
    ghost.setAttribute('aria-hidden', 'true');
    const isActiveSlot = parent.classList.contains('build-active-bar-item');
    ghost.className = parent.className;
    // Слот со смарткастом: призрак летит вместе с рамкой смарткаста (а в самом слоте
    // она скрыта, пока идёт анимация); без смарткаста — только иконка.
    if (isActiveSlot) {
      ghost.classList.add(parent.classList.contains('smartcast') ? 'build-talent-move-ghost-smartcast' : 'build-talent-move-ghost-neutral');
    }
    let borderWidth = '';
    try {
      if (isActiveSlot) borderWidth = getComputedStyle(parent).borderTopWidth;
    } catch {}
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${parentRect.left}px`,
      top: `${parentRect.top}px`,
      width: `${parentRect.width}px`,
      height: `${parentRect.height}px`,
      margin: '0',
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '10000',
      willChange: 'transform',
    });
    if (isActiveSlot) {
      ghost.style.boxSizing = 'border-box';
      if (borderWidth) ghost.style.borderWidth = borderWidth;
    }
    const clone = node.cloneNode(true);
    clone.style.position = 'static';
    clone.style.left = '';
    clone.style.top = '';
    clone.style.translate = '';
    clone.style.removeProperty('transform');
    clone.style.opacity = '1';
    ghost.append(clone);
    document.body.append(ghost);
    return ghost;
  }

  /** Текущее видимое положение таланта: если он ещё «летит», берём позицию призрака. */
  static getTalentVisualRect(node) {
    try {
      const done = Build._talentMoveGhosts?.get?.(node);
      const ghostChild = done?.ghost?.firstChild;
      if (ghostChild?.isConnected) return ghostChild.getBoundingClientRect();
      return node.getBoundingClientRect();
    } catch {
      return null;
    }
  }

  /** Талант убран из слота: копия плавно гаснет и сжимается на месте (rect — где её показать). */
  static animateTalentVanish(node, rect = null, duration = 170) {
    try {
      if (!node || !Build.shouldAnimateSortMoves()) return;
      const parent = node.parentElement;
      if (!parent) return;
      const nodeRect = rect || Build.getTalentVisualRect(node) || node.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      if (!nodeRect?.width || !parentRect.width) return;
      Build.ensureTalentMoveAnimStyle();
      // Ячейку центрируем на видимом месте таланта (например, точке броска).
      const box = {
        left: nodeRect.left + nodeRect.width / 2 - parentRect.width / 2,
        top: nodeRect.top + nodeRect.height / 2 - parentRect.height / 2,
        width: parentRect.width,
        height: parentRect.height,
      };
      Build._talentMoveGhosts?.get?.(node)?.();
      const ghost = Build.createTalentGhost(node, parent, box);
      ghost.style.display = 'flex';
      ghost.style.alignItems = 'center';
      ghost.style.justifyContent = 'center';
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        ghost.remove();
      };
      const anim = ghost.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.6)' },
        ],
        { duration, easing: 'ease-in' },
      );
      anim.onfinish = done;
      anim.oncancel = done;
      setTimeout(done, duration + 300);
    } catch {}
  }

  static animateTalentMove(node, fromRect, duration = Build.SORT_MOVE_ANIMATION_MS) {
    try {
      if (!node || !fromRect || !node.isConnected || !Build.shouldAnimateSortMoves()) return;
      const parent = node.parentElement;
      if (!parent) return;
      const toRect = node.getBoundingClientRect();
      if (!toRect.width || !toRect.height || !fromRect.width || !fromRect.height) return;
      const dx = fromRect.left - toRect.left;
      const dy = fromRect.top - toRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      if (!Build._talentMoveGhosts) Build._talentMoveGhosts = new WeakMap();
      Build._talentMoveGhosts.get(node)?.();

      const parentRect = parent.getBoundingClientRect();
      Build.ensureTalentMoveAnimStyle();
      const ghost = Build.createTalentGhost(node, parent, parentRect);

      // Оригинал прячем через атрибут на ЯЧЕЙКЕ, а не inline-стилем на самом таланте:
      // панель активных клонирует таланты с поля (cloneNode), и inline visibility:hidden
      // попадал в клоны — слоты выглядели пустыми/затемнёнными.
      parent.dataset.talentMoveAnim = `${(Number(parent.dataset.talentMoveAnim) || 0) + 1}`;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        ghost.remove();
        const left = (Number(parent.dataset.talentMoveAnim) || 1) - 1;
        if (left > 0) parent.dataset.talentMoveAnim = `${left}`;
        else delete parent.dataset.talentMoveAnim;
        Build._talentMoveGhosts.delete(node);
      };
      done.ghost = ghost;
      Build._talentMoveGhosts.set(node, done);
      const anim = ghost.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      anim.onfinish = done;
      anim.oncancel = done;
      setTimeout(done, duration + 300);
    } catch {}
  }

  static async mirrorBuildOnlyWithSingleSync() {
    if (Build.sortSetsInProgress || Build.combatModeEnabled) {
      Build.syncSetSortButtonState();
      return;
    }
    const initialBodySnapshot = (Build.installedTalents || []).map((t) => Number(t?.id) || 0);
    const initialActiveSnapshot = (Build.activeBarItems || []).slice(0, 24).map((v) => Number(v) || 0);
    Build.sortSetsInProgress = true;
    Build._sortDeferBackendSync = true;
    Build.syncSetSortButtonState();
    try {
      Build.beginSortDomBatch();
      await Build.mirrorBuildRightToLeft();
      Build.endSortDomBatch();
      Build.updateHeroStats();
      Build.renderCombatOrderBadges();
      Build.refreshActiveTalentDescription();
      Build.refreshStatFilterHighlightCountDisplay();
      Build.syncCombatModeButtonState();
      await Build.syncSortResultToBackend(initialBodySnapshot, initialActiveSnapshot);
    } catch {
      Build.endSortDomBatch(false);
      try {
        await Build.refreshBuildStateFromServer({ refreshInventory: true });
      } catch {}
    } finally {
      if (Build._sortDomBatch) Build.endSortDomBatch();
      Build._sortDeferBackendSync = false;
      Build.sortSetsInProgress = false;
      Build.syncSetSortButtonState();
    }
  }

  static buildSwapPlanFromBodySnapshots(initialBody = [], finalBody = []) {
    const work = Array.isArray(initialBody) ? initialBody.slice() : [];
    const target = Array.isArray(finalBody) ? finalBody : [];
    const swaps = [];
    const n = Math.min(work.length, target.length);
    for (let i = 0; i < n; i++) {
      if (work[i] === target[i]) continue;
      let j = -1;
      for (let k = i + 1; k < n; k++) {
        if (work[k] === target[i]) {
          j = k;
          break;
        }
      }
      if (j < 0) continue;
      const t = work[i];
      work[i] = work[j];
      work[j] = t;
      swaps.push([i, j]);
    }
    return swaps;
  }

  /**
   * Повторяет серверную логику build.optimisticSwap (pw-api, build.model.js):
   * ссылка панели активных переносится, только если в панели есть ровно одна из двух позиций.
   * Раньше симуляция переносила обе — и синхронизация слала лишние setActive.
   */
  static simulateActiveAfterSwaps(active = [], swaps = []) {
    const next = Array.isArray(active) ? active.slice(0, 24).map((v) => Number(v) || 0) : new Array(24).fill(0);
    for (const pair of swaps || []) {
      const i1 = Number(pair?.[0]);
      const i2 = Number(pair?.[1]);
      if (!Number.isFinite(i1) || !Number.isFinite(i2) || i1 === i2) continue;
      const pos1 = i1 + 1;
      const pos2 = i2 + 1;
      let has1 = false;
      let has2 = false;
      for (let i = 0; i < next.length; i++) {
        const abs = Math.abs(next[i]);
        if (abs === pos1) has1 = true;
        else if (abs === pos2) has2 = true;
      }
      if (has1 === has2) continue;
      const from = has1 ? pos1 : pos2;
      const to = has1 ? pos2 : pos1;
      for (let i = 0; i < next.length; i++) {
        const item = next[i];
        if (item && Math.abs(item) === from) next[i] = item > 0 ? to : -to;
      }
    }
    return next;
  }

  static async syncSortResultToBackend(initialBody, initialActive) {
    const finalBody = (Build.installedTalents || []).map((t) => Number(t?.id) || 0);
    const finalActive = (Build.activeBarItems || []).slice(0, 24).map((v) => Number(v) || 0);
    const swaps = Build.buildSwapPlanFromBodySnapshots(initialBody, finalBody);
    for (const [i1, i2] of swaps) {
      await Build.sendBuildMutationOrThrow({
        optimisticMethod: 'optimisticSwap',
        legacyMethod: 'swap',
        data: { buildId: Build.id, i1, i2 },
      });
    }
    const backendActive = Build.simulateActiveAfterSwaps(initialActive, swaps);
    for (let i = 0; i < 24; i++) {
      const want = Number(finalActive[i]) || 0;
      const have = Number(backendActive[i]) || 0;
      if (want === have) continue;
      if (want === 0) {
        await Build.sendBuildMutationOrThrow({
          optimisticMethod: 'optimisticClearActive',
          legacyMethod: 'setZeroActive',
          data: { buildId: Build.id, index: i },
        });
      } else {
        await Build.sendBuildMutationOrThrow({
          optimisticMethod: 'optimisticSetActive',
          legacyMethod: 'setActive',
          data: { buildId: Build.id, index: i, position: want },
        });
      }
    }
  }

  static async sortSetTalentsIntoColumns(options = {}) {
    if (Build.sortSetsInProgress) return;
    if (Build.combatModeEnabled) {
      Build.syncSetSortButtonState();
      return;
    }
    if (!Array.isArray(Build.installedTalents) || Build.installedTalents.length < 36) return;
    const classEdgeSort = !!options?.classEdgeSort;
    const skipBackendSync = !!options?.skipBackendSync;
    const initialBodySnapshot = Array.isArray(options?.initialBodySnapshot)
      ? options.initialBodySnapshot.slice()
      : (Build.installedTalents || []).map((t) => Number(t?.id) || 0);
    const initialActiveSnapshot = Array.isArray(options?.initialActiveSnapshot)
      ? options.initialActiveSnapshot.slice(0, 24).map((v) => Number(v) || 0)
      : (Build.activeBarItems || []).slice(0, 24).map((v) => Number(v) || 0);

    Build.sortSetsInProgress = true;
    Build._sortDeferBackendSync = true;
    Build.syncSetSortButtonState();
    try {
      Build.beginSortDomBatch();
      if (classEdgeSort) {
        await Build.normalizeClassTalentsToMajorSide();
        await Build.mirrorBuildRightToLeft();
      }

      const setTalentToKey = new Map();
      for (const set of TalentSets.list()) {
        const setKey = `${set?.key || ''}`;
        if (!setKey) continue;
        const setIds = TalentSets.getTalentIds(set)
          .map((id) => Math.abs(Number(id)))
          .filter((id) => Number.isFinite(id) && id > 0);
        for (const tid of setIds) {
          if (!setTalentToKey.has(tid)) {
            setTalentToKey.set(tid, setKey);
          }
        }
      }

      // Без загруженных сетов не выходим: при ПКМ зеркалирование уже применено локально
      // и должно уйти на сервер (раньше return пропускал syncSortResultToBackend).

      const fixedSlots = new Set();
      const setTalentCounters = new Map();
      const setRowsMap = new Map();
      for (let level = 6; level >= 1; level--) {
        const rowSlots = Build.getRowSlotIndicesByLevel(level);
        const seenRows = new Set();
        for (const slot of rowSlots) {
          const talent = Build.installedTalents[slot];
          if (!talent) continue;
          const talentId = Number(talent.id);
          if (talentId < 0) {
            fixedSlots.add(slot);
            continue;
          }
          const setKey = setTalentToKey.get(Math.abs(talentId));
          if (!setKey) continue;
          setTalentCounters.set(setKey, (setTalentCounters.get(setKey) || 0) + 1);
          seenRows.add(setKey);
        }
        for (const setKey of seenRows) {
          if (!setRowsMap.has(setKey)) setRowsMap.set(setKey, new Set());
          setRowsMap.get(setKey).add(level);
        }
      }

      const getSetPriorityWeight = (setKey) => {
        const rows = Array.from(setRowsMap.get(setKey) || []).sort((a, b) => a - b);
        const count = Number(setTalentCounters.get(setKey)) || 0;
        if (count <= 0) return 0;
        if (count === 1) return 1; // одиночные
        // User rule: if all set talents are located within a single row,
        // they are treated as "singletons" priority-wise.
        if (rows.length <= 1) return 1;
        const min = rows[0];
        const max = rows[rows.length - 1];
        const contiguous = max - min + 1 === rows.length;
        if (count === 6) return 10;
        if (count === 5) return contiguous ? 9 : 8;
        if (count === 4) return contiguous ? 7 : 6;
        if (count === 3) return contiguous ? 5 : 4;
        if (count === 2) return contiguous ? 3 : 2;
        return 1;
      };

      const setSize = new Map();
      const orderedSetKeys = Array.from(setTalentCounters.keys()).sort((a, b) => {
        const wa = getSetPriorityWeight(a);
        const wb = getSetPriorityWeight(b);
        if (wb !== wa) return wb - wa;
        const ca = Number(setTalentCounters.get(a)) || 0;
        const cb = Number(setTalentCounters.get(b)) || 0;
        if (cb !== ca) return cb - ca;
        return `${a}`.localeCompare(`${b}`);
      });
      for (const k of orderedSetKeys) {
        setSize.set(k, getSetPriorityWeight(k));
      }
      const setRankByKey = new Map(orderedSetKeys.map((k, i) => [k, i]));
      const makeColsArray = () => new Array(6).fill(0);
      const getSetAtSlot = (slot) => {
        const t = Build.installedTalents?.[slot];
        const id = Number(t?.id);
        if (!(id > 0)) return null;
        return setTalentToKey.get(Math.abs(id)) || null;
      };
      const getSetColsInRow = (rowSlots, setKey) => {
        const cols = [];
        for (let c = 0; c < 6; c++) {
          if (getSetAtSlot(rowSlots[c]) === setKey) cols.push(c);
        }
        return cols;
      };
      const getRowSetCount = (rowSlots) => {
        const m = new Map();
        for (let c = 0; c < 6; c++) {
          const sk = getSetAtSlot(rowSlots[c]);
          if (!sk) continue;
          m.set(sk, (m.get(sk) || 0) + 1);
        }
        return m;
      };
      const getColumnSupport = () => {
        const support = new Map();
        for (let level = 6; level >= 1; level--) {
          const rowSlots = Build.getRowSlotIndicesByLevel(level);
          const seenByRow = new Map();
          for (let c = 0; c < 6; c++) {
            const sk = getSetAtSlot(rowSlots[c]);
            if (!sk) continue;
            if (!seenByRow.has(sk)) seenByRow.set(sk, new Set());
            seenByRow.get(sk).add(c);
          }
          for (const [sk, cols] of seenByRow.entries()) {
            if (!support.has(sk)) support.set(sk, makeColsArray());
            for (const c of cols) support.get(sk)[c] += 1;
          }
        }
        return support;
      };
      // Оценка доски на битовых масках (6 колонок -> 6 бит): та же формула, что и раньше,
      // но без Map/массивов на каждый вызов — функция вызывается сотни раз за сортировку.
      const scoreSetKeys = Array.from(setTalentCounters.keys());
      const scoreSetIdx = new Map(scoreSetKeys.map((k, i) => [k, i]));
      const scoreSetW = scoreSetKeys.map((k) => Math.max(1, Number(setSize.get(k)) || 1));
      const scoreSetTotal = scoreSetKeys.map((k) => Number(setTalentCounters.get(k)) || 0);
      const scoreMasks = new Int32Array(scoreSetKeys.length * 7);
      const scoreRowSlots = [null];
      for (let level = 1; level <= 6; level++) scoreRowSlots.push(Build.getRowSlotIndicesByLevel(level));
      const bitCount6 = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) + ((m >> 4) & 1) + ((m >> 5) & 1);
      const scoreHist = new Int32Array(6);
      const evaluateBoardScore = () => {
        scoreMasks.fill(0);
        for (let level = 1; level <= 6; level++) {
          const rowSlots = scoreRowSlots[level];
          for (let c = 0; c < 6; c++) {
            const sk = getSetAtSlot(rowSlots[c]);
            if (!sk) continue;
            const idx = scoreSetIdx.get(sk);
            if (idx === undefined) continue;
            scoreMasks[idx * 7 + level] |= 1 << c;
          }
        }
        let score = 0;
        for (let idx = 0; idx < scoreSetKeys.length; idx++) {
          const base = idx * 7;
          let present = 0;
          scoreHist.fill(0);
          for (let level = 1; level <= 6; level++) {
            const m = scoreMasks[base + level];
            if (!m) continue;
            present = 1;
            for (let c = 0; c < 6; c++) if (m & (1 << c)) scoreHist[c]++;
          }
          if (!present) continue;
          const w = scoreSetW[idx];

          let bestCol = 0;
          for (let c = 1; c < 6; c++) {
            if (scoreHist[c] > scoreHist[bestCol]) bestCol = c;
          }
          const vertical = scoreHist[bestCol];
          score += w * vertical * vertical * 40;

          let streak = 0;
          let bestStreak = 0;
          const bestBit = 1 << bestCol;
          for (let level = 6; level >= 1; level--) {
            if (scoreMasks[base + level] & bestBit) {
              streak++;
              if (streak > bestStreak) bestStreak = streak;
            } else {
              streak = 0;
            }
          }
          score += w * bestStreak * bestStreak * 20;

          // For medium/large sets treat two-column shape as a single coherent structure.
          if (scoreSetTotal[idx] >= 4) {
            let secondCol = bestCol === 0 ? 1 : 0;
            for (let c = 0; c < 6; c++) {
              if (c === bestCol) continue;
              if (scoreHist[c] > scoreHist[secondCol]) secondCol = c;
            }
            const secondSupport = scoreHist[secondCol];
            score += w * secondSupport * secondSupport * 22;
            if (Math.abs(secondCol - bestCol) === 1) score += w * 35;
          }

          for (let level = 1; level <= 6; level++) {
            const m = scoreMasks[base + level];
            const cnt = bitCount6(m);
            if (cnt < 2) continue;
            score += w * 12 * bitCount6(m & (m >> 1));
            const lo = 31 - Math.clz32(m & -m);
            const hi = 31 - Math.clz32(m);
            const spread = hi - lo;
            const ideal = cnt - 1;
            if (spread > ideal) score -= (spread - ideal) * w * 8;
          }

          // Multi-column continuity between adjacent rows.
          for (let level = 1; level <= 5; level++) {
            const overlap = bitCount6(scoreMasks[base + level] & scoreMasks[base + level + 1]);
            if (overlap > 0) score += w * overlap * overlap * 18;
          }
        }
        return score;
      };
      const getProtectedColsForRow = (level, rowSlots, rowSetCount, colSupport) => {
        const prevSlots = level < 6 ? Build.getRowSlotIndicesByLevel(level + 1) : null;
        const nextSlots = level > 1 ? Build.getRowSlotIndicesByLevel(level - 1) : null;
        const protectedCols = new Set();
        for (let c = 0; c < 6; c++) {
          const slot = rowSlots[c];
          if (fixedSlots.has(slot)) {
            protectedCols.add(c);
            continue;
          }
          const sk = getSetAtSlot(slot);
          if (!sk) continue;
          const cnt = rowSetCount.get(sk) || 0;
          if (cnt !== 1) continue;
          const prevSet = prevSlots ? getSetAtSlot(prevSlots[c]) : null;
          const nextSet = nextSlots ? getSetAtSlot(nextSlots[c]) : null;
          const support = Number(colSupport.get(sk)?.[c]) || 0;
          const hasRowMates = (rowSetCount.get(sk) || 0) > 1;
          if (hasRowMates && support <= 1) continue;
          if (prevSet === sk || nextSet === sk || support > 1) protectedCols.add(c);
        }
        return protectedCols;
      };

      let improved = true;
      let pass = 0;
      while (improved && pass < 10) {
        improved = false;
        pass++;
        const colSupport = getColumnSupport();
        const preferredColBySet = new Map();
        for (const setKey of orderedSetKeys) {
          // Bottom-up dominance: lower levels (1,2,3) must have stronger impact
          // on preferred column selection than upper rows.
          // Also count only one set entry per row.
          const weightedHist = makeColsArray();
          for (let level = 1; level <= 6; level++) {
            const rowSlots = Build.getRowSlotIndicesByLevel(level);
            const cols = getSetColsInRow(rowSlots, setKey);
            if (!cols.length) continue;
            const rowWeight = (7 - level) * (7 - level);
            const chosenCol = cols.slice().sort((a, b) => a - b)[0];
            weightedHist[chosenCol] += rowWeight;
            // For multi-column sets we must account row support on EACH occupied column,
            // otherwise leftmost-only voting may lock wrong shape (e.g. 112/112/з11).
            const uniqueCols = Array.from(new Set(cols)).sort((a, b) => a - b);
            for (const col of uniqueCols) {
              weightedHist[col] += rowWeight;
            }
          }
          const hist = colSupport.get(setKey) || makeColsArray();
          const targetColsCount = 1;
          const rankedCols = [0, 1, 2, 3, 4, 5].sort((a, b) => {
            if (weightedHist[b] !== weightedHist[a]) return weightedHist[b] - weightedHist[a];
            if ((hist[b] || 0) !== (hist[a] || 0)) return (hist[b] || 0) - (hist[a] || 0);
            return a - b;
          });
          // Strict bottom-up anchor:
          // use the lowest row (level 1 -> 6) where set exists as primary column source.
          let anchorCol = null;
          for (let level = 1; level <= 6; level++) {
            const rowSlots = Build.getRowSlotIndicesByLevel(level);
            const cols = getSetColsInRow(rowSlots, setKey);
            if (!cols.length) continue;
            anchorCol = cols.slice().sort((a, b) => a - b)[0];
            break;
          }
          const targetCols = rankedCols.slice(0, targetColsCount).sort((a, b) => a - b);
          preferredColBySet.set(setKey, Number.isFinite(anchorCol) ? anchorCol : targetCols[0]);
        }

        // Directed column-alignment pass (bottom -> top):
        // helps escape local-score plateaus and guarantees visible column building.
        for (const setKey of orderedSetKeys) {
          const targetCol = preferredColBySet.get(setKey);
          if (!Number.isFinite(targetCol)) continue;
          const curW = Number(setSize.get(setKey)) || 0;
          if (curW <= 0) continue;
          for (let level = 1; level <= 6; level++) {
            const rowSlots = Build.getRowSlotIndicesByLevel(level);
            const setCols = getSetColsInRow(rowSlots, setKey);
            if (!setCols.length) continue;
            const sourceCol = setCols.slice().sort((a, b) => Math.abs(a - targetCol) - Math.abs(b - targetCol))[0];
            if (!Number.isFinite(sourceCol) || sourceCol === targetCol) continue;

            const sourceSlot = rowSlots[sourceCol];
            const targetSlot = rowSlots[targetCol];
            if (fixedSlots.has(sourceSlot) || fixedSlots.has(targetSlot)) continue;
            const targetSet = getSetAtSlot(targetSlot);
            if (targetSet && targetSet !== setKey) {
              const targetW = Number(setSize.get(targetSet)) || 0;
              if (targetW > curW) continue;
              // Равный вес: не вытесняем более приоритетный сет (раньше в orderedSetKeys) из его
              // целевой колонки — иначе два сета перекидывают талант туда-обратно до лимита проходов
              // и побеждает тот, кто обработан последним (напр. зелье/перчатка в III ряду).
              if (
                targetW === curW &&
                setRankByKey.get(targetSet) < setRankByKey.get(setKey) &&
                preferredColBySet.get(targetSet) === targetCol
              ) {
                continue;
              }
            }
            await Build.swapBuildSlotsWithBackend(sourceSlot, targetSlot);
            improved = true;
          }
        }

        for (let level = 1; level <= 6; level++) {
          const rowSlots = Build.getRowSlotIndicesByLevel(level);
          const rowSetCount = getRowSetCount(rowSlots);
          const protectedCols = getProtectedColsForRow(level, rowSlots, rowSetCount, colSupport);
          const movableCols = [];
          for (let c = 0; c < 6; c++) {
            if (protectedCols.has(c)) continue;
            if (fixedSlots.has(rowSlots[c])) continue;
            movableCols.push(c);
          }
          if (movableCols.length < 2) continue;

          const base = evaluateBoardScore();
          let best = null;
          for (let i = 0; i < movableCols.length; i++) {
            for (let j = i + 1; j < movableCols.length; j++) {
              const c1 = movableCols[i];
              const c2 = movableCols[j];
              const s1 = rowSlots[c1];
              const s2 = rowSlots[c2];
              const t1 = Build.installedTalents?.[s1];
              const t2 = Build.installedTalents?.[s2];
              const id1 = Number(t1?.id);
              const id2 = Number(t2?.id);
              if (t1 && id1 < 0) continue;
              if (t2 && id2 < 0) continue;

              const sk1 = getSetAtSlot(s1);
              const sk2 = getSetAtSlot(s2);
              if (sk1 && sk2 && sk1 !== sk2) {
                const w1 = Number(setSize.get(sk1)) || 0;
                const w2 = Number(setSize.get(sk2)) || 0;
                if (w1 !== w2) {
                  const strong = w1 > w2 ? sk1 : sk2;
                  const strongCol = w1 > w2 ? c1 : c2;
                  const strongTargetCol = w1 > w2 ? c2 : c1;
                  const strongSupport = Number(colSupport.get(strong)?.[strongCol]) || 0;
                  const strongTargetSupport = Number(colSupport.get(strong)?.[strongTargetCol]) || 0;
                  // Bigger sets keep priority: do not let weaker sets displace
                  // already-supported strong entries into totally foreign columns.
                  if (strongSupport > 1 && strongTargetSupport <= 0) continue;

                  // Strict protection by priority:
                  // reject swap if it makes stronger set column position worse
                  // while weaker set gets same or better position.
                  const strongFromCol = w1 > w2 ? c1 : c2;
                  const strongToCol = w1 > w2 ? c2 : c1;
                  const weak = w1 > w2 ? sk2 : sk1;
                  const weakFromCol = w1 > w2 ? c2 : c1;
                  const weakToCol = w1 > w2 ? c1 : c2;
                  const strongHist = colSupport.get(strong) || makeColsArray();
                  const weakHist = colSupport.get(weak) || makeColsArray();
                  const strongFromScore = Number(strongHist[strongFromCol]) || 0;
                  const strongToScore = Number(strongHist[strongToCol]) || 0;
                  const weakFromScore = Number(weakHist[weakFromCol]) || 0;
                  const weakToScore = Number(weakHist[weakToCol]) || 0;
                  // «Потеря» считается только если у сильного сета в исходной колонке есть опора
                  // (ещё хотя бы один талант сета в этой колонке). Одиночный талант без связи
                  // не должен блокировать достройку колонки слабым сетом.
                  const strongerLoses = strongToScore < strongFromScore && strongFromScore > 1;
                  const weakerGains = weakToScore >= weakFromScore;
                  if (strongerLoses && weakerGains) continue;

                  // Do not break strong set's two-column core shape (for 4+ talents).
                  const strongCount = Number(setTalentCounters.get(strong)) || 0;
                  if (strongCount >= 4) {
                    const sHist = colSupport.get(strong) || makeColsArray();
                    let top1 = 0;
                    for (let c = 1; c < 6; c++) {
                      if ((sHist[c] || 0) > (sHist[top1] || 0)) top1 = c;
                    }
                    let top2 = top1 === 0 ? 1 : 0;
                    for (let c = 0; c < 6; c++) {
                      if (c === top1) continue;
                      if ((sHist[c] || 0) > (sHist[top2] || 0)) top2 = c;
                    }
                    // Колонка входит в «ядро», только если в ней ≥2 таланта сета:
                    // одиночный талант — не форма, его можно сдвинуть ради чужой колонки.
                    const coreCols = new Set([top1, top2].filter((c) => (sHist[c] || 0) > 1));
                    if (coreCols.has(strongCol) && !coreCols.has(strongTargetCol)) continue;
                  }
                }
              }

              const a = Build.installedTalents[s1];
              const b = Build.installedTalents[s2];
              Build.installedTalents[s1] = b;
              Build.installedTalents[s2] = a;
              const sc = evaluateBoardScore();
              Build.installedTalents[s1] = a;
              Build.installedTalents[s2] = b;
              if (sc > base + 0.001 && (!best || sc > best.score)) {
                best = { c1, c2, score: sc };
              }
            }
          }
          if (!best) continue;
          await Build.swapBuildSlotsWithBackend(rowSlots[best.c1], rowSlots[best.c2]);
          improved = true;
        }
      }

      Build.endSortDomBatch();
      Build.updateHeroStats();
      Build.renderCombatOrderBadges();
      Build.refreshActiveTalentDescription();
      Build.refreshStatFilterHighlightCountDisplay();
      Build.syncCombatModeButtonState();
      if (!skipBackendSync) {
        await Build.syncSortResultToBackend(initialBodySnapshot, initialActiveSnapshot);
        Build.sortSetsWasApplied = true;
      }

    } catch {
      Build.endSortDomBatch(false);
      try {
        await Build.refreshBuildStateFromServer({ refreshInventory: true });
      } catch {}
    } finally {
      if (Build._sortDomBatch) Build.endSortDomBatch();
      Build._sortDeferBackendSync = false;
      Build.sortSetsInProgress = false;
      Build.syncSetSortButtonState();
    }
  }

  static getCombatUnlockedRowsForLevel(level) {
    const lvl = Math.max(1, Number(level) || 1);
    if (lvl >= 20) return 6;
    return Math.max(1, Math.min(6, 1 + Math.floor(lvl / 4)));
  }

  static renderCombatOrderBadges() {
    try {
      Build.fieldView?.querySelectorAll('.build-combat-order-badge').forEach((el) => el.remove());
      Build.fieldView?.querySelectorAll('.build-talent-item.build-combat-learned').forEach((el) => el.classList.remove('build-combat-learned'));
      Build.fieldView?.querySelectorAll('.build-talent-item.build-combat-locked').forEach((el) => el.classList.remove('build-combat-locked'));
      Build.fieldView?.querySelectorAll('.build-talent-item.build-combat-surrounded-blink').forEach((el) =>
        el.classList.remove('build-combat-surrounded-blink'),
      );
    } catch {}
    if (!Build.combatModeEnabled) {
      Build.fieldView?.classList.remove('build-combat-mode-on');
      return;
    }
    Build.fieldView?.classList.add('build-combat-mode-on');
    const unlockedRows = Build.getCombatUnlockedRowsForLevel(Build.getCombatModeHeroLevel());
    const cells = Build.fieldView?.querySelectorAll('.build-hero-grid-item') || [];
    const slotToTalentEl = new Map();
    for (const cell of cells) {
      const talentEl = cell?.querySelector?.('.build-talent-item');
      if (!talentEl) continue;
      const slot = Number(cell?.dataset?.position);
      if (!Number.isFinite(slot)) continue;
      slotToTalentEl.set(slot, talentEl);
      const slotTalent = Build.installedTalents?.[slot];
      const row = Math.max(1, Number(slotTalent?.level) || 1);
      const learnedOrder = Build.combatModeLearnOrderBySlot.get(slot);
      const isLearned = Number.isFinite(learnedOrder);
      if (isLearned) {
        talentEl.classList.add('build-combat-learned');
        const badge = DOM({ style: 'build-combat-order-badge' }, String(learnedOrder));
        talentEl.append(badge);
      } else if (row > unlockedRows) {
        talentEl.classList.add('build-combat-locked');
      }
    }

    // Blink enclosed unlearned talents (4 sides are either walls or already learned talents).
    const GRID_SIZE = 6;
    const learnedSet = Build.combatModeLearnedSlots || new Set();
    for (const [slot, talentEl] of slotToTalentEl.entries()) {
      if (learnedSet.has(slot)) continue;
      const row = Math.floor(slot / GRID_SIZE);
      const col = slot % GRID_SIZE;
      const topBlocked = row === 0 || learnedSet.has(slot - GRID_SIZE);
      const rightBlocked = col === GRID_SIZE - 1 || learnedSet.has(slot + 1);
      const bottomBlocked = row === GRID_SIZE - 1 || learnedSet.has(slot + GRID_SIZE);
      const leftBlocked = col === 0 || learnedSet.has(slot - 1);
      if (topBlocked && rightBlocked && bottomBlocked && leftBlocked) {
        talentEl.classList.add('build-combat-surrounded-blink');
      }
    }
  }

  static getCombatLearnedInstalledTalents() {
    const effective = new Array(36).fill(null);
    for (const slot of Build.combatModeLearnedSlots) {
      if (slot < 0 || slot >= 36) continue;
      effective[slot] = Build.installedTalents?.[slot] || null;
    }
    return effective;
  }

  static getEffectiveInstalledTalents() {
    if (!Build.combatModeEnabled) return Build.installedTalents;
    return Build.getCombatLearnedInstalledTalents();
  }

  static canLearnTalentInCombatMode(slotIndex) {
    if (!Build.combatModeEnabled) return false;
    if (Build.combatModeLearnedSlots.has(slotIndex)) return false;
    const talent = Build.installedTalents?.[slotIndex];
    if (!talent) return false;
    const currentLevel = Build.getCombatModeHeroLevel();
    const unlockedRows = Build.getCombatUnlockedRowsForLevel(currentLevel);
    const talentRow = Math.max(1, Number(talent.level) || 1);
    return talentRow <= unlockedRows;
  }

  static learnCombatTalentAtSlot(slotIndex) {
    if (!Build.canLearnTalentInCombatMode(slotIndex)) return false;
    const order = Build.combatModeLearnOrder.length + 1;
    Build.combatModeLearnOrder.push(slotIndex);
    Build.combatModeLearnedSlots.add(slotIndex);
    Build.combatModeLearnOrderBySlot.set(slotIndex, order);
    return true;
  }

  static rebuildCombatLearnOrderMapsFromOrderArray() {
    Build.combatModeLearnedSlots = new Set(Build.combatModeLearnOrder);
    Build.combatModeLearnOrderBySlot = new Map();
    for (let i = 0; i < Build.combatModeLearnOrder.length; i++) {
      Build.combatModeLearnOrderBySlot.set(Build.combatModeLearnOrder[i], i + 1);
    }
  }

  /**
   * После изменения числа изученных: уровень = длина списка; строки выше допустимой для этого уровня снимаются
   * (с конца порядка изучения среди нарушителей).
   */
  static enforceCombatLearnedRowConstraints() {
    const requirements = [4, 8, 12, 16, 20];
    
    let changed = true;
    while (changed) {
      changed = false;
      
      const talentsByRow = new Map();
      Build.combatModeLearnOrder.forEach(slot => {
        const t = Build.installedTalents?.[slot];
        const row = Math.max(1, Number(t?.level) || 1);
        talentsByRow.set(row, (talentsByRow.get(row) || 0) + 1);
      });
      
      let totalTalents = 0;
      for (let row = 1; row <= 5; row++) {
        totalTalents += talentsByRow.get(row) || 0;
        if (totalTalents < requirements[row - 1]) {
          for (let i = Build.combatModeLearnOrder.length - 1; i > 0; i--) {
            const slot = Build.combatModeLearnOrder[i];
            const t = Build.installedTalents?.[slot];
            const talentRow = Math.max(1, Number(t?.level) || 1);
            if (talentRow === row + 1) {
              Build.combatModeLearnOrder.splice(i, 1);
              Build.rebuildCombatLearnOrderMapsFromOrderArray();
              changed = true;
              break;
            }
          }
          break;
        }
      }
    }
    
    while (Build.combatModeLearnOrder.length > 0) {
      const level = Build.combatModeLearnOrder.length;
      const unlockedRows = Build.getCombatUnlockedRowsForLevel(level);
      let removeIdx = -1;
      for (let j = Build.combatModeLearnOrder.length - 1; j > 0; j--) {
        const slot = Build.combatModeLearnOrder[j];
        const t = Build.installedTalents?.[slot];
        const row = Math.max(1, Number(t?.level) || 1);
        if (row > unlockedRows) {
          removeIdx = j;
          break;
        }
      }
      if (removeIdx < 0) break;
      Build.combatModeLearnOrder.splice(removeIdx, 1);
      Build.rebuildCombatLearnOrderMapsFromOrderArray();
    }
    
    if (Build.combatModeLearnOrder.length === 0) {
      const mainSlot = Build.getCombatMainTalentSlotIndex();
      if (mainSlot >= 0) {
        Build.combatModeLearnOrder = [mainSlot];
        Build.rebuildCombatLearnOrderMapsFromOrderArray();
      }
    }
  }

  /**
   * Оставить только первые keepLastOrder шагов (номера 1…keepLastOrder). 0 — ни одного; пусто → снова только главный классовый талант.
   */
  static rollbackCombatProgressToOrder(keepLastOrder) {
    let keep = Number(keepLastOrder);
    if (!Number.isFinite(keep)) keep = 0;
    keep = Math.max(0, Math.floor(keep));
    const nextOrder = [];
    const nextSet = new Set();
    const nextMap = new Map();
    for (let i = 0; i < Build.combatModeLearnOrder.length; i++) {
      const slot = Build.combatModeLearnOrder[i];
      const ord = i + 1;
      if (ord > keep) break;
      nextOrder.push(slot);
      nextSet.add(slot);
      nextMap.set(slot, ord);
    }
    Build.combatModeLearnOrder = nextOrder;
    Build.combatModeLearnedSlots = nextSet;
    Build.combatModeLearnOrderBySlot = nextMap;
    if (Build.combatModeLearnOrder.length === 0) {
      const mainSlot = Build.getCombatMainTalentSlotIndex();
      if (mainSlot >= 0) {
        Build.combatModeLearnOrder = [mainSlot];
        Build.rebuildCombatLearnOrderMapsFromOrderArray();
      }
    }
    Build.enforceCombatLearnedRowConstraints();
  }

  /** ПКМ по изученному таланту: снять только его, номера следующих −1; затем проверка строк по уровню. */
  static handleCombatTalentContextMenu(talentEl, event) {
    if (Number(talentEl?.dataset?.state) !== 2) return false;
    const slot = Number(talentEl?.parentElement?.dataset?.position);
    if (!Number.isFinite(slot)) return false;

    if (!Build.combatModeEnabled) {
      if (Number(talentEl?.dataset?.active) !== 1) return false;
      if (Build.isFieldIndexAlreadyInActiveBar(slot)) return false;

      const freeIndex = Build.findFirstFreeActiveBarIndex();
      if (freeIndex < 0) return false;

      event?.preventDefault?.();
      event?.stopPropagation?.();

      const position = slot + 1;
      Build.assignActiveSlotLocal(freeIndex, position);

      const targetContainer = Build.activeBarView?.childNodes?.[freeIndex];
      if (targetContainer) {
        const clone = talentEl.cloneNode(true);
        clone.dataset.position = `${slot}`;
        clone.dataset.state = 3;
        clone.style.opacity = 1;
        clone.style.zIndex = 1;
        clone.style.position = 'static';
        Build.move(clone, true);
        targetContainer.append(clone);
      }

      Build.sendBuildMutation({
        optimisticMethod: 'optimisticSetActive',
        legacyMethod: 'setActive',
        data: {
          buildId: Build.id,
          index: freeIndex,
          position: position,
        },
      });
      return true;
    }
    
    const mainSlot = Build.getCombatMainTalentSlotIndex();
    if (slot === mainSlot) return false;
    
    if (!Build.combatModeLearnOrderBySlot.has(slot)) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const idx = Build.combatModeLearnOrder.indexOf(slot);
    if (idx < 0) return true;
    Build.combatModeLearnOrder.splice(idx, 1);
    Build.rebuildCombatLearnOrderMapsFromOrderArray();
    Build.enforceCombatLearnedRowConstraints();
    Build.renderCombatOrderBadges();
    Build.updateHeroStats();
    Build.refreshActiveTalentDescription();
    Build.refreshStatFilterHighlightCountDisplay();
    Build.syncCombatModeButtonState();
    return true;
  }

  static handleCombatTalentClick(element, event) {
    if (!Build.combatModeEnabled) return false;
    if (Number(element?.dataset?.state) !== 2) return false;
    const slot = Number(element?.parentElement?.dataset?.position);
    if (!Number.isFinite(slot)) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const existingOrder = Build.combatModeLearnOrderBySlot.get(slot);
    if (Number.isFinite(existingOrder)) {
      Build.rollbackCombatProgressToOrder(existingOrder - 1);
    } else {
      const learned = Build.learnCombatTalentAtSlot(slot);
      if (!learned) return true;
    }
    Build.renderCombatOrderBadges();
    Build.updateHeroStats();
    Build.refreshActiveTalentDescription();
    Build.refreshStatFilterHighlightCountDisplay();
    Build.syncCombatModeButtonState();
    return true;
  }

  static toggleCombatMode() {
    Build.setCombatMode(!Build.combatModeEnabled);
  }

  static setCombatMode(enabled, { force = false } = {}) {
    const next = !!enabled;
    if (!force && next && !Build.canEnableCombatMode()) {
      Build.syncCombatModeButtonState();
      return;
    }
    if (Build.combatModeEnabled === next) {
      Build.syncCombatModeButtonState();
      return;
    }

    Build.combatModeEnabled = next;
    Build.combatModeLearnOrder = [];
    Build.combatModeLearnOrderBySlot = new Map();
    Build.combatModeLearnedSlots = new Set();

    if (next) {
      const mainSlot = Build.getCombatMainTalentSlotIndex();
      if (mainSlot < 0) {
        Build.combatModeEnabled = false;
      } else {
        Build.combatModeLearnOrder = [mainSlot];
        Build.combatModeLearnedSlots = new Set([mainSlot]);
        Build.combatModeLearnOrderBySlot = new Map([[mainSlot, 1]]);
      }
    }

    Build.renderCombatOrderBadges();
    Build.updateHeroStats();
    Build.refreshActiveTalentDescription();
    Build.refreshStatFilterHighlightCountDisplay();
    Build.syncCombatModeButtonState();
  }

  static list(builds, isWindow) {
    const buildButtonsWrapper = DOM({ style: 'build-list' });

    for (let build of builds) {
      const item = DOM(
        {
          tag: 'button',
          domaudio: domAudioPresets.defaultButton,
          style: ['build-tab-item', 'btn-hover'],
          event: [
            'click',
            () => {
              // Последняя вкладка побеждает: каждый клик стартует инициал,
              // устаревшие гаснет токен-гвардом в Build.init.
              isWindow ? Window.show('main', 'build', Build.heroId, build.id, true) : View.show('build', Build.heroId, build.id);
            },
          ],
        },
        DOM({ style: 'build-tab-label' }, DOM({ tag: 'span' }, `${build.name}`)),
      );
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        Build.buildSelectName('rename', Lang.text('renameBuild'), { id: build.id }, isWindow);
      });

      const div = DOM({ tag: 'div', style: 'button-build--wrapper' }, item);

      if (build.target) {
        item.classList.add('list-highlight');
      } else {
        item.classList.add('list-not-highlight');
      }

      Build.listView.append(div);
    }

    const updateLabel = (tab) => {
      const label = tab.querySelector('.build-tab-label');
      const text = label?.firstElementChild;
      if (!text || !label.clientWidth) return;
      const overflow = Math.max(0, text.scrollWidth - label.clientWidth);
      tab.style.setProperty('--tab-scroll-distance', `${overflow}px`);
      tab.classList.toggle('build-tab--overflowing', overflow > 1);
      tab.title = text.textContent;
    };
    const tabs = Array.from(Build.listView.querySelectorAll('.build-tab-item'));
    if (typeof ResizeObserver !== 'undefined') {
      Build._tabLabelObserver = new ResizeObserver((entries) => {
        for (const entry of entries) updateLabel(entry.target);
      });
      for (const tab of tabs) Build._tabLabelObserver.observe(tab);
    }
    requestAnimationFrame(() => tabs.forEach(updateLabel));

    // Добавляем обработчик колесика мыши после создания списка
    setTimeout(() => {
      const buildList = document.querySelector('.build-list');
      if (buildList) {
        buildList.addEventListener('wheel', function (e) {
          e.preventDefault();
          this.scrollLeft += e.deltaY;

          // Опционально: можно добавить множитель для скорости прокрутки
          // this.scrollLeft += e.deltaY * 2;
        });
      }
    }, 0);

    /*
		setTimeout(_ => {
			if (!document.querySelector('.build-list.list-highlight')) {
				document.querySelector('.build-list').classList.add('list-highlight');
			}
		}, 300);
		*/
  }

  static totalStat(stat, { uncapped = false } = {}) {
    let initialStat = Build.initialStats[stat];
    if (!Number.isFinite(Number(initialStat))) initialStat = 0;
    else initialStat = Number(initialStat);
    let talentsStat = Build.calculationStats[stat];
    if (!Number.isFinite(Number(talentsStat))) talentsStat = 0;
    else talentsStat = Number(talentsStat);
    let powerStat = 0.0;
    if (stat in Build.heroStatsFromPower) {
      powerStat += Build.heroStatsFromPower[stat];
    }
    if (!Number.isFinite(powerStat)) powerStat = 0;
    // speeda — отдельный аддитивный вклад в скорость, суммируется с max-speed.
    if (stat === 'speed') {
      let speedAdd = Build.calculationStats['speeda'];
      if (!Number.isFinite(Number(speedAdd))) speedAdd = 0;
      else speedAdd = Number(speedAdd);
      talentsStat += speedAdd;
    }
    let total = initialStat + talentsStat + powerStat;
    if (stat === 'speedtal' && !uncapped) {
      total = Math.max(0, Math.min(Build.TALENT_COOLDOWN_PCT_MAX, total));
    }
    return total;
  }

  static hero(data) {
    Build.heroStatMods = Build.dataRequest.hero.statModifiers;

    Build.heroPowerModifier = Build.dataRequest.hero.overallModifier;

    Build.heroPowerFromInstalledTalents = 0.0;

    Build.heroMainAttackStat = data.param; // osn_param
    Build.heroAttackModifier = data.koef; // aa_koef

    for (let stat in data.stats) {
      Build.initialStats[stat] = parseFloat(data.stats[stat]);
      Build.calculationStats[stat] = 0.0;
    }
    if (!('speeda' in Build.initialStats)) Build.initialStats['speeda'] = 0;
    if (!('speeda' in Build.calculationStats)) Build.calculationStats['speeda'] = 0;
    // Прямой бонус шанса крита из талантов/сетов.
    if (!('crit' in Build.initialStats)) Build.initialStats['crit'] = 0;
    if (!('crit' in Build.calculationStats)) Build.calculationStats['crit'] = 0;
    Build.initialStats['talentCdPct'] = 0;
    Build.calculationStats['talentCdPct'] = 0;

    let stats = DOM({ style: 'build-hero-stats-view' });

    const template = {
      hp: Lang.text('health'),
      mp: Lang.text('energy'),
      speed: Lang.text('speed'),
      regenhp: Lang.text('statRegenHealth'),
      regenmp: Lang.text('statRegenEnergy'),
      krajahp: Lang.text('statStealHealth'),
      krajamp: Lang.text('statStealEnergy'),
      talentCdPct: Lang.text('statTalentCooldownPct'),
      sila: Lang.text('strength'),
      razum: Lang.text('intelligence'),
      provorstvo: Lang.text('agility'),
      hitrost: Lang.text('dexterity'),
      stoikost: Lang.text('stamina'),
      volia: Lang.text('will'),
      damage: Lang.text('damage'),
      critProb: Lang.text('criticalHit'),
      attackSpeed: Lang.text('attacksPerSecond'),
      punching: Lang.text('penetration'),
      protectionBody: Lang.text('defencePsys'),
      protectionSpirit: Lang.text('defenceMagic'),
    };

    if (!('profile' in Build.dataRequest)) {
      Build.dataRequest.profile = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    }

    let i = 0;

    const cond = (key) =>
      [
        'damage',
        'critProb',
        'attackSpeed',
        'punching',
        'protectionBody',
        'protectionSpirit',
        'considerStacks',
        'considerBuff',
        'groundType',
      ].includes(key);

    for (const key in template) {
      const item = DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          style: 'build-hero-stats-item',
          event: [
            'click',
            !cond(key)
              ? () => {
                  if (item.dataset.active == 1) {
                    item.style.background = 'rgba(0,0,0,0)';

                    if (key == 'hp') {
                      Build.removeSortInventory('stats', 'hp');
                      Build.removeSortInventory('stats', 'hpmp');
                    } else if (key == 'mp') {
                      Build.removeSortInventory('stats', 'mp');
                      Build.removeSortInventory('stats', 'hpmp');
                    } else if (key == 'regenhp') {
                      Build.removeSortInventory('stats', 'regenhp');
                      Build.removeSortInventory('stats', 'regenhpvz');
                    } else if (key == 'regenmp') {
                      Build.removeSortInventory('stats', 'regenmp');
                      Build.removeSortInventory('stats', 'regenmpvz');
                    } else if (key == 'krajahp') {
                      Build.removeSortInventory('stats', 'krajahp');
                      Build.removeSortInventory('stats', 'krajahprz');
                      Build.removeSortInventory('stats', 'krajahpvz');
                    } else if (key == 'krajamp') {
                      Build.removeSortInventory('stats', 'krajamp');
                    } else if (key == 'talentCdPct') {
                      Build.removeSortInventory('stats', 'speedtal');
                      Build.removeSortInventory('stats', 'speedtalrz');
                      Build.removeSortInventory('stats', 'speedtalvz');
                    } else if (key == 'speed') {
                      Build.removeSortInventory('stats', 'speed');
                      Build.removeSortInventory('stats', 'speedrz');
                      Build.removeSortInventory('stats', 'speedvz');
                      Build.removeSortInventory('stats', 'speeda');
                      Build.removeSortInventory('stats', 'speedarz');
                      Build.removeSortInventory('stats', 'speedavz');
                      Build.removeSortInventory('stats', 'speedd');
                      Build.removeSortInventory('stats', 'speeddrz');
                      Build.removeSortInventory('stats', 'speeddvz');
                    } else if (key == 'sila') {
                      Build.removeSortInventory('stats', 'sila');
                      Build.removeSortInventory('stats', 'sr');
                      Build.removeSortInventory('stats', 'srsv');
                      Build.removeSortInventory('stats', 'silarz');
                      Build.removeSortInventory('stats', 'silavz');
                    } else if (key == 'razum') {
                      Build.removeSortInventory('stats', 'razum');
                      Build.removeSortInventory('stats', 'sr');
                      Build.removeSortInventory('stats', 'srsv');
                      Build.removeSortInventory('stats', 'razumrz');
                      Build.removeSortInventory('stats', 'razumvz');
                    } else if (key == 'provorstvo') {
                      Build.removeSortInventory('stats', 'provorstvo');
                      Build.removeSortInventory('stats', 'ph');
                      Build.removeSortInventory('stats', 'provorstvorz');
                      Build.removeSortInventory('stats', 'provorstvovz');
                    } else if (key == 'hitrost') {
                      Build.removeSortInventory('stats', 'hitrost');
                      Build.removeSortInventory('stats', 'ph');
                      Build.removeSortInventory('stats', 'hitrostrz');
                      Build.removeSortInventory('stats', 'hitrostvz');
                    } else if (key == 'stoikost') {
                      Build.removeSortInventory('stats', 'stoikost');
                      Build.removeSortInventory('stats', 'sv');
                      Build.removeSortInventory('stats', 'srsv');
                      Build.removeSortInventory('stats', 'stoikostrz');
                      Build.removeSortInventory('stats', 'svvz');
                      Build.removeSortInventory('stats', 'vs');
                    } else if (key == 'volia') {
                      Build.removeSortInventory('stats', 'volia');
                      Build.removeSortInventory('stats', 'sv');
                      Build.removeSortInventory('stats', 'srsv');
                      Build.removeSortInventory('stats', 'voliarz');
                      Build.removeSortInventory('stats', 'svvz');
                      Build.removeSortInventory('stats', 'vs');
                    }
                    Build.sortInventory();
                    item.dataset.active = 0;
                  } else {
                    item.style.background = '#5899';
                    if (key == 'hp') {
                      Build.setSortInventory('stats', 'hp');
                      Build.setSortInventory('stats', 'hpmp');
                    } else if (key == 'mp') {
                      Build.setSortInventory('stats', 'mp');
                      Build.setSortInventory('stats', 'hpmp');
                    } else if (key == 'regenhp') {
                      Build.setSortInventory('stats', 'regenhp');
                      Build.setSortInventory('stats', 'regenhpvz');
                    } else if (key == 'regenmp') {
                      Build.setSortInventory('stats', 'regenmp');
                      Build.setSortInventory('stats', 'regenmpvz');
                    } else if (key == 'krajahp') {
                      Build.setSortInventory('stats', 'krajahp');
                      Build.setSortInventory('stats', 'krajahprz');
                      Build.setSortInventory('stats', 'krajahpvz');
                    } else if (key == 'krajamp') {
                      Build.setSortInventory('stats', 'krajamp');
                    } else if (key == 'talentCdPct') {
                      Build.setSortInventory('stats', 'speedtal');
                      Build.setSortInventory('stats', 'speedtalrz');
                      Build.setSortInventory('stats', 'speedtalvz');
                    } else if (key == 'speed') {
                      Build.setSortInventory('stats', 'speed');
                      Build.setSortInventory('stats', 'speedrz');
                      Build.setSortInventory('stats', 'speedvz');
                      Build.setSortInventory('stats', 'speeda');
                      Build.setSortInventory('stats', 'speedarz');
                      Build.setSortInventory('stats', 'speedavz');
                      Build.setSortInventory('stats', 'speedd');
                      Build.setSortInventory('stats', 'speeddrz');
                      Build.setSortInventory('stats', 'speeddvz');
                    } else if (key == 'sila') {
                      Build.setSortInventory('stats', 'sila');
                      Build.setSortInventory('stats', 'sr');
                      Build.setSortInventory('stats', 'srsv');
                      Build.setSortInventory('stats', 'silarz');
                      Build.setSortInventory('stats', 'silavz');
                    } else if (key == 'razum') {
                      Build.setSortInventory('stats', 'razum');
                      Build.setSortInventory('stats', 'sr');
                      Build.setSortInventory('stats', 'srsv');
                      Build.setSortInventory('stats', 'razumrz');
                      Build.setSortInventory('stats', 'razumvz');
                    } else if (key == 'provorstvo') {
                      Build.setSortInventory('stats', 'provorstvo');
                      Build.setSortInventory('stats', 'ph');
                      Build.setSortInventory('stats', 'provorstvorz');
                      Build.setSortInventory('stats', 'provorstvovz');
                    } else if (key == 'hitrost') {
                      Build.setSortInventory('stats', 'hitrost');
                      Build.setSortInventory('stats', 'ph');
                      Build.setSortInventory('stats', 'hitrostrz');
                      Build.setSortInventory('stats', 'hitrostvz');
                    } else if (key == 'stoikost') {
                      Build.setSortInventory('stats', 'stoikost');
                      Build.setSortInventory('stats', 'sv');
                      Build.setSortInventory('stats', 'srsv');
                      Build.setSortInventory('stats', 'stoikostrz');
                      Build.setSortInventory('stats', 'svvz');
                      Build.setSortInventory('stats', 'vs');
                    } else if (key == 'volia') {
                      Build.setSortInventory('stats', 'volia');
                      Build.setSortInventory('stats', 'sv');
                      Build.setSortInventory('stats', 'srsv');
                      Build.setSortInventory('stats', 'voliarz');
                      Build.setSortInventory('stats', 'svvz');
                      Build.setSortInventory('stats', 'vs');
                    } else if (key == 'hpmp') {
                      Build.setSortInventory('stats', 'hpmp');
                    } else {
                      Build.setSortInventory('stats', key);
                    }
                    // Build.setSortInventory('stats','hp');

                    Build.sortInventory();
                    item.dataset.active = 1;
                  }
                }
              : null,
          ],
        },
        DOM({ tag: 'div' }, template[key]),
        DOM(
          { tag: 'div' },
          key === 'talentCdPct'
            ? 0
            : key === 'regenhp' || key === 'regenmp'
              ? (() => {
                  const v =
                    data.stats[key] !== undefined && data.stats[key] !== null ? parseFloat(data.stats[key]) : 0;
                  return Build.formatRegenStatDisplay(v);
                })()
              : data.stats[key] !== undefined && data.stats[key] !== null
                ? data.stats[key]
                : 0,
        ),
      );

      if (key === 'groundType') {
        let isMouseOverItem = false;
        let isMouseOverWrapper = false;
        item.classList.add('noNumber');
        if (Build.applyRz || Build.applyVz) {
          item.classList.add('highlight');
        }
        let mouseOutEvent = function () {
          if (isMouseOverWrapper || isMouseOverItem) {
            return;
          }
          let wrapper = item.parentNode.querySelector('.wrapper');
          if (wrapper) {
            wrapper.remove();
          }
        };
        item.onclick = (_) => {
          item.classList.toggle('highlight');
          let wrapper = item.parentNode.querySelector('.wrapper');
          if (Build.applyRz || Build.applyVz) {
            // Disable
            Build.applyRz = false;
            Build.applyVz = false;
            if (wrapper) {
              if (wrapper.querySelector('.home.highlight')) {
              }
              wrapper.querySelector('.home').classList.remove('highlight');
              if (wrapper.querySelector('.enemy.highlight')) {
              }
              wrapper.querySelector('.enemy').classList.remove('highlight');
            }
          } else {
            // Enable home
            Build.applyRz = true;
            Build.applyVz = false;
            if (wrapper) {
              wrapper.querySelector('.home').classList.add('highlight');
              if (wrapper.querySelector('.enemy.highlight')) {
                wrapper.querySelector('.enemy.highlight').classList.remove('highlight');
              }
            }
          }
          Build.updateHeroStats();
        };
        item.onmouseover = (_) => {
          isMouseOverItem = true;
          if (item.parentNode.querySelector('.wrapper')) {
            // Node already here
            return;
          }
          const home = DOM({ style: 'home' }, Lang.text('native'));
          const enemy = DOM({ style: 'enemy' }, Lang.text('enemy'));
          if (Build.applyRz) {
            home.classList.add('highlight');
          } else if (Build.applyVz) {
            enemy.classList.add('highlight');
          }
          home.onclick = (_) => {
            // Remove applicator if already selected
            if (home.classList.contains('highlight')) {
              home.classList.remove('highlight');
              item.classList.remove('highlight');
              Build.applyRz = false;
            } else {
              if (!item.classList.contains('.build-hero-stats-item.highlight')) {
                item.classList.add('highlight');
              }
              home.classList.add('highlight');
              enemy.classList.remove('highlight');
              Build.applyRz = true;
              Build.applyVz = false;
            }
            Build.updateHeroStats();
          };
          enemy.onclick = (_) => {
            // Remove applicator if already selected
            if (enemy.classList.contains('highlight')) {
              enemy.classList.remove('highlight');
              item.classList.remove('highlight');
              Build.applyVz = false;
            } else {
              if (!item.classList.contains('.build-hero-stats-item.highlight')) {
                item.classList.add('highlight');
              }
              enemy.classList.add('highlight');
              home.classList.remove('highlight');
              Build.applyVz = true;
              Build.applyRz = false;
            }
            Build.updateHeroStats();
          };
          const wrapper = DOM({ style: 'wrapper' }, home, enemy);
          wrapper.onmouseover = (_) => {
            isMouseOverWrapper = true;
          };
          wrapper.onmouseout = (_) => {
            isMouseOverWrapper = false;
            setTimeout((_) => {
              mouseOutEvent();
            }, 100);
          };
          item.parentNode.append(wrapper);
        };
        item.onmouseout = (_) => {
          isMouseOverItem = false;
          setTimeout((_) => {
            mouseOutEvent();
          }, 100);
        };
      }

      if (key === 'considerStacks') {
        Build.setUiTooltip(item, Lang.text('gradualTalentsTitle'));
      }
      if (key === 'talentCdPct') {
        item.classList.add('build-cooldown-stat');
        Build.setUiTooltip(item, Lang.text('buildCooldownTooltip'));
      }
      if (key === 'considerBuff') {
        Build.setUiTooltip(item, Lang.text('aoeTalentsTitle'));
      }
      if (key === 'groundType') {
        Build.setUiTooltip(item, Lang.text('territoryTalentsTitle'));
      }

      if (item.dataset.tooltip) {
        const syncStatsTooltipPosition = () => {
          const rect = item.getBoundingClientRect();
          item.style.setProperty('--build-stats-tip-left', `${Math.round(key === 'talentCdPct' ? rect.left : rect.right + 12)}px`);
          item.style.setProperty('--build-stats-tip-top', `${Math.round(key === 'talentCdPct' ? rect.bottom + 6 : rect.top + rect.height / 2 - window.innerHeight * 0.045)}px`);
        };
        item.addEventListener('mouseenter', syncStatsTooltipPosition);
        item.addEventListener('focus', syncStatsTooltipPosition);
      }

      if (key === 'considerStacks' || key === 'considerBuff') {
        item.classList.add('noNumber');
        if (Build.applyStak && key === 'considerStacks') {
          item.classList.add('highlight');
        }
        if (Build.applyBuffs && key === 'considerBuff') {
          item.classList.add('highlight');
        }
        item.onclick = (_) => {
          item.classList.toggle('highlight');
          if (key == 'considerStacks') {
            Build.applyStak = !Build.applyStak;
          } else if (key == 'considerBuff') {
            Build.applyBuffs = !Build.applyBuffs;
          }
          Build.updateHeroStats();
        };
      }

      item.dataset.active = 0;
      if (cond(key)) {
        item.classList.add('passive');
      }

      Build.dataStats[key] = item;

      if (
        ![
          'hp',
          'mp',
          'regenhp',
          'regenmp',
          'krajahp',
          'krajamp',
          'talentCdPct',
          'speed',
          'damage',
          'critProb',
          'attackSpeed',
          'punching',
          'protectionBody',
          'protectionSpirit',
          'considerStacks',
          'considerBuff',
          'groundType',
        ].includes(key)
      ) {
        const daw = DOM({
          tag: 'img',
          domaudio: domAudioPresets.smallButton,
          style: 'build-hero-stats-daw',
          title: Lang.text('makeStatPriorityTitle'),
          event: [
            'click',
            async () => {
              if (daw.dataset.status != 0) {
                await App.api.request('build', 'setProfile', {
                  id: Build.id,
                  index: daw.dataset.index,
                  value: false,
                });

                daw.dataset.status = 0;
                daw.src = 'content/icons/circle.webp';

                Build.profileStats[key] = 0;

                Build.updateHeroStats();
                try {
                  if (Build._statFilterHoverRowKey) {
                    Build.applyStatFilterHoverHighlightOnBuild(Build._statFilterHoverRowKey);
                  } else {
                    Build.refreshStatFilterHighlightCountDisplay();
                  }
                  if (Build._hoveredSetTalentIds) {
                    Build.previewSetTalentsInEmptySlots({ _manualOrder: Build._hoveredSetTalentIds });
                  }
                } catch {}
              } else {
                await App.api.request('build', 'setProfile', {
                  id: Build.id,
                  index: daw.dataset.index,
                  value: true,
                });

                daw.dataset.status = 1;
                daw.src = 'content/icons/checkbox.webp';

                Build.profileStats[key] = 1;

                Build.updateHeroStats();
                try {
                  if (Build._statFilterHoverRowKey) {
                    Build.applyStatFilterHoverHighlightOnBuild(Build._statFilterHoverRowKey);
                  } else {
                    Build.refreshStatFilterHighlightCountDisplay();
                  }
                  if (Build._hoveredSetTalentIds) {
                    Build.previewSetTalentsInEmptySlots({ _manualOrder: Build._hoveredSetTalentIds });
                  }
                } catch {}
              }
            },
          ],
        });

        const profileIdx =
          key in Build.heroStatProfileIndex ? Build.heroStatProfileIndex[key] : i;
        daw.dataset.index = profileIdx;

        const prof = Build.dataRequest.profile;
        daw.dataset.status =
          prof && profileIdx in prof && prof[profileIdx] !== undefined && prof[profileIdx] !== null
            ? prof[profileIdx]
            : 0;

        Build.profileStats[key] = parseInt(daw.dataset.status, 10) || 0;

        if (daw.dataset.status == 1) {
          daw.src = 'content/icons/checkbox.webp';
        } else {
          daw.src = 'content/icons/circle.webp';
        }

        const statsLineWithDaw = DOM({ style: 'build-hero-stats-line' }, daw, item);
        if (!cond(key)) {
          statsLineWithDaw.addEventListener('mouseenter', () => Build.applyStatFilterHoverHighlightOnBuild(key));
          statsLineWithDaw.addEventListener('mouseleave', () => Build.clearStatFilterHoverHighlightOnBuild());
        }
        stats.append(statsLineWithDaw);
      } else {
        const statsLinePlain = DOM({ style: 'build-hero-stats-line' }, item);
        if (!cond(key)) {
          statsLinePlain.addEventListener('mouseenter', () => Build.applyStatFilterHoverHighlightOnBuild(key));
          statsLinePlain.addEventListener('mouseleave', () => Build.clearStatFilterHoverHighlightOnBuild());
        }
        stats.append(statsLinePlain);
      }
      i++;
    }

    let landTypeSettingWrap = null;
    let landTypeSetting = DOM({
      domaudio: domAudioPresets.defaultButton,
      style: ['build-hero-stats-setting-land-type', 'button-outline', 'build-hero-stats-setting-land-type-rz'],
      event: [
        'click',
        async () => {
          Build.applyRz = !Build.applyRz;
          Build.applyVz = !Build.applyVz;
          Build.updateHeroStats();
          if (Build.applyRz) {
            landTypeSetting.classList.replace('build-hero-stats-setting-land-type-vz', 'build-hero-stats-setting-land-type-rz');
            Build.setUiTooltip(landTypeSettingWrap, Lang.text('titleLandTipeRZ'));
          } else {
            landTypeSetting.classList.replace('build-hero-stats-setting-land-type-rz', 'build-hero-stats-setting-land-type-vz');
            Build.setUiTooltip(landTypeSettingWrap, Lang.text('titleLandTipeVZ'));
          }
        },
      ],
    });
    landTypeSetting.removeAttribute('title');

    landTypeSettingWrap = DOM({ style: 'build-hero-stats-settings' }, landTypeSetting);
    Build.setUiTooltip(landTypeSettingWrap, Lang.text('titleLandTipeRZ'));
    const syncLandTypeTooltipPosition = () => {
      const rect = landTypeSettingWrap.getBoundingClientRect();
      landTypeSettingWrap.style.setProperty('--build-land-tip-left', `${Math.round(rect.left + rect.width / 2)}px`);
      landTypeSettingWrap.style.setProperty('--build-land-tip-top', `${Math.round(rect.top - 12)}px`);
    };
    landTypeSettingWrap.addEventListener('mouseenter', syncLandTypeTooltipPosition);
    landTypeSettingWrap.addEventListener('focus', syncLandTypeTooltipPosition);
    Build.rarityView.querySelector('.build-hero-stats-settings')?.remove();
    Build.rarityView.append(landTypeSettingWrap);

    const statFilterHighlightCountValue = DOM({
      tag: 'span',
      style: 'build-hero-stats-highlight-count-value',
    });
    statFilterHighlightCountValue.textContent = '0';
    const statFilterHighlightCountBadge = DOM(
      { style: 'build-hero-stats-highlight-count-badge' },
      statFilterHighlightCountValue,
    );
    const statFilterHighlightCountEl = DOM({ style: 'build-hero-stats-highlight-count' }, statFilterHighlightCountBadge);
    const statFilterHighlightCountTitle = Lang.text('buildStatsHighlightedTalentsCountTitle');
    statFilterHighlightCountEl.dataset.tooltip = statFilterHighlightCountTitle;
    stats.append(statFilterHighlightCountEl);
    Build.statFilterHighlightCountValueEl = statFilterHighlightCountValue;
    Build.statFilterHighlightCountWrapEl = statFilterHighlightCountEl;
    Build.refreshStatFilterHighlightCountDisplay();

    Build.heroName = DOM({ tag: 'div', style: 'name' });

    if (MM.hero) {
      const hero = MM.hero.find((h) => h.id === data.id);
      Build.setHeroName(Build.heroName, Lang.heroName(hero.id, hero.skin || 1));
    }

    Build.heroImg = DOM({ style: 'avatar' });

    if (App.isAdmin()) {
      Build.heroImg.oncontextmenu = async () => {
        let body = document.createDocumentFragment(),
          request = await App.api.request('build', 'heroData', { id: data.id });

        for (let key in request) {
          body.append(
            App.input(
              (value) => {
                let object = new Object();

                object[key] = value;

                App.api.request('build', 'heroEdit', {
                  id: data.id,
                  object: object,
                });
              },
              { value: request[key] },
            ),
          );
        }

        body.append(
          DOM(
            {
              domaudio: domAudioPresets.bigButton,
              style: 'splash-content-button',
              event: ['click', () => Splash.hide()],
            },
            Lang.text('titleClose'),
          ),
        );

        Splash.show(body);
      };
    }

    Build.heroImg.onclick = () => {
      Window.show('main', 'top', data.id, 0);
	  closeTip();
    };

    Build.applyBuildHeroAvatarSkin(data.id, Build.dataRequest.hero.skin.target ? Build.dataRequest.hero.skin.target : 1);

    let rankIcon = DOM({ style: 'rank-icon' });
    rankIcon.style.backgroundImage = `url("content/ranks/${Rank.icon(data.rating)}.webp"), url("content/ranks/rateIconBack.png")`;
    rankIcon.style.backgroundSize = '70%, 100%';
    rankIcon.style.backgroundPosition = 'center, center';
    rankIcon.style.backgroundRepeat = 'no-repeat, no-repeat';

    let rank = DOM({ style: 'rank' }, rankIcon);
    // рамка по победам на герое (wins/frameType из build.heroAll), под плашкой ранга
    Build.heroImg.append(HeroFrame.createNode(HeroFrame.fromHeroList(MM.hero, data.id)), rank);

    try {
      Build._avatarTipEl?.parentNode?.removeChild?.(Build._avatarTipEl);
    } catch {}
    Build._avatarTipEl = null;
    try {
      document.querySelectorAll('.build-avatar-tip').forEach((el) => el.remove());
    } catch {}

    const avatarTip = DOM({ style: 'build-avatar-tip' }, DOM({ style: 'tip-title' }, Lang.text('tipTitle')), DOM({ style: 'tip-body' }, Lang.text('tipBody')));
    Build._avatarTipEl = avatarTip;
    document.body.append(avatarTip);

    
    function placeAvatarTip() {
      const r = Build.heroImg.getBoundingClientRect();
      const gap = 12;

      let left = r.right + gap;
      let top = r.top + r.height / 2;

      const tipRect = avatarTip.getBoundingClientRect();

      top = top - tipRect.height / 2;

      const pad = 10;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (left + tipRect.width > vw - pad) {
        left = r.left - gap - tipRect.width;
      }

      left = Math.max(pad, Math.min(left, vw - tipRect.width - pad));

      top = Math.max(pad, Math.min(top, vh - tipRect.height - pad));

      avatarTip.style.left = `${Math.round(left)}px`;
      avatarTip.style.top = `${Math.round(top)}px`;
    }

    let tipOpen = false;

    function openTip() {
      if (tipOpen) return;
      tipOpen = true;

      avatarTip.classList.add('is-open');
      requestAnimationFrame(() => {
        placeAvatarTip();
      });
    }

    function closeTip() {
      if (!tipOpen) return;
      tipOpen = false;
      avatarTip.classList.remove('is-open');
    }

    Build.heroImg.addEventListener('mouseenter', openTip);
    Build.heroImg.addEventListener('mouseleave', closeTip);

    function onViewportChange() {
      if (!tipOpen) return;
      placeAvatarTip();
    }
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);

    const oldCleanup = Build.cleanup;
    Build.cleanup = function () {
      try {
        window.removeEventListener('scroll', onViewportChange, true);
        window.removeEventListener('resize', onViewportChange);
        if (avatarTip && avatarTip.parentNode) avatarTip.remove();
        if (Build._avatarTipEl === avatarTip) Build._avatarTipEl = null;
      } catch (e) {}
      if (typeof oldCleanup === 'function') oldCleanup.call(Build);
    };

    const avatarWrap = DOM({ style: 'build-avatar-wrap' }, Build.heroImg);

    const navPrev = DOM({
      style: ['build-hero-nav-btn', 'build-hero-nav-btn-left'],
      domaudio: domAudioPresets.defaultButton,
      event: [
        'click',
        async () => {
          await Build.switchHeroFromCastleBottomList(-1);
        },
      ],
    });
    navPrev.style.backgroundImage = 'url("content/img/goLeft.png")';

    const navNext = DOM({
      style: ['build-hero-nav-btn', 'build-hero-nav-btn-right'],
      domaudio: domAudioPresets.defaultButton,
      event: [
        'click',
        async () => {
          await Build.switchHeroFromCastleBottomList(1);
        },
      ],
    });
    navNext.style.backgroundImage = 'url("content/img/goRight.png")';

    const avatarActions = DOM({ style: 'build-hero-avatar-actions' }, Build.skinView, Build.training);
    const wrapper = DOM({ style: 'build-hero-avatar-and-name' }, avatarWrap, Build.heroName);
    const heroNav = DOM({ style: 'build-hero-nav-controls' }, navPrev, navNext);

    const heroRating = DOM({ style: 'build-hero-rating' }, `${Lang.text('buildHeroRating')}: ${data.rating}`);
    Build.heroView.append(wrapper, heroRating, stats, heroNav, avatarActions);
  }

  static getHeroIdsFromCastleBottomList() {
    const ids = [];
    const seen = new Set();
    try {
      const nodes = View.castleBottom?.querySelectorAll?.('.castle-hero-item');
      for (const node of nodes || []) {
        let heroId = Number(node?.dataset?.heroId);
        if (!Number.isFinite(heroId) || heroId <= 0) {
          const m = String(node?.id || '').match(/^id(\d+)$/);
          heroId = m ? Number(m[1]) : NaN;
        }
        if (!Number.isFinite(heroId) || heroId <= 0 || seen.has(heroId)) continue;
        seen.add(heroId);
        ids.push(heroId);
      }
    } catch {}
    return ids;
  }

  static async switchHeroFromCastleBottomList(direction = 1, waitForBuildWindowRender = true, cancelOnSplashOpen = false) {
    if (Splash.body && getComputedStyle(Splash.body).display !== 'none') return;
    const ids = Build.getHeroIdsFromCastleBottomList();
    if (!ids.length) return;
    const dir = Number(direction) < 0 ? -1 : 1;
    const highlightedHeroId = Number(View.castleOpenedBuildHeroId);
    const buildHeroId = Number(Build.heroId);
    const currentHeroId = Number.isFinite(highlightedHeroId) && highlightedHeroId > 0 ? highlightedHeroId : buildHeroId;
    let index = ids.indexOf(currentHeroId);
    if (index < 0) index = 0;
    const nextHeroId = ids[(index + dir + ids.length) % ids.length];
    if (!Number.isFinite(nextHeroId) || nextHeroId <= 0 || nextHeroId === currentHeroId) return;

    try {
      View.setCastleOpenedBuildHero?.(nextHeroId);
      View.scrollCastleBottomToHero?.(nextHeroId);
    } catch {}

    const isWindowBuild = Window.windows?.main?.id === 'wbuild';
    if (isWindowBuild) {
      const showPromise = Window.show('main', 'build', nextHeroId, 0, true);
      if (waitForBuildWindowRender) {
        await showPromise;
      } else {
        showPromise.catch(() => {});
      }
      if (cancelOnSplashOpen && Splash.body && getComputedStyle(Splash.body).display !== 'none') {
        try {
          View.setCastleOpenedBuildHero?.(currentHeroId);
          View.scrollCastleBottomToHero?.(currentHeroId);
        } catch {}
        const rollbackPromise = Window.show('main', 'build', currentHeroId, 0, true);
        if (waitForBuildWindowRender) {
          await rollbackPromise;
        } else {
          rollbackPromise.catch(() => {});
        }
        return;
      }
      try {
        View.scrollCastleBottomToHero?.(nextHeroId);
      } catch {}
      return;
    }
    await View.show('build', nextHeroId);
  }

  /** Одна десятичная, без «.0» у целых (реген HP/MP). */
  static formatRegenStatDisplay(value) {
    const r = Math.round(Number(value) * 10) / 10;
    const s = r.toFixed(1);
    return s.endsWith('.0') ? String(Math.round(r)) : s;
  }

  /** Пересчёт вкладов талантов в calculationStats / силу героя (без обновления подписей в UI). */
  static recomputeTalentCalculationTotals() {
    const effectiveInstalledTalents = Build.getEffectiveInstalledTalents() || [];
    Build.heroPower = 0.0;
    for (let key in Build.calculationStats) {
      Build.calculationStats[key] = 0.0;
    }
    if (Build.combatModeEnabled) {
      // В боевом режиме важен порядок изучения: таланты вида "к наибольшему"
      // должны опираться на текущие статы на момент изучения.
      for (const slot of Build.combatModeLearnOrder || []) {
        const idx = Number(slot);
        if (!Number.isFinite(idx) || idx < 0 || idx >= 36) continue;
        const talent = effectiveInstalledTalents[idx];
        if (!talent) continue;
        Build.setStat(talent, true, false);
      }
    } else {
      for (let i = 35; i >= 0; i--) {
        let talent = effectiveInstalledTalents[i];
        if (talent) {
          Build.calcStatsFromPower(i, effectiveInstalledTalents);
          Build.setStat(talent, true, false);
        }
      }
    }

    // Итоговая мощь: последний calcStatsFromPower(i) шёл до setStat слота i — в heroPower не хватало этого таланта.
    // Пересчитываем один раз при полном Build.heroPower, как в боевом режиме при полной сумме мощи.
    if (!Build.combatModeEnabled) {
      Build.calcStatsFromPower(0, effectiveInstalledTalents);
    }

    Build.applySetAddStatsForInstalledTalents(effectiveInstalledTalents);
    if (Build.combatModeEnabled) {
      Build.applyCombatModeHeroStatsFromPower();
    }
  }

  /** Мощь таланта по редкости/заточке (как в setStat). */
  static getTalentRarityPowerContribution(talent) {
    if (!talent) return 0;
    const talentPowerByRarity = {
      4: Build.talentPowerByRarityFirstLevel[4] + Build.talentPowerByRarityPerLevel[4] * (Build.talentRefineByRarity[4] - 1),
      3: Build.talentPowerByRarityFirstLevel[3] + Build.talentPowerByRarityPerLevel[3] * (Build.talentRefineByRarity[3] - 1),
      2: Build.talentPowerByRarityFirstLevel[2] + Build.talentPowerByRarityPerLevel[2] * (Build.talentRefineByRarity[2] - 1),
      1: Build.talentPowerByRarityFirstLevel[1] + Build.talentPowerByRarityPerLevel[1] * (Build.talentRefineByRarity[1] - 1),
      0: Build.talentPowerByRarityFirstLevel[0] + Build.talentPowerByRarityPerLevel[0] * (Build.talentRefineByRarity[4] - 1),
    };
    return 'rarity' in talent ? talentPowerByRarity[talent.rarity] : talentPowerByRarity[0];
  }

  /**
   * Боевой режим: вклад мощи в статы героя.
   * Сначала по полному билду считаются heroPowerFull и сумма весов строк (позиция на сетке),
   * от m = heroPowerFull * sumWeightFull получаем «чистый» стат от мощи (как раньше по формуле),
   * затем к базе идут только доли: statPowerFull * вес_строки_таланта для каждого изученного таланта (уровень строки = talent.level).
   */
  static applyCombatModeHeroStatsFromPower() {
    const w = Build.TALENT_POWER_LINE_WEIGHTS;
    const full = Build.installedTalents || [];
    let heroPowerFull = 0;
    let sumWeightFull = 0;
    for (let i = 35; i >= 0; i--) {
      const t = full[i];
      if (!t) continue;
      heroPowerFull += Build.getTalentRarityPowerContribution(t);
      const gridLine = Math.floor((35 - i) / 6);
      const wl = w[gridLine];
      if (Number.isFinite(wl)) sumWeightFull += wl;
    }
    const mFull = heroPowerFull * sumWeightFull;
    const q = Build.heroPowerModifier;
    let sumLearnedLineWeights = 0;
    for (const slot of Build.combatModeLearnedSlots) {
      const t = full[slot];
      if (!t) continue;
      const rowIdx = Math.max(0, Math.min(5, (Number(t.level) || 1) - 1));
      const wl = w[rowIdx];
      if (Number.isFinite(wl)) sumLearnedLineWeights += wl;
    }
    for (let stat in Build.heroStatsFromPower) {
      let Lvl = Number(Build.heroStatMods[stat]);
      if (!Number.isFinite(Lvl)) Lvl = 0;
      const statPowerFull = Lvl * (0.6 * q * (mFull / 10.0 - 16.0) + 36.0);
      Build.heroStatsFromPower[stat] = statPowerFull * sumLearnedLineWeights;
    }
  }

  static normalizeSetAddStatsRules(addStats) {
    const normalized = [];
    const pushRule = (needRaw, stats) => {
      const need = Number(needRaw);
      if (!Number.isFinite(need) || need <= 0 || !stats || typeof stats !== 'object' || Array.isArray(stats)) return;
      normalized.push({ need, stats });
    };

    if (Array.isArray(addStats)) {
      for (const entry of addStats) {
        if (Array.isArray(entry) && entry.length >= 2) {
          pushRule(entry[0], entry[1]);
          continue;
        }
        if (!entry || typeof entry !== 'object') continue;
        if ('need' in entry && 'stats' in entry) {
          pushRule(entry.need, entry.stats);
          continue;
        }
        for (const [k, v] of Object.entries(entry)) {
          pushRule(k, v);
        }
      }
    } else if (addStats && typeof addStats === 'object') {
      for (const [k, v] of Object.entries(addStats)) {
        pushRule(k, v);
      }
    }

    normalized.sort((a, b) => a.need - b.need);
    return normalized;
  }

  static normalizeSetTalentCooldownRules(rawRules) {
    const normalized = [];
    if (!rawRules || typeof rawRules !== 'object' || Array.isArray(rawRules)) return normalized;

    const normalizeDeltaValue = (deltaRaw) => {
      let deltaSeconds = NaN;
      if (Array.isArray(deltaRaw) && deltaRaw.length > 0) {
        deltaSeconds = Number(deltaRaw[0]);
      } else {
        deltaSeconds = Number(deltaRaw);
      }
      if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0) return null;
      return deltaSeconds;
    };
    const parseSetCountRules = (rulesRaw) => {
      const setCountRules = [];
      if (!rulesRaw || typeof rulesRaw !== 'object' || Array.isArray(rulesRaw)) return setCountRules;
      for (const [needRaw, deltaRaw] of Object.entries(rulesRaw)) {
        const need = Number(needRaw);
        if (!Number.isFinite(need) || need <= 0) continue;
        const deltaSeconds = normalizeDeltaValue(deltaRaw);
        if (deltaSeconds == null) continue;
        setCountRules.push({ need, deltaSeconds });
      }
      setCountRules.sort((a, b) => a.need - b.need);
      return setCountRules;
    };

    for (const [targetRaw, sourceMapRaw] of Object.entries(rawRules)) {
      const targetTalentId = Math.abs(Number(targetRaw));
      if (!Number.isFinite(targetTalentId) || targetTalentId <= 0) continue;
      if (!sourceMapRaw || typeof sourceMapRaw !== 'object' || Array.isArray(sourceMapRaw)) continue;

      const sourceRules = [];
      let setCountRules = [];
      for (const [sourceRaw, deltaRaw] of Object.entries(sourceMapRaw)) {
        // Optional rule by total installed set talents count (including target talent):
        // cdMods: { [targetId]: { bySetCount: { 2: [-1], 4: [-2] } } }
        if (
          sourceRaw === 'bySetCount' ||
          sourceRaw === 'setCount' ||
          sourceRaw === 'count' ||
          sourceRaw === 'need'
        ) {
          setCountRules = parseSetCountRules(deltaRaw);
          continue;
        }

        const sourceTalentId = Math.abs(Number(sourceRaw));
        if (!Number.isFinite(sourceTalentId) || sourceTalentId <= 0) continue;
        const deltaSeconds = normalizeDeltaValue(deltaRaw);
        if (deltaSeconds == null) continue;
        sourceRules.push({ sourceTalentId, deltaSeconds });
      }
      if (sourceRules.length || setCountRules.length) normalized.push({ targetTalentId, sourceRules, setCountRules });
    }

    return normalized;
  }

  static getSetTalentCooldownDeltaSeconds(targetTalentId, installedTalents = Build.getEffectiveInstalledTalents()) {
    const target = Math.abs(Number(targetTalentId));
    if (!Number.isFinite(target) || target <= 0) return 0;

    const installedIds = new Set();
    for (const talent of installedTalents || []) {
      const tid = Math.abs(Number(talent?.id));
      if (Number.isFinite(tid) && tid > 0) installedIds.add(tid);
    }
    if (!installedIds.size) return 0;

    let deltaTotal = 0;
    const sets = TalentSets.list();
    for (const set of sets) {
      const setIds = TalentSets.getTalentIds(set)
        .map((id) => Math.abs(Number(id)))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (!setIds.length) continue;

      let count = 0;
      for (const id of setIds) {
        if (installedIds.has(id)) count++;
      }
      if (count <= 0) continue;

      const requiredMain = Math.abs(Number(set?.mainNeed));
      if (Number.isFinite(requiredMain) && requiredMain > 0 && !installedIds.has(requiredMain)) continue;

      const rules = Build.normalizeSetTalentCooldownRules(set?.cdMods);
      for (const rule of rules) {
        if (rule.targetTalentId !== target) continue;
        const setCountRules = Array.isArray(rule.setCountRules) ? rule.setCountRules : [];
        for (const countRule of setCountRules) {
          if (count >= countRule.need) deltaTotal += countRule.deltaSeconds;
        }
        for (const sourceRule of rule.sourceRules) {
          if (!installedIds.has(sourceRule.sourceTalentId)) continue;
          deltaTotal += sourceRule.deltaSeconds;
        }
      }
    }

    return deltaTotal;
  }

  static resolveCompositeStatAlias(statKey) {
    if (statKey === 'critProb') return 'crit';
    if (statKey === 'sr') return Build.getMaxStat(['sila', 'razum']);
    if (statKey === 'ph') return Build.getMaxStat(['provorstvo', 'hitrost']);
    if (statKey === 'sv') return Build.getMaxStat(['stoikost', 'volia']);
    if (statKey === 'srsv') return Build.getMaxStat(['sila', 'razum', 'stoikost', 'volia']);
    if (statKey === 'hpmp') return Build.getMaxStat(['hp', 'mp']);
    if (statKey === 'srMin') return Build.getMinStat(['sila', 'razum']);
    if (statKey === 'phMin') return Build.getMinStat(['provorstvo', 'hitrost']);
    if (statKey === 'svMin') return Build.getMinStat(['volia', 'stoikost']);
    if (statKey === 'srsvMin') return Build.getMinStat(['sila', 'razum', 'stoikost', 'volia']);
    if (statKey === 'hpmpMin') return Build.getMinStat(['hp', 'mp']);
    return statKey;
  }

  static applyCalculatedStatDelta(calcKey, statChange) {
    calcKey = Build.remapTalentStatKeyForHeroResource(calcKey);
    if (!calcKey) return;
    if (!(calcKey in Build.calculationStats)) return;
    if (calcKey === 'speed') {
      Build.calculationStats[calcKey] = Math.max(Build.calculationStats[calcKey], statChange);
      return;
    }
    Build.calculationStats[calcKey] += statChange;
  }

  static heroHasZeroBaseEnergy() {
    const baseMp = Number(Build.initialStats?.mp);
    return Number.isFinite(baseMp) && Math.abs(baseMp) < 1e-9;
  }

  static remapTalentStatKeyForHeroResource(statKey) {
    if (!statKey) return statKey;
    if (!Build.heroHasZeroBaseEnergy()) return statKey;
    if (statKey === 'mp') return null;
    if (statKey === 'regenmp') return 'regenhp';
    if (statKey === 'regenmpvz') return 'regenhpvz';
    return statKey;
  }

  static resolveConditionalStatKey(rawKey) {
    if (Build.applyStak && rawKey.indexOf('stak') !== -1) return rawKey.replace('stak', '');
    if (Build.applyRz && rawKey.indexOf('rz') !== -1) return rawKey.replace('rz', '');
    if (Build.applyVz && rawKey.indexOf('vz') !== -1) return rawKey.replace('vz', '');
    if (rawKey.indexOf('dop') !== -1) return rawKey.replace('dop', '');
    if (Build.applyBuffs && rawKey.indexOf('buff') !== -1) return rawKey.replace('buff', '');
    return rawKey;
  }

  static applySetStatMap(statsMap) {
    if (!statsMap || typeof statsMap !== 'object') return;
    const resolved = new Object();
    for (const [rawKey, rawValue] of Object.entries(statsMap)) {
      const val = Number(rawValue);
      if (!Number.isFinite(val)) continue;
      const targetKey = Build.resolveCompositeStatAlias(rawKey);
      if (!targetKey) continue;
      resolved[targetKey] = (resolved[targetKey] || 0) + val;
    }

    for (const [key2, statChange] of Object.entries(resolved)) {
      Build.applyCalculatedStatDelta(Build.resolveConditionalStatKey(key2), statChange);
    }
  }

  static findInstalledTalentById(installedTalents, talentId) {
    const wanted = Math.abs(Number(talentId));
    if (!Number.isFinite(wanted) || wanted <= 0) return null;
    for (const talent of installedTalents || []) {
      const tid = Math.abs(Number(talent?.id));
      if (Number.isFinite(tid) && tid === wanted) return talent;
    }
    return null;
  }

  static getResolvedTalentStatValue(talent, targetKey) {
    if (!talent || !talent.stats || typeof talent.stats !== 'object') return 0;
    let maxValue = -Infinity;
    let sumValue = 0;
    let hasAny = false;

    for (const key in talent.stats) {
      let statValue = parseFloat(talent.stats[key]);
      if (!Number.isFinite(statValue)) continue;
      if ('statsRefine' in talent && 'rarity' in talent) {
        let refineBonus = Build.getTalentRefineByRarity(talent.rarity);
        let refineMul = parseFloat(talent.statsRefine[key]);
        if (Number.isFinite(refineMul)) statValue += refineBonus * refineMul;
      }

      const resolvedKey = Build.resolveConditionalStatKey(key);
      if (resolvedKey !== targetKey) continue;
      hasAny = true;
      if (targetKey === 'speed') {
        if (statValue > maxValue) maxValue = statValue;
      } else {
        sumValue += statValue;
      }
    }

    if (!hasAny) return 0;
    if (targetKey === 'speed') return Number.isFinite(maxValue) ? maxValue : 0;
    return Number.isFinite(sumValue) ? sumValue : 0;
  }

  static applySetAddStatsForInstalledTalents(installedTalents) {
    const installedIds = new Set();
    for (const talent of installedTalents || []) {
      const tid = Number(talent?.id);
      if (Number.isFinite(tid) && tid !== 0) installedIds.add(tid);
    }
    if (!installedIds.size) return;

    const mainTalentSpeedBonusById = new Map();
    const sets = TalentSets.list();
    for (const set of sets) {
      const setIds = TalentSets.getTalentIds(set)
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id !== 0);
      if (!setIds.length) continue;

      let count = 0;
      for (const id of setIds) {
        if (installedIds.has(id)) count++;
      }
      if (count <= 0) continue;

      const requiredMain = Number(set?.mainNeed);
      if (Number.isFinite(requiredMain) && requiredMain !== 0 && !installedIds.has(requiredMain)) {
        continue;
      }

      const rules = Build.normalizeSetAddStatsRules(set?.addStats);
      for (const rule of rules) {
        if (count >= rule.need) {
          const map = rule.stats && typeof rule.stats === 'object' ? { ...rule.stats } : null;
          if (!map) continue;

          for (const rawKey of Object.keys(map)) {
            const resolvedKey = Build.resolveConditionalStatKey(rawKey);
            if (resolvedKey !== 'speedd') continue;
            const speedDeltaResolved = Number(map[rawKey]);
            if (!Number.isFinite(speedDeltaResolved) || speedDeltaResolved === 0) {
              delete map[rawKey];
              continue;
            }
            let mainId = Number(set?.mainNeed);
            if (!Number.isFinite(mainId) || mainId <= 0) {
              mainId = Number(TalentSets.chooseMainTalentId(set));
            }
            if (Number.isFinite(mainId) && mainId !== 0 && installedIds.has(mainId)) {
              const prev = Number(mainTalentSpeedBonusById.get(mainId)) || 0;
              mainTalentSpeedBonusById.set(mainId, prev + speedDeltaResolved);
            }
            delete map[rawKey];
          }

          Build.applySetStatMap(map);
        }
      }
    }

    for (const [mainId, bonus] of mainTalentSpeedBonusById.entries()) {
      const mainTalent = Build.findInstalledTalentById(installedTalents, mainId);
      if (!mainTalent) continue;
      const baseMainSpeed = Build.getResolvedTalentStatValue(mainTalent, 'speed');
      Build.applyCalculatedStatDelta('speed', baseMainSpeed + bonus);
    }
  }

  static updateHeroStats() {
    Build.recomputeTalentCalculationTotals();

    for (let key2 in Build.dataStats) {
      if (key2 === 'talentCdPct') continue;
      let total = Build.totalStat(key2);
      if (key2 === 'regenhp' || key2 === 'regenmp') {
        if (key2 === 'regenhp') {
          total += Build.totalStat('hp') * Build.REGEN_HP_FROM_MAX_HP_PCT;
        } else {
          total += Build.totalStat('mp') * Build.REGEN_MP_FROM_MAX_MP_PCT;
        }
        Build.dataStats[key2].lastChild.innerText = Build.formatRegenStatDisplay(total);
      } else {
        Build.dataStats[key2].lastChild.innerText = Math.round(total);
      }
    }
    if (Build.dataStats['talentCdPct']) {
      const cdPct = Math.max(0, Math.round(Build.totalStat('speedtal')));
      // Сверх лимита — в скобках фактическая сумма: «-30% (-42%)».
      const rawCdPct = Math.max(0, Math.round(Build.totalStat('speedtal', { uncapped: true })));
      let cdText = cdPct === 0 ? '0%' : `-${cdPct}%`;
      if (rawCdPct > cdPct) cdText += ` (-${rawCdPct}%)`;
      Build.dataStats['talentCdPct'].lastChild.innerText = cdText;
      // Подсказка: что такое значение и что в скобках.
      const maxCd = String(Build.TALENT_COOLDOWN_PCT_MAX);
      const cooldownLimitTooltip =
        rawCdPct > cdPct
          ? Lang.text('statTalentCooldownPctTipOver').replace('{max}', maxCd).replace('{raw}', String(rawCdPct))
          : Lang.text('statTalentCooldownPctTipMax').replace('{max}', maxCd);
      Build.setUiTooltip(Build.dataStats['talentCdPct'], `${cooldownLimitTooltip}\n\n${Lang.text('buildCooldownTooltip')}`);
    }

    const statAg = Build.totalStat('provorstvo');
    const statCun = Build.totalStat('hitrost');
    const statStamina = Build.totalStat('stoikost');
    const statWill = Build.totalStat('volia');
    const statStrength = Build.totalStat('sila');
    const statInt = Build.totalStat('razum');

    {
      // TODO: make hero damage calculation
      let damage = Build.heroMainAttackStat == 1 ? statStrength : statInt;
      let dmgMin = Math.round(damage * Build.heroAttackModifier * 0.9);
      let dmgMax = Math.round(damage * Build.heroAttackModifier * 1.1);
      let dmgTag = Build.heroMainAttackStat == 1 ? '<fiz> </fiz>' : '<mag> </mag>';
      Build.dataStats['damage'].lastChild.innerHTML = dmgMin + '-' + dmgMax + dmgTag;
    }

    {
      let penetration = 0.0;
      if (statAg > 500.0) {
        penetration += 61.72 + 0.6876 * statAg - 10.035 * Math.sqrt(statAg);
      } else {
        penetration += 48.45 + 0.764 * statAg - 11.15 * Math.sqrt(statAg);
      }
      if (statCun > 500.0) {
        penetration += 85.78 + 0.43 * statCun - 15.55 * Math.log(statCun);
      } else {
        penetration += 59.83 + 0.57 * statCun - 20.73 * Math.log(statCun);
      }
      Build.dataStats['punching'].lastChild.innerText = Math.round(penetration) + '%';
    }

    {
      let defStamina = 0.5355 * (statStamina + 0.15 * statWill) - 20;
      let defWill = 0.5355 * (statWill + 0.15 * statStamina) - 20;

      Build.dataStats['protectionBody'].lastChild.innerText = Math.round(defStamina) + '%';
      Build.dataStats['protectionSpirit'].lastChild.innerText = Math.round(defWill) + '%';
    }

    {
      let crit = 62.765 - 11534.0 / (126.04 + statCun);
      crit += Build.getTalentDirectCalculationValue('crit');
      Build.dataStats['critProb'].lastChild.innerText = Math.max(0.0, Math.round(crit)) + '%';
    }

    {
      let attackSpeed = Math.min(2.0, 0.00364 * statAg + 0.49);
      Build.dataStats['attackSpeed'].lastChild.innerText = Math.round(attackSpeed * 100.0) / 100.0;
    }
  }

  static calcStatsFromPower(maxTalentId, installedTalents = Build.installedTalents) {
    const talentPowerByLine = Build.TALENT_POWER_LINE_WEIGHTS;

    Build.heroPowerFromInstalledTalents = 0.0;

    for (let i = 35; i >= 0 && i >= maxTalentId; i--) {
      let talent = installedTalents[i];
      if (talent) {
        let line = Math.floor((35 - i) / 6);
        Build.heroPowerFromInstalledTalents += talentPowerByLine[line];
      }
    }

    for (let stat in Build.heroStatsFromPower) {
      let Lvl = Number(Build.heroStatMods[stat]);
      if (!Number.isFinite(Lvl)) Lvl = 0;
      let q = Build.heroPowerModifier;
      let m = Build.heroPower * Build.heroPowerFromInstalledTalents;
      Build.heroStatsFromPower[stat] = Lvl * (0.6 * q * (m / 10.0 - 16.0) + 36.0);
    }
  }

  static getMaxStat(stats) {
    const fakeStat = 999;
    let maxStat = stats[0];
    let maxValue = Build.totalStat(maxStat);
    if (maxStat in Build.profileStats) {
      maxValue += Build.profileStats[maxStat] * fakeStat;
    }

    for (let s = 1; s < stats.length; s++) {
      let possibleMaxStat = Build.totalStat(stats[s]);
      if (stats[s] in Build.profileStats) {
        possibleMaxStat += Build.profileStats[stats[s]] * fakeStat;
      }
      if (possibleMaxStat > maxValue) {
        maxStat = stats[s];
        maxValue = Build.totalStat(maxStat);
        if (maxStat in Build.profileStats) {
          maxValue += Build.profileStats[maxStat] * fakeStat;
        }
      }
    }

    return maxStat;
  }

  static getMinStat(stats) {
    const fakeStat = 999;
    let minStat = stats[0];
    let minValue = Build.totalStat(minStat);
    if (minStat in Build.profileStats) {
      minValue += Build.profileStats[minStat] * fakeStat;
    }

    for (let s = 1; s < stats.length; s++) {
      let possibleMinStat = Build.totalStat(stats[s]);
      if (stats[s] in Build.profileStats) {
        possibleMinStat += Build.profileStats[stats[s]] * fakeStat;
      }
      if (possibleMinStat < minValue) {
        minStat = stats[s];
        minValue = Build.totalStat(minStat);
        if (minStat in Build.profileStats) {
          minValue += Build.profileStats[minStat] * fakeStat;
        }
      }
    }

    return minStat;
  }

  static getSumStat(stats) {
    let sumStat = stats[0];
    return sumStat;
  }

  static getTalentRefineByRarity(rarity) {
    return rarity ? Build.talentRefineByRarity[rarity] - 1.0 : 4.0;
  }

  static setStat(talent, fold = true, animation = true) {
    // Calculate overall power bonus
    const talentPowerByRarity = {
      4: Build.talentPowerByRarityFirstLevel[4] + Build.talentPowerByRarityPerLevel[4] * (Build.talentRefineByRarity[4] - 1),
      3: Build.talentPowerByRarityFirstLevel[3] + Build.talentPowerByRarityPerLevel[3] * (Build.talentRefineByRarity[3] - 1),
      2: Build.talentPowerByRarityFirstLevel[2] + Build.talentPowerByRarityPerLevel[2] * (Build.talentRefineByRarity[2] - 1),
      1: Build.talentPowerByRarityFirstLevel[1] + Build.talentPowerByRarityPerLevel[1] * (Build.talentRefineByRarity[1] - 1),
      0: Build.talentPowerByRarityFirstLevel[0] + Build.talentPowerByRarityPerLevel[0] * (Build.talentRefineByRarity[4] - 1),
    };

    let talentPower = 'rarity' in talent ? talentPowerByRarity[talent.rarity] : talentPowerByRarity[0];
    Build.heroPower += fold ? talentPower : -talentPower;

    let add = new Object();

    function registerStat(stat, key) {
      let statValue = parseFloat(talent.stats[key]);
      if ('statsRefine' in talent && 'rarity' in talent) {
        let refineBonus = Build.getTalentRefineByRarity(talent.rarity);
        let refineMul = parseFloat(talent.statsRefine[key]);
        statValue += refineBonus * refineMul;
      }
      if (Build.combatModeEnabled && key.indexOf('stak') !== -1) {
        statValue *= Build.getCombatStackProgressFactor();
      }
      add[stat] = statValue;
    }

    for (let key in talent.stats) {
      if (key == 'sr') {
        registerStat(Build.getMaxStat(['sila', 'razum']), key);
      } else if (key == 'ph') {
        registerStat(Build.getMaxStat(['provorstvo', 'hitrost']), key);
      } else if (key == 'sv') {
        registerStat(Build.getMaxStat(['stoikost', 'volia']), key);
      } else if (key == 'srsv') {
        registerStat(Build.getMaxStat(['sila', 'razum', 'stoikost', 'volia']), key);
      } else if (key == 'hpmp') {
        registerStat(Build.getMaxStat(['hp', 'mp']), key);
      } else if (key == 'srMin') {
        registerStat(Build.getMinStat(['sila', 'razum']), key);
      } else if (key == 'phMin') {
        registerStat(Build.getMinStat(['provorstvo', 'hitrost']), key);
      } else if (key == 'svMin') {
        registerStat(Build.getMinStat(['volia', 'stoikost']), key);
      } else if (key == 'srsvMin') {
        registerStat(Build.getMinStat(['sila', 'razum', 'stoikost', 'volia']), key);
      } else if (key == 'hpmpMin') {
        registerStat(Build.getMinStat(['hp', 'mp']), key);
      } else {
        registerStat(key, key);
      }
    }

    function calcualteSpecialStats(keyStat, statChange) {
      if (keyStat in Build.calculationStats) {
        if (keyStat == 'speed') {
          Build.calculationStats[keyStat] = Math.max(Build.calculationStats[keyStat], statChange);
        } else {
          Build.calculationStats[keyStat] += fold ? statChange : -statChange;
        }
      }
    }

    let hasSpeedCandidate = false;
    let speedBaseCandidate = -Infinity;
    let speedDeltaCandidate = 0;
    let speedNeedsAnimation = false;
    const statKeysToAnimate = new Set();
    const shouldAnimateHero = Build.animateHeroOnBuildChange === true;

    // Apply animation and change stats in Build.calculationStats
    for (let key2 in add) {
      let statChange = parseFloat(add[key2]);
      const resolvedRawKey = Build.resolveConditionalStatKey(key2);
      const resolvedKey = Build.remapTalentStatKeyForHeroResource(resolvedRawKey);
      if (!resolvedKey) continue;
      if (resolvedKey === 'speed') {
        hasSpeedCandidate = true;
        if (Number.isFinite(statChange)) speedBaseCandidate = Math.max(speedBaseCandidate, statChange);
        speedNeedsAnimation = true;
      } else if (resolvedKey === 'speedd') {
        hasSpeedCandidate = true;
        if (Number.isFinite(statChange)) speedDeltaCandidate += statChange;
        speedNeedsAnimation = true;
      } else {
        calcualteSpecialStats(resolvedKey, statChange);
      }

      const animationKey =
        resolvedKey in Build.dataStats
          ? resolvedKey
          : key2 in Build.dataStats
            ? key2
            : null;
      if (!animationKey) {
        continue;
      }

      if (animation) {
        statKeysToAnimate.add(animationKey);
      }
    }

    if (hasSpeedCandidate) {
      const base = Number.isFinite(speedBaseCandidate) ? speedBaseCandidate : 0;
      const addSpeed = Number.isFinite(speedDeltaCandidate) ? speedDeltaCandidate : 0;
      calcualteSpecialStats('speed', base + addSpeed);

      if (animation && speedNeedsAnimation && Build.dataStats['speed']) {
        statKeysToAnimate.add('speed');
      }
    }

    if (animation && statKeysToAnimate.size > 0) {
      for (const statKey of statKeysToAnimate) {
        const el = Build.dataStats?.[statKey];
        if (!el?.animate) continue;
        el.animate(
          { transform: ['scale(1)', 'scale(1.5)', 'scale(1)'] },
          { duration: 250, fill: 'both', easing: 'ease-out' },
        );
      }
      if (shouldAnimateHero && Build.heroImg?.animate) {
        Build.heroImg.animate({ transform: ['scale(1)', 'scale(1.5)', 'scale(1)'] }, { duration: 250, fill: 'both', easing: 'ease-out' });
      }
    }
  }

  static isMainHeroClassTalent(talent) {
    const mainTalentId = Math.abs(Number(getMainHeroTalentId(Build.heroId)));
    if (!Number.isFinite(mainTalentId) || mainTalentId <= 0) return false;
    const rawTalentId = Number(talent?.id);
    if (!Number.isFinite(rawTalentId) || rawTalentId >= 0) return false; // only heroic/class talents
    const classTalentId = Math.abs(rawTalentId);
    return classTalentId === mainTalentId;
  }

  // Кнопки уровней: светлая — таланты уровня показаны в библиотеке, тёмная — скрыты.
  // Фильтр — Build.ruleSortInventory.level, список показанных уровней (нет ключа — показаны все).
  static levelShown(id) {
    const shown = Build.ruleSortInventory?.level;
    return !shown || shown.includes(String(id));
  }

  // levels — показанные уровни; null или все шесть — фильтра нет.
  static setShownLevels(levels) {
    Build._forceShowTalentIds = null;
    Build._forceShowOnlySetTalentIds = null;
    Build._forceShowOnlyTalentIds = null;
    if (!levels || levels.length >= Build.levelView.children.length) delete Build.ruleSortInventory.level;
    else Build.ruleSortInventory.level = levels.map(String);
    Build.syncLevelButtons();
    Build.sortInventory();
  }

  // Ряды поля не подсвечиваем: состояние фильтра видно по самим кнопкам.
  static syncLevelButtons() {
    if (!Build.levelView) return;
    for (const button of Build.levelView.children) {
      button.classList.toggle('build-level-dim', !Build.levelShown(button.dataset.id));
    }
  }

  static level() {
    let i = 6;
    for (const number of ['VI', 'V', 'IV', 'III', 'II', 'I']) {
      const item = document.createElement('div');

      item.innerText = number;

      item.dataset.id = i;

      item.id = `bl${i}`;

      // ЛКМ — показать или скрыть таланты этого уровня.
      item.addEventListener('click', () => {
        Sound.play(SOUNDS_LIBRARY.CLICK, {
          id: 'ui-click',
          volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
        });
        const shown = [...Build.levelView.children].map((button) => button.dataset.id).filter((id) => Build.levelShown(id));
        Build.setShownLevels(Build.levelShown(item.dataset.id) ? shown.filter((id) => id !== item.dataset.id) : [...shown, item.dataset.id]);
      });

      // ПКМ — только этот уровень: остальные кнопки темнеют. Повторный ПКМ по ней — показать все.
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        Sound.play(SOUNDS_LIBRARY.CLICK, {
          id: 'ui-click',
          volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
        });

        const shown = Build.ruleSortInventory?.level;
        const solo = shown?.length === 1 && shown[0] === item.dataset.id;
        Build.setShownLevels(solo ? null : [item.dataset.id]);
      });

      Build.levelView.append(item);

      i--;
    }
  }

  static talentStatFilter(stat) {
    return (
      stat.indexOf('stak') != -1 ||
      stat.indexOf('rz') != -1 ||
      stat.indexOf('vz') != -1 ||
      stat.indexOf('stak') != -1 ||
      stat.indexOf('dop') != -1 ||
      stat.indexOf('buff') != -1 ||
      (stat.indexOf('speed') != -1 && stat.indexOf('speedtal') == -1)
    );
  }

  static field(data) {
    /*

		*/
    TalentData.enrich(data);

    let y = 0,
      index = 0,
      level = 6,
      preload = new PreloadImages();

    while (y < 6) {
      let row = document.createElement('div');

      row.classList.add('build-field-row');

      row.id = `bfr${level}`;

      row.dataset.level = level;

      let x = 0;

      while (x < 6) {
        let item = document.createElement('div');

        item.dataset.position = index;

        item.classList.add('build-hero-grid-item');

        if (data[index]) {
          data[index].state = 2;

          preload.add(Build.templateViewTalent(data[index]), item);
        }

        row.append(item);

        Build.installedTalents[index] = data[index];

        if (data[index] && 'conflict' in data[index]) {
          Build.fieldConflict[Math.abs(data[index].id)] = true;
        }

        x++;

        index++;
      }

      Build.fieldView.append(row);

      level--;

      y++;
    }

    Build.updateHeroStats();
    Build.renderCombatOrderBadges();
  }

  /** Кэш разбора строки txtNum ("value,refine,stat;..."): одна и та же строка разбирается один раз. */
  static _txtNumCache = new Map();

  static parseTalentTxtNum(txtNum) {
    const cached = Build._txtNumCache.get(txtNum);
    if (cached) return cached;
    const parsed = String(txtNum)
      .split(';')
      .map((part) => {
        const v = part.split(',');
        return [parseFloat(v[0]), parseFloat(v[1]), v[2]];
      });
    Build._txtNumCache.set(txtNum, parsed);
    return parsed;
  }

  static templateViewTalent(data) {
    const talent = DOM({ domaudio: domAudioPresets.talent, style: 'build-talent-item' });

    if (data.txtNum) {
      const params = Build.parseTalentTxtNum(data.txtNum);
      if (!data.stats) {
        data.stats = new Object();
      }
      if (!data.statsRefine) {
        data.statsRefine = new Object();
      }
      for (const [value, refine, key] of params) {
        if (Build.talentStatFilter(key)) {
          data.stats[key] = value;
          data.statsRefine[key] = refine;
        } else if (!(key in data.stats) && key in Build.initialStats && Build.initialStats[key] > 0) {
          data.stats[key + 'buff'] = value;
          data.statsRefine[key + 'buff'] = refine;
        }
      }
    }

    data.params = data.txtNum ? data.txtNum : data.params; //"all,8,74,num,razum";

    Build.talents[data.id] = data;

    talent.dataset.id = data.id;

    // игра не даёт включить смарткаст этому таланту — у его слота на панели нет переключателя
    if (!TalentData.canSmartcast(data.id)) talent.dataset.smartcast = '0';

    talent.dataset.active = data.active;

    talent.dataset.state = data.state;

    talent.dataset.url = data.id > 0 ? `content/talents/${data.id}.webp` : `content/htalents/${Math.abs(data.id)}.webp`;

    Build.move(talent);

    Build.description(talent);
    talent.addEventListener('click', (event) => {
      Build.handleCombatTalentClick(talent, event);
    });
    talent.addEventListener('contextmenu', (event) => {
      Build.handleCombatTalentContextMenu(talent, event);
    });

    if (data.level == 0) {
      talent.style.display = 'none';
    }

    return talent;

    preload.add(talent);
  }

  static async inventory() {
    const container = Build.inventoryView?.querySelector('.build-talents');
    if (container) {
      container.replaceChildren();
    }
    Build._inventoryDefaultOrder = new Map();
    Build._regroupInventoryBySetsOnNextSort = true;

    const requestedBuildId = Build.id;
    // Last-wins: при быстром переключении билдов рендерит только последний вызов.
    const inventoryToken = (Number(Build._inventoryToken) || 0) + 1;
    Build._inventoryToken = inventoryToken;
    const isStale = () => Build._inventoryToken !== inventoryToken || requestedBuildId !== Build.id;
    Build.loading = true;

    // «Библиотека» отдаётся сервером страницами под бюджет размера
    // (лимит CF ~23 КБ на фрейм) — накапливаем полный список.
    // Раньше при быстром переключении билдов новый запрос падал с REQUEST_ALREADY_PENDING
    // (предыдущий build.inventory ещё висел), ошибка глушилась в пустой массив,
    // а старый ответ отбрасывался как устаревший — библиотека оставалась пустой.
    // Теперь ждём освобождения метода и повторяем запрос.
    // Справочник героя уже есть — библиотека собирается на месте, без запроса.
    let data = Build.previewData ? structuredClone(Build.previewData.inventory) : Build.libraryFromCatalog(Build.heroId);
    const catalogHeroId = Build.heroId;
    const catalogGen = Build.buildCacheGen;

    for (let attempt = 0; attempt < 5 && data === null; attempt++) {
      if (isStale()) return;
      try {
        data = await App.api.requestPaged('build', 'inventory', { buildId: requestedBuildId });
        Build.rememberTalentCatalog(catalogHeroId, requestedBuildId, data, catalogGen);
      } catch (error) {
        if (isStale()) return;
        if (error?.code === 'REQUEST_ALREADY_PENDING') {
          await Build.waitForApiMethodIdle('build', 'inventory', 5000);
        } else if (attempt >= 1) {
          break;
        }
      }
    }

    if (isStale()) return;

    if (!Array.isArray(data)) data = new Array();

    TalentData.enrich(data);

    // Собираем всю библиотеку во фрагменте и вставляем в DOM одним разом:
    // раньше каждый талант вставлялся отдельно (+ querySelector на каждой итерации),
    // что вызывало сотни пересчётов вёрстки при открытии билда.
    const talentsList = Build.inventoryView.querySelector('.build-talents');
    const fragment = document.createDocumentFragment();
    const preload = new PreloadImages();

    let orderIndex = 0;
    for (let item of data) {
      const key = `${Number(item?.id)}`;
      Build._inventoryDefaultOrder.set(key, orderIndex);
      let talentContainer = DOM({ style: 'build-talent-item-container' });
      talentContainer.dataset.defaultOrder = `${orderIndex}`;

      item.state = 1;

      preload.add(Build.templateViewTalent(item), talentContainer);
      fragment.append(talentContainer);
      orderIndex++;
    }

    if (talentsList) talentsList.append(fragment);
    Build.loading = false;
    try {
      Build.sortInventory();
    } catch {}
    try {
      const ids = Build._hoveredSetTalentIds;
      const anchor = Build._hoveredSetAnchorEl;
      if (ids?.length && anchor?.isConnected) {
        Build.highlightSetTalents(ids);
        Build.previewSetTalentsInEmptySlots({ _manualOrder: ids, key: 'hover_preview_inventory' });
        const start = performance.now();
        const tick = () => {
          if (Build._hoveredSetAnchorEl !== anchor || Build._hoveredSetTalentIds !== ids) return;
          Build.highlightSetTalents(ids);
          Build.previewSetTalentsInEmptySlots({ _manualOrder: ids, key: 'hover_preview_inventory_tick' });
          if (performance.now() - start >= 900) return;
          setTimeout(tick, 140);
        };
        setTimeout(tick, 120);
      }
    } catch {}
  }

  static isTalentInBuild(talentId) {
    const numericId = Number(talentId);
    for (const t of Build.installedTalents || []) {
      if (!t) continue;
      if (Number.isFinite(numericId)) {
        if (Number(t.id) === numericId) return true;
      } else if (`${t.id}` === `${talentId}`) {
        return true;
      }
    }
    return false;
  }

  static isTalentConflictState(talentData, installedTalents) {
    try {
      return Build.getTalentConflictMatches(talentData, installedTalents).length > 0;
    } catch {
      return false;
    }
  }

  static getTalentConflictMatches(talentData, installedTalents) {
    try {
      if (!talentData || !Array.isArray(installedTalents)) return [];
      if (!('conflict' in talentData) || !Array.isArray(talentData.conflict)) return [];

      const matches = [];
      for (let index = 0; index < installedTalents.length; index++) {
        const installedTalent = installedTalents[index];
        if (!installedTalent) continue;

        for (const conflictId of talentData.conflict) {
          if (Math.abs(installedTalent.id) != conflictId) continue;

          const isCurrentOrdinary = talentData.id > 0;
          const isInstalledOrdinary = installedTalent.id > 0;
          if (isCurrentOrdinary !== isInstalledOrdinary) continue;

          matches.push({
            index,
            id: Number(installedTalent.id),
          });
          break;
        }
      }
      return matches;
    } catch {
      return [];
    }
  }

  static notifyTalentConflict() {
    try {
      if (typeof App !== 'undefined' && App.notify) {
        App.notify(Lang.text('talentConflict'));
      }
    } catch {}
  }

  static clearSetHighlights() {
    try {
      Build.fieldView?.querySelectorAll('.build-talent-item.build-set-highlight').forEach((el) => el.classList.remove('build-set-highlight'));
    } catch {}
    try {
      Build.inventoryView
        ?.querySelectorAll('.build-talents .build-talent-item.build-set-highlight-lib')
        .forEach((el) => el.classList.remove('build-set-highlight-lib'));
    } catch {}

    Build.clearEmptySlotPreviews();
    Build.refreshStatFilterHighlightCountDisplay();
  }

  /** Ключи stats у таланта, совпадающие с фильтром строки героя (как при setSortInventory). */
  static getHeroStatRowFilterStatKeys(heroRowKey) {
    const m = {
      hp: ['hp', 'hpmp'],
      mp: ['mp', 'hpmp'],
      regenhp: ['regenhp', 'regenhpvz'],
      regenmp: ['regenmp', 'regenmpvz'],
      krajahp: ['krajahp', 'krajahprz', 'krajahpvz'],
      krajamp: ['krajamp'],
      talentCdPct: ['speedtal', 'speedtalrz', 'speedtalvz'],
      speed: ['speed', 'speedrz', 'speedvz', 'speeda', 'speedarz', 'speedavz', 'speedd', 'speeddrz', 'speeddvz'],
      sila: ['sila', 'sr', 'srsv', 'silarz', 'silavz'],
      razum: ['razum', 'sr', 'srsv', 'razumrz', 'razumvz'],
      provorstvo: ['provorstvo', 'ph', 'provorstvorz', 'provorstvovz'],
      hitrost: ['hitrost', 'ph', 'hitrostrz', 'hitrostvz'],
      stoikost: ['stoikost', 'sv', 'srsv', 'stoikostrz', 'svvz', 'vs'],
      volia: ['volia', 'sv', 'srsv', 'voliarz', 'svvz', 'vs'],
    };
    return m[heroRowKey] ? m[heroRowKey].slice() : [heroRowKey];
  }

  /** Ключ в calculationStats (прямой вклад талантов через setStat), соответствующий строке героя. */
  static getHeroStatRowDisplayTotalKey(heroRowKey) {
    if (heroRowKey === 'talentCdPct') return 'speedtal';
    return heroRowKey;
  }

  static getTalentDirectCalculationValue(statKey) {
    if (statKey === 'speed') {
      const base = Number(Build.calculationStats['speed']);
      const add = Number(Build.calculationStats['speeda']);
      const b = Number.isFinite(base) ? base : 0;
      const a = Number.isFinite(add) ? add : 0;
      return b + a;
    }
    const v = Number(Build.calculationStats[statKey]);
    return Number.isFinite(v) ? v : 0;
  }

  /**
   * Состояние расчёта до применения таланта в слоте slotIndex (порядок i=35..0 как в updateHeroStats).
   */
  static computeStatsStateBeforeSlot(slotIndex) {
    Build.heroPower = 0.0;
    for (let key in Build.calculationStats) {
      Build.calculationStats[key] = 0.0;
    }
    const partialInstalledTalents = new Array(36).fill(null);
    for (let i = 35; i > slotIndex; i--) {
      const talent = Build.installedTalents[i];
      if (talent) {
        partialInstalledTalents[i] = talent;
        Build.calcStatsFromPower(i);
        Build.setStat(talent, true, false);
      }
    }
    Build.applySetAddStatsForInstalledTalents(partialInstalledTalents);
  }

  /** Меняется ли calculationStats[calcKey] при удалении таланта (для строк без max/min-алиасов). */
  static talentMarginalContributesToCalcKey(slotIndex, calcKey) {
    const installed = Build.installedTalents;
    const t = installed?.[slotIndex];
    if (!t) return false;
    const eps = 1e-4;
    Build.recomputeTalentCalculationTotals();
    const full = Build.getTalentDirectCalculationValue(calcKey);
    installed[slotIndex] = null;
    Build.recomputeTalentCalculationTotals();
    const without = Build.getTalentDirectCalculationValue(calcKey);
    installed[slotIndex] = t;
    Build.recomputeTalentCalculationTotals();
    return Math.abs(full - without) > eps;
  }

  static isCompositeHeroStatRowForHighlight(heroRowKey) {
    return ['hitrost', 'provorstvo', 'sila', 'razum', 'stoikost', 'volia', 'hp', 'mp'].includes(heroRowKey);
  }

  /**
   * Режим «есть ключ стата»: совпадение с фильтром библиотеки по ключам в данных таланта
   * (в т.ч. ph на обеих строках ловкости/хитрости), без проверки фактического вклада.
   */
  static statRowMatchesTalentByFilterKeysOnly(heroRowKey, t) {
    const base = t.id != null ? Build.talents?.[String(t.id)] : null;
    const stats = { ...(base?.stats || {}), ...(t.stats || {}) };
    const statKeys = Build.getHeroStatRowFilterStatKeys(heroRowKey);
    for (const sk of statKeys) {
      if (sk in stats) return true;
    }
    return false;
  }

  /**
   * Подсветка строки героя: для ph/sr/sv/srsv/hpmp смотрим куда уйдёт бонус в момент setStat
   * (getMaxStat/getMinStat на состоянии до слота). Маргинальный пересчёт неверен — соседний талант с ph
   * может перекинуться на другую характеристику при удалении «проворства».
   */
  static statRowMatchesTalentForHighlight(heroRowKey, t, slotIndex) {
    const base = t.id != null ? Build.talents?.[String(t.id)] : null;
    const stats = { ...(base?.stats || {}), ...(t.stats || {}) };
    const has = (k) => k in stats;

    if (heroRowKey === 'hitrost') {
      if (has('hitrost') || has('hitrostrz') || has('hitrostvz')) return true;
      if (has('ph')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['provorstvo', 'hitrost']) === 'hitrost';
      }
      if (has('phMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['provorstvo', 'hitrost']) === 'hitrost';
      }
      return false;
    }
    if (heroRowKey === 'provorstvo') {
      if (has('provorstvo') || has('provorstvorz') || has('provorstvovz')) return true;
      if (has('ph')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['provorstvo', 'hitrost']) === 'provorstvo';
      }
      if (has('phMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['provorstvo', 'hitrost']) === 'provorstvo';
      }
      return false;
    }
    if (heroRowKey === 'sila') {
      if (has('sila') || has('silarz') || has('silavz')) return true;
      if (has('sr')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['sila', 'razum']) === 'sila';
      }
      if (has('srsv')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['sila', 'razum', 'stoikost', 'volia']) === 'sila';
      }
      if (has('srMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['sila', 'razum']) === 'sila';
      }
      if (has('srsvMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['sila', 'razum', 'stoikost', 'volia']) === 'sila';
      }
      return false;
    }
    if (heroRowKey === 'razum') {
      if (has('razum') || has('razumrz') || has('razumvz')) return true;
      if (has('sr')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['sila', 'razum']) === 'razum';
      }
      if (has('srsv')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['sila', 'razum', 'stoikost', 'volia']) === 'razum';
      }
      if (has('srMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['sila', 'razum']) === 'razum';
      }
      if (has('srsvMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['sila', 'razum', 'stoikost', 'volia']) === 'razum';
      }
      return false;
    }
    if (heroRowKey === 'stoikost') {
      if (has('stoikost') || has('stoikostrz')) return true;
      if (has('sv')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['stoikost', 'volia']) === 'stoikost';
      }
      if (has('srsv')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['sila', 'razum', 'stoikost', 'volia']) === 'stoikost';
      }
      if (has('svMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['volia', 'stoikost']) === 'stoikost';
      }
      if (has('srsvMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['sila', 'razum', 'stoikost', 'volia']) === 'stoikost';
      }
      if (has('svvz') || has('vs')) {
        return Build.talentMarginalContributesToCalcKey(slotIndex, 'stoikost');
      }
      return false;
    }
    if (heroRowKey === 'volia') {
      if (has('volia') || has('voliarz')) return true;
      if (has('sv')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['stoikost', 'volia']) === 'volia';
      }
      if (has('srsv')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['sila', 'razum', 'stoikost', 'volia']) === 'volia';
      }
      if (has('svMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['volia', 'stoikost']) === 'volia';
      }
      if (has('srsvMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['sila', 'razum', 'stoikost', 'volia']) === 'volia';
      }
      if (has('svvz') || has('vs')) {
        return Build.talentMarginalContributesToCalcKey(slotIndex, 'volia');
      }
      return false;
    }
    if (heroRowKey === 'hp') {
      if (has('hp')) return true;
      if (has('hpmp')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['hp', 'mp']) === 'hp';
      }
      if (has('hpmpMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['hp', 'mp']) === 'hp';
      }
      return false;
    }
    if (heroRowKey === 'mp') {
      if (has('mp')) return true;
      if (has('hpmp')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMaxStat(['hp', 'mp']) === 'mp';
      }
      if (has('hpmpMin')) {
        Build.computeStatsStateBeforeSlot(slotIndex);
        return Build.getMinStat(['hp', 'mp']) === 'mp';
      }
      return false;
    }

    const statKeys = Build.getHeroStatRowFilterStatKeys(heroRowKey);
    for (const sk of statKeys) {
      if (sk in stats) return true;
    }
    return false;
  }

  static refreshStatFilterHighlightCountDisplay() {
    try {
      const el = Build.statFilterHighlightCountValueEl;
      const wrap = Build.statFilterHighlightCountWrapEl;
      if (!el) return;
      const nodes =
        Build.fieldView?.querySelectorAll?.(
          '.build-talent-item.build-stat-filter-hover, .build-talent-item.build-set-highlight',
        ) || [];
      el.textContent = String(new Set(Array.from(nodes)).size);
      if (wrap) wrap.dataset.tooltip = Lang.text('buildStatsHighlightedTalentsCountTitle');
    } catch {}
  }

  static clearStatFilterHoverHighlightOnSets() {
    try {
      Build.setsListView?.querySelectorAll('.build-set-item.build-stat-filter-hover-set').forEach((el) => {
        el.classList.remove('build-stat-filter-hover-set');
      });
    } catch {}
  }

  static heroRowMatchesResolvedSetStatKey(heroRowKey, resolvedSetStatKey) {
    const key = Build.resolveConditionalStatKey(Build.resolveCompositeStatAlias(resolvedSetStatKey));
    if (!key) return false;
    if (heroRowKey === 'critProb' && key === 'crit') return true;
    const rowKeys = Build.getHeroStatRowFilterStatKeys(heroRowKey);
    for (const rowKey of rowKeys) {
      const normalizedRowKey = Build.resolveConditionalStatKey(Build.resolveCompositeStatAlias(rowKey));
      if (normalizedRowKey === key) return true;
    }
    return false;
  }

  static applyStatFilterHoverHighlightOnSets(heroRowKey) {
    Build.clearStatFilterHoverHighlightOnSets();
    if (!Build.setsListView) return;
    const rendered = Array.isArray(Build._renderedSetEntries) ? Build._renderedSetEntries : [];
    if (!rendered.length) return;

    const installedIds = new Set();
    for (const talent of Build.installedTalents || []) {
      const tid = Number(talent?.id);
      if (Number.isFinite(tid) && tid !== 0) installedIds.add(tid);
    }
    if (!installedIds.size) return;

    for (const entry of rendered) {
      const set = entry?.set;
      const item = entry?.item;
      if (!set || !item || !item.isConnected) continue;

      const setIds = TalentSets.getTalentIds(set)
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id !== 0);
      if (!setIds.length) continue;

      let count = 0;
      for (const id of setIds) {
        if (installedIds.has(id)) count++;
      }
      if (count <= 0) continue;

      const requiredMain = Number(set?.mainNeed);
      if (Number.isFinite(requiredMain) && requiredMain !== 0 && !installedIds.has(requiredMain)) {
        continue;
      }

      const rules = Build.normalizeSetAddStatsRules(set?.addStats);
      let matched = false;
      for (const rule of rules) {
        if (count < rule.need) continue;
        const stats = rule?.stats;
        if (!stats || typeof stats !== 'object') continue;

        let speeddTotal = 0;
        for (const [rawKey, rawValue] of Object.entries(stats)) {
          const value = Number(rawValue);
          if (!Number.isFinite(value) || value === 0) continue;
          const resolvedStatKey = Build.resolveConditionalStatKey(Build.resolveCompositeStatAlias(rawKey));
          if (!resolvedStatKey) continue;
          if (resolvedStatKey === 'speedd') {
            speeddTotal += value;
            continue;
          }
          if (Build.heroRowMatchesResolvedSetStatKey(heroRowKey, resolvedStatKey)) {
            matched = true;
            break;
          }
        }
        if (matched) break;

        if (speeddTotal !== 0 && Build.heroRowMatchesResolvedSetStatKey(heroRowKey, 'speed')) {
          let mainId = Number(set?.mainNeed);
          if (!Number.isFinite(mainId) || mainId <= 0) mainId = Number(TalentSets.chooseMainTalentId(set));
          if (Number.isFinite(mainId) && mainId !== 0 && installedIds.has(mainId)) {
            matched = true;
            break;
          }
        }
      }

      if (matched) item.classList.add('build-stat-filter-hover-set');
    }
  }

  static clearStatFilterHoverHighlightOnBuild() {
    try {
      Build.fieldView
        ?.querySelectorAll('.build-talent-item.build-stat-filter-hover')
        .forEach((el) => el.classList.remove('build-stat-filter-hover'));
    } catch {}
    Build.clearStatFilterHoverHighlightOnSets();
    Build._statFilterHoverRowKey = null;
    Build.refreshStatFilterHighlightCountDisplay();
  }

  /** Подсветка слотов билда при наведении на строку стат-фильтра. */
  static applyStatFilterHoverHighlightOnBuild(heroRowKey) {
    Build.clearStatFilterHoverHighlightOnBuild();
    const mode = Build.getBuildStatFilterHighlightMode();
    if (mode === 0) {
      Build._statFilterHoverRowKey = null;
      return;
    }
    Build._statFilterHoverRowKey = heroRowKey;
    const installed = Build.installedTalents || [];
    const highlightAt = (index) => {
      const cell = Build.fieldView?.querySelector?.(`.build-hero-grid-item[data-position="${index}"]`);
      const el = cell?.querySelector?.('.build-talent-item');
      if (el) el.classList.add('build-stat-filter-hover');
    };

    if (mode === 1) {
      for (let index = 0; index < installed.length; index++) {
        const t = installed[index];
        if (!t) continue;
        if (Build.statRowMatchesTalentByFilterKeysOnly(heroRowKey, t)) highlightAt(index);
      }
      Build.applyStatFilterHoverHighlightOnSets(heroRowKey);
      Build.refreshStatFilterHighlightCountDisplay();
      return;
    }

    if (Build.isCompositeHeroStatRowForHighlight(heroRowKey)) {
      for (let index = 0; index < installed.length; index++) {
        const t = installed[index];
        if (!t) continue;
        if (Build.statRowMatchesTalentForHighlight(heroRowKey, t, index)) highlightAt(index);
      }
      Build.recomputeTalentCalculationTotals();
      Build.applyStatFilterHoverHighlightOnSets(heroRowKey);
      Build.refreshStatFilterHighlightCountDisplay();
      return;
    }

    const displayKey = Build.getHeroStatRowDisplayTotalKey(heroRowKey);
    Build.recomputeTalentCalculationTotals();
    const fullDirect = Build.getTalentDirectCalculationValue(displayKey);
    const eps = 1e-4;
    for (let index = 0; index < installed.length; index++) {
      const t = installed[index];
      if (!t) continue;
      installed[index] = null;
      Build.recomputeTalentCalculationTotals();
      const withoutDirect = Build.getTalentDirectCalculationValue(displayKey);
      installed[index] = t;
      if (Math.abs(fullDirect - withoutDirect) > eps) {
        highlightAt(index);
      }
    }
    Build.recomputeTalentCalculationTotals();
    Build.applyStatFilterHoverHighlightOnSets(heroRowKey);
    Build.refreshStatFilterHighlightCountDisplay();
  }

  static setSelectedSetItem(item) {
    try {
      if (Build._selectedSetItem && Build._selectedSetItem !== item) {
        Build._selectedSetItem.classList.remove('build-set-item-selected');
      }
      Build._selectedSetItem = item || null;
      if (Build._selectedSetItem) {
        Build._selectedSetItem.classList.add('build-set-item-selected');
      }
    } catch {}
  }

  static clearSelectedSetItem() {
    try {
      if (Build._selectedSetItem) {
        Build._selectedSetItem.classList.remove('build-set-item-selected');
      }
    } catch {}
    Build._selectedSetItem = null;
  }

  // Крестики-разделители поля (main.css, .build-field::before) видны только во время переноса
  // и только в круге у курсора: маска слоя следует за --divider-x/y.
  static showFieldDividers(clientX, clientY) {
    const field = Build.fieldView;
    if (!field?.isConnected) return;
    const rect = field.getBoundingClientRect();
    // Слой отступает от краёв поля на полклетки (inset: 100% / 12) — точку считаем от него.
    const inset = rect.width / 12;
    field.style.setProperty('--divider-x', `${Math.round(clientX - rect.left - inset)}px`);
    field.style.setProperty('--divider-y', `${Math.round(clientY - rect.top - inset)}px`);
    if (field.classList.contains('build-field--dividers')) return;
    // Первую точку применяем без перехода, иначе круг «приедет» с прошлого места.
    getComputedStyle(field, '::before').getPropertyValue('--divider-x');
    field.classList.add('build-field--dividers');
  }

  static hideFieldDividers() {
    Build.fieldView?.classList.remove('build-field--dividers');
  }

  static clearEmptySlotPreviews() {
    try {
      Build.fieldView
        ?.querySelectorAll(
          '.build-hero-grid-item.build-set-empty-slot-preview, .build-hero-grid-item.build-talent-empty-slot-preview',
        )
        .forEach((el) => {
          el.classList.remove('build-set-empty-slot-preview');
          el.classList.remove('build-talent-empty-slot-preview');
          el.style.backgroundImage = '';
        });
    } catch {}
    Build.stopPreviewBlinkTickerIfIdle();
  }

  static ensurePreviewBlinkTicker() {
    if (Build._previewBlinkTimer) return;
    Build._previewBlinkState = false;
    const tick = () => {
      if (!Build._previewBlinkTimer) return;
      Build._previewBlinkState = !Build._previewBlinkState;
      try {
        Build.fieldView?.classList?.toggle('build-preview-blink-on', Build._previewBlinkState);
      } catch {}
    };
    Build._previewBlinkTimer = setInterval(tick, 450);
    tick();
  }

  static stopPreviewBlinkTickerIfIdle() {
    let hasPreview = false;
    try {
      hasPreview = !!Build.fieldView?.querySelector?.(
        '.build-hero-grid-item.build-set-empty-slot-preview, .build-hero-grid-item.build-talent-empty-slot-preview',
      );
    } catch {}
    if (hasPreview) return;
    try {
      if (Build._previewBlinkTimer) clearInterval(Build._previewBlinkTimer);
    } catch {}
    Build._previewBlinkTimer = 0;
    Build._previewBlinkState = false;
    try {
      Build.fieldView?.classList?.remove('build-preview-blink-on');
    } catch {}
  }

  static getFirstEmptySlotIndexForLevelIn(installedTalents, level) {
    const lvl = Number(level);
    if (!Number.isFinite(lvl) || lvl <= 0) return null;

    for (let t = (lvl - 1) * 6; t < lvl * 6; t++) {
      const index = 35 - t;
      if (!installedTalents?.[index]) return index;
    }
    return null;
  }

  static previewSetTalentsInEmptySlots(set, slotDirection = 'right', { previewClass = 'build-set-empty-slot-preview' } = {}) {
    try {
      Build.clearEmptySlotPreviews();

      let ids = TalentSets.getTalentIds(set);
      if (previewClass === 'build-set-empty-slot-preview' && Array.isArray(ids)) {
        if (ids.length > 1) ids = Build.sortSetTalentIdsByPriority(ids);
        ids = Build.filterSetTalentIdsByMatchingStats(ids);
      }
      const simInstalled = Array.isArray(Build.installedTalents) ? Build.installedTalents.slice() : new Array(36).fill(null);

      for (const id of ids) {
        if (Build.isTalentInBuild(id)) continue; // already installed in real build
        const data = Build.talents?.[String(id)];
        if (!data || !data.level || data.level <= 0) continue;

        let emptyIndex = null;
        if (slotDirection === 'left') {
          // left-to-right within the row: indices increase from left to right in Build.field()
          const lvl = Number(data.level);
          const start = (6 - lvl) * 6;
          if (Number.isFinite(start)) {
            for (let idx = start; idx < start + 6; idx++) {
              if (!simInstalled?.[idx]) {
                emptyIndex = idx;
                break;
              }
            }
          }
        } else {
          // right-to-left (current behavior used by sets)
          emptyIndex = Build.getFirstEmptySlotIndexForLevelIn(simInstalled, data.level);
        }

        if (emptyIndex == null) continue;

        // simulate installation so next missing talent uses the correct next empty slot
        simInstalled[emptyIndex] = data;

        const cell = Build.fieldView?.querySelector(`.build-hero-grid-item[data-position="${emptyIndex}"]`);
        if (!cell) continue;
        cell.classList.add(previewClass);
        const src = id > 0 ? `content/talents/${id}.webp` : `content/htalents/${Math.abs(id)}.webp`;
        cell.style.backgroundImage = `url("${src}")`;
      }
      Build.ensurePreviewBlinkTicker();
    } catch {}
  }


  static positionDescriptionNearRect(anchorRect) {
    // Вызывается из rAF и img.onload — окно билда к этому моменту может быть уже закрыто
    if (!Build.descriptionView) return;
    const gap = 8;
    Build.descriptionView.style.zIndex = 9999;
    Build.descriptionView.style.position = 'fixed';

    let left = anchorRect.left + anchorRect.width + gap;
    let top = anchorRect.top;

    const w = Build.descriptionView.offsetWidth;
    const h = Build.descriptionView.offsetHeight;

    const overBottom = top + h - window.innerHeight;
    if (overBottom > 0) {
      top -= overBottom;
    }

    if (top < 0) top = 0;

    Build.descriptionView.style.left = `${left}px`;
    Build.descriptionView.style.top = `${top}px`;
  }

  static scheduleDescriptionReposition(anchorRect) {
    Build.positionDescriptionNearRect(anchorRect);
    requestAnimationFrame(() => Build.positionDescriptionNearRect(anchorRect));
    try {
      const imgs = Build.descriptionView.querySelectorAll('img');
      imgs.forEach((img) => {
        if (img.complete) return;
        img.addEventListener(
          'load',
          () => {
            Build.positionDescriptionNearRect(anchorRect);
          },
          { once: true },
        );
        img.addEventListener(
          'error',
          () => {
            Build.positionDescriptionNearRect(anchorRect);
          },
          { once: true },
        );
      });
    } catch {}
  }

  static applyTalentParamsToDescription(talentData) {
    if (!talentData || !talentData.params || !Build.descriptionView) return;

    try {
      let paramIterator = 0;
      const params = String(talentData.params || '').split(';').filter(Boolean);
      if (!params.length) return;

      const nodes = Build.descriptionView.querySelectorAll('*');
      for (const outerTag of nodes) {
        for (const specialTag of outerTag.childNodes || []) {
          const tagString = specialTag.innerHTML ? specialTag.innerHTML : specialTag.data;
          if (!tagString || tagString.indexOf('%s') === -1) continue;
          if (paramIterator >= params.length) return;

          const param = params[paramIterator];
          const paramValues = String(param || '')
            .split(',')
            .map((value) => String(value).trim());

          let statAffection, minValue, maxValue;
          let dynamicByStat = false;
          let optionalTokens = new Array();
          if (paramValues.length >= 5) {
            minValue = parseFloat(paramValues[1]);
            maxValue = parseFloat(paramValues[2]);
            statAffection = paramValues[4];
            dynamicByStat = true;
            optionalTokens = paramValues.slice(5);
          } else if (paramValues.length >= 3) {
            minValue = parseFloat(paramValues[0]);
            maxValue = parseFloat(paramValues[1]);
            statAffection = paramValues[2];
            optionalTokens = paramValues.slice(3);
          } else {
            continue;
          }

          if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || !statAffection) {
            paramIterator++;
            continue;
          }

          let clampMin = null;
          let clampMax = null;
          for (const token of optionalTokens) {
            const rawToken = String(token || '');
            const minMatch = rawToken.match(/^min\s*:\s*(-?\d+(?:\.\d+)?)$/i);
            if (minMatch) {
              const parsed = Number(minMatch[1]);
              if (Number.isFinite(parsed)) clampMin = parsed;
              continue;
            }
            const maxMatch = rawToken.match(/^max\s*:\s*(-?\d+(?:\.\d+)?)$/i);
            if (maxMatch) {
              const parsed = Number(maxMatch[1]);
              if (Number.isFinite(parsed)) clampMax = parsed;
            }
          }

          let resolvedStatAffection;
          let resolvedStatAffection1;
          let resolvedStatAffection2;
          switch (statAffection) {
            case 'sr_max':
              resolvedStatAffection = Build.getMaxStat(['sila', 'razum']);
              break;
            case 'sv_max':
              resolvedStatAffection = Build.getMaxStat(['stoikost', 'volia']);
              break;
            case 'ph_max':
              resolvedStatAffection = Build.getMaxStat(['provorstvo', 'hitrost']);
              break;
            case 'hr_max':
              resolvedStatAffection = Build.getMaxStat(['hitrost', 'razum']);
              break;
            case 'hpmp_max':
              resolvedStatAffection = Build.getMaxStat(['hp', 'mp']);
              break;
            case 'sr_sum':
              resolvedStatAffection1 = 'sila';
              resolvedStatAffection2 = 'razum';
              break;
            case 'ph_sum':
              resolvedStatAffection1 = 'provorstvo';
              resolvedStatAffection2 = 'hitrost';
              break;
            case 'sv_sum':
              resolvedStatAffection1 = 'stoikost';
              resolvedStatAffection2 = 'volia';
              break;
            case 'hpmp_sum':
              resolvedStatAffection1 = 'hp';
              resolvedStatAffection2 = 'mp';
              break;
            default:
              resolvedStatAffection = statAffection;
              break;
          }

          function lerp(a, b, alpha) {
            return a + alpha * (b - a);
          }

          let outputValue;
          if (statAffection == 'sr_sum' || statAffection == 'ph_sum' || statAffection == 'sv_sum' || statAffection == 'hpmp_sum') {
            let resolvedTotalStat1 = Build.totalStat(resolvedStatAffection1);
            let resolvedTotalStat2 = Build.totalStat(resolvedStatAffection2);
            const isHpOrEnergy =
              resolvedStatAffection1 == 'hp' ||
              resolvedStatAffection1 == 'mp' ||
              resolvedStatAffection2 == 'hp' ||
              resolvedStatAffection2 == 'mp';
            const param1 = isHpOrEnergy ? 600.0 : 50.0;
            const param2 = isHpOrEnergy ? 6250.0 : 250.0;
            outputValue = lerp(minValue, maxValue, (resolvedTotalStat1 + resolvedTotalStat2 - param1) / param2);
          } else {
            if (resolvedStatAffection in Build.dataStats && dynamicByStat) {
              let resolvedTotalStat = Build.totalStat(resolvedStatAffection);
              const isHpOrEnergy = resolvedStatAffection == 'hp' || resolvedStatAffection == 'mp';
              const param1 = isHpOrEnergy ? 600.0 : 50.0;
              const param2 = isHpOrEnergy ? 6250.0 : 250.0;
              outputValue = lerp(minValue, maxValue, (resolvedTotalStat - param1) / param2);
            } else {
              let refineBonus = Build.getTalentRefineByRarity(talentData.rarity);
              outputValue = minValue + maxValue * refineBonus;
            }
          }

          if (!Number.isFinite(outputValue)) {
            paramIterator++;
            continue;
          }
          if (Number.isFinite(clampMin)) outputValue = Math.min(outputValue, clampMin);
          if (Number.isFinite(clampMax)) outputValue = Math.max(outputValue, clampMax);
          let outputString = outputValue.toFixed(1);
          if (outputString.endsWith('.0')) outputString = outputString.replace('.0', '');

          if (specialTag.innerHTML) specialTag.innerHTML = tagString.replace('%s', outputString);
          else outerTag.innerHTML = tagString.replace('%s', outputString);

          paramIterator++;
        }
      }
    } catch {}
  }

  static formatCooldownValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const rounded = Math.round(num * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
    return String(rounded).replace(/\.0$/, '');
  }

  static applyCooldownReductionToDescriptionMarkup(talentDataForParams = null) {
    if (!Build.descriptionView) return;
    const cdNodes = Build.descriptionView.querySelectorAll('cd');
    if (!cdNodes.length) return;

    const talentId = Number(talentDataForParams?.id);
    const cdDeltaSec = Number.isFinite(talentId) ? Build.getSetTalentCooldownDeltaSeconds(talentId) : 0;
    const rawPct = Number(Build.totalStat('speedtal'));
    const cdPct = Number.isFinite(rawPct) ? Math.max(0, Math.min(Build.TALENT_COOLDOWN_PCT_MAX, rawPct)) : 0;
    if (cdPct <= 0 && cdDeltaSec === 0) return;

    for (const cdNode of cdNodes) {
      const source = String(cdNode.textContent || '').trim();
      let base = NaN;
      const explicit = source.match(/^([0-9]+(?:[.,][0-9]+)?)$/);
      if (explicit) {
        base = Number(String(explicit[1]).replace(',', '.'));
      } else if (!source) {
        const parent = cdNode.parentElement;
        if (parent) {
          const textNodes = Array.from(parent.childNodes).filter((n) => n !== cdNode && n.nodeType === 3);
          const rawNeighborNumber = textNodes
            .map((n) => String(n.textContent || ''))
            .join('')
            .trim();
          const implicit = rawNeighborNumber.match(/^([0-9]+(?:[.,][0-9]+)?)$/);
          if (implicit) {
            base = Number(String(implicit[1]).replace(',', '.'));
            for (const tn of textNodes) tn.textContent = '';
          }
        }
      }

      if (!Number.isFinite(base) || base <= 0) continue;

      const shiftedBase = Math.max(0, base + cdDeltaSec);
      const cdWithoutMods = base * (1 - cdPct / 100);
      const cdWithMods = shiftedBase * (1 - cdPct / 100);
      const baseText = Build.formatCooldownValue(base);
      const textWithoutMods = Build.formatCooldownValue(cdWithoutMods);
      const textWithMods = Build.formatCooldownValue(cdWithMods);
      if (!baseText || !textWithoutMods || !textWithMods) continue;

      // Compare formatted values to avoid showing redundant brackets.
      // Brackets are shown only when cdMods visibly changes result AND bracket value
      // differs from the "standard" left value (base).
      const hasCdModsEffect = textWithMods !== textWithoutMods;
      const showBracketValue = hasCdModsEffect && textWithoutMods !== baseText;
      const rightPart = showBracketValue ? `${textWithMods}(${textWithoutMods})` : textWithMods;
      cdNode.replaceChildren(`${baseText} `, uiIcon('send'), ` ${rightPart}`);
    }
  }

  static renderDescriptionHtml({ html, anchorEl, anchorRect, talentDataForParams }) {
    if (!Build.descriptionView) return;
    Build.descriptionView.innerHTML = html || '';
    Build.descriptionView.style.display = 'block';

    if (talentDataForParams) {
      Build.applyTalentParamsToDescription(talentDataForParams);
    }
    Build.applyCooldownReductionToDescriptionMarkup(talentDataForParams);

    const rect = anchorRect || anchorEl?.getBoundingClientRect?.();
    if (rect) Build.scheduleDescriptionReposition(rect);
  }

  static highlightSetTalents(talentIds) {
    Build.clearSetHighlights();
    const wanted = new Set((talentIds || []).map(String));
    const visibleRect = Build.getLibraryVisibleScrollRect();
    Build.fieldView?.querySelectorAll('.build-talent-item').forEach((el) => {
      if (wanted.has(el.dataset.id)) el.classList.add('build-set-highlight');
    });
    Build.inventoryView?.querySelectorAll('.build-talents .build-talent-item').forEach((el) => {
      if (wanted.has(el.dataset.id) && Build.isLibraryTalentVisibleByScroll(el, visibleRect)) el.classList.add('build-set-highlight-lib');
    });
    Build.refreshStatFilterHighlightCountDisplay();
  }

  static getLibraryVisibleScrollRect() {
    const list = Build.inventoryView?.querySelector?.('.build-talents');
    if (!list) return null;
    const listRect = list.getBoundingClientRect?.();
    return {
      list,
      listRect,
      left: list.scrollLeft,
      right: list.scrollLeft + list.clientWidth,
      top: list.scrollTop,
      bottom: list.scrollTop + list.clientHeight,
    };
  }

  static isLibraryTalentVisibleByScroll(el, visibleRect) {
    if (!el || !el.isConnected || !visibleRect?.list) return false;
    if (!visibleRect.list.contains(el)) return false;
    const elRect = el.getBoundingClientRect?.();
    const listRect = visibleRect.listRect || visibleRect.list.getBoundingClientRect?.();
    if (!elRect || !listRect) return false;
    const left = elRect.left - listRect.left + visibleRect.list.scrollLeft;
    const top = elRect.top - listRect.top + visibleRect.list.scrollTop;
    const right = left + el.offsetWidth;
    const bottom = top + el.offsetHeight;
    return !(
      right <= visibleRect.left ||
      left >= visibleRect.right ||
      bottom <= visibleRect.top ||
      top >= visibleRect.bottom
    );
  }

  static highlightSetTalentsInLibraryOnly(talentIds) {
    Build.clearSetHighlights();
    const wanted = new Set((talentIds || []).map(String));
    const visibleRect = Build.getLibraryVisibleScrollRect();
    Build.inventoryView?.querySelectorAll('.build-talents .build-talent-item').forEach((el) => {
      if (wanted.has(el.dataset.id) && Build.isLibraryTalentVisibleByScroll(el, visibleRect)) el.classList.add('build-set-highlight-lib');
    });
    Build.refreshStatFilterHighlightCountDisplay();
  }

  static async highlightSetTalentsAfterRender(talentIds, timeoutMs = 2000) {
    const ids = (talentIds || []).map(String);
    if (!ids.length) return;
    const hasAny = () => ids.some((id) => Build.fieldView?.querySelector(`.build-talent-item[data-id="${id}"]`) || Build.inventoryView?.querySelector(`.build-talents .build-talent-item[data-id="${id}"]`));
    await Build.waitForCondition(hasAny, timeoutMs);
    if (Build._hoveredSetTalentIds !== talentIds) return;
    Build.highlightSetTalents(talentIds);
    Build.previewSetTalentsInEmptySlots({ _manualOrder: ids, key: 'hover_preview_recover' });
  }

  static showSetDescription(set, anchorEl) {
    Build._descriptionPinnedBySet = true;
    const mode = Build.getSetLmbMode();
    const mainId = TalentSets.chooseMainTalentId(set);
    const ids = TalentSets.getTalentIds(set);

    const iconHtml = ids
      .map((id) => {
        const inBuild = Build.isTalentInBuild(id);
        const src = `content/talents/${id}.webp`;
        const cls = inBuild ? 'build-set-desc-icon is-in-build' : 'build-set-desc-icon';
        return `<img class="${cls}" src="${src}">`;
      })
      .join('');

    let mainDesc = '';
    if (mainId != null) {
      const absId = Math.abs(mainId);
      const prefix = 'talent_';
      const nameKey = `${prefix}${absId}_name`;
      const descriptionKey = `${prefix}${absId}_description`;
      const mainName = Lang.text(nameKey);
      const desc = Lang.text(descriptionKey);
      mainDesc = `<div class="build-set-main-desc"><b>${mainName}</b><br><br>${desc}</div>`;
    }

    let lmbHint = Lang.text('setHintLmb');
    if (mode === 2) lmbHint = Lang.text('setHintLmbMode2');
    if (mode === 3) lmbHint = Lang.text('setHintLmbMode3');

    let rmbHint = Lang.text('setHintRmb');
    if (mode === 3) rmbHint = Lang.text('setHintRmbMode3');

    const html =
      `${mainDesc}` +
      `<div class="build-set-desc-icons">${iconHtml}</div>` +
      `<div class="build-set-desc-hints">` +
      `<div>${lmbHint}</div>` +
      `<div>${rmbHint}</div>` +
      `</div>`;

    const dataForParams = mainId != null ? Build.talents[String(mainId)] : null;
    Build.renderDescriptionHtml({ html, anchorEl, talentDataForParams: dataForParams });
  }

  static refreshSetHoverState(set, item, ids, withDelayedHighlights = false) {
    if (Build._hoveredSetAnchorEl !== item) return;

    Build.showSetDescription(set, item);
    Build.highlightSetTalents(ids);
    Build.previewSetTalentsInEmptySlots(set);
    Build.highlightSetTalentsAfterRender(ids);
    if (withDelayedHighlights) {
      const start = performance.now();
      const tick = () => {
        if (Build._hoveredSetAnchorEl !== item || Build._hoveredSetTalentIds !== ids) return;
        Build.highlightSetTalents(ids);
        if (performance.now() - start >= 1400) return;
        setTimeout(tick, 140);
      };
      setTimeout(tick, 120);
    }
    requestAnimationFrame(() => {
      if (Build._hoveredSetAnchorEl !== item || Build._hoveredSetTalentIds !== ids) return;
      Build.showSetDescription(set, item);
      Build.highlightSetTalents(ids);
      Build.previewSetTalentsInEmptySlots(set);
    });
  }

  static getFirstEmptySlotIndexForLevel(level) {
    const lvl = Number(level);
    if (!Number.isFinite(lvl) || lvl <= 0) return null;

    for (let t = (lvl - 1) * 6; t < lvl * 6; t++) {
      const index = 35 - t;
      if (!Build.installedTalents?.[index]) return index;
    }
    return null;
  }

  static async removeTalentFromActiveByFieldIndex(fieldIndex) {
    const pos = Number(fieldIndex);
    if (!Number.isFinite(pos)) return;
    for (let i = 0; i < (Build.activeBarItems || []).length; i++) {
      const talPos = Math.abs(Build.activeBarItems[i]) - 1;
      if (talPos === pos) {
        try {
          await Build.removeTalentFromActive(i);
        } catch {}
      }
    }
  }

  static findFirstFreeActiveBarIndex() {
    for (let i = 0; i < (Build.activeBarItems || []).length; i++) {
      if (Build.activeBarItems[i] === 0) return i;
    }
    return -1;
  }

  static isFieldIndexAlreadyInActiveBar(fieldIndex) {
    const pos = Number(fieldIndex);
    if (!Number.isFinite(pos)) return false;
    for (let i = 0; i < (Build.activeBarItems || []).length; i++) {
      const talPos = Math.abs(Build.activeBarItems[i]) - 1;
      if (talPos === pos) return true;
    }
    return false;
  }

  static waitForCondition(check, timeoutMs = 1200) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        let ok = false;
        try {
          ok = !!check();
        } catch {
          ok = false;
        }
        if (ok) return resolve(true);
        if (performance.now() - start >= timeoutMs) return resolve(false);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  /** Ждёт, пока в App.api.awaiting не останется запросов конкретного object.method. */
  static waitForApiMethodIdle(objectName, methodName, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        let pending = 0;
        try {
          const awaiting = App?.api?.awaiting || {};
          for (const v of Object.values(awaiting)) {
            if (v?.object === objectName && v?.method === methodName) pending++;
          }
        } catch {}

        if (pending === 0) return resolve(true);
        if (performance.now() - start >= timeoutMs) return resolve(false);
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  static waitForApiIdle(objectName, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        let pending = 0;
        try {
          const awaiting = App?.api?.awaiting || {};
          for (const v of Object.values(awaiting)) {
            if (v?.object === objectName) pending++;
          }
        } catch {}

        if (pending === 0) return resolve(true);
        if (performance.now() - start >= timeoutMs) return resolve(false);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  static getSetApplyPriorityBases(useFallback = true) {
    const bases = ['sila', 'razum', 'provorstvo', 'hitrost', 'stoikost', 'volia'];

    // Source of truth: profile checkboxes (circle/checkbox) in hero stats block.
    const profile = Build.profileStats || {};
    const fromProfile = bases.filter((k) => Number(profile[k]) === 1);
    if (fromProfile.length) return new Set(fromProfile);

    if (!useFallback) return new Set();

    // Fallback: current stats filter state.
    const selected = Array.isArray(Build.ruleSortInventory?.stats) ? Build.ruleSortInventory.stats : [];
    if (!selected.length) return new Set();
    return new Set(bases.filter((k) => selected.includes(k)));
  }

  static getSetPriorityFamilyWeights() {
    return {
      sila: { pure: ['sila', 'silarz', 'silavz'], mixed: ['sr', 'srsv'] },
      razum: { pure: ['razum', 'razumrz', 'razumvz'], mixed: ['sr', 'srsv'] },
      provorstvo: { pure: ['provorstvo', 'provorstvorz', 'provorstvovz'], mixed: ['ph'] },
      hitrost: { pure: ['hitrost', 'hitrostrz', 'hitrostvz'], mixed: ['ph'] },
      stoikost: { pure: ['stoikost', 'stoikostrz'], mixed: ['sv', 'svvz', 'vs', 'srsv'] },
      volia: { pure: ['volia', 'voliarz'], mixed: ['sv', 'svvz', 'vs', 'srsv'] },
    };
  }

  static getSetSilaRazumPresence(stats = {}) {
    const pureSilaKeys = ['sila', 'silarz', 'silavz'];
    const pureRazumKeys = ['razum', 'razumrz', 'razumvz'];
    const maxSrKeys = ['sr', 'srsv'];
    const hasPureSila = pureSilaKeys.some((k) => Build.hasTalentStatKey(stats, k));
    const hasPureRazum = pureRazumKeys.some((k) => Build.hasTalentStatKey(stats, k));
    const hasSrMax = maxSrKeys.some((k) => Build.hasTalentStatKey(stats, k));
    return { hasPureSila, hasPureRazum, hasSrMax };
  }

  static hasTalentStatKey(stats = {}, key = '') {
    if (!key) return false;
    return key in stats || `${key}buff` in stats;
  }

  static hasNonCheckboxStatKey(stats = {}, familyWeights = null) {
    const map = familyWeights || Build.getSetPriorityFamilyWeights();
    const checkboxKeys = new Set(['srMin', 'phMin', 'svMin', 'srsvMin']);
    try {
      for (const cfg of Object.values(map)) {
        for (const k of cfg?.pure || []) checkboxKeys.add(k);
        for (const k of cfg?.mixed || []) checkboxKeys.add(k);
      }
    } catch {}

    for (const rawKey of Object.keys(stats || {})) {
      const k = String(rawKey).endsWith('buff') ? String(rawKey).slice(0, -4) : String(rawKey);
      if (!checkboxKeys.has(k)) return true;
    }
    return false;
  }

  static hasAnyCheckboxStatKey(stats = {}, familyWeights = null) {
    const map = familyWeights || Build.getSetPriorityFamilyWeights();
    const checkboxKeys = new Set(['srMin', 'phMin', 'svMin', 'srsvMin']);
    try {
      for (const cfg of Object.values(map)) {
        for (const k of cfg?.pure || []) checkboxKeys.add(k);
        for (const k of cfg?.mixed || []) checkboxKeys.add(k);
      }
    } catch {}

    for (const rawKey of Object.keys(stats || {})) {
      const k = String(rawKey).endsWith('buff') ? String(rawKey).slice(0, -4) : String(rawKey);
      if (checkboxKeys.has(k)) return true;
    }
    return false;
  }

  static sortSetTalentIdsByPriority(ids) {
    if (!Array.isArray(ids) || ids.length <= 1) return ids;
    const bases = Build.getSetApplyPriorityBases(false);
    if (!bases.size) return ids;

    const familyWeights = Build.getSetPriorityFamilyWeights();
    const hasSilaSelected = bases.has('sila');
    const hasRazumSelected = bases.has('razum');
    const dominantSr = hasSilaSelected && hasRazumSelected ? Build.getMaxStat(['sila', 'razum']) : null;

    const pureWeight = 10;
    const mixedWeight = 3;

    const scored = ids.map((id, idx) => {
      const data = Build.talents?.[String(id)];
      const score = Build.getSetTalentPriorityScore(data, bases, familyWeights, pureWeight, mixedWeight, { dominantSr });

      return { id, idx, score };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    });

    return scored.map((x) => x.id);
  }

  static getSetTalentPriorityScore(data, bases, familyWeights, pureWeight = 10, mixedWeight = 3, options = {}) {
    const stats = data?.stats || {};
    let score = 0;
    for (const base of bases || []) {
      const map = familyWeights?.[base];
      if (!map) continue;
      let basePureWeight = pureWeight;
      let baseMixedWeight = mixedWeight;

      // If both Sila and Razum are selected, prioritize the larger of those
      // stats in current build state.
      if (options?.dominantSr && (base === 'sila' || base === 'razum')) {
        if (base === options.dominantSr) {
          basePureWeight += 4;
          baseMixedWeight += 1;
        } else {
          basePureWeight = Math.max(0, basePureWeight - 2);
          baseMixedWeight = Math.max(0, baseMixedWeight - 1);
        }
      }

      for (const k of map.pure) {
        if (Build.hasTalentStatKey(stats, k)) score += basePureWeight;
      }
      for (const k of map.mixed) {
        if (Build.hasTalentStatKey(stats, k)) score += baseMixedWeight;
      }
    }
    return score;
  }

  static filterSetTalentIdsByMatchingStats(ids) {
    if (!Array.isArray(ids) || !ids.length) return ids || [];
    if (!Settings.settings?.buildSetOnlyMatchingStats) return ids;

    const bases = Build.getSetApplyPriorityBases(false);

    const familyWeights = Build.getSetPriorityFamilyWeights();
    const hasSilaSelected = bases.has('sila');
    const hasRazumSelected = bases.has('razum');
    const bothSelected = hasSilaSelected && hasRazumSelected;
    const dominantSr = bothSelected ? Build.getMaxStat(['sila', 'razum']) : null;
    const nonSrBases = new Set([...bases].filter((b) => b !== 'sila' && b !== 'razum'));

    return ids.filter((id) => {
      const data = Build.talents?.[String(id)];
      const stats = data?.stats || {};
      const hasCheckbox = Build.hasAnyCheckboxStatKey(stats, familyWeights);
      const hasNonCheckbox = Build.hasNonCheckboxStatKey(stats, familyWeights);
      if (!bases.size) return !hasCheckbox && hasNonCheckbox;
      // Always allow "other stats" only when talent has no checkbox-related
      // stats at all. Mixed talents must still obey checkbox filters.
      if (!hasCheckbox && hasNonCheckbox) return true;
      const srPresence = Build.getSetSilaRazumPresence(stats);

      // If only Razum is selected, reject only pure Sila talents.
      // "Largest stat" aliases (sr/srsv) are allowed.
      if (hasRazumSelected && !hasSilaSelected && srPresence.hasPureSila) return false;
      // If only Sila is selected, reject only pure Razum talents.
      // "Largest stat" aliases (sr/srsv) are allowed.
      if (hasSilaSelected && !hasRazumSelected && srPresence.hasPureRazum) return false;

      // If neither Sila nor Razum is selected, reject talents that are only
      // Sila/Razum-based (including "max between them" aliases like sr/srsv).
      if (!hasSilaSelected && !hasRazumSelected && (srPresence.hasPureSila || srPresence.hasPureRazum || srPresence.hasSrMax)) {
        const nonSrScore = Build.getSetTalentPriorityScore(data, nonSrBases, familyWeights);
        if (nonSrScore <= 0) return false;
      }

      return Build.getSetTalentPriorityScore(data, bases, familyWeights, 10, 3, { dominantSr }) > 0;
    });
  }

  static applySetToBuild(set) {
    const setIds = TalentSets.getTalentIds(set);
    let ids = Build.sortSetTalentIdsByPriority(setIds);
    ids = Build.filterSetTalentIdsByMatchingStats(ids);
    const simInstalled = Array.isArray(Build.installedTalents) ? Build.installedTalents.slice() : new Array(36).fill(null);
    for (const id of ids) {
      if (Build.isTalentInBuild(id)) continue;
      const data = Build.talents?.[String(id)];
      if (!data) continue;
      if (!data.level || data.level <= 0) continue;

      // Conflict handling: match Build.move() behavior.
      const conflictState = Build.isTalentConflictState(data, simInstalled);
      if (conflictState) {
        Build.notifyTalentConflict();
        continue;
      }

      const emptyIndex = Build.getFirstEmptySlotIndexForLevelIn(simInstalled, data.level);
      if (emptyIndex == null) continue;

      try {
        Build.sendBuildMutation({
          optimisticMethod: 'optimisticSet',
          legacyMethod: 'set',
          data: {
            buildId: Build.id,
            talentId: data.id,
            index: emptyIndex,
          },
        });

        Build.installedTalents[emptyIndex] = data;
        simInstalled[emptyIndex] = data;

        if (data.active) {
          if (!Build.isFieldIndexAlreadyInActiveBar(emptyIndex)) {
            const free = Build.findFirstFreeActiveBarIndex();
            if (free !== -1) {
              const position = Number(emptyIndex) + 1;
              Build.sendBuildMutation({
                optimisticMethod: 'optimisticSetActive',
                legacyMethod: 'setActive',
                data: {
                  buildId: Build.id,
                  index: free,
                  position: position,
                },
              });
              Build.activeBarItems[free] = position;
            }
          }
        }
      } catch (e) {
      }
    }

    Build.refreshLocalBuildUiAfterSet(setIds);

  }

  /** Индекс порядка из карты загрузки библиотеки (устойчиво к типу id). */
  static lookupInventoryDefaultOrderIndex(talentIdRaw) {
    try {
      const m = Build._inventoryDefaultOrder;
      if (!m) return null;
      if (talentIdRaw === undefined || talentIdRaw === null) return null;
      const s = String(talentIdRaw).trim();
      if (!s) return null;
      const n = Number(s);
      if (Number.isFinite(n)) {
        const v = m.get(`${n}`);
        if (Number.isFinite(Number(v))) return Number(v);
      }
      const v2 = m.get(s);
      if (Number.isFinite(Number(v2))) return Number(v2);
    } catch {}
    return null;
  }

  /** Проставить data-default-order с карты (новые обёртки после билда часто без него). */
  static attachDefaultOrderDatasetToInventoryContainer(container) {
    try {
      const item = container?.querySelector?.('.build-talent-item');
      const idx = Build.lookupInventoryDefaultOrderIndex(item?.dataset?.id);
      if (idx !== null) container.dataset.defaultOrder = `${idx}`;
    } catch {}
  }

  /** Порядок таланта в библиотеке как при загрузке (не после перестановок сета). */
  static getInventoryContainerDefaultOrder(container) {
    const item = container?.querySelector?.('.build-talent-item');
    const byData = Number(container?.dataset?.defaultOrder);
    if (Number.isFinite(byData)) return byData;
    const fromMap = Build.lookupInventoryDefaultOrderIndex(item?.dataset?.id);
    if (fromMap !== null) return fromMap;
    return Number.MAX_SAFE_INTEGER;
  }

  /** Вернуть узлы библиотеки в исходный порядок (после Alt / сброса режима сета). */
  static reorderInventoryByDefaultOrder() {
    const list = Build.inventoryView?.querySelector('.build-talents');
    if (!list) return;
    const allContainers = Array.from(list.querySelectorAll('.build-talent-item-container'));
    for (const c of allContainers) {
      Build.attachDefaultOrderDatasetToInventoryContainer(c);
    }
    if (allContainers.length < 2) return;
    const sorted = allContainers.slice().sort((a, b) => {
      const da = Build.getInventoryContainerDefaultOrder(a);
      const db = Build.getInventoryContainerDefaultOrder(b);
      if (da !== db) return da - db;
      const ia = Number(a.querySelector('.build-talent-item')?.dataset?.id);
      const ib = Number(b.querySelector('.build-talent-item')?.dataset?.id);
      if (Number.isFinite(ia) && Number.isFinite(ib) && ia !== ib) return ia - ib;
      return 0;
    });
    for (const container of sorted) {
      try {
        list.appendChild(container);
      } catch {}
    }
  }

  static applySetInventoryOrder(set) {
    const list = Build.inventoryView?.querySelector('.build-talents');
    if (!list) return;

    const ids = TalentSets.getTalentIds(set);
    const mode = Build.getSetLmbMode();
    Build._forceShowOnlySetTalentIds = null;
    Build._forceShowOnlyTalentIds = null;

    if (mode === 2 || mode === 3) {
      Build._forceShowOnlySetTalentIds = new Set(ids.map(String));
      Build.refreshForcedSetOnlyTalentIds();
      // Весь сет уже в билде — не оставляем «пустой» фильтр (вся библиотека пропадала без sortInventory).
      if (!Build._forceShowOnlyTalentIds?.size) {
        Build._forceShowOnlySetTalentIds = null;
        Build._forceShowOnlyTalentIds = null;
        Build.sortInventory();
        return;
      }

      const prevScroll = list.scrollTop;

      // Show only leftovers; then rebuild DOM order grouped by build rows (levels 6..1).
      // We preserve the original relative order inside each level group.
      Build.sortInventory();

      const visibleContainers = Array.from(list.querySelectorAll('.build-talent-item-container')).filter((container) => {
        try {
          return container?.style?.display !== 'none';
        } catch {
          return false;
        }
      });

      const byLevel = new Map();
      for (const container of visibleContainers) {
        const item = container.querySelector('.build-talent-item');
        const talentId = item?.dataset?.id ? String(item.dataset.id) : null;
        if (!talentId) continue;
        const level = Number(Build.talents?.[talentId]?.level) || 0;
        if (!byLevel.has(level)) byLevel.set(level, []);
        byLevel.get(level).push(container);
      }

      const orderedLevels = [6, 5, 4, 3, 2, 1, 0];
      const ordered = [];
      for (const lvl of orderedLevels) {
        const part = byLevel.get(lvl);
        if (part?.length) ordered.push(...part);
      }

      for (const container of ordered) {
        try {
          if (container.parentNode === list) list.removeChild(container);
        } catch {}
      }
      for (const container of ordered) {
        try {
          list.appendChild(container);
        } catch {}
      }

      try {
        list.scrollTop = prevScroll;
      } catch {}
      return;
    }
    Build._forceShowOnlySetTalentIds = null;

    Build.sortInventory();
    const allContainers = Array.from(list.querySelectorAll('.build-talent-item-container'));
    const setContainers = [];
    const setContainerKeys = new Set();
    for (const id of ids) {
      if (Build.isTalentInBuild(id)) continue;
      const el = list.querySelector(`.build-talent-item[data-id="${id}"]`);
      if (!el) continue;
      const container = el.closest('.build-talent-item-container');
      if (!container) continue;
      if (container.style.display === 'none') continue;
      const key = `${Number(id)}`;
      if (setContainerKeys.has(key)) continue;
      setContainerKeys.add(key);
      setContainers.push(container);
    }
    const restContainers = allContainers.filter((container) => {
      const item = container?.querySelector?.('.build-talent-item');
      const id = `${Number(item?.dataset?.id)}`;
      return !setContainerKeys.has(id);
    });
    restContainers.sort(
      (a, b) => Build.getInventoryContainerDefaultOrder(a) - Build.getInventoryContainerDefaultOrder(b),
    );
    const ordered = [...setContainers, ...restContainers];
    for (const container of ordered) {
      try {
        list.appendChild(container);
      } catch {}
    }
    try {
      list.scrollTop = 0;
    } catch {}
  }

  static async removeSetFromBuild(set) {
    const ids = TalentSets.getTalentIds(set);
    const idSet = new Set((ids || []).map((id) => `${Number(id)}`));
    const removeIndices = [];
    
    for (let index = 0; index < (Build.installedTalents || []).length; index++) {
      const t = Build.installedTalents[index];
      if (!t) continue;
      if (idSet.has(`${Number(t.id)}`)) {
        removeIndices.push(index);
      }
    }
    
    if (!removeIndices.length) {
      Build.refreshLocalBuildUiAfterSet(ids, set);
      return;
    }
    
    const removePositions = new Set(removeIndices.map((index) => Number(index) + 1));
    for (let i = 0; i < (Build.activeBarItems || []).length; i++) {
      const activeItem = Number(Build.activeBarItems[i]) || 0;
      if (!activeItem) continue;
      if (!removePositions.has(Math.abs(activeItem))) continue;
      Build.clearActiveSlotLocal(i);
      Build.sendBuildMutation({
        optimisticMethod: 'optimisticClearActive',
        legacyMethod: 'setZeroActive',
        data: { buildId: Build.id, index: i },
      });
    }
    
    for (const index of removeIndices) {
      Build.installedTalents[index] = null;
      Build.sendBuildMutation({
        optimisticMethod: 'optimisticRemove',
        legacyMethod: 'setZero',
        data: { buildId: Build.id, index },
      });
    }

    Build.refreshLocalBuildUiAfterSet(ids, set);

  }

  static tryBeginSetAction() {
    if (Build._setActionInProgress) return false;
    Build._setActionInProgress = true;
    return true;
  }

  static endSetAction() {
    Build._setActionInProgress = false;
  }

  static renderTalentSetsList() {
    if (!Build.setsListView) return;
    Build.setsListView.replaceChildren();
    Build._renderedSetEntries = [];

    if (!Build._setsHoverMonitorInstalled) {
      Build._setsHoverMonitorInstalled = true;
      let lastCheck = 0;
      document.addEventListener(
        'mousemove',
        (e) => {
          const anchor = Build._hoveredSetAnchorEl;
          if (!anchor) return;
          const now = performance.now();
          if (now - lastCheck < 80) return;
          lastCheck = now;
          const below = document.elementFromPoint(e.clientX, e.clientY);
          const hoveredSet = below?.closest?.('.build-set-item');
          if (hoveredSet === anchor) return;
          if (Build.descriptionView) Build.descriptionView.style.display = 'none';
          Build._descriptionPinnedBySet = false;
          Build._hoveredSetTalentIds = null;
          Build._hoveredSetAnchorEl = null;
          Build.clearSetHighlights();
        },
        { passive: true },
      );
    }

    const sets = Build.getSortedSetsForRender();
    for (const set of sets) {
      const mainId = TalentSets.chooseMainTalentId(set);
      if (mainId == null) continue;
      const src = `content/talents/${mainId}.webp`;

      const item = DOM({ style: 'build-set-item' });
      item.style.backgroundImage = `url("${src}")`;
      Build._renderedSetEntries.push({ set, item });

      const ids = TalentSets.getTalentIds(set);
      item.addEventListener('mouseenter', () => {
        if (Build._setsHoverSuppressed) return;
        Build.showSetDescription(set, item);
        Build._hoveredSetTalentIds = ids;
        Build._hoveredSetAnchorEl = item;
        Build.highlightSetTalents(ids);
        Build.previewSetTalentsInEmptySlots(set);
      });
      item.addEventListener('mouseleave', () => {
        // After set click, transient mouseleave can happen during fast rerender.
        // Keep current hover visuals pinned; global mousemove monitor will clear on real leave.
        if (Build._descriptionPinnedBySet && Build._hoveredSetAnchorEl === item) return;
        if (Build.descriptionView) Build.descriptionView.style.display = 'none';
        Build._descriptionPinnedBySet = false;
        Build._hoveredSetTalentIds = null;
        Build._hoveredSetAnchorEl = null;
        Build.clearSetHighlights();
      });
      item.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          Sound.play(SOUNDS_LIBRARY.CLICK, { id: 'ui-set-down', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
          Sound.play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, { id: 'ui-set-up', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
        } catch {}
        if (!Build.tryBeginSetAction()) return;
        (async () => {
          try {
            Build.setSelectedSetItem(item);
            const mode = Build.getSetLmbMode();
            const installedBefore = Build.countInstalledTalentsFromSet(set);
            Build._descriptionPinnedBySet = true;
            Build._hoveredSetTalentIds = ids;
            Build._forceShowTalentIds = mode === 1 ? new Set(ids.map(String)) : null;
            Build._forceShowOnlySetTalentIds = null;
            Build._forceShowOnlyTalentIds = null;

            if (mode === 2) {
              Build._forceShowOnlySetTalentIds = new Set(ids.map(String));
              Build._forceShowOnlyTalentIds = new Set();
            } else if (mode === 3) {
              Build.applySetInventoryOrder(set);
            }
            if (mode !== 3) {
              Build.applySetToBuild(set);
              Build.applySetInventoryOrder(set);
            } else {
              Build.applySetInventoryOrder(set);
            }
            if (mode !== 3) {
              const installedAfter = Build.countInstalledTalentsFromSet(set);
              if (installedAfter >= 2 && installedAfter > installedBefore) {
                Build.registerSetPopularityClick(set);
              }
            }
            Build.refreshSetHoverState(set, item, ids, true);
          } finally {
            Build.endSetAction();
          }
        })();
      });
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (Build.combatModeEnabled) return;
        try {
          Sound.play(SOUNDS_LIBRARY.CLICK, { id: 'ui-set-down', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
        } catch {}
        if (!Build.tryBeginSetAction()) return;
        (async () => {
          try {
            Build.setSelectedSetItem(item);
            const mode = Build.getSetLmbMode();
            Build._hoveredSetTalentIds = ids;
            Build._forceShowTalentIds = mode === 1 ? new Set(ids.map(String)) : null;
            Build._forceShowOnlySetTalentIds = null;
            Build._forceShowOnlyTalentIds = null;
            await Build.removeSetFromBuild(set);
            Build.refreshSetHoverState(set, item, ids);
          } finally {
            Build.endSetAction();
          }
        })();
      });

      Build.setsListView.append(item);
    }
    if (Build._statFilterHoverRowKey) {
      Build.applyStatFilterHoverHighlightOnSets(Build._statFilterHoverRowKey);
    }
  }

  static syncRarityFilterVisuals() {
    const rules = Build.ruleSortInventory || {};
    for (const button of Build.rarityView?.querySelectorAll('[data-filter-kind]') || []) {
      const isActiveFilter = button.dataset.filterKind === 'active';
      const enabled = isActiveFilter
        ? !rules.active || rules.active.includes('1')
        : !rules.rarity || rules.rarity.includes(button.dataset.rarityId);
      button.dataset.active = enabled ? '1' : '0';
      button.setAttribute('aria-checked', String(enabled));
      // Редкость выключена — камень в центре того же цвета, кольцо вокруг одинаково серое у всех
      // (build/filter-<цвет>-off.png собраны из картинок «вкл»).
      const image = isActiveFilter
        ? button.dataset.filterImage + (enabled ? 'Show' : 'NoShow')
        : enabled
          ? (['2', '3'].includes(button.dataset.rarityId) ? `build/filter-${button.dataset.filterImage}` : `${button.dataset.filterImage}Show`)
          : `build/filter-${button.dataset.filterImage}-off`;
      button.style.backgroundImage = `url("content/img/${image}.png")`;
      button.style.backgroundColor = 'transparent';
      button.style.backgroundBlendMode = 'normal';
      button.style.backgroundSize = isActiveFilter ? '92%' : 'cover';
      button.style.filter = isActiveFilter && enabled
        ? 'brightness(1.04) saturate(2.02)'
        : 'none';
    }
  }

  static rarity() {
    const qualities = [
      { id: '4', name: Lang.text('titleTheRed'), image: 'red' },
      { id: '3', name: Lang.text('titleTheOrange'), image: 'orange' },
      { id: '2', name: Lang.text('titleThePurple'), image: 'purple' },
      { id: '1', name: Lang.text('titleTheBlue'), image: 'blue' },
    ];
    const allQualities = qualities.map(item => item.id);
    const updateFilters = () => {
      Build._forceShowTalentIds = null;
      Build._forceShowOnlySetTalentIds = null;
      Build._forceShowOnlyTalentIds = null;
      Build.sortInventory();
    };
    const prepareButton = (button, image, kind) => {
      button.dataset.filterKind = kind;
      button.dataset.filterImage = image;
      button.style.backgroundColor = 'transparent';
      button.style.backgroundRepeat = 'no-repeat';
      button.style.backgroundPosition = 'center';
      button.style.backgroundSize = 'cover';
      button.style.border = 'none';
      button.style.boxSizing = 'border-box';
      button.setAttribute('role', 'checkbox');
      button.tabIndex = 0;
      button.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        button.click();
      });
      button.addEventListener('click', () => {
        Sound.play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, {
          id: 'ui-small-click',
          volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
        });
      });
    };

    const active = document.createElement('div');
    active.classList.add('build-rarity-other');
    prepareButton(active, 'active', 'active');
    Build.setUiTooltip(active, Lang.text('buildActiveFilterTooltip'));
    active.setAttribute('aria-label', Lang.text('buildActiveFilterTooltip'));
    active.addEventListener('click', () => {
      if (active.dataset.active === '1') Build.ruleSortInventory.active = ['0'];
      else delete Build.ruleSortInventory.active;
      updateFilters();
    });
    active.addEventListener('contextmenu', event => {
      event.preventDefault();
      delete Build.ruleSortInventory.rarity;
      Build.ruleSortInventory.active = ['1'];
      updateFilters();
    });
    Build.rarityView.append(active);

    for (const item of qualities) {
      const button = document.createElement('div');
      button.dataset.rarityId = item.id;
      prepareButton(button, item.image, 'rarity');
      Build.setUiTooltip(button, Lang.text('talentQualityTitle').replace('{name}', item.name));
      button.setAttribute('aria-label', Lang.text('talentQualityTitle').replace('{name}', item.name));
      button.addEventListener('click', () => {
        const selected = new Set(Build.ruleSortInventory.rarity ?? allQualities);
        if (selected.has(item.id)) selected.delete(item.id);
        else selected.add(item.id);
        // An explicit empty selection hides all qualities; missing means all.
        if (selected.size === allQualities.length) delete Build.ruleSortInventory.rarity;
        else Build.ruleSortInventory.rarity = [...selected];
        updateFilters();
      });
      button.addEventListener('contextmenu', event => {
        event.preventDefault();
        delete Build.ruleSortInventory.active;
        Build.ruleSortInventory.rarity = [item.id];
        updateFilters();
      });
      Build.rarityView.append(button);
    }
    Build.syncRarityFilterVisuals();
  }

  static async removeTalentFromActive(activeId) {
    let container = Build.activeBarView.childNodes[activeId];

    Build.disableSmartCast(container);
    container.firstChild.remove();

    Build.activeBarItems[activeId] = 0;
    await Build.sendBuildMutationOrThrow({
      optimisticMethod: 'optimisticClearActive',
      legacyMethod: 'setZeroActive',
      data: {
      buildId: Build.id,
      index: activeId,
      },
    });
  }
  
  static clearActiveSlotLocal(activeId) {
    const index = Number(activeId);
    if (!Number.isFinite(index) || index < 0) return;
    const container = Build.activeBarView?.childNodes?.[index];
    if (container) {
      try {
        container.classList.remove('smartcast');
        container.dataset.active = 0;
        container.setAttribute('aria-label', Lang.text('titleSmartcastIsDisabled'));
      } catch {}
      try {
        container.firstChild?.remove?.();
      } catch {}
    }
    if (Array.isArray(Build.activeBarItems) && index < Build.activeBarItems.length) {
      Build.activeBarItems[index] = 0;
    }
  }
  
  static assignActiveSlotLocal(activeId, position) {
    const index = Number(activeId);
    const pos = Number(position);
    if (!Number.isFinite(index) || index < 0) return;
    if (!Number.isFinite(pos) || pos === 0) return;
    
    const absPos = Math.abs(pos);
    for (let i = 0; i < (Build.activeBarItems || []).length; i++) {
      if (i === index) continue;
      const current = Number(Build.activeBarItems[i]) || 0;
      if (!current) continue;
      if (Math.abs(current) !== absPos) continue;
      Build.clearActiveSlotLocal(i);
    }
    
    if (Array.isArray(Build.activeBarItems) && index < Build.activeBarItems.length) {
      Build.activeBarItems[index] = pos;
    }
    
    const container = Build.activeBarView?.childNodes?.[index];
    if (container) {
      try {
        if (container.firstChild) {
          container.firstChild.remove();
        }
      } catch {}
    }
  }
  

  static async requestSmartcast(element) {
    if (element.firstChild) {
      let position = Number(element.firstChild.dataset.position) + 1;
      if (element.dataset.active == 1) {
        position = -position;
      }
      const activeIndex = Number(element.dataset.index);
      if (Number.isFinite(activeIndex) && Array.isArray(Build.activeBarItems) && activeIndex >= 0 && activeIndex < Build.activeBarItems.length) {
        Build.activeBarItems[activeIndex] = position;
      }

      await Build.sendBuildMutationOrThrow({
        optimisticMethod: 'optimisticSetActive',
        legacyMethod: 'setActive',
        data: {
        buildId: Build.id,
        index: element.dataset.index,
        position: position,
        },
      });
    }
  }

  // Переключатель смарткаста — правый нижний угол слота панели активных (36% ширины и высоты).
  static isOverSmartcastIndicator(slot, x, y) {
    const rect = slot.getBoundingClientRect();
    return x >= rect.right - rect.width * 0.36 && x <= rect.right && y >= rect.bottom - rect.height * 0.36 && y <= rect.bottom;
  }

  // Слот панели с талантом, которому игра разрешает смарткаст (пустой слот — нет)
  static canSmartcastSlot(element) {
    const talent = element?.firstChild;
    return !!talent && talent.dataset?.smartcast !== '0';
  }

  static async enableSmartCast(element, sendRequest) {
    if (element.firstChild && !Build.canSmartcastSlot(element)) {
      // такой талант в бою не смарткастится: показываем выключенным, на сервер не шлём
      return Build.disableSmartCast(element, false);
    }
    element.classList.add('smartcast');
    element.dataset.active = 1;
    element.setAttribute('aria-label', Lang.text('titleSmartcastIsEnabled'));
    if (sendRequest) {
      await Build.requestSmartcast(element);
    }
  }

  static async disableSmartCast(element, sendRequest) {
    element.classList.remove('smartcast');
    element.dataset.active = 0;
    element.setAttribute('aria-label', Lang.text('titleSmartcastIsDisabled'));
    if (sendRequest) {
      await Build.requestSmartcast(element);
    }
  }

  static activeBar(data) {
    Build.activeBarItems = data;

    // FLIP: запоминаем, где стоял каждый талант (по id), чтобы после перерисовки
    // плавно довезти его на новый слот вместо «телепорта». Только в рамках одного билда.
    const prevActiveRects = new Map();
    const sameBuild = Build._activeBarRenderedBuildId !== undefined && Build._activeBarRenderedBuildId === Build.id;
    if (sameBuild && Build.activeBarView && Build.shouldAnimateSortMoves()) {
      try {
        for (const slot of Build.activeBarView.childNodes) {
          const talent = slot.firstChild;
          const id = talent?.dataset?.id;
          if (id === undefined || prevActiveRects.has(id)) continue;
          const rect = Build.getTalentVisualRect(talent);
          if (rect?.width) prevActiveRects.set(id, rect);
          Build._talentMoveGhosts?.get?.(talent)?.();
        }
      } catch {}
    }
    Build._activeBarRenderedBuildId = Build.id;
    const activeMoves = [];

    try {
      Build.activeBarView?.replaceChildren();
    } catch {}
    try {
      Build.activeBarKeybindingsView?.replaceChildren();
    } catch {}

    let index = 0;

    for (let item of data) {
      const element = DOM({
        domaudio: domAudioPresets.defaultButton,
        data: { index: index },
        style: 'build-active-bar-item',
        event: [
          'contextmenu',
          async (e) => {
            e.preventDefault();
            if (!Build.canSmartcastSlot(element)) {
              return;
            }

            if (element.dataset.active == 1) {
              await Build.disableSmartCast(element, true);
            } else {
              await Build.enableSmartCast(element, true);
            }
          },
        ],
      });

      element.dataset.active = 0;

      const keyName = Build.getKeyName(index);

      if (Math.abs(item)) {
        let position = Math.abs(item) - 1;
        let findTalent = Build.fieldView.querySelector(`[data-position = "${position}"]`);

        if (findTalent && findTalent.firstChild) {
          let clone = findTalent.firstChild.cloneNode(true);
          element.append(clone);

          clone.dataset.state = 3;
          clone.style.opacity = 1;
          clone.style.position = 'static';
          clone.style.backgroundImage = `url("${clone.dataset.url}")`;
          clone.dataset.position = position;
          Build.move(clone, true);
          const fromRect = prevActiveRects.get(clone.dataset.id);
          if (fromRect) activeMoves.push({ node: clone, from: fromRect });
        }
      }

      // после вставки таланта: enableSmartCast проверяет, можно ли ему смарткаст
      if (item < 0) Build.enableSmartCast(element);

      element.addEventListener('mousemove', (event) => {
        const tooltip = Build.activeBarView.parentElement?.querySelector('.build-smartcast-tooltip');
        if (!tooltip) return;
        const rect = element.getBoundingClientRect();
        const overIndicator = Build.isOverSmartcastIndicator(element, event.clientX, event.clientY);
        if (!Build.canSmartcastSlot(element) || Build._isDraggingTalent || !overIndicator) {
          tooltip.style.display = 'none';
          return;
        }
        const parentRect = Build.activeBarView.parentElement.getBoundingClientRect();
        const enabled = Number(element.dataset.active) === 1;
        tooltip.replaceChildren(
          document.createTextNode(Lang.text('smartcastLabel')),
          DOM({ tag: 'span', style: enabled ? 'smartcast-state--enabled' : 'smartcast-state--disabled' },
            Lang.text(enabled ? 'smartcastEnabled' : 'smartcastDisabled')),
        );
        tooltip.style.left = `${rect.right - rect.width * 0.18 - parentRect.left}px`;
        tooltip.style.top = `${rect.bottom - rect.height * 0.36 - parentRect.top - 6}px`;
        tooltip.style.display = 'block';
      });
      element.addEventListener('mouseleave', () => {
        const tooltip = Build.activeBarView.parentElement?.querySelector('.build-smartcast-tooltip');
        if (tooltip) tooltip.style.display = 'none';
      });
      Build.activeBarView.append(element);

      // Keep key-label alignment: always append an element per slot.
      // If no key is assigned, we render an empty text node.
      const keyElement = DOM({ style: 'build-active-bar-key' }, keyName || '');
      Build.activeBarKeybindingsView.append(keyElement);

      index++;
    }

    for (const m of activeMoves) Build.animateTalentMove(m.node, m.from);
  }

  static getKeyName(index) {
    try {
      const bind = Build.binds?.[index];
      const keys = bind?.keys;
      if (!Array.isArray(keys) || !keys.length) return '';
      return keys.join('+');
    } catch {
      return '';
    }
	
  }

  static setSortInventory(key, value) {
    Build._forceShowTalentIds = null;
    Build._forceShowOnlySetTalentIds = null;
    Build._forceShowOnlyTalentIds = null;
    if (!(key in Build.ruleSortInventory)) {
      Build.ruleSortInventory[key] = new Array();

      Build.ruleSortInventory[key].push(value);
    } else {
      if (!Build.ruleSortInventory[key].includes(value)) {
        Build.ruleSortInventory[key].push(value);
      }
    }

    // Build.sortInventory();
  }

  static removeSortInventory(key, value) {
    Build._forceShowTalentIds = null;
    Build._forceShowOnlySetTalentIds = null;
    Build._forceShowOnlyTalentIds = null;
    if (key in Build.ruleSortInventory) {
      let newArray = new Array();

      for (let item of Build.ruleSortInventory[key]) {
        if (item != value) {
          newArray.push(item);
        }
      }

      if (newArray.length) {
        Build.ruleSortInventory[key] = newArray;
      } else {
        delete Build.ruleSortInventory[key];
      }

      // Build.sortInventory();
    }
  }

  /** Фильтры библиотеки + поиск по названию поверх них. */
  static applySorting(itemContainer) {
    Build.applySortingCore(itemContainer);
    Build.applyLibrarySearch(itemContainer);
  }

  static createLibrarySearchInput() {
    Build._librarySearchQuery = '';
    const row = document.createElement('div');
    row.className = 'build-library-search-row mm-lobby-hero-search-wrap';
    const icon = document.createElement('span');
    icon.className = 'build-library-search-icon';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'build-library-search mm-lobby-hero-search';
    input.placeholder = Lang.text('buildTalentSearchPlaceholder');
    input.setAttribute('aria-label', input.placeholder);
    input.spellcheck = false;
    input.autocomplete = 'off';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'build-library-search-clear';
    clear.textContent = '×';
    clear.setAttribute('aria-label', Lang.text('buildTalentSearchClear'));
    row.append(icon, input, clear);

    clearTimeout(Build._librarySearchTimer);
    Build._librarySearchTimer = 0;
    const apply = () => {
      row.classList.toggle('build-library-search-row--active', input.value.trim() !== '');
      const q = Build.normalizeSearchText(input.value);
      if (q === Build._librarySearchQuery) return;
      Build._librarySearchQuery = q;
      Build.sortInventory();
    };
    const reset = () => {
      input.value = '';
      clearTimeout(Build._librarySearchTimer);
      apply();
    };
    input.addEventListener('input', () => {
      row.classList.toggle('build-library-search-row--active', input.value.trim() !== '');
      clearTimeout(Build._librarySearchTimer);
      Build._librarySearchTimer = setTimeout(apply, 80);
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        reset();
        input.blur();
      } else if (App.isEnterKey(e)) {
        // Enter в поле — «готово»: снимаем фокус, фильтр остаётся.
        e.preventDefault();
        input.blur();
      }
    });
    for (const type of ['mousedown', 'click', 'contextmenu', 'keyup']) {
      row.addEventListener(type, (e) => e.stopPropagation());
    }
    icon.addEventListener('click', () => input.focus());
    clear.addEventListener('click', () => {
      reset();
      input.focus();
    });
    Build.librarySearchInput = input;
    Build.installLibrarySearchHotkey();
    return row;
  }

  /** Enter в окне билда (вне полей ввода) — фокус в поиск Библиотеки с выделением текста. */
  static installLibrarySearchHotkey() {
    if (Build._librarySearchHotkeyHandler) {
      window.removeEventListener('keydown', Build._librarySearchHotkeyHandler, true);
    }
    const handler = (e) => {
      try {
        if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (!App.isEnterKey(e)) return;
        if (Window.windows?.main?.id !== 'wbuild') return;
        const input = Build.librarySearchInput;
        if (!input || !input.isConnected || input.offsetParent === null) return;
        const active = document.activeElement;
        if (active === input) return;
        const tag = String(active?.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
        e.preventDefault();
        e.stopPropagation();
        input.focus();
        input.select();
      } catch {}
    };
    Build._librarySearchHotkeyHandler = handler;
    window.addEventListener('keydown', handler, true);
  }

  static normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
  }

  static getLangWordSilently(key) {
    const target = Lang.list?.[Lang.target]?.word;
    if (target && Object.prototype.hasOwnProperty.call(target, key)) return target[key];
    const def = Lang.list?.[Lang.default]?.word;
    if (def && Object.prototype.hasOwnProperty.call(def, key)) return def[key];
    return '';
  }

  /** Нормализованное название таланта для поиска (кешируется по языку). */
  static getTalentSearchName(id) {
    const num = Number(id);
    if (!Number.isFinite(num) || num === 0) return '';
    if (!Build._talentSearchNameCache || Build._talentSearchNameCacheLang !== Lang.target) {
      Build._talentSearchNameCache = new Map();
      Build._talentSearchNameCacheLang = Lang.target;
    }
    const cache = Build._talentSearchNameCache;
    if (cache.has(num)) return cache.get(num);
    const key = num < 0 ? `htalent_${Math.abs(num)}_name` : `talent_${num}_name`;
    const raw = String(Build.getLangWordSilently(key) || '').replace(/<[^>]*>/g, '');
    const name = Build.normalizeSearchText(raw);
    cache.set(num, name);
    return name;
  }

  static applyLibrarySearch(itemContainer) {
    const q = Build._librarySearchQuery;
    if (!q || !itemContainer || itemContainer.style.display === 'none') return;
    const id = itemContainer.firstChild?.dataset?.id;
    if (!Build.getTalentSearchName(id).includes(q)) {
      itemContainer.style.display = 'none';
    }
  }

  static applySortingCore(itemContainer) {
    let item = itemContainer.firstChild;

    let data = Build.talents[item.dataset.id],
      flag = true;

    try {
      // Сначала: в билде — никогда не показывать в библиотеке (в т.ч. при режиме «остаток сета» и после Alt).
      const tid0 = item?.dataset?.id;
      if (tid0 != null && `${tid0}` !== '' && Build.isTalentInBuild(tid0)) {
        itemContainer.style.display = 'none';
        itemContainer.style.gridRow = '';
        return;
      }

      // Пустой Set — не режим «только остаток сета» (иначе скрывается вся библиотека).
      if (Build._forceShowOnlyTalentIds && Build._forceShowOnlyTalentIds.size > 0) {
        const id = String(item.dataset.id);
        const visible = Build._forceShowOnlyTalentIds.has(id);
        itemContainer.style.display = visible ? 'block' : 'none';
        if (visible) {
          const level = Number(Build.talents?.[id]?.level) || 0;
          // Build rows are rendered from 6 -> 1 (top -> bottom), mirror this in library.
          const row = level > 0 ? 7 - level : 1;
          itemContainer.style.gridRow = `${row}`;
        } else {
          itemContainer.style.gridRow = '';
        }
        return;
      }
      itemContainer.style.gridRow = '';
      if (Build._forceShowTalentIds && Build._forceShowTalentIds.has(String(item.dataset.id))) {
        itemContainer.style.display = 'block';
        return;
      }
    } catch {}

    if (data.level == 0) {
      itemContainer.style.display = 'none';
      return;
    }

    for (let key in Build.ruleSortInventory) {
      if (!(key in data)) {
        flag = false;

        break;
      }

      if (key == 'stats') {
        let foundStat = false;

        if (!data.stats) {
          flag = false;

          break;
        }

        for (let stat of Build.ruleSortInventory.stats) {
          if (stat in data.stats) {
            foundStat = true;
          }
        }

        if (!foundStat) {
          flag = false;

          break;
        }
      } else {
        if (!Build.ruleSortInventory[key].includes(`${data[key]}`)) {
          flag = false;

          break;
        }
      }
    }

    if (flag) {
      itemContainer.style.display = 'block';
    } else {
      itemContainer.style.display = 'none';
    }
  }

  static sortInventory() {
    Build.syncRarityFilterVisuals();
    Build.refreshForcedSetOnlyTalentIds();
    for (let itemContainer of Build.inventoryView.querySelectorAll('.build-talent-item-container')) {
      Build.applySorting(itemContainer);
    }
    if (Build._regroupInventoryBySetsOnNextSort) {
      Build.groupInventoryTalentsBySets();
      Build._regroupInventoryBySetsOnNextSort = false;
    }
  }

  /** Группировать видимые таланты одного сета в библиотеке (в порядке sets.list.js). */
  static groupInventoryTalentsBySets() {
    const list = Build.inventoryView?.querySelector('.build-talents');
    if (!list) return;

    const containers = Array.from(list.querySelectorAll('.build-talent-item-container'));
    if (containers.length < 2) return;

    // TalentSets.list() возвращает reverse() для UI списка; для группировки берём порядок как в sets.list.js.
    const sets = TalentSets.list().slice().reverse();
    const setMetaByTalentId = new Map();
    for (const set of sets) {
      const setKey = `${set?.key || ''}`;
      const ids = TalentSets.getTalentIds(set);
      for (let index = 0; index < ids.length; index++) {
        const key = `${Number(ids[index])}`;
        if (!Number.isFinite(Number(key))) continue;
        if (setMetaByTalentId.has(key)) continue;
        setMetaByTalentId.set(key, { setKey, orderInSet: index });
      }
    }

    const visibleContainersBySet = new Map();
    const getTalentIdKey = (container) => {
      const idRaw = container?.querySelector?.('.build-talent-item')?.dataset?.id;
      const idNum = Number(idRaw);
      if (!Number.isFinite(idNum)) return null;
      return `${idNum}`;
    };

    for (const container of containers) {
      if (container?.style?.display === 'none') continue;
      const idKey = getTalentIdKey(container);
      if (!idKey) continue;
      const meta = setMetaByTalentId.get(idKey);
      if (!meta) continue;
      if (!visibleContainersBySet.has(meta.setKey)) {
        visibleContainersBySet.set(meta.setKey, new Map());
      }
      const byOrder = visibleContainersBySet.get(meta.setKey);
      if (!byOrder.has(meta.orderInSet)) {
        byOrder.set(meta.orderInSet, []);
      }
      byOrder.get(meta.orderInSet).push(container);
    }

    const consumed = new Set();
    const ordered = [];
    for (const container of containers) {
      if (consumed.has(container)) continue;

      const idKey = getTalentIdKey(container);
      const meta = idKey ? setMetaByTalentId.get(idKey) : null;
      const visible = container?.style?.display !== 'none';
      const groupMap = visible && meta ? visibleContainersBySet.get(meta.setKey) : null;

      if (!groupMap || groupMap.size <= 1) {
        ordered.push(container);
        consumed.add(container);
        continue;
      }

      const groupOrders = Array.from(groupMap.keys()).sort((a, b) => a - b);
      for (const order of groupOrders) {
        const groupContainers = groupMap.get(order) || [];
        for (const groupedContainer of groupContainers) {
          if (consumed.has(groupedContainer)) continue;
          ordered.push(groupedContainer);
          consumed.add(groupedContainer);
        }
      }
    }

    for (const container of containers) {
      if (consumed.has(container)) continue;
      ordered.push(container);
      consumed.add(container);
    }

    for (const container of ordered) {
      try {
        list.appendChild(container);
      } catch {}
    }
  }

  static refreshLocalBuildUiAfterSet(ids, set = null) {
    try {
      Build.updateHeroStats();
    } catch {}
    try {
      Build.renderCombatOrderBadges();
    } catch {}
    try {
      Build.syncCombatModeButtonState();
    } catch {}
    try {
      Build.rebuildFieldConflictFromInstalledTalents();
      Build.syncFieldSlotsFromInstalledTalents();
      Build.scheduleActiveBarRender(Array.isArray(Build.activeBarItems) ? Build.activeBarItems : new Array(24).fill(0));
      Build.ensureTalentIdsPresentInInventory(ids);
      Build.sortInventory();
      if (set) Build.applySetInventoryOrder(set);
    } catch {}
  }

  static rebuildFieldConflictFromInstalledTalents() {
    Build.fieldConflict = new Object();
    for (const talent of Build.installedTalents || []) {
      if (!talent) continue;
      if ('conflict' in talent) {
        Build.fieldConflict[Math.abs(talent.id)] = true;
      }
    }
  }

  static syncFieldSlotsFromInstalledTalents() {
    // Один проход по DOM вместо 36 отдельных querySelector.
    const cellsByPosition = new Map();
    for (const el of Build.fieldView?.querySelectorAll?.('.build-hero-grid-item[data-position]') || []) {
      if (!cellsByPosition.has(el.dataset.position)) cellsByPosition.set(el.dataset.position, el);
    }
    for (let index = 0; index < 36; index++) {
      const cell = cellsByPosition.get(`${index}`);
      if (!cell) continue;
      const currentEl = cell.querySelector('.build-talent-item');
      const expectedTalent = Build.installedTalents?.[index] || null;
      const currentId = currentEl ? Number(currentEl.dataset.id) : null;
      const expectedId = expectedTalent ? Number(expectedTalent.id) : null;
      if (currentEl && expectedTalent && currentId === expectedId) continue;
      if (currentEl) {
        try {
          currentEl.remove();
        } catch {}
      }
      if (!expectedTalent) continue;
      const view = Build.templateViewTalent({ ...expectedTalent, state: 2 });
      const preload = new PreloadImages(cell);
      preload.add(view, cell);
    }
  }

  static ensureTalentIdsPresentInInventory(ids) {
    const list = Build.inventoryView?.querySelector('.build-talents');
    if (!list || !Array.isArray(ids)) return;
    const normalizeId = (v) => {
      const n = Number(v);
      if (Number.isFinite(n)) return `${n}`;
      return `${v}`;
    };
    const existing = new Map();
    for (const item of Array.from(list.querySelectorAll('.build-talent-item'))) {
      const id = item?.dataset?.id;
      if (!id) continue;
      const key = normalizeId(id);
      const container = item.closest('.build-talent-item-container');
      if (!container) continue;
      if (existing.has(key)) {
        try { container.remove(); } catch {}
        continue;
      }
      existing.set(key, container);
    }
    const uniqueIds = new Set((ids || []).map((id) => normalizeId(id)));
    for (const key of uniqueIds) {
      if (Build.isTalentInBuild(key)) continue;
      if (existing.has(key)) continue;
      const data = Build.talents?.[key] || Build.talents?.[String(key)];
      if (!data) continue;
      const talentContainer = DOM({ style: 'build-talent-item-container' });
      const preload = new PreloadImages(talentContainer);
      const talentView = Build.templateViewTalent({ ...data, state: 1 });
      preload.add(talentView);
      list.append(talentContainer);
      Build.attachDefaultOrderDatasetToInventoryContainer(talentContainer);
      existing.set(key, talentContainer);
    }
  }

  static refreshForcedSetOnlyTalentIds() {
    if (!Build._forceShowOnlySetTalentIds) {
      // Без активного сета не держим «остаток» — иначе после Alt/sortInventory остаётся устаревший фильтр.
      Build._forceShowOnlyTalentIds = null;
      return;
    }
    const leftovers = new Set();
    for (const id of Build._forceShowOnlySetTalentIds) {
      if (Build.isTalentInBuild(id)) continue;
      leftovers.add(String(id));
    }
    Build._forceShowOnlyTalentIds = leftovers;
  }

  static attachAltResetHintBelowInventory() {
    try {
      const hint = Build.altResetHintView;
      const inv = Build.inventoryView;
      const parent = inv?.parentElement;
      if (!hint || !inv || !parent) {
        requestAnimationFrame(() => Build.attachAltResetHintBelowInventory());
        return;
      }
      if (hint.parentNode !== parent || hint.previousSibling !== inv) {
        inv.insertAdjacentElement('afterend', hint);
      }
    } catch {}
  }

  static resetSetForcedLibraryView() {
    Build._forceShowTalentIds = null;
    Build._forceShowOnlySetTalentIds = null;
    Build._forceShowOnlyTalentIds = null;
    Build.clearSelectedSetItem();
    try {
      Build._descriptionPinnedBySet = false;
      Build._hoveredSetTalentIds = null;
      Build._hoveredSetAnchorEl = null;
      Build.clearSetHighlights();
      Build.clearEmptySlotPreviews();
      if (Build.descriptionView) Build.descriptionView.style.display = 'none';
    } catch {}
    try {
      Build._regroupInventoryBySetsOnNextSort = true;
      Build.sortInventory();
    } catch {}
  }

  static installAltResetHandler() {
    try {
      if (Build._altResetHandler) {
        window.removeEventListener('keydown', Build._altResetHandler, true);
      }
    } catch {}

    Build._altResetHandler = (e) => {
      const isAlt = e?.key === 'Alt' || e?.code === 'AltLeft' || e?.code === 'AltRight';
      if (!isAlt || e?.repeat) return;
      Build.resetSetForcedLibraryView();
    };

    try {
      window.addEventListener('keydown', Build._altResetHandler, true);
    } catch {}
  }

  static installHeroNavKeyboardHandler() {
    try {
      if (Build._heroNavKeyboardHandler) {
        window.removeEventListener('keydown', Build._heroNavKeyboardHandler, true);
      }
      if (Build._heroNavKeyboardUpHandler) {
        window.removeEventListener('keyup', Build._heroNavKeyboardUpHandler, true);
      }
      if (Build._heroNavKeyboardBlurHandler) {
        window.removeEventListener('blur', Build._heroNavKeyboardBlurHandler, true);
      }
    } catch {}

    const HOLD_DELAY_MS = 800;
    const REPEAT_INTERVAL_MS = 50;
    const sleep = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    const syncStoppedHeroAfterRepeat = async () => {
      const syncToken = (Number(Build._heroNavStopSyncToken) || 0) + 1;
      Build._heroNavStopSyncToken = syncToken;
      if (Window.windows?.main?.id !== 'wbuild') return;

      // Non-awaited Window.show calls from hold-repeat can finish out of order.
      // Re-assert the final highlighted hero a few times after key release.
      await sleep(120);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (Build._heroNavStopSyncToken !== syncToken) return;
        if (Window.windows?.main?.id !== 'wbuild') return;
        const wantedHeroId = Number(View.castleOpenedBuildHeroId);
        if (!Number.isFinite(wantedHeroId) || wantedHeroId <= 0) return;

        try {
          await Window.show('main', 'build', wantedHeroId, 0, true);
        } catch {}
        if (Build._heroNavStopSyncToken !== syncToken) return;

        if (Number(Build.heroId) === wantedHeroId) {
          await sleep(140);
          if (Build._heroNavStopSyncToken !== syncToken) return;
          if (Number(Build.heroId) === wantedHeroId) return;
        } else {
          await sleep(120);
        }
      }
    };
    const stopHeroNavRepeat = (syncAfterStop = false) => {
      const hadRepeat = !!Build._heroNavKeyboardRepeatTimer;
      try {
        if (Build._heroNavKeyboardHoldTimer) clearTimeout(Build._heroNavKeyboardHoldTimer);
      } catch {}
      try {
        if (Build._heroNavKeyboardRepeatTimer) clearInterval(Build._heroNavKeyboardRepeatTimer);
      } catch {}
      Build._heroNavKeyboardHoldTimer = 0;
      Build._heroNavKeyboardRepeatTimer = 0;
      Build._heroNavHeldCode = '';
      if (syncAfterStop && hadRepeat) {
        void syncStoppedHeroAfterRepeat();
      }
    };
    const getHeroNavCode = (e) => {
      const code = String(e?.code || '');
      if (code === 'KeyA' || code === 'KeyD') return code;
      const key = String(e?.key || '').toLowerCase();
      if (key === 'a') return 'KeyA';
      if (key === 'd') return 'KeyD';
      return '';
    };
    const isSplashOpened = () => Splash.body && getComputedStyle(Splash.body).display !== 'none';
    const canUseHeroNavHotkey = (e) => {
      if (Window.windows?.main?.id !== 'wbuild') return false;
      if (isSplashOpened()) return false;
      if (e?.ctrlKey || e?.metaKey || e?.altKey || e?.shiftKey) return false;
      const activeEl = document.activeElement;
      const activeTag = String(activeEl?.tagName || '').toUpperCase();
      const isTypingTarget =
        activeEl?.isContentEditable ||
        activeTag === 'INPUT' ||
        activeTag === 'TEXTAREA' ||
        activeTag === 'SELECT';
      if (isTypingTarget) return false;
      return true;
    };
    const switchHeroSafe = async (dir, waitForRender = true) => {
      if (waitForRender && Build._heroNavKeyboardBusy) return;
      if (isSplashOpened()) {
        stopHeroNavRepeat(false);
        return;
      }
      if (Window.windows?.main?.id !== 'wbuild') {
        stopHeroNavRepeat(false);
        return;
      }
      if (waitForRender) Build._heroNavKeyboardBusy = true;
      try {
        await Build.switchHeroFromCastleBottomList(dir, waitForRender, true);
      } finally {
        if (waitForRender) Build._heroNavKeyboardBusy = false;
      }
    };

    Build._heroNavKeyboardHandler = async (e) => {
      const navCode = getHeroNavCode(e);
      if (!navCode || e?.repeat) return;
      if (!canUseHeroNavHotkey(e)) {
        stopHeroNavRepeat();
        return;
      }

      const dir = navCode === 'KeyA' ? -1 : 1;
      if (Build._heroNavHeldCode === navCode) {
        e.preventDefault?.();
        return;
      }

      stopHeroNavRepeat(false);
      Build._heroNavHeldCode = navCode;
      e.preventDefault?.();
      await switchHeroSafe(dir);
      if (isSplashOpened()) {
        stopHeroNavRepeat(false);
        return;
      }

      Build._heroNavKeyboardHoldTimer = setTimeout(() => {
        if (Build._heroNavHeldCode !== navCode) return;
        if (isSplashOpened()) {
          stopHeroNavRepeat(false);
          return;
        }
        Build._heroNavKeyboardRepeatTimer = setInterval(() => {
          if (Build._heroNavHeldCode !== navCode) return;
          if (isSplashOpened()) {
            stopHeroNavRepeat(false);
            return;
          }
          void switchHeroSafe(dir, false);
        }, REPEAT_INTERVAL_MS);
      }, HOLD_DELAY_MS);
    };
    Build._heroNavKeyboardUpHandler = (e) => {
      const navCode = getHeroNavCode(e);
      if (!navCode) return;
      if (Build._heroNavHeldCode === navCode) {
        stopHeroNavRepeat(true);
      }
    };
    Build._heroNavKeyboardBlurHandler = () => {
      stopHeroNavRepeat(true);
    };

    try {
      window.addEventListener('keydown', Build._heroNavKeyboardHandler, true);
      window.addEventListener('keyup', Build._heroNavKeyboardUpHandler, true);
      window.addEventListener('blur', Build._heroNavKeyboardBlurHandler, true);
    } catch {}
  }

  static cancelSortInventory() {
    Build.ruleSortInventory = new Object();
    Build.syncRarityFilterVisuals();
    Build.syncLevelButtons();

    for (let item of Build.inventoryView.children) {
      item.style.display = 'block';
    }
  }

  static move(element, fromActiveBar) {
    let elementFromPoint = (x, y) => {
      let elems = document.elementsFromPoint(x, y);
      if (!elems || elems.length === 0) return document.body;
      if (elems[0]?.classList?.contains('build-level')) return elems[1] || elems[0];
      return elems[0] || document.body;
    };
    let elementSetDisplay = (element, display) => {
      if (element.parentElement?.classList.contains('build-talent-item-container')) {
        element.parentElement.style.display = display;
      }
      element.style.display = display;
    };

    element.onmousedown = (event) => {
      if (event.button != 0) return;
      if (Build.combatModeEnabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const isInventoryTalent = !fromActiveBar && !!element.closest?.('.build-talents');
      if (isInventoryTalent && !Build.consumeLibraryTalentClickCooldown()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      // ЛКМ по переключателю смарткаста (правый нижний угол слота) меняет смарткаст, как ПКМ,
      // и сам талант не трогает: не поднимается и не переносится.
      const activeSlot = fromActiveBar ? element.parentElement : null;
      if (activeSlot?.classList.contains('build-active-bar-item') && Build.canSmartcastSlot(activeSlot) &&
        Build.isOverSmartcastIndicator(activeSlot, event.clientX, event.clientY)) {
        event.preventDefault();
        event.stopPropagation();
        const toggle = activeSlot.dataset.active == 1 ? Build.disableSmartCast : Build.enableSmartCast;
        toggle(activeSlot, true).catch((error) => App.error(error));
        activeSlot.dispatchEvent(new MouseEvent('mousemove', { clientX: event.clientX, clientY: event.clientY }));
        return;
      }

      let moveStart = Date.now();
      // Drag start should always dismiss talent/set description overlays.
      // Fast cursor moves can skip mouseout and leave expensive hover-refresh logic active.
      Build._isDraggingTalent = true;
      Build._hoveredDescriptionTalentEl = null;
      Build._descriptionPinnedBySet = false;
      Build._hoveredSetTalentIds = null;
      Build._hoveredSetAnchorEl = null;
      if (Build.descriptionView) Build.descriptionView.style.display = 'none';
      Build.clearBuildRowHoverHighlight();
      Build.clearSetHighlights();
      Build.clearEmptySlotPreviews();

      if (!Build._hoveredSetTalentIds) Build.clearSetHighlights();
      try {
        const hadStatHover = element.classList.contains('build-stat-filter-hover');
        element.classList.remove('build-set-highlight', 'build-set-highlight-lib', 'build-stat-filter-hover');
        if (hadStatHover) Build.refreshStatFilterHighlightCountDisplay();
      } catch {}

      let data = Build.talents[element.dataset.id];
      if (!data || typeof data.level !== 'number') {
        return;
      }
      let fieldRow = document.getElementById(`bfr${data.level}`);

      if (!fromActiveBar) {
        // Ряд таланта подсвечиваем так же, как при наведении (градиент), а не белой заливкой.
        fieldRow?.classList.add('build-field-row--drag-source');
      }

      // Фикс для transform
      element.style.transformOrigin = 'center center';
      element.style.willChange = 'transform';
      element.style.setProperty('transform', 'scale(1.1)', 'important');
      element.style.transition = 'transform 0.1s ease';

      let shiftX = 0;
      let shiftY = 0;

      const startRect = element.getBoundingClientRect();
      shiftX = event.clientX - startRect.left;
      shiftY = event.clientY - startRect.top;

      element.style.zIndex = '9999';
      // Ряды поля изолированы (isolation: isolate), колонка библиотеки — z-index 5: обе лежат
      // под панелью активных. На время переноса поднимаем исходную колонку, иначе талант уходит под панель.
      // Ряд таланта тоже поднимаем над соседними: иначе следующие по DOM ряды (уровнем ниже)
      // рисуются поверх, а заодно браузеру приходится каждый кадр перекладывать слои над талантом.
      const dragLiftHosts = [element.closest('.build-field-container, .build-right'), element.closest('.build-field-row')]
        .filter(Boolean);
      for (const host of dragLiftHosts) host.classList.add('build-drag-lift');
      // Замок под окном билда на время переноса не перерисовываем — на слабых видеокартах
      // он съедает кадр, и талант отстаёт от курсора.
      Castle.toggleRender(Castle.RENDER_LAYER_BUILD_DRAG, false);
      // Смарткаст «поднимаем» вместе с талантом: в слоте рамка гаснет, на таланте — подсветка.
      const liftedSmartcastSlot =
        fromActiveBar && element.parentElement?.classList?.contains('smartcast') ? element.parentElement : null;
      if (liftedSmartcastSlot) {
        liftedSmartcastSlot.dataset.smartcastLifted = '1';
        element.classList.add('build-talent-drag-smartcast');
      }
      const dropLiftedSmartcast = () => {
        element.classList.remove('build-talent-drag-smartcast');
        if (liftedSmartcastSlot) delete liftedSmartcastSlot.dataset.smartcastLifted;
      };
      element.style.position = 'fixed';
      element.style.left = event.clientX - shiftX + 'px';
      element.style.top = event.clientY - shiftY + 'px';

      // Во время перетаскивания двигаем через CSS translate (композитор, без layout),
      // не чаще одного раза за кадр. На mouseup переносим итог обратно в left/top —
      // дальше вся логика броска работает как раньше.
      const dragBaseLeft = event.clientX - shiftX;
      const dragBaseTop = event.clientY - shiftY;
      let dragLeft = dragBaseLeft;
      let dragTop = dragBaseTop;
      let dragRaf = 0;
      const applyDragPosition = () => {
        dragRaf = 0;
        element.style.translate = `${dragLeft - dragBaseLeft}px ${dragTop - dragBaseTop}px`;
        // Крестики появляются с первым движением, а не на клике.
        Build.showFieldDividers(dragLeft + shiftX, dragTop + shiftY);
      };
      const commitDragPosition = () => {
        if (dragRaf) cancelAnimationFrame(dragRaf);
        dragRaf = 0;
        element.style.translate = '';
        element.style.left = dragLeft + 'px';
        element.style.top = dragTop + 'px';
      };

      elementSetDisplay(element, 'none');
      let startingElementBelow = elementFromPoint(event.clientX, event.clientY);
      elementSetDisplay(element, 'block');

      document.onmousemove = (e) => {
        dragLeft = e.clientX - shiftX;
        dragTop = e.clientY - shiftY;
        if (!dragRaf) dragRaf = requestAnimationFrame(applyDragPosition);
      };

      // mouseup может прийти не на талант: курсор обогнал его (позиция обновляется раз в кадр)
      // или над ним другой слой. Тогда бросок ловим на документе — иначе талант «прилипает» к курсору.
      const onDocumentMouseUp = (e) => {
        document.removeEventListener('mouseup', onDocumentMouseUp);
        if (typeof element.onmouseup === 'function') element.onmouseup(e);
      };
      document.addEventListener('mouseup', onDocumentMouseUp);

      element.onmouseup = async (event) => {
        // До любых cloneNode: класс подсветки не должен попасть в копии.
        dropLiftedSmartcast();
        commitDragPosition();
        Build.hideFieldDividers();
        for (const host of dragLiftHosts) host.classList.remove('build-drag-lift');
        Castle.toggleRender(Castle.RENDER_LAYER_BUILD_DRAG, true);
        Build._isDraggingTalent = false;
        // Точка броска (для анимаций в панели активных) и флаг «не возвращать оригинал полётом».
        let dropPointRect = null;
        try {
          dropPointRect = element.getBoundingClientRect();
        } catch {}
        let skipReturnAnimation = false;
        const finishDragVisualState = () => {
          // Плавно «сажаем» талант с точки броска на итоговое место.
          let dropRect = null;
          try {
            if (element.style.position === 'fixed' && !skipReturnAnimation) dropRect = element.getBoundingClientRect();
          } catch {}
          fieldRow?.classList.remove('build-field-row--drag-source');
          element.style.position = 'static';
          element.style.zIndex = 'auto';
          element.style.left = '';
          element.style.top = '';
          element.style.translate = '';
          element.style.transition = '';
          element.style.willChange = '';
          element.style.transformOrigin = '';
          element.style.removeProperty('transform');
          if (dropRect) Build.animateTalentMove(element, dropRect, 180);
        };

        // Возвращаем исходный размер
        element.style.setProperty('transform', 'scale(1)', 'important');

        let moveEnd = Date.now();
        let isClick = moveEnd - moveStart < 200;

        document.onmousemove = null;
        element.onmouseup = null;

        let field = Build.fieldView.getBoundingClientRect();
        let inventory = Build.inventoryView.getBoundingClientRect();
        let bar = Build.activeBarView.getBoundingClientRect();
        let target = element.getBoundingClientRect();

        let left = parseInt(element.style.left) + target.width / 2;
        let top = parseInt(element.style.top) + target.height / 2;

        let isFieldTarget = left > field.x && left < field.x + field.width && top > field.y && top < field.y + field.height;
        let isInventoryTarget =
          left > inventory.x && left < inventory.x + inventory.width && top > inventory.y && top < inventory.y + inventory.height;
        let isActiveBarTarget = left > bar.x && left < bar.x + bar.width && top > bar.y && top < bar.y + bar.height;

        if (isClick && (isFieldTarget || (isActiveBarTarget && fromActiveBar))) {
          elementSetDisplay(element, 'none');
          let elemBelow = elementFromPoint(event.clientX, event.clientY);
          elementSetDisplay(element, 'block');
          isClick = elemBelow == startingElementBelow;
        }
        if (isClick) {
          if (element.dataset.state == 2) {
            isFieldTarget = false;
            isInventoryTarget = true;
            isActiveBarTarget = false;
          } else if (element.dataset.state == 1 && data.level > 0) {
            let hasEmptySpace = false;
            for (let t = (data.level - 1) * 6; t < data.level * 6; t++) {
              if (!Build.installedTalents[35 - t]) {
                hasEmptySpace = true;

                break;
              }
            }
            if (hasEmptySpace) {
              isFieldTarget = true;
              isInventoryTarget = false;
              isActiveBarTarget = false;
            }
          }
        }

        // Талант из билда, брошенный мимо поля и панели активных (на статы, за окно), снимаем
        // в библиотеку — так же, как бросок на неё или клик.
        const droppedOutsideBuild =
          !isClick && !fromActiveBar && Number(element.dataset.state) === 2 &&
          !isFieldTarget && !isActiveBarTarget && !isInventoryTarget;
        if (droppedOutsideBuild) isInventoryTarget = true;

        const sourceState = Number(element.dataset.state);
        const sourceIsInventory = !fromActiveBar && sourceState === 1;
        const sourceIsBuild = !fromActiveBar && sourceState === 2;
        const isClickTransferBetweenBuildAndLibrary =
          isClick && ((sourceIsInventory && isFieldTarget) || (sourceIsBuild && isInventoryTarget));

        let postMoveNeedSort = true;

        if (Build._hoveredSetTalentIds) {
          Build.highlightSetTalents(Build._hoveredSetTalentIds);
          Build.previewSetTalentsInEmptySlots({ _manualOrder: Build._hoveredSetTalentIds, key: 'hover_preview_move' });
        }
        else Build.clearSetHighlights();

        // No-op case: talent was dragged inside library and released in library.
        // Snap it back immediately, without waiting for heavy post-drop logic.
        if (!fromActiveBar && element.dataset.state == 1 && isInventoryTarget) {
          Build.schedulePostMoveUiRefresh({ needSort: false });
          finishDragVisualState();
          try {
            const hovered = document.elementFromPoint(event.clientX, event.clientY);
            const hoveredTalent = hovered?.closest?.('.build-talent-item');
            if (hoveredTalent) {
              requestAnimationFrame(() => {
                try {
                  hoveredTalent.dispatchEvent(
                    new MouseEvent('mouseover', {
                      bubbles: true,
                      clientX: event.clientX,
                      clientY: event.clientY,
                    }),
                  );
                } catch {}
              });
            }
          } catch {}
          return;
        }

        let removeFromActive = async (position, skipActiveId) => {
          for (let i = 0; i < Build.activeBarItems.length; i++) {
            const talPos = Math.abs(Build.activeBarItems[i]) - 1;
            if (talPos == position && i != skipActiveId) {
              await Build.removeTalentFromActive(i);
            }
          }
        };

        let addToActive = async (index, position, datasetPosition, targetElem, clone, smartCast, deferRequest = false) => {
          Build.assignActiveSlotLocal(index, position);
          targetElem.append(clone);
          clone.style.position = 'static';
          clone.style.zIndex = 1;

          clone.dataset.position = datasetPosition;
          clone.dataset.state = 3;
          clone.style.opacity = 1;
          clone.style.zIndex = 1;
          clone.style.position = 'static';

          Build.move(clone, true);

          if (smartCast) {
            try {
              await Build.enableSmartCast(targetElem, false);
            } catch {}
          }

          if (!deferRequest) {
            try {
              await Build.sendBuildMutationOrThrow({
                optimisticMethod: 'optimisticSetActive',
                legacyMethod: 'setActive',
                data: {
                  buildId: Build.id,
                  index: index,
                  position: position,
                },
              });
              if (smartCast) {
                try {
                  await Build.requestSmartcast(targetElem);
                } catch {}
              }
            } catch {
              try {
                await Build.refreshBuildStateFromServer({ refreshInventory: true });
              } catch {}
            }
          }
        };

        let editActive = async (position, newPosition, clone, skipActiveId, deferRequest = false) => {
          if (position == newPosition) {
            clone.remove();
            return null;
          }

          let activeBarPosition = -1;
          for (let i = 0; i < Build.activeBarItems.length; i++) {
            const talPos = Math.abs(Build.activeBarItems[i]) - 1;
            if (talPos == position && i != skipActiveId) {
              activeBarPosition = i;
              break;
            }
          }
          if (activeBarPosition == -1) {
            clone.remove();
            return null;
          }

          let container = Build.activeBarView.childNodes[activeBarPosition];

          let isSmartCast = Number(container.dataset.active);

          let activePosition = Number(newPosition) + 1;

          let glone = container.firstChild.cloneNode(true);

          await removeFromActive(position, skipActiveId);

          await addToActive(activeBarPosition, activePosition, newPosition, container, clone, isSmartCast, deferRequest);

          return { index: Number(activeBarPosition), smartCast: Number(isSmartCast) };
        };

        if (isFieldTarget && !fromActiveBar) {
          elementSetDisplay(element, 'none');

          let elemBelow = elementFromPoint(event.clientX, event.clientY);
          // Поверх поля может лежать чужой слой — берём верхний элемент именно из поля.
          if (elemBelow && !Build.fieldView?.contains(elemBelow)) {
            try {
              const inField = document
                .elementsFromPoint(event.clientX, event.clientY)
                .find((el) => Build.fieldView.contains(el) && el !== element && !element.contains(el) && el.className != 'build-level');
              if (inField) elemBelow = inField;
            } catch {}
          }

          if (elemBelow.childNodes[0]?.classList?.contains('build-talent-item')) {
            // Select 'build-talent-item' if selected its parent
            elemBelow = elemBelow.childNodes[0];
          }

          let swapParentNode = element.parentNode;
          let performSwap = false;
          let performSwapFromLibrary = false;

          if (elemBelow.classList?.contains('build-talent-item') && elemBelow.parentElement?.classList.contains('build-hero-grid-item')) {
            elemBelow = elemBelow.parentElement;
            performSwap = (swapParentNode?.dataset?.position !== undefined);
            performSwapFromLibrary = !performSwap;
          }

          if (isClick && data.level > 0) {
            let talentsInRow = document.getElementsByClassName('build-field-row')[6 - data.level].childNodes;
            for (let tal in talentsInRow) {
              if (talentsInRow[tal].childNodes.length == 0) {
                elemBelow = talentsInRow[tal];
                break;
              }
            }
          }

          elementSetDisplay(element, 'block');

          if (elemBelow?.classList?.contains('build-hero-grid-item')) {
            if (data.level && elemBelow.parentNode.dataset.level == data.level) {
              const targetPosition = Number(elemBelow.dataset.position);
              const conflictMatches = Build.getTalentConflictMatches(data, Build.installedTalents);
              const allowConflictReplacement =
                performSwapFromLibrary &&
                Number.isFinite(targetPosition) &&
                conflictMatches.length === 1 &&
                conflictMatches[0].index === targetPosition;
              let conflictState = conflictMatches.length > 0 && !allowConflictReplacement;
              if (conflictState) Build.notifyTalentConflict();

              if (!conflictState) {
                if ('conflict' in data) {
                  Build.fieldConflict[Math.abs(data.id)] = true;
                }

                let prevState = element.dataset.state;
                element.dataset.state = 2;

                let swappingTal = null;
                let removeContainerAfterMove = false;
                if (performSwap) {
                  swappingTal = Build.installedTalents[parseInt(swapParentNode.dataset.position)];
                  let swappedTal = Build.installedTalents[parseInt(elemBelow.dataset.position)];
                  Build.installedTalents[parseInt(elemBelow.dataset.position)] = swappingTal;
                  Build.installedTalents[parseInt(swapParentNode.dataset.position)] = swappedTal;

                  const displacedNode = elemBelow.firstChild;
                  const displacedRect = displacedNode?.getBoundingClientRect?.();
                  swapParentNode.append(displacedNode);
                  elemBelow.append(element);
                  Build.animateTalentMove(displacedNode, displacedRect);
                  // Active bar keeps clones, so force immediate redraw after field swap.
                  Build.scheduleActiveBarRender(Array.isArray(Build.activeBarItems) ? Build.activeBarItems : new Array(24).fill(0));
                } else {
                  if (performSwapFromLibrary) {
                    swappingTal = Build.installedTalents[parseInt(elemBelow.dataset.position)];
                    if (Build.isMainHeroClassTalent(swappingTal)) {
                      App.notify(Lang.text('mainHeroClassTalentLocked'));
                      elementSetDisplay(element, 'block');
                      fieldRow?.classList.remove('build-field-row--drag-source');
                      element.style.position = 'static';
                      element.style.zIndex = 'auto';
                      return;
                    }
                  }
                  Build.installedTalents[parseInt(elemBelow.dataset.position)] = data;
                  Build.installedTalents[parseInt(swapParentNode.dataset.position)] = null;

                  const replacedNode = performSwapFromLibrary ? elemBelow.firstChild : null;
                  const replacedRect = replacedNode?.getBoundingClientRect?.();
                  elemBelow.append(element);
                  if (performSwapFromLibrary) {
                    swapParentNode.prepend(elemBelow.firstChild);
                    if (replacedNode && replacedNode.parentNode === swapParentNode) {
                      Build.animateTalentMove(replacedNode, replacedRect);
                    }
                  } else {
                    if (swapParentNode.classList.contains('build-talent-item-container')) {
                      removeContainerAfterMove = true;
                    }
                  }
                }

                try {
                  let activeBarMove = null;
                  if (!performSwap && data.active && swapParentNode?.dataset?.position !== undefined) {
                    activeBarMove = await editActive(
                      swapParentNode.dataset.position,
                      elemBelow.dataset.position,
                      element.cloneNode(true),
                      undefined,
                      true,
                    );
                  }
                  if (performSwap) {
                    const oldPos = Number(swapParentNode.dataset.position);
                    const newPos = Number(elemBelow.dataset.position);
                    const activeChanged = Build.remapActiveBarAfterSwap(oldPos, newPos);
                    // Оба таланта в панели: смарткаст переезжает вместе с талантом.
                    const smartcastSwapped = !activeChanged && Build.swapActiveSmartcastAfterBothSwap(oldPos, newPos);
                    if (activeChanged || smartcastSwapped) {
                      Build.scheduleActiveBarRender(Array.isArray(Build.activeBarItems) ? Build.activeBarItems : new Array(24).fill(0));
                    }
                    await Build.sendBuildMutationOrThrow({
                      optimisticMethod: 'optimisticSwap',
                      legacyMethod: 'swap',
                      data: {
                        buildId: Build.id,
                        i1: Number(swapParentNode.dataset.position),
                        i2: Number(elemBelow.dataset.position),
                      },
                    });

                    Build.setStat(data, true, false);
                  } else {
                    if (performSwapFromLibrary) {
                      if (swappingTal.active) {
                        await removeFromActive(elemBelow.dataset.position);
                      }
                      swapParentNode.firstChild.dataset.state = 1;
                      await Build.sendBuildMutationOrThrow({
                        optimisticMethod: 'optimisticRemove',
                        legacyMethod: 'setZero',
                        data: {
                          buildId: Build.id,
                          index: elemBelow.dataset.position,
                        },
                      });
                    }
                    Build.setStat(data, true);
                  }

                  if (!performSwap) {
                    await Build.sendBuildMutationOrThrow({
                      optimisticMethod: 'optimisticSet',
                      legacyMethod: 'set',
                      data: {
                        buildId: Build.id,
                        talentId: data.id,
                        index: elemBelow.dataset.position,
                      },
                    });

                    if (activeBarMove && Number.isFinite(activeBarMove.index) && activeBarMove.index >= 0) {
                      const nextPosition = Number(elemBelow.dataset.position) + 1;
                      await Build.sendBuildMutationOrThrow({
                        optimisticMethod: 'optimisticSetActive',
                        legacyMethod: 'setActive',
                        data: {
                          buildId: Build.id,
                          index: activeBarMove.index,
                          position: nextPosition,
                        },
                      });
                      if (Number(activeBarMove.smartCast)) {
                        const targetContainer = Build.activeBarView?.childNodes?.[activeBarMove.index];
                        if (targetContainer) {
                          try {
                            await Build.requestSmartcast(targetContainer);
                          } catch {}
                        }
                      }
                    }
                  }

                  if (data.active && prevState != element.dataset.state) {
                    let index = -1;
                    for (let i = 0; i < Build.activeBarItems.length; i++) {
                      if (Build.activeBarItems[i] == 0) {
                        index = i;
                        break;
                      }
                    }
                    if (index != -1) {
                      let targetActiveContainer = Build.activeBarView.childNodes[index];
                      await addToActive(
                        index,
                        Number(elemBelow.dataset.position) + 1,
                        elemBelow.dataset.position,
                        targetActiveContainer,
                        element.cloneNode(true),
                      );
                    }
                  }
                } catch (e) {
                  element.dataset.state = 1;

                  const invList = Build.inventoryView?.querySelector('.build-talents');
                  if (invList) {
                    const container = element.closest('.build-talent-item-container');
                    if (container && container.parentNode) {
                      invList.prepend(container);
                    } else {
                      const wrapped = DOM({ style: 'build-talent-item-container' }, element);
                      Build.attachDefaultOrderDatasetToInventoryContainer(wrapped);
                      Build.applySorting(wrapped);
                      invList.prepend(wrapped);
                    }
                  }

                  Build.installedTalents[parseInt(elemBelow.dataset.position)] = null;
                }

                if (removeContainerAfterMove) {
                  swapParentNode.remove();
                }
              }
            }
          }
        } else if (isInventoryTarget && !fromActiveBar) {
          elementSetDisplay(element, 'none');

          let elemBelow = elementFromPoint(event.clientX, event.clientY);

          if (isClick || droppedOutsideBuild) {
            elemBelow = document.getElementsByClassName('build-talents')[0].firstChild;
          }

          elementSetDisplay(element, 'block');

          let targetElement = elemBelow.parentNode;

          if (targetElement?.classList?.contains('build-talent-item-container')) {
            targetElement = targetElement.parentNode;
          }

          // classList, а не className: у библиотеки есть и другие классы (build-custom-scroll),
          // и точное сравнение не давало снять талант из билда вообще
          if (elemBelow && targetElement?.classList?.contains('build-talents') && element.dataset.state != 1) {
            let oldParentNode = element.parentNode;
            if (Build.isMainHeroClassTalent(data)) {
              App.notify(Lang.text('mainHeroClassTalentLocked'));
              elementSetDisplay(element, 'block');
              fieldRow?.classList.remove('build-field-row--drag-source');
              element.style.position = 'static';
              element.style.zIndex = 'auto';
              return;
            }

            element.dataset.state = 1;

            try {
              const duplicates = Array.from(
                targetElement.querySelectorAll(`.build-talent-item[data-id="${data.id}"]`)
              );
              for (const dup of duplicates) {
                if (dup === element) continue;
                const dupContainer = dup.closest('.build-talent-item-container');
                if (dupContainer) {
                  dupContainer.remove();
                } else {
                  dup.remove();
                }
              }
            } catch {}

            let containedTalent = DOM({ style: 'build-talent-item-container' }, element);
            Build.attachDefaultOrderDatasetToInventoryContainer(containedTalent);

            targetElement.prepend(containedTalent);
            // Возврат из билда в библиотеку должен оставаться "в первый слот" до следующей явной сортировки.
            postMoveNeedSort = false;

            try {
              if (data.active && oldParentNode?.dataset?.position !== undefined) {
                await removeFromActive(oldParentNode.dataset.position);
              }

              await Build.sendBuildMutationOrThrow({
                optimisticMethod: 'optimisticRemove',
                legacyMethod: 'setZero',
                data: {
                  buildId: Build.id,
                  index: oldParentNode.dataset.position,
                },
              });

              Build.installedTalents[parseInt(oldParentNode.dataset.position)] = null;
              Build.applySorting(containedTalent);

              Build.setStat(data, true);

              if ('conflict' in data) {
                delete Build.fieldConflict[Math.abs(data.id)];
              }
            } catch (e) {
              element.dataset.state = 2;

              oldParentNode.append(element);

              elementSetDisplay(element, 'block');

              containedTalent.remove();
            }
          }
        } else if (isActiveBarTarget) {
          elementSetDisplay(element, 'none');

          let elemBelow = elementFromPoint(event.clientX, event.clientY);

          // Слот ищем геометрически: поверх панели могут лежать другие слои (build-left и т.п.),
          // и elementFromPoint вернёт их вместо слота.
          {
            let slot = elemBelow?.closest?.('.build-active-bar-item');
            if (!slot || !Build.activeBarView?.contains(slot)) {
              slot = Build.findActiveBarSlotAt(event.clientX, event.clientY) || Build.findActiveBarSlotAt(left, top);
            }
            if (slot) {
              const occupant = slot.firstElementChild;
              elemBelow = occupant && occupant !== element ? occupant : slot;
            }
          }

          let isSwap = !!elemBelow?.parentNode?.classList?.contains('build-active-bar-item');

          elementSetDisplay(element, 'block');

          if (
            elemBelow &&
            (element.dataset.state == 2 || element.dataset.state == 3) &&
            (elemBelow.classList.contains('build-active-bar-item') || isSwap) &&
            data.active == 1
          ) {
            let index = elemBelow.dataset.index;
            let smartCast = Number(element.parentNode.dataset.active);
            let positionRaw = element.dataset.position;

            if (!positionRaw) {
              positionRaw = element.parentNode.dataset.position;
            }

            if (isSwap) {
              index = elemBelow.parentNode.dataset.index;
            }

            let position = Number(positionRaw) + 1;

            try {
              if (fromActiveBar) {
                let startingIndex = element.parentNode.dataset.index;
                if (isClick) {
                  Build.animateTalentVanish(element, element.parentNode?.getBoundingClientRect?.());
                  await removeFromActive(positionRaw);
                } else if (index != startingIndex) {
                  // moved to other position
                  let swapElemParent = element.parentNode;
                  let targetElem = isSwap ? elemBelow.parentNode : elemBelow;
                  let clone = element.cloneNode(true);
                  if (isSwap) {
                    const swapPositionRaw = elemBelow.dataset.position;
                    const swapPosition = Number(swapPositionRaw) + 1;
                    const swapSmartCast = Number(targetElem.dataset.active);
                    const swapClone = elemBelow.cloneNode(true);
                    const swapFromRect = Build.getTalentVisualRect(elemBelow);
                    const targetIndexNum = Number(index);
                    const startingIndexNum = Number(startingIndex);
                    const startPositionNum = Number(position);
                    const swapPositionNum = Number(swapPosition);
                    
                    if (
                      Number.isFinite(targetIndexNum) &&
                      Number.isFinite(startingIndexNum) &&
                      Number.isFinite(startPositionNum) &&
                      Number.isFinite(swapPositionNum) &&
                      startPositionNum > 0 &&
                      swapPositionNum > 0
                    ) {
                      // Atomic local swap without intermediate removals to avoid transient empty/duplicate states.
                      Build.clearActiveSlotLocal(startingIndexNum);
                      Build.clearActiveSlotLocal(targetIndexNum);
                      
                      // Смарткаст едет вместе с талантом: знак позиции = смарткаст.
                      const startSigned = smartCast ? -startPositionNum : startPositionNum;
                      const swapSigned = swapSmartCast ? -swapPositionNum : swapPositionNum;
                      Build.assignActiveSlotLocal(targetIndexNum, startSigned);
                      Build.assignActiveSlotLocal(startingIndexNum, swapSigned);
                      
                      clone.dataset.position = `${Number(positionRaw)}`;
                      clone.dataset.state = 3;
                      clone.style.opacity = 1;
                      clone.style.zIndex = 1;
                      clone.style.position = 'static';
                      Build.move(clone, true);
                      targetElem.append(clone);
                      
                      swapClone.dataset.position = `${Number(swapPositionRaw)}`;
                      swapClone.dataset.state = 3;
                      swapClone.style.opacity = 1;
                      swapClone.style.zIndex = 1;
                      swapClone.style.position = 'static';
                      Build.move(swapClone, true);
                      swapElemParent.append(swapClone);
                      
                      if (smartCast) await Build.enableSmartCast(targetElem, false);
                      else await Build.disableSmartCast(targetElem, false);
                      
                      if (swapSmartCast) await Build.enableSmartCast(swapElemParent, false);
                      else await Build.disableSmartCast(swapElemParent, false);

                      // После простановки смарткастов: призраки летят уже с нужной рамкой.
                      Build.animateTalentMove(clone, dropPointRect, 180);
                      Build.animateTalentMove(swapClone, swapFromRect);
                      
                      Build.sendBuildMutation({
                        optimisticMethod: 'optimisticSetActive',
                        legacyMethod: 'setActive',
                        data: {
                          buildId: Build.id,
                          index: targetIndexNum,
                          position: startSigned,
                        },
                      });
                      
                      Build.sendBuildMutation({
                        optimisticMethod: 'optimisticSetActive',
                        legacyMethod: 'setActive',
                        data: {
                          buildId: Build.id,
                          index: startingIndexNum,
                          position: swapSigned,
                        },
                      });
                    }
                  } else {
                    await removeFromActive(positionRaw);
                    const addPromise = addToActive(index, position, positionRaw, targetElem, clone, smartCast);
                    Build.animateTalentMove(clone, dropPointRect, 180);
                    await addPromise;
                  }
                }
              } else {
                let targetElem = isSwap ? elemBelow.parentNode : elemBelow;
                let clone = element.cloneNode(true);
                clone.dataset.position = element.parentNode.dataset.position;
                clone.dataset.state = 3;
                clone.style.opacity = 1;
                clone.style.zIndex = 1;
                clone.style.position = 'static';

                if (isSwap) {
                  Build.animateTalentVanish(elemBelow);
                  await removeFromActive(elemBelow.dataset.position);
                }
                // Если талант уже стоял в другом слоте — показываем, что он «уехал» оттуда.
                const previousActiveIndex = (Build.activeBarItems || []).findIndex(
                  (item, i) => Math.abs(Number(item) || 0) - 1 === Number(positionRaw) && String(i) !== String(index),
                );
                const previousActiveTalent =
                  previousActiveIndex >= 0 ? Build.activeBarView?.childNodes?.[previousActiveIndex]?.firstChild : null;
                const previousActiveRect = previousActiveTalent ? Build.getTalentVisualRect(previousActiveTalent) : null;
                await removeFromActive(positionRaw);
                await Build.sendBuildMutationOrThrow({
                  optimisticMethod: 'optimisticSetActive',
                  legacyMethod: 'setActive',
                  data: {
                    buildId: Build.id,
                    index: index,
                    position: position,
                  },
                });
                Build.assignActiveSlotLocal(index, position);

                Build.move(clone, true);

                targetElem.append(clone);
                // Новый слот: из старого слота (если был) или с точки броска; оригинал на поле
                // возвращаем без полёта, чтобы не было двух летящих иконок.
                Build.animateTalentMove(clone, previousActiveRect || dropPointRect, previousActiveRect ? undefined : 180);
                skipReturnAnimation = true;
              }
            } catch (e) {
              App.error('Failed to swap activebar');
            }
          }
        } else if (fromActiveBar) {
          Build.animateTalentVanish(element, dropPointRect);
          await removeFromActive(element.dataset.position);
        }

        Build.schedulePostMoveUiRefresh({ needSort: postMoveNeedSort });

        finishDragVisualState();

        const destinationState = Number(element.dataset.state);
        const didTransferBetweenBuildAndLibrary =
          !fromActiveBar && ((sourceState === 1 && destinationState === 2) || (sourceState === 2 && destinationState === 1));

        if (isClickTransferBetweenBuildAndLibrary || didTransferBetweenBuildAndLibrary) {
          Build._talentDescriptionSuppressedUntil = Date.now() + 220;
          Build.beginLibraryHoverSuppression(120);
          Build.cancelPendingInventorySetHover();
          if (Build.descriptionView) Build.descriptionView.style.display = 'none';
          Build._hoveredDescriptionTalentEl = null;
          Build.clearBuildRowHoverHighlight();
          Build.clearEmptySlotPreviews();
          if (!Build._hoveredSetTalentIds) Build.clearSetHighlights();
          return;
        }

        // If cursor stays over a talent after click/drag-end,
        // restore tooltip/row-highlight without requiring mouse movement.
        // Avoid expensive forced tooltip redraw on very frequent library clicks.
        if (!(isInventoryTalent && isClick)) {
          try {
            const hovered = document.elementFromPoint(event.clientX, event.clientY);
            const hoveredTalent = hovered?.closest?.('.build-talent-item');
            if (hoveredTalent) {
              hoveredTalent.dispatchEvent(
                new MouseEvent('mouseover', {
                  bubbles: true,
                  clientX: event.clientX,
                  clientY: event.clientY,
                }),
              );
            } else {
              if (Build.descriptionView) Build.descriptionView.style.display = 'none';
              Build._hoveredDescriptionTalentEl = null;
              Build.clearBuildRowHoverHighlight();
              Build.clearEmptySlotPreviews();
              if (!Build._hoveredSetTalentIds) Build.clearSetHighlights();
            }
          } catch {}
        }
      };
    };

    element.ondragstart = () => {
      return false;
    };
  }

  static highlightBuildRowByLevel(level) {
    Build.clearBuildRowHoverHighlight();
    const row = document.getElementById(`bfr${level}`);
    if (!row) return;
    row.classList.add('build-field-row--library-hover');
    Build._hoveredBuildRowEl = row;
  }

  static clearBuildRowHoverHighlight() {
    if (!Build._hoveredBuildRowEl) return;
    Build._hoveredBuildRowEl.classList.remove('build-field-row--library-hover');
    Build._hoveredBuildRowEl = null;
  }

  static consumeLibraryTalentClickCooldown() {
    const now = Date.now();
    const cooldownMs = Math.max(0, Number(Build.libraryTalentClickCooldownMs) || 0);
    if (cooldownMs <= 0) return true;
    if (now - Build._lastLibraryTalentClickAt < cooldownMs) return false;
    Build._lastLibraryTalentClickAt = now;
    return true;
  }

  static schedulePostMoveUiRefresh({ needSort = true } = {}) {
    if (needSort) Build._postMoveRefreshNeedSort = true;
    if (Build._postMoveRefreshRaf) return;

    Build._postMoveRefreshRaf = requestAnimationFrame(() => {
      Build._postMoveRefreshRaf = 0;
      const shouldSort = Build._postMoveRefreshNeedSort;
      Build._postMoveRefreshNeedSort = false;
      try {
        if (shouldSort) Build.sortInventory();
      } catch {}
      try {
        Build.updateHeroStats();
      } catch {}
      try {
        Build.syncCombatModeButtonState();
      } catch {}
    });
  }

  static scheduleLibraryDescriptionRender(renderFn) {
    if (typeof renderFn !== 'function') return;
    requestAnimationFrame(() => {
      try {
        renderFn();
      } catch {}
    });
  }

  static cancelPendingInventorySetHover() {
    try {
      if (Build._inventorySetHoverTimer) clearTimeout(Build._inventorySetHoverTimer);
    } catch {}
    Build._inventorySetHoverTimer = 0;
    Build._inventorySetHoverTalentId = null;
  }

  static applySetHoverForLibraryTalent(talentData) {
    let hasSetHover = !!Build._hoveredSetTalentIds;
    const numericTalentId = Number(talentData?.id);
    const canUseSetHoverForTalent = Number.isFinite(numericTalentId) && numericTalentId > 0;
    if (!hasSetHover && canUseSetHoverForTalent && Build.isBuildSetHoverOnTalentEnabled()) {
      const wantedId = numericTalentId;
      for (const set of TalentSets.list()) {
        const ids = TalentSets.getTalentIds(set);
        if (!Array.isArray(ids) || !ids.length) continue;
        if (!ids.some((id) => Number(id) === wantedId)) continue;
        let installedSetTalentsCount = 0;
        for (const id of ids) {
          if (Build.isTalentInBuild(id)) installedSetTalentsCount++;
        }
        const hoveredTalentInstalledInBuild = Build.isTalentInBuild(talentData.id);
        if (installedSetTalentsCount <= 1 && hoveredTalentInstalledInBuild) {
          Build.highlightSetTalentsInLibraryOnly(ids);
          hasSetHover = true;
          break;
        }
        Build.highlightSetTalents(ids);
        hasSetHover = true;
        break;
      }
    }
    return hasSetHover;
  }

  static scheduleInventorySetHoverEnhance(talentElement, talentData) {
    Build.cancelPendingInventorySetHover();
    const talentId = Number(talentData?.id);
    Build._inventorySetHoverTalentId = Number.isFinite(talentId) ? talentId : null;
    const waitMs = Math.max(0, Number(Build.inventorySetHoverDelayMs) || 0);
    Build._inventorySetHoverTimer = setTimeout(() => {
      Build._inventorySetHoverTimer = 0;
      if (Build._isDraggingTalent) return;
      if (Build._hoveredDescriptionTalentEl !== talentElement) return;
      if (!talentElement?.isConnected) return;
      if (Build._libraryHoverSuppressed) return;
      const currentHoveredId = Number(Build._hoveredDescriptionTalentEl?.dataset?.id);
      if (Number.isFinite(Build._inventorySetHoverTalentId) && currentHoveredId !== Build._inventorySetHoverTalentId) return;
      const hasSetHover = Build.applySetHoverForLibraryTalent(talentData);
      if (Build.isBuildRowHoverHighlightEnabled() && Number(talentData?.level) > 0) {
        Build.highlightBuildRowByLevel(talentData.level);
      }
      if (!hasSetHover) {
        Build.previewSetTalentsInEmptySlots(
          { _manualOrder: [talentData.id], key: `single_${talentData.id}` },
          'left',
          { previewClass: 'build-talent-empty-slot-preview' },
        );
      }
      Build._inventorySetHoverTalentId = null;
    }, waitMs);
  }

  static refreshActiveTalentDescription() {
    if (!Build.descriptionView) return;
    if (Build.descriptionView.style.display === 'none') return;
    if (Build._descriptionPinnedBySet) return;
    const activeTalentEl = Build._hoveredDescriptionTalentEl;
    if (!activeTalentEl || !activeTalentEl.isConnected) return;
    if (Build._libraryHoverSuppressed && activeTalentEl.closest?.('.build-talents')) return;
    try {
      activeTalentEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: false, cancelable: false, view: window }));
    } catch {}
  }

  static description(element) {
    let descEvent = () => {
      if (Date.now() < Number(Build._talentDescriptionSuppressedUntil || 0)) {
        if (Build.descriptionView) Build.descriptionView.style.display = 'none';
        return;
      }
      if (Build._isDraggingTalent) {
        if (Build.descriptionView) Build.descriptionView.style.display = 'none';
        return;
      }
      let positionElement = element.getBoundingClientRect();
      let data = Build.talents[element.dataset.id];
      const isInventoryTalent = !!element.closest?.('.build-talents');
      if (isInventoryTalent && Build._libraryHoverSuppressed) return;

      if (!data) {
        console.log('Не найден талант в билде: ' + element.dataset.id);
        Build.descriptionView.style.display = 'none';
        return;
      }

      // Определяем тип таланта и формируем ключи для перевода
      const isHeroTalent = data.id < 0;
      const prefix = isHeroTalent ? 'htalent_' : 'talent_';
      const absId = Math.abs(data.id);

      const nameKey = `${prefix}${absId}_name`;
      const descriptionKey = `${prefix}${absId}_description`;

      let hasSetHover = !!Build._hoveredSetTalentIds;
      if (isInventoryTalent) {
        // Library hover gets an extra delayed pass for expensive set highlighting.
        // This avoids spikes during rapid cursor movement.
        Build.scheduleInventorySetHoverEnhance(element, data);
      } else {
        hasSetHover = Build.applySetHoverForLibraryTalent(data);
      }

      // Получаем переводы из системы Lang
      const name = Lang.text(nameKey);
      const description = Lang.text(descriptionKey);

      // Проверяем, есть ли переводы (если вернулся ключ, значит перевода нет)
      if (name === nameKey || description === descriptionKey) {
        Build.renderDescriptionHtml({
          html: `<b>Талант #${data.id}</b><div>Информация отсутствует. Сообщите пожалуйста об этом в отдельную тему Telegram сообщества Prime World Classic.</div><span>+1000 Уважение</span>`,
          anchorRect: positionElement,
        });
        return;
      }

      let rgb = '';
      switch (data.rarity) {
        case 1:
          rgb = '17,105,237';
          break;
        case 2:
          rgb = '205,0,205';
          break;
        case 3:
          rgb = '237,129,5';
          break;
        case 4:
          rgb = '170,20,44';
          break;
      }

      let stats = '';
      if ('stats' in data && data.stats) {
        for (let key in data.stats) {
          if (Build.talentStatFilter(key)) {
            continue;
          }

          let statValue = parseFloat(data.stats[key]);

          if ('statsRefine' in data && 'rarity' in data) {
            let refineBonus = Build.getTalentRefineByRarity(data.rarity);
            let refineMul = parseFloat(data.statsRefine[key]);
            statValue += refineBonus * refineMul;
          }

          const v = Math.floor(statValue * 10.0) / 10.0;
          if (key == 'speedtal' || key == 'speedtalrz' || key == 'speedtalvz') {
            if (Math.abs(v) < 1e-9) {
              stats += `0 ${Lang.text(key)}<br>`;
            } else {
              stats += `-${Math.abs(v)} ${Lang.text(key)}<br>`;
            }
          } else {
            stats += '+' + `${v} ${Lang.text(key)}<br>`;
          }
        }
      }

      let dataTemp = data.rarity;

      switch (dataTemp) {
        case 1:
          dataTemp = 1;
          break;
        case 2:
          dataTemp = 2;
          break;
        case 3:
          dataTemp = 3;
          break;
        case 4:
          dataTemp = 4;
          break;
        default:
          dataTemp = 0;
          break;
      }

      let talentIsClassBased = '';

      if (!dataTemp) {
        talentIsClassBased = Lang.text('classTalent') + `<br>`;
      }

      let starOrange = window.innerHeight * 0.015;
      let starGold = window.innerHeight * 0.015;
      let talentRefineByRarity = Build.talentRefineByRarity[dataTemp == 0 ? 4 : dataTemp];

      let stars = '';

      for (let i = 0; i < (talentRefineByRarity > 15 ? 0 : talentRefineByRarity); i++) {
        if (Math.floor(i / 5) % 2 == 1) {
          stars = stars + `<img src="content/icons/starOrange27.webp" width=${starOrange} height=${starOrange}>`;
        } else {
          stars = stars + `<img src="content/icons/starGold.webp" width=${starGold} height=${starGold}>`;
        }
      }

      if (talentRefineByRarity > 15) {
        stars = stars + talentRefineByRarity + `<img src="content/icons/starOrange27.webp" width=${starOrange} height=${starOrange}>`;
      }

      // Используем переведенное описание
      let descriptionWithStars = `<b>${talentIsClassBased}</b>${stars} <br><br> ${description} `;

      Build.renderDescriptionHtml({
        html: `<b style="color:rgb(${rgb})">${name}</b><div>${descriptionWithStars}</div><span>${stats}</span>`,
        anchorRect: positionElement,
        talentDataForParams: data,
      });

      // Preview: where this library talent would land in the build.
      if (isInventoryTalent) {
        // Expensive library hover effects are delayed in scheduleInventorySetHoverEnhance().
        // This keeps fast cursor movement smooth (same feel as hovering talents in build grid).
        return;
      }
    };

    let descEventEnd = () => {
      Build.cancelPendingInventorySetHover();
      Build.descriptionView.style.display = 'none';
      Build.clearBuildRowHoverHighlight();
      if (!Build._hoveredSetTalentIds) Build.clearSetHighlights();
      // Remove only slot previews (keeps set-highlight logic independent).
      if (element.closest?.('.build-talents')) Build.clearEmptySlotPreviews();
    };

    element.ontouchstart = (e) => {
      descEvent();
    };

    element.onmouseover = () => {
      Build._hoveredDescriptionTalentEl = element;
      const isInventoryTalent = !!element.closest?.('.build-talents');
      if (isInventoryTalent) {
        Build.scheduleLibraryDescriptionRender(descEvent);
        return;
      }
      descEvent();
    };
    element.onmouseout = () => {
      if (Build._hoveredDescriptionTalentEl === element) Build._hoveredDescriptionTalentEl = null;
      descEventEnd();
    };
    element.ontouchend = () => {
      if (Build._hoveredDescriptionTalentEl === element) Build._hoveredDescriptionTalentEl = null;
      descEventEnd();
    };
  }
  static cleanup() {
    clearTimeout(Build._librarySearchTimer);
    Build._librarySearchTimer = 0;
    if (Build._librarySearchHotkeyHandler) window.removeEventListener('keydown', Build._librarySearchHotkeyHandler, true);
    Build._librarySearchHotkeyHandler = null;
    Build.librarySearchInput = null;
    Build.librarySearchView = null;
    for (const observer of Build._inventoryScrollObservers ?? []) observer.disconnect();
    Build._inventoryScrollObservers = [];
    Build._initToken = (Number(Build._initToken) || 0) + 1;
    Build._tabLabelObserver?.disconnect();
    Build._tabLabelObserver = null;
    Build._isDraggingTalent = false;
    Castle.toggleRender(Castle.RENDER_LAYER_BUILD_DRAG, true);
    Build._hoveredDescriptionTalentEl = null;
    Build._talentDescriptionSuppressedUntil = 0;
    Build._libraryHoverSuppressed = false;
    try {
      if (Build._libraryHoverSuppressTimer) clearTimeout(Build._libraryHoverSuppressTimer);
    } catch {}
    Build._libraryHoverSuppressTimer = 0;
    Build.cancelPendingInventorySetHover();
    Build._libraryPointerX = null;
    Build._libraryPointerY = null;
    Build.clearBuildRowHoverHighlight();
    Build.toggleBuildSettingsPanel(false);
    try {
      if (Build._altResetHandler) window.removeEventListener('keydown', Build._altResetHandler, true);
    } catch {}
    Build._altResetHandler = null;
    try {
      if (Build._heroNavKeyboardHandler) window.removeEventListener('keydown', Build._heroNavKeyboardHandler, true);
    } catch {}
    try {
      if (Build._heroNavKeyboardUpHandler) window.removeEventListener('keyup', Build._heroNavKeyboardUpHandler, true);
    } catch {}
    try {
      if (Build._heroNavKeyboardBlurHandler) window.removeEventListener('blur', Build._heroNavKeyboardBlurHandler, true);
    } catch {}
    try {
      if (Build._heroNavKeyboardHoldTimer) clearTimeout(Build._heroNavKeyboardHoldTimer);
    } catch {}
    try {
      if (Build._heroNavKeyboardRepeatTimer) clearInterval(Build._heroNavKeyboardRepeatTimer);
    } catch {}
    Build._heroNavKeyboardHandler = null;
    Build._heroNavKeyboardUpHandler = null;
    Build._heroNavKeyboardBlurHandler = null;
    Build._heroNavKeyboardHoldTimer = 0;
    Build._heroNavKeyboardRepeatTimer = 0;
    Build._heroNavHeldCode = '';
    Build._heroNavStopSyncToken = (Number(Build._heroNavStopSyncToken) || 0) + 1;
    Build._heroNavKeyboardBusy = false;
    Build._descriptionPinnedBySet = false;
    Build._hoveredSetTalentIds = null;
    Build._hoveredSetAnchorEl = null;
    try {
      Build.altResetHintView?.parentNode?.removeChild?.(Build.altResetHintView);
    } catch {}
    Build.altResetHintView = null;
    try {
      if (Build._previewBlinkTimer) clearInterval(Build._previewBlinkTimer);
    } catch {}
    Build._previewBlinkTimer = 0;
    Build._previewBlinkState = false;
    try {
      Build.fieldView?.classList?.remove('build-preview-blink-on');
    } catch {}
    try {
      if (Build._setsScrollStopTimer) clearTimeout(Build._setsScrollStopTimer);
    } catch {}
    Build._setsScrollStopTimer = 0;
    try {
      if (Build._buildSettingsAttachTimer) clearTimeout(Build._buildSettingsAttachTimer);
    } catch {}
    Build._buildSettingsAttachTimer = 0;
    try {
      Build.buildSettingsButton?.parentNode?.removeChild?.(Build.buildSettingsButton);
    } catch {}
    try {
      Build.buildSettingsPanel?.parentNode?.removeChild?.(Build.buildSettingsPanel);
    } catch {}
    Build.buildSettingsButton = null;
    Build.buildSettingsPanel = null;
    try {
      Build._avatarTipEl?.parentNode?.removeChild?.(Build._avatarTipEl);
    } catch {}
    Build._avatarTipEl = null;
    try {
      document.querySelectorAll('.build-avatar-tip').forEach((el) => el.remove());
    } catch {}
    if (Build.descriptionView && Build.descriptionView.parentNode) {
      Build.descriptionView.remove();
      Build.descriptionView = null;
    }
  }
}

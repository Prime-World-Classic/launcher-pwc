import { DOM } from './dom.js';
import { Store } from './store.js';
import { Api } from './api.js';
import { View } from './view.js';
import { CastleFarm } from './castleFarm.js';
import { CastleNAVBAR } from './castleNavBar.js';
import { Events } from './events.js';
import { Voice } from './voice.js';
import { Chat } from './chat.js';
import { NativeAPI } from './nativeApi.js';
import { mmMode } from './clientChannel.js';
import { MM } from './mm.js';
import { Build } from './build.js';
import { Splash } from './splash.js';
import { Window } from './window.js';
import { Castle } from './castle.js';
import { Lang } from './lang.js';
import { Sound } from './sound.js';
import { loadKeybinds } from './keybindings/keybindings.io.js';
import { domAudioPresets } from './domAudioPresets.js';
import { SOUNDS_LIBRARY, generateHeroSoundsNative, generateHeroSoundsFallback } from './soundsLibrary.js';
import { SessionPulse } from './sessionPulse.js';
import { HostRacer } from './hostRacer.js';
import { uiIcon } from './uiIcon.js';
import { Stats } from './stats.js';

export class App {
  static APP_VERSION = '0';

  // PW_VERSION обязан совпадать с версией модели того режима, в который идёт
  // клиент: mm ↔ objects/mm.model.js, mmtest ↔ objects/mmtest.model.js
  // (`this.version`) — иначе каждый mm-запрос даёт «Вышло обновление …».
  // С 2.16.0 обе модели одной версии (сейчас 3.0.0).
  static PW_VERSION = '3.0.0';

  // Режим матчмейкинга — по манифесту (clientChannel.js): тестовая сборка
  // (package.json.name с «Dev») → mmtest, публичная → mm. До 2026-10-19 значение
  // было зашито в ветку (test → mmtest, main → mm) и терялось при синках.
  static CURRENT_MM = mmMode();

  static RVPN = 'ws://26.187.55.30:3737';
  static VPS = 'wss://pw-classic.ru';
  // Резервный API-хост (тот же бэкенд на второй VPS, Let's Encrypt сертификат
  // валиден). Гонка параллельная — он просто ещё один кандидат: если основной
  // VPS молчит, побеждает он (проверено: wss://pw-classic-backup.ru
  // открывается, wss://pw-classic.ru в этот момент — 1006 без ответа).
  static VPS_BACKUP = 'wss://pw-classic-backup.ru';
  // Cloudflare-край (DOK). Сам CF фреймы не режет: из сети без фильтрации
  // (2026-10-17) по одному соединению прошли фреймы по 60 КБ и 360 КБ
  // подряд. Обрывы «после ~2 средних фреймов» (замер 2026-09: 2×5.4 КБ OK,
  // 3-й нет; 17.9 КБ первым OK, вторым нет) — это российские провайдеры
  // (ТСПУ, с 2025-06): TCP к IP Cloudflare «замерзает» после первых
  // ~16–20 КБ за соединение, без RST. Ужимать фреймы бесполезно — лимит
  // на всё соединение. Поэтому CF в гонке только с пробой (PROBED_HOSTS,
  // HostRacer.startProbe): ~48 КБ вниз до победы. Под фильтрацией проба не
  // проходит — игрока ведёт VPS; без неё (зарубеж, VPN) CF работает как
  // обычный хост. Замёрзший позже — штраф на 10 мин (HostRacer.penalize).
  static CF = 'wss://api2.zone-play.com:2096/api';
  static PROBED_HOSTS = [this.CF];
  static hostList = [this.RVPN, this.VPS, this.VPS_BACKUP, this.CF];

  // Бессмертное подключение: таймаут на кандидата растёт по мере провальных
  // раундов (потолок — конец списка); тупикового «конечного отказа» нет —
  // цикл идёт, пока не ответит какой-нибудь хост. Сбрасывается при успехе.
  static CONNECT_TIMEOUT_SCHEDULE = [3500, 5000, 7000, 10000, 15000, 20000, 30000];
  static CONNECT_ROUND_BACKOFF_MS = 1000;

  static connectTimeoutForRound(round) {
    const schedule = this.CONNECT_TIMEOUT_SCHEDULE;
    return schedule[Math.min(round, schedule.length - 1)];
  }

  /**
   * Первое подключение: гонка хостов (HostRacer), открытый сокет
   * передаётся в Api без повторного handshake. Гонка бессмертная:
   * раунды идут с эскалацией таймаутов, пока не подключимся.
   */
  static async connectAndInit() {
    if (this.isBuildPreviewEnabled() || this.isFairPreviewEnabled() || this.isTamburPreviewEnabled() || this.isSettingsPreviewEnabled() || this.isPlayerBuildPreviewEnabled() || this.isChatPreviewEnabled() || this.isCastlePreviewEnabled()) {
      return this.init();
    }
    let round = 0;

    this.racer = new HostRacer(this.hostList, {
      getToken: () => {
        // На первом подключении storage ещё не инициализирован
        try {
          return this.storage?.data?.token || '';
        } catch (error) {
          return '';
        }
      },
      probeHosts: this.PROBED_HOSTS,
    });

    while (true) {
      const result = await this.racer.race({ timeoutMs: this.connectTimeoutForRound(round) });

      if (result.ok) {
        return this.init(result.socket, result.host, result.latencyMs, result.buffered);
      }

      round++;
      await new Promise((resolve) => setTimeout(resolve, this.CONNECT_ROUND_BACKOFF_MS));
    }
  }

  /**
   * Preloads all sounds in SOUNDS_LIBRARY
   * @returns {Promise<void>} A promise that resolves when all sounds are preloaded
   */
  static async initSounds() {
    if (NativeAPI.status) {
      generateHeroSoundsNative();
    } else {
      generateHeroSoundsFallback();
    }
    const entries = [];

    const walk = (obj) => {
      for (const key in obj) {
        const value = obj[key];

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          walk(value);
        } else {
          entries.push([key, value]);
        }
      }
    };

    walk(SOUNDS_LIBRARY);

    // preloadAll, а не Promise.all(Sound.preload(...)): одна не дошедшая до
    // canplaythrough загрузка иначе никогда не резолвится и App.init() не доходит
    // до построения интерфейса.
    await Sound.preloadAll(entries);
  }

  static async init(socket = null, host = null, latencyMs = 0, buffered = null) {
    // ws://26.187.55.30:3737 - Radmin VPN relay (DOK)
    // wss://pw-classic.ru - VPS
    // wss://pw-classic-backup.ru - VPS2 (резерв)
    // wss://api2.zone-play.com:2096/api - Cloudflare edge (DOK), только с пробой
    App.api = new Api(this.hostList, Events, { socket: socket, host: host, latencyMs: latencyMs, buffered: buffered });

    await Store.init();

    await App.initSounds();

    App.storage = new Store('u3');

    await App.storage.init({ id: 0, token: '', login: '', launcherToken: '', auditToken: '' });

    App.notificationsInit();
    if (!App.isBuildPreviewEnabled() && !App.isFairPreviewEnabled() && !App.isTamburPreviewEnabled() && !App.isSettingsPreviewEnabled() && !App.isPlayerBuildPreviewEnabled() && !App.isChatPreviewEnabled()) App.autoLoginFromStoredGameAccount();

    await MM.init();
        
        // setTimeout(() => {
            
        //     MM.chat({id:0,message:'тестовое сообщение'});
        //     MM.chat({id:2,message:'тестовое сообщение'});
        //     MM.chat({id:7,message:'тестовое сообщение'});
            
        // },2000);


        // setTimeout(() => {
            
        //     ARAM.briefing(6,1,() => alert(1));
            
        // },3000);


        // setTimeout(() => {
            
        //     Splash.show(DOM({style:'iframe-stats'},DOM({style:'iframe-stats-navbar',event:['click',() => Splash.hide()]},'X'),DOM({tag:'iframe',src:'https://stat.26rus-game.ru'})),false);
            
        // },3000);

    await loadKeybinds();
    await App.syncAuthPulse();
    Chat.init();

    if (App.isChatPreviewEnabled()) {
      await App.showChatPreview();
      return;
    }

    if (App.isSettingsPreviewEnabled()) {
      await App.showSettingsPreview();
      return;
    }

    if (App.isPlayerBuildPreviewEnabled()) {
      View.active = DOM({ style: 'view' });
      document.body.append(View.active);
      await Window.show('playerBuild', 'playerBuild', {
        request: Array.from({ length: 36 }, (_, index) => index + 1),
        user: 0, hero: 20, nickname: 'LantarmОченьДлинныйНикнейм', preview: true,
      });
      View.active.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') Window.close('playerBuild');
      });
      return;
    }

    if (App.isFairPreviewEnabled()) {
      await App.showFairPreview();
      return;
    }

    if (App.isBuildPreviewEnabled()) {
      await App.showBuildPreview();
      return;
    }

    if (App.isCastlePreviewEnabled()) {
      await App.showCastlePreview();
      return;
    }

    if (App.isTamburPreviewEnabled()) {
      Voice.init();
      await App.showTamburPreview();
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (Splash.body?.style.display === 'flex') Splash.hide();
          else Window.closeLast();
        }
      });
      return;
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Esc уже обработан внутри (окно аудита закрылось само) — до preventDefault ниже.
        const handledInside = e.defaultPrevented;
        requestAnimationFrame(() => Voice.updatePanelPosition());
        e.preventDefault();
        e.stopPropagation();

        // 0. Модальный <dialog> (окна фермы и её аудита) — поверх всего. preventDefault
        // выше гасит его штатное закрытие по Esc, поэтому закрываем сами.
        const openDialog = [...document.querySelectorAll('dialog[open]')].pop();
        if (openDialog) {
          openDialog.close();
          Sound.play(SOUNDS_LIBRARY.CLICK_CLOSE, { id: 'ui-close', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
          return;
        }

        // 1. Сначала закрываем Splash если открыт
        if (typeof Splash !== 'undefined' && Splash.body && Splash.body.style.display === 'flex') {
          Splash.hide();
          Sound.play(SOUNDS_LIBRARY.CLICK_CLOSE, { id: 'ui-close', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
          return;
        }

        // 2. Затем закрываем окна по одному в обратном порядке
        if (typeof Window !== 'undefined' && Window.anyOpen && Window.anyOpen()) {
          Window.closeLast(); // Закрываем только последнее окно
          Sound.play(SOUNDS_LIBRARY.CLICK_CLOSE, { id: 'ui-close', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
          return;
        }
        // 3. Экран «Статистика» (аудит) — Esc работает как его крестик: назад в замок.
        // Открытое окно аудита (репорт, харизма…) закрывает сам аудит, экран остаётся.
        if (View.active?.classList?.contains('stats-screen')) {
          if (handledInside || Stats.hasOpenWindow()) return;
          View.show('castle');
          Sound.play(SOUNDS_LIBRARY.CLICK_CLOSE, { id: 'ui-close', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
          return;
        }
        // 4. Если окон нет - открываем настройки
        else {
          if (typeof Window !== 'undefined' && Window.show) {
            Window.show('main', 'menu');
            Sound.play(SOUNDS_LIBRARY.CLICK_OPEN_BIG, { id: 'ui-big-click', volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
          }
        }
      }
    });

    try {
      await App.api.init();
    } catch (error) {}
    
    Chat.loadHistory().catch((error) => console.error('Failed to load chat history after API init', error));

    //App.ShowCurrentView();

    // App.backgroundAnimate = document.body.animate({backgroundSize:['150%','100%','150%']},{duration:30000,iterations:Infinity,easing:'ease-out'});

    if (App.isAdmin()) {
      document.body.append(DOM({ id: 'ADMStat' }));
    }

    Voice.init();
  }

  static isTamburPreviewEnabled() {
    const host = String(window.location?.hostname || '').toLowerCase();
    return (App.isLocalhostOrigin() || host === 'pw.r4ok.com') &&
      new URLSearchParams(window.location.search).get('previewTambur') === '1';
  }

  // DEV-превью замка с фермой (?previewCastle=1): угол ресурсов, бейджи очереди,
  // пузыри сбора и окно здания на локальных данных CastleFarm, без бэкенда.
  static isCastlePreviewEnabled() {
    return (App.isLocalhostOrigin() || window.location.hostname === 'pw.r4ok.com') &&
      new URLSearchParams(window.location.search).get('previewCastle') === '1';
  }

  static async showCastlePreview() {
    Sound.preload('NEW_LEVEL', SOUNDS_LIBRARY.NEW_LEVEL);
    CastleFarm.startPreview();
    await App.showChatPreview({ buildContext: true, interactive: true });
    CastleNAVBAR.queue({ mode: { 0: '7 (2)', 1: 3, 3: 12, 5: 1 } });
    const params = new URLSearchParams(window.location.search);
    const initialWindow = params.get('previewFarm');
    const previewWindow = params.get('previewWindow');
    if (previewWindow === 'invite' || previewWindow === 'call') {
      await Window.show('main', `${previewWindow}Window`, { preview: true, id: 0, nickname: 'Nesh', name: 'Nesh' });
    } else if (previewWindow === 'minigame') {
      await Window.show('main', 'farm', { preview: true });
    } else if (initialWindow === 'audit') await CastleFarm.openAudit();
    else if (CastleFarm.isFarm(initialWindow) || initialWindow === CastleFarm.STORAGE) CastleFarm.openInfo(initialWindow);
  }

  static isChatPreviewEnabled() {
    return (App.isLocalhostOrigin() || window.location.hostname === 'pw.r4ok.com') &&
      new URLSearchParams(window.location.search).get('previewChat') === '1';
  }

  static async showChatPreview(options = {}) {
    View.setCss('content/castle.css');
    Castle.canvas = DOM({ tag: 'canvas', id: 'castle-game-surface' });
    // interactive (?previewCastle=1): здания замка и ферма откликаются на мышь
    Castle.canvas.style.pointerEvents = options.interactive ? '' : 'none';
    Castle.buildingBubbles = DOM({ style: 'castle-buildings-bubbles' });
    View.active = DOM({ id: 'castle-body' },
      DOM({ id: 'castle-background-img' }), Castle.canvas, Castle.buildingBubbles, View.castleChat());
    document.body.append(View.active);
    Chat.history.hasMore = false;
    Chat.field.readOnly = true;
    for (const name of ['click', 'contextmenu', 'keydown', 'submit']) {
      Chat.body.addEventListener(name, (event) => {
        if (name === 'click' && event.target === Chat.field) return;
        if (event.target.closest('.chat-tab') && (name === 'click' || (name === 'keydown' && ['Enter', ' '].includes(event.key)))) return;
        if (name === 'keydown' && event.key === 'Tab') return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
    const lines = [
      ['Коао', 'Всем привет! Кто собирается в бой?'],
      ['Lantarm', 'Собираем команду на Драгонвальд.'],
      ['Nesh', 'Я с вами, сейчас выберу героя.'],
      ['Коао', 'Отлично, ждём остальных.'],
    ];
    lines.forEach(([nickname, text], index) => Chat.upsert({
      id: index + 1, userId: index + 100, nickname, text, date: Date.now(),
      to: 0, flag: 0, star: 0, source: '', pinned: false,
    }, true));
    const params = new URLSearchParams(window.location.search);
    const faction = params.get('previewFaction') === 'ad' ? 'ad' : 'doct';
    Castle.currentSceneName = faction;
    if (options.buildContext) {
      const target = Number(App.storage.data.id) || 0;
      const heroes = [20, 1, 2, 3, 4, 25, 26, 38].map((id, index) => ({
        id, skin: 1, rating: 1312 + index * 25, favourite: index < 4 ? 3 : 0,
      }));
      const party = { id: target, mode: 0, users: {
        [target]: { nickname: 'Коао', hero: 20, skin: 1, ready: false, heroRating: 1312, playerRatingVisual: 1268 },
      } };
      const previewData = { party, heroes };
      View.active.append(await View.castlePlay(party, { previewData }),
        await View.castleHeroes({ previewData }), View.castleSettings());
      View.castleTotalCrystal.firstChild.textContent = '126';
      for (const name of options.interactive ? [] : ['click', 'dblclick', 'contextmenu', 'pointerdown', 'keydown', 'input', 'change', 'submit']) {
        View.active.addEventListener(name, (event) => {
          if (event.target === Chat.field && (name === 'click' || (name === 'keydown' && event.key === 'Tab'))) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        }, true);
      }
    }
    Castle.dayTimeOverride = Castle.dayModeTime[params.get('previewTime') === 'night' ? 'night' : 'day'];
    const loading = DOM({ style: 'castle-preview-status', role: 'status' }, 'Загрузка замка...');
    View.active.append(loading);
    try {
      if (await Castle.initDemo(faction, Castle.canvas, { preview: true }) === 1) throw new Error('WebGL unavailable');
      loading.remove();
    } catch (error) {
      loading.setAttribute('role', 'alert');
      loading.textContent = 'Не удалось загрузить замок. Обновите страницу или проверьте поддержку WebGL.';
      console.error('Castle preview failed', error);
    }
  }

  static isSettingsPreviewEnabled() {
    const host = String(window.location?.hostname || '').toLowerCase();
    return (App.isLocalhostOrigin() || host === 'pw.r4ok.com') &&
      new URLSearchParams(window.location.search).get('previewSettings') === '1';
  }

  static isPlayerBuildPreviewEnabled() {
    const host = String(window.location?.hostname || '').toLowerCase();
    return (App.isLocalhostOrigin() || host === 'pw.r4ok.com') &&
      new URLSearchParams(window.location.search).get('previewPlayerBuild') === '1';
  }

  static async showSettingsPreview() {
    View.active = DOM({ style: 'view' });
    document.body.append(View.active);
    const navigation = new Set(['account', 'preferences', 'battleSettings', 'advancedSettings', 'back'].map((key) => Lang.text(key)));
    View.active.addEventListener('click', (event) => {
      if (event.target.closest('.close-button, .bs-cat, .window__overlay')) return;
      const button = event.target.closest('.castle-menu-item-button');
      if (button && navigation.has(button.textContent.trim())) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    for (const name of ['input', 'change', 'submit']) {
      View.active.addEventListener(name, (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
    for (const name of ['pointerdown', 'mousedown', 'touchstart', 'dragstart', 'drop']) {
      View.active.addEventListener(name, (event) => {
        if (!event.target.closest('input, select, .bs-wheel, .bs-wheel-slot, .bs-wheel-item, .bs-key')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
    View.active.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        Window.close('main');
        Window.show('main', 'menu');
      } else if (event.target.matches('input, select, textarea') && event.key !== 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    const requested = new URLSearchParams(window.location.search).get('settingsPage');
    const method = ['menu', 'accountPanel', 'settings', 'advancedSettings', 'battleSettings'].includes(requested) ? requested : 'menu';
    await Window.show('main', method);
  }

  static isFairPreviewEnabled() {
    const host = String(window.location?.hostname || '').toLowerCase();
    return (App.isLocalhostOrigin() || host === 'pw.r4ok.com') &&
      new URLSearchParams(window.location.search).get('previewFair') === '1';
  }

  static async showFairPreview() {
    View.active = DOM({ style: 'view' });
    document.body.append(View.active);
    MM.hero = [1, 2, 3, 4, 20, 25].map((id) => ({ id, skin: 1 }));
    const available = [];
    for (const hero of [1, 2, 3, 4, 20, 25]) {
      for (const skin of [2, 3]) {
        available.push({ id: available.length + 1, categoryId: 3, externalId: `${hero}/${skin}`, price: 50, enabled: true });
      }
    }
    for (const flag of ['adornia', 'admin', 'apple', 'bike', 'ball']) {
      available.push({ id: available.length + 1, categoryId: 1, externalId: flag, price: 20, enabled: true });
    }
    for (const frame of [4, 8]) {
      available.push({ id: available.length + 1, categoryId: 2, externalId: String(frame), price: 100, enabled: true });
    }
    const purchased = [
      { ...available[0], enabled: true },
      { ...available[12], enabled: true },
      { id: 0, categoryId: 1, externalId: 'default', enabled: false },
      { id: 0, categoryId: 2, externalId: 'default', enabled: false },
    ];
    available[0].enabled = false;
    available[12].enabled = false;
    const requestedTab = new URLSearchParams(window.location.search).get('previewFairTab');
    const previewTab = ['frame', 'skin'].includes(requestedTab) ? requestedTab : 'all';
    await Window.show('previewFair', 'shop', previewTab, {
      available, purchased, topHero: { heroId: 1, skinId: 1, frameId: 1 },
    });
    View.active.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.target.matches('input, select, textarea')) {
        Window.close('previewFair');
      }
    });
  }

  static async showTamburPreview() {
    if (!Lang.list[Lang.target]) await Lang.init();
    const previewUserId = 99999999;
    const previewAram = new URLSearchParams(window.location.search).get('previewTamburMode') === 'aram';
    const previewSkinCounts = [
      9, 10, 7, 6, 9, 6, 6, 4, 6, 9, 10, 10, 9, 10, 7, 9, 5, 7, 7, 5,
      11, 7, 6, 5, 7, 5, 7, 8, 5, 5, 2, 3, 7, 7, 4, 4, 5, 4, 4, 5,
    ];
    const users = {
      10: { nickname: 'Nesh', hero: 15, ready: 1, rating: 1300, team: 1, banhero: 59 },
      1858: { nickname: 'DOK', hero: 6, ready: 1, rating: 1100, team: 1, banhero: 14 },
      2: { nickname: 'Коао', hero: 12, ready: 1, rating: 1100, team: 1, banhero: 62 },
      4: { nickname: 'LantarmОченьДлинныйНикнейм', hero: 24, ready: 1, rating: 1100, team: 1, banhero: 9 },
      5: { nickname: '123', hero: 8, ready: 1, rating: 1100, team: 2, banhero: 49 },
      6: { nickname: '123', hero: 2, ready: 1, rating: 1100, team: 2, banhero: 21 },
      7: { nickname: 'Farfania', hero: 9, ready: 1, rating: 1100, team: 2, banhero: 22 },
      8: { nickname: 'Rekongstor', hero: 25, ready: 1, rating: 1100, team: 2, banhero: 23 },
      9: { nickname: 'Hatem', hero: 0, ready: 1, rating: 2200, team: 2, banhero: 26 },
    };
    users[previewUserId] = {
      nickname: App.storage.data.login || 'Вы', hero: 20, ready: 0,
      rating: 1284, select: true, team: 1, commander: true, banhero: 16,
    };
    await MM.lobby({
      id: 1, users, target: previewUserId,
      map: [4, 2, previewUserId, 10, 1858, 5, 6, 7, 8, 9],
      mode: previewAram ? 3 : 0, banhero: previewAram, previewUserId,
      ...(previewAram ? { hero: [2, 6, 8, 9, 12, 14, 15, 16, 20, 21, 22, 23, 24, 25, 26] } : {}),
      previewHeroList: { id: 1, name: Lang.text('mmPreviewHeroList') },
      previewHeroes: Array.from({ length: 40 }, (_, index) => ({
        id: index + 1,
        rating: 1000 + (index % 5) * 200,
        skin: 1,
        favourite: [1, 4, 12, 20, 26, 38].includes(index + 1) ? 1 : 0,
        star: [7, 20].includes(index + 1) ? 1 : 0,
        previewSkins: Array.from({ length: previewSkinCounts[index] }, (_, skin) => skin + 1),
      })).sort((a, b) => a.rating - b.rating),
    }, { preview: true });
  }

  static isBuildPreviewEnabled() {
    const host = String(window.location?.hostname || '').toLowerCase();
    return (App.isLocalhostOrigin() || host === 'pw.r4ok.com') &&
      new URLSearchParams(window.location.search).get('previewBuild') === '1';
  }

  static async showBuildPreview(options = {}) {
    if (!Lang.list[Lang.target]) await Lang.init();
    if (options.reuseCastle) View.stashBuildHeroesFrame();
    App._buildPreviewCleanup?.();
    if (!options.reuseCastle) await App.showChatPreview({ buildContext: true });
    const heroIds = Build.getHeroIdsFromCastleBottomList();
    const previewParams = new URLSearchParams(window.location.search);
    const guidePreview = previewParams.get('previewBuildGuide') === '1' && !options.heroId;
    const requestedHero = guidePreview ? 1 : Number(options.heroId || previewParams.get('hero') || 20);
    const heroId = heroIds.includes(requestedHero) ? requestedHero : 20;
    const heroesTab = options.heroesTab ?? new URLSearchParams(window.location.search).get('heroesTab') === '1';
    const talent = (id, index) => ({
      id, level: index % 6 + 1, rarity: index % 4 + 1,
      refine: 0, active: index % 5 === 0 ? 1 : 0, stats: {}, statsRefine: {},
    });
    // Display fixtures reuse the real build renderer and never load account data.
    const body = Array.from({ length: 36 }, (_, index) => talent(index + 1, 35 - index));
    if (guidePreview) {
      const response = await fetch('content/talent_hero.json');
      if (!response.ok) throw new Error('Failed to load guide class talents');
      const catalogue = await response.json();
      // Fixed Duelist screenshot fixture; class talent IDs are negative in build data.
      const classIds = [1, 37, 38, 39, 40, 41, 42, 43, 44];
      const rowSlots = new Map();
      for (const id of classIds) {
        const item = catalogue.find((entry) => Number(entry.id) === id);
        if (!item) throw new Error(`Missing guide class talent ${id}`);
        const rowStart = (6 - Number(item.level)) * 6;
        const column = rowSlots.get(rowStart) || 0;
        rowSlots.set(rowStart, column + 1);
        body[rowStart + column] = { ...item, id: -id, stats: {}, statsRefine: {} };
      }
    }
    const activePositions = guidePreview
      ? [...body.entries()]
        .filter(([, item]) => item.id < 0 && Number(item.active) === 1)
        .sort(([, a], [, b]) => Math.abs(a.id) - Math.abs(b.id))
        .concat([...body.entries()].filter(([, item]) => item.id > 0 && Number(item.active) === 1))
        .map(([index]) => index + 1)
      : body.slice(24).map((item) => item.id);
    const keyNames = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'O', 'P'];
    const previewData = {
      id: -1,
      binds: Array.from({ length: 24 }, (_, index) => ({
        keys: index < 12 ? [keyNames[index]] : ['CTRL', keyNames[index - 12]],
      })),
      build: [1, 2, 3, 4, 5, 6].map((id) => ({
        id,
        name: id === 3
          ? (Lang.target === 'en' ? 'Build with a long name' : 'Билд с длинным названием')
          : `${Lang.target === 'en' ? 'Build' : 'Билд'} ${id}`,
        target: id === 1,
      })),
      body,
      // Negative positions show the existing smartcast state without account mutations.
      active: Array.from({ length: 24 }, (_, index) => {
        const position = activePositions[index] || 0;
        return [1, 6].includes(index) ? -position : position;
      }),
      profile: [0, 0, 0, 0, 1, 0, 1, 0, 0],
      hero: {
        id: heroId, rating: 1312, param: 'razum', koef: 1,
        skin: { target: 1, list: [1] }, statModifiers: {}, overallModifier: 1,
        stats: { hp: 6443, mp: 4862, regenhp: 9.7, regenmp: 27.6, speed: 56,
          sila: 195, razum: 445, provorstvo: 144, hitrost: 356, stoikost: 93, volia: 166 },
      },
      inventory: Array.from({ length: 84 }, (_, index) => talent(index + 37, index)),
    };
    MM.hero = [{ id: heroId, skin: 1 }];
    const content = await View.build(heroId, 0, true, {
      previewData, heroesTab,
      onHeroNavigate: (direction, active) => {
        const index = heroIds.indexOf(heroId);
        const nextHero = heroIds[(index + direction + heroIds.length) % heroIds.length];
        return App.showBuildPreview({ heroId: nextHero, heroesTab: active, reuseCastle: true });
      },
    });
    const preview = DOM({ id: 'wbuild', style: 'build-preview' }, content);
    const overlay = DOM({ style: 'window__overlay' });
    // Keep tooltip and native scrolling behavior, but block every editing gesture.
    for (const name of ['click', 'dblclick', 'contextmenu', 'pointerdown', 'mousedown', 'touchstart', 'dragstart', 'drop', 'keydown', 'input', 'change', 'submit']) {
      preview.addEventListener(name, (event) => {
        if (event.target.closest('#wbuild_help, .build-preview-close, .build-tab-item, .build-heroes-nav, .build-hero-nav-btn, .build-scroll-arrow, .build-scroll-rail, .build-list-settings, .build-rarity > [data-rarity-id], .build-rarity-other, .build-library-search-row')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
    const cleanup = () => {
      Build.cleanup();
      overlay.remove();
      preview.remove();
      App._buildPreviewCleanup = null;
    };
    App._buildPreviewCleanup = cleanup;
    preview.append(DOM(
      {
        tag: 'button', type: 'button', style: ['close-button', 'build-preview-close'],
        title: Lang.text('titleClose'), ariaLabel: Lang.text('titleClose'),
        event: ['click', cleanup],
      },
      DOM({ tag: 'img', src: 'content/icons/close-cropped.svg', alt: '', style: 'close-image-style' }),
    ));
    View.active.append(overlay);
    document.body.append(preview);
    View.placeBuildHeroesFrame();
    View.fitBuildWindowToHeroList();
  }

  static say(text) {
    if (!('speechSynthesis' in window)) {
      return;
    }

    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }

    let synthesis = new SpeechSynthesisUtterance(text);

    synthesis.rate = 1.0;

    synthesis.pitch = 1.0;

    synthesis.volume = Castle.GetVolume(Castle.AUDIO_SOUNDS);

    synthesis.lang = Lang.text('synthesisLang');

    window.speechSynthesis.speak(synthesis);
  }

  static ShowCurrentView() {
    console.log('ShowCurrentView');
    if (App.storage.data.login && !App.isAuthPulseActiveSync()) {
      View.show('castle');
    } else {
      View.show('authorization');
    }
  }

  static async ShowCurrentViewAsync() {
    await App.syncAuthPulse();
    if (App.storage.data.login && !App.isAuthPulseActiveSync()) {
      await View.show('castle');
    } else {
      await View.show('authorization');
    }
  }

  static parseAuthPulse(raw) {
    return SessionPulse.parse(raw);
  }

  static encodeCompactData(text) {
    return SessionPulse.encodeCompactData(text);
  }

  static decodeCompactData(text) {
    return SessionPulse.decodeCompactData(text);
  }

  static readAuthPulseFromStorage() {
    return SessionPulse.readFromStorage();
  }

  static getAuthPulseFilePath() {
    return SessionPulse.getFilePath(NativeAPI);
  }

  static async readAuthPulseFromFile() {
    return SessionPulse.readFromFile(NativeAPI);
  }

  static async writeAuthPulse(pulse) {
    await SessionPulse.writeToAll(NativeAPI, pulse);
  }

  static isAuthPulseActive(pulse) {
    return SessionPulse.isActive(pulse);
  }

  static isAuthPulseActiveSync() {
    return App.isAuthPulseActive(App.readAuthPulseFromStorage());
  }

  static buildAuthPulseMessage(pulse) {
    return SessionPulse.buildMessage(pulse, (key) => Lang.text(key));
  }

  static parseSignalMinutes(text) {
    return SessionPulse.parseSignalMinutes(text);
  }

  static isAuthPulseSignal(text) {
    return SessionPulse.isSignal(text, `${Lang.text('accountBanned') || ''}`);
  }

  static async syncAuthPulse() {
    return await SessionPulse.sync(NativeAPI);
  }

  static async handleAuthPulseSignal(text, context = null) {
    const pulse = SessionPulse.createFromSignal(
      text,
      context,
      {
        ownerLogin: `${App.storage?.data?.login || ''}`.trim(),
        ownerId: Number(App.storage?.data?.id || 0),
      },
      `${Lang.text('accountBanned') || ''}`,
    );
    if (!pulse) return null;
    await SessionPulse.writeToAll(NativeAPI, pulse);
    try {
      View.show('authorization');
    } catch {}
    return pulse;
  }

  static OpenExternalLink(url) {
    if (NativeAPI.status) {
      nw.Shell.openExternal(url);
    } else {
      window.open(url, url, 'popup');
    }
  }

  static onApiReconnected() {
    Chat.onReconnect?.();
    Events.onApiReconnected?.();
  }

  // Тот же сайт, что и у аудита (Stats.origin). Старый pw2.26rus-game.ru не резолвится
  // в публичном DNS — без VPN уведомления падали с ENOTFOUND. Геттеры, а не поля:
  // stats.js и app.js импортируют друг друга, Stats на момент загрузки ещё не готов.
  static get notificationsPostUrl() {
    return `${Stats.origin}/stats/api/launcher/notifications.php`;
  }
  static get notificationsListUrl() {
    return `${App.notificationsPostUrl}?action=list`;
  }
  static get notificationsNewsListUrl() {
    return `${App.notificationsPostUrl}?action=news_list`;
  }
  static notificationsSteamAppId = 3684820;
  static notificationsSteamNewsCacheMs = 600000;
  static notificationsRefreshMs = 60000;
  static notifications = [];
  static notificationsUnreadCount = 0;
  static notificationsStatus = '';
  static notificationsLastError = '';
  static notificationsLoading = false;
  static notificationsActionLocked = false;
  static notificationsTimer = 0;
  static notificationsInitialized = false;
  static notificationsToastIds = new Set();
  static notificationsReadAnimationIds = new Set();
  static notificationsLocalId = 0;
  static notificationsButton = null;
  static notificationsQuickButton = null;
  static hallOfFameQuickButton = null;
  static notificationsPanel = null;
  static notificationsPanelBackdrop = null;
  static notificationsListNode = null;
  static notificationsDetailNode = null;
  static notificationsStatusNode = null;
  static notificationsFilterNode = null;
  static notificationsHelpNode = null;
  static notificationsTabs = {};
  static notificationsSelectedId = 0;
  static notificationsFilter = 'all';
  static notificationsActiveTab = 'news';
  static notificationsHelpVisible = false;
  static notificationsToastRoot = null;
  static notificationsAuditToken = '';
  static notificationsAuditPlayerId = 0;
  static notificationsNews = [];
  static notificationsNewsSelectedId = 0;
  static notificationsNewsLoading = false;
  static notificationsNewsUnreadCount = 0;
  static notificationsNewsStatus = '';
  static notificationsNewsToastIds = new Set();
  static notificationsNewsReaderNode = null;

  static getNotificationNewsStorageKey(kind) {
    const playerId = Number(App.notificationsAuditPlayerId || App.storage?.data?.id || 0) || 'guest';
    return `pwclassic_launcher_news_${kind}_${playerId}`;
  }

  static getNotificationNewsLocalIds(kind) {
    try {
      const raw = window.localStorage?.getItem(App.getNotificationNewsStorageKey(kind));
      const ids = JSON.parse(raw || '[]');
      return new Set(Array.isArray(ids) ? ids.map((id) => String(id || '').trim()).filter(Boolean) : []);
    } catch (error) {
      return new Set();
    }
  }

  static rememberNotificationNewsLocalId(kind, id) {
    id = String(id || '').trim();
    if (!id) return;

    const ids = App.getNotificationNewsLocalIds(kind);
    ids.add(id);
    try {
      window.localStorage?.setItem(App.getNotificationNewsStorageKey(kind), JSON.stringify([...ids].slice(-500)));
    } catch (error) {}
  }

  static isNotificationNewsLocallyMarked(kind, id) {
    id = String(id || '').trim();
    return Boolean(id) && App.getNotificationNewsLocalIds(kind).has(id);
  }
  static notificationsInit() {
    if (App.notificationsInitialized) return;

    App.notificationsInitialized = true;
    App.ensureNotificationsToastRoot();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && App.notificationsNewsReaderNode?.isConnected) {
        App.closeNotificationNewsReader({ reopenNewsPanel: true });
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key === 'Escape' && App.notificationsPanel?.isConnected) {
        App.closeNotificationsPanel();
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    });
    App.notificationsTimer = setInterval(() => {
      App.refreshNotifications({ showToasts: true });
      App.loadNotificationNews({ showToasts: true, render: false });
    }, App.notificationsRefreshMs);
  }

  static getAuditPlayerId() {
    return Number(App?.storage?.data?.id || 0);
  }

  static hasGameAccountSession() {
    return App.getAuditPlayerId() > 0;
  }

  static getCurrentGameAccountForNotifications() {
    const data = App?.storage?.data || {};
    const playerId = Number(data.id || 0);
    if (playerId <= 0) return null;

    return {
      id: playerId,
      login: `${data.login || ''}`.trim(),
      launcherToken: `${data.launcherToken || ''}`.trim(),
      auditToken: `${data.auditToken || ''}`.trim(),
    };
  }

  static ensureNotificationsAuditLogin() {
    const account = App.getCurrentGameAccountForNotifications();
    if (!account) {
      App.notificationsAuditToken = '';
      App.notificationsAuditPlayerId = 0;
      App.notifications = [];
      App.notificationsUnreadCount = 0;
      App.notificationsNews = [];
      App.notificationsNewsUnreadCount = 0;
      App.notificationsLastError = '';
      App.notificationsStatus = Lang.text('notifLoginRequired');
      App.renderNotifications();
      return false;
    }

    if (App.notificationsAuditToken && App.notificationsAuditPlayerId === account.id) return true;

    App.notificationsAuditPlayerId = account.id;
    App.notificationsAuditToken = account.launcherToken || account.auditToken || `launcher_dev_${account.id}`;
    App.notificationsStatus = '';
    App.notificationsLastError = '';
    App.renderNotificationsButton();
    return true;
  }

  static autoLoginFromStoredGameAccount() {
    if (!App.ensureNotificationsAuditLogin()) return false;

    // Игрок вошёл: снимаем отпечаток железа в фоне, не открывая аудит.
    Stats.captureOnLogin();
    App.refreshNotifications({ showToasts: true });
    App.loadNotificationNews({ showToasts: true, render: false });
    return true;
  }

  static notificationsAuthChanged() {
    Stats.authChanged();
    App.notifications = [];
    App.notificationsNews = [];
    App.notificationsUnreadCount = 0;
    App.notificationsLastError = '';
    App.notificationsToastIds.clear();
    App.notificationsReadAnimationIds.clear();
    App.notificationsNewsToastIds.clear();
    App.notificationsNewsUnreadCount = 0;
    App.notificationsAuditToken = '';
    App.notificationsAuditPlayerId = 0;
    App.renderNotifications();
    App.autoLoginFromStoredGameAccount();
  }

  static getNotificationsToken() {
    if (!App.ensureNotificationsAuditLogin()) return '';
    return App.notificationsAuditToken;
  }

  static async notificationsRequestList() {
    const token = App.getNotificationsToken();
    if (!token) throw new Error(Lang.text('notifNeedLogin'));

    return await App.notificationsHttpRequest(App.notificationsListUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  }

  static async notificationsRequestAction(action, fields = {}) {
    const token = App.getNotificationsToken();
    if (!token) throw new Error(Lang.text('notifNeedLogin'));

    const body = new URLSearchParams();
    body.set('action', action);
    for (const key in fields) {
      const value = fields[key];
      if (Array.isArray(value)) {
        value.forEach((item, index) => body.set(`${key}[${index}]`, String(item)));
      } else {
        body.set(key, String(value));
      }
    }

    return await App.notificationsHttpRequest(App.notificationsPostUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    });
  }

  static async notificationsRequestNewsList() {
    const token = App.getNotificationsToken();
    if (!token) throw new Error(Lang.text('newsNeedLogin'));

    return await App.notificationsHttpRequest(App.notificationsNewsListUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  }

  static async notificationsRequestNewsUpdate(newsId, fields = {}, bannerFile = null) {
    const payload = { ...fields, news_id: newsId, id: newsId };
    return await App.notificationsRequestNewsActionWithFallback(['news_update', 'update_news', 'news_edit', 'edit_news'], payload, bannerFile);
  }

  static async notificationsRequestNewsDelete(newsId) {
    return await App.notificationsRequestNewsActionWithFallback(['news_delete', 'delete_news', 'news_remove', 'remove_news'], { news_id: newsId, id: newsId });
  }

  static async notificationsRequestNewsCreate(fields = {}, bannerFile = null) {
    return await App.notificationsRequestNewsActionWithFallback(['news_create', 'create_news', 'news_add', 'add_news'], fields, bannerFile);
  }

  static async notificationsRequestNewsActionWithFallback(actions, fields = {}, bannerFile = null) {
    let lastError = null;

    for (const action of actions) {
      try {
        if (bannerFile) return await App.notificationsRequestNewsMultipartAction(action, fields, bannerFile);
        return await App.notificationsRequestNewsAction(action, fields);
      } catch (error) {
        lastError = error;
        const message = String(error?.message || error || '').toLowerCase();
        if (!message.includes('unknown_action')) throw error;
      }
    }

    throw lastError || new Error('news_action failed');
  }

  static async notificationsRequestNewsAction(action, fields = {}) {
    const token = App.getNotificationsToken();
    if (!token) throw new Error(Lang.text('newsNeedLogin'));

    const body = new URLSearchParams();
    body.set('action', action);
    for (const key in fields) {
      const value = fields[key];
      if (Array.isArray(value)) {
        value.forEach((item, index) => body.set(`${key}[${index}]`, String(item)));
      } else if (value !== undefined && value !== null) {
        body.set(key, String(value));
      }
    }

    return await App.notificationsHttpRequest(App.notificationsPostUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body,
    });
  }

  static async notificationsRequestNewsMultipartAction(action, fields = {}, bannerFile = null) {
    const token = App.getNotificationsToken();
    if (!token) throw new Error(Lang.text('newsNeedLogin'));

    const form = new FormData();
    form.set('action', action);
    for (const key in fields) {
      const value = fields[key];
      if (value !== undefined && value !== null) form.set(key, String(value));
    }
    if (bannerFile) form.set('banner', bannerFile, bannerFile.name || 'news-banner');

    return await App.notificationsMultipartRequest(App.notificationsPostUrl, form, token);
  }

  static async notificationsMultipartRequest(url, form, token) {
    if (NativeAPI.status && NativeAPI.https && /^https?:\/\//i.test(String(url || ''))) {
      const { body, contentType } = await App.encodeMultipartFormData(form);
      return await App.notificationsNativeRequest(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': contentType,
        },
        body,
      });
    }

    return await App.notificationsHttpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      body: form,
    });
  }

  static async encodeMultipartFormData(form) {
    const boundary = `----pwLauncher${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const chunks = [];
    const pushText = (value) => chunks.push(Buffer.from(value, 'utf8'));

    for (const [key, value] of form.entries()) {
      pushText(`--${boundary}\r\n`);

      if (value instanceof File) {
        const filename = String(value.name || 'upload.bin').replace(/"/g, '');
        const type = String(value.type || 'application/octet-stream');
        pushText(`Content-Disposition: form-data; name="${key}"; filename="${filename}"\r\n`);
        pushText(`Content-Type: ${type}\r\n\r\n`);
        chunks.push(Buffer.from(await value.arrayBuffer()));
        pushText('\r\n');
      } else {
        pushText(`Content-Disposition: form-data; name="${key}"\r\n\r\n${String(value)}\r\n`);
      }
    }

    pushText(`--${boundary}--\r\n`);

    return {
      body: Buffer.concat(chunks),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  static async parseNotificationsResponse(response) {
    const responseText = App.cleanAuditJsonText(await response.text());
    let json = null;
    try {
      json = JSON.parse(responseText || '{}');
    } catch (error) {
      if (!response.ok) throw new Error(`Audit HTTP ${response.status}`);
      throw new Error('Audit вернул некорректный ответ');
    }

    if (!response.ok || !json?.ok) {
      throw App.createAuditApiError(json, `Audit недоступен (${response.status})`, {
        statusCode: response.status,
        responseText,
      });
    }

    return json;
  }

  static createAuditApiError(json, fallback, meta = {}) {
    const parts = [json?.error, json?.message, json?.detail, json?.details, json?.sql_error, json?.exception]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    const message = parts.length ? [...new Set(parts)].join(': ') : fallback;
    const error = new Error(message);
    error.audit = json || null;
    error.meta = meta;
    return error;
  }

  static async notificationsHttpRequest(url, options = {}) {
    if (NativeAPI.status && NativeAPI.https && /^https?:\/\//i.test(String(url || ''))) {
      return await App.notificationsNativeRequest(url, options);
    }

    if (App.isLocalhostOrigin()) {
      throw new Error('CORS: Audit должен разрешить localhost или нужно запускать NW.js лаунчер');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return await App.parseNotificationsResponse(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static async notificationsNativeRequest(url, options = {}) {
    return await new Promise((resolve, reject) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (error) {
        reject(new Error('Audit URL error'));
        return;
      }

      const isBufferBody = typeof Buffer !== 'undefined' && Buffer.isBuffer?.(options.body);
      const bodyData = isBufferBody ? options.body : options.body ? String(options.body) : '';
      const headers = { ...(options.headers || {}) };
      if (bodyData) headers['Content-Length'] = isBufferBody ? bodyData.length : Buffer.byteLength(bodyData);

      const request = NativeAPI.https.request(
        {
          method: options.method || 'GET',
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          headers,
          timeout: 10000,
        },
        (response) => {
          let responseText = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            responseText += chunk;
          });
          response.on('end', () => {
            let json = null;
            responseText = App.cleanAuditJsonText(responseText);
            try {
              json = JSON.parse(responseText || '{}');
            } catch (error) {
              reject(new Error(`Audit HTTP ${response.statusCode}: ${parsedUrl.pathname}${parsedUrl.search}`));
              return;
            }

            if (Number(response.statusCode || 0) < 200 || Number(response.statusCode || 0) >= 300 || !json?.ok) {
              reject(
                App.createAuditApiError(json, `Audit HTTP ${response.statusCode}`, {
                  statusCode: response.statusCode,
                  path: `${parsedUrl.pathname}${parsedUrl.search}`,
                  responseText,
                }),
              );
              return;
            }

            resolve(json);
          });
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error('Audit request timeout'));
      });
      request.on('error', (error) => {
        reject(new Error(error?.message || 'Audit network error'));
      });

      if (bodyData) request.write(bodyData);
      request.end();
    });
  }

  static cleanAuditJsonText(value) {
    return String(value || '').replace(/^\uFEFF/, '').trim();
  }

  static isLocalhostOrigin() {
    const host = String(window.location?.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  static applyNotificationsState(data) {
    if (!data || !Array.isArray(data.notifications)) return false;

    App.notifications = data.notifications
      .map((item) => App.normalizeNotification(item))
      .filter((item) => !App.isNotificationNewsAnnouncement(item))
      .sort((a, b) => {
        const dateDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        return Number.isFinite(dateDiff) && dateDiff !== 0 ? dateDiff : b.id - a.id;
      });
    App.notificationsUnreadCount = App.notifications.filter((item) => !item.is_read).length;
    if (!App.notifications.some((item) => item.id === App.notificationsSelectedId)) {
      App.notificationsSelectedId = App.notifications[0]?.id || 0;
    }
    App.notificationsStatus = App.notifications.length ? '' : Lang.text('notifNone');
    App.notificationsLastError = '';
    App.renderNotifications();
    return true;
  }

  static normalizeNotification(item) {
    return {
      id: Number(item?.id || 0),
      type: String(item?.type || 'system'),
      title: String(item?.title || Lang.text('notifDefaultTitle')),
      message: String(item?.message || ''),
      details: String(item?.details || ''),
      banner_url: App.normalizeAuditAssetUrl(item?.banner_url || item?.image_url || ''),
      action_url: String(item?.action_url || item?.url || ''),
      created_at: String(item?.created_at || ''),
      read_at: String(item?.read_at || ''),
      toast_shown_at: String(item?.toast_shown_at || ''),
      is_read: Boolean(item?.is_read) || Boolean(item?.read_at),
      is_global: Boolean(item?.is_global),
      is_local: Boolean(item?.is_local),
      target_type: String(item?.target_type || ''),
    };
  }

  static isNotificationNewsAnnouncement(item) {
    const type = String(item?.type || '').trim().toLowerCase();
    if (['news', 'launcher_news', 'new_news', 'news_publish', 'news_post'].includes(type)) return true;

    const title = String(item?.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (title === 'новая новость' || title === 'новость' || title === 'new news') return true;
    return /^новая новость\b/.test(title) || /^новость опубликована\b/.test(title) || /^new news\b/.test(title);
  }

  static normalizeAuditAssetUrl(value) {
    const url = String(value || '').trim();
    if (!url) return '';
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) return url;
    if (/^data:/i.test(url)) return '';
    if (/^\/\//.test(url)) return `https:${url}`;
    if (/^(https?:\/\/|content\/|\/)/i.test(url)) return url;
    return '';
  }

  static async refreshNotifications({ showToasts = false } = {}) {
    if (App.notificationsLoading) {
      App.renderNotificationsPanel();
      return;
    }

    if (!App.ensureNotificationsAuditLogin()) return;

    App.notificationsLoading = true;
    App.renderNotifications();

    try {
      const data = await App.notificationsRequestList();
      App.applyNotificationsState(data);
      if (showToasts) App.showNewNotificationToasts();
    } catch (error) {
      App.notifications = [];
      App.notificationsUnreadCount = 0;
      App.notificationsStatus = Lang.text('notifAuditEmpty');
      App.notificationsLastError = String(error?.message || error || Lang.text('notifErrAudit'));
      App.renderNotifications();
      console.warn('Audit notifications failed', error);
    } finally {
      App.notificationsLoading = false;
      App.renderNotifications();
    }
  }

  static async markNotificationRead(id) {
    id = Number(id || 0);
    if (!id || App.notificationsActionLocked) return;

    App.notificationsActionLocked = true;
    const item = App.notifications.find((notification) => notification.id === id);
    const wasUnread = item && !item.is_read;
    if (item) {
      item.is_read = true;
      item.read_at = item.read_at || new Date().toISOString();
      App.notificationsReadAnimationIds.add(id);
      if (wasUnread) App.notificationsUnreadCount = Math.max(0, App.notificationsUnreadCount - 1);
      App.renderNotifications();
      setTimeout(() => {
        App.notificationsReadAnimationIds.delete(id);
        App.renderNotificationsPanel();
      }, 1700);
    }

    try {
      if (item?.is_local || id < 0) {
        App.renderNotifications();
        return;
      }

      const data = await App.notificationsRequestAction('mark_read', { notification_id: id });
      if (!App.applyNotificationsState(data)) await App.refreshNotifications();
    } catch (error) {
      App.notificationsLastError = String(error?.message || error || Lang.text('notifErrMark'));
      App.renderNotifications();
    } finally {
      App.notificationsActionLocked = false;
    }
  }

  static async markAllNotificationsRead() {
    if (App.notificationsActionLocked) return;

    App.notificationsActionLocked = true;
    App.notifications.forEach((item) => {
      item.is_read = true;
      item.read_at = item.read_at || new Date().toISOString();
    });
    App.notificationsUnreadCount = 0;
    App.renderNotifications();

    try {
      const hasRemoteNotifications = App.notifications.some((item) => !item.is_local && item.id > 0);
      if (hasRemoteNotifications) {
        const data = await App.notificationsRequestAction('mark_all_read');
        if (!App.applyNotificationsState(data)) await App.refreshNotifications();
      } else {
        App.renderNotifications();
      }
    } catch (error) {
      App.notificationsLastError = String(error?.message || error || Lang.text('notifErrMarkAll'));
      App.renderNotifications();
    } finally {
      App.notificationsActionLocked = false;
    }
  }

  static async markNotificationToastsShown(ids) {
    const cleanIds = [...new Set((ids || []).map((id) => Number(id)).filter((id) => id > 0))];
    if (!cleanIds.length) return;

    try {
      const data = await App.notificationsRequestAction('mark_toasts_shown', { ids: cleanIds });
      if (!App.applyNotificationsState(data)) await App.refreshNotifications();
    } catch (error) {
      console.warn('Audit mark_toasts_shown failed', error);
    }
  }

  static sendLauncherNotification(notification, options = {}) {
    const source = typeof notification === 'string' ? { message: notification } : { ...(notification || {}) };
    const item = App.normalizeNotification({
      id: source.id || --App.notificationsLocalId,
      type: source.type || 'system',
      title: source.title || Lang.text('notifDefaultTitle'),
      message: source.message || source.text || '',
      details: source.details || '',
      created_at: source.created_at || new Date().toISOString(),
      read_at: source.read_at || '',
      toast_shown_at: source.toast_shown_at || '',
      is_read: Boolean(source.is_read),
      is_global: Boolean(source.is_global),
      target_type: source.target_type || 'local',
      is_local: true,
    });

    App.notifications = [item, ...App.notifications.filter((current) => current.id !== item.id)];
    App.notificationsUnreadCount = App.notifications.filter((current) => !current.is_read).length;
    App.notificationsSelectedId = item.id;
    App.notificationsStatus = '';
    App.notificationsLastError = '';
    App.renderNotifications();

    if (options.showToast !== false && !item.is_read) {
      App.notificationsToastIds.add(item.id);
      App.playNotificationSound();
      App.showNotificationToast(item);
    }

    return item;
  }

  static showNewNotificationToasts() {
    const pending = App.notifications.filter((item) => item.id > 0 && !item.toast_shown_at && !App.notificationsToastIds.has(item.id));
    if (!pending.length) return;

    App.playNotificationSound();

    const ids = [];
    pending.forEach((item, index) => {
      App.notificationsToastIds.add(item.id);
      ids.push(item.id);
      setTimeout(() => App.showNotificationToast(item), index * 600);
    });
    App.markNotificationToastsShown(ids);
  }

  static playNotificationSound() {
    try {
      Sound.play(SOUNDS_LIBRARY.GROUP_INVITE || SOUNDS_LIBRARY.CALL || SOUNDS_LIBRARY.CHAT, {
        id: 'launcher_notifications_sound',
        volume: 0.65,
      });
    } catch (error) {
      console.warn('Notification sound failed', error);
    }
  }

  static showNotificationToast(item) {
    App.ensureNotificationsToastRoot();
    const type = App.getNotificationVisualType(item);

    const toast = DOM(
      {
        style: ['launcher-notification-toast', `is-${type}`, item.is_global ? 'is-global' : 'is-personal'],
        event: [
          'click',
          () => {
            App.openNotificationsPanel();
            App.markNotificationRead(item.id);
            toast.remove();
          },
        ],
      },
      DOM({ style: ['launcher-notification-toast-icon', `is-${type}`] }),
      DOM(
        { style: 'launcher-notification-toast-body' },
        DOM({ style: 'launcher-notification-toast-kind' }, App.getNotificationScopeLabel(item)),
        DOM({ style: 'launcher-notification-toast-title' }, item.title),
        DOM({ style: 'launcher-notification-toast-message' }, item.message),
      ),
    );
    if (item.banner_url) {
      toast.classList.add('has-banner');
      toast.style.backgroundImage = `linear-gradient(90deg, rgba(1, 24, 30, 0.92), rgba(1, 24, 30, 0.68)), url("${item.banner_url}")`;
    }
    App.notificationsToastRoot.append(toast);
    setTimeout(() => toast.classList.add('is-visible'), 20);
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 250);
    }, 6500);
  }

  static showNotificationNewsToast(item) {
    App.ensureNotificationsToastRoot();
    const toast = DOM(
      {
        style: ['launcher-notification-toast', 'launcher-news-toast', item.banner_url ? 'has-banner' : ''].filter(Boolean),
        event: [
          'click',
          async () => {
            App.notificationsActiveTab = 'news';
            App.notificationsNewsSelectedId = item.id;
            await App.markNotificationNewsRead(item.id);
            App.openNotificationNewsReader(item);
            toast.remove();
          },
        ],
      },
      App.createNotificationNewsThumb(item),
      DOM(
        { style: 'launcher-notification-toast-body' },
        DOM({ style: 'launcher-notification-toast-kind' }, Lang.text('newsSingle')),
        DOM({ style: 'launcher-notification-toast-title' }, item.title),
        DOM({ style: 'launcher-notification-toast-message' }, item.message),
      ),
    );
    if (item.banner_url) {
      const toastOverlay =
        type === 'report'
          ? 'linear-gradient(90deg, rgba(77, 8, 18, 0.92), rgba(100, 24, 22, 0.66))'
          : 'linear-gradient(90deg, rgba(1, 24, 30, 0.92), rgba(1, 24, 30, 0.68))';
      toast.style.backgroundImage = `${toastOverlay}, url("${item.banner_url}")`;
    }
    App.notificationsToastRoot.append(toast);
    setTimeout(() => toast.classList.add('is-visible'), 20);
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 250);
    }, 7500);
  }

  static createNotificationsButton() {
    const badge = DOM({ style: 'launcher-notifications-badge' });
    const button = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'launcher-notifications-menu-item',
        data: { tooltip: Lang.text('notifications') },
        event: ['click', () => App.toggleNotificationsPanel()],
      },
      DOM({ style: 'launcher-notifications-icon' }),
      badge,
    );

    button.badge = badge;
    App.notificationsButton = button;
    App.ensureNotificationsQuickTab();
    App.ensureHallOfFameQuickTab();
    App.ensureMinigamesQuickTab();
    App.showLauncherRestartButton();
    App.renderNotificationsButton();
    return button;
  }

  static renderNotificationsButton() {
    const totalUnread = App.getTotalLauncherUnreadCount();
    if (App.notificationsButton) {
      App.notificationsButton.classList.toggle('has-unread', totalUnread > 0);
      App.notificationsButton.classList.toggle('no-unread', totalUnread <= 0);
      App.notificationsButton.classList.toggle('is-loading', App.notificationsLoading);
      App.notificationsButton.dataset.tooltip = App.notificationsLastError || App.notificationsStatus || Lang.text('notifications');
      App.notificationsButton.badge.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
      App.notificationsButton.badge.style.display = 'flex';
    }
    App.renderNotificationsQuickTab();
  }

  static ensureNotificationsQuickTab() {
    if (App.notificationsQuickButton?.isConnected) return;

    const badge = DOM({ style: 'launcher-notifications-quick-badge' });
    App.notificationsQuickButton = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'launcher-notifications-quick-tab',
        data: { tooltip: Lang.text('news') },
        event: ['click', () => App.openNotificationsPanel()],
      },
      DOM({ style: 'launcher-notifications-quick-icon' }),
      badge,
    );
    App.notificationsQuickButton.badge = badge;
    document.body.append(App.notificationsQuickButton);
    App.renderNotificationsQuickTab();
  }

  static removeNotificationsQuickTab() {
    App.closeNotificationsPanel();
    App.notificationsQuickButton?.remove();
    App.notificationsQuickButton = null;
    App.hallOfFameQuickButton?.remove();
    App.hallOfFameQuickButton = null;
    App.minigamesQuickTab?.remove();
    App.minigamesQuickTab = null;
    App.launcherRestartButton?.remove();
  }

  // Быстрые кнопки и панель новостей создаются один раз с текстами текущего языка:
  // при смене языка убираем их, View.show('castle') создаст заново
  static resetLocalizedQuickTabs() {
    App.removeNotificationsQuickTab();
    App.notificationsPanel?.remove();
    App.notificationsPanel = null;
    if (App.launcherRestartButton && !App.launcherRestartButton.disabled) App.launcherRestartButton = null;
  }

  static ensureHallOfFameQuickTab() {
    if (App.hallOfFameQuickButton?.isConnected) return;

    const title = Lang.text('topWindowTitle');
    App.hallOfFameQuickButton = DOM({
      domaudio: domAudioPresets.defaultButton,
      tag: 'button',
      type: 'button',
      style: 'launcher-hall-of-fame-quick-tab',
      data: { tooltip: title },
      event: ['click', () => Window.show('main', 'top', 0, 0)],
    });
    App.hallOfFameQuickButton.setAttribute('aria-label', title);
    document.body.append(App.hallOfFameQuickButton);
  }

  // Быстрая кнопка «Мини-игры» под «Залом славы»: при наведении — список мини-игр
  // (доступны и без 3D-замка, где здания не видно)
  static ensureMinigamesQuickTab() {
    if (App.minigamesQuickTab?.isConnected) return;
    const title = Lang.text('minigames');
    const item = (icon, name, sub, open) => {
      const props = { tag: 'button', type: 'button', style: ['launcher-minigames-item'] };
      if (open) {
        props.domaudio = domAudioPresets.bigButton;
        props.event = [
          'click',
          () => {
            App.minigamesQuickTab?.classList.remove('is-open');
            App.minigamesQuickTab?.classList.add('is-picked');
            document.activeElement?.blur?.();
            open();
          },
        ];
      } else {
        props.style.push('is-soon');
        props.disabled = true;
      }
      return DOM(
        props,
        DOM({ style: ['launcher-minigames-item-icon', icon] }),
        DOM({ style: 'launcher-minigames-item-text' }, DOM({ tag: 'b' }, name), DOM({ tag: 'small' }, sub)),
      );
    };
    const list = DOM(
      { style: 'launcher-minigames-list' },
      DOM({ style: 'launcher-minigames-title' }, title),
      item('is-easel', Lang.text('easel_doct'), Lang.text('minigameEaselSub'), () => App.openEasel()),
      // «Фарм талантов» (здание talent_farm, Window.farm → View.game / game.js): три в ряд из талантов
      item('is-match3', Lang.text('minigameMatch3'), Lang.text('minigameMatch3Sub'), () => Window.show('main', 'farm')),
    );
    const button = DOM({
      tag: 'button',
      type: 'button',
      domaudio: domAudioPresets.defaultButton,
      style: 'launcher-minigames-quick-tab',
      event: [
        'click',
        () => {
          App.minigamesQuickTab.classList.remove('is-picked');
          App.minigamesQuickTab.classList.toggle('is-open');
        },
      ],
    });
    button.setAttribute('aria-label', title);
    App.minigamesQuickTab = DOM({ style: 'launcher-minigames-quick' }, button, list);
    App.minigamesQuickTab.addEventListener('mouseleave', () => App.minigamesQuickTab?.classList.remove('is-open', 'is-picked'));
    document.body.append(App.minigamesQuickTab);
  }

  static async openEasel() {
    try {
      const [{ Easel }, { Castle }] = await Promise.all([import('./easel/easel.js'), import('./castle.js')]);
      await Easel.open(Castle.currentSceneName || (App.storage.data.fraction == 1 ? 'ad' : 'doct'));
    } catch (e) {
      console.error(e);
      App.notify(Lang.text('easelComingSoon'));
    }
  }

  // Кнопка «Перезапустить» под быстрыми кнопками: появляется, когда фоновое
  // обновление content скачано (NativeAPI.restartPending). Клик — перезагрузка окна.
  static showLauncherRestartButton(notify = false) {
    if (!NativeAPI.restartPending) return;
    if (App.launcherRestartButton?.isConnected) return;
    if (!App.launcherRestartButton) {
      const title = Lang.text('launcherRestartReady');
      App.launcherRestartButton = DOM({
        domaudio: domAudioPresets.defaultButton,
        tag: 'button',
        type: 'button',
        style: 'launcher-restart-quick-tab',
        data: { tooltip: title },
        event: [
          'click',
          () => {
            if (App.launcherRestartButton.disabled) return;
            App.launcherRestartButton.disabled = true;
            App.launcherRestartButton.classList.add('is-busy');
            NativeAPI.resetWhenContentReady();
          },
        ],
      });
      App.launcherRestartButton.setAttribute('aria-label', title);
    }
    document.body.append(App.launcherRestartButton);
    if (notify) App.notify(Lang.text('launcherRestartReadyNotify'));
  }

  static renderNotificationsQuickTab() {
    if (!App.notificationsQuickButton) return;

    const totalUnread = App.getTotalLauncherUnreadCount();
    App.notificationsQuickButton.classList.toggle('has-unread', totalUnread > 0);
    App.notificationsQuickButton.classList.toggle('no-unread', totalUnread <= 0);
    App.notificationsQuickButton.dataset.tooltip = Lang.text('news');
    App.notificationsQuickButton.removeAttribute('title');
    App.notificationsQuickButton.badge.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
  }

  static getTotalLauncherUnreadCount() {
    return Math.max(0, Number(App.notificationsUnreadCount || 0) + Number(App.notificationsNewsUnreadCount || 0));
  }

  static toggleNotificationsPanel() {
    if (App.notificationsPanel?.isConnected) App.closeNotificationsPanel();
    else App.openNotificationsPanel();
  }

  static openNotificationsPanel() {
    if (!App.notificationsPanel) App.notificationsPanel = App.createNotificationsPanel();
    if (!App.notificationsPanelBackdrop) {
      App.notificationsPanelBackdrop = DOM({
        style: 'launcher-notifications-panel-backdrop',
        event: ['click', () => App.closeNotificationsPanel()],
      });
    }
    if (!App.notificationsPanelBackdrop.isConnected) document.body.append(App.notificationsPanelBackdrop);
    if (!App.notificationsPanel.isConnected) document.body.append(App.notificationsPanel);

    requestAnimationFrame(() => App.notificationsPanelBackdrop?.classList.add('is-open'));
    App.notificationsPanel.classList.add('is-open');
    App.renderNotificationsPanel();

    if (App.notificationsActiveTab === 'news') {
      App.loadNotificationNews();
      return;
    }

    if (!App.ensureNotificationsAuditLogin()) return;
    App.refreshNotifications({ showToasts: false });
  }

  static closeNotificationsPanel() {
    if (!App.notificationsPanel) return;

    App.notificationsPanelBackdrop?.classList.remove('is-open');
    App.notificationsPanel.classList.remove('is-open');
    setTimeout(() => {
      if (App.notificationsPanelBackdrop && !App.notificationsPanelBackdrop.classList.contains('is-open')) {
        App.notificationsPanelBackdrop.remove();
      }
      if (App.notificationsPanel && !App.notificationsPanel.classList.contains('is-open')) {
        App.notificationsPanel.remove();
      }
    }, 180);
  }

  static createNotificationsPanel() {
    App.notificationsStatusNode = DOM({ style: 'launcher-notifications-status' });
    App.notificationsListNode = DOM({ style: 'launcher-notifications-list' });
    App.notificationsDetailNode = DOM({ style: 'launcher-notifications-detail' });
    App.notificationsTabs = {};
    App.notificationsHelpNode = DOM(
      { style: 'launcher-notifications-help' },
      DOM({ tag: 'b' }, Lang.text('notifHelpTitle')),
      DOM({}, Lang.text('notifHelpText')),
    );
    App.notificationsFilterNode = DOM(
      {
        tag: 'select',
        domaudio: domAudioPresets.defaultButton,
        style: 'launcher-notifications-filter',
        title: Lang.text('filter'),
        event: [
          'change',
          (event) => {
            App.notificationsFilter = event.target.value || 'all';
            App.renderNotificationsPanel();
          },
        ],
      },
      DOM({ tag: 'option', value: 'all' }, Lang.text('filterAll')),
      DOM({ tag: 'option', value: 'unread' }, Lang.text('filterUnread')),
      DOM({ tag: 'option', value: 'read' }, Lang.text('filterRead')),
    );

    const tabs = DOM(
      { style: 'launcher-notifications-tabs' },
      App.createNotificationsTab('news', Lang.text('news')),
      App.createNotificationsTab('notifications', Lang.text('notifications')),
      DOM(
        { style: 'launcher-notifications-tab-separator' },
        DOM({ style: 'shop_separator_left' }),
        DOM({ style: 'shop_separator_right' }),
        DOM({ style: 'shop_separator_center' }),
      ),
    );

    return DOM(
      { style: 'launcher-notifications-panel' },
      DOM(
        { style: 'launcher-notifications-header' },
        DOM(
          { style: 'launcher-notifications-actions' },
          DOM(
            {
              domaudio: domAudioPresets.defaultButton,
              style: 'launcher-notifications-action',
              data: { action: 'refresh' },
              title: Lang.text('refresh'),
              event: ['click', () => App.refreshActiveNotificationsTab()],
            },
            '⟳',
          ),
          DOM(
            {
              domaudio: domAudioPresets.defaultButton,
              style: 'launcher-notifications-action',
              data: { variant: 'wide', action: 'read-all' },
              title: Lang.text('markAllRead'),
              event: ['click', () => App.markAllActiveNotificationsRead()],
            },
            Lang.text('markAllRead'),
          ),
          DOM(
            {
              domaudio: domAudioPresets.defaultButton,
              style: ['help-button', 'launcher-notifications-help-button'],
              title: Lang.text('help'),
              event: [
                'click',
                () => {
                  App.notificationsHelpVisible = !App.notificationsHelpVisible;
                  App.renderNotificationsPanel();
                },
              ],
            },
          ),
        ),
        DOM(
          {
            domaudio: domAudioPresets.closeButton,
            style: 'launcher-notifications-action',
            data: { variant: 'close' },
            title: Lang.text('close'),
            event: ['click', () => App.closeNotificationsPanel()],
          },
          '×',
        ),
      ),
      tabs,
      DOM({ style: 'launcher-notifications-toolbar' }, App.notificationsFilterNode, App.notificationsStatusNode),
      App.notificationsHelpNode,
      DOM({ style: 'launcher-notifications-body' }, App.notificationsListNode, App.notificationsDetailNode),
    );
  }

  static createNotificationsTab(tab, text) {
    const node = DOM(
      {
        domaudio: domAudioPresets.bigButton,
        style: 'launcher-notifications-tab',
        event: [
          'click',
          () => {
            if (App.notificationsActiveTab === tab) return;
            App.notificationsActiveTab = tab;
            App.notificationsHelpVisible = false;
            App.renderNotificationsPanel();
            if (tab === 'news') App.loadNotificationNews();
            else if (App.ensureNotificationsAuditLogin()) App.refreshNotifications({ showToasts: false });
          },
        ],
      },
      text,
    );
    App.notificationsTabs[tab] = node;
    return node;
  }

  static refreshActiveNotificationsTab() {
    if (App.notificationsActiveTab === 'news') {
      App.loadNotificationNews({ forceUpdate: true });
      return;
    }

    App.refreshNotifications({ showToasts: false });
  }

  static markAllActiveNotificationsRead() {
    if (App.notificationsActiveTab === 'news') {
      App.markAllNotificationNewsRead();
      return;
    }

    App.markAllNotificationsRead();
  }

  static renderNotifications() {
    App.renderNotificationsButton();
    App.renderNotificationsPanel();
  }

  static setNotificationsPanelStatus(text = '') {
    if (!App.notificationsStatusNode) return;

    const value = String(text || '');
    App.notificationsStatusNode.textContent = value;
    App.notificationsStatusNode.classList.toggle('is-empty', !value);
    App.notificationsStatusNode.parentElement?.classList.toggle('is-status-empty', !value);
  }

  static renderNotificationsPanel() {
    if (!App.notificationsPanel || !App.notificationsListNode || !App.notificationsDetailNode || !App.notificationsStatusNode) return;

    App.notificationsPanel.classList.toggle('is-news-tab', App.notificationsActiveTab === 'news');
    App.notificationsPanel.classList.toggle('is-notifications-tab', App.notificationsActiveTab !== 'news');
    for (const tab in App.notificationsTabs) {
      App.notificationsTabs[tab].classList.toggle('is-active', tab === App.notificationsActiveTab);
    }

    if (App.notificationsActiveTab === 'news') {
      App.renderNotificationNewsPanel();
      return;
    }

    if (App.notificationsLoading) {
      App.setNotificationsPanelStatus(Lang.text('notifChecking'));
    } else if (App.notificationsLastError) {
      App.setNotificationsPanelStatus(App.notificationsLastError);
    } else {
      App.setNotificationsPanelStatus();
    }

    App.notificationsListNode.replaceChildren();
    App.notificationsDetailNode.replaceChildren();
    if (App.notificationsFilterNode) App.notificationsFilterNode.value = App.notificationsFilter;
    if (App.notificationsHelpNode) App.notificationsHelpNode.classList.toggle('is-open', App.notificationsHelpVisible);

    if (!App.notifications.length) {
      const shouldOfferLogin = !App.hasGameAccountSession();
      if (shouldOfferLogin && !App.notificationsLoading) {
        App.notificationsListNode.append(
          DOM(
            { style: 'launcher-notifications-empty' },
            DOM({ tag: 'div' }, App.notificationsLastError ? `Audit: ${App.notificationsLastError}` : Lang.text('notifLoginRequired')),
            DOM(
              {
                domaudio: domAudioPresets.defaultButton,
                style: 'launcher-notifications-login-button',
                event: [
                  'click',
                  async () => {
                    App.closeNotificationsPanel();
                    await App.exit();
                  },
                ],
              },
              Lang.text('loginToAccount'),
            ),
          ),
        );
        App.notificationsDetailNode.append(DOM({ style: 'launcher-notifications-empty' }, Lang.text('notifAfterLogin')));
        return;
      }

      const emptyText = App.notificationsLoading
        ? Lang.text('notifChecking')
        : App.notificationsLastError
          ? `Audit: ${App.notificationsLastError}`
          : App.notificationsStatus || Lang.text('notifNone');
      App.notificationsListNode.append(DOM({ style: 'launcher-notifications-empty' }, emptyText));
      App.notificationsDetailNode.append(DOM({ style: 'launcher-notifications-empty' }, emptyText));
      return;
    }

    const filtered = App.getFilteredNotifications();
    if (!filtered.some((item) => item.id === App.notificationsSelectedId)) {
      App.notificationsSelectedId = filtered[0]?.id || App.notifications[0]?.id || 0;
    }

    if (!filtered.length) {
      App.notificationsListNode.append(DOM({ style: 'launcher-notifications-empty' }, Lang.text('categoryEmpty')));
      App.notificationsDetailNode.append(DOM({ style: 'launcher-notifications-empty' }, Lang.text('chooseAnotherFilter')));
      return;
    }

    for (const item of filtered) {
      App.notificationsListNode.append(App.createNotificationItem(item));
    }

    const selected = App.notifications.find((item) => item.id === App.notificationsSelectedId) || filtered[0];
    App.notificationsDetailNode.append(App.createNotificationDetail(selected));
  }

  static async loadNotificationNews({ forceUpdate = false, showToasts = false, render = true } = {}) {
    if (App.notificationsNewsLoading) return;

    App.notificationsNewsLoading = true;
    if (render) App.renderNotificationsPanel();

    try {
      const [auditResult, steamResult] = await Promise.allSettled([App.notificationsRequestNewsList(), App.loadSteamNotificationNews({ forceUpdate })]);
      const auditData = auditResult.status === 'fulfilled' ? auditResult.value : null;
      const auditList = Array.isArray(auditData?.list) ? auditData.list : [];
      const steamList = steamResult.status === 'fulfilled' && Array.isArray(steamResult.value) ? steamResult.value : [];
      const list = [...auditList, ...steamList];

      if (auditResult.status === 'rejected' && !steamList.length) throw auditResult.reason;
      if (steamResult.status === 'rejected') console.warn('Steam news failed', steamResult.reason);

      App.notificationsNews = list
        .map((item) => App.normalizeNotificationNews(item))
        .sort((a, b) => {
          const dateDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          return Number.isFinite(dateDiff) && dateDiff !== 0 ? dateDiff : Math.abs(Number(b.id) || 0) - Math.abs(Number(a.id) || 0);
        });
      const unreadCount = App.notificationsNews.filter((item) => !item.is_read).length;
      App.notificationsNewsUnreadCount = unreadCount;
      App.notificationsNewsStatus = App.notificationsNews.length ? Lang.text('newsUnreadCount').replace('{count}', unreadCount) : Lang.text('newsNone');
      if (!App.notificationsNews.some((item) => item.id === App.notificationsNewsSelectedId)) {
        App.notificationsNewsSelectedId = App.notificationsNews[0]?.id || 0;
      }
      if (showToasts) App.showNewNotificationNewsToasts();
      App.renderNotificationsButton();
    } catch (error) {
      App.notificationsNews = [];
      App.notificationsNewsUnreadCount = 0;
      App.notificationsNewsStatus = String(error?.message || error || Lang.text('newsLoadFailed'));
    } finally {
      App.notificationsNewsLoading = false;
      if (render) App.renderNotificationsPanel();
      App.renderNotificationsButton();
    }
  }

  static async loadSteamNotificationNews({ forceUpdate = false } = {}) {
    const cacheKey = `pwclassic_steam_news_${App.notificationsSteamAppId}`;
    const cached = App.readSteamNewsCache(cacheKey);
    if (!forceUpdate && cached && Date.now() - Number(cached.updatedAt || 0) < App.notificationsSteamNewsCacheMs) {
      return cached.news;
    }

    try {
      const rssUrl = `https://store.steampowered.com/feeds/news/app/${App.notificationsSteamAppId}/?l=russian&cc=RU`;
      const rssText = await App.fetchTextResource(rssUrl, {
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      const news = App.parseSteamNewsRss(rssText).slice(0, 5);
      App.writeSteamNewsCache(cacheKey, news);
      return news;
    } catch (error) {
      if (cached?.news?.length) return cached.news;
      throw error;
    }
  }

  static readSteamNewsCache(cacheKey) {
    try {
      const cached = JSON.parse(window.localStorage?.getItem(cacheKey) || 'null');
      return cached && Array.isArray(cached.news) ? cached : null;
    } catch (error) {
      return null;
    }
  }

  static writeSteamNewsCache(cacheKey, news) {
    try {
      window.localStorage?.setItem(cacheKey, JSON.stringify({ updatedAt: Date.now(), news }));
    } catch (error) {}
  }

  static async fetchTextResource(url, headers = {}) {
    if (NativeAPI.status && NativeAPI.https && /^https?:\/\//i.test(String(url || ''))) {
      return await App.nativeTextRequest(url, { headers });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const browserHeaders = { ...headers };
      delete browserHeaders['User-Agent'];
      const response = await fetch(url, { headers: browserHeaders, signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static async nativeTextRequest(url, options = {}) {
    return await new Promise((resolve, reject) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch (error) {
        reject(new Error('URL error'));
        return;
      }

      const request = NativeAPI.https.request(
        {
          method: options.method || 'GET',
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: `${parsedUrl.pathname}${parsedUrl.search}`,
          headers: options.headers || {},
          timeout: 10000,
        },
        (response) => {
          let responseText = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            responseText += chunk;
          });
          response.on('end', () => {
            if (Number(response.statusCode || 0) < 200 || Number(response.statusCode || 0) >= 300) {
              reject(new Error(`HTTP ${response.statusCode}`));
              return;
            }
            resolve(responseText);
          });
        },
      );

      request.on('timeout', () => request.destroy(new Error('Request timeout')));
      request.on('error', (error) => reject(new Error(error?.message || 'Network error')));
      request.end();
    });
  }

  static parseSteamNewsRss(rssText) {
    const xml = new DOMParser().parseFromString(String(rssText || ''), 'text/xml');
    const items = [...xml.querySelectorAll('channel > item')];

    return items.map((item) => {
      const title = App.getXmlNodeText(item, 'title') || 'Steam';
      const rawDescription = App.getXmlNodeText(item, 'description');
      const link = App.getXmlNodeText(item, 'link');
      const pubDate = App.getXmlNodeText(item, 'pubDate');
      const image = App.extractFirstSteamImage(rawDescription);
      const message = App.htmlToPlainText(rawDescription) || Lang.text('newsSteamNoDescription');
      const id = App.stablePositiveHash(`steam:${link || title}:${pubDate}`);

      return {
        id,
        title,
        message,
        details: '',
        content_html: App.processSteamNewsMarkup(rawDescription),
        type: 'steam',
        source: 'steam',
        banner_url: App.normalizeAuditAssetUrl(image || ''),
        action_url: link,
        created_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        is_external: true,
      };
    });
  }

  static getXmlNodeText(parent, selector) {
    return String(parent.querySelector(selector)?.textContent || '').trim();
  }

  static extractFirstSteamImage(content) {
    const doc = new DOMParser().parseFromString(String(content || ''), 'text/html');
    return String(doc.querySelector('img')?.getAttribute('src') || '').trim();
  }

  static processSteamNewsMarkup(content) {
    return App.sanitizeNewsHtml(String(content || ''));
  }

  static htmlToPlainText(content) {
    const doc = new DOMParser().parseFromString(String(content || ''), 'text/html');
    doc.querySelectorAll('script, style').forEach((node) => node.remove());
    doc.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
    doc.querySelectorAll('p, div, li, h1, h2, h3').forEach((node) => node.append('\n'));
    return String(doc.body?.textContent || '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  static stablePositiveHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  }

  static showNewNotificationNewsToasts() {
    const pending = App.notificationsNews.filter(
      (item) =>
        item.id > 0 &&
        !item.is_read &&
        App.isNotificationNewsToastFresh(item) &&
        !App.notificationsNewsToastIds.has(item.id) &&
        !App.isNotificationNewsLocallyMarked('toast', item.id),
    );
    if (!pending.length) return;

    App.playNotificationSound();
    pending.forEach((item, index) => {
      App.notificationsNewsToastIds.add(item.id);
      App.rememberNotificationNewsLocalId('toast', item.id);
      setTimeout(() => App.showNotificationNewsToast(item), index * 650);
    });
  }

  static isNotificationNewsToastFresh(item) {
    const date = new Date(String(item?.created_at || item?.publish_at || item?.scheduled_at || '').replace(' ', 'T'));
    if (!Number.isFinite(date.getTime())) return true;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return Date.now() - date.getTime() <= sevenDaysMs;
  }

  static isMajorNotificationNews(item) {
    if (item?.is_major === true || item?.release_type === 'major') return true;
    const title = String(item?.title || '').trim();
    return /^(?:(?:крупное|большое|глобальное|major)\s+)?(?:обновление|update|release)\s+(?:v\s*)?[1-9]\d*\.0(?:\.0)?(?=$|[\s:!\u2013\u2014-])/iu.test(title);
  }

  static normalizeNotificationNews(item) {
    const id = Number(item?.id || 0);
    const text = String(item?.text || item?.title || '');
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const title = String(item?.title || lines[0] || Lang.text('newsSingle'));
    const message = String(item?.message || (lines.length > 1 ? lines.slice(1).join('\n') : text || Lang.text('newsNoDescription')));
    const type = String(item?.type || 'news');

    return {
      id,
      title,
      is_major: App.isMajorNotificationNews({ ...item, title }),
      message,
      details: String(item?.details || ''),
      content_html: App.sanitizeNewsHtml(item?.content_html || item?.contents_html || item?.html || ''),
      type,
      source: String(item?.source || ''),
      banner_url: App.normalizeAuditAssetUrl(item?.banner_url || item?.image_url || ''),
      action_url: String(item?.action_url || item?.url || ''),
      created_at: String(item?.created_at || item?.date || ''),
      expires_at: String(item?.expires_at || ''),
      publish_at: String(item?.publish_at || ''),
      scheduled_at: String(item?.scheduled_at || ''),
      is_external: Boolean(item?.is_external),
      is_read:
        Boolean(item?.is_read) ||
        Boolean(item?.read_at) ||
        Boolean(item?.status) ||
        App.isNotificationNewsLocallyMarked('read', id),
    };
  }

  static renderNotificationNewsPanel() {
    App.notificationsListNode.replaceChildren();
    App.notificationsDetailNode.replaceChildren();
    if (App.notificationsFilterNode) App.notificationsFilterNode.value = 'all';
    if (App.notificationsHelpNode) App.notificationsHelpNode.classList.toggle('is-open', App.notificationsHelpVisible);
    App.setNotificationsPanelStatus(App.notificationsNewsLoading ? Lang.text('newsLoading') : '');

    if (App.notificationsNewsLoading && !App.notificationsNews.length) {
      App.notificationsListNode.append(DOM({ style: 'launcher-notifications-empty' }, Lang.text('newsLoading')));
      App.notificationsDetailNode.append(DOM({ style: 'launcher-notifications-empty' }, Lang.text('newsWillAppear')));
      return;
    }

    if (!App.notificationsNews.length) {
      App.notificationsListNode.append(DOM({ style: 'launcher-notifications-empty' }, App.notificationsNewsStatus || Lang.text('newsNone')));
      App.notificationsDetailNode.append(DOM({ style: 'launcher-notifications-empty' }, Lang.text('newsFreshWillAppear')));
      return;
    }

    for (const item of App.notificationsNews) {
      App.notificationsListNode.append(App.createNotificationNewsItem(item));
    }

    const selected = App.notificationsNews.find((item) => item.id === App.notificationsNewsSelectedId) || App.notificationsNews[0];
    App.notificationsDetailNode.append(App.createNotificationNewsDetail(selected));
  }

  static openAdminNewsEditor(item) {
    if (!item || item.source === 'steam' || item.is_external || !Window.canManageNews?.()) return;
    Window.pendingNewsEdit = item;
    App.closeNotificationsPanel();
    Window.show('main', 'adminNewsPanel');
  }

  static createNotificationNewsItem(item) {
    const classes = [
      'launcher-notification-item',
      'launcher-news-item',
      item.is_major ? 'is-major-release' : '',
      item.is_read ? 'is-read' : 'is-unread',
      App.notificationsNewsSelectedId === item.id ? 'is-selected' : '',
    ].filter(Boolean);
    const canEdit = Window.canManageNews?.() && item.source !== 'steam' && !item.is_external;
    const editButton = canEdit
      ? DOM(
          {
            tag: 'button',
            type: 'button',
            domaudio: domAudioPresets.defaultButton,
            style: 'launcher-news-edit-button',
            title: Lang.text('newsEdit'),
            event: [
              'click',
              (event) => {
                event.preventDefault();
                event.stopPropagation();
                App.openAdminNewsEditor(item);
              },
            ],
          },
        )
      : DOM();

    return DOM(
      {
        style: classes,
        event: [
          'click',
          () => {
            App.notificationsNewsSelectedId = item.id;
            App.renderNotificationsPanel();
          },
        ],
      },
      DOM({ style: ['launcher-notification-unread-dot', item.is_read ? 'is-hidden' : ''].filter(Boolean) }),
      App.createNotificationNewsThumb(item),
      DOM(
        { style: 'launcher-notification-summary' },
        DOM(
          { style: 'launcher-notification-meta' },
          DOM({ style: 'launcher-notification-title' }, item.title),
          DOM({ style: 'launcher-notification-date' }, item.created_at ? App.formatNotificationShortDate(item.created_at) : Lang.text('news')),
        ),
        DOM({ style: 'launcher-notification-message' }, item.message),
      ),
      editButton,
    );
  }

  static createNotificationNewsThumb(item) {
    const thumb = DOM({ style: 'launcher-news-thumb' });
    if (item?.banner_url) thumb.style.backgroundImage = `url("${item.banner_url}")`;
    return thumb;
  }

  static createNotificationNewsBody(item, style, { full = false } = {}) {
    const body = DOM({ style: ['launcher-news-rich-content', style].filter(Boolean) });
    const fragment = document.createDocumentFragment();

    if (item?.content_html) {
      fragment.append(App.newsHtmlToFragment(item.content_html, { skipFirstImageSrc: item.banner_url }));
    } else {
      fragment.append(App.newsTextToFragment(item?.message || '', { skipFirstImageSrc: item.banner_url }));
      if (full && item?.details) {
        const separator = DOM({ style: 'launcher-news-rich-separator' });
        fragment.append(separator, App.newsTextToFragment(item.details));
      }
    }

    if (!fragment.childNodes.length) fragment.append(String(item?.message || ''));
    body.append(fragment);
    return body;
  }

  static newsTextToFragment(text, options = {}) {
    const fragment = document.createDocumentFragment();
    const source = String(text || '');
    const imagePattern = /!\[([^\]]*)\]\(([^)\s]+)\)|\[img(?::|=)([^\]\s|]+)(?:\|([^\]]+))?\]/gi;
    const lines = source.split(/\r?\n/);
    const skipFirstImageSrc = App.normalizeComparableUrl(options.skipFirstImageSrc || '');
    let skippedFirstImage = false;

    lines.forEach((line, lineIndex) => {
      let cursor = 0;
      let match;
      imagePattern.lastIndex = 0;
      while ((match = imagePattern.exec(line))) {
        if (match.index > cursor) fragment.append(line.slice(cursor, match.index));
        const alt = String(match[1] || match[4] || Lang.text('newsImageAlt')).trim();
        const src = App.normalizeAuditAssetUrl(match[2] || match[3] || '');
        if (src && (!skipFirstImageSrc || skippedFirstImage || App.normalizeComparableUrl(src) !== skipFirstImageSrc)) {
          fragment.append(App.createNewsInlineImage(src, alt));
        } else if (src) {
          skippedFirstImage = true;
        }
        cursor = imagePattern.lastIndex;
      }
      if (cursor < line.length) fragment.append(line.slice(cursor));
      if (lineIndex < lines.length - 1) fragment.append(DOM({ tag: 'br' }));
    });

    return fragment;
  }

  static newsHtmlToFragment(html, options = {}) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const fragment = document.createDocumentFragment();
    const state = {
      skipFirstImageSrc: App.normalizeComparableUrl(options.skipFirstImageSrc || ''),
      skippedFirstImage: false,
    };
    [...doc.body.childNodes].forEach((node) => {
      const cleanNode = App.cloneAllowedNewsNode(node, state);
      if (cleanNode) fragment.append(cleanNode);
    });
    return fragment;
  }

  static cloneAllowedNewsNode(node, state = {}) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return null;
    if (tag === 'img') {
      const src = App.normalizeAuditAssetUrl(node.getAttribute('src') || '');
      if (!src) return null;
      if (!state.skippedFirstImage && state.skipFirstImageSrc && App.normalizeComparableUrl(src) === state.skipFirstImageSrc) {
        state.skippedFirstImage = true;
        return null;
      }
      return App.createNewsInlineImage(src, node.getAttribute('alt') || Lang.text('newsImageAlt'));
    }

    if (tag === 'a') {
      const href = App.normalizeExternalUrl(node.getAttribute('href') || '');
      const link = document.createElement(href ? 'a' : 'span');
      if (href) {
        link.href = href;
        link.className = 'launcher-news-link';
        link.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          App.OpenExternalLink(href);
        });
      }
      [...node.childNodes].forEach((child) => {
        const cleanChild = App.cloneAllowedNewsNode(child, state);
        if (cleanChild) link.append(cleanChild);
      });
      return link;
    }

    const allowedTags = new Set(['p', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'br']);
    const element = document.createElement(allowedTags.has(tag) ? tag : 'span');
    [...node.childNodes].forEach((child) => {
      const cleanChild = App.cloneAllowedNewsNode(child, state);
      if (cleanChild) element.append(cleanChild);
    });
    return element;
  }

  static normalizeComparableUrl(value) {
    return App.normalizeAuditAssetUrl(value)
      .replace(/^https?:\/\//i, '//')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }

  static normalizeExternalUrl(value) {
    const url = String(value || '').trim();
    if (/^\/\//.test(url)) return `https:${url}`;
    if (/^https?:\/\//i.test(url)) return url;
    return '';
  }

  static createNewsInlineImage(src, alt = '') {
    const image = DOM({
      tag: 'img',
      style: 'launcher-news-inline-image',
      src,
      alt: String(alt || Lang.text('newsImageAlt')),
      loading: 'lazy',
    });
    return image;
  }

  static sanitizeNewsHtml(html) {
    const clean = App.newsHtmlToFragment(html);
    const wrapper = document.createElement('div');
    wrapper.append(clean);
    return wrapper.innerHTML;
  }

  static createNotificationNewsDetail(item) {
    if (!item) return DOM({ style: 'launcher-notifications-empty' }, Lang.text('newsNone'));

    const banner = DOM(
      { style: 'launcher-news-banner' },
      DOM({ style: 'launcher-news-banner-shine' }),
      DOM(
        { style: 'launcher-news-banner-content' },
        DOM(
          { style: 'launcher-news-banner-badges' },
          DOM({ style: 'launcher-news-label' }, App.getNotificationNewsLifetimeLabel(item)),
          DOM({ style: ['launcher-news-state-badge', item.is_read ? 'is-read' : 'is-unread'] }, item.is_read ? Lang.text('newsRead') : Lang.text('newsNew')),
        ),
        DOM({ style: 'launcher-news-banner-title' }, item.title),
      ),
    );
    if (item.banner_url) {
      banner.style.backgroundImage = `linear-gradient(90deg, rgba(0, 25, 32, 0.22), rgba(0, 25, 32, 0.74)), url("${item.banner_url}")`;
    }

    return DOM(
      { style: ['launcher-notification-detail-card', 'launcher-news-detail-card', item.is_read ? 'is-read' : 'is-unread'].filter(Boolean) },
      banner,
      DOM(
        { style: 'launcher-news-content' },
        DOM(
          { style: 'launcher-news-preview-frame' },
          App.createNotificationNewsBody(item, 'launcher-news-description'),
          DOM({ style: 'launcher-news-preview-fade' }),
        ),
        DOM(
            {
              tag: 'button',
              domaudio: domAudioPresets.defaultButton,
              style: 'launcher-news-read-button',
              event: [
                'click',
                (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  App.openNotificationNewsReader(item);
                },
              ],
            },
            Lang.text('continueReading'),
          ),
        ),
    );
  }

  static getNotificationNewsLifetimeLabel(item) {
    if (item?.source === 'steam') return 'Steam';
    if (item?.expires_at) return Lang.text('newsUntil').replace('{date}', App.formatNotificationShortDate(item.expires_at));
    return item?.created_at ? App.formatNotificationShortDate(item.created_at) : Lang.text('newsPermanent');
  }

  static async markNotificationNewsRead(id) {
    id = Number(id || 0);
    if (!id) return;

    const item = App.notificationsNews.find((current) => current.id === id);
    const wasUnread = item && !item.is_read;
    if (item && !item.is_read) {
      item.is_read = true;
      App.notificationsNewsUnreadCount = Math.max(0, App.notificationsNewsUnreadCount - 1);
      App.notificationsNewsStatus = App.notificationsNews.length
      ? Lang.text('newsUnreadCount').replace('{count}', App.notificationsNewsUnreadCount)
      : Lang.text('newsNone');
      App.rememberNotificationNewsLocalId('read', id);
      App.renderNotificationsButton();
    }
    if (item && (!wasUnread || item.is_external || item.source === 'steam')) return;

    try {
      await App.notificationsRequestNewsAction('news_read', { news_id: id });
    } catch (error) {
      console.warn('Remote news read status failed', error);
    }
  }

  static async markAllNotificationNewsRead() {
    if (App.notificationsActionLocked) return;

    const unread = App.notificationsNews.filter((item) => !item.is_read);
    if (!unread.length) return;

    App.notificationsActionLocked = true;
    unread.forEach((item) => {
      item.is_read = true;
      App.rememberNotificationNewsLocalId('read', item.id);
    });
    App.notificationsNewsUnreadCount = 0;
    App.notificationsNewsStatus = App.notificationsNews.length ? Lang.text('newsUnreadCount').replace('{count}', 0) : Lang.text('newsNone');
    App.renderNotifications();

    try {
      const remoteIds = unread.filter((item) => !item.is_external && item.source !== 'steam' && item.id > 0).map((item) => item.id);
      await Promise.all(remoteIds.map((id) => App.notificationsRequestNewsAction('news_read', { news_id: id })));
    } catch (error) {
      console.warn('Remote news read all status failed', error);
    } finally {
      App.notificationsActionLocked = false;
      App.renderNotifications();
    }
  }

  static openNotificationNewsReader(item) {
    if (!item) return;
    App.notificationsActiveTab = 'news';
    App.notificationsNewsSelectedId = item.id;
    App.notificationsHelpVisible = false;
    App.markNotificationNewsRead(item.id);
    App.closeNotificationNewsReader();
    App.openNotificationsPanel();

    const banner = DOM(
      { style: 'launcher-news-reader-banner' },
      DOM(
        { style: 'launcher-news-banner-badges' },
        DOM({ style: 'launcher-news-label' }, App.getNotificationNewsLifetimeLabel(item)),
        DOM({ style: ['launcher-news-state-badge', 'is-read'] }, Lang.text('newsRead')),
      ),
      DOM({ style: 'launcher-news-reader-title' }, item.title),
    );
    if (item.banner_url) {
      banner.style.backgroundImage = `linear-gradient(90deg, rgba(0, 25, 32, 0.2), rgba(0, 25, 32, 0.78)), url("${item.banner_url}")`;
    }

    App.notificationsNewsReaderNode = DOM(
      { style: 'launcher-news-reader-overlay' },
      DOM(
        {
          style: 'launcher-news-reader-backdrop',
          event: ['click', () => App.closeNotificationNewsReader({ reopenNewsPanel: true })],
        },
      ),
      DOM(
        { style: 'launcher-news-reader' },
        DOM(
          {
            domaudio: domAudioPresets.closeButton,
            style: 'launcher-news-reader-close',
            event: ['click', () => App.closeNotificationNewsReader({ reopenNewsPanel: true })],
          },
          '×',
        ),
        banner,
        DOM(
          { style: 'launcher-news-reader-scroll' },
          DOM(
            { style: 'launcher-news-reader-body' },
            App.createNotificationNewsBody(item, 'launcher-news-reader-message', { full: true }),
          ),
        ),
      ),
    );

    document.body.appendChild(App.notificationsNewsReaderNode);
    setTimeout(() => App.notificationsNewsReaderNode?.classList.add('is-open'), 0);
  }

  static closeNotificationNewsReader({ reopenNewsPanel = false } = {}) {
    const reader = App.notificationsNewsReaderNode;
    if (!reader) {
      if (reopenNewsPanel) {
        App.notificationsActiveTab = 'news';
        App.openNotificationsPanel();
      }
      return;
    }

    reader.classList.remove('is-open');
    setTimeout(() => {
      if (reader.isConnected) reader.remove();
      if (App.notificationsNewsReaderNode === reader) App.notificationsNewsReaderNode = null;
      if (reopenNewsPanel) {
        App.notificationsActiveTab = 'news';
        App.openNotificationsPanel();
      }
    }, 180);
  }

  static createNotificationItem(item) {
    const type = App.getNotificationVisualType(item);
    const classes = [
      'launcher-notification-item',
      `is-${type}`,
      item.is_read ? 'is-read' : 'is-unread',
      item.is_global ? 'is-global' : 'is-personal',
      App.notificationsSelectedId === item.id ? 'is-selected' : '',
      App.notificationsReadAnimationIds.has(item.id) ? 'is-just-read' : '',
    ].filter(Boolean);

    return DOM(
      {
        style: classes,
        event: [
          'click',
          () => {
            App.notificationsSelectedId = item.id;
            App.renderNotificationsPanel();
          },
        ],
      },
      DOM({ style: ['launcher-notification-unread-dot', item.is_read ? 'is-hidden' : ''].filter(Boolean) }),
      DOM({ style: ['launcher-notification-type-icon', `is-${type}`] }),
      DOM(
        { style: 'launcher-notification-summary' },
        DOM(
          { style: 'launcher-notification-meta' },
          DOM({ style: 'launcher-notification-title' }, item.title),
          DOM({ style: 'launcher-notification-date' }, App.formatNotificationShortDate(item.created_at)),
        ),
        DOM({ style: 'launcher-notification-message' }, item.message),
      ),
    );
  }

  static createNotificationDetail(item) {
    if (!item) return DOM({ style: 'launcher-notifications-empty' }, Lang.text('notifNone'));

    const type = App.getNotificationVisualType(item);
    const banner = item.banner_url ? DOM({ style: 'launcher-notification-banner' }) : DOM();
    if (item.banner_url) {
      banner.style.backgroundImage = `linear-gradient(90deg, rgba(1, 24, 30, 0.22), rgba(1, 24, 30, 0.74)), url("${item.banner_url}")`;
    }
    const readButton = item.is_read
      ? DOM()
      : DOM(
          {
            domaudio: domAudioPresets.defaultButton,
            style: 'launcher-notification-read-button',
            event: ['click', () => App.markNotificationRead(item.id)],
          },
          Lang.text('markRead'),
        );

    return DOM(
      { style: ['launcher-notification-detail-card', `is-${type}`, item.is_read ? 'is-read' : 'is-unread', App.notificationsReadAnimationIds.has(item.id) ? 'is-just-read' : ''].filter(Boolean) },
      banner,
      DOM(
        { style: 'launcher-notification-detail-head' },
        DOM({ style: ['launcher-notification-type-icon', 'is-large', `is-${type}`] }),
        DOM({ style: 'launcher-notification-detail-title' }, item.title),
        DOM({ style: 'launcher-notification-detail-date' }, App.formatNotificationDate(item.created_at)),
      ),
      DOM({ style: 'launcher-notification-detail-separator' }),
      DOM({ style: 'launcher-notification-detail-message' }, item.message),
      item.details ? DOM({ style: 'launcher-notification-details' }, item.details) : DOM(),
      DOM(
        { style: 'launcher-notification-detail-status' },
        DOM({ style: 'launcher-notification-detail-check' }, uiIcon('check')),
        DOM({}, item.is_read ? Lang.text('notifStatusRead') : Lang.text('notifStatusUnread')),
      ),
      DOM({ style: 'launcher-notification-footer' }, readButton),
    );
  }

  static getFilteredNotifications() {
    if (App.notificationsFilter === 'unread') return App.notifications.filter((item) => !item.is_read);
    if (App.notificationsFilter === 'read') return App.notifications.filter((item) => item.is_read);
    return App.notifications;
  }

  static getNotificationVisualType(item) {
    const source = `${item?.type || ''} ${item?.title || ''} ${item?.message || ''}`.toLowerCase();
    if (source.includes('report') || source.includes('репорт') || source.includes('жалоб')) return 'report';
    if (source.includes('commend') || source.includes('praise') || source.includes('похвал') || source.includes('лайк')) return 'praise';
    if (source.includes('achievement') || source.includes('достижен')) return 'achievement';
    return 'system';
  }

  static getNotificationScopeLabel(item) {
    return item.is_global || item.target_type === 'all' ? Lang.text('notifScopeGlobal') : Lang.text('notifScopePersonal');
  }

  static formatNotificationDate(value) {
    const date = new Date(String(value || '').replace(' ', 'T'));
    if (!Number.isFinite(date.getTime())) return String(value || '');

    return date.toLocaleString(View.getFriendLastSeenLocale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  static formatNotificationShortDate(value) {
    const date = new Date(String(value || '').replace(' ', 'T'));
    if (!Number.isFinite(date.getTime())) return String(value || '');

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const time = date.toLocaleTimeString(View.getFriendLastSeenLocale(), { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === now.toDateString()) return time;
    if (date.toDateString() === yesterday.toDateString()) return Lang.text('yesterdayAt').replace('{time}', time);
    return date.toLocaleDateString(View.getFriendLastSeenLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  static ensureNotificationsToastRoot() {
    if (App.notificationsToastRoot?.isConnected) return;

    App.notificationsToastRoot = DOM({ style: 'launcher-notifications-toast-root' });
    document.body.append(App.notificationsToastRoot);
  }

  static async authorization(login, password) {
    if (!login.value) {
      login.setAttribute('style', 'background:rgba(255,0,0,0.3)');

      return App.error(Lang.text('loginRequiredError'));
    }

    if (!password.value) {
      password.setAttribute('style', 'background:rgba(255,0,0,0.3)');

      return App.error(Lang.text('passwordRequiredError'));
    }

    let request, analysis;

    try {
      analysis = NativeAPI.analysis();
    } catch (e) {}

    if (analysis && App.api) {
      analysis.api = App.api.connectionInfo();
    }

    try {
      request = await App.api.request('user', 'authorization', {
        login: login.value.trim(),
        password: password.value.trim(),
        analysis: analysis,
        mac: NativeAPI.getMACAdress(),
        cache: await NativeAPI.getCacheIndex(),
      });
    } catch (error) {
      await App.handleAuthPulseSignal(error, { ownerLogin: login.value.trim() });
      return App.error(error);
    }

    const activePulse = await App.syncAuthPulse();
    if (App.isAuthPulseActive(activePulse)) {
      const ownerLogin = `${activePulse?.ownerLogin || ''}`.trim().toLowerCase();
      const ownerId = Number(activePulse?.ownerId || 0);
      const hasOwnerMeta = !!ownerLogin || ownerId > 0;
      const enteredLogin = `${login.value || ''}`.trim().toLowerCase();
      if (!hasOwnerMeta || (ownerLogin && enteredLogin && ownerLogin === enteredLogin)) {
        await App.writeAuthPulse(null);
      } else {
        return App.error(App.buildAuthPulseMessage(activePulse));
      }
    }

    await App.writeAuthPulse(null);

    await App.storage.set({
      id: request.id,
      token: request.token,
      login: login.value,
      fraction: request.fraction,
      launcherToken: request.launcherToken || '',
      auditToken: request.auditToken || '',
    });

    App.notificationsAuthChanged();

    View.show('castle');
  }

  static formatNicknameCooldown(ms = 0) {
    const totalMinutes = Math.max(0, Math.ceil(Number(ms || 0) / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const dayUnit = Lang.text('nicknameTimeDayShort');
    const hourUnit = Lang.text('nicknameTimeHourShort');
    const minuteUnit = Lang.text('nicknameTimeMinuteShort');
    const parts = [];
    if (days > 0) parts.push(`${days}${dayUnit}`);
    if (hours > 0 || days > 0) parts.push(`${hours}${hourUnit}`);
    parts.push(`${minutes}${minuteUnit}`);
    return parts.join(' ');
  }

  static showAccountSplash(template) {
    Splash.show(template);
    const overlay = DOM({ style: 'window__overlay' });
    Splash.body.style.background = 'transparent';
    Splash.body.prepend(overlay);
    Splash.body.querySelector('.splash-content')?.classList.add('splash-content--account');
  }

  static async setNickname() {
    let isClosed = false;
    
    const close = DOM({
      tag: 'div',
      domaudio: domAudioPresets.closeButton,
      style: 'close-button',
      event: [
        'click',
        () => {
          isClosed = true;
          Splash.hide();
        },
      ],
    });

    close.style.backgroundImage = 'url(content/icons/close-cropped.svg)';

    let template = document.createDocumentFragment();
    let modal = DOM({style: 'title-modal'}, DOM({style: 'title-modal-text'}, Lang.text('nicknamePlaceholder')));
    let title = DOM({ tag: 'div', style: 'castle-menu-text', id: 'castle-menu-text-change-nickname' }, Lang.text('nicknameChangeCooldown'));
    const loadingTemplate = document.createDocumentFragment();
    loadingTemplate.append(
      DOM({style: 'title-modal'}, DOM({style: 'title-modal-text'}, Lang.text('nicknamePlaceholder'))),
      DOM({ style: 'splash-account-loader' }),
      DOM({ tag: 'div', style: 'splash-account-loader-text' }, Lang.text('loading')),
      close,
    );
    App.showAccountSplash(loadingTemplate);

    try {
      const cooldown = await App.api.request('user', 'nicknameCooldown', {});
      const remainingMs = Number(cooldown?.remainingMs || 0);
      title.textContent = remainingMs > 0
        ? Lang.text('nicknameChangeRemaining').replace('{time}', App.formatNicknameCooldown(remainingMs))
        : Lang.text('nicknameChangeReadyNow');
    } catch {}

    if (isClosed || Splash.body?.style.display === 'none') {
      return;
    }

    let name = DOM({
      domaudio: domAudioPresets.defaultInput,
      tag: 'input',
      placeholder: Lang.text('nicknamePlaceholder'),
      value: App.storage.data.login,
    });

    let button = DOM(
      {
        domaudio: domAudioPresets.bigButton,
        style: ['splash-content-button-modal', 'splash-nickname-sized-button'],
        event: [
          'click',
          async () => {
            if (!name.value) {
              Splash.hide();

              return;
            }

            if (App.storage.data.login == name.value) {
              Splash.hide();

              return;
            }

            try {
              await App.api.request('user', 'set', { nickname: name.value });
            } catch (error) {
              return App.error(error);
            }

            await App.storage.set({ login: name.value });

            View.show('castle');

            Splash.hide();
          },
        ],
      },
      Lang.text('apply'),
    );

    template.append(DOM({ style: 'splash-modal-scope-account-action' }), modal, title,name, button, close);

    App.showAccountSplash(template);
  }

  static setFraction() {
    const close = DOM({
      tag: 'div',
      domaudio: domAudioPresets.closeButton,
      style: 'close-button',
      event: ['click', () => Splash.hide()],
    });
    close.style.backgroundImage = 'url(content/icons/close-cropped.svg)';

    let template = document.createDocumentFragment();
    const title = DOM({style: 'title-modal'}, DOM({style: 'title-modal-text'}, Lang.text('select_faction')));  
    Object.assign(title.style, {
      textAlign: 'center',
      color: '#fff',
      textShadow: '0 0 5px rgba(0,0,0,0.5)',
      marginBottom: '30px',
      fontSize: '24px',
    });

    const factionsContainer = DOM({ tag: 'div', style: 'factions-container' });
    Object.assign(factionsContainer.style, {
      display: 'flex',
      gap: '5%',
      justifyContent: 'center',
      marginBottom: '30px',
      flexWrap: 'wrap',
      width: '90%',
      maxWidth: '600px',
      margin: '0 auto',
      marginTop: '4 cqh',
    });

    const factions = [
      { id: 1, name: Lang.text('adorians'), icon: 'Elf_logo_over.webp?v=20260920-faction-icons' },
      { id: 2, name: Lang.text('dokts'), icon: 'Human_logo_over2.webp?v=20260920-faction-icons' },
    ];

    const calculateIconSize = () => {
      const windowWidth = window.innerWidth;
      if (windowWidth < 500) return '20vw';
      if (windowWidth < 768) return '15vw';
      return '120px';
    };

    let selectedFaction = App.storage.data.fraction;

    factions.forEach((faction) => {
      const factionElement = DOM({
        tag: 'div',
        domaudio: domAudioPresets.defaultButton,
        style: ['faction-item', ...(selectedFaction === faction.id ? ['faction-item-selected'] : [])],
        event: [
          'click',
          () => {
            selectedFaction = faction.id;

            factionsContainer.querySelectorAll('.faction-item').forEach((item) => {
              item.classList.toggle('faction-item-selected', item === factionElement);
            });
          },
        ],
      });

      const iconSize = calculateIconSize();
      Object.assign(factionElement.style, {
        width: iconSize,
        height: iconSize,
        minWidth: '80px',
        minHeight: '80px',
        maxWidth: '150px',
        maxHeight: '150px',
        backgroundImage: `url(content/icons/${faction.icon})`,
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        cursor: 'url(content/img/cursor_button32x32.png) 0 0, pointer',
        borderRadius: '10px',
      });

      const nameLabel = DOM({ tag: 'div', style: 'faction-name' }, faction.name);
      Object.assign(nameLabel.style, {
        textAlign: 'center',
        color: 'rgb(252, 229, 188)',
        marginTop: '1.1cqh',
        textShadow: '0 0.18cqh 0.18cqh rgba(0, 0, 0, 0.72)',
        font: "1.72cqh / 1.18 'DejaVuSans', sans-serif",
      });

      const wrapper = DOM({ tag: 'div', style: 'faction-wrapper' });
      Object.assign(wrapper.style, {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        margin: '10px',
      });

      wrapper.append(factionElement, nameLabel);
      factionsContainer.append(wrapper);
    });

    const button = DOM(
      {
        style: 'splash-content-button-modal',
        id: 'splash-content-button-modal-fraction',
        domaudio: domAudioPresets.bigButton,
        event: [
          'click',
          async () => {
            if (!selectedFaction) {
              Splash.hide();
              return;
            }

            try {
              await App.api.request('user', 'set', {
                fraction: selectedFaction,
              });
            } catch (error) {
              return App.error(error);
            }

            await App.storage.set({ fraction: selectedFaction });

            Splash.hide();

            // 3D-замок создаётся один раз (Castle.initDemo), поэтому раньше новая фракция появлялась
            // только после перезапуска лаунчера. Теперь пересобираем лишь сцену замка, а в интерфейсе —
            // только то, что зависит от фракции (View.refreshCastleFaction): окна остаются открытыми.
            if (Castle.gl) {
              // пока собирается сцена новой фракции, на гербе — «Обновление замка»
              View.setCastleFactionUpdating(true);
              try {
                await Castle.switchScene(Number(selectedFaction) == 1 ? 'ad' : 'doct');
              } catch (error) {
                App.error(error);
              } finally {
                View.setCastleFactionUpdating(false);
              }
            }

            if (!Castle.gl || !View.refreshCastleFaction()) {
              View.show('castle');
            }
          },
        ],
      },
      Lang.text('apply'),
    );

    const resizeHandler = () => {
      const iconSize = calculateIconSize();
      factionsContainer.querySelectorAll('.faction-item').forEach((icon) => {
        icon.style.width = iconSize;
        icon.style.height = iconSize;
      });
    };

    window.addEventListener('resize', resizeHandler);

    close.addEventListener('click', () => {
      window.removeEventListener('resize', resizeHandler);
    });

    template.append(DOM({ style: 'splash-modal-scope-account-action' }), title, factionsContainer, button, close);
    App.showAccountSplash(template);
  }

  static async registration(fraction, invite, login, password, password2) {
    if (!fraction.value || !invite.value || !login.value || !password.value || !password2.value) {
      return App.error(Lang.text('missingValuesError'));
    }

    if (password.value != password2.value) {
      password.setAttribute('style', 'background:rgba(255,0,0,0.3)');

      password2.setAttribute('style', 'background:rgba(255,0,0,0.3)');

      return App.error(Lang.text('passwordsMismatchError'));
    }

    let request, analysis;

    try {
      analysis = NativeAPI.analysis();
    } catch (e) {}

    if (analysis && App.api) {
      analysis.api = App.api.connectionInfo();
    }

    try {
      request = await App.api.request('user', 'registration', {
        fraction: fraction.value,
        invite: invite.value.trim(),
        login: login.value.trim(),
        password: password.value.trim(),
        analysis: analysis,
        mac: NativeAPI.getMACAdress(),
        cache: await NativeAPI.getCacheIndex(),
      });
    } catch (error) {
      return App.error(error);
    }

    await App.storage.set({
      id: request.id,
      token: request.token,
      login: login.value,
      fraction: fraction.value,
      launcherToken: request.launcherToken || '',
      auditToken: request.auditToken || '',
    });

    App.notificationsAuthChanged();

    View.show('castle');
  }

  // Адрес соглашения об обработке ПДн и признак «сервер умеет регистрацию через
  // провайдеров» — ОДИН запрос user.agreementUrl, кэш на сессию. Адрес в
  // клиенте не хардкодится (меняется env AGREEMENT_URL на бэкенде).
  //
  // Тот же запрос — capability-проба: на СТАРОМ бэкенде метода нет в
  // Api.unauthorizedMethods, ответ — «Access denied.». Кнопки
  // «Зарегистрироваться через Steam/Яндекс» при этом прячутся: старый сервер не
  // понимает ?mode=register (его catch-all уводит попап на обычный вход) и
  // зарегистрировал бы аккаунт по-старому — без ника, фракции и согласия.
  static agreementUrl = '';
  static providerRegistrationEnabled = false;
  static authCapabilities = null;

  static async fetchAuthCapabilities() {
    if (App.authCapabilities) {
      return App.authCapabilities;
    }

    if (!App.api) {
      return null;
    }

    try {
      let request = await App.api.request('user', 'agreementUrl', {});

      App.agreementUrl = `${(request && request.url) || ''}`.trim();
      App.providerRegistrationEnabled = !!App.agreementUrl;
    } catch (error) {
      // Старый бэкенд (или ещё не поднятый WS) — тишина, тоста не будет:
      // экран регистрации обязан открыться и без провайдеров.
      App.agreementUrl = '';
      App.providerRegistrationEnabled = false;
      return null;
    }

    App.authCapabilities = {
      agreementUrl: App.agreementUrl,
      providers: App.providerRegistrationEnabled,
    };

    return App.authCapabilities;
  }

  // Регистрация через провайдера: страницу рисует лончер (эталон — steam.js:
  // провайдер отдаёт только postMessage). Билет приходит из попапа
  // (ParentEvent.register) и живёт в App.providerPending: сервер сжигает его при
  // каждой попытке, а при ошибке валидации возвращает НОВЫЙ — повтор после
  // собственной ошибки не должен быть «ссылка устарела».
  static providerPending = null;

  static showProviderRegistration(message) {
    const provider = `${(message && message.provider) || ''}`.trim().toLowerCase();
    const ticket = `${(message && message.ticket) || ''}`.trim();

    if (!ticket || !(provider in Window.authProviders) || !Window.authProviderEnabled(provider)) {
      App.providerPending = null;
      App.error(Lang.text('providerRegistrationExpired'));
      return View.show('authorization');
    }

    App.providerPending = {
      provider: provider,
      ticket: ticket,
      agreementUrl: `${(message && message.agreementUrl) || ''}`.trim(),
      login: '',
      fraction: 0,
      error: '',
    };

    View.show('providerRegistration');
  }

  // POST JSON на хост авторизации (Window.authBase). Запрос идёт нативным
  // http/https: окно лончера лежит на своём origin, CORS для чужого хоста не
  // работает (тот же путь, что у запросов уведомлений).
  static async authJsonRequest(path, body) {
    const url = `${Window.authBase}${path}`;
    const payload = JSON.stringify(body || {});

    if (NativeAPI.status && (NativeAPI.https || NativeAPI.http)) {
      return await App.authNativeJsonRequest(url, payload);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });

      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  static authNativeJsonRequest(url, payload) {
    return new Promise((resolve, reject) => {
      let parsed;

      try {
        parsed = new URL(url);
      } catch {
        reject(new Error('Auth URL error'));
        return;
      }

      // http: — только для локального стенда (dev); боевой authBase — https.
      const lib = parsed.protocol === 'http:' ? NativeAPI.http : NativeAPI.https;

      const request = lib.request(
        {
          method: 'POST',
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
          path: `${parsed.pathname}${parsed.search}`,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 15000,
        },
        (response) => {
          let text = '';

          response.setEncoding('utf8');
          response.on('data', (chunk) => (text += chunk));
          response.on('end', () => {
            let json = null;

            try {
              json = JSON.parse(text || '{}');
            } catch {
              reject(new Error(`Auth HTTP ${response.statusCode}: ${parsed.pathname}`));
              return;
            }

            resolve(json);
          });
        },
      );

      request.on('timeout', () => request.destroy(new Error('Auth request timeout')));
      request.on('error', (error) => reject(new Error(error?.message || 'Auth network error')));
      request.write(payload);
      request.end();
    });
  }

  // Шаг регистрации через провайдера: ник + фракция. POST идёт на
  // путь провайдера (Window.authProviders[...].register). Ответ — JSON
  // {ok,id,token,login,fraction} либо {ok:false,error,ticket}. Успех — тот же
  // путь, что у App.registration (сессия, замок, уведомления).
  static async registrationProvider(fraction, login) {
    let pending = App.providerPending;

    if (!pending || !pending.ticket || !(pending.provider in Window.authProviders)) {
      App.providerPending = null;
      App.error(Lang.text('providerRegistrationExpired'));
      return View.show('authorization');
    }

    let request;

    try {
      request = await App.authJsonRequest(Window.authProviders[pending.provider].register, {
        ticket: pending.ticket,
        login: `${login.value || ''}`.trim(),
        fraction: Number(fraction.value) || 0,
      });
    } catch (error) {
      return App.error(error?.message || error);
    }

    if (!request || request.ok !== true) {
      let error = `${(request && request.error) || Lang.text('providerRegistrationFailed')}`;

      // Билет уже сожжён: без нового повторять нельзя — отказ и на вход.
      if (!request || !request.ticket) {
        App.providerPending = null;
        App.error(error);
        return View.show('authorization');
      }

      pending.ticket = `${request.ticket}`;
      pending.login = `${login.value || ''}`;
      pending.fraction = Number(fraction.value) || 0;
      pending.error = error;

      return View.show('providerRegistration');
    }

    App.providerPending = null;

    await App.storage.set({
      id: request.id,
      token: request.token,
      login: request.login,
      fraction: request.fraction,
      launcherToken: request.launcherToken || '',
      auditToken: request.auditToken || '',
    });

    App.notificationsAuthChanged();

    View.show('castle');
  }

  static async exit() {
    await App.storage.set({ id: 0, token: '', login: '', launcherToken: '', auditToken: '' });

    App.notificationsAuthChanged();
    App.removeNotificationsQuickTab();

    View.show('authorization');
  }

  // Статистика игрока — экран «Статистика» со встроенным аудитом (stats.js).
  static openStatsProfile({ id = 0, login = '' } = {}) {
    View.show('stats', { id, login });
  }

  static input(callback, object = new Object()) {
    if (!('tag' in object)) {
      object.tag = 'input';
    }

    if (!('value' in object)) {
      object.value = '';
    }

    let body = DOM(object);

    body.addEventListener('blur', async () => {
      if (body.value == object.value) {
        return;
      }

      if (callback) {
        try {
          await callback(body.value);
        } catch (e) {
          return;
        }
      }

      object.value = body.value;
    });

    return body;
  }

  static getRandomInt(min, max) {
    min = Math.ceil(min);

    max = Math.floor(max);

    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  static error(message, timeout = 3000) {
    let previousErrors = document.getElementsByClassName('error-message');
    let body;
    if (previousErrors.length == 0) {
      body = DOM({ style: 'error-message' });
      document.body.append(body);
    } else {
      body = previousErrors[0];
    }

    let msg = DOM({ tag: 'div' }, `${message}`);
    Sound.play(SOUNDS_LIBRARY.ERROR, {
      id: 'ui-error',
      volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) * 0.25,
    });
    setTimeout(() => {
      msg.remove();
    }, timeout);

    body.append(msg);
    console.error(message);
    console.trace('Current call stack:');
  }

  static notify(message, delay = 0) {
    setTimeout(() => {
      let body = DOM({ style: 'notify-message' }, DOM({ tag: 'div' }, `${message}`));

      setTimeout(() => {
        body.remove();
      }, 3000);

      document.body.append(body);
    }, delay);
    Sound.play(SOUNDS_LIBRARY.ERROR, {
      id: 'ui-error',
      volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) * 0.25,
    });
  }

  static isAdmin(id = 0) {
    const adminIds = [1, 2, 24, 134, 865, 2220, 292, 1853, 12781];
    const adminLogins = ['kot04ka'];
    // в DEV-превью (?previewBuild=1) входа нет и App.storage не создан
    const targetId = Number(id ? id : App.storage?.data?.id);
    const login = String(App?.storage?.data?.login || '').trim().toLowerCase();

    return adminIds.includes(targetId) || (!id && adminLogins.includes(login));
  }
  
  static isHelper(id = 0){
	return [935, 1033, 6179, 8686].includes(Number(id ? id : App.storage?.data?.id));
  }

  static isEnterKey(e) {
    return e.key === 'Enter' || e.keyCode === 13 || e.code === 'Enter' || e.code === 'NumpadEnter';
  }

  static href(url) {
    let a = DOM({ tag: 'a', href: url });

    a.click();
  }
}

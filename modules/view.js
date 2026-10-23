import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { CastleNAVBAR } from './castleNavBar.js';
import { Window } from './window.js';
import { Rank } from './rank.js';
import { Division } from './division.js';
import { Build } from './build.js';
import { App } from './app.js';
import { Voice } from './voice.js';
import { Chat } from './chat.js';
import { PWGame } from './pwgame.js';
import { NativeAPI } from './nativeApi.js';
import { Castle } from './castle.js';
import { Settings } from './settings.js';
import { MM } from './mm.js';
import { PreloadImages } from './preloadImages.js';
import { Game } from './game.js';
import { Match3Duel } from './match3Duel.js';
import { Splash } from './splash.js';
import { Timer } from './timer.js';
import { HelpSplash } from './helpSpalsh.js';
import { Shop } from './shop.js';
import { syncFairGameFiles } from './fair.js';
import { DomAudio } from './domAudio.js';
import { domAudioPresets } from './domAudioPresets.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';
import { Sound } from './sound.js';
import { ensureActionBarSlotsInNativeCfg, loadKeybinds } from './keybindings/keybindings.io.js';
import { getHeroSearchAliases } from './heroSearchAliases.js';
import { uiIcon } from './uiIcon.js';
import { TalentAdmin } from './talentAdmin.js';
import { ReplayUpload } from './replayUpload.js';
import { HeroFrame } from './heroFrame.js';

const KEYBOARD_LAYOUT_EN_TO_RU = {
  q: 'й',
  w: 'ц',
  e: 'у',
  r: 'к',
  t: 'е',
  y: 'н',
  u: 'г',
  i: 'ш',
  o: 'щ',
  p: 'з',
  '[': 'х',
  ']': 'ъ',
  a: 'ф',
  s: 'ы',
  d: 'в',
  f: 'а',
  g: 'п',
  h: 'р',
  j: 'о',
  k: 'л',
  l: 'д',
  ';': 'ж',
  "'": 'э',
  z: 'я',
  x: 'ч',
  c: 'с',
  v: 'м',
  b: 'и',
  n: 'т',
  m: 'ь',
  ',': 'б',
  '.': 'ю',
  '/': '.',
  '`': 'ё',
};
const KEYBOARD_LAYOUT_RU_TO_EN = Object.fromEntries(Object.entries(KEYBOARD_LAYOUT_EN_TO_RU).map(([enChar, ruChar]) => [ruChar, enChar]));
const KEYBOARD_LAYOUT_GRID_ROWS = [
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
];
const KEYBOARD_LAYOUT_POSITIONS = (() => {
  const positions = new Map();
  for (let rowIndex = 0; rowIndex < KEYBOARD_LAYOUT_GRID_ROWS.length; rowIndex++) {
    const row = KEYBOARD_LAYOUT_GRID_ROWS[rowIndex];
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const enChar = row[colIndex];
      positions.set(enChar, [rowIndex, colIndex]);
      const ruChar = KEYBOARD_LAYOUT_EN_TO_RU[enChar];
      if (ruChar) positions.set(ruChar, [rowIndex, colIndex]);
    }
  }
  return positions;
})();

export class View {
  static mmQueueMap = {};
  static _actionBarCfgEnsured = false;
  static friendsMenuItem = null;
  static flagMenuItem = null;
  static hasFriendIncomingRequest = false;
  static castleActiveTab = 'heroes';
  static castleOpenedBuildHeroId = 0;
  // версия страницы вкладки «Герой» и её каталога (content/heroes-preview.*)
  static HEROES_TAB_VERSION = '20261021-heroes-tab-5';
  static heroesCatalogueIdsPromise = null;
  // открыта вкладка «Герой» окна билда (View.attachBuildHeroesTab)
  static buildHeroesTabActive = false;
  static CASTLE_HERO_LISTS_MAX = 8;
  // здания меню постройки с анимированной иконкой <имя>_anim.webp (показывается при наведении)
  static CASTLE_ANIMATED_ICONS = ['cat', 'dog', 'unicorn'];
  static CASTLE_HERO_LIST_STORAGE_KEY = 'castleHeroSelectedList';
  static CASTLE_HERO_LAST_ACTIVE_LIST_STORAGE_KEY = 'castleHeroLastActiveList';
  static CASTLE_HERO_LIST_NAMES_STORAGE_KEY = 'castleHeroListNames';
  static CASTLE_FRIEND_LISTS_MAX = 1;
  static CASTLE_FRIEND_LIST_STORAGE_KEY = 'castleFriendSelectedList';
  static castleHeroAll = [];
  static castleHeroSelectedList = 0;
  static castleHeroLastActiveList = 0;
  static castleHeroSearch = '';
  static castleHeroPhantomList = 0;
  static castleHeroListEditMode = '';
  static castleHeroEditSelection = new Set();
  static castleHeroListNames = {};
  static castleHeroDeleteConfirmListId = 0;
  static castleHeroPrevSelectedList = 0;
  static castleHeroListsBar = null;
  static castleHeroPinnedEditor = null;
  static castleFriendAll = [];
  static castleOnlinePlayersAll = [];
  static castleFriendSelectedList = 0;
  static castleFriendSearch = '';
  static castleFriendListEditMode = '';
  static castleFriendEditSelection = new Set();
  static castleFriendClearConfirm = false;
  static castleModeHeroAutoOpenHandler = null;
  static castleHeroAutoOpenModes = new Set([1, 2, 5]);
  static castleAramMode = 3;
  static castlePartyHeroRequestInFlight = false;
  static castlePlayRefreshSeq = 0;

  static getQueue(cssKey) {
    const map = {
      pvp: 0,
      anderkrug: 1,
      cte: 2,
      m4: 3,
      'pve-ep2-red': 4,
      'custom-battle': 5,
    };
    const index = map[cssKey];
    return (View.mmQueueMap.mode && View.mmQueueMap.mode[index]) || '-';
  }

  static setFriendIncomingStatus(value) {
    View.hasFriendIncomingRequest = Boolean(value);
    View.updateFriendsMenuIncomingState();
  }
  
  static normalizeFriendPresenceState(item) {
    const state = String(item?.presenceState || '').toLowerCase();
    if (state === 'online' || state === 'queue' || state === 'tambour' || state === 'battle' || state === 'away' || state === 'offline') {
      return state;
    }
    return Number(item?.online) === 1 ? 'online' : 'offline';
  }
  
  static getFriendPresenceLabel(state) {
    switch (String(state || 'offline')) {
      case 'battle':
        return Lang.text('friendStatusBattle');
      case 'tambour':
        return Lang.text('friendStatusTambour');
      case 'queue':
        return Lang.text('friendStatusQueue');
      case 'away':
        return Lang.text('friendStatusAway');
      case 'online':
        return Lang.text('friendStatusOnline');
      default:
        return Lang.text('friendStatusOffline');
    }
  }
  
  static FRIEND_LAST_SEEN_TICK_MS = 30 * 1000;
  static friendLastSeenTimer = 0;

  static getFriendLastOnline(item) {
    const value = Number(item?.lastOnline || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  // Короткая подпись «сколько не в сети»: только что / 15 мин / 3 ч / 2 дн / 12 мая.
  static formatFriendLastSeen(lastOnline, now = Date.now()) {
    const diff = Math.max(0, now - lastOnline);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return Lang.text('friendLastSeenJustNow');
    if (diff < hour) return Lang.text('friendLastSeenMinutes').replace('{n}', String(Math.floor(diff / minute)));
    if (diff < day) return Lang.text('friendLastSeenHours').replace('{n}', String(Math.floor(diff / hour)));
    if (diff < 30 * day) return Lang.text('friendLastSeenDays').replace('{n}', String(Math.floor(diff / day)));
    const date = new Date(lastOnline);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return date.toLocaleDateString(View.getFriendLastSeenLocale(), sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  static getFriendLastSeenLocale() {
    return Lang.target === 'en' ? 'en-GB' : 'ru-RU';
  }

  static formatFriendLastSeenTitle(lastOnline) {
    const full = new Date(lastOnline).toLocaleString(View.getFriendLastSeenLocale(), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return Lang.text('friendLastSeenTitle').replace('{date}', full);
  }

  static FRIEND_SINCE_STATES = ['queue', 'tambour', 'battle', 'away'];

  static getFriendPresenceSince(item) {
    const value = Number(item?.since || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  // Длительность состояния: «<1 мин» / «12 мин» / «1 ч 5 мин» / «2 дн».
  static formatFriendDuration(since, now = Date.now()) {
    const minutes = Math.floor(Math.max(0, now - since) / 60000);
    if (minutes < 1) return Lang.text('friendDurationLessMinute');
    if (minutes < 60) return Lang.text('friendDurationMinutes').replace('{n}', String(minutes));
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      const rest = minutes % 60;
      return rest
        ? Lang.text('friendDurationHoursMinutes').replace('{h}', String(hours)).replace('{m}', String(rest))
        : Lang.text('friendDurationHours').replace('{n}', String(hours));
    }
    return Lang.text('friendDurationDays').replace('{n}', String(Math.floor(hours / 24)));
  }

  static formatFriendSinceTitle(state, since) {
    const time = new Date(since).toLocaleTimeString(View.getFriendLastSeenLocale(), { hour: '2-digit', minute: '2-digit' });
    const key = state === 'away' ? 'friendSinceTitleAway' : 'friendSinceTitle';
    return Lang.text(key).replace('{status}', View.getFriendPresenceLabel(state)).replace('{time}', time);
  }

  static getFriendBadgeText(badge, now = Date.now()) {
    const value = Number(badge.dataset.lastOnline || badge.dataset.since || 0);
    return badge.dataset.since ? View.formatFriendDuration(value, now) : View.formatFriendLastSeen(value, now);
  }

  // Плашка над кнопками: оффлайн — «[часы] 3 ч назад» (из lastOnline),
  // в поиске / тамбуре / бою / отошёл — «[секундомер] 12 мин» (since из памяти API, без БД).
  static syncFriendLastSeenBadge(card, item) {
    if (!card) return;
    const state = View.normalizeFriendPresenceState(item);
    const isFriend = Number(item?.status || 0) === 1;
    const lastOnline = View.getFriendLastOnline(item);
    const since = View.getFriendPresenceSince(item);
    const showLastSeen = isFriend && state === 'offline' && lastOnline > 0;
    const showSince = isFriend && !showLastSeen && since > 0 && View.FRIEND_SINCE_STATES.includes(state);
    let badge = card.querySelector('.castle-friend-last-seen');
    if (!showLastSeen && !showSince) {
      badge?.remove();
      if (card.dataset.lastSeenTitle === '1') {
        card.removeAttribute('title');
        delete card.dataset.lastSeenTitle;
      }
      return;
    }
    if (!badge) {
      badge = DOM({ style: 'castle-friend-last-seen' });
      card.append(badge);
    }
    delete badge.dataset.lastOnline;
    delete badge.dataset.since;
    badge.classList.toggle('castle-friend-since', showSince);
    if (showSince) {
      badge.dataset.since = String(since);
      card.title = View.formatFriendSinceTitle(state, since);
    } else {
      badge.dataset.lastOnline = String(lastOnline);
      card.title = View.formatFriendLastSeenTitle(lastOnline);
    }
    badge.textContent = View.getFriendBadgeText(badge);
    card.dataset.lastSeenTitle = '1';
    View.ensureFriendLastSeenTicker();
  }

  static ensureFriendLastSeenTicker() {
    if (View.friendLastSeenTimer) return;
    View.friendLastSeenTimer = setInterval(() => {
      const badges = View.castleBottom?.querySelectorAll?.(
        '.castle-friend-last-seen[data-last-online], .castle-friend-last-seen[data-since]',
      );
      if (!badges || !badges.length) {
        clearInterval(View.friendLastSeenTimer);
        View.friendLastSeenTimer = 0;
        return;
      }
      const now = Date.now();
      for (const badge of badges) {
        const text = View.getFriendBadgeText(badge, now);
        if (badge.textContent !== text) badge.textContent = text;
      }
    }, View.FRIEND_LAST_SEEN_TICK_MS);
  }

  static isFriendGroupInviteEnabled(item) {
    return View.normalizeFriendPresenceState(item) === 'online';
  }
  
  static isFriendCallEnabled(item) {
    const state = View.normalizeFriendPresenceState(item);
    // «Отошёл» — лаунчер друга открыт, просто давно без действий: звонок до него доходит
    return state === 'online' || state === 'queue' || state === 'away';
  }
  
  static getFriendPresenceFilter(state) {
    switch (String(state || 'offline')) {
      case 'battle':
        return 'sepia(1) hue-rotate(-40deg) saturate(1.45) brightness(0.95)';
      case 'tambour':
        return 'sepia(1) hue-rotate(-715deg) saturate(3.35) brightness(1.02)';
      case 'queue':
        return 'brightness(1.28)';
      case 'away':
        return 'sepia(1) hue-rotate(352deg) saturate(1.1) brightness(0.92)';
      case 'offline':
        return '';
      default:
        return '';
    }
  }
  
  static getFriendStatusSortWeight(item) {
    const relationStatus = Number(item?.status || 0);
    if (relationStatus === 2) {
      return 0; // incoming requests
    }
    if (relationStatus === 3) {
      return 8; // outgoing requests
    }
    if (relationStatus !== 1) {
      return 9;
    }
    const presenceState = View.normalizeFriendPresenceState(item);
    if (presenceState === 'online') {
      return Number(item?.inParty) === 1 ? 2 : 1;
    }
    switch (presenceState) {
      case 'queue':
        return 3;
      case 'tambour':
        return 4;
      case 'battle':
        return 5;
      case 'away':
        return 6;
      default:
        return 7; // offline/unknown
    }
  }
  
  static getSortedCastleFriends() {
    const source = Array.isArray(View.castleFriendAll) ? View.castleFriendAll : [];
    return source
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const weightDiff = View.getFriendStatusSortWeight(a.item) - View.getFriendStatusSortWeight(b.item);
        if (weightDiff !== 0) {
          return weightDiff;
        }
        return a.index - b.index;
      })
      .map((entry) => entry.item);
  }

  static getSortedOnlinePlayers(relationById = null) {
    const source = Array.isArray(View.castleOnlinePlayersAll) ? View.castleOnlinePlayersAll : [];
    const relationMap = relationById instanceof Map ? relationById : null;
    return source
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const aRelation = relationMap?.get(Number(a.item?.id || 0));
        const bRelation = relationMap?.get(Number(b.item?.id || 0));
        const aSortItem = aRelation
          ? {
              ...a.item,
              status: Number(aRelation?.status || 0),
              favourite: Number(aRelation?.favourite || 0),
            }
          : a.item;
        const bSortItem = bRelation
          ? {
              ...b.item,
              status: Number(bRelation?.status || 0),
              favourite: Number(bRelation?.favourite || 0),
            }
          : b.item;
        const weightDiff = View.getFriendStatusSortWeight(aSortItem) - View.getFriendStatusSortWeight(bSortItem);
        if (weightDiff !== 0) {
          return weightDiff;
        }
        return a.index - b.index;
      })
      .map((entry) => entry.item);
  }

  static getCastleFriendListsMax() {
    return App.isAdmin() ? 2 : View.CASTLE_FRIEND_LISTS_MAX;
  }
  
  static applyFriendPresenceUpdate(data) {
    const friendId = Number(data?.id || 0);
    if (!friendId) return;
    let changed = false;
    let changedItem = null;
    for (const item of View.castleFriendAll || []) {
      if (Number(item?.id) !== friendId) continue;
      const wasOffline = View.normalizeFriendPresenceState(item) === 'offline';
      item.presenceState = String(data?.state || item?.presenceState || '');
      if (Number(data?.lastOnline) > 0) {
        item.lastOnline = Number(data.lastOnline);
      } else if (!wasOffline && View.normalizeFriendPresenceState(item) === 'offline') {
        // Старый бэкенд без lastOnline: друг вышел только что.
        item.lastOnline = Date.now();
      }
      if ('online' in (data || {})) item.online = Number(data.online) === 1 ? 1 : 0;
      if ('mobile' in (data || {})) item.mobile = Number(data.mobile) === 1 ? 1 : 0;
      if ('inParty' in (data || {})) item.inParty = Number(data.inParty) === 1 ? 1 : 0;
      if ('mode' in (data || {})) item.mode = Number(data.mode);
      item.since = Number(data?.since || 0);
      changed = true;
      changedItem = item;
      break;
    }
    if (changed && changedItem && View.castleActiveTab === 'friends') {
      View.patchVisibleFriendCard(changedItem);
      View.reorderVisibleFriendCards();
    }
  }
  
  static createFriendGroupAction(item) {
    return async () => {
      await App.api.request(App.CURRENT_MM, 'inviteParty', { id: item.id, mode: CastleNAVBAR.mode });
      App.notify(Lang.text('friendAcceptText').replace('{nickname}', item.nickname));
    };
  }
  
  static createFriendCallAction(item) {
    return async () => {
      try {
        let voice = new Voice(item.id, 'friend', item.nickname, true);
        await voice.call();
      } catch (error) {
        App.error(error);
      }
    };
  }
  
  static patchVisibleFriendCard(item) {
    if (!View.castleBottom) return;
    const card = View.castleBottom.querySelector(`.castle-friend-item[data-friend-id="${Number(item?.id || 0)}"]`);
    if (!card) return;
    const status = Number(item?.status || 0);
    if (status !== 1) return;
    const bottom = card.querySelector('.castle-friend-item-bottom');
    if (!bottom) return;
    const buttons = bottom.querySelectorAll('.castle-friend-add-group');
    if (buttons.length < 2) return;
    const call = buttons[0];
    const group = buttons[1];
    const presenceState = View.normalizeFriendPresenceState(item);
    const friendInParty = presenceState === 'online' && Number(item?.inParty) === 1;
    const groupEnabled = View.isFriendGroupInviteEnabled(item);
    const callEnabled = View.isFriendCallEnabled(item);
    const isOffline = presenceState === 'offline';
    const isTambour = presenceState === 'tambour';
    const groupText = friendInParty
      ? Lang.text('friendInGroup')
      : groupEnabled
        ? Lang.text('inviteToAGroup')
        : View.getFriendPresenceLabel(presenceState);
    const modeId = Number(item?.mode);
    const canShowModeOnHover =
      !groupEnabled &&
      !friendInParty &&
      Number.isFinite(modeId) &&
      modeId >= 0 &&
      (presenceState === 'battle' || presenceState === 'queue' || presenceState === 'tambour');
    const modeText = canShowModeOnHover ? Lang.text(`gm${modeId + 1}`) : '';
    group.textContent = groupText;
    group.classList.toggle('castle-friend-add-group-offline', isOffline);
    call.classList.toggle('castle-friend-add-group-offline', isOffline);
    group.classList.toggle('castle-friend-add-group-tambour', isTambour);
    const presenceFilter = View.getFriendPresenceFilter(presenceState);
    group.style.filter = (!groupEnabled || friendInParty) ? (isOffline || isTambour ? '' : (presenceFilter || 'grayscale(0.8)')) : '';
    call.style.filter = !callEnabled ? (isOffline ? '' : 'grayscale(0.8)') : '';
    group.onmouseenter = null;
    group.onmouseleave = null;
    group.onclick = null;
    call.onclick = null;
    if (groupEnabled && !friendInParty) {
      group.onclick = View.createFriendGroupAction(item);
    }
    if (callEnabled) {
      call.onclick = View.createFriendCallAction(item);
    }
    if (canShowModeOnHover) {
      group.onmouseenter = () => {
        group.textContent = modeText;
      };
      group.onmouseleave = () => {
        group.textContent = groupText;
      };
    }
    const mobileEmoji = card.querySelector('.castle-friend-mobile-emoji');
    const showMobile = status === 1 && View.normalizeFriendPresenceState(item) !== 'offline' && Number(item?.mobile) === 1;
    if (showMobile && !mobileEmoji) {
      card.append(DOM({ style: 'castle-friend-mobile-emoji' }, uiIcon('phone')));
    } else if (!showMobile && mobileEmoji) {
      mobileEmoji.remove();
    }
    View.syncFriendLastSeenBadge(card, item);
  }
  
  static reorderVisibleFriendCards() {
    if (!View.castleBottom) return;
    const cards = Array.from(View.castleBottom.querySelectorAll('.castle-friend-item[data-friend-id]'));
    if (cards.length < 2) return;
    const orderIndex = new Map();
    const all = Array.isArray(View.castleFriendAll) ? View.castleFriendAll : [];
    for (let i = 0; i < all.length; i++) {
      orderIndex.set(Number(all[i]?.id || 0), i);
    }
    cards.sort((a, b) => {
      const aId = Number(a.dataset.friendId || 0);
      const bId = Number(b.dataset.friendId || 0);
      const aItem = all.find((x) => Number(x?.id || 0) === aId);
      const bItem = all.find((x) => Number(x?.id || 0) === bId);
      const weightDiff = View.getFriendStatusSortWeight(aItem) - View.getFriendStatusSortWeight(bItem);
      if (weightDiff !== 0) {
        return weightDiff;
      }
      return (orderIndex.get(aId) ?? 0) - (orderIndex.get(bId) ?? 0);
    });
    for (const card of cards) {
      View.castleBottom.append(card);
    }
  }

  static updateFriendsMenuIncomingState() {
    if (!View.friendsMenuItem) {
      return;
    }

    View.friendsMenuItem.classList.toggle('friends-menu-item-incoming', View.hasFriendIncomingRequest);
  }

  static updateFriendsMenuOnlineCount() {
    if (!View.friendsMenuItem) {
      return;
    }

    const onlineCount = (View.castleFriendAll || []).filter(
      (item) => Number(item?.status) === 1 && View.normalizeFriendPresenceState(item) !== 'offline',
    ).length;
    View.friendsMenuOnlineCount?.remove();
    View.friendsMenuOnlineCount = null;
    if (onlineCount > 0) {
      View.friendsMenuOnlineCount = DOM({ style: 'friends-menu-online-count' }, String(onlineCount));
      View.friendsMenuItem.append(View.friendsMenuOnlineCount);
    }
  }

  static updateCastlePanelMenuActiveState(tab = View.castleActiveTab) {
    for (const [item, itemTab] of [
      [View.heroesMenuItem, 'heroes'],
      [View.friendsMenuItem, 'friends'],
      [View.buildingsMenuItem, 'buildings'],
    ]) {
      item?.classList?.toggle('castle-panel-menu-item-active', tab === itemTab);
    }
  }

  static isCastleModeRequireHeroSelection(mode) {
    return View.castleHeroAutoOpenModes.has(Number(mode));
  }

  // Кэш build/heroAll для пати: раньше список запрашивался на каждый PUpdate
  // и каждое открытие выбора героя. Параллельные вызовы делят один запрос.
  static PARTY_HEROES_TTL_MS = 30 * 1000;
  static partyHeroesCache = { at: 0, list: null, pending: null };

  static async getPartyHeroes({ force = false } = {}) {
    const cache = View.partyHeroesCache;
    if (!force && Array.isArray(cache.list) && Date.now() - cache.at < View.PARTY_HEROES_TTL_MS) {
      return cache.list;
    }
    if (cache.pending) return cache.pending;
    cache.pending = (async () => {
      try {
        const list = await App.api.request('build', 'heroAll');
        if (Array.isArray(list)) {
          cache.list = list;
          cache.at = Date.now();
          MM.hero = list;
        }
        return list;
      } finally {
        cache.pending = null;
      }
    })();
    return cache.pending;
  }

  static async setCastlePartyHero(playerCard, heroId, fallbackRating = 1100) {
    if (!playerCard || Number(playerCard?.dataset?.id) !== Number(App.storage?.data?.id)) {
      return false;
    }

    if (View.castlePartyHeroRequestInFlight) {
      return false;
    }

    View.castlePartyHeroRequestInFlight = true;
    try {
      await App.api.request(App.CURRENT_MM, 'heroParty', {
        id: MM.partyId,
        hero: heroId,
      });
    } catch (error) {
      App.error(error);
      return false;
    } finally {
      View.castlePartyHeroRequestInFlight = false;
    }

    const numericHeroId = Number(heroId) || 0;
    let heroSkin = 1;
    let heroRating = fallbackRating || 1100;
    let heroFrameData = null;

    if (numericHeroId > 0) {
      let heroes = MM.hero;
      if (!Array.isArray(heroes) || !heroes.length) {
        try {
          heroes = await View.getPartyHeroes();
        } catch (error) {
          // Герой уже выбран на сервере — без списка просто нет скина/рейтинга
          console.warn('heroAll failed', error);
          heroes = [];
        }
      }

      const selectedHero = Array.isArray(heroes) ? heroes.find((item) => Number(item?.id) === numericHeroId) : null;
      if (selectedHero) {
        heroSkin = Number(selectedHero.skin) > 0 ? Number(selectedHero.skin) : 1;
        heroRating = Number(selectedHero.rating) || heroRating;
        heroFrameData = selectedHero;
      }
    }

    HeroFrame.apply(playerCard.querySelector('.hero-win-frame'), heroFrameData);

    const newHeroImg = numericHeroId ? `url(content/hero/${numericHeroId}/${heroSkin}.webp)` : `url(content/hero/empty.webp)`;
    playerCard.style.backgroundImage = `${newHeroImg}, url(content/hero/background.png)`;
    playerCard.style.backgroundRepeat = 'no-repeat, no-repeat';
    playerCard.style.backgroundPosition = 'center, center';
    playerCard.style.backgroundSize = 'contain, contain';

    // Без героя (id 0) рейтинг не показываем — как при первой отрисовке пати,
    // иначе на карточке оставалась цифра предыдущего героя.
    const rankContainer = playerCard.querySelector('.rank');
    if (rankContainer) {
      if (numericHeroId > 0) {
        Rank.updateRankContainer(rankContainer, parseInt(heroRating, 10));
        rankContainer.style.display = 'flex';
      } else {
        rankContainer.style.display = 'none';
      }
    }

    MM.activeSelectHero = numericHeroId;
    return true;
  }

  static async openCastlePartyHeroPicker(playerCard, fallbackRating = 1100, options = {}) {
    const { notifyOnActiveSearch = true } = options;
    if (!playerCard || Number(playerCard?.dataset?.id) !== Number(App.storage?.data?.id)) {
      return;
    }
    if (MM.active) {
      if (notifyOnActiveSearch) {
        App.notify(Lang.text('youSearchFight'));
      }
      return;
    }

    let request;
    try {
      request = await View.getPartyHeroes();
    } catch (error) {
      App.error(error);
      return;
    }
    if (!Array.isArray(request)) {
      App.error(Lang.text('partyHeroListError'));
      return;
    }
    MM.hero = request;

    let bannedHeroesResponse = new Array();
    try {
      bannedHeroesResponse = await App.api.request(App.CURRENT_MM, 'bannedHeroes', { mode: CastleNAVBAR.mode });
    } catch (error) {
      bannedHeroesResponse = new Array();
    }

    const bannedHeroes = new Set(
      (Array.isArray(bannedHeroesResponse) ? bannedHeroesResponse : new Array())
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0),
    );

    const heroList = [...request, { id: 0 }];
    let bodyHero = DOM({ style: 'party-hero' });
    let preload = new PreloadImages(bodyHero);

    for (let heroData of heroList) {
      let hero = DOM({ domaudio: domAudioPresets.smallButton });
      const isBannedInMode = heroData.id && bannedHeroes.has(Number(heroData.id));
      if (isBannedInMode) {
        hero.style.filter = 'grayscale(100%)';
        hero.style.opacity = '0.6';
        hero.title = Lang.text('thisHeroIsUnavailableInCurrentGameMode');
      }

      hero.addEventListener('click', async () => {
        if (isBannedInMode) {
          App.error(Lang.text('thisHeroIsUnavailableInCurrentGameMode'));
          return;
        }

        const selected = await View.setCastlePartyHero(playerCard, heroData.id, heroData.rating || fallbackRating || 1100);
        if (selected) {
          Splash.hide();
        }
      });

      hero.dataset.url = heroData.id ? `content/hero/${heroData.id}/${heroData.skin ? heroData.skin : 1}.webp` : `content/hero/empty.webp`;
      preload.add(hero);
    }

    Splash.show(bodyHero, false);
  }

  static bindCastleModeHeroAutoOpen() {
    if (View.castleModeHeroAutoOpenHandler) {
      window.removeEventListener('CastleModeChanged', View.castleModeHeroAutoOpenHandler);
    }

    View.castleModeHeroAutoOpenHandler = async (event) => {
      const mode = Number(event?.detail?.mode);
      const myCard = document.querySelector(`.castle-play-lobby-player[data-id="${App.storage.data.id}"]`);
      if (!myCard) {
        return;
      }

      if (mode === View.castleAramMode) {
        if (Number(MM.activeSelectHero) !== 0) {
          const selected = await View.setCastlePartyHero(myCard, 0, 1100);
          if (selected && Splash.body && Splash.body.style.display == 'flex' && Splash.body.querySelector('.party-hero')) {
            Splash.hide();
          }
        }
        return;
      }

      if (!View.isCastleModeRequireHeroSelection(mode) || Number(MM.activeSelectHero) > 0) {
        return;
      }
      if (Splash.body && Splash.body.style.display == 'flex' && Splash.body.querySelector('.party-hero')) {
        return;
      }

      await View.openCastlePartyHeroPicker(myCard, 1100, { notifyOnActiveSearch: false });
    };

    window.addEventListener('CastleModeChanged', View.castleModeHeroAutoOpenHandler);
  }

  static remapQueryByKeyboardLayout(value, layoutMap) {
    return String(value || '')
      .split('')
      .map((char) => layoutMap[char] || char)
      .join('');
  }

  static getLayoutAwareSearchVariants(value) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (!normalized) return [];
    const variants = new Set([normalized]);
    variants.add(View.remapQueryByKeyboardLayout(normalized, KEYBOARD_LAYOUT_EN_TO_RU));
    variants.add(View.remapQueryByKeyboardLayout(normalized, KEYBOARD_LAYOUT_RU_TO_EN));
    return [...variants].filter(Boolean);
  }

  static splitSearchWords(value) {
    return String(value || '')
      .toLowerCase()
      .split(/[^a-zа-яё0-9]+/i)
      .filter(Boolean);
  }

  static hasSingleAdjacentTransposition(left, right) {
    if (left.length !== right.length || left === right) return false;
    let firstDiff = -1;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) {
        firstDiff = i;
        break;
      }
    }
    if (firstDiff < 0 || firstDiff >= left.length - 1) return false;
    if (!(left[firstDiff] === right[firstDiff + 1] && left[firstDiff + 1] === right[firstDiff])) return false;
    for (let i = firstDiff + 2; i < left.length; i++) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }

  static hasEditDistanceAtMostOne(left, right) {
    if (left === right) return true;
    const lenDiff = Math.abs(left.length - right.length);
    if (lenDiff > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        i++;
        j++;
        continue;
      }
      edits++;
      if (edits > 1) return false;
      if (left.length > right.length) {
        i++;
      } else if (left.length < right.length) {
        j++;
      } else {
        if (!View.isKeyboardNeighbor(left[i], right[j])) return false;
        i++;
        j++;
      }
    }
    if (i < left.length || j < right.length) edits++;
    return edits <= 1;
  }

  static toKeyboardLayoutKey(char) {
    const normalizedChar = String(char || '').toLowerCase();
    return KEYBOARD_LAYOUT_RU_TO_EN[normalizedChar] || normalizedChar;
  }

  static toKeyboardLayoutString(value) {
    return String(value || '')
      .split('')
      .map((char) => View.toKeyboardLayoutKey(char))
      .join('');
  }

  static isKeyboardNeighbor(leftChar, rightChar) {
    if (leftChar === rightChar) return true;
    const leftPosition = KEYBOARD_LAYOUT_POSITIONS.get(View.toKeyboardLayoutKey(leftChar));
    const rightPosition = KEYBOARD_LAYOUT_POSITIONS.get(View.toKeyboardLayoutKey(rightChar));
    if (!leftPosition || !rightPosition) return true;
    return Math.abs(leftPosition[0] - rightPosition[0]) <= 1 && Math.abs(leftPosition[1] - rightPosition[1]) <= 1;
  }

  static isFuzzySearchVariantMatch(filterHaystack, filterWords, variant) {
    if (!variant) return false;
    if (filterHaystack.includes(variant)) return true;
    const variantKey = View.toKeyboardLayoutString(variant);
    if (variantKey && filterWords.some((word) => View.toKeyboardLayoutString(word).includes(variantKey))) return true;
    if (variant.length < 3) return false;
    for (const word of filterWords) {
      if (word.includes(variant)) return true;
      const prefix = word.slice(0, variant.length);
      if (prefix && prefix !== word) {
        if (View.hasSingleAdjacentTransposition(prefix, variant)) return true;
        if (View.hasEditDistanceAtMostOne(prefix, variant)) return true;
      }
      if (Math.abs(word.length - variant.length) > 1) continue;
      if (View.hasSingleAdjacentTransposition(word, variant)) return true;
      if (View.hasEditDistanceAtMostOne(word, variant)) return true;

      const wordKey = View.toKeyboardLayoutString(word);
      const keyPrefix = wordKey.slice(0, variantKey.length);
      if (keyPrefix && keyPrefix !== wordKey) {
        if (View.hasSingleAdjacentTransposition(keyPrefix, variantKey)) return true;
        if (View.hasEditDistanceAtMostOne(keyPrefix, variantKey)) return true;
      }
      if (Math.abs(wordKey.length - variantKey.length) <= 1) {
        if (View.hasSingleAdjacentTransposition(wordKey, variantKey)) return true;
        if (View.hasEditDistanceAtMostOne(wordKey, variantKey)) return true;
      }
    }
    return false;
  }

  static setCastleOpenedBuildHero(heroId = 0) {
    const id = Number(heroId);
    View.castleOpenedBuildHeroId = Number.isFinite(id) && id > 0 ? id : 0;
    View.syncCastleOpenedBuildHeroGlow();
  }

  static syncCastleOpenedBuildHeroGlow() {
    try {
      const container = View.castleBottom;
      if (!container) return;
      const isBuildOpen = Window.windows?.main?.id === 'wbuild';
      const targetId = Number(View.castleOpenedBuildHeroId);
      container.querySelectorAll('.castle-hero-item').forEach((el) => {
        const heroId = Number(el.dataset.heroId);
        const isActive = isBuildOpen && Number.isFinite(targetId) && targetId > 0 && heroId === targetId;
        el.classList.toggle('castle-hero-item-build-open', isActive);
      });
    } catch {}
  }
  static activeTemplate = false;

  static activeAnimation = false;

  static animationIsEnabled = false;

  static defaultAnimation = {
    transform: ['scale(1.1)', 'scale(1)'],
    opacity: [0, 1],
    backdropFilter: ['blur(0)', 'blur(1cqh)'],
  };

  static defaultOptionAnimation = {
    duration: 150,
    fill: 'both',
    easing: 'ease-out',
  };

  static updateProgress = false;

  static castleQuestBody = DOM({ style: ['quest', 'left-offset-no-shift'] });

  static castleTotalCrystal = DOM({ tag: 'div', style: ['question-icon'] }, DOM({ style: 'quest-counter' }, ''));

  static setCss(name = 'content/style.css') {
    const cssVersion = '20261023-build-buttons-1';
    const separator = name.includes('?') ? '&' : '?';
    let css = DOM({ tag: 'link', rel: 'stylesheet', href: `${name}${separator}v=${cssVersion}` });

    document.head.appendChild(css);
  }

  // Окно, открытое пока строился новый вью (входящий звонок, приглашение), попадает в старый
  // View.active и уходит вместе с ним: мелодия звонка играет, а окна нет. Переносим в новый вью.
  static adoptOrphanWindows() {
    for (const element of Object.values(Window.windows || {})) {
      if (element && !element.isConnected) {
        View.active.append(element);
      }
    }
  }

  static async show(method, value, value2, value3) {
    if (!(method in View)) {
      return;
    }

    Window.close('main');

    Castle.toggleRender(Castle.RENDER_LAYER_LAUNCHER, method == 'castle');

    // ушли из замка — из Строительства тоже: ожидающее здание исчезает
    if (method != 'castle') {
      Castle.buildMode = false;
    }

    try {
      var template = await View[method](value, value2, value3);
    } catch (error) {
      App.error(error);

      return;
    }

    // Устаревший/отменённый рендер (null) — не трогаем текущий экран:
    // при быстром переключении вкладки проигравшая гонка не должна
    // убирать уже показанный вью (иначе пустой экран).
    if (!template) {
      return;
    }

    // Ensure action bar slots exist in native input_new.cfg once per app session.
    if (method === 'castle' && !View._actionBarCfgEnsured) {
      try {
        const { changed } = await ensureActionBarSlotsInNativeCfg();
        if (changed) await loadKeybinds();
      } catch {}
      View._actionBarCfgEnsured = true;
    }

    if (View.active) {
      if (View.animationIsEnabled) {
        View.activeAnimation.reverse();

        View.activeAnimation.addEventListener('finish', () => {
          View.active.remove();

          View.active = template;

          View.activeAnimation = template.animate(View.defaultAnimation, View.defaultOptionAnimation);

          document.body.append(template);

          View.adoptOrphanWindows();
        });
      } else {
        View.active.remove();

        View.active = template;

        document.body.append(template);

        View.adoptOrphanWindows();
      }
    } else {
      if (View.animationIsEnabled) {
        View.active = template;

        View.activeAnimation = template.animate(View.defaultAnimation, View.defaultOptionAnimation);

        document.body.append(template);

        View.adoptOrphanWindows();
      } else {
        View.active = template;

        document.body.append(template);

        View.adoptOrphanWindows();
      }
    }
  }

  static authorization() {
    let numEnterEvent = [
      'keyup',
      async (event) => {
        if (!App.isEnterKey(event)) return;
        App.authorization(login, password);
      },
    ];

    let login = DOM({
        tag: 'input',
        domaudio: domAudioPresets.defaultInput,
        placeholder: Lang.text('nickname'),
        event: numEnterEvent,
      }),
      password = DOM({
        tag: 'input',
        domaudio: domAudioPresets.defaultInput,
        placeholder: Lang.text('password'),
        type: 'password',
        event: numEnterEvent,
      });
    // Создаем выпадающий список языков
    const languageSelect = DOM({
      tag: 'select',
      domaudio: domAudioPresets.defaultSelect,
      id: 'lang_select',
      style: 'language-select',
      event: [
        'change',
        async (e) => {
          const newLanguage = e.target.value;
          Lang.target = newLanguage;
          Settings.settings.language = newLanguage;
          App.error(`${Lang.text('LangTarg')}: ${Lang.list[newLanguage].name}`);
          // Перезагружаем страницу для применения языка
          await Lang.reinitViews();
        },
      ],
    });

    // Заполняем выпадающий список языками
    Object.entries(Lang.list).forEach(([code, langData]) => {
      languageSelect.appendChild(
        DOM({
          tag: 'option',
          value: code,
          selected: code === Lang.target,
          text: langData.name,
        }),
      );
    });

    let authorizationForm = DOM(
      { style: 'login_box' },
      DOM(
        { style: ['login-box-forma', 'login-box-forma--authorization'] },
        DOM(
          { tag: 'div', style: 'login-box-forma-logo-panel' },
          DOM({
            tag: 'img',
            style: ['login-box-forma-logo', 'login-box-forma-brand'],
            src: 'content/img/logo_classic.webp',
          }),
        ),

        DOM({ style: 'language-select-container' }, languageSelect),
        DOM(
          { style: 'login-box-forma-inputs' },
          DOM({ style: ['login-box-forma-title', 'auth-window-title'] }, Lang.text('authorizationTitle')),
          login,
          password,
          DOM(
            { style: 'login-box-forma-buttons' },
            DOM(
              {
                domaudio: domAudioPresets.defaultButton,
                style: 'login-box-forma-button',
                event: ['click', () => App.authorization(login, password)],
              },
              Lang.text('login'),
            ),
            DOM(
              {
                domaudio: domAudioPresets.defaultButton,
                style: 'login-box-forma-button',
                event: ['click', () => View.show('registration')],
              },
              Lang.text('registration'),
            ),
          ),
          DOM(
            { style: 'login-box-forma-buttons' },
            DOM(
              {
                domaudio: domAudioPresets.bigButton,
                style: ['login-box-forma-button', 'login-box-forma-button--steam', 'steamauth'],
                event: ['click', () => Window.show('main', 'steamauth')],
              },
              Lang.text('authorizationSteam'),
            ),
            ...(Window.authProviderEnabled('yandex')
              ? [
                  DOM(
                    {
                      domaudio: domAudioPresets.bigButton,
                      style: ['login-box-forma-button', 'login-box-forma-button--yandex', 'yandexauth'],
                      event: ['click', () => Window.show('main', 'yandexauth')],
                    },
                    Lang.text('authorizationYandex'),
                  ),
                ]
              : []),
          ),
        ),
      ),
      DOM({ style: 'author' }, `Prime World: Classic v.${App.PW_VERSION}.${App.APP_VERSION}`),
    );

    return authorizationForm;
  }

  static async registration() {
    // Адрес соглашения об обработке ПДн и признак «сервер умеет регистрацию
    // через провайдеров» — один WS-запрос (кэш на сессию). Без него экран
    // работает как раньше: ссылка показывается текстом, кнопок провайдеров нет.
    await App.fetchAuthCapabilities();

    let numEnterEvent = [
      'keyup',
      async (event) => {
        if (!App.isEnterKey(event)) return;
        App.registration(fraction, invite, login, password, password2);
      },
    ];

    let fraction = DOM(
      {
        tag: 'button',
        type: 'button',
        value: '',
        domaudio: domAudioPresets.defaultSelect,
        style: 'registration-fraction-trigger',
        event: ['click', () => Window.show('main', 'registrationFraction', fraction)],
      },
      Lang.text('fraction'),
    );

    let tgBotUrl = 'https://t.me/primeworldclassic_bot';

    let telegramBotLink = DOM({
      domaudio: domAudioPresets.defaultButton,
      style: 'telegram-bot',
      tag: 'a',
      target: '_blank',
      href: tgBotUrl,
      title: Lang.text('telegramInvite'),
      'aria-label': Lang.text('telegramInvite'),
      event: ['click', (e) => NativeAPI.linkHandler(e)],
    });

    let invite = DOM({
      tag: 'input',
      domaudio: domAudioPresets.defaultInput,
      placeholder: Lang.text('code'),
      event: numEnterEvent,
    });

    let inviteContainer = DOM({ style: 'invite-input' }, invite, telegramBotLink);

    let login = DOM({
      tag: 'input',
      domaudio: domAudioPresets.defaultInput,
      placeholder: Lang.text('nickname'),
      event: numEnterEvent,
    });

    let password = DOM({
      tag: 'input',
      domaudio: domAudioPresets.defaultInput,
      placeholder: Lang.text('password'),
      type: 'password',
      event: numEnterEvent,
    });

    let password2 = DOM({
      tag: 'input',
      domaudio: domAudioPresets.defaultInput,
      placeholder: Lang.text('passwordAgain'),
      type: 'password',
      event: numEnterEvent,
    });

    let submit = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'login-box-forma-button',
        event: ['click', () => App.registration(fraction, invite, login, password, password2)],
      },
      Lang.text('registration1'),
    );

    let providers = [];
    let providerButtons = [];

    for (let provider of Window.authEnabledProviders()) {
      let button =
        provider === 'steam'
          ? DOM(
              {
                domaudio: domAudioPresets.bigButton,
                style: ['login-box-forma-button', 'login-box-forma-button--steam', 'steamauth'],
                event: ['click', () => Window.show('main', 'steamauth', 'register')],
              },
              Lang.text('registrationSteam'),
            )
          : DOM(
              {
                domaudio: domAudioPresets.bigButton,
                style: ['login-box-forma-button', 'login-box-forma-button--yandex', 'yandexauth'],
                event: ['click', () => Window.show('main', 'yandexauth', 'register')],
              },
              Lang.text('registrationYandex'),
            );

      providerButtons.push(button);
    }

    if (App.providerRegistrationEnabled && providerButtons.length) {
      providers.push(
        DOM({ style: 'registration-providers-title' }, Lang.text('registrationViaTitle')),
        DOM({ style: 'login-box-forma-buttons' }, ...providerButtons),
      );
    }

    return DOM(
      { style: 'login_box' },
      DOM(
        { style: ['login-box-forma', 'login-box-forma--registration'] },

        DOM(
          { style: 'login-box-forma-inputs' },
          DOM({ style: ['login-box-forma-title', 'auth-window-title'] }, Lang.text('registration')),
          fraction,
          inviteContainer,
          login,
          password,
          password2,
          DOM(
            { style: 'login-box-forma-buttons' },
            submit,
            DOM(
              {
                domaudio: domAudioPresets.defaultButton,
                style: 'login-box-forma-button',
                event: ['click', () => View.show('authorization')],
              },
              Lang.text('back'),
            ),
          ),
          ...providers,
        ),
        DOM(
          { style: 'login-box-forma-right' },
          DOM({
            tag: 'img',
            style: ['login-box-forma-logo', 'login-box-forma-brand'],
            src: 'content/img/logo_classic.webp',
          }),
          DOM({
            tag: 'img',
            style: ['login-box-forma-logo', 'login-box-forma-qr'],
            src: 'content/img/pwclassicbot.png',
          }),
          DOM(
            { style: 'login-box-form-invite-text' },
            DOM({ tag: 'span' }, Lang.text('inviteCodeGet')),
            DOM({ tag: 'span' }, Lang.text('inviteViaQr')),
          ),
        ),
      ),
      DOM({ style: 'author' }, `Prime World: Classic v.${App.PW_VERSION}.${App.APP_VERSION}`),
    );
  }

  // Регистрация через провайдера (Steam/Яндекс): поля как у View.registration(),
  // но без пароля и инвайта. Ввод и ошибка живут в App.providerPending: форма
  // перерисовывается после отказа сервера (с новым билетом в ответе).
  static providerRegistration() {
    let pending = App.providerPending || { provider: 'steam', agreementUrl: '', login: '', fraction: 0, error: '' };
    let provider = pending.provider in Window.authProviders ? pending.provider : 'steam';
    let providerName = Lang.text(Window.authProviders[provider].label);

    let fraction = DOM({
      tag: 'button',
      type: 'button',
      value: `${pending.fraction || ''}`,
      domaudio: domAudioPresets.defaultSelect,
      style: ['registration-fraction-trigger', ...(pending.fraction ? ['registration-fraction-trigger--selected'] : [])],
      event: ['click', () => Window.show('main', 'registrationFraction', fraction)],
    }, Number(pending.fraction) === 1 ? Lang.text('adornia') : Number(pending.fraction) === 2 ? Lang.text('docts') : Lang.text('fraction'));

    let login = DOM({
      tag: 'input',
      domaudio: domAudioPresets.defaultInput,
      placeholder: Lang.text('nickname'),
      maxLength: 20,
      autocomplete: 'off',
      value: `${pending.login || ''}`,
      event: [
        'keyup',
        async (event) => {
          if (!App.isEnterKey(event)) return;
          await App.registrationProvider(fraction, login);
        },
      ],
    });

    let submit = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'login-box-forma-button',
        event: ['click', () => App.registrationProvider(fraction, login)],
      },
      Lang.text('registration1'),
    );

    return DOM(
      { style: 'login_box' },
      DOM(
        { style: ['login-box-forma', 'login-box-forma--registration', 'login-box-forma--provider-registration'] },

        DOM(
          { style: 'login-box-forma-inputs' },
          DOM({ style: ['login-box-forma-title', 'auth-window-title'] }, Lang.text('providerRegistration')),
          DOM(
            { style: 'registration-intro' },
            Lang.text(provider === 'steam' ? 'providerRegistrationIntroSteam' : 'providerRegistrationIntroYandex'),
          ),
          DOM({ style: 'registration-error' }, pending.error || ''),
          fraction,
          login,
          DOM({ style: 'registration-hint' }, Lang.text('nicknameHint')),
          DOM(
            { style: 'login-box-forma-buttons' },
            submit,
            DOM(
              {
                domaudio: domAudioPresets.defaultButton,
                style: 'login-box-forma-button',
                event: ['click', () => View.show('authorization')],
              },
              Lang.text('back'),
            ),
          ),
          DOM({ style: 'registration-exists' }, Lang.text('providerRegistrationExists').replace('{provider}', providerName)),
        ),
        DOM(
          { style: 'login-box-forma-right' },
          DOM({
            tag: 'img',
            style: ['login-box-forma-logo', 'login-box-forma-brand'],
            src: 'content/img/logo_classic.webp',
          }),
        ),
      ),
      DOM({ style: 'author' }, `Prime World: Classic v.${App.PW_VERSION}.${App.APP_VERSION}`),
    );
  }

  static progress() {
    let body = DOM({ style: 'progress' }, DOM({ style: 'animation1' }), DOM());

    Splash.show(body, false);
    Splash.body.classList.add('splash--blur');

    return body;
  }

  // Прогресс обновления — небольшая плашка под чатом замка (до входа в замок — сверху экрана),
  // замок не перекрывает, клики проходят сквозь неё. На время обновления бой запрещён (MM.isBlockedByUpdate).
  // data: { update, title, total } от NativeAPI.update.
  static updateIndicator(data) {
    if (!data.update) {
      if (View.updateProgress) View.updateProgress.remove();
      View.updateProgress = false;
      return;
    }
    if (!View.updateProgress) {
      View.updateProgress = DOM({ style: 'update-indicator' }, DOM({ style: ['update-indicator-bar', 'animation1'] }), DOM({ style: 'update-indicator-text' }));
    }
    // чат замка пересоздаётся вместе с замком — каждый раз ищем, под чем показываться
    View.placeUpdateIndicator(document.querySelector('.castle-chat'));
    // total: null — процентов ещё нет (подключение к зеркалам, сверка): бегущая полоса без числа
    const known = Number.isFinite(data.total);
    View.updateProgress.classList.toggle('update-indicator--indeterminate', !known);
    View.updateProgress.firstChild.style.width = known ? data.total + '%' : '';
    View.updateProgress.lastChild.innerText = known ? `${data.title} ${data.total}%...` : `${data.title}...`;
  }

  static async castle(castleArg = null) {
    document.body.classList.add('noselect');

    Shop.retrieveLastUpdate();
    syncFairGameFiles(); // номер выбранной похвалы и тексты похвал — в файлы игры
    ReplayUpload.resume(); // недосланные реплеи боёв (после перезапуска лончера тоже)

    View.setCss('content/castle.css');

    let body = DOM({ tag: 'div', id: 'castle-body' });
    let backgroundImage = DOM({ tag: 'div', id: 'castle-background-img' });

    if (!Castle.canvas) {
      Castle.canvas = DOM({ tag: 'canvas', id: 'castle-game-surface' });
      Castle.buildingBubbles = DOM({ style: 'castle-buildings-bubbles' });
      // вытесненные при перестановке здания ждут здесь, пока их не поставят
      Castle.pendingTray = DOM({ style: 'castle-pending-buildings' });
    }

    try {
      if (!Castle.gl) {
        await Castle.initDemo(App.storage.data.fraction == 1 ? 'ad' : 'doct', Castle.canvas);
      }
    } catch (error) {
      // если замок не работает на устройстве, тогда рендерим старую версию главной страницы

      App.error(error);
    }

    body.append(backgroundImage, Castle.canvas, Castle.buildingBubbles, Castle.pendingTray, View.castleQuestBody);
    Castle.renderPendingTray();

    try {
      await View.castleQuestUpdate();
    } catch (error) {
      App.error(error);
    }

    let partyData = null;
    let castleOptions = {};
    if (castleArg && typeof castleArg === 'object') {
      if ('users' in castleArg || 'mode' in castleArg || 'id' in castleArg) {
        partyData = castleArg;
      } else {
        castleOptions = castleArg;
      }
    }

    try {
      let castlePlay = await View.castlePlay(partyData, castleOptions);

      body.append(castlePlay);
    } catch (error) {
      if (String(error).search(new RegExp(`session is not valid`, 'i')) != -1) {
        const pulse = await App.syncAuthPulse();
        if (App.isAuthPulseActive(pulse)) {
          await View.show('authorization');
        } else {
          await App.exit();
        }

        NativeAPI.reset();

        return;
      }

      App.error(error);
    }

    body.append(View.castleChat());

    try {
      let castleHeroes = await View.castleHeroes();

      body.append(castleHeroes);
    } catch (e) {
      App.error(e);
    }

    body.append(View.castleSettings());

    setTimeout(() => {
      Chat.scroll();
    }, 1500);

    return body;
  }

  static updateCastleFactionFlag() {
    if (!View.flagMenuItem) return;
    View.flagMenuItem.style.backgroundImage =
      Castle.currentSceneName == 'doct' ? `url(content/icons/Human_logo_over.webp)` : `url(content/icons/Elf_logo_over.webp)`;
  }

  // Индикатор поверх герба фракции, пока Castle.switchScene собирает сцену: кольцо, затемнение и надпись.
  // Герб в это время не нажимается.
  static setCastleFactionUpdating(updating) {
    const flag = View.flagMenuItem;
    if (!flag) return;
    flag.querySelector('.castle-faction-updating')?.remove();
    flag.classList.toggle('flag-menu-item-updating', updating);
    if (updating) {
      flag.append(
        DOM(
          { style: 'castle-faction-updating' },
          DOM({ style: 'castle-faction-updating-ring' }),
          DOM({ style: 'castle-faction-updating-label' }, Lang.text('castleFactionUpdating')),
        ),
      );
    }
  }

  // Смена фракции: от неё в замке зависят только флаг, список построек и иконки ждущих зданий.
  // Весь замок (группа, чат, герои, друзья) не пересобираем и открытые окна не закрываем.
  // false — замок сейчас не открыт, обновлять нечего.
  static refreshCastleFaction() {
    const castleBody = document.getElementById('castle-body');
    if (!castleBody || View.active !== castleBody) return false;
    View.updateCastleFactionFlag();
    if (View.castleActiveTab === 'buildings') {
      const scroll = Number(View.castleBottom?.scrollLeft) || 0;
      View.bodyCastleBuildings();
      View.resetCastleBottomScroll(scroll);
    }
    Castle.renderPendingTray();
    return true;
  }

  static async refreshCastlePlayOnly(partyData = null) {
    const castleBody = document.getElementById('castle-body');
    const activeCastleView = castleBody && View.active === castleBody;
    const currentCastlePlay = activeCastleView ? castleBody.querySelector('.castle-play') : null;
    if (!currentCastlePlay) {
      await View.show('castle', partyData);
      return;
    }

    // Несколько PUpdate подряд: castlePlay асинхронный (loadParty/heroAll),
    // ответы могут прийти не по порядку — применяем только последний рендер
    // и заменяем тот .castle-play, что в DOM сейчас (а не уже отсоединённый).
    const seq = ++View.castlePlayRefreshSeq;
    const updatedCastlePlay = await View.castlePlay(partyData);
    if (seq !== View.castlePlayRefreshSeq) return;
    const liveCastlePlay = castleBody.querySelector('.castle-play');
    if (!liveCastlePlay || View.active !== castleBody) return;
    liveCastlePlay.replaceWith(updatedCastlePlay);
  }

  static async castlePlay(partyData = null, options = {}) {
    const DEMO_PARTY_SIZE = 0;
    let body = DOM({ style: 'castle-play' });

    let play = MM.play();

    play.classList.remove('main-header-item');

    play.classList.remove('button-play');

    play.classList.add('castle-button-play');
    /*
        if(!play.children.length){
            
            play.append(DOM({id:'MMQueue'},'0'));
            
        }
        */
    let lobby = DOM({ style: 'castle-play-lobby' });

    let data = partyData || (await App.api.request(App.CURRENT_MM, 'loadParty')),
      players = new Array();

    // Устаревший PUpdate (нас уже кикнули / пати распалась) — нас нет в users:
    // берём актуальное состояние с сервера, а не падаем на data.users[myId].
    const myId = App.storage?.data?.id; // в DEV-превью (?previewBuild=1) App.storage нет
    if (partyData && !partyData?.users?.[myId]) {
      data = await App.api.request(App.CURRENT_MM, 'loadParty');
    }
    if (!data || typeof data.users !== 'object' || !data.users) {
      data = { ...(data || {}), id: myId, users: {} };
    }

    MM.partyId = data.id;
    MM.partyMembersCount = Object.keys(data?.users || {}).length || 1;
    if (data && ('mode' in data) && !options?.preserveMode) {
      CastleNAVBAR.setMode(Number(data.mode) + 1, { syncParty: false });
    }

    MM.activeSelectHero = Number(data.users[myId]?.hero) || 0;

    MM.searchActive(Boolean(data.users[MM.partyId]?.ready));

    try {
      const heroes = options.previewData?.heroes || await View.getPartyHeroes();
      MM.hero = Array.isArray(heroes) ? heroes : [];
    } catch (e) {
      console.warn('Could not preload heroes:', e);
      if (!Array.isArray(MM.hero)) MM.hero = [];
    }

    for (let key in data.users) {
      let userRating = data.users[key].heroRating || 1100;
      // рамка по победам: wins/frameType из пати; у себя — из heroAll, если бэкенд их ещё не прислал
      let frameData = { wins: data.users[key].wins, frameType: data.users[key].frameType };

      if (key == App.storage.data.id && data.users[key].hero && MM.hero.length > 0) {
        const userHero = MM.hero.find((h) => Number(h.id) === Number(data.users[key].hero));
        if (userHero && userHero.rating) {
          userRating = userHero.rating;
        }
        if (userHero && !('wins' in data.users[key])) {
          frameData = { wins: userHero.wins, frameType: userHero.frameType };
        }
      }

      players.push({
        id: key,
        hero: data.users[key].hero,
        nickname: data.users[key].nickname,
        ready: data.users[key].ready,
        rating: userRating,
        skin: data.users[key].skin,
        wins: frameData.wins,
        frameType: frameData.frameType,
        demo: false,
      });
    }

    if (players.length < DEMO_PARTY_SIZE) {
      const heroPool = Array.isArray(MM.hero) ? MM.hero.filter((h) => Number(h?.id) > 0) : [];
      const usedHeroIds = new Set(players.map((p) => Number(p.hero)).filter((id) => Number.isFinite(id) && id > 0));
      const pickDemoHero = (seed) => {
        if (!heroPool.length) return { hero: 0, skin: 1, rating: 1100 };
        let idx = Math.abs(Number(seed) || 0) % heroPool.length;
        for (let tries = 0; tries < heroPool.length; tries++) {
          const cand = heroPool[(idx + tries) % heroPool.length];
          const cid = Number(cand?.id);
          if (!Number.isFinite(cid) || cid <= 0) continue;
          if (!usedHeroIds.has(cid)) {
            usedHeroIds.add(cid);
            return {
              hero: cid,
              skin: Number(cand?.skin) > 0 ? Number(cand.skin) : 1,
              rating: Number(cand?.rating) || 1100,
              wins: cand?.wins,
              frameType: cand?.frameType,
            };
          }
        }
        const fallback = heroPool[idx];
        return {
          hero: Number(fallback?.id) || 0,
          skin: Number(fallback?.skin) > 0 ? Number(fallback.skin) : 1,
          rating: Number(fallback?.rating) || 1100,
        };
      };

      const need = DEMO_PARTY_SIZE - players.length;
      for (let i = 0; i < need; i++) {
        const demoId = `demo-${i + 1}`;
        const demoHero = pickDemoHero(i + 37);
        players.push({
          id: demoId,
          hero: demoHero.hero,
          nickname: `Teammate ${i + 1}`,
          ready: i % 3 !== 0 ? 1 : 0,
          rating: demoHero.rating,
          skin: demoHero.skin,
          wins: demoHero.wins,
          frameType: demoHero.frameType,
          demo: true,
        });
      }
    }

    const partySize = Math.max(1, players.length);
    const maxInRow = partySize <= 5 ? partySize : 5;
    lobby.style.setProperty('--castle-play-lobby-max-in-row', String(maxInRow));
    const rowCount = Math.max(1, Math.ceil(partySize / maxInRow));
    lobby.dataset.rows = String(rowCount);
    /*
        if(players.length < 5){
            
            while(players.length < 5){
                
                players.push({id:0,hero:0,nickname:'',ready:0});
                
            }
            
        }
        */
    for (let p in players) {
      let player = players[p];

      let item = DOM({
        domaudio: domAudioPresets.bigButton,
        style: 'castle-play-lobby-player',
        data: { id: player.id },
      });

      let rank = Rank.createRankNode(player.rating);

      // рамка под плашкой ранга
      item.append(HeroFrame.createNode(Number(player.hero) ? player : null), rank);

      if (!player.rating || player.rating === 0 || !Number(player.hero)) {
        rank.style.display = 'none';
      } else {
        rank.style.display = 'flex';
      }

      let status = DOM(
        {
          style: ['castle-party-middle-item-ready-notready', 'castle-party-middle-item-not-ready'],
        },
        DOM({}, Lang.text('partyNotReady')),
      );

      if (player.id) {
        if (player.ready) {
          status.firstChild.innerText = Lang.text('ready');

          status.classList.replace('castle-party-middle-item-not-ready', 'castle-party-middle-item-ready');
        } else if (MM.partyId == player.id) {
          status.firstChild.innerText = Lang.text('ready');

          status.classList.replace('castle-party-middle-item-not-ready', 'castle-party-middle-item-ready');
        } else if (player.id == App.storage.data.id) {
          status.onclick = async () => {
            // Защита от двойного клика (в т.ч. в браузере без NativeAPI)
            if (status.dataset.busy === '1') {
              return;
            }
            status.dataset.busy = '1';
            try {
              if (MM.isBlockedByUpdate()) {
                return;
              }

              if (NativeAPI.status) {
                if (PWGame.gameConnectionTestIsActive) {
                  return;
                }

                PWGame.gameConnectionTestIsActive = true;

                try {
                  await PWGame.check();

                  await PWGame.checkUpdates();
                } finally {
                  PWGame.gameConnectionTestIsActive = false;
                }
              }

              await App.api.request(App.CURRENT_MM, 'readyParty', {
                id: MM.partyId,
                mac: NativeAPI.getMACAdress(),
                cache: await NativeAPI.getCacheIndex(),
              });

              status.onclick = null;
            } catch (e) {
              App.error(e);
            } finally {
              delete status.dataset.busy;
            }
          };

          status.firstChild.innerText = Lang.text('confirm');
        }

        const heroImg = player.hero
          ? `url(content/hero/${player.hero}/${player.skin ? player.skin : 1}.webp)`
          : `url(content/hero/empty.webp)`;

        item.style.backgroundImage = `${heroImg}, url(content/hero/background.png)`;
        item.style.backgroundRepeat = 'no-repeat, no-repeat';
        item.style.backgroundPosition = 'center, center';
        item.style.backgroundSize = 'contain, contain';
      } else {
        item.innerHTML = '<div class="castle-play-lobby-empty"><div>+</div></div>';

        status.style.opacity = 0;

        // lvl.style.opacity = 0;

        //rank.style.opacity = 0;
      }

      let removeButton = DOM({ style: 'castle-party-remove' });

      removeButton.style.backgroundImage = `url(content/icons/close-cropped.svg)`;

      const nicknameValue = String(player.nickname || '');
      let nicknameText = DOM({}, nicknameValue || Lang.text('partyAddPlayer'));

      let nicknameHideOverflowContainer = DOM({ style: 'castle-party-middle-item-nickname-hidden-overflow' }, nicknameText);

      let nickname = DOM({ style: 'castle-party-middle-item-nickname' }, nicknameHideOverflowContainer);

      let playerX = DOM(
        {
          id: `PP${player.id}`,
          style: 'castle-party-middle-item',
          title: Lang.text('choosingHero'),
        },
        nickname,
        item,
        status,
      );

      if (p > 0 && !players[p - 1].id) {
        playerX.style.display = 'none';
      }

      if (nicknameValue.length > 20) {
        nickname.firstChild.firstChild.classList.add('castle-name-autoscroll');
      }

      playerX.dataset.id = player.id;

      nickname.firstChild.firstChild.classList.add('castle-player-nickname');

      if (MM.partyId == App.storage.data.id && !player.demo && playerX.dataset.id != App.storage.data.id && playerX.dataset.id != 0) {
        removeButton.addEventListener('click', async () => {
          await App.api.request(App.CURRENT_MM, 'leaderKickParty', {
            id: playerX.dataset.id,
          });
        });

        if (nicknameValue.length > 15) {
          nickname.firstChild.firstChild.classList.add('castle-name-autoscroll');
        }

        nickname.append(removeButton);
      }

      if (MM.partyId != App.storage.data.id && playerX.dataset.id == App.storage.data.id) {
        removeButton.addEventListener('click', async () => {
          await App.api.request(App.CURRENT_MM, 'leaveParty', {
            id: MM.partyId,
          });

          await View.refreshCastlePlayOnly();
        });

        if (nicknameValue.length > 15) {
          nickname.firstChild.firstChild.classList.add('castle-name-autoscroll');
        }

        nickname.append(removeButton);
      }

      item.addEventListener('click', async () => {
        if (item.dataset.id == App.storage.data.id) {
          await View.openCastlePartyHeroPicker(item, player.rating);
        }
        /*
                if( ( (item.dataset.id == 0) && ( (!MM.partyId ) || (MM.partyId == App.storage.data.id) ) ) ){
                    
                    let input = DOM({tag:'input',style:'search-input'});
                    
                    let body = DOM({style:'search-body'});
                    
                    let search = DOM({style:'search'},input,body,DOM({style:'search-bottom',event:['click',() => {
                        
                        Splash.hide();
                        
                    }]},`[Назад]`));
                    
                    input.addEventListener('input', async () => {
                        
                        let request = await App.api.request(App.CURRENT_MM,'findUser',{name:input.value});
                        
                        if(body.firstChild){
                            
                            while(body.firstChild){
                                
                                body.firstChild.remove();
                                
                            }
                            
                        }
                        
                        for(let item of request){
                            
                            body.append(DOM({event:['click', async () => {
                                
                                await App.api.request(App.CURRENT_MM,'inviteParty',{id:item.id,mode:CastleNAVBAR.mode});
                                
                                App.notify(`Приглашение отправлено игроку ${item.nickname}`,1000);
                                
                                // Splash.hide();
                                
                            }]},item.nickname));
                            
                        }
                        
                    });
                    
                    Splash.show(search,false);
                    
                    input.focus();
                    
                }
                */
      });

      lobby.append(playerX);
    }

    body.append(CastleNAVBAR.body, lobby);
    if (!options.previewData) View.bindCastleModeHeroAutoOpen();

    return body;
  }

  static castleBannerOnline() {
    const getDivisionId = () =>
      (window.User && (User.divisionId || User.rank || User.rating)) ||
      (window.Settings && Settings.user && (Settings.user.divisionId || Settings.user.rank)) ||
      10;

    const isFiniteNumber = (v) => Number.isFinite(v) && !Number.isNaN(v);

    const safeQueueCounts = (cssKey) => {
      let party = 0,
        players = 0;

      try {
        if (typeof View?.getQueue === 'function') {
          const v = Number(View.getQueue(cssKey));
          if (isFiniteNumber(v)) party = v;
        }
      } catch (_) {}

      try {
        if (typeof View?.getTotalQueue === 'function') {
          const t = Number(View.getTotalQueue(cssKey));
          if (isFiniteNumber(t)) players = t;
        }
      } catch (_) {}

      return { players, party };
    };

    // карта режимов
    const modeMap = {
      pvp: 0,
      anderkrug: 1,
      cte: 2,
      m4: 3,
      'custom-battle': 4,
      'pve-ep2-red': 5,
    };

    const bannerItems = Object.entries(modeMap).map(([cssKey]) => ({
      cssKey,
      label: () => (typeof View?.getQueue === 'function' ? View.getQueue(cssKey) : 0),
    }));

    const banner = DOM({ style: ['castle-banner-online'] });
    banner.append(DOM({ style: ['banner-ornament'] }));

    // --- элементы по режимам ---
    bannerItems.forEach((item, idx) => {
      const wrap = DOM({ style: ['banner-item'] });

      // иконка режима
      const icon = DOM({
        style: ['banner-icon', `banner-icon--${item.cssKey}`],
      });
      wrap.append(icon);

      // счётчик: всегда стартует с "0/0"
      const lbl = DOM({ tag: 'div', style: ['banner-count', 'is-loading'] });
      lbl.textContent = '0/0';
      lbl.title = Lang.text('queueCountTooltip');
      wrap.append(lbl);

      const onQueuesUpdated = () => {
        const { players, party } = safeQueueCounts(item.cssKey);
        lbl.textContent = `${players}/${party}`;
        if (players || party) lbl.classList.remove('is-loading');
      };
      window.addEventListener?.('queues:updated', onQueuesUpdated);

      let ticks = 0;
      const iv = setInterval(() => {
        ticks++;
        const { players, party } = safeQueueCounts(item.cssKey);
        const current = lbl.textContent;
        const next = `${players}/${party}`;
        if (current !== next) {
          lbl.textContent = next;
        }
        if (players || party) {
          lbl.classList.remove('is-loading');
        }
        if (players || party || ticks >= 30) {
          clearInterval(iv);
        }
      }, 500);

      banner.append(wrap);

      if (idx < bannerItems.length - 1) {
        banner.append(DOM({ tag: 'div', style: ['banner-separator'] }));
      }
    });

    // --- блок статистики/кнопка Stat ---
    const statWrapper = DOM({ style: ['banner-stat-wrapper'] });
    const statRect = DOM({ style: ['banner-stat-rect'] });
    const statCircle = DOM({ style: ['banner-stat-circle'] });

    const statsBtn = DOM({
      domaudio: domAudioPresets.bigButton,
      style: ['banner-icon', 'banner-icon--stat', 'button-outline'],
      event: [
        'click',
        () => {
          App.openStatsProfile();
        },
      ],
    });
    statsBtn.setAttribute('aria-label', Lang.text('statistics'));
    const statsTooltip = DOM({ style: 'banner-stat-tooltip', textContent: Lang.text('statistics') });

    // бейдж дивизии под кнопкой Stat
    const divId = getDivisionId();
    const divInfo = typeof Division?.get === 'function' ? Division.get(divId) : { name: 'Дивизион', icon: 1 };

    const divisionBadgeUnderStat = DOM({
      style: ['banner-division-badge', 'banner-division-badge--stat'],
    });
    divisionBadgeUnderStat.style.backgroundImage = `url(content/ranks/${divInfo.icon}.webp)`;
    divisionBadgeUnderStat.title = Lang.text('titlehint2');

    statCircle.append(statsBtn, statsTooltip, divisionBadgeUnderStat);
    statWrapper.append(statRect, statCircle);

    // подсказка слева
    const tooltipWrap = DOM({ tag: 'div', style: ['tooltip-wrap-left'] });
    const tooltipBubble = DOM({ tag: 'div', style: ['tooltip-bubble-img'] });
    const tooltipText = DOM({ tag: 'div', style: ['tooltip-text'] });
    tooltipText.textContent = Lang.text('titlehint');
    tooltipBubble.append(tooltipText);
    tooltipWrap.append(tooltipBubble);

    View.castleCrystalContainer = DOM(
      {
        domaudio: domAudioPresets.bigButton,
        style: ['crystal-container', Shop.requireAnimation ? 'crystal-container-anim' : '_dummy_'],
        data: { tooltip: Lang.text('crystals') },
        event: [
          'click',
          () => {
            Window.show('main', 'shop');
          },
        ],
      },
      View.castleTotalCrystal,
    );

    banner.append(statWrapper, View.castleCrystalContainer);

    return DOM({ style: 'castle-banner-online-wrapper' }, banner);
  }

  static castleSettings() {
    let builds = DOM({
      domaudio: domAudioPresets.bigButton,
      style: ['castle-builds', 'button-outline'],
      data: { tooltip: Lang.text('rating') },
      event: ['click', () => View.show('top')],
    });

    let settings = DOM({
      domaudio: domAudioPresets.bigButton,
      style: ['castle-settings-btn', 'button-outline'],
      data: { tooltip: Lang.text('castleGraphicsToggle') },
      event: [
        'click',
        () => {
          let wrapper = DOM({ style: ['castle-settings-window'] });
          settings.append(wrapper);
        },
      ],
    });

    let clan = DOM({
      domaudio: domAudioPresets.bigButton,
      style: ['castle-clans', 'button-outline'],
      data: { tooltip: Lang.text('clans') },
      event: ['click', () => Frame.open('clan')],
    });

    let farm = DOM({
      domaudio: domAudioPresets.bigButton,
      style: ['castle-farm', 'button-outline'],
      data: { tooltip: Lang.text('farm') },
      event: ['click', () => Window.show('main', 'farm')],
    });

    let input = DOM({ style: 'castle-input', tag: 'input' });

    input.type = 'range';

    input.min = '0';
    input.max = '1';
    input.step = '0.01';

    let body = DOM({ style: ['castle-settings'] });
    let container = DOM({ style: ['castle-settings-container'] }, View.castleBannerOnline(), body);
    return container;
  }

  // Полоса обновления под чатом замка, без чата — сверху экрана.
  static placeUpdateIndicator(chat) {
    if (!View.updateProgress) return;
    const host = chat || document.body;
    if (View.updateProgress.parentNode === host) return;
    View.updateProgress.classList.toggle('update-indicator--chat', !!chat);
    host.append(View.updateProgress);
  }

  static castleChat() {
    let body = DOM({ style: 'castle-chat' }, Chat.body);
    // обновление началось до замка: полоса висела сверху экрана, а апдейтер может больше
    // ничего не прислать до конца (на 100% он молчит) — переносим её под чат сразу
    View.placeUpdateIndicator(body);

    return body;
  }

  static async castleHeroes(options = {}) {
    let tab = 1;
    const SCROLL_MODIFIER = 1;
    let body = DOM({ style: 'castle-bottom' });

    View.castleBottom = DOM({ style: 'castle-bottom-content' });

    View.castleBottom.addEventListener(
      'wheel',
      function (event) {
        if (event.deltaY != 0) {
          let deltaPx = 0;
          if (event.deltaMode == event.DOM_DELTA_PIXEL) {
            deltaPx = event.deltaY * SCROLL_MODIFIER;
          } else if (event.deltaMode == event.DOM_DELTA_LINE) {
            deltaPx = event.deltaY * 18 * SCROLL_MODIFIER;
          } else if (event.deltaMode == event.DOM_DELTA_PAGE) {
            deltaPx = this.clientWidth;
          }
          if (deltaPx !== 0) {
            event.preventDefault();
            View.applyCastleBottomScrollDelta(deltaPx);
          }
        }
      },
      { passive: false },
    );
    View.castleBottom.addEventListener(
      'scroll',
      () => {
        View.currentFloatScroll = Number(View.castleBottom?.scrollLeft) || 0;
        if (!View.castleBottomScrollRaf) {
          View.castleBottomTargetScroll = View.currentFloatScroll;
        }
        View.updateArrows();
      },
      { passive: true },
    );

    let nicknameValue = String(App?.storage?.data?.login || '').trim();
    let nicknameMenuItem = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'nickname-menu-item',
        event: [
          'click',
          () => {
            App.setNickname();
          },
        ],
        data: { tooltip: Lang.text('titleNicknameСhange') },
      },
      DOM({}, nicknameValue),
    );
    if (nicknameValue.length > 10) {
      nicknameMenuItem.firstChild.classList.add('castle-name-autoscroll');
    }

    let flagMenuItem = DOM({
      domaudio: domAudioPresets.defaultButton,
      style: 'flag-menu-item',
      event: [
        'click',
        () => {
          App.setFraction();
        },
      ],
      data: { tooltip: Lang.text('titleflag') },
    });

    const partyData = options.previewData?.party || await App.api.request(App.CURRENT_MM, 'loadParty', {});
    const dbNickname = String(partyData?.users?.[App.storage.data.id]?.nickname || '').trim();
    if (dbNickname) {
      nicknameMenuItem.firstChild.textContent = dbNickname;
      nicknameMenuItem.firstChild.classList.toggle('castle-name-autoscroll', dbNickname.length > 10);
      if (!options.previewData && App?.storage?.data?.login !== dbNickname) {
        App.storage.data.login = dbNickname;
      }
    }
    const playerRatingVisual = partyData.users[App.storage.data.id]?.playerRatingVisual || 0;
    let accountRatingItem = DOM(
      {
        style: 'account-rating-menu-item',
      },
      Lang.text('accountRating').replace('{rating}', playerRatingVisual),
    );

    const accountRatingTooltipText = Lang.text('accountRatingTooltip');
    const accountRatingTooltipMatch = accountRatingTooltipText.match(/^(\S+\s+\S+)\s*-\s*(.*)$/);
    const accountRatingTooltipTitle = accountRatingTooltipMatch ? accountRatingTooltipMatch[1] : '';
    const accountRatingTooltipBody = accountRatingTooltipMatch ? `- ${accountRatingTooltipMatch[2]}` : accountRatingTooltipText;
    const accountRatingTooltip = DOM({ style: 'account-rating-tooltip' });
    if (accountRatingTooltipTitle) {
      accountRatingTooltip.append(DOM({ style: 'account-rating-tooltip-title' }, accountRatingTooltipTitle));
    }
    accountRatingTooltip.append(DOM({ style: 'account-rating-tooltip-body' }, accountRatingTooltipBody));
    accountRatingItem.append(accountRatingTooltip);

    let settingsMenuItem = DOM({
      domaudio: domAudioPresets.defaultButton,
      style: 'settings-menu-item',
      event: [
        'click',
        () => {
          Window.show('main', 'menu');
        },
      ],
      data: { tooltip: Lang.text('titlesettings') },
    });
    let chatMenuItem = DOM({
      domaudio: domAudioPresets.defaultButton,
      style: ['chat-menu-item', Chat.hide ? 'chat-menu-item--muted' : null],
      role: 'button',
      tabIndex: 0,
      event: [
        'click',
        () => {
          Chat.changeChatVisibility();
        },
      ],
      data: { tooltip: Lang.text('chatToggle') },
    });
    chatMenuItem.setAttribute('aria-pressed', String(!Chat.hide));
    chatMenuItem.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        Chat.changeChatVisibility();
      }
    });
    chatMenuItem.setAttribute('aria-pressed', String(!Chat.hide));
    chatMenuItem.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        Chat.changeChatVisibility();
      }
    });
    let notificationsMenuItem = App.createNotificationsButton();
    let heroesMenuItem = DOM({
      domaudio: domAudioPresets.defaultButton,
      style: 'heroes-menu-item',
      event: [
        'click',
        () => {
          View.bodyCastleHeroes();
          View.resetCastleBottomScroll(0);
          Castle.buildMode = false;
        },
      ],
      data: { tooltip: Lang.text('titleheroes') },
    });
    let friendsMenuItem = DOM({
      domaudio: domAudioPresets.defaultButton,
      style: 'friends-menu-item',
      event: [
        'click',
        () => {
          View.bodyCastleFriends();
          View.resetCastleBottomScroll(0);
          Castle.buildMode = false;
        },
      ],
      data: { tooltip: Lang.text('titlefriends') },
    });
    View.friendsMenuItem = friendsMenuItem;
    View.updateFriendsMenuIncomingState();
    let buildingsMenuItem = DOM({
      domaudio: domAudioPresets.defaultButton,
      style: 'buildings-menu-item',
      event: [
        'click',
        () => {
          View.bodyCastleBuildings();
          View.resetCastleBottomScroll(0);
          Castle.buildMode = true;
        },
      ],
      data: { tooltip: Lang.text('titleconstruction') },
    });
    const framedMenuItems = [buildingsMenuItem, heroesMenuItem, friendsMenuItem, chatMenuItem];
    for (const menuItem of framedMenuItems) {
      menuItem.append(DOM({ style: 'castle-menu-icon-frame' }));
    }
    for (const menuItem of [heroesMenuItem, friendsMenuItem, buildingsMenuItem]) {
      menuItem.append(DOM({ style: 'castle-panel-menu-active-frame' }));
    }
    View.heroesMenuItem = heroesMenuItem;
    View.friendsMenuItem = friendsMenuItem;
    View.buildingsMenuItem = buildingsMenuItem;
    if (!options.previewData) App.api.silent(
      (result) => {
        View.castleFriendAll = Array.isArray(result) ? result : [];
        View.setFriendIncomingStatus(View.castleFriendAll.some((item) => Number(item?.status) === 2));
        View.updateFriendsMenuOnlineCount();
      },
      'friend',
      'list',
    );

    View.flagMenuItem = flagMenuItem;
    View.updateCastleFactionFlag();

    View.arrows = new Object();
    View.arrows.ls = DOM({
      domaudio: domAudioPresets.smallButton,
      style: 'castle-bottom-left-scroll-single',
      event: ['click', () => View.scrollHero(-1)],
    });
    View.arrows.ld = DOM({
      domaudio: domAudioPresets.smallButton,
      style: 'castle-bottom-left-scroll-double',
      event: ['click', () => View.scrollHeroLine(-1)],
    });
    View.arrows.rs = DOM({
      domaudio: domAudioPresets.smallButton,
      style: 'castle-bottom-right-scroll-single',
      event: ['click', () => View.scrollHero(1)],
    });
    View.arrows.rd = DOM({
      domaudio: domAudioPresets.smallButton,
      style: 'castle-bottom-right-scroll-double',
      event: ['click', () => View.scrollHeroLine(1)],
    });
    View.castleHeroListsBar = DOM({ style: 'castle-hero-lists-bar' });
    View.castleHeroPinnedEditor = DOM({ style: 'castle-hero-pinned-editor' });
    body.append(
      DOM(
        { style: 'castle-bottom-menu' },
        nicknameMenuItem,
        flagMenuItem,
        accountRatingItem,
        settingsMenuItem,
        notificationsMenuItem,
        heroesMenuItem,
        friendsMenuItem,
        buildingsMenuItem,
        chatMenuItem,
      ),
      DOM(
        { style: 'castle-bottom-content-container' },
        View.castleHeroListsBar,
        View.castleHeroPinnedEditor,
        View.castleBottom,
        DOM({ style: 'castle-bottom-content-left-scroll' }, View.arrows.ls, View.arrows.ld),
        DOM({ style: 'castle-bottom-content-right-scroll' }, View.arrows.rs, View.arrows.rd),
        View.createCastleDayModeButton(),
      ),
    );

    // Инициализируем вкладку героев после создания toolbar-контейнера,
    // чтобы кнопки списков появились сразу при входе в замок.
    if (options.previewData) {
      View.castleActiveTab = 'heroes';
      View.castleHeroSelectedList = 0;
      View.castleHeroListNames = {};
      View.castleHeroAll = options.previewData.heroes;
      View.updateCastlePanelMenuActiveState();
      View.renderCastleHeroesFromCache();
    } else {
      View.bodyCastleHeroes();
    }
    Castle.buildMode = false;

    View.resetCastleBottomScroll(Number(View.castleBottom?.scrollLeft) || 0);

    return body;
  }

  static currentFloatScroll = 0.0;
  static castleBottomTargetScroll = 0.0;
  static castleBottomScrollRaf = 0;

  static getCastleBottomMaxScrollLeft() {
    if (!View.castleBottom) return 0;
    return Math.max(0, View.castleBottom.scrollWidth - View.castleBottom.clientWidth);
  }

  static stopCastleBottomScrollAnimation() {
    if (!View.castleBottomScrollRaf) return;
    cancelAnimationFrame(View.castleBottomScrollRaf);
    View.castleBottomScrollRaf = 0;
  }

  static animateCastleBottomScroll() {
    if (!View.castleBottom) {
      View.castleBottomScrollRaf = 0;
      return;
    }
    const max = View.getCastleBottomMaxScrollLeft();
    View.castleBottomTargetScroll = Castle.clamp(View.castleBottomTargetScroll, 0, max);
    const current = Number(View.castleBottom.scrollLeft) || 0;
    const target = Number(View.castleBottomTargetScroll) || 0;
    const diff = target - current;
    if (Math.abs(diff) <= 0.35) {
      View.castleBottom.scrollLeft = target;
      View.currentFloatScroll = target;
      View.castleBottomScrollRaf = 0;
      View.updateArrows();
      return;
    }

    const next = current + diff * 0.22;
    View.castleBottom.scrollLeft = next;
    View.currentFloatScroll = next;
    View.castleBottomScrollRaf = requestAnimationFrame(() => View.animateCastleBottomScroll());
  }

  static applyCastleBottomScrollDelta(deltaPx) {
    if (!View.castleBottom) return;
    const max = View.getCastleBottomMaxScrollLeft();
    if (!Number.isFinite(View.castleBottomTargetScroll)) {
      View.castleBottomTargetScroll = Number(View.castleBottom.scrollLeft) || 0;
    }
    View.castleBottomTargetScroll = Castle.clamp(View.castleBottomTargetScroll + deltaPx, 0, max);
    if (!View.castleBottomScrollRaf) {
      View.castleBottomScrollRaf = requestAnimationFrame(() => View.animateCastleBottomScroll());
    }
  }

  static resetCastleBottomScroll(value = 0) {
    if (!View.castleBottom) return;
    View.stopCastleBottomScrollAnimation();
    const max = View.getCastleBottomMaxScrollLeft();
    const v = Castle.clamp(Number(value) || 0, 0, max);
    View.castleBottomTargetScroll = v;
    View.currentFloatScroll = v;
    View.castleBottom.scrollLeft = v;
    View.updateArrows();
  }

  static scrollCastleBottomToHero(heroId, { center = false } = {}) {
    const targetHeroId = Number(heroId);
    if (!View.castleBottom || !Number.isFinite(targetHeroId) || targetHeroId <= 0) return;
    const item = View.castleBottom.querySelector(`.castle-hero-item[data-hero-id="${targetHeroId}"]`);
    if (!item) return;

    const max = View.getCastleBottomMaxScrollLeft();
    let target = Number(item.offsetLeft) || 0;
    if (center) {
      target = target - (View.castleBottom.clientWidth - item.clientWidth) / 2;
    } else {
      // Scroll only when selected hero starts touching/leaving edges.
      const current = Number(View.castleBottom.scrollLeft) || 0;
      const edgePad = Math.max(12, Math.round(item.clientWidth * 1.5));
      const itemLeft = Number(item.offsetLeft) || 0;
      const itemRight = itemLeft + (Number(item.offsetWidth) || 0);
      const safeLeft = current + edgePad;
      const safeRight = current + View.castleBottom.clientWidth - edgePad;

      if (itemLeft < safeLeft) {
        target = itemLeft - edgePad;
      } else if (itemRight > safeRight) {
        target = itemRight - View.castleBottom.clientWidth + edgePad;
      } else {
        return;
      }
    }
    View.castleBottomTargetScroll = Castle.clamp(target, 0, max);
    if (!View.castleBottomScrollRaf) {
      View.castleBottomScrollRaf = requestAnimationFrame(() => View.animateCastleBottomScroll());
    }
  }

  static scrollHero(delta) {
    if (!View.castleBottom?.firstChild) return;
    const style = getComputedStyle(View.castleBottom.firstChild);
    const itemWidth = parseFloat(style.width) || View.castleBottom.clientHeight;
    const itemBorder = parseFloat(style.borderRightWidth) || 0;
    const modifier = itemWidth + itemBorder;
    View.applyCastleBottomScrollDelta(modifier * delta);
  }

  static scrollHeroLine(delta) {
    const width = parseFloat(getComputedStyle(View.castleBottom).width) || View.castleBottom.clientWidth;
    View.applyCastleBottomScrollDelta(width * delta);
  }

  static updateArrows() {
    let maxScrollLeft = View.castleBottom.scrollWidth - View.castleBottom.clientWidth;
    if (View.castleBottom.scrollLeft == 0) {
      View.arrows.ls.classList.add('castle-bottom-content-btn-disable');
      View.arrows.ld.classList.add('castle-bottom-content-btn-disable');
    } else {
      View.arrows.ls.classList.remove('castle-bottom-content-btn-disable');
      View.arrows.ld.classList.remove('castle-bottom-content-btn-disable');
    }

    if (maxScrollLeft && View.castleBottom.scrollLeft == maxScrollLeft) {
      View.arrows.rs.classList.add('castle-bottom-content-btn-disable');
      View.arrows.rd.classList.add('castle-bottom-content-btn-disable');
    } else {
      View.arrows.rs.classList.remove('castle-bottom-content-btn-disable');
      View.arrows.rd.classList.remove('castle-bottom-content-btn-disable');
    }
  }

  static async castleQuestUpdate() {
    let request;

    try {
      request = await App.api.request('quest', 'list');

      if (!('crystal' in request)) {
        alert(request);
        return App.error(`Неизвестное число кристаллов: ${JSON.stringify(request)}`);
      }

      View.castleTotalCrystal.firstChild.innerText = request.crystal;
    } catch (error) {
      return App.error(error);
    }

    while (View.castleQuestBody.firstChild) {
      View.castleQuestBody.firstChild.remove();
    }

    const list = DOM({ style: 'quest-list' });
    const PAGE = 4;
    let start = 0;
    const items = [];

    const btnUp = DOM({
      domaudio: domAudioPresets.smallButton,
      style: ['quest-arrow', 'quest-arrow-up'],
      event: [
        'click',
        () => {
          if (start > 0) {
            start--;
            render();
          }
        },
      ],
    });

    const btnDown = DOM({
      domaudio: domAudioPresets.smallButton,
      style: ['quest-arrow', 'quest-arrow-down'],
      event: [
        'click',
        () => {
          if (start < Math.max(0, items.length - PAGE)) {
            start++;
            render();
          }
        },
      ],
    });

    if (request.quests.length > PAGE) {
      View.castleQuestBody.append(btnUp, list, btnDown); // порядок: ▲ список ▼
    } else {
      View.castleQuestBody.append(list); // порядок: ▲ список ▼
    }

    for (let item of request.quests) {
      const timerMs = Number(item.timer ?? item.timeLeft ?? item.remainingMs ?? item.remaining ?? 0) || 0;
      const isActiveQuest = Number(item.status) === 1;
      // day = 0 — квест без срока, таймер не показываем
      const hasTimer = isActiveQuest && Number(item.day) !== 0;
      let hero = DOM({ style: 'quest-item-hero' }, DOM({ style: 'quest-item-portrait-glass' }));
      hero.style.backgroundImage = `url(content/hero/${item.heroId}/1.webp)`;

      let timer = DOM({ style: 'quest-item-timer' });
      item.timer = hasTimer ? Math.max(0, timerMs) : 0;
      const tick = () => {
        item.timer = Math.max(0, item.timer - 1000);
        timer.textContent = Timer.getFormattedTimer(item.timer) || '00:00';
      };
      tick();
      if (hasTimer) setInterval(tick, 1000);

      let quest = DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          style: ['quest-item', isActiveQuest ? 'quest-item--active' : null].filter(Boolean),
          domaudio: domAudioPresets.defaultButton,
          event: [
            'click',
            () => {
              // Удаляем возможные предыдущие окна и не передаём превью-ноду
              document.querySelectorAll('#wquest').forEach((n) => n.remove());
              Window.show('main', 'quest', item);
            },
          ],
        },
        DOM(
          { style: 'quest-item-portrait-background' },
          hero,
          DOM({
            style: item.status == 0 ? 'quest-item-exclamation' : 'quest-item-completed',
          }),
        ),
        hasTimer ? timer : '',
      );

      items.push(quest);
      if (items.length <= PAGE) list.append(quest);
    }

    function render() {
      list.innerHTML = '';
      const end = Math.min(start + PAGE, items.length);
      for (let i = start; i < end; i++) list.append(items[i]);
      const maxStart = Math.max(0, items.length - PAGE);
      const noScroll = items.length <= PAGE;
      btnUp.classList.toggle('disabled', noScroll || start === 0);
      btnDown.classList.toggle('disabled', noScroll || start >= maxStart);
    }

    list.addEventListener(
      'wheel',
      (event) => {
        if (items.length <= PAGE) return;
        if (!event.deltaY) return;
        event.preventDefault();
        const maxStart = Math.max(0, items.length - PAGE);
        if (event.deltaY > 0) {
          if (start < maxStart) {
            start++;
            render();
          }
        } else if (start > 0) {
          start--;
          render();
        }
      },
      { passive: false },
    );

    render();
  }

  // Кнопка времени суток справа от стрелок списка: смена дня и ночи → всегда день → всегда ночь
  static createCastleDayModeButton() {
    const button = DOM({ style: 'castle-daymode-btn', domaudio: domAudioPresets.smallButton }, DOM({ style: 'castle-daymode-icon' }));
    const update = () => {
      const mode = Castle.dayMode;
      button.dataset.mode = mode;
      button.title = Lang.text(
        { cycle: 'castleDayModeCycle', day: 'castleDayModeDay', night: 'castleDayModeNight' }[mode],
      );
    };
    button.addEventListener('click', () => {
      // режимы работают только со сменой дня и ночи — включаем её, если была выключена в настройках
      if (Settings.settings && Settings.settings.dayNight === false) Settings.settings.dayNight = true;
      Castle.nextDayMode();
      update();
    });
    update();
    return button;
  }

  // Вкладки-иконки над списком построек, как в оригинальном замке (Castle.getBuildingCategory):
  // для героев, производство, развитие, услуги, декорации + осветители.
  // «Склад» (Pocket в оригинале — убранные с карты здания) пока серый и не нажимается: понадобится
  // для «Развития замка», включается снятием disabled.
  static CASTLE_BUILDING_CATEGORY_STORAGE_KEY = 'castleBuildingCategory';
  static CASTLE_BUILDING_CATEGORIES = [
    ['heroes', 'castleBuildCategoryHeroes'],
    ['production', 'castleBuildCategoryProduction'],
    ['house', 'castleBuildCategoryHouse'],
    ['services', 'castleBuildCategoryServices'],
    ['decor', 'castleBuildCategoryDecor'],
    ['lights', 'castleBuildCategoryLights'],
    ['storage', 'castleBuildCategoryStorage', { disabled: true }],
  ];
  static castleBuildingCategory = (() => {
    try {
      const value = localStorage.getItem('castleBuildingCategory');
      // старые значения из вкладок «Здания» / «Украшения»
      if (value === 'decorations') return 'decor';
      return View.CASTLE_BUILDING_CATEGORIES.some(([category, , options]) => category === value && !options?.disabled)
        ? value
        : 'production';
    } catch {
      return 'production';
    }
  })();

  static renderCastleBuildingTypesToolbar() {
    const bar = View.castleHeroListsBar;
    if (!bar) return;
    bar.replaceChildren();
    bar.classList.remove('castle-hero-lists-bar-hidden', 'castle-friend-lists-bar');
    bar.classList.add('castle-building-types-bar');
    for (const [category, langKey, options] of View.CASTLE_BUILDING_CATEGORIES) {
      if (options?.disabled) {
        bar.append(
          DOM(
            {
              style: ['castle-hero-list-btn', 'castle-building-type-btn', 'castle-building-type-btn-disabled'],
              data: { tooltip: `${Lang.text(langKey)}
${Lang.text('castleBuildCategoryUnavailable')}` },
            },
            DOM({ tag: 'img', style: 'castle-building-type-icon', src: `content/img/buildings/tabs/${category}.png` }),
          ),
        );
        continue;
      }
      bar.append(
        DOM(
          {
            style: [
              'castle-hero-list-btn',
              'castle-building-type-btn',
              View.castleBuildingCategory === category ? 'castle-hero-list-btn-active' : null,
            ].filter(Boolean),
            // у открытой вкладки название и так видно — подсказка только у остальных
            ...(View.castleBuildingCategory === category ? {} : { data: { tooltip: Lang.text(langKey) } }),
            domaudio: domAudioPresets.defaultButton,
            event: [
              'click',
              () => {
                if (View.castleBuildingCategory === category) return;
                View.castleBuildingCategory = category;
                try {
                  localStorage.setItem(View.CASTLE_BUILDING_CATEGORY_STORAGE_KEY, category);
                } catch {}
                View.bodyCastleBuildings();
                View.resetCastleBottomScroll(0);
              },
            ],
          },
          DOM({ tag: 'img', style: 'castle-building-type-icon', src: `content/img/buildings/tabs/${category}.png` }),
          // у открытой вкладки рядом с иконкой — её название
          ...(View.castleBuildingCategory === category ? [DOM({ style: 'castle-building-type-name' }, Lang.text(langKey))] : []),
        ),
      );
    }
  }

  static bodyCastleBuildings() {
    View.castleActiveTab = 'buildings';
    View.updateCastlePanelMenuActiveState();
    View.castleHeroDeleteConfirmListId = 0;
    View.castleFriendClearConfirm = false;
    View.cleanupCastleHeroPhantomList();
    View.castleHeroPinnedEditor?.replaceChildren?.();
    View.castleBottom?.classList?.remove('castle-bottom-content-with-editor');
    while (View.castleBottom.firstChild) {
      View.castleBottom.firstChild.remove();
    }
    View.renderCastleBuildingTypesToolbar();

    let selectedFaction = -1;
    if (Castle.currentSceneName == 'ad') {
      selectedFaction = 0;
    }
    if (Castle.currentSceneName == 'doct') {
      selectedFaction = 1;
    }
    if (selectedFaction == -1) {
      return;
    }

    let preload = new PreloadImages(View.castleBottom, (element) => {
      const imageUrl = String(element?.dataset?.url || '');
      if (!imageUrl) return;
      element.style.backgroundImage = `url("${imageUrl}"), radial-gradient(ellipse at 50% 43%, rgba(45, 209, 189, 0.48) 0%, rgba(45, 209, 189, 0.41) 12%, rgba(45, 209, 189, 0.32) 23%, rgba(45, 209, 189, 0.23) 35%, rgba(45, 209, 189, 0.15) 46%, rgba(45, 209, 189, 0.075) 57%, rgba(45, 209, 189, 0.035) 70%, rgba(45, 209, 189, 0.012) 88%, rgba(45, 209, 189, 0) 100%)`;
    });

    for (let i = 1; i < Castle.buildings.length; ++i) {
      let item = Castle.buildings[i];
      if (Castle.getBuildingCategory(item) !== View.castleBuildingCategory) continue;
      let itemName = Lang.text(Castle.buildingsNames[i][selectedFaction]);

      let buildingName = DOM({ style: 'castle-hero-name' }, DOM({}, itemName));

      if (itemName.length > 10) {
        buildingName.firstChild.classList.add('castle-name-autoscroll');
      }

      let buildingNameBase = DOM({ style: 'castle-item-hero-name' }, buildingName);
      let buildingIcon = DOM({ style: 'buildingIcon', src: 'content/img/buildings/hammerIcon.png', tag: 'img' });
      let buildingIconBox = DOM({ style: 'buildingIconBox', data: { tooltip: Lang.text('buildingBuild') } }, buildingIcon);

      let building = DOM(
        { style: 'castle-building-item' },
        DOM({ style: ['castle-item-ornament', 'hover-brightness'] }),
        buildingNameBase,
        buildingIconBox,
      );

      building.dataset.url = `content/img/buildings/${Castle.currentSceneName}/${item}.png`;

      // питомцы оживают при наведении: анимированная иконка (tools/pw-convert/animate_pet_icons.py),
      // её первый кадр совпадает со статичной
      if (View.CASTLE_ANIMATED_ICONS.includes(item)) {
        const animUrl = `content/img/buildings/${Castle.currentSceneName}/${item}_anim.webp`;
        new Image().src = animUrl;
        const setIcon = (url) => {
          const bg = building.style.backgroundImage;
          if (bg) building.style.backgroundImage = bg.replace(/url\([^)]*\)/, `url("${url}")`);
        };
        building.addEventListener('mouseenter', () => setIcon(animUrl));
        building.addEventListener('mouseleave', () => setIcon(building.dataset.url));
      }

      building.dataset.buildingId = i;
      // одиночное здание, которое уже стоит или ждёт, — серое
      if (Castle.isBuildingUnavailable(i)) {
        building.classList.add('castle-building-item-taken');
        building.dataset.tooltip = Lang.text('castleBuildingAlreadyBuilt');
      }

      building.addEventListener('click', async () => {
        // Сначала удаляем класс selectedBuild со всех зданий
        document.querySelectorAll('.castle-building-item').forEach((item) => {
          item.classList.remove('selectedBuild');
        });

        // Затем устанавливаем ID выбранного здания и добавляем класс
        // (одиночное здание, которое уже стоит или ждёт, не выбрать)
        if (Castle.selectPhantomBuilding(building.dataset.buildingId)) {
          building.classList.add('selectedBuild');
        }
      });

      preload.add(building);
    }
  }

  static getCastleHeroFavouriteMask(hero) {
    const raw = Number(hero?.favourite);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.min(255, raw | 0));
  }

  static isCastleHeroInList(hero, listId) {
    if (!Number.isFinite(listId) || listId < 1 || listId > View.CASTLE_HERO_LISTS_MAX) return false;
    const mask = View.getCastleHeroFavouriteMask(hero);
    return (mask & (1 << (listId - 1))) !== 0;
  }

  static getCastleCreatedHeroListCount() {
    let maxList = 0;
    for (const hero of View.castleHeroAll || []) {
      const mask = View.getCastleHeroFavouriteMask(hero);
      for (let bit = 0; bit < View.CASTLE_HERO_LISTS_MAX; bit++) {
        if (mask & (1 << bit)) {
          maxList = Math.max(maxList, bit + 1);
        }
      }
    }
    return maxList;
  }

  static persistCastleHeroSelectedList() {
    try {
      localStorage.setItem(View.CASTLE_HERO_LIST_STORAGE_KEY, String(View.castleHeroSelectedList || 0));
    } catch {}
  }

  static persistCastleHeroLastActiveList() {
    try {
      localStorage.setItem(View.CASTLE_HERO_LAST_ACTIVE_LIST_STORAGE_KEY, String(View.castleHeroLastActiveList || 0));
    } catch {}
  }

  static rememberCastleHeroLastActiveList(listId) {
    const id = Number(listId) || 0;
    if (id < 1 || id > View.CASTLE_HERO_LISTS_MAX) return;
    if (View.castleHeroLastActiveList === id) return;
    View.castleHeroLastActiveList = id;
    View.persistCastleHeroLastActiveList();
  }

  static loadCastleHeroSelectedList() {
    try {
      const value = Number(localStorage.getItem(View.CASTLE_HERO_LIST_STORAGE_KEY));
      if (Number.isFinite(value) && value >= 0 && value <= View.CASTLE_HERO_LISTS_MAX) {
        View.castleHeroSelectedList = value;
      }
    } catch {}
    try {
      const value = Number(localStorage.getItem(View.CASTLE_HERO_LAST_ACTIVE_LIST_STORAGE_KEY));
      if (Number.isFinite(value) && value >= 1 && value <= View.CASTLE_HERO_LISTS_MAX) {
        View.castleHeroLastActiveList = value;
      } else {
        View.castleHeroLastActiveList = 0;
      }
    } catch {}
    if (View.castleHeroSelectedList > 0) {
      View.rememberCastleHeroLastActiveList(View.castleHeroSelectedList);
    }
  }

  static getCastleHeroTamburListId(heroes = []) {
    const selectedListId = Number(View.castleHeroSelectedList) || 0;
    if (selectedListId >= 1 && selectedListId <= View.CASTLE_HERO_LISTS_MAX) {
      return selectedListId;
    }

    const fallbackListId = Number(View.castleHeroLastActiveList) || 0;
    if (fallbackListId < 1 || fallbackListId > View.CASTLE_HERO_LISTS_MAX) {
      return 0;
    }

    if (Array.isArray(heroes) && heroes.length) {
      const mask = 1 << (fallbackListId - 1);
      const hasHeroesInList = heroes.some((hero) => (View.getCastleHeroFavouriteMask(hero) & mask) !== 0);
      if (!hasHeroesInList) return 0;
    }

    return fallbackListId;
  }

  static cleanupCastleHeroPhantomList() {
    if (!View.castleHeroPhantomList) return;
    const hasHeroes = (View.castleHeroAll || []).some((hero) => View.isCastleHeroInList(hero, View.castleHeroPhantomList));
    if (hasHeroes) {
      View.castleHeroPhantomList = 0;
      return;
    }
    if (View.castleHeroSelectedList === View.castleHeroPhantomList) {
      View.castleHeroSelectedList = 0;
    }
    View.castleHeroPhantomList = 0;
    View.castleHeroListEditMode = '';
    View.castleHeroEditSelection = new Set();
  }

  static async updateCastleHeroListBackend(action, listId, heroIds = []) {
    try {
      await App.api.request('build', 'favouriteSet', {
        action,
        list: listId,
        heroes: heroIds,
      });
    } catch (error) {
      App.error(error);
    }
  }

  static patchCastleHeroListLocal(action, listId, heroIds = []) {
    const bit = 1 << (listId - 1);
    const heroIdSet = new Set((heroIds || []).map((id) => Number(id)));
    for (const hero of View.castleHeroAll || []) {
      const heroId = Number(hero?.id);
      if (action === 'clear' || heroIdSet.has(heroId)) {
        let mask = View.getCastleHeroFavouriteMask(hero);
        if (action === 'add') mask = mask | bit;
        else mask = mask & (255 ^ bit);
        hero.favourite = mask;
      }
    }
  }

  static getCastleListButtonLabel(listId) {
    return listId === 0 ? '' : String(listId);
  }

  static loadCastleHeroListNames() {
    try {
      const raw = localStorage.getItem(View.CASTLE_HERO_LIST_NAMES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const names = {};
      for (let i = 1; i <= View.CASTLE_HERO_LISTS_MAX; i++) {
        const value = String(parsed?.[i] || '').trim();
        if (value) names[i] = value;
      }
      View.castleHeroListNames = names;
    } catch {
      View.castleHeroListNames = {};
    }
  }

  static persistCastleHeroListNames() {
    try {
      localStorage.setItem(View.CASTLE_HERO_LIST_NAMES_STORAGE_KEY, JSON.stringify(View.castleHeroListNames || {}));
    } catch {}
  }

  static getCastleHeroListName(listId) {
    const id = Number(listId) || 0;
    const custom = String(View.castleHeroListNames?.[id] || '').trim();
    return custom || Lang.text('heroListDefaultName').replace('{id}', id);
  }

  static setCastleHeroListName(listId, value) {
    const id = Number(listId) || 0;
    if (id < 1 || id > View.CASTLE_HERO_LISTS_MAX) return;
    const name = String(value || '')
      .trim()
      .slice(0, 32);
    if (name) View.castleHeroListNames[id] = name;
    else delete View.castleHeroListNames[id];
    View.persistCastleHeroListNames();
  }

  static openCastleHeroListRenameDialog(listId) {
    const id = Number(listId) || 0;
    if (id < 1 || id > View.CASTLE_HERO_LISTS_MAX) return;
    const close = DOM({
      tag: 'div',
      domaudio: domAudioPresets.closeButton,
      style: 'close-button',
      event: ['click', () => Splash.hide()],
    });
    close.style.backgroundImage = 'url(content/icons/close-cropped.svg)';
    const template = document.createDocumentFragment();
    const modal = DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, Lang.text('assembly')));
    const name = DOM({
      id: 'build-create-input',
      domaudio: domAudioPresets.defaultInput,
      tag: 'input',
      placeholder: Lang.text('buildNamePlaceholder'),
      value: String(View.castleHeroListNames?.[id] || ''),
    });
    const button = DOM(
      {
        style: 'splash-content-button-modal',
        domaudio: domAudioPresets.bigButton,
        event: [
          'click',
          () => {
            View.setCastleHeroListName(id, name.value);
            Splash.hide();
            View.renderCastleHeroesFromCache();
          },
        ],
      },
      Lang.text('renameBuild'),
    );
    template.append(modal, name, button, close);
    Splash.show(template);
    setTimeout(() => name.focus(), 0);
  }

  static renderCastleHeroListsToolbar() {
    const bar = View.castleHeroListsBar;
    if (!bar) return;
    bar.classList.remove('castle-friend-lists-bar', 'castle-building-types-bar');
    bar.replaceChildren();

    const createdCount = View.getCastleCreatedHeroListCount();
    const visibleCount = Math.max(createdCount, View.castleHeroPhantomList || 0);

    const allBtn = DOM(
      {
        style: [
          'castle-hero-list-btn',
          'castle-hero-list-btn-all',
          View.castleHeroSelectedList === 0 ? 'castle-hero-list-btn-active' : null,
        ].filter(Boolean),
        domaudio: domAudioPresets.defaultButton,
        title: Lang.text('titleheroes'),
        event: [
          'click',
          () => {
            View.castleHeroSelectedList = 0;
            View.castleHeroListEditMode = '';
            View.castleHeroEditSelection = new Set();
            View.castleHeroDeleteConfirmListId = 0;
            View.cleanupCastleHeroPhantomList();
            View.persistCastleHeroSelectedList();
            View.renderCastleHeroesFromCache();
          },
        ],
      },
      View.getCastleListButtonLabel(0),
    );
    bar.append(allBtn);

    for (let i = 1; i <= View.CASTLE_HERO_LISTS_MAX; i++) {
      if (i > visibleCount) continue;
      const isActive = View.castleHeroSelectedList === i;
      const isPhantom = View.castleHeroPhantomList === i;
      const btn = DOM(
        {
          style: [
            'castle-hero-list-btn',
            isActive ? 'castle-hero-list-btn-active' : null,
            isPhantom ? 'castle-hero-list-btn-phantom' : null,
          ].filter(Boolean),
          domaudio: domAudioPresets.defaultButton,
          title: View.getCastleHeroListName(i),
          event: [
            'click',
            () => {
              if (!isPhantom) {
                View.cleanupCastleHeroPhantomList();
              }
              View.castleHeroSelectedList = i;
              View.rememberCastleHeroLastActiveList(i);
              if (isPhantom && !View.castleHeroListEditMode) View.castleHeroListEditMode = 'add';
              View.castleHeroEditSelection = new Set();
              View.castleHeroDeleteConfirmListId = 0;
              View.persistCastleHeroSelectedList();
              View.renderCastleHeroesFromCache();
            },
          ],
        },
        View.getCastleListButtonLabel(i),
      );
      bar.append(btn);
    }

    if (visibleCount < View.CASTLE_HERO_LISTS_MAX) {
      const addBtn = DOM(
        {
          style: ['castle-hero-list-btn', 'castle-hero-list-btn-add'],
          domaudio: domAudioPresets.defaultButton,
          data: { tooltip: Lang.text('heroListCreate') },
          event: [
            'click',
            () => {
              if (View.castleHeroPhantomList) {
                View.castleHeroSelectedList = View.castleHeroPhantomList;
              } else {
                View.castleHeroPhantomList = visibleCount + 1;
                View.castleHeroSelectedList = View.castleHeroPhantomList;
              }
              View.castleHeroListEditMode = 'add';
              View.castleHeroEditSelection = new Set();
              View.castleHeroDeleteConfirmListId = 0;
              View.persistCastleHeroSelectedList();
              View.renderCastleHeroesFromCache();
            },
          ],
        },
        '',
      );
      bar.append(addBtn);
    }

    const searchWrap = DOM({
      style: [
        'castle-hero-list-search-wrap',
        'castle-roster-list-search-wrap',
        View.castleHeroSearch ? 'castle-hero-list-search-wrap-has-value' : null,
      ].filter(Boolean),
    });

    const search = DOM({
      tag: 'input',
      style: 'castle-hero-list-search',
      placeholder: Lang.text('castleHeroFilterPlaceholder'),
      value: View.castleHeroSearch || '',
      event: [
        'input',
        (event) => {
          View.castleHeroSearch = String(event?.target?.value || '');
          if (View.castleHeroSearch) {
            searchWrap.classList.add('castle-hero-list-search-wrap-has-value');
          } else {
            searchWrap.classList.remove('castle-hero-list-search-wrap-has-value');
          }
          /* Не пересобирать toolbar: replaceChildren() снимает фокус с input */
          View.renderCastleHeroesFromCache({ refreshToolbar: false });
        },
      ],
    });
    const clearSearchBtn = DOM(
      {
        tag: 'button',
        type: 'button',
        style: 'castle-hero-list-search-clear',
        domaudio: domAudioPresets.defaultButton,
        event: [
          'click',
          () => {
            if (!search.value) return;
            search.value = '';
            View.castleHeroSearch = '';
            searchWrap.classList.remove('castle-hero-list-search-wrap-has-value');
            search.focus();
            View.renderCastleHeroesFromCache({ refreshToolbar: false });
          },
        ],
      },
      '×',
    );
    searchWrap.append(search, clearSearchBtn);
    bar.append(searchWrap);
  }

  static buildCastleHeroListEditorCard(listId) {
    const mode = View.castleHeroListEditMode || '';
    const listName = View.getCastleHeroListName(listId);
    const modeClass =
      mode === 'add'
        ? 'castle-hero-list-editor-mode-add'
        : mode === 'remove'
          ? 'castle-hero-list-editor-mode-remove'
          : 'castle-hero-list-editor-mode-idle';
    const titleText =
      mode === 'add'
        ? Lang.text('heroListAddTitle').replace('{name}', listName)
        : mode === 'remove'
          ? Lang.text('heroListRemoveTitle').replace('{name}', listName)
          : listName;
    const titleContent =
      mode === 'add'
        ? DOM(
            { style: ['castle-hero-list-editor-title', 'castle-hero-list-editor-title-add'] },
            DOM({ tag: 'span' }, Lang.text('heroListAddPrefix')),
            DOM({ tag: 'span' }, listName),
          )
        : DOM({ style: 'castle-hero-list-editor-title' }, titleText);
    const totalHeroes = (View.castleHeroAll || []).length;
    let heroesInList = 0;
    for (const hero of View.castleHeroAll || []) {
      if (View.isCastleHeroInList(hero, listId)) heroesInList++;
    }
    const canAddToList = totalHeroes > 0 && heroesInList < totalHeroes;
    const canRemoveFromList = heroesInList > 0;

    const topPlus = DOM(
      {
        style: [
          'castle-hero-list-editor-sign',
          'castle-hero-list-editor-sign-add',
          canAddToList ? null : 'castle-hero-list-editor-sign-disabled',
        ].filter(Boolean),
        domaudio: domAudioPresets.defaultButton,
        data: { tooltip: Lang.text('listAdd') },
        event: [
          'click',
          () => {
            if (!canAddToList) return;
            View.castleHeroListEditMode = 'add';
            View.castleHeroEditSelection = new Set();
            View.castleHeroDeleteConfirmListId = 0;
            View.renderCastleHeroesFromCache();
          },
        ],
      },
      '',
    );
    const bottomMinus = DOM(
      {
        style: [
          'castle-hero-list-editor-sign',
          'castle-hero-list-editor-sign-remove',
          canRemoveFromList ? null : 'castle-hero-list-editor-sign-disabled',
        ].filter(Boolean),
        domaudio: domAudioPresets.defaultButton,
        data: { tooltip: Lang.text('listRemove') },
        event: [
          'click',
          () => {
            if (!canRemoveFromList) return;
            View.castleHeroListEditMode = 'remove';
            View.castleHeroEditSelection = new Set();
            View.castleHeroDeleteConfirmListId = 0;
            View.renderCastleHeroesFromCache();
          },
        ],
      },
      '',
    );

    const confirm = DOM(
      {
        style: ['castle-hero-list-editor-confirm', 'castle-hero-list-editor-confirm-action'],
        domaudio: domAudioPresets.defaultButton,
        event: [
          'click',
          async () => {
            const selectedCount = View.castleHeroEditSelection?.size || 0;
            if (!selectedCount) return;
            const currentMode = View.castleHeroListEditMode || '';
            const action = currentMode === 'add' ? 'add' : 'remove';
            const heroIds = Array.from(View.castleHeroEditSelection || []);
            await View.updateCastleHeroListBackend(action, listId, heroIds);
            View.patchCastleHeroListLocal(action, listId, heroIds);
            View.castleHeroEditSelection = new Set();
            View.castleHeroListEditMode = '';
            View.castleHeroDeleteConfirmListId = 0;
            View.cleanupCastleHeroPhantomList();
            View.renderCastleHeroesFromCache();
          },
        ],
      },
      Lang.text('confirm'),
    );
    const clear = DOM(
      {
        style: ['castle-hero-list-editor-confirm', 'castle-hero-list-editor-delete-action'],
        domaudio: domAudioPresets.defaultButton,
        title: Lang.text('heroListDeleteTitle').replace('{id}', listId),
        event: [
          'click',
          async () => {
            if (View.castleHeroDeleteConfirmListId !== listId) {
              View.castleHeroDeleteConfirmListId = listId;
              View.renderCastleHeroesFromCache({ refreshToolbar: false });
              return;
            }
            await View.updateCastleHeroListBackend('clear', listId, []);
            View.patchCastleHeroListLocal('clear', listId, []);
            View.setCastleHeroListName(listId, '');
            View.castleHeroEditSelection = new Set();
            View.castleHeroListEditMode = '';
            View.castleHeroDeleteConfirmListId = 0;
            View.cleanupCastleHeroPhantomList();
            View.renderCastleHeroesFromCache();
          },
        ],
      },
      View.castleHeroDeleteConfirmListId === listId ? Lang.text('confirmAction') : Lang.text('heroListDelete'),
    );

    const middle = DOM(
      {
        style: 'castle-hero-list-editor-middle',
        event: [
          'click',
          (event) => {
            event.preventDefault();
            View.openCastleHeroListRenameDialog(listId);
          },
        ],
      },
      titleContent,
    );
    middle.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      View.openCastleHeroListRenameDialog(listId);
      return false;
    });

    return DOM(
      { style: ['castle-hero-item', 'castle-hero-list-editor-item', modeClass] },
      DOM({ style: 'castle-item-background' }),
      DOM({ style: 'castle-item-ornament' }),
      DOM({ style: 'castle-hero-list-editor-top' }, topPlus, bottomMinus),
      middle,
      DOM({ style: 'castle-hero-list-editor-bottom' }, confirm, clear),
    );
  }

  static renderCastleHeroesFromCache(options = {}) {
    if (!View.castleBottom) return;
    if (options.refreshToolbar !== false) {
      View.renderCastleHeroListsToolbar();
    }

    const selectedList = Number(View.castleHeroSelectedList) || 0;
    if (View.castleHeroPrevSelectedList !== selectedList) {
      View.castleHeroEditSelection = new Set();
      View.castleHeroDeleteConfirmListId = 0;
      View.castleHeroPrevSelectedList = selectedList;
    }
    const editMode = selectedList > 0 ? View.castleHeroListEditMode : '';
    const searchVariants = View.getLayoutAwareSearchVariants(View.castleHeroSearch);
    const hasSearch = searchVariants.length > 0;
    const preload = new PreloadImages(View.castleBottom);
    const pinnedEditorRoot = View.castleHeroPinnedEditor;
    let renderedHeroCount = 0;

    View.castleBottom.replaceChildren();
    pinnedEditorRoot?.replaceChildren?.();
    View.castleBottom.classList.toggle('castle-bottom-content-with-editor', selectedList > 0);

    if (selectedList > 0) {
      pinnedEditorRoot?.append(View.buildCastleHeroListEditorCard(selectedList));
    }

    for (let item of View.castleHeroAll || []) {
      const localizedNameRaw = String(Lang.heroName(item.id, item.skin) || item.name || `Hero ${item.id}`);
      const localizedName = localizedNameRaw.replace(/<[^>]*>/g, '').trim();
      const fallbackName = String(item?.name || '')
        .replace(/<[^>]*>/g, '')
        .trim();
      const customNames = getHeroSearchAliases(item.id)
        .map((name) =>
          String(name)
            .replace(/<[^>]*>/g, '')
            .trim(),
        )
        .filter(Boolean)
        .join(' ');
      const filterHaystack = `${localizedName} ${fallbackName} ${customNames}`.toLowerCase();
      const filterWords = View.splitSearchWords(filterHaystack);
      if (hasSearch && !searchVariants.some((variant) => View.isFuzzySearchVariantMatch(filterHaystack, filterWords, variant))) {
        continue;
      }

      if (selectedList > 0) {
        const inList = View.isCastleHeroInList(item, selectedList);
        if (!editMode && !inList) continue;
        if (editMode === 'add' && inList) continue;
        if (editMode === 'remove' && !inList) continue;
      }

      const heroName = DOM({ style: 'castle-hero-name' }, DOM({}, localizedName));
      if (localizedName.length > 10) {
        heroName.firstChild.classList.add('castle-name-autoscroll');
      }
      let heroNameBase = DOM({ style: ['castle-item-hero-name', 'hover-brightness'] }, heroName);
      let rank = Rank.createRankNode(item.rating, { stylePrefix: 'castle-hero-' });
      const hero = DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          id: `id${item.id}`,
          style: ['castle-hero-item', 'hover-brightness'],
        },
        DOM({ style: ['castle-item-background', 'hover-brightness'] }),
        DOM({ style: ['castle-hero-item-bg', 'hover-brightness'] }),
        DOM({ style: ['castle-hero-item-img', 'no-hover-brightness'] }),
        HeroFrame.createNode(item),
        DOM({ style: ['castle-item-ornament', 'hover-brightness'] }),
        rank,
        heroNameBase,
      );

      hero.dataset.heroId = String(item.id);
      hero.dataset.url = `content/hero/${item.id}/${item.skin ? item.skin : 1}.webp`;

      if (editMode) {
        const selected = View.castleHeroEditSelection.has(Number(item.id));
        const pick = DOM({ style: ['castle-hero-list-pick', selected ? 'castle-hero-list-pick-active' : null].filter(Boolean) }, '');
        hero.append(pick);
        hero.addEventListener('click', () => {
          const heroId = Number(item.id);
          const isSelected = View.castleHeroEditSelection.has(heroId);
          if (isSelected) View.castleHeroEditSelection.delete(heroId);
          else View.castleHeroEditSelection.add(heroId);
          pick.classList.toggle('castle-hero-list-pick-active', !isSelected);
        });
      } else {
        hero.addEventListener('click', async () => {
          View.setCastleOpenedBuildHero(item.id);
          await Window.show('main', 'build', item.id, 0, true);
          View.syncCastleOpenedBuildHeroGlow();
        });
      }

      preload.add(hero);
      renderedHeroCount++;
    }

    if (renderedHeroCount === 0) {
      const emptyText = hasSearch ? Lang.text('nothingFound') : Lang.text('listEmpty');
      View.castleBottom.append(
        DOM(
          { style: ['castle-hero-item', 'castle-hero-list-empty-item'] },
          DOM({ style: 'castle-item-background' }),
          DOM({ style: 'castle-item-ornament' }),
          DOM({ style: 'castle-hero-list-empty-label' }, emptyText),
        ),
      );
    }

    View.syncCastleOpenedBuildHeroGlow();
    View.updateArrows();
  }

  static loadCastleFriendSelectedList() {
    try {
      const value = Number(localStorage.getItem(View.CASTLE_FRIEND_LIST_STORAGE_KEY));
      if (Number.isFinite(value) && value >= 0 && value <= View.getCastleFriendListsMax()) {
        View.castleFriendSelectedList = value;
      }
    } catch {}
  }

  static persistCastleFriendSelectedList() {
    try {
      localStorage.setItem(View.CASTLE_FRIEND_LIST_STORAGE_KEY, String(View.castleFriendSelectedList || 0));
    } catch {}
  }

  static isCastleFriendInList(item, listId) {
    if (!Number.isFinite(listId) || listId < 1 || listId > 8) return false;
    const mask = Number(item?.favourite) || 0;
    return (mask & (1 << (listId - 1))) !== 0;
  }

  static patchCastleFriendListLocal(action, listId, friendIds = []) {
    const bit = 1 << (listId - 1);
    const ids = new Set((friendIds || []).map((id) => Number(id)));
    for (const item of View.castleFriendAll || []) {
      const id = Number(item?.id);
      if (action === 'clear' || ids.has(id)) {
        let mask = Number(item?.favourite) || 0;
        if (action === 'add') mask = mask | bit;
        else mask = mask & (255 ^ bit);
        item.favourite = mask;
      }
    }
  }

  static async updateCastleFriendListBackend(action, listId, friendIds = []) {
    try {
      await App.api.request('friend', 'favouriteSet', {
        action,
        list: listId,
        friends: friendIds,
      });
    } catch (error) {
      App.error(error);
    }
  }

  static renderCastleFriendListsToolbar() {
    const bar = View.castleHeroListsBar;
    if (!bar) return;
    bar.replaceChildren();
    bar.classList.remove('castle-hero-lists-bar-hidden', 'castle-building-types-bar');
    bar.classList.add('castle-friend-lists-bar');

    const allBtn = DOM(
      {
        style: [
          'castle-hero-list-btn',
          'castle-hero-list-btn-all',
          'castle-friend-list-btn-all',
          View.castleFriendSelectedList === 0 ? 'castle-hero-list-btn-active' : null,
        ].filter(Boolean),
        domaudio: domAudioPresets.defaultButton,
        data: { tooltip: Lang.text('friendListAll') },
        event: [
          'click',
          () => {
            View.castleFriendSelectedList = 0;
            View.castleFriendListEditMode = '';
            View.castleFriendEditSelection = new Set();
            View.castleFriendClearConfirm = false;
            View.persistCastleFriendSelectedList();
            View.renderCastleFriendsFromCache();
          },
        ],
      },
      '',
    );
    bar.append(allBtn);

    const favBtn = DOM(
      {
        style: [
          'castle-hero-list-btn',
          'castle-friend-list-btn-fav',
          View.castleFriendSelectedList === 1 ? 'castle-hero-list-btn-active' : null,
        ].filter(Boolean),
        domaudio: domAudioPresets.defaultButton,
        data: { tooltip: Lang.text('friendListFavorites') },
        event: [
          'click',
          () => {
            View.castleFriendSelectedList = 1;
            View.castleFriendEditSelection = new Set();
            View.castleFriendClearConfirm = false;
            View.persistCastleFriendSelectedList();
            View.renderCastleFriendsFromCache();
          },
        ],
      },
      '',
    );
    bar.append(favBtn);

    if (App.isAdmin()) {
      const onlineBtn = DOM(
        {
          style: [
            'castle-hero-list-btn',
            'castle-friend-list-btn-online',
            View.castleFriendSelectedList === 2 ? 'castle-hero-list-btn-active' : null,
          ].filter(Boolean),
          domaudio: domAudioPresets.defaultButton,
          title: Lang.text('onlinePlayers'),
          event: [
            'click',
            () => {
              View.castleFriendSelectedList = 2;
              View.castleFriendListEditMode = '';
              View.castleFriendEditSelection = new Set();
              View.castleFriendClearConfirm = false;
              View.persistCastleFriendSelectedList();
              View.renderCastleFriendsFromCache();
            },
          ],
        },
        'ON',
      );
      bar.append(onlineBtn);
    }

    const searchWrap = DOM({
      style: [
        'castle-hero-list-search-wrap',
        'castle-roster-list-search-wrap',
        View.castleFriendSearch ? 'castle-hero-list-search-wrap-has-value' : null,
      ].filter(Boolean),
    });

    const search = DOM({
      tag: 'input',
      style: 'castle-hero-list-search',
      placeholder: Lang.text('friendNicknamePlaceholder'),
      value: View.castleFriendSearch || '',
      event: [
        'input',
        (event) => {
          View.castleFriendSearch = String(event?.target?.value || '');
          if (View.castleFriendSearch) {
            searchWrap.classList.add('castle-hero-list-search-wrap-has-value');
          } else {
            searchWrap.classList.remove('castle-hero-list-search-wrap-has-value');
          }
          View.renderCastleFriendsFromCache({ refreshToolbar: false });
        },
      ],
    });
    const clearSearchBtn = DOM(
      {
        tag: 'button',
        type: 'button',
        style: 'castle-hero-list-search-clear',
        domaudio: domAudioPresets.defaultButton,
        event: [
          'click',
          () => {
            if (!search.value) return;
            search.value = '';
            View.castleFriendSearch = '';
            searchWrap.classList.remove('castle-hero-list-search-wrap-has-value');
            search.focus();
            View.renderCastleFriendsFromCache({ refreshToolbar: false });
          },
        ],
      },
      '×',
    );
    searchWrap.append(search, clearSearchBtn);
    bar.append(searchWrap);
  }

  static buildCastleFriendListEditorCard() {
    const mode = View.castleFriendListEditMode || '';
    let friendsInList = 0;
    for (const f of View.castleFriendAll || []) {
      if (Number(f?.status) === 1 && View.isCastleFriendInList(f, 1)) friendsInList++;
    }
    const totalFriends = (View.castleFriendAll || []).filter((f) => Number(f?.status) === 1).length;
    const canAdd = totalFriends > 0 && friendsInList < totalFriends;
    const canRemove = friendsInList > 0;

    const topPlus = DOM(
      {
        style: [
          'castle-hero-list-editor-sign',
          'castle-hero-list-editor-sign-add',
          canAdd ? null : 'castle-hero-list-editor-sign-disabled',
        ].filter(Boolean),
        domaudio: domAudioPresets.defaultButton,
        data: { tooltip: Lang.text('listAdd') },
        event: [
          'click',
          () => {
            if (!canAdd) return;
            View.castleFriendListEditMode = 'add';
            View.castleFriendEditSelection = new Set();
            View.castleFriendClearConfirm = false;
            View.renderCastleFriendsFromCache({ refreshToolbar: false });
          },
        ],
      },
      '',
    );
    const bottomMinus = DOM(
      {
        style: [
          'castle-hero-list-editor-sign',
          'castle-hero-list-editor-sign-remove',
          canRemove ? null : 'castle-hero-list-editor-sign-disabled',
        ].filter(Boolean),
        domaudio: domAudioPresets.defaultButton,
        data: { tooltip: Lang.text('listRemove') },
        event: [
          'click',
          () => {
            if (!canRemove) return;
            View.castleFriendListEditMode = 'remove';
            View.castleFriendEditSelection = new Set();
            View.castleFriendClearConfirm = false;
            View.renderCastleFriendsFromCache({ refreshToolbar: false });
          },
        ],
      },
      '',
    );

    const confirm = DOM(
      {
        style: ['castle-hero-list-editor-confirm', 'castle-hero-list-editor-confirm-action'],
        domaudio: domAudioPresets.defaultButton,
        event: [
          'click',
          async () => {
            const selectedCount = View.castleFriendEditSelection?.size || 0;
            if (!selectedCount) return;
            const ids = Array.from(View.castleFriendEditSelection || []);
            const currentMode = View.castleFriendListEditMode || '';
            if (currentMode === 'add') {
              await View.updateCastleFriendListBackend('add', 1, ids);
              View.patchCastleFriendListLocal('add', 1, ids);
            } else {
              await View.updateCastleFriendListBackend('remove', 1, ids);
              View.patchCastleFriendListLocal('remove', 1, ids);
            }
            View.castleFriendEditSelection = new Set();
            View.castleFriendListEditMode = '';
            View.castleFriendClearConfirm = false;
            View.renderCastleFriendsFromCache({ refreshToolbar: false });
          },
        ],
      },
      Lang.text('confirm'),
    );

    const clear = DOM(
      {
        style: ['castle-hero-list-editor-confirm', 'castle-hero-list-editor-delete-action'],
        domaudio: domAudioPresets.defaultButton,
        event: [
          'click',
          async () => {
            if (!View.castleFriendClearConfirm) {
              View.castleFriendClearConfirm = true;
              View.renderCastleFriendsFromCache({ refreshToolbar: false });
              return;
            }
            await View.updateCastleFriendListBackend('clear', 1, []);
            View.patchCastleFriendListLocal('clear', 1, []);
            View.castleFriendEditSelection = new Set();
            View.castleFriendListEditMode = '';
            View.castleFriendClearConfirm = false;
            View.castleFriendSelectedList = 0;
            View.persistCastleFriendSelectedList();
            View.renderCastleFriendsFromCache({ refreshToolbar: false });
          },
        ],
      },
      View.castleFriendClearConfirm ? Lang.text('confirmAction') : Lang.text('friendListClear'),
    );

    const modeClass =
      mode === 'add'
        ? 'castle-hero-list-editor-mode-add'
        : mode === 'remove'
          ? 'castle-hero-list-editor-mode-remove'
          : 'castle-hero-list-editor-mode-idle';
    const titleText =
      mode === 'add' ? Lang.text('friendListAddTitle') : mode === 'remove' ? Lang.text('friendListRemoveTitle') : Lang.text('friendListFavoritesTitle');

    return DOM(
      { style: ['castle-hero-item', 'castle-hero-list-editor-item', modeClass] },
      DOM({ style: 'castle-item-background' }),
      DOM({ style: 'castle-item-ornament' }),
      DOM({ style: 'castle-hero-list-editor-top' }, topPlus, bottomMinus),
      DOM({ style: 'castle-hero-list-editor-middle' }, DOM({}, titleText)),
      DOM({ style: 'castle-hero-list-editor-bottom' }, confirm, clear),
    );
  }

  static renderCastleFriendsFromCache(options = {}) {
    if (!View.castleBottom) return;
    if (options.refreshToolbar !== false) {
      View.renderCastleFriendListsToolbar();
    }

    const selectedList = Number(View.castleFriendSelectedList) || 0;
    const favListSelected = selectedList === 1;
    const onlineListSelected = selectedList === 2;
    const editMode = favListSelected ? View.castleFriendListEditMode : '';
    const searchVariants = View.getLayoutAwareSearchVariants(View.castleFriendSearch);
    const hasSearch = searchVariants.length > 0;
    const pinnedEditorRoot = View.castleHeroPinnedEditor;
    const preload = new PreloadImages(View.castleBottom);

    View.castleBottom.replaceChildren();
    pinnedEditorRoot?.replaceChildren?.();
    View.castleBottom.classList.toggle('castle-bottom-content-with-editor', favListSelected);
    if (favListSelected) {
      pinnedEditorRoot?.append(View.buildCastleFriendListEditorCard());
    }

    const modal = DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, Lang.text('searchForFriends')));
    const buttonAdd = DOM(
      {
        style: ['castle-friend-item', 'castle-friend-add-card'],
        onclick: () => {
          let input = DOM({
            tag: 'input',
            domaudio: domAudioPresets.defaultInput,
            style: 'search-input',
            id: 'search-friend-window-input',
            placeholder: Lang.text('friendNicknamePlaceholder'),
          });
          let body = DOM({ style: 'search-body' });
          let closeButton = DOM({
            tag: 'div',
            domaudio: domAudioPresets.closeButton,
            style: 'close-button',
            event: ['click', () => Splash.hide()],
          });
          closeButton.style.backgroundImage = 'url(content/icons/close-cropped.svg)';
          let search = DOM({ style: 'search' }, modal, input, body, closeButton);
          const inviteFromFavList = (Number(View.castleFriendSelectedList) || 0) === 1;
          input.addEventListener('input', async () => {
            const request = await App.api.request('user', 'find', { nickname: input.value });
            while (body.firstChild) body.firstChild.remove();
            for (const found of request || []) {
              const openAdminFoundUserModal = () => {
                let adminBody = document.createDocumentFragment();
                adminBody.append(
                  DOM({}, found.nickname),
                  DOM(
                    {
                      domaudio: domAudioPresets.bigButton,
                      style: 'splash-content-button',
                      event: [
                        'click',
                        async () => {
                          await App.api.request('user', 'blocked', { id: found.id });
                          Splash.hide();
                        },
                      ],
                    },
                    found.blocked ? 'Разблокировать' : 'Заблокировать',
                  ),
                  DOM(
                    {
                      domaudio: domAudioPresets.bigButton,
                      style: 'splash-content-button',
                      event: [
                        'click',
                        async () => {
                          await App.api.request('user', 'mute', { id: found.id });
                          Splash.hide();
                        },
                      ],
                    },
                    found.mute ? 'Убрать мут' : 'Мут чата',
                  ),
                  DOM(
                    {
                      domaudio: domAudioPresets.bigButton,
                      style: 'splash-content-button',
                      event: [
                        'click',
                        async () => {
                          let password = await App.api.request('user', 'restore', { id: found.id });
                          App.notify(`Скопировано в буфер обмена! Пароль: ${password}`);
                          navigator.clipboard.writeText(password);
                        },
                      ],
                    },
                    'Сброс пароля',
                  ),
                  DOM(
                    {
                      domaudio: domAudioPresets.closeButton,
                      style: 'splash-content-button',
                      event: ['click', () => Splash.hide()],
                    },
                    Lang.text('cancel'),
                  ),
                );
                Splash.show(adminBody);
              };

              const template = DOM(
                {
                  domaudio: domAudioPresets.defaultButton,
                  event: [
                    'click',
                    async () => {
                      await App.api.request('friend', 'request', { id: found.id, fromFav: inviteFromFavList ? 1 : 0 });
                      if (inviteFromFavList) {
                        View.patchCastleFriendListLocal('add', 1, [found.id]);
                        await View.updateCastleFriendListBackend('add', 1, [found.id]);
                      }
                      App.notify(Lang.text('friendRequestSent').replace('{name}', found.nickname), 1000);
                      Splash.hide();
                      View.bodyCastleFriends();
                    },
                  ],
                },
                found.nickname,
              );

              if (App.isAdmin() && 'blocked' in found) {
                template.addEventListener('contextmenu', (event) => {
                  event.preventDefault();
                  openAdminFoundUserModal();
                  return false;
                });
                if (found.mute) template.style.color = 'yellow';
                if (found.blocked) template.style.color = 'red';
              }

              body.append(template);
            }
          });
          Splash.show(search, false);
          input.focus();
        },
      },
      DOM(
        { style: 'castle-friend-item-middle' },
        DOM(
          { style: 'castle-item-hero-name' },
          DOM({ style: ['castle-hero-name', 'add-to-friend-text'] }, DOM({ tag: 'span' }, Lang.text('addFriend'))),
        ),
        DOM({ src: 'content/hero/addFriend.png', style: 'addToFriendIcon', tag: 'img' }),
        DOM({ style: ['castle-item-ornament', 'hover-brightness'] }),
        DOM(
          { style: 'castle-friend-item-bottom' },
          DOM({ style: ['castle-friend-add-group', 'add-to-friend-button'] }, Lang.text('inviteToAFriend')),
        ),
      ),
    );
    buttonAdd.dataset.tooltip = Lang.text('addFriend');
    if (!onlineListSelected) {
      buttonAdd.dataset.url = `content/hero/empty.png`;
      preload.add(buttonAdd);
      View.castleBottom.append(buttonAdd);
    }

    const friendRelationById = onlineListSelected
      ? new Map((View.castleFriendAll || []).map((friendItem) => [Number(friendItem?.id || 0), friendItem]))
      : null;
    const sortedFriends = onlineListSelected ? View.getSortedOnlinePlayers(friendRelationById) : View.getSortedCastleFriends();
    for (let item of sortedFriends) {
      const relationItem = friendRelationById?.get(Number(item?.id || 0));
      if (relationItem) {
        item = {
          ...item,
          status: Number(relationItem?.status || 0),
          favourite: Number(relationItem?.favourite || 0),
        };
      }
      const status = Number(item?.status);
      const nickname = String(item?.nickname || '');
      const nicknameLower = nickname.toLowerCase();
      const nicknameWords = View.splitSearchWords(nicknameLower);
      if (hasSearch && !searchVariants.some((variant) => View.isFuzzySearchVariantMatch(nicknameLower, nicknameWords, variant))) continue;
      if (favListSelected) {
        const inFavList = View.isCastleFriendInList(item, 1);
        if (editMode) {
          if (status !== 1) continue;
          if (editMode === 'add' && inFavList) continue;
          if (editMode === 'remove' && !inFavList) continue;
        } else {
          if (!inFavList) continue;
        }
      }

      const heroName = DOM({ style: 'castle-hero-name' }, DOM({ tag: 'span' }, nickname));
      if (nickname.length > 10) heroName.firstChild.classList.add('castle-name-autoscroll');
      let heroNameBase = DOM({ style: 'castle-item-hero-name' }, heroName);
      let bottom = DOM({ style: 'castle-friend-item-bottom' });
      let friend = DOM({ style: 'castle-friend-item' }, DOM({ style: ['castle-item-ornament', 'hover-brightness'] }), heroNameBase, bottom);
      friend.dataset.friendId = String(Number(item?.id || 0));

      if (editMode && status === 1) {
        const selected = View.castleFriendEditSelection.has(Number(item.id));
        const pick = DOM({ style: ['castle-hero-list-pick', selected ? 'castle-hero-list-pick-active' : null].filter(Boolean) });
        friend.append(pick);
        friend.addEventListener('click', () => {
          const id = Number(item.id);
          const isSelected = View.castleFriendEditSelection.has(id);
          if (isSelected) View.castleFriendEditSelection.delete(id);
          else View.castleFriendEditSelection.add(id);
          pick.classList.toggle('castle-hero-list-pick-active', !isSelected);
        });
      } else {
        // Keep existing friend actions in non-edit mode (copied minimal core behavior).
        if (status == 1) {
          const presenceState = View.normalizeFriendPresenceState(item);
          const friendInParty = presenceState === 'online' && Number(item?.inParty) === 1;
          const groupEnabled = View.isFriendGroupInviteEnabled(item);
          const callEnabled = View.isFriendCallEnabled(item);
          const isOffline = presenceState === 'offline';
          const isTambour = presenceState === 'tambour';
          const groupText = friendInParty
            ? Lang.text('friendInGroup')
            : groupEnabled
              ? Lang.text('inviteToAGroup')
              : View.getFriendPresenceLabel(presenceState);
          const modeId = Number(item?.mode);
          const canShowModeOnHover =
            !groupEnabled &&
            !friendInParty &&
            Number.isFinite(modeId) &&
            modeId >= 0 &&
            (presenceState === 'battle' || presenceState === 'queue' || presenceState === 'tambour');
          const modeText = canShowModeOnHover ? Lang.text(`gm${modeId + 1}`) : '';
          let group = DOM(
            {
              style: [
                'castle-friend-add-group',
                isOffline ? 'castle-friend-add-group-offline' : null,
                isTambour ? 'castle-friend-add-group-tambour' : null,
              ].filter(Boolean),
            },
            groupText,
          );
          let call = DOM(
            { style: ['castle-friend-add-group', isOffline ? 'castle-friend-add-group-offline' : null].filter(Boolean) },
            Lang.text('callAFriend'),
          );
          const presenceFilter = View.getFriendPresenceFilter(presenceState);
          if (!groupEnabled || friendInParty) {
            group.style.filter = isOffline || isTambour ? '' : (presenceFilter || 'grayscale(0.8)');
          }
          if (!callEnabled) {
            call.style.filter = isOffline ? '' : 'grayscale(0.8)';
          }
          if (groupEnabled && !friendInParty) {
            group.onclick = View.createFriendGroupAction(item);
          }
          if (callEnabled) {
            call.onclick = View.createFriendCallAction(item);
          }
          if (canShowModeOnHover) {
            group.onmouseenter = () => {
              group.textContent = modeText;
            };
            group.onmouseleave = () => {
              group.textContent = groupText;
            };
          }
          friend.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            let body = document.createDocumentFragment();
            const modal = DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, Lang.text('friends')));
            let removeButton = DOM(
              {
                domaudio: domAudioPresets.smallButton,
                style: ['splash-content-button', 'splash-nickname-sized-button', 'friend-action-button'],
                event: [
                  'click',
                  async () => {
                    await App.api.request('friend', 'remove', {
                      id: item.id,
                    });
                    friend.remove();
                    Splash.hide();
                  },
                ],
              },
              Lang.text('friendRemovePlayer'),
            );
            let profileButton = DOM(
              {
                domaudio: domAudioPresets.smallButton,
                style: ['splash-content-button', 'splash-nickname-sized-button', 'friend-action-button'],
                event: [
                  'click',
                  () => {
                    Splash.hide();
                    App.openStatsProfile({ id: item.id, login: item.nickname });
                  },
                ],
              },
              Lang.text('showStatistics'),
            );
            let cancelButton = DOM(
              {
                domaudio: domAudioPresets.closeButton,
                style: ['splash-content-button', 'splash-content-button-red', 'splash-nickname-sized-button', 'friend-action-button'],
                event: ['click', () => Splash.hide()],
              },
              Lang.text('friendClose'),
            );
            const nicknameLine = DOM(
              { id: 'friendRemoveText', style: 'friend-menu-nickname' },
              DOM({ tag: 'span' }, String(item.nickname || '')),
            );
            nicknameLine.tabIndex = 0;
            const updateNicknameOverflow = () => {
              const overflow = Math.max(0, nicknameLine.firstChild.offsetWidth - nicknameLine.clientWidth);
              nicknameLine.style.setProperty('--nickname-scroll-distance', `${overflow}px`);
              nicknameLine.classList.toggle('friend-menu-nickname--overflowing', overflow > 1);
            };
            nicknameLine.addEventListener('mouseenter', updateNicknameOverflow);
            nicknameLine.addEventListener('focus', updateNicknameOverflow);
            body.append(
              DOM({ style: 'splash-modal-scope-friend-action' }),
              modal,
              nicknameLine,
              profileButton,
              removeButton,
              cancelButton,
            );
            Splash.show(body);
            requestAnimationFrame(updateNicknameOverflow);
            return false;
          });
          bottom.append(call, group);
        } else if (status == 2) {
          bottom.append(
            DOM(
              {
                domaudio: domAudioPresets.smallButton,
                style: 'castle-friend-confirm',
                event: [
                  'click',
                  async () => {
                    await App.api.request('friend', 'accept', { id: item.id });
                    View.bodyCastleFriends();
                  },
                ],
              },
              Lang.text('friendAccept'),
            ),
            DOM(
              {
                domaudio: domAudioPresets.smallButton,
                style: 'castle-friend-cancel',
                event: [
                  'click',
                  async () => {
                    await App.api.request('friend', 'remove', { id: item.id });
                    View.bodyCastleFriends();
                  },
                ],
              },
              Lang.text('friendDecline'),
            ),
          );
        } else if (status == 3) {
          friend.append(
            DOM({ style: 'castle-friend-item-middle' }, DOM({ style: 'castle-friend-request' }, Lang.text('friendAcceptWaiting'))),
          );
          friend.style.filter = 'grayscale(1)';
          bottom.append(
            DOM(
              {
                domaudio: domAudioPresets.smallButton,
                style: 'castle-friend-cancel',
                event: [
                  'click',
                  async () => {
                    await App.api.request('friend', 'remove', { id: item.id });
                    View.bodyCastleFriends();
                  },
                ],
              },
              Lang.text('cancel'),
            ),
          );
        } else if (status == 0 && onlineListSelected) {
          bottom.append(
            DOM(
              {
                domaudio: domAudioPresets.smallButton,
                style: 'castle-friend-add-group',
                event: [
                  'click',
                  async () => {
                    await App.api.request('friend', 'request', { id: item.id, fromFav: 0 });
                    App.notify(Lang.text('friendRequestSent').replace('{name}', item.nickname), 800);
                    View.bodyCastleFriends();
                  },
                ],
              },
              Lang.text('inviteToAFriend'),
            ),
          );
        }
      }

      if (status == 1 && View.normalizeFriendPresenceState(item) !== 'offline' && Number(item.mobile) == 1) {
        friend.append(DOM({ style: 'castle-friend-mobile-emoji' }, uiIcon('phone')));
      }
      if (!editMode) {
        View.syncFriendLastSeenBadge(friend, item);
      }

      friend.dataset.url = `content/hero/friendLogo.png`;
      preload.add(friend);
    }

    View.updateArrows();
  }

  static bodyCastleHeroes() {
    View.castleActiveTab = 'heroes';
    View.updateCastlePanelMenuActiveState();
    View.castleHeroDeleteConfirmListId = 0;
    View.castleFriendClearConfirm = false;
    View.castleHeroListsBar?.classList?.remove('castle-hero-lists-bar-hidden');
    View.loadCastleHeroSelectedList();
    View.loadCastleHeroListNames();
    if (View.castleHeroSelectedList === 0) View.castleHeroListEditMode = '';

    App.api.silent(
      (result) => {
        if (View.castleActiveTab !== 'heroes') return;
        MM.hero = Array.isArray(result) ? result : [];
        View.castleHeroAll = Array.isArray(result) ? result : [];
        View.cleanupCastleHeroPhantomList();
        const maxAllowed = Math.max(View.getCastleCreatedHeroListCount(), View.castleHeroPhantomList || 0);
        if (View.castleHeroSelectedList > maxAllowed && View.castleHeroSelectedList > 0) {
          View.castleHeroSelectedList = 0;
          View.castleHeroListEditMode = '';
          View.castleHeroEditSelection = new Set();
        }
        View.persistCastleHeroSelectedList();
        View.renderCastleHeroesFromCache();
      },
      'build',
      'heroAll',
    );
  }

  static bodyCastleFriends() {
    View.castleActiveTab = 'friends';
    View.updateCastlePanelMenuActiveState();
    View.castleHeroDeleteConfirmListId = 0;
    View.castleFriendClearConfirm = false;
    View.cleanupCastleHeroPhantomList();
    View.castleHeroListsBar?.classList?.remove('castle-hero-lists-bar-hidden');
    View.castleHeroPinnedEditor?.replaceChildren?.();
    View.loadCastleFriendSelectedList();
    View.castleOnlinePlayersAll = [];
    const maxList = View.getCastleFriendListsMax();
    if (View.castleFriendSelectedList > maxList) {
      View.castleFriendSelectedList = 0;
      View.persistCastleFriendSelectedList();
    }
    View.renderCastleFriendsFromCache();

    App.api.silent(
      (result) => {
        if (View.castleActiveTab !== 'friends') return;
        View.setFriendIncomingStatus(Array.isArray(result) && result.some((item) => Number(item?.status) == 2));
        View.castleFriendAll = Array.isArray(result) ? result : [];
        View.updateFriendsMenuOnlineCount();
        View.renderCastleFriendsFromCache();
      },
      'friend',
      'list',
    );

    if (App.isAdmin()) {
      App.api.silent(
        (result) => {
          if (View.castleActiveTab !== 'friends') return;
          View.castleOnlinePlayersAll = Array.isArray(result) ? result : [];
          if (View.castleFriendSelectedList === 2) {
            View.renderCastleFriendsFromCache();
          }
        },
        'friend',
        'onlineAll',
      );
    }
  }

  static exitOrLogout() {
    let logout = DOM(
      {
        domaudio: domAudioPresets.smallButton,
        event: [
          'click',
          async () => {
            App.exit();

            Splash.hide();
          },
        ],
      },
      Lang.text('logoutAccount'),
    );

    let close = DOM({ domaudio: domAudioPresets.closeButton, event: ['click', () => Splash.hide()] }, Lang.text('cancel'));

    let wrap = DOM({ style: 'wrap' }, logout, close);

    if (NativeAPI.status) {
      let exit = DOM({ domaudio: domAudioPresets.closeButton, event: ['click', () => NativeAPI.exit()] }, Lang.text('exit'));

      wrap = DOM({ style: 'wrap' }, logout, exit, close);
    }

    let dom = DOM({ style: 'div' }, '', wrap);

    Splash.show(dom);
  }

  static header() {
    let play = MM.play();

    play.classList.add('main-header-item');

    play.classList.add('button-play');

    play.classList.remove('castle-button-play');

    let playButton = DOM({ style: 'menu-button-play' }, play);

    let menu = DOM(
      { style: 'main-header' },
      DOM({
        domaudio: domAudioPresets.defaultButton,
        tag: 'img',
        src: 'content/img/logo.webp',
        event: ['click', () => View.show('castle')],
      }),
      playButton,
    );

    if (App.isAdmin()) {
      let adm = DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          style: 'main-header-item',
          event: [
            'click',
            () => {
              let body = document.createDocumentFragment();

              body.append(
                DOM(
                  {
                    domaudio: domAudioPresets.bigButton,
                    style: 'splash-content-button',
                    event: [
                      'click',
                      () => {
                        View.show('talents');

                        Splash.hide();
                      },
                    ],
                  },
                  'Таланты (обычные)',
                ),
                DOM(
                  {
                    domaudio: domAudioPresets.bigButton,
                    style: 'splash-content-button',
                    event: [
                      'click',
                      () => {
                        View.show('talents2');

                        Splash.hide();
                      },
                    ],
                  },
                  'Таланты (классовые)',
                ),
                DOM(
                  {
                    domaudio: domAudioPresets.closeButton,
                    style: 'splash-content-button',
                    event: ['click', () => Splash.hide()],
                  },
                  '[X]',
                ),
              );

              Splash.show(body);
            },
          ],
        },
        'Админ',
      );

      adm.classList.add('animation1');

      adm.style.color = 'rgba(255,255,255,1)';

      menu.append(adm);
    }

    menu.append(
      DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          style: 'main-header-item',
          event: ['click', () => View.show('castle')],
        },
        Castle.gl ? Lang.text('castle') : Lang.text('lobby'),
      ),
      DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          style: 'main-header-item',
          event: ['click', () => View.show('builds')],
        },
        Lang.text('builds'),
      ),
      /*DOM({ style: 'main-header-item', event: ['click', () => View.show('history')] }, 'История'),*/
      DOM({ domaudio: domAudioPresets.defaultButton, style: 'main-header-item', event: ['click', () => View.show('top')] }, Lang.text('rating')),
      DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          style: 'main-header-item',
          event: ['click', () => View.show('game')],
        },
        Lang.text('farm'),
      ),
      DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          style: 'main-header-item',
          event: ['click', () => View.exitOrLogout()],
        },
        Lang.text('logoutShort'),
      ),
    );

    return menu;
  }

  /*
    static async history(isWindow) {

        let body = DOM({ style: 'main' }), history = DOM({ style: isWindow ? 'whistory' : 'history' });

        let result = await App.api.request(App.CURRENT_MM, 'history');

        for (let item of result) {

            let hero = DOM();

            hero.style.backgroundImage = `url(content/hero/${item.hero}/${item.skin ? item.skin : 1}.webp)`;

            let game = DOM({ style: 'history-item' }, hero, DOM({ style: 'history-text-box', tag: 'div' }, (item.team == 1) ? Lang.text('factionDoctsShort') : Lang.text('factionAdorniaShort')), DOM({ style: 'history-text-box', tag: 'div' }, Math.round(((item.team == item.win) ? +item.rating : -item.rating) * 10.0) / 10.0), DOM({ style: 'history-text-box', tag: 'div' }, new Date(item.added).toLocaleString()));

            if (item.team == item.win) {

                game.style.background = 'rgba(51,255,51,0.5)';

            }

            history.append(game);

        }

        if (!isWindow) {
            body.append(View.header());
        }
        body.append(history);

        return body;

    }
    */
  static async top(hero = 0, isSplah = false, mode = 0) {
    const TOP_MODE_TABS = [
      { id: 0, labelKey: 'gm1' },
      { id: 1, labelKey: 'gm2' },
      { id: 2, labelKey: 'gm3' },
      { id: 3, labelKey: 'gm4' },
    ];
    const HERO_STATS_TAB_ID = 6;
    // «Звёзды славы»: топ по звёздам, что видны у ника в чате (user.star, API user.stars)
    const STARS_TAB_ID = 7;
    const STARS_PAGE_SIZE = 25;
    const STARS_MAX_PAGES = 4;

    const heroId = hero == null || hero === '' ? 0 : Number(hero) || 0;
    let activeMode = mode == null || mode === '' ? 0 : Number(mode);
    if (!Number.isFinite(activeMode) || activeMode < 0) {
      activeMode = 0;
    }
    if (activeMode === 4 || activeMode === 5) {
      activeMode = 0;
    }
    const isHeroStatsView = activeMode === HERO_STATS_TAB_ID;
    const isStarsView = activeMode === STARS_TAB_ID;
    if (!isHeroStatsView && !isStarsView && activeMode > 3) {
      activeMode = 0;
    }

    let body = DOM({ style: 'main' });

    let heroStatsPayload = { week: [], month: [], allTime: [] };

    const heroNameById = (id) => {
      const localizedName = Lang.heroName(Number(id), 1);
      if (localizedName && localizedName !== `hero_${Number(id)}_name`) {
        return localizedName;
      }
      const row = MM.hero && MM.hero.find((h) => Number(h.id) === Number(id));
      return row && row.name ? row.name : '';
    };

    const makeCrownForRank = (rankNum, variant) => {
      if (rankNum < 1 || rankNum > 3) {
        return [];
      }
      const src = rankNum === 1 ? 'content/icons/crown_5.png' : rankNum === 2 ? 'content/icons/crown_3.png' : 'content/icons/crown_2.png';
      const style = variant === 'podium' ? ['wtop-crown', 'wtop-crown--podium'] : ['wtop-crown', 'wtop-crown--row'];
      return [
        DOM({
          tag: 'img',
          src,
          alt: '',
          style,
          draggable: false,
        }),
      ];
    };

    const makePodiumCard = (player, rankNum) => {
      const rank = DOM({ style: 'top-item-hero-rank' });
      rank.style.backgroundImage = `url(content/ranks/${Rank.icon(player.rating)}.webp)`;
      const heroFace = DOM({ style: 'top-item-hero' }, rank);
      heroFace.style.backgroundImage = `url(content/hero/${player.hero}/${player.skin ? player.skin : 1}.webp)`;
      const heroBlock = DOM({ style: 'wtop-podium-hero-wrap' }, heroFace);
      const crownSlot = DOM({ style: 'wtop-podium-crown-slot' }, ...makeCrownForRank(rankNum, 'podium'));
      const playerBlock = DOM(
        { style: 'wtop-podium-player' },
        DOM({ style: 'wtop-podium-name-line' }, `#${rankNum}. ${player.nickname}`),
        DOM(`${player.rating}`),
      );
      const middle = DOM({ style: 'wtop-podium-card-body' }, playerBlock, crownSlot);
      return DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          style: ['top-item', 'wtop-podium-card', `wtop-podium-card--${rankNum}`],
          event: ['click', () => Build.view(player.id, player.hero, player.nickname)],
        },
        heroBlock,
        middle,
      );
    };

    const makeTableRow = (player, rankNum) => {
      const hName = player.hero ? heroNameById(player.hero) : '';
      const placeCell = DOM({ style: ['wtop-cell', 'wtop-cell--place'] }, String(rankNum));
      const nameCellStyle = ['wtop-cell', 'wtop-cell--name'];
      if (rankNum <= 3) {
        nameCellStyle.push('wtop-cell--name-with-crown');
      }
      const nameCell = DOM(
        { style: nameCellStyle },
        DOM({ tag: 'span', style: 'wtop-cell-name-text' }, player.nickname || '—'),
        ...makeCrownForRank(rankNum, 'row'),
      );
      const heroIcon = DOM({ style: 'wtop-cell-hero-icon' });
      heroIcon.style.backgroundImage = player.hero
        ? `url(content/hero/${player.hero}/${player.skin ? player.skin : 1}.webp)`
        : 'url(content/hero/empty.webp)';
      const heroNameEl = DOM({ style: 'wtop-cell-hero-name' }, hName || '—');
      const heroCell = DOM({ style: ['wtop-cell', 'wtop-cell--hero'] }, heroIcon, heroNameEl);
      const ratingCell = isStarsView
        ? DOM(
          { style: ['wtop-cell', 'wtop-cell--rating', 'wtop-cell--stars'], data: { tooltip: Lang.text('titleStarsGlory') } },
          DOM({ tag: 'span' }, String(player.rating)),
          DOM({ tag: 'img', src: 'content/icons/starOrange.webp', alt: '', style: 'wtop-star-icon', draggable: false }),
        )
        : DOM({ style: ['wtop-cell', 'wtop-cell--rating'] }, String(player.rating));
      return DOM(
        {
          domaudio: domAudioPresets.defaultButton,
          style: 'wtop-table-row',
          // герой — последнего боя, за который дали звезду; без него билд открыть не на чем
          event: ['click', () => player.hero && Build.view(player.id, player.hero, player.nickname)],
        },
        placeCell,
        nameCell,
        heroCell,
        ratingCell,
      );
    };

    const heroStatsSortState = {
      key: 'battles',
      direction: 'desc',
    };
    const HERO_STATS_PERIODS = ['week', 'month', 'allTime'];
    let heroStatsPeriod = 'week';

    const heroStatsColumns = [
      { key: 'hero', labelKey: 'topColHero' },
      { key: 'battles', labelKey: 'topColBattles' },
      { key: 'wins', labelKey: 'topColWins' },
      { key: 'losses', labelKey: 'topColLosses' },
      { key: 'winrate', labelKey: 'topColWinrate' },
    ];
    const HERO_STATS_COLOR_RANGE = {
      battles: { min: '#d46a6a', max: '#62d27a' },
      wins: { min: '#d46a6a', max: '#62d27a' },
      losses: { min: '#d46a6a', max: '#62d27a' },
      winrate: { min: '#d46a6a', max: '#62d27a' },
    };
    const HERO_STATS_METRIC_KEYS = ['battles', 'wins', 'losses', 'winrate'];

    const hexToRgb = (hexColor) => {
      const hex = String(hexColor || '').replace('#', '');
      if (hex.length !== 6) return { r: 255, g: 255, b: 255 };
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
      };
    };

    const mixColor = (minColor, maxColor, ratio) => {
      const clamped = Math.max(0, Math.min(1, ratio));
      const minRgb = hexToRgb(minColor);
      const maxRgb = hexToRgb(maxColor);
      const r = Math.round(minRgb.r + (maxRgb.r - minRgb.r) * clamped);
      const g = Math.round(minRgb.g + (maxRgb.g - minRgb.g) * clamped);
      const b = Math.round(minRgb.b + (maxRgb.b - minRgb.b) * clamped);
      return `rgb(${r}, ${g}, ${b})`;
    };

    const buildMetricRanges = (rows) => {
      const ranges = {};
      for (const key of HERO_STATS_METRIC_KEYS) {
        let min = Infinity;
        let max = -Infinity;
        for (const item of rows) {
          const value = Number(item[key]) || 0;
          if (value < min) min = value;
          if (value > max) max = value;
        }
        ranges[key] = {
          min: Number.isFinite(min) ? min : 0,
          max: Number.isFinite(max) ? max : 0,
        };
      }
      return ranges;
    };

    const metricValueColor = (metricKey, value, metricRanges) => {
      const range = metricRanges[metricKey];
      if (!range) return '';
      const min = Number(range.min) || 0;
      const max = Number(range.max) || 0;
      const ratio = max === min ? 0.5 : (value - min) / (max - min);
      const palette = HERO_STATS_COLOR_RANGE[metricKey] || HERO_STATS_COLOR_RANGE.battles;
      return mixColor(palette.min, palette.max, ratio);
    };

    const makeHeroStatsRow = (item, metricRanges) => {
      const heroIcon = DOM({ style: 'wtop-cell-hero-icon' });
      heroIcon.style.backgroundImage = `url(content/hero/${item.hero}/1.webp)`;
      const heroCell = DOM(
        { style: ['wtop-cell', 'wtop-cell--hero', 'wtop-cell--hero-stats-hero'] },
        heroIcon,
        DOM({ style: 'wtop-cell-hero-name' }, heroNameById(item.hero) || '—'),
      );
      const battlesCell = DOM({ style: ['wtop-cell', 'wtop-cell--hero-stat-number'] }, String(item.battles || 0));
      const winsCell = DOM({ style: ['wtop-cell', 'wtop-cell--hero-stat-number'] }, String(item.wins || 0));
      const lossesCell = DOM({ style: ['wtop-cell', 'wtop-cell--hero-stat-number'] }, String(item.losses || 0));
      const winrateCell = DOM({ style: ['wtop-cell', 'wtop-cell--hero-stat-number', 'wtop-cell--hero-stat-winrate'] }, `${Number(item.winrate || 0).toFixed(2)}%`);
      battlesCell.style.color = metricValueColor('battles', Number(item.battles) || 0, metricRanges);
      winsCell.style.color = metricValueColor('wins', Number(item.wins) || 0, metricRanges);
      lossesCell.style.color = metricValueColor('losses', Number(item.losses) || 0, metricRanges);
      winrateCell.style.color = metricValueColor('winrate', Number(item.winrate) || 0, metricRanges);
      return DOM({ style: 'wtop-hero-stats-row' }, heroCell, battlesCell, winsCell, lossesCell, winrateCell);
    };

    const makeHeroStatsTable = (listScroll) => {
      const rowsBody = DOM({ style: 'wtop-hero-stats-rows' });
      const headerButtons = new Map();
      const periodToggle = DOM({
        tag: 'button',
        type: 'button',
        domaudio: domAudioPresets.defaultButton,
        style: ['wtop-cell', 'wtop-hero-period-toggle'],
        data: { tooltip: Lang.text('topPeriodTooltip') },
      });
      periodToggle.setAttribute('aria-label', Lang.text('topPeriodTooltip'));
      const headerHeroTitle = DOM({ style: ['wtop-cell', 'wtop-cell--hero', 'wtop-cell--hero-stats-hero', 'wtop-hero-title-cell'] });
      const headerHeroLabel = DOM({ tag: 'span', style: 'wtop-hero-title-label' }, Lang.text('topColHero'));
      const getCurrentHeroList = () => heroStatsPayload[heroStatsPeriod] || [];
      const hasAnyData = HERO_STATS_PERIODS.some((periodKey) => (heroStatsPayload[periodKey] || []).length > 0);

      const sortRows = () => {
        const key = heroStatsSortState.key;
        const dir = heroStatsSortState.direction === 'asc' ? 1 : -1;
        const rows = [...getCurrentHeroList()];
        rows.sort((a, b) => {
          const av = Number(a[key]) || 0;
          const bv = Number(b[key]) || 0;
          if (av === bv) {
            return (Number(a.hero) || 0) - (Number(b.hero) || 0);
          }
          return (av - bv) * dir;
        });

        rowsBody.innerHTML = '';
        if (!rows.length) {
          rowsBody.append(DOM({ style: 'wtop-empty-hint', textContent: Lang.text('topEmpty') }));
        } else {
          const metricRanges = buildMetricRanges(rows);
          for (const item of rows) {
            rowsBody.append(makeHeroStatsRow(item, metricRanges));
          }
        }

        for (const [keyName, btn] of headerButtons) {
          const arrow = heroStatsSortState.key === keyName ? (heroStatsSortState.direction === 'asc' ? ' ▲' : ' ▼') : '';
          btn.textContent = `${Lang.text(heroStatsColumns.find((col) => col.key === keyName).labelKey)}${arrow}`;
          btn.classList.toggle('is-active', heroStatsSortState.key === keyName);
        }
        headerHeroLabel.textContent = Lang.text('topColHero');
        if (heroStatsPeriod === 'week') {
          periodToggle.textContent = Lang.text('topPeriodWeek');
        } else if (heroStatsPeriod === 'month') {
          periodToggle.textContent = Lang.text('topPeriodMonth');
        } else {
          periodToggle.textContent = Lang.text('topPeriodAllTime');
        }
      };

      if (!hasAnyData) {
        listScroll.append(DOM({ style: 'wtop-empty-hint', textContent: Lang.text('topEmpty') }));
        return;
      }

      const header = DOM({ style: 'wtop-hero-stats-header' });
      for (const col of heroStatsColumns) {
        if (col.key === 'hero') {
          periodToggle.addEventListener('click', () => {
            const currentIndex = HERO_STATS_PERIODS.indexOf(heroStatsPeriod);
            heroStatsPeriod = HERO_STATS_PERIODS[(currentIndex + 1) % HERO_STATS_PERIODS.length];
            sortRows();
          });
          headerHeroTitle.append(DOM({ style: 'wtop-hero-title-split' }, headerHeroLabel, periodToggle));
          header.append(headerHeroTitle);
          continue;
        }
        const btn = DOM({
          tag: 'button',
          type: 'button',
          style: ['wtop-cell', 'wtop-sortable-header'],
          domaudio: domAudioPresets.defaultButton,
          data: { tooltip: Lang.text('topSortTooltip') },
          event: [
            'click',
            () => {
              if (heroStatsSortState.key === col.key) {
                heroStatsSortState.direction = heroStatsSortState.direction === 'desc' ? 'asc' : 'desc';
              } else {
                heroStatsSortState.key = col.key;
                heroStatsSortState.direction = 'desc';
              }
              sortRows();
            },
          ],
        });
        btn.setAttribute('aria-label', Lang.text('topSortTooltip'));
        headerButtons.set(col.key, btn);
        header.append(btn);
      }
      listScroll.append(header);
      listScroll.append(rowsBody);
      sortRows();
    };

    const openHeroPicker = async () => {
      let request = await App.api.request('build', 'heroAll');
      request.push({ id: 0 });
      const bodyHero = DOM({ style: 'party-hero' });
      const preload = new PreloadImages(bodyHero);
      for (let item of request) {
        const heroEl = DOM({ domaudio: domAudioPresets.smallButton });
        if (item.id) {
          heroEl.dataset.url = `content/hero/${item.id}/${item.skin ? item.skin : 1}.webp`;
        } else {
          heroEl.dataset.url = `content/hero/empty.webp`;
        }
        heroEl.addEventListener('click', async () => {
          if (isSplah) {
            Window.show('main', 'top', item.id, activeMode);
          } else {
            View.show('top', item.id, false, activeMode);
          }
          Splash.hide();
        });
        preload.add(heroEl);
      }
      Splash.show(bodyHero, false);
    };

    const scrollClass = isSplah ? 'wtop-scroll' : 'top-scroll';
    const modeBar = DOM({ style: 'wtop-mode-bar' });
    modeBar.append(DOM({ style: 'wtop-mode-section-title' }, Lang.text('topModesHeading')));
    for (const tab of TOP_MODE_TABS) {
      const isActive = tab.id === activeMode;
      const btn = DOM({
        domaudio: domAudioPresets.defaultButton,
        style: ['wtop-mode-tab', isActive ? 'is-active' : null].filter(Boolean),
        tag: 'button',
        type: 'button',
        textContent: Lang.text(tab.labelKey),
        event: [
          'click',
          () => {
            if (tab.id === activeMode) return;
            if (isSplah) {
              Window.show('main', 'top', heroId, tab.id);
            } else {
              View.show('top', heroId, false, tab.id);
            }
          },
        ],
      });
      modeBar.append(btn);
    }
    modeBar.append(DOM({ style: ['wtop-mode-section-title', 'wtop-mode-section-title--other'] }, Lang.text('topOtherHeading')));
    modeBar.append(
      DOM({
        domaudio: domAudioPresets.defaultButton,
        style: ['wtop-mode-tab', isHeroStatsView ? 'is-active' : null].filter(Boolean),
        tag: 'button',
        type: 'button',
        textContent: Lang.text('topHeroesTab'),
        event: [
          'click',
          () => {
            if (isHeroStatsView) return;
            if (isSplah) {
              Window.show('main', 'top', heroId, HERO_STATS_TAB_ID);
            } else {
              View.show('top', heroId, false, HERO_STATS_TAB_ID);
            }
          },
        ],
      }),
    );
    modeBar.append(
      DOM({
        domaudio: domAudioPresets.defaultButton,
        style: ['wtop-mode-tab', isStarsView ? 'is-active' : null].filter(Boolean),
        tag: 'button',
        type: 'button',
        data: { tooltip: Lang.text('titleStarsGlory') },
        event: [
          'click',
          () => {
            if (isStarsView) return;
            if (isSplah) {
              Window.show('main', 'top', heroId, STARS_TAB_ID);
            } else {
              View.show('top', heroId, false, STARS_TAB_ID);
            }
          },
        ],
      },
      Lang.text('topStarsTab')),
    );

    const listScroll = DOM({ style: 'wtop-list-scroll' });
    let loadId = 0;
    const showListStatus = (textKey, retry = false) => {
      const status = DOM({ style: 'wtop-list-status' });
      status.setAttribute('role', retry ? 'alert' : 'status');
      if (!retry) {
        status.append(DOM({ style: 'wtop-list-spinner' }));
      }
      status.append(DOM({ style: 'wtop-list-status-text' }, Lang.text(textKey)));
      if (retry) {
        status.append(DOM({ tag: 'button', type: 'button', style: 'wtop-list-retry', event: ['click', () => loadTop()] }, Lang.text('topRetry')));
      }
      listScroll.replaceChildren(status);
    };

    const renderPlayerList = (players, currentLoadId) => {
      if (!players.length) {
        listScroll.replaceChildren(DOM({ style: 'wtop-empty-hint', textContent: Lang.text('topEmpty') }));
        listScroll.removeAttribute('aria-busy');
        return;
      }

      const header = DOM(
        { style: 'wtop-table-header' },
        DOM({ style: ['wtop-cell', 'wtop-cell--place'] }, Lang.text('topColPlace')),
        DOM({ style: ['wtop-cell', 'wtop-cell--name'] }, DOM({ tag: 'span', style: 'wtop-cell-name-text' }, Lang.text('topColPlayer'))),
        DOM({ style: ['wtop-cell', 'wtop-cell--hero'] }, Lang.text('topColHero')),
        DOM({ style: ['wtop-cell', 'wtop-cell--rating'] }, Lang.text(isStarsView ? 'topColStars' : 'topColRating')),
      );
      const rows = DOM({ style: 'wtop-table-rows' });
      const spacer = DOM({ style: 'wtop-list-spacer' });
      const progress = DOM({ style: 'wtop-list-progress' });
      progress.setAttribute('role', 'status');
      listScroll.replaceChildren(header, rows, spacer, progress);

      let index = 0;
      let rowStride = 0;
      const appendBatch = () => {
        if (!body.isConnected || currentLoadId !== loadId) return;
        const fragment = document.createDocumentFragment();
        const end = Math.min(index + 20, players.length);
        for (; index < end; index++) {
          fragment.append(makeTableRow(players[index], index + 1));
        }
        rows.append(fragment);
        if (!rowStride) {
          const firstRow = rows.firstElementChild;
          rowStride = firstRow.getBoundingClientRect().height + parseFloat(getComputedStyle(firstRow).marginBottom);
        }

        const remaining = players.length - index;
        if (remaining) {
          spacer.style.height = `${remaining * rowStride}px`;
          progress.textContent = `${Lang.text('topLoadingMore')} ${index}/${players.length}`;
          requestAnimationFrame(appendBatch);
        } else {
          spacer.remove();
          progress.remove();
          listScroll.removeAttribute('aria-busy');
        }
      };
      appendBatch();
    };

    // Сервер отдаёт по 25 игроков (user.stars, page) — первые 100, страницы по очереди
    const loadStars = async () => {
      const players = [];
      for (let page = 0; page < STARS_MAX_PAGES; page++) {
        const rows = await App.api.request('user', 'stars', { page });
        if (!Array.isArray(rows)) {
          if (page) break;
          return rows;
        }
        for (const row of rows) {
          players.push({ id: row.id, nickname: row.nickname, hero: Number(row.hero) || 0, rating: Number(row.star) || 0 });
        }
        if (rows.length < STARS_PAGE_SIZE) break;
      }
      return players;
    };

    const loadTop = async () => {
      const currentLoadId = ++loadId;
      listScroll.setAttribute('aria-busy', 'true');
      showListStatus('topLoading');
      try {
        const [result] = await Promise.all([
          isStarsView
            ? loadStars()
            : isHeroStatsView
            ? App.api.request(App.CURRENT_MM, 'topHeroStats')
            : App.api.request(App.CURRENT_MM, activePlayerPeriod === 'recent' ? 'topActive' : 'top', { limit: 100, hero: heroId, mode: activeMode }),
          (async () => {
            if (!MM.hero) {
              try {
                MM.hero = await App.api.request('build', 'heroAll');
              } catch {
                MM.hero = [];
              }
            }
          })(),
        ]);
        if (!body.isConnected || currentLoadId !== loadId) return;
        if (result == null) throw new Error('Рейтинг отсутствует');

        if (isHeroStatsView) {
          heroStatsPayload = result && typeof result === 'object' && !Array.isArray(result)
            ? result
            : { week: [], month: [], allTime: [] };
          listScroll.replaceChildren();
          makeHeroStatsTable(listScroll);
          listScroll.removeAttribute('aria-busy');
        } else {
          if (!Array.isArray(result)) throw new Error('Invalid Hall of Fame response');
          renderPlayerList(result, currentLoadId);
        }
      } catch (error) {
        if (!body.isConnected || currentLoadId !== loadId) return;
        console.error('Hall of Fame failed to load', error);
        listScroll.removeAttribute('aria-busy');
        const reason = typeof error === 'string' ? error : error?.message;
        const recentError = !isHeroStatsView && !isStarsView && activePlayerPeriod === 'recent';
        const statusKey = recentError && reason === 'activeRatingIndexRequired'
          ? 'topRecentPlayersNotReady'
          : recentError && ['activeRatingBusy', 'activeRatingRetryLater'].includes(reason)
            ? 'topRecentPlayersBusy' : 'topLoadError';
        showListStatus(statusKey, true);
      }
    };
    showListStatus('topLoading');

    const heroFilterImg = DOM({
      tag: 'img',
      src: 'content/icons/ЗалСлавы.png',
      alt: '',
      style: 'wtop-hero-filter-img',
      draggable: false,
    });
    const heroFilterBtn = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        tag: 'button',
        type: 'button',
        style: 'wtop-hero-filter',
        data: { tooltip: Lang.text('topHeroFilterTooltip') },
        event: ['click', openHeroPicker],
      },
      heroFilterImg,
    );
    heroFilterBtn.setAttribute('aria-label', Lang.text('topHeroFilterTooltip'));
    if (!isHeroStatsView && !isStarsView) {
      modeBar.append(DOM({ style: 'wtop-hero-filter-slot' }, heroFilterBtn));
    }

    const periodTabs = DOM({ style: 'wtop-period-tabs' });
    periodTabs.setAttribute('role', 'tablist');
    const periodButtons = [];
    let activePlayerPeriod = 'all';
    if (!isHeroStatsView && !isStarsView) {
      for (const period of ['recent', 'all']) {
        const button = DOM({
          domaudio: domAudioPresets.defaultButton,
          tag: 'button',
          type: 'button',
          style: ['wtop-period-tab', period === activePlayerPeriod ? 'is-active' : null].filter(Boolean),
          textContent: Lang.text(period === 'recent' ? 'topPeriodRecentPlayers' : 'topPeriodAllPlayers'),
          event: ['click', () => {
            if (period === activePlayerPeriod) return;
            activePlayerPeriod = period;
            for (const [tabPeriod, tabButton] of periodButtons) {
              const selected = tabPeriod === period;
              tabButton.classList.toggle('is-active', selected);
              tabButton.setAttribute('aria-selected', String(selected));
            }
            loadTop();
          }],
        });
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(period === activePlayerPeriod));
        periodButtons.push([period, button]);
        periodTabs.append(button);
      }
    }

    const listRow = DOM({ style: 'wtop-list-row' }, ...(!isHeroStatsView && !isStarsView ? [periodTabs] : []), listScroll);
    const updateTime = DOM({ tag: 'span', style: 'wtop-update-time' });
    const updateFooter = DOM({ style: 'wtop-update-footer' }, Lang.text('topUpdateCountdown'), updateTime);
    let nextUpdateAt = Timer.getNextMoscowMidnight();
    let updateInterval = null;
    const updateCountdown = () => {
      const now = Date.now();
      if (now >= nextUpdateAt) {
        nextUpdateAt = Timer.getNextMoscowMidnight(now);
        loadTop();
      }
      const remaining = Math.min(Timer.oneDay - 1000, Math.ceil((nextUpdateAt - now) / 1000) * 1000);
      updateTime.textContent = Timer.getFormattedTimer(remaining) || '00:00';
    };
    updateCountdown();
    const top = DOM(
      { style: [scrollClass, 'top-layout'] },
      DOM({ style: 'wtop-window-title' }, Lang.text('topWindowTitle')),
      DOM(
        { style: 'wtop-window-body' },
        modeBar,
        DOM({ style: 'wtop-window-content' }, listRow),
      ),
      // звёзды начисляются сразу после боя — суточного обновления у этого топа нет
      ...(isStarsView ? [] : [updateFooter]),
    );

    const helpBtn = DOM({
      id: 'wtop_help',
      domaudio: domAudioPresets.defaultButton,
      style: 'help-button',
      event: [
        'click',
        () => {
          HelpSplash(Lang.text('top_help_content'));
        },
      ],
    });

    if (!isSplah) {
      body.append(View.header());
    }
    body.append(top);
    body.append(helpBtn);

    body.cleanup = () => {
      clearInterval(updateInterval);
      updateInterval = null;
      ++loadId;
    };
    requestAnimationFrame(() => {
      if (!body.isConnected) return;
      loadTop();
      updateInterval = setInterval(() => {
        if (!body.isConnected) return body.cleanup();
        updateCountdown();
      }, 1000);
    });

    return body;
  }

  static builds() {
    let body = DOM({ style: 'main' });

    let hero = DOM({ style: 'hero' });

    let preload = new PreloadImages(hero, (element) => {
      /*
            let test = () => {
                
                element.dataset.slide = ( ( ( Number(element.dataset.slide) + 1 ) > element.dataset.total ) ? 1 : ( Number(element.dataset.slide) + 1 ));
                
                PreloadImages.load(() => {
                    
                    let firstSlide = DOM(), twoSlide = DOM();
                    
                    firstSlide.style.backgroundImage = element.style.backgroundImage;
                    
                    element.append(firstSlide);
                    
                    element.style.backgroundImage = 'none';
                    
                    twoSlide.style.opacity = 0;
                    
                    element.append(twoSlide);
                    
                    twoSlide.style.backgroundImage = `url("content/hero/${element.dataset.id}/${element.dataset.slide}.webp")`;
                    
                    firstSlide.animate({opacity:[1,0]},{duration:500,easing:'ease-out',fill:'forwards'});
                    
                    let animation = twoSlide.animate({opacity:[0,1]},{duration:500,easing:'ease-in',fill:'forwards'});
                    
                    animation.onfinish = () => {
                        
                        element.style.backgroundImage = twoSlide.style.backgroundImage;
                        
                        firstSlide.remove();
                        
                        twoSlide.remove();
                        
                        setTimeout(() => {
                            
                            test();
                            
                        },App.getRandomInt(5000,15000));
                        
                    }
                    
                },`content/hero/${element.dataset.id}/${element.dataset.slide}.webp`);
                
            }
            
            if(element.dataset.total > 1){
                
                setTimeout(() => {
                    
                    test();
                    
                },App.getRandomInt(2500,5000));
                
            }
            */
    });

    App.api.silent(
      (result) => {
        MM.hero = result;

        for (const item of result) {
          //item.rating = App.getRandomInt(1100,3000);
          let rank = Rank.createRankNode(item.rating);
          const hero = DOM({ style: 'hero-item' }, DOM({ tag: 'span', style: 'name' }, item.name), rank);

          hero.addEventListener('click', () => View.show('build', item.id));

          hero.dataset.id = item.id;

          hero.dataset.slide = 1;

          hero.dataset.total = item.total;

          hero.dataset.url = `content/hero/${item.id}/${item.skin ? item.skin : 1}.webp`;

          preload.add(hero);
        }
      },
      'build',
      'heroAll',
    );

    body.append(View.header(), DOM({ style: 'main-body-full' }, hero));

    return body;
  }

  static inventory(isWindow) {
    let body = DOM({ style: 'main' });

    let inventory = DOM({ style: 'inventory' });

    App.api.silent(
      (result) => {
        for (let item of result) {
          let unit = DOM({ style: [`rarity${item.rarity}`] });

          unit.style.backgroundImage = `url(content/talents/${item.id}.webp)`;

          unit.append(DOM({ tag: 'span' }, item.score));

          inventory.append(unit);
        }
      },
      'gamev2',
      'inventory',
    );

    if (!isWindow) {
      body.append(
        DOM(
          { style: 'main-header' },
          DOM({ tag: 'img', src: 'content/img/logo.webp' }),
          DOM(
            {
              domaudio: domAudioPresets.bigButton,
              style: 'main-header-item',
              event: ['click', () => View.show('castle')],
            },
            App.storage.data.login,
          ),
          DOM(
            {
              domaudio: domAudioPresets.bigButton,
              style: 'main-header-item',
              event: ['click', () => View.show('inventory')],
            },
            Lang.text('shards'),
          ),
          DOM(
            {
              domaudio: domAudioPresets.bigButton,
              style: 'main-header-item',
              event: ['click', () => View.show('game')],
            },
            Lang.text('farm'),
          ),
          DOM(
            {
              domaudio: domAudioPresets.bigButton,
              style: 'main-header-item',
              event: ['click', () => View.exitOrLogout()],
            },
            Lang.text('logoutShort'),
          ),
        ),
      );
    } else {
      body.append(DOM({ style: 'inventory-header' }, Lang.text('library')));
    }
    body.append(DOM({ style: 'main-body-full' }, inventory));

    return body;
  }

  // Окно «Фарм талантов»: вкладки «Дуэль» (match3Duel.js) и «Фарм» (одиночный, game.js + gamev2)
  static game(isWindow) {
    let body = DOM({ style: ['game', 'game-tabbed'] });

    let content = DOM({ style: 'game-tab-content' });

    let tabButtons = {};

    const showTab = (name) => {
      for (const key in tabButtons) {
        tabButtons[key].classList.toggle('game-tab-active', key == name);
      }

      Match3Duel.destroy();

      Game.dragEnd();

      content.replaceChildren();

      if (name == 'duel') {
        Match3Duel.render(content);
      } else {
        button.innerText = Lang.text('farmStart');

        content.append(dscription);
      }
    };

    for (const [name, key] of [
      ['duel', 'match3TabDuel'],
      ['farm', 'match3TabFarm'],
    ]) {
      tabButtons[name] = DOM({ domaudio: domAudioPresets.defaultButton, style: 'game-tab', event: ['click', () => showTab(name)] }, Lang.text(key));
    }

    body.append(DOM({ style: 'game-tabs' }, tabButtons.duel, tabButtons.farm), content);

    let button = DOM(
      {
        domaudio: domAudioPresets.bigButton,
        style: ['m3d-btn', 'm3d-start'],
        event: [
          'click',
          async () => {
            let request = await App.api.request('gamev2', 'start');

            if ('error' in request) {
              button.innerText = Lang.text('farmCooldown').replace('{min}', request.error);

              return;
            }

            dscription.remove();

            request.back = () => {
              View.show('castle');
            };

            request.finish = async () => {
              await App.api.request('gamev2', 'finish');

              isWindow ? Window.close('main') : View.show('castle');
            };

            request.exit = () => {
              View.show('castle');
            };

            Game.init(content, request, isWindow);
          },
        ],
      },
      Lang.text('farmStart'),
    );

    let dscription = DOM(
      { style: 'game-description' },
      DOM({ tag: 'h1' }, Lang.text('farmIntroTitle')),
      DOM({ tag: 'p' }, Lang.text('farmRule1')),
      DOM({ tag: 'p' }, Lang.text('farmRule2')),
      //DOM({tag:'p'},'— кулдаун между играми 60 минут;'),
      DOM(
        { tag: 'p' },
        Lang.text('farmRule3'),
      ),
      DOM({ tag: 'p' }, Lang.text('farmRule4')),
      DOM({ tag: 'p' }, Lang.text('farmRule5')),
      //DOM({tag:'p'},'— в рейтинге на главной страничке отображается сумма всех очков на одного игрока за всё время.'),
      button,
      isWindow
        ? DOM()
        : DOM(
            {
              domaudio: domAudioPresets.bigButton,
              style: 'game-button',
              event: ['click', () => View.show('castle')],
            },
            Lang.text('back'),
          ),
    );

    showTab('duel');

    return body;
  }

  static async build(heroId, targetId = 0, isWindow = false, options = {}) {
    const body = DOM({ style: 'build-horizontal' });
    requestAnimationFrame(() => Voice.updatePanelPosition());

    const initialized = await Build.init(heroId, targetId, isWindow, options);
    if (!initialized) {
      return null;
    }

    const libraryTitle = DOM({ style: 'build-library-title' }, DOM({ tag: 'span' }, Lang.text('library')));
    const libraryTooltip = DOM({ style: 'build-library-tooltip' },
      DOM({ style: 'account-rating-tooltip-title' }, Lang.text('buildLibraryTooltipTitle')),
      DOM({ style: 'account-rating-tooltip-body' }, Lang.text('buildLibraryTooltipBody')),
    );
    libraryTooltip.setAttribute('role', 'tooltip');
    libraryTitle.append(libraryTooltip);
    const setsTitle = Build.inventoryView.querySelector('.build-sets-section > .build-inventory-legend');
    if (setsTitle) {
      setsTitle.append(DOM({ style: ['build-library-tooltip', 'build-sets-tooltip'], role: 'tooltip' },
        DOM({ style: 'account-rating-tooltip-title' }, Lang.text('sets')),
        DOM({ style: 'account-rating-tooltip-body' }, Lang.text('buildSetsTooltipBody')),
      ));
    }
    if (Build.statFilterHighlightCountWrapEl) Build.buildActionsView.prepend(Build.statFilterHighlightCountWrapEl);

    body.append(
      DOM({
        id: 'wbuild_help',
        domaudio: domAudioPresets.defaultButton,
        style: 'help-button',
        data: { tooltip: Lang.text('help') },
        ariaLabel: Lang.text('help'),
        event: [
          'click',
          () => {
            HelpSplash(Lang.text('build_help_content'));
          },
        ],
      }),
      DOM({ style: 'build-left' }, Build.heroView),
      DOM(
        { style: 'build-center' },
        Build.buildActionsView,
        DOM({ style: 'build-field-with-tabs' }, Build.listView, DOM({ style: 'build-field-container' }, Build.levelView, Build.fieldView)),
        DOM(
          { style: 'build-active-bar-container' },
          Build.activeBarKeybindingsView,
          Build.activeBarView,
          DOM({ style: 'build-smartcast-tooltip', role: 'tooltip' }),
          DOM({ style: 'build-active-bar-hint' }, Lang.text('smartcastDescription')),
        ),
      ),
      DOM({ style: 'build-right' }, libraryTitle, Build.rarityView, Build.librarySearchView, Build.talentsAndSetsView, Build.inventoryView),
    );
    // Настройки билда — слева от «?», сразу вместе с окном: таймер attach при смене билда давал мигание.
    if (Build.buildSettingsButton) body.querySelector('#wbuild_help')?.before(Build.buildSettingsButton);

    if (!isWindow) {
      body.append(
        DOM(
          {
            domaudio: domAudioPresets.closeButton,
            style: ['build-list-close', 'close-button'],
            title: Lang.text('titleClose'),
            event: [
              'click',
              () => {
                Build.CleanInvalidDescriptions();
                if (isWindow) {
                  View.show('castle');
                } else {
                  View.show('builds');
                }
              },
            ],
          },
          DOM({
            tag: 'img',
            src: 'content/icons/close-cropped.svg',
            alt: Lang.text('titleClose'),
            style: 'close-image-style',
          }),
        ),
      );
    }

    // вкладка «Герой» — только для героев из каталога: у новых героев (Лагуна) ещё нет артов
    if ((await View.heroesCatalogueIds()).has(Number(heroId))) {
      View.attachBuildHeroesTab(body, heroId, options);
    }
    return isWindow ? body : DOM({ id: 'viewbuild' }, body);
  }

  // Окно билда в замке опускаем так, чтобы подсказка под рядом смарткаста стояла почти впритык
  // (BUILD_HERO_LIST_GAP px) к списку героев при любом соотношении сторон экрана.
  static BUILD_HERO_LIST_GAP = 4;

  static fitBuildWindowToHeroList() {
    if (!View.fitBuildWindowResizeBound) {
      View.fitBuildWindowResizeBound = true;
      window.addEventListener('resize', () => View.fitBuildWindowToHeroList());
    }
    requestAnimationFrame(() => {
      const win = document.getElementById('wbuild');
      const list = document.querySelector('.castle-bottom-content-container');
      const hint = win?.querySelector('.build-active-bar-hint');
      if (!win || !list || !hint) return;
      // сдвиг через top: margin раздувает родителя и тянет список героев за окном,
      // а transform ломает перенос талантов (position: fixed внутри окна)
      win.style.top = '';
      win.style.position = '';
      const hintRect = hint.getBoundingClientRect();
      // над списком стоят кнопки списков и поиск: считаем от самого верхнего, что под подсказкой
      let top = list.getBoundingClientRect().top;
      for (const item of list.parentElement.querySelectorAll('.castle-hero-list-btn, .castle-hero-list-search-wrap')) {
        const rect = item.getBoundingClientRect();
        if (rect.height && rect.right > hintRect.left && rect.left < hintRect.right) top = Math.min(top, rect.top);
      }
      const shift = top - View.BUILD_HERO_LIST_GAP - hintRect.bottom;
      // только вниз: сверху окно не поднимаем выше обычного отступа
      if (shift <= 0) return;
      const style = getComputedStyle(win);
      if (style.position === 'static') win.style.position = 'relative';
      win.style.top = `${(parseFloat(style.top) || 0) + shift}px`;
      // окно опустилось — панель войса встаёт вровень с ним
      Voice.schedulePanelPosition();
    });
  }

  static heroesCatalogueIds() {
    View.heroesCatalogueIdsPromise ??= fetch(`content/heroes-preview.json?v=${View.HEROES_TAB_VERSION}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((heroes) => new Set(heroes.map((hero) => Number(hero.id))))
      .catch(() => {
        View.heroesCatalogueIdsPromise = null;
        return new Set();
      });
    return View.heroesCatalogueIdsPromise;
  }

  // Живые данные для вкладки «Герой» (content/modules/heroesPreview.js читает window.parent.pwHeroesHost).
  static createHeroesHost(preview) {
    const heroOf = (heroId) => (Array.isArray(MM.hero) ? MM.hero.find((hero) => Number(hero.id) === Number(heroId)) : null);
    const request = (heroId) => (Number(Build.heroId) === Number(heroId) ? Build.dataRequest?.hero : null);
    return {
      lang: Lang.target,
      text: (key) => Lang.text(key),
      heroName: (heroId, skin) => Lang.heroName(heroId, skin),
      rating: (heroId) => Number(request(heroId)?.rating ?? heroOf(heroId)?.rating) || 0,
      rankIcon: (rating) => `content/ranks/${Rank.icon(rating || 0)}.webp`,
      ownedSkins: (heroId) => {
        const list = request(heroId)?.skin?.list;
        const owned = Array.isArray(list) ? list.map(Number).filter((skin) => Number.isInteger(skin) && skin > 0) : [];
        return owned.length ? owned : [1];
      },
      selectedSkin: (heroId) =>
        Number(heroOf(heroId)?.skin) || Number(request(heroId)?.skin?.target) || 1,
      selectSkin: async (heroId, skin) => {
        if (!preview) await Build.changeSkinForHero(heroId, skin);
        const data = request(heroId);
        if (data?.skin) data.skin.target = skin;
        const hero = heroOf(heroId);
        if (hero) hero.skin = skin;
        if (preview) Build.applyBuildHeroAvatarSkin(heroId, skin);
      },
      openFair: () => {
        if (!preview) {
          Window.show('main', 'shop', 'skin');
          return;
        }
        const url = new URL('/', window.location.href);
        url.search = new URLSearchParams({ previewFair: '1', previewFairTab: 'skin' });
        window.location.assign(url.href);
      },
    };
  }

  // Живая страница вкладки «Герой» (iframe) последнего окна билда
  static buildHeroesFrame = null;

  // Окно билда вот-вот уберут (смена героя): уносим его страницу «Герой» в скрытый контейнер,
  // чтобы новое окно забрало её без перезагрузки. moveBefore не перезагружает iframe, а remove — да.
  static stashBuildHeroesFrame() {
    const frame = View.buildHeroesFrame;
    if (!frame?.isConnected || typeof document.body.moveBefore !== 'function') return;
    let stash = document.getElementById('build-heroes-stash');
    if (!stash) {
      stash = DOM({ id: 'build-heroes-stash', ariaHidden: 'true' });
      document.body.append(stash);
    }
    // тот же размер, что в окне: страница не перекладывается дважды
    const rect = frame.getBoundingClientRect();
    stash.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${rect.width}px; height: ${rect.height}px; pointer-events: none;`;
    try {
      stash.moveBefore(frame, null);
    } catch {
      return;
    }
    clearTimeout(View.buildHeroesStashTimer);
    // новое окно так и не забрало страницу (закрыли, ошибка) — не держим её в памяти
    View.buildHeroesStashTimer = setTimeout(() => {
      if (frame.parentElement === stash) frame.remove();
      if (View.buildHeroesFrame === frame && !frame.isConnected) View.buildHeroesFrame = null;
    }, 5000);
  }

  // Окно билда вставлено в документ: забрать в него страницу «Герой» прошлого окна
  static placeBuildHeroesFrame() {
    View.pendingBuildHeroesPlace?.();
  }

  static attachBuildHeroesTab(body, heroId, options = {}) {
    const preview = !!options.previewData;
    const list = Build.listView;
    const buildTabs = [...list.querySelectorAll('.build-tab-item')];
    const selectedTab = buildTabs.find((tab) => tab.classList.contains('list-highlight'));
    const panel = DOM({ style: 'build-heroes-panel', hidden: true, role: 'tabpanel' });
    let frame = null;
    const portrait = DOM({ tag: 'img', alt: '', style: 'build-heroes-portrait' });
    const nameplate = DOM({ style: ['name', 'build-heroes-name'] });
    const selection = DOM({ style: ['build-hero-avatar-and-name', 'build-heroes-selection'], hidden: true }, portrait, nameplate);
    let navigating = false;
    const navigateHero = async (direction) => {
      if (navigating) return;
      navigating = true;
      const active = body.classList.contains('build-horizontal--heroes');
      for (const button of selection.querySelectorAll('button')) button.disabled = true;
      try {
        if (options.onHeroNavigate) await options.onHeroNavigate(direction, active);
        else {
          await Build.switchHeroFromCastleBottomList(direction);
          if (active) Build.listView.querySelector('.build-heroes-tab')?.click();
        }
      } finally {
        navigating = false;
        for (const button of selection.querySelectorAll('button')) button.disabled = false;
      }
    };
    for (const [direction, label] of [['prev', Lang.text('heroesPrevHero')], ['next', Lang.text('heroesNextHero')]]) {
      selection.append(DOM({
        tag: 'button', type: 'button', style: ['build-heroes-nav', `build-heroes-nav--${direction}`],
        title: label, ariaLabel: label, disabled: true,
        event: ['click', () => navigateHero(direction === 'prev' ? -1 : 1)],
      }));
    }
    const heroTab = DOM({
      tag: 'button', type: 'button', style: ['build-tab-item', 'btn-hover', 'list-not-highlight', 'build-heroes-tab'],
      ariaPressed: 'false',
    }, DOM({ style: 'build-tab-label' }, DOM({ tag: 'span' }, Lang.text('heroesTabHero'))));
    heroTab.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    // Страница героя (iframe). Создаётся заранее, в фоне, чтобы вкладка открывалась сразу.
    // При смене героя окно билда собирается заново, а живая страница переезжает в него
    // (View.stashBuildHeroesFrame) и сама переключает героя — без перезагрузки и пустого кадра.
    const ensureFrame = () => {
      if (frame) return;
      window.pwHeroesHost = View.createHeroesHost(preview);
      // пока страница героя грузится, над вкладкой — текущий облик героя, а не пустое кольцо
      const currentSkin = window.pwHeroesHost.selectedSkin(heroId);
      portrait.src = `content/hero/${heroId}/${currentSkin}.webp`;
      portrait.alt = Lang.heroName(heroId, currentSkin);
      Build.setHeroName(nameplate, portrait.alt);
      for (const button of selection.querySelectorAll('button')) button.disabled = false;
      const live = View.buildHeroesFrame;
      const adopt = !!live?.isConnected && typeof panel.moveBefore === 'function';
      if (adopt) {
        frame = live;
      } else {
        const params = new URLSearchParams({
          embedded: '1',
          lockHero: '1',
          hero: String(heroId),
          skin: String(currentSkin),
          v: View.HEROES_TAB_VERSION,
        });
        // без title: всплывающее «Герои» над всей вкладкой ничего не сообщает
        frame = DOM({ tag: 'iframe', style: 'build-heroes-frame', src: `content/heroes-preview.html?${params}` });
        frame.setAttribute('aria-label', Lang.text('titleheroes'));
        const created = frame;
        // обработчики берутся из окна билда, в котором страница сейчас стоит
        created.addEventListener('load', () => {
          const doc = created.contentDocument;
          // Hero identity belongs to the build; the catalogue only browses its skins.
          doc?.addEventListener('heroes-preview-change', () => created.pwSyncSelection?.());
          doc?.addEventListener('keydown', (event) => created.pwKeydown?.(event));
          created.pwSyncSelection?.();
        });
        View.buildHeroesFrame = frame;
      }
      const shownFrame = frame;
      shownFrame.pwSyncSelection = () => {
        const doc = shownFrame.contentDocument;
        const image = doc?.getElementById('hero-portrait');
        const name = doc?.getElementById('hero-name');
        if (!image?.getAttribute('src') || !name) return;
        portrait.src = image.src;
        portrait.alt = name.textContent;
        Build.setHeroName(nameplate, name.textContent);
      };
      shownFrame.pwKeydown = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        setActive(false);
        heroTab.focus();
      };
      // облик сменили не во вкладке (окно выбора облика на аватаре) — обновить кнопку «Выбрать»
      Build.onHeroSkinChanged = () => shownFrame.contentDocument?.dispatchEvent(new CustomEvent('heroes-host-change'));
      if (!adopt) {
        panel.append(frame);
        return;
      }
      shownFrame.contentDocument?.dispatchEvent(new CustomEvent('heroes-host-hero', { detail: { hero: Number(heroId) } }));
      // переносим, когда новое окно уже в документе (moveBefore работает только между подключёнными узлами):
      // сразу после вставки окна (View.placeBuildHeroesFrame), до первой отрисовки; кадр анимации — запасной путь
      let attempts = 0;
      const place = () => {
        if (frame !== shownFrame || shownFrame.parentElement === panel) return;
        if (!body.isConnected) {
          if (++attempts < 120) requestAnimationFrame(place);
          return;
        }
        if (View.pendingBuildHeroesPlace === place) View.pendingBuildHeroesPlace = null;
        try {
          panel.moveBefore(shownFrame, null);
        } catch {
          shownFrame.remove();
          frame = null;
          View.buildHeroesFrame = null;
          ensureFrame();
        }
      };
      View.pendingBuildHeroesPlace = place;
      place();
    };
    const setActive = (active) => {
      // запоминаем вкладку: следующий герой (Ф/В, стрелки, клик по герою внизу) откроется тоже на «Герой»
      View.buildHeroesTabActive = active;
      body.classList.toggle('build-horizontal--heroes', active);
      panel.hidden = !active;
      selection.hidden = !active;
      heroTab.classList.toggle('list-highlight', active);
      heroTab.classList.toggle('list-not-highlight', !active);
      heroTab.setAttribute('aria-pressed', String(active));
      for (const tab of buildTabs) {
        const selected = !active && tab === selectedTab;
        tab.classList.toggle('list-highlight', selected);
        tab.classList.toggle('list-not-highlight', !selected);
      }
      for (const section of body.querySelectorAll('.build-right, .build-actions-view, .build-field-container, .build-active-bar-container')) {
        section.inert = active;
      }
      if (active) {
        Build.toggleBuildSettingsPanel(false);
        Build.descriptionView.style.display = 'none';
        ensureFrame();
      }
    };
    heroTab.addEventListener('click', () => setActive(true));
    list.prepend(DOM({ style: 'button-build--wrapper' }, heroTab));
    list.addEventListener('click', (event) => {
      const tab = event.target.closest('.build-tab-item');
      if (!tab || tab === heroTab) return;
      const wasActive = body.classList.contains('build-horizontal--heroes');
      if (wasActive && !preview && tab !== selectedTab) {
        // другой билд открывается новым окном: «Герой» остаётся до его прихода, иначе мелькает текущий билд
        View.buildHeroesTabActive = false;
        heroTab.classList.replace('list-highlight', 'list-not-highlight');
        heroTab.setAttribute('aria-pressed', 'false');
        for (const other of buildTabs) {
          other.classList.toggle('list-highlight', other === tab);
          other.classList.toggle('list-not-highlight', other !== tab);
        }
        return;
      }
      setActive(false);
      if (preview || (wasActive && tab === selectedTab)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    body.append(panel);
    Build.heroView.append(selection);
    if (options.onHeroNavigate) body.addEventListener('click', (event) => {
      const button = event.target.closest('.build-hero-nav-btn');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      navigateHero(button.classList.contains('build-hero-nav-btn-left') ? -1 : 1);
    }, true);
    // Сменили героя, стоя на «Герой» (прошлое окно билда ещё на экране и на этой вкладке) — сразу «Герой».
    const keepHeroesTab = View.buildHeroesTabActive &&
      !!document.querySelector(':is(#wbuild, #viewbuild) .build-horizontal--heroes');
    if (keepHeroesTab || (preview && options.heroesTab)) {
      setActive(true);
    } else {
      View.buildHeroesTabActive = false;
      // живая страница прошлого окна переезжает сразу, новая подгружается в фоне, когда окно билда уже показано
      if (View.buildHeroesFrame?.isConnected) ensureFrame();
      else setTimeout(() => {
        if (body.isConnected) ensureFrame();
      }, 600);
    }
  }

  // Админка талантов: обычные и классовые — одна страница с вкладками (talentAdmin.js).
  static async talents() {
    return DOM({ style: 'main' }, TalentAdmin.render('common'));
  }

  static async talents2() {
    return DOM({ style: 'main' }, TalentAdmin.render('hero'));
  }

}

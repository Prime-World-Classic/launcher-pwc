import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { App } from './app.js';
import { NativeAPI } from './nativeApi.js';
import { Splash } from './splash.js';
import { domAudioPresets } from './domAudioPresets.js';
import { uiIcon } from './uiIcon.js';
import { CastleFarm } from './castleFarm.js';

// Общий чат замка.
// У сообщения один id — chat_message.id из БД: его несут и живая рассылка
// (UChat / UChatPinned: messageId), и история (user.loadForumMessage: id).
// По нему же правка, закреп и скрытие. Закрепы хранит сервер (chat_message.pinned).
export class Chat {
  // Лимиты — как ChatLimits в бэкенде (objects/user.model.js).
  static MAX_LENGTH = 256;

  static EDIT_WINDOW_MS = 2 * 60 * 60 * 1000;

  static HISTORY_PAGE_SIZE = 25;

  // Счётчик символов показываем с этой длины.
  static COUNTER_FROM = 200;

  // data.v: бэкенд отдаёт ошибки ключами перевода (chatError* в content/lang).
  static PROTOCOL = 2;

  static body;

  static list;

  static field;

  static hide = false;

  // id -> сообщение (лента + закрепы).
  static messages = new Map();

  // id -> элемент ленты.
  static items = new Map();

  static pinnedIds = new Set();

  static pinnedOpen = false;

  // echoId -> элемент локальной копии, ждущей подтверждения сервера.
  static pending = new Map();

  // { userId, handle } — кому отвечаем; текст начинается с `${handle}, `.
  static reply = null;

  static editId = 0;

  static editDraft = '';

  static sending = false;

  static unread = 0;

  static history = { page: 0, loading: false, hasMore: true };

  static syncing = false;

  // Вкладка: 'all' — общий чат, 'team' — чат команды (пати в замке или своя команда в лобби).
  // Сообщения команды сервер не хранит: лента живёт, пока открыт лаунчер.
  static tab = 'all';

  static TEAM_LIMIT = 200;

  static teamList;

  static tabs = {};

  // Непрочитанные на неактивной вкладке.
  static tabUnread = { all: 0, team: 0 };

  // Поиск боя выключен админом (MMSearchState) — серая строка под лентой на обеих вкладках.
  static mmNotice;

  static searchClosed = false;

  static init() {
    Chat.initView();

    document.addEventListener('keydown', (event) => {
      if (event.code == 'KeyM' && (event.ctrlKey || event.metaKey)) {
        Chat.changeChatVisibility();
      }
    });
  }

  static initView() {
    Chat.list = DOM({ style: 'chat-body' });
    Chat.list.addEventListener('scroll', () => Chat.onScroll(), { passive: true });

    Chat.jumpButton = DOM(
      {
        tag: 'button',
        style: 'chat-jump',
        title: Lang.text('chatScrollDown'),
        event: ['click', () => Chat.scroll(true)],
      },
      DOM({ tag: 'span', style: 'chat-jump-count' }),
      '▼',
    );

    Chat.pinnedContainer = DOM({ style: 'chat-pinned' });

    Chat.field = DOM({
      tag: 'input',
      domaudio: domAudioPresets.chatButton,
      style: 'chat-input',
      maxLength: Chat.MAX_LENGTH,
      placeholder: Lang.text('enterTextAndPressEnter'),
    });
    Chat.field.addEventListener('keydown', (event) => Chat.onFieldKeyDown(event));
    Chat.field.addEventListener('input', () => Chat.onFieldInput());

    Chat.banner = DOM({ style: 'chat-compose-banner' });

    // Ошибки чата (мьют, флуд, «некому писать») — строкой над полем ввода, а не общим тостом.
    Chat.notice = DOM({ style: 'chat-notice', event: ['click', () => Chat.hideError()] });
    Chat.counter = DOM({ tag: 'span', style: 'chat-counter' });

    const sendButton = DOM(
      {
        tag: 'button',
        style: 'chat-send',
        domaudio: domAudioPresets.smallButton,
        title: Lang.text('chatSend'),
        event: ['click', () => Chat.sendMessage()],
      },
      uiIcon('send'),
    );

    Chat.teamList = DOM({ style: ['chat-body', 'chat-body--team'] }, DOM({ style: 'chat-team-hint' }, Lang.text('chatTeamHint')));

    Chat.mmNotice = DOM({ style: 'chat-mm-notice' }, Lang.text('chatMMSearchClosed'));
    Chat.setSearchClosed(Chat.searchClosed);

    // Переключатель вкладок — в строке ввода: она не двигается, когда чат раскрывается вверх,
    // и чат не растёт.
    const tab = (name, label) => {
      const count = DOM({ tag: 'span', style: 'chat-tab-count' });
      const button = DOM(
        {
          tag: 'button',
          style: 'chat-tab',
          domaudio: domAudioPresets.smallButton,
          event: ['click', () => Chat.setTab(name)],
        },
        DOM({ tag: 'span' }, label),
        count,
      );
      Chat.tabs[name] = { button, count };
      return button;
    };

    Chat.input = DOM(
      { style: 'chat-input-container' },
      Chat.field,
      Chat.counter,
      DOM({ style: 'chat-tabs' }, tab('all', Lang.text('chatTabAll')), tab('team', Lang.text('chatTabTeam'))),
      sendButton,
    );

    Chat.body = DOM(
      { style: 'chat' },
      DOM({ style: 'chat-feed' }, Chat.list, Chat.teamList, Chat.jumpButton),
      Chat.mmNotice,
      Chat.pinnedContainer,
      Chat.notice,
      Chat.banner,
      Chat.input,
    );
    Chat.body.addEventListener('mouseleave', () => Chat.setPinnedOpen(false));
    Chat.initResizeAnchor();

    Chat.initTooltip();
    Chat.setTab('all');
  }

  static NOTICE_MS = 6000;

  static showError(error) {
    const text = String(error?.message || error || '').trim();
    console.error('[chat]', error);
    if (!text || !Chat.notice) return;
    Chat.notice.textContent = text;
    Chat.notice.classList.add('chat-notice--visible');
    Chat.revealChat();
    clearTimeout(Chat.noticeTimer);
    Chat.noticeTimer = setTimeout(() => Chat.hideError(), Chat.NOTICE_MS);
  }

  static hideError() {
    clearTimeout(Chat.noticeTimer);
    Chat.notice?.classList.remove('chat-notice--visible');
  }

  // Состояние храним отдельно: событие может прийти до initView, а смена языка пересоздаёт чат.
  static setSearchClosed(closed) {
    Chat.searchClosed = Boolean(closed);
    Chat.mmNotice?.classList.toggle('chat-mm-notice--visible', Chat.searchClosed);
  }

  // ---- Вкладки ----

  static setTab(name) {
    if (Chat.tab !== name && (Chat.editId || Chat.reply)) Chat.cancelCompose();
    Chat.tab = name;
    Chat.tabUnread[name] = 0;
    Chat.body.classList.toggle('chat--team', name === 'team');
    for (const [key, { button }] of Object.entries(Chat.tabs)) {
      button.classList.toggle('chat-tab--active', key === name);
      button.setAttribute('aria-pressed', String(key === name));
    }
    Chat.field.placeholder = Lang.text(name === 'team' ? 'chatTeamPlaceholder' : 'enterTextAndPressEnter');
    Chat.renderPinned();
    Chat.updateTabCounts();
    Chat.updateCompose();
    if (name === 'team') Chat.teamList.scrollTo({ top: 0 });
  }

  static updateTabCounts() {
    for (const [key, { button, count }] of Object.entries(Chat.tabs)) {
      const unread = Chat.tabUnread[key];
      count.textContent = unread > 0 ? (unread > 99 ? '99+' : String(unread)) : '';
      button.classList.toggle('chat-tab--unread', unread > 0);
    }
  }

  static bumpTab(name) {
    if (Chat.tab === name) return;
    Chat.tabUnread[name]++;
    Chat.updateTabCounts();
  }

  // ---- Чат команды ----

  // UTeamChat — сообщение пати (поля как у UChat, messageId — счётчик сервера).
  static onTeam(data) {
    const message = { ...Chat.fromLive(data), id: 0 };
    if (message.echoId) Chat.resolvePending(message.echoId);
    Chat.addTeamMessage(message);
  }

  // MMChat от игрока — чат своей команды в лобби (его же показывает лобби).
  static onTeamLobby(data, nickname) {
    const userId = Number(data?.id || 0);
    if (!(userId > 0) || !nickname) return;
    Chat.addTeamMessage({
      ...Chat.fromLive({ id: userId, nickname, message: data?.message, date: Date.now() }),
      id: 0,
    });
  }

  static addTeamMessage(message) {
    if (!Chat.teamList) return;
    const stick = Chat.isTeamAtBottom();
    Chat.teamList.prepend(Chat.renderMessage(message));
    const items = Chat.teamList.querySelectorAll('.chat-msg');
    for (let i = Chat.TEAM_LIMIT; i < items.length; i++) items[i].remove();
    if (stick || Chat.isOwn(message)) Chat.teamList.scrollTo({ top: 0 });
    if (!Chat.isOwn(message)) Chat.bumpTab('team');
  }

  static isTeamAtBottom() {
    return Math.abs(Chat.teamList.scrollTop) <= 8;
  }

  static async submitTeam(text, raw) {
    const echoId = `${Chat.myId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const client = NativeAPI.isSteamClient ? 2 : 0;
    const echo = Chat.renderMessage({
      id: 0,
      userId: Chat.myId,
      nickname: String(App.storage.data.login || ''),
      to: 0,
      flag: 0,
      star: 0,
      text,
      date: Date.now(),
      edited: 0,
      source: Chat.sourceOf({ client }),
    });
    echo.classList.add('chat-msg--pending');
    echo.title = Lang.text('chatPending');
    Chat.pending.set(echoId, echo);
    Chat.teamList.prepend(echo);
    Chat.teamList.scrollTo({ top: 0 });
    Chat.field.value = '';
    Chat.updateCompose();

    try {
      await App.api.request('user', 'teamChat', { message: text, client, echoId, v: Chat.PROTOCOL });
      // В лобби сообщение приходит как MMChat без echoId — копию убираем по ответу.
      Chat.resolvePending(echoId);
    } catch (error) {
      Chat.resolvePending(echoId);
      if (!Chat.field.value) {
        Chat.field.value = raw;
        Chat.updateCompose();
      }
      throw error;
    }
  }

  // Подсказки к флагу, источнику, звёздам и роли — слева от чата (внутри он обрезается).
  static initTooltip() {
    Chat.roleTooltip = DOM({ style: 'chat-role-tooltip' });
    document.body.append(Chat.roleTooltip);

    Chat.body.addEventListener(
      'mouseover',
      (event) => {
        const el = event.target.closest('[data-tooltip-source], [data-tooltip-role]');
        if (!el || !Chat.body.contains(el)) return;
        const lines = [el.dataset.tooltipSource, el.dataset.tooltipRole].filter(Boolean).flatMap((text) => text.split('\n'));
        Chat.roleTooltip.replaceChildren(...lines.map((line) => DOM({ tag: 'div' }, line)));
        Chat.roleTooltip.style.display = 'block';
        requestAnimationFrame(() => {
          const chatRect = Chat.body.getBoundingClientRect();
          Chat.roleTooltip.style.left = `${chatRect.left - Chat.roleTooltip.offsetWidth - 8}px`;
          Chat.roleTooltip.style.top = `${el.getBoundingClientRect().top}px`;
        });
      },
      true,
    );
    Chat.body.addEventListener(
      'mouseout',
      (event) => {
        if (event.target.closest('[data-tooltip-source], [data-tooltip-role]')) {
          Chat.roleTooltip.style.display = 'none';
        }
      },
      true,
    );
  }

  static changeChatVisibility() {
    Chat.hide = !Chat.hide;
    Chat.body.style.display = Chat.hide ? 'none' : '';
    Chat.updateToggleState();
  }

  static updateToggleState() {
    for (const toggle of document.querySelectorAll('.chat-menu-item')) {
      toggle.classList.toggle('chat-menu-item--muted', Chat.hide);
      toggle.setAttribute('aria-pressed', String(!Chat.hide));
    }
  }

  // ---- Данные ----

  static get myId() {
    return Number(App?.storage?.data?.id || 0);
  }

  static get canModerate() {
    return App.isAdmin() || App.isHelper();
  }

  static toTimestamp(value) {
    if (value === undefined || value === null || value === '' || value === false) return 0;
    if (value === true) return Date.now();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric;
    const parsed = Date.parse(String(value).replace(' ', 'T'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  static sourceOf(data) {
    const source = String(data?.source || '').toLowerCase();
    if (source === 'steam' || source === 'phone' || source === 'telegram') return source;
    if (Number(data?.client) === 2) return 'steam';
    if (Number(data?.client) === 1) return 'phone';
    return '';
  }

  // UChat / UChatPinned.
  static fromLive(data) {
    return {
      id: Number(data?.messageId || 0),
      userId: Number(data?.id || 0),
      nickname: String(data?.nickname || ''),
      to: Number(data?.to || 0),
      flag: data?.flag || 0,
      star: Number(data?.star || 0),
      text: String(data?.message ?? ''),
      date: Chat.toTimestamp(data?.date) || Date.now(),
      edited: Chat.toTimestamp(data?.edited),
      pinned: Boolean(data?.pinned),
      source: Chat.sourceOf(data),
      tgTag: String(data?.tgTag || ''),
      echoId: String(data?.echoId || ''),
    };
  }

  // user.loadForumMessage.
  static fromHistory(row) {
    return {
      id: Number(row?.id || 0),
      userId: Number(row?.userId || 0),
      nickname: String(row?.nickname || ''),
      to: Number(row?.replyId || 0),
      flag: row?.flag || 0,
      star: Number(row?.star || 0),
      text: String(row?.message ?? ''),
      date: Chat.toTimestamp(row?.date),
      edited: Chat.toTimestamp(row?.edited),
      pinned: Boolean(Number(row?.pinned || 0)),
      source: Chat.sourceOf(row),
      tgTag: String(row?.tgTag || ''),
      echoId: '',
    };
  }

  static isOwn(message) {
    return Chat.myId > 0 && message.userId === Chat.myId;
  }

  static isMention(message) {
    if (Chat.isOwn(message)) return false;
    if (Chat.myId > 0 && message.to === Chat.myId) return true;
    const login = String(App?.storage?.data?.login || '').trim().toLowerCase();
    return Boolean(login) && message.text.toLowerCase().includes(`@${login}`);
  }

  static canEdit(message) {
    if (!message || !Chat.isOwn(message) || !Chat.items.has(message.id)) return false;
    if (message.source === 'telegram' && !Chat.canModerate) return false;
    return Date.now() - message.date <= Chat.EDIT_WINDOW_MS;
  }

  // ---- События сервера (events.js) ----

  static onLive(data) {
    const message = Chat.fromLive(data);
    if (!(message.id > 0)) {
      Chat.renderSystem(message);
      return;
    }
    const isNew = !Chat.items.has(message.id);
    Chat.upsert(message, true);
    if (isNew && !Chat.isOwn(message)) Chat.bumpTab('all');
    if (isNew && !Chat.isOwn(message) && !Chat.isAtBottom()) {
      Chat.unread++;
      Chat.updateJumpButton();
    }
  }

  static onPinned(data) {
    const message = Chat.fromLive(data);
    if (message.id > 0) {
      Chat.upsert(message, false);
      if (message.pinned) Chat.revealChat();
    }
  }

  static onEdited(data) {
    const id = Number(data?.id || 0);
    const known = Chat.messages.get(id);
    if (!known) return;
    Chat.upsert({ ...known, text: String(data?.message ?? known.text), edited: Chat.toTimestamp(data?.edited) || Date.now() }, false);
  }

  static onRemoved(data) {
    const id = Number(data?.id || 0);
    Chat.items.get(id)?.remove();
    Chat.items.delete(id);
    Chat.messages.delete(id);
    if (Chat.pinnedIds.delete(id)) Chat.renderPinned();
    if (Chat.editId === id) Chat.cancelCompose();
  }

  // Совместимость: старые вызовы Chat.viewMessage(UChat-данные).
  static viewMessage(data) {
    Chat.onLive(data);
  }

  // inFeed — сообщение должно быть в ленте (UChat, история); закрепы из
  // UChatPinned обновляют уже показанное, но в ленту сами не добавляются.
  static upsert(message, inFeed) {
    if (message.echoId) Chat.resolvePending(message.echoId);
    const merged = { ...(Chat.messages.get(message.id) || {}), ...message };
    Chat.messages.set(merged.id, merged);

    const existing = Chat.items.get(merged.id);
    if (existing || inFeed) {
      const element = Chat.renderMessage(merged);
      if (existing) existing.replaceWith(element);
      else Chat.insertByOrder(element, merged.id);
      Chat.items.set(merged.id, element);
    }

    const wasPinned = Chat.pinnedIds.has(merged.id);
    if (merged.pinned) Chat.pinnedIds.add(merged.id);
    else Chat.pinnedIds.delete(merged.id);
    if (wasPinned || merged.pinned) Chat.renderPinned();
  }

  // Лента — column-reverse: первый элемент DOM внизу. Порядок — по убыванию id,
  // локальные копии (ещё без id) всегда самые нижние.
  static insertByOrder(element, id) {
    const stick = Chat.isAtBottom();
    for (const child of Chat.list.children) {
      const childId = Number(child.dataset.id || 0);
      if (childId > 0 && childId < id) {
        child.before(element);
        if (stick) Chat.scroll();
        return;
      }
    }
    Chat.list.append(element);
  }

  // ---- История ----

  static async loadHistory() {
    Chat.history = { page: 0, loading: false, hasMore: true };
    await Chat.loadHistoryPage(0);
    await Chat.refreshPinned();
  }

  static async loadHistoryPage(page) {
    const ws = App.api?.WebSocket;
    if (Chat.history.loading || !ws || ws.readyState !== ws.OPEN) return;
    if (page > 0 && !Chat.history.hasMore) return;
    Chat.history.loading = true;
    try {
      const rows = await App.api.request('user', 'loadForumMessage', { category: 0, page });
      const list = Array.isArray(rows) ? rows : [];
      for (const row of list) {
        Chat.upsert(Chat.fromHistory(row), true);
      }
      if (list.length < Chat.HISTORY_PAGE_SIZE) Chat.history.hasMore = false;
      Chat.history.page = Math.max(Chat.history.page, page);
    } catch (error) {
      console.error('Failed to load chat history page', error);
    } finally {
      Chat.history.loading = false;
    }
  }

  static async refreshPinned() {
    let rows;
    try {
      rows = await App.api.request('user', 'chatPinnedList', {});
    } catch (error) {
      return; // старый бэкенд: закрепы придут через UChatPinned при подключении
    }
    if (!Array.isArray(rows)) return;
    const fresh = new Set();
    for (const row of rows) {
      const message = Chat.fromLive(row);
      if (!(message.id > 0)) continue;
      fresh.add(message.id);
      Chat.upsert({ ...message, pinned: true }, false);
    }
    for (const id of [...Chat.pinnedIds]) {
      if (!fresh.has(id)) {
        const known = Chat.messages.get(id);
        if (known) Chat.upsert({ ...known, pinned: false }, false);
      }
    }
  }

  // После переподключения: догружаем пропущенное (апдейт-режим, чанки по 25) и закрепы.
  static async onReconnect() {
    if (Chat.syncing) return;
    Chat.syncing = true;
    try {
      let cursor = Math.max(0, ...Chat.items.keys());
      if (cursor > 0) {
        for (let total = 0; total < 500; ) {
          const rows = await App.api.request('user', 'loadForumMessage', { category: 0, page: -cursor });
          const list = Array.isArray(rows) ? rows : [];
          for (const row of list) {
            const message = Chat.fromHistory(row);
            Chat.upsert(message, true);
            cursor = Math.max(cursor, message.id);
          }
          total += list.length;
          if (list.length < Chat.HISTORY_PAGE_SIZE) break;
        }
      } else {
        await Chat.loadHistoryPage(0);
      }
      await Chat.refreshPinned();
    } catch (error) {
      console.error('Failed to sync chat after reconnect', error);
    } finally {
      Chat.syncing = false;
    }
  }

  // ---- Прокрутка ----

  // column-reverse: scrollTop 0 — низ ленты, вверх — отрицательные значения.
  static isAtBottom() {
    return !Chat.list || Math.abs(Chat.list.scrollTop) <= 8;
  }

  static scroll(force = false) {
    if (!Chat.list) return;
    if (force || Chat.isAtBottom()) {
      Chat.list.scrollTo({ top: 0, behavior: force ? 'smooth' : 'auto' });
    }
    if (force) {
      Chat.unread = 0;
      Chat.updateJumpButton();
    }
  }

  // Чат сворачивается/разворачивается анимацией высоты (main.css). Нижнее видимое
  // сообщение должно оставаться на месте: запоминаем его отступ от низа ленты
  // перед изменением высоты и восстанавливаем при каждом ресайзе ленты.
  static initResizeAnchor() {
    const remember = () => {
      Chat.resizeAnchor = Chat.bottomVisibleAnchor();
    };
    Chat.body.addEventListener('mouseenter', remember);
    Chat.body.addEventListener('mouseleave', remember);
    Chat.body.addEventListener('focusin', remember);
    Chat.body.addEventListener('focusout', remember);
    Chat.list.addEventListener('wheel', () => (Chat.resizeAnchor = null), { passive: true });
    Chat.list.addEventListener('pointerdown', () => (Chat.resizeAnchor = null), { passive: true });
    Chat.body.addEventListener('transitionend', (event) => {
      if (event.target === Chat.body && event.propertyName === 'height') Chat.resizeAnchor = null;
    });
    new ResizeObserver(() => Chat.restoreResizeAnchor()).observe(Chat.list);
  }

  static bottomVisibleAnchor() {
    if (!Chat.list || Chat.isAtBottom()) return null;
    const bottom = Chat.list.getBoundingClientRect().bottom;
    // column-reverse: первые дети DOM — внизу.
    for (const child of Chat.list.children) {
      const rect = child.getBoundingClientRect();
      if (rect.top < bottom) return { element: child, offset: bottom - rect.bottom };
    }
    return null;
  }

  static restoreResizeAnchor() {
    const anchor = Chat.resizeAnchor;
    if (!anchor || !anchor.element.isConnected) return;
    const offset = Chat.list.getBoundingClientRect().bottom - anchor.element.getBoundingClientRect().bottom;
    // Сообщение ушло вверх на delta — сдвигаем ленту к старым (scrollTop отрицательный).
    Chat.list.scrollTop -= offset - anchor.offset;
  }

  static onScroll() {
    const list = Chat.list;
    if (Chat.isAtBottom() && Chat.unread) {
      Chat.unread = 0;
    }
    Chat.updateJumpButton();
    const nearTop = Math.abs(list.scrollTop) + list.clientHeight >= list.scrollHeight - 40;
    if (nearTop && Chat.history.hasMore && !Chat.history.loading) {
      Chat.loadHistoryPage(Chat.history.page + 1);
    }
  }

  static updateJumpButton() {
    if (!Chat.jumpButton) return;
    Chat.jumpButton.classList.toggle('chat-jump--visible', !Chat.isAtBottom());
    Chat.jumpButton.firstChild.textContent = Chat.unread > 0 ? `${Chat.unread > 99 ? '99+' : Chat.unread} ` : '';
  }

  // ---- Отрисовка ----

  static formatTime(ts) {
    const date = new Date(ts || Date.now());
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  static getFlagLabel(flagId) {
    const key = `flag_${flagId}`;
    const text = Lang.text(key);
    return !text || text === key ? String(flagId) : text;
  }

  // Флаг, источник, звёзды, ник — общее для ленты и закрепов.
  static renderAuthor(message) {
    const parts = [];

    if (message.flag && message.flag !== '0') {
      const flag = DOM({ tag: 'img', style: 'chat-flag', src: `content/flags/${message.flag}.png` });
      flag.dataset.tooltipSource = Chat.getFlagLabel(message.flag);
      parts.push(flag);
    }

    const sourceLabels = { phone: 'titlePhone', steam: 'titleSteamClient', telegram: 'titleTelegram' };
    if (sourceLabels[message.source]) {
      const icon = DOM({ tag: 'span', style: ['chat-source-icon', `chat-source-icon-${message.source}`] });
      icon.dataset.tooltipSource = Lang.text(sourceLabels[message.source]);
      if (message.source === 'phone') icon.append(uiIcon('phone'));
      parts.push(icon);
    }

    if (message.star > 0) {
      const star = DOM(
        { tag: 'span', style: 'chat-star' },
        DOM({ tag: 'span' }, String(message.star)),
        DOM({ tag: 'img', style: 'chat-flag', src: 'content/icons/starOrange.webp' }),
      );
      star.dataset.tooltipSource = Lang.text('titleStarsGlory');
      parts.push(star);
    }

    // Цвет роли важнее цвета звёзд: у администрации и хелперов со звёздами ник не перекрашивается.
    const nick = DOM({ tag: 'span', style: 'chat-msg-nick' }, message.nickname);
    if (message.userId === 1) {
      nick.classList.add('owner-text');
      nick.dataset.tooltipRole = Lang.text('titleOwner');
    } else if (App.isAdmin(message.userId)) {
      nick.classList.add('administration-text');
      nick.dataset.tooltipRole = Lang.text('titleAdministration');
    } else if (App.isHelper(message.userId)) {
      nick.classList.add('helper-text');
      nick.dataset.tooltipRole = Lang.text('titleHelper');
    } else if (message.star > 0) {
      nick.classList.add('chat-msg-nick--star');
    }
    parts.push(nick);

    return parts;
  }

  // Текст: ссылки — только у администрации, картинка — у владельца (сообщение-ссылка).
  static renderText(message) {
    const text = DOM({ tag: 'span', style: 'chat-msg-text' });
    if (message.userId === 1 && /^https:\/\/\S+$/.test(message.text)) {
      text.append(DOM({ tag: 'img', style: 'chat-msg-image', src: message.text }));
      return text;
    }
    if (App.isAdmin(message.userId) || message.userId === 1) {
      for (const part of message.text.split(/(https:\/\/[^\s]+)/)) {
        if (!part) continue;
        if (/^https:\/\//.test(part)) {
          const link = DOM({ tag: 'a', href: part, target: '_blank' }, part);
          link.addEventListener('click', (event) => {
            event.stopPropagation();
            NativeAPI.linkHandler(event);
          });
          text.append(link);
        } else {
          text.append(part);
        }
      }
      return text;
    }
    text.textContent = message.text;
    return text;
  }

  static renderTime(message) {
    const time = DOM(
      { tag: 'span', style: 'chat-msg-time' },
      `${Chat.formatTime(message.date)}${message.edited ? ` · ${Lang.text('chatEditedShort')}` : ''}`,
    );
    time.title = new Date(message.date || Date.now()).toLocaleString();
    return time;
  }

  static renderMessage(message) {
    const classes = ['chat-msg'];
    if (Chat.isOwn(message)) classes.push('chat-msg--own');
    if (Chat.isMention(message)) classes.push('chat-msg--mention');
    if (message.to === -1) classes.push('chat-msg--alert');
    if (Chat.pinnedIds.has(message.id) || message.pinned) classes.push('chat-msg--pinned');
    if (Chat.editId && Chat.editId === message.id) classes.push('chat-msg--editing');

    const actions = DOM({ style: 'chat-msg-actions' });
    if (Chat.canModerate && message.id > 0) {
      actions.append(Chat.actionButton(uiIcon('pin'), Chat.pinnedIds.has(message.id) ? Lang.text('chatUnpin') : Lang.text('chatPin'), () => Chat.togglePin(message.id)));
    }
    if (message.text && !(message.userId === 1 && /^https:\/\/\S+$/.test(message.text))) {
      const copy = Chat.actionButton(uiIcon('copy'), Lang.text('chatCopy'), async () => {
        await Chat.copyText(Chat.stripReplyHandle(message.text));
        copy.replaceChildren(uiIcon('check'));
        clearTimeout(copy.resetTimer);
        copy.resetTimer = setTimeout(() => copy.replaceChildren(uiIcon('copy')), 1200);
      });
      actions.append(copy);
    }
    if (message.id > 0) {
      actions.append(Chat.actionButton('⋯', Lang.text('chatActions'), () => Chat.openMenu(message.id)));
    }

    const element = DOM(
      {
        style: classes,
        domaudio: domAudioPresets.bigButton,
        event: [
          'click',
          (event) => {
            if (event.target.closest('a, button')) return;
            Chat.startReply(message.id);
          },
        ],
      },
      Chat.renderTime(message),
      ...Chat.renderAuthor(message),
      DOM({ tag: 'span', style: 'chat-msg-colon' }, ': '),
      Chat.renderText(message),
      actions,
    );
    element.dataset.id = String(message.id || '');
    element.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (message.id > 0) Chat.openMenu(message.id);
    });
    return element;
  }

  static actionButton(content, title, callback) {
    return DOM(
      {
        tag: 'button',
        style: 'chat-msg-action',
        title,
        event: [
          'click',
          (event) => {
            event.stopPropagation();
            callback();
          },
        ],
      },
      content,
    );
  }

  // Системное сообщение без id (старый формат рассылки) — только в ленту, не хранится.
  static renderSystem(message) {
    const element = DOM(
      { style: ['chat-msg', 'chat-msg--system', message.to === -1 ? 'chat-msg--alert' : 'chat-msg--info'] },
      Chat.renderTime(message),
      DOM({ tag: 'span', style: 'chat-msg-nick' }, message.nickname || 'PWClassic'),
      DOM({ tag: 'span', style: 'chat-msg-colon' }, ': '),
      DOM({ tag: 'span', style: 'chat-msg-text' }, message.text),
    );
    Chat.list.prepend(element);
    Chat.scroll();
  }

  static flash(id) {
    const element = Chat.items.get(id);
    if (!element) return false;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.classList.remove('chat-msg--flash');
    void element.offsetWidth;
    element.classList.add('chat-msg--flash');
    return true;
  }

  // ---- Закрепы ----

  static revealChat() {
    if (Chat.hide) Chat.changeChatVisibility();
  }

  static setPinnedOpen(open) {
    Chat.pinnedOpen = open && Chat.pinnedIds.size > 0;
    Chat.pinnedContainer?.classList.toggle('chat-pinned--open', Chat.pinnedOpen);
  }

  static renderPinned() {
    if (!Chat.pinnedContainer) return;

    // Новые сверху; если сообщение есть в ленте — обновляем его отметку.
    const list = [...Chat.pinnedIds].map((id) => Chat.messages.get(id)).filter(Boolean).sort((a, b) => b.id - a.id);
    // Закрепы — только у общего чата; на вкладке команды чат не растёт под них.
    Chat.body.classList.toggle('chat-has-pinned', list.length > 0 && Chat.tab === 'all');
    for (const [id, element] of Chat.items) {
      element.classList.toggle('chat-msg--pinned', Chat.pinnedIds.has(id));
    }

    if (!list.length) {
      Chat.pinnedContainer.replaceChildren();
      Chat.setPinnedOpen(false);
      return;
    }

    const latest = list[0];
    const header = DOM(
      {
        style: 'chat-pinned-header',
        event: ['click', () => Chat.setPinnedOpen(!Chat.pinnedOpen)],
      },
      uiIcon('pin'),
      DOM({ tag: 'span', style: 'chat-pinned-preview' }, DOM({ tag: 'b' }, `${latest.nickname}: `), latest.text),
      DOM({ tag: 'span', style: 'chat-pinned-count' }, String(list.length)),
    );

    const items = list.map((message) => {
      const row = DOM(
        {
          style: 'chat-pinned-item',
          event: [
            'click',
            (event) => {
              if (event.target.closest('button')) return;
              Chat.setPinnedOpen(false);
              if (!Chat.flash(message.id)) Chat.startReply(message.id);
            },
          ],
        },
        Chat.renderTime(message),
        ...Chat.renderAuthor(message),
        DOM({ tag: 'span', style: 'chat-msg-colon' }, ': '),
        Chat.renderText(message),
      );
      if (Chat.canModerate) {
        row.append(Chat.actionButton(uiIcon('cross'), Lang.text('chatUnpin'), () => Chat.togglePin(message.id)));
      }
      return row;
    });

    Chat.pinnedContainer.replaceChildren(header, DOM({ style: 'chat-pinned-list' }, ...items));
    Chat.setPinnedOpen(Chat.pinnedOpen);
  }

  static async togglePin(id) {
    const pinned = !Chat.pinnedIds.has(id);
    try {
      const result = await App.api.request('user', 'chatPin', { messageId: id, pinned, v: Chat.PROTOCOL });
      // Ответ — то же, что придёт в UChatPinned; применяем сразу, не дожидаясь рассылки.
      if (result && typeof result === 'object') Chat.onPinned(result);
    } catch (error) {
      Chat.showError(error);
    }
  }

  // ---- Меню сообщения ----

  static openMenu(id) {
    const message = Chat.messages.get(id);
    if (!message) return;

    const button = (text, callback) =>
      DOM(
        {
          style: 'splash-content-button',
          domaudio: domAudioPresets.bigButton,
          event: [
            'click',
            () => {
              Splash.hide();
              callback();
            },
          ],
        },
        text,
      );

    const nicknameLine = DOM({ id: 'friendRemoveText', style: 'chat-player-menu-nickname' }, DOM({ tag: 'span' }, message.nickname));
    nicknameLine.tabIndex = 0;
    const updateNicknameOverflow = () => {
      const overflow = Math.max(0, nicknameLine.firstChild.offsetWidth - nicknameLine.clientWidth);
      nicknameLine.style.setProperty('--nickname-scroll-distance', `${overflow}px`);
      nicknameLine.classList.toggle('chat-player-menu-nickname--overflowing', overflow > 1);
    };
    nicknameLine.addEventListener('mouseenter', updateNicknameOverflow);
    nicknameLine.addEventListener('focus', updateNicknameOverflow);

    const buttons = [button(Lang.text('chatReply'), () => Chat.startReply(id))];
    if (Chat.canEdit(message)) {
      buttons.push(button(Lang.text('chatEdit'), () => Chat.startEdit(id)));
    }
    if (message.userId > 0) {
      buttons.push(button(Lang.text('showStatistics'), () => App.openStatsProfile({ id: message.userId, login: message.nickname })));
      buttons.push(button(Lang.text('farmAudit'), () => CastleFarm.openAudit({ id: message.userId, nickname: message.nickname })));
    }
    if (Chat.canModerate) {
      buttons.push(button(Chat.pinnedIds.has(id) ? Lang.text('chatUnpin') : Lang.text('chatPin'), () => Chat.togglePin(id)));
      if (message.userId !== 1 && !Chat.isOwn(message)) {
        buttons.push(
          button(Lang.text('chatMute'), () =>
            Chat.confirm(Lang.text('chatConfirmMute').replace('${nickname}', message.nickname), () =>
              App.api.request('user', 'mute', { id: message.userId }),
            ),
          ),
        );
      }
      buttons.push(
        button(Lang.text('chatHide'), () =>
          Chat.confirm(Lang.text('chatConfirmHide'), () => App.api.request('user', 'setForumMessage', { id, object: { blocked: 1 } })),
        ),
      );
    }
    buttons.push(button(Lang.text('cancel'), () => {}));

    Splash.show(
      DOM(
        { style: 'chat-player-menu' },
        DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, Lang.text('chatTitle'))),
        nicknameLine,
        ...buttons,
      ),
    );
    requestAnimationFrame(updateNicknameOverflow);
  }

  // Обращения в начале («@ник, » из replyPrefix или просто «@ник ») — не часть текста сообщения.
  static stripReplyHandle(text) {
    const stripped = String(text || '').replace(/^(?:@[^,\n]{1,32},\s*|@\S+\s+)+/, '');
    return stripped.trim() ? stripped : String(text || '');
  }

  static async copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // В NW без фокуса окна navigator.clipboard может отказать — пишем через nw.Clipboard.
      globalThis.nw?.Clipboard?.get().set(text, 'text');
    }
  }

  static confirm(text, action) {
    const button = (label, callback) =>
      DOM(
        {
          style: 'splash-content-button',
          domaudio: domAudioPresets.bigButton,
          event: [
            'click',
            async () => {
              Splash.hide();
              try {
                await callback();
              } catch (error) {
                Chat.showError(error);
              }
            },
          ],
        },
        label,
      );
    Splash.show(
      DOM(
        { style: 'chat-player-menu' },
        DOM({ style: 'title-modal' }, DOM({ style: 'title-modal-text' }, Lang.text('chatTitle'))),
        DOM({ style: 'chat-confirm-text' }, text),
        button(Lang.text('confirm'), action),
        button(Lang.text('cancel'), () => {}),
      ),
    );
  }

  // ---- Ввод: ответ, правка, отправка ----

  static replyHandle(message) {
    if (message.source === 'telegram' && message.tgTag) return `@${message.tgTag.replace(/^@+/, '')}`;
    return `@${message.nickname.trim()}`;
  }

  static replyPrefix() {
    return Chat.reply ? `${Chat.reply.handle}, ` : '';
  }

  static startReply(id) {
    const message = Chat.messages.get(id);
    if (!message || message.userId <= 0) return;
    if (Chat.editId) Chat.cancelCompose();
    const body = Chat.field.value.startsWith(Chat.replyPrefix()) ? Chat.field.value.slice(Chat.replyPrefix().length) : Chat.field.value;
    Chat.reply = { userId: message.userId, handle: Chat.replyHandle(message) };
    Chat.field.value = `${Chat.replyPrefix()}${body}`.slice(0, Chat.MAX_LENGTH);
    Chat.focusField();
    Chat.updateCompose();
  }

  static startEdit(id) {
    const message = Chat.messages.get(id);
    if (!Chat.canEdit(message)) return;
    if (!Chat.editId) Chat.editDraft = Chat.field.value;
    Chat.items.get(Chat.editId)?.classList.remove('chat-msg--editing');
    Chat.reply = null;
    Chat.editId = id;
    Chat.items.get(id)?.classList.add('chat-msg--editing');
    Chat.field.value = message.text;
    Chat.focusField();
    Chat.updateCompose();
  }

  // Отмена ответа или правки; при правке возвращаем черновик.
  static cancelCompose() {
    if (Chat.editId) {
      Chat.items.get(Chat.editId)?.classList.remove('chat-msg--editing');
      Chat.editId = 0;
      Chat.field.value = Chat.editDraft;
      Chat.editDraft = '';
    } else if (Chat.reply) {
      const prefix = Chat.replyPrefix();
      if (Chat.field.value.startsWith(prefix)) Chat.field.value = Chat.field.value.slice(prefix.length);
      Chat.reply = null;
    }
    Chat.updateCompose();
  }

  static focusField() {
    Chat.field.focus();
    const end = Chat.field.value.length;
    Chat.field.setSelectionRange(end, end);
  }

  static updateCompose() {
    if (!Chat.banner) return;
    const length = Chat.field.value.length;
    Chat.counter.textContent = length >= Chat.COUNTER_FROM ? `${length}/${Chat.MAX_LENGTH}` : '';
    Chat.counter.classList.toggle('chat-counter--limit', length >= Chat.MAX_LENGTH);

    let label = '';
    if (Chat.editId) label = Lang.text('chatEditing');
    else if (Chat.reply) label = `${Lang.text('chatReplyTo')} ${Chat.reply.handle}`;
    Chat.banner.replaceChildren();
    Chat.banner.classList.toggle('chat-compose-banner--visible', Boolean(label));
    if (label) {
      Chat.banner.append(
        DOM({ tag: 'span' }, label),
        DOM({ tag: 'button', style: 'chat-msg-action', title: Lang.text('cancel'), event: ['click', () => Chat.cancelCompose()] }, uiIcon('cross')),
      );
    }
  }

  // Свои сообщения, доступные для правки, — новые первыми.
  static editableMessages() {
    return [...Chat.messages.values()].filter((message) => Chat.canEdit(message)).sort((a, b) => b.id - a.id);
  }

  static onFieldKeyDown(event) {
    if (App.isEnterKey(event)) {
      event.preventDefault();
      Chat.sendMessage();
      return;
    }
    if (event.key === 'Escape' && (Chat.editId || Chat.reply)) {
      event.preventDefault();
      event.stopPropagation();
      Chat.cancelCompose();
      return;
    }
    if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }
    // Стрелки листают свои сообщения для правки — из пустого поля или уже в режиме правки.
    if (Chat.tab !== 'all') return;
    if (!Chat.editId && (event.key === 'ArrowDown' || Chat.field.value.length)) return;
    const list = Chat.editableMessages();
    const index = list.findIndex((message) => message.id === Chat.editId);
    event.preventDefault();
    if (event.key === 'ArrowUp') {
      const next = list[index + 1];
      if (next) Chat.startEdit(next.id);
    } else if (index > 0) {
      Chat.startEdit(list[index - 1].id);
    } else {
      Chat.cancelCompose();
    }
  }

  static onFieldInput() {
    // Стёрли «@ник, » — это уже не ответ.
    if (Chat.reply && !Chat.field.value.startsWith(Chat.replyPrefix())) {
      Chat.reply = null;
    }
    Chat.updateCompose();
  }

  static async sendMessage() {
    if (Chat.sending) return;
    const raw = Chat.field.value;
    const text = raw.trim();
    const prefix = Chat.replyPrefix().trim();
    if (!text.length || (prefix && text === prefix)) {
      if (!Chat.editId) Chat.cancelCompose();
      return;
    }

    Chat.sending = true;
    Chat.hideError();
    try {
      if (Chat.editId) {
        await Chat.submitEdit(Chat.editId, text);
      } else {
        await (Chat.tab === 'team' ? Chat.submitTeam(text, raw) : Chat.submitNew(text, raw));
      }
    } catch (error) {
      Chat.showError(error);
    } finally {
      Chat.sending = false;
    }
  }

  static async submitEdit(id, text) {
    await App.api.request('user', 'editForumMessage', { id, body: text, v: Chat.PROTOCOL });
    const known = Chat.messages.get(id);
    Chat.editDraft = '';
    Chat.cancelCompose();
    if (known && known.text !== text) {
      Chat.upsert({ ...known, text, edited: Date.now() }, false);
    }
  }

  static async submitNew(text, raw) {
    const reply = Chat.reply;
    const echoId = `${Chat.myId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const client = NativeAPI.isSteamClient ? 2 : 0;

    const echo = Chat.renderMessage({
      id: 0,
      userId: Chat.myId,
      nickname: String(App.storage.data.login || ''),
      to: reply?.userId || 0,
      flag: 0,
      star: 0,
      text,
      date: Date.now(),
      edited: 0,
      source: Chat.sourceOf({ client }),
    });
    echo.classList.add('chat-msg--pending');
    echo.dataset.pending = '1';
    echo.title = Lang.text('chatPending');
    Chat.pending.set(echoId, echo);
    Chat.list.prepend(echo);
    Chat.scroll(true);

    Chat.reply = null;
    Chat.field.value = '';
    Chat.updateCompose();

    try {
      await App.api.request('user', 'chat', { message: text, to: reply?.userId || 0, client, echoId, v: Chat.PROTOCOL });
    } catch (error) {
      // Отказ (мьют, флуд, длина): убираем копию и возвращаем текст в поле, если там пусто.
      Chat.resolvePending(echoId);
      if (!Chat.field.value) {
        Chat.reply = reply;
        Chat.field.value = raw;
        Chat.updateCompose();
      }
      throw error;
    }
  }

  static resolvePending(echoId) {
    const echo = Chat.pending.get(echoId);
    if (!echo) return;
    echo.remove();
    Chat.pending.delete(echoId);
  }
}

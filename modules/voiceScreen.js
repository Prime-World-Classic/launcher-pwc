// Демонстрация экрана в замке для администраторов и хелперов: кнопка в панели войса, выбор любого окна
// или экрана Windows, окно просмотра у собеседников. Логика соединений — в voiceScreenHub.js.
import { DOM } from './dom.js';
import { App } from './app.js';
import { Lang } from './lang.js';
import { MM } from './mm.js';
import { uiIcon } from './uiIcon.js';
import { Voice } from './voice.js';
import { domAudioPresets } from './domAudioPresets.js';
import { ScreenShareHub } from './voiceScreenHub.js';

const CAPTURE_MAX_WIDTH = 1920;
const CAPTURE_MAX_HEIGHT = 1080;
const CAPTURE_MAX_FPS = 30;

export class VoiceScreen {
  static hubInstance = null;

  static windows = new Map(); // id показывающего -> {root, video, status, stream}

  // Была ли в панели кнопка показа при последней отрисовке (см. panelOutdated).
  static renderedCanShare = false;

  static get hub() {
    if (!VoiceScreen.hubInstance) {
      VoiceScreen.hubInstance = new ScreenShareHub({
        send: (id, message) => App.api.ghost('user', 'screenSignal', { id, ...message }),
        getIceServers: () => Voice.getIceServers(),
        capture: () => VoiceScreen.capture(),
        onChange: () => VoiceScreen.refresh(),
        onFull: () => App.notify(Lang.text('voiceScreenFull')),
        log: (event, data) => Voice.log(event, data),
      });
    }
    return VoiceScreen.hubInstance;
  }

  // Кнопка показа только у администраторов и хелперов и только в замке. API проверяет то же самое.
  static canShare() {
    return Boolean(App.isAdmin() || App.isHelper()) && !MM.isInTambur && !MM.isInBattle;
  }

  // Выбор любого окна или экрана Windows. null — игрок передумал.
  static async capture() {
    if (typeof nw !== 'undefined' && nw.Screen?.chooseDesktopMedia) {
      nw.Screen.Init();
      const sourceId = await new Promise((resolve) => nw.Screen.chooseDesktopMedia(['window', 'screen'], resolve));
      if (!sourceId) return null;
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth: CAPTURE_MAX_WIDTH,
            maxHeight: CAPTURE_MAX_HEIGHT,
            maxFrameRate: CAPTURE_MAX_FPS,
          },
        },
      });
    }
    // Лаунчер в браузере (dev-сервер, запасная сборка).
    try {
      return await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: { width: { max: CAPTURE_MAX_WIDTH }, height: { max: CAPTURE_MAX_HEIGHT }, frameRate: { max: CAPTURE_MAX_FPS } },
      });
    } catch (error) {
      if (error?.name === 'NotAllowedError') return null;
      throw error;
    }
  }

  static connectedPeerIds() {
    return Object.keys(Voice.manager)
      .map(Number)
      .filter((id) => id > 0 && Voice.manager[id]?.peer?.connectionState === 'connected');
  }

  static async toggleSharing() {
    const hub = VoiceScreen.hub;
    if (hub.sharing) {
      hub.stop();
      return;
    }
    if (!VoiceScreen.canShare()) return;
    try {
      await hub.start(VoiceScreen.connectedPeerIds());
    } catch (error) {
      Voice.log('screen-capture-error', { error: String(error) });
      App.error(Lang.text('voiceScreenCaptureError'));
    }
  }

  // Звонок с собеседником установлен: если идёт показ, он должен об этом узнать.
  static onPeerConnected(id) {
    VoiceScreen.hubInstance?.announce(id);
  }

  static onPeerGone(id) {
    VoiceScreen.hubInstance?.peerGone(id);
  }

  // Демонстрация — только в замке: перед матчем показ и просмотр заканчиваются.
  static stopForMatch() {
    VoiceScreen.hubInstance?.closeAll();
  }

  static closeAll() {
    VoiceScreen.hubInstance?.closeAll();
  }

  static async onSignal(data) {
    const id = Number(data?.id);
    if (!(id > 0)) return;
    const wasAvailable = VoiceScreen.hub.available.has(id);
    await VoiceScreen.hub.handle(id, data);
    if (data?.type === 'start' && !wasAvailable) {
      const name = Voice.manager[id]?.name || `id${id}`;
      App.notify(Lang.text('voiceScreenStarted').replace('{name}', name));
      // Панель, закрытая крестиком, скрыла бы и кнопку просмотра.
      Voice.infoPanelHiddenByUser = false;
      Voice.showInfoPanel(true);
    }
  }

  static refresh() {
    VoiceScreen.syncWindows();
    Voice.updateInfoPanel();
  }

  // Вернулись из тамбура или боя в замок: панель надо перерисовать, чтобы кнопка показа появилась снова.
  static panelOutdated() {
    return VoiceScreen.canShare() !== VoiceScreen.renderedCanShare;
  }

  // Кнопка в своей строке панели войса.
  static selfButton() {
    const hub = VoiceScreen.hubInstance;
    const sharing = Boolean(hub?.sharing);
    VoiceScreen.renderedCanShare = VoiceScreen.canShare();
    if (!sharing && !VoiceScreen.renderedCanShare) return null;
    const button = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'voice-info-panel-body-item-icon',
        event: ['click', () => VoiceScreen.toggleSharing()],
      },
      uiIcon('screen'),
    );
    button.classList.add('voice-screen-button');
    button.classList.toggle('voice-screen-button--on', sharing);
    button.dataset.tip = sharing
      ? Lang.text('voiceScreenStopTip').replace('{count}', String(hub.watcherCount))
      : Lang.text('voiceScreenStartTip');
    return button;
  }

  // Кнопка в строке собеседника, который показывает экран.
  static peerButton(id) {
    id = Number(id);
    const hub = VoiceScreen.hubInstance;
    if (!hub?.available.has(id)) return null;
    const watching = hub.viewers.has(id);
    const button = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'voice-info-panel-body-item-icon',
        event: ['click', () => (hub.viewers.has(id) ? hub.unwatch(id) : hub.watch(id))],
      },
      uiIcon('screen'),
    );
    button.classList.add('voice-screen-button', 'voice-screen-button--available');
    button.classList.toggle('voice-screen-button--on', watching);
    button.dataset.tip = Lang.text(watching ? 'voiceScreenCloseTip' : 'voiceScreenWatchTip');
    return button;
  }

  static syncWindows() {
    const hub = VoiceScreen.hubInstance;
    for (const [id, view] of VoiceScreen.windows) {
      if (hub?.viewers.has(id)) continue;
      // Соединение оборвалось, а показ ещё идёт: иначе окно просто исчезнет без объяснений.
      if (hub?.available.has(id) && view.stream) App.error(Lang.text('voiceScreenLost'));
      VoiceScreen.removeWindow(id, view);
    }
    if (!hub) return;
    for (const [id, viewer] of hub.viewers) {
      let view = VoiceScreen.windows.get(id);
      if (!view) {
        view = VoiceScreen.createWindow(id);
        VoiceScreen.windows.set(id, view);
      }
      if (viewer.stream && view.stream !== viewer.stream) {
        view.stream = viewer.stream;
        view.video.srcObject = viewer.stream;
        view.video.play?.()?.catch?.(() => {});
      }
    }
  }

  static removeWindow(id, view) {
    VoiceScreen.windows.delete(id);
    try {
      view.video.srcObject = null;
    } catch {}
    view.root.remove();
  }

  // Окно просмотра: своё, а не из Window.show — оно должно оставаться поверх замка и других окон лаунчера.
  static createWindow(id) {
    const name = Voice.manager[id]?.name || `id${id}`;
    const video = DOM({ tag: 'video', style: 'voice-screen-window-video' });
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    const status = DOM({ style: 'voice-screen-window-status' }, Lang.text('voiceScreenConnecting'));
    video.addEventListener('playing', () => status.remove());

    const toggleFullscreen = () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.()?.catch?.(() => {});
      } else {
        video.requestFullscreen?.()?.catch?.(() => {});
      }
    };
    video.addEventListener('dblclick', toggleFullscreen);

    const fullscreen = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'voice-screen-window-button',
        title: Lang.text('voiceScreenFullscreen'),
        event: ['click', toggleFullscreen],
      },
      uiIcon('screen'),
    );
    const close = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'voice-screen-window-button',
        title: Lang.text('voiceScreenCloseTip'),
        event: ['click', () => VoiceScreen.hubInstance?.unwatch(id)],
      },
      uiIcon('cross'),
    );
    const title = DOM(
      { style: 'voice-screen-window-title' },
      DOM({ style: 'voice-screen-window-name' }, Lang.text('voiceScreenTitle').replace('{name}', name)),
      fullscreen,
      close,
    );
    const root = DOM({ style: 'voice-screen-window' }, title, DOM({ style: 'voice-screen-window-body' }, video, status));
    VoiceScreen.enableDrag(root, title);
    document.body.append(root);
    // Следующее окно — со сдвигом, чтобы не легло ровно поверх первого.
    const shift = VoiceScreen.windows.size * 3;
    root.style.left = `calc(${root.offsetLeft}px + ${shift}vh)`;
    root.style.top = `calc(${root.offsetTop}px + ${shift}vh)`;
    return { root, video, status, stream: null };
  }

  static enableDrag(root, handle) {
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('.voice-screen-window-button')) return;
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      const shiftX = event.clientX - rect.left;
      const shiftY = event.clientY - rect.top;
      handle.setPointerCapture?.(event.pointerId);
      const onMove = (move) => {
        // Заголовок не должен уехать за край окна лаунчера: за него окно и вытаскивают обратно.
        const maxLeft = window.innerWidth - rect.width;
        const maxTop = window.innerHeight - handle.offsetHeight;
        root.style.left = `${Math.max(0, Math.min(maxLeft, move.clientX - shiftX))}px`;
        root.style.top = `${Math.max(0, Math.min(maxTop, move.clientY - shiftY))}px`;
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }
}

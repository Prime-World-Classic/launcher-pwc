import { DOM } from './dom.js';
import { App } from './app.js';
import { Settings } from './settings.js';
import { Sound } from './sound.js';
import { Castle } from './castle.js';
import { Lang } from './lang.js';
import { domAudioPresets } from './domAudioPresets.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';
import { normalizeKey } from './keybindings/keybindings.input.js';
import { MM } from './mm.js';
import { uiIcon } from './uiIcon.js';
import { NativeAPI } from './nativeApi.js';
import { VoiceScreen } from './voiceScreen.js';

export class Voice {
  static peerConnectionConfig = {
    // проверка stun https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
    // TURN добавляется перед звонком: временный логин выдаёт API (user.turnCredentials), см. applyIceServers.
    iceServers: [
      { urls: ['stun:pw-classic-backup.ru:3478'] },
      /*
			{url:'turn:192.158.29.39:3478?transport=udp',credential:'JZEOEt2V3Qb0y27GRntt2u2PAYA=',username:'28224511:1379330808'},
			{url:'turn:192.158.29.39:3478?transport=tcp',credential:'JZEOEt2V3Qb0y27GRntt2u2PAYA=',username:'28224511:1379330808'},
			{url:'turn:turn.bistri.com:80',credential:'homeo',username:'homeo'},
			{url:'turn:turn.anyfirewall.com:443?transport=tcp',credential:'webrtc',username:'webrtc'}
			*/
    ],
  };

  static turnIceServers = null;

  static turnExpiresAt = 0;

  static turnPromise = null;

  // Временные TURN-логины от API. Кэш, пока до истечения больше часа; параллельные звонки
  // ждут один запрос. Ошибка (старый API, таймаут) — звоним только через STUN.
  static async getIceServers() {
    if (Voice.turnIceServers && Date.now() < Voice.turnExpiresAt - 3600000) {
      return Voice.turnIceServers;
    }

    if (!Voice.turnPromise) {
      Voice.turnPromise = App.api
        .request('user', 'turnCredentials', {})
        .then((result) => {
          const servers = Array.isArray(result?.iceServers) ? result.iceServers : null;
          const ttl = Number(result?.ttl) || 0;

          if (servers && ttl > 0) {
            Voice.turnIceServers = servers;
            Voice.turnExpiresAt = Date.now() + ttl * 1000;
          }

          return servers || Voice.peerConnectionConfig.iceServers;
        })
        .catch((error) => {
          Voice.log('turn-error', { error: String(error) });

          return Voice.peerConnectionConfig.iceServers;
        })
        .finally(() => {
          Voice.turnPromise = null;
        });
    }

    // Медленный API не должен съедать 15-секундный таймаут звонка.
    return await Promise.race([
      Voice.turnPromise,
      new Promise((resolve) => setTimeout(() => resolve(Voice.peerConnectionConfig.iceServers), 5000)),
    ]);
  }

  // До setLocalDescription: сбор ICE-кандидатов начнётся уже с TURN.
  async applyIceServers() {
    const iceServers = await Voice.getIceServers();

    if (!this.peer || this.peer.signalingState === 'closed') return;

    try {
      this.peer.setConfiguration({ ...this.peer.getConfiguration(), iceServers });
    } catch (error) {
      Voice.log('turn-apply-error', { id: Number(this.id), error: String(error) });
    }
  }

  static mediaAudioConfigManual = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 44100,
    sampleSize: 16,
  };

  static mediaAudioConfigHighQality = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 32000,
    sampleSize: 16,
  };

  static mediaAudioConfig = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 16000,
    sampleSize: 16,
  };

  static mediaAudioConfigLowQality = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: false,
    channelCount: 1,
    sampleRate: 8000,
    sampleSize: 16,
  };

  static userMedia = null;

  static micUnavailable = false;
  static micUnavailableNotified = false;

  static localMediaPromise = null;

  static reacquireMicPromise = null;

  static deviceChangeListening = false;

  static rawMic = null;

  static mic = null;

  static processingContext = null;

  static processingInput = null;

  static processingGain = null;

  static processingCompressor = null;

  static processingDestination = null;

  static manager = new Object();

  static infoPanel = null;

  // «?» в углу панели: при наведении на панель показываются подсказки по управлению
  static infoPanelHelp = null;

  static panelPositionFrame = 0;

  static infoPanelHiddenByUser = false;

  static cacheCandidate = new Object();

  static limit = 10;

  static volumeLevel = 1.0;

  static reconnectJobs = new Map();

  static mergeAutoAcceptUntil = new Map();
  
  static battleSuspendedPeers = new Map();

  static battleSuspendedAt = 0;

  // Союзники по матчу, с которыми звонок друзей шёл ещё до матча (он не ставится на паузу).
  // Если связь с ними оборвётся в бою, их переподключение надо пустить — иначе звонок
  // вернулся бы только после боя.
  static battleFriendAllies = new Set();

  static battleSuspendMaxMs = 3 * 60 * 1000;

  // Матч, в котором звонки не рвём: 1×1 (союзников нет — иначе пауза сбросила бы всех)
  // и любой матч тестового клиента. Ставится при «Матч найден» и в лобби, сбрасывается
  // вместе с паузой (restoreSuspendedBattlePeers).
  static battleKeepCalls = false;

  static mutedPeers = new Set();
  
  static mutedByPeers = new Set();
  
  static panelMeterStops = new Set();
  
  static peerSettingsStorageKey = 'voice-peer-settings-v1';
  
  static peerSettingsLoaded = false;
  
  static peerSettings = {};
  
  static playbackContext = null;

  static reconnectPlanMs = [2000, 5000, 10000, 15000, 20000];

  // Срок переподключения вне матча. С союзником в матче попытки идут до конца матча (isMatchVoicePeer).
  static reconnectMaxDurationMs = 15 * 60 * 1000;

  // Запись собеседника, которая столько не может соединиться, считается зависшей: её заменит новый звонок.
  static reconnectBusyMaxMs = 45 * 1000;

  // Сколько ждать звонка союзника, который должен позвонить первым, прежде чем позвонить ему самим.
  static matchCalleeWaitMs = 20 * 1000;

  static reconnectDisconnectedGraceMs = 3000;

  static radioHotkeyListenersBound = false;

  static radioPressedByKeyboard = false;

  static radioPulseTimer = null;

  static logQueue = Promise.resolve();

  // Выбор игрока «микрофон включён» (Ctrl+Z) живёт до выхода из лаунчера: sessionStorage
  // переживает перезагрузку страницы после фонового обновления, но не перезапуск. Раньше микрофон
  // выключался сам, когда заканчивались звонки, при бое и при новом микрофоне — и каждый раз
  // приходилось снова жать Ctrl+Z.
  static micWantedStorageKey = 'voice-mic-wanted';

  static getMicWanted() {
    try {
      return sessionStorage.getItem(Voice.micWantedStorageKey) === '1';
    } catch {
      return false;
    }
  }

  static setMicWanted(wanted) {
    try {
      if (wanted) sessionStorage.setItem(Voice.micWantedStorageKey, '1');
      else sessionStorage.removeItem(Voice.micWantedStorageKey);
    } catch {}
  }

  // Журнал войса (voice.log рядом с лаунчером, с лимитом размера): звонки, входящие и решения
  // по ним, переподключения, бой. Нужен, чтобы разбирать сбои, которые воспроизводятся только
  // у живых игроков (восстановление после боя и т.п.).
  static log(event, data = {}) {
    let payload = '';
    try {
      payload = JSON.stringify(data);
    } catch {}
    const self = Number(App.storage?.data?.id || 0);
    const line = `[${new Date().toISOString()}] me=${self} ${event} ${payload}\n`;
    console.log('[voice]', event, data);
    if (!NativeAPI.status) return;
    Voice.logQueue = Voice.logQueue.then(() => NativeAPI.cappedAppend('voice.log', line)).catch(() => {});
  }

  static getReconnectToken(id, key) {
    return `${String(key || '')}:${Number(id) || 0}`;
  }

  static markMergeAutoAccept(id, ttlMs = 20000) {
    const targetId = Number(id);
    if (!Number.isFinite(targetId) || targetId <= 0) return;
    Voice.mergeAutoAcceptUntil.set(targetId, Date.now() + Math.max(1000, Number(ttlMs) || 20000));
  }

  static consumeMergeAutoAccept(id) {
    const targetId = Number(id);
    if (!Number.isFinite(targetId) || targetId <= 0) return false;
    const until = Voice.mergeAutoAcceptUntil.get(targetId);
    if (!until) return false;
    Voice.mergeAutoAcceptUntil.delete(targetId);
    return until >= Date.now();
  }

  static shouldAutoReconnectKey(key) {
    return !!key;
  }

  static ensurePeerSettingsLoaded() {
    if (Voice.peerSettingsLoaded) return;
    Voice.peerSettingsLoaded = true;
    try {
      const raw = localStorage.getItem(Voice.peerSettingsStorageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      Voice.peerSettings = parsed && typeof parsed === 'object' ? parsed : {};
      for (const idText of Object.keys(Voice.peerSettings)) {
        const id = Number(idText);
        if (!Number.isFinite(id) || id <= 0) continue;
        if (Voice.peerSettings[idText]?.muted === true) {
          Voice.mutedPeers.add(id);
        }
      }
    } catch {
      Voice.peerSettings = {};
    }
  }

  static savePeerSettings() {
    try {
      localStorage.setItem(Voice.peerSettingsStorageKey, JSON.stringify(Voice.peerSettings));
    } catch {}
  }

  static getPeerSettings(id) {
    Voice.ensurePeerSettingsLoaded();
    const targetId = Number(id);
    if (!Number.isFinite(targetId) || targetId <= 0) return null;
    const key = String(targetId);
    if (!Voice.peerSettings[key] || typeof Voice.peerSettings[key] !== 'object') {
      Voice.peerSettings[key] = {};
    }
    return Voice.peerSettings[key];
  }

  static getPeerVolumePercent(id) {
    const peerSettings = Voice.getPeerSettings(id);
    if (!peerSettings) return 50;
    if (Number.isFinite(Number(peerSettings.volumePercent))) {
      return Math.max(10, Math.min(100, Math.round(Number(peerSettings.volumePercent))));
    }
    return 50;
  }

  static setPeerVolumePercent(id, percent = 50) {
    const targetId = Number(id);
    if (!Number.isFinite(targetId) || targetId <= 0) return;
    const value = Math.max(10, Math.min(100, Math.round(Number(percent) || 0)));
    const peerSettings = Voice.getPeerSettings(targetId);
    if (!peerSettings) return;
    peerSettings.volumePercent = value;
    Voice.savePeerSettings();
    Voice.applyPeerOutputVolume(targetId);
  }

  static peerPercentToGain(percent = 50) {
    // 50% is baseline (x1). 100% is boost (x2).
    return Math.max(0, Math.min(2, Number(percent || 0) / 50));
  }

  static ensurePlaybackContext() {
    if (Voice.playbackContext) {
      if (Voice.playbackContext.state === 'suspended') {
        Voice.playbackContext.resume().catch(() => {});
      }
      return Voice.playbackContext;
    }
    try {
      Voice.playbackContext = new AudioContext();
      if (Voice.playbackContext.state === 'suspended') {
        Voice.playbackContext.resume().catch(() => {});
      }
    } catch {
      Voice.playbackContext = null;
    }
    return Voice.playbackContext;
  }

  static applyPeerOutputVolume(id) {
    const targetId = Number(id);
    if (!Number.isFinite(targetId) || targetId <= 0) return;
    const target = Voice.manager?.[targetId];
    if (!target) return;
    const peerGain = Voice.peerPercentToGain(Voice.getPeerVolumePercent(targetId));
    const globalGain = Math.max(0, Math.min(1, Number(Voice.volumeLevel) || 0));
    const gain = peerGain * globalGain;
    const effectiveGain = Voice.isPeerSilenced(targetId) ? 0 : gain;
    if (target.playbackGain) {
      try {
        target.playbackGain.gain.value = effectiveGain;
      } catch {}
    }
    if (target.controller) {
      if (target.playbackGain) {
        target.controller.muted = true;
      } else {
        target.controller.muted = Voice.isPeerSilenced(targetId);
        target.controller.volume = Math.max(0, Math.min(1, effectiveGain));
      }
    }
  }

  static isPeerMuted(id) {
    Voice.ensurePeerSettingsLoaded();
    const targetId = Number(id);
    return Number.isFinite(targetId) && targetId > 0 && Voice.mutedPeers.has(targetId);
  }

  // Настройка «Мут всех и себя» (ключ novoice остался от прежней «Выключить войс чат»): звонки
  // матча соединяются как обычно, но собеседники и свой микрофон начинают заглушёнными. Снять мут
  // можно как обычно — кнопкой динамика у игрока (в панели и в оверлее боя) и Ctrl+Z; на
  // следующий матч все снова в муте (resetMutedAllForMatch). Не глушим звонки друзьям: в них
  // заходят сами, и тиммейт, с которым говорили ещё до матча, остаётся в этом звонке —
  // его слышно, и свой микрофон тогда тоже не выключаем. Личный мут собеседников (сохраняется)
  // не трогаем — после снятия галочки всё как было.
  static mutedAllUnmuted = new Set();

  static isMutedAll() {
    return Boolean(Settings.settings?.novoice);
  }

  static isInMatch() {
    return Boolean(MM.isInTambur || MM.isInBattle);
  }

  // Союзник текущего матча: звонок этого матча или звонок друзей, который шёл с ним ещё до матча.
  // Связь с ним восстанавливают обе стороны и без ограничения по времени, пока матч не закончится.
  static isMatchVoicePeer(id, key) {
    if (!Voice.isInMatch() && !Voice.isBattleSuspendActive()) return false;
    const callKey = String(key || '');
    return (callKey !== '' && callKey === String(MM.id || '')) || Voice.isBattleFriendAlly(id);
  }

  static isMutedAllTarget(id) {
    if (!Voice.isMutedAll() || Voice.mutedAllUnmuted.has(Number(id))) return false;
    const target = Voice.manager[Number(id)];
    return !target || !Voice.isFriendScopedConnection(target);
  }

  static isPeerSilenced(id) {
    return Voice.isPeerMuted(id) || Voice.isMutedAllTarget(id);
  }

  // Свой микрофон при первом звонке: в матче под «Мут всех и себя» — выключен.
  static getInitialMicEnabled() {
    if (Settings.settings?.voiceRadioMode) return false;
    if (Voice.isMutedAll() && Voice.isInMatch()) return false;
    return Voice.getMicWanted();
  }

  static hasFriendCall(allySet = null) {
    return Object.keys(Voice.manager).some(
      (id) => Voice.isFriendScopedConnection(Voice.manager[id]) && (!allySet || allySet.has(Number(id))),
    );
  }

  static refreshMutedAll() {
    for (const id in Voice.manager) {
      Voice.applyPeerOutputVolume(id);
    }
    Voice.updateInfoPanel();
  }

  static setMutedAll(muted) {
    Settings.settings.novoice = Boolean(muted);
    Voice.mutedAllUnmuted.clear();
    if (Voice.mic) {
      if (!Voice.isMutedAll()) {
        Voice.mic.enabled = !Settings.settings?.voiceRadioMode && Voice.getMicWanted();
      } else if (Voice.isInMatch() && !Voice.hasFriendCall()) {
        Voice.mic.enabled = false;
      }
    }
    Voice.refreshMutedAll();
  }

  static resetMutedAllForMatch(allyIds = []) {
    Voice.mutedAllUnmuted.clear();
    if (!Voice.isMutedAll()) return;
    const allySet = new Set(allyIds.map(Number));
    if (Voice.mic && !Voice.hasFriendCall(allySet)) {
      Voice.mic.enabled = false;
    }
    Voice.log('mute-all-match', { keepMic: Boolean(Voice.mic?.enabled) });
    Voice.refreshMutedAll();
  }

  static setPeerMuted(id, muted = true) {
    const targetId = Number(id);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return;
    }
    if (muted) {
      Voice.mutedPeers.add(targetId);
    } else {
      Voice.mutedPeers.delete(targetId);
    }
    const peerSettings = Voice.getPeerSettings(targetId);
    if (peerSettings) {
      peerSettings.muted = Boolean(muted);
      Voice.savePeerSettings();
    }
    Voice.applyPeerOutputVolume(targetId);
  }

  static togglePeerMuted(id) {
    const targetId = Number(id);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return;
    }
    const nextMuted = !Voice.isPeerSilenced(targetId);
    const target = Voice.manager[targetId];
    if (Voice.isMutedAll() && !(target && Voice.isFriendScopedConnection(target))) {
      // Под «Мут всех и себя» снятие/возврат мута живёт до конца матча и не меняет личный мут.
      if (nextMuted) {
        Voice.mutedAllUnmuted.delete(targetId);
      } else {
        Voice.mutedAllUnmuted.add(targetId);
      }
      if (!nextMuted && Voice.isPeerMuted(targetId)) {
        Voice.setPeerMuted(targetId, false);
      } else {
        Voice.applyPeerOutputVolume(targetId);
      }
    } else {
      Voice.setPeerMuted(targetId, nextMuted);
    }
    App.api
      .ghost('user', 'callMuteState', {
        id: targetId,
        muted: nextMuted ? 1 : 0,
      })
      .catch(() => {});
    Voice.updateInfoPanel();
  }

  static isMutedByPeer(id) {
    const targetId = Number(id);
    return Number.isFinite(targetId) && targetId > 0 && Voice.mutedByPeers.has(targetId);
  }

  static setMutedByPeer(id, muted = true) {
    const targetId = Number(id);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return;
    }
    if (muted) {
      Voice.mutedByPeers.add(targetId);
    } else {
      Voice.mutedByPeers.delete(targetId);
    }
    Voice.updateInfoPanel();
  }

  static stopPanelMeters() {
    for (const stop of Voice.panelMeterStops) {
      try {
        stop?.();
      } catch {}
    }
    Voice.panelMeterStops.clear();
  }

  static isFriendScopedConnection(target) {
    const key = String(target?.key || '');
    if (key === 'friend') {
      return true;
    }
    // Backward compatibility: old friend calls could arrive without key.
    return !key && Boolean(target?.important);
  }

  static stopReconnectJob(id, key) {
    const token = Voice.getReconnectToken(id, key);
    const job = Voice.reconnectJobs.get(token);
    if (!job) return;
    Voice.log('reconnect-stop', { id: job.id, key: job.key, attempts: job.attempt });
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    Voice.reconnectJobs.delete(token);
    Voice.hideInfoPanelIfIdle();
  }

  static getReconnectJob(id, key) {
    const token = Voice.getReconnectToken(id, key);
    return Voice.reconnectJobs.get(token) || null;
  }

  static hasReconnectJob(id) {
    const targetId = Number(id);
    return Array.from(Voice.reconnectJobs.values()).some((job) => job.id === targetId);
  }

  // Матч закончился или отменён: звонить союзникам по его ключу больше незачем.
  static stopMatchReconnectJobs(exceptKey = '') {
    for (const job of Array.from(Voice.reconnectJobs.values())) {
      if (job.key !== 'friend' && job.key !== exceptKey) {
        Voice.stopReconnectJob(job.id, job.key);
      }
    }
  }

  static getInfoPanelBody() {
    return Voice.infoPanel?.querySelector?.('.voice-info-panel-body') || null;
  }

  // Панель видна всегда — сразу после входа, со своим ником, даже если никому не звонили, в любом
  // режиме (и в рации). Прячет её только «Мут всех и себя»; звонок с другом под ним идёт дальше,
  // поэтому с ним панель остаётся. Крестик прячет панель до следующего звонка или нажатия
  // клавиши войса.
  static shouldShowInfoPanel() {
    if (!Voice.isLoggedInView()) return false;
    if (!Voice.isMutedAll()) return true;
    return Voice.hasFriendCall();
  }

  // Voice.init вызывается и до входа: на экране авторизации панели (с пустым ником) нет.
  static viewMethod = '';
  static infoPanelLogin = null;

  static isLoggedInView() {
    return Number(App.storage?.data?.id) > 0 && Voice.viewMethod !== 'authorization';
  }

  // View.show: сменился экран (вход, выход из аккаунта). Сменился ник — панель перерисовывается.
  static onViewShown(method) {
    Voice.viewMethod = String(method || '');
    if (!Voice.infoPanel) return;
    const login = String(App.storage?.data?.login || '');
    if (Voice.infoPanelLogin !== login || VoiceScreen.panelOutdated()) {
      Voice.updateInfoPanel();
    } else {
      Voice.syncInfoPanel();
    }
  }

  static showInfoPanel(force = false) {
    if (!Voice.infoPanel) return;
    if (!force && Voice.infoPanelHiddenByUser) return;
    if (!Voice.shouldShowInfoPanel()) return;
    if (!Voice.getInfoPanelBody()?.firstChild) {
      Voice.updateInfoPanel();
    }
    Voice.infoPanel.style.display = 'flex';
  }

  // Видимость по shouldShowInfoPanel в обе стороны: сняли «Мут всех и себя» — панель вернулась.
  static syncInfoPanel() {
    if (!Voice.infoPanel) return;
    if (Voice.shouldShowInfoPanel()) {
      if (!Voice.infoPanelHiddenByUser) Voice.infoPanel.style.display = 'flex';
      return;
    }
    Voice.infoPanel.style.display = 'none';
  }

  static hideInfoPanelIfIdle() {
    if (!Voice.infoPanel || Voice.shouldShowInfoPanel()) return;
    Voice.infoPanel.style.display = 'none';
  }

  static stopAllReconnectJobs() {
    for (const job of Voice.reconnectJobs.values()) {
      if (job.timer) {
        clearTimeout(job.timer);
        job.timer = null;
      }
    }
    Voice.reconnectJobs.clear();
    Voice.hideInfoPanelIfIdle();
  }

  static ensureReconnectJob(id, key, name = '', important = false, initialDelayMs = 0) {
    if (!Voice.shouldAutoReconnectKey(key)) return;
    const token = Voice.getReconnectToken(id, key);
    if (Voice.reconnectJobs.has(token)) return;
    const job = {
      id: Number(id),
      key: String(key || ''),
      name: String(name || ''),
      important: Boolean(important),
      attempt: 0,
      startedAt: Date.now(),
      busySince: 0,
      timer: null,
      activeCallAttempt: false,
    };
    Voice.reconnectJobs.set(token, job);
    Voice.log('reconnect-start', { id: job.id, key: job.key, delay: Number(initialDelayMs) || 0 });
    const run = async () => {
      const current = Voice.reconnectJobs.get(token);
      if (!current) return;
      if (Voice.isMatchVoicePeer(current.id, current.key)) {
        current.startedAt = Date.now();
      }
      if (Date.now() - current.startedAt > Voice.reconnectMaxDurationMs) {
        Voice.log('reconnect-expired', { id: current.id });
        Voice.stopReconnectJob(current.id, current.key);
        return;
      }
      const existing = Voice.manager[current.id];
      if (existing && existing.peer && existing.peer.connectionState !== 'closed') {
        // Соединение уже есть, возможно под другим ключом (звонок друзей с союзником по матчу).
        if (existing.peer.connectionState === 'connected') {
          Voice.stopReconnectJob(current.id, current.key);
          return;
        }
        current.busySince = current.busySince || Date.now();
        if (Date.now() - current.busySince <= Voice.reconnectBusyMaxMs) {
          const delayBusy = Voice.reconnectPlanMs[Math.min(current.attempt, Voice.reconnectPlanMs.length - 1)];
          Voice.log('reconnect-busy', { id: current.id, state: existing.peer.connectionState, signaling: existing.peer.signalingState });
          current.timer = setTimeout(run, delayBusy);
          return;
        }
        // Принятый звонок сам по себе не закрывается: без этого задача ждала бы его вечно.
        Voice.log('reconnect-stale', { id: current.id, state: existing.peer.connectionState, signaling: existing.peer.signalingState });
        existing.close({ keepReconnect: true });
      }
      current.busySince = 0;
      let voice = null;
      try {
        current.activeCallAttempt = true;
        Voice.log('reconnect-attempt', { id: current.id, attempt: current.attempt + 1 });
        voice = new Voice(current.id, current.key, current.name, current.important);
        await voice.call({ reconnect: 1 });
      } catch (error) {
        Voice.log('reconnect-attempt-error', { id: current.id, error: String(error) });
        try {
          voice?.close({ keepReconnect: true });
        } catch {}
      } finally {
        current.activeCallAttempt = false;
      }
      current.attempt += 1;
      const delay = Voice.reconnectPlanMs[Math.min(current.attempt, Voice.reconnectPlanMs.length - 1)];
      current.timer = setTimeout(run, delay);
    };
    job.timer = setTimeout(run, Math.max(0, Number(initialDelayMs) || 0));
  }

  static init() {
    if (!Voice.infoPanel) {
      const closeButton = DOM(
        {
          tag: 'div',
          style: ['close-button', 'voice-info-panel-close'],
          domaudio: domAudioPresets.defaultButton,
          event: [
            'click',
            () => {
              Voice.infoPanelHiddenByUser = true;
              if (Voice.infoPanel) Voice.infoPanel.style.display = 'none';
            },
          ],
        },
      );
      closeButton.style.backgroundImage = 'url(content/icons/close-cropped.svg)';
      Voice.infoPanelHelp = DOM({ style: 'voice-info-panel-help', hidden: true }, '?');
      Voice.infoPanel = DOM(
        { style: ['voice-info-panel', 'left-offset-with-shift'] },
        closeButton,
        Voice.infoPanelHelp,
        DOM({ style: 'voice-info-panel-body' }),
      );
      // Место панели зависит от открытых окон и размера окна лаунчера (updatePanelPosition)
      window.addEventListener('resize', () => Voice.schedulePanelPosition());
      // Подстраховка: окно билда появилось или пропало (открытие, закрытие, движение окна сами зовут
      // updatePanelPosition). Не на любую правку DOM: каждая заставляла пересчитать раскладку тяжёлого
      // окна билда (getBoundingClientRect) — пролаги при наведении на таланты, прокрутке, переносе.
      new MutationObserver((records) => {
        if (records.some(Voice.isBuildWindowMutation)) Voice.schedulePanelPosition();
      }).observe(document.body, { childList: true, subtree: true });
    }

    document.body.append(Voice.infoPanel);

    // Панель со своим ником — сразу после входа, а не с первым звонком.
    Voice.showInfoPanel();

    Voice.ensureRadioHotkeyListeners();

    requestAnimationFrame(() => Voice.updatePanelPosition());
  }

  static getVoiceToggleTokens() {
    const fallback = ['CTRL', 'Z'];
    const tokens = Array.isArray(Settings.settings?.voiceToggleHotkey) ? Settings.settings.voiceToggleHotkey : fallback;
    const cleaned = tokens.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
    return cleaned.length ? cleaned : fallback;
  }

  static tokensEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (String(a[i]) !== String(b[i])) return false;
    }
    return true;
  }

  static eventMatchesVoiceToggleHotkey(event) {
    const expected = Voice.getVoiceToggleTokens();
    if (!expected.length) return false;
    const actual = normalizeKey(event);
    return Voice.tokensEqual(expected, Array.isArray(actual) ? actual : []);
  }

  static async setMicEnabled(enabled) {
    if (!Voice.userMedia || !Voice.mic) {
      await Voice.initLocalMedia();
    }
    if (!Voice.mic) {
      if (enabled) Voice.notifyMicUnavailable();
      return;
    }
    if (Voice.mic.enabled === Boolean(enabled)) return;
    Voice.mic.enabled = Boolean(enabled);
    Voice.updateInfoPanel();
  }

  static async setRadioPressed(pressed) {
    if (!Settings.settings?.voiceRadioMode) return;
    const next = Boolean(pressed);
    if (Voice.radioPressedByKeyboard === next) return;
    Voice.radioPressedByKeyboard = next;
    if (next) {
      // Нажали рацию — панель открывается, даже закрытая крестиком (как Ctrl+Z в обычном режиме).
      Voice.infoPanelHiddenByUser = false;
      await Voice.setMicEnabled(true);
      Voice.showInfoPanel(true);
      return;
    }
    await Voice.setMicEnabled(false);
  }

  // Переключатель «Режим рации». Раньше менялся только флаг: включённый в обычном режиме микрофон
  // так и оставался включённым (говорили всё время), а панель тут же пряталась и больше не
  // появлялась. В рации микрофон включён только пока зажата клавиша; при выходе из рации —
  // как выбрал игрок в обычном режиме (Ctrl+Z).
  static setRadioMode(enabled) {
    Settings.settings.voiceRadioMode = Boolean(enabled);
    Voice.clearRadioPulseTimer();
    Voice.radioPressedByKeyboard = false;
    if (Voice.mic) {
      Voice.mic.enabled = Voice.getInitialMicEnabled();
    }
    Voice.updateInfoPanel();
    Voice.showInfoPanel();
  }

  static clearRadioPulseTimer() {
    if (!Voice.radioPulseTimer) return;
    clearTimeout(Voice.radioPulseTimer);
    Voice.radioPulseTimer = null;
  }

  static async pulseRadioTalk(durationMs = 700) {
    if (!Settings.settings?.voiceRadioMode) return;
    if (Voice.radioPressedByKeyboard) return;
    await Voice.setMicEnabled(true);
    Voice.clearRadioPulseTimer();
    Voice.radioPulseTimer = setTimeout(async () => {
      Voice.radioPulseTimer = null;
      if (Voice.radioPressedByKeyboard) return;
      await Voice.setMicEnabled(false);
    }, Math.max(120, Number(durationMs) || 700));
  }

  static ensureRadioHotkeyListeners() {
    if (Voice.radioHotkeyListenersBound) return;
    Voice.radioHotkeyListenersBound = true;

    document.addEventListener('keydown', async (event) => {
      if (!Settings.settings?.voiceRadioMode) return;
      if (event.repeat) return;
      if (!Voice.eventMatchesVoiceToggleHotkey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      Voice.clearRadioPulseTimer();
      await Voice.setRadioPressed(true);
    });

    document.addEventListener('keyup', async (event) => {
      if (!Settings.settings?.voiceRadioMode) return;
      if (!Voice.radioPressedByKeyboard) return;
      const keyUpper = String(event.key || '').trim().toUpperCase();
      const isModifierRelease = keyUpper === 'CONTROL' || keyUpper === 'ALT' || keyUpper === 'SHIFT' || keyUpper === 'META';
      const isMainRelease = Voice.eventMatchesVoiceToggleHotkey(event);
      if (!isModifierRelease && !isMainRelease) return;
      Voice.clearRadioPulseTimer();
      await Voice.setRadioPressed(false);
    });

    window.addEventListener('blur', async () => {
      Voice.clearRadioPulseTimer();
      Voice.radioPressedByKeyboard = false;
      if (Settings.settings?.voiceRadioMode) {
        await Voice.setMicEnabled(false);
      }
    });
  }

  // Клавиша войса от наблюдателя клавиш (NativeAPI, PW_KeyWatch): приходит и нажатие,
  // и отпускание в любом окне. Рация говорит, пока клавиша зажата; иначе — вкл/выкл
  // микрофона по нажатию. В бою игра шлёт свой "ptt" той же клавиши — setRadioPressed
  // повторное нажатие/отпускание пропускает.
  static async handleVoiceToggleKey(pressed) {
    if (Settings.settings?.voiceRadioMode) {
      Voice.clearRadioPulseTimer();
      await Voice.setRadioPressed(pressed);
      return;
    }
    if (pressed) await Voice.toggleEnabledMic();
  }

  // Запасной путь — nw.Shortcut: приходит только нажатие, рация включается импульсом.
  static async handleVoiceToggleHotkey() {
    if (Settings.settings?.voiceRadioMode) {
      await Voice.pulseRadioTalk(700);
      return;
    }
    await Voice.toggleEnabledMic();
  }

  static async initLocalMedia() {
    if (Voice.userMedia) {
      return;
    }
    // Two calls started before getUserMedia resolves must share one mic; otherwise the second
    // overwrites Voice.mic and the first peer keeps a track that Ctrl+Z no longer controls.
    if (!Voice.localMediaPromise) {
      Voice.localMediaPromise = Voice.initLocalMediaOnce().finally(() => {
        Voice.localMediaPromise = null;
      });
    }
    return Voice.localMediaPromise;
  }

  static async initLocalMediaOnce() {
    try {
      Voice.userMedia = await Voice.openMicStream();
    } catch (error) {
      return Voice.onMicUnavailable(error?.name || error);
    }

    let tracks = new Array();

    try {
      tracks = Voice.userMedia.getTracks();
    } catch (error) {
      return Voice.onMicUnavailable(error?.name || error);
    }

    if (!tracks.length) {
      return Voice.onMicUnavailable('no-tracks');
    }

    if (tracks[0].kind != 'audio') {
      return Voice.onMicUnavailable('not-audio');
    }

    Voice.micUnavailable = false;
    Voice.micUnavailableNotified = false;
    Voice.rawMic = tracks[0];
    Voice.watchRawMic(Voice.rawMic);

    try {
      const processedTrack = Voice.ensureMicProcessing();
      Voice.connectMicInput(Voice.rawMic);
      Voice.mic = processedTrack || Voice.rawMic;
    } catch (error) {
      console.log('Voice DSP init failed, fallback to raw mic:', error);
      Voice.mic = Voice.rawMic;
    }

    if (Voice.mic) {
      // В режиме рации микрофон включается только удержанием клавиши.
      Voice.mic.enabled = Voice.getInitialMicEnabled();
    }
  }

  // Без микрофона войс работает на приём: звонки матча идут сами по себе (и переподключаются),
  // поэтому здесь без App.error — иначе в тамбуре ошибка на каждый звонок. Об этом говорит панель,
  // а ошибку показывают только нажатия самого игрока (toggleEnabledMic, setMicEnabled).
  // Цепочка обработки создаётся и без микрофона: собеседникам уходит её тихая дорожка, и
  // подключённый позже микрофон слышно сразу, без перезвона.
  static onMicUnavailable(reason) {
    Voice.userMedia = null;
    Voice.micUnavailable = true;
    Voice.log('mic-unavailable', { error: String(reason) });
    try {
      Voice.ensureMicProcessing();
    } catch (error) {
      console.log('Voice DSP init failed, no silent track:', error);
    }
    Voice.listenDeviceChange();
  }

  static notifyMicUnavailable() {
    if (Voice.micUnavailableNotified) return;
    Voice.micUnavailableNotified = true;
    App.error(Lang.text('voiceMicUnavailable'));
  }

  // Дорожка для звонка: микрофон, а пока его нет — тихая дорожка той же цепочки обработки.
  static getOutgoingTrack() {
    return Voice.mic || Voice.processingDestination?.stream.getAudioTracks()[0] || null;
  }

  static ensureMicProcessing() {
    if (!Voice.processingContext) {
      Voice.processingContext = new AudioContext();
      Voice.processingGain = Voice.processingContext.createGain();
      Voice.processingGain.gain.value = 2.1;
      Voice.processingCompressor = Voice.processingContext.createDynamicsCompressor();
      Voice.processingCompressor.threshold.value = -30;
      Voice.processingCompressor.knee.value = 20;
      Voice.processingCompressor.ratio.value = 3.5;
      Voice.processingCompressor.attack.value = 0.01;
      Voice.processingCompressor.release.value = 0.22;
      Voice.processingDestination = Voice.processingContext.createMediaStreamDestination();

      Voice.processingGain.connect(Voice.processingCompressor);
      Voice.processingCompressor.connect(Voice.processingDestination);
    }
    return Voice.processingDestination.stream.getAudioTracks()[0] || null;
  }

  static connectMicInput(track) {
    try {
      Voice.processingInput?.disconnect?.();
    } catch {}
    Voice.processingInput = Voice.processingContext.createMediaStreamSource(new MediaStream([track]));
    Voice.processingInput.connect(Voice.processingGain);
    // Созданный без микрофона контекст мог остаться приостановленным.
    Voice.processingContext.resume?.()?.catch?.(() => {});
  }

  static getMediaConstraints() {
    return {
      audio: App.isAdmin()
        ? App.storage.data.id == 1
          ? Voice.mediaAudioConfigManual
          : Voice.mediaAudioConfigHighQality
        : Voice.mediaAudioConfig,
      video: false,
    };
  }

  // Микрофон из настроек (Settings.voiceMicDevice — deviceId, voiceMicLabel — его имя на случай,
  // если Windows выдаст устройству новый id). Пусто — устройство записи Windows по умолчанию:
  // без deviceId Chromium берёт именно его, и если оно заглушено, а говорят в другой микрофон,
  // собеседникам уходит тишина.
  static async listMicDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audioinput');
  }

  // deviceId выбранного микрофона, если он сейчас подключён; '' — брать Windows по умолчанию.
  static async resolveMicDeviceId() {
    const id = String(Settings.settings?.voiceMicDevice || '');
    if (!id) return '';
    let devices = [];
    try {
      devices = await Voice.listMicDevices();
    } catch {
      return id;
    }
    // Без разрешения на микрофон Chromium прячет id и имена — пробуем сохранённый id как есть.
    if (!devices.length || devices.every((device) => !device.deviceId)) return id;
    if (devices.some((device) => device.deviceId === id)) return id;
    const label = String(Settings.settings?.voiceMicLabel || '');
    const byLabel = label ? devices.find((device) => device.label === label) : null;
    return byLabel ? byLabel.deviceId : '';
  }

  // Выбранный микрофон, а если его нет или он не открылся — Windows по умолчанию.
  static async openMicStream() {
    const constraints = Voice.getMediaConstraints();
    const deviceId = await Voice.resolveMicDeviceId();
    let stream = null;
    if (deviceId) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          ...constraints,
          audio: { ...constraints.audio, deviceId: { exact: deviceId } },
        });
      } catch (error) {
        Voice.log('mic-selected-failed', { error: String(error?.name || error) });
      }
    }
    if (!stream) stream = await navigator.mediaDevices.getUserMedia(constraints);
    Voice.log('mic-open', {
      label: stream?.getAudioTracks?.()[0]?.label || '',
      selected: Boolean(deviceId),
    });
    return stream;
  }

  // Смена микрофона в настройках: идущие звонки переходят на него сразу, без перезвона.
  static async setMicDevice(deviceId, label = '') {
    Settings.settings.voiceMicDevice = String(deviceId || '');
    Settings.settings.voiceMicLabel = deviceId ? String(label || '') : '';
    await Settings.WriteSettings();
    Voice.log('mic-device-set', { label: Settings.settings.voiceMicLabel });
    if (Voice.userMedia) {
      await Voice.reacquireMic(true);
    } else if (Voice.micUnavailable && Object.keys(Voice.manager).length) {
      await Voice.initLocalMedia();
      Voice.updateInfoPanel();
    }
  }

  // Выдернутый микрофон завершает свою дорожку ('ended'), и без повторного getUserMedia
  // звонок после подключения обратно шлёт тишину. Новая дорожка подключается ко входу той же
  // цепочки обработки: собеседникам по-прежнему идёт Voice.mic, переподключать звонки не нужно.
  static watchRawMic(track) {
    track?.addEventListener?.('ended', () => {
      if (track !== Voice.rawMic) return;
      Voice.log('mic-ended', { label: track.label || '' });
      Voice.updateInfoPanel();
      Voice.reacquireMic();
    });

    Voice.listenDeviceChange();
  }

  static listenDeviceChange() {
    if (Voice.deviceChangeListening || !navigator.mediaDevices?.addEventListener) return;
    Voice.deviceChangeListening = true;
    navigator.mediaDevices.addEventListener('devicechange', () => {
      if (Voice.userMedia && Voice.rawMic?.readyState === 'ended') {
        Voice.reacquireMic();
      } else if (Voice.micUnavailable && Object.keys(Voice.manager).length) {
        Voice.initLocalMedia().then(() => Voice.updateInfoPanel());
      } else if (Voice.userMedia && Settings.settings?.voiceMicDevice) {
        // Выбранный микрофон подключили обратно, а звонок идёт через Windows по умолчанию.
        Voice.resolveMicDeviceId()
          .then((id) => {
            const current = Voice.rawMic?.getSettings?.()?.deviceId;
            if (id && current && id !== current) Voice.reacquireMic(true);
          })
          .catch(() => {});
      }
    });
  }

  // force — открыть микрофон заново и при живой дорожке (сменили устройство в настройках).
  static reacquireMic(force = false) {
    if (Voice.reacquireMicPromise) {
      return force ? Voice.reacquireMicPromise.then(() => Voice.reacquireMic(true)) : Voice.reacquireMicPromise;
    }
    Voice.reacquireMicPromise = Voice.reacquireMicOnce(force).finally(() => {
      Voice.reacquireMicPromise = null;
    });
    return Voice.reacquireMicPromise;
  }

  static async reacquireMicOnce(force = false) {
    if (!Voice.userMedia || (!force && Voice.rawMic?.readyState !== 'ended')) return;

    let stream = null;
    try {
      stream = await Voice.openMicStream();
    } catch (error) {
      // Микрофона пока нет — следующая попытка будет по 'devicechange'.
      Voice.log('mic-reacquire-failed', { error: String(error?.name || error) });
      return;
    }

    const track = stream.getAudioTracks()[0];
    // Пока ждали, звонки могли закончиться (destroy обнуляет userMedia).
    if (!track || !Voice.userMedia) {
      stream.getTracks().forEach((item) => item.stop());
      return;
    }

    const oldRaw = Voice.rawMic;
    Voice.userMedia = stream;
    Voice.rawMic = track;
    Voice.watchRawMic(track);

    if (Voice.processingContext && Voice.processingGain && Voice.mic !== oldRaw) {
      Voice.connectMicInput(track);
    } else {
      // Без обработки собеседникам уходит сама дорожка микрофона — меняем её в отправителях.
      track.enabled = Voice.mic ? Voice.mic.enabled : Voice.getInitialMicEnabled();
      for (const id in Voice.manager) {
        const senders = Voice.manager[id]?.peer?.getSenders?.() || [];
        for (const sender of senders) {
          if (sender.track === oldRaw || sender.track?.kind === 'audio') {
            sender.replaceTrack(track).catch(() => {});
          }
        }
      }
      Voice.mic = track;
    }

    try {
      oldRaw?.stop?.();
    } catch {}

    Voice.log('mic-reacquired', { label: track.label || '' });
    Voice.updateInfoPanel();
  }

  static resetMicProcessing() {
    try {
      Voice.processingInput?.disconnect?.();
    } catch {}
    try {
      Voice.processingGain?.disconnect?.();
    } catch {}
    try {
      Voice.processingCompressor?.disconnect?.();
    } catch {}
    try {
      Voice.processingDestination?.disconnect?.();
    } catch {}
    try {
      Voice.processingContext?.close?.();
    } catch {}
    Voice.processingContext = null;
    Voice.processingInput = null;
    Voice.processingGain = null;
    Voice.processingCompressor = null;
    Voice.processingDestination = null;
  }

  static async toggleEnabledMic() {
    Voice.infoPanelHiddenByUser = false;
    if (!Voice.userMedia) {
      await Voice.initLocalMedia();

      Voice.updateInfoPanel();
    }

    if (!Voice.mic) {
      return Voice.notifyMicUnavailable();
    }

    Voice.mic.enabled = !Voice.mic.enabled;
    Voice.setMicWanted(Voice.mic.enabled);

    if (Voice.mic.enabled) {
      Sound.play(SOUNDS_LIBRARY.VC_ENABALED, {
        id: 'Voice_enabled',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });

      //Voice.infoPanel.firstChild.lastChild.style.opacity = 0;
    } else {
      Sound.play(SOUNDS_LIBRARY.VC_DISABLED, {
        id: 'Voice_disabled',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });

      //Voice.infoPanel.firstChild.lastChild.style.opacity = 1;
    }

    Voice.updateInfoPanel();
    Voice.showInfoPanel(true);
  }

  static indication(source, callback) {
    let audioContext = null;
    let mediaStreamSource = null;
    let analyser = null;
    let processor = null;
    let zeroGain = null;
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (processor) {
        processor.onaudioprocess = null;
      }
      try {
        mediaStreamSource?.disconnect?.();
      } catch {}
      try {
        analyser?.disconnect?.();
      } catch {}
      try {
        processor?.disconnect?.();
      } catch {}
      try {
        zeroGain?.disconnect?.();
      } catch {}
      try {
        audioContext?.close?.();
      } catch {}
      mediaStreamSource = null;
      analyser = null;
      processor = null;
      zeroGain = null;
      audioContext = null;
    };

    try {
      audioContext = new AudioContext();
      mediaStreamSource = audioContext.createMediaStreamSource(source);
      analyser = audioContext.createAnalyser();
      processor = audioContext.createScriptProcessor(2048, 1, 1);
      zeroGain = audioContext.createGain();
      zeroGain.gain.value = 0;
      mediaStreamSource.connect(analyser);
      analyser.connect(processor);
      processor.connect(zeroGain);
      zeroGain.connect(audioContext.destination);
      analyser.fftSize = 256;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      processor.onaudioprocess = () => {
        if (stopped) return;
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }

        let average = Math.round(sum / bufferLength);
        if (average > 100) {
          average = 100;
        }

        if (callback) {
          callback(average);
        }
      };
    } catch (error) {
      console.log('Voice indication init failed:', error);
      stop();
    }

    return stop;
  }

  static updateInfoPanel() {
    if (Number.isFinite(Number(Settings.settings?.voiceVolume))) {
      Voice.setVolumeLevel(Number(Settings.settings.voiceVolume));
    }
    Voice.stopPanelMeters();
    const panelBody = Voice.getInfoPanelBody();
    if (!panelBody) return;
    while (panelBody.firstChild) {
      panelBody.firstChild.remove();
    }

    let level = DOM({ style: 'voice-info-panel-body-item-bar-level' });

    let bar = DOM({ style: 'voice-info-panel-body-item-bar' }, level);

    const toggleKey = Voice.formatHotkey(Settings.settings?.voiceToggleHotkey, 'Ctrl+Z');
    const micIcon = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'voice-info-panel-body-item-icon',
        event: ['click', () => Voice.toggleEnabledMic()],
      },
      uiIcon(Voice.mic?.enabled ? 'mic' : 'mic-off'),
    );
    micIcon.dataset.tip = `${App.storage.data.login}\n${Lang.text('voiceLobbyMicTip').replace('{hotkey}', toggleKey)}`;

    const selfItem = DOM(
      { style: ['voice-info-panel-body-item', 'voice-info-panel-body-item--self'] },
      DOM(
        { style: 'voice-info-panel-body-item-controls' },
        micIcon,
        DOM(
          {
            domaudio: domAudioPresets.defaultButton,
            style: 'voice-info-panel-body-item-name',
            event: ['click', () => Voice.toggleEnabledMic()],
          },
          App.storage.data.login,
        ),
        VoiceScreen.selfButton() || '',
      ),
      DOM({ style: 'voice-info-panel-body-item-status' }, bar),
    );
    selfItem.classList.toggle('voice-info-panel-body-item--muted', !Voice.mic?.enabled);

    if (!Voice.mic) {
      level.style.width = '0%';
      level.classList.remove('voice-info-panel-body-item-bar-level-muted');
      bar.classList.add('voice-info-panel-body-item-nostream');
    } else if (Voice.mic.enabled) {
      level.classList.remove('voice-info-panel-body-item-bar-level-muted');
      bar.classList.remove('voice-info-panel-body-item-nostream');
      const selfId = App.storage.data.id;
      const stopMeter = Voice.indication(Voice.userMedia, (percent) => {
        level.style.width = `${percent}%`;
        selfItem.style.setProperty('--voice-level', String(percent / 100));
        Voice.setLobbyVoiceLevel(selfId, percent);
      });
      Voice.panelMeterStops.add(stopMeter);
    } else {
      level.style.width = '0%';
      bar.classList.remove('voice-info-panel-body-item-nostream');
      level.classList.add('voice-info-panel-body-item-bar-level-muted');
      Voice.setLobbyVoiceLevel(App.storage.data.id, 0);
    }

    panelBody.append(selfItem);
    Voice.infoPanelLogin = String(App.storage?.data?.login || '');

    for (let id in Voice.manager) {
      Voice.playerInfoPanel(id);
    }

    // Подсказки по управлению — карточкой при наведении на панель («?» в углу — что они есть).
    let tutorial = '';

    if (Voice.mic || Voice.micUnavailable) {
      const dropKey = Voice.formatHotkey(Settings.settings?.voiceDropHotkey, 'Ctrl+K');
      const hintDivider = '<span class="voice-info-panel-hint-divider"></span>';
      if (!Voice.mic) {
        tutorial =
          Lang.text('voiceMicUnavailable') +
          hintDivider +
          `<strong>${dropKey}</strong>${Lang.text('hotkeyDropCallsSuffix')}` +
          hintDivider +
          Lang.text('hotkeyVolumeControl') +
          hintDivider +
          Lang.text('voicePeerVolumeHint');
      } else if (Voice.mic.enabled) {
        tutorial =
          `<strong>${dropKey}</strong>${Lang.text('hotkeyDropCallsSuffix')}` +
          hintDivider +
          Lang.text('hotkeyVolumeControl') +
          hintDivider +
          Lang.text('voicePeerVolumeHint');
      } else {
        const micLabel = String(Voice.rawMic?.label || Voice.mic?.label || 'microphone');
        tutorial =
          `<strong>${dropKey}</strong>${Lang.text('hotkeyDropCallsSuffix')}` +
          hintDivider +
          Lang.text('hotkeyVolumeControl') +
          hintDivider +
          Lang.text('voicePeerVolumeHint') +
          '<br>────────────<br>' +
          (Voice.isMutedAll() ? `${Lang.text('voiceMutedAllHint')}<br>` : '') +
          `<strong>${toggleKey}</strong>${Lang.text('enableMicSuffix').replace('{Voice.mic.label}', micLabel)}`;
      }
    }

    if (tutorial) {
      panelBody.append(DOM({ style: 'voice-info-panel-body-tutorial', innerHTML: tutorial }));
    }

    if (Voice.infoPanelHelp) {
      Voice.infoPanelHelp.hidden = !tutorial;
    }

    Voice.syncLobbyVoice();

    Voice.syncInfoPanel();
  }

  static formatHotkey(tokens, fallback) {
    if (!Array.isArray(tokens)) return fallback;
    const cleaned = tokens.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
    if (!cleaned.length) return fallback;
    const map = {
      CTRL: 'Ctrl',
      ALT: 'Alt',
      SHIFT: 'Shift',
      WIN: 'Win',
      UP: 'Up',
      DOWN: 'Down',
      LEFT: 'Left',
      RIGHT: 'Right',
      SPACE: 'Space',
      ENTER: 'Enter',
      ESC: 'Esc',
      TAB: 'Tab',
    };
    return cleaned.map((x) => (map[x] ? map[x] : x)).join('+');
  }

  static playerInfoPanel(id) {
    let name = Voice.manager[id].name ? Voice.manager[id].name : `id${id}`;

    // Статус соединения: текст и вид (wait — ждём/соединяемся, bad — связь потеряна, closed — завершён).
    let statusInfo = () => {
      const connectionState = Voice.manager[id].peer.connectionState;
      if (connectionState === 'connected') return { text: '', kind: '' };
      const reconnectJob = Voice.getReconnectJob(id, Voice.manager[id].key);
      if (reconnectJob) {
        return {
          text: Lang.text('voiceReconnectingAttempt').replace('{attempt}', String((reconnectJob.attempt || 0) + 1)),
          kind: 'wait',
        };
      }
      switch (connectionState) {
        case 'new':
          return { text: Lang.text('waitingResponse'), kind: 'wait' };
        case 'connecting':
          return { text: Lang.text('voiceConnecting'), kind: 'wait' };
        case 'disconnected':
          return { text: Lang.text('voiceDisconnected'), kind: 'bad' };
        case 'failed':
          return { text: Lang.text('voiceFailed'), kind: 'bad' };
        case 'closed':
          return { text: Lang.text('voiceClosed'), kind: 'closed' };
        default:
          return { text: String(connectionState || ''), kind: 'wait' };
      }
    };

    // ник со статусом — для подсказки значка (в узкой колонке ников нет)
    let state = () => {
      const { text } = statusInfo();
      return text ? `${name} (${text})` : `${name}`;
    };

    // Статус — отдельной строкой под ником вместо полоски уровня: в строке с ником
    // он обрезался многоточием («Lantarm (пер…»).
    const statusLabel = DOM({ style: 'voice-info-panel-body-item-state' }, '');

    let item = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'voice-info-panel-body-item-name',
        event: [
          'click',
          () => {
            if (MM.isInTambur || MM.isInBattle) {
              return;
            }
            Voice.drop(Number(id));
            item.remove();
          },
        ],
      },
      '',
    );
    
    let mute = DOM(
      {
        domaudio: domAudioPresets.defaultButton,
        style: 'voice-info-panel-body-item-icon',
        event: ['click', () => Voice.togglePeerMuted(Number(id))],
      },
      '',
    );

    const row = DOM({ style: 'voice-info-panel-body-item' });

    let mutedByIcon = DOM(
      {
        style: 'voice-info-panel-body-item-muted-by',
      },
      uiIcon('cross'),
    );
    
    const updateItemView = () => {
      const mutedMark = Voice.isPeerSilenced(Number(id)) ? ' [MUTED]' : '';
      item.innerText = `${name}${mutedMark}`;
      const info = statusInfo();
      statusLabel.textContent = info.text;
      statusLabel.dataset.kind = info.kind;
      mute.replaceChildren(uiIcon(Voice.isPeerSilenced(Number(id)) ? 'sound-off' : 'sound-on'));
      // в узкой колонке ников нет — ник в подсказке значка
      mute.dataset.tip = state();
      mutedByIcon.style.display = Voice.isMutedByPeer(Number(id)) ? '' : 'none';
      row.classList.toggle('voice-info-panel-body-item--muted', Voice.isPeerSilenced(Number(id)));
      row.classList.toggle('voice-info-panel-body-item--connecting', Voice.manager[id]?.peer.connectionState !== 'connected');
      Voice.syncLobbyVoice();
    };
    
    updateItemView();

    let level = DOM({ style: 'voice-info-panel-body-item-bar-level' });

    let bar = DOM({ style: 'voice-info-panel-body-item-bar' }, level);
    let volumeText = DOM({ style: 'voice-info-panel-body-item-volume' }, '');
    const updatePeerVolumeView = () => {
      const percent = Voice.getPeerVolumePercent(Number(id));
      volumeText.innerText = `${percent}%`;
      Voice.applyPeerOutputVolume(Number(id));
    };
    updatePeerVolumeView();
    let currentStopMeter = null;

    let indication = () => {
      if (currentStopMeter) {
        currentStopMeter();
        Voice.panelMeterStops.delete(currentStopMeter);
        currentStopMeter = null;
      }
      if (Voice.manager[id].peer.connectionState == 'connected' && Voice.manager[id].stream) {
        const stopMeter = Voice.indication(Voice.manager[id].stream, (percent) => {
          level.style.width = `${percent}%`;
          row.style.setProperty('--voice-level', String(percent / 100));
          Voice.setLobbyVoiceLevel(id, percent);
        });
        currentStopMeter = stopMeter;
        Voice.panelMeterStops.add(stopMeter);
      }

      if (Voice.manager[id].stream) {
        if (bar.classList.contains('voice-info-panel-body-item-nostream')) {
          bar.classList.remove('voice-info-panel-body-item-nostream');
        }
      } else {
        if (!bar.classList.contains('voice-info-panel-body-item-nostream')) {
          bar.classList.add('voice-info-panel-body-item-nostream');
        }
      }
    };

    indication();

    // Wrap the constructor's handler, not the current one: the panel is rebuilt on every
    // updateInfoPanel, and chaining wrappers would grow without bound (one meter per layer).
    const target = Voice.manager[id];
    const baseOnConnectionStateChange = target.baseOnConnectionStateChange;
    target.peer.onconnectionstatechange = (...args) => {
      try {
        baseOnConnectionStateChange?.(...args);
      } catch {}
      if (Voice.manager[id] !== target) return;
      updateItemView();

      indication();
    };

    const panelBody = Voice.getInfoPanelBody();
    if (!panelBody) return;
    const status = DOM({ style: 'voice-info-panel-body-item-status' }, bar, statusLabel);
    row.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const step = event.deltaY < 0 ? 1 : -1;
        Voice.setPeerVolumePercent(Number(id), Voice.getPeerVolumePercent(Number(id)) + step);
        updatePeerVolumeView();
      },
      { passive: false },
    );
    row.append(DOM({ style: 'voice-info-panel-body-item-controls' }, mute, mutedByIcon, item, VoiceScreen.peerButton(id) || '', volumeText), status);
    panelBody.append(row);
  }

  static async ready(id, answer) {
    if (!(id in Voice.manager)) {
      Voice.log('ready-ignored', { id: Number(id) });
      return;
    }
    Voice.log('ready', { id: Number(id) });

    if (Voice.manager[id].timer) {
      clearTimeout(Voice.manager[id].timer);
    }

    await Voice.manager[id].peer.setRemoteDescription(answer);

    if (id in Voice.cacheCandidate) {
      for (let candidate of Voice.cacheCandidate[id]) {
        console.log('ОТПРАВИЛИ ICE кандидат из кэша:', candidate);

        await App.api.ghost('user', 'callCandidate', {
          id: id,
          candidate: candidate,
        });
      }

      delete Voice.cacheCandidate[id];
    }
  }

  static async candidate(id, candidate) {
    if (!(id in Voice.manager)) {
      return;
    }

    Voice.manager[id].ice?.remote.push(Voice.describeCandidate(candidate));

    await Voice.manager[id].peer.addIceCandidate(candidate);
  }

  // «relay/udp(tcp) 1.2.3.4:5678»: тип, протокол до пира, у relay — протокол до TURN-сервера.
  // Кандидат может прийти и объектом RTCIceCandidate, и простым объектом из сигналинга.
  static describeCandidate(candidate) {
    const line = String(candidate?.candidate || '');
    if (!line) return 'end-of-candidates';
    const parts = line.split(' ');
    const type = /\btyp (\S+)/.exec(line)?.[1] || '?';
    const relayProtocol = candidate?.relayProtocol ? `(${candidate.relayProtocol})` : '';
    return `${type}/${String(parts[2] || '?').toLowerCase()}${relayProtocol} ${parts[4] || '?'}:${parts[5] || '?'}`;
  }

  // Звонок закрылся, так и не соединившись: что было у обеих сторон и что ответили STUN/TURN.
  logIceFailure() {
    if (!this.ice || this.ice.logged) return;
    this.ice.logged = true;
    Voice.log('ice-fail', {
      id: Number(this.id),
      key: this.key,
      ice: String(this.peer?.iceConnectionState || ''),
      gathering: String(this.peer?.iceGatheringState || ''),
      local: this.ice.local,
      remote: this.ice.remote,
      errors: this.ice.errors,
    });
  }

  // Через какую пару кандидатов пошёл звук: напрямую (host/srflx) или через TURN (relay).
  async logSelectedPair() {
    if (!this.ice || this.ice.logged) return;
    this.ice.logged = true;
    try {
      const stats = await this.peer.getStats();
      let pair = null;
      stats.forEach((report) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          pair = stats.get(report.selectedCandidatePairId) || pair;
        }
      });
      if (!pair) {
        stats.forEach((report) => {
          if (!pair && report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') pair = report;
        });
      }
      const side = (statsId) => {
        const c = stats.get(statsId);
        if (!c) return '?';
        const relayProtocol = c.relayProtocol ? `(${c.relayProtocol})` : '';
        return `${c.candidateType}/${c.protocol}${relayProtocol} ${c.address || c.ip || '?'}:${c.port}`;
      };
      Voice.log('ice-pair', {
        id: Number(this.id),
        key: this.key,
        local: pair ? side(pair.localCandidateId) : '?',
        remote: pair ? side(pair.remoteCandidateId) : '?',
        rtt: pair?.currentRoundTripTime ?? null,
        errors: this.ice.errors,
      });
    } catch (error) {
      Voice.log('ice-pair-error', { id: Number(this.id), error: String(error) });
    }
  }

  static async mergeFriendCalls(users) {
    if (!Array.isArray(users) || !users.length) {
      return;
    }
    const selfId = Number(App.storage?.data?.id || 0);

    for (const item of users) {
      const id = Number(item?.id);
      if (!Number.isFinite(id) || id <= 0) {
        continue;
      }
      if (id === selfId) {
        continue;
      }
      if (id in Voice.manager) {
        continue;
      }
      // Deterministic initiator to avoid both sides calling simultaneously.
      if (Number.isFinite(selfId) && selfId > 0 && selfId > id) {
        Voice.log('merge-skip-higher-id', { id });
        continue;
      }
      Voice.log('merge-call', { id });

      try {
        Voice.markMergeAutoAccept(id);
        const voice = new Voice(id, 'friend', String(item?.name || ''), true);
        await voice.call({ reconnect: 1 });
      } catch (error) {
        console.log('Voice friend merge failed:', error);
        const msg = String(error || '').toLowerCase();
        if (msg.includes('request') && msg.includes('pending')) {
          setTimeout(async () => {
            if (id in Voice.manager) return;
            try {
              Voice.markMergeAutoAccept(id);
              const retryVoice = new Voice(id, 'friend', String(item?.name || ''), true);
              await retryVoice.call({ reconnect: 1 });
            } catch (retryError) {
              console.log('Voice friend merge retry failed:', retryError);
            }
          }, 700);
        }
      }
    }
  }

  static getConnectedPeerIds(excludeId = 0) {
    const skipId = Number(excludeId) || 0;
    const result = [];
    for (const key of Object.keys(Voice.manager)) {
      const id = Number(key);
      if (!Number.isFinite(id) || id <= 0 || id === skipId) continue;
      const item = Voice.manager[key];
      const state = String(item?.peer?.connectionState || '');
      if (state === 'connected' || state === 'connecting') {
        result.push(id);
      }
    }
    return Array.from(new Set(result));
  }

  // Between the lobby closing and the game process starting neither MM.isInTambur nor
  // MM.isInBattle is set; friend calls must still be ignored then. Cleared on restore,
  // and expires on its own in case the game never started.
  static isBattleSuspendActive() {
    return Voice.battleSuspendedAt > 0 && Date.now() - Voice.battleSuspendedAt < Voice.battleSuspendMaxMs;
  }

  static isTestClient() {
    return App.CURRENT_MM === 'mmtest';
  }

  // playerCount — сколько живых игроков в матче (0 — неизвестно).
  static setMatchKeepCalls(playerCount = 0) {
    const count = Number(playerCount) || 0;
    Voice.battleKeepCalls = Voice.isTestClient() || (count > 0 && count <= 2);
    Voice.log('match-keep-calls', { players: count, keep: Voice.battleKeepCalls });
    return Voice.battleKeepCalls;
  }

  static isMatchKeepCalls() {
    return Voice.battleKeepCalls || Voice.isTestClient();
  }

  static isBattleFriendAlly(id) {
    return Voice.battleFriendAllies.has(Number(id));
  }

  static rememberBattleFriendAllies(allyIds = []) {
    const allySet = new Set((allyIds || []).map((x) => Number(x)));
    Voice.battleFriendAllies = new Set();
    for (const idText of Object.keys(Voice.manager)) {
      const id = Number(idText);
      if (allySet.has(id) && Voice.isFriendScopedConnection(Voice.manager[idText])) {
        Voice.battleFriendAllies.add(id);
      }
    }
    // Связь могла оборваться ещё до лобби — тогда звонка в manager нет, но идёт переподключение.
    for (const job of Voice.reconnectJobs.values()) {
      if (allySet.has(job.id) && (job.key === 'friend' || (!job.key && job.important))) {
        Voice.battleFriendAllies.add(job.id);
      }
    }
  }

  static suspendPeersForBattle(allyIds = [], playerCount = 0) {
    VoiceScreen.stopForMatch();
    Voice.rememberBattleFriendAllies(allyIds);
    if (Voice.setMatchKeepCalls(playerCount)) {
      // Ничего не ставим на паузу и не игнорируем переподключения друзей до начала боя.
      Voice.battleSuspendedAt = 0;
      Voice.log('battle-keep', { peers: Object.keys(Voice.manager).map(Number) });
      return;
    }
    Voice.battleSuspendedAt = Date.now();
    const cleanIds = Array.from(new Set((allyIds || []).map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)));
    const allySet = new Set(cleanIds);
    Voice.log('battle-suspend', { allies: cleanIds, peers: Object.keys(Voice.manager).map(Number), jobs: Array.from(Voice.reconnectJobs.values()).map((j) => j.id) });
    for (const idText of Object.keys(Voice.manager)) {
      const id = Number(idText);
      if (allySet.has(id)) {
        continue;
      }
      const target = Voice.manager[idText];
      if (!target) {
        continue;
      }

      const key = String(target.key || '');
      Voice.stopReconnectJob(id, key);

      if (Voice.isFriendScopedConnection(target)) {
        if (!Voice.battleSuspendedPeers.has(id)) {
          Voice.battleSuspendedPeers.set(id, {
            id,
            key: key || 'friend',
            name: String(target.name || ''),
            important: Boolean(target.important),
          });
        }
        App.api.ghost('user', 'callPause', { id }).catch(() => {
          App.api.ghost('user', 'callDrop', { id }).catch(() => {});
        });
      } else {
        App.api.ghost('user', 'callDrop', { id }).catch(() => {});
      }

      target.close();
    }

    Voice.updateInfoPanel();
  }

  static restoreSuspendedBattlePeers() {
    Voice.battleSuspendedAt = 0;
    Voice.battleKeepCalls = false;
    Voice.battleFriendAllies.clear();
    Voice.stopMatchReconnectJobs();
    if (!Voice.battleSuspendedPeers.size) {
      return;
    }

    const list = Array.from(Voice.battleSuspendedPeers.values());
    Voice.battleSuspendedPeers.clear();
    Voice.log('battle-restore', { ids: list.map((x) => x.id) });

    // Через задачу переподключения, а не одним звонком: единственная попытка могла сорваться
    // (встречный звонок от VFriendMerge, гонка состояний, отказ сервера) — и друг не возвращался.
    // Задача повторяет звонок по reconnectPlanMs, останавливается при соединении или VDrop.
    let delayMs = 0;
    for (const item of list) {
      Voice.ensureReconnectJob(item.id, String(item.key || 'friend'), String(item.name || ''), Boolean(item.important), delayMs);
      delayMs += 250;
    }
  }

  static async remoteDrop(id) {
    Voice.log('remote-drop', { id: Number(id), hadEntry: Boolean(Voice.manager[id]) });
    // В бою трубку руками не положить: VDrop значит, что союзник потерял связь с сервером или
    // перезапустил лаунчер. Он может вернуться, поэтому продолжаем звонить.
    const entry = Voice.manager[id];
    if (MM.isInBattle && (entry ? Voice.isMatchVoicePeer(id, entry.key) : Voice.hasReconnectJob(id))) {
      if (entry) {
        Voice.setMutedByPeer(id, false);
        Voice.ensureReconnectJob(entry.id, entry.key, entry.name, entry.important, Voice.reconnectDisconnectedGraceMs);
        await entry.close({ keepReconnect: true });
      }
      return;
    }
    // The peer hung up (or paused for battle): stop re-calling them even between attempts,
    // when there is no live entry to close. If we are in battle, don't restore them afterwards
    // either (e.g. they closed the launcher while our battle was going on).
    Voice.battleSuspendedPeers.delete(Number(id));
    for (const job of Array.from(Voice.reconnectJobs.values())) {
      if (job.id === Number(id)) {
        Voice.stopReconnectJob(job.id, job.key);
      }
    }
    const target = Voice.manager[id];
    if (!target) return;
    Voice.setMutedByPeer(id, false);
    await target.close();
  }

  static drop(id) {
    const target = Voice.manager[id];
    if (!target) return;
    App.api.ghost('user', 'callDrop', { id }).catch(() => {});
    target.close();
  }

  static destroy(full = false, say = false) {
    // В бою Ctrl+K не рвёт звонки команды (раньше их защищало окно войса).
    if (!full && MM.isInBattle) {
      return;
    }
    if (full) {
      VoiceScreen.closeAll();
      Voice.stopAllReconnectJobs();
      Voice.battleSuspendedPeers.clear();
    } else {
      // Pending reconnects of non-friend calls (peer currently not in manager) must stop too.
      for (const job of Array.from(Voice.reconnectJobs.values())) {
        if (!job.important && job.key !== 'friend') {
          Voice.stopReconnectJob(job.id, job.key);
        }
      }
    }
    for (let id in Voice.manager) {
      // Ctrl+K drops everything except friends; auto-accepted friend calls (merge, battle
      // restore) are not flagged important, so check the friend scope as well.
      if (!full && (Voice.manager[id].important || Voice.isFriendScopedConnection(Voice.manager[id]))) {
        continue;
      }

      Voice.stopReconnectJob(Number(id), String(Voice.manager[id].key || ''));
      if (Number(id) > 0) {
        App.api.ghost('user', 'callDrop', { id: Number(id) }).catch(() => {});
      }
      Voice.manager[id].close();
    }

    if (say) {
      App.say(Lang.text('callsDropped'));
    }

    // Без микрофона от звонков осталась только цепочка с тихой дорожкой.
    if (full && !Voice.mic) {
      Voice.resetMicProcessing();
      Voice.micUnavailable = false;
    }

    if (Voice.mic) {
      if (full) {
        try {
          Voice.mic?.stop?.();
        } catch {}
        try {
          Voice.rawMic?.stop?.();
        } catch {}
        Voice.resetMicProcessing();

        Voice.mic = null;
        
        Voice.rawMic = null;

        Voice.userMedia = null;

        Voice.setMicWanted(false);
      }

      Voice.updateInfoPanel();
    }
  }

  static destroyTamburCallsOnly() {
    for (let id in Voice.manager) {
      const target = Voice.manager[id];
      if (!target) continue;
      const key = String(target.key || '');
      // Preserve friend/friend-of-friend calls; drop only MM/tambur scoped calls.
      if (Voice.isFriendScopedConnection(target)) {
        continue;
      }
      Voice.stopReconnectJob(Number(id), key);
      if (Number(id) > 0) {
        App.api.ghost('user', 'callDrop', { id: Number(id) }).catch(() => {});
      }
      target.close();
    }

    Voice.updateInfoPanel();
  }

  static setVolumeLevel(level = 1.0) {
    const volumeLevel = Math.max(0, Math.min(1, Number(level) || 0));
    Voice.volumeLevel = volumeLevel;
    for (let id in Voice.manager) {
      Voice.applyPeerOutputVolume(Number(id));
    }
  }
  
  static volumeControl(increase = false) {
    const current = Number.isFinite(Number(Settings.settings?.voiceVolume))
      ? Number(Settings.settings.voiceVolume)
      : Voice.volumeLevel;
    const next = Math.max(0, Math.min(1, current + (increase ? 0.01 : -0.01)));
    if (Math.abs(next - current) < 0.00001) {
      return;
    }
    Settings.settings.voiceVolume = next;
    Voice.setVolumeLevel(next);
    const nextPercent = Math.round(next * 100);
    if (nextPercent % 20 === 0) {
      App.say(`${nextPercent}%`);
    }
    const slider = document.getElementById('voice-volume-slider');
    if (slider) {
      slider.value = String(nextPercent);
      const max = Number(slider.max || 100);
      const percentage = 2 + (nextPercent / Math.max(1, max)) * 98;
      slider.style.setProperty('--fill-percentage', `${percentage}%`);
    }
    const percent = document.getElementById('voice-volume-percentage');
    if (percent) {
      percent.textContent = `${nextPercent}%`;
    }
  }

  static isBuildWindowMutation(record) {
    for (const nodes of [record.addedNodes, record.removedNodes]) {
      for (const node of nodes) {
        if (node.nodeType !== 1) continue;
        if (node.id === 'wbuild' || node.id === 'viewbuild' || node.querySelector('#wbuild, #viewbuild')) return true;
      }
    }
    return false;
  }

  static schedulePanelPosition() {
    if (Voice.panelPositionFrame) return;
    Voice.panelPositionFrame = requestAnimationFrame(() => {
      Voice.panelPositionFrame = 0;
      Voice.updatePanelPosition();
    });
  }

  // Панель не ложится на окна. В тамбуре её нет: войс на портретах союзников (syncLobbyVoice).
  // При открытом билде остаётся на своём месте, если и так левее окна; иначе — в полосе слева
  // от окна, а если полоса уже панели (узкое окно лаунчера) — колонкой значков без ников.
  static updatePanelPosition() {
    const panel = Voice.infoPanel;
    if (!panel) return;

    panel.classList.toggle('voice-info-panel--tambur', Boolean(MM.isInTambur));

    // закрывающееся окно (уходит к герою) уже не в счёт
    const build = MM.isInTambur ? null : document.querySelector('#wbuild:not(.wbuild--closing)');
    // окно ещё вылетает из карточки героя (и до того его опускает к списку героев
    // fitBuildWindowToHeroList): панель не трогаем, Window позовёт, когда окно долетит
    if (build?.classList.contains('wbuild--opening')) return;
    const rect = build?.getBoundingClientRect();
    const vh = window.innerHeight / 100;
    const margin = Math.max(4, vh * 0.8);
    // своё место панели — left-offset-with-shift (10vh от края), ширина 20vh, как в CSS
    const homeRight = (panel.classList.contains('left-offset-no-shift') ? 0 : vh * 10) + vh * 20;

    if (!rect?.width || homeRight + margin <= rect.left) {
      panel.classList.remove('voice-info-panel--docked', 'voice-info-panel--mini');
      panel.style.left = panel.style.top = panel.style.width = '';
      return;
    }

    const space = rect.left - margin * 2;
    // ширина обычной панели — 20vh, как в CSS
    const mini = space < vh * 20;
    const width = mini ? Math.max(24, Math.min(vh * 5.6, space)) : vh * 20;

    panel.classList.add('voice-info-panel--docked');
    panel.classList.toggle('voice-info-panel--mini', mini);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(2, (rect.left - width) / 2)}px`;
    panel.style.top = `${rect.top}px`;
  }

  // Войс на портрете союзника в шапке тамбура: свечение по громкости (--voice-level) и кнопка
  // мута, у себя — микрофона. Колёсико над кнопкой — громкость игрока.
  static decorateLobbyPlayer(player, state) {
    const hero = player?.querySelector('.mm-lobby-header-team-player-hero');
    if (!hero) return;

    let button = hero.querySelector('.mm-voice-btn');

    player.classList.toggle('mm-voice', Boolean(state));

    if (!state) {
      button?.remove();
      player.style.removeProperty('--voice-level');
      return;
    }

    if (!button) {
      button = DOM({ tag: 'button', type: 'button', style: 'mm-voice-btn', domaudio: domAudioPresets.defaultButton });
      // клик по портрету открывает билд союзника — до него не доходим
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        button.voiceState?.onToggle?.();
      });
      button.addEventListener(
        'wheel',
        (event) => {
          if (!button.voiceState?.onVolume) return;
          event.preventDefault();
          event.stopPropagation();
          const percent = button.voiceState.onVolume(event.deltaY < 0 ? 1 : -1);
          button.dataset.volume = `${percent}%`;
          button.classList.add('mm-voice-btn--volume');
          clearTimeout(button.volumeTimer);
          button.volumeTimer = setTimeout(() => button.classList.remove('mm-voice-btn--volume'), 1200);
        },
        { passive: false },
      );
      hero.append(button);
    }

    button.voiceState = state;
    button.replaceChildren(uiIcon(state.icon));
    button.dataset.tip = state.tip;
    // дуга вокруг кнопки союзника — его громкость (видно, что колёсиком её можно крутить)
    button.classList.toggle('mm-voice-btn--ring', Number.isFinite(state.volume));
    if (Number.isFinite(state.volume)) {
      button.style.setProperty('--voice-volume', String(state.volume / 100));
    } else {
      button.style.removeProperty('--voice-volume');
    }
    player.classList.toggle('mm-voice--muted', Boolean(state.muted));
    player.classList.toggle('mm-voice--muted-by', Boolean(state.mutedBy));
    player.classList.toggle('mm-voice--connecting', Boolean(state.connecting));
  }

  static syncLobbyVoice() {
    const players = document.querySelectorAll('.mm-lobby-header-team-player[id^="PLAYER"]');
    if (!players.length || MM.preview) return;

    const selfId = Number(App.storage.data.id);

    for (const player of players) {
      const id = Number(player.id.slice('PLAYER'.length));

      if (id === selfId) {
        Voice.decorateLobbyPlayer(player, Voice.mic && {
          icon: Voice.mic.enabled ? 'mic' : 'mic-off',
          muted: !Voice.mic.enabled,
          tip: Lang.text('voiceLobbyMicTip').replace('{hotkey}', Voice.formatHotkey(Settings.settings?.voiceToggleHotkey, 'Ctrl+Z')),
          onToggle: () => Voice.toggleEnabledMic(),
        });
        continue;
      }

      const target = Voice.manager[id];
      // Между попытками переподключения записи нет, но кнопка мута должна остаться.
      const inVoice = target || Voice.hasReconnectJob(id);
      const silenced = inVoice && Voice.isPeerSilenced(id);
      Voice.decorateLobbyPlayer(player, inVoice && {
        icon: silenced ? 'sound-off' : 'sound-on',
        muted: silenced,
        mutedBy: Voice.isMutedByPeer(id),
        connecting: target?.peer?.connectionState !== 'connected',
        volume: Voice.getPeerVolumePercent(id),
        tip: Lang.text('voiceLobbyPeerTip').replace('{percent}', String(Voice.getPeerVolumePercent(id))) +
          (Voice.isMutedByPeer(id) ? `\n${Lang.text('voiceLobbyMutedByTip')}` : ''),
        onToggle: () => Voice.togglePeerMuted(id),
        onVolume: (step) => {
          Voice.setPeerVolumePercent(id, Voice.getPeerVolumePercent(id) + step);
          Voice.syncLobbyVoice();
          return Voice.getPeerVolumePercent(id);
        },
      });
    }
  }

  static setLobbyVoiceLevel(id, percent) {
    document.getElementById(`PLAYER${id}`)?.style.setProperty('--voice-level', String(percent / 100));
  }

  static async association(i, users, key) {
    // Новый матч: под «Мут всех и себя» все снова в муте, включая свой микрофон, — кроме
    // союзников, с которыми звонок друзей шёл ещё до матча.
    Voice.resetMutedAllForMatch(users.map((user) => user.id));

    Voice.stopMatchReconnectJobs(String(key || ''));

    // Панель покажет сам звонок (call/accept): в лобби может быть некому звонить.
    let start = false;

    for (let user of users) {
      if (user.id == i) {
        start = true;

        continue;
      }

      // Этот союзник звонит нам сам. Если его звонок не дойдёт, позвоним ему после ожидания.
      if (!start) {
        Voice.ensureReconnectJob(user.id, key, user.name, false, Voice.matchCalleeWaitMs);

        continue;
      }

      // One rejected ally (left the match, server check failed) must not stop calls to the rest.
      let voice = null;
      try {
        voice = new Voice(user.id, key, user.name);

        await voice.call();
      } catch (error) {
        console.log('Voice.association call failed:', user.id, error);
        Voice.ensureReconnectJob(user.id, key, user.name, false, Voice.reconnectDisconnectedGraceMs);
        voice?.close({ keepReconnect: true });
      }
    }
  }

  constructor(id, key = '', name = '', important = false) {
    if (Number.isFinite(Number(Settings.settings?.voiceVolume))) {
      Voice.setVolumeLevel(Number(Settings.settings.voiceVolume));
    }
    this.id = id;

    this.key = key;

    this.name = name;

    this.important = important;

    this.isCaller = false;

    this.reconnectScheduled = false;
    
    this.hasEverConnected = false;
    
    this.disconnectTimer = null;

    this.allowAutoReconnect = true;

    this.stream = null;

    this.controller = null;
    
    this.playbackSource = null;
    
    this.playbackGain = null;

    if (this.id in Voice.manager || Object.keys(Voice.manager).length + 1 > Voice.limit) {
      this.peer = null;

      return this;
    }

    this.peer = new RTCPeerConnection(Voice.peerConnectionConfig);

    // Для voice.log: свои и чужие кандидаты, ошибки STUN/TURN (см. logIceFailure, logSelectedPair).
    this.ice = { local: [], remote: [], errors: [], logged: false };

    Voice.manager[this.id] = this;

    this.peer.ontrack = (event) => {
      console.log('Получен удаленный медиапоток', event);

      this.stream = new MediaStream([event.track]);

      this.controller = new Audio();

      this.controller.srcObject = this.stream;

      this.controller.autoplay = true;

      this.controller.controls = true;

      const playbackContext = Voice.ensurePlaybackContext();
      if (playbackContext) {
        try {
          this.playbackSource = playbackContext.createMediaStreamSource(this.stream);
          this.playbackGain = playbackContext.createGain();
          this.playbackSource.connect(this.playbackGain);
          this.playbackGain.connect(playbackContext.destination);
        } catch {
          this.playbackSource = null;
          this.playbackGain = null;
        }
      }
      
      this.controller.muted = Voice.isPeerSilenced(this.id);
      Voice.applyPeerOutputVolume(this.id);

      this.controller.play();

      document.body.prepend(this.controller);

      this.controller.style.display = 'none';
    };

    this.peer.onicecandidateerror = (event) => {
      const text = `${event.errorCode} ${event.url || ''} ${event.errorText || ''}`.trim();
      if (this.ice.errors.length < 10 && !this.ice.errors.includes(text)) {
        this.ice.errors.push(text);
      }
    };

    this.peer.onicecandidate = async (event) => {
      if (event.candidate) {
        console.log('Сгенерирован ICE кандидат:', event.candidate);
        this.ice.local.push(Voice.describeCandidate(event.candidate));

        if (this.peer.remoteDescription) {
          console.log('ОТПРАВИЛИ ICE кандидат:', event.candidate);

          await App.api.ghost('user', 'callCandidate', {
            id: this.id,
            candidate: event.candidate,
          });
        } else {
          if (!(this.id in Voice.cacheCandidate)) {
            Voice.cacheCandidate[this.id] = new Array();
          }

          Voice.cacheCandidate[this.id].push(event.candidate);
        }
      } else {
        console.log('Все ICE кандидаты собраны');
      }
    };

    const clearDisconnectTimer = () => {
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
    };

    const canScheduleReconnect = () => {
      return (
        this.allowAutoReconnect &&
        Voice.shouldAutoReconnectKey(this.key) &&
        (this.isCaller || Voice.isMatchVoicePeer(this.id, this.key)) &&
        !this.reconnectScheduled &&
        (this.key !== 'friend' || this.hasEverConnected)
      );
    };

    this.peer.onconnectionstatechange = () => {
      const state = String(this.peer?.connectionState || '');
      Voice.log('state', { id: Number(this.id), key: this.key, state, caller: this.isCaller });
      switch (state) {
        case 'connected':
          this.hasEverConnected = true;
          this.logSelectedPair();
          VoiceScreen.onPeerConnected(this.id);
          if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
          }
          clearDisconnectTimer();
          Voice.stopReconnectJob(this.id, this.key);
          this.reconnectScheduled = false;
          break;

        case 'disconnected':
          clearDisconnectTimer();
          this.disconnectTimer = setTimeout(() => {
            this.disconnectTimer = null;
            if (!this.peer || this.peer.connectionState === 'closed') {
              this.close();
              return;
            }
            if (this.peer.connectionState !== 'disconnected') {
              return;
            }
            if (canScheduleReconnect()) {
              this.reconnectScheduled = true;
              Voice.ensureReconnectJob(this.id, this.key, this.name, this.important, Voice.reconnectDisconnectedGraceMs);
              this.close({ keepReconnect: true });
            } else {
              this.close();
            }
          }, Voice.reconnectDisconnectedGraceMs);
          break;

        case 'failed':
          clearDisconnectTimer();
          if (canScheduleReconnect()) {
            this.reconnectScheduled = true;
            Voice.ensureReconnectJob(this.id, this.key, this.name, this.important, 0);
            this.close({ keepReconnect: true });
          } else {
            this.close();
          }
          break;

        case 'closed':
          clearDisconnectTimer();
          if (canScheduleReconnect()) {
            this.reconnectScheduled = true;
            Voice.ensureReconnectJob(this.id, this.key, this.name, this.important, Voice.reconnectDisconnectedGraceMs);
            this.close({ keepReconnect: true });
          } else {
            this.close();
          }
          break;
      }
    };
    this.baseOnConnectionStateChange = this.peer.onconnectionstatechange;

    this.peer.oniceconnectionstatechange = () => {
      switch (this.peer.iceConnectionState) {
        case 'connected':
          console.log('Соединение успешно установлено');
          this.hasEverConnected = true;
          if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
          }
          clearDisconnectTimer();
          Voice.stopReconnectJob(this.id, this.key);
          this.reconnectScheduled = false;
          break;

        case 'disconnected':
          // WebRTC may report transient "disconnected" during glare/rechecks.
          // Do not drop UI entry immediately; wait and close only if it persists.
          clearDisconnectTimer();
          this.disconnectTimer = setTimeout(() => {
            this.disconnectTimer = null;
            if (!this.peer || this.peer.connectionState === 'closed') {
              this.close();
              return;
            }
            if (this.peer.iceConnectionState !== 'disconnected') {
              return;
            }
            if (canScheduleReconnect()) {
              this.reconnectScheduled = true;
              Voice.ensureReconnectJob(this.id, this.key, this.name, this.important, Voice.reconnectDisconnectedGraceMs);
              this.close({ keepReconnect: true });
            } else {
              this.close();
            }
          }, Voice.reconnectDisconnectedGraceMs);
          break;

        case 'failed':
          clearDisconnectTimer();
          if (canScheduleReconnect()) {
            this.reconnectScheduled = true;
            Voice.ensureReconnectJob(this.id, this.key, this.name, this.important, 0);
            this.close({ keepReconnect: true });
          } else {
            this.close();
          }
          break;

        case 'closed':
          clearDisconnectTimer();
          if (canScheduleReconnect()) {
            this.reconnectScheduled = true;
            Voice.ensureReconnectJob(this.id, this.key, this.name, this.important, Voice.reconnectDisconnectedGraceMs);
            this.close({ keepReconnect: true });
          } else {
            this.close();
          }
          break;
      }

      console.log(`Состояние соединения: ${this.peer.iceConnectionState}`);
    };
  }

  async call(options = {}) {
    if (!this.peer) {
      return;
    }

    if (this.isCaller) {
      return;
    }

    // Попытка переподключения не открывает заново панель, закрытую крестиком.
    const isReconnect = Boolean(Number(options?.reconnect || 0));
    if (!isReconnect) {
      Voice.infoPanelHiddenByUser = false;
    }
    Voice.showInfoPanel(!isReconnect);

    // Пока offer готовится, запись выглядит как зависшая (см. shouldReplaceDeadCall).
    this.offerStarting = true;

    await Voice.initLocalMedia();

    // Звонок другу, начатый самим игроком, сразу с включённым микрофоном (не при переподключении
    // после боя и не в режиме рации — там микрофон включает зажатая клавиша)
    if (Voice.mic && this.key === 'friend' && !Number(options?.reconnect || 0) && !Settings.settings?.voiceRadioMode && !Voice.mic.enabled) {
      Voice.mic.enabled = true;
      Voice.setMicWanted(true);
      Sound.play(SOUNDS_LIBRARY.VC_ENABALED, {
        id: 'Voice_enabled',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    }

    const outgoingTrack = Voice.getOutgoingTrack();
    if (outgoingTrack) {
      this.peer.addTrack(outgoingTrack);
    }

    await this.applyIceServers();

    let offer = await this.peer.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });

    await this.peer.setLocalDescription(offer);

    this.offerStarting = false;

    this.timer = setTimeout(() => {
      this.timer = null;

      // Союзнику в матче звоним, пока не ответит: первый звонок мог просто не дойти.
      if (Voice.isMatchVoicePeer(this.id, this.key)) {
        Voice.ensureReconnectJob(this.id, this.key, this.name, this.important, Voice.reconnectPlanMs[0]);
      }

      // Unanswered reconnect attempt: keep the job so it retries per reconnectPlanMs.
      Voice.log('call-timeout', { id: Number(this.id), job: Boolean(Voice.getReconnectJob(this.id, this.key)) });
      this.close({ keepReconnect: Boolean(Voice.getReconnectJob(this.id, this.key)) });
    }, 15000);

    Voice.log('call', { id: Number(this.id), key: this.key, reconnect: Number(options?.reconnect || 0) ? 1 : 0 });
    try {
      // API отклоняет второй user.call, пока не пришёл ответ на первый (REQUEST_ALREADY_PENDING).
      // При восстановлении после боя звонки нескольким друзьям идут почти одновременно — ждём
      // освобождения метода, а не теряем звонок.
      for (let wait = 0; ; wait++) {
        try {
          await App.api.request('user', 'call', {
            id: this.id,
            key: this.key,
            offer: offer,
            reconnect: Number(options?.reconnect || 0) ? 1 : 0,
          });
          break;
        } catch (error) {
          if (error?.code !== 'REQUEST_ALREADY_PENDING' || wait >= 40 || Voice.manager[this.id] !== this) throw error;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
    } catch (error) {
      Voice.log('call-error', { id: Number(this.id), error: String(error) });
      throw error;
    }

    this.isCaller = true;

    Voice.updateInfoPanel();
  }

  async accept(offer) {
    if (!this.peer) {
      return;
    }

    Voice.infoPanelHiddenByUser = false;
    Voice.showInfoPanel(true);

    await Voice.initLocalMedia();

    const outgoingTrack = Voice.getOutgoingTrack();
    if (outgoingTrack) {
      this.peer.addTrack(outgoingTrack);
    }

    await this.applyIceServers();

    Voice.log('accept', { id: Number(this.id), key: this.key });
    await this.peer.setRemoteDescription(offer);

    let answer = await this.peer.createAnswer();

    await App.api.ghost('user', 'callAccept', {
      id: this.id,
      answer: answer,
      mergePeers: Voice.getConnectedPeerIds(this.id),
    });

    await this.peer.setLocalDescription(answer);

    Voice.updateInfoPanel();
  }

  async reconnect() {
    if (!Voice.shouldAutoReconnectKey(this.key) || !this.isCaller) return;
    Voice.ensureReconnectJob(this.id, this.key, this.name, this.important, 0);
    this.close({ keepReconnect: true });
  }

  async close(options = {}) {
    // A placeholder (constructor found the id busy or the limit hit) was never registered:
    // closing it must not evict the live entry for this id or stop its reconnect job.
    if (!this.peer) {
      return;
    }
    // A repeated close() of an already replaced object must not touch the newer entry for this id.
    const isLive = Voice.manager[this.id] === this;
    const keepReconnect = Boolean(options?.keepReconnect);
    if (!keepReconnect) {
      this.allowAutoReconnect = false;
    }
    if (!keepReconnect && isLive) {
      Voice.stopReconnectJob(this.id, this.key);
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.hasEverConnected) {
      this.logIceFailure();
    }

    try {
      this.peer?.close?.();
    } catch {}
    try {
      this.playbackSource?.disconnect?.();
    } catch {}
    try {
      this.playbackGain?.disconnect?.();
    } catch {}
    if (this.controller) {
      try {
        this.controller.pause();
        this.controller.srcObject = null;
        this.controller.remove();
      } catch {}
      this.controller = null;
    }

    if (!isLive) {
      return;
    }

    delete Voice.manager[this.id];
    
    Voice.mutedByPeers.delete(this.id);

    VoiceScreen.onPeerGone(this.id);

    if (this.id in Voice.cacheCandidate) {
      delete Voice.cacheCandidate[this.id];
    }

    Voice.updateInfoPanel();
  }
}

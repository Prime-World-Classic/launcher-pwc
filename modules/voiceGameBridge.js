import { App } from './app.js';
import { Settings } from './settings.js';
import { NativeAPI } from './nativeApi.js';
import { Voice } from './voice.js';

// Мост войса в оверлей боя (PW_Game.exe, PF_GameLogic/VoiceOverlayController).
// Игра шлёт на 127.0.0.1:PORT короткие текстовые датаграммы; на каждую "poll" (~10 раз в
// секунду) лаунчер отвечает снимком состояния звонков. Ответы идут из обработчика сокета,
// а не по таймеру: в спрятанном окне лаунчера браузерные таймеры душатся до 1 Гц.
//
// Игра -> лаунчер:
//   poll                  прислать состояние
//   mute <id>             заглушить/включить участника у себя
//   mic                   включить/выключить свой микрофон
//   ptt <0|1>             рация: клавиша отпущена/зажата
//   vol <id> <delta>      громкость участника, проценты
//   pos <x> <y>           оверлей перетащили (доли экрана 0..1)
//   smartcast <талант> <0|1>   смарткаст переключён на панели (сохраняется в билд)
//   cbar                  кнопки панели действий для расходников (build.battleConsumables), ответ PWC ниже
//   tbuild <запрос> <герой>    тренировка: герой (persistentId) выбран прямо в бою — нужен
//                              билд игрока на него (build.trainingBuild), ответ PWB ниже
// Лаунчер -> игра на tbuild (без строк b/r/a — билда нет, игра берёт билд из данных):
//   PWB 1 <запрос>
//   b <36 persistentId талантов через пробел, - пустой слот>   (web-порядок, как build[] сессии)
//   r <36 заточек>
//   a <24 ячейки панели: abs-1 = слот билда, знак минус = смарткаст>
// Лаунчер -> игра на cbar (окно билда, панель «Расходники»; build/consumables.js):
//   PWC 1
//   c <24 маски кнопок: бит N — расходник N, порядок CONSUMABLES>
// Из боя раскладка расходников не сохраняется.
// Лаунчер -> игра на poll (строки через \n, имя всегда последнее поле):
//   PWV 1
//   cfg <оверлей 0|1> <рация 0|1> <VK клавиши рации через запятую или -> <x> <y>
//   me <мик 0 нет|1 вкл|2 выкл> <говорит 0|1> <ник>
//   p <id> <флаги> <громкость %> <ник>     флаги: 1 говорит, 2 заглушён мной,
//                                          4 заглушил меня, 8 нет соединения,
//                                          16 микрофон выключен, 32 микрофона нет
// Состояние своего микрофона лаунчер шлёт собеседникам через бэкенд
// (user.callMicState -> событие VMicState), пока идёт бой и оно меняется.
export class VoiceGameBridge {
  static PORT = 34981;

  static socket = null;

  static audioContext = null;

  static meters = new Map();

  // RMS сигнала (0..1), выше которого участник считается говорящим.
  static SPEAK_THRESHOLD = 0.012;

  // Сколько держать подсветку после последнего громкого кадра, чтобы не мигала между словами.
  static SPEAK_HOLD_MS = 300;

  static pttPressed = false;

  // id собеседника -> состояние его микрофона (0 нет, 1 вкл, 2 выкл) из VMicState.
  static peerMicStates = new Map();

  // id собеседника -> какое состояние своего микрофона мы ему уже отправили.
  static sentMicStates = new Map();

  static pttWatchdog = null;

  static VK_MAP = {
    CTRL: 0x11,
    ALT: 0x12,
    SHIFT: 0x10,
    WIN: 0x5b,
    UP: 0x26,
    DOWN: 0x28,
    LEFT: 0x25,
    RIGHT: 0x27,
    SPACE: 0x20,
    ENTER: 0x0d,
    ESC: 0x1b,
    TAB: 0x09,
    BACKSPACE: 0x08,
    DELETE: 0x2e,
    INSERT: 0x2d,
    HOME: 0x24,
    END: 0x23,
    PG_UP: 0x21,
    PG_DOWN: 0x22,
    '`': 0xc0,
    NUM_ADD: 0x6b,
    NUM_SUB: 0x6d,
    NUM_MUL: 0x6a,
    NUM_DIV: 0x6f,
    NUM_DOT: 0x6e,
    NUM_ENTER: 0x0d,
  };

  static start() {
    if (!NativeAPI.status || !NativeAPI.dgram || VoiceGameBridge.socket) {
      return;
    }

    try {
      const socket = NativeAPI.dgram.createSocket('udp4');

      socket.on('message', (message, remote) => {
        // Принимаем только локальные пакеты: сокет и так слушает 127.0.0.1.
        if (remote?.address !== '127.0.0.1') return;
        VoiceGameBridge.onMessage(String(message || ''), remote);
      });

      socket.on('error', (error) => {
        Voice.log('overlay-socket-error', { error: String(error) });
        VoiceGameBridge.stop();
      });

      socket.bind(VoiceGameBridge.PORT, '127.0.0.1');

      VoiceGameBridge.socket = socket;
    } catch (error) {
      Voice.log('overlay-socket-error', { error: String(error) });
      VoiceGameBridge.socket = null;
    }
  }

  static stop() {
    VoiceGameBridge.releasePtt();
    // Следующий бой начинаем с чистого листа: собеседники перешлют состояния заново.
    VoiceGameBridge.peerMicStates.clear();
    VoiceGameBridge.sentMicStates.clear();

    if (VoiceGameBridge.socket) {
      try {
        VoiceGameBridge.socket.close();
      } catch {}
      VoiceGameBridge.socket = null;
    }

    for (const meter of VoiceGameBridge.meters.values()) {
      VoiceGameBridge.disconnectMeter(meter);
    }
    VoiceGameBridge.meters.clear();

    if (VoiceGameBridge.audioContext) {
      try {
        VoiceGameBridge.audioContext.close();
      } catch {}
      VoiceGameBridge.audioContext = null;
    }
  }

  static onMessage(text, remote) {
    const parts = text.trim().split(/\s+/);
    const command = parts[0];

    try {
      switch (command) {
        case 'poll':
          VoiceGameBridge.send(VoiceGameBridge.buildState(), remote);
          break;

        case 'mute': {
          const id = Number(parts[1]);
          if (id in Voice.manager) {
            Voice.togglePeerMuted(id);
          }
          break;
        }

        case 'mic':
          Voice.toggleEnabledMic();
          break;

        case 'ptt':
          VoiceGameBridge.setPtt(parts[1] === '1');
          break;

        case 'vol': {
          const id = Number(parts[1]);
          const delta = Math.round(Number(parts[2]) || 0);
          if (id in Voice.manager && delta) {
            Voice.setPeerVolumePercent(id, Voice.getPeerVolumePercent(id) + delta);
          }
          break;
        }

        // Смарткаст переключён на панели в бою: сохраняем в билд (build.battleSmartCast),
        // иначе при следующем бое настройка откатывалась к билду из БД.
        case 'smartcast': {
          const talent = String(parts[1] || '');
          if (/^[A-Za-z0-9_-]{1,64}$/.test(talent) && (parts[2] === '0' || parts[2] === '1')) {
            Promise.resolve(App.api?.ghost?.('build', 'battleSmartCast', { talent, on: parts[2] === '1' })).catch(() => {});
          }
          break;
        }

        case 'tbuild': {
          const request = String(parts[1] || '');
          const hero = String(parts[2] || '');
          if (/^\d{1,9}$/.test(request) && /^[A-Za-z0-9_-]{1,64}$/.test(hero)) {
            VoiceGameBridge.sendTrainingBuild(request, hero, remote);
          }
          break;
        }

        case 'cbar':
          VoiceGameBridge.sendConsumableBar(remote);
          break;

        case 'pos': {
          const x = Number(parts[1]);
          const y = Number(parts[2]);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            Settings.settings.voiceOverlayPos = [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))];
            Promise.resolve(Settings.WriteSettings()).catch(() => {});
          }
          break;
        }
      }
    } catch (error) {
      Voice.log('overlay-command-error', { command, error: String(error) });
    }
  }

  // Лимит tbuild (порт слышит любая программа на компьютере, каждый запрос идёт на бэкенд):
  // к бэкенду — по одному (Api.request и не пустит второй такой же); ждут не больше
  // TRAINING_BUILD_QUEUE запросов (игра добавляет героев пачкой и сама кеширует билды),
  // лишним старейшим — сразу заголовок; не больше TRAINING_BUILD_LIMIT запросов к бэкенду
  // в минуту — сверх лимита сразу заголовок. На заголовок игра берёт билд из данных.
  static TRAINING_BUILD_LIMIT = 20;

  static TRAINING_BUILD_WINDOW_MS = 60000;

  static TRAINING_BUILD_QUEUE = 8;

  static trainingBuildTimes = [];

  static trainingBuildJobs = [];

  // Идущая обработка (null — простаивает); тесты ждут её.
  static trainingBuildTask = null;

  static sendTrainingBuild(request, hero, remote) {
    const jobs = VoiceGameBridge.trainingBuildJobs;
    jobs.push({ request, hero, remote });
    while (jobs.length > VoiceGameBridge.TRAINING_BUILD_QUEUE) {
      const dropped = jobs.shift();
      VoiceGameBridge.send(`PWB 1 ${dropped.request}`, dropped.remote);
    }
    if (!VoiceGameBridge.trainingBuildTask) {
      VoiceGameBridge.trainingBuildTask = VoiceGameBridge.runTrainingBuilds().finally(() => {
        VoiceGameBridge.trainingBuildTask = null;
      });
    }
  }

  static async runTrainingBuilds() {
    while (VoiceGameBridge.trainingBuildJobs.length) {
      const { request, hero, remote } = VoiceGameBridge.trainingBuildJobs.shift();

      const now = Date.now();
      const times = VoiceGameBridge.trainingBuildTimes.filter((time) => now - time < VoiceGameBridge.TRAINING_BUILD_WINDOW_MS);
      VoiceGameBridge.trainingBuildTimes = times;
      if (times.length >= VoiceGameBridge.TRAINING_BUILD_LIMIT) {
        Voice.log('training-build-limit', { hero });
        VoiceGameBridge.send(`PWB 1 ${request}`, remote);
        continue;
      }
      times.push(now);
      VoiceGameBridge.send(await VoiceGameBridge.buildTrainingReply(request, hero), remote);
    }
  }

  static async buildTrainingReply(request, hero) {
    const lines = [`PWB 1 ${request}`];
    try {
      const data = await App.api?.request?.('build', 'trainingBuild', { hero });
      if (data && Array.isArray(data.build) && data.build.length === 36) {
        const isId = (value) => /^[A-Za-z0-9_-]{1,64}$/.test(String(value || ''));
        const refine = Array.isArray(data.buildRefine) ? data.buildRefine : [];
        const bar = Array.isArray(data.bar) ? data.bar : [];
        lines.push(`b ${data.build.map((id) => (isId(id) ? id : '-')).join(' ')}`);
        lines.push(`r ${data.build.map((id, i) => Math.trunc(Number(refine[i]) || 0)).join(' ')}`);
        lines.push(`a ${Array.from({ length: 24 }, (value, i) => Math.trunc(Number(bar[i]) || 0)).join(' ')}`);
      }
    } catch (error) {
      Voice.log('training-build-error', { hero, error: String(error) });
    }
    return lines.join('\n');
  }

  // Лимит cbar: игра спрашивает раз в начале боя (и повторяет, пока нет ответа) — к бэкенду
  // по одному запросу и не больше CONSUMABLE_BAR_LIMIT в минуту; сверх лимита ответа нет.
  static CONSUMABLE_BAR_LIMIT = 12;

  static consumableBarTimes = [];

  // Идущий запрос (null — простаивает); тесты ждут его.
  static consumableBarTask = null;

  // Герой боя, запущенного этим лаунчером (MM.finish; 0 — неизвестен): тренировки тестового ММ
  // не пишутся в game_session_user, и без него бэкенд взял бы героя прошлого обычного боя.
  static battleHero = 0;

  static sendConsumableBar(remote) {
    if (VoiceGameBridge.consumableBarTask) return;
    const now = Date.now();
    const times = VoiceGameBridge.consumableBarTimes.filter((time) => now - time < 60000);
    VoiceGameBridge.consumableBarTimes = times;
    if (times.length >= VoiceGameBridge.CONSUMABLE_BAR_LIMIT) return;
    times.push(now);
    VoiceGameBridge.consumableBarTask = VoiceGameBridge.buildConsumableBarReply()
      .then((reply) => reply && VoiceGameBridge.send(reply, remote))
      .finally(() => {
        VoiceGameBridge.consumableBarTask = null;
      });
  }

  // null — бэкенд не ответил (игра спросит ещё раз)
  static async buildConsumableBarReply() {
    try {
      const heroId = VoiceGameBridge.battleHero;
      const data = await App.api?.request?.('build', 'battleConsumables', heroId ? { heroId } : {});
      const slots = Array.isArray(data?.slots) ? data.slots : [];
      return `PWC 1\nc ${Array.from({ length: 24 }, (value, i) => Math.max(0, Math.trunc(Number(slots[i]) || 0))).join(' ')}`;
    } catch (error) {
      Voice.log('consumable-bar-error', { error: String(error) });
      return null;
    }
  }

  static send(text, remote) {
    if (!VoiceGameBridge.socket || !remote) return;
    try {
      VoiceGameBridge.socket.send(text, remote.port, remote.address);
    } catch {}
  }

  // Рация в бою: клавишу ловит игра (лаунчер спрятан и keydown не получает).
  static setPtt(pressed) {
    if (!Settings.settings?.voiceRadioMode) return;

    clearTimeout(VoiceGameBridge.pttWatchdog);
    VoiceGameBridge.pttWatchdog = null;

    if (pressed) {
      // Пока клавиша зажата, игра повторяет "ptt 1" с каждым poll. Если игра пропадёт с
      // зажатой клавишей (вылет), микрофон не должен остаться включённым.
      VoiceGameBridge.pttWatchdog = setTimeout(() => VoiceGameBridge.releasePtt(), 3000);
    }

    if (VoiceGameBridge.pttPressed === pressed) return;
    VoiceGameBridge.pttPressed = pressed;
    Voice.clearRadioPulseTimer();
    Voice.setRadioPressed(pressed);
  }

  static releasePtt() {
    clearTimeout(VoiceGameBridge.pttWatchdog);
    VoiceGameBridge.pttWatchdog = null;
    if (!VoiceGameBridge.pttPressed) return;
    VoiceGameBridge.pttPressed = false;
    Voice.setRadioPressed(false);
  }

  static hotkeyToVk(tokens, fallback) {
    const cleaned = Array.isArray(tokens) ? tokens.filter((x) => String(x || '').trim()) : [];
    const list = cleaned.length ? cleaned : fallback;
    const codes = [];
    for (const raw of list) {
      const token = String(raw || '').trim().toUpperCase();
      let code = VoiceGameBridge.VK_MAP[token];
      if (!code && /^[A-Z0-9]$/.test(token)) {
        code = token.charCodeAt(0);
      } else if (!code && /^F([1-9]|1[0-2])$/.test(token)) {
        code = 0x6f + Number(token.slice(1));
      } else if (!code && /^NUM_[0-9]$/.test(token)) {
        code = 0x60 + Number(token.slice(4));
      }
      if (!code) return '-';
      codes.push(code);
    }
    return codes.join(',');
  }

  static setPeerMicState(id, state) {
    const peerId = Number(id);
    const value = Number(state);
    if (!Number.isFinite(peerId) || peerId <= 0 || ![0, 1, 2].includes(value)) return;
    VoiceGameBridge.peerMicStates.set(peerId, value);
  }

  // Шлём собеседникам своё состояние микрофона, когда оно изменилось или собеседник новый.
  // В режиме рации мик гаснет между нажатиями — для остальных это «включён».
  static syncMicState(ownState, connectedIds) {
    const reported = ownState === 2 && Settings.settings?.voiceRadioMode ? 1 : ownState;
    for (const id of connectedIds) {
      if (VoiceGameBridge.sentMicStates.get(id) === reported) continue;
      VoiceGameBridge.sentMicStates.set(id, reported);
      Promise.resolve(App.api?.ghost?.('user', 'callMicState', { id, state: reported })).catch(() => {});
    }
  }

  static cleanName(name) {
    return String(name || '').replace(/[\r\n]+/g, ' ').trim() || '?';
  }

  static buildState() {
    const settings = Settings.settings || {};
    const enabled = settings.voiceOverlay !== false;
    const pos = Array.isArray(settings.voiceOverlayPos) ? settings.voiceOverlayPos : [-1, -1];
    const lines = [
      'PWV 1',
      `cfg ${enabled ? 1 : 0} ${settings.voiceRadioMode ? 1 : 0} ${VoiceGameBridge.hotkeyToVk(settings.voiceToggleHotkey, ['CTRL', 'Z'])} ${Number(pos[0]).toFixed(4)} ${Number(pos[1]).toFixed(4)}`,
    ];

    if (!enabled) {
      VoiceGameBridge.pruneMeters(new Set());
      return lines.join('\n');
    }

    const now = Date.now();
    const alive = new Set();
    const present = new Set();
    const connectedIds = [];

    let micState = 0;
    let meSpeaking = false;
    // Выдернутый микрофон (дорожка 'ended') показываем как «нет микрофона», пока он не вернётся.
    if (Voice.mic && Voice.rawMic?.readyState !== 'ended') {
      micState = Voice.mic.enabled ? 1 : 2;
      if (Voice.mic.enabled && Voice.userMedia) {
        alive.add(Voice.userMedia);
        meSpeaking = VoiceGameBridge.isSpeaking(Voice.userMedia, now);
      }
    }
    lines.push(`me ${micState} ${meSpeaking ? 1 : 0} ${VoiceGameBridge.cleanName(App.storage?.data?.login)}`);

    for (const key in Voice.manager) {
      const peer = Voice.manager[key];
      const id = Number(key);
      if (!peer || !Number.isFinite(id)) continue;

      const connected = peer.peer?.connectionState === 'connected';
      present.add(id);
      if (connected) connectedIds.push(id);
      let flags = 0;
      if (connected && peer.stream) {
        alive.add(peer.stream);
        if (VoiceGameBridge.isSpeaking(peer.stream, now)) flags |= 1;
      }
      if (Voice.isPeerSilenced(id)) flags |= 2;
      if (Voice.isMutedByPeer(id)) flags |= 4;
      if (!connected) flags |= 8;
      const peerMic = VoiceGameBridge.peerMicStates.get(id);
      if (peerMic === 2) flags |= 16;
      if (peerMic === 0) flags |= 32;

      lines.push(`p ${id} ${flags} ${Voice.getPeerVolumePercent(id)} ${VoiceGameBridge.cleanName(peer.name || `id${id}`)}`);
    }

    VoiceGameBridge.pruneMeters(alive);

    // Ушедшим из звонка — забыть, чтобы при новом звонке состояния переслались заново.
    for (const map of [VoiceGameBridge.peerMicStates, VoiceGameBridge.sentMicStates]) {
      for (const id of Array.from(map.keys())) {
        if (!present.has(id)) map.delete(id);
      }
    }
    VoiceGameBridge.syncMicState(micState, connectedIds);

    return lines.join('\n');
  }

  static isSpeaking(stream, now) {
    const meter = VoiceGameBridge.getMeter(stream);
    if (!meter) return false;

    meter.analyser.getFloatTimeDomainData(meter.data);
    let sum = 0;
    for (let i = 0; i < meter.data.length; i++) {
      sum += meter.data[i] * meter.data[i];
    }
    const rms = Math.sqrt(sum / meter.data.length);
    if (rms >= VoiceGameBridge.SPEAK_THRESHOLD) {
      meter.speakingUntil = now + VoiceGameBridge.SPEAK_HOLD_MS;
    }
    return now < meter.speakingUntil;
  }

  static getMeter(stream) {
    let meter = VoiceGameBridge.meters.get(stream);
    if (meter) return meter;

    try {
      if (!VoiceGameBridge.audioContext) {
        VoiceGameBridge.audioContext = new AudioContext();
      }
      const context = VoiceGameBridge.audioContext;
      if (context.state === 'suspended') {
        context.resume().catch(() => {});
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      meter = { source, analyser, data: new Float32Array(analyser.fftSize), speakingUntil: 0 };
      VoiceGameBridge.meters.set(stream, meter);
      return meter;
    } catch (error) {
      Voice.log('overlay-meter-error', { error: String(error) });
      return null;
    }
  }

  static disconnectMeter(meter) {
    try {
      meter.source.disconnect();
    } catch {}
    try {
      meter.analyser.disconnect();
    } catch {}
  }

  static pruneMeters(alive) {
    for (const [stream, meter] of VoiceGameBridge.meters) {
      if (!alive.has(stream)) {
        VoiceGameBridge.disconnectMeter(meter);
        VoiceGameBridge.meters.delete(stream);
      }
    }
  }
}

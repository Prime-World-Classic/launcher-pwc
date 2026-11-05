// Демонстрация экрана поверх войса: логика соединений без интерфейса и без зависимостей от лаунчера.
//
// У каждого зрителя своё RTCPeerConnection, отдельное от голосового звонка. Идущий звонок перезаключить
// нечем (offer и answer ходят только при его начале), а так видео не трогает голос: оно может упасть,
// не задев его, и зрители без окна просмотра не тратят канал показывающего.
//
// Сообщения (идут через API как user.screenSignal / событие VScreen):
//   показывающий -> зритель: start, stop, offer {sid, sdp}, candidate {sid, candidate}
//   зритель -> показывающий: request {sid}, answer {sid, sdp}, candidate {sid, candidate}, leave {sid}
//   показывающий -> зритель: full {sid} — мест нет
// sid — номер просмотра, его задаёт зритель. По нему отсеиваются опоздавшие сообщения прошлого просмотра.
//
// Видео идёт напрямую каждому зрителю и кодируется для каждого отдельно: исходящий канал и процессор
// показывающего тратятся на всех сразу. Поэтому общий бюджет делится между зрителями, а их число ограничено.

export const MAX_WATCHERS = 4;
const VIDEO_TOTAL_BITRATE = 4000000;
const VIDEO_MAX_BITRATE = 3000000;
const VIDEO_MAX_FPS = 30;

// Битрейт на одного зрителя: 1 — 3 Мбит/с, 2 — 2, 3 — 1,33, 4 — 1.
export function bitratePerWatcher(count) {
  return Math.min(VIDEO_MAX_BITRATE, Math.floor(VIDEO_TOTAL_BITRATE / Math.max(1, count)));
}

// Поддерживать все кодеки незачем, а SDP с полным списком тяжёлый: на Cloudflare сообщения ~16 КБ и больше
// у игроков из РФ зависают. VP9 и VP8 есть у всех, VP9 лучше держит текст на малом битрейте.
const CODEC_ORDER = ['video/VP9', 'video/VP8'];

export function pickVideoCodecs(codecs) {
  const list = Array.isArray(codecs) ? codecs : [];
  const out = [];
  for (const mime of CODEC_ORDER) {
    for (const codec of list) {
      if (String(codec?.mimeType).toLowerCase() !== mime.toLowerCase()) continue;
      // У VP9 профиль 0 — единственный, который декодируют все клиенты.
      if (mime === 'video/VP9' && /profile-id=(?!0\b)/.test(String(codec.sdpFmtpLine || ''))) continue;
      out.push(codec);
    }
  }
  // Повторная передача нужна, чтобы при потерях картинка не рассыпалась.
  for (const codec of list) {
    if (String(codec?.mimeType).toLowerCase() === 'video/rtx') out.push(codec);
  }
  return out;
}

export class ScreenShareHub {
  // send(id, message) — доставка собеседнику; getIceServers() — STUN/TURN; capture() — поток экрана или null,
  // если игрок передумал; onChange() — перерисовать интерфейс; log(event, data) — запись в voice.log.
  // onFull(id) — у показывающего нет мест для зрителя.
  constructor({ send, getIceServers, capture, onChange = () => {}, onFull = () => {}, log = () => {}, createPeer }) {
    this.send = send;
    this.getIceServers = getIceServers;
    this.capture = capture;
    this.onChange = onChange;
    this.onFull = onFull;
    this.log = log;
    this.createPeer = createPeer || ((config) => new RTCPeerConnection(config));

    this.localStream = null;
    this.starting = false;
    this.announced = new Set(); // кому сообщили, что показ идёт
    this.senders = new Map(); // id зрителя -> {pc, sid, pending}
    this.available = new Set(); // id собеседников, которые сейчас показывают экран
    this.viewers = new Map(); // id показывающего -> {pc, sid, pending, stream, state}
    this.nextSid = 1;
  }

  get sharing() {
    return Boolean(this.localStream);
  }

  // Сколько человек сейчас смотрит показ.
  get watcherCount() {
    return this.senders.size;
  }

  async start(peerIds = []) {
    if (this.localStream || this.starting) return false;
    this.starting = true;
    this.onChange();
    let stream = null;
    try {
      stream = await this.capture();
    } finally {
      this.starting = false;
    }
    if (!stream) {
      this.onChange();
      return false;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const other of stream.getTracks()) other.stop();
      this.onChange();
      return false;
    }
    // Текст и интерфейс важнее плавности: при нехватке канала падает частота кадров, а не чёткость.
    track.contentHint = 'detail';
    // Окно закрыли, или показ остановили кнопкой системы.
    track.onended = () => this.stop();
    this.localStream = stream;
    this.log('screen-start', { peers: peerIds.length });
    for (const id of peerIds) this.announce(id);
    this.onChange();
    return true;
  }

  stop() {
    if (!this.localStream) return;
    const stream = this.localStream;
    this.localStream = null;
    for (const track of stream.getTracks()) {
      track.onended = null;
      track.stop();
    }
    for (const id of this.senders.keys()) this.closeSender(id);
    for (const id of this.announced) this.post(id, { type: 'stop' });
    this.announced.clear();
    this.log('screen-stop', {});
    this.onChange();
  }

  announce(id) {
    id = Number(id);
    if (!this.localStream || this.announced.has(id)) return;
    this.announced.add(id);
    this.post(id, { type: 'start' });
  }

  // Голосовой звонок с собеседником завершился.
  peerGone(id) {
    id = Number(id);
    this.announced.delete(id);
    this.closeSender(id);
    this.closeViewer(id);
    if (this.available.delete(id)) this.onChange();
  }

  // Начать смотреть показ собеседника.
  watch(id) {
    id = Number(id);
    if (!this.available.has(id) || this.viewers.has(id)) return;
    const sid = this.nextSid++;
    this.viewers.set(id, { pc: null, sid, pending: [], stream: null, state: 'connecting' });
    this.post(id, { type: 'request', sid });
    this.onChange();
  }

  unwatch(id) {
    id = Number(id);
    const viewer = this.viewers.get(id);
    if (!viewer) return;
    this.post(id, { type: 'leave', sid: viewer.sid });
    this.closeViewer(id);
    this.onChange();
  }

  closeAll() {
    this.stop();
    for (const id of Array.from(this.viewers.keys())) this.unwatch(id);
  }

  async handle(fromId, message) {
    const id = Number(fromId);
    const type = String(message?.type || '');
    try {
      switch (type) {
        case 'start':
          this.available.add(id);
          this.onChange();
          break;
        case 'stop':
          this.available.delete(id);
          this.closeViewer(id);
          this.onChange();
          break;
        case 'request':
          await this.onRequest(id, message.sid);
          break;
        case 'leave':
          if (this.senders.get(id)?.sid === message.sid) {
            this.closeSender(id);
            this.onChange();
          }
          break;
        case 'full':
          if (this.viewers.get(id)?.sid === message.sid) {
            this.closeViewer(id);
            this.onFull(id);
            this.onChange();
          }
          break;
        case 'offer':
          await this.onOffer(id, message.sid, message.sdp);
          break;
        case 'answer':
          await this.onAnswer(id, message.sid, message.sdp);
          break;
        case 'candidate':
          await this.onCandidate(id, message.sid, message.candidate);
          break;
      }
    } catch (error) {
      this.log('screen-error', { id, type, error: String(error) });
    }
  }

  post(id, message) {
    try {
      const sent = this.send(id, message);
      sent?.catch?.((error) => this.log('screen-send-error', { id, type: message.type, error: String(error) }));
    } catch (error) {
      this.log('screen-send-error', { id, type: message.type, error: String(error) });
    }
  }

  async makePeer(id, entry) {
    const iceServers = await this.getIceServers();
    const pc = this.createPeer({ iceServers });
    entry.pc = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate) this.post(id, { type: 'candidate', sid: entry.sid, candidate: event.candidate });
    };
    return pc;
  }

  async onRequest(id, sid) {
    if (!this.localStream) {
      this.post(id, { type: 'stop' });
      return;
    }
    this.closeSender(id);
    if (this.senders.size >= MAX_WATCHERS) {
      this.log('screen-full', { id });
      this.post(id, { type: 'full', sid });
      return;
    }
    const entry = { pc: null, sid, pending: [], sender: null };
    this.senders.set(id, entry);
    const pc = await this.makePeer(id, entry);
    // Показ остановили или зритель ушёл, пока ждали ICE-серверы.
    if (this.senders.get(id) !== entry || !this.localStream) {
      this.closePc(pc);
      return;
    }
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.log('screen-sender-state', { id, state });
      if ((state === 'failed' || state === 'closed') && this.senders.get(id) === entry) {
        this.closeSender(id);
        this.onChange();
      }
    };
    const track = this.localStream.getVideoTracks()[0];
    const transceiver = pc.addTransceiver(track, { direction: 'sendonly', streams: [this.localStream] });
    try {
      const codecs = pickVideoCodecs(globalThis.RTCRtpSender?.getCapabilities?.('video')?.codecs);
      if (codecs.length) transceiver.setCodecPreferences(codecs);
    } catch (error) {
      this.log('screen-codec-error', { error: String(error) });
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.post(id, { type: 'offer', sid, sdp: pc.localDescription.sdp });
    entry.sender = transceiver.sender;
    await this.applyBitrates();
    this.onChange();
  }

  // Зритель пришёл или ушёл — бюджет делится заново.
  async applyBitrates() {
    const maxBitrate = bitratePerWatcher(this.senders.size);
    for (const { sender } of this.senders.values()) {
      if (!sender) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings?.length) continue;
        params.encodings[0].maxBitrate = maxBitrate;
        params.encodings[0].maxFramerate = VIDEO_MAX_FPS;
        await sender.setParameters(params);
      } catch (error) {
        this.log('screen-limit-error', { error: String(error) });
      }
    }
  }

  async onOffer(id, sid, sdp) {
    const viewer = this.viewers.get(id);
    // Предложение только в ответ на свой запрос: без него чужое видео не откроется.
    if (!viewer || viewer.sid !== sid || viewer.pc) return;
    const pc = await this.makePeer(id, viewer);
    if (this.viewers.get(id) !== viewer) {
      this.closePc(pc);
      return;
    }
    pc.ontrack = (event) => {
      viewer.stream = event.streams?.[0] || new MediaStream([event.track]);
      this.onChange();
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.log('screen-viewer-state', { id, state });
      if (this.viewers.get(id) !== viewer) return;
      viewer.state = state;
      if (state === 'failed') {
        this.closeViewer(id);
      }
      this.onChange();
    };
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await this.flushCandidates(viewer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.post(id, { type: 'answer', sid, sdp: pc.localDescription.sdp });
  }

  async onAnswer(id, sid, sdp) {
    const entry = this.senders.get(id);
    if (!entry?.pc || entry.sid !== sid) return;
    await entry.pc.setRemoteDescription({ type: 'answer', sdp });
    await this.flushCandidates(entry);
  }

  async onCandidate(id, sid, candidate) {
    const sender = this.senders.get(id);
    const entry = sender?.sid === sid ? sender : this.viewers.get(id)?.sid === sid ? this.viewers.get(id) : null;
    if (!entry || !candidate) return;
    // Кандидат может обогнать offer или answer.
    if (!entry.pc?.remoteDescription) {
      entry.pending.push(candidate);
      return;
    }
    await entry.pc.addIceCandidate(candidate);
  }

  async flushCandidates(entry) {
    for (const candidate of entry.pending.splice(0)) {
      await entry.pc.addIceCandidate(candidate);
    }
  }

  closePc(pc) {
    if (!pc) return;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.ontrack = null;
    try {
      pc.close();
    } catch {}
  }

  closeSender(id) {
    const entry = this.senders.get(id);
    if (!entry) return;
    this.senders.delete(id);
    this.closePc(entry.pc);
    this.applyBitrates();
  }

  closeViewer(id) {
    const entry = this.viewers.get(id);
    if (!entry) return;
    this.viewers.delete(id);
    this.closePc(entry.pc);
  }
}

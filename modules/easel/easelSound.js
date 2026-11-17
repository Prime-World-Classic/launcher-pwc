// Звуки «Мастерской свитков» — события FMOD группы Minigame02 клиента PW (Data/Audio/PrimeWorld.fev + Minigame02.fsb →
// content/easel/sfx/*.ogg + events.json, tools/pw-convert/build_easel_sounds.py), Web Audio.
// Как в клиенте (PF_Minigames/EaselFModEvent.cpp, свойства событий из FMOD Designer):
// - громкость события (volume) и разброс громкости/высоты (volumeRand/pitchRand) — при каждом запуске;
// - высота и эффекты слоёв у разовых событий уже в файле (рендер самим FMOD), у зацикленных — rate;
// - повторный запуск того же звука (тот же id, по умолчанию — имя события) перезапускает его, а зацикленный, пока
//   звучит, не трогается;
// - одновременно звучит не больше maxPlaybacks экземпляров события, лишний вытесняет старый (steal) или не звучит;
// - остановка — сразу, без затухания: клиент останавливает события с fImmediately (fadeOut не нужен).
// Тот же интерфейс (load/play/stop/stopAll/pause/setVolume/destroy) повторяет звук Android (easelNative.js,
// SoundPool) — общие части ниже экспортируются для него.
import { EASEL_BASE, fetchOk } from './easelRenderer.js';

export const SFX_BASE = EASEL_BASE + 'sfx/';

// Таблица событий: имя → {file, volume, rate, loop, maxPlaybacks, steal, volumeRand, pitchRand, fadeIn, offset, ms}
export async function loadEaselEvents() {
  return (await fetchOk(SFX_BASE + 'events.json')).events || {};
}

// Громкость экземпляра: громкость события, разброс FMOD — только вниз, в дБ
export function eventGain(ev) {
  let g = ev.volume ?? 1;
  if (ev.volumeRand) g *= 10 ** ((-Math.random() * ev.volumeRand) / 20);
  return g;
}

// Скорость экземпляра: rate события и разброс высоты ± pitchRand полутонов
export function eventRate(ev) {
  let r = ev.rate || 1;
  if (ev.pitchRand) r *= 2 ** (((Math.random() * 2 - 1) * ev.pitchRand) / 12);
  return r;
}

// Учёт звучащих экземпляров: id → экземпляр, лимит повторов события. stopFn(handle) — заглушить экземпляр.
// Время — в секундах любых часов (end — когда экземпляр доиграет сам, Infinity у зацикленных).
export class EaselVoices {
  constructor(stopFn) {
    this.stopFn = stopFn;
    this.list = [];
  }

  prune(now) {
    this.list = this.list.filter((v) => v.end > now);
  }

  // Можно ли запустить событие name под id; заодно глушит тех, кого надо вытеснить
  admit(name, ev, id, now) {
    this.prune(now);
    const same = this.list.find((v) => v.id === id);
    if (same) {
      if (ev.loop && same.name === name) return false; // зацикленный уже звучит
      this.kill(same);
    }
    const mine = this.list.filter((v) => v.name === name);
    if (mine.length >= Math.max(1, ev.maxPlaybacks || 1)) {
      if (ev.steal === 'fail' || ev.steal === 'failIfQuietest') return false;
      // quietest — громкость у всех экземпляров одна, вытесняем старый
      this.kill(ev.steal === 'newest' ? mine[mine.length - 1] : mine[0]);
    }
    return true;
  }

  add(id, name, handle, end) {
    this.list.push({ id, name, handle, end });
  }

  // Экземпляр доиграл сам
  forget(handle) {
    this.list = this.list.filter((v) => v.handle !== handle);
  }

  kill(v) {
    this.list = this.list.filter((x) => x !== v);
    this.stopFn(v.handle);
  }

  stop(id) {
    for (const v of this.list.filter((x) => x.id === id)) this.kill(v);
  }

  stopAll() {
    for (const v of [...this.list]) this.kill(v);
  }
}

export class EaselSound {
  constructor() {
    this.events = {};
    this.buffers = {}; // файл → AudioBuffer
    this.last = {};
    this.volume = 0.5;
    this.muted = false;
    this.voices = new EaselVoices((src) => {
      try {
        src.stop();
      } catch (e) {
        // уже остановлен
      }
    });
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    } catch (e) {
      this.ctx = null; // без звука
    }
  }

  async load() {
    if (!this.ctx) return;
    try {
      this.events = await loadEaselEvents();
    } catch (e) {
      console.warn('easel: sound events failed', e);
      return;
    }
    const files = new Set(
      Object.values(this.events)
        .map((ev) => ev.file)
        .filter(Boolean),
    );
    await Promise.all(
      [...files].map(async (f) => {
        try {
          const buf = await fetchOk(`${SFX_BASE}${f}.ogg`, 'buf');
          this.buffers[f] = await this.ctx.decodeAudioData(buf);
        } catch (e) {
          console.warn('easel: sound failed', f, e);
        }
      }),
    );
  }

  setVolume(v, muted = this.muted) {
    this.volume = v;
    this.muted = muted;
    if (this.out) this.out.gain.value = muted ? 0 : v;
  }

  // name — событие FMOD (events.json). opts: {id — слот звука (по умолчанию имя события): новый запуск в том же
  // слоте перезапускает звук, как EaselFModEvent::Play; gap — не чаще чем раз в gap секунд; volume — множитель}
  play(name, opts = {}) {
    const ev = this.events[name];
    const b = ev && this.buffers[ev.file];
    if (!b || !this.ctx || this.muted || !(ev.volume > 0)) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    if (opts.gap && this.last[name] !== undefined && now - this.last[name] < opts.gap) return;
    const id = opts.id || name;
    if (!this.voices.admit(name, ev, id, now)) return;
    this.last[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = !!ev.loop;
    const rate = eventRate(ev);
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    const vol = eventGain(ev) * (opts.volume ?? 1);
    if (ev.fadeIn > 0) {
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(vol, now + ev.fadeIn / 1000);
    } else g.gain.value = vol;
    src.connect(g);
    g.connect(this.out);
    const offset = Math.min(ev.offset || 0, b.duration);
    const end = ev.loop ? Infinity : now + (b.duration - offset) / rate + 0.05;
    this.voices.add(id, name, src, end);
    src.onended = () => this.voices.forget(src);
    src.start(0, offset);
  }

  stop(id) {
    if (id) this.voices.stop(id);
  }

  stopAll() {
    this.voices.stopAll();
  }

  pause(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend();
    else this.ctx.resume();
  }

  destroy() {
    this.stopAll();
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}

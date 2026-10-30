// Звуки «Мастерской свитков» (Data/Audio/Minigame02.fsb → content/easel/sounds/*.ogg), Web Audio
import { EASEL_BASE, fetchOk } from './easelRenderer.js';

export const SOUNDS = [
  'easel_drop_shot',
  'easel_hit_color_match',
  'easel_hit_color_missmatch',
  'easel_miss',
  'easel_platform_drops_swap',
  'easel_drop_explosion',
  'easel_paint_flow',
  'easel_drop_slide_high',
  'easel_drop_slide_low',
  'easel_chain_merged',
  'easel_chain_destroyed',
  'easel_chain_near_exit',
  'easel_chain_reach_end',
  'easel_level_scroll_start',
  'easel_level_win',
  'easel_level_loose',
  'easel_result_gold',
  'easel_result_silver',
  'easel_coin_catched',
  'easel_ball_in_tunnel',
  'easel_ball_out_tunnel',
  'easel_boost_paintblast_clic',
  'easel_boost_paintblas_explosion',
  'easel_boost_freeze_click',
  'easel_boost_joker_click',
  'easel_boost_inspiration_cli',
  'Magnet',
  'Alchemist',
];

// Поправки громкости отдельных звуков (в PW все события Minigame02 одинаковые: −5 дБ)
const TRIM = {
  easel_platform_drops_swap: 0.12,
  easel_chain_merged: 0.12,
};

export class EaselSound {
  constructor() {
    this.buffers = {};
    this.playing = new Map(); // id → источник (для остановки)
    this.last = {};
    this.volume = 0.5;
    this.muted = false;
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
    await Promise.all(
      SOUNDS.map(async (n) => {
        try {
          const buf = await fetchOk(`${EASEL_BASE}sounds/${n}.ogg`, 'buf');
          this.buffers[n] = await this.ctx.decodeAudioData(buf);
        } catch (e) {
          console.warn('easel: sound failed', n, e);
        }
      }),
    );
  }

  setVolume(v, muted = this.muted) {
    this.volume = v;
    this.muted = muted;
    if (this.out) this.out.gain.value = muted ? 0 : v;
  }

  // opts: {id — заменяет прежний звук с тем же id (по умолчанию — имя звука: как в PW, у каждого
  // события FMOD один экземпляр, max playbacks = 1, повторный Play перезапускает), gap — не чаще
  // чем раз в gap секунд, volume}
  play(name, opts = {}) {
    const b = this.buffers[name];
    if (!b || !this.ctx || this.muted) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const now = this.ctx.currentTime;
    if (opts.gap && this.last[name] !== undefined && now - this.last[name] < opts.gap) return;
    this.last[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    let node = src;
    const vol = (opts.volume ?? 1) * (TRIM[name] ?? 1);
    if (vol !== 1) {
      const g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(g);
      node = g;
    }
    node.connect(this.out);
    const id = opts.id || name;
    this.stop(id);
    this.playing.set(id, src);
    src.onended = () => {
      if (this.playing.get(id) === src) this.playing.delete(id);
    };
    src.start();
  }

  stop(id) {
    if (!id) return;
    const s = this.playing.get(id);
    if (!s) return;
    this.playing.delete(id);
    try {
      s.stop();
    } catch (e) {
      // уже остановлен
    }
  }

  stopAll() {
    for (const id of [...this.playing.keys()]) this.stop(id);
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

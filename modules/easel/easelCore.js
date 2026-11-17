// «Мастерская свитков» без интерфейса: загрузка, цикл кадров, ввод, звуки по событиям, прогресс, рекорды.
// Общий для лаунчера (easel.js — окно на HTML) и Android-приложения (экран на NativeScript):
// вид рисует меню и HUD по состоянию сессии и передаёт ей касания/мышь. Всё, что зависит от среды, — в easelPlatform.js.
import { EaselRenderer, EASEL_BASE, CONTENT_BASE, fetchOk } from './easelRenderer.js';
import { EaselGame, Rng, BOARD, BOOST, BALL_TYPE, POINT_MODE, STEP_MS, M, FIELD_L, selectTrajectory } from './easelLogic.js';
import { EaselSound } from './easelSound.js';
import { EaselFx } from './easelFx.js';
import { EaselScene, toLogic, FIELD } from './easelScene.js';
import { EaselPlatform } from './easelPlatform.js';

export { BOARD, BOOST } from './easelLogic.js';

const LUX_Z = 0.56;
const STORE_KEY = 'easel.progress.v1';
const START_GOLD = 300;
export const LEVELS = 16;
// Панель бустов: тип логики, иконка (Data/UI/Styles/Minigame02/Boosts → content/easel/ui), клавиша
export const BOOST_UI = [
  { type: BOOST.PAINTBLAST, icon: 'boost_colorbomb', key: '1' },
  { type: BOOST.FREEZE, icon: 'boost_freeze', key: '2' },
  { type: BOOST.JOKER, icon: 'boost_jocker', key: '3' },
  { type: BOOST.SORTER, icon: 'boost_sort', key: '4' },
  { type: BOOST.MAGNET, icon: 'boost_magnet', key: '5' },
  { type: BOOST.ALCHEMIST, icon: 'boost_alchemist', key: '6' },
];
export const DIFFICULTY_KEY = { Easy: 'easelDiffEasy', Medium: 'easelDiffMedium', Hard: 'easelDiffHard', Impossible: 'easelDiffImpossible' };
export const MEDAL_KEY = { gold: 'easelMedalGold', silver: 'easelMedalSilver', bronze: 'easelMedalBronze' };
export const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };
export const MEDAL_BY_RANK = [null, 'bronze', 'silver', 'gold'];

export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// Время рекорда с десятыми: 1:23.4
export const fmtRec = (ms) => {
  const d = Math.max(0, Math.floor(ms / 100));
  return `${fmtTime(d / 10)}.${d % 10}`;
};

// Подсказка буста из Minigame02 (теги PW: <style:TT_Title>, <br>, <value:price>)
export function parseTooltip(src, price) {
  if (!src) return { title: '', body: '' };
  const t = src.replace(/<value:price>/g, String(price));
  const m = t.match(/<style:TT_Title>(.*?)(?:<br>|<style:)/);
  const title = m ? m[1].replace(/<[^>]*>/g, '').trim() : '';
  const i = t.lastIndexOf('<br><br>');
  const body = (i >= 0 ? t.slice(i + 8) : t).replace(/<[^>]*>/g, '').trim();
  return { title, body };
}

export function loadProgress() {
  const def = { gold: START_GOLD, maxLevel: 0, medals: {}, trackUse: {}, lastTrack: -1, first: true };
  try {
    return { ...def, ...JSON.parse(EaselPlatform.storage.get(STORE_KEY) || '{}') };
  } catch (e) {
    return def;
  }
}

// Данные мини-игры (data.json) — одни на все открытия
let DATA = null;

export class EaselSession {
  // canvas — канва с WebGL2; opts.faction — 'ad' | 'doct' (модель мольберта);
  // opts.api — {online(): bool, myId(): number, request(method, data): Promise} или null (без рейтинга)
  constructor(canvas, { faction = 'doct', api = null } = {}) {
    this.canvas = canvas;
    this.faction = faction === 'ad' ? 'ad' : 'doct';
    this.api = api;
    this.progress = loadProgress();
    this.renderer = this.fx = this.sound = this.data = null;
    this.game = this.scene = null;
    this.board = [];
    this.running = false;
    this.paused = false;
    this.suspended = false;
    this.mouse = null; // точка в CSS-пикселях канвы (браузер — clientX/Y окна)
    this.clicks = { left: false, right: false };
    this.records = null;
    this.overallMe = null;
    this.level = 0;
    this.acc = 0;
    this._near = false;
    this._recordsReq = null;
    this._startReq = null;
    // Хуки вида: перед кадром (громкость), после кадра (HUD), конец партии
    this.beforeFrame = null;
    this.afterFrame = null;
    this.onFinish = null;
    this._frame = this._frame.bind(this);
  }

  async load() {
    this.renderer = new EaselRenderer(this.canvas);
    if (!DATA) DATA = await fetchOk(EASEL_BASE + 'data.json');
    this.data = DATA;
    const Sound = EaselPlatform.Sound || EaselSound;
    this.sound = new Sound();
    this.fx = new EaselFx(this.renderer);
    // эффекты необязательны: без них сцена рисует простые спрайты
    const fxLoad = this.fx.load().catch((e) => console.warn('easel: effects', e));
    await Promise.all([this.renderer.load(), this.sound.load(), fxLoad]);
    await this._loadBoard();
  }

  // Запустить цикл кадров (после load)
  start() {
    if (this.running || !this.renderer) return;
    this.running = true;
    this._last = EaselPlatform.now();
    EaselPlatform.raf(this._frame);
  }

  destroy() {
    this.saveGold();
    this.running = false;
    this.game = this.scene = null;
    this.records = this._recordsReq = null;
    if (this.renderer) this.renderer.destroy();
    this.renderer = this.fx = null;
    if (this.sound) this.sound.destroy();
    this.sound = null;
  }

  // Модель здания (та же, что в замке): content/meshes/easel/*.bin
  // (Докты — Buildings/A/MiniGame, Адорнийцы — Buildings/B/MiniGame)
  async _loadBoard() {
    const r = this.renderer;
    const parts =
      this.faction === 'ad'
        ? [
            ['ad_0', 'easel/ad_board'],
            ['ad_1', 'easel/ad_gem'],
          ]
        : [['doct_0', 'easel/doct_board']];
    this.board = [];
    for (const [mesh, tex] of parts) {
      const buf = await fetchOk(`${CONTENT_BASE}meshes/easel/${mesh}.bin`, 'buf');
      const texId = 'board_' + mesh;
      await r.loadTexture(texId, `${CONTENT_BASE}textures/${tex}.webp`);
      const m = r.dynamicModel('board_' + mesh, new Float32Array(buf));
      m.subs[0].tex = texId;
      m.subs[0].kind = mesh === 'ad_1' ? 'drop' : undefined;
      this.board.push(m);
    }
  }

  save() {
    EaselPlatform.storage.set(STORE_KEY, JSON.stringify(this.progress));
  }

  saveGold() {
    if (this.game && !this.game._saved) this.progress.gold = Math.max(0, this.game.gold);
    this.save();
  }

  // ---------- партия ----------
  async startLevel(level, track) {
    const data = this.data;
    level = Math.max(0, Math.min(LEVELS - 1, level | 0));
    this.saveGold();
    const P = this.progress;
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    if (track === undefined || track === null || !data.tracks[track]) {
      track = selectTrajectory(data, level, P.trackUse, P.lastTrack, new Rng(seed), P.first);
    }
    P.lastTrack = track;
    if (level === 0) P.first = false;
    this.save();
    const picture = level % data.pictures.length;
    const boosts = level >= 1 ? BOOST_UI.map((b) => b.type) : [];
    const game = new EaselGame({ data, track, level, picture, seed, triple: false, boosts, gold: P.gold });
    const tex = await this.renderer.loadPicture(picture);
    if (!this.renderer) return false; // закрыли во время загрузки
    game.trackIndex = track;
    this.game = game;
    this.scene = new EaselScene(this.renderer, data, game, this.board, tex, this.fx);
    this.level = level;
    this.acc = 0;
    this.clicks = { left: false, right: false };
    this.paused = false;
    this._near = false;
    this._magnet = false;
    if (this.sound) {
      this.sound.stopAll();
      this.sound.pause(false);
    }
    game.start();
    this._startReq = this.req('start', { level });
    return true;
  }

  // Выйти из партии к меню (доска без игры)
  stopGame() {
    this.saveGold();
    this.game = this.scene = null;
    this.paused = false;
    if (this.sound) {
      this.sound.stopAll();
      this.sound.pause(false);
    }
  }

  // Пауза партии; false — нельзя (нет партии или она уже закончилась)
  pause(on) {
    const g = this.game;
    if (!g || g.state === BOARD.WON_FINAL || g.state === BOARD.FAIL_FINAL) return false;
    this.paused = on;
    if (this.sound) this.sound.pause(on);
    if (!on) this._last = EaselPlatform.now();
    return true;
  }

  // Свернуть (окно лаунчера поверх, приложение в фоне): кадры не считаются, звук на паузе
  suspend(on) {
    this.suspended = on;
    if (this.sound) this.sound.pause(on || this.paused);
    if (!on) this._last = EaselPlatform.now();
  }

  // Конец партии (FINAL) — показано окно итогов
  get finished() {
    const g = this.game;
    return !!g && (g.state === BOARD.WON_FINAL || g.state === BOARD.FAIL_FINAL);
  }

  // ---------- ввод ----------
  // Указатель (мышь, палец) в CSS-пикселях канвы; null — убран
  setPointer(x, y) {
    this.mouse = x === null || x === undefined ? null : [x, y];
  }

  // Щелчок: 'left' — выстрел / старт уровня, 'right' — поменять капли
  click(button) {
    if (!this.game || this.paused) return;
    this.clicks[button === 'right' ? 'right' : 'left'] = true;
  }

  fireBoost(type) {
    const g = this.game;
    if (!g || this.paused) return;
    const b = g.boosts.get(type);
    const can = g.boosts.canFire(b);
    g.fireBoost(type);
    if (can && type === BOOST.ALCHEMIST && this.sound) this.sound.play('alchemist');
  }

  // ---------- кадр ----------
  _frame(now) {
    if (!this.running || !this.renderer) return;
    if (this.suspended) {
      this._last = now;
      EaselPlatform.raf(this._frame);
      return;
    }
    if (this.beforeFrame) this.beforeFrame();
    const dt = Math.min(0.25, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    const g = this.game;
    const s = this.scene;
    if (g && s) {
      if (!this.paused) {
        this._liveAim();
        this.acc += dt * 1000;
        while (this.acc >= STEP_MS) {
          this.acc -= STEP_MS;
          const [x, y] = this._fieldMouse() || [g.platform.pos.x / M, FIELD / 2];
          g.input(x, y, this.clicks.left, this.clicks.right);
          this.clicks.left = this.clicks.right = false;
          g.step(STEP_MS);
          const ev = g.events.splice(0);
          s.afterStep(ev);
          for (const e of ev) this._onEvent(e);
          if (!this.game) break;
          this._checkNearExit();
          this._checkMagnet();
        }
      }
      if (this.scene) this.scene.render(this.paused ? 0 : dt);
    } else {
      // меню без партии: пустая доска
      const r = this.renderer;
      const cam = this.data.common.camera;
      r.setCamera({ target: [cam.anchor.x, cam.anchor.y, cam.anchor.z], yaw: cam.yaw, pitch: cam.pitch, rod: cam.rod, fov: cam.fov });
      r.begin();
      for (const b of this.board) r.draw({ model: b, matrix: BOARD_MATRIX });
      r.end();
    }
    if (this.afterFrame) this.afterFrame();
    if (this.running) EaselPlatform.raf(this._frame);
  }

  // Указатель → координаты поля (0..FIELD)
  _fieldMouse() {
    if (!this.mouse || !this.renderer) return null;
    const p = this.renderer.screenToPlane(this.mouse[0], this.mouse[1], LUX_Z);
    return toLogic(p[0], p[1]);
  }

  // Тележка следует за указателем каждый кадр (логика всё равно берёт позицию на шаге)
  _liveAim() {
    const g = this.game;
    const f = this._fieldMouse();
    const mg = g.boosts.get(BOOST.MAGNET);
    if (!f || (mg && mg.state === 'waiting')) return;
    const x = Math.max(20, Math.min(FIELD_L - 20, Math.trunc(f[0] * M)));
    g.platform.setPos({ x, y: g.platform.pos.y });
    if (g.state === BOARD.LEVEL_RUN) g._updatePointer();
  }

  _onEvent(e) {
    this._soundFor(e);
    if (e.type !== 'state') return;
    if (e.state === BOARD.WON_FINAL || e.state === BOARD.FAIL_FINAL) this._finish(e.state === BOARD.WON_FINAL);
  }

  // Звуки по событиям логики (PF_Minigames/SoundObserver.cpp, EaselMinigameData.xdb: soundData). Имя — событие FMOD
  // группы Minigame02 (content/easel/sfx/events.json): громкость, высота, лимит повторов — из него, см. easelSound.js
  _soundFor(e) {
    const S = this.sound;
    if (!S) return;
    switch (e.type) {
      case 'fired':
        return S.play('easel_drop_shot');
      case 'hit':
        return S.play(e.matched ? 'easel_hit_color_match' : 'easel_hit_color_missmatch');
      case 'miss':
        return S.play('easel_miss');
      case 'swap':
        return S.play('easel_platform_drops_swap');
      case 'explode':
        return S.play('easel_drop_explosion', { gap: 0.06 });
      case 'paintFlow':
        return S.play('easel_paint_flow', { gap: 0.3 });
      case 'paintBlast':
        return S.play('easel_boost_paintblast_explosion');
      case 'chainGenerated':
        return S.play('easel_drop_slide_high', { gap: 0.5 });
      case 'slideBack':
        return S.play('easel_drop_slide_low', { gap: 0.5 });
      case 'chainMerged':
        return S.play('easel_chain_merged', { gap: 0.3 });
      case 'chainDestroyed':
        return S.play('easel_chain_destroyed', { gap: 0.3 });
      case 'tunnel':
        return S.play(e.in ? 'easel_ball_in_tunnel' : 'easel_ball_out_tunnel', { gap: 0.1 });
      case 'coinPicked':
        return S.play('easel_coin_catched');
      case 'freeze':
        return e.on && S.play('easel_boost_freeze_click');
      case 'sorter':
        return S.play('easel_boost_inspiration_click');
      case 'specialBall':
        return S.play(e.ball.type === BALL_TYPE.JOKER ? 'easel_boost_joker_click' : 'easel_boost_paintblast_click');
      case 'state':
        if (e.state === BOARD.LEVEL_BEGIN) S.play('easel_level_scroll_start');
        else if (e.state === BOARD.LEVEL_WON) {
          S.stopAll();
          S.play('easel_level_win', { id: 'result' });
        } else if (e.state === BOARD.LEVEL_FAIL) {
          S.stopAll();
          S.play('easel_chain_reach_end', { id: 'result' });
        } else if (e.state === BOARD.FAIL_FINAL) S.play('easel_level_loose', { id: 'result' });
    }
  }

  // Цепочка близко к колодцу — тревожный звук (CHAIN_NEAR_EXIT), пока не отъедет
  _checkNearExit() {
    const g = this.game;
    let k = 0;
    if (g.state === BOARD.LEVEL_RUN) {
      for (const bc of g.boardChains) if (bc.chains.length) k = Math.max(k, bc.chains[0].position() / bc.path.traj.length);
    }
    if (!this._near && k > 0.82) {
      this._near = true;
      if (this.sound) this.sound.play('easel_chain_near_exit', { id: 'near' });
    } else if (this._near && k < 0.75) {
      this._near = false;
      if (this.sound) this.sound.stop('near');
    }
  }

  // Магнит стоит в точке картины — его звук (событие magnet зациклено: в клиенте он висит на эффекте магнита,
  // Minigames/Minigame02/Effects/Magnet/_.PRXY) звучит, пока магнит не снят
  _checkMagnet() {
    const g = this.game;
    let on = false;
    if (g.state === BOARD.LEVEL_RUN) for (const p of g.paint.points()) if (p.mode === POINT_MODE.MAGNET_INSTALLED) on = true;
    if (on === this._magnet) return;
    this._magnet = on;
    if (!this.sound) return;
    if (on) this.sound.play('magnet');
    else this.sound.stop('magnet');
  }

  // Итог партии: прогресс, медаль, отправка результата. Вид получает onFinish({won, medal, game, result}),
  // где result — Promise итога на сервере (см. sendResult)
  _finish(won) {
    const g = this.game;
    const P = this.progress;
    P.gold = Math.max(0, g.gold);
    g._saved = true;
    let medal = null;
    if (won) {
      medal = g.medal || 'bronze';
      const prev = P.medals[g.level];
      if (!prev || MEDAL_RANK[medal] > MEDAL_RANK[prev]) P.medals[g.level] = medal;
      P.maxLevel = Math.max(P.maxLevel, Math.min(LEVELS - 1, g.level + 1));
    }
    this.save();
    if (this.sound && (medal === 'gold' || medal === 'silver')) this.sound.play('easel_result_' + medal, { id: 'medal' });
    const result = this.sendResult(g, won, medal);
    if (this.onFinish) this.onFinish({ won, medal, game: g, result });
  }

  // Состояние HUD: время, медаль по времени, заливка, золото, баннер (ключ текста + переменные), бусты
  hud() {
    const g = this.game;
    if (!g) return null;
    const st = g.levelStats;
    const t = g.elapsed / 1000;
    const medal = t <= st.goldMedalTime ? 'gold' : t <= st.silverMedalTime ? 'silver' : null;
    const mg = g.boosts.get(BOOST.MAGNET);
    let banner = null;
    if (g.state === BOARD.LEVEL_BEGIN) banner = 'begin';
    else if (g.state >= BOARD.LEVEL_WON && g.state <= BOARD.WON_MOVIE) banner = 'won';
    else if (g.state === BOARD.LEVEL_FAIL) banner = 'fail';
    else if (mg && mg.state === 'waiting') banner = 'magnet';
    else if (g.frozen) banner = 'freeze';
    const boosts = [];
    for (const ui of BOOST_UI) {
      const b = g.boosts.get(ui.type);
      if (!b) continue;
      boosts.push({
        ...ui,
        boost: b,
        price: b.price,
        cooldown: b.cooldown,
        can: g.boosts.canFire(b),
        active: b.waiting || (b.type === BOOST.FREEZE && g.frozen) || !!b.active,
        poor: g.gold < b.price,
        cd: b.cooling ? 1 - b.progress() : 0,
      });
    }
    return {
      level: g.level,
      difficulty: this.data.levels[g.level].difficulty,
      time: t,
      medal,
      medalTime: medal === 'gold' ? st.goldMedalTime : medal === 'silver' ? st.silverMedalTime : 0,
      fill: g.paint.fillRatio(),
      gold: g.gold,
      banner,
      boosts,
    };
  }

  // ---------- рекорды и рейтинг (backend: объект easel) ----------
  online() {
    try {
      return !!(this.api && this.api.online());
    } catch (e) {
      return false;
    }
  }

  myId() {
    return this.online() ? Number(this.api.myId()) || 0 : 0;
  }

  // Запрос к API; null — без входа; ошибка → { error: текст } (сервер без объекта easel, нет связи).
  // error === true — техническая ошибка (вид покажет «рейтинг временно недоступен»)
  async req(method, data = {}) {
    if (!this.online()) return null;
    try {
      return await this.api.request('easel', method, data);
    } catch (e) {
      console.warn('easel api', method, e);
      const text = String((e && e.message) || e || '');
      return { error: !text || /^Not (object|method)|Внутренняя/.test(text) ? true : text };
    }
  }

  // Свои рекорды с сервера: время на плитках уровней и перенос прогресса (уровни, медали) между устройствами
  loadRecords() {
    if (this._recordsReq) return this._recordsReq;
    this._recordsReq = (async () => {
      const r = await this.req('me');
      if (!r || r.error || !Array.isArray(r.levels)) {
        this._recordsReq = null;
        return false;
      }
      const P = this.progress;
      this.records = {};
      for (const l of r.levels) {
        this.records[l.level] = l;
        if (!l.wins || l.level < 0 || l.level >= LEVELS) continue;
        P.maxLevel = Math.max(P.maxLevel, Math.min(LEVELS - 1, l.level + 1));
        const m = MEDAL_BY_RANK[l.medal];
        if (m && (!P.medals[l.level] || MEDAL_RANK[m] > MEDAL_RANK[P.medals[l.level]])) P.medals[l.level] = m;
      }
      this.overallMe = r.overall || null;
      this.save();
      return true;
    })();
    return this._recordsReq;
  }

  // Отправить итог партии. Ответ: {offline: true} | {error} | {won, best, place, total, newRecord}
  async sendResult(g, won, medal) {
    if (!this.online()) return { offline: true };
    await this._startReq;
    const r = await this.req('finish', {
      level: g.level,
      track: g.trackIndex,
      won,
      timeMs: Math.round(g.elapsed),
      score: g.goldEarned,
      medal: won ? MEDAL_RANK[medal] : 0,
    });
    if (!r || r.error) return { error: (r && r.error) || true };
    const b = r.best;
    this.records = this.records || {};
    this.records[g.level] = { level: g.level, ...b };
    this.overallMe = null;
    return { won, best: b, place: r.place, total: r.total, newRecord: !!(r.newTime && b.wins > 1) };
  }

  // Рейтинг: level = -1 — общий, 0..15 — лучшее время уровня
  top(level = -1, limit = 30) {
    return this.req('top', { level, limit });
  }
}

const BOARD_MATRIX = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0.44, 1]);

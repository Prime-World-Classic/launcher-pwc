// «Мастерская свитков» (Easel) — мини-игра из Prime World, порт в лаунчер.
// easelLogic.js — логика (порт PF_Minigames/Lux*), easelScene.js — 3D-сцена, здесь — окно, HUD, меню, прогресс.
import { EaselRenderer, EASEL_BASE, CONTENT_BASE, fetchOk } from './easelRenderer.js';
import { EaselGame, Rng, BOARD, BOOST, BALL_TYPE, STEP_MS, M, FIELD_L, selectTrajectory } from './easelLogic.js';
import { EaselSound } from './easelSound.js';
import { EaselFx } from './easelFx.js';
import { EaselScene, toLogic, FIELD } from './easelScene.js';
import { uiIconHtml } from '../uiIcon.js';

export { FIELD, toClient, toLogic, COLOR_TEX } from './easelScene.js';

const LUX_Z = 0.56;
const STORE_KEY = 'easel.progress.v1';
const START_GOLD = 300;
const LEVELS = 16;
// Панель бустов: тип логики, иконка (Data/UI/Styles/Minigame02/Boosts), клавиша
const BOOST_UI = [
  { type: BOOST.PAINTBLAST, icon: 'boost_colorbomb', key: '1' },
  { type: BOOST.FREEZE, icon: 'boost_freeze', key: '2' },
  { type: BOOST.JOKER, icon: 'boost_jocker', key: '3' },
  { type: BOOST.SORTER, icon: 'boost_sort', key: '4' },
  { type: BOOST.MAGNET, icon: 'boost_magnet', key: '5' },
  { type: BOOST.ALCHEMIST, icon: 'boost_alchemist', key: '6' },
];
// Тексты — из Lang лаунчера (подгружается в open)
let Lang = null;
const T = (key, vars = {}) => {
  let s = Lang ? Lang.text(key) : key;
  for (const v in vars) s = s.split(`{${v}}`).join(vars[v]);
  return s;
};
const DIFFICULTY_KEY = { Easy: 'easelDiffEasy', Medium: 'easelDiffMedium', Hard: 'easelDiffHard', Impossible: 'easelDiffImpossible' };
const difficulty = (d) => (DIFFICULTY_KEY[d] ? T(DIFFICULTY_KEY[d]) : '');
const MEDAL_KEY = { gold: 'easelMedalGold', silver: 'easelMedalSilver', bronze: 'easelMedalBronze' };
const MEDAL_ICON = { gold: uiIconHtml('medal-gold'), silver: uiIconHtml('medal-silver'), bronze: uiIconHtml('check') };
const COIN = uiIconHtml('coin');
const MEDAL_RANK = { bronze: 1, silver: 2, gold: 3 };
const MEDAL_BY_RANK = [null, 'bronze', 'silver', 'gold'];
const svg = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  settings: svg('<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>'),
  pause: svg('<path d="M9 5v14"/><path d="M15 5v14"/>'),
};
const KBD = { esc: '<kbd>Esc</kbd>', enter: '<kbd>Enter</kbd>' };

const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
// Время рекорда с десятыми: 1:23.4
const fmtRec = (ms) => {
  const d = Math.max(0, Math.floor(ms / 100));
  return `${fmtTime(d / 10)}.${d % 10}`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Подсказка буста из Minigame02 (теги PW: <style:TT_Title>, <br>, <value:price>)
function parseTooltip(src, price) {
  if (!src) return { title: '', body: '' };
  const t = src.replace(/<value:price>/g, String(price));
  const m = t.match(/<style:TT_Title>(.*?)(?:<br>|<style:)/);
  const title = m ? m[1].replace(/<[^>]*>/g, '').trim() : '';
  const i = t.lastIndexOf('<br><br>');
  const body = (i >= 0 ? t.slice(i + 8) : t).replace(/<[^>]*>/g, '').trim();
  return { title, body };
}

function loadProgress() {
  const def = { gold: START_GOLD, maxLevel: 0, medals: {}, trackUse: {}, lastTrack: -1, first: true };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
  } catch (e) {
    return def;
  }
}

export class Easel {
  static root = null;
  static renderer = null;
  static fx = null;
  static data = null;
  static running = false;
  static faction = 'doct';
  static game = null;
  static scene = null;
  static paused = false;
  static mouse = null;

  // opts: {level, track} — сразу начать уровень (иначе — меню уровней)
  static async open(faction = 'doct', opts = {}) {
    if (!Lang) {
      try {
        Lang = (await import('../lang.js')).Lang;
      } catch (e) {
        Lang = null;
      }
    }
    if (Easel.root) return;
    // одна мини-игра за раз: «Фарм талантов» и др. закрываются (Window слушает pw:minigame-open)
    window.dispatchEvent(new CustomEvent('pw:minigame-open', { detail: 'easel' }));
    Easel.faction = faction === 'ad' ? 'ad' : 'doct';
    Easel.progress = loadProgress();
    Easel._injectStyle();
    const root = document.createElement('div');
    root.className = 'easel-overlay';
    root.innerHTML = `
      <canvas class="easel-canvas"></canvas>
      <div class="easel-hud" hidden>
        <div class="easel-top">
          <div class="easel-cell easel-level"></div>
          <div class="easel-cell easel-time"></div>
          <div class="easel-cell easel-fill"></div>
          <div class="easel-cell easel-gold"></div>
        </div>
        <div class="easel-banner"></div>
        <div class="easel-boosts"></div>
      </div>
      <div class="easel-buttons">
        <button class="easel-ibtn easel-settings" title="${T('easelVolumeHint')}" hidden>${ICON.settings}</button>
        <button class="easel-ibtn easel-menu-btn" title="${T('easelPauseEsc')}" hidden>${ICON.pause}</button>
        <button class="easel-x easel-close" title="${T('easelCloseGame')}"></button>
      </div>
      <div class="easel-panel" hidden></div>
      <div class="easel-loading">${T('easelLoading')}</div>`;
    document.body.appendChild(root);
    Easel.root = root;
    Easel.$ = (s) => root.querySelector(s);
    Easel.$('.easel-close').onclick = () => Easel.close();
    Easel.$('.easel-settings').onclick = () => Easel.openSettings();
    // окно боя (готовность, тамбур) — мини-игра сворачивается на паузе и возвращается, когда оно закроется
    Easel._onMmShow = () => Easel.suspend(true, 'mm');
    Easel._onMmClose = () => Easel.suspended === 'mm' && Easel.suspend(false);
    window.addEventListener('pw:mm-show', Easel._onMmShow);
    window.addEventListener('pw:mm-close', Easel._onMmClose);
    Easel._onMinigameOpen = (e) => e.detail !== 'easel' && Easel.close();
    window.addEventListener('pw:minigame-open', Easel._onMinigameOpen);
    Easel.$('.easel-menu-btn').onclick = () => Easel.game && Easel.pause(!Easel.paused);
    // звуки кнопок — как у лаунчера (domAudioPresets: Click / ClickClose)
    root.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || b.classList.contains('easel-boost')) return;
      Easel._uiSound(b.classList.contains('easel-x') || b.dataset.act === 'exit' ? 'close' : 'click');
    });
    Easel._bindInput(root.querySelector('.easel-canvas'));
    Easel._pauseCastle(true);
    try {
      Easel.renderer = new EaselRenderer(root.querySelector('.easel-canvas'));
      if (!Easel.data) Easel.data = await fetchOk(EASEL_BASE + 'data.json');
      Easel.sound = new EaselSound();
      Easel._applyVolume();
      Easel.fx = new EaselFx(Easel.renderer);
      // эффекты необязательны: без них сцена рисует простые спрайты
      const fxLoad = Easel.fx.load().catch((e) => console.warn('easel: effects', e));
      await Promise.all([Easel.renderer.load(), Easel.sound.load(), fxLoad]);
      await Easel._loadBoard();
      if (!Easel.root) return; // закрыли во время загрузки
      Easel.$('.easel-loading').remove();
      Easel.running = true;
      Easel._last = performance.now();
      requestAnimationFrame(Easel._frame);
      if (opts.level !== undefined) await Easel.startLevel(opts.level, opts.track);
      else Easel.showLevels();
    } catch (e) {
      console.error('easel', e);
      const l = Easel.root && Easel.$('.easel-loading');
      if (l) l.textContent = String(e.message || e);
    }
  }

  static close() {
    if (!Easel.root) return;
    Easel._saveGold();
    Easel.running = false;
    Easel.game = Easel.scene = null;
    window.removeEventListener('keydown', Easel._onKey, true);
    window.removeEventListener('pw:mm-show', Easel._onMmShow);
    window.removeEventListener('pw:mm-close', Easel._onMmClose);
    window.removeEventListener('pw:minigame-open', Easel._onMinigameOpen);
    clearInterval(Easel._suspendPoll);
    Easel.suspended = false;
    Easel.records = Easel._recordsReq = null;
    document.removeEventListener('visibilitychange', Easel._onVis);
    if (Easel.renderer) Easel.renderer.destroy();
    Easel.renderer = null;
    Easel.fx = null;
    if (Easel.sound) Easel.sound.destroy();
    Easel.sound = null;
    Easel.root.remove();
    Easel.root = null;
    Easel._pauseCastle(false);
  }

  static async _pauseCastle(pause) {
    try {
      Easel._app = (await import('../app.js')).App;
    } catch (e) {
      Easel._app = null;
    }
    try {
      const { Castle } = await import('../castle.js');
      Easel._castle = Castle;
      try {
        Easel._uiSnd = { Sound: (await import('../sound.js')).Sound, LIB: (await import('../soundsLibrary.js')).SOUNDS_LIBRARY };
      } catch (e) {
        Easel._uiSnd = null;
      }
      try {
        Easel._win = (await import('../window.js')).Window;
      } catch (e) {
        Easel._win = null;
      }
      const sb = Easel.root && Easel.$('.easel-settings');
      if (sb) sb.hidden = !Easel._win;
      Easel._applyVolume();
      // через toggleRender: он будит уснувший цикл отрисовки замка
      if (Castle.render && Castle.RENDER_LAYER_EASEL !== undefined) Castle.toggleRender(Castle.RENDER_LAYER_EASEL, !pause);
    } catch (e) {
      // вне лаунчера (тестовая страница) замка нет
    }
  }

  // Громкость — из настроек лаунчера (общая × звуки), применяется на лету (проверка в каждом кадре).
  // ×2 — события Minigame02 в PW на −5 дБ тише звуков интерфейса
  static _applyVolume() {
    const C = Easel._castle;
    let v = 0.5;
    try {
      if (C && C.GetVolume) v = C.GetVolume(C.AUDIO_SOUNDS);
    } catch (e) {
      // настройки недоступны
    }
    const g = Math.min(1.5, v * 2);
    if (Easel.sound && Easel.sound.volume !== g) Easel.sound.setVolume(g, false);
  }

  // Настройки лаунчера (громкость) поверх мини-игры: игра на паузе и свёрнута, пока окно открыто
  static async openSettings() {
    const W = Easel._win;
    if (!W) return;
    Easel.suspend(true, 'settings');
    await W.show('main', 'settings');
    clearInterval(Easel._suspendPoll);
    Easel._suspendPoll = setInterval(() => {
      if (Easel.suspended !== 'settings') return clearInterval(Easel._suspendPoll);
      if (!W.anyOpen()) {
        clearInterval(Easel._suspendPoll);
        Easel.suspend(false);
      }
    }, 250);
  }

  // Свернуть мини-игру (окно боя, настройки): партия на паузе, окно скрыто, замок снова рисуется
  static suspend(on, why = 'mm') {
    if (!Easel.root) return;
    if (on) {
      if (Easel.game && !Easel.paused) Easel.pause(true);
      if (Easel.sound) Easel.sound.pause(true);
      Easel.suspended = why;
      Easel.root.style.display = 'none';
      Easel._pauseCastle(false);
      return;
    }
    if (!Easel.suspended) return;
    Easel.suspended = false;
    Easel.root.style.display = '';
    Easel._pauseCastle(true);
    Easel._applyVolume();
    Easel._last = performance.now();
  }

  // Поверх мини-игры открыто окно лаунчера (настройки, сплэш «бой найден…») — клавиши отдаём ему
  static _launcherOnTop() {
    try {
      if (Easel._win && Easel._win.anyOpen()) return true;
    } catch (e) {
      // нет менеджера окон
    }
    return [...document.querySelectorAll('.splash')].some((el) => el.style.display === 'flex');
  }

  static _uiSound(kind) {
    const U = Easel._uiSnd;
    const C = Easel._castle;
    if (!U || !C) return;
    try {
      const src = kind === 'close' ? U.LIB.CLICK_CLOSE : U.LIB.CLICK;
      U.Sound.play(src, { id: kind === 'close' ? 'ui-close' : 'ui-click', volume: C.GetVolume(C.AUDIO_SOUNDS) });
    } catch (e) {
      // звук интерфейса необязателен
    }
  }

  // Модель здания (та же, что в замке): content/meshes/easel/*.bin
  // (Докты — Buildings/A/MiniGame, Адорнийцы — Buildings/B/MiniGame)
  static async _loadBoard() {
    const r = Easel.renderer;
    const parts =
      Easel.faction === 'ad'
        ? [
            ['ad_0', 'easel/ad_board'],
            ['ad_1', 'easel/ad_gem'],
          ]
        : [['doct_0', 'easel/doct_board']];
    Easel.board = [];
    for (const [mesh, tex] of parts) {
      const buf = await fetchOk(`${CONTENT_BASE}meshes/easel/${mesh}.bin`, 'buf');
      const texId = 'board_' + mesh;
      await r.loadTexture(texId, `${CONTENT_BASE}textures/${tex}.webp`);
      const m = r.dynamicModel('board_' + mesh, new Float32Array(buf));
      m.subs[0].tex = texId;
      m.subs[0].kind = mesh === 'ad_1' ? 'drop' : undefined;
      Easel.board.push(m);
    }
  }

  static _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(Easel.progress));
    } catch (e) {
      // localStorage недоступен — прогресс только на сессию
    }
  }

  static _saveGold() {
    if (Easel.game && !Easel.game._saved) Easel.progress.gold = Math.max(0, Easel.game.gold);
    Easel._save();
  }

  // ---------- партия ----------
  static async startLevel(level, track) {
    const data = Easel.data;
    level = Math.max(0, Math.min(LEVELS - 1, level | 0));
    Easel._saveGold();
    Easel._hidePanel();
    const P = Easel.progress;
    const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    if (track === undefined || track === null || !data.tracks[track]) {
      track = selectTrajectory(data, level, P.trackUse, P.lastTrack, new Rng(seed), P.first);
    }
    P.lastTrack = track;
    if (level === 0) P.first = false;
    Easel._save();
    const picture = level % data.pictures.length;
    const boosts = level >= 1 ? BOOST_UI.map((b) => b.type) : [];
    const game = new EaselGame({ data, track, level, picture, seed, triple: false, boosts, gold: P.gold });
    const tex = await Easel.renderer.loadPicture(picture);
    if (!Easel.root) return;
    game.trackIndex = track;
    Easel.game = game;
    Easel.scene = new EaselScene(Easel.renderer, data, game, Easel.board, tex, Easel.fx);
    Easel.level = level;
    Easel.acc = 0;
    Easel.clicks = { left: false, right: false };
    Easel.paused = false;
    Easel._near = false;
    if (Easel.sound) {
      Easel.sound.stopAll();
      Easel.sound.pause(false);
    }
    game.start();
    Easel._buildHud();
    Easel._startReq = Easel._req('start', { level });
  }

  // ---------- рекорды и рейтинг (backend: объект easel) ----------
  // Лаунчер с входом в аккаунт; в тестовой странице и без входа — null
  static _online() {
    const A = Easel._app;
    const d = A && A.storage && A.storage.data;
    return A && A.api && d && d.token && Number(d.id) > 0 ? A : null;
  }

  static _myId() {
    const A = Easel._online();
    return A ? Number(A.storage.data.id) : 0;
  }

  // Запрос к API; ошибка → { error: текст } (сервер без объекта easel, нет связи)
  static async _req(method, data = {}) {
    const A = Easel._online();
    if (!A) return null;
    try {
      return await A.api.request('easel', method, data);
    } catch (e) {
      console.warn('easel api', method, e);
      const text = String((e && e.message) || e || '');
      // старый сервер без объекта easel / сбой — без технического текста
      return { error: !text || /^Not (object|method)|Внутренняя/.test(text) ? T('easelRatingUnavailableTemp') : text };
    }
  }

  // Свои рекорды с сервера: время на плитках уровней и перенос прогресса (уровни, медали) между устройствами
  static async _loadRecords() {
    if (Easel._recordsReq) return Easel._recordsReq;
    Easel._recordsReq = (async () => {
      const r = await Easel._req('me');
      if (!r || r.error || !Array.isArray(r.levels)) {
        Easel._recordsReq = null;
        return false;
      }
      const P = Easel.progress;
      Easel.records = {};
      for (const l of r.levels) {
        Easel.records[l.level] = l;
        if (!l.wins || l.level < 0 || l.level >= LEVELS) continue;
        P.maxLevel = Math.max(P.maxLevel, Math.min(LEVELS - 1, l.level + 1));
        const m = MEDAL_BY_RANK[l.medal];
        if (m && (!P.medals[l.level] || MEDAL_RANK[m] > MEDAL_RANK[P.medals[l.level]])) P.medals[l.level] = m;
      }
      Easel.overallMe = r.overall || null;
      Easel._save();
      return true;
    })();
    return Easel._recordsReq;
  }

  // Отправить итог партии и показать рекорд/место в окне итогов
  static async _sendResult(g, won, medal) {
    const box = Easel.$('.easel-record');
    if (!box) return;
    if (!Easel._online()) {
      box.innerHTML = Easel._app ? `<small>${T('easelLoginForRating')}</small>` : '';
      return;
    }
    box.innerHTML = `<small>${T('easelSaving')}</small>`;
    await Easel._startReq;
    const r = await Easel._req('finish', {
      level: g.level,
      track: g.trackIndex,
      won,
      timeMs: Math.round(g.elapsed),
      score: g.goldEarned,
      medal: won ? MEDAL_RANK[medal] : 0,
    });
    if (!box.isConnected) return;
    if (!r || r.error) {
      box.innerHTML = `<small>${esc((r && r.error) || T('easelRatingUnavailable'))}</small>`;
      return;
    }
    const b = r.best;
    Easel.records = Easel.records || {};
    Easel.records[g.level] = { level: g.level, ...b };
    Easel.overallMe = null;
    if (!won) {
      box.innerHTML = b.timeMs !== null ? `<small>${T('easelLevelRecord', { time: fmtRec(b.timeMs), place: r.place, total: r.total })}</small>` : '';
      return;
    }
    const rec = r.newTime && b.wins > 1 ? `<div class="easel-newrec">${uiIconHtml('trophy')} ${T('easelNewRecord')}</div>` : '';
    box.innerHTML = `${rec}<p>${T('easelYourRecord', { time: fmtRec(b.timeMs), place: r.place, total: r.total })}</p>`;
  }

  // Окно рейтинга: level = -1 — общий, 0..15 — лучшее время уровня
  static async showRating(level = -1) {
    Easel._ratingLevel = level;
    const tabs = `<div class="easel-rtabs">
        <button class="easel-rtab${level < 0 ? ' on' : ''}" data-rlevel="-1">${T('easelOverall')}</button>
        ${Easel.data.levels.map((l, i) => `<button class="easel-rtab d-${esc(l.difficulty)}${i === level ? ' on' : ''}" data-rlevel="${i}">${i + 1}</button>`).join('')}
      </div>`;
    const panel = (body) =>
      Easel._showPanel(
        `${tabs}<div class="easel-rbody">${body}</div>
        <div class="easel-actions easel-row"><button class="easel-btn" data-act="levels">${T('easelToLevels')}${KBD.esc}</button></div>`,
        { title: T('easelRatingTitle'), back: () => Easel.showLevels(), wide: true },
      );
    if (!Easel._online()) {
      return panel(`<p>${Easel._app ? T('easelLoginToView') : T('easelRatingInLauncher')}</p>`);
    }
    panel(`<p class="easel-rmsg">${T('easelLoading')}</p>`);
    const r = await Easel._req('top', { level, limit: 30 });
    if (Easel._ratingLevel !== level || !Easel.root || !Easel.$('.easel-rbody')) return;
    const body = Easel.$('.easel-rbody');
    if (!r || r.error) {
      body.innerHTML = `<p class="easel-rmsg">${esc((r && r.error) || T('easelRatingUnavailable'))}</p>`;
      return;
    }
    body.innerHTML = Easel._ratingTable(r, level);
  }

  static _ratingTable(r, level) {
    const my = Easel._myId();
    const overall = level < 0;
    const head = overall
      ? `<th>#</th><th class="l">${T('easelColPlayer')}</th><th title="${T('easelColLevelsHint')}">${T('easelColLevels')}</th><th title="${T('easelColGoldHint')}">${MEDAL_ICON.gold}</th><th title="${T('easelColSilverHint')}">${MEDAL_ICON.silver}</th><th title="${T('easelColScoreSumHint')}">${T('easelColScore')}</th><th title="${T('easelColTimeSumHint')}">${T('easelColTime')}</th>`
      : `<th>#</th><th class="l">${T('easelColPlayer')}</th><th>${T('easelColTime')}</th><th title="${T('easelColBestScoreHint')}">${T('easelColScore')}</th><th>${T('easelColMedal')}</th>`;
    const place = (n) => (n === 1 ? MEDAL_ICON.gold : n === 2 ? MEDAL_ICON.silver : n === 3 ? uiIconHtml('medal-bronze') : n);
    const row = (x) => {
      const cls = x.userId === my ? ' class="me"' : '';
      const name = `<td class="l">${esc(x.login || '—')}</td>`;
      return overall
        ? `<tr${cls}><td>${place(x.place)}</td>${name}<td><b>${x.levels}</b>/${LEVELS}</td><td>${x.gold}</td><td>${x.silver}</td><td>${x.score}</td><td>${fmtTime(x.timeMs / 1000)}</td></tr>`
        : `<tr${cls}><td>${place(x.place)}</td>${name}<td><b>${fmtRec(x.timeMs)}</b></td><td>${x.score}</td><td>${MEDAL_ICON[MEDAL_BY_RANK[x.medal]] || ''}</td></tr>`;
    };
    if (!r.rows.length) {
      return `<p class="easel-rmsg">${overall ? T('easelNoOneOverall') : T('easelNoOneLevel', { level: level + 1 })}</p>`;
    }
    let rows = r.rows.map(row).join('');
    if (r.me && !r.rows.some((x) => x.userId === r.me.userId)) rows += `<tr class="gap"><td colspan="7">…</td></tr>${row(r.me)}`;
    const mine =
      r.me || r.rows.some((x) => x.userId === my)
        ? ''
        : `<p class="easel-rmsg"><small>${overall ? T('easelPassToRate') : T('easelNotPassed')}</small></p>`;
    const sub = overall
      ? T('easelOrderOverall')
      : T('easelBestTimeLevel', { level: level + 1, difficulty: esc(difficulty(Easel.data.levels[level].difficulty)) });
    return `<p class="easel-rsub"><small>${sub} · ${T('easelPlayersCount', { count: r.total })}</small></p>
      <div class="easel-rscroll"><table class="easel-rtable"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${mine}`;
  }

  static _frame(now) {
    if (!Easel.running || !Easel.renderer) return;
    if (Easel.suspended) {
      Easel._last = now;
      return requestAnimationFrame(Easel._frame);
    }
    Easel._applyVolume();
    const dt = Math.min(0.25, Math.max(0, (now - Easel._last) / 1000));
    Easel._last = now;
    const g = Easel.game;
    const s = Easel.scene;
    if (g && s) {
      if (!Easel.paused) {
        Easel._liveAim();
        Easel.acc += dt * 1000;
        while (Easel.acc >= STEP_MS) {
          Easel.acc -= STEP_MS;
          const [x, y] = Easel._fieldMouse() || [g.platform.pos.x / M, FIELD / 2];
          g.input(x, y, Easel.clicks.left, Easel.clicks.right);
          Easel.clicks.left = Easel.clicks.right = false;
          g.step(STEP_MS);
          const ev = g.events.splice(0);
          s.afterStep(ev);
          for (const e of ev) Easel._onEvent(e);
          if (!Easel.game) break;
          Easel._checkNearExit();
        }
      }
      if (Easel.scene) Easel.scene.render(Easel.paused ? 0 : dt);
      if (Easel.game) Easel._updateHud();
    } else {
      // меню без партии: пустая доска
      const r = Easel.renderer;
      const cam = Easel.data.common.camera;
      r.setCamera({ target: [cam.anchor.x, cam.anchor.y, cam.anchor.z], yaw: cam.yaw, pitch: cam.pitch, rod: cam.rod, fov: cam.fov });
      r.begin();
      const m = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0.44, 1]);
      for (const b of Easel.board) r.draw({ model: b, matrix: m });
      r.end();
    }
    requestAnimationFrame(Easel._frame);
  }

  // Мышь → координаты поля (0..FIELD)
  static _fieldMouse() {
    if (!Easel.mouse || !Easel.renderer) return null;
    const p = Easel.renderer.screenToPlane(Easel.mouse[0], Easel.mouse[1], LUX_Z);
    return toLogic(p[0], p[1]);
  }

  // Тележка следует за мышью каждый кадр (логика всё равно берёт позицию на шаге)
  static _liveAim() {
    const g = Easel.game;
    const f = Easel._fieldMouse();
    const mg = g.boosts.get(BOOST.MAGNET);
    if (!f || (mg && mg.state === 'waiting')) return;
    const x = Math.max(20, Math.min(FIELD_L - 20, Math.trunc(f[0] * M)));
    g.platform.setPos({ x, y: g.platform.pos.y });
    if (g.state === BOARD.LEVEL_RUN) g._updatePointer();
  }

  static _onEvent(e) {
    Easel._soundFor(e);
    if (e.type !== 'state') return;
    if (e.state === BOARD.WON_FINAL || e.state === BOARD.FAIL_FINAL) Easel._finish(e.state === BOARD.WON_FINAL);
  }

  // Звуки по событиям логики (PF_Minigames/SoundObserver.cpp, EaselMinigameData.xdb: soundData)
  static _soundFor(e) {
    const S = Easel.sound;
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
        return S.play('easel_paint_flow', { gap: 0.3, volume: 0.7 });
      case 'paintBlast':
        return S.play('easel_boost_paintblas_explosion');
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
        return S.play('easel_boost_inspiration_cli');
      case 'specialBall':
        return S.play(e.ball.type === BALL_TYPE.JOKER ? 'easel_boost_joker_click' : 'easel_boost_paintblast_clic');
      case 'magnetInstalled':
        return S.play('Magnet', { id: 'magnet' });
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
  static _checkNearExit() {
    const g = Easel.game;
    let k = 0;
    if (g.state === BOARD.LEVEL_RUN) {
      for (const bc of g.boardChains) if (bc.chains.length) k = Math.max(k, bc.chains[0].position() / bc.path.traj.length);
    }
    if (!Easel._near && k > 0.82) {
      Easel._near = true;
      if (Easel.sound) Easel.sound.play('easel_chain_near_exit', { id: 'near' });
    } else if (Easel._near && k < 0.75) {
      Easel._near = false;
      if (Easel.sound) Easel.sound.stop('near');
    }
  }

  static _finish(won) {
    const g = Easel.game;
    const P = Easel.progress;
    P.gold = Math.max(0, g.gold);
    g._saved = true;
    let medal = null;
    if (won) {
      medal = g.medal || 'bronze';
      const prev = P.medals[g.level];
      if (!prev || MEDAL_RANK[medal] > MEDAL_RANK[prev]) P.medals[g.level] = medal;
      P.maxLevel = Math.max(P.maxLevel, Math.min(LEVELS - 1, g.level + 1));
    }
    Easel._save();
    if (Easel.sound && (medal === 'gold' || medal === 'silver')) Easel.sound.play('easel_result_' + medal, { id: 'medal' });
    const st = g.levelStats;
    const html = won
      ? `<div class="easel-medal">${MEDAL_ICON[medal]} ${T(MEDAL_KEY[medal])}</div>
         <p>${T('easelTimeLine', { time: fmtTime(g.elapsed / 1000), gold: fmtTime(st.goldMedalTime), silver: fmtTime(st.silverMedalTime) })}</p>
         <p>${T('easelEarned', { earned: g.goldEarned, total: P.gold, coin: COIN })}</p>
         <div class="easel-record"></div>`
      : `<p>${T('easelFailText')}</p>
         <p>${T('easelEarned', { earned: g.goldEarned, total: P.gold, coin: COIN })}</p>
         <div class="easel-record"></div>`;
    const next = won && g.level + 1 < LEVELS;
    Easel._showPanel(
      html +
        `<div class="easel-actions">
          ${next ? `<button class="easel-btn easel-primary" data-act="next">${T('easelNextLevel')}${KBD.enter}</button>` : ''}
          <button class="easel-btn${next ? '' : ' easel-primary'}" data-act="retry">${T('easelRetry')}${next ? '' : KBD.enter}</button>
          <button class="easel-btn" data-act="levels">${T('easelLevels')}${KBD.esc}</button>
          <button class="easel-btn easel-red" data-act="exit">${T('easelExit')}</button>
        </div>`,
      { title: won ? T('easelWonTitle') : T('easelFailTitle'), back: () => Easel.showLevels() },
    );
    Easel._sendResult(g, won, medal);
  }

  static pause(on) {
    if (!Easel.game) return;
    const g = Easel.game;
    if (g.state === BOARD.WON_FINAL || g.state === BOARD.FAIL_FINAL) return;
    Easel.paused = on;
    if (Easel.sound) Easel.sound.pause(on);
    if (!on) {
      Easel._hidePanel();
      Easel._last = performance.now();
      return;
    }
    Easel._showPanel(
      `<p>${T('easelLevelLine', { level: g.level + 1, difficulty: esc(difficulty(Easel.data.levels[g.level].difficulty)) })}</p>
      <div class="easel-actions">
        <button class="easel-btn easel-primary" data-act="resume">${T('easelResume')}${KBD.esc}</button>
        <button class="easel-btn" data-act="retry">${T('easelRestart')}</button>
        <button class="easel-btn" data-act="levels">${T('easelToLevelSelect')}</button>
        ${Easel._win ? `<button class="easel-btn" data-act="settings">${T('easelVolumeSettings')}</button>` : ''}
        <button class="easel-btn easel-red" data-act="exit">${T('easelExitGame')}</button>
      </div>
      <div class="easel-help">${T('easelControls')}</div>`,
      { title: T('easelPause'), back: () => Easel.pause(false) },
    );
  }

  static showLevels() {
    Easel._saveGold();
    Easel.game = Easel.scene = null;
    Easel.paused = false;
    if (Easel.sound) {
      Easel.sound.stopAll();
      Easel.sound.pause(false);
    }
    Easel.$('.easel-hud').hidden = true;
    const P = Easel.progress;
    const cells = Easel.data.levels
      .map((l, i) => {
        const locked = i > P.maxLevel;
        const medal = P.medals[i];
        const rec = Easel.records && Easel.records[i];
        const best = rec && rec.timeMs !== null && rec.wins ? `<em>${fmtRec(rec.timeMs)}</em>` : '';
        const cls = (locked ? ' locked' : '') + (i === P.maxLevel ? ' easel-primary' : '');
        return `<button class="easel-lvl${cls} d-${esc(l.difficulty)}" data-level="${i}" ${locked ? 'disabled' : ''}>
          <b>${i + 1}</b><small>${esc(difficulty(l.difficulty) || l.difficulty)}</small>
          <span>${locked ? uiIconHtml('lock') : medal ? MEDAL_ICON[medal] : ''}</span>${best}</button>`;
      })
      .join('');
    Easel._showPanel(
      `<p>${T('easelIntro')}</p>
      <div class="easel-gold-big">${P.gold} ${COIN}</div>
      <div class="easel-levels">${cells}</div>
      <div class="easel-actions easel-row">
        ${Easel._online() ? `<button class="easel-btn" data-act="rating">${uiIconHtml('trophy')} ${T('easelRating')}</button>` : ''}
        <button class="easel-btn easel-red" data-act="exit">${T('easelExit')}${KBD.esc}</button></div>`,
      { title: T('easel_doct'), back: Easel._levelsBack, wide: true },
    );
    // рекорды с сервера — один раз за открытие; после загрузки перерисовать плитки, если окно ещё открыто
    if (!Easel.records && Easel._online()) {
      Easel._loadRecords().then((ok) => ok && Easel._panelBack === Easel._levelsBack && !Easel.game && Easel.showLevels());
    }
  }

  static _levelsBack() {
    Easel.close();
  }

  // Окно в стиле лаунчера (splash-content--titled): полоса заголовка, крестик, кнопки.
  // back — действие крестика и Esc
  static _showPanel(html, { title = '', back = null, wide = false } = {}) {
    const p = Easel.$('.easel-panel');
    p.innerHTML = `<div class="easel-box${wide ? ' easel-wide' : ''}">
      <div class="easel-title">${esc(title)}</div>
      <button class="easel-x easel-box-x" data-act="back" title="${T('easelCloseEsc')}"></button>
      ${html}</div>`;
    p.hidden = false;
    Easel._panelBack = back;
    Easel._updateMenuBtn();
    p.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'back') return Easel._back();
      if (b.dataset.level !== undefined) return Easel.startLevel(+b.dataset.level);
      if (b.dataset.rlevel !== undefined) return Easel.showRating(+b.dataset.rlevel);
      const g = Easel.game;
      switch (b.dataset.act) {
        case 'resume':
          return Easel.pause(false);
        case 'retry':
          return Easel.startLevel(g ? g.level : Easel.level);
        case 'next':
          return Easel.startLevel((g ? g.level : Easel.level) + 1);
        case 'levels':
          return Easel.showLevels();
        case 'settings':
          return Easel.openSettings();
        case 'rating':
          return Easel.showRating(Easel._ratingLevel ?? -1);
        case 'exit':
          return Easel.close();
      }
    };
  }

  static _hidePanel() {
    const p = Easel.root && Easel.$('.easel-panel');
    if (p) p.hidden = true;
    Easel._panelBack = null;
    Easel._updateMenuBtn();
  }

  static _panelOpen() {
    const p = Easel.root && Easel.$('.easel-panel');
    return !!p && !p.hidden;
  }

  // кнопка паузы — только во время партии
  static _updateMenuBtn() {
    const b = Easel.root && Easel.$('.easel-menu-btn');
    if (b) b.hidden = !Easel.game || Easel._panelOpen();
  }

  // Esc / крестик окна: пауза → продолжить, итоги → выбор уровня, выбор уровня → закрыть мини-игру;
  // во время партии — пауза
  static _back() {
    if (Easel._panelOpen() && Easel._panelBack) return Easel._panelBack();
    if (Easel.game) {
      const s = Easel.game.state;
      if (s === BOARD.WON_FINAL || s === BOARD.FAIL_FINAL) return Easel.showLevels();
      return Easel.pause(true);
    }
    Easel.close();
  }

  // ---------- HUD ----------
  static _buildHud() {
    const g = Easel.game;
    const data = Easel.data;
    Easel.$('.easel-hud').hidden = false;
    Easel._updateMenuBtn();
    Easel.$('.easel-level').textContent = T('easelLevelLine', { level: g.level + 1, difficulty: difficulty(data.levels[g.level].difficulty) });
    const bar = Easel.$('.easel-boosts');
    bar.innerHTML = '';
    Easel.boostEls = [];
    for (const ui of BOOST_UI) {
      const b = g.boosts.get(ui.type);
      if (!b) continue;
      const tipSrc = (Lang && Lang.list[Lang.target]?.word?.['easelBoostTip' + ui.type]) || data.boostTooltips[ui.type];
      const tip = parseTooltip(tipSrc, b.price);
      const el = document.createElement('button');
      el.className = 'easel-boost';
      el.innerHTML = `<img src="${EASEL_BASE}ui/${ui.icon}.webp" alt=""><i class="easel-cd"></i>
        <span class="easel-price">${b.price}</span><kbd>${ui.key}</kbd>
        <div class="easel-tip"><b>${esc(tip.title)}</b> <em>${b.price} ${COIN} · ${T('easelSeconds', { n: Math.round(b.cooldown / 1000) })}</em><br>${esc(tip.body)}</div>`;
      el.onclick = (e) => {
        e.stopPropagation();
        Easel._fireBoost(ui.type);
      };
      bar.appendChild(el);
      Easel.boostEls.push({ el, boost: b, cd: el.querySelector('.easel-cd') });
    }
    Easel._hud = {};
  }

  static _fireBoost(type) {
    const g = Easel.game;
    if (!g || Easel.paused) return;
    const b = g.boosts.get(type);
    const can = g.boosts.canFire(b);
    g.fireBoost(type);
    if (can && type === BOOST.ALCHEMIST && Easel.sound) Easel.sound.play('Alchemist', { id: 'alchemist' });
  }

  static _setText(sel, text) {
    if (Easel._hud[sel] === text) return;
    Easel._hud[sel] = text;
    Easel.$(sel).innerHTML = text;
  }

  static _updateHud() {
    const g = Easel.game;
    const st = g.levelStats;
    const t = g.elapsed / 1000;
    const medal =
      t <= st.goldMedalTime ? MEDAL_ICON.gold + ' ' + fmtTime(st.goldMedalTime) : t <= st.silverMedalTime ? MEDAL_ICON.silver + ' ' + fmtTime(st.silverMedalTime) : '';
    Easel._setText('.easel-time', `${uiIconHtml('stopwatch')} ${fmtTime(t)} <small>${medal}</small>`);
    Easel._setText('.easel-fill', `${uiIconHtml('palette')} ${Math.round(g.paint.fillRatio() * 100)}%`);
    Easel._setText('.easel-gold', `${g.gold} ${COIN}`);
    let banner = '';
    if (g.state === BOARD.LEVEL_BEGIN) banner = `${T('easelLevelN', { level: g.level + 1 })}<small>${T('easelClickToStart')}</small>`;
    else if (g.state >= BOARD.LEVEL_WON && g.state <= BOARD.WON_MOVIE) banner = T('easelWonTitle');
    else if (g.state === BOARD.LEVEL_FAIL) banner = T('easelFailBanner');
    else if (g.boosts.get(BOOST.MAGNET) && g.boosts.get(BOOST.MAGNET).state === 'waiting')
      banner = `<small>${T('easelMagnetPlace')}</small>`;
    else if (g.frozen) banner = `<small>${T('easelFreeze')}</small>`;
    Easel._setText('.easel-banner', banner);
    for (const x of Easel.boostEls) {
      const b = x.boost;
      const can = g.boosts.canFire(b);
      x.el.classList.toggle('off', !can);
      x.el.classList.toggle('active', b.waiting || (b.type === BOOST.FREEZE && g.frozen) || !!b.active);
      x.el.classList.toggle('poor', g.gold < b.price);
      x.cd.style.height = b.cooling ? `${Math.round((1 - b.progress()) * 100)}%` : '0';
    }
  }

  // ---------- ввод ----------
  static _bindInput(canvas) {
    Easel.clicks = { left: false, right: false };
    canvas.addEventListener('mousemove', (e) => (Easel.mouse = [e.clientX, e.clientY]));
    canvas.addEventListener('mousedown', (e) => {
      Easel.mouse = [e.clientX, e.clientY];
      if (!Easel.game || Easel.paused) return;
      if (e.button === 0) Easel.clicks.left = true;
      else if (e.button === 2) Easel.clicks.right = true;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Перехват на window в фазе захвата: иначе Esc забирает обработчик лаунчера (app.js — открывает меню
    // настроек и останавливает всплытие). Глушим только клавиши мини-игры, остальное (push-to-talk) — дальше.
    const eat = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    Easel._onKey = (e) => {
      if (!Easel.root || Easel.suspended || Easel._launcherOnTop()) return;
      if (e.key === 'Escape') {
        eat(e);
        if (!e.repeat) {
          Easel._uiSound('close');
          Easel._back();
        }
        return;
      }
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (Easel._panelOpen()) {
        const b = e.key === 'Enter' && Easel.$('.easel-panel .easel-primary:not([disabled])');
        if (b) {
          eat(e);
          if (!e.repeat) b.click();
        }
        return;
      }
      if (!Easel.game || Easel.paused) return;
      if (e.key === ' ') {
        eat(e);
        Easel.clicks.right = true;
        return;
      }
      const ui = BOOST_UI.find((b) => b.key === e.key);
      if (ui) {
        eat(e);
        Easel._fireBoost(ui.type);
      }
    };
    window.addEventListener('keydown', Easel._onKey, true);
    Easel._onVis = () => {
      if (document.hidden && Easel.game && !Easel.paused) Easel.pause(true);
    };
    document.addEventListener('visibilitychange', Easel._onVis);
  }

  // Стиль — как у окон лаунчера (main.css: splash-content--titled, #wcastle-menu, castle-menu-item-button)
  static _injectStyle() {
    if (document.getElementById('easel-style')) return;
    const s = document.createElement('style');
    s.id = 'easel-style';
    const img = (f) => `url('${CONTENT_BASE}${f}')`;
    s.textContent = `
      .easel-overlay{--eg:rgb(208,180,96);--egb:rgba(168,151,82,.95);--etx:rgb(252,229,188);--egold:rgb(255,226,140);
        position:fixed;inset:0;z-index:9000;background:radial-gradient(ellipse at center,rgba(4,32,42,.5),rgba(0,0,0,.9));
        color:var(--etx);font:clamp(13px,1.9vh,22px)/1.3 'DejaVuSans',sans-serif;user-select:none;cursor:${img('img/cursor32x32.png')} 0 0,default}
      .easel-overlay button{font-family:inherit;color:inherit;cursor:${img('img/cursor_button32x32.png')} 0 0,pointer}
      .easel-overlay [hidden]{display:none!important}
      .easel-overlay kbd{font:inherit;font-size:.72em;margin-left:.6em;padding:.1em .35em;border-radius:.3em;vertical-align:.1em;
        background:rgba(0,0,0,.35);border:1px solid rgba(168,151,82,.55);opacity:.85}
      .easel-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
      .easel-hud{position:absolute;inset:0;pointer-events:none}
      .easel-btn,.easel-ibtn,.easel-lvl{pointer-events:auto;position:relative;overflow:hidden;box-sizing:border-box;
        border:1px solid var(--egb);border-radius:.55em;background:linear-gradient(180deg,rgba(4,64,63,.98),rgba(0,32,35,.98));
        box-shadow:inset 0 1px 2px rgba(99,222,211,.18),inset 0 -2px 4px rgba(0,0,0,.48),0 0 0 1px rgba(13,61,45,.95),0 2px 6px rgba(0,0,0,.35);
        text-shadow:0 1px 2px rgba(0,0,0,.65);transition:filter .12s,border-color .12s,box-shadow .12s,transform .12s}
      .easel-btn::before,.easel-ibtn::before,.easel-lvl::before{content:'';position:absolute;inset:0;pointer-events:none;
        background:radial-gradient(85% 46% at 50% 0%,rgba(174,255,238,.34) 0%,rgba(174,255,238,.18) 32%,rgba(174,255,238,0) 72%);mix-blend-mode:screen}
      .easel-btn::after,.easel-ibtn::after,.easel-lvl::after{content:'';position:absolute;left:3px;right:3px;top:0;height:54%;pointer-events:none;
        border-radius:50% 50% 55% 55%;transform:translateY(-42%);background:linear-gradient(180deg,rgba(235,255,247,.28),rgba(255,255,255,.04))}
      .easel-btn:hover,.easel-ibtn:hover,.easel-lvl:not(.locked):hover{border-color:rgba(195,181,101,.98);filter:brightness(1.12);
        box-shadow:inset 0 1px 3px rgba(170,255,236,.22),inset 0 -2px 4px rgba(0,0,0,.43),0 0 0 1px rgba(25,78,58,.95),0 0 8px rgba(125,237,211,.2)}
      .easel-btn:active,.easel-ibtn:active,.easel-lvl:not(.locked):active{transform:translateY(1px)}
      .easel-btn{font-size:.95em;line-height:1;padding:.7em 1.3em;min-width:9em}
      .easel-primary{border-color:var(--eg);background:linear-gradient(180deg,rgba(35,116,105,.95) 0%,rgba(4,68,65,.98) 45%,rgba(2,42,40,1) 100%);
        box-shadow:inset 0 2px 3px rgba(255,255,255,.18),inset 0 -2px 4px rgba(0,0,0,.3),0 0 0 1px rgba(13,61,45,.95),0 0 10px rgba(208,180,96,.35)}
      .easel-red{background:linear-gradient(180deg,rgba(83,25,9,.98),rgba(49,8,2,.99));
        box-shadow:inset 0 1px 2px rgba(219,151,92,.18),inset 0 -2px 4px rgba(0,0,0,.52),0 0 0 1px rgba(78,36,14,.95),0 2px 6px rgba(0,0,0,.35)}
      .easel-red::before{background:radial-gradient(85% 46% at 50% 0%,rgba(255,209,164,.32) 0%,rgba(255,209,164,.16) 32%,rgba(255,209,164,0) 72%)}
      .easel-red:hover{box-shadow:inset 0 1px 3px rgba(255,209,164,.2),inset 0 -2px 4px rgba(0,0,0,.45),0 0 0 1px rgba(91,43,17,.95),0 0 8px rgba(255,209,164,.16)}
      .easel-x{pointer-events:auto;width:2.3em;height:2.3em;padding:0;border:none;background:${img('icons/close-cropped.svg')} center/contain no-repeat;
        transition:filter .15s,transform .15s}
      .easel-x:hover{filter:brightness(1.18)}
      .easel-buttons{position:absolute;top:.9em;right:1em;display:flex;gap:.55em;align-items:center;z-index:3}
      .easel-ibtn{width:2.3em;height:2.3em;padding:0;display:flex;align-items:center;justify-content:center;border-radius:.6em}
      .easel-ibtn svg{width:1.25em;height:1.25em;position:relative;z-index:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}
      .easel-top{position:absolute;top:.9em;left:1em;right:9em;display:flex;gap:.6em;justify-content:center;flex-wrap:wrap}
      .easel-cell{border:1px solid var(--egb);border-radius:.55em;padding:.4em .9em;font-size:.95em;white-space:nowrap;text-shadow:0 1px 2px #000;
        background:linear-gradient(180deg,rgba(4,64,63,.88),rgba(0,32,35,.9));
        box-shadow:inset 0 1px 2px rgba(99,222,211,.15),0 0 0 1px rgba(13,61,45,.8),0 2px 6px rgba(0,0,0,.4)}
      .easel-cell small{opacity:.85;font-size:.82em}
      .easel-banner{position:absolute;top:34%;left:50%;transform:translate(-50%,-50%);font-size:2.6em;font-weight:bold;text-align:center;
        color:var(--etx);text-shadow:0 2px 8px #000,0 0 3px #000,0 0 14px rgba(13,90,118,.8)}
      .easel-banner small{display:block;font-size:.42em;font-weight:normal;margin-top:.4em}
      .easel-boosts{position:absolute;bottom:.9em;left:50%;transform:translateX(-50%);display:flex;gap:.65em}
      .easel-boost{pointer-events:auto;position:relative;width:4em;height:4em;padding:0;border-radius:.65em;overflow:visible;
        border:2px solid var(--egb);background:rgba(0,32,35,.9);box-shadow:0 0 0 1px rgba(13,61,45,.95),0 2px 8px rgba(0,0,0,.5);
        transition:border-color .12s,box-shadow .12s,transform .12s}
      .easel-boost:hover{border-color:var(--eg);transform:translateY(-2px)}
      .easel-boost img{width:100%;height:100%;border-radius:.5em;display:block}
      .easel-boost.off img{filter:grayscale(.7) brightness(.6)}
      .easel-boost.active{border-color:#ffe27a;box-shadow:0 0 0 1px rgba(13,61,45,.95),0 0 14px rgba(255,210,74,.85)}
      .easel-boost.poor .easel-price{color:#ff8a76}
      .easel-cd{position:absolute;left:0;right:0;bottom:0;height:0;background:rgba(0,0,0,.6);border-radius:0 0 .5em .5em}
      .easel-price{position:absolute;bottom:-.65em;left:50%;transform:translateX(-50%);font-size:.75em;font-style:normal;padding:0 .5em;
        border:1px solid var(--egb);border-radius:.6em;color:var(--egold);background:linear-gradient(180deg,rgba(4,64,63,1),rgba(0,32,35,1))}
      .easel-boost kbd{position:absolute;top:.15em;left:.2em;margin:0;padding:0 .3em;font-size:.68em;color:#fff;opacity:1;text-shadow:0 0 3px #000}
      .easel-tip{display:none;position:absolute;bottom:4.9em;left:50%;transform:translateX(-50%);width:17em;padding:.6em .8em;
        font-size:.85em;line-height:1.35;text-align:left;color:rgba(255,255,255,.9);border:1px solid var(--eg);border-radius:.55em;
        background:linear-gradient(180deg,rgba(18,76,80,.97),rgba(4,32,42,.97));box-shadow:0 4px 14px rgba(0,0,0,.55)}
      .easel-tip b{color:var(--etx)}
      .easel-tip em{float:right;font-style:normal;color:var(--egold)}
      .easel-boost:hover .easel-tip{display:block}
      .easel-panel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);z-index:2}
      .easel-box{position:relative;box-sizing:border-box;width:min(24em,92vw);padding:2.9em 1.5em 1.4em;text-align:center;
        border:2px solid var(--eg);border-radius:.8em;color:rgba(255,255,255,.9);background-color:rgba(18,76,80,.9);
        background-image:radial-gradient(92% 72% at 50% 16%,rgba(13,90,118,.26) 0%,rgba(13,90,118,.16) 44%,rgba(13,90,118,0) 100%),
          linear-gradient(180deg,rgba(18,76,80,.72) 0%,rgba(18,76,80,.64) 42%,rgba(18,76,80,.74) 100%);
        box-shadow:0 6px 24px rgba(0,0,0,.6),inset 0 0 6px rgba(255,255,255,.06)}
      .easel-box.easel-wide{width:min(34em,94vw)}
      .easel-title{position:absolute;top:0;left:0;right:0;height:1.9em;border-radius:.65em .65em 0 0;display:flex;align-items:center;
        justify-content:center;font-size:.95em;color:var(--etx);text-shadow:0 1px 1px rgba(0,0,0,.6),0 -1px 1px rgba(0,0,0,.4);
        background:${img('img/modalHeader.png')} left center/auto 100% no-repeat,${img('img/modalHeaderRight.png')} 14.2em center/auto 100% repeat-x,
          linear-gradient(180deg,rgba(16,147,159,.96),rgba(3,72,82,.98))}
      .easel-box-x{position:absolute;top:0;right:0;transform:translate(50%,-40%);z-index:2}
      .easel-box p{margin:.45em 0;font-size:1em}
      .easel-box b{color:var(--egold)}
      .easel-help{font-size:.8em;opacity:.75;margin:1em 0 0}
      .easel-medal{font-size:1.45em;margin:.2em 0 .5em;color:var(--etx);text-shadow:0 1px 3px #000}
      .easel-gold-big{font-size:1.25em;margin:.5em 0;color:var(--egold)}
      .easel-actions{display:flex;flex-direction:column;align-items:center;gap:.6em;margin-top:1.1em}
      .easel-actions .easel-btn{width:80%}
      .easel-actions.easel-row{flex-direction:row;flex-wrap:wrap;justify-content:center}
      .easel-actions.easel-row .easel-btn{width:auto}
      .easel-levels{display:grid;grid-template-columns:repeat(4,1fr);gap:.55em;margin-top:.9em}
      .easel-lvl{display:flex;flex-direction:column;align-items:center;gap:.1em;padding:.5em .2em .4em}
      .easel-lvl b{font-size:1.35em;color:var(--etx);position:relative}
      .easel-lvl small{font-size:.72em;opacity:.9;position:relative}
      .easel-lvl.d-Easy small{color:#9fe3a0}
      .easel-lvl.d-Medium small{color:#f3dc84}
      .easel-lvl.d-Hard small{color:#f5a96a}
      .easel-lvl.d-Impossible small{color:#ff8a7a}
      .easel-lvl span{min-height:1.2em;position:relative}
      .easel-lvl em{font-size:.68em;font-style:normal;color:var(--egold);position:relative;margin-top:-.15em}
      .easel-record{min-height:1.4em}
      .easel-record small{opacity:.85}
      .easel-newrec{font-size:1.15em;margin:.3em 0 .1em;color:var(--egold);text-shadow:0 1px 3px #000}
      .easel-rtabs{display:flex;flex-wrap:wrap;justify-content:center;gap:.3em;margin:.2em 0 .6em}
      .easel-rtab{min-width:2.1em;padding:.25em .45em;font:inherit;font-size:.85em;color:rgba(255,255,255,.88);border:1px solid var(--egb);
        border-radius:.45em;background:rgba(0,32,35,.75);cursor:inherit}
      .easel-rtab:hover{border-color:var(--eg);filter:brightness(1.15)}
      .easel-rtab.on{color:var(--etx);border-color:var(--eg);background:linear-gradient(180deg,rgba(35,116,105,.95),rgba(2,42,40,1))}
      .easel-rtab.d-Easy{color:#9fe3a0}.easel-rtab.d-Medium{color:#f3dc84}.easel-rtab.d-Hard{color:#f5a96a}.easel-rtab.d-Impossible{color:#ff8a7a}
      .easel-rbody{min-height:8em}
      .easel-rsub{margin:.1em 0 .4em!important;opacity:.85}
      .easel-rmsg{margin:1.5em 0!important}
      .easel-rscroll{max-height:min(19em,48vh);overflow-y:auto;border:1px solid var(--egb);border-radius:.5em;background:rgba(0,26,29,.55)}
      .easel-rtable{width:100%;border-collapse:collapse;font-size:.88em}
      .easel-rtable th{position:sticky;top:0;padding:.35em .4em;font-weight:normal;color:var(--etx);background:rgba(4,52,52,.98);border-bottom:1px solid var(--egb)}
      .easel-rtable td{padding:.28em .4em;border-top:1px solid rgba(255,255,255,.06);white-space:nowrap}
      .easel-rtable .l{text-align:left;max-width:9em;overflow:hidden;text-overflow:ellipsis}
      .easel-rtable tr.me td{background:rgba(195,181,101,.18);color:#fff}
      .easel-rtable tr.gap td{padding:0;line-height:1;opacity:.6;border:0}
      .easel-lvl.locked{cursor:${img('img/cursor32x32.png')} 0 0,default;filter:grayscale(.5) brightness(.6)}
      .easel-loading{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:1.4em;text-shadow:0 1px 3px #000}`;
    document.head.appendChild(s);
  }
}

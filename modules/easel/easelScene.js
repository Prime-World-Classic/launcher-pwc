// Отображение партии «Мастерской свитков»: 3D-сцена по состоянию EaselGame (easelLogic.js).
// Логика идёт фиксированными шагами STEP_MS, сцена интерполирует позиции между шагами.
import * as mat4 from '../glMatrix/mat4.js';
import { placementMatrix } from './easelRenderer.js';
import { M, FIELD_L, DIAM, STEP_MS, BALL, BALL_TYPE, BOARD, BOOST, POINT_MODE, COLOR_ANY } from './easelLogic.js';

const BOOST_MAGNET = BOOST.MAGNET;
const quatZ = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const rand = (a, b) => a + Math.random() * (b - a);
// эффекты точек картины в режиме магнита (EaselPaintViewFragment)
const MAGNET_FX = {
  [POINT_MODE.MAGNET_HIGHLIGHT]: 'magnetHighlight',
  [POINT_MODE.MAGNET_PRESELECT]: 'magnetPreselect',
  [POINT_MODE.MAGNET_INSTALLED]: 'magnet',
};

export const FIELD = 10000; // поле в единицах трасс (логика: ×M)
const LUX_SCALE = 8; // commonParams.luxorPlacement: scale (8, -8, 8), location (-0.5, -0.5, 0.07)
const LUX_Z = 0.07 * LUX_SCALE;
const BALL_SCALE = 0.4; // Drops/_*.SOBJ: placement.scale
const BALL_YAW_OFFSET = Math.PI / 2;
const ANIM_FADE = 0.2;
export const COLOR_TEX = [
  'drop_lightgreen',
  'drop_blue',
  'drop_darkgreen',
  'drop_orange',
  'drop_white',
  'drop_cyan',
  'drop_yellow',
  'drop_magenta',
];

// Координаты поля (0..FIELD) → сцена (Z вверх, как в PW)
export function toClient(x, y, z = 0) {
  return [LUX_SCALE * (x / FIELD - 0.5), -LUX_SCALE * (y / FIELD - 0.5), LUX_Z + (z / FIELD) * LUX_SCALE];
}
export function toLogic(cx, cy) {
  return [(cx / LUX_SCALE + 0.5) * FIELD, (-cy / LUX_SCALE + 0.5) * FIELD];
}
const fromLogic = (p, z = 0) => toClient(p.x / M, p.y / M, z);
const swz = (p) => [-p[1], -p[0], p[2]]; // EaselLuxViewPath: offset (-y, -x, z)
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const xform = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

export class EaselScene {
  // pictureTex — id текстур картины из renderer.loadPicture(); efx — EaselFx (эффекты PW), без него — простые спрайты
  constructor(renderer, data, game, board, pictureTex, efx = null) {
    this.efx = efx && efx.ready ? efx : null;
    if (this.efx) this.efx.clear();
    this.magnetFx = new Map(); // точка → {key, inst}
    this.blastFx = new Map(); // id шара-бомбы → {key, inst}
    this.freezeFx = null;
    this.explosionAngle = 0;
    this.r = renderer;
    this.data = data;
    this.game = game;
    this.board = board;
    this.common = data.common;
    this.colors = this.common.colors.map((c) => [c.R, c.G, c.B, c.A]);
    this.time = 0;
    this.pictureTex = pictureTex;
    this.masks = data.pictures[game.pictureIndex].masks[game.level];
    this.fragments = new Float32Array(40);
    this.fragTarget = new Float32Array(40);
    this.fillQueue = [];
    this.final = 0;
    this.paths = game.paths.map((p) => this._pathObjects(p));
    this.views = new Map(); // id шара → вид (позиции двух последних шагов, анимация)
    this.coins = new Map();
    this.fx = [];
    this._buildQuad();
    this._buildPicture();
    this._buildPathDots();
    this.afterStep([]);
  }

  _pathObjects(p) {
    const traj = p.traj.poly;
    const start = traj.coords(0);
    const end = traj.coords(traj.length);
    const sPos = toClient(start[0], start[1]);
    const ePos = toClient(end[0], end[1]);
    const so = swz(p.desc.start.pos);
    const eo = swz(p.desc.end.pos);
    const cannonRoot = placementMatrix(
      mat4.create(),
      [sPos[0] + so[0], sPos[1] + so[1], sPos[2] + so[2]],
      p.desc.start.rot,
      p.desc.start.scale,
    );
    const wellRoot = placementMatrix(mat4.create(), [ePos[0] + eo[0], ePos[1] + eo[1], ePos[2] + eo[2]], p.desc.end.rot, p.desc.end.scale);
    // Cannon/_B.SOBJ: pos (-1.5, 0.6, -0.4), scale 0.75; Well/_.SOBJ: pos (0, 0, 0.88), scale 0.7
    const cannon = mat4.multiply(
      mat4.create(),
      cannonRoot,
      placementMatrix(mat4.create(), [-1.5, 0.6, -0.4], [0, 0, 0, 1], [0.75, 0.75, 0.75]),
    );
    const well = mat4.multiply(mat4.create(), wellRoot, placementMatrix(mat4.create(), [0, 0, 0.88], [0, 0, 0, 1], [0.7, 0.7, 0.7]));
    // локаторы скелетов: пушка start_point_start → start_point_end, колодец end_point_start → middle → end
    const inFrom = xform(cannon, [0.2, 0, 0.5]);
    const inTo = xform(cannon, [1.35, 0, 0.3]);
    const out0 = xform(well, [0, -0.7, 0.3]);
    const out1 = xform(well, [0, -0.2, 0.3]);
    const out2 = xform(well, [0, 0, 0]);
    const inDir = sub3(inTo, inFrom);
    const inLen = len3(inDir);
    const outLen = len3(sub3(out1, out0)) + len3(sub3(out2, out1));
    // EaselLuxView::CreateTunnels: лунки на длине begin + startPointOffset и end + endPointOffset
    // (Tunnel/_.SOBJ — плоскость в плоскости доски, поворот фиксированный)
    const to = this.common.tunnels || { startPointOffset: 0, endPointOffset: 0 };
    const tunnels = [];
    for (const t of p.tunnels) {
      for (const l of [t.begin + to.startPointOffset, t.end + to.endPointOffset]) {
        const [x, y] = traj.coords(l);
        tunnels.push(mat4.fromTranslation(mat4.create(), toClient(x, y, 2)));
      }
    }
    return {
      tunnels,
      cannon,
      well,
      inFrom,
      inTo,
      inDir,
      inLen,
      out: [out0, out1, out2],
      outLen,
      open: false,
      openT: 10,
      bones: new Float32Array(32 * 16),
    };
  }

  _buildQuad() {
    const v = (x, y, u, w) => [x, y, 0, 0, 0, 1, u, w];
    const q = [v(-0.5, -0.5, 0, 1), v(0.5, 0.5, 1, 0), v(0.5, -0.5, 1, 1), v(-0.5, -0.5, 0, 1), v(-0.5, 0.5, 0, 0), v(0.5, 0.5, 1, 0)];
    this.quad = this.r.dynamicModel('quad', new Float32Array(q.flat()));
  }

  _buildPicture() {
    const z = LUX_Z - 0.02;
    const a = toClient(0, 0);
    const b = toClient(FIELD, FIELD);
    const v = (x, y, u, w) => [x, y, z, 0, 0, 1, u, w];
    const quad = [
      v(a[0], a[1], 0, 0),
      v(b[0], a[1], 1, 0),
      v(b[0], b[1], 1, 1),
      v(a[0], a[1], 0, 0),
      v(b[0], b[1], 1, 1),
      v(a[0], b[1], 0, 1),
    ];
    this.pictureModel = this.r.dynamicModel('picture', new Float32Array(quad.flat()));
  }

  _buildPathDots() {
    const out = [];
    const z = LUX_Z - 0.01;
    const size = 0.06;
    for (const gp of this.game.paths) {
      const t = gp.traj.poly;
      for (let l = 0; l <= t.length; l += 200) {
        if (gp.tunnels.some((tn) => l >= tn.begin && l <= tn.end)) continue;
        const [x, y] = t.coords(l);
        const c = toClient(x, y);
        const q = (dx, dy, u, w) => [c[0] + dx * size, c[1] + dy * size, z, 0, 0, 1, u, w];
        out.push(q(-1, -1, 0, 1), q(1, 1, 1, 0), q(1, -1, 1, 1), q(-1, -1, 0, 1), q(-1, 1, 0, 0), q(1, 1, 1, 0));
      }
    }
    this.dotsModel = this.r.dynamicModel('pathdots', new Float32Array(out.flat()));
  }

  // Позиция и направление шара в сцене; null — не виден (в тоннеле, ушёл в колодец)
  _ballPlace(b, path) {
    if (path) {
      const P = this.paths[path.id];
      if (b.covered < 0 || b.state === BALL.ROLL_IN) {
        const d = (Math.abs(b.pos.x) / FIELD_L) * LUX_SCALE;
        if (d > P.inLen) return null;
        const k = d / P.inLen;
        return { pos: lerp3(P.inTo, P.inFrom, k), dir: P.inDir, inPipe: true };
      }
      if (b.state === BALL.ROLL_OUT) {
        const d = (Math.abs(b.pos.x) / FIELD_L) * LUX_SCALE;
        const t = d / P.outLen;
        if (t > 1) return null;
        const [a, c, e] = P.out;
        const pos = lerp3(lerp3(a, c, t), lerp3(c, e, t), t);
        return { pos, dir: sub3(lerp3(c, e, t), lerp3(a, c, t)) };
      }
    }
    const pos = fromLogic(b.pos);
    return { pos, dir: [b.dir.x, -b.dir.y, 0] };
  }

  _view(b) {
    let v = this.views.get(b.id);
    if (!v) {
      v = {
        ball: b,
        prev: null,
        cur: null,
        dir: [1, 0, 0],
        anim: 'idle01',
        t: Math.random() * 2,
        loop: true,
        prevAnim: null,
        fade: 1,
        bones: new Float32Array(32 * 16),
      };
      this.views.set(b.id, v);
    }
    return v;
  }

  _place(b, path, mode) {
    const pl = this._ballPlace(b, path);
    const v = this._view(b);
    v.seen = true;
    v.mode = mode;
    if (!pl) {
      v.hidden = true;
      v.prev = v.cur = null;
      return v;
    }
    v.hidden = false;
    v.prev = v.cur && !v.wasHidden ? v.cur : pl.pos;
    v.cur = pl.pos;
    if (pl.dir[0] || pl.dir[1]) v.dir = pl.dir;
    v.inPipe = !!pl.inPipe;
    return v;
  }

  // EaselBallView::UpdateAnimation: перед лункой (ближе jumpInDistance) и в тоннеле — MOVEUNDERGROUND
  // (jumpIn: капля подпрыгивает, на 12/16 анимации пересекает доску и уходит под неё), на выходе — jumpOut
  _chainAnim(v, b, moving) {
    const sk = this.r.skeletons.drop;
    v.inTunnel = b.state === BALL.IN_TUNNEL;
    let under = v.inTunnel;
    if (!under) {
      const speed = Math.max(Math.abs(b.speed), v.jumpSpeed || 0);
      const toTunnel = b.nextTunnel - b.covered;
      under = toTunnel > 0 && toTunnel < speed * sk.duration('jumpIn') * 1000 * (12 / 16);
    }
    if (under) {
      if (v.anim !== 'jumpIn') {
        v.jumpSpeed = Math.abs(b.speed);
        this._setAnim(v, 'jumpIn', false);
      }
    } else if (v.anim === 'jumpIn') {
      v.jumpSpeed = 0;
      this._setAnim(v, 'jumpOut', false);
    } else if (v.anim !== 'jumpOut' || v.t >= sk.duration('jumpOut')) {
      this._setAnim(v, moving ? 'move01' : 'idle01');
    }
  }

  _setAnim(v, anim, loop = true) {
    if (v.anim === anim) return;
    v.prevAnim = v.anim;
    v.prevT = v.t;
    v.prevLoop = v.loop;
    v.fade = 0;
    v.anim = anim;
    v.t = 0;
    v.loop = loop;
  }

  // Вызывается после каждого шага логики: снимок позиций + события
  afterStep(events) {
    const g = this.game;
    for (const v of this.views.values()) {
      v.seen = false;
      v.wasHidden = v.hidden;
    }
    g.forAllBalls((b, path, chain) => {
      const v = this._place(b, path, 'chain');
      const moving = chain.speed !== 0 && !g.frozen;
      if (!v.dying) this._chainAnim(v, b, moving);
    });
    for (const b of g.bullets) {
      const v = this._place(b, null, 'bullet');
      v.dir = [0, 1, 0];
      this._setAnim(v, 'speedball');
    }
    g.platform.balls.forEach((b) => {
      if (!b) return;
      const v = this._view(b);
      v.seen = true;
      v.mode = 'platform';
      v.hidden = false;
      v.dir = [0, 1, 0];
      this._setAnim(v, 'idle01');
    });
    for (const e of events) this._onEvent(e);
    for (const [id, v] of this.views) {
      if (!v.seen && !v.dying) this.views.delete(id);
    }
    // монетки
    for (const c of this.coins.values()) c.seen = false;
    for (const o of g.falling.objects) {
      if (o.picked) continue;
      let c = this.coins.get(o.id);
      const p = fromLogic(o.pos);
      if (!c) this.coins.set(o.id, (c = { prev: p, cur: p, phase: Math.random() * 6 }));
      else {
        c.prev = c.cur;
        c.cur = p;
      }
      c.seen = true;
    }
    for (const [id, c] of this.coins) if (!c.seen) this.coins.delete(id);
    // заполнение фрагментов картины — с задержкой paintFillStartTime
    const ratios = new Float32Array(40);
    for (const f of g.paint.fragments) {
      let a = 0;
      let cap = 0;
      for (const p of f.points) {
        a += p.amount;
        cap += p.capacity;
      }
      if (f.id < 40) ratios[f.id] = cap ? a / cap : 0;
    }
    const fp = this.common.effects.fillParams;
    this.fillQueue.push({ at: this.time + fp.paintFillStartTime, ratios });
    // пушка открыта, пока из неё выходят капли
    for (const P of this.paths) P.want = false;
    g.forAllBalls((b, path) => {
      if (b.covered < 0 && (Math.abs(b.pos.x) / FIELD_L) * LUX_SCALE < this.paths[path.id].inLen + 0.6) this.paths[path.id].want = true;
    });
    for (const P of this.paths) {
      if (P.want !== P.open) {
        P.open = P.want;
        P.openT = 0;
      }
    }
    this.stepTime = this.time;
  }

  _color(c, a = 1) {
    const k = this.colors[c] || this.colors[COLOR_ANY] || [1, 1, 1, 1];
    return [k[0], k[1], k[2], a];
  }

  _onEvent(e) {
    switch (e.type) {
      case 'explode':
        for (const b of e.balls) {
          const v = this.views.get(b.id);
          if (v && v.cur && !v.hidden) {
            v.dying = true;
            v.dieT = 0;
            this._setAnim(v, 'death', false);
            if (this.efx) this._explosion(v.cur, b);
            else this.fx.push({ kind: 'splash', pos: v.cur, color: this._color(b.color), t: 0, life: 0.55, size: 0.9 });
          }
        }
        break;
      case 'paintFlow': {
        const from = fromLogic(e.from);
        const to = fromLogic(e.point.coord);
        if (this.efx) {
          this._flow(from, to, e.color);
          break;
        }
        this.fx.push({
          kind: 'flow',
          from,
          to,
          color: this._color(e.color),
          t: -Math.random() * 0.15,
          life: 0.75 + Math.min(0.5, len3(sub3(to, from)) * 0.05),
        });
        break;
      }
      case 'alchemistIn':
        if (this.efx) {
          this._flow(fromLogic(e.from), this._potPos(), e.color);
          break;
        }
        this.fx.push({ kind: 'splash', pos: fromLogic(e.from), color: [0.8, 0.5, 1, 1], t: 0, life: 0.6, size: 0.7 });
        break;
      case 'alchemistOut':
        if (this.efx) {
          this._flow(this._potPos(), fromLogic(e.point.coord), e.point.color);
          break;
        }
        this.fx.push({ kind: 'splash', pos: fromLogic(e.point.coord), color: [0.8, 0.5, 1, 1], t: 0, life: 0.8, size: 1.4 });
        break;
      case 'paintBlast':
        if (this.efx) {
          this.efx.spawn('paintblastExplosion', { pos: fromLogic(e.at) });
          break;
        }
        this.fx.push({ kind: 'splash', pos: fromLogic(e.at), color: [1, 0.75, 0.3, 1], t: 0, life: 0.8, size: 4.5, add: true });
        break;
      case 'bulletHitMagnet':
      case 'miss': {
        const v = this.views.get(e.ball.id);
        if (v && v.cur) this.fx.push({ kind: 'splash', pos: v.cur, color: this._color(e.ball.color), t: 0, life: 0.4, size: 0.6 });
        break;
      }
      case 'coinPicked': {
        const c = this.coins.get(e.obj.id);
        const p = c ? c.cur : fromLogic(e.obj.pos);
        if (this.efx) {
          // EaselLuxView::StartPickEffect: эффект прикрепляется к тележке (attachType Body), а не к кристаллу
          const inst = this.efx.spawn('coinPickUp', { pos: this._carriageBody(this.game.platform.pos.x) });
          if (inst) (this.pickFx || (this.pickFx = [])).push(inst);
          break;
        }
        this.fx.push({ kind: 'splash', pos: p, color: [1, 0.9, 0.4, 1], t: 0, life: 0.5, size: 1.2, add: true });
        break;
      }
      case 'sorter':
        if (this.efx) this.efx.spawn('sort', { pos: toClient(FIELD / 2, FIELD / 2) });
        else g_forSplash(this, [0.6, 1, 0.6, 1]);
        break;
      case 'freeze':
        if (this.efx) {
          if (this.freezeFx) this.freezeFx.stop();
          this.freezeFx = e.on ? this.efx.spawn('freeze', { pos: toClient(FIELD / 2, FIELD / 2) }) : null;
        } else if (e.on) g_forSplash(this, [0.6, 0.85, 1, 1]);
        break;
      case 'state':
        // заставки начала уровня и победы (EaselViewEffects: startMovie / gameWonEffect)
        if (!this.efx) break;
        if (e.state === BOARD.LEVEL_BEGIN) this.efx.spawn('gameStart', { pos: toClient(FIELD / 2, FIELD / 2) });
        else if (e.state === BOARD.WON_MOVIE) this.efx.spawn('gameWon', { pos: toClient(FIELD / 2, FIELD / 2) });
        if (e.state >= BOARD.LEVEL_WON && this.freezeFx) {
          this.freezeFx.stop();
          this.freezeFx = null;
        }
        break;
    }
  }

  // EaselViewEffects::BallExplosionHandler: случайный поворот (≥ minRotationAngle от предыдущего) и масштаб
  _explosion(pos, b) {
    if (b.color === COLOR_ANY || b.type === BALL_TYPE.JOKER) return;
    if (b.pos.x < 0 || b.pos.y < 0) return;
    const ep = this.common.effects.explosionParams;
    const min = (ep.minRotationAngle * Math.PI) / 180;
    let a = (min < 2 * Math.PI ? rand(min, 2 * Math.PI) : min) + this.explosionAngle;
    if (a > 2 * Math.PI) a -= 2 * Math.PI;
    this.explosionAngle = a;
    const s = [rand(ep.minScale.x, ep.maxScale.x), rand(ep.minScale.y, ep.maxScale.y), rand(ep.minScale.z, ep.maxScale.z)];
    this.efx.spawn('ballExplosion', { pos: [pos[0], pos[1], LUX_Z], rot: quatZ(a), scale: s, color: this._color(b.color) });
  }

  // PaintFlyInPointHandler: брызги в точке + струя по группе дальности, повёрнутая к цели (локальная −Y),
  // масштаб = расстояние / flowScale
  _flow(from, to, color) {
    const E = this.common.effects;
    const col = this._color(color);
    const f = [from[0], from[1], LUX_Z];
    const t = [to[0], to[1], LUX_Z];
    const d = Math.hypot(t[0] - f[0], t[1] - f[1]);
    if (d < E.flowIntervalsStartDistance) return;
    const groups = ['flowZero', 'flowShort', 'flowMid', 'flowLong'];
    let gi = E.flowGroups.findIndex((g) => d < g.intervalEndDistance);
    if (gi < 0) gi = E.flowGroups.length - 1;
    this.efx.spawn('flowTouch', { pos: t, color: col });
    if (d < 1e-4) return;
    const ang = Math.atan2(t[0] - f[0], -(t[1] - f[1]));
    this.efx.spawn(groups[gi], { pos: f, rot: quatZ(ang), scale: d / E.flowScale, color: col });
  }

  // Котёл алхимика: эффект прикреплён к корню здания (EaselViewAlchemistPot), струи летят в его позицию
  _potPos() {
    return [0, 0, LUX_Z];
  }

  // Локатор Body тележки (Carriage/_B1.SOBJ: компонент pos (0, -4.6, 0), scale 0.5; Body z 0.218)
  _carriageBody(x) {
    const c = toClient(x / M, FIELD / 2);
    return [c[0], c[1] - 4.6, c[2] + 0.218 * 0.5];
  }

  // Постоянные эффекты кадра: магниты, бомба, прицел, лазер, котёл алхимика
  _updateFx(alpha) {
    const fx = this.efx;
    const g = this.game;
    // эффекты подбора кристаллов едут вместе с тележкой
    if (this.pickFx) {
      const body = this._carriageBody(g.platform.pos.x);
      this.pickFx = this.pickFx.filter((inst) => !inst.dead);
      for (const inst of this.pickFx) inst.setPlacement(body);
    }
    // магниты в точках картины
    const seen = new Set();
    for (const p of g.paint.points()) {
      let key = MAGNET_FX[p.mode] || null;
      if (p.mode === POINT_MODE.MAGNET_HIGHLIGHT && p.amount >= p.capacity) key = null;
      let rec = this.magnetFx.get(p);
      if (rec && rec.key !== key) {
        rec.inst.stop();
        this.magnetFx.delete(p);
        rec = null;
      }
      if (!key) continue;
      seen.add(p);
      if (!rec) {
        const inst = fx.spawn(key, { pos: fromLogic(p.coord), colors: { recolor: this._color(p.color) } });
        if (inst) this.magnetFx.set(p, { key, inst });
      }
    }
    for (const [p, rec] of this.magnetFx) {
      if (!seen.has(p)) {
        rec.inst.stop();
        this.magnetFx.delete(p);
      }
    }
    // шар-бомба: эффект вместо модели (на тележке / в полёте)
    const blastSeen = new Set();
    for (const [id, v] of this.views) {
      const b = v.ball;
      if (b.type !== BALL_TYPE.PAINTBLAST || v.hidden || v.dying) continue;
      const key = v.mode === 'bullet' ? 'paintBlastBallFlying' : 'paintBlastBall';
      let rec = this.blastFx.get(id);
      if (rec && rec.key !== key) {
        rec.inst.kill();
        rec = null;
      }
      if (!rec) {
        const inst = fx.spawn(key, {});
        if (!inst) continue;
        this.blastFx.set(id, (rec = { key, inst }));
      }
      rec.inst.setPlacement(this._ballPos(v, alpha));
      blastSeen.add(id);
    }
    for (const [id, rec] of this.blastFx) {
      if (!blastSeen.has(id)) {
        rec.inst.kill();
        this.blastFx.delete(id);
      }
    }
    // лазерный прицел: луч от шара на тележке до точки столкновения, цель и источник (EaselLuxViewPlatform)
    const plat = g.platform;
    const bullet = plat.bullet();
    const magnet = g.boosts.get(BOOST_MAGNET);
    const aim = bullet && plat.collision && g.state === BOARD.LEVEL_RUN && !(magnet && magnet.state === 'waiting');
    if (aim) {
      const blast = bullet.type === BALL_TYPE.PAINTBLAST;
      const col = this._color(blast ? 3 : bullet.color);
      const from = fromLogic(bullet.pos);
      const to = fromLogic(plat.collision, DIAM / M / 2);
      if (!this.laserTarget) this.laserTarget = fx.spawn('laserPointer', {});
      if (!this.laserSource) this.laserSource = fx.spawn('laserSource', {});
      for (const [inst, pos] of [
        [this.laserTarget, to],
        [this.laserSource, from],
      ]) {
        if (!inst) continue;
        inst.setPlacement(pos);
        inst.colors = { recolor: col };
      }
      fx.beam('laser', from, to, col);
      fx.beam('laser2', from, to, [1, 1, 1, 1]);
      if (blast) {
        if (!this.aimFx) this.aimFx = fx.spawn('paintBlastAim', {});
        if (this.aimFx) this.aimFx.setPlacement(fromLogic(plat.collision));
      } else this._killFx('aimFx');
    } else {
      this._killFx('laserTarget');
      this._killFx('laserSource');
      this._killFx('aimFx');
    }
    // котёл алхимика, пока буст активен
    const alch = g.boosts.get(BOOST.ALCHEMIST);
    const active = !!(alch && alch.active);
    if (active && !this.potFx) this.potFx = fx.spawn('alchemistPot', { pos: [0, 0, 0] });
    else if (!active && this.potFx) {
      this.potFx.stop();
      this.potFx = null;
    }
  }

  _killFx(k) {
    if (this[k]) this[k].kill();
    this[k] = null;
  }

  _ballPos(v, alpha) {
    if (v.mode === 'platform') return fromLogic(v.ball.pos);
    return v.cur ? lerp3(v.prev || v.cur, v.cur, alpha) : fromLogic(v.ball.pos);
  }

  _bonesFor(v) {
    const sk = this.r.skeletons.drop;
    if (v.prevAnim && v.fade < ANIM_FADE) {
      return sk.pose(v.bones, v.prevAnim, v.prevT, v.prevLoop, { anim: v.anim, time: v.t, weight: v.fade / ANIM_FADE, loop: v.loop });
    }
    return sk.pose(v.bones, v.anim, v.t, v.loop);
  }

  _sprite(tex, pos, size, tint, blend = 'alpha', order = 0, rot = 0) {
    const m = mat4.fromTranslation(mat4.create(), pos);
    if (rot) mat4.rotateZ(m, m, rot);
    mat4.scale(m, m, [size, size, 1]);
    this.r.draw({ model: this.quad, matrix: m, tex: { '*': tex }, kind: 2, blend, tint, cull: false, order });
  }

  // Кадр: dt — секунды, alpha — доля шага логики (0..1)
  render(dt) {
    const r = this.r;
    const g = this.game;
    this.time += dt;
    const alpha = Math.min(1, (this.time - this.stepTime) / (STEP_MS / 1000));
    this._updateFill(dt);
    const cam = this.common.camera;
    r.setCamera({ target: [cam.anchor.x, cam.anchor.y, cam.anchor.z], yaw: cam.yaw, pitch: cam.pitch, rod: cam.rod, fov: cam.fov });
    r.begin();
    const I = mat4.create();
    const boardM = mat4.fromTranslation(mat4.create(), [0, 0, 0.44]); // Buildings/*/MiniGame/_.SOBJ: stat pos z 0.44
    for (const m of this.board) r.draw({ model: m, matrix: boardM });
    r.draw({
      model: this.pictureModel,
      matrix: I,
      paint: { tex: this.pictureTex, fragments: this.fragments, masks: this.masks, final: this.final },
    });
    r.draw({ model: this.dotsModel, matrix: I, tex: { '*': '__dot' }, kind: 2, blend: 'alpha', tint: [1, 0.95, 0.75, 0.3], order: 10 });

    // пушки и колодцы
    const cannonSkel = r.skeletons.cannon;
    for (const P of this.paths) {
      P.openT += dt;
      const anim = P.open ? 'open' : 'close';
      r.draw({
        model: r.models.cannon,
        matrix: P.cannon,
        bones: cannonSkel.pose(P.bones, anim, Math.min(P.openT, cannonSkel.duration(anim)), false),
      });
      r.draw({ model: r.models.well, matrix: P.well });
      // EaselLuxViewTunnelPoint: видны с начала уровня (LEVEL_RUN) до его окончания
      if (g.state === BOARD.LEVEL_RUN) for (const m of P.tunnels) r.draw({ model: r.models.tunnel, matrix: m, order: 6, cull: false });
    }

    // капли
    const freezeAdd = g.frozen ? [0.12, 0.22, 0.4, 0] : null;
    for (const [id, v] of this.views) {
      v.t += dt;
      if (v.prevAnim) {
        v.fade += dt;
        v.prevT += dt;
      }
      if (v.dying) {
        v.dieT += dt;
        if (v.dieT > Math.max(0.3, r.skeletons.drop.duration('death'))) {
          this.views.delete(id);
          continue;
        }
      }
      if (v.hidden) continue;
      // в тоннеле капля под доской: после jumpIn не рисуется; тень гаснет (EaselBallView::UpdateShadow)
      v.shadow = Math.max(0, Math.min(1, (v.shadow ?? 1) + (v.inTunnel ? -dt : dt) * 4));
      if (v.inTunnel && (v.anim !== 'jumpIn' || v.t >= r.skeletons.drop.duration('jumpIn'))) continue;
      const b = v.ball;
      let pos;
      let dir = v.dir;
      if (v.mode === 'platform') {
        pos = fromLogic(b.pos);
      } else {
        if (!v.cur) continue;
        pos = v.dying ? v.cur : lerp3(v.prev || v.cur, v.cur, alpha);
      }
      const m = mat4.fromTranslation(mat4.create(), pos);
      mat4.rotateZ(m, m, Math.atan2(dir[1], dir[0]) + BALL_YAW_OFFSET);
      const sy = b.size / DIAM;
      const sx = 1 - (sy - 1) / 1.5;
      const pl = v.mode === 'platform' && b !== g.platform.bullet() ? 0.8 : 1;
      mat4.scale(m, m, [BALL_SCALE * sx * pl, BALL_SCALE * sy * pl, BALL_SCALE * pl]);
      let tex = COLOR_TEX[b.color] || 'drop_joker';
      if (b.type === BALL_TYPE.JOKER || b.color === COLOR_ANY) tex = 'drop_joker';
      let add = v.mode === 'chain' ? freezeAdd : null;
      if (b.type === BALL_TYPE.PAINTBLAST) {
        tex = 'drop_orange';
        const k = 0.35 + 0.25 * Math.sin(this.time * 10);
        add = [k, k * 0.6, 0.05, 0];
      }
      if (v.mode === 'chain' && !v.inPipe && !v.dying && v.shadow > 0)
        this._sprite('__dot', [pos[0], pos[1] - 0.05, LUX_Z + 0.005], 0.62, [0, 0, 0, 0.35 * v.shadow], 'alpha', 5);
      if (b.type === BALL_TYPE.PAINTBLAST && this.efx) continue; // PaintBlastBall/_.EFFT
      r.draw({ model: r.models.drop, matrix: m, bones: this._bonesFor(v), tex: { 0: tex }, add });
      if (b.type === BALL_TYPE.PAINTBLAST) this._sprite('__dot', [pos[0], pos[1], pos[2] + 0.2], 0.9, [1, 0.6, 0.2, 0.6], 'add', 1);
    }

    // монетки-кристаллы (Crystal/_.SOBJ), common.coin.zLift
    for (const c of this.coins.values()) {
      const p = lerp3(c.prev, c.cur, alpha);
      const m = mat4.fromTranslation(mat4.create(), [p[0], p[1], p[2] + (DIAM / M / FIELD) * LUX_SCALE * this.common.coin.zLift]);
      mat4.rotateZ(m, m, this.time * 3 + c.phase);
      mat4.rotateX(m, m, 0.4);
      mat4.scale(m, m, [3.2, 3.2, 3.2]);
      r.draw({ model: r.models.crystal, matrix: m });
      this._sprite('__dot', [p[0], p[1], p[2] + 0.36], 0.55, [1, 0.85, 0.4, 0.35], 'add', 2);
    }

    // тележка (Carriage/_B1.SOBJ: pos (0,-4.6,0), rot 180° вокруг Z, scale 0.5)
    const plat = g.platform;
    const cx = toClient(plat.pos.x / M, FIELD / 2);
    const carriage = mat4.fromTranslation(mat4.create(), [cx[0], cx[1] - 4.6, cx[2]]);
    mat4.rotateZ(carriage, carriage, Math.PI);
    mat4.scale(carriage, carriage, [0.5, 0.5, 0.5]);
    r.draw({ model: plat.balls.length === 3 ? r.models.carriage2 : r.models.carriage1, matrix: carriage });

    // лазерный прицел до точки столкновения
    const bullet = plat.bullet();
    const magnet = g.boosts.get(BOOST_MAGNET);
    if (!this.efx && bullet && g.state === BOARD.LEVEL_RUN && !(magnet && magnet.state === 'waiting')) {
      const from = fromLogic(bullet.pos);
      const to = plat.collision ? fromLogic(plat.collision) : toClient(bullet.pos.x / M, 0);
      const col = this._color(bullet.type === BALL_TYPE.PAINTBLAST ? 3 : bullet.color, 0.55);
      const L = len3(sub3(to, from));
      const step = 0.22;
      const ofs = (this.time * 1.5) % step;
      for (let d = 0.35 + ofs; d < L; d += step) this._sprite('__dot', lerp3(from, to, d / L), 0.09, col, 'add', 3);
      if (plat.collision) this._sprite('__dot', to, 0.45 + 0.08 * Math.sin(this.time * 8), [col[0], col[1], col[2], 0.8], 'add', 3);
    }

    // точки картины в режиме магнита
    for (const p of this.efx ? [] : g.paint.points()) {
      if (p.mode === POINT_MODE.NONE) continue;
      const pos = fromLogic(p.coord, 30);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
      if (p.mode === POINT_MODE.MAGNET_HIGHLIGHT) this._sprite('__dot', pos, 0.9, [1, 1, 1, 0.25 + 0.15 * pulse], 'add', 4);
      else if (p.mode === POINT_MODE.MAGNET_PRESELECT) this._sprite('__dot', pos, 1.5, [1, 0.9, 0.3, 0.6 + 0.3 * pulse], 'add', 4);
      else this._sprite('__dot', pos, 1.2 + 0.2 * pulse, [0.4, 0.8, 1, 0.65], 'add', 4, this.time);
    }

    // эффекты
    this.fx = this.fx.filter((f) => (f.t += dt) < f.life);
    for (const f of this.fx) {
      if (f.t < 0) continue;
      const u = f.t / f.life;
      if (f.kind === 'splash') {
        this._sprite(
          '__dot',
          [f.pos[0], f.pos[1], f.pos[2] + 0.15],
          f.size * (0.35 + 0.65 * Math.sqrt(u)),
          [f.color[0], f.color[1], f.color[2], (1 - u) * 0.9],
          f.add ? 'add' : 'alpha',
          2,
        );
      } else if (f.kind === 'flow') {
        const e = u * u * (3 - 2 * u);
        const p = lerp3(f.from, f.to, e);
        p[2] += Math.sin(Math.PI * u) * (0.6 + len3(sub3(f.to, f.from)) * 0.12);
        this._sprite('__dot', p, 0.32, [f.color[0], f.color[1], f.color[2], 0.95], 'alpha', 1);
        this._sprite('__dot', p, 0.55, [f.color[0], f.color[1], f.color[2], 0.35], 'add', 1);
        if (f.t + dt >= f.life) this.fx.push({ kind: 'splash', pos: f.to, color: f.color, t: 0, life: 0.45, size: 0.8 });
      }
    }
    if (this.efx) {
      this._updateFx(alpha);
      this.efx.update(dt);
      this.efx.render();
    }
    r.end();
  }

  _updateFill(dt) {
    while (this.fillQueue.length && this.fillQueue[0].at <= this.time) this.fragTarget.set(this.fillQueue.shift().ratios);
    const fp = this.common.effects.fillParams;
    for (let i = 0; i < 40; i++) {
      const target = this.fragTarget[i];
      let s = this.fragments[i];
      if (target >= 1 && s >= 1) s = Math.min(2, s + dt / fp.completeFadeIn);
      else if (s < target) s = Math.min(target, s + (dt * Math.max(0.15, (target - s) * 3)) / fp.fillInterval);
      else if (s > target && s <= 1) s = target;
      this.fragments[i] = s;
    }
    const won = this.game.state >= BOARD.LEVEL_WON && this.game.state <= BOARD.WON_FINAL;
    this.final = won ? Math.min(1, this.final + dt / fp.completeFadeIn) : 0;
  }
}

// Вспышка по всем шарам на поле (сортировка, заморозка)
function g_forSplash(scene, color) {
  for (const v of scene.views.values()) {
    if (v.mode === 'chain' && v.cur && !v.hidden && !v.inPipe)
      scene.fx.push({ kind: 'splash', pos: v.cur, color, t: -Math.random() * 0.2, life: 0.5, size: 0.8, add: true });
  }
}

// Логика «Мастерской свитков» — порт PF_Minigames (Lux*.cpp, PaintLogic, Boosts) из Prime World.
// Единицы как в оригинале: логические = единицы трасс × 10000 (LUX_LOGIC_TIME_MULTIPLIER), время — мс.
// Логика шагает фиксированным шагом STEP_MS (как мир PW), отображение интерполирует между шагами.
import { PolylineTrajectory } from './easelTrajectory.js';

export const M = 10000; // LUX_LOGIC_TIME_MULTIPLIER
export const FIELD_L = 10000 * M; // LOGIC_FIELD_WIDTH/HEIGHT
export const DIAM = 500 * M; // BALL_DEF_DIAMETER
export const RADIUS = 250 * M;
export const STEP_MS = 100;
const BORDER_WIDTH_OFFSET = 20;
const BORDER_HEIGHT_OFFSET = 30;
const MIN_BALLS_TO_BLOW = 3;
const AFTER_EXIT_DISTANCE = 1500;
const SPLINE_FALLING_CHAIN_SPEED = 80;
const LEVEL_END_DELAY1 = 1000;
const LEVEL_END_DELAY2 = 4000;
const LEVEL_FAIL_END_DELAY = 4000;
const GAME_START_EFFECT_MS = 2700; // Effects/LevelStart lifeTime 2.7
const GAME_WON_EFFECT_MS = 4300; // Effects/LevelEnd lifeTime 4.3
const RANDOM_RETRIES = 100;

// NDb::EColor
export const COLOR = { black: 0, blue: 1, green: 2, red: 3, white: 4, cyan: 5, yellow: 6, magenta: 7, any: 8 };
export const COLOR_ANY = 8;
const NUM_COLORS = 9;

export const BALL = {
  UNKNOWN: 0,
  ROLL_IN: 1,
  ON_BOARD: 2,
  ROLL_OUT: 3,
  IN_TUNNEL: 4,
  ON_PLATFORM: 5,
  FIRED: 6,
  HIT_MATCH: 7,
  HIT_MISSMATCH: 8,
  MISSED: 9,
  EXPLODED: 10,
};
export const BALL_TYPE = { SIMPLE: 0, PAINTBLAST: 1, JOKER: 2 };
const CHAIN = { ROLL_IN: 0, ON_BOARD: 1, ROLL_OUT: 2 };
export const BOARD = {
  NONE: 0,
  LEVEL_BEGIN: 1,
  LEVEL_RUN: 2,
  LEVEL_WON: 3,
  WON_BLAST_BALLS: 4,
  WON_MOVIE: 5,
  WON_FINAL: 6,
  LEVEL_FAIL: 7,
  FAIL_FINAL: 8,
};
export const BOOST = { PAINTBLAST: 1, FREEZE: 2, JOKER: 3, SORTER: 6, MAGNET: 7, ALCHEMIST: 8 };
export const POINT_MODE = { NONE: 0, MAGNET_HIGHLIGHT: 1, MAGNET_PRESELECT: 2, MAGNET_INSTALLED: 3 };

const trunc = Math.trunc;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => trunc(Math.hypot(a.x - b.x, a.y - b.y)); // EaselMath CalculateDistance

// NRandom: целые [min, max] включительно и float [min, max)
export class Rng {
  constructor(seed) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min, max) {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }
  float(min, max) {
    return min + this.next() * (max - min);
  }
}

// Траектория в логических единицах поверх PolylineTrajectory (единицы трасс)
class LogicTrajectory {
  constructor(degree, points) {
    this.poly = new PolylineTrajectory(degree, points);
    this.length = Math.round(this.poly.length * M);
  }
  coords(len) {
    if (len > this.length) return null; // LUX_LENGHT_TOO_BIG
    const c = this.poly.coords(len / M);
    return { x: c[0] * M, y: c[1] * M };
  }
  tangent(len) {
    const t = this.poly.tangent(len / M);
    return { x: t[0] * M, y: t[1] * M };
  }
}

let ballIds = 0;
export class Ball {
  constructor(type, pos, color) {
    this.id = ++ballIds;
    this.type = type;
    this.color = color;
    this.state = BALL.UNKNOWN;
    this.size = DIAM;
    this.speed = 0;
    this.dir = { x: 1, y: 0 };
    this.pos = { x: pos.x, y: pos.y };
    this.covered = -1;
    this.lastTunnel = -1e10;
    this.nextTunnel = -1e10;
  }
  velocity() {
    const l = Math.hypot(this.dir.x, this.dir.y) || 1;
    return { dx: this.dir.x / l, dy: this.dir.y / l, vx: (this.dir.x / l) * this.speed, vy: (this.dir.y / l) * this.speed };
  }
  // LuxBall::GetCollisionTime
  collisionTime(other) {
    const L = this.size / 2 + other.size / 2;
    const dX = this.pos.x - other.pos.x;
    const dY = this.pos.y - other.pos.y;
    const a = this.velocity();
    const b = other.velocity();
    const dVX = a.vx - b.vx;
    const dVY = a.vy - b.vy;
    const A = dVX * dVX + dVY * dVY;
    const B = 2 * (dX * dVX + dY * dVY);
    const C = dX * dX + dY * dY - L * L;
    const eps = FIELD_L * 1e-6;
    if (Math.abs(A) < eps) {
      if (Math.abs(B) < eps) return null;
      return -C / B;
    }
    let D = B * B - 4 * A * C;
    if (D < -eps) return null;
    if (D < eps) D = 0;
    const sq = Math.sqrt(D);
    const t1 = (-B + sq) / (2 * A);
    const t2 = (-B - sq) / (2 * A);
    if (t1 < 0) return t2 < 0 ? null : t2;
    if (t2 < 0) return t1;
    return Math.min(t1, t2);
  }
  insertionShift(other, t) {
    const a = this.velocity();
    const b = other.velocity();
    let tx = this.pos.x + a.vx * t - (other.pos.x + b.vx * t);
    let ty = this.pos.y + a.vy * t - (other.pos.y + b.vy * t);
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    return b.dx * tx + b.dy * ty;
  }
  // GetCollisionPoint: в оригинале Interpolate(first, first) — позиция пули в момент столкновения
  collisionPoint(t) {
    const a = this.velocity();
    return { x: this.pos.x + a.vx * t, y: this.pos.y + a.vy * t };
  }
  canCollide() {
    if (this.state === BALL.ROLL_IN || this.state === BALL.ROLL_OUT) return false;
    if (this.state === BALL.IN_TUNNEL && this.covered - this.lastTunnel > DIAM) return false;
    return true;
  }
}

class BallRecord {
  constructor(ball) {
    this.ball = ball;
    this.inserted = false;
    this.countdown = 5;
    this.edge = 0;
    this.edgeVel = 0;
    this.curVel = 0;
    this.offset = 0;
    this.tunnelEnd = 0;
  }
  canExplode() {
    if (this.inserted) this.countdown--;
    return this.inserted && this.countdown <= 0;
  }
}

// LuxBallChain
class BallChain {
  constructor(path, game) {
    this.path = path;
    this.game = game;
    this.speed = 0;
    this.defSpeed = 0;
    this.state = CHAIN.ROLL_IN;
    this.firstEdge = 0;
    this.firstEdgeVel = 0;
    this.balls = [];
  }
  position() {
    if (!this.balls.length) return 0;
    const f = this.balls[0].ball;
    return f.covered + trunc(f.size / 2);
  }
  length() {
    if (!this.balls.length) return 0;
    const b = this.balls[this.balls.length - 1].ball;
    return this.position() - (b.covered - trunc(b.size / 2));
  }
  end() {
    return this.position() - this.length();
  }
  tearOffTail(idx) {
    const c = new BallChain(this.path, this.game);
    c.state = this.state;
    c.speed = this.speed;
    c.defSpeed = this.defSpeed;
    c.firstEdge = this.firstEdge;
    c.firstEdgeVel = this.firstEdgeVel;
    c.balls = this.balls.splice(idx);
    this.balls[0].edgeVel = 0;
    return c;
  }
  processTunnels() {
    const tunnels = this.path.tunnels;
    if (!tunnels.length) return;
    const nextOffset = DIAM * 2;
    const find = (pos) => {
      const p = trunc(pos / M);
      return tunnels.find((t) => p >= t.begin && p <= t.end);
    };
    for (const r of this.balls) {
      const pos = r.ball.covered;
      const t = find(pos);
      const tn = find(pos + nextOffset);
      if (tn) r.ball.nextTunnel = tn.begin * M;
      if (!t) {
        if (r.ball.state === BALL.IN_TUNNEL) {
          this.game.emit({ type: 'tunnel', in: false, ball: r.ball }); // LuxBall: SendBallLeavesTunnelNotification
          r.ball.lastTunnel = r.tunnelEnd;
          r.ball.state = this.state === CHAIN.ON_BOARD ? BALL.ON_BOARD : this.state === CHAIN.ROLL_IN ? BALL.ROLL_IN : BALL.ROLL_OUT;
        }
      } else if (this.speed >= 0) {
        r.ball.lastTunnel = t.begin * M;
        r.tunnelEnd = t.end * M;
        if (r.ball.state !== BALL.IN_TUNNEL) this.game.emit({ type: 'tunnel', in: true, ball: r.ball });
        r.ball.state = BALL.IN_TUNNEL;
      }
    }
  }
  explodeChainBalls() {
    for (const r of this.balls) {
      r.ball.state = BALL.EXPLODED;
      this._exploded(r.ball, 1);
    }
    this.game.emit({ type: 'explode', balls: this.balls.map((r) => r.ball) });
    this.balls = [];
  }
  explodeBallAtPos(pos) {
    const i = this.balls.findIndex((r) => r.ball.covered === pos);
    if (i < 0) return { found: false };
    return { found: true, tail: this.explodeBall(i) };
  }
  sortChain() {
    this.balls.sort((a, b) => a.ball.color - b.ball.color);
    this.recalcSizes();
    this.recalcPositions();
    this.processTunnels();
  }
  addInit(ball) {
    const r = trunc(ball.size / 2);
    const pos = -this.length() - r;
    ball.covered = pos;
    const rec = new BallRecord(ball);
    rec.edge = pos + r;
    this.balls.push(rec);
    this.firstEdge = pos - r;
  }
  _newRecord(ball) {
    const rec = new BallRecord(ball);
    rec.countdown = this.game.data.common.explosionCountdown;
    return rec;
  }
  addFront(ball) {
    const r = trunc(ball.size / 2);
    const pos = ball.covered;
    ball.speed = 0;
    let matched = true;
    if (this.balls.length) {
      const fc = this.balls[0].ball.color;
      matched = ball.color === COLOR_ANY || fc === COLOR_ANY || ball.color === fc;
    }
    const rec = this._newRecord(ball);
    this.balls.unshift(rec);
    rec.inserted = this.checkOnExplosion(0);
    rec.edge = pos - r;
    this.recalcSizes();
    this.recalcPositions();
    this.processTunnels();
    return matched;
  }
  addEnd(ball) {
    const r = trunc(ball.size / 2);
    const pos = ball.covered;
    ball.speed = 0;
    let matched = true;
    if (this.balls.length) {
      const bc = this.balls[this.balls.length - 1].ball.color;
      matched = ball.color === COLOR_ANY || bc === COLOR_ANY || ball.color === bc;
    }
    const rec = this._newRecord(ball);
    this.balls.push(rec);
    rec.inserted = this.checkOnExplosion(this.balls.length - 1);
    rec.edge = pos + r;
    this.firstEdge = pos - r;
    this.recalcSizes();
    this.recalcPositions();
    this.processTunnels();
    return matched;
  }
  // RunTimeAddBallMiddle; возвращает fColorMatched
  addRuntime(ball) {
    const nextTunnelOffset = DIAM;
    const pos = ball.covered;
    let lastInTunnel = true;
    let i = 0;
    for (; i < this.balls.length; i++) {
      const b = this.balls[i].ball;
      const inTunnel = b.state === BALL.IN_TUNNEL;
      const toTunnel = b.nextTunnel - b.covered;
      const justBefore = toTunnel < nextTunnelOffset && toTunnel > 0;
      if (pos > b.covered && (!inTunnel || !lastInTunnel) && !justBefore) break;
      lastInTunnel = inTunnel;
    }
    if (i === 0) return this.addFront(ball);
    if (i === this.balls.length) return this.addEnd(ball);
    const pc = this.balls[i - 1].ball.color;
    const nc = this.balls[i].ball.color;
    const c = ball.color;
    const matched = pc === COLOR_ANY || c === COLOR_ANY || nc === COLOR_ANY || c === pc || c === nc;
    ball.speed = 0;
    const rec = this._newRecord(ball);
    this.balls.splice(i, 0, rec);
    rec.inserted = this.checkOnExplosion(i);
    rec.edge = pos - trunc(ball.size / 2);
    this.recalcSizes();
    this.recalcPositions();
    this.processTunnels();
    return matched;
  }
  intersects(o) {
    return this.position() > o.end() && o.position() > this.end();
  }
  checkOnExplosion(idx) {
    let counter = 1;
    let color = this.balls[idx].ball.color;
    const joker = color === COLOR_ANY;
    let leftJoker = joker;
    let first = true;
    for (let j = idx - 1; j >= 0; j--) {
      const c = this.balls[j].ball.color;
      if (leftJoker && first) {
        color = c;
        first = false;
      }
      if (c === COLOR_ANY) leftJoker = true;
      if (color === c || c === COLOR_ANY) counter++;
      else break;
    }
    let rightJoker = joker;
    first = true;
    for (let j = idx + 1; j < this.balls.length; j++) {
      const c = this.balls[j].ball.color;
      if (rightJoker && first) {
        color = c;
        first = false;
      }
      if (c === COLOR_ANY) rightJoker = true;
      if (color === c || c === COLOR_ANY) counter++;
      else break;
    }
    return counter >= MIN_BALLS_TO_BLOW;
  }
  mergeTail(other) {
    if (other.speed <= 0 && this.speed >= 0) return false;
    this.firstEdge = other.firstEdge;
    this.firstEdgeVel = other.firstEdgeVel;
    this.speed = other.speed;
    this.state = other.state;
    const check = this.balls[this.balls.length - 1].ball.color === other.balls[0].ball.color;
    const last = this.balls.length - 1;
    this.balls.push(...other.balls);
    other.balls = [];
    if (check) {
      this.balls[last].inserted = this.checkOnExplosion(last);
      this.balls[last].countdown = this.game.data.common.explosionCountdown;
    }
    this.recalcSizes();
    this.recalcPositions();
    this.processTunnels();
    return true;
  }
  explodePaintBlastWave(at, radius) {
    if (!this.balls.length) return null;
    const inside = (b) => b.state !== BALL.IN_TUNNEL && trunc(Math.hypot(b.pos.x - at.x, b.pos.y - at.y)) <= radius;
    let got = inside(this.balls[0].ball);
    let start = 0;
    let i = 0;
    for (; i < this.balls.length; i++) {
      const ex = inside(this.balls[i].ball);
      if (!ex) {
        if (got) return this.paintBlastExplode(start, i);
      } else if (!got) {
        got = true;
        start = i;
      }
    }
    if (got) return this.paintBlastExplode(start, i);
    return null;
  }
  explodeFirstSameColorSegment() {
    if (!this.balls.length) return null;
    const B = this.balls;
    let from = 0;
    let num = 1;
    let collision = B[0].canExplode();
    let color = B[0].ball.color;
    let i = 1;
    for (; i < B.length; i++) {
      const st = B[i].ball.state;
      const hidden = st === BALL.IN_TUNNEL || st === BALL.ROLL_IN;
      const c = B[i].ball.color;
      if (color === COLOR_ANY && !hidden) {
        color = c;
        num++;
        collision = collision || B[i].canExplode();
      } else if (c === color && !hidden) {
        num++;
        collision = collision || B[i].canExplode();
      } else if (c === COLOR_ANY && !hidden) {
        color = COLOR_ANY;
        num++;
        collision = collision || B[i].canExplode();
      } else {
        if (num >= MIN_BALLS_TO_BLOW && collision && this._hasColored(from, i)) return this.explodeBalls(from, i, num);
        num = 1;
        from = i;
        collision = B[i].canExplode();
        color = B[i].ball.color;
      }
    }
    if (num >= MIN_BALLS_TO_BLOW && collision && this._hasColored(from, i)) return this.explodeBalls(from, i, num);
    return null;
  }
  _hasColored(from, to) {
    for (let k = from; k < to; k++) if (this.balls[k].ball.color !== COLOR_ANY) return true;
    return false;
  }
  paintBlastExplode(from, to) {
    for (let k = from; k < to; k++) {
      this.balls[k].ball.state = BALL.EXPLODED;
      this._exploded(this.balls[k].ball, 1);
    }
    return this.tearOff(from, to);
  }
  explodeBalls(from, to, num) {
    for (let k = from; k < to; k++) this.balls[k].ball.state = BALL.EXPLODED;
    const mid = from + trunc((to - from) / 2);
    this._exploded(this.balls[mid].ball, num, to - from);
    return this.tearOff(from, to);
  }
  explodeBall(i) {
    this.balls[i].ball.state = BALL.EXPLODED;
    return this.tearOff(i, i + 1);
  }
  // ProcessTailTearOff
  tearOff(from, to) {
    let tail = null;
    const backSpeed = 50000;
    if (from !== 0 && to !== this.balls.length) {
      const same = this.balls[from - 1].ball.color === this.balls[to].ball.color;
      let ns = 0;
      if (this.speed > 0) {
        if (same) {
          ns = -backSpeed;
          this.game.emit({ type: 'slideBack' });
        }
      } else ns = this.speed;
      tail = this.tearOffTail(to);
      if (this.state === CHAIN.ROLL_IN) this.state = CHAIN.ON_BOARD;
      to = this.balls.length;
      tail.speed = this.speed;
      this.speed = ns;
    }
    if (from !== 0 && from !== this.balls.length) {
      this.firstEdge = this.balls[from].edge;
      this.firstEdgeVel = this.balls[from].edgeVel;
    }
    const removed = this.balls.splice(from, to - from);
    this.game.emit({ type: 'explode', balls: removed.map((r) => r.ball) });
    return tail;
  }
  setPosition(p) {
    for (const r of this.balls) {
      const rad = trunc(r.ball.size / 2);
      p -= rad;
      r.ball.covered = p;
      r.edge = p + rad;
      p -= rad;
    }
    this.recalcPositions();
    this.processTunnels();
    this.firstEdge = this.end();
  }
  updateSpeed(lastChain) {
    const len = this.path.traj.length;
    if (this.state === CHAIN.ROLL_IN && this.position() - this.length() < 0 && this.length() !== 0) {
      const mult = 3;
      let s = trunc((this.defSpeed * mult * this.position()) / this.length());
      s = Math.max(0, s);
      this.speed = this.defSpeed * (mult + 1) - s;
    } else if (this.position() > len) {
      this.state = CHAIN.ROLL_OUT;
      const mult = 6;
      const acc = 1000 * M;
      let s = trunc((this.defSpeed * mult * (this.position() - len)) / acc);
      s = Math.max(0, Math.min(s, this.defSpeed * mult));
      this.speed = this.defSpeed + s;
    } else if (this.state === CHAIN.ROLL_IN) {
      this.state = CHAIN.ON_BOARD;
      this.speed = this.defSpeed;
    }
    if (lastChain && this.speed <= 0) this.speed = this.defSpeed;
  }
  static stepVelocity(desired, dt, rec, key) {
    const mult = 50;
    const cur = rec[key];
    if (desired - cur > 0) {
      rec[key] = Math.min(cur + dt * mult, desired);
      return true;
    } else if (desired !== cur) {
      rec[key] = Math.max(cur - dt * mult, desired);
      return true;
    }
    return false;
  }
  moveByVelocity(dt) {
    if (!this.balls.length) return;
    let v = this.speed;
    if (v >= 0) {
      const back = this.balls[this.balls.length - 1].ball;
      const diff = back.covered - back.lastTunnel;
      const minV = diff > 0 && diff < DIAM * 2 ? this.defSpeed : 0;
      v = Math.max(v, minV);
    }
    BallChain.stepVelocity(trunc(this.speed < 0 ? v * 10 : v), dt, this, 'firstEdgeVel');
    this.firstEdge = trunc(this.firstEdge + this.firstEdgeVel * dt);
    for (let i = 0; i < this.balls.length; i++) {
      const r = this.balls[i];
      let desired = trunc(v);
      if (i === 0 && this.state === CHAIN.ROLL_OUT) desired *= 10;
      if (BallChain.stepVelocity(desired, dt, r, 'curVel')) r.ball.speed = trunc(r.curVel);
      r.edge = trunc(r.edge + r.curVel * dt);
    }
  }
  static calcOffset(start, end, dt, r) {
    const kc = 6.0e-6;
    const dumping = 0.0001;
    const cur = r.edge;
    const f = kc * (DIAM - (cur - start)) - kc * (DIAM - (end - cur));
    const acc = f * dt - dumping * r.edgeVel * dt;
    r.edgeVel += acc * dt;
    r.offset = r.edgeVel * dt;
  }
  static recalcPoint(prev, r) {
    let p = trunc(r.edge + r.offset);
    if (p > prev + RADIUS * 2.5) {
      p = trunc(prev + RADIUS * 2.5);
      r.edgeVel = 0;
    }
    if (p < prev + RADIUS * 1.5) {
      p = trunc(prev + RADIUS * 1.5);
      r.edgeVel = 0;
    }
    r.edge = p;
  }
  recalcSizes() {
    let last = this.firstEdge;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const r = this.balls[i];
      BallChain.recalcPoint(last, r);
      const size = r.edge - last;
      r.ball.size = size;
      r.ball.covered = last + trunc(size / 2);
      last = r.edge;
    }
  }
  moveAndResize(dt) {
    if (!this.balls.length) return;
    let last = this.firstEdge;
    for (let i = this.balls.length - 1; i > 0; i--) {
      const r = this.balls[i];
      const next = this.balls[i - 1].edge;
      const last2 = last;
      last = r.edge;
      BallChain.calcOffset(last2, next, dt, r);
    }
    const f = this.balls[0];
    BallChain.calcOffset(last, f.edge + DIAM, dt, f);
    this.recalcSizes();
  }
  move(dt) {
    if (!this.balls.length) return;
    this.moveByVelocity(dt);
    const step = 20;
    let i = step;
    for (; i < dt; i += step) this.moveAndResize(step);
    this.moveAndResize(dt - i);
    this.recalcPositions();
    this.processTunnels();
  }
  recalcPositions() {
    for (const r of this.balls) this.recalcBall(r.ball);
  }
  recalcBall(b) {
    const traj = this.path.traj;
    const p = b.covered;
    const t = traj.tangent(p);
    if (t.x || t.y) b.dir = t;
    if (p < 0) {
      b.pos = { x: p, y: 0 };
      b.state = BALL.ROLL_IN;
      return;
    }
    const c = traj.coords(p);
    if (!c) {
      b.pos = { x: traj.length - p, y: 0 };
      b.state = BALL.ROLL_OUT;
      return;
    }
    b.pos = c;
    if (b.state !== BALL.IN_TUNNEL) b.state = BALL.ON_BOARD;
  }
  // SendChainElementExplodedNotification
  _exploded(ball, num) {
    this.game.falling.dropCoin(ball.pos);
    this.game.addGold(this.game.levelStats.ballExplosionNafta * num);
    this.game.paint.onPaintFlow(ball.pos, ball.color, num);
  }
  backwardTearOffTunnel() {
    if (!this.balls.length || this.speed >= 0) return null;
    if (this.balls[this.balls.length - 1].ball.state === BALL.IN_TUNNEL) {
      this.speed = 0;
      return null;
    }
    for (let i = this.balls.length - 1; i >= 0; i--) {
      if (this.balls[i].ball.state === BALL.IN_TUNNEL) {
        const tail = this.tearOffTail(i + 1);
        tail.speed = this.speed;
        this.speed = 0;
        this.firstEdge = tail.balls[0].edge;
        this.firstEdgeVel = tail.balls[0].edgeVel;
        this.recalcSizes();
        this.recalcPositions();
        this.processTunnels();
        tail.recalcSizes();
        tail.recalcPositions();
        tail.processTunnels();
        return tail;
      }
    }
    return null;
  }
}

class ChainGenerator {
  constructor(seed) {
    this.rng = new Rng(seed);
    this.chain = [];
  }
  chooseColors(stats) {
    let last = -1;
    let color = last;
    const use = new Array(NUM_COLORS).fill(0);
    let used = 0;
    let n = 0;
    this.usedColors = [];
    this.paintColors = [];
    for (let i = 0; i < NUM_COLORS; i++) {
      if (stats.remainColorCapacity[i] > 0) {
        this.usedColors[n] = i;
        this.paintColors[n] = i;
        n++;
        use[i]++;
      }
    }
    this.numPaintColors = n;
    const numColors = stats.allPaintColors.length;
    for (; n < NUM_COLORS; n++) {
      for (let k = 0; k < RANDOM_RETRIES; k++) {
        color = stats.allPaintColors[this.rng.int(0, numColors - 1)];
        if (color !== last && use[color] * numColors <= used) break;
      }
      used++;
      use[color]++;
      last = color;
      this.usedColors[n] = color;
    }
    for (let i = 0; i < stats.remainColorsToPaint; i++) {
      const j = this.rng.int(0, stats.remainColorsToPaint - 1);
      [this.usedColors[i], this.usedColors[j]] = [this.usedColors[j], this.usedColors[i]];
    }
  }
  oneColorChunks(p) {
    let last = -1;
    let color = last;
    this.generated = 0;
    const use = new Array(NUM_COLORS).fill(0);
    let used = 0;
    let avail = this.paintColors;
    let numAvail = this.numPaintColors;
    while (this.generated < p.numBallsInChain) {
      let len = this.rng.int(p.minSameColorChain, p.maxSameColorChain);
      len = Math.min(len, p.numBallsInChain - this.generated);
      len = Math.max(len, p.minSameColorChain);
      for (let k = 0; k < RANDOM_RETRIES; k++) {
        color = avail[this.rng.int(0, numAvail - 1)];
        if (color !== last && use[color] * this.numBallColors <= used) break;
      }
      used++;
      use[color]++;
      last = color;
      for (let i = 0; i < len; i++) this.chain[this.generated + i] = color;
      this.generated += len;
      avail = this.usedColors;
      numAvail = this.numBallColors;
    }
  }
  rearrange(p) {
    const n = this.generated;
    if (n < 2) return;
    for (let b = 1; b < n - 1; b++) {
      if (this.rng.int(1, 100) <= p.colorsDistortionPercentage) continue;
      for (let k = 0; k < RANDOM_RETRIES; k++) {
        const s = this.rng.int(1, n - 2);
        if (b !== s) {
          [this.chain[s], this.chain[b]] = [this.chain[b], this.chain[s]];
          break;
        }
      }
    }
  }
  generate(chain, params, paint) {
    const stats = paint.statistics();
    if (stats.remainPaintCapacity <= 0) return false;
    this.generated = 0;
    this.numBallColors = Math.max(stats.remainColorsToPaint, 3);
    this.chooseColors(stats);
    this.oneColorChunks(params);
    this.rearrange(params);
    for (let i = 0; i < this.generated; i++) {
      const b = new Ball(BALL_TYPE.SIMPLE, { x: 0, y: 0 }, this.chain[i]);
      b.state = BALL.ROLL_IN;
      chain.addInit(b);
    }
    return true;
  }
}

// LuxGameBoardChain — цепочки одного пути
class BoardChain {
  constructor(game, path) {
    this.game = game;
    this.path = path;
    this.chains = [];
    const d = game.data;
    this.newChainOffset = d.startPointOffset * M;
    this.killAfterEndOffset = d.killChainAfterOffset * M;
    let speed = trunc(path.traj.length / d.common.chainTravelTime);
    speed = trunc((speed * path.chainsData.speedMultiplier) / 100);
    this.defaultSpeed = speed;
    this.chainSpeed = speed;
    this.nextChainTimeLeft = path.chainsData.firstChainDelay;
  }
  anyMoving() {
    return this.chains.some((c) => c.state === CHAIN.ON_BOARD && c.speed !== 0);
  }
  setSpeed(s) {
    for (const c of this.chains) c.speed = s;
    this.chainSpeed = s;
  }
  addChain(c) {
    if (!c) return;
    this.chains.push(c);
    this.validate();
  }
  validate() {
    this.chains = this.chains.filter((c) => c.balls.length);
    this.chains.sort((a, b) => b.position() - a.position());
  }
  forceNew() {
    this.generateNew();
    this.nextChainTimeLeft = this.path.chainsData.nextChainDelay;
  }
  generateNewChains(dt) {
    this.nextChainTimeLeft -= dt;
    if (this.nextChainTimeLeft <= 0) {
      this.generateNew();
      this.nextChainTimeLeft = this.path.chainsData.nextChainDelay;
    }
  }
  removeSameColorSequences() {
    const C = this.chains;
    let i = 0;
    while (i < C.length) {
      let nc;
      while ((nc = C[i].explodeFirstSameColorSegment())) {
        C[i].processTunnels();
        const tt = C[i].backwardTearOffTunnel();
        if (tt) C.splice(++i, 0, tt);
        C.splice(++i, 0, nc);
      }
      if (!C[i].balls.length) {
        this.game.addGold(this.game.levelStats.chainKillNafta);
        this.game.emit({ type: 'chainDestroyed' });
        C.splice(i, 1);
      } else i++;
    }
  }
  processPaintBlast(at, radius) {
    const C = this.chains;
    let i = 0;
    while (i < C.length) {
      let nc;
      while ((nc = C[i].explodePaintBlastWave(at, radius))) C.splice(++i, 0, nc);
      if (!C[i].balls.length) C.splice(i, 1);
      else i++;
    }
  }
  destroyAll() {
    for (const c of this.chains) c.explodeChainBalls();
    this.chains = [];
  }
  generateNew() {
    const c = new BallChain(this.path, this.game);
    c.defSpeed = this.defaultSpeed;
    c.speed = this.chainSpeed;
    if (this.game.generator.generate(c, this.path.chainsData, this.game.paint)) {
      c.setPosition(this.newChainOffset);
      this.chains.push(c);
      this.game.emit({ type: 'chainGenerated', path: this.path.id });
    }
  }
  updateSpeeds() {
    const C = this.chains;
    if (!C.length) return;
    C[C.length - 1].updateSpeed(true);
    for (let i = C.length - 2; i >= 0; i--) C[i].updateSpeed(false);
  }
  move(dt) {
    for (const c of this.chains) c.move(dt);
  }
  cleanUp() {
    this.chains = this.chains.filter((c) => c.balls.length);
  }
  mergeIntersecting() {
    const C = this.chains;
    if (C.length < 2) return;
    let prev = 0;
    let cur = 1;
    while (cur < C.length) {
      if (C[cur].intersects(C[prev])) {
        this.game.emit({ type: 'chainMerged' });
        if (C[prev].mergeTail(C[cur])) C.splice(cur, 1);
        else prev = cur++;
      } else prev = cur++;
    }
  }
  removeCameToEnd(afterExit) {
    const C = this.chains;
    for (let i = 0; i < C.length;) {
      if (!C[i].balls.length) {
        C.splice(i, 1);
        continue;
      }
      const tail = C[i].position() - C[i].length() - this.killAfterEndOffset;
      if (tail > this.path.traj.length + afterExit * M) {
        for (const r of C[i].balls) this.game.emit({ type: 'rolledOut', ball: r.ball });
        C.splice(i, 1);
      } else i++;
    }
  }
  sortAll() {
    for (const c of this.chains) c.sortChain();
  }
  reachedEnd(endOffset) {
    if (!this.chains.length) return false;
    return this.path.traj.length + endOffset < this.chains[0].position();
  }
  forAllBalls(fn) {
    for (const c of this.chains) for (const r of c.balls) fn(r.ball, c);
  }
}

// PaintLogic + CPaintFragment + CPainterPoint
class PaintLogic {
  constructor(game, fragments) {
    this.game = game;
    this.fragments = fragments.map((f) => ({
      id: f.id,
      color: COLOR[f.color],
      points: f.points.map((p) => ({
        coord: { x: p.pos[0] * M, y: p.pos[1] * M },
        capacity: p.capacity,
        amount: 0,
        color: COLOR[p.color],
        mode: POINT_MODE.NONE,
      })),
    }));
    this.complete = false;
  }
  static hasRoom(p) {
    return p.amount < p.capacity;
  }
  points() {
    return this.fragments.flatMap((f) => f.points);
  }
  fillRatio() {
    let a = 0;
    let c = 0;
    for (const p of this.points()) {
      a += p.amount;
      c += p.capacity;
    }
    return c ? a / c : 0;
  }
  static closestPoint(points, at, notFilledOnly, color, ignoreMagnet) {
    let best = null;
    let bestD = 0;
    for (const p of points) {
      if (!ignoreMagnet && p.mode === POINT_MODE.MAGNET_INSTALLED) continue;
      if (notFilledOnly && !PaintLogic.hasRoom(p)) continue;
      if (color !== COLOR_ANY && p.color !== color) continue;
      const d = dist(at, p.coord);
      if (best && d > bestD) continue;
      bestD = d;
      best = p;
    }
    return best ? { point: best, dist: bestD } : null;
  }
  onPaintFlow(at, color, amount) {
    if (this.complete) {
      this.game.boosts.onUnusedPaint(at, color, amount);
      return;
    }
    let best = null;
    for (const f of this.fragments) {
      const r = PaintLogic.closestPoint(f.points, at, true, color, true);
      if (r && (!best || r.dist < best.dist)) best = { ...r, frag: f };
    }
    if (best) {
      this._inc(best.point, amount);
      this.game.emit({ type: 'paintFlow', from: { ...at }, point: best.point, color, frag: best.frag });
    } else this.game.boosts.onUnusedPaint(at, color, amount);
  }
  _inc(p, v) {
    p.amount = Math.min(p.amount + v, p.capacity);
    if (!PaintLogic.hasRoom(p)) this.game.addGold(this.game.levelStats.paintFragmentFinishedNafta);
  }
  fillMostWanted(amount) {
    if (this.complete || amount <= 0) return null;
    let best = null;
    let bestRoom = 0;
    for (const f of this.fragments) {
      let fb = null;
      let fr = 0;
      for (const p of f.points) {
        const room = p.capacity - p.amount;
        if (!fb || room > fr) {
          fb = p;
          fr = room;
        }
      }
      if (fb && (!best || fr > bestRoom)) {
        best = fb;
        bestRoom = fr;
      }
    }
    if (best && bestRoom > 0) {
      this._inc(best, amount);
      return best;
    }
    return null;
  }
  checkPainted() {
    return this.points().every((p) => !PaintLogic.hasRoom(p));
  }
  step() {
    const g = this.game;
    if (g.state !== BOARD.LEVEL_RUN) return;
    if (!this.complete && this.checkPainted()) {
      g.setState(BOARD.LEVEL_WON);
      this.complete = true;
    }
  }
  statistics() {
    const s = { remainPaintCapacity: 0, remainColorsToPaint: 0, remainColorCapacity: new Array(NUM_COLORS).fill(0), allPaintColors: [] };
    for (let c = 0; c < NUM_COLORS; c++) {
      if (this.fragments.some((f) => f.points.some((p) => p.color === c))) s.allPaintColors.push(c);
    }
    for (let c = 0; c < NUM_COLORS; c++) {
      let present = false;
      for (const f of this.fragments) {
        let cap = 0;
        let am = 0;
        for (const p of f.points) {
          if (p.color === c) {
            cap += p.capacity;
            am += p.amount;
          }
        }
        const remain = Math.max(0, cap - am);
        if (remain > 0) {
          s.remainPaintCapacity += remain;
          s.remainColorCapacity[c] += remain;
          present = true;
        }
      }
      if (present) s.remainColorsToPaint++;
    }
    return s;
  }
}

// LuxPlatform + LuxPlatformBoard
class Platform {
  constructor(game, triple) {
    this.game = game;
    this.rng = new Rng(game.seed);
    this.balls = new Array(triple ? 3 : 2).fill(null);
    this.pos = { x: FIELD_L / 2, y: FIELD_L / 2 };
    this.lastColor = 0;
    this.lastColorRepeat = 0;
    this.collision = null;
    this.shouldGenerate = true;
    this.createBullet = false;
    this.waitCreation = false;
    this.pauseTime = game.data.common.ballFireInterval * 1000;
    this.curPause = 0;
    this.leftClicks = 0;
    this.rightClicks = 0;
  }
  bullet() {
    return this.balls[0];
  }
  setPos(p) {
    this.pos = { x: p.x, y: p.y };
    const y = p.y + FIELD_L / 2;
    const s = DIAM;
    const B = this.balls;
    if (B.length === 2) {
      if (B[0]) B[0].pos = { x: p.x, y: y + s };
      if (B[1]) B[1].pos = { x: p.x, y: y + 2 * s };
    } else {
      if (B[0]) B[0].pos = { x: p.x, y: y + 1.3 * s };
      if (B[1]) B[1].pos = { x: p.x + 0.55 * s, y: y + 2.25 * s };
      if (B[2]) B[2].pos = { x: p.x - 0.55 * s, y: y + 2.25 * s };
    }
  }
  createBall(i, color, type) {
    const b = new Ball(type, this.pos, color);
    b.speed = this.game.data.common.ballVelocities.bulletVelocity;
    b.dir = { x: 0, y: -M };
    b.state = BALL.ON_PLATFORM;
    this.balls[i] = b;
    this.setPos(this.pos);
    return b;
  }
  initialCreate() {
    let next = COLOR_ANY;
    for (let i = 0; i < this.balls.length; i++) {
      next = this.nextColor(next);
      this.createBall(i, next, BALL_TYPE.SIMPLE);
    }
  }
  updateBalls(force) {
    let changed = false;
    let next = COLOR_ANY;
    const w = this.colorWeights();
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (!b) continue;
      if (b.color !== COLOR_ANY && !w.has(b.color)) {
        next = this.nextColor(next);
        this.createBall(i, next, BALL_TYPE.SIMPLE);
        changed = true;
      }
    }
    if (!force) return changed;
    for (let i = 1; i < this.balls.length; i++) {
      if (this.balls[i - 1] && this.balls[i - 1].color === COLOR_ANY) continue;
      this.balls[i - 1] = this.balls[i];
    }
    next = this.nextColor(next);
    this.createBall(this.balls.length - 1, next, BALL_TYPE.SIMPLE);
    return true;
  }
  swap() {
    const f = this.balls[0];
    for (let i = 1; i < this.balls.length; i++) this.balls[i - 1] = this.balls[i];
    this.balls[this.balls.length - 1] = f;
    this.setPos(this.pos);
  }
  fire() {
    const b = this.balls[0];
    this.balls[0] = null;
    if (b) b.state = BALL.FIRED;
    return b;
  }
  // CollectColorWeights: Map отсортирован по цвету, как nstl::map
  colorWeights() {
    const power = this.game.data.common.platformGeneratorParams.colorWeightsPower;
    const w = new Map();
    for (const bc of this.game.boardChains) {
      const L = bc.path.traj.length;
      bc.forAllBalls((b) => {
        let e = w.get(b.color);
        if (!e) w.set(b.color, (e = { count: 0, weight: 0 }));
        e.count++;
        const r = b.covered / L;
        e.weight += Math.max(Math.sign(r) * Math.pow(r, power), 0.00000001);
      });
    }
    return new Map([...w.entries()].sort((a, b) => a[0] - b[0]));
  }
  nextColor(except) {
    const w = this.colorWeights();
    const low = this.game.data.common.platformGeneratorParams.lowActChance;
    if (this.rng.float(0, 1) <= low) return this.byWeight(except, w);
    return this.lowAct(w);
  }
  lowAct(w) {
    if (!w.size) return COLOR.white;
    const keys = [...w.keys()];
    let c = COLOR_ANY;
    for (let i = 0, guard = 0; i < 20 && guard < 200; i++, guard++) {
      c = keys[this.rng.int(0, keys.length - 1)];
      if (c === COLOR_ANY) {
        i--;
        continue;
      }
      if (c !== this.lastColor) {
        this.lastColor = c;
        this.lastColorRepeat = 1;
        break;
      } else if (this.lastColorRepeat < 2) {
        this.lastColorRepeat++;
        break;
      }
    }
    return c;
  }
  byWeight(except, w) {
    if (!w.size) return COLOR.white;
    let maxW = w.values().next().value.weight;
    let color = 0;
    let noStrong = true;
    for (const [c, e] of w) {
      const overrun = this.lastColor === c && this.lastColorRepeat >= 2;
      const strong = !overrun && e.weight > 0 && except !== c;
      if (!noStrong && !strong) continue;
      if ((noStrong && strong) || e.weight >= maxW) {
        maxW = e.weight;
        color = c;
      }
      noStrong = noStrong && !strong;
    }
    if (color === this.lastColor) this.lastColorRepeat++;
    else {
      this.lastColor = color;
      this.lastColorRepeat = 1;
    }
    return color;
  }
  input(x, left, right) {
    this.setPos({ x: clamp(trunc(x), BORDER_WIDTH_OFFSET, FIELD_L - BORDER_WIDTH_OFFSET), y: this.pos.y });
    if (this.game.state !== BOARD.LEVEL_RUN) return;
    if (left) this.leftClicks++;
    if (right) this.rightClicks++;
  }
  processClicks() {
    if (this.leftClicks > 0) {
      const b = this.fire();
      if (b) {
        this.game.bullets.push(b);
        this.game.emit({ type: 'fired', ball: b });
        this.waitCreation = true;
        this.curPause = 0;
      }
      this.leftClicks--;
    }
    if (this.rightClicks > 0) {
      if (this.bullet()) {
        this.swap();
        this.game.emit({ type: 'swap' });
      }
      this.rightClicks--;
    }
  }
  step(dt) {
    if (this.game.state !== BOARD.LEVEL_RUN) return;
    this.processClicks();
    if (this.waitCreation) {
      this.curPause += dt;
      if (this.curPause >= this.pauseTime) {
        this.createBullet = true;
        this.waitCreation = false;
      }
    }
    if (this.shouldGenerate) {
      this.initialCreate();
      this.shouldGenerate = false;
    } else if (this.updateBalls(this.createBullet)) this.createBullet = false;
  }
}

// LuxFallingBoard + CLuxFallingObject (монетки-кристаллы)
class FallingBoard {
  constructor(game) {
    this.game = game;
    this.coin = game.data.common.coin;
    this.rng = new Rng(game.seed + 17);
    this.objects = [];
    this.platformPos = { x: 0, y: 0 };
    this.prevPlatformPos = { x: 0, y: 0 };
  }
  dropCoin(from) {
    if (this.rng.int(0, 100) > this.coin.fallingPercentage) return;
    if (this.game.state !== BOARD.LEVEL_RUN) return;
    const to = { x: this.rng.float(0, FIELD_L), y: FIELD_L * 1.2 };
    const up = DIAM * this.coin.jumpSpeed;
    const g = DIAM * this.coin.gravity;
    const o = { id: ++ballIds, pos: { x: from.x, y: from.y }, vel: { x: 0, y: -up }, acc: { x: 0, y: g }, picked: false, time: 0 };
    const s = to.y - from.y;
    const D = up * up + 2 * g * s;
    if (D > 1e-3) {
      const t0 = (up + Math.sqrt(D)) / g;
      const t1 = (up - Math.sqrt(D)) / g;
      let t = 0;
      if (t0 > 0 && t1 > 0) t = Math.min(t0, t1);
      else if (t0 > 0) t = t0;
      else if (t1 > 0) t = t1;
      if (t >= 1e-3) o.vel.x = (to.x - from.x) / t;
    }
    this.objects.push(o);
    this.game.emit({ type: 'coinDropped', obj: o });
  }
  valid(o) {
    return o.pos.x >= 0 && o.pos.x <= FIELD_L && o.pos.y >= -FIELD_L && o.pos.y <= FIELD_L;
  }
  step(dt) {
    this.prevPlatformPos = this.platformPos;
    this.platformPos = { ...this.game.platform.pos };
    this.objects = this.objects.filter((o) => this.valid(o) && !o.picked);
    const t = dt * 1e-3;
    for (const o of this.objects) {
      o.time += dt;
      o.vel.x += trunc(0.5 + t * o.acc.x);
      o.vel.y += trunc(0.5 + t * o.acc.y);
      o.pos.x += trunc(0.5 + t * o.vel.x);
      o.pos.y += trunc(0.5 + t * o.vel.y);
    }
    const radius = DIAM * this.coin.catchRadius;
    const px = (this.platformPos.x + this.prevPlatformPos.x) / 2;
    for (const o of this.objects) {
      if (Math.hypot(o.pos.x - px, o.pos.y - FIELD_L) < radius) {
        this.game.addGold(this.game.data.priestessStats.coinNafta);
        o.picked = true;
        this.game.emit({ type: 'coinPicked', obj: o });
      }
    }
  }
}

// LuxBoost и наследники
class Boost {
  constructor(game, type, base) {
    this.game = game;
    this.type = type;
    this.name = base.name;
    this.price = base.price;
    this.cooldown = base.cooldown * 1000;
    this.cooling = false;
    this.cooldownCur = 0;
    this.waiting = false;
  }
  fire() {
    if (this.cooling) return;
    const r = this.vFire();
    if (r === 'activated') {
      this.waiting = true;
      this.complete();
    } else if (r === 'waiting') this.waiting = true;
  }
  complete() {
    if (!this.waiting) return;
    this.waiting = false;
    this.cooling = true;
    this.cooldownCur = 0;
    this.game.addGold(-this.price);
  }
  step(dt) {
    if (this.cooling && this.cooldown > 0 && dt > 0) {
      this.cooldownCur += dt;
      if (this.cooldownCur >= this.cooldown) {
        this.cooldownCur = 0;
        this.cooling = false;
      }
    }
    this.vStep(dt);
  }
  progress() {
    return this.cooling ? this.cooldownCur / this.cooldown : 0;
  }
  vFire() {}
  vStep() {}
  input() {
    return false;
  }
  abort() {}
  onUnusedPaint() {}
}
class FreezeBoost extends Boost {
  constructor(game, d) {
    super(game, BOOST.FREEZE, d.boostBase);
    this.freezeTime = d.seconds * 1000;
    this.fired = false;
  }
  vFire() {
    this.t = 0;
    this.fired = true;
    this.game.frozen = true;
    this.game.emit({ type: 'freeze', on: true });
    return 'activated';
  }
  vStep(dt) {
    if (!this.fired) return;
    this.t += dt;
    if (this.t >= this.freezeTime) {
      this.fired = false;
      this.game.frozen = false;
      this.game.emit({ type: 'freeze', on: false });
    }
  }
}
class BallBoost extends Boost {
  constructor(game, type, d, ballType) {
    super(game, type, d.boostBase);
    this.ballType = ballType;
  }
  vFire() {
    this.ball = this.game.platform.createBall(0, COLOR_ANY, this.ballType);
    this.game.emit({ type: 'specialBall', ball: this.ball });
    return 'waiting';
  }
  vStep() {
    if (this.ball && this.ball.state !== BALL.ON_PLATFORM) {
      this.complete();
      this.ball = null;
    }
  }
}
class SorterBoost extends Boost {
  constructor(game, d) {
    super(game, BOOST.SORTER, d.boostBase);
  }
  vFire() {
    this.game.emit({ type: 'sorter' });
    for (const bc of this.game.boardChains) bc.sortAll();
    return 'activated';
  }
}
class AlchemistBoost extends Boost {
  constructor(game, d) {
    super(game, BOOST.ALCHEMIST, d.boostBase);
    this.time = d.alchemistDuration;
    this.left = 0;
    this.unused = 0;
    this.additional = d.additionalPaint;
    this.mult = d.paintMult;
    this.active = false;
  }
  onUnusedPaint(at, color, n) {
    this.unused += n;
    if (this.active) this.game.emit({ type: 'alchemistIn', from: { ...at }, color });
  }
  vFire() {
    this.active = true;
    this.left = this.time;
    this.unused = 0;
    return 'activated';
  }
  vStep(dt) {
    if (!this.active) return;
    this.left -= dt;
    if (this.left < 0) {
      const fill = this.additional + Math.floor(this.unused * this.mult);
      if (fill <= 0) return;
      const p = this.game.paint.fillMostWanted(fill);
      if (p) this.game.emit({ type: 'alchemistOut', point: p });
      this.active = false;
      this.left = 0;
    }
  }
  abort() {
    this.active = false;
  }
}
// LuxMagnet — коллайдер на точке картины, «съедает» шары своего цвета в радиусе R1
class Magnet {
  constructor(boost, d) {
    this.boost = boost;
    this.scanTime = d.searchSeconds;
    this.r1 = d.radiusR1 * M;
    this.r2 = d.radiusR2 * M;
    this.numToEat = d.numBallToEat;
    this.eaten = 0;
    this.killed = false;
    this.done = false;
    this.timer = 0;
    this.point = null;
    this.size = DIAM;
    this.speed = 0;
    this.dir = { x: 0, y: -1 };
  }
  get pos() {
    return this.point ? this.point.coord : { x: 0, y: 0 };
  }
  velocity() {
    return { dx: 0, dy: -1, vx: 0, vy: 0 };
  }
  exhausted() {
    return this.killed || this.done || this.numToEat - this.eaten <= 0;
  }
  hit() {
    if (this.point) this.point.mode = POINT_MODE.NONE;
    this.killed = true;
    return true;
  }
  finish() {
    this.point.mode = POINT_MODE.NONE;
    this.done = true;
  }
  step(dt, game) {
    if (!this.point) return;
    if (!PaintLogic.hasRoom(this.point)) return this.finish();
    if (this.timer < this.scanTime * 1000) {
      this.operate(game);
      if (this.exhausted() || !PaintLogic.hasRoom(this.point)) return this.finish();
      this.timer = this.scanTime * 1000;
      return;
    }
    this.timer -= dt;
  }
  operate(game) {
    let best = null;
    for (const bc of game.boardChains) {
      for (const c of bc.chains) {
        for (const r of c.balls) {
          const b = r.ball;
          if (b.state === BALL.IN_TUNNEL || b.color !== this.point.color) continue;
          const d = dist(this.pos, b.pos);
          if (d <= this.r2 && (!best || d < best.d)) best = { d, b, c, bc };
        }
      }
    }
    if (best && best.d <= this.r1) {
      this.point.amount = Math.min(this.point.amount + 1, this.point.capacity);
      game.emit({ type: 'paintFlow', from: { ...best.b.pos }, point: this.point, color: best.b.color, magnet: true });
      const r = best.c.explodeBallAtPos(best.b.covered);
      if (r.found) {
        if (r.tail) best.bc.addChain(r.tail);
        else best.bc.validate();
      }
    }
  }
}
class MagnetBoost extends Boost {
  constructor(game, d) {
    super(game, BOOST.MAGNET, d.boostBase);
    this.d = d;
    this.state = 'none';
    this.installed = [];
    this.userPos = { x: FIELD_L / 2, y: FIELD_L / 2 };
  }
  vFire() {
    this.state = 'started';
    this.closest = null;
    this.newMagnet = new Magnet(this, this.d);
    this.game.colliders.push(this.newMagnet);
    return 'waiting';
  }
  highlight(on) {
    for (const p of this.game.paint.points()) {
      if (p.mode !== POINT_MODE.MAGNET_INSTALLED) p.mode = on ? POINT_MODE.MAGNET_HIGHLIGHT : POINT_MODE.NONE;
    }
  }
  vStep(dt) {
    for (const m of this.installed) m.step(dt, this.game);
    this.installed = this.installed.filter((m) => !m.exhausted());
    if (this.state === 'started') {
      if (!this.game.paint.points().length) this.state = 'none';
      else {
        this.highlight(true);
        this.state = 'waiting';
      }
    } else if (this.state === 'waiting') {
      const r = PaintLogic.closestPoint(this.game.paint.points(), this.userPos, true, COLOR_ANY, false);
      this.closest = r && r.point;
      if (!this.closest) {
        this.highlight(false);
        this.state = 'none';
        return;
      }
      this.highlight(true);
      this.closest.mode = POINT_MODE.MAGNET_PRESELECT;
      this.newMagnet.point = this.closest;
    } else if (this.state === 'placed') {
      if (!this.closest) {
        this.highlight(false);
        this.state = 'none';
        return;
      }
      this.complete();
      this.installed.push(this.newMagnet);
      this.newMagnet = null;
      this.highlight(false);
      this.closest.mode = POINT_MODE.MAGNET_INSTALLED;
      this.state = 'none';
      this.game.emit({ type: 'magnetInstalled' });
    }
  }
  input(x, y, left) {
    if (this.state !== 'waiting') return false;
    this.userPos = { x: clamp(x, 0, FIELD_L), y: clamp(y, 0, FIELD_L) };
    if (left && this.closest) this.state = 'placed';
    return true;
  }
  abort() {
    if (this.state !== 'none') {
      this.highlight(false);
      this.state = 'none';
    }
  }
}

export function createBoost(game, type) {
  const b = game.data.boosts;
  switch (type) {
    case BOOST.PAINTBLAST:
      return new BallBoost(game, type, b.paintblast, BALL_TYPE.PAINTBLAST);
    case BOOST.FREEZE:
      return new FreezeBoost(game, b.freeze);
    case BOOST.JOKER:
      return new BallBoost(game, type, b.joker, BALL_TYPE.JOKER);
    case BOOST.SORTER:
      return new SorterBoost(game, b.sorter);
    case BOOST.MAGNET:
      return new MagnetBoost(game, b.magnet);
    case BOOST.ALCHEMIST:
      return new AlchemistBoost(game, b.alchemist);
  }
  return null;
}

class BoostBoard {
  constructor(game, types) {
    this.game = game;
    this.boosts = types.map((t) => createBoost(game, t)).filter(Boolean);
  }
  step(dt) {
    if (this.game.state !== BOARD.LEVEL_RUN) {
      for (const b of this.boosts) b.abort();
      return;
    }
    for (const b of this.boosts) b.step(dt);
  }
  onUnusedPaint(at, color, n) {
    for (const b of this.boosts) b.onUnusedPaint(at, color, n);
  }
  get(type) {
    return this.boosts.find((b) => b.type === type);
  }
  waiting() {
    return this.boosts.some((b) => b.waiting);
  }
  canFire(b) {
    return this.game.state === BOARD.LEVEL_RUN && b && !b.cooling && this.game.gold >= b.price && !this.waiting();
  }
  fire(type) {
    const b = this.get(type);
    if (this.canFire(b)) b.fire();
  }
  input(x, y, left) {
    return this.boosts.some((b) => b.input(x, y, left));
  }
}

// LuxGameLogic + LuxGameBoard + EaselWorld: один уровень
export class EaselGame {
  // opts: {data, track, level, picture, seed, triple, boosts: [типы], gold}
  constructor(opts) {
    this.data = opts.data;
    this.level = opts.level || 0;
    this.seed = opts.seed >>> 0 || 1;
    this.events = [];
    this.gold = opts.gold || 0;
    this.goldEarned = 0;
    this.elapsed = 0;
    this.state = BOARD.NONE;
    this.waitTimer = 0;
    this.frozen = false;
    this.bullets = [];
    this.colliders = [];
    this.levelStats = this.data.priestessStats.stats[this.level];
    const track = this.data.tracks[opts.track];
    this.track = track;
    this.paths = track.paths.map((p, i) => ({
      id: i,
      desc: p,
      traj: new LogicTrajectory(p.degree, p.points),
      tunnels: p.tunnels || [],
      chainsData: p.chains[this.level],
    }));
    this.pictureIndex = opts.picture;
    this.paint = new PaintLogic(this, this.data.pictures[opts.picture].levels[this.level]);
    this.generator = new ChainGenerator(this.seed);
    this.platform = new Platform(this, !!opts.triple);
    this.boardChains = this.paths.map((p) => new BoardChain(this, p));
    this.boosts = new BoostBoard(this, opts.boosts || []);
    this.falling = new FallingBoard(this);
    this.medal = null;
  }
  emit(e) {
    this.events.push(e);
  }
  addGold(v) {
    if (!v) return;
    this.gold += v;
    if (v > 0) this.goldEarned += v;
  }
  start() {
    this.setState(BOARD.LEVEL_BEGIN);
  }
  skipIntro() {
    if (this.state === BOARD.LEVEL_BEGIN) this.setState(BOARD.LEVEL_RUN);
    else if (this.state === BOARD.WON_MOVIE) this.setState(BOARD.WON_FINAL);
  }
  setState(s) {
    const prev = this.state;
    if ((prev === BOARD.LEVEL_FAIL || prev === BOARD.FAIL_FINAL) && s === BOARD.LEVEL_WON) return;
    if (prev >= BOARD.LEVEL_WON && prev <= BOARD.WON_FINAL && s === BOARD.LEVEL_FAIL) return;
    if (prev === BOARD.NONE && s === BOARD.LEVEL_BEGIN) this.waitTimer = GAME_START_EFFECT_MS;
    if (prev === BOARD.LEVEL_RUN) {
      if (s === BOARD.LEVEL_FAIL) {
        for (const bc of this.boardChains) bc.setSpeed(SPLINE_FALLING_CHAIN_SPEED * M);
      } else if (s === BOARD.LEVEL_WON) {
        this.waitTimer = LEVEL_END_DELAY1;
        this._onWon();
      }
    }
    this.state = s;
    this.emit({ type: 'state', state: s, prev });
  }
  _onWon() {
    const st = this.levelStats;
    if (this.elapsed / 1000 <= st.goldMedalTime) {
      this.medal = 'gold';
      this.addGold(st.goldMedalNafta + Math.floor(Math.max(0, st.goldMedalTime - this.elapsed / 1000) * st.fastCompletePerSecondNafta));
    } else if (this.elapsed / 1000 <= st.silverMedalTime) {
      this.medal = 'silver';
      this.addGold(st.silverMedalNafta);
    }
    this.addGold(st.pictureEndNafta);
  }
  // Ввод: координаты мыши в единицах поля (0..10000), клики за шаг
  input(x, y, left, right) {
    const lx = x * M;
    const ly = y * M;
    if (!this.boosts.input(lx, ly, left)) {
      this.platform.input(lx, left, right);
      if (left || right) this.skipIntro();
    }
  }
  fireBoost(type) {
    this.boosts.fire(type);
  }
  step(dt = STEP_MS) {
    this.platform.step(dt);
    this.falling.step(dt);
    this._boardStep(dt);
    this.boosts.step(dt);
    this.paint.step();
    if (this.state === BOARD.LEVEL_RUN) this.elapsed += dt;
  }
  _boardStep(dt) {
    this.waitTimer -= dt;
    switch (this.state) {
      case BOARD.LEVEL_BEGIN:
        if (this.waitTimer <= 0) this.setState(BOARD.LEVEL_RUN);
        break;
      case BOARD.LEVEL_RUN:
        this._runStep(dt);
        break;
      case BOARD.LEVEL_WON:
        if (this.waitTimer <= 0) {
          for (const bc of this.boardChains) bc.destroyAll();
          this.waitTimer = LEVEL_END_DELAY2;
          this.setState(BOARD.WON_BLAST_BALLS);
        }
        break;
      case BOARD.WON_BLAST_BALLS:
        if (this.waitTimer <= 0) {
          this.waitTimer = GAME_WON_EFFECT_MS;
          this.setState(BOARD.WON_MOVIE);
        }
        break;
      case BOARD.WON_MOVIE:
        if (this.waitTimer <= 0) this.setState(BOARD.WON_FINAL);
        break;
      case BOARD.LEVEL_FAIL:
        this._failStep(dt);
        if (this.waitTimer <= 0) this.waitTimer = LEVEL_FAIL_END_DELAY;
        break;
    }
    this._moveBullets(dt);
  }
  _runStep(dt) {
    for (const bc of this.boardChains) {
      bc.cleanUp();
      bc.updateSpeeds();
      if (!this.frozen) bc.move(dt);
    }
    this._updatePointer();
    for (const bc of this.boardChains) {
      bc.mergeIntersecting();
      bc.removeCameToEnd(AFTER_EXIT_DISTANCE);
      bc.removeSameColorSequences();
    }
    this.bullets = this.bullets.filter((b) => !this._collide(b, dt));
    if (!this.frozen) for (const bc of this.boardChains) bc.generateNewChains(dt);
    if (!this.boardChains.some((bc) => bc.chains.length)) this.boardChains[0].forceNew();
    this._checkReachEnd();
    this.colliders = this.colliders.filter((c) => !c.exhausted());
  }
  _findCollision(bullet) {
    let best = null;
    for (const bc of this.boardChains) {
      for (const c of bc.chains) {
        for (const r of c.balls) {
          const b = r.ball;
          if (!b.canCollide()) continue;
          const t = bullet.collisionTime(b);
          if (t !== null && (!best || t < best.t)) best = { t, ball: b, chain: c, bc };
        }
      }
    }
    // CollideWithOthers: магнит перехватывает, только если столкновение с ним раньше любого шара
    let collider = null;
    let bound = best ? best.t : Infinity;
    for (const m of this.colliders) {
      if (m.exhausted()) continue;
      const t = bullet.collisionTime(m);
      if (t !== null && t < bound) {
        collider = { t, obj: m };
        bound = t;
      }
    }
    return { best, collider };
  }
  _collide(bullet, dt) {
    const { best, collider } = this._findCollision(bullet);
    if (collider && collider.t < dt) {
      if (collider.obj.hit()) {
        bullet.pos = bullet.collisionPoint(collider.t);
        bullet.state = BALL.EXPLODED;
        this.emit({ type: 'bulletHitMagnet', ball: bullet });
        return true;
      }
    }
    if (best && best.t < dt) {
      let matched = true;
      if (bullet.type === BALL_TYPE.PAINTBLAST) {
        bullet.state = BALL.EXPLODED;
        const at = bullet.collisionPoint(best.t);
        bullet.pos = at;
        this.emit({ type: 'paintBlast', at: { ...at } });
        for (const bc of this.boardChains) bc.processPaintBlast(at, 3 * DIAM);
      } else {
        const shift = bullet.insertionShift(best.ball, best.t) * DIAM * 0.5;
        bullet.covered = trunc(best.ball.covered + shift);
        matched = best.chain.addRuntime(bullet);
      }
      if (bullet.state === BALL.ON_BOARD) bullet.state = matched ? BALL.HIT_MATCH : BALL.HIT_MISSMATCH;
      this.emit({ type: 'hit', ball: bullet, matched });
      for (const bc of this.boardChains) bc.removeSameColorSequences();
      return true;
    }
    return false;
  }
  _updatePointer() {
    const p = this.platform;
    p.collision = null;
    const b = p.bullet();
    if (!b) return;
    const { best, collider } = this._findCollision(b);
    const hit = collider || best;
    if (hit) p.collision = b.collisionPoint(hit.t);
  }
  _failStep(dt) {
    let has = false;
    for (const bc of this.boardChains) {
      if (bc.chains.length) {
        if (!this.frozen) bc.move(dt);
        bc.removeCameToEnd(AFTER_EXIT_DISTANCE);
        has = true;
      }
    }
    if (!has) this.setState(BOARD.FAIL_FINAL);
  }
  _checkReachEnd() {
    if (this.state !== BOARD.LEVEL_RUN) return;
    for (const bc of this.boardChains) {
      if (bc.reachedEnd(AFTER_EXIT_DISTANCE * M)) {
        this.frozen = false;
        this.setState(BOARD.LEVEL_FAIL);
        return;
      }
    }
  }
  _moveBullets(dt) {
    this.bullets = this.bullets.filter((b) => {
      const d = dt * b.speed;
      if (b.pos.y === BORDER_HEIGHT_OFFSET) {
        b.state = BALL.MISSED;
        this.emit({ type: 'miss', ball: b });
        return false;
      }
      if (b.pos.y - d > BORDER_HEIGHT_OFFSET) b.pos = { x: b.pos.x, y: b.pos.y - d };
      else b.pos = { x: b.pos.x, y: BORDER_HEIGHT_OFFSET };
      return true;
    });
  }
  // Для отображения: все шары на поле
  forAllBalls(fn) {
    for (const bc of this.boardChains) bc.forAllBalls((b, c) => fn(b, bc.path, c));
  }
}

// Easel::SelectTrajectory — трасса по сложности уровня, реже использованные — чаще
export function selectTrajectory(data, level, useCount, lastTrajectory, rng, first) {
  if (first && level === 0) return data.firstLevelForceTrajectory;
  const diff = data.levels[level].difficulty;
  let min = Infinity;
  const cands = [];
  data.tracks.forEach((t, i) => {
    if (t.difficulty !== diff || i === lastTrajectory) return;
    const u = useCount[i] || 0;
    if (u < min) {
      min = u;
      cands.length = 0;
    }
    if (u === min) cands.push(i);
  });
  if (!cands.length) return data.tracks.findIndex((t) => t.difficulty === diff);
  const i = cands[rng.int(0, cands.length - 1)];
  useCount[i] = (useCount[i] || 0) + 1;
  return i;
}

// Проигрыватель эффектов PW (BasicEffect: дерево компонентов с TimeController, анимированными плейсментами,
// материалами BasicFX/ParticleFX и системами частиц .part). Данные — tools/pw-convert/build_easel_fx.py (content/easel/fx).
// Время узлов повторяет PF TimeController (задержка, смещение первого цикла, циклы, fadein/fadeout, Finish),
// частицы — ParticleFX (треки с линейной интерполяцией, двойной буфер при зацикливании).
import * as mat4 from '../glMatrix/mat4.js';
import * as quat from '../glMatrix/quat.js';
import { EASEL_BASE, fetchOk } from './easelRenderer.js';

const FX_BASE = EASEL_BASE + 'fx/';
const BLEND = { lerp: 0, add: 1, off: 2 };
const OPMODE = { simple: 0, blend: 1, add: 2 };
const V = 13; // float на вершину частицы: pos3 uv2 c0(4) c1(4)

function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

// Значение или анимация {k, v} (Clamp, линейно)
function sample(a, t, n, out) {
  if (typeof a === 'number') {
    out[0] = a;
    return out;
  }
  if (!a.k) {
    for (let i = 0; i < n; i++) out[i] = a[i];
    return out;
  }
  const k = a.k;
  const v = a.v;
  const last = k.length - 1;
  if (t <= k[0] || last === 0) {
    for (let i = 0; i < n; i++) out[i] = v[i];
  } else if (t >= k[last]) {
    for (let i = 0; i < n; i++) out[i] = v[last * n + i];
  } else {
    let j = 0;
    while (j < last - 1 && t >= k[j + 1]) j++;
    const d = k[j + 1] - k[j];
    const u = d > 0 ? (t - k[j]) / d : 0;
    for (let i = 0; i < n; i++) out[i] = v[j * n + i] + (v[(j + 1) * n + i] - v[j * n + i]) * u;
  }
  return out;
}
const s1 = new Float32Array(1);
const sampleNum = (a, t, def) => (a === undefined ? def : sample(a, t, 1, s1)[0]);

// Трек частицы в F с позиции o: [n, t0..tn-1, v(n·dim)]
function track(F, o, dim, t, out, step = false) {
  const n = F[o];
  const T = o + 1;
  const D = o + 1 + n;
  if (n <= 1 || t <= F[T]) {
    for (let i = 0; i < dim; i++) out[i] = F[D + i];
    return out;
  }
  if (t >= F[T + n - 1]) {
    for (let i = 0; i < dim; i++) out[i] = F[D + (n - 1) * dim + i];
    return out;
  }
  let j = 0;
  while (j < n - 2 && t >= F[T + j + 1]) j++;
  if (step) {
    out[0] = F[D + j];
    return out;
  }
  const d = F[T + j + 1] - F[T + j];
  const u = d > 0 ? (t - F[T + j]) / d : 0;
  for (let i = 0; i < dim; i++) out[i] = F[D + j * dim + i] + (F[D + (j + 1) * dim + i] - F[D + j * dim + i]) * u;
  return out;
}

// Плейсмент PW: pos, rot, scale; дочерний — parent.pos + parent.rot·(parent.scale ⊙ pos), rot = parent.rot·rot, scale ⊙
function compose(P, L, out) {
  const vx = P.s[0] * L.p[0];
  const vy = P.s[1] * L.p[1];
  const vz = P.s[2] * L.p[2];
  const [qx, qy, qz, qw] = P.r;
  // v' = v + w·t + q×t, t = 2·(q×v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out.p[0] = P.p[0] + vx + qw * tx + (qy * tz - qz * ty);
  out.p[1] = P.p[1] + vy + qw * ty + (qz * tx - qx * tz);
  out.p[2] = P.p[2] + vz + qw * tz + (qx * ty - qy * tx);
  quat.multiply(out.r, P.r, L.r);
  out.s[0] = P.s[0] * L.s[0];
  out.s[1] = P.s[1] * L.s[1];
  out.s[2] = P.s[2] * L.s[2];
  return out;
}
const newPl = () => ({ p: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] });

class FxNode {
  constructor(def, lib) {
    this.d = def;
    this.ch = (def.ch || []).map((c) => new FxNode(c, lib));
    this.sys = def.t === 'p' ? lib.parts[def.part] : null;
    this.local = newPl();
    this.wp = newPl();
    this.m = mat4.create();
    this.reinit();
  }

  reinit() {
    const tc = this.d.tc;
    this.on = true;
    this.dead = false;
    this.finishing = false;
    this.offset = 0;
    this.time = 0;
    if (tc) {
      this.cycles = tc.n > 0 ? tc.n - 1 : Infinity;
      if (tc.sd > 0) {
        this.on = false;
        this.time = -tc.sd;
      } else this.offset = tc.o + Math.random() * tc.od;
    }
    if (this.sys) {
      this.pt = [0, 0];
      this.second = false;
      this.last = 0;
    }
    for (const c of this.ch) c.reinit();
  }

  get alive() {
    return this.on && !this.dead;
  }

  // HasChildWithFadeOut: среди живых потомков есть узел с fadeout
  childFading() {
    for (const c of this.ch) {
      if (!c.alive) continue;
      if ((c.d.tc && c.d.tc.fo > 0) || c.childFading()) return true;
    }
    return false;
  }

  finish() {
    const tc = this.d.tc;
    this.cycles = 0;
    if (!(tc && tc.fo > 0) && !this.childFading()) this.dead = true;
    else this.finishing = true;
    for (const c of this.ch) c.finish();
  }

  // TimeController::Update; возвращает приращение времени для дочерних
  tick(adv) {
    const tc = this.d.tc;
    if (!tc) {
      this.time += adv;
      if (this.finishing && !this.childFading()) this.dead = true;
      return adv;
    }
    let delta = adv * tc.sp + this.offset;
    this.offset = 0;
    const old = this.time;
    this.time += delta;
    if (old < 0) {
      if (this.time >= 0) {
        this.on = true;
        const o = tc.o + Math.random() * tc.od;
        this.time += o;
        delta += o;
      } else return 0;
    }
    const cyc = tc.c > 0 ? tc.c : this.d.len - (tc.fi + tc.fo);
    if (cyc <= 0) return delta;
    if (this.time > tc.fi + cyc && this.cycles > 0) {
      const n = Math.floor((this.time - tc.fi) / cyc);
      const dec = cyc * n;
      let start = old - dec;
      if (start < 0) {
        delta += start;
        start = 0;
      }
      if (this.sys) this.looped(start);
      this.time -= dec;
      this.cycles = Math.max(0, this.cycles - n);
    }
    if (this.time > tc.fi + cyc + tc.fo && !this.childFading()) this.dead = true;
    return delta;
  }

  // ParticleFX::OnTimeLooped — незаконченный цикл доигрывает во втором канале
  looped(start) {
    if (this.pt[0] < this.sys.dur || this.second) {
      if (this.second) this.pt[0] = this.pt[1];
      this.second = true;
      this.pt[1] = start;
    } else this.pt[0] = start;
    this.last = start;
  }

  update(adv) {
    if (this.dead) return;
    if (!this.on && !(this.d.tc && this.time < 0)) return;
    const delta = this.tick(adv);
    if (!this.alive) return;
    if (this.sys) {
      const t = this.time;
      const dt = t - this.last;
      if (t >= 0 && dt >= 0.001) {
        const total = this.sys.dur;
        for (let i = 0; i < 2; i++) this.pt[i] = Math.min(total, this.pt[i] + dt);
        this.last = t;
      }
      const tc = this.d.tc;
      if ((!tc || tc.n === 1) && this.sys.dur + this.d.dfo <= t) this.on = false;
    }
    for (const c of this.ch) c.update(delta);
  }
}

// Длительность эффекта (сек) для deathType Anim: конец поддерева с учётом задержек и скоростей
function subtreeEnd(def, start = 0, rate = 1) {
  const tc = def.tc;
  let own = Infinity;
  let s = start;
  let r = rate;
  if (tc) {
    r = rate * tc.sp;
    s = start + Math.max(0, tc.sd - tc.o) / r;
    const cyc = tc.c > 0 ? tc.c : def.len - (tc.fi + tc.fo);
    if (cyc > 0) own = tc.n === 0 ? Infinity : s + (tc.fi + cyc * tc.n + tc.fo - tc.o) / r;
  } else if (def.t !== 'g') own = start + (def.len + (def.dfo || 0)) / rate;
  if (!def.ch) return own;
  let ch = 0;
  for (const c of def.ch) ch = Math.max(ch, subtreeEnd(c, s, r));
  return def.t === 'g' && !tc ? ch : Math.min(own, Math.max(ch, own === Infinity ? 0 : own));
}

export class FxInstance {
  constructor(lib, key, def, opts) {
    this.lib = lib;
    this.key = key;
    this.root = new FxNode(def.root, lib);
    this.life = def.death === 'Time' ? def.life : def.death === 'Anim' ? def.end : Infinity;
    this.time = 0;
    this.pl = newPl();
    this.colors = opts.colors || null; // {id: rgba}
    this.color = opts.color || null; // для всех узлов с id
    this.setPlacement(opts.pos, opts.rot, opts.scale);
    this.dead = false;
    this.visible = true;
  }

  setPlacement(pos, rot, scale) {
    if (pos) this.pl.p = [pos[0], pos[1], pos[2]];
    if (rot) this.pl.r = [rot[0], rot[1], rot[2], rot[3]];
    if (scale !== undefined) this.pl.s = typeof scale === 'number' ? [scale, scale, scale] : [scale[0], scale[1], scale[2]];
    return this;
  }

  // Die(): узлы без fadeout гаснут сразу, остальные доигрывают
  stop() {
    if (!this.stopped) this.root.finish();
    this.stopped = true;
  }

  kill() {
    this.dead = true;
  }

  colorFor(id) {
    if (!id) return null;
    if (this.colors) return this.colors[id] || null;
    return this.color;
  }
}

export class EaselFx {
  constructor(renderer) {
    this.r = renderer;
    this.list = [];
    this.buf = new Float32Array(V * 6 * 2048);
    this.n = 0;
    this.ready = false;
    this._tmp = new Float32Array(4);
    this._pos = new Float32Array(3);
    this._rs = new Float32Array(3);
    this._col = new Float32Array(4);
    this._uv = new Float32Array(1);
    this._parts = [];
  }

  async load(base = FX_BASE) {
    const [lib, meshes, parts] = await Promise.all([
      fetchOk(base + 'fx.json'),
      fetchOk(base + 'meshes.bin', 'buf'),
      fetchOk(base + 'parts.bin', 'buf'),
    ]);
    const h = new Uint16Array(parts);
    const F = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) F[i] = halfToFloat(h[i]);
    for (const p of Object.values(lib.parts)) {
      // смещения треков каждой частицы: [base, o0, o1, o2, o3]
      const idx = new Uint32Array(p.n * 5);
      let o = p.off;
      for (let i = 0; i < p.n; i++) {
        idx[i * 5] = o;
        o += 2;
        for (let k = 0; k < 4; k++) {
          idx[i * 5 + 1 + k] = o;
          const n = F[o];
          o += 1 + n + n * [3, 3, 4, 1][k];
        }
      }
      p.idx = idx;
      p.F = F;
    }
    for (const e of Object.values(lib.effects)) e.end = subtreeEnd(e.root);
    this.lib = lib;
    this.vao = this.r.fxMeshBuffer(new Uint8Array(meshes));
    await Promise.all(Object.keys(lib.textures).map((t) => this.r.loadTexture('fx:' + t, base + 'tex/' + t + '.webp')));
    this.ready = true;
  }

  has(key) {
    return !!(this.lib && this.lib.effects[key]);
  }

  // opts: {pos, rot (кватернион), scale (число|vec3), color (rgba для узлов с id) | colors {id: rgba}}
  spawn(key, opts = {}) {
    if (!this.ready) return null;
    const def = this.lib.effects[key];
    if (!def || !def.root) return null;
    const inst = new FxInstance(this.lib, key, def, opts);
    this.list.push(inst);
    return inst;
  }

  clear() {
    this.list.length = 0;
  }

  update(dt) {
    this.time = (this.time || 0) + dt;
    for (const e of this.list) {
      if (e.dead) continue;
      e.time += dt;
      e.root.update(dt);
      if (e.root.dead || e.time > e.life + 0.05) e.dead = true;
    }
    this.list = this.list.filter((e) => !e.dead);
  }

  // Кадр: строит частицы и отправляет draw-элементы в рендерер (до renderer.end())
  render() {
    if (!this.ready) return;
    this.n = 0;
    this._items = [];
    const v = this.r.view;
    this.camX = [v[0], v[4], v[8]];
    this.camY = [v[1], v[5], v[9]];
    this.eye = this.r.eye;
    for (const e of this.list) if (e.visible) this._node(e, e.root, e.pl);
    for (const b of this._beams || []) this._beam(b);
    this._beams = [];
    const pvao = this.r.fxParticles(this.buf, this.n);
    for (const it of this._items) {
      if (it.fx.particle) it.fx.vao = pvao;
      this.r.draw(it);
    }
  }

  // Луч лазера (LightningEffect): лента к камере от a до b
  beam(key, a, b, color) {
    if (!this.ready || !this.lib.beams[key]) return;
    (this._beams || (this._beams = [])).push({ key, a, b, color });
  }

  _grow(verts) {
    if ((this.n + verts) * V <= this.buf.length) return;
    const nb = new Float32Array(Math.max(this.buf.length * 2, (this.n + verts) * V));
    nb.set(this.buf.subarray(0, this.n * V));
    this.buf = nb;
  }

  _vert(x, y, z, u, w, c0, c1) {
    const o = this.n++ * V;
    const B = this.buf;
    B[o] = x;
    B[o + 1] = y;
    B[o + 2] = z;
    B[o + 3] = u;
    B[o + 4] = w;
    B[o + 5] = c0[0];
    B[o + 6] = c0[1];
    B[o + 7] = c0[2];
    B[o + 8] = c0[3];
    B[o + 9] = c1[0];
    B[o + 10] = c1[1];
    B[o + 11] = c1[2];
    B[o + 12] = c1[3];
  }

  _node(e, node, parent) {
    if (!node.alive) return;
    const d = node.d;
    const t = Math.max(0, node.time);
    const L = node.local;
    if (d.pl) {
      if (d.pl.p) sample(d.pl.p, t, 3, L.p);
      else L.p[0] = L.p[1] = L.p[2] = 0;
      if (d.pl.r) {
        sample(d.pl.r, t, 4, L.r);
        quat.normalize(L.r, L.r);
      } else quat.identity(L.r);
      if (d.pl.s) sample(d.pl.s, t, 3, L.s);
      else L.s[0] = L.s[1] = L.s[2] = 1;
      compose(parent, L, node.wp);
    } else {
      node.wp.p = parent.p.slice();
      node.wp.r = parent.r.slice();
      node.wp.s = parent.s.slice();
    }
    const wp = node.wp;
    mat4.fromRotationTranslationScale(node.m, wp.r, wp.p, wp.s);
    if (d.t === 's') this._static(e, node, t);
    else if (d.t === 'p') this._particles(e, node, t);
    for (const c of node.ch) this._node(e, c, wp);
  }

  _matColors(e, node, mat, t) {
    const col = e.colorFor(node.d.id);
    const mul = col ? col : mat.mul ? sample(mat.mul, t, 4, new Float32Array(4)) : null;
    const add = col ? null : mat.add ? sample(mat.add, t, 4, new Float32Array(4)) : null;
    const op = sampleNum(mat.op, t, 1);
    return { mul, add, op };
  }

  _static(e, node, t) {
    const d = node.d;
    const mesh = this.lib.meshes[d.mesh];
    for (const sub of mesh.subs) {
      const mat = d.mats[sub.m];
      if (!mat || !mat.tex) continue;
      const { mul, add, op } = this._matColors(e, node, mat, t);
      const u = sampleNum(mat.u, t, 0);
      const w = sampleNum(mat.v, t, 0);
      this._items.push({
        matrix: node.m,
        fx: {
          vao: this.vao,
          first: sub.first,
          count: sub.count,
          matrix: node.m,
          tex: 'fx:' + mat.tex,
          blend: BLEND[mat.b] ?? 0,
          mul,
          add,
          opacity: op,
          opMode: OPMODE[mat.om] || 0,
          vc: mat.vc,
          uv: u || w ? [u, -w] : null,
          addr: mat.addr,
        },
      });
    }
  }

  _particles(e, node, t) {
    const d = node.d;
    const sys = node.sys;
    const mat = d.mat;
    if (!mat.tex) return;
    const { mul, add, op } = this._matColors(e, node, mat, t);
    const F = sys.F;
    const idx = sys.idx;
    const m = node.m;
    const scale = Math.abs(node.wp.s[0]);
    let X = this.camX;
    let Y = this.camY;
    if (d.o === 1) {
      const lx = Math.hypot(m[0], m[1], m[2]) || 1;
      const ly = Math.hypot(m[4], m[5], m[6]) || 1;
      X = [m[0] / lx, m[1] / lx, m[2] / lx];
      Y = [m[4] / ly, m[5] / ly, m[6] / ly];
    }
    const pv = d.pv || [0, 0];
    const co = d.co || 0;
    const eye = this.eye;
    const uvs = d.uv;
    const om = OPMODE[mat.om] || 0;
    const list = this._parts;
    list.length = 0;
    const tracks = node.second ? 2 : 1;
    for (let k = 0; k < tracks; k++) {
      const pt = node.pt[k];
      for (let i = 0; i < sys.n; i++) {
        const b = idx[i * 5];
        if (pt < F[b] || pt > F[b + 1]) continue;
        list.push(i, pt);
      }
    }
    if (!list.length) return;
    const count = list.length / 2;
    // сортировка сзади наперёд для LerpByAlpha
    let order = null;
    const P = this._pos;
    const centers = new Float32Array(count * 3);
    for (let j = 0; j < count; j++) {
      const i = list[j * 2];
      track(F, idx[i * 5 + 1], 3, list[j * 2 + 1], P);
      centers[j * 3] = m[0] * P[0] + m[4] * P[1] + m[8] * P[2] + m[12];
      centers[j * 3 + 1] = m[1] * P[0] + m[5] * P[1] + m[9] * P[2] + m[13];
      centers[j * 3 + 2] = m[2] * P[0] + m[6] * P[1] + m[10] * P[2] + m[14];
    }
    if (mat.b === 'lerp' && count > 1) {
      const dist = new Float32Array(count);
      for (let j = 0; j < count; j++)
        dist[j] = (centers[j * 3] - eye[0]) ** 2 + (centers[j * 3 + 1] - eye[1]) ** 2 + (centers[j * 3 + 2] - eye[2]) ** 2;
      order = Array.from({ length: count }, (_, j) => j).sort((a, b) => dist[b] - dist[a]);
    }
    this._grow(count * 6);
    const first = this.n;
    const RS = this._rs;
    const C = this._col;
    const c0 = [0, 0, 0, 0];
    const c1 = [0, 0, 0, 0];
    const U = this._uv;
    const corner = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ];
    for (let jj = 0; jj < count; jj++) {
      const j = order ? order[jj] : jj;
      const i = list[j * 2];
      const pt = list[j * 2 + 1];
      track(F, idx[i * 5 + 2], 3, pt, RS);
      track(F, idx[i * 5 + 3], 4, pt, C);
      track(F, idx[i * 5 + 4], 1, pt, U, true);
      const sp = uvs[Math.max(0, Math.min(uvs.length - 1, Math.round(U[0])))];
      if (!sp) continue;
      for (let q = 0; q < 4; q++) {
        c0[q] = C[q] * (mul ? mul[q] : 1);
        c1[q] = C[q] * (add ? add[q] : 0);
      }
      if (om === 1) {
        c0[3] *= op;
        c1[3] *= op;
      } else if (om === 2) {
        for (let q = 0; q < 3; q++) {
          c0[q] *= op;
          c1[q] *= op;
        }
      }
      const cx = centers[j * 3];
      const cy = centers[j * 3 + 1];
      const cz = centers[j * 3 + 2];
      const sn = Math.sin(RS[2]);
      const cs = Math.cos(RS[2]);
      let ox = 0;
      let oy = 0;
      let oz = 0;
      if (co) {
        const ex = eye[0] - cx;
        const ey = eye[1] - cy;
        const ez = eye[2] - cz;
        const l = Math.hypot(ex, ey, ez) || 1;
        ox = (ex / l) * co;
        oy = (ey / l) * co;
        oz = (ez / l) * co;
      }
      for (const [kx, ky] of corner) {
        const dx = (kx - pv[0] * 2) * RS[0] * scale;
        const dy = (ky - pv[1] * 2) * RS[1] * scale;
        const rx = dx * cs - dy * sn;
        const ry = dx * sn + dy * cs;
        this._vert(
          cx + X[0] * rx + Y[0] * ry + ox,
          cy + X[1] * rx + Y[1] * ry + oy,
          cz + X[2] * rx + Y[2] * ry + oz,
          kx < 0 ? sp[0] : sp[2],
          ky < 0 ? sp[1] : sp[3],
          c0,
          c1,
        );
      }
    }
    const cnt = this.n - first;
    if (!cnt) return;
    this._items.push({
      matrix: node.m,
      fx: { particle: 1, first, count: cnt, tex: 'fx:' + mat.tex, blend: BLEND[mat.b] ?? 0 },
    });
  }

  _beam({ key, a, b, color }) {
    const B = this.lib.beams[key];
    const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(dir[0], dir[1], dir[2]);
    if (L < 1e-4) return;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const view = [mid[0] - this.eye[0], mid[1] - this.eye[1], mid[2] - this.eye[2]];
    // поперечная ось ⟂ лучу и взгляду
    let s = [dir[1] * view[2] - dir[2] * view[1], dir[2] * view[0] - dir[0] * view[2], dir[0] * view[1] - dir[1] * view[0]];
    const sl = Math.hypot(s[0], s[1], s[2]) || 1;
    s = s.map((x) => (x / sl) * B.r);
    const c0 = [color[0] * B.color[0], color[1] * B.color[1], color[2] * B.color[2], Math.min(1, color[3] * B.color[3])];
    const c1 = [0, 0, 0, 0];
    const t = this.time || 0;
    const u0 = -t * B.scroll * 0.1;
    const u1 = u0 + (L * B.tile) / 10;
    this._grow(6);
    const first = this.n;
    const P = (p, k) => [p[0] + s[0] * k, p[1] + s[1] * k, p[2] + s[2] * k];
    const A0 = P(a, -1);
    const A1 = P(a, 1);
    const B0 = P(b, -1);
    const B1 = P(b, 1);
    this._vert(...A0, u0, 0, c0, c1);
    this._vert(...B0, u1, 0, c0, c1);
    this._vert(...B1, u1, 1, c0, c1);
    this._vert(...A0, u0, 0, c0, c1);
    this._vert(...B1, u1, 1, c0, c1);
    this._vert(...A1, u0, 1, c0, c1);
    const m = mat4.fromTranslation(mat4.create(), mid);
    this._items.push({ matrix: m, fx: { particle: 1, first, count: 6, tex: 'fx:' + B.tex, blend: 1 } });
  }
}

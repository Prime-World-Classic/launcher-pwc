// Траектория шаров «Мастерской свитков» — порт PF_Minigames/EaselTrajectory.cpp
// (CBSplineTrajectory + PolylineTrajectory). Координаты — в единицах поля 0..10000.

export const POLYLINE_SEGMENT_SIZE = 100;

class BSpline {
  constructor(degree, cps) {
    this.degree = degree;
    this.cps = cps;
    const n = cps.length;
    this.nodes = [];
    let knots = 0;
    for (let i = 0; i < degree + n + 1; i++) {
      if (i > degree && i <= n) knots++;
      this.nodes[i] = knots;
    }
  }

  deBoor(r, i, u) {
    if (r === 0) return this.cps[i];
    const nd = this.nodes;
    const pre = (u - nd[i + r]) / (nd[i + this.degree + 1] - nd[i + r]);
    const a = this.deBoor(r - 1, i, u);
    const b = this.deBoor(r - 1, i + 1, u);
    return [a[0] * (1 - pre) + b[0] * pre, a[1] * (1 - pre) + b[1] * pre];
  }

  // Точки сплайна с накопленной длиной (как splinePointsMap — ключи уникальны и возрастают)
  points() {
    const out = [];
    let prev = this.cps[0];
    let len = 0;
    const end = this.nodes[this.degree + this.cps.length];
    const push = (l, p) => {
      if (out.length && out[out.length - 1].len === l) return; // map.insert не перезаписывает
      out.push({ len: l, x: p[0], y: p[1] });
    };
    for (let k = 0; ; k++) {
      const u = k * 0.01;
      if (u >= end) break;
      const p = this.deBoor(this.degree, Math.floor(u), u);
      len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      push(len, p);
      prev = p;
    }
    const last = this.cps[this.cps.length - 1];
    len += Math.hypot(prev[0] - last[0], prev[1] - last[1]);
    push(len, last);
    return out;
  }
}

export class PolylineTrajectory {
  constructor(degree, controlPoints, delta = POLYLINE_SEGMENT_SIZE) {
    this.delta = delta;
    this.pts = []; // {x, y, tx, ty}
    const sp = new BSpline(degree, controlPoints).points();
    let cur = 0;
    const first = sp[0];
    this.pts.push({ x: first.x, y: first.y, tx: sp[1].x - first.x, ty: sp[1].y - first.y });
    let lastLen = delta;
    let lastCP = sp[0];
    for (cur = 1; cur < sp.length; cur++) {
      const c = sp[cur];
      const seg = c.len - lastCP.len;
      if (seg === 0) {
        lastCP = c;
        continue;
      }
      const tx = c.x - lastCP.x;
      const ty = c.y - lastCP.y;
      while (c.len > lastLen) {
        const f = (c.len - lastLen) / seg;
        this.pts.push({ x: c.x + (lastCP.x - c.x) * f, y: c.y + (lastCP.y - c.y) * f, tx, ty });
        lastLen += delta;
      }
      lastCP = c;
    }
    this.length = delta * (this.pts.length - 1);
  }

  // Координаты по длине; для длины вне [0, length] — экстраполяция по крайнему сегменту
  coords(len) {
    const p = this.pts;
    if (len <= 0) {
      const t = this.tangentNorm(0);
      return [p[0].x + t[0] * len, p[0].y + t[1] * len];
    }
    if (len >= this.length) {
      const e = p[p.length - 1];
      const t = this.tangentNorm(this.length);
      const over = len - this.length;
      return [e.x + t[0] * over, e.y + t[1] * over];
    }
    const id = Math.floor(len / this.delta);
    const f = (len - id * this.delta) / this.delta;
    return [p[id].x + (p[id + 1].x - p[id].x) * f, p[id].y + (p[id + 1].y - p[id].y) * f];
  }

  tangent(len) {
    const p = this.pts;
    if (len < 0) return [p[0].tx, p[0].ty];
    if (len >= this.length) return [p[p.length - 1].tx, p[p.length - 1].ty];
    const id = Math.floor(len / this.delta);
    const f = (len - id * this.delta) / this.delta;
    return [p[id].tx + (p[id + 1].tx - p[id].tx) * f, p[id].ty + (p[id + 1].ty - p[id].ty) * f];
  }

  tangentNorm(len) {
    const t = this.tangent(len);
    const l = Math.hypot(t[0], t[1]) || 1;
    return [t[0] / l, t[1] / l];
  }
}

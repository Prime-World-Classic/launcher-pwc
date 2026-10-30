// Скелетная анимация объектов замка на GPU (VS_SKIN в убер-шейдере): граф случайных idle-клипов с плавными
// переходами, матрицы костей для uniform bones и перерисовка участка карты теней под движущимися объектами.
// Используется «Мастерской свитков» (easel/easelCastleFx.js) и питомцами в домиках (castlePets.js).
// Скелет и клипы — Skeleton из easel/easelRenderer.js (30 fps, локальные TRS костей).
import * as mat4 from './glMatrix/mat4.js';

const DEFAULT_TRANSFORM = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]; // как в Castle.drawObject

// Граф idle: клип узла играется один раз, потом — следующий узел по вероятностям (nodes: [{ anim, p, ... }]),
// переход от последней позы прошлого клипа за blend секунд. Время — по часам (сек), а не по кадрам:
// скорость анимации не зависит от частоты кадров.
export class SkinIdlePlayer {
  constructor(skel, nodes, blend = 0.5) {
    this.skel = skel;
    this.nodes = nodes;
    this.blend = blend;
    this.pose = new Float32Array(skel.count * 16);
    this.bones = new Float32Array(skel.count * 12); // uniform bones: 3 строки аффинной матрицы на кость
    this.cur = null; // { node, start }
    this.prev = null; // { anim, time } — откуда идёт переход
  }

  pick() {
    const total = this.nodes.reduce((s, n) => s + n.p, 0);
    let r = Math.random() * total;
    for (const n of this.nodes) {
      if ((r -= n.p) < 0) return n;
    }
    return this.nodes[0];
  }

  // узел и переход на момент time; возвращает локальное время текущего клипа
  step(time) {
    const sk = this.skel;
    if (!this.cur) this.cur = { node: this.pick(), start: time };
    const dur = sk.duration(this.cur.node.anim);
    if (time - this.cur.start >= dur) {
      // конец клипа → следующий по вероятностям, плавный переход от последней позы.
      // Следующий начинается ровно в момент конца, а не на кадре, где его заметили; после долгой паузы
      // отрисовки — с текущего момента.
      const end = this.cur.start + dur;
      this.prev = { anim: this.cur.node.anim, time: dur };
      this.cur = { node: this.pick(), start: time - end < this.blend ? end : time };
    }
    const local = time - this.cur.start;
    if (this.prev && local >= this.blend) this.prev = null;
    return local;
  }

  // поза скелета на момент time (после step) → this.pose и this.bones
  apply(time) {
    const local = time - this.cur.start;
    if (this.prev) {
      this.skel.pose(this.pose, this.prev.anim, this.prev.time, false, {
        anim: this.cur.node.anim,
        time: local,
        loop: false,
        weight: Math.min(1, local / this.blend),
      });
    } else {
      this.skel.pose(this.pose, this.cur.node.anim, local, false);
    }
    packRows(this.bones, this.pose, this.skel.count);
  }

  update(time) {
    this.step(time);
    this.apply(time);
  }
}

// матрицы скиннинга (mat4, column-major) → uniform bones убер-шейдера: 3 строки аффинной матрицы на кость
export function packRows(rows, m, count) {
  for (let i = 0; i < count; i++) {
    const a = i * 16;
    const o = i * 12;
    rows[o] = m[a];
    rows[o + 1] = m[a + 4];
    rows[o + 2] = m[a + 8];
    rows[o + 3] = m[a + 12];
    rows[o + 4] = m[a + 1];
    rows[o + 5] = m[a + 5];
    rows[o + 6] = m[a + 9];
    rows[o + 7] = m[a + 13];
    rows[o + 8] = m[a + 2];
    rows[o + 9] = m[a + 6];
    rows[o + 10] = m[a + 10];
    rows[o + 11] = m[a + 14];
  }
}

// Перерисовать участок карты теней [x0, y0, x1, y1] (тексели): очистить и заново нарисовать всех,
// кто в него попадает. Используется для скиннинговых объектов и для вращающихся объектов (Castle).
export function redrawShadowRect(Castle, rect, visible) {
  const size = Castle.depthTextureSize;
  const lvp = Castle.lightViewProjMatrix;
  rect = [
    Math.max(0, Math.floor(rect[0])),
    Math.max(0, Math.floor(rect[1])),
    Math.min(size, Math.ceil(rect[2])),
    Math.min(size, Math.ceil(rect[3])),
  ];
  if (rect[2] <= rect[0] || rect[3] <= rect[1]) return;
  const gl = Castle.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, Castle.depthFramebuffer);
  gl.viewport(0, 0, size, size);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
  gl.depthMask(true);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  const hits = (obj, rotation, translation) => {
    const md = obj.meshData;
    if (!md || !md.vertices || (obj.noShadowCast && Castle.dayNightActive)) return false;
    if (obj.objRotation || !md.bboxMin || !isFinite(md.bboxMin[0])) return true;
    const r = smRect(lvp, size, obj, rotation, translation, md.bboxMin, md.bboxMax, 4);
    return r[0] < rect[2] && r[2] > rect[0] && r[1] < rect[3] && r[3] > rect[1];
  };
  // те же заслонители, что и в статическом проходе Castle.loop
  for (const obj of Castle.sceneObjects) {
    if (obj.blend) break;
    if (hits(obj)) Castle.prepareAndDrawObject(obj, true);
  }
  for (const b of visible) {
    for (const obj of b.mesh.objects) {
      if (hits(obj, b.rotation, b.translation)) Castle.prepareAndDrawObject(obj, true, b.rotation, b.translation);
    }
  }
  gl.disable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// Участок карты теней, который вращающийся объект (objRotation) может занять при любом угле:
// вращение идёт вокруг локального начала координат, берём куб радиуса самой дальней вершины.
export function rotatingShadowRect(Castle, obj, rotation, translation) {
  const md = obj.meshData;
  if (!md || !md.bboxMin || !isFinite(md.bboxMin[0])) return null;
  let r = 0;
  for (let c = 0; c < 8; c++) {
    const x = c & 1 ? md.bboxMax[0] : md.bboxMin[0];
    const y = c & 2 ? md.bboxMax[1] : md.bboxMin[1];
    const z = c & 4 ? md.bboxMax[2] : md.bboxMin[2];
    r = Math.max(r, Math.hypot(x, y, z));
  }
  return smRect(Castle.lightViewProjMatrix, Castle.depthTextureSize, obj, rotation, translation, [-r, -r, -r], [r, r, r], 4);
}

// Участки карты теней под скиннинговым объектом obj во всех видимых зданиях name
// (границы box — локальные, за все клипы), пересекающиеся участки слиты.
export function skinShadowRects(Castle, visible, name, obj, box, rects = []) {
  for (const b of visible) {
    if (b.name !== name) continue;
    rects.push(smRect(Castle.lightViewProjMatrix, Castle.depthTextureSize, obj, b.rotation, b.translation, box[0], box[1], 2));
  }
  return mergeRects(rects);
}

export function mergeRects(rects) {
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < rects.length && !merged; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i],
          c = rects[j];
        if (a[0] < c[2] && c[0] < a[2] && a[1] < c[3] && c[1] < a[3]) {
          rects[i] = unionRect(a, c);
          rects.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return rects;
}

// мировая матрица объекта — как в Castle.drawObject (без objRotation и scaleOverride)
const _w = mat4.create();
const _r = mat4.create();
function worldMatrix(obj, rotation, translation) {
  mat4.transpose(_w, obj.transform || DEFAULT_TRANSFORM);
  if (rotation) {
    mat4.fromRotation(_r, rotation, [0, 1, 0]);
    mat4.mul(_w, _r, _w);
  }
  if (translation) {
    _w[12] += translation[0];
    _w[13] += translation[1];
    _w[14] += translation[2];
  }
  return _w;
}

// прямоугольник в текселях карты теней [x0, y0, x1, y1] для локальных границ объекта
export function smRect(lvp, size, obj, rotation, translation, bmin, bmax, margin) {
  const w = worldMatrix(obj, rotation, translation);
  const r = [Infinity, Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const x = c & 1 ? bmax[0] : bmin[0];
    const y = c & 2 ? bmax[1] : bmin[1];
    const z = c & 4 ? bmax[2] : bmin[2];
    const wx = w[0] * x + w[4] * y + w[8] * z + w[12];
    const wy = w[1] * x + w[5] * y + w[9] * z + w[13];
    const wz = w[2] * x + w[6] * y + w[10] * z + w[14];
    const cw = lvp[3] * wx + lvp[7] * wy + lvp[11] * wz + lvp[15];
    const px = ((lvp[0] * wx + lvp[4] * wy + lvp[8] * wz + lvp[12]) / cw) * 0.5 + 0.5;
    const py = ((lvp[1] * wx + lvp[5] * wy + lvp[9] * wz + lvp[13]) / cw) * 0.5 + 0.5;
    r[0] = Math.min(r[0], px * size);
    r[1] = Math.min(r[1], py * size);
    r[2] = Math.max(r[2], px * size);
    r[3] = Math.max(r[3], py * size);
  }
  r[0] -= margin;
  r[1] -= margin;
  r[2] += margin;
  r[3] += margin;
  return r;
}

export function unionRect(a, b) {
  if (!a) return b;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

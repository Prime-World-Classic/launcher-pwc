// Анимация здания «Мастерская свитков» в замке — как onIdleEffect PW (Buildings/B/MiniGame/FX.EFFT):
// скиннинговые капли (FXallDrops01.skin, скелет FXroot.skel) по графу idle → idle1 (FXIdle1, вероятность 1)
// или idle2 (FXIdle2, вероятность 2), переходы 0.5 с; «дыра» (FXHoleHolle.stat) видна только в idle1.
// Меши лежат в scenes.json: easel/fx_drops.bin (с индексами и весами костей, шейдер shader_pos_norm_uv_skin)
// и easel/fx_hole.bin. Здесь — граф анимаций и позы скелета: матрицы костей уходят в убер-шейдер замка
// (drops.bones → uniform bones, VS_SKIN), вершины скинит шейдер. Данные: tools/pw-convert/build_easel_castle.py.
// Граф клипов, матрицы костей и перерисовка участка карты теней — общие со скиннинговыми объектами замка (castleSkin.js).
import { Skeleton, fetchOk, EASEL_BASE, CONTENT_BASE } from './easelRenderer.js';
import { SkinIdlePlayer, redrawShadowRect, smRect, unionRect } from '../castleSkin.js';

const DROPS = 'easel/fx_drops.bin';
const HOLE = 'easel/fx_hole.bin';
const BASE = EASEL_BASE + 'castle/';
const NODES = [
  { anim: 'FXIdle1', p: 1, hole: true },
  { anim: 'FXIdle2', p: 2, hole: false },
];
const BLEND = 0.5; // PoseToAnim, сек
const HOLE_ALPHA = 0.7; // DiffuseMul.A материала дыры
const HOLE_FADE_OUT = 0.2;
const STEP = 1 / 30; // шаг перерисовки тени капель, сек (позы — каждый кадр)
const BOX_STEP = 0.5; // шаг выборки поз для границ капель за всю анимацию, сек
const STRIDE = 10; // вершина капель во float: pos3 norm3 uv2 + индексы костей 4×u8 + веса 4×u8 (40 байт)

let assets = null; // Promise<{ skel, src, n, boneBox }>

function loadAssets() {
  if (!assets) {
    assets = Promise.all([
      fetchOk(BASE + 'assets.json'),
      fetchOk(CONTENT_BASE + 'meshes/' + DROPS, 'buf'),
      fetchOk(BASE + 'anims/fx.bin', 'buf'),
    ]).then(([desc, mesh, anims]) => {
      const skel = new Skeleton(desc.skeletons.fx, new Float32Array(anims));
      const src = new Float32Array(mesh);
      const bytes = new Uint8Array(mesh);
      const n = src.length / STRIDE;
      // границы вершин каждой кости в позе привязки — для границ капель за всю анимацию (_animBox)
      const boneBox = new Float32Array(skel.count * 6);
      for (let b = 0; b < skel.count; b++) boneBox.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], b * 6);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 4; j++) {
          if (!bytes[i * STRIDE * 4 + 36 + j]) continue;
          const b = bytes[i * STRIDE * 4 + 32 + j];
          for (let k = 0; k < 3; k++) {
            const v = src[i * STRIDE + k];
            if (v < boneBox[b * 6 + k]) boneBox[b * 6 + k] = v;
            if (v > boneBox[b * 6 + 3 + k]) boneBox[b * 6 + 3 + k] = v;
          }
        }
      }
      return { skel, src, n, boneBox };
    });
    assets.catch((e) => {
      console.error('easel castle fx:', e);
    });
  }
  return assets;
}

const states = new WeakMap(); // объект капель сцены → состояние

export class EaselCastleFx {
  // building — Castle.sceneBuildings.easel; time — секунды (по часам, не по кадрам);
  // maxBones — сколько костей принимает шейдер (Castle.SKIN_MAX_BONES)
  static update(building, time, maxBones) {
    const drops = building && building.objects.find((o) => o.meshName === DROPS);
    if (!drops || !drops.meshData || !drops.meshData.vertices) return;
    let s = states.get(drops);
    if (!s) {
      s = { ready: false };
      states.set(drops, s);
      const hole = building.transparentObjects.find((o) => o.meshName === HOLE);
      loadAssets()
        .then((a) => {
          if (a.n !== drops.meshData.indexCount) throw new Error('easel castle fx: число вершин капель не совпадает');
          if (a.skel.count > maxBones) throw new Error('easel castle fx: костей больше, чем Castle.SKIN_MAX_BONES');
          Object.assign(s, a, {
            ready: true,
            pose: new Float32Array(a.skel.count * 16),
            player: new SkinIdlePlayer(a.skel, NODES, BLEND),
            hole,
            holeCount: hole && hole.meshData ? hole.meshData.indexCount : 0,
            holeFade: 0,
            last: -1,
            shadowDirty: false,
          });
          s.box = EaselCastleFx._animBox(s);
          // заслонители при перерисовке участка карты теней отбираются по границам меша
          drops.meshData.bboxMin = s.box[0];
          drops.meshData.bboxMax = s.box[1];
          drops.bones = s.player.bones;
        })
        .catch((e) => console.error(e));
      return;
    }
    if (!s.ready) return;
    const local = s.player.step(time);
    EaselCastleFx._hole(s, time, local);
    // поза — каждый кадр по текущему времени (между ключами анимации — интерполяция), тень — с шагом STEP
    s.player.apply(time);
    if (s.last < 0 || time - s.last >= STEP) {
      s.last = time;
      s.shadowDirty = true;
    }
  }

  // Карта теней замка статична (кэшируется один раз). После каждого обновления капель
  // перерисовываем только её участок под каплями (scissor): очищаем глубину и рисуем
  // заслонителей, чьи границы попадают в этот участок, — остальная карта не меняется.
  static updateShadow(Castle, buildingsToDraw) {
    const building = Castle.sceneBuildings && Castle.sceneBuildings.easel;
    const drops = building && building.objects.find((o) => o.meshName === DROPS);
    const s = drops && states.get(drops);
    if (!s || !s.ready || !s.shadowDirty || !Castle.depthFramebuffer) return;
    s.shadowDirty = false;
    const size = Castle.depthTextureSize;
    const lvp = Castle.lightViewProjMatrix;
    const visible = buildingsToDraw.filter((b) => !b.outlined);

    let rect = null;
    for (const b of visible) {
      if (b.name !== 'easel') continue;
      rect = unionRect(rect, smRect(lvp, size, drops, b.rotation, b.translation, s.box[0], s.box[1], 2));
    }
    if (!rect) return;
    redrawShadowRect(Castle, rect, visible);
  }

  // Границы капель (локально) по всем позам обеих анимаций и позе привязки. Вершина — взвешенная сумма
  // своей точки, перенесённой матрицами костей, поэтому лежит внутри объединения границ костей,
  // перенесённых их матрицами: хватает 8 углов на кость вместо скиннинга всех вершин.
  static _animBox(s) {
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    const { boneBox, pose } = s;
    const count = s.skel.count;
    for (let i = 0; i < s.n; i++) {
      for (let k = 0; k < 3; k++) {
        const v = s.src[i * STRIDE + k];
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
      }
    }
    for (const node of NODES) {
      const d = s.skel.duration(node.anim);
      for (let t = 0; t <= d; t += BOX_STEP) {
        s.skel.pose(pose, node.anim, t, false);
        for (let b = 0; b < count; b++) {
          const bb = b * 6;
          if (!isFinite(boneBox[bb])) continue;
          const m = b * 16;
          for (let c = 0; c < 8; c++) {
            const x = boneBox[bb + (c & 1 ? 3 : 0)];
            const y = boneBox[bb + (c & 2 ? 4 : 1)];
            const z = boneBox[bb + (c & 4 ? 5 : 2)];
            for (let k = 0; k < 3; k++) {
              const v = pose[m + k] * x + pose[m + 4 + k] * y + pose[m + 8 + k] * z + pose[m + 12 + k];
              if (v < mn[k]) mn[k] = v;
              if (v > mx[k]) mx[k] = v;
            }
          }
        }
      }
    }
    return [mn, mx];
  }

  static _hole(s, time, local) {
    // дыра: включается вместе с idle1 (fadeIn = переход), гаснет за 0.2 с
    if (s.hole && s.hole.meshData) {
      const dt = Math.max(0, time - (s.holeTime ?? time));
      s.holeTime = time;
      if (s.player.cur.node.hole) s.holeFade = Math.min(1, s.player.prev ? local / BLEND : s.holeFade + dt / BLEND);
      else s.holeFade = Math.max(0, s.holeFade - dt / HOLE_FADE_OUT);
      s.hole.tintColor = [1, 1, 1, HOLE_ALPHA * s.holeFade];
      s.hole.meshData.indexCount = s.holeFade > 0 ? s.holeCount : 0;
    }
  }
}

// Питомцы в домиках замка («Кошкин дом», «Домик щенка», «Домик единорожка»): скелетная анимация из Unity-замка PW.
// Клипы idle1..idle5 сменяют друг друга случайно (idle1 — основной, чаще), переходы 0.5 с.
// Меши pets/<id>.bin лежат в scenes.json (поза привязки, шейдер shader_pos_norm_uv_skin_ak), скелеты, клипы
// и границы меша за все клипы — content/pets/ (tools/pw-convert/build_pets_castle.py). Позы считаются здесь,
// матрицы костей уходят в убер-шейдер замка (obj.bones → uniform bones, VS_SKIN), вершины скинит шейдер.
// Питомцы одного вида в замке двигаются одинаково: объект здания общий для всех его копий.
import { Skeleton, fetchOk } from './easel/easelRenderer.js';
import { SkinIdlePlayer, redrawShadowRect, skinShadowRects } from './castleSkin.js';

const PETS = ['cat', 'dog', 'unicorn']; // имя здания в scenes.json = id питомца
const BASE = 'content/pets/'; // от документа, как content/scenes.json в Castle.loadScene
const BLEND = 0.5; // переход между клипами, сек
const MAIN_IDLE = 'idle1';
const MAIN_IDLE_P = 3; // вероятность основного клипа относительно остальных (по 1)
const STEP = 1 / 30; // шаг перерисовки тени, сек (позы — каждый кадр)

let desc = null; // Promise<pets.json>
const states = new WeakMap(); // объект питомца в сцене → состояние

function load(id) {
  if (!desc) desc = fetchOk(BASE + 'pets.json');
  return Promise.all([desc, fetchOk(BASE + id + '.bin', 'buf')]).then(([d, buf]) => {
    const skel = new Skeleton(d[id], new Float32Array(buf));
    const nodes = Object.keys(d[id].anims).map((anim) => ({ anim, p: anim === MAIN_IDLE ? MAIN_IDLE_P : 1 }));
    return { skel, nodes, box: d[id].box };
  });
}

function petObject(Castle, id) {
  const building = Castle.sceneBuildings && Castle.sceneBuildings[id];
  const obj = building && building.objects.find((o) => o.meshName === 'pets/' + id + '.bin');
  return obj && obj.meshData && obj.meshData.vertices ? obj : null;
}

export class CastlePets {
  // каждый кадр: позы питомцев, чьи домики стоят в замке или ставятся (фантом)
  static update(Castle, buildingsToDraw) {
    const time = Castle.currentTime;
    for (const id of PETS) {
      if (!buildingsToDraw.some((b) => b.name === id)) continue;
      const obj = petObject(Castle, id);
      if (!obj) continue;
      let s = states.get(obj);
      if (!s) {
        s = { ready: false };
        states.set(obj, s);
        load(id)
          .then((a) => {
            if (a.skel.count > Castle.SKIN_MAX_BONES) throw new Error(`castle pets: у ${id} костей больше, чем Castle.SKIN_MAX_BONES`);
            Object.assign(s, { ready: true, player: new SkinIdlePlayer(a.skel, a.nodes, BLEND), box: a.box, last: -1, shadowDirty: false });
            // заслонители при перерисовке участка карты теней отбираются по границам меша
            obj.meshData.bboxMin = a.box[0];
            obj.meshData.bboxMax = a.box[1];
            obj.bones = s.player.bones;
            s.player.update(Castle.currentTime);
          })
          .catch((e) => console.error(e));
        continue;
      }
      if (!s.ready) continue;
      s.player.update(time);
      if (s.last < 0 || time - s.last >= STEP) {
        s.last = time;
        s.shadowDirty = true;
      }
    }
  }

  // Карта теней замка статична: под питомцами перерисовываем только её участки (scissor) — как у мольберта.
  static updateShadow(Castle, buildingsToDraw) {
    if (!Castle.depthFramebuffer) return;
    let visible = null;
    let rects = [];
    for (const id of PETS) {
      const obj = petObject(Castle, id);
      const s = obj && states.get(obj);
      if (!s || !s.ready || !s.shadowDirty) continue;
      s.shadowDirty = false;
      visible = visible || buildingsToDraw.filter((b) => !b.outlined);
      rects = skinShadowRects(Castle, visible, id, obj, s.box, rects);
    }
    for (const rect of rects) redrawShadowRect(Castle, rect, visible);
  }
}

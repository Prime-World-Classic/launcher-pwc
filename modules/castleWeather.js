import * as mat4 from './glMatrix/mat4.js';

// Погодный оверлей замка (снег ↔ дождь).
//
// Рисуется ОДНИМ fullscreen-квадом (меши weather_*.bin из scenes.json, шейдер
// shader_pos_color_uv_falloff_snow) в прозрачном проходе, после сцены и после освещения.
// Сам квад — локальный квадрат [-1,1]²; его transform каждый кадр пересчитывается из камеры так,
// чтобы он ровно накрывал кадр (углы NDC, снятые через viewProjInv на близкой плоскости).
//
// Координата узора при этом МИРОВАЯ: вершинная программа отдаёт мировы метры точки квада в
// базисе плоскости квада (fragPlanePos), а CastleWeather добавляет к ней мировую привязку
// камеры (weather3.zw) — поэтому панорама не тащит осадки за собой, а поворот и зум не дают
// скачка узора.
//
// Фаза падения — накопленный путь (travel, метры), а не «скорость × время сцены»: произведение
// при смене скорости или fov перематывало бы узор на тысячи ячеек за кадр.
//
// Смена эффекта — фейд по прозрачности (fade), между эффектами пауза. Режим переключается
// setMode('snow'|'rain') или дебажным циклом.
export class CastleWeather {
  static MESH_RE = /^weather_/;

  static enabled = true;

  // объекты текущей сцены (bind) — их transform и weather* пишутся каждый кадр
  static objects = [];

  static mode = 'snow';

  // ДЕБАЖНАЯ ВЫКАТКА (снять при привязке погоды к сезону/времени игрока): в замках погода идёт
  // всегда, снег и дождь чередуются. debugCycleS — сколько секунд держится эффект,
  // debugPauseS — пауза между эффектами (осадков нет), fadeS — фейд по прозрачности.
  // debugCycleS = 0 — автоматической смены нет, держится режим из setMode/?previewWeather=,
  // но ручное переключение всё равно проходит через фейд.
  static debugCycleS = 30;
  static debugPauseS = 10;
  static fadeS = 3;

  // in → hold → out → (пауза) → in…
  static phase = 'in';
  static phaseClock = 0;
  static fade = 0;
  static pendingMode = null;

  // накопленный путь падения в метрах — единственная «временна́я» величина шейдера
  static travel = 0;

  // NDC-z квада: почти на ближней плоскости, поэтому глубина квада ближе любой геометрии сцены
  // и DEPTH_TEST (включён в прозрачном проходе) его не отсекает.
  static NDC_Z = -0.995;

  static KEYS = ['speed', 'tail', 'density', 'jitter', 'tilt', 'size', 'depthNear', 'depthFar', 'layers', 'farFade', 'alpha', 'presence'];

  // Все размеры и скорости — мировые метры: частица в 2 см остаётся 2 см при любом зуме,
  // а на экране её размер задаётся дистанцией слоя.
  static PRESETS = {
    // снег: редкие крупные снежинки вблизи, частые мелкие вдали; падает медленно, с заметным сносом
    snow: {
      color: [0.95, 0.97, 1.0],
      alpha: 0.675,
      speed: 1.4, // м/с
      tail: 0.0, // м — хвоста нет, частица круглая
      density: 3.1, // ячеек на метр
      jitter: 0.6, // разброс размеров ±30%
      tilt: 0.25, // мировой снос: dx на единицу падения
      size: 0.021, // м, радиус «снежинки»
      depthNear: 3,
      depthFar: 45,
      layers: 6,
      farFade: 0.35, // дальний слой бледнее ближнего в 3 раза
      presence: 0.42, // доля ячеек с частицей
    },
    // дождь: тонкие отвесные полосы, летят быстрее, прозрачнее и холоднее по цвету
    rain: {
      color: [0.72, 0.78, 0.86],
      alpha: 0.375,
      speed: 9.0,
      tail: 0.35, // м — длина полосы
      density: 5.4,
      jitter: 0.3,
      tilt: 0.12,
      size: 0.006,
      depthNear: 3,
      depthFar: 38,
      layers: 6,
      farFade: 0.45,
      presence: 0.42,
    },
  };

  static params = { ...CastleWeather.PRESETS.snow };

  // Ночью снег тусклее (лунный свет), но не гаснет совсем — сцена под ним почти чёрная
  static NIGHT_FLOOR = 0.45;

  static current() {
    return CastleWeather.params;
  }

  // Плавно (фейдом) перевести погоду в другой режим.
  static setMode(name) {
    if (!CastleWeather.PRESETS[name]) return;
    if (name === CastleWeather.mode && CastleWeather.phase === 'hold') return;
    CastleWeather.pendingMode = name;
    if (CastleWeather.phase === 'in' || CastleWeather.phase === 'hold') {
      CastleWeather.phase = 'out';
      CastleWeather.phaseClock = 0;
    }
  }

  // Мгновенная установка без фейда (стенды, отладка, середина паузы)
  static applyImmediate(name, partial = null) {
    const preset = CastleWeather.PRESETS[name];
    if (!preset) return;
    CastleWeather.params = { ...preset, ...(partial || {}) };
    CastleWeather.mode = name;
    CastleWeather.pendingMode = null;
  }

  static stepCycle(dt) {
    const W = CastleWeather;
    W.phaseClock += dt;
    if (W.phase === 'in') {
      W.fade = Math.min(1, W.phaseClock / Math.max(W.fadeS, 0.001));
      if (W.phaseClock >= W.fadeS) {
        W.phase = 'hold';
        W.phaseClock = 0;
        W.fade = 1;
      }
      return;
    }
    if (W.phase === 'hold') {
      W.fade = 1;
      const auto = W.debugCycleS > 0 && W.phaseClock >= W.debugCycleS;
      if (auto || W.pendingMode) {
        W.phase = 'out';
        W.phaseClock = 0;
      }
      return;
    }
    if (W.phase === 'out') {
      W.fade = Math.max(0, 1 - W.phaseClock / Math.max(W.fadeS, 0.001));
      if (W.phaseClock >= W.fadeS) {
        W.fade = 0;
        // смена параметров — в тот момент, когда прозрачность уже ноль: скачка узора не видно
        const next = W.pendingMode || (W.debugCycleS > 0 ? (W.mode === 'snow' ? 'rain' : 'snow') : null);
        if (next && next !== W.mode) W.applyImmediate(next);
        W.phase = 'pause';
        W.phaseClock = 0;
      }
      return;
    }
    // пауза: осадков нет
    W.fade = 0;
    const pause = W.debugCycleS > 0 ? W.debugPauseS : 0;
    if (W.phaseClock >= pause) {
      W.phase = 'in';
      W.phaseClock = 0;
    }
  }

  // Объекты погоды в собранной сцене. transform и uniform-ы живут в Float32Array — их пишем на месте.
  static bind(castle) {
    CastleWeather.objects = [];
    for (const obj of castle.sceneObjects || []) {
      if (!CastleWeather.MESH_RE.test(obj.meshName)) continue;
      obj.transform = new Float32Array(16);
      obj.weather = new Float32Array(4);
      obj.weather2 = new Float32Array(4);
      obj.weather3 = new Float32Array(4);
      obj.weather4 = new Float32Array(4);
      obj.tintColor = new Float32Array(4);
      CastleWeather.objects.push(obj);
    }
  }
  // Квад строится аналитически, без унпроекцирования углов NDC: вычитание мировых точек
  // (~1400 ед.) даёт полуоси с относительной ошибкой ~1e-5, а это ~15 px лишнего «скольжения»
  // ближнего слоя на каждую панораму. Источник истины — invert(viewMatrix2): его колонки 0 и 1
  // это мировые right/up камеры, колонка 2 со знаком минус — forward, элементы 12..14 — позиция.
  static _mat = new Float32Array(16);
  static _camToWorld = new Float32Array(16);
  static snowR = [1, 0, 0];
  static snowU = [0, 1, 0];
  static planeDist = 10;
  static camPlane = [0, 0];

  // Мировая позиция основной камеры. БЕРЁМ ИЗ invert(viewMatrix2) обязательно: локальная
  // переменная camPos в Castle.updateMainCam — перевод в ЛОКАльной системе вида (mat4.translate
  // домножает справа), знак у неё обратный мировой позиции: инвертированная матрица даёт
  // (1432, 90, 1582), а camPos — (-1432, -90, -1582).
  static cameraPos(castle, out) {
    if (!mat4.invert(out, castle.viewMatrix2)) return null;
    return out;
  }

  // Дистанция плоскости квада от камеры: ndc_z = (P10*zv + P14)/(-zv) → zv = -P14/(ndc_z + P10).
  static planeDepth(castle) {
    const P = castle.projMatrix;
    const denom = CastleWeather.NDC_Z + P[10];
    if (Math.abs(denom) < 1e-9) return CastleWeather.planeDist;
    return Math.abs(P[14] / denom);
  }

  static fullscreenTransform(castle) {
    const out = CastleWeather._mat;
    const cw = CastleWeather.cameraPos(castle, CastleWeather._camToWorld);
    if (!cw) return out;
    const D = CastleWeather.planeDepth(castle);
    const tanHalf = Math.tan((castle.fov * Math.PI) / 360);
    const halfH = D * tanHalf;
    const halfW = halfH * ((castle.canvasWidth || 1) / (castle.canvasHeight || 1));
    const R = CastleWeather.snowR;
    const U = CastleWeather.snowU;
    R[0] = cw[0];
    R[1] = cw[1];
    R[2] = cw[2];
    U[0] = cw[4];
    U[1] = cw[5];
    U[2] = cw[6];
    const cx = cw[12] - cw[8] * D;
    const cy = cw[13] - cw[9] * D;
    const cz = cw[14] - cw[10] * D;
    // transform хранится построчно (как в шейдере и в CastleLighting.glowOf):
    // локальная (x, y, 0) → центр + x*полуширина + y*полувысота
    out[0] = R[0] * halfW;
    out[1] = U[0] * halfH;
    out[2] = 0;
    out[3] = cx;
    out[4] = R[1] * halfW;
    out[5] = U[1] * halfH;
    out[6] = 0;
    out[7] = cy;
    out[8] = R[2] * halfW;
    out[9] = U[2] * halfH;
    out[10] = 0;
    out[11] = cz;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;

    CastleWeather.planeDist = D;
    CastleWeather.camPlane[0] = cw[12] * R[0] + cw[13] * R[1] + cw[14] * R[2];
    CastleWeather.camPlane[1] = cw[12] * U[0] + cw[13] * U[1] + cw[14] * U[2];
    return out;
  }

  // Мировое направление падения (tilt, -1, 0), спроецированное на базис квада.
  // При обходе камеры вокруг замка экранное «вниз-вбок» само меняет знак — как у настоящего ветра.
  static fallDir(tilt) {
    const len3 = Math.hypot(tilt, 1) || 1;
    const R = CastleWeather.snowR;
    const U = CastleWeather.snowU;
    const fx = (tilt * R[0] - R[1]) / len3;
    const fy = (tilt * U[0] - U[1]) / len3;
    const l = Math.hypot(fx, fy);
    // камера смотрит почти вдоль мирового «вниз» — проекция вырождается, держим экранный низ
    if (l < 1e-3) return [0, -1];
    return [fx / l, fy / l];
  }

  // Каждый кадр: дебажный цикл, фаза падения, позиция квада и uniform-ы объектов.
  // Вызывается из Castle.loop после updateDayNight (нужен Castle.daylight).
  static update(castle) {
    if (!CastleWeather.objects.length) return;
    // deltaTime считается от Castle.currentTime, а он скачет после сна цикла (вкладка скрыта,
    // шёл бой) — без среза один такой кадр сдвигал бы цикл и фазу падения на несколько секунд
    const dt = Math.min(Math.max(castle.deltaTime || 0, 0), 1);
    CastleWeather.stepCycle(dt);

    const p = CastleWeather.current();
    CastleWeather.travel += p.speed * dt;

    CastleWeather.fullscreenTransform(castle);
    const fall = CastleWeather.fallDir(p.tilt);

    const gate = (CastleWeather.enabled ? 1 : 0) * CastleWeather.fade;
    const light = CastleWeather.NIGHT_FLOOR + (1 - CastleWeather.NIGHT_FLOOR) * (castle.daylight ?? 1);
    const mat = CastleWeather._mat;

    for (const obj of CastleWeather.objects) {
      obj.transform.set(mat);
      const w = obj.weather;
      w[0] = CastleWeather.travel;
      w[1] = p.tail;
      w[2] = p.density;
      w[3] = p.jitter;
      const w2 = obj.weather2;
      w2[0] = p.size;
      w2[1] = p.depthNear;
      w2[2] = p.depthFar;
      w2[3] = CastleWeather.planeDist;
      const w3 = obj.weather3;
      w3[0] = p.layers;
      w3[1] = p.farFade;
      w3[2] = CastleWeather.camPlane[0];
      w3[3] = CastleWeather.camPlane[1];
      const w4 = obj.weather4;
      w4[0] = fall[0];
      w4[1] = fall[1];
      w4[2] = p.presence;
      w4[3] = 0;
      const tint = obj.tintColor;
      tint[0] = p.color[0] * light;
      tint[1] = p.color[1] * light;
      tint[2] = p.color[2] * light;
      tint[3] = p.alpha * gate;
    }
  }
}

import * as vec4 from './glMatrix/vec4.js';

// Погодний оверлей замка (снег ↔ дождь).
//
// Рисуется ОДНИМ fullscreen-квадом (меши weather_*.bin из scenes.json, шейдер
// shader_pos_color_uv_falloff_snow) в прозрачном проходе, после сцены и после освещения.
// Сам квад — локальный квадрат [-1,1]²; его transform каждый кадр пересчитывается из камеры так,
// чтобы он ровно накрывал кадр (углы NDC, снятые через viewProjInv на близкой плоскости), —
// поэтому эффект не зависит от позы камеры, зума и поворота (в т.ч. кинематографичного обхода).
//
// Глубина кадра — слои в шейдере: ближний слой редкий и крупный, дальний частый и мелкий.
// Параметры слоёв и частиц уходят в шейдер uniform-ами weather/weather2/weather3 (их ставит
// Castle.drawObject только у программ, где эти uniform-ы объявлены), цвет и прозрачность —
// стандартным tintColor.
//
// Дождь — тот же шейдер, другой пресет: setMode('snow'|'rain') везёт параметры плавно,
// TRANSITION_S секунд.
export class CastleWeather {
  static MESH_RE = /^weather_/;

  static enabled = true;

  // объекты текущей сцены (bind) — их transform/weather/weather2/weather3 пишутся каждый кадр
  static objects = [];

  static mode = 'snow';

  static TRANSITION_S = 3.0;

  // ДЕБАЖНАЯ ВЫКАТКА (снять при привязке погоды к сезону/времени игрока): в замках погода
  // идёт всегда, снег и дождь меняются каждые debugCycleS секунд. 0 — цикл выключен,
  // режим держится тот, что выставлен вручную (Castle.weather.setMode / ?previewWeather=).
  // Отсчёт на Castle.currentTime — при смене сцены (switchScene) цикл начинается заново.
  static debugCycleS = 30;
  static debugClock = 0;

  // NDC-z квада: почти на ближней плоскости, поэтому глубина квада ближе любой геометрии сцены
  // и DEPTH_TEST (включён в прозрачном проходе) его не отсекает.
  static NDC_Z = -0.995;

  // Плавный переход: from → to по t01 (считается на deltaTime, без таймеров)
  static from = null;
  static to = null;
  static t01 = 1;

  static KEYS = ['speed', 'tail', 'density', 'jitter', 'tilt', 'size', 'depthNear', 'depthFar', 'layers', 'farFade', 'alpha'];

  static PRESETS = {
    // снег: редкие крупные снежинки вблизи, частые мелкие вдали; падает медленно, с заметным сносом
    snow: {
      color: [0.95, 0.97, 1.0],
      alpha: 0.9,
      speed: 1.4, // м/с
      tail: 0.0, // м — хвоста нет, частица круглая
      density: 2.6, // ячеек на высоту экрана на метр глубины
      jitter: 0.6, // разброс размеров ±30%
      tilt: 0.25, // dx/dy ≈ 14°
      size: 0.042, // м, радиус «снежинки»
      depthNear: 3,
      depthFar: 45,
      layers: 6,
      farFade: 0.35, // дальний слой бледнее ближнего в 3 раза
    },
    // дождь: тонкие отвесные полосы, летят быстрее, прозрачнее и холоднее по цвету
    rain: {
      color: [0.72, 0.78, 0.86],
      alpha: 0.5,
      speed: 9.0,
      tail: 0.35, // м — длина полосы
      density: 4.5,
      jitter: 0.3,
      tilt: 0.12,
      size: 0.012,
      depthNear: 3,
      depthFar: 38,
      layers: 6,
      farFade: 0.45,
    },
  };

  static params = { ...CastleWeather.PRESETS.snow };

  // Ночью снег тусклее (лунный свет), но не гаснет совсем — сцена под ним почти чёрная
  static NIGHT_FLOOR = 0.45;

  static current() {
    return CastleWeather.params;
  }

  // Плавно перевести погоду в режим (snow|rain). partial — разовая подправка параметров presets.
  static setMode(name, partial = null) {
    const preset = CastleWeather.PRESETS[name];
    if (!preset) return;
    CastleWeather.from = { ...CastleWeather.current() };
    CastleWeather.to = { ...preset, ...(partial || {}) };
    CastleWeather.t01 = 0;
    CastleWeather.mode = name;
  }

  // Мгновенная установка (стенды, отладка)
  static applyImmediate(name, partial = null) {
    const preset = CastleWeather.PRESETS[name];
    if (!preset) return;
    CastleWeather.params = { ...preset, ...(partial || {}) };
    CastleWeather.from = CastleWeather.to = CastleWeather.params;
    CastleWeather.t01 = 1;
    CastleWeather.mode = name;
  }

  static step(dt) {
    if (!CastleWeather.to || CastleWeather.t01 >= 1) return;
    CastleWeather.t01 = Math.min(1, CastleWeather.t01 + Math.max(dt, 0) / CastleWeather.TRANSITION_S);
    const k = CastleWeather.t01 * CastleWeather.t01 * (3 - 2 * CastleWeather.t01); // smoothstep
    const p = { color: [...CastleWeather.from.color] };
    for (const key of CastleWeather.KEYS) p[key] = CastleWeather.lerp(CastleWeather.from[key], CastleWeather.to[key], k);
    for (let c = 0; c < 3; c++) p.color[c] = CastleWeather.lerp(CastleWeather.from.color[c], CastleWeather.to.color[c], k);
    CastleWeather.params = p;
  }

  static lerp(a, b, k) {
    return a + (b - a) * k;
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
      obj.tintColor = new Float32Array(4);
      CastleWeather.objects.push(obj);
    }
  }

  // Углы NDC-прямоугольника на NDC_Z → мир (viewProjInv — уже обратная к proj*view2).
  // Противоположные стороны равны (сечение пирамиды на постоянной глубине — параллелограмм),
  // поэтому квад задаётся центром и двумя полусторонами.
  static _v = new Float32Array(4);
  static _corners = new Float32Array(12);

  static fullscreenTransform(castle, out) {
    const inv = castle.viewProjInv;
    const c = CastleWeather._corners;
    const v = CastleWeather._v;
    const z = CastleWeather.NDC_Z;
    for (let i = 0; i < 4; i++) {
      const nx = i === 1 || i === 2 ? 1 : -1;
      const ny = i >= 2 ? 1 : -1;
      vec4.transformMat4(v, [nx, ny, z, 1], inv);
      const w = v[3] || 1;
      c[i * 3] = v[0] / w;
      c[i * 3 + 1] = v[1] / w;
      c[i * 3 + 2] = v[2] / w;
    }
    // порядок углов: (-1,-1), (1,-1), (1,1), (-1,1)
    const ex = [(c[3] - c[0]) / 2, (c[4] - c[1]) / 2, (c[5] - c[2]) / 2];
    const ey = [(c[9] - c[0]) / 2, (c[10] - c[1]) / 2, (c[11] - c[2]) / 2];
    const cx = (c[0] + c[3] + c[6] + c[9]) / 4;
    const cy = (c[1] + c[4] + c[7] + c[10]) / 4;
    const cz = (c[2] + c[5] + c[8] + c[11]) / 4;
    // transform хранится построчно (как в шейдере и в CastleLighting.glowOf):
    // локальная (x, y, 0) → центр + x*полуширина + y*полувысота
    out[0] = ex[0];
    out[1] = ey[0];
    out[2] = 0;
    out[3] = cx;
    out[4] = ex[1];
    out[5] = ey[1];
    out[6] = 0;
    out[7] = cy;
    out[8] = ex[2];
    out[9] = ey[2];
    out[10] = 0;
    out[11] = cz;
    out[12] = 0;
    out[13] = 0;
    out[14] = 0;
    out[15] = 1;
    return out;
  }

  static _mat = new Float32Array(16);

  // Каждый кадр: дебажный цикл, переход режима, позиция квада и uniform-ы объектов.
  // Вызывается из Castle.loop после updateDayNight (нужен Castle.daylight).
  static update(castle) {
    if (!CastleWeather.objects.length) return;
    // deltaTime считается от Castle.currentTime, а он скачет после сна цикла (вкладка скрыта,
    // шёл бой) — без среза один такой кадр сдвигал бы цикл на несколько переключений
    const dt = Math.min(Math.max(castle.deltaTime || 0, 0), 1);
    if (CastleWeather.debugCycleS > 0) {
      CastleWeather.debugClock += dt;
      if (CastleWeather.debugClock >= CastleWeather.debugCycleS) {
        CastleWeather.debugClock = 0;
        CastleWeather.setMode(CastleWeather.mode === 'snow' ? 'rain' : 'snow');
      }
    }
    CastleWeather.step(dt);

    const p = CastleWeather.current();
    const aspect = (castle.canvasWidth || 1) / (castle.canvasHeight || 1);
    const tanHalf = Math.tan((castle.fov * Math.PI) / 180 / 2);
    const day = CastleWeather.enabled ? 1 : 0;
    const light = CastleWeather.NIGHT_FLOOR + (1 - CastleWeather.NIGHT_FLOOR) * (castle.daylight ?? 1);

    CastleWeather.fullscreenTransform(castle, CastleWeather._mat);

    for (const obj of CastleWeather.objects) {
      obj.transform.set(CastleWeather._mat);
      const w = obj.weather;
      w[0] = p.speed;
      w[1] = p.tail;
      w[2] = p.density * day; // плотность 0 = выключено: слоёв не остаётся
      w[3] = p.jitter;
      const w2 = obj.weather2;
      w2[0] = p.tilt;
      w2[1] = p.size;
      w2[2] = p.depthNear;
      w2[3] = p.depthFar;
      const w3 = obj.weather3;
      w3[0] = aspect;
      w3[1] = tanHalf;
      w3[2] = p.layers;
      w3[3] = p.farFade;
      const tint = obj.tintColor;
      tint[0] = p.color[0] * light;
      tint[1] = p.color[1] * light;
      tint[2] = p.color[2] * light;
      tint[3] = p.alpha * day;
    }
  }
}

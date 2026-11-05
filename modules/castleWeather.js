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
// Смена эффекта — фейд по прозрачности, расписание — по реальным часам игрока (см. schedule).
export class CastleWeather {
  static MESH_RE = /^weather_/;

  static enabled = true;

  // объекты текущей сцены (bind) — их transform и weather* пишутся каждый кадр
  static objects = [];

  static mode = 'snow';

  // Расписание. Погода квантуется слотами по CYCLE_S секунд: слот — это один погодный цикл,
  // «несколько циклов подряд» — просто соседние активные слоты. Активность слота — бернуллиев
  // опыт по детерминированному хешу номера слота, с вероятностью SEASON_DUTY сезона: в
  // среднем доля времени с осадками равна ей (50% осень/зима, 20% весна/лето), но подряд
  // могут выпасть и несколько циклов, и длинный перерыв.
  static CYCLE_S = 300;
  static FADE_S = 3;
  static SEASON_DUTY = { winter: 0.5, autumn: 0.5, spring: 0.2, summer: 0.2 };

  // Ручное переопределение расписания (стенд, консоль): 'snow' | 'rain' | 'off' | null.
  static override = null;

  // фаза текущего слота для отладки: режим и прозрачность, посчитанные из часов
  static slot = 0;
  static fade = 0;

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

  // Как осадки меняют свет сцены (Castle.updateDayNight). Без этого дождь идёт при полном
  // солнце: тучи на картинку не влияют, и кадр выглядит суше, чем погода за окном.
  // Множители — «при полностью активной погоде» (fade=1); на границе слота эффект
  // интерполируется фейдом.
  static WET_SUN = 0.6; // прямое солнце (и с ним тени) гаснет до 60%
  static WET_EXPOSURE = 0.85; // общая экспозиция сцены (и неба) — вниз на 15%
  static WET_AMBIENT = 0.95; // заполняющий свет чуть тусклее
  static WET_DESAT = 0.6; // фон тянется к серому (по luminance) на 60%

  // Насколько погода «сегодня» затемняет сцену: 0..1 (учитывает ручной выключатель и фейд).
  // Значение считает schedule(), поэтому вызывать нужно ПОСЛЕ него.
  static strength() {
    return CastleWeather.enabled ? CastleWeather.fade : 0;
  }

  // Чистая функция: (sunLight, ambientLight) → те же массивы, затемнённые и обесцвеченные
  // погодой. sunLight.a — экспозиция (её множит отдельно), rgb — цвет и сила солнца.
  // Сначала считается «полностью погодный» свет, потом он мешается с штатным по wet — так
  // затемнение линейно по фейду слота и не накапливается от кадра к кадру.
  static tintLight(wet, sunLight, ambientLight) {
    if (wet <= 0) return [sunLight, ambientLight];
    const sunFull = [
      sunLight[0] * CastleWeather.WET_SUN,
      sunLight[1] * CastleWeather.WET_SUN,
      sunLight[2] * CastleWeather.WET_SUN,
      sunLight[3] * CastleWeather.WET_EXPOSURE,
    ];
    // обесцвечивание по luminance: цветной ночной фон (синий) становится серо-голубым,
    // дневной нейтральный — просто чуть более плоским; смещение (alpha) не трогаем
    const a = ambientLight;
    const lum = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    const d = CastleWeather.WET_DESAT;
    const ambFull = [
      (a[0] + (lum - a[0]) * d) * CastleWeather.WET_AMBIENT,
      (a[1] + (lum - a[1]) * d) * CastleWeather.WET_AMBIENT,
      (a[2] + (lum - a[2]) * d) * CastleWeather.WET_AMBIENT,
      a[3],
    ];
    const mix = (b, f) => b + (f - b) * wet;
    return [
      [mix(sunLight[0], sunFull[0]), mix(sunLight[1], sunFull[1]), mix(sunLight[2], sunFull[2]), mix(sunLight[3], sunFull[3])],
      [mix(a[0], ambFull[0]), mix(a[1], ambFull[1]), mix(a[2], ambFull[2]), a[3]],
    ];
  }

  static current() {
    return CastleWeather.params;
  }

  // Метеорологические сезоны северного полушария (дек-фев / мар-май / июн-авг / сен-ноя):
  // границы не зависят от года, в отличие от астрономических солнцестояний.
  static season(date = new Date()) {
    const m = date.getMonth();
    if (m === 11 || m <= 1) return 'winter';
    if (m <= 4) return 'spring';
    if (m <= 7) return 'summer';
    return 'autumn';
  }

  // Снег — только зимой, в остальное время дождь.
  static modeFor(date) {
    return CastleWeather.season(date) === 'winter' ? 'snow' : 'rain';
  }

  static slotAt(ms) {
    return Math.floor(ms / (CastleWeather.CYCLE_S * 1000));
  }

  // Детерминированный по номеру слота ПСЧ (finalizer splitmix32): одна и та же погода у всех
  // игроков в один момент времени, независимо от того, когда открыли лончер.
  static slotRandom(n) {
    let x = (n ^ 0x9e3779b9) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    x = (x ^ (x >>> 15)) >>> 0;
    return x / 4294967296;
  }

  static slotOn(n, date) {
    return CastleWeather.slotRandom(n) < (CastleWeather.SEASON_DUTY[CastleWeather.season(date)] ?? 0);
  }

  // Режим и прозрачность по часам. Фейд нужен только на границе «пусто ↔ погода»: соседние
  // активные слоты (несколько циклов подряд) склеиваются без мерцания.
  static schedule(nowMs = Date.now()) {
    const W = CastleWeather;
    if (W.override) {
      W.fade = W.override === 'off' ? 0 : 1;
      if (W.override !== 'off' && W.override !== W.mode) W.applyImmediate(W.override);
      return { mode: W.override === 'off' ? W.mode : W.override, fade: W.fade };
    }
    const date = new Date(nowMs);
    const mode = W.modeFor(date);
    const s = W.slotAt(nowMs);
    W.slot = s;
    if (!W.slotOn(s, date)) {
      W.fade = 0;
      return { mode, fade: 0 };
    }
    if (mode !== W.mode) W.applyImmediate(mode);
    const slotMs = W.CYCLE_S * 1000;
    const inMs = nowMs - s * slotMs;
    const outMs = (s + 1) * slotMs - nowMs;
    const fadeS = W.FADE_S * 1000;
    // предыдущий слот «тот же режим и тоже погода» — появления не нужно
    const prevRun = W.slotOn(s - 1, date) && W.modeFor(new Date(nowMs - slotMs)) === mode;
    const nextRun = W.slotOn(s + 1, date) && W.modeFor(new Date(nowMs + slotMs)) === mode;
    const fadeIn = prevRun ? 1 : Math.min(1, inMs / fadeS);
    const fadeOut = nextRun ? 1 : Math.min(1, outMs / fadeS);
    W.fade = Math.max(0, Math.min(fadeIn, fadeOut));
    return { mode, fade: W.fade };
  }

  // Ручное переопределение расписания (стенд, консоль)
  static setMode(name) {
    if (name !== 'snow' && name !== 'rain' && name !== 'off') return;
    CastleWeather.override = name;
  }

  static clearOverride() {
    CastleWeather.override = null;
  }

  // Мгновенная установка пресета (расписание/override выбирают его сами)
  static applyImmediate(name, partial = null) {
    const preset = CastleWeather.PRESETS[name];
    if (!preset) return;
    CastleWeather.params = { ...preset, ...(partial || {}) };
    CastleWeather.mode = name;
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
  static snowF = [0, 0, -1]; // мировая ось зрения (из invert(viewMatrix2), со знаком минус)
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
    const Fv = CastleWeather.snowF;
    Fv[0] = -cw[8];
    Fv[1] = -cw[9];
    Fv[2] = -cw[10];
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

  // Направление падения в базисе плоскости квада — ЭКРАННАЯ проекция мирового вектора
  // осадок, БЕЗ нормализации: его длина = sin угла между осью зрения и «мировым вниз»,
  // то есть доля падения, приходящаяся на плоскость кадра.
  //
  // Прежняя формула брала вертикаль жёстко по экрану (0,-1) и нормализовала результат.
  // Так осадки переставали «ехать под наклоном к камере» при виде сверху (старый дефект),
  // но ценой физики: у камеры, смотрящей круто вниз, мировой «вниз» почти параллелен лучу
  // зрения, и полоса в кадре обязана укорачиваться (капля летит «вглубь» кадра), а не
  // оставаться полной длины. Замер поз: ступени 1-3 (камера на высоте 440, наклон 55.7°)
  // дают |проекция| = 0.563, постановочные 4-6 (высота 90, наклон 12.8°) — 0.975, и у
  // совсем отвесной камеры — 0.
  //
  // Третий компонент — составляющая вдоль луча зрения (fallFwd): из неё в шейдере
  // строится перспектива полос (они сходятся к точке схода мировых вертикалей и растут
  // по мере удаления от неё). Ветер — мировой (то же направление, что у покачивания
  // деревьев), поэтому наклон сам меняет знак при обходе замка.
  static fallVec(tilt, windXY) {
    const R = CastleWeather.snowR;
    const U = CastleWeather.snowU;
    const F = CastleWeather.snowF;
    const wx = windXY ? windXY[0] : 1;
    const wz = windXY ? windXY[1] : 0;
    // мировая скорость капли: вниз (0,-1,0) плюс снос tilt по направлению ветра
    const fx = tilt * wx;
    const fy = -1;
    const fz = tilt * wz;
    return [fx * R[0] + fy * R[1] + fz * R[2], fx * U[0] + fy * U[1] + fz * U[2], fx * F[0] + fy * F[1] + fz * F[2]];
  }

  // Каждый кадр: расписание по часам, фаза падения, позиция квада и uniform-ы объектов.
  // Вызывается из Castle.loop после updateDayNight (нужен Castle.daylight).
  static update(castle) {
    if (!CastleWeather.objects.length) return;
    // deltaTime считается от Castle.currentTime, а он скачет после сна цикла (вкладка скрыта,
    // шёл бой) — без среза один такой кадр сдвигал бы фазу падения на несколько секунд
    const dt = Math.min(Math.max(castle.deltaTime || 0, 0), 1);
    CastleWeather.schedule(Date.now());

    const p = CastleWeather.current();
    CastleWeather.travel += p.speed * dt;

    CastleWeather.fullscreenTransform(castle);
    const fall = CastleWeather.fallVec(p.tilt, castle.windDirXY);

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
      w4[3] = fall[2];
      const tint = obj.tintColor;
      tint[0] = p.color[0] * light;
      tint[1] = p.color[1] * light;
      tint[2] = p.color[2] * light;
      tint[3] = p.alpha * gate;
    }
  }
}

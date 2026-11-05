// Uber shader. Leave first line non functional

#ifdef DEFERRED
// G-buffer for opaque objects (CastleLighting): gl_FragData[0] - lit colour before tonemapping,
// [1] - albedo (a - receives point lights), [2] - world normal (a - 1 if the mesh has normals).
// "#extension GL_EXT_draw_buffers" is prepended by Castle.prepareShader (it must precede all code).
// gl_FragColor and gl_FragData cannot be mixed, so the colour is built in fragOut.
vec4 fragOut;
#define FRAG_COLOR fragOut
#else
#define FRAG_COLOR gl_FragColor
#endif

varying vec2 fragTexCoord;

#if defined(VS_UV2) || defined(VS_UV2_UNUSED)
varying vec2 fragTexCoord2;
#endif

#ifdef VS_COLOR
varying vec4 fragColor;
#endif

uniform sampler2D tex0;

#ifdef TEX2
uniform sampler2D tex1;
#endif

#ifdef TEX3
uniform sampler2D tex2;
#endif

#ifdef TEX4
uniform sampler2D tex3;
#endif

#ifdef VS_NORMAL
varying vec3 fragNormal;
#endif

#ifdef RENDER_PASS_COLOR
uniform sampler2D smTexture;
uniform vec4 zNear_zFar;

uniform mat4 lightViewProj;

varying vec4 v_projectedTexcoord;

// Day/night cycle (Castle.updateDayNight): sunLight.rgb - sun colour and strength,
// sunLight.a - exposure; ambientLight.rgb - tint of the light where the sun does not reach.
uniform vec4 sunLight;
uniform vec4 ambientLight;
// Glows (additive blending) stay bright at night: lower bound of the lighting factor (CastleLighting)
uniform float emissive;

// Shadow debug (Castle.setShadowDebug): smColor holds the id of the occluder nearest to the sun.
// shadowDebug.x: 0 - off, 1 - tint shadows with the occluder colour, 2 - output the raw id.
uniform sampler2D smColor;
uniform vec4 shadowDebug;
#endif

#ifdef RENDER_PASS_SM
uniform vec4 smDebugColor;
#endif

#ifdef PS_GRID
varying vec2 posXZ;
uniform vec2 cursorGridPosition;
uniform sampler2D gridTex;
// номер здания в клетке (R — младший байт, G — старший), 0 — пусто; см. Castle.gridIdTex
uniform sampler2D gridIdTex;

float gridCellId(vec2 cellIdx) {
  if (cellIdx.x < 0.0 || cellIdx.y < 0.0) {
    return 0.0;
  }
  vec2 v = texture2D(gridIdTex, (cellIdx + 0.5) / 64.0).rg;
  return floor(v.r * 255.0 + 0.5) + floor(v.g * 255.0 + 0.5) * 256.0;
}
#endif

uniform mat4 mViewProj;
uniform vec4 tintColor;
uniform vec4 uvScale;
#ifndef SNOW
uniform vec2 uvScroll;
#endif

#if defined(SKY_STARS) || defined(WATER_REFLECT)
// ---------------- звёздное небо и отражение неба ----------------
// Общее для неба (SKY_STARS) и воды (WATER_REFLECT): и там, и там нужен один и тот же
// процедурный источник — направление в мир, градиент неба днём и звёзды ночью.
//
// Звёзды привязаны к МИРОВУ направлению, а не к экрану: при обходе камеры вокруг замка они
// стоят на месте, как настоящие, а не скользят по кадру. Решётка — по азимуту и углу места
// (не по «широте/долготе» единичной сферы): у полюсов растяжение меньше.
uniform vec4 nightStars; // x: ночной уровень 0..1 (CastleLighting.nightLevel), y: яркость звёзд, z: сила отражения в воде, w: резерв
uniform vec4 camPos; // мировая позиция камеры (ставится в Castle.setupMainCam)
// время кадра объявлено в убер-ВЕРШИННОЙ программе; во фрагментной его нет — звёздам оно нужно
uniform vec4 time;

float starHash(vec2 p)
{
  p = fract(p * vec2(123.783, 456.234));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y * 0.3123);
}

// Плотность и угловой размер — независимые регуляторы, но считаются одной ячейкой:
// поэтому размер приходится пересчитывать в долях ячейки. Ступень «втрое больше звёзд и
// втрое меньше каждая» = ×√3 по обеим осям решётки (это ×3 ячеек) И ×√3 в делителе размера
// (иначе угол звезды упал бы в 3·√3). Здесь две ступени: решётка ×3 против базовой (20, 26)
// → ×9 звёзд, делитель 3 → угол звезды в 9 раз меньше базового.
const vec2 STAR_GRID = vec2(60.0, 78.0); // ячеек на радиан: базовая (20, 26), ×3 (две ступени по √3)
const float STAR_SIZE_DIV = 3.0; // = √3·√3 — см. вывод выше
// Вклад одной ячейки решётки в точку gp (координаты в единицах ячейки). Пустая ячейка — 0.
float starCell(vec2 cell, vec2 gp, float t, float sizeGain)
{
  float h = starHash(cell);
  if (h < 0.66) return 0.0; // звезда есть не в каждой ячейке
  vec2 c = vec2(starHash(cell + 7.13), starHash(cell + 13.71));
  float r = length(gp - cell - c);
  float size = (0.045 + 0.10 * starHash(cell + 3.37)) * clamp(sizeGain, 1.0, 4.0) / STAR_SIZE_DIV;
  float core = smoothstep(size, 0.0, r);
  float halo = smoothstep(size * 3.5, 0.0, r) * 0.22;
  float mag = 0.30 + 0.70 * starHash(cell + 2.11);
  // Мерцание — СЛУЧАЙНОЕ ПРИБАВЛЕНИЕ яркости: редкий острый вспыль (sin в 4-й степени),
  // а не непрерывный строб; периоды 5..20 с — «не очень быстро».
  float ph = 6.2831853 * starHash(cell + 9.91);
  float spd = 0.32 + 0.68 * starHash(cell + 5.53);
  float flash = pow(0.5 + 0.5 * sin(t * spd + ph), 4.0);
  return (core + halo) * mag * (0.55 + 0.75 * flash);
}

// Яркость звезды по мировому направлению.
// sizeGain — раздувание ядра/ореола той же звезды (позиции не меняются): в отражении воды
// звезда обязана быть КРУПНЕЕ, чем в небе, — отражённое направление по глади меняется
// быстро, и точечная звезда в отражении попадала в доли пикселя.
// Ореол достает за пределы своей ячейки (радиус size*3.5), поэтому суммация идёт по
// соседям 3×3: без этого у звезды, вставшей впритык к границе ячейки, срезается край —
// в кадре это квадратный «пластырь» (замер: при sizeGain 2.4 квадраты видны и в небе,
// и в воде).
float starField(vec3 dir, float t, float sizeGain)
{
  float az = atan(dir.z, dir.x); // -pi..pi
  float el = asin(clamp(dir.y, -1.0, 1.0)); // -pi/2..pi/2
  vec2 g = vec2(az * STAR_GRID.x, (el + 1.5707963) * STAR_GRID.y);
  vec2 base = floor(g);
  float acc = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      acc = max(acc, starCell(base + vec2(float(i), float(j)), g, t, sizeGain));
    }
  }
  return acc;
}

// Цвет неба по направлению: днём — градиент «горизонт → зенит», ночью — тёмная база плюс
// звёзды. Используется только для отражения в воде (там направление зеркальное).
// starGain — множитель звёзд: в отражении звёздное поле тусклее самого неба (луч идёт вниз,
// к глади, и блик размывается), поэтому для воды его поднимают отдельно.
vec3 skyTint(vec3 dir, float t, float starGain, float starSize)
{
#ifdef SCENE_DOCT
  const vec3 zenith = vec3(0.10, 0.30, 0.66);
  const vec3 horizon = vec3(0.66, 0.76, 0.86);
#else
  const vec3 zenith = vec3(0.12, 0.36, 0.58);
  const vec3 horizon = vec3(0.70, 0.82, 0.78);
#endif
  float up = pow(clamp(dir.y, 0.0, 1.0), 0.6);
  vec3 col = mix(horizon, zenith, up);
  float night = clamp(nightStars.x, 0.0, 1.0);
  col = mix(col, vec3(0.035, 0.055, 0.115), night);
  col += vec3(0.75, 0.82, 1.0) * starField(dir, t, starSize) * night * nightStars.y * starGain;
  return col;
}
#endif // SKY_STARS || WATER_REFLECT

vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;

  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;

  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;

  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;

  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

#if defined(SSR) && defined(RENDER_PASS_COLOR)
// ---------------- Screen Space Reflections в воде ----------------
// Источник трассировки — G-buffer отложенного освещения (CastleLighting): цвет (hdr, до
// тонмаппинга, но уже с экспозицией sunLight.a и со сложенными огнями зданий), глубина и
// мировая нормаль. Вода рисуется в прозрачном проходе ПОСЛЕ композита и прямо в экран,
// а экран в WebGL1 не читается — поэтому источник только эти три текстуры, и SSR живёт
// ровно пока жив отложенный путь кадра.
//
// Фолбэк — это НЕ отдельный путь: при conf = 0 отражение остаётся процедурным небом
// skyTint(), то есть кадр совпадает с тем, что было до появления SSR.
//
// Границы GLSL ES 1.00: цикл канонический (индекс, постоянное число итераций), while нет,
// сэмплеры не индексируются динамически — отсюда три отдельных uniform-а вместо массива.
//
// RENDER_PASS_COLOR в условии обязателен: defines-файл подставляется во ВСЕ три программы
// шейдера (цвет, карта теней, G-buffer), а zNear_zFar объявлен только в цветном проходе —
// в программе карты теней (RENDER_PASS_SM) блок не должен компилироваться вовсе.
const int SSR_STEPS = 24; // шагов экранного марша (постоянный бюджет)
const int SSR_REFINE = 5; // бисекций после находки пересечения: без них попадание квантуется
                          // шагом марша (1/24 отрезка) и отражение стены идёт «ступеньками»
const float SSR_EDGE_PX = 4.0; // пикселей у края кадра, где уверенность гаснет
const float SSR_FADE_FROM = 0.6; // доля дистанции, с которой уверенность идёт к нулю

uniform sampler2D ssrHdr; // отражаемый цвет (линейный, до neutral())
uniform sampler2D ssrDepth; // оконная глубина сцены (WEBGL_depth_texture, 24 бит)
uniform sampler2D ssrNormal; // мировая нормаль попадания; a = 0 у объектов без нормалей
uniform vec4 ssrParams; // x: сила (0 — трассировка не выполняется), y: maxDist (м), z: отступ старта (м), w: 1 — карта уверенности
uniform vec4 ssrParams2; // x: потолок уверенности, y: радиус размива на малой дистанции (px), z: прибавка радиуса на полной дистанции (px), w: резерв
uniform vec2 ssrInvSize; // 1/ширина, 1/высота G-buffer

// Линейная дистанция до камеры по оконной глубине — та же формула, что invDepth() в
// композите (castleLighting.js). По оконной глубине сравнивать нельзя: при zNear=10 и
// zFar=6200 всё дальше 1500 м жмётся в d ∈ [0.995, 0.998].
float ssrSceneAxis(vec2 uv)
{
  float d = texture2D(ssrDepth, uv).r;
  float inv = (zNear_zFar.y - d * (zNear_zFar.y - zNear_zFar.x)) / (zNear_zFar.x * zNear_zFar.y);
  return 1.0 / max(inv, 1e-5);
}

// Гасение у краёв кадра: отражение за границей вьюпорта нечем добить, и без fade там
// читается жёсткая рамка.
float ssrEdgeFade(vec2 uv)
{
  vec2 sz = 1.0 / ssrInvSize;
  vec2 px = uv * sz;
  vec2 d = min(px, sz - px);
  return clamp(min(d.x, d.y) / SSR_EDGE_PX, 0.0, 1.0);
}

// Выборка отражённого цвета с размывом. Без него гладкое зеркало показывает марш полосами:
// у скользящего луча отражённая поверхность идёт почти вдоль экрана, и попадание одного
// пикселя растягивается на десятки. Пять тапов (центр + диагонали) дешевле, чем 3×3, а
// вес по альфе не тянет в размыв фон (в G-buffer его нет).
vec3 ssrSample(vec2 uv, float rpx, out float alpha)
{
  vec2 o = rpx * ssrInvSize;
  vec4 c0 = texture2D(ssrHdr, uv);
  vec4 c1 = texture2D(ssrHdr, uv + vec2(-o.x, -o.y));
  vec4 c2 = texture2D(ssrHdr, uv + vec2(o.x, -o.y));
  vec4 c3 = texture2D(ssrHdr, uv + vec2(-o.x, o.y));
  vec4 c4 = texture2D(ssrHdr, uv + vec2(o.x, o.y));
  vec3 acc = neutral(c0.rgb) * (c0.a * 2.0) + (neutral(c1.rgb) + neutral(c2.rgb) + neutral(c3.rgb) + neutral(c4.rgb)) * 0.5;
  float wsum = c0.a * 2.0 + 0.5 * (c1.a + c2.a + c3.a + c4.a);
  alpha = c0.a;
  return wsum > 0.001 ? acc / wsum : vec3(0.0);
}

// Марш по отражённому лучу r из мировой точки глади P.
//
// Шаг — НЕ по мировой длине отрезка: 24 шага по 60 м перескакивают и берег, и башню.
// Пересекается экран: концы отрезка P → P + r·maxDist проецируются один раз, дальше
// точка берётся линейно по экрану (1/w и z/w линейны по экрану точно), а мировая длина
// восстанавливается как maxDist·u. Пересечение — смена знака (ось_луча − ось_сцены),
// затем SSR_REFINE бисекций.
//
// Старт всегда «перед сценой»: воды в G-buffer нет (blend-объект, рисуется после
// композита), поэтому под водой в глубине лежит дно — оно дальше глади, и луч, идущий
// вверх, его не пересекает. Отступ ssrParams.z снимает ложные попадания о берег впритык.
vec3 ssrTrace(vec3 P, vec3 r, out float conf)
{
  conf = 0.0;
  if (ssrParams.x <= 0.0 || r.y <= 0.004) {
    return vec3(0.0); // луч уходит под гладь — данных нет, остаётся небо
  }
  float maxd = max(ssrParams.y, 10.0);
  vec4 c0 = mViewProj * vec4(P, 1.0);
  if (c0.w <= 0.001) {
    return vec3(0.0);
  }
  vec4 c1 = mViewProj * vec4(P + r * maxd, 1.0);
  float uEnd = 1.0;
  if (c1.w <= 0.001) {
    // конец отрезка за камерой: w линеен по отрезку, отсекаем у плоскости камеры
    uEnd = c0.w / max(c0.w - c1.w, 1e-4) * 0.999;
    c1 = mViewProj * vec4(P + r * (maxd * uEnd), 1.0);
  }
  vec2 n0 = c0.xy / c0.w;
  vec2 n1 = c1.xy / c1.w;
  float iz0 = 1.0 / c0.w;
  float iz1 = 1.0 / c1.w;
  float uStart = clamp(ssrParams.z / maxd, 0.0, 0.5);
  float du = (1.0 - uStart) / float(SSR_STEPS);
  float uPrev = uStart;
  for (int i = 1; i <= SSR_STEPS; i++) {
    float u = uStart + float(i) * du;
    vec2 uv = mix(n0, n1, u) * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      break; // луч ушёл за кадр — данных нет
    }
    if (1.0 / mix(iz0, iz1, u) - ssrSceneAxis(uv) > 0.0) {
      // пересечение между uPrev и u — уточняем бисекцией
      float a = uPrev;
      float b = u;
      for (int k = 0; k < SSR_REFINE; k++) {
        float m = 0.5 * (a + b);
        vec2 muv = mix(n0, n1, m) * 0.5 + 0.5;
        if (1.0 / mix(iz0, iz1, m) - ssrSceneAxis(muv) > 0.0) {
          b = m;
        } else {
          a = m;
        }
      }
      float uh = 0.5 * (a + b);
      // длина отрезка после отсечки у камеры — maxd·uEnd, а не maxd
      if (maxd * uEnd * uh < ssrParams.z) {
        uPrev = u;
        continue; // слишком близко к глади — идём дальше
      }
      vec2 uvh = mix(n0, n1, uh) * 0.5 + 0.5;
      vec4 nrm = texture2D(ssrNormal, uvh);
      float facing = 1.0;
      if (nrm.a > 0.5) {
        facing = dot(normalize(nrm.xyz * 2.0 - 1.0), -r);
        if (facing <= 0.0) {
          uPrev = u;
          continue; // задняя грань / тонкий объект — не отражаем
        }
        conf = min(1.0, facing * 2.0);
      } else {
        conf = 0.7; // нормали нет (рельеф, небо) — пониженная уверенность
      }
      conf *= 1.0 - smoothstep(SSR_FADE_FROM, 1.0, uh / max(uEnd, 1e-3));
      conf *= ssrEdgeFade(uvh);
      conf = min(conf, max(ssrParams2.x, 0.0));
      // размыв растёт с дистанцией попадания и с пологостью луча (скользящее попадание
      // растянутее всего)
      float rpx = ssrParams2.y + ssrParams2.z * uh * (1.5 - 0.5 * facing);
      float hitA = 0.0;
      vec3 col = ssrSample(uvh, rpx, hitA);
      if (hitA < 0.5) {
        break; // в G-buffer тут ничего не рисовалось (фон) — данных нет
      }
      return col;
    }
    uPrev = u;
  }
  return vec3(0.0);
}
#endif // SSR && RENDER_PASS_COLOR

void main()
{
#if 0
  #ifdef SCENE_DOCT
    const vec3 lightColor = vec3(1.0, 1.0, 1.0) * 2.2;
    const float shadowContrast = 0.9;
  #else
    const vec3 lightColor = vec3(1.0, 1.0, 1.2) * 1.6;
    const float shadowContrast = 0.8;
  #endif
#endif
  const vec3 lightColor = vec3(1.0, 1.0, 1.0) * 1.6;
  const float shadowContrast = 0.6;

  const float gridFalloffDistance = 50.0;

#ifdef PS_GRID
  // Grid cells (клетка — 7x7 единиц)
  vec2 cell = (posXZ + vec2(126.0, 77.0)) / 7.0;
  vec2 cellIdx = floor(cell);
  vec2 cellFrac = cell - cellIdx;
  // Клетки одного здания сливаются в одну плитку (линия сетки между ними не рисуется),
  // по краю плитки — тёмная обводка: видно, где кончается одно здание и начинается другое.
  float cellId = gridCellId(cellIdx);
  bool sameLeft = cellId > 0.0 && gridCellId(cellIdx - vec2(1.0, 0.0)) == cellId;
  bool sameBack = cellId > 0.0 && gridCellId(cellIdx - vec2(0.0, 1.0)) == cellId;
  bool sameRight = cellId > 0.0 && gridCellId(cellIdx + vec2(1.0, 0.0)) == cellId;
  bool sameFront = cellId > 0.0 && gridCellId(cellIdx + vec2(0.0, 1.0)) == cellId;
  const float gridLine = 1.5 / 7.0;
  const float gridOutline = 1.0 / 7.0;
  bool outline = cellId > 0.0 && (
    (!sameLeft && cellFrac.x >= gridLine && cellFrac.x < gridLine + gridOutline) ||
    (!sameBack && cellFrac.y >= gridLine && cellFrac.y < gridLine + gridOutline) ||
    (!sameRight && cellFrac.x > 1.0 - gridOutline) ||
    (!sameFront && cellFrac.y > 1.0 - gridOutline));
  FRAG_COLOR = vec4(0.0, 0.0, 0.0,
    (sameLeft ? 0.0 : max(0.0, 1.5 - cellFrac.x * 7.0)) + (sameBack ? 0.0 : max(0.0, 1.5 - cellFrac.y * 7.0)));
  FRAG_COLOR.rgb += vec3(FRAG_COLOR.a, FRAG_COLOR.a, 0.1*FRAG_COLOR.a);
  float gridMul = clamp(1.0 - FRAG_COLOR.r * 10000.0, 0.0, 1.0);

  // Grid falloff
  float falloff = sqrt(dot(posXZ - cursorGridPosition, posXZ - cursorGridPosition)) - gridFalloffDistance;
  FRAG_COLOR.a *= 1.0 - falloff;
  FRAG_COLOR.a = (max(0.0, FRAG_COLOR.a - 0.9) / 30.0);
  vec4 gridColor = texture2D(gridTex, (cellIdx + 0.5) / 64.0);
  if (outline && gridColor.a > 0.0) {
    gridColor = vec4(gridColor.rgb * 0.3, 1.0);
  }
  FRAG_COLOR += vec4(gridColor * vec4(gridMul));
  //FRAG_COLOR.a = FRAG_COLOR.a / (1.0 + abs(FRAG_COLOR.a));

  vec3 light = vec3(1.0);
#ifdef RENDER_PASS_SM
  discard; // TODO: Remove from SM pass
#endif
#else
  // Diffuse lighting
  vec3 light = lightColor;
#ifdef VS_NORMAL
  // Debug Render Normals
/*
  FRAG_COLOR = vec4(fragNormal * 0.5 + 0.5, 1.0);
  return;
*/

#ifdef RENDER_PASS_COLOR
  light *= max(0.0, dot(normalize(fragNormal), -normalize(vec3(lightViewProj[0].z, lightViewProj[1].z, lightViewProj[2].z))));
#endif
#endif // VS_NORMAL

  // Albedo
  FRAG_COLOR = texture2D(tex0, (fragTexCoord + uvScroll) * uvScale.xx);

  FRAG_COLOR *= tintColor;
#if defined(PS_FALLOFF_BLEND) && defined(VS_COLOR)
  FRAG_COLOR *= fragColor;
#endif
#if defined(PS_VCOLOR) && defined(VS_COLOR)
  // Дальние холмы (terrain_far_*): вершинный цвет — не маска затухания, а затемнение по
  // высоте (основание темнее, гребень светлее). Отдельный define, а не PS_FALLOFF_BLEND:
  // у PS_FALLOFF_BLEND своя семантика (водопады/туман), и включать её рельефу нельзя.
  FRAG_COLOR *= fragColor;
#endif
#endif // PS_GRID

  // Alpha test
#if defined(PS_ALPHAKILL)
  if (FRAG_COLOR.a - 0.9 < 0.0) {
    discard;
  }
#endif
  #ifndef VS_COLOR
    vec4 fragColor = tintColor;
  #endif
#ifdef TEX2
  FRAG_COLOR = mix(FRAG_COLOR, texture2D(tex0, fragTexCoord * uvScale.yy), fragColor.x);
#endif
#ifdef TEX3
  FRAG_COLOR = mix(FRAG_COLOR, texture2D(tex2, fragTexCoord * uvScale.zz), fragColor.y);
#endif
#ifdef TEX4
  // WTF?
  //FRAG_COLOR += texture2D(tex3, fragTexCoord2 * uvScale.ww) * (1.0 - fragColor.w);
#endif

#ifdef RENDER_PASS_COLOR
  // No division needed since there's only one light with orthogonal projection
  vec3 projectedTexcoord = vec3(v_projectedTexcoord.xy * 0.5 + 0.5, v_projectedTexcoord.z);
  float currentDepth = projectedTexcoord.z * 0.5 + 0.5 - ambientLight.w; // depth bias (Castle.ambientLight)
  float projectedDepth = texture2D(smTexture, projectedTexcoord.xy).r;  
  bool inRange = 
      projectedTexcoord.x >= 0.0 &&
      projectedTexcoord.x <= 1.0 &&
      projectedTexcoord.y >= 0.0 &&
      projectedTexcoord.y <= 1.0;
  float shadowLight = (inRange && projectedDepth <= currentDepth) ? 0.0 : 1.0;

  vec3 shadowDebugTint = vec3(-1.0);
  if (shadowDebug.x > 2.5) {
    // mode 3: shadow map coverage - green inside the light frustum, red outside
    FRAG_COLOR = inRange ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(1.0, 0.0, 0.0, 1.0);
    return;
  }
  if (shadowDebug.x > 0.5) {
    vec4 occluder = texture2D(smColor, projectedTexcoord.xy);
    if (shadowDebug.x > 1.5) {
      FRAG_COLOR = shadowLight < 0.5 ? vec4(occluder.rg, 1.0, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    if (shadowLight < 0.5 && occluder.b > 0.99) {
      float hue = fract((occluder.r * 255.0 + occluder.g * 65280.0) * 0.6180339);
      shadowDebugTint = clamp(abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    }
  }

  // Multiply diffuse by shadow weight (0 or 1)
  light *= shadowLight * sunLight.rgb;

  // Apply lighting (сетка строительства — подсказка, а не часть сцены: не темнеет ни в тени, ни ночью)
#ifndef PS_GRID
  FRAG_COLOR.xyz *= max(max(light, shadowContrast * ambientLight.rgb), vec3(emissive));
  FRAG_COLOR.xyz *= sunLight.a;
#endif

#ifdef DEFERRED
  // albedo — цвет ДО звёзд: точечные огни (CastleLighting) домножают именно его, поэтому
  // звёзды не разгораются от фонарей. Объявлен до выхода в G-buffer ниже.
  vec3 albedo = FRAG_COLOR.xyz;
#endif

#ifdef SKY_STARS
  // Ночное небо: панорама остывает (синий сдвиг) и в неё подмешивается звёздное поле.
  // Ночной уровень тот же, что зажигает огни зданий (CastleLighting.nightLevel), поэтому
  // звёзды появляются на закате и гаснут на рассвете вместе с городом.
  // Блок ДО #ifdef DEFERRED: небо — непрозрачный объект, и при включённом отложенном освещении
  // оно пишется в G-buffer, где выход идёт через gl_FragData и return; после тонмаппинга блок
  // просто не выполнялся бы (замер: звёзды появлялись только с выключенными огнями зданий).
  {
    vec3 sdir = normalize(fragWorldPos - camPos.xyz);
    float night = clamp(nightStars.x, 0.0, 1.0);
    FRAG_COLOR.rgb = mix(FRAG_COLOR.rgb, FRAG_COLOR.rgb * vec3(0.60, 0.72, 1.10) + vec3(0.010, 0.016, 0.036), night);
    FRAG_COLOR.rgb += vec3(0.86, 0.90, 1.0) * starField(sdir, time.x, 1.0) * night * nightStars.y;
  }
#endif

#ifdef DEFERRED
  gl_FragData[0] = vec4(FRAG_COLOR.xyz, 1.0);
  gl_FragData[1] = vec4(clamp(albedo, 0.0, 1.0), tintColor.a > 1.5 ? 0.0 : 1.0); // outline (tint alpha 2) is unlit
#ifdef VS_NORMAL
  gl_FragData[2] = vec4(normalize(fragNormal) * 0.5 + 0.5, 1.0);
#else
  gl_FragData[2] = vec4(0.5, 1.0, 0.5, 0.0);
#endif
  return;
#endif

  // Tonemapping
  FRAG_COLOR.xyz = neutral(FRAG_COLOR.xyz);
#ifdef WATER_REFLECT
  // Отражение неба в воде. Вода плоская и горизонтальная, поэтому нормаль отражения — просто
  // зеркальная Y-составляющая луча зрения; у скользящих лучей (дальше от камеры) отражение
  // сильнее — как у настоящего Френеля. Френель не уходит в ноль и при отвесном взгляде:
  // у гладкой воды нормальное падение отражает ~2%, и это единственное, что даёт ночные
  // звёзды в середине плёса, а не только у дальнего берега.
  // nightStars.w — отдельная прибавка к звёздам именно в отражении (waterStarGain).
  {
    const float WATER_FRES_BASE = 0.06; // отвесный луч: ~2% отражения у воды, здесь — с запасом
    // Размер звезды в отражении ОТНОСИТЕЛЬНО неба. Держали 2.4 («по глади отражённое
    // направление меняется быстрее, точечная звезда попадала в доли пикселя»), но из-за
    // этого блики в лужах стали крупнее звёзд самого неба. Замер разности кадров
    // (вода изолирована фильтром, currentTime заморожен, светлячки выключены; rms-радиус
    // блоба): небо 0.79 px, отражение при 2.4 — 1.62 px, при 1.0 — 0.87 px. То есть 1.0 —
    // та же угловая величина, что в небе; потеря света от меньшей площадки компенсирована
    // waterStarGain (3.0 → 9.0, сумма пиков 15.4k → 15.5k).
    const float WATER_STAR_SIZE = 1.0;
    vec3 rd = normalize(fragWorldPos - camPos.xyz);
    vec3 refl = normalize(vec3(rd.x, -rd.y, rd.z));
    float fres = WATER_FRES_BASE + (1.0 - WATER_FRES_BASE) * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 2.5);
    // Фолбэк — процедурное небо (градиент + звёзды). SSR кладется ПОВЕРХ него по уверенности
    // трассировки: там, где в G-buffer нет данных (небо, прозрачные объекты, выход луча за
    // кадр или за ssrMaxDist), кадр обязан остаться ровно таким, как без SSR.
    vec3 reflCol = skyTint(refl, time.x, max(nightStars.w, 0.0), WATER_STAR_SIZE);
#if defined(SSR) && defined(RENDER_PASS_COLOR)
    if (ssrParams.w > 0.5) {
      // отладка (Castle.ssrDebug): красный — где есть данные SSR, синий — где фолбэк на небо.
      // Альфа = 1 (у глади Доктов альфа-блендинг, иначе карта смешалась бы с подложкой) и
      // выход ЗАМЕНЯЕТ цвет воды, а не складывается с ним: иначе в красный канал лезет
      // член неба и карта перестаёт быть читаемой (замер: днём «синяя» вода давала (36,50,255)).
      float ssrConf = 0.0;
      ssrTrace(fragWorldPos, refl, ssrConf);
      FRAG_COLOR = vec4(clamp(ssrConf, 0.0, 1.0), 0.0, 1.0 - clamp(ssrConf, 0.0, 1.0), 1.0);
    } else {
      float ssrConf = 0.0;
      vec3 ssrCol = ssrTrace(fragWorldPos, refl, ssrConf);
      FRAG_COLOR.rgb += mix(reflCol, ssrCol, clamp(ssrConf, 0.0, 1.0)) * fres * nightStars.z;
    }
#else
    FRAG_COLOR.rgb += reflCol * fres * nightStars.z;
#endif
  }
#endif
  if (shadowDebugTint.x >= 0.0) {
    // tint follows the sun strength, so at night (no direct light, no visible shadows) it is off
    FRAG_COLOR.xyz = mix(FRAG_COLOR.xyz, shadowDebugTint, 0.7 * clamp(sunLight.r, 0.0, 1.0));
  }
#ifdef SNOW
  // Погодный fullscreen-оверлей (CastleWeather): snow() пересобирает цвет целиком — текстура,
  // свет и тонмаппинг у этого объекта не участвуют, цвет и прозрачность берутся из tintColor.
  snow(FRAG_COLOR, fragTexCoord, tintColor);
#endif
  // Exposure
  // FRAG_COLOR.xyz *= pow(2.0, 0.0); // -0.5
#endif
#ifdef RENDER_PASS_SM
  FRAG_COLOR = smDebugColor;
#endif
}
precision highp float;

#define VS_POSITION
#define VS_COLOR
#define VS_UV
#define SNOW

// Погодный fullscreen-оверлей замка (CastleWeather, меши weather_*.bin, рисуются в прозрачном
// проходе поверх всей сцены).
//
// Глубина кадра задана СЛОЯМИ: у ближнего слоя редкие крупные снежинки и быстрое падение, у
// дальнего — частые мелкие и медленное. Все размеры и скорости — в МИРОВЫХ метрах: частица
// радиусом 2 см остаётся 2 см, а на экране она `size/(2*z*tan(fov/2))` высот экрана, то есть
// и зум, и дистанция слоя работают сами.
//
// Координата узора — мировая (varying fragPlanePos из вершинной программы: точка квада,
// спроецированная на оси плоскости квада). Поэтому пан камеры не «тащит» снег за собой —
// камера едет сквозь осадки. Поворот тоже непрерывен: меняются оси плоскости, а не фаза узора.
//
// Направление падения — мировое «вниз» (0,-1,0) с ветром (weather2.x в пунктах 2 и 4),
// спроецированное на плоскость квада: при обходе замка наклон то уходит в «+x» экрана, то
// в «-x», как и должно быть у настоящего ветра.
//
// Дождь — тот же шейдер с другими числами: скорость, длина хвоста (weather.y), радиус
// (weather2.x), наклон, цвет и прозрачность. Отдельного «режима» нет — капсула вдоль
// направления падения при нулевом хвосте сама вырождается в круг.
//
// ФАЗА ПАДЕНИЯ (weather.x) считает CastleWeather как накопленный путь в метрах, а не
// «скорость × время сцены»: при смене скорости или fov произведение дало бы скачок узора на
// тысячи ячеек (визуально — «быстрая перемотка»).
//
// Вызывается из shader.fs.glsl: snow(FRAG_COLOR, fragTexCoord, tintColor).
// tintColor передаётся параметром, а не читается как uniform: этот файл подставляется В НАЧАЛО
// и фрагментной, и вершинной программы (Castle.startProgram), до объявления uniform-ов убер-шейдера.

uniform vec4 weather; // x: накопленный путь падения, м; y: длина хвоста, м; z: плотность (ячеек на метр); w: разброс размеров частиц
uniform vec4 weather2; // x: радиус частицы, м; y: дистанция ближнего слоя, м; z: дистанция дальнего слоя, м; w: расстояние от камеры до плоскости квада, м
uniform vec4 weather3; // x: число слоёв; y: множитель яркости дальнего слоя; zw: мировая позиция камеры в базисе плоскости квада, м
uniform vec4 weather4; // xy: направление падения в базисе плоскости квада (единичное); z: доля ячеек с частицей; w: резерв
uniform vec2 uvScroll; // нужен убер-шейдеру (сэмпл текстуры до snow()); на сам эффект не влияет

varying vec2 fragPlanePos; // мировые метры точки квада в базисе плоскости квада (пишет shader.vs.glsl)

#define SNOW_MAX_LAYERS 8

float hash(vec2 p)
{
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void snow(out vec4 outColor, in vec2 fragCoord, in vec4 tint)
{
    if (tint.a <= 0.0) { // фейд в ноль (CastleWeather) — не гонять цикл по всему кадру
        outColor = vec4(0.0);
        return;
    }

    float layers = clamp(weather3.x, 1.0, float(SNOW_MAX_LAYERS));
    float zNearL = max(weather2.y, 0.05);
    float zFarL = max(weather2.z, zNearL * 1.01);
    float planeDist = max(weather2.w, 0.01);
    vec2 camPlane = weather3.zw;
    vec2 fall = weather4.xy;
    float presence = clamp(weather4.z, 0.0, 1.0);
    float cell = max(weather.z, 0.01); // ячеек на метр — одинаково для всех слоёв

    float cov = 0.0;

    for (int i = 0; i < SNOW_MAX_LAYERS; i++)
    {
        float li = float(i);
        if (li >= layers) break;

        // дистанция слоя: k = 0 у ближнего, 1 у дальнего, между ними — геометрическая прогрессия
        float k = layers > 1.5 ? li / (layers - 1.0) : 0.0;
        float z = zNearL * pow(zFarL / zNearL, k);

        // Мировая точка слоя на том же луче, что и точка квада: плоскость слоя отстоит в z/D раз
        // дальше, и смещение считается ОТ КАМЕРЫ, иначе при панораме дальние слои уезжали бы
        // в другую сторону (camPlane — мировая привязка, без неё узор «плывёт» вокруг начала мира).
        vec2 w = camPlane + (fragPlanePos - camPlane) * (z / planeDist);

        // Сетка сдвигается вдоль направления падения. Целый сдвиг на число ячеек картинку не
        // меняет, если сид ячейки брать со сдвигом обратно: числа остаются мелкими, и частица
        // не «пересевается» на границе ячейки (узор едет жёстко, без pop-in).
        vec2 shift = fall * (weather.x * cell);
        vec2 shiftCells = floor(shift);
        vec2 q = w * cell - fract(shift);
        vec2 gi = floor(q);
        vec2 seed = gi - shiftCells + li * 37.0;

        if (hash(seed) > presence) continue; // частица есть не в каждой ячейке

        vec2 off = vec2(hash(seed * 1.31 + 11.0), hash(seed * 2.17 + 5.0));
        vec2 d = (q - gi - off) / cell; // метры
        float sizeVar = 1.0 + weather.w * (hash(seed + 71.0) - 0.5);
        float rad = max(weather2.x * sizeVar, 0.001);
        float halfLen = max(weather.y * 0.5, 0.0);

        // капсула вдоль направления падения: при halfLen = 0 вырождается в круг (снег)
        vec2 along = fall * clamp(dot(d, fall), -halfLen, halfLen);
        float a = smoothstep(rad, rad * 0.2, length(d - along));
        if (a <= 0.0) continue;

        float bright = 0.55 + 0.45 * hash(seed + 13.0);
        float depthFade = mix(1.0, clamp(weather3.y, 0.0, 1.0), (z - zNearL) / (zFarL - zNearL));
        cov = 1.0 - (1.0 - cov) * (1.0 - a * bright * depthFade * tint.a);
    }

    outColor = vec4(tint.rgb, cov);
}

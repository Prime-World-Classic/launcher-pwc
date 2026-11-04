precision highp float;

#define VS_POSITION
#define VS_COLOR
#define VS_UV
#define SNOW

// Погодный fullscreen-оверлей замка (CastleWeather, меши weather_*.bin, рисуются в прозрачном
// проходе поверх всей сцены).
//
// Глубина кадра задана СЛОЯМИ: у ближнего слоя редкие крупные снежинки и быстрое падение, у
// дальнего — частые мелкие и медленное. Слои разложены геометрической прогрессией по мировым
// дистанциям, а метры переводятся в доли высоты экрана через tan(fov/2) и дистанцию слоя,
// поэтому и размер, и скорость, и частота сетки меняются от слоя к слою в одно и то же число
// раз и картинка не «расползается» при зуме камеры.
//
// Направление падения — вниз с небольшим наклоном (weather2.x = dx на единицу dy). Дождь — это
// тот же шейдер с другими параметрами (пресеты CastleWeather): длинный хвост (weather.y),
// тонкие частицы (weather2.y), высокая скорость (weather.x), отвеснее наклон, другой цвет и
// прозрачность (tintColor). Формы частицы как отдельного параметра нет: капсула вдоль
// направления падения при нулевом хвосте сама вырождается в круг.
//
// Вызывается из shader.fs.glsl: snow(FRAG_COLOR, fragTexCoord, tintColor).
// tintColor передаётся параметром, а не читается как uniform: этот файл подставляется В НАЧАЛО
// и фрагментной, и вершинной программы (Castle.startProgram), до объявления uniform-ов убер-шейдера.

uniform vec4 weather; // x: скорость падения, м/с; y: длина хвоста, м; z: плотность сетки (ячеек на высоту экрана на метр глубины); w: разброс размеров частиц
uniform vec4 weather2; // x: наклон (dx/dy); y: радиус частицы, м; z: дистанция ближнего слоя, м; w: дистанция дальнего слоя, м
uniform vec4 weather3; // x: aspect кадра; y: tan(fov/2); z: число слоёв; w: множитель яркости дальнего слоя
uniform vec2 uvScroll; // y — часы сцены (prepareAndDrawObject множит uvScroll из scenes.json на Castle.currentTime)

#define SNOW_MAX_LAYERS 8

float hash(vec2 p)
{
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void snow(out vec4 outColor, in vec2 fragCoord, in vec4 tint)
{
    if (tint.a <= 0.0) { // CastleWeather.enabled = false — не гонять цикл по всему кадру
        outColor = vec4(0.0);
        return;
    }

    float layers = clamp(weather3.z, 1.0, float(SNOW_MAX_LAYERS));
    float aspect = max(weather3.x, 0.001);
    float tanHalf = max(weather3.y, 0.0001);
    float zNearL = max(weather2.z, 0.05);
    float zFarL = max(weather2.w, zNearL * 1.01);

    // экранные координаты: y — вверх (uv квада совмещён с NDC), x умножен на aspect,
    // чтобы круглые частицы оставались круглыми на любом соотношении сторон
    vec2 p = vec2(fragCoord.x * aspect, fragCoord.y);

    // направление падения: вниз (-y) с небольшим наклоном в +x
    vec2 dir = normalize(vec2(weather2.x, -1.0));
    float fall = weather.x * uvScroll.y;

    float cov = 0.0;

    for (int i = 0; i < SNOW_MAX_LAYERS; i++)
    {
        float li = float(i);
        if (li >= layers) break;

        // дистанция слоя: k = 0 у ближнего, 1 у дальнего, между ними — геометрическая прогрессия
        float k = layers > 1.5 ? li / (layers - 1.0) : 0.0;
        float z = zNearL * pow(zFarL / zNearL, k);
        float inv = 1.0 / (2.0 * z * tanHalf); // метры → доли высоты экрана на дистанции z
        float cell = max(weather.z * z, 0.5); // дальний слой — мельче ячейки (больше частиц на кадр)

        // Сетка сдвигается вдоль направления падения. Целый сдвиг на число ячеек картинку не
        // меняет, если сид ячейки брать со сдвигом обратно: числа остаются мелкими, и частица
        // не «пересевается» на границе ячейки (узор едет жёстко, без pop-in).
        vec2 shift = dir * (fall * inv) * cell;
        vec2 shiftCells = floor(shift);
        vec2 q = p * cell - fract(shift);
        vec2 gi = floor(q);
        vec2 seed = gi - shiftCells + li * 37.0;

        if (hash(seed) > 0.42) continue; // частица есть не в каждой ячейке

        vec2 off = vec2(hash(seed * 1.31 + 11.0), hash(seed * 2.17 + 5.0));
        vec2 d = (q - gi - off) / cell; // вектор к частице, в долях высоты экрана
        float sizeVar = 1.0 + weather.w * (hash(seed + 71.0) - 0.5);
        float rad = max(weather2.y * sizeVar * inv, 0.0002);
        float halfLen = max(weather.y * inv * 0.5, 0.0);

        // капсула вдоль направления падения: при halfLen = 0 вырождается в круг (снег)
        vec2 along = dir * clamp(dot(d, dir), -halfLen, halfLen);
        float a = smoothstep(rad, rad * 0.2, length(d - along));
        if (a <= 0.0) continue;

        float bright = 0.55 + 0.45 * hash(seed + 13.0);
        float depthFade = mix(1.0, clamp(weather3.w, 0.0, 1.0), (z - zNearL) / (zFarL - zNearL));
        cov = 1.0 - (1.0 - cov) * (1.0 - a * bright * depthFade * tint.a);
    }

    outColor = vec4(tint.rgb, cov);
}

precision highp float;

#define VS_POSITION
#define VS_COLOR
#define WATER_REFLECT

// Река и озёра замка Доктов (mesh doct/blend_7_01.bin) с отражением неба. От shader_pos_color
// отличается только этим блоком: та же планарная разметка (без VS_UV убер-шейдер берёт uv из
// vertPosition.xy, масштаб — uvScale 0.001), то же альфа-смешивание поверх рельефа.
//
// У адорнийцев вода отдельная — water_3_* (shader_pos_water_reflect, аддитивная подсветка).
// У Доктов водная гладь лежит в blend_*: иска по имени меша («water») её не находит.
//
// precision — highp: отражение считается по мировой позиции фрагмента (~1400…5200 ед.), в
// mediump направление разворота дрожит и звёзды в воде «кипят».
//
// varying объявлен здесь: defines-файл подставляется в начало обеих программ.
varying vec3 fragWorldPos;

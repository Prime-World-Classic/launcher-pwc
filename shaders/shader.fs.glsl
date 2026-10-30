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
#ifdef SNOW
varying float posDepth;
#endif

uniform mat4 mViewProj;
uniform vec4 tintColor;
uniform vec4 uvScale;
#ifndef SNOW
uniform vec2 uvScroll;
#endif

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

#ifdef DEFERRED
  vec3 albedo = FRAG_COLOR.xyz;
#endif

  // Apply lighting (сетка строительства — подсказка, а не часть сцены: не темнеет ни в тени, ни ночью)
#ifndef PS_GRID
  FRAG_COLOR.xyz *= max(max(light, shadowContrast * ambientLight.rgb), vec3(emissive));
  FRAG_COLOR.xyz *= sunLight.a;
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
  if (shadowDebugTint.x >= 0.0) {
    // tint follows the sun strength, so at night (no direct light, no visible shadows) it is off
    FRAG_COLOR.xyz = mix(FRAG_COLOR.xyz, shadowDebugTint, 0.7 * clamp(sunLight.r, 0.0, 1.0));
  }
#ifdef SNOW
  snow(FRAG_COLOR, fragTexCoord * uvScale.zw);
  FRAG_COLOR.w *= posDepth * 0.002;
#endif
  // Exposure
  // FRAG_COLOR.xyz *= pow(2.0, 0.0); // -0.5
#endif
#ifdef RENDER_PASS_SM
  FRAG_COLOR = smDebugColor;
#endif
}
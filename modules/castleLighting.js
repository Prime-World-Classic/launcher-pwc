import * as vec3 from './glMatrix/vec3.js';
import * as vec4 from './glMatrix/vec4.js';
import * as mat4 from './glMatrix/mat4.js';

// Отложенное освещение замка: непрозрачные объекты пишутся в G-buffer (освещённый солнцем цвет до
// тонмаппинга, альбедо, нормаль, глубина), поверх него складываются точечные источники света зданий,
// затем тонмаппинг + FXAA в экран с переносом глубины — прозрачные объекты рисуются как раньше (forward).
// WebGL1 + расширения (WEBGL_draw_buffers, WEBGL_depth_texture, half float, EXT_frag_depth); без них
// замок рисуется старым путём, без точечных источников.
export class CastleLighting {
  static supported = false;
  static checked = false;
  static ext = {};
  static width = 0;
  static height = 0;
  static gbufferFBO = null;
  static lightFBO = null;
  static hdrTexture = null;
  static albedoTexture = null;
  static normalTexture = null;
  static depthTexture = null;
  static lightProgram = null;
  static compositeProgram = null;
  static lightBuffer = null;
  static quadBuffer = null;
  static lights = []; // источники кадра: { pos: [x,y,z], color: [r,g,b], radius, intensity, flicker }
  static debugMarkers = false;

  // Ночная сила источников и свечений (0 днём, 1 ночью), выставляет Castle.updateDayNight
  static nightLevel = 0;
  static dayLevel = 0; // доля силы источников днём
  static intensityScale = 1;

  static init(gl) {
    if (CastleLighting.checked) return CastleLighting.supported;
    CastleLighting.checked = true;
    const ext = {
      drawBuffers: gl.getExtension('WEBGL_draw_buffers'),
      depthTexture: gl.getExtension('WEBGL_depth_texture'),
      halfFloat: gl.getExtension('OES_texture_half_float'),
      halfFloatLinear: gl.getExtension('OES_texture_half_float_linear'),
      colorBufferHalfFloat: gl.getExtension('EXT_color_buffer_half_float'),
      fragDepth: gl.getExtension('EXT_frag_depth'),
    };
    CastleLighting.ext = ext;
    if (!ext.drawBuffers || !ext.depthTexture || !ext.halfFloat || !ext.colorBufferHalfFloat || !ext.fragDepth) {
      console.warn('CastleLighting: нет нужных расширений WebGL, точечные источники выключены', Object.keys(ext).filter((k) => !ext[k]));
      return false;
    }
    if (gl.getParameter(ext.drawBuffers.MAX_DRAW_BUFFERS_WEBGL) < 3 || gl.getParameter(ext.drawBuffers.MAX_COLOR_ATTACHMENTS_WEBGL) < 3) {
      console.warn('CastleLighting: меньше трёх render target');
      return false;
    }
    CastleLighting.lightProgram = CastleLighting.buildProgram(gl, LIGHT_VS, LIGHT_FS);
    CastleLighting.compositeProgram = CastleLighting.buildProgram(gl, QUAD_VS, COMPOSITE_FS);
    if (!CastleLighting.lightProgram || !CastleLighting.compositeProgram) return false;
    CastleLighting.lightBuffer = gl.createBuffer();
    CastleLighting.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, CastleLighting.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    CastleLighting.supported = CastleLighting.resize(gl, gl.drawingBufferWidth, gl.drawingBufferHeight);
    return CastleLighting.supported;
  }

  static buildProgram(gl, vsText, fsText) {
    const compile = (type, text) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('CastleLighting: ошибка шейдера', gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vsText);
    const fs = compile(gl.FRAGMENT_SHADER, fsText);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('CastleLighting: ошибка линковки', gl.getProgramInfoLog(prog));
      return null;
    }
    const uniforms = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i);
      uniforms[info.name] = gl.getUniformLocation(prog, info.name);
    }
    const attribs = {};
    const attribCount = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < attribCount; i++) {
      const info = gl.getActiveAttrib(prog, i);
      attribs[info.name] = gl.getAttribLocation(prog, info.name);
    }
    return { prog, uniforms, attribs };
  }

  static createTexture(gl, format, type, filter) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, CastleLighting.width, CastleLighting.height, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  // (Пере)создание G-buffer под размер холста. false — FBO неполный (драйвер не умеет такой формат).
  static resize(gl, width, height) {
    if (width === CastleLighting.width && height === CastleLighting.height && CastleLighting.gbufferFBO) return true;
    const db = CastleLighting.ext.drawBuffers;
    for (const t of [CastleLighting.hdrTexture, CastleLighting.albedoTexture, CastleLighting.normalTexture, CastleLighting.depthTexture]) {
      if (t) gl.deleteTexture(t);
    }
    if (CastleLighting.gbufferFBO) gl.deleteFramebuffer(CastleLighting.gbufferFBO);
    if (CastleLighting.lightFBO) gl.deleteFramebuffer(CastleLighting.lightFBO);

    CastleLighting.width = width;
    CastleLighting.height = height;
    // В WebGL1 (WEBGL_draw_buffers) у всех целей MRT должна быть одна разрядность — все три half float.
    // hdr — LINEAR для FXAA (выборки между пикселями), если драйвер умеет фильтровать half float.
    const half = CastleLighting.ext.halfFloat.HALF_FLOAT_OES;
    CastleLighting.hdrTexture = CastleLighting.createTexture(gl, gl.RGBA, half, CastleLighting.ext.halfFloatLinear ? gl.LINEAR : gl.NEAREST);
    CastleLighting.albedoTexture = CastleLighting.createTexture(gl, gl.RGBA, half, gl.NEAREST);
    CastleLighting.normalTexture = CastleLighting.createTexture(gl, gl.RGBA, half, gl.NEAREST);
    CastleLighting.depthTexture = CastleLighting.createTexture(gl, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);

    CastleLighting.gbufferFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, CastleLighting.gbufferFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, db.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, CastleLighting.hdrTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, db.COLOR_ATTACHMENT1_WEBGL, gl.TEXTURE_2D, CastleLighting.albedoTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, db.COLOR_ATTACHMENT2_WEBGL, gl.TEXTURE_2D, CastleLighting.normalTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, CastleLighting.depthTexture, 0);
    const gbufferOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    // источники пишут только в hdr: альбедо, нормаль и глубина читаются как текстуры
    CastleLighting.lightFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, CastleLighting.lightFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, CastleLighting.hdrTexture, 0);
    const lightOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!gbufferOk || !lightOk) {
      console.warn('CastleLighting: G-buffer не собирается (FBO incomplete), точечные источники выключены');
      return false;
    }
    return true;
  }

  // Начало кадра: G-buffer вместо экрана. Фон (где нет геометрии) — hdr.a = 0, композит выводит его как есть.
  static beginGBuffer(gl, clearColor) {
    if (!CastleLighting.resize(gl, gl.drawingBufferWidth, gl.drawingBufferHeight)) {
      CastleLighting.supported = false;
      return false;
    }
    const db = CastleLighting.ext.drawBuffers;
    gl.bindFramebuffer(gl.FRAMEBUFFER, CastleLighting.gbufferFBO);
    db.drawBuffersWEBGL([db.COLOR_ATTACHMENT0_WEBGL, db.COLOR_ATTACHMENT1_WEBGL, db.COLOR_ATTACHMENT2_WEBGL]);
    gl.viewport(0, 0, CastleLighting.width, CastleLighting.height);
    gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    return true;
  }

  // Точечные источники (сложение в hdr) и вывод на экран: тонмаппинг, FXAA, глубина в буфер экрана.
  static finish(gl, castle) {
    const strength = CastleLighting.currentStrength();
    if (strength > 0.001 && CastleLighting.lights.length) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, CastleLighting.lightFBO);
      gl.viewport(0, 0, CastleLighting.width, CastleLighting.height);
      CastleLighting.drawLights(gl, castle, strength);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const p = CastleLighting.compositeProgram;
    gl.useProgram(p.prog);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, CastleLighting.hdrTexture);
    gl.uniform1i(p.uniforms.hdrTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, CastleLighting.depthTexture);
    gl.uniform1i(p.uniforms.depthTex, 1);
    gl.uniform2f(p.uniforms.invSize, 1 / CastleLighting.width, 1 / CastleLighting.height);
    gl.uniform2f(p.uniforms.zNearFar, castle.zNear, castle.zFar);
    CastleLighting.drawQuad(gl, p);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
  }

  static drawQuad(gl, p) {
    gl.bindBuffer(gl.ARRAY_BUFFER, CastleLighting.quadBuffer);
    const loc = p.attribs.aPos;
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 8, 0);
    gl.enableVertexAttribArray(loc);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  static currentStrength() {
    const night = CastleLighting.nightLevel;
    return (CastleLighting.dayLevel + (1 - CastleLighting.dayLevel) * night) * CastleLighting.intensityScale;
  }

  // Каждый источник — прямоугольник экрана, покрывающий его сферу; освещение считается в шейдере.
  static drawLights(gl, castle, strength) {
    const viewProj = castle.viewProjMatr;
    const t = castle.currentTime;
    const data = [];
    const corner = vec4.create();
    let count = 0;
    for (const light of CastleLighting.lights) {
      const r = light.radius;
      const c = light.pos;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let behind = false;
      for (let i = 0; i < 8; i++) {
        vec4.transformMat4(corner, [c[0] + (i & 1 ? r : -r), c[1] + (i & 2 ? r : -r), c[2] + (i & 4 ? r : -r), 1], viewProj);
        if (corner[3] <= 1e-3) {
          behind = true;
          break;
        }
        const x = corner[0] / corner[3], y = corner[1] / corner[3];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      if (behind) {
        minX = minY = -1;
        maxX = maxY = 1;
      }
      minX = Math.max(minX, -1);
      minY = Math.max(minY, -1);
      maxX = Math.min(maxX, 1);
      maxY = Math.min(maxY, 1);
      if (minX >= maxX || minY >= maxY) continue;
      // мерцание огня: две несоизмеримые синусоиды со сдвигом фазы по позиции
      let k = light.intensity * strength;
      if (light.flicker) {
        const ph = c[0] * 0.37 + c[2] * 0.61;
        k *= 1 - light.flicker * (0.5 + 0.25 * Math.sin(t * 7.3 + ph) + 0.25 * Math.sin(t * 13.1 + ph * 1.7));
      }
      const col = [light.color[0] * k, light.color[1] * k, light.color[2] * k];
      const verts = [
        [minX, minY],
        [maxX, minY],
        [minX, maxY],
        [minX, maxY],
        [maxX, minY],
        [maxX, maxY],
      ];
      for (const v of verts) data.push(v[0], v[1], c[0], c[1], c[2], r, col[0], col[1], col[2]);
      count++;
    }
    if (!count) return;

    const p = CastleLighting.lightProgram;
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, CastleLighting.lightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    const stride = 9 * 4;
    gl.vertexAttribPointer(p.attribs.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(p.attribs.aPos);
    gl.vertexAttribPointer(p.attribs.aLight, 4, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(p.attribs.aLight);
    gl.vertexAttribPointer(p.attribs.aColor, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(p.attribs.aColor);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, CastleLighting.albedoTexture);
    gl.uniform1i(p.uniforms.albedoTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, CastleLighting.normalTexture);
    gl.uniform1i(p.uniforms.normalTex, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, CastleLighting.depthTexture);
    gl.uniform1i(p.uniforms.depthTex, 2);
    gl.uniformMatrix4fv(p.uniforms.viewProjInv, false, castle.viewProjInv);
    gl.uniform2f(p.uniforms.invSize, 1 / CastleLighting.width, 1 / CastleLighting.height);
    gl.uniform1f(p.uniforms.debugMarkers, CastleLighting.debugMarkers ? 1 : 0);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, count * 6);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disableVertexAttribArray(p.attribs.aLight);
    gl.disableVertexAttribArray(p.attribs.aColor);
  }

  // ---- Источники зданий ------------------------------------------------------------------------
  // Источники не расставлены руками: в моделях зданий и декора есть свечения (FX-меши с аддитивным
  // смешиванием — огни, кристаллы, фонари). В центре каждого свечения ставим источник цвета его
  // текстуры, близкие свечения одного здания сливаем. Ручные поправки — buildingLightOverrides.
  static mergeDistance = 6;
  static minRadius = 14;
  static maxRadius = 45;
  static defaultIntensity = 1.6;

  // Поправки по зданиям: { 'ad:tavern': { scale, add: [{ pos (локальные), color, radius, intensity, flicker }], skip: true } }
  static buildingLightOverrides = {};

  // Локальные (до поворота/сдвига здания) источники каждого здания сцены
  static buildTemplates(castle) {
    const templates = {};
    for (const name in castle.sceneBuildings) {
      const building = castle.sceneBuildings[name];
      const key = castle.currentSceneName + ':' + name;
      const override = CastleLighting.buildingLightOverrides[key] || {};
      if (name === 'grid' || override.skip) {
        templates[name] = [];
        continue;
      }
      const glows = [];
      for (const obj of building.transparentObjects) {
        const glow = CastleLighting.glowOf(castle, obj);
        if (glow) glows.push(glow);
      }
      const lights = CastleLighting.clusterGlows(glows);
      for (const l of lights) l.intensity *= override.scale ?? 1;
      for (const a of override.add || []) lights.push({ intensity: CastleLighting.defaultIntensity, flicker: 0, ...a });
      templates[name] = lights;
    }
    CastleLighting.templates = templates;
    return templates;
  }

  static isAdditive(obj) {
    return obj.blend && obj.blend[1] === 'ONE';
  }

  // Центр и размер свечения в координатах здания, цвет — средний цвет текстуры (и вершин)
  static glowOf(castle, obj) {
    if (!CastleLighting.isAdditive(obj) || !obj.meshData || !obj.meshData.bboxMin) return null;
    const avg = castle.sceneTextureAvg && castle.sceneTextureAvg[obj.textureId];
    if (!avg || avg[3] < 0.02) return null;
    const lo = obj.meshData.bboxMin, hi = obj.meshData.bboxMax;
    const t = obj.transform || [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
    // transform хранится построчно (как в шейдере после транспонирования в drawObject)
    const tp = (p) => [
      t[0] * p[0] + t[1] * p[1] + t[2] * p[2] + t[3],
      t[4] * p[0] + t[5] * p[1] + t[6] * p[2] + t[7],
      t[8] * p[0] + t[9] * p[1] + t[10] * p[2] + t[11],
    ];
    const a = tp(lo), b = tp(hi);
    const center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const size = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let color = [avg[0], avg[1], avg[2]];
    const tint = obj.tintColor;
    if (tint) color = color.map((x, i) => x * tint[i]);
    if (obj.meshData.avgColor && obj.shader === 'shader_pos_color_uv_falloff') {
      color = color.map((x, i) => x * obj.meshData.avgColor[i]);
    }
    const peak = Math.max(color[0], color[1], color[2]);
    if (peak < 0.05) return null;
    // нормируем цвет к яркости 1: силу задаёт intensity, а не яркость текстуры
    color = color.map((x) => x / peak);
    return { center, size, color, weight: avg[3] * Math.max(1, size) };
  }

  static clusterGlows(glows) {
    const clusters = [];
    for (const g of glows) {
      const c = clusters.find((cl) => vec3.distance(cl.center, g.center) < CastleLighting.mergeDistance + (cl.size + g.size) * 0.15);
      if (c) {
        const w = c.weight + g.weight;
        for (let k = 0; k < 3; k++) {
          c.center[k] = (c.center[k] * c.weight + g.center[k] * g.weight) / w;
          c.color[k] = (c.color[k] * c.weight + g.color[k] * g.weight) / w;
        }
        c.size = Math.max(c.size, g.size, vec3.distance(c.center, g.center) * 2);
        c.weight = w;
      } else {
        clusters.push({ center: g.center.slice(), color: g.color.slice(), size: g.size, weight: g.weight });
      }
    }
    return clusters.map((c) => ({
      pos: c.center,
      color: c.color,
      radius: Math.min(CastleLighting.maxRadius, Math.max(CastleLighting.minRadius, c.size * 2.5)),
      intensity: CastleLighting.defaultIntensity,
      flicker: 0.15,
    }));
  }

  // Источники кадра из расставленных зданий
  static collectLights(buildingsToDraw) {
    const lights = [];
    const rot = mat4.create();
    const p = vec3.create();
    for (const b of buildingsToDraw) {
      if (b.outlined) continue; // фантом при постройке не светит
      const list = CastleLighting.templates && CastleLighting.templates[b.name];
      if (!list || !list.length) continue;
      mat4.fromRotation(rot, b.rotation, [0, 1, 0]);
      for (const l of list) {
        vec3.transformMat4(p, l.pos, rot);
        lights.push({
          pos: [p[0] + b.translation[0], p[1] + b.translation[1], p[2] + b.translation[2]],
          color: l.color,
          radius: l.radius,
          intensity: l.intensity,
          flicker: l.flicker,
          building: b.name,
        });
      }
    }
    CastleLighting.lights = lights;
    return lights;
  }

  // Средний цвет текстуры (с учётом альфы) — для цвета источника
  static averageColor(image) {
    try {
      const n = 16;
      const canvas = document.createElement('canvas');
      canvas.width = n;
      canvas.height = n;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, n, n);
      const px = ctx.getImageData(0, 0, n, n).data;
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < px.length; i += 4) {
        const w = px[i + 3] / 255;
        r += (px[i] / 255) * w;
        g += (px[i + 1] / 255) * w;
        b += (px[i + 2] / 255) * w;
        a += w;
      }
      const count = px.length / 4;
      return a > 0 ? [r / a, g / a, b / a, a / count] : [0, 0, 0, 0];
    } catch (e) {
      return null;
    }
  }
}

const QUAD_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const LIGHT_VS = `
attribute vec2 aPos;
attribute vec4 aLight;
attribute vec3 aColor;
varying vec4 vLight;
varying vec3 vColor;
void main() {
  vLight = aLight;
  vColor = aColor;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const LIGHT_FS = `
precision highp float;
uniform sampler2D albedoTex;
uniform sampler2D normalTex;
uniform sampler2D depthTex;
uniform mat4 viewProjInv;
uniform vec2 invSize;
uniform float debugMarkers;
varying vec4 vLight;
varying vec3 vColor;
void main() {
  vec2 uv = gl_FragCoord.xy * invSize;
  float depth = texture2D(depthTex, uv).r;
  if (depth >= 1.0) discard;
  vec4 albedo = texture2D(albedoTex, uv);
  vec4 world = viewProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 pos = world.xyz / world.w;
  vec3 toLight = vLight.xyz - pos;
  float dist = length(toLight);
  float radius = vLight.w;
  if (debugMarkers > 0.5 && dist < radius * 0.06 + 0.6) {
    gl_FragColor = vec4(vColor * 8.0 + 2.0, 0.0);
    return;
  }
  if (dist >= radius || albedo.a < 0.5) discard;
  // мягкое затухание к краю радиуса (квадратичное по расстоянию, ноль на границе)
  float x = dist / radius;
  float falloff = (1.0 - x * x);
  falloff = falloff * falloff / (1.0 + 8.0 * x * x);
  vec4 n = texture2D(normalTex, uv);
  float ndl = 1.0;
  if (n.a > 0.5) {
    // half-lambert: стены, повёрнутые от источника, не проваливаются в черноту
    float d = dot(normalize(n.xyz * 2.0 - 1.0), toLight / max(dist, 1e-3));
    ndl = clamp(d * 0.6 + 0.4, 0.0, 1.0);
  }
  gl_FragColor = vec4(albedo.rgb * vColor * (falloff * ndl), 0.0);
}`;

// Тонмаппинг neutral() — тот же, что в shader.fs.glsl; FXAA (упрощённый, по яркости) на результате,
// только на краях геометрии (geometryEdge), текстуры остаются чёткими.
const COMPOSITE_FS = `
#extension GL_EXT_frag_depth : require
precision highp float;
uniform sampler2D hdrTex;
uniform sampler2D depthTex;
uniform vec2 invSize;
uniform vec2 zNearFar;
varying vec2 vUv;

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

vec3 ldr(vec2 uv) {
  vec4 c = texture2D(hdrTex, uv);
  // фон (нет геометрии) — как есть, как цвет очистки экрана раньше
  return c.a > 0.5 ? neutral(c.rgb) : c.rgb;
}

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// 1 / расстояние от камеры по глубине окна (перспектива zNear..zFar)
float invDepth(vec2 uv) {
  float d = texture2D(depthTex, uv).r;
  return (zNearFar.y - d * (zNearFar.y - zNearFar.x)) / (zNearFar.x * zNearFar.y);
}

// Край геометрии (силуэт на фоне другой поверхности). FXAA смотрит только на яркость и без этой маски
// замыливал контрастные текстуры (камень, черепица, трава). 1/z на любой плоскости линейна по экрану:
// вторая разность ~0 на гранях и изломах стен и большая на разрыве глубины, в т.ч. у низких зданий на земле.
bool geometryEdge() {
  vec2 dx = vec2(invSize.x, 0.0), dy = vec2(0.0, invSize.y);
  float iM = invDepth(vUv);
  float eX = abs(invDepth(vUv - dx) + invDepth(vUv + dx) - 2.0 * iM);
  float eY = abs(invDepth(vUv - dy) + invDepth(vUv + dy) - 2.0 * iM);
  return max(eX, eY) > 0.01 * iM;
}

void main() {
  vec3 rgbM = ldr(vUv);
  if (!geometryEdge()) {
    gl_FragColor = vec4(rgbM, 1.0);
    gl_FragDepthEXT = texture2D(depthTex, vUv).r;
    return;
  }
  vec3 rgbNW = ldr(vUv + vec2(-1.0, -1.0) * invSize);
  vec3 rgbNE = ldr(vUv + vec2(1.0, -1.0) * invSize);
  vec3 rgbSW = ldr(vUv + vec2(-1.0, 1.0) * invSize);
  vec3 rgbSE = ldr(vUv + vec2(1.0, 1.0) * invSize);
  float lM = luma(rgbM), lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec3 color = rgbM;
  if (lMax - lMin > max(0.0312, lMax * 0.125)) {
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * invSize;
    vec3 rgbA = 0.5 * (ldr(vUv + dir * (1.0 / 3.0 - 0.5)) + ldr(vUv + dir * (2.0 / 3.0 - 0.5)));
    vec3 rgbB = rgbA * 0.5 + 0.25 * (ldr(vUv + dir * -0.5) + ldr(vUv + dir * 0.5));
    float lB = luma(rgbB);
    color = (lB < lMin || lB > lMax) ? rgbA : rgbB;
  }
  gl_FragColor = vec4(color, 1.0);
  gl_FragDepthEXT = texture2D(depthTex, vUv).r;
}`;

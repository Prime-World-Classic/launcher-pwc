// WebGL2-рендер «Мастерской свитков»: статические и скиннинговые модели PW
// (конвертер: tools/pw-convert/pwmodel.py), скелетная анимация 30 fps, спрайты.
import * as mat4 from '../glMatrix/mat4.js';
import * as quat from '../glMatrix/quat.js';

// Пути — относительно самого модуля (content/modules/easel/), а не документа. Путь — через переменную:
// литерал в new URL('...', import.meta.url) dev-сервер Vite переписывает как ассет и теряет «/» на конце.
const CONTENT_REL = '../../';
export const CONTENT_BASE = new URL(CONTENT_REL, import.meta.url).href;
export const EASEL_BASE = CONTENT_BASE + 'easel/';

export async function fetchOk(url, type = 'json') {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Не удалось загрузить ${url}`);
  }
  if (!res.ok) throw new Error(`Не удалось загрузить ${url} (${res.status})`);
  return type === 'json' ? res.json() : type === 'blob' ? res.blob() : res.arrayBuffer();
}
const MAX_BONES = 32;
const ANIM_FPS = 30;

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
layout(location=2) in vec2 aUv;
#ifdef SKIN
layout(location=3) in vec4 aJoints;
layout(location=4) in vec4 aWeights;
uniform mat4 uBones[${MAX_BONES}];
#endif
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vNorm;
out vec2 vUv;
out vec3 vWorld;
void main() {
  vec4 p = vec4(aPos, 1.0);
  vec3 n = aNorm;
#ifdef SKIN
  mat4 s = uBones[int(aJoints.x)] * aWeights.x + uBones[int(aJoints.y)] * aWeights.y +
           uBones[int(aJoints.z)] * aWeights.z + uBones[int(aJoints.w)] * aWeights.w;
  p = s * p;
  n = mat3(s) * n;
#endif
  vec4 w = uModel * p;
  vWorld = w.xyz;
  vNorm = mat3(uModel) * n;
  vUv = aUv;
  gl_Position = uViewProj * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vNorm;
in vec2 vUv;
in vec3 vWorld;
uniform sampler2D uTex;
uniform vec4 uTint;
uniform vec4 uAdd;
uniform vec3 uLightDir;
uniform vec3 uEye;
uniform int uKind;
uniform float uAlphaTest; // > 0 — непрозрачный проход с альфа-тестом (renderState.alphaTest On, ref 127)
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUv) * uTint;
  if (uAlphaTest > 0.0) {
    if (t.a < uAlphaTest) discard;
    t.a = 1.0;
  }
  if (uKind == 2) { outColor = vec4(t.rgb + uAdd.rgb, t.a); return; }
  vec3 n = normalize(vNorm);
  if (!gl_FrontFacing) n = -n;
  float d = max(dot(n, uLightDir), 0.0);
  vec3 c = t.rgb * (0.55 + 0.65 * d);
  if (uKind == 1) {
    vec3 v = normalize(uEye - vWorld);
    vec3 h = normalize(v + uLightDir);
    float s = pow(max(dot(n, h), 0.0), 48.0);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
    c = t.rgb * (0.65 + 0.5 * d) + vec3(s * 0.9) + t.rgb * rim * 0.5;
  }
  outColor = vec4(c + uAdd.rgb, t.a);
}`;

// Порт Render/Shaders/PaintMaterial.hlsl (paintMode InWork): маска делит картину на фрагменты (значение ≈ 10·(id+1)),
// uFrag[id] — заполнение фрагмента: 0..1 — черновик проступает по карте растекания (FullBackground.a),
// 1..2 — переход к готовой картине (CompletePaint). Вне масок (id > uMasks) — BaseBackground.
const PAINT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDraft;
uniform sampler2D uFull;
uniform sampler2D uBase;
uniform sampler2D uComplete;
uniform sampler2D uMask;
uniform float uFrag[40];
uniform int uMasks;
uniform float uFinal;
out vec4 outColor;
void main() {
  vec3 draft = texture(uDraft, vUv).rgb;
  vec4 full = texture(uFull, vUv);
  vec3 base = texture(uBase, vUv).rgb;
  vec3 comp = texture(uComplete, vUv).rgb;
  float m = texture(uMask, vUv).r * 255.0;
  int idx = min(int(ceil((m - 5.0) / 10.0)) - 1, uMasks);
  float fade = idx >= 0 ? uFrag[idx] : 0.0;
  float maskTotal = step(m, 14.0 + float(uMasks) * 10.0 + 0.5);
  float fillDraft = clamp(1.0 - fade, 0.0, 1.0);
  float flow = full.a;
  float a = smoothstep(fillDraft, fillDraft + 0.1, flow) * smoothstep(0.05, 0.1, flow);
  vec3 c = mix(full.rgb, draft, a);
  c = mix(c, comp, clamp(fade - 1.0, 0.0, 1.0));
  c = mix(c, comp, uFinal);
  outColor = vec4(mix(base, c, maskTotal), 1.0);
}`;

// Эффекты PW (easelFx.js): BasicFXMaterial — color = mul·tex(uv + offset) + add, opacity (BlendOpacity: a·op,
// AdditiveOpacity: rgb·op), × цвет вершин; ParticleFXMaterial — saturate(c0·tex + c1), c0/c1 уже посчитаны на CPU.
// Выход премультиплицирован (blend ONE, ONE_MINUS_SRC_ALPHA): LerpByAlpha — (rgb·a, a), AddColorMulAlpha — (rgb·a, 0), Off — (rgb, 1).
const FX_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in vec4 aCol;
layout(location=3) in vec4 aCol2;
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec2 uUvOff;
out vec2 vUv;
out vec4 vCol;
out vec4 vCol2;
void main() {
  vUv = aUv + uUvOff;
  vCol = aCol;
  vCol2 = aCol2;
  gl_Position = uViewProj * (uModel * vec4(aPos, 1.0));
}`;

const FX_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vCol;
in vec4 vCol2;
uniform sampler2D uTex;
uniform vec4 uMul;
uniform vec4 uAdd;
uniform float uOpacity;
uniform int uOpMode; // 0 simple, 1 blend, 2 additive
uniform int uVc;
uniform int uParticle;
uniform int uBlend; // 0 lerp, 1 add, 2 off
uniform ivec2 uAddr; // 0 wrap, 1 clamp, 2 border; V меша хранится как -v PW, D3D v = t WebGL
out vec4 outColor;
void main() {
  vec2 uv = vec2(vUv.x, -vUv.y);
  if (uAddr.x == 1) uv.x = clamp(uv.x, 0.0, 1.0);
  if (uAddr.y == 1) uv.y = clamp(uv.y, 0.0, 1.0);
  vec4 t = texture(uTex, uParticle == 1 ? vUv : uv); // частицы — уже в координатах атласа
  if ((uAddr.x == 2 && (uv.x < 0.0 || uv.x > 1.0)) || (uAddr.y == 2 && (uv.y < 0.0 || uv.y > 1.0))) t = vec4(0.0);
  vec4 c;
  if (uParticle == 1) {
    c = clamp(vCol * t + vCol2, 0.0, 1.0);
  } else {
    c = uMul * t + uAdd;
    if (uOpMode == 1) c.a *= uOpacity;
    else if (uOpMode == 2) c.rgb *= uOpacity;
    if (uVc == 1) c *= vCol;
    c = clamp(c, 0.0, 1.0);
  }
  if (uBlend == 2) outColor = vec4(c.rgb, 1.0);
  else outColor = vec4(c.rgb * c.a, uBlend == 0 ? c.a : 0.0);
}`;

function compile(gl, defines, fs = FS, names = null, vs = VS) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src.replace('#version 300 es', '#version 300 es\n' + defines));
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('easel shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('easel link: ' + gl.getProgramInfoLog(p));
  const u = {};
  for (const n of names || ['uModel', 'uViewProj', 'uTex', 'uTint', 'uAdd', 'uLightDir', 'uEye', 'uKind', 'uBones', 'uAlphaTest']) {
    u[n] = gl.getUniformLocation(p, n);
  }
  return { p, u };
}

// Скелет + анимации: позы считаются на CPU, матрицы скиннинга уходят в uniform-массив
// Знак определителя 3×3 части матрицы 4×4 (column-major)
const det3 = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);

export class Skeleton {
  constructor(desc, floats) {
    this.names = desc.names;
    this.parents = desc.parents;
    this.count = desc.names.length;
    this.invBind = desc.invBind.map((r) => {
      const m = mat4.create();
      // Matrix43 PW: 3 строки × 4 столбца, перенос в 4-м столбце
      m[0] = r[0];
      m[4] = r[1];
      m[8] = r[2];
      m[12] = r[3];
      m[1] = r[4];
      m[5] = r[5];
      m[9] = r[6];
      m[13] = r[7];
      m[2] = r[8];
      m[6] = r[9];
      m[10] = r[10];
      m[14] = r[11];
      return m;
    });
    this.anims = {};
    for (const [name, a] of Object.entries(desc.anims)) {
      let o = a.offset;
      const tracks = [];
      for (let b = 0; b < a.bones; b++) {
        const tr = {};
        for (const [k, n] of [
          ['p', 3],
          ['r', 4],
          ['s', 3],
        ]) {
          const cnt = floats[o++];
          tr[k] = floats.subarray(o, o + cnt * n);
          tr['n' + k] = cnt;
          o += cnt * n;
        }
        tracks.push(tr);
      }
      this.anims[name] = { tracks, duration: a.maxTime - a.minTime, frames: a.frames };
    }
    this._local = this.names.map(() => mat4.create());
    this._world = this.names.map(() => mat4.create());
    this._q = quat.create();
    this._q2 = quat.create();
  }

  duration(name) {
    return this.anims[name] ? this.anims[name].duration : 0;
  }

  _sample(tr, key, n, frame, alpha, out) {
    const cnt = tr['n' + key];
    const d = tr[key];
    if (cnt === 1) {
      for (let i = 0; i < n; i++) out[i] = d[i];
      return;
    }
    const a = (frame % cnt) * n;
    const b = ((frame + 1) % cnt) * n;
    for (let i = 0; i < n; i++) out[i] = d[a + i] + (d[b + i] - d[a + i]) * alpha;
  }

  _sampleRot(tr, frame, alpha, out) {
    const cnt = tr.nr;
    const d = tr.r;
    if (cnt === 1) {
      quat.set(out, d[0], d[1], d[2], d[3]);
      return;
    }
    const a = (frame % cnt) * 4;
    const b = ((frame + 1) % cnt) * 4;
    quat.set(this._q, d[a], d[a + 1], d[a + 2], d[a + 3]);
    quat.set(this._q2, d[b], d[b + 1], d[b + 2], d[b + 3]);
    quat.slerp(out, this._q, this._q2, alpha);
  }

  // Поза: anim (имя), time (сек), loop; blend — {anim, time, weight} для перехода
  pose(out, anim, time, loop = true, blend = null) {
    const A = this.anims[anim] || Object.values(this.anims)[0];
    const B = blend && this.anims[blend.anim];
    const fa = this._frameOf(A, time, loop);
    const fb = B ? this._frameOf(B, blend.time, blend.loop !== false) : null;
    const p = [0, 0, 0],
      s = [1, 1, 1],
      r = quat.create();
    const p2 = [0, 0, 0],
      s2 = [1, 1, 1],
      r2 = quat.create();
    for (let i = 0; i < this.count; i++) {
      const tr = A.tracks[i];
      this._sample(tr, 'p', 3, fa[0], fa[1], p);
      this._sample(tr, 's', 3, fa[0], fa[1], s);
      this._sampleRot(tr, fa[0], fa[1], r);
      if (B) {
        const w = blend.weight;
        const tb = B.tracks[i];
        this._sample(tb, 'p', 3, fb[0], fb[1], p2);
        this._sample(tb, 's', 3, fb[0], fb[1], s2);
        this._sampleRot(tb, fb[0], fb[1], r2);
        for (let k = 0; k < 3; k++) {
          p[k] += (p2[k] - p[k]) * w;
          s[k] += (s2[k] - s[k]) * w;
        }
        quat.slerp(r, r, r2, w);
      }
      quat.normalize(r, r);
      mat4.fromRotationTranslationScale(this._local[i], r, p, s);
      const par = this.parents[i];
      if (par < 0) mat4.copy(this._world[i], this._local[i]);
      else mat4.multiply(this._world[i], this._world[par], this._local[i]);
    }
    for (let i = 0; i < this.count; i++) {
      const m = out.subarray(i * 16, i * 16 + 16);
      mat4.multiply(m, this._world[i], this.invBind[i]);
    }
    return out;
  }

  _frameOf(A, time, loop) {
    let t = Math.max(0, time);
    if (loop) {
      if (A.duration > 0) t %= A.duration;
    } else {
      t = Math.min(t, Math.max(0, A.duration - 1e-4));
    }
    const f = t * ANIM_FPS;
    let frame = Math.floor(f);
    let alpha = f - frame;
    if (!loop && frame >= A.frames - 1) {
      frame = A.frames - 1;
      alpha = 0;
    }
    return [frame, alpha];
  }

  bonePosition(anim, time, boneName, loop = true) {
    const tmp = new Float32Array(this.count * 16);
    this.pose(tmp, anim, time, loop);
    const i = this.names.indexOf(boneName);
    if (i < 0) return [0, 0, 0];
    const w = this._world[i];
    return [w[12], w[13], w[14]];
  }
}

export class EaselRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 недоступен');
    this.gl = gl;
    this.progStatic = compile(gl, '');
    this.progSkin = compile(gl, '#define SKIN 1');
    this.progPaint = compile(gl, '', PAINT_FS, [
      'uModel',
      'uViewProj',
      'uDraft',
      'uFull',
      'uBase',
      'uComplete',
      'uMask',
      'uFrag',
      'uMasks',
      'uFinal',
    ]);
    this.progFx = compile(
      gl,
      '',
      FX_FS,
      ['uModel', 'uViewProj', 'uUvOff', 'uTex', 'uMul', 'uAdd', 'uOpacity', 'uOpMode', 'uVc', 'uParticle', 'uBlend', 'uAddr'],
      FX_VS,
    );
    this.textures = {};
    this.models = {};
    this.skeletons = {};
    this.view = mat4.create();
    this.proj = mat4.create();
    this.viewProj = mat4.create();
    this.eye = [0, 0, 10];
    this.lightDir = normalize3([0.35, -0.45, 0.82]);
    this.white = this._makeTex(1, 1, new Uint8Array([255, 255, 255, 255]));
    this.textures.__dot = this._makeDotTexture();
    this._dyn = new Map(); // динамические меши (спрайты)
    this._bones = new Float32Array(MAX_BONES * 16);
  }

  async load(base = EASEL_BASE) {
    this.assets = await fetchOk(base + 'assets.json');
    const jobs = [];
    for (const [id, m] of Object.entries(this.assets.models)) {
      jobs.push(
        fetchOk(`${base}models/${id}.bin`, 'buf').then((buf) => {
          this.models[id] = this._makeModel(m, new Float32Array(buf));
        }),
      );
    }
    for (const [id, s] of Object.entries(this.assets.skeletons)) {
      jobs.push(
        fetchOk(`${base}anims/${id}.bin`, 'buf').then((buf) => {
          this.skeletons[id] = new Skeleton(s, new Float32Array(buf));
        }),
      );
    }
    for (const id of Object.keys(this.assets.textures)) {
      jobs.push(this.loadTexture(id, `${base}tex/${id}.webp`));
    }
    await Promise.all(jobs);
  }

  // Текстура без премультипликации альфы (альфа — данные, напр. карта растекания краски); opts.nearest — без фильтрации
  async loadRawTexture(id, url, opts = {}) {
    if (this.textures[id]) return this.textures[id];
    const gl = this.gl;
    try {
      const blob = await fetchOk(url, 'blob');
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
      if (bmp.close) bmp.close();
      if (opts.nearest) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures[id] = t;
      return t;
    } catch (e) {
      console.warn('easel: texture failed', url, e);
      return (this.textures[id] = this.white);
    }
  }

  // Текстуры картины i (assets.pictures[i]) — грузятся по требованию
  async loadPicture(i, base = EASEL_BASE) {
    const p = this.assets.pictures[i];
    const ids = {};
    await Promise.all(
      Object.entries(p).map(async ([k, file]) => {
        ids[k] = 'pic' + i + '_' + k;
        await this.loadRawTexture(ids[k], base + 'tex/' + file, { nearest: k === 'Mask' });
      }),
    );
    return ids;
  }

  loadTexture(id, url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const gl = this.gl;
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        this.textures[id] = t;
        resolve(t);
      };
      img.onerror = () => {
        console.warn('easel: texture failed', url);
        this.textures[id] = this.white;
        resolve(this.white);
      };
      img.src = url;
    });
  }

  _makeTex(w, h, data) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _makeDotTexture() {
    const n = 64;
    const d = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const r = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
        const a = Math.max(0, 1 - r) ** 1.6;
        const i = (y * n + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.round(a * 255);
      }
    }
    return this._makeTex(n, n, d);
  }

  _makeModel(desc, data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const stride = desc.stride * 4;
    const attr = (loc, size, off) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
    };
    attr(0, 3, 0);
    attr(1, 3, 3);
    attr(2, 2, 6);
    if (desc.stride === 16) {
      attr(3, 4, 8);
      attr(4, 4, 12);
    }
    gl.bindVertexArray(null);
    return { ...desc, vao, vbo, skinned: desc.stride === 16 };
  }

  // Меши эффектов: pos3 f32, uv2 f32, rgba u8 (24 байта)
  fxMeshBuffer(bytes) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 24, 20);
    gl.disableVertexAttribArray(3);
    gl.vertexAttrib4f(3, 0, 0, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  // Частицы/лучи кадра: pos3 uv2 c0(4) c1(4) — 13 float на вершину, треугольники
  fxParticles(floats, count) {
    const gl = this.gl;
    if (!this._fxp) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      const S = 13 * 4;
      [
        [0, 3, 0],
        [1, 2, 3],
        [2, 4, 5],
        [3, 4, 9],
      ].forEach(([loc, n, off]) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S, off * 4);
      });
      gl.bindVertexArray(null);
      this._fxp = { vao, vbo };
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fxp.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, floats.subarray(0, count * 13), gl.STREAM_DRAW);
    return this._fxp.vao;
  }

  // Динамический меш (pos3 norm3 uv2) — для спрайтов/картины/пути
  dynamicModel(id, floats) {
    let m = this._dyn.get(id);
    const gl = this.gl;
    if (!m) {
      m = this._makeModel({ stride: 8, subs: [] }, floats);
      this._dyn.set(id, m);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, floats, gl.DYNAMIC_DRAW);
    }
    m.subs = [{ first: 0, count: floats.length / 8 }];
    return m;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return [w, h];
  }

  // Камера PW: target + anchor, yaw/pitch (град.), rod — расстояние, fov — вертикальный
  setCamera({ target = [0, 0, 0], yaw = 0, pitch = -47, rod = 12, fov = 50 }) {
    const [w, h] = this.resize();
    const p = (pitch * Math.PI) / 180;
    const y = (yaw * Math.PI) / 180;
    const dir = [Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), Math.sin(p)];
    this.eye = [target[0] - dir[0] * rod, target[1] - dir[1] * rod, target[2] - dir[2] * rod];
    mat4.lookAt(this.view, this.eye, target, [0, 0, 1]);
    mat4.perspective(this.proj, (fov * Math.PI) / 180, w / h, 0.1, 200);
    mat4.multiply(this.viewProj, this.proj, this.view);
    this.cameraTarget = target;
  }

  // Луч из экранной точки (px в CSS-пикселях) на плоскость z = planeZ
  screenToPlane(px, py, planeZ) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((px - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((py - rect.top) / rect.height) * 2;
    const inv = mat4.invert(mat4.create(), this.viewProj);
    const unproject = (z) => {
      const v = [nx, ny, z, 1];
      const o = [0, 0, 0, 0];
      for (let r = 0; r < 4; r++) o[r] = inv[r] * v[0] + inv[4 + r] * v[1] + inv[8 + r] * v[2] + inv[12 + r] * v[3];
      return [o[0] / o[3], o[1] / o[3], o[2] / o[3]];
    };
    const a = unproject(-1);
    const b = unproject(1);
    const t = (planeZ - a[2]) / (b[2] - a[2]);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, planeZ];
  }

  worldToScreen(p) {
    const m = this.viewProj;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    const rect = this.canvas.getBoundingClientRect();
    return [rect.left + ((x / w + 1) / 2) * rect.width, rect.top + ((1 - y / w) / 2) * rect.height];
  }

  begin(clear = [0, 0, 0, 0]) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...clear);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    this._opaque = [];
    this._blended = [];
    this._lastProg = null;
  }

  // item: {model, matrix, tex?: {subIndex|'*': texId}, tint?, add?, kind?, blend?: 'alpha'|'add', bones?, cull?: false|'back'|'front' (по умолчанию — по знаку det матрицы), depthWrite?}
  draw(item) {
    if (item.fx) return this._blended.push(item);
    const blend = item.blend || (item.model.subs[0] && item.model.subs[0].blend);
    (blend ? this._blended : this._opaque).push(item);
  }

  end() {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (const it of this._opaque) this._drawItem(it);
    // прозрачные — сзади наперёд
    const eye = this.eye;
    const dist = (it) => {
      const m = it.matrix;
      return (m[12] - eye[0]) ** 2 + (m[13] - eye[1]) ** 2 + (m[14] - eye[2]) ** 2;
    };
    this._blended.sort((a, b) => (b.order || 0) - (a.order || 0) || dist(b) - dist(a));
    gl.enable(gl.BLEND);
    this._lastProg = null;
    for (const it of this._blended) {
      if (it.fx) {
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        this._drawFx(it);
        continue;
      }
      const mode = it.blend || it.model.subs[0].blend;
      if (mode === 'add') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(it.depthWrite === true);
      this._drawItem(it);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _drawPaint(it) {
    const gl = this.gl;
    const pr = this.progPaint;
    const P = it.paint;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.uViewProj, false, this.viewProj);
    gl.uniformMatrix4fv(pr.u.uModel, false, it.matrix);
    ['Draft', 'Full', 'Base', 'Complete', 'Mask'].forEach((k, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      const key = { Draft: 'DraftPaint', Full: 'FullBackground', Base: 'BaseBackground', Complete: 'CompletePaint', Mask: 'Mask' }[k];
      gl.bindTexture(gl.TEXTURE_2D, this.textures[P.tex[key]] || this.white);
      gl.uniform1i(pr.u['u' + k], unit);
    });
    gl.uniform1fv(pr.u.uFrag, P.fragments);
    gl.uniform1i(pr.u.uMasks, P.masks);
    gl.uniform1f(pr.u.uFinal, P.final || 0);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(it.model.vao);
    for (const sub of it.model.subs) gl.drawArrays(gl.TRIANGLES, sub.first, sub.count);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  // it.fx: {vao, first, count, matrix, tex, blend 0|1|2, particle?, mul, add, opacity, opMode, vc, uv, addr}
  _drawFx(it) {
    const gl = this.gl;
    const pr = this.progFx;
    const u = pr.u;
    if (this._lastProg !== pr) {
      gl.useProgram(pr.p);
      gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
      gl.uniform1i(u.uTex, 0);
      gl.disable(gl.CULL_FACE);
    }
    gl.uniformMatrix4fv(u.uModel, false, it.fx.matrix || IDENTITY);
    gl.uniform2fv(u.uUvOff, it.fx.uv || ZERO2);
    gl.uniform4fv(u.uMul, it.fx.mul || ONE4);
    gl.uniform4fv(u.uAdd, it.fx.add || ZERO4);
    gl.uniform1f(u.uOpacity, it.fx.opacity ?? 1);
    gl.uniform1i(u.uOpMode, it.fx.opMode || 0);
    gl.uniform1i(u.uVc, it.fx.vc ? 1 : 0);
    gl.uniform1i(u.uParticle, it.fx.particle ? 1 : 0);
    gl.uniform1i(u.uBlend, it.fx.blend || 0);
    const ad = it.fx.addr || ZERO2I;
    gl.uniform2i(u.uAddr, ad[0], ad[1]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[it.fx.tex] || this.white);
    gl.bindVertexArray(it.fx.vao);
    gl.drawArrays(gl.TRIANGLES, it.fx.first, it.fx.count);
    gl.bindVertexArray(null);
    this._lastProg = pr;
  }

  _drawItem(it) {
    this._lastProg = null;
    if (it.paint) return this._drawPaint(it);
    const gl = this.gl;
    const m = it.model;
    const pr = m.skinned ? this.progSkin : this.progStatic;
    gl.useProgram(pr.p);
    gl.uniformMatrix4fv(pr.u.uViewProj, false, this.viewProj);
    gl.uniformMatrix4fv(pr.u.uModel, false, it.matrix);
    gl.uniform3fv(pr.u.uLightDir, this.lightDir);
    gl.uniform3fv(pr.u.uEye, this.eye);
    gl.uniform4fv(pr.u.uTint, it.tint || [1, 1, 1, 1]);
    gl.uniform4fv(pr.u.uAdd, it.add || [0, 0, 0, 0]);
    gl.uniform1i(pr.u.uTex, 0);
    if (m.skinned) gl.uniformMatrix4fv(pr.u.uBones, false, it.bones);
    gl.uniform1f(pr.u.uAlphaTest, it.blend || (m.subs[0] && m.subs[0].blend) ? 0 : 0.5);
    if (it.cull === false) gl.disable(gl.CULL_FACE);
    else {
      // Меши (как и в замке) — лицевые грани против часовой (CCW) при обычной камере; зеркальная
      // матрица модели (det < 0) меняет обход, тогда отсекаем FRONT
      gl.enable(gl.CULL_FACE);
      const back = it.cull === 'back' || (it.cull !== 'front' && det3(it.matrix) >= 0);
      gl.cullFace(back ? gl.BACK : gl.FRONT);
    }
    gl.bindVertexArray(m.vao);
    gl.activeTexture(gl.TEXTURE0);
    m.subs.forEach((s, i) => {
      const texId = (it.tex && (it.tex[i] ?? it.tex['*'])) || s.tex;
      gl.bindTexture(gl.TEXTURE_2D, (texId && this.textures[texId]) || this.white);
      const kind = it.kind ?? (s.kind === 'drop' ? 1 : s.kind === 'shadow' ? 2 : 0);
      gl.uniform1i(pr.u.uKind, kind);
      gl.drawArrays(gl.TRIANGLES, s.first, s.count);
    });
    gl.bindVertexArray(null);
  }

  destroy() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }
}

const IDENTITY = mat4.create();
const ZERO2 = new Float32Array(2);
const ZERO2I = [0, 0];
const ZERO4 = new Float32Array(4);
const ONE4 = new Float32Array([1, 1, 1, 1]);

export function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Матрица из плейсмента PW: pos, rot (кватернион x,y,z,w), scale
export function placementMatrix(out, pos, rot = [0, 0, 0, 1], scale = [1, 1, 1]) {
  return mat4.fromRotationTranslationScale(out, rot, pos, scale);
}

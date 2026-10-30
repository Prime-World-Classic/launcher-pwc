// Плавная смена сцены замка (смена фракции, Castle.switchScene): новая сцена грузится порциями,
// пока старая рисуется, а после подмены последний кадр старой сцены растворяется поверх новой.

// Уступить поток до следующего кадра. Если кадры не идут (окно свёрнуто, вкладка скрыта),
// requestAnimationFrame не срабатывает — тогда продолжаем по таймеру.
export function yieldFrame(fallbackMs = 20) {
  return new Promise((resolve) => {
    // окно скрыто — кадров никто не видит, а таймеры в фоне замедляются до раза в секунду
    if (typeof document !== 'undefined' && document.hidden) {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
      return;
    }
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, fallbackMs);
  });
}

// Бюджет работы за кадр: slice() пропускает, пока с начала порции прошло меньше ms,
// иначе ждёт следующий кадр. Общий для параллельных загрузок — ждут один и тот же кадр.
export class FrameBudget {
  constructor(ms) {
    this.ms = ms;
    this.start = performance.now();
    this.pending = null;
  }

  async slice() {
    while (performance.now() - this.start > this.ms) {
      if (!this.pending) {
        this.pending = yieldFrame().then(() => {
          this.start = performance.now();
          this.pending = null;
        });
      }
      await this.pending;
    }
  }
}

// fn(item, index) для всех элементов, не больше limit одновременно
export async function forEachLimited(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb, uAlpha);
}`;

export class CastleSceneFade {
  static duration = 0.8; // с
  static texture = null;
  static program = null;
  static buffer = null;
  static pending = null;
  static startedAt = 0;
  static active = false;

  // Снимок кадра, который Castle.loop нарисует следующим (до вывода на экран — иначе без
  // preserveDrawingBuffer буфер уже пуст). Промис выполняется сразу после снимка, до следующего
  // кадра, — подменённая в нём сцена появится уже под снимком. false — кадр не пришёл (замок не рисуется).
  static capture(timeoutMs = 300) {
    CastleSceneFade.pending?.(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (CastleSceneFade.pending === done) CastleSceneFade.pending = null;
        resolve(false);
      }, timeoutMs);
      const done = (ok) => {
        clearTimeout(timer);
        resolve(ok);
      };
      CastleSceneFade.pending = done;
    });
  }

  // В конце Castle.loop, после всей отрисовки сцены в экранный буфер
  static afterFrame(gl) {
    const now = performance.now() / 1000;
    if (CastleSceneFade.pending) {
      const done = CastleSceneFade.pending;
      CastleSceneFade.pending = null;
      const ok = CastleSceneFade.snapshot(gl);
      if (ok) {
        CastleSceneFade.active = true;
        CastleSceneFade.startedAt = now;
      }
      done(ok);
      return;
    }
    if (!CastleSceneFade.active) return;
    const t = (now - CastleSceneFade.startedAt) / CastleSceneFade.duration;
    if (t >= 1) {
      CastleSceneFade.active = false;
      return;
    }
    // плавный старт и конец (smoothstep)
    CastleSceneFade.draw(gl, 1 - t * t * (3 - 2 * t));
  }

  static snapshot(gl) {
    if (!CastleSceneFade.init(gl)) return false;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    // ошибки, накопленные отрисовкой сцены, — не наши
    for (let i = 0; i < 16 && gl.getError() !== gl.NO_ERROR; i++);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, CastleSceneFade.texture);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, w, h, 0);
    return gl.getError() === gl.NO_ERROR;
  }

  static draw(gl, alpha) {
    const prog = CastleSceneFade.program;
    const depthTest = gl.isEnabled(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // альфу холста не трогаем: иначе страница просвечивает сквозь замок
    gl.colorMask(true, true, true, false);
    gl.useProgram(prog.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, CastleSceneFade.texture);
    gl.uniform1i(prog.uTex, 0);
    gl.uniform1f(prog.uAlpha, alpha);
    gl.bindBuffer(gl.ARRAY_BUFFER, CastleSceneFade.buffer);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(prog.aPos);
    gl.colorMask(true, true, true, true);
    if (depthTest) gl.enable(gl.DEPTH_TEST);
  }

  static init(gl) {
    if (CastleSceneFade.program) return true;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VS);
    const fs = compile(gl.FRAGMENT_SHADER, FS);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('CastleSceneFade: шейдер не собрался', gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return false;
    }
    CastleSceneFade.program = {
      prog,
      aPos: gl.getAttribLocation(prog, 'aPos'),
      uTex: gl.getUniformLocation(prog, 'uTex'),
      uAlpha: gl.getUniformLocation(prog, 'uAlpha'),
    };
    CastleSceneFade.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, CastleSceneFade.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    // текстура размером с холст (не степень двойки): без мип-карт и повтора
    CastleSceneFade.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, CastleSceneFade.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return true;
  }
}

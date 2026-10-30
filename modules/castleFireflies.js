import * as vec4 from './glMatrix/vec4.js';

// Светлячки ночью за пределами замка: мигающие точки над лесом, кустами, скалами и землёй вокруг стен,
// над водой — редко (waterChance). Высоту берём из карты высот, собранной один раз из мешей рельефа,
// деревьев и кустов сцены; вода — там, где её поверхность выше всего остального (кувшинки Адорнийцев
// лежат в меше деревьев на уровне воды и считаются водой).
// Рисуются аддитивными точками поверх сцены (с тестом глубины — прячутся за деревьями и скалами),
// и каждый слегка подсвечивает землю под собой точечным источником (CastleLighting).
export class CastleFireflies {
  static count = 260;
  static cellSize = 4;
  // меши, над которыми летают светлячки (по имени меша сцены)
  static groundMeshes = /(^|\/)(terrain|understage|highland|rocks_|trees_|bushes_|water)/;
  static waterMeshes = /(^|\/)water_/; // реки и пруды; водопады (waterfall_*) — не поверхность

  static plantMeshes = /(^|\/)(trees_|bushes_)/;
  static flyHeight = [1.5, 5]; // над землёй: от и до (ниже крыш зданий)
  static wallMarginCells = 2; // отступ от стен наружу, клеток сетки (по 7 единиц)
  static nearWallBandCells = 9; // полоса за стенами (клеток), куда идёт nearWallShare светлячков
  static nearWallShare = 0.4;
  static maxDistance = 420; // от центра замка
  static lightRadius = 10;
  static lightIntensity = 0.9;
  static spriteSize = 7; // мировой размер точки (с ореолом)

  static heights = null; // Float32Array, NaN — нет земли
  static water = null; // Float32Array: высота видимой воды в клетке, NaN — суша
  static waterChance = 0.1; // доля мест над водой, где светлячок всё же появится
  static gridOrigin = [0, 0];
  static gridSize = [0, 0];
  static flies = [];
  static program = null;
  static buffer = null;
  static data = null;

  // Позиции вершин меша, пока он ещё в памяти (Castle.loadMesh) — только для мешей земли
  static keepGroundPositions(obj, meshFloat, vertStride, posOffset) {
    if (!CastleFireflies.groundMeshes.test(obj.meshName)) return;
    const stride = vertStride / 4;
    const n = Math.floor(meshFloat.length / stride);
    const pos = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const i = v * stride + posOffset / 4;
      pos[v * 3] = meshFloat[i];
      pos[v * 3 + 1] = meshFloat[i + 1];
      pos[v * 3 + 2] = meshFloat[i + 2];
    }
    obj.meshData.groundPositions = pos;
  }

  // Карта высот: для каждой клетки XZ — наибольшая высота треугольников земли над ней.
  // castle — сцена с sceneObjects (Castle или собираемая Castle.buildScene). Нужна только spawn, поэтому
  // при смене фракции считается заранее, порциями (slice — ожидание следующей порции, Castle.buildScene).
  static async buildHeightField(castle, slice = null) {
    const cs = CastleFireflies.cellSize;
    const tris = [];
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const obj of castle.sceneObjects) {
      const pos = obj.meshData && obj.meshData.groundPositions;
      if (!pos) continue;
      if (slice) await slice();
      const t = obj.transform || [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
      const n = pos.length / 3;
      const w = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
        // transform построчно, как в CastleLighting.glowOf
        w[v * 3] = t[0] * x + t[1] * y + t[2] * z + t[3];
        w[v * 3 + 1] = t[4] * x + t[5] * y + t[6] * z + t[7];
        w[v * 3 + 2] = t[8] * x + t[9] * y + t[10] * z + t[11];
        minX = Math.min(minX, w[v * 3]);
        maxX = Math.max(maxX, w[v * 3]);
        minZ = Math.min(minZ, w[v * 3 + 2]);
        maxZ = Math.max(maxZ, w[v * 3 + 2]);
      }
      // 0 — рельеф и скалы, 1 — деревья и кусты, 2 — вода
      const kind = CastleFireflies.waterMeshes.test(obj.meshName) ? 2 : CastleFireflies.plantMeshes.test(obj.meshName) ? 1 : 0;
      const triCount = obj.strip ? n - 2 : Math.floor(n / 3);
      for (let k = 0; k < triCount; k++) {
        const a = obj.strip ? k : k * 3;
        tris.push(w, a, a + 1, a + 2, kind);
      }
      obj.meshData.groundPositions = null; // больше не нужны
    }
    if (!tris.length) {
      CastleFireflies.heights = null;
      return;
    }
    const gw = Math.ceil((maxX - minX) / cs) + 1;
    const gh = Math.ceil((maxZ - minZ) / cs) + 1;
    const heights = new Float32Array(gw * gh).fill(NaN); // верх всего, кроме воды (с кронами)
    const groundH = new Float32Array(gw * gh).fill(NaN); // только рельеф и скалы
    const waterH = new Float32Array(gw * gh).fill(NaN);
    for (let i = 0; i < tris.length; i += 5) {
      if (slice && i % 10000 === 0) await slice();
      const w = tris[i];
      const a = tris[i + 1] * 3, b = tris[i + 2] * 3, c = tris[i + 3] * 3;
      const ax = w[a], ay = w[a + 1], az = w[a + 2];
      const bx = w[b], by = w[b + 1], bz = w[b + 2];
      const cx = w[c], cy = w[c + 1], cz = w[c + 2];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-6) continue;
      const x0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cs));
      const x1 = Math.min(gw - 1, Math.ceil((Math.max(ax, bx, cx) - minX) / cs));
      const z0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - minZ) / cs));
      const z1 = Math.min(gh - 1, Math.ceil((Math.max(az, bz, cz) - minZ) / cs));
      for (let gz = z0; gz <= z1; gz++) {
        const pz = minZ + gz * cs;
        for (let gx = x0; gx <= x1; gx++) {
          const px = minX + gx * cs;
          const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
          const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -0.01 || l2 < -0.01 || l3 < -0.01) continue;
          const y = l1 * ay + l2 * by + l3 * cy;
          const idx = gz * gw + gx;
          const kind = tris[i + 4];
          if (kind === 2) {
            if (!(waterH[idx] >= y)) waterH[idx] = y;
            continue;
          }
          if (!(heights[idx] >= y)) heights[idx] = y;
          if (kind === 0 && !(groundH[idx] >= y)) groundH[idx] = y;
        }
      }
    }
    // вода видна, если её поверхность выше рельефа и растений (или под ней ничего нет)
    for (let idx = 0; idx < waterH.length; idx++) {
      if (heights[idx] > waterH[idx] + 0.5) waterH[idx] = NaN;
    }
    // летают у земли, а не над кронами: высота — рельеф, а где его нет — верх растений
    for (let idx = 0; idx < heights.length; idx++) {
      if (groundH[idx] === groundH[idx]) heights[idx] = groundH[idx];
    }
    CastleFireflies.heights = heights;
    CastleFireflies.water = waterH;
    CastleFireflies.gridOrigin = [minX, minZ];
    CastleFireflies.gridSize = [gw, gh];
  }

  static heightAt(x, z) {
    const h = CastleFireflies.heights;
    if (!h) return NaN;
    const cs = CastleFireflies.cellSize;
    const gx = Math.round((x - CastleFireflies.gridOrigin[0]) / cs);
    const gz = Math.round((z - CastleFireflies.gridOrigin[1]) / cs);
    if (gx < 0 || gz < 0 || gx >= CastleFireflies.gridSize[0] || gz >= CastleFireflies.gridSize[1]) return NaN;
    return h[gz * CastleFireflies.gridSize[0] + gx];
  }

  static waterAt(x, z) {
    const f = CastleFireflies.water;
    if (!f) return NaN;
    const cs = CastleFireflies.cellSize;
    const gx = Math.round((x - CastleFireflies.gridOrigin[0]) / cs);
    const gz = Math.round((z - CastleFireflies.gridOrigin[1]) / cs);
    if (gx < 0 || gz < 0 || gx >= CastleFireflies.gridSize[0] || gz >= CastleFireflies.gridSize[1]) return NaN;
    return f[gz * CastleFireflies.gridSize[0] + gx];
  }

  // Прямоугольник сетки замка в мире (как считаются позиции зданий в Castle.loop)
  static castleRect(castle) {
    const x0 = castle.zeroTranslation[0], z0 = castle.zeroTranslation[1] - 17 * 7;
    return [x0, z0, x0 + 47 * 7, z0 + 38 * 7];
  }

  // Внутри стен (с запасом marginCells клеток наружу). Форма — как в Castle.isBuildingAllowed:
  // сетка 46x38 клеток со срезанными нижним, левым и правым углами; клетка 7 единиц.
  static insideWalls(castle, x, z, marginCells) {
    const gx = (x - castle.zeroTranslation[0]) / 7;
    const gy = (z - castle.zeroTranslation[1]) / 7 + 17;
    const m = marginCells, d = marginCells * Math.SQRT2;
    if (gx < -m || gy < -m || gx > 46 + m || gy > 38 + m) return false;
    if (gx + gy > 66 + d) return false; // нижний угол
    if (gx - gy > 44 + d) return false; // левый угол
    if (gy - gx > 36 + d) return false; // правый угол
    return true;
  }

  // Места светлячков: случайные точки вокруг замка, сразу за стенами и дальше
  static spawn(castle) {
    CastleFireflies.flies = [];
    if (!CastleFireflies.heights) return;
    const r = CastleFireflies.castleRect(castle);
    const cx = (r[0] + r[2]) / 2, cz = (r[1] + r[3]) / 2;
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    // часть — в полосе сразу за стенами (равномерный разброс по большой площади её почти не задевает)
    const nearCount = Math.round(CastleFireflies.count * CastleFireflies.nearWallShare);
    const margin = CastleFireflies.wallMarginCells, band = CastleFireflies.nearWallBandCells;
    for (let tries = 0; CastleFireflies.flies.length < CastleFireflies.count && tries < CastleFireflies.count * 60; tries++) {
      let x, z;
      if (CastleFireflies.flies.length < nearCount) {
        // точка сетки замка с запасом band клеток, но вне стен с отступом margin
        x = castle.zeroTranslation[0] + (-band + rnd() * (46 + 2 * band)) * 7;
        z = castle.zeroTranslation[1] + (-band + rnd() * (38 + 2 * band) - 17) * 7;
        if (!CastleFireflies.insideWalls(castle, x, z, band)) continue;
      } else {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * CastleFireflies.maxDistance;
        x = cx + Math.cos(a) * d * 1.3;
        z = cz + Math.sin(a) * d;
      }
      if (CastleFireflies.insideWalls(castle, x, z, margin)) continue;
      const ground = CastleFireflies.heightAt(x, z);
      const water = CastleFireflies.waterAt(x, z);
      let y = ground;
      if (Number.isFinite(water)) {
        if (rnd() > CastleFireflies.waterChance) continue; // над водой — редко, и над её поверхностью
        y = Number.isFinite(ground) ? Math.max(ground, water) : water;
      }
      if (!Number.isFinite(y)) continue;
      CastleFireflies.flies.push({
        base: [x, y + CastleFireflies.flyHeight[0] + rnd() * (CastleFireflies.flyHeight[1] - CastleFireflies.flyHeight[0]), z],
        phase: rnd() * 100,
        speed: 0.25 + rnd() * 0.35,
        blink: 0.6 + rnd() * 1.2,
        range: 3 + rnd() * 5,
      });
    }
  }

  // Положение и яркость светлячков в момент t; яркость — короткие вспышки
  static update(t) {
    for (const f of CastleFireflies.flies) {
      const p = f.phase, s = f.speed, rg = f.range;
      f.pos = [
        f.base[0] + Math.sin(t * s + p) * rg + Math.sin(t * s * 2.3 + p * 1.7) * rg * 0.3,
        f.base[1] + Math.sin(t * s * 1.6 + p * 0.7) * 1.0,
        f.base[2] + Math.cos(t * s * 0.8 + p * 1.3) * rg + Math.sin(t * s * 1.9 + p) * rg * 0.3,
      ];
      const b = Math.sin(t * f.blink + p * 3.1);
      f.glow = Math.pow(Math.max(0, b), 3) * 0.85 + 0.15 * (0.5 + 0.5 * Math.sin(t * 0.7 + p));
    }
  }

  // Источники света под светлячками для CastleLighting (только ночью)
  static lights(level) {
    if (level < 0.01) return [];
    return CastleFireflies.flies.map((f) => ({
      pos: f.pos,
      color: [0.75, 1.0, 0.35],
      radius: CastleFireflies.lightRadius,
      intensity: CastleFireflies.lightIntensity * f.glow,
      flicker: 0,
    }));
  }

  static init(gl) {
    const vs = `
attribute vec4 aFly; // xyz, яркость
uniform mat4 viewProj;
uniform float pointScale;
varying float vGlow;
void main() {
  gl_Position = viewProj * vec4(aFly.xyz, 1.0);
  gl_PointSize = clamp(pointScale / gl_Position.w, 3.0, 32.0);
  vGlow = aFly.w;
}`;
    const fs = `
precision mediump float;
uniform vec3 color;
varying float vGlow;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 14.0);
  float halo = (1.0 - r2) * (1.0 - r2) * 0.45;
  gl_FragColor = vec4(color * (core * 2.2 + halo) * vGlow, 1.0);
}`;
    const compile = (type, text) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, text);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('CastleFireflies: ошибка шейдера', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    CastleFireflies.program = {
      prog,
      aFly: gl.getAttribLocation(prog, 'aFly'),
      viewProj: gl.getUniformLocation(prog, 'viewProj'),
      pointScale: gl.getUniformLocation(prog, 'pointScale'),
      color: gl.getUniformLocation(prog, 'color'),
    };
    CastleFireflies.buffer = gl.createBuffer();
  }

  // Точки светлячков поверх сцены (после непрозрачного), аддитивно, с тестом глубины без записи
  static draw(gl, castle, level) {
    if (level < 0.01 || !CastleFireflies.flies.length) return;
    if (!CastleFireflies.program) CastleFireflies.init(gl);
    const p = CastleFireflies.program;
    if (!p) return;
    const n = CastleFireflies.flies.length;
    if (!CastleFireflies.data || CastleFireflies.data.length !== n * 4) CastleFireflies.data = new Float32Array(n * 4);
    const data = CastleFireflies.data;
    for (let i = 0; i < n; i++) {
      const f = CastleFireflies.flies[i];
      data[i * 4] = f.pos[0];
      data[i * 4 + 1] = f.pos[1];
      data[i * 4 + 2] = f.pos[2];
      data[i * 4 + 3] = f.glow * level;
    }
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, CastleFireflies.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(p.aFly, 4, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(p.aFly);
    gl.uniformMatrix4fv(p.viewProj, false, castle.viewProjMatr);
    // размер точки в пикселях = мировой размер * (высота экрана / 2) / tan(fov/2) / w
    const fov = (castle.fov * Math.PI) / 180;
    gl.uniform1f(p.pointScale, (CastleFireflies.spriteSize * gl.drawingBufferHeight) / (2 * Math.tan(fov / 2)));
    gl.uniform3f(p.color, 0.8, 1.0, 0.4);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.colorMask(true, true, true, false);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.disableVertexAttribArray(p.aFly);
  }
}

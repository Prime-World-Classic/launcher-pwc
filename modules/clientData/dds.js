// Текстуры игры (.dds) -> RGBA для canvas: DXT1/DXT3/DXT5 и несжатые 32/24 бит
// (то, что лежит в UI/Styles игры). Мип-уровни не нужны — берётся первый.

function color565(value) {
  return [((value >> 11) & 31) * 255 / 31, ((value >> 5) & 63) * 255 / 63, (value & 31) * 255 / 31];
}

function decodeColorBlock(view, at, out, width, height, bx, by, dxt1, alphaOf) {
  const c0 = view.getUint16(at, true);
  const c1 = view.getUint16(at + 2, true);
  const bits = view.getUint32(at + 4, true);
  const p0 = color565(c0);
  const p1 = color565(c1);
  const palette = [p0, p1];
  let transparent = -1;
  if (!dxt1 || c0 > c1) {
    palette.push(p0.map((v, i) => (2 * v + p1[i]) / 3), p0.map((v, i) => (v + 2 * p1[i]) / 3));
  } else {
    palette.push(p0.map((v, i) => (v + p1[i]) / 2), [0, 0, 0]);
    transparent = 3;
  }
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = bx + x;
      const py = by + y;
      if (px >= width || py >= height) continue;
      const index = (bits >> (2 * (y * 4 + x))) & 3;
      const o = (py * width + px) * 4;
      const color = palette[index];
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
      out[o + 3] = index === transparent ? 0 : alphaOf ? alphaOf(x, y) : 255;
    }
  }
}

export function decodeDds(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x20534444) throw new Error('не DDS');
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  const pfFlags = view.getUint32(80, true);
  const fourCC = String.fromCharCode(bytes[84], bytes[85], bytes[86], bytes[87]);
  const bitCount = view.getUint32(88, true);
  const masks = [view.getUint32(92, true), view.getUint32(96, true), view.getUint32(100, true), view.getUint32(104, true)];
  const out = new Uint8ClampedArray(width * height * 4);
  let at = 128;

  if (pfFlags & 0x4) {
    const kind = fourCC.trim();
    if (!['DXT1', 'DXT3', 'DXT5'].includes(kind)) throw new Error(`DDS ${kind} не поддержан`);
    for (let by = 0; by < height; by += 4) {
      for (let bx = 0; bx < width; bx += 4) {
        let alphaOf = null;
        if (kind === 'DXT3') {
          const base = at;
          alphaOf = (x, y) => {
            const nibble = (bytes[base + y * 2 + (x >> 1)] >> ((x & 1) * 4)) & 15;
            return nibble * 17;
          };
          at += 8;
        } else if (kind === 'DXT5') {
          const a0 = bytes[at];
          const a1 = bytes[at + 1];
          const alphas = [a0, a1];
          if (a0 > a1) for (let i = 1; i < 7; i++) alphas.push(((7 - i) * a0 + i * a1) / 7);
          else {
            for (let i = 1; i < 5; i++) alphas.push(((5 - i) * a0 + i * a1) / 5);
            alphas.push(0, 255);
          }
          let bits = 0n;
          for (let i = 0; i < 6; i++) bits |= BigInt(bytes[at + 2 + i]) << BigInt(8 * i);
          alphaOf = (x, y) => alphas[Number((bits >> BigInt(3 * (y * 4 + x))) & 7n)];
          at += 8;
        }
        decodeColorBlock(view, at, out, width, height, bx, by, kind === 'DXT1', alphaOf);
        at += 8;
      }
    }
    return { width, height, data: out };
  }

  const bytesPerPixel = bitCount / 8;
  if (bytesPerPixel !== 4 && bytesPerPixel !== 3) throw new Error(`DDS ${bitCount} бит не поддержан`);
  const hasAlpha = (pfFlags & 0x1) && masks[3];
  const shiftOf = (mask) => (mask ? 31 - Math.clz32(mask & -mask) : 0);
  const shifts = masks.map(shiftOf);
  for (let i = 0; i < width * height; i++) {
    const value = bytesPerPixel === 4 ? view.getUint32(at, true) : bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    at += bytesPerPixel;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = (value & masks[c]) >>> shifts[c];
    out[i * 4 + 3] = hasAlpha ? (value & masks[3]) >>> shifts[3] : 255;
  }
  return { width, height, data: out };
}

// Кусок текстуры (как textureShift + imageSize у UIBaseMaterial) -> data URL png
export function ddsToDataUrl(bytes, crop = null) {
  const image = decodeDds(bytes);
  const x = crop?.x || 0;
  const y = crop?.y || 0;
  const w = Math.min(crop?.width || image.width, image.width - x);
  const h = Math.min(crop?.height || image.height, image.height - y);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  if (!x && !y && w === image.width && h === image.height) return canvas.toDataURL('image/png');
  const part = document.createElement('canvas');
  part.width = w;
  part.height = h;
  part.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return part.toDataURL('image/png');
}

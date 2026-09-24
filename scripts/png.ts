/** Minimal PNG encoder, decoder and upscaler for previews and reference inspection (Node only). */
import { deflateSync, inflateSync } from 'node:zlib';
import { Pixmap, type Color } from '../src/art/pixmap';

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(pm: Pixmap): Buffer {
  const raw = Buffer.alloc((pm.w * 4 + 1) * pm.h);
  for (let y = 0; y < pm.h; y++) {
    raw[y * (pm.w * 4 + 1)] = 0;
    Buffer.from(pm.data.buffer, pm.data.byteOffset + y * pm.w * 4, pm.w * 4).copy(raw, y * (pm.w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(pm.w, 0);
  ihdr.writeUInt32BE(pm.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Nearest-neighbour upscale over an opaque background colour (for viewing transparent sprites). */
export function upscale(pm: Pixmap, z: number, bg?: Color): Pixmap {
  const out = new Pixmap(pm.w * z, pm.h * z);
  if (bg !== undefined) out.rect(0, 0, out.w, out.h, bg);
  for (let y = 0; y < pm.h; y++)
    for (let x = 0; x < pm.w; x++) {
      const i = (y * pm.w + x) * 4;
      const a = pm.data[i + 3];
      if (!a) continue;
      const col = ((pm.data[i] << 16) | (pm.data[i + 1] << 8) | pm.data[i + 2]) >>> 0;
      out.rect(x * z, y * z, z, z, col, a);
    }
  return out;
}


/**
 * Minimal PNG decoder: 8-bit greyscale / RGB / RGBA (with or without alpha), non-interlaced.
 * Enough to open a reference image and study it with the same `Pixmap` tools the art pipeline uses.
 */
export function decodePng(buf: Buffer): Pixmap {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNGs are not supported');
      if (depth !== 8) throw new Error(`only 8-bit PNGs are supported (got ${depth})`);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = new Pixmap(w, h);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          // Paeth
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: break;
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const i = x * channels;
      const r = line[i];
      const g = channels >= 3 ? line[i + 1] : r;
      const b = channels >= 3 ? line[i + 2] : r;
      const alpha = channels === 4 ? line[i + 3] : channels === 2 ? line[i + 1] : 255;
      out.set(x, y, ((r << 16) | (g << 8) | b) >>> 0, alpha);
    }
    prev.set(line);
  }
  return out;
}

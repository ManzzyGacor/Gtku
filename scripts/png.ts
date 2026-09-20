/** Minimal PNG encoder + upscaler for previews (Node only). */
import { deflateSync } from 'node:zlib';
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

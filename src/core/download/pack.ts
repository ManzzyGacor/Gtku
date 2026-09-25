/**
 * The area data pack: a container for an area's pre-baked chunk ground textures.
 *
 * **Why these exist at all.** The world is generated, so nothing *has* to be downloaded — but
 * generating a chunk's ground texture (`bakeChunk`) is the single most expensive thing that
 * happens while you walk: measured at 11–22 ms per chunk in Node, and several times that on a
 * phone, landing on the main thread exactly when a new chunk streams in. Baked once at build time
 * and deflated, a whole area is 0.2–0.6 MB. So a pack turns a hitch on every chunk into a lookup,
 * and it gives the areas a real delivery path for the hand-made assets they will get later.
 *
 * **The format** is deliberately dull, because it has to be decoded by hand in the browser:
 *
 *   "LMAP"            4 bytes  magic
 *   format            u16      container format, bumped only if this layout changes
 *   count             u16      entries in this file
 *   then per entry:   cx u8, cy u8, bytes u32, then `bytes` of payload
 *
 * Little-endian throughout. The payload is opaque here — in practice a deflated 256x256 RGBA
 * pixmap — so this file stays pure and knows nothing about compression or pixels.
 */

export const PACK_MAGIC = 'LMAP';
export const PACK_FORMAT = 1;
/** Hard cap per file, from the plan: nothing the phone downloads in one piece is larger than this. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface PackEntry {
  cx: number;
  cy: number;
  payload: Uint8Array;
}

const HEADER = 8;
const ENTRY_HEADER = 6;

/** Encode entries into one file. Throws if the result would exceed `maxBytes`. */
export function encodePack(entries: readonly PackEntry[], maxBytes = MAX_FILE_BYTES): Uint8Array {
  let size = HEADER;
  for (const e of entries) size += ENTRY_HEADER + e.payload.length;
  if (size > maxBytes) throw new Error(`pack of ${size} bytes exceeds the ${maxBytes}-byte limit`);
  if (entries.length > 0xffff) throw new Error('too many entries for one pack');
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = PACK_MAGIC.charCodeAt(i);
  view.setUint16(4, PACK_FORMAT, true);
  view.setUint16(6, entries.length, true);
  let at = HEADER;
  for (const e of entries) {
    if (e.cx < 0 || e.cx > 255 || e.cy < 0 || e.cy > 255) throw new Error(`chunk ${e.cx},${e.cy} out of range`);
    out[at] = e.cx;
    out[at + 1] = e.cy;
    view.setUint32(at + 2, e.payload.length, true);
    out.set(e.payload, at + ENTRY_HEADER);
    at += ENTRY_HEADER + e.payload.length;
  }
  return out;
}

/**
 * Decode a file. Returns null — never throws — for anything that is not a well-formed pack of the
 * format this build understands: a truncated download, a file from a newer build, or plain garbage
 * all mean "treat this area as not downloaded", never "crash".
 */
export function decodePack(bytes: Uint8Array): PackEntry[] | null {
  if (bytes.length < HEADER) return null;
  for (let i = 0; i < 4; i++) if (bytes[i] !== PACK_MAGIC.charCodeAt(i)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== PACK_FORMAT) return null;
  const count = view.getUint16(6, true);
  const out: PackEntry[] = [];
  let at = HEADER;
  for (let i = 0; i < count; i++) {
    if (at + ENTRY_HEADER > bytes.length) return null;
    const cx = bytes[at];
    const cy = bytes[at + 1];
    const len = view.getUint32(at + 2, true);
    const start = at + ENTRY_HEADER;
    if (start + len > bytes.length) return null;
    out.push({ cx, cy, payload: bytes.subarray(start, start + len) });
    at = start + len;
  }
  // trailing bytes mean the file is not what its header claims
  return at === bytes.length ? out : null;
}

/**
 * Split entries across as many files as needed so none exceeds `maxBytes`, keeping chunk order.
 * An entry larger than a whole file on its own is an error, not something to split mid-chunk.
 */
export function splitEntries(entries: readonly PackEntry[], maxBytes = MAX_FILE_BYTES): PackEntry[][] {
  const files: PackEntry[][] = [];
  let current: PackEntry[] = [];
  let size = HEADER;
  for (const e of entries) {
    const need = ENTRY_HEADER + e.payload.length;
    if (HEADER + need > maxBytes) throw new Error(`chunk ${e.cx},${e.cy} alone exceeds the file limit`);
    if (size + need > maxBytes && current.length) {
      files.push(current);
      current = [];
      size = HEADER;
    }
    current.push(e);
    size += need;
  }
  if (current.length) files.push(current);
  return files;
}

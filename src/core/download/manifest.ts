/**
 * The data manifest: what exists to download, in which version, how big, and how to check it.
 *
 * Every file's URL carries its content hash, so a file never changes under a URL: a new version is
 * a new URL, which makes "do I already have this?" a question the cache can answer exactly, and
 * makes it impossible to mix half of version 3 with half of version 4.
 */

export interface DataFile {
  /** Relative to the manifest, and content-addressed: `forest-3f9a…-0.bin`. */
  url: string;
  bytes: number;
  /** Hex SHA-256 of the file, checked before anything is written to the cache. */
  sha256: string;
}

export interface AreaManifest {
  /** Content hash of the whole area; changes whenever any of its files do. */
  version: string;
  /** Total download size. */
  bytes: number;
  files: DataFile[];
  /** How many chunks the area's files hold between them. */
  chunks: number;
}

export interface DataManifest {
  format: 1;
  /** Which area ships with the game rather than being asked for. */
  core: string;
  areas: Record<string, AreaManifest>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Validate a manifest from the network. Returns null for anything malformed rather than throwing:
 * a broken manifest has to mean "downloads are unavailable right now", not a crash at boot.
 */
export function parseManifest(value: unknown): DataManifest | null {
  if (!isObj(value) || value.format !== 1 || typeof value.core !== 'string' || !isObj(value.areas)) return null;
  const areas: Record<string, AreaManifest> = {};
  for (const [id, raw] of Object.entries(value.areas)) {
    if (!isObj(raw) || typeof raw.version !== 'string' || !raw.version || !Array.isArray(raw.files)) return null;
    const files: DataFile[] = [];
    let bytes = 0;
    for (const f of raw.files) {
      if (!isObj(f) || typeof f.url !== 'string' || typeof f.bytes !== 'number' || typeof f.sha256 !== 'string') return null;
      if (!Number.isFinite(f.bytes) || f.bytes <= 0 || !HEX64.test(f.sha256)) return null;
      // content-addressed and relative: no absolute URLs, no climbing out of the data folder
      if (f.url.includes('/') || f.url.includes('..') || !f.url.endsWith('.bin')) return null;
      files.push({ url: f.url, bytes: f.bytes, sha256: f.sha256 });
      bytes += f.bytes;
    }
    if (!files.length) return null;
    const chunks = typeof raw.chunks === 'number' && Number.isFinite(raw.chunks) ? raw.chunks : 0;
    areas[id] = { version: raw.version, bytes, files, chunks };
  }
  if (!areas[value.core]) return null;
  return { format: 1, core: value.core, areas };
}

export type AreaStatus = 'terpasang' | 'belum' | 'versi-baru';

/**
 * What state an area is in, given what is installed.
 *
 * "Installed" is a version string written only after every one of the area's files has been
 * downloaded *and* verified — so an interrupted download can never look like a finished one.
 */
export function areaStatus(manifest: DataManifest, installed: Record<string, string>, area: string): AreaStatus {
  const want = manifest.areas[area]?.version;
  const have = installed[area];
  if (!have) return 'belum';
  return have === want ? 'terpasang' : 'versi-baru';
}

/** Bytes, for people: "0,56 MB", "320 KB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2).replace('.', ',')} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round(n)} B`;
}

/**
 * Downloading an area's data — safely.
 *
 * The rules the plan asks for, and how each one is kept:
 *
 *  • **A failed or interrupted download can be retried without corrupting anything.** A file is
 *    written to the cache only after it has arrived *completely* and its SHA-256 matches the
 *    manifest. A connection that drops halfway leaves nothing behind for that file; the files that
 *    did finish stay, so a retry resumes from the first missing file rather than from zero.
 *  • **Nothing already cached is downloaded again unless its version changed.** File URLs are
 *    content-addressed, so "is this exact file cached?" is a cache lookup, and a new version is
 *    simply a set of new URLs.
 *  • **An area only counts as installed once every file is in.** The installed marker is written
 *    last, after the final verification, so no half-finished area can ever be treated as ready.
 *  • **Old versions are cleaned up** after a new one is complete — never before, so an update that
 *    fails leaves the old, working version in place.
 *
 * Everything outside this file (fetch, Cache Storage, crypto, localStorage) is passed in, so the
 * whole thing — including a download that dies at 40% — is tested in Node.
 */
import type { DataManifest } from './manifest';

export interface FetchResult {
  ok: boolean;
  status: number;
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array | undefined }> } } | null;
}

export interface DataCache {
  has(url: string): Promise<boolean>;
  put(url: string, bytes: Uint8Array): Promise<void>;
  get(url: string): Promise<Uint8Array | null>;
  delete(url: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface InstalledStore {
  get(): Record<string, string>;
  set(area: string, version: string | null): void;
}

export interface DownloadDeps {
  fetch(url: string): Promise<FetchResult>;
  cache: DataCache;
  sha256(bytes: Uint8Array): Promise<string>;
  installed: InstalledStore;
}

export type DownloadState = 'mengunduh' | 'memeriksa' | 'selesai' | 'gagal';

export interface DownloadProgress {
  area: string;
  state: DownloadState;
  /** Bytes in hand, counting files that were already cached. */
  done: number;
  total: number;
  /** 1-based index of the file in flight, and how many there are. */
  file: number;
  files: number;
  error?: string | undefined;
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly kind: 'jaringan' | 'terpotong' | 'rusak' | 'server' | 'tidak-dikenal',
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

/** Read a streamed body to the end, reporting bytes as they arrive. */
/* oxlint-disable no-await-in-loop -- reading a stream and downloading file after file are sequential
   by nature: a stream has no "all chunks at once", and running the files in parallel would mean a
   phone on a weak connection splits its bandwidth across several half-finished files, any one of
   which can die and be lost. One at a time is what makes a retry resume cleanly. */
async function readAll(result: FetchResult, onBytes: (n: number) => void): Promise<Uint8Array> {
  if (!result.body) throw new DownloadError('Server tidak mengirim isi berkas.', 'server');
  const reader = result.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let chunk: { done: boolean; value?: Uint8Array | undefined };
    try {
      chunk = await reader.read();
    } catch {
      throw new DownloadError('Koneksi terputus di tengah unduhan.', 'jaringan');
    }
    if (chunk.done) break;
    if (!chunk.value) continue;
    parts.push(chunk.value);
    total += chunk.value.length;
    onBytes(total);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* oxlint-enable no-await-in-loop */

/** Every cache key that belongs to an area, whatever its version. */
async function areaKeys(cache: DataCache, area: string): Promise<string[]> {
  return (await cache.keys()).filter((k) => k.startsWith(`${area}-`));
}

/**
 * Download (or finish downloading) one area. Resolves when the area is installed; rejects with a
 * `DownloadError` otherwise, having written nothing that is not complete and verified.
 */
/* oxlint-disable no-await-in-loop -- see readAll: file after file on purpose */
export async function downloadArea(
  manifest: DataManifest,
  area: string,
  deps: DownloadDeps,
  base: string,
  onProgress: (p: DownloadProgress) => void = () => undefined,
): Promise<void> {
  const def = manifest.areas[area];
  if (!def) throw new DownloadError(`Area "${area}" tidak ada di manifest.`, 'tidak-dikenal');
  const total = def.bytes;
  let done = 0;
  const report = (state: DownloadState, file: number, extra = 0, error?: string): void =>
    onProgress({ area, state, done: Math.min(total, done + extra), total, file, files: def.files.length, error });

  try {
    for (let i = 0; i < def.files.length; i++) {
      const f = def.files[i];
      // already downloaded and verified in an earlier attempt: that is what makes a retry resume
      if (await deps.cache.has(f.url)) {
        done += f.bytes;
        report('mengunduh', i + 1);
        continue;
      }
      report('mengunduh', i + 1);
      let result: FetchResult;
      try {
        result = await deps.fetch(`${base}${f.url}`);
      } catch {
        throw new DownloadError('Tidak bisa terhubung ke server.', 'jaringan');
      }
      if (!result.ok) throw new DownloadError(`Server menjawab ${result.status}.`, 'server');
      const bytes = await readAll(result, (n) => report('mengunduh', i + 1, n));

      report('memeriksa', i + 1, bytes.length);
      if (bytes.length !== f.bytes) {
        throw new DownloadError(`Berkas terpotong: ${bytes.length} dari ${f.bytes} byte.`, 'terpotong');
      }
      if ((await deps.sha256(bytes)) !== f.sha256) {
        throw new DownloadError('Isi berkas tidak cocok dengan manifest (rusak di jalan).', 'rusak');
      }
      // only now, complete and verified, does it touch the cache
      await deps.cache.put(f.url, bytes);
      done += f.bytes;
    }

    // the marker goes last: an area is installed only when every file above is in
    deps.installed.set(area, def.version);

    // and only now, with the new version complete, is the old one removed
    const keep = new Set(def.files.map((f) => f.url));
    const stale = (await areaKeys(deps.cache, area)).filter((key) => !keep.has(key));
    await Promise.all(stale.map((key) => deps.cache.delete(key)));

    report('selesai', def.files.length);
  } catch (e) {
    const err = e instanceof DownloadError ? e : new DownloadError(String((e as Error)?.message ?? e), 'tidak-dikenal');
    report('gagal', 0, 0, err.message);
    throw err;
  }
}

/* oxlint-enable no-await-in-loop */

/** Remove an area's data: the marker first (so it is never "installed but missing"), then the files. */
export async function deleteArea(area: string, deps: Pick<DownloadDeps, 'cache' | 'installed'>): Promise<number> {
  deps.installed.set(area, null);
  const keys = await areaKeys(deps.cache, area);
  await Promise.all(keys.map((k) => deps.cache.delete(k)));
  return keys.length;
}

/** How many bytes of an area are already in the cache (for "0,31 dari 0,56 MB" before resuming). */
export async function cachedBytes(manifest: DataManifest, area: string, cache: DataCache): Promise<number> {
  const def = manifest.areas[area];
  if (!def) return 0;
  const present = await Promise.all(def.files.map((f) => cache.has(f.url)));
  return def.files.reduce((n, f, i) => n + (present[i] ? f.bytes : 0), 0);
}

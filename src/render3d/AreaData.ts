/**
 * The phone side of the area data: the browser's storage, the downloads, and turning a downloaded
 * pack back into chunk ground textures.
 *
 * `core/download/*` holds every rule (what counts as installed, how a download resumes, which
 * areas are gated); this file only supplies the browser: Cache Storage for the files, `fetch` with
 * a streaming body for progress, `crypto.subtle` for the SHA-256 check, `localStorage` for the
 * installed markers, `navigator.storage` for the quota and the persistence request, and
 * `DecompressionStream` to inflate a chunk.
 *
 * Decoding is **lazy and asynchronous**: a pack is held compressed (0.2–0.6 MB per area) and a
 * chunk is inflated only when the streamer is about to need it, off the main thread's critical
 * path. The streamer asks `ground(cx, cy)`: a ready pixmap, `'pending'` while it inflates (the
 * chunk waits a frame or two), or `null` when there is no pack for it — in which case the phone
 * bakes it itself, exactly as it always did.
 */
import { CHUNK_PX } from '../config';
import { Pixmap } from '../art/pixmap';
import { readRaw, writeRaw } from '../core/storage';
import { decodePack } from '../core/download/pack';
import { areaStatus, parseManifest, type DataManifest } from '../core/download/manifest';
import { cachedBytes, deleteArea, downloadArea, type DataCache, type DownloadDeps, type DownloadProgress, type FetchResult } from '../core/download/downloader';
import { areaBlocked, type DataStatus } from '../core/download/gate';

const CACHE_NAME = 'lentera-malam-data';
const INSTALLED_KEY = 'lentera-malam/data/installed';
/** Decoded chunk textures kept in memory: about three screens' worth, ~12 MB. */
const DECODED_KEEP = 48;

const keyOf = (cx: number, cy: number): number => cy * 1000 + cx;

export interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean | null;
}

/** A progress callback plus the latest value, so the UI can open mid-download and still see it. */
export interface AreaDownload {
  progress: DownloadProgress | null;
  promise: Promise<void> | null;
}

export class AreaData {
  manifest: DataManifest | null = null;
  /** False when this browser cannot cache files at all — see core/download/gate.ts. */
  readonly available: boolean;
  /** Why the manifest could not be read, for the Download Manager. */
  manifestError: string | null = null;
  private readonly base: string;
  private installed: Record<string, string>;
  private readonly downloads = new Map<string, AreaDownload>();
  /** Compressed chunk payloads of every loaded area. */
  private readonly packed = new Map<number, Uint8Array>();
  private readonly loadedAreas = new Set<string>();
  private readonly decoded = new Map<number, Pixmap>();
  private readonly inflight = new Set<number>();
  /** Fired whenever a status changes, so open panels can redraw. */
  onChange: () => void = () => undefined;

  constructor(base = './data/') {
    this.base = base;
    this.available =
      typeof caches !== 'undefined' &&
      typeof fetch === 'function' &&
      typeof crypto !== 'undefined' &&
      !!crypto.subtle &&
      typeof DecompressionStream !== 'undefined';
    this.installed = this.readInstalled();
  }

  // ───────────────────────── browser dependencies ─────────────────────────

  private readInstalled(): Record<string, string> {
    try {
      const raw = readRaw(INSTALLED_KEY);
      const v = raw ? (JSON.parse(raw) as unknown) : {};
      if (!v || typeof v !== 'object') return {};
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === 'string') out[k] = val;
      return out;
    } catch {
      return {};
    }
  }

  private deps(): DownloadDeps {
    const cacheP = caches.open(CACHE_NAME);
    const url = (name: string): string => `${this.base}${name}`;
    const cache: DataCache = {
      has: async (name) => !!(await (await cacheP).match(url(name))),
      put: async (name, bytes) =>
        (await cacheP).put(url(name), new Response(bytes as BodyInit, { headers: { 'Content-Type': 'application/octet-stream' } })),
      get: async (name) => {
        const r = await (await cacheP).match(url(name));
        return r ? new Uint8Array(await r.arrayBuffer()) : null;
      },
      delete: async (name) => {
        await (await cacheP).delete(url(name));
      },
      keys: async () => (await (await cacheP).keys()).map((req) => req.url.replace(/^.*\//, '')),
    };
    return {
      cache,
      fetch: async (u) => {
        const r = await fetch(u, { cache: 'no-store' });
        return { ok: r.ok, status: r.status, body: r.body as FetchResult['body'] };
      },
      sha256: async (bytes) => {
        const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      },
      installed: {
        get: () => ({ ...this.installed }),
        set: (area, version) => {
          if (version === null) delete this.installed[area];
          else this.installed[area] = version;
          writeRaw(INSTALLED_KEY, JSON.stringify(this.installed));
        },
      },
    };
  }

  // ───────────────────────── lifecycle ─────────────────────────

  /**
   * Read the manifest and load whatever is already installed. Never throws: an offline start just
   * means "nothing new can be downloaded right now", and installed areas still work from the cache.
   */
  async init(): Promise<void> {
    if (!this.available) return;
    try {
      const r = await fetch(`${this.base}manifest.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      this.manifest = parseManifest(await r.json());
      if (!this.manifest) throw new Error('manifest tidak sah');
      this.manifestError = null;
    } catch (e) {
      this.manifestError = String((e as Error)?.message ?? e);
    }
    const areas = this.manifest ? Object.keys(this.manifest.areas) : Object.keys(this.installed);
    await Promise.all(areas.filter((a) => this.installed[a]).map((a) => this.loadArea(a)));
    this.onChange();
  }

  /** Move an installed area's packs from the cache into memory (still compressed). */
  private async loadArea(area: string): Promise<boolean> {
    const def = this.manifest?.areas[area];
    if (!def) return false;
    const deps = this.deps();
    const files = await Promise.all(def.files.map((f) => deps.cache.get(f.url)));
    if (files.some((f) => !f)) {
      // the marker says installed but a file is gone (the browser evicted it): not installed
      deps.installed.set(area, null);
      return false;
    }
    for (const bytes of files) {
      const entries = decodePack(bytes!);
      if (!entries) {
        deps.installed.set(area, null);
        return false;
      }
      for (const e of entries) this.packed.set(keyOf(e.cx, e.cy), e.payload);
    }
    this.loadedAreas.add(area);
    return true;
  }

  // ───────────────────────── status & downloads ─────────────────────────

  status(area: string): DataStatus {
    const d = this.downloads.get(area);
    if (d?.progress?.state === 'mengunduh' || d?.progress?.state === 'memeriksa') return 'mengunduh';
    if (d?.progress?.state === 'gagal') return 'gagal';
    if (!this.manifest) return this.installed[area] ? 'terpasang' : 'belum';
    return areaStatus(this.manifest, this.installed, area);
  }

  blocked(area: string): boolean {
    return areaBlocked(area, { available: this.available && !!this.manifest, core: this.manifest?.core ?? 'village', status: (a) => this.status(a) });
  }

  progress(area: string): DownloadProgress | null {
    return this.downloads.get(area)?.progress ?? null;
  }

  sizeOf(area: string): number {
    return this.manifest?.areas[area]?.bytes ?? 0;
  }

  async cachedBytes(area: string): Promise<number> {
    if (!this.manifest || !this.available) return 0;
    return cachedBytes(this.manifest, area, this.deps().cache);
  }

  /** Download an area. Joins a download already running instead of starting a second one. */
  download(area: string): Promise<void> {
    const running = this.downloads.get(area);
    if (running?.promise) return running.promise;
    if (!this.manifest) return Promise.reject(new Error(this.manifestError ?? 'manifest belum terbaca'));
    const entry: AreaDownload = { progress: null, promise: null };
    this.downloads.set(area, entry);
    entry.promise = downloadArea(this.manifest, area, this.deps(), this.base, (p) => {
      entry.progress = p;
      this.onChange();
    })
      .then(async () => {
        await this.loadArea(area);
        this.decoded.clear();
      })
      .finally(() => {
        entry.promise = null;
        this.onChange();
      });
    return entry.promise;
  }

  async remove(area: string): Promise<void> {
    await deleteArea(area, this.deps());
    this.loadedAreas.delete(area);
    // forget the chunks it supplied; the phone bakes them again if they are needed
    this.packed.clear();
    await Promise.all([...this.loadedAreas].map((a) => this.loadArea(a)));
    this.decoded.clear();
    this.downloads.delete(area);
    this.onChange();
  }

  async storage(): Promise<StorageInfo> {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const est = nav?.storage?.estimate ? await nav.storage.estimate() : {};
    const persisted = nav?.storage?.persisted ? await nav.storage.persisted() : null;
    return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
  }

  /**
   * Ask the browser not to evict our data under storage pressure. Android Chrome decides by itself
   * (usually yes for an installed or often-used site); where it is not supported this returns null.
   */
  async requestPersist(): Promise<boolean | null> {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.storage?.persist) return null;
    return nav.storage.persist();
  }

  // ───────────────────────── chunk ground ─────────────────────────

  /**
   * The pre-baked ground for a chunk, if a pack supplied it.
   *
   * `null` means "no pack covers this chunk — bake it yourself"; `'pending'` means it is being
   * inflated right now and will be ready in a frame or two.
   */
  ground(cx: number, cy: number): Pixmap | 'pending' | null {
    const key = keyOf(cx, cy);
    const hit = this.decoded.get(key);
    if (hit) return hit;
    if (!this.packed.has(key)) return null;
    this.prefetch(cx, cy);
    return 'pending';
  }

  /** Start inflating a chunk now, so it is ready by the time the streamer gets to it. */
  prefetch(cx: number, cy: number): void {
    const key = keyOf(cx, cy);
    if (this.decoded.has(key) || this.inflight.has(key)) return;
    const payload = this.packed.get(key);
    if (!payload) return;
    this.inflight.add(key);
    void inflate(payload)
      .then((raw) => {
        if (raw.length !== CHUNK_PX * CHUNK_PX * 4) return;
        const pm = new Pixmap(CHUNK_PX, CHUNK_PX);
        pm.data.set(raw);
        this.decoded.set(key, pm);
        // keep the most recent few; the rest are cheap to inflate again
        while (this.decoded.size > DECODED_KEEP) this.decoded.delete(this.decoded.keys().next().value!);
      })
      .catch(() => {
        // a payload that will not inflate is treated as absent: the phone bakes that chunk
        this.packed.delete(key);
      })
      .finally(() => this.inflight.delete(key));
  }

  /** For the report. */
  describe(): string {
    if (!this.available) return 'data area: tidak tersedia di browser ini (tanah dipanggang di HP)';
    if (!this.manifest) return `data area: manifest belum terbaca${this.manifestError ? ` (${this.manifestError})` : ''}`;
    const parts = Object.keys(this.manifest.areas).map((a) => `${a} ${this.status(a)}`);
    return `data area: ${parts.join(', ')}   chunk dari paket: ${this.packed.size}, terdekode ${this.decoded.size}`;
  }
}

async function inflate(payload: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([payload as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

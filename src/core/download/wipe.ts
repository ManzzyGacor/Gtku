/**
 * Where downloaded world data lives on the phone, and how to remove all of it.
 *
 * Here rather than in `render3d/AreaData.ts` so Settings can offer "Hapus semua data dunia" from the
 * title screen, before any world (and so any `AreaData`) exists. Browser APIs are feature-tested:
 * without Cache Storage there is nothing to remove.
 */
import { removeRaw } from '../storage';

export const DATA_CACHE_NAME = 'lentera-malam-data';
export const DATA_INSTALLED_KEY = 'lentera-malam/data/installed';

/**
 * Delete every downloaded area. The "installed" markers go **first**: if the cache delete is cut
 * short, the worst case is data on disk that nothing claims (downloaded again on demand), never a
 * marker pointing at data that is gone.
 */
export async function wipeWorldData(): Promise<boolean> {
  removeRaw(DATA_INSTALLED_KEY);
  if (typeof caches === 'undefined') return false;
  try {
    return await caches.delete(DATA_CACHE_NAME);
  } catch {
    return false;
  }
}

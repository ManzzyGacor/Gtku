/**
 * Small shared UI effects, and the one graphics decision the UI has to make for itself.
 *
 * **Blur.** `backdrop-filter` is a full-screen filter: the compositor re-renders everything behind
 * the panel, every frame, at device resolution. On a weak phone that is the difference between a
 * menu that opens and a menu that stutters open — so it is gated on the graphics preset, exactly as
 * the plan asks ("efek blur hanya di preset Tinggi ke atas supaya tetap ringan").
 */
import { profileOf } from '../core/graphics';
import { settings } from '../core/settings';

/** True when the current preset can afford a backdrop blur. */
export function blurAllowed(): boolean {
  const preset = settings.get('preset');
  return preset === 'high' || preset === 'ultra';
}

/** The preset's own opinion, for anything else that wants to scale an effect. */
export function effectBudget(): number {
  const p = profileOf(settings.get('preset'));
  return p.bloom ? 1 : 0.5;
}

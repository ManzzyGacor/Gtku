/** Anything the hero can talk to / touch: NPCs, shrines (checkpoints), signs, the Great Lantern. */
export interface Interactable {
  id: string;
  x: number;
  y: number;
  range: number;
  /** Prompt label, or null when currently unavailable. */
  label: () => string | null;
  interact: () => void;
}

export function nearestInteractable(list: Interactable[], x: number, y: number): Interactable | null {
  let best: Interactable | null = null;
  let bd = Infinity;
  for (const it of list) {
    if (it.label() === null) continue;
    const d = Math.hypot(it.x - x, it.y - y);
    if (d <= it.range && d < bd) {
      bd = d;
      best = it;
    }
  }
  return best;
}

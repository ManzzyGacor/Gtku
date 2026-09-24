/** Anything the hero can talk to / touch: NPCs, shrines (checkpoints), signs, the Great Lantern. */
export interface Interactable {
  id: string;
  x: number;
  y: number;
  range: number;
  /** Prompt label, or null when currently unavailable. */
  label: () => string | null;
  interact: () => void;
  /**
   * How high above the object the "there is something here" marker floats, in world units.
   * Villagers are tall, signs and chests are not, and a marker inside a chest reads as nothing.
   */
  markerLift?: number | undefined;
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

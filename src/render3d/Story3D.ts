/**
 * Everything that makes the world a game rather than a sandbox: villagers, the things you can
 * talk to or touch, the main quest, the checkpoints you rest at, the Great Lantern's payoff, and
 * the heal orbs enemies drop.
 *
 * Ported from the 2D `GameScene`, and it runs the *same* pure logic — `advanceQuest`,
 * `dialogueFor`, `nearestInteractable` — so the quest reaches the same four stages in the same
 * order, with the same dialogue.
 */
import * as THREE from 'three';
import { TILE, WORLD_CHUNKS_H, WORLD_CHUNKS_W } from '../config';
import { sfx } from '../core/audio';
import { input } from '../core/input';
import { EXP_REWARDS } from '../core/progression';
import { nearestInteractable, type Interactable } from '../core/systems/interactables';
import { advanceQuest, dialogueFor, QUEST_TITLE, trackerLines, type NpcId, type QuestEvent, type QuestReward } from '../core/systems/quest';
import type { GameState } from '../core/state/GameState';
import type { HeroCore } from '../core/entities/HeroCore';
import type { Collision } from '../core/world/collision';
import type { NpcDef, WorldSource } from '../core/world/source';
import type { DialogueSpec } from '../ui/Dialogue';
import type { MapMark } from '../ui/Minimap';
import { NpcMesh3D } from './NpcMesh3D';
import { u } from './worldPlan';

/** A heal orb an enemy dropped. */
interface Pickup {
  x: number;
  y: number;
  age: number;
  heal: number;
  mesh: THREE.Mesh;
}

export interface StoryHooks {
  dialogue(spec: DialogueSpec): void;
  toast(text: string): void;
  banner(text: string): void;
  hint(text: string | null): void;
  /** Rising text at a world position (px). */
  float(x: number, y: number, text: string, color: string, big?: boolean): void;
  spark(x: number, y: number, color: number, big: boolean): void;
  save(force?: boolean): void;
  shake(amount: number, seconds: number): void;
  /** EXP for a discovery: a sign read, a shrine rested at, a chest opened (Batch 4). */
  exp(amount: number, x: number, y: number): void;
  /** Roll a loot table into the bag. `kind` names the table in `core/items/drops.ts`. */
  loot(kind: string, x: number, y: number): void;
  /** Hand over a quest stage's reward (EXP and named items). */
  reward(reward: QuestReward, x: number, y: number): void;
  /** A quest step moved. Shown as its own notification rather than a passing toast. */
  questNote(text: string): void;
}

export class Story3D {
  private npcs: NpcMesh3D[] = [];
  private interactables: Interactable[] = [];
  private pickups: Pickup[] = [];
  /** Caches for the two things the HUD asks for every frame (see `mapMarks`/`questText`). */
  private marksCache: MapMark[] | null = null;
  private marksStage = -1;
  private questCache: { title: string; lines: string[] } | null = null;
  private questStage = -1;
  private questKills = -1;
  private orbGeo: THREE.BufferGeometry;
  private orbMat: THREE.MeshBasicMaterial;
  /** The Great Lantern's beacon, switched on when the quest completes. */
  private beacon: THREE.PointLight;
  private beaconGlow: THREE.Mesh;
  private beaconMat: THREE.MeshBasicMaterial;
  private clock = 0;
  /** Where the hero was on the last update, so a quest reward can float above them. */
  private heroX = 0;
  private heroY = 0;

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly world: WorldSource,
    private readonly collision: Collision,
    private readonly state: GameState,
    private readonly hooks: StoryHooks,
  ) {
    this.orbGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0x7cf07c });

    const m = this.world.markers.lantern;
    this.beacon = new THREE.PointLight(0xffd08a, 0, 26, 1.4);
    this.beacon.position.set(u(m.x), 4.2, u(m.y));
    scene.add(this.beacon);
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.beaconGlow = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), this.beaconMat);
    this.beaconGlow.position.copy(this.beacon.position);
    this.beaconGlow.visible = false;
    scene.add(this.beaconGlow);

    this.build();
  }

  // ───────────────────────── world scan ─────────────────────────

  /**
   * Walk every chunk once and collect the villagers, the readable signs and the checkpoints.
   * The world is 128 chunks, and this runs at load: cheaper than tracking it during streaming,
   * and it means an NPC never fails to exist because their chunk happened to be unloaded.
   */
  private build(): void {
    for (let cy = 0; cy < WORLD_CHUNKS_H; cy++)
      for (let cx = 0; cx < WORLD_CHUNKS_W; cx++) {
        const chunk = this.world.chunk(cx, cy);
        for (const n of chunk.npcs) {
          this.npcs.push(new NpcMesh3D(this.scene, n));
          // villagers are solid, so you cannot walk through the elder
          this.collision.addBlocker(Math.floor(n.x / TILE), Math.floor(n.y / TILE));
          this.interactables.push({
            id: n.id,
            x: n.x,
            y: n.y,
            range: 34,
            label: () => 'Bicara',
            interact: () => this.talk(n),
          });
        }
        for (const p of chunk.props) {
          if (p.type === 'sign' && p.text) {
            const text = p.text;
            const id = `sign_${p.x}_${p.y}`;
            this.interactables.push({
              id,
              x: p.x,
              y: p.y - 4,
              range: 26,
              label: () => 'Baca',
              interact: () => {
                this.hooks.dialogue({ name: 'Papan', lines: [text] });
                // reading something for the first time is exploring, and exploring pays (once)
                this.discover(`read_${id}`, EXP_REWARDS.discovery, p.x, p.y);
              },
            });
          }
          if (p.type === 'chest') {
            const id = `chest_${p.x}_${p.y}`;
            this.interactables.push({
              id,
              x: p.x,
              y: p.y - 4,
              range: 28,
              label: () => (this.state.flags[id] ? 'Sudah kosong' : 'Buka'),
              interact: () => this.openChest(id, p.x, p.y),
            });
          }
        }
      }
    for (const cp of this.world.markers.checkpoints) {
      this.interactables.push({
        id: cp.id,
        x: cp.x,
        y: cp.y - 4,
        range: 32,
        label: () => 'Istirahat',
        interact: () => this.rest(cp.id, cp.name),
      });
    }
    this.refreshMarkers();
    this.setLanternLit(!!this.state.flags.lanternLit, false);
  }

  // ───────────────────────── quest ─────────────────────────

  private talk(n: NpcDef): void {
    const script = dialogueFor(n.id as NpcId, this.state);
    this.hooks.dialogue({
      name: n.name,
      look: n.look,
      lines: script.lines,
      onDone: () => {
        if (script.onDone) this.questEvent(script.onDone);
      },
    });
  }

  /** Apply a quest event, tell the player, and persist. Same rules as the 2D build. */
  questEvent(ev: QuestEvent): void {
    const r = advanceQuest(this.state, ev);
    if (!r.changed) return;
    if (r.message) this.hooks.questNote(r.message);
    if (r.reward) this.hooks.reward(r.reward, this.heroX, this.heroY);
    if (r.lightLantern) this.lightLantern();
    this.refreshMarkers();
    if (ev.type !== 'kill' || r.message) this.hooks.save();
  }

  private refreshMarkers(): void {
    const stage = this.state.quest.stage;
    for (const npc of this.npcs) {
      if (npc.def.id !== 'wulan') {
        npc.setMarker(null);
        continue;
      }
      npc.setMarker(stage === 0 ? 'quest' : stage === 3 ? 'turnin' : null);
    }
  }

  /** The finale: the Great Lantern burns again. */
  private lightLantern(): void {
    const m = this.world.markers.lantern;
    this.setLanternLit(true, true);
    this.hooks.spark(m.x, m.y - 40, 0xffd98a, true);
    this.hooks.banner('Lentera Agung menyala kembali!');
    this.hooks.shake(3, 0.6);
  }

  private setLanternLit(lit: boolean, announce: boolean): void {
    this.state.flags.lanternLit = lit;
    this.beacon.intensity = lit ? 6 : 0;
    this.beaconGlow.visible = lit;
    this.beaconMat.opacity = lit ? 0.5 : 0;
    void announce;
  }

  /** Shrine / lantern: heal fully, remember the checkpoint, save. */
  /**
   * A chest. Opened once, and the flag lives in the save, so a chest you emptied stays empty
   * across sessions — finding one has to mean something.
   */
  private openChest(id: string, x: number, y: number): void {
    if (this.state.flags[id]) {
      this.hooks.hint(null);
      this.hooks.dialogue({ name: 'Peti', lines: ['Sudah kosong. Kamu yang mengambilnya.'] });
      return;
    }
    this.state.flags[id] = true;
    this.hooks.loot('chest', x, y);
    this.hooks.exp(EXP_REWARDS.chest, x, y - 8);
    this.hooks.spark(x, y - 8, 0xffd98a, true);
    this.hooks.save(true);
    this.refreshMarkers();
  }

  /** One-off exploration EXP, guarded by a save flag. */
  private discover(flag: string, amount: number, x: number, y: number): void {
    if (this.state.flags[flag]) return;
    this.state.flags[flag] = true;
    this.hooks.exp(amount, x, y - 8);
  }

  private rest(id: string, name: string): void {
    this.state.checkpoint = id;
    this.hooks.toast(`${name}: HP pulih, progres tersimpan`);
    // the first time you find a shrine is a discovery; after that it is just a bed
    const cp = this.world.markers.checkpoints.find((c) => c.id === id);
    if (cp) this.discover(`found_${id}`, EXP_REWARDS.discovery, cp.x, cp.y);
    this.hooks.save(true);
    this.onRest();
  }

  /** Set by the game so resting can heal the hero. */
  onRest: () => void = () => undefined;

  // ───────────────────────── pickups ─────────────────────────

  /** Enemies sometimes leave a heal orb behind. */
  dropHeal(x: number, y: number, heal = 2): void {
    const mesh = new THREE.Mesh(this.orbGeo, this.orbMat);
    mesh.position.set(u(x), 0.6, u(y));
    this.scene.add(mesh);
    this.pickups.push({ x, y, age: 0, heal, mesh });
  }

  private updatePickups(realDt: number, hero: HeroCore): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.age += realDt;
      const d = Math.hypot(hero.x - p.x, hero.y - 6 - p.y);
      // after a moment they drift toward the hero, so a kill never leaves loot stranded
      if (p.age > 0.35 && d < 50 && hero.alive && d > 0.001) {
        p.x += ((hero.x - p.x) / d) * 130 * realDt;
        p.y += ((hero.y - 6 - p.y) / d) * 130 * realDt;
      }
      p.mesh.position.set(u(p.x), 0.6 + Math.sin(p.age * 5) * 0.12, u(p.y));
      p.mesh.rotation.y += realDt * 3;
      if (d < 10 && hero.alive && hero.hp < hero.maxHp) {
        hero.heal(p.heal);
        this.hooks.float(hero.x, hero.y - 26, `+${p.heal}`, '#7cf07c');
        this.hooks.spark(p.x, p.y, 0x7cf07c, false);
        p.mesh.removeFromParent();
        this.pickups.splice(i, 1);
      } else if (p.age > 18) {
        p.mesh.removeFromParent();
        this.pickups.splice(i, 1);
      }
    }
  }

  // ───────────────────────── per frame ─────────────────────────

  /** @returns the interact prompt to show, if any. */
  update(dt: number, realDt: number, hero: HeroCore, cameraYaw: number, dialogueOpen: boolean): void {
    this.clock += realDt;
    this.heroX = hero.x;
    this.heroY = hero.y;
    for (const npc of this.npcs) npc.update(realDt, cameraYaw);
    this.updatePickups(realDt, hero);

    if (this.beaconGlow.visible) {
      const flicker = 0.42 + Math.sin(this.clock * 2.2) * 0.06 + Math.sin(this.clock * 5.7) * 0.03;
      this.beaconMat.opacity = flicker;
      this.beacon.intensity = 5.4 + flicker * 2;
    }

    let label: string | null = null;
    if (!dialogueOpen && hero.alive && dt > 0) {
      const it = nearestInteractable(this.interactables, hero.x, hero.y);
      label = it ? it.label() : null;
      if (it && input.consume('interact', 120)) {
        it.interact();
        sfx.swap();
      }
    }
    this.hooks.hint(label);
  }

  /**
   * Markers for the minimap: villagers, checkpoints and the current objective.
   *
   * Cached on the quest stage, which is the only thing that can change them — the HUD asks for
   * this every frame, and rebuilding a dozen objects sixty times a second to describe a map that
   * changes four times a playthrough is pure garbage.
   */
  mapMarks(): MapMark[] {
    const stage = this.state.quest.stage;
    if (this.marksCache && this.marksStage === stage) return this.marksCache;
    const out: MapMark[] = [];
    for (const npc of this.npcs) {
      const highlight = npc.def.id === 'wulan' && (stage === 0 || stage === 3);
      out.push({ x: npc.def.x, y: npc.def.y, color: highlight ? '#ffd15a' : '#66e0ff', size: highlight ? 3 : 2 });
    }
    for (const cp of this.world.markers.checkpoints) out.push({ x: cp.x, y: cp.y, color: '#ffb04a' });
    if (stage === 2) {
      const b = this.world.markers.boss.spawn;
      out.push({ x: b.x, y: b.y, color: '#ff5a4a', size: 3 });
    }
    this.marksStage = stage;
    this.marksCache = out;
    return out;
  }

  /** Also asked for every frame, and also only changes on a stage or a kill. */
  questText(): { title: string; lines: string[] } {
    const q = this.state.quest;
    if (this.questCache && this.questStage === q.stage && this.questKills === q.kills) return this.questCache;
    this.questStage = q.stage;
    this.questKills = q.kills;
    this.questCache = { title: QUEST_TITLE, lines: trackerLines(this.state) };
    return this.questCache;
  }

  dispose(): void {
    for (const npc of this.npcs) npc.dispose();
    this.npcs = [];
    for (const p of this.pickups) p.mesh.removeFromParent();
    this.pickups = [];
    this.beaconGlow.removeFromParent();
    this.beacon.removeFromParent();
    this.beaconGlow.geometry.dispose();
    this.beaconMat.dispose();
    this.orbGeo.dispose();
    this.orbMat.dispose();
  }
}

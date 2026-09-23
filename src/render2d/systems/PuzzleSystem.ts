/** Phaser side of the cave puzzle: push-rock, pressure plate, sealed gate, and the boss-arena door. */
import Phaser from 'phaser';
import { TILE } from '../../config';
import { input } from '../../core/input';
import { frameOf } from '../register';
import type { GameScene } from '../scenes/GameScene';
import { pushIntent, RockPuzzle } from '../../core/systems/puzzleLogic';

interface DoorDef {
  tx: number;
  ty: number;
  w: number;
  h: number;
}

export class PuzzleSystem {
  readonly logic: RockPuzzle;
  private rock: Phaser.GameObjects.Image;
  private plate: Phaser.GameObjects.Image;
  private gate: Phaser.GameObjects.Image;
  private door: Phaser.GameObjects.Image;
  private gateDef: DoorDef;
  private doorDef: DoorDef;
  private gateOpen = false;
  private doorClosed = false;
  private sliding = false;
  private shudder = 0;
  private hintT = 0;

  constructor(private readonly game: GameScene) {
    const m = game.world.markers;
    this.gateDef = m.puzzle.gate;
    this.doorDef = m.boss.door;
    const col = game.collision;
    this.logic = new RockPuzzle(m.puzzle.rock, m.puzzle.plate, (tx, ty) => !col.solidTile(tx, ty));

    const mkDoor = (def: DoorDef, frame: string): Phaser.GameObjects.Image => {
      const f = frameOf('props', frame);
      const footY = (def.ty + def.h) * TILE - 2;
      return game.add.image(def.tx * TILE + TILE / 2, footY, 'props', frame).setOrigin((f.ax ?? f.w / 2) / f.w, (f.ay ?? f.h) / f.h).setDepth(footY);
    };
    this.gate = mkDoor(this.gateDef, 'gate_c');
    this.door = mkDoor(this.doorDef, 'boss_door_o');
    const pf = frameOf('props', 'plate_u');
    this.plate = game.add.image(m.puzzle.plate.tx * TILE + 8, m.puzzle.plate.ty * TILE + TILE - 1, 'props', 'plate_u').setOrigin((pf.ax ?? 8) / pf.w, (pf.ay ?? 13) / pf.h).setDepth(1);
    const rf = frameOf('props', 'pushrock');
    this.rock = game.add.image(0, 0, 'props', 'pushrock').setOrigin((rf.ax ?? 10) / rf.w, (rf.ay ?? 19) / rf.h);
    this.placeRock(true);
    this.blockGate(true);
  }

  private tileCenter(tx: number, ty: number): { x: number; y: number } {
    return { x: tx * TILE + TILE / 2, y: (ty + 1) * TILE - 1 };
  }

  private placeRock(instant: boolean): void {
    const p = this.tileCenter(this.logic.rock.tx, this.logic.rock.ty);
    if (instant) {
      this.rock.setPosition(p.x, p.y);
      this.rock.setDepth(p.y);
      this.game.collision.addBlocker(this.logic.rock.tx, this.logic.rock.ty);
    }
  }

  private blockGate(on: boolean): void {
    for (let i = 0; i < this.gateDef.h; i++) {
      if (on) this.game.collision.addBlocker(this.gateDef.tx, this.gateDef.ty + i);
      else this.game.collision.removeBlocker(this.gateDef.tx, this.gateDef.ty + i);
    }
  }

  /** Restore a solved puzzle from a save. */
  restoreSolved(): void {
    const c = this.game.collision;
    c.removeBlocker(this.logic.rock.tx, this.logic.rock.ty);
    this.logic.forceSolved();
    c.addBlocker(this.logic.rock.tx, this.logic.rock.ty);
    this.placeRock(false);
    const p = this.tileCenter(this.logic.rock.tx, this.logic.rock.ty);
    this.rock.setPosition(p.x, p.y).setDepth(p.y);
    this.plate.setFrame('plate_d');
    this.gate.setFrame('gate_o');
    if (!this.gateOpen) this.blockGate(false);
    this.gateOpen = true;
  }

  // ── boss door ──
  closeBossDoor(): void {
    if (this.doorClosed) return;
    this.doorClosed = true;
    this.door.setFrame('boss_door_c');
    for (let i = 0; i < this.doorDef.h; i++) this.game.collision.addBlocker(this.doorDef.tx, this.doorDef.ty + i);
    const x = this.doorDef.tx * TILE + 8;
    const y = (this.doorDef.ty + this.doorDef.h / 2) * TILE;
    this.game.fx.smokePuff(x, y, 10);
    this.game.fx.violetBurst(x, y, 14);
    this.game.rig.shake(3, 0.3);
  }

  openBossDoor(): void {
    if (!this.doorClosed) return;
    this.doorClosed = false;
    this.door.setFrame('boss_door_o');
    for (let i = 0; i < this.doorDef.h; i++) this.game.collision.removeBlocker(this.doorDef.tx, this.doorDef.ty + i);
    this.game.fx.smokePuff(this.doorDef.tx * TILE + 8, (this.doorDef.ty + 1.5) * TILE, 8);
  }

  // ── per frame ──
  update(dt: number, realDt: number): void {
    const g = this.game;
    const h = g.hero;
    const logic = this.logic;

    if (!logic.solved && !this.sliding && h.alive) {
      const ax = input.axis();
      const intent = pushIntent(h, ax.x, ax.y, logic.rock);
      const before = { ...logic.rock };
      const moved = logic.update(dt, intent);
      if (moved) {
        const c = g.collision;
        c.removeBlocker(before.tx, before.ty);
        c.addBlocker(logic.rock.tx, logic.rock.ty);
        this.slideTo(logic.rock.tx, logic.rock.ty);
        g.fx.step(before.tx * TILE + 8, before.ty * TILE + 12, 'stone', 4);
        g.rig.shake(1, 0.1);
        if (logic.solved) this.onSolved();
      }
      // shudder while pushing
      this.shudder = intent ? logic.pushProgress : 0;
      if (!this.sliding) {
        const p = this.tileCenter(logic.rock.tx, logic.rock.ty);
        this.rock.setPosition(p.x + (this.shudder > 0.05 ? (Math.floor(g.simTime * 30) % 2 ? 1 : -1) : 0), p.y);
      }
    }

    // reset the rock when the hero leaves the room (prevents soft-locks)
    if (!logic.solved && (logic.rock.tx !== logic.start.tx || logic.rock.ty !== logic.start.ty)) {
      const room = g.world.markers.puzzle.room;
      const tx = h.x / TILE;
      const ty = h.y / TILE;
      if (tx < room.x0 - 3 || tx > room.x1 + 3 || ty < room.y0 - 3 || ty > room.y1 + 3) this.resetRock();
    }

    // little hint sparkle on the plate until the puzzle is solved
    this.hintT -= realDt;
    if (!logic.solved && this.hintT <= 0) {
      this.hintT = 0.7;
      const m = g.world.markers.puzzle.plate;
      g.fx.cyanBurst(m.tx * TILE + 8, m.ty * TILE + 8, 1);
    }
    this.rock.setDepth(this.rock.y);
  }

  private slideTo(tx: number, ty: number): void {
    const p = this.tileCenter(tx, ty);
    this.sliding = true;
    this.game.tweens.add({
      targets: this.rock,
      x: p.x,
      y: p.y,
      duration: 190,
      ease: 'Sine.easeOut',
      onComplete: () => (this.sliding = false),
    });
  }

  private resetRock(): void {
    const c = this.game.collision;
    const before = { ...this.logic.rock };
    c.removeBlocker(before.tx, before.ty);
    this.logic.reset();
    c.addBlocker(this.logic.rock.tx, this.logic.rock.ty);
    const p = this.tileCenter(this.logic.rock.tx, this.logic.rock.ty);
    this.game.fx.smokePuff(before.tx * TILE + 8, before.ty * TILE + 8, 6);
    this.rock.setPosition(p.x, p.y);
    this.game.fx.smokePuff(p.x, p.y - 6, 6);
    this.sliding = false;
  }

  private onSolved(): void {
    const g = this.game;
    this.plate.setFrame('plate_d');
    this.gateOpen = true;
    this.blockGate(false);
    this.gate.setFrame('gate_o');
    const gx = this.gateDef.tx * TILE + 8;
    const gy = (this.gateDef.ty + this.gateDef.h / 2) * TILE;
    g.fx.violetBurst(gx, gy, 24);
    g.fx.smokePuff(gx, gy, 10);
    g.fx.glowPulse(this.plate.x, this.plate.y - 4, 34, 0xa795ff, 500);
    g.rig.shake(3.5, 0.5);
    g.state.puzzleSolved = true;
    g.ui?.toast('Gerbang terbuka!');
    g.events.emit('puzzle-solved');
  }

  destroy(): void {
    this.rock.destroy();
    this.plate.destroy();
    this.gate.destroy();
    this.door.destroy();
  }
}

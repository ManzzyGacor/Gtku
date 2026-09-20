import Phaser from 'phaser';
import { WORLD_PX_H, WORLD_PX_W } from '../config';
import { input } from '../core/input';
import { sheets } from '../art/register';
import { CameraRig } from '../systems/cameraRig';
import { ChunkManager } from '../systems/chunks';
import { HeroCore, type HeroInput } from '../entities/HeroCore';
import { HeroView } from '../entities/HeroView';
import { Collision } from '../world/collision';
import { GeneratedWorld } from '../world/worldgen';

export class GameScene extends Phaser.Scene {
  world!: GeneratedWorld;
  collision!: Collision;
  chunks!: ChunkManager;
  hero!: HeroCore;
  heroView!: HeroView;
  rig!: CameraRig;
  /** Seconds of game time (frozen during hit-stop). */
  simTime = 0;
  private freezeLeft = 0;

  constructor() {
    super('Game');
  }

  create(): void {
    this.world = new GeneratedWorld();
    this.collision = new Collision(this.world);
    this.chunks = new ChunkManager(this, this.world, sheets.get('tiles')!);
    const start = this.world.markers.playerStart;
    this.hero = new HeroCore(start.x, start.y);
    this.heroView = new HeroView(this, this.hero);

    const cam = this.cameras.main;
    cam.setBackgroundColor(0x0f0b1c);
    this.rig = new CameraRig(cam, WORLD_PX_W, WORLD_PX_H);
    this.rig.snap(start.x, start.y);
    this.chunks.preload(this.rig.view, 1);

    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.rig.snap(this.hero.x, this.hero.y));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.chunks.destroy());
  }

  /** Hit-stop: freeze simulation for `ms` while rendering keeps going. */
  freeze(ms: number): void {
    this.freezeLeft = Math.max(this.freezeLeft, ms / 1000);
  }

  override update(time: number, deltaMs: number): void {
    const realDt = Math.min(deltaMs / 1000, 1 / 20);
    let dt = realDt;
    if (this.freezeLeft > 0) {
      this.freezeLeft -= realDt;
      dt = 0;
    }
    this.simTime += dt;

    const ax = input.axis();
    const inp: HeroInput = {
      mx: ax.x,
      my: ax.y,
      attack: input.consume('attack'),
      dodge: input.consume('dodge'),
      skill: input.consume('skill'),
    };
    if (dt > 0) {
      const speedMult = this.collision.speedAt(this.hero.x, this.hero.y);
      this.hero.update(dt, inp, this.collision, speedMult);
    }
    this.hero.events.length = 0;
    this.heroView.update(dt, realDt, time / 1000);

    this.rig.update(realDt, this.hero.x, this.hero.y - 6, this.hero.vx, this.hero.vy);
    this.chunks.update(this.rig.view);
    this.chunks.step(5);
    this.chunks.animate(this.simTime);
  }
}

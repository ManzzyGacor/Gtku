/**
 * Dynamic 2D lighting.
 *  1. A half-resolution *lightmap* canvas is filled with the ambient colour (from the day/night cycle or the cave),
 *     every light is added on top (additive gradients) and a vignette is multiplied in.
 *  2. The lightmap is drawn over the whole scene with MULTIPLY blend.
 *  3. Additive halo sprites make lights glow above the scene (these feed the optional bloom).
 * Deterministic and cheap: ~300x135 canvas, ≤ 24 gradient blits per frame.
 */
import Phaser from 'phaser';
import { hashf } from '../core/rng';
import { PROPS, type LightDef } from '../core/world/props';
import type { LoadedChunk } from './chunks';
import type { RGB } from '../core/systems/daynight';

interface Light {
  x: number;
  y: number;
  radius: number;
  color: number;
  strength: number;
  flicker: number;
  nightOnly: boolean;
  phase: number;
}

interface Temp extends Light {
  life: number;
  max: number;
}

const SCALE = 2; // lightmap px per 2 logical px
const MAX_HALOS = 22;

const hex = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

export class Lighting {
  private ctx!: CanvasRenderingContext2D;
  private tex!: Phaser.Textures.CanvasTexture;
  private img!: Phaser.GameObjects.Image;
  private glowCache = new Map<number, HTMLCanvasElement>();
  private vignette: HTMLCanvasElement | null = null;
  private halos: Phaser.GameObjects.Image[] = [];
  private staticLights = new Map<LoadedChunk, Light[]>();
  private frameLights: Light[] = [];
  private temps: Temp[] = [];
  private w = 0;
  private h = 0;
  enabled = true;
  /** 0..1: how strong the vignette is. */
  vignetteStrength = 0.55;
  /** Update the canvas every N frames (adaptive quality can raise this). */
  everyN = 1;
  /** How many halos the current preset allows (pool size stays MAX_HALOS). */
  maxHalos = MAX_HALOS;
  private frameNo = 0;
  private lit = { lantern: false, lanternX: 0, lanternY: 0 };

  constructor(private readonly scene: Phaser.Scene) {
    this.build();
    for (let i = 0; i < MAX_HALOS; i++) {
      this.halos.push(scene.add.image(0, 0, 'fx', 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(5100).setScrollFactor(0).setVisible(false));
    }
    scene.scale.on(Phaser.Scale.Events.RESIZE, () => this.build());
  }

  private build(): void {
    const w = Math.ceil(this.scene.scale.width / SCALE);
    const h = Math.ceil(this.scene.scale.height / SCALE);
    if (this.tex && w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    if (this.tex) {
      this.tex.setSize(w, h);
      this.ctx = this.tex.getContext();
    } else {
      this.tex = this.scene.textures.createCanvas('lightmap', w, h)!;
      this.tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.ctx = this.tex.getContext();
      this.img = this.scene.add.image(0, 0, 'lightmap').setOrigin(0).setScrollFactor(0).setDepth(5000).setBlendMode(Phaser.BlendModes.MULTIPLY);
    }
    this.img.setDisplaySize(this.scene.scale.width, this.scene.scale.height);
    this.vignette = null;
  }

  // ── sources ──

  addChunk(c: LoadedChunk): void {
    const lights: Light[] = [];
    for (const p of c.data.props) {
      const def: LightDef | undefined = PROPS[p.type].light;
      if (!def) continue;
      lights.push({
        x: p.x,
        y: p.y - (def.lift ?? 10),
        radius: def.radius,
        color: def.color,
        strength: def.strength,
        flicker: def.flicker ?? 0,
        nightOnly: !!def.nightOnly,
        phase: hashf(p.x, p.y, 9) * 100,
      });
    }
    if (lights.length) this.staticLights.set(c, lights);
  }

  removeChunk(c: LoadedChunk): void {
    this.staticLights.delete(c);
  }

  /** A light for this frame only (hero lantern, boss core, projectiles). */
  light(x: number, y: number, radius: number, color: number, strength: number, flicker = 0): void {
    this.frameLights.push({ x, y, radius, color, strength, flicker, nightOnly: false, phase: x * 0.13 });
  }

  /** A fading light (skill flash, explosions). */
  flash(x: number, y: number, radius: number, color: number, strength: number, dur: number): void {
    this.temps.push({ x, y, radius, color, strength, flicker: 0, nightOnly: false, phase: 0, life: dur, max: dur });
  }

  setLantern(lit: boolean, x: number, y: number): void {
    this.lit = { lantern: lit, lanternX: x, lanternY: y };
  }

  // ── rendering ──

  private glow(color: number): HTMLCanvasElement {
    let c = this.glowCache.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const [r, gg, b] = hex(color);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    grad.addColorStop(0.35, `rgba(${r},${gg},${b},0.6)`);
    grad.addColorStop(0.7, `rgba(${r},${gg},${b},0.18)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glowCache.set(color, c);
    return c;
  }

  private vignetteCanvas(): HTMLCanvasElement {
    if (this.vignette) return this.vignette;
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const g = c.getContext('2d')!;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const rad = Math.hypot(cx, cy);
    const grad = g.createRadialGradient(cx, cy, rad * 0.38, cx, cy, rad * 1.02);
    const edge = Math.round(255 * (1 - this.vignetteStrength));
    grad.addColorStop(0, 'rgb(255,255,255)');
    grad.addColorStop(1, `rgb(${edge},${edge},${Math.min(255, edge + 12)})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, this.w, this.h);
    this.vignette = c;
    return c;
  }

  /** `night` 0..1 scales night-only lights; `haloBoost` 0..1 extra halo visibility (caves). */
  update(dt: number, time: number, scrollX: number, scrollY: number, ambient: RGB, night: number, haloBoost: number): void {
    // fade temps
    for (let i = this.temps.length - 1; i >= 0; i--) {
      this.temps[i].life -= dt;
      if (this.temps[i].life <= 0) this.temps.splice(i, 1);
    }
    this.frameNo++;
    const draw = this.frameNo % this.everyN === 0;
    const viewW = this.scene.scale.width;
    const viewH = this.scene.scale.height;

    const nightK = night < 0.15 ? 0 : night > 0.5 ? 1 : (night - 0.15) / 0.35;
    const all: Light[] = [];
    const push = (l: Light, s: number): void => {
      if (s < 0.02) return;
      if (l.x + l.radius < scrollX || l.x - l.radius > scrollX + viewW || l.y + l.radius < scrollY || l.y - l.radius > scrollY + viewH) return;
      all.push({ ...l, strength: s });
    };
    const strengthOf = (l: Light): number => {
      const flick = l.flicker ? 1 + l.flicker * (Math.sin(time * 9 + l.phase) * 0.6 + Math.sin(time * 23 + l.phase * 1.7) * 0.4) : 1;
      return l.strength * flick * (l.nightOnly ? nightK : 1);
    };
    for (const list of this.staticLights.values()) for (const l of list) push(l, strengthOf(l));
    for (const l of this.frameLights) push(l, strengthOf(l));
    for (const t of this.temps) push(t, t.strength * (t.life / t.max));
    if (this.lit.lantern) push({ x: this.lit.lanternX, y: this.lit.lanternY, radius: 150, color: 0xffd08a, strength: 1, flicker: 0.04, nightOnly: false, phase: 3 }, 1);
    this.frameLights.length = 0;

    if (draw && this.enabled) {
      const ctx = this.ctx;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgb(${Math.round(ambient[0] * 255)},${Math.round(ambient[1] * 255)},${Math.round(ambient[2] * 255)})`;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalCompositeOperation = 'lighter';
      for (const l of all) {
        const sx = (l.x - scrollX) / SCALE;
        const sy = (l.y - scrollY) / SCALE;
        const r = l.radius / SCALE;
        ctx.globalAlpha = Math.min(1, l.strength);
        ctx.drawImage(this.glow(l.color), sx - r, sy - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.vignetteCanvas(), 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      this.tex.refresh();
    }
    this.img.setVisible(this.enabled);

    // halos: the visible "glow" of light sources above the darkness
    const haloK = Math.min(1, 0.22 + night * 0.7 + haloBoost * 0.6);
    let n = 0;
    const budget = Math.max(0, Math.min(MAX_HALOS, this.maxHalos));
    for (const l of all) {
      if (n >= budget) break;
      const hImg = this.halos[n++];
      hImg.setVisible(this.enabled);
      hImg.setPosition(Math.round(l.x - scrollX), Math.round(l.y - scrollY));
      hImg.setTint(l.color);
      hImg.setScale((l.radius * 0.9) / 32);
      hImg.setAlpha(Math.min(0.9, l.strength * 0.4 * haloK));
    }
    for (let i = n; i < MAX_HALOS; i++) this.halos[i].setVisible(false);
  }

  destroy(): void {
    for (const h of this.halos) h.destroy();
    this.img.destroy();
    this.scene.textures.remove('lightmap');
  }
}

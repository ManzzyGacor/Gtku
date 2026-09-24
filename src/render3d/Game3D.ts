/**
 * The 3D game loop (docs/OVERHAUL.md, Fase 1).
 *
 * It owns the pixel renderer, the isometric camera and the greybox world, and it reuses the same
 * `src/core` logic as the 2D build: the same `GeneratedWorld`, the same day/night curve, the same
 * `input` hub, the same graphics presets and the same FPS watchdog. Nothing here is a second copy
 * of the game — it is a second *view* of it.
 */
import { buildTileSheet } from '../art/tiles';
import { AdaptiveQuality, probeDevice, profileOf, suggestPreset } from '../core/graphics';
import { input } from '../core/input';
import { PerfMeter } from '../core/perf';
import { settings } from '../core/settings';
import { DAY_SECONDS, gradeAt, nightAmount, smooth, timeLabel } from '../core/systems/daynight';
import { CAVE_X0, FOREST_X0 } from '../core/world/areas';
import { HeroCore, HERO_STATS, type HeroEvent, type HeroInput } from '../core/entities/HeroCore';
import { WEAPONS } from '../core/combat/weapons';
import { GameState } from '../core/state/GameState';
import { loadGame, saveGame } from '../core/save';
import { migrateSave } from '../core/saveMigrate';
import { AREAS, areaAtTile } from '../core/world/areas';
import { Dialogue } from '../ui/Dialogue';
import { Hud, type Projector } from '../ui/Hud';
import { Minimap } from '../ui/Minimap';
import { CharacterPanel } from '../ui/CharacterPanel';
import { Puzzle3D } from './Puzzle3D';
import { Story3D } from './Story3D';
import { sfx, unlockAudio } from '../core/audio';
import { Combat3D } from './Combat3D';
import { Collision } from '../core/world/collision';
import { GeneratedWorld } from '../core/world/worldgen';
import type { DiagnosticsSource } from '../ui/diagnostics';
import * as THREE from 'three';
import { Environment } from './Environment';
import { HeroMesh3D } from './HeroMesh3D';
import { CAMERA_DISTANCE, IsoCamera } from './IsoCamera';
import { PerfProbe, type ProbeScenario } from './PerfProbe';
import { PixelRenderer } from './PixelRenderer';
import { Sky } from './Sky';
import { World3D } from './World3D';
import { u } from './worldPlan';
import { Character } from '../core/stats/character';
import { itemDef, rarityMeta } from '../core/items/items';
import type { QuestReward } from '../core/systems/quest';
import { rollDrops } from '../core/items/drops';

/**
 * How many of the fixed light pool each preset actually lights up. Small on purpose: the static
 * lights are baked into the ground's light map, so these only add shading on nearby 3D objects.
 */
/** Cached so the HUD's energy bar does not reach into the stats table every frame. */
const HERO_SKILL_COOLDOWN = HERO_STATS.skillCooldown;

const LIGHT_BUDGET: Record<string, number> = { vlow: 0, low: 1, medium: 2, high: 3, ultra: 3 };

export class Game3D {
  readonly pixels: PixelRenderer;
  readonly camera = new IsoCamera();
  readonly world = new GeneratedWorld();
  readonly collision = new Collision(this.world);
  readonly sky: Sky;
  readonly environment: Environment;
  readonly scene3d: World3D;
  readonly hero: HeroCore;
  readonly heroMesh: HeroMesh3D;
  readonly state = new GameState();
  readonly combat: Combat3D;
  readonly hud: Hud;
  readonly dialogue: Dialogue;
  readonly minimap: Minimap;
  readonly sheet: CharacterPanel;
  readonly story: Story3D;
  readonly puzzle: Puzzle3D;
  readonly perf = new PerfMeter();
  /** Level, EXP, bag, equipment and the resolved stats every hit is calculated from (Batch 4). */
  readonly character = new Character();

  private adaptive = new AdaptiveQuality(this.perf);
  private tileSheet = buildTileSheet();
  private raf = 0;
  private lastFrame = 0;
  private dayTime = 0.35;
  private paused = false;
  /** Real seconds since boot, for flicker and breathing (keeps running while paused). */
  private clock = 0;
  /** Hit-stop: the simulation holds still while rendering carries on. */
  private freezeLeft = 0;
  private autosaveT = 30;
  private deathT = -1;
  private area: string | null = null;
  private readonly projected = new THREE.Vector3();
  /** Preset multiplier on the bloom (the cheapest thing to turn down). */
  private bloomScale = 1;
  private gradeLift = new THREE.Color();
  private gradeGain = new THREE.Color();
  private probe = new PerfProbe();
  /** Frame times for the report, in ms. */
  private frameMs = 16.7;
  private unsubscribe: () => void;
  private disposed = false;
  /** What the save migration had to change on load, shown in the report so it is never silent. */
  private saveNotes: string[] = [];

  constructor(parent: HTMLElement, options: { continue?: boolean } = {}) {
    this.pixels = new PixelRenderer(parent);
    // Created before the world: materials compiled afterwards then include the fog chunks.
    this.sky = new Sky(this.pixels.scene);
    this.scene3d = new World3D(this.pixels.scene, this.world, this.tileSheet);
    this.environment = new Environment(this.pixels.scene);

    const start = this.world.markers.playerStart;
    this.hero = new HeroCore(start.x, start.y);
    this.heroMesh = new HeroMesh3D(this.pixels.scene);
    this.camera.snap(u(start.x), u(start.y));

    // ── the save, before anything reads the state ──
    const stored = options.continue ? loadGame() : null;
    // Migration runs here and not in `loadGame` because only this far in does a world exist to
    // check the saved position against: a 2D-era save can point at a tile that is now solid.
    const migrated = stored ? migrateSave(stored, this.world, this.hero.maxHp) : null;
    if (migrated) {
      this.saveNotes = migrated.notes;
      this.state.load(migrated.save);
      this.character.load(migrated.save.character);
      // Only the hero's own numbers here: the HUD, the combat and the meshes do not exist yet, so
      // the full `applySheet()` runs at the end of the constructor instead. The HP ceiling has to
      // be right *before* `reset`, or a saved 18 HP would be clamped to the level 1 ceiling of 12.
      this.applyHeroStats();
      this.hero.reset(migrated.save.hero.x, migrated.save.hero.y, Math.min(migrated.save.hero.hp, this.hero.maxHp));
      this.dayTime = this.state.dayTime;
      this.camera.snap(u(this.hero.x), u(this.hero.y));
    }

    this.hud = new Hud();
    this.dialogue = new Dialogue();
    this.minimap = new Minimap(this.world);
    this.sheet = new CharacterPanel(this.character, {
      changed: () => {
        this.applySheet();
        this.saveNow(true);
      },
      use: (def) => {
        if (def.heal) {
          this.hero.heal(def.heal);
          this.hud.float(u(this.hero.x), 1.1, u(this.hero.y), `+${def.heal}`, '#7cf07c', false);
        }
        sfx.pickup();
        this.saveNow(true);
      },
      // no rummaging through the bag while dead — respawn first
      blocked: () => !this.hero.alive,
    });
    // `I` / `Tab` on a keyboard; the bag button on a phone.
    input.onMenu = () => this.sheet.toggle();
    // While the sheet is open the hero holds still and the world stops, exactly as during a
    // dialogue. Reading your stats should not be something enemies can punish.
    this.sheet.onToggle = (open) => {
      this.paused = open;
      input.enabled = !open && !this.dialogue.open;
      if (open) input.reset();
      else this.saveNow(true);
    };
    this.puzzle = new Puzzle3D(this.pixels.scene, this.world.markers, this.collision, this.state.puzzleSolved);
    this.puzzle.onSolved = () => {
      this.state.puzzleSolved = true;
      this.hud.toast('Gerbang batu terbuka!');
      this.saveNow();
    };

    this.combat = new Combat3D(this.pixels.scene, this.world, this.collision, this.state, {
      freeze: (ms) => this.freeze(ms),
      shake: (amount, seconds) => this.camera.shake(amount, seconds),
      spark: (x, y, color, big) => this.environment.spark(u(x), u(y), color, big),
      damage: (x, y, amount, color, big) => this.hud.float(u(x), 0.9, u(y), String(amount), color, big),
      killed: (kind, x, y) => {
        this.story.questEvent({ type: 'kill', kind });
        // a third of the time an enemy leaves something behind
        if (kind !== 'boss' && Math.random() < 0.33) this.story.dropHeal(x, y);
        this.dropLoot(kind, x, y);
      },
      exp: (amount, x, y) => this.gainExp(amount, x, y),
      heal: (amount) => {
        if (amount <= 0 || this.hero.hp >= this.hero.maxHp) return;
        this.hero.heal(amount);
        this.hud.float(u(this.hero.x), 1.1, u(this.hero.y), `+${amount}`, '#7cf07c', false);
      },
      bossWoke: () => {
        this.puzzle.closeBossDoor();
        this.hud.banner('Kolosus Kelam terbangun!');
      },
      bossDefeated: (x, y) => {
        this.puzzle.openBossDoor();
        this.state.bossDefeated = true;
        this.hud.banner('Kolosus Kelam kalah!');
        this.environment.spark(u(x), u(y), 0xffd98a, true);
        this.story.questEvent({ type: 'boss-defeated' });
        this.saveNow(true);
      },
    });

    this.story = new Story3D(this.pixels.scene, this.world, this.collision, this.state, {
      dialogue: (spec) => this.dialogue.show(spec),
      toast: (text) => this.hud.toast(text),
      banner: (text) => this.hud.banner(text),
      hint: (text) => this.hud.setHint(text),
      float: (x, y, text, color, big) => this.hud.float(u(x), 1.1, u(y), text, color, big),
      exp: (amount, x, y) => this.gainExp(amount, x, y),
      loot: (kind, x, y) => this.dropLoot(kind, x, y),
      reward: (reward, x, y) => this.giveReward(reward, x, y),
      spark: (x, y, color, big) => this.environment.spark(u(x), u(y), color, big),
      save: (force) => this.saveNow(force),
      shake: (amount, seconds) => this.camera.shake(amount, seconds),
    });
    this.story.onRest = () => {
      this.hero.heal(this.hero.maxHp);
      this.environment.spark(u(this.hero.x), u(this.hero.y), 0xffd98a, true);
    };
    this.dialogue.onOpenChange = (open) => {
      if (open) input.reset();
    };

    // Phone sticks are not precise: nudge every attack toward the nearest enemy in front.
    this.hero.aimAssist = (angle) => this.combat.aimAssist(this.hero, angle);
    this.scene3d.onChunkLoad = (cx, cy) => this.combat.spawnForChunk(cx, cy);
    this.scene3d.onChunkUnload = (cx, cy) => this.combat.despawnForChunk(cx, cy);

    if (settings.firstRun && settings.get('presetAuto') && !settings.isLocked('preset')) {
      settings.set('preset', suggestPreset(probeDevice()));
    }
    this.adaptive.auto = settings.get('presetAuto') && !settings.isLocked('preset');
    this.adaptive.onChange = (rung) => {
      settings.set('preset', rung.preset);
      settings.set('renderScale', rung.renderScale);
    };
    this.unsubscribe = settings.on((key) => {
      if (key === 'presetAuto') this.adaptive.auto = settings.get('presetAuto') && !settings.isLocked('preset');
      if (key === 'preset' || key === 'renderScale') this.applyProfile();
    });

    // Now that the HUD, the combat and the meshes exist, push the whole character sheet through.
    this.applySheet();

    this.applyProfile();
    this.resize();
    this.scene3d.setView(this.camera.groundExtent(), (px, pz, ox, oz, out) => this.camera.toGroundAxes(px, pz, ox, oz, out));
    // The immediate neighbourhood is ready before the first frame; the rest streams in behind the
    // fog over the next few frames rather than freezing the boot.
    this.scene3d.preload(u(start.x), u(start.y), 1);
    window.addEventListener('resize', this.onResize);
  }

  /** The HUD listens for which weapon is next and how far the bow is drawn. */
  onWeaponState: (nextWeapon: string, charge: number) => void = () => undefined;

  private onResize = (): void => this.resize();

  resize(): void {
    const p = profileOf(settings.get('preset'));
    const plan = this.pixels.resize(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio || 1,
      p.pixelHeight,
      p.renderScale * settings.get('renderScale'),
    );
    this.camera.setAspect(plan.pixelW / plan.pixelH);
  }

  private applyProfile(): void {
    const p = profileOf(settings.get('preset'));
    this.pixels.setOutline(p.outline);
    this.scene3d.setLightBudget(LIGHT_BUDGET[p.id] ?? 2);
    // The bottom preset stands still: swaying every blade costs vertex work.
    this.scene3d.setWind(p.id === 'vlow' ? 0 : p.id === 'low' ? 0.6 : 1);
    this.scene3d.setWater(p.id !== 'vlow');
    this.bloomScale = p.id === 'vlow' ? 0 : p.id === 'low' ? 0.6 : 1;
    // Baked pools are almost free, so even the bottom preset keeps them — they are what makes
    // the village look lit at night.
    this.scene3d.setLightPools(p.id === 'vlow' ? 1.2 : 1.6);
    this.scene3d.setGroundDetail(p.id === 'vlow' ? 0 : 1);
    this.scene3d.setRim(p.id === 'vlow' ? 0.4 : 1);
    this.environment.setBudget(p.id === 'vlow' ? 0 : p.id === 'low' ? 0.5 : 1);
    this.scene3d.setShadows(p.shadows);
    this.resize();
    this.scene3d.setRenderDistance(this.chunkRadius());
  }

  /**
   * How many chunks to keep loaded: what the camera can actually see, plus the preset's margin.
   * A flatter camera or a wider zoom therefore streams more. Capped, so zooming all the way out
   * on a weak phone cannot ask for a hundred ground textures at once.
   */
  private chunkRadius(): number {
    return Math.max(1, profileOf(settings.get('preset')).chunkMargin + 1);
  }

  // ───────────────────────── loop ─────────────────────────

  start(): void {
    if (this.raf) return;
    this.lastFrame = 0;
    const frame = (now: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
      this.lastFrame = now;
      this.step(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Project a world point to viewport pixels, for the floating combat numbers. */
  private projector: Projector = (x, y, z) => {
    this.projected.set(x, y, z).project(this.camera.camera);
    if (this.projected.z > 1) return null;
    const plan = this.pixels.plan;
    return {
      x: ((this.projected.x + 1) / 2) * plan.cssW,
      y: ((1 - this.projected.y) / 2) * plan.cssH,
      visible: Math.abs(this.projected.x) < 1.2 && Math.abs(this.projected.y) < 1.2,
    };
  };

  /** HP, energy, quest, boss bar, minimap, area banner, autosave and respawn. */
  private updateHud(dt: number, simDt: number): void {
    this.hud.setHp(this.hero.hp, this.hero.maxHp);
    this.hud.setEnergy(1 - this.hero.skillCd / HERO_SKILL_COOLDOWN);
    const q = this.story.questText();
    this.hud.setQuest(q.title, q.lines);

    const boss = this.combat.bossRef;
    if (boss && boss.awake && !boss.dead) this.hud.setBoss('Kolosus Kelam', Math.max(0, boss.hp / boss.maxHp));
    else this.hud.setBoss(null);

    this.minimap.update(dt, this.hero.x, this.hero.y, AREAS[areaAtTile(Math.floor(this.hero.x / 16))].name, this.story.mapMarks());
    this.hud.update(dt, this.projector);

    // area banner
    const area = areaAtTile(Math.floor(this.hero.x / 16));
    if (area !== this.area) {
      if (this.area !== null) this.hud.banner(AREAS[area].name);
      this.area = area;
      this.saveNow();
    }

    if (simDt > 0) {
      this.autosaveT -= simDt;
      if (this.autosaveT <= 0) {
        this.autosaveT = 30;
        this.saveNow();
      }
      this.updateDeath(dt);
    }
  }

  /**
   * Push the character sheet into the parts of the game that cache its numbers.
   *
   * Called after anything that can change the sheet: load, level-up, equipping. The hero keeps its
   * current HP (`setMaxHp` clamps rather than scales), so taking off a +HP helmet cannot kill you
   * and a level-up does not heal you.
   */
  applySheet(): void {
    this.applyHeroStats();
    this.combat.character = this.character;
    this.heroMesh.setLanternRange(this.character.stats.lanternRange / 100);
    this.hud.setLevel(this.character.level, this.character.exp, this.character.expNeeded);
  }

  /**
   * The part of the sheet that only touches `HeroCore`.
   *
   * Split out because the save is loaded before the HUD, the combat and the meshes are built — and
   * the first version called the whole of `applySheet()` there, which threw on `this.combat` being
   * undefined and turned every boot into "Gagal memuat".
   */
  private applyHeroStats(): void {
    this.character.refresh();
    const stats = this.character.stats;
    this.hero.setMaxHp(stats.maxHp);
    this.hero.speedScale = stats.speed / 100;
    this.hero.heavyCritBonus = this.character.heavyCritBonus();
  }

  /**
   * EXP from a kill, a discovery or a quest stage. Levels are announced, because a number quietly
   * going up in a menu nobody has open is not a reward.
   */
  gainExp(amount: number, x?: number, y?: number): void {
    if (amount <= 0) return;
    const levels = this.character.addExp(amount);
    if (x !== undefined && y !== undefined) this.hud.float(u(x), 1.5, u(y), `+${amount} EXP`, '#a795ff', false);
    if (levels.length) {
      this.applySheet();
      this.hud.toast(`Level ${this.character.level}!`);
      this.hud.banner(`LEVEL ${this.character.level}`, 1.8);
      this.environment.spark(u(this.hero.x), u(this.hero.y), 0xffd98a, true);
      sfx.levelUp();
      this.saveNow(true);
    } else {
      this.hud.setLevel(this.character.level, this.character.exp, this.character.expNeeded);
    }
  }

  /**
   * Loot. A fallen enemy sometimes leaves something, and what it leaves depends on what it was —
   * the table lives in `core/items/drops.ts` so it can be tested without a renderer.
   */
  private dropLoot(kind: string, x: number, y: number): void {
    // A kill gives at most one thing — a stream of pickups turns a fight into paperwork — while a
    // chest is the reward for exploring and rolls its whole table.
    const drops = rollDrops(kind, Math.random, kind === 'chest' ? Infinity : 1);
    let overflowed = false;
    let lifted = 0;
    for (const drop of drops) {
      const def = itemDef(drop.id);
      if (!def) continue;
      const result = this.character.inventory.add(drop.id, drop.count, drop.rarity);
      if (result.added > 0) {
        this.hud.toast(`${def.name}${result.added > 1 ? ` x${result.added}` : ''}`);
        this.hud.float(u(x), 1.2 + lifted * 0.35, u(y), def.name, rarityMeta(drop.rarity).color, false);
        lifted++;
      }
      if (result.overflow > 0) overflowed = true;
    }
    if (lifted > 0) {
      sfx.pickup();
      this.saveNow();
    }
    if (overflowed) this.hud.toast('Tas penuh! Buang sesuatu dulu.');
  }

  /**
   * Hand over a quest stage's reward. The items are named in `core/systems/quest.ts`, so what a
   * stage pays out is part of the quest definition rather than something the renderer decides.
   */
  private giveReward(reward: QuestReward, x: number, y: number): void {
    let lifted = 1;
    for (const entry of reward.items ?? []) {
      const def = itemDef(entry.id);
      if (!def) continue;
      const result = this.character.inventory.add(entry.id, entry.count ?? 1);
      if (result.added > 0) {
        this.hud.toast(`Hadiah: ${def.name}${result.added > 1 ? ` x${result.added}` : ''}`);
        this.hud.float(u(x), 1.2 + lifted * 0.35, u(y), def.name, rarityMeta(def.rarity).color, false);
        lifted++;
      }
      if (result.overflow > 0) this.hud.toast(`Tas penuh: ${def.name} tidak terbawa!`);
    }
    if (reward.exp) this.gainExp(reward.exp, x, y);
    this.applySheet();
    this.saveNow(true);
  }

  /** Death → fade → respawn at the last checkpoint, exactly as the 2D build did it. */
  private updateDeath(dt: number): void {
    if (this.hero.alive) {
      if (this.deathT >= 0) this.deathT = -1;
      return;
    }
    if (this.deathT < 0) {
      this.deathT = 0;
      this.hud.banner('Kamu pingsan...');
      return;
    }
    const prev = this.deathT;
    this.deathT += dt;
    if (prev < 2 && this.deathT >= 2) this.respawn();
  }

  respawn(): void {
    const cps = this.world.markers.checkpoints;
    const cp = cps.find((c) => c.id === this.state.checkpoint) ?? cps[0];
    this.hero.reset(cp.x, cp.y + 14);
    this.deathT = -1;
    this.camera.snap(u(cp.x), u(cp.y));
    this.scene3d.preload(u(cp.x), u(cp.y), 1);
    this.puzzle.openBossDoor();
    this.puzzle.reset();
    this.hud.toast(`Bangun di ${cp.name}`);
  }

  /** Write the save. Never mid-boss-fight unless forced, so death cannot lock you in. */
  saveNow(force = false): void {
    const boss = this.combat.bossRef;
    if (!this.hero.alive) return;
    if (!force && boss && boss.awake && !boss.dead) return;
    this.state.dayTime = this.dayTime;
    saveGame(this.state.toJSON({ x: this.hero.x, y: this.hero.y, hp: this.hero.hp }, this.character.toJSON()));
  }

  /** Freeze the simulation for `ms` while rendering keeps going — the punch behind a landed hit. */
  freeze(ms: number): void {
    this.freezeLeft = Math.max(this.freezeLeft, ms / 1000);
  }

  /** One frame. Exposed so a test can drive the simulation without a browser. */
  step(dt: number): void {
    if (this.disposed) return;
    if (dt > 0) this.frameMs += (dt * 1000 - this.frameMs) * 0.1;
    this.probe.update(dt);
    this.clock += dt;
    // hit-stop freezes the simulation, never the rendering
    let simDt = this.paused ? 0 : dt;
    if (this.freezeLeft > 0) {
      this.freezeLeft = Math.max(0, this.freezeLeft - dt);
      simDt = 0;
    }
    if (!this.paused && dt > 0) {
      this.dayTime = (this.dayTime + simDt / DAY_SECONDS) % 1;
      this.updateHero(simDt);
      this.combat.update(simDt, dt, this.hero);
      this.camera.follow(u(this.hero.x), u(this.hero.y), dt);
      this.camera.tick(dt);
      this.perf.push(dt);
      this.adaptive.update(dt, settings.get('preset'), settings.get('renderScale'));
    }
    this.heroMesh.update(simDt, dt, this.hero, this.clock);
    this.onWeaponState(WEAPONS[this.hero.loadout[this.hero.slot === 0 ? 1 : 0]].name.toUpperCase(), this.hero.charge);

    // ── story, puzzle, HUD ──
    const ax = input.axis();
    this.puzzle.update(simDt, dt, this.hero, ax.x, ax.y);
    this.story.update(simDt, dt, this.hero, this.camera.yawRadians, this.dialogue.open);
    this.dialogue.update(dt);
    this.updateHud(dt, simDt);
    const cave = this.caveWeight();
    this.scene3d.setHeroOcclusion(this.heroMesh.root.position, this.camera.camera, this.hero.alive);
    /*
     * Clamp the fog to what is actually loaded. The report showed fog reaching 155 while only
     * ~64 units of world existed around the hero, so the fog was doing nothing to hide the
     * streaming edge — and the chunk radius was paying for ground the fog should have swallowed.
     */
    const [rawNear, rawFar] = this.camera.fogRange();
    const loadedReach = CAMERA_DISTANCE + this.chunkRadius() * 16 * 0.92;
    const fogFar = Math.min(rawFar, loadedReach);
    const fogNear = Math.min(rawNear, fogFar - 8);
    const night = nightAmount(this.dayTime);
    this.sky.update(this.dayTime, cave, fogNear, fogFar, night, this.clock);
    this.pixels.renderer.setClearColor(this.sky.haze, 1);
    this.applyGrade(cave);
    this.scene3d.setRenderDistance(this.chunkRadius());
    this.scene3d.setView(this.camera.groundExtent(), (px, pz, ox, oz, out) => this.camera.toGroundAxes(px, pz, ox, oz, out));
    this.scene3d.setHeroGround(u(this.hero.x), u(this.hero.y));
    this.scene3d.update(this.dayTime, this.camera.target, cave, this.paused ? 0 : 1, dt);
    // the water reflects whatever the sky is doing, and fogs out with everything else
    this.scene3d.waterUniforms.uSky.value.copy(this.sky.haze);
    this.scene3d.waterUniforms.uFogColor.value.copy(this.sky.haze);
    this.scene3d.waterUniforms.uFogRange.value.set(this.sky.fog.near, this.sky.fog.far);
    this.environment.update(dt, this.camera.target, nightAmount(this.dayTime), cave, this.forestWeight(), this.sky.haze);
    this.pixels.render(this.camera.camera);
  }

  /** Bloom, vignette and colour grade for the current time of day, scaled by the preset. */
  private applyGrade(cave: number): void {
    const g = gradeAt(this.dayTime, cave);
    const p = profileOf(settings.get('preset'));
    const allow = settings.get('bloom') && p.bloom ? 1 : 0;
    this.pixels.setGrade({
      bloom: g.bloom * allow * this.bloomScale,
      vignette: g.vignette * (p.outline ? 1 : 0.6),
      lift: this.gradeLift.setRGB(g.lift[0], g.lift[1], g.lift[2]),
      gain: this.gradeGain.setRGB(g.gain[0], g.gain[1], g.gain[2]),
    });
  }

  /** 0 outside, 1 deep in the cave — the same curve the 2D renderer uses for its lightmap. */
  private caveWeight(): number {
    return smooth(CAVE_X0 - 6, CAVE_X0 + 3, this.hero.x / 16);
  }

  /** 0 in the village, 1 deep in the forest; drives how thick the ground mist gets. */
  private forestWeight(): number {
    const tx = this.hero.x / 16;
    return smooth(FOREST_X0 - 8, FOREST_X0 + 8, tx) * (1 - smooth(CAVE_X0 - 8, CAVE_X0 - 2, tx));
  }

  /**
   * Movement runs through the *same* `HeroCore` and the *same* `Collision` grid as the 2D build —
   * only the input direction is rotated, because on a fixed 3/4 camera "push up" has to mean
   * "walk away from the camera", not "walk north".
   */
  private updateHero(dt: number): void {
    const ax = input.axis();
    const dir = this.camera.stickToWorld(ax.x, ax.y);
    const inp: HeroInput = {
      mx: dir.x,
      my: dir.y,
      attack: input.consume('attack'),
      // held, not just pressed: this is what promotes a tap into the heavy swing or a bow charge
      attackHeld: input.isHeld('attack'),
      dodge: input.consume('dodge'),
      skill: input.consume('skill'),
    };
    if (input.consume('swap')) {
      if (this.hero.swapWeapon()) unlockAudio();
    }
    this.hero.update(dt, inp, this.collision, this.collision.speedAt(this.hero.x, this.hero.y));
    this.handleHeroEvents();
  }

  /** Turn the hero's events into damage, effects and sound. */
  private handleHeroEvents(): void {
    const events: HeroEvent[] = this.hero.events.splice(0);
    for (const e of events) {
      switch (e.type) {
        case 'swing-start':
          sfx.swing(this.hero.isHeavy);
          break;
        case 'swing':
          this.combat.applySwing(this.hero, e);
          break;
        case 'shoot':
          this.combat.spawnArrow(e);
          break;
        case 'charge':
          if (e.level > 0.5) sfx.bowDraw();
          break;
        case 'swap':
          sfx.swap();
          break;
        case 'roll':
          sfx.roll();
          this.environment.spark(u(e.x), u(e.y), 0xd8cfff, false);
          break;
        case 'blast':
          this.environment.spark(u(e.x), u(e.y), 0xffe4a0, true);
          this.camera.shake(4, 0.28);
          this.combat.applyBlast(e.x, e.y, e.radius, e.dmg, e.knock, e.stun, this.hero);
          break;
        case 'hurt':
          this.camera.shake(3.5, 0.2);
          break;
        case 'dead':
          sfx.die();
          this.camera.shake(5, 0.4);
          break;
        default:
          break;
      }
    }
  }

  // ───────────────────────── performance probe ─────────────────────────

  /**
   * The scenarios worth measuring, in the order they are most likely to be the problem.
   * Each one is applied on top of the player's *own* settings, one change at a time.
   */
  private probeScenarios(): ProbeScenario[] {
    return [
      { id: 'base', label: 'semua menyala', apply: () => undefined },
      { id: 'lights', label: 'tanpa lampu dinamis', apply: () => this.scene3d.setLightBudget(0) },
      { id: 'shadows', label: 'tanpa bayangan', apply: () => this.scene3d.setShadows('off') },
      { id: 'water', label: 'tanpa air beriak', apply: () => this.scene3d.setWater(false) },
      { id: 'bloom', label: 'tanpa bloom', apply: () => this.pixels.setGrade({ bloom: 0, vignette: 0, lift: this.gradeLift, gain: this.gradeGain }) },
      { id: 'grass', label: 'tanpa angin', apply: () => this.scene3d.setWind(0) },
      { id: 'detail', label: 'tanpa grain tanah', apply: () => this.scene3d.setGroundDetail(0) },
      { id: 'rim', label: 'tanpa rim light', apply: () => this.scene3d.setRim(0) },
      { id: 'env', label: 'tanpa kunang/kabut', apply: () => this.environment.setBudget(0) },
      { id: 'outline', label: 'tanpa outline', apply: () => this.pixels.setOutline(false) },
      {
        id: 'half',
        label: 'skala render 60%',
        apply: () => this.pixels.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, profileOf(settings.get('preset')).pixelHeight, 0.6),
      },
      {
        id: 'px360',
        label: 'grid pixel 360',
        apply: () => this.pixels.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, 360, 1),
      },
      {
        id: 'px270',
        label: 'grid pixel 270',
        apply: () => this.pixels.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, 270, 1),
      },
      { id: 'radius', label: 'radius chunk -1', apply: () => this.scene3d.setRenderDistance(Math.max(1, this.chunkRadius() - 1)) },
    ];
  }

  startPerfProbe(): void {
    this.probe.start(
      this.probeScenarios(),
      () => {
        // put every knob back to whatever the player's settings say
        this.applyProfile();
        this.applyGrade(this.caveWeight());
      },
      () => ({ calls: this.pixels.renderer.info.render.calls, triangles: this.pixels.renderer.info.render.triangles }),
    );
  }

  // ───────────────────────── diagnostics ─────────────────────────

  diagnostics(): DiagnosticsSource {
    return {
      name: 'three3d',
      fps: () => ({ avg: this.perf.avg, low: this.perf.low }),
      objects: () => {
        const s = this.scene3d.stats();
        return s.instances + s.chunks + 1;
      },
      view: () => ({ w: this.pixels.plan.renderW, h: this.pixels.plan.renderH }),
      setPaused: (p) => {
        this.paused = p;
        input.enabled = !p;
        if (p) input.reset();
      },
      report: () => this.extraReport(),
      startPerfProbe: () => this.startPerfProbe(),
      perfProbeStatus: () => ({
        running: this.probe.running,
        label: this.probe.label,
        progress: this.probe.progress,
        lines: this.probe.lines(),
      }),
    };
  }

  /** Extra lines for the "Salin laporan" report. */
  private extraReport(): string[] {
    const s = this.scene3d.stats();
    const plan = this.pixels.plan;
    const info = this.pixels.renderer.info.render;
    const probe = this.probe.lines();
    return [
      `frame: ${this.frameMs.toFixed(1)} ms (${(1000 / Math.max(0.01, this.frameMs)).toFixed(1)} fps)`,
      `draw call: ${info.calls}   triangle: ${(info.triangles / 1000).toFixed(0)}k   program: ${this.pixels.renderer.info.programs?.length ?? 0}`,
      `kanvas: ${plan.canvasW}x${plan.canvasH} px perangkat (layar ${Math.round(window.innerWidth * (window.devicePixelRatio || 1))}x${Math.round(window.innerHeight * (window.devicePixelRatio || 1))})`,
      `grid pixel: ${plan.pixelW}x${plan.pixelH}   render target: ${plan.renderW}x${plan.renderH}   skala ${plan.scale.toFixed(2)}x`,
      `chunk dimuat: ${s.chunks} (radius ${this.chunkRadius()}, antre ${s.queued})   instance: ${s.instances}   ` +
        `draw group: ${s.draws} (${s.pools} pool, ${s.water} air)   lampu: ${s.lights}`,
      `atmosfer: jam ${timeLabel(this.dayTime)}   malam ${(nightAmount(this.dayTime) * 100).toFixed(0)}%   ` +
        `hutan ${(this.forestWeight() * 100).toFixed(0)}%   jendela menyala ${s.windows}`,
      `outline tersedia: ${this.pixels.canOutline ? 'ya' : 'tidak'}`,
      `hero: (${Math.round(this.hero.x)}, ${Math.round(this.hero.y)}) hp ${this.hero.hp}/${this.hero.maxHp} state ${this.hero.state}`,
      `senjata: ${this.hero.weapon}${this.hero.isRanged ? ` (charge ${(this.hero.charge * 100).toFixed(0)}%)` : ` (combo ${this.hero.combo})`}`,
      `musuh hidup: ${this.combat.enemyCount}   status aktif: ${this.combat.statusSummary()}   reaksi terdaftar: ${this.combat.reactionCount}`,
      ...(this.saveNotes.length ? [`migrasi save: ${this.saveNotes.join('; ')}`] : []),
      `area: ${this.world.areaAt(Math.floor(this.hero.x / 16), Math.floor(this.hero.y / 16))}`,
      `kamera: sudut ${this.camera.pitch}\u00b0  zoom ${this.camera.zoom.toFixed(2)}x  ` +
        `target (${this.camera.target.x.toFixed(1)}, ${this.camera.target.z.toFixed(1)})  radius pandang ${this.camera.viewRadius.toFixed(1)} unit`,
      `kabut: ${this.sky.fog.near.toFixed(0)} - ${this.sky.fog.far.toFixed(0)} (gua ${(this.caveWeight() * 100).toFixed(0)}%)`,
      ...(probe.length ? ['', '[UJI PERFORMA] (baseline = setelanmu sendiri, satu fitur dimatikan per baris)', ...probe] : []),
    ];
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.unsubscribe();
    this.saveNow();
    this.story.dispose();
    this.puzzle.dispose();
    this.minimap.destroy();
    this.sheet.destroy();
    this.dialogue.destroy();
    this.hud.destroy();
    this.combat.dispose();
    this.camera.dispose();
    this.sky.dispose();
    this.environment.dispose();
    this.heroMesh.dispose();
    this.scene3d.dispose();
    this.pixels.dispose();
  }
}

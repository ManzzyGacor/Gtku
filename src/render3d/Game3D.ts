/**
 * The 3D game loop (docs/OVERHAUL.md, Fase 1).
 *
 * It owns the pixel renderer, the isometric camera and the greybox world, and it reuses the same
 * `src/core` logic as the 2D build: the same `GeneratedWorld`, the same day/night curve, the same
 * `input` hub, the same graphics presets and the same FPS watchdog. Nothing here is a second copy
 * of the game — it is a second *view* of it.
 */
import { buildTileSheet } from '../art/tiles';
import { higherPreset, lowerPreset, probeDevice, profileOf, suggestPreset, PROFILES } from '../core/graphics';
import { AUTO_PATH, AutoTuner, COMPONENT_LABEL, FULL, type ComponentId } from '../core/autotune';

const AUTO_STEPS = AUTO_PATH.length;
import { input } from '../core/input';
import { PerfMeter } from '../core/perf';
import { settings } from '../core/settings';
import { DAY_SECONDS, gradeAt, nightAmount, smooth, timeLabel } from '../core/systems/daynight';
import { CAVE_X0, FOREST_X0 } from '../core/world/areas';
import { ATTACKS, HeroCore, HERO_STATS, type HeroEvent, type HeroInput } from '../core/entities/HeroCore';
import { WEAPONS } from '../core/combat/weapons';
import { GameState } from '../core/state/GameState';
import { loadGame, saveGame } from '../core/save';
import { migrateSave } from '../core/saveMigrate';
import { AREAS, areaAtTile } from '../core/world/areas';
import { Dialogue } from '../ui/Dialogue';
import { Hud, type Projector } from '../ui/Hud';
import { Minimap } from '../ui/Minimap';
import { CharacterPanel } from '../ui/CharacterPanel';
import { CutsceneOverlay } from '../ui/CutsceneOverlay';
import { PauseMenu, type InfoLine } from '../ui/PauseMenu';
import { BOW_SHOTS } from '../core/combat/weapons';
import { ELEMENTS, type ElementId } from '../core/combat/elements';
import { KILLS_NEEDED } from '../core/state/GameState';
import { DUMMY_TILE, settleTutorial } from '../core/systems/tutorial';
import { WEATHER, type Weather } from '../core/systems/weather';
import { Rain } from './Rain';
import { AreaData } from './AreaData';
import { DataRequired, DownloadManager, type DataAreaView, type DataSource } from '../ui/DownloadManager';
import { Cutscene3D } from './Cutscene3D';
import { CUTSCENES, playerName } from '../core/story/cutscenes';
import { ambient as ambientPlayer, ambientFor, audioReady, bus, fadeFor, music, musicFor } from '../core/audio';
import type { ActorSpec, FxSpec } from '../core/story/cutscene';
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
  /** The cutscene director (Batch 5). Null-safe: the game runs identically with no scene playing. */
  readonly cutscene: Cutscene3D;
  readonly pause: PauseMenu;
  private readonly csOverlay: CutsceneOverlay;
  readonly story: Story3D;
  readonly puzzle: Puzzle3D;
  readonly perf = new PerfMeter();
  /** Level, EXP, bag, equipment and the resolved stats every hit is calculated from (Batch 4). */
  readonly character = new Character();

  /** AUTO, per component (see core/autotune.ts). */
  readonly autoTuner = new AutoTuner(this.perf);
  /** Set while AUTO itself is changing the preset, so that change does not reset AUTO's dials. */
  private autoMovingPreset = false;
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
  /** While a cutscene is framing the shot, the day/night clock holds at this time. */
  private dayTimeOverride: number | null = null;
  private tintOverride: [number, number, number] | null = null;
  /** An actor being walked from A to B by a cutscene. */
  private actorMove: { id: string; fromX: number; fromY: number; toX: number; toY: number; t: number; dur: number } | null = null;
  /** Area data packs (Batch 6): downloads, and pre-baked chunk ground. */
  readonly areaData = new AreaData();
  readonly downloads: DownloadManager;
  private readonly dataRequired: DataRequired;
  /** Where the hero last stood in an area they were allowed into — the gate sends them back here. */
  private readonly lastSafe = { x: 0, y: 0, area: '' };
  private gatePromptT = 0;
  /** Current weather (developer menu only, until Batch 7 gives the world its own). */
  private weather: Weather = 'cerah';
  private rain: Rain | null = null;
  /** What the mixer was last told to play, so nothing is re-requested every frame. */
  private nowMusic = '';
  private nowAmbient = '';

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
    const dataSource = this.makeDataSource();
    this.downloads = new DownloadManager(dataSource);
    this.dataRequired = new DataRequired(dataSource);
    this.csOverlay = new CutsceneOverlay();
    this.cutscene = new Cutscene3D(this.camera, {
      setDayTime: (t) => {
        this.dayTimeOverride = t;
        if (t !== null) this.dayTime = t;
      },
      setTint: (tint) => {
        this.tintOverride = tint;
      },
      actor: (spec) => this.moveActor(spec),
      fx: (spec) => this.cutsceneFx(spec),
      flag: (name) => {
        this.state.flags[name] = true;
      },
    });
    this.csOverlay.onAdvance = () => this.cutscene.advance();
    this.csOverlay.onSkip = () => this.cutscene.skip();

    this.pause = new PauseMenu({
      resume: () => undefined,
      openSheet: (tab) => this.sheet.openTab(tab),
      openSettings: () => this.onOpenSettings(),
      saveAndQuit: () => {
        this.saveNow(true);
        this.onQuit();
      },
      weapons: () => this.weaponLines(),
      skills: () => this.skillLines(),
      quest: () => this.questLines(),
      map: () => ({
        atlas: this.minimap.worldAtlas,
        heroTx: this.hero.x / 16,
        heroTy: this.hero.y / 16,
        marks: this.story.mapMarks().map((m) => ({ tx: m.x / 16, ty: m.y / 16, color: m.color })),
      }),
    });
    this.hud.onPause = () => this.pause.toggle();
    this.pause.onToggle = (open) => {
      this.paused = open || this.sheet.isOpen;
      input.enabled = !this.paused && !this.dialogue.open;
      if (open) input.reset();
      this.hud.setVisible(!open);
      if (!open) this.saveNow();
    };

    // `I` / `Tab` for the sheet, `Escape` / `P` for the pause menu; buttons on a phone.
    input.onMenu = (which) => {
      if (which === 'pause') this.pause.toggle();
      else this.sheet.toggle();
    };
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
      coins: (amount) => this.character.addCoins(amount),
      elementHit: (kind, element) => {
        if (kind === 'dummy') this.story.tutorialEvent({ type: 'element-hit', element, target: 'dummy' });
      },
      reaction: (name, incoming, on, x, y) => this.onReaction(name, incoming, on, x, y),
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
      grantCore: (itemId) => this.grantCore(itemId),
      questNote: (text) => {
        this.hud.popup({ icon: '\u2691', title: 'Quest', sub: text, color: '#ffd98a', seconds: 5 });
        this.hud.toast(text);
      },
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
    this.autoTuner.auto = settings.get('presetAuto') && !settings.isLocked('preset');
    this.unsubscribe = settings.on((key) => {
      if (key === 'presetAuto') {
        this.autoTuner.auto = settings.get('presetAuto') && !settings.isLocked('preset');
        // switching AUTO off gives every dial back to the preset
        if (!this.autoTuner.auto) this.autoTuner.reset();
        this.applyProfile();
      }
      if (key === 'preset' || key === 'renderScale') {
        // a preset the *player* picked starts from full dials; one AUTO picked keeps AUTO's
        if (key === 'preset' && !this.autoMovingPreset) this.autoTuner.reset();
        this.applyProfile();
      }
    });

    // Now that the HUD, the combat and the meshes exist, push the whole character sheet through.
    this.applySheet();
    // A save that already knows an element has nothing left to learn from "Bara Pertama".
    settleTutorial(this.state, this.character.unlocked.length > 0);
    // The tutorial's training dummy stands in the plaza for good: it is also the best place to try
    // out a new element or a reaction, long after the tutorial is done.
    this.combat.addDummy(DUMMY_TILE.tx * 16 + 8, DUMMY_TILE.ty * 16 + 12);

    this.applyProfile();
    this.resize();
    this.scene3d.setView(this.camera.groundExtent(), (px, pz, ox, oz, out) => this.camera.toGroundAxes(px, pz, ox, oz, out));
    // The immediate neighbourhood is ready before the first frame; the rest streams in behind the
    // fog over the next few frames rather than freezing the boot.
    this.scene3d.preload(u(start.x), u(start.y), 1);
    window.addEventListener('resize', this.onResize);

    // ── area data: ground from the packs, and the core area fetched quietly in the background ──
    this.lastSafe.x = this.hero.x;
    this.lastSafe.y = this.hero.y;
    this.lastSafe.area = areaAtTile(Math.floor(this.hero.x / 16));
    this.scene3d.groundSource = (cx, cy) => this.areaData.ground(cx, cy);
    void this.areaData.init().then(() => {
      const core = this.areaData.manifest?.core;
      if (!core) return;
      const st = this.areaData.status(core);
      // Ravenhollow is never gated; it just arrives when it arrives, and until then the phone bakes it
      if (st === 'belum' || st === 'versi-baru') void this.areaData.download(core).catch(() => undefined);
    });
  }

  /** The HUD listens for which weapon is next and how far the bow is drawn. */
  onWeaponState: (nextWeapon: string, charge: number, held: { label: string; ranged: boolean }) => void = () => undefined;

  private onResize = (): void => this.resize();

  resize(): void {
    const p = profileOf(settings.get('preset'));
    const plan = this.pixels.resize(
      window.innerWidth,
      window.innerHeight,
      window.devicePixelRatio || 1,
      p.pixelHeight,
      p.renderScale * settings.get('renderScale') * (this.autoTuner.auto ? this.autoTuner.levels.resolution : 1),
    );
    this.camera.setAspect(plan.pixelW / plan.pixelH);
  }

  /**
   * Apply the preset, then let AUTO's dials pull individual components *below* it.
   *
   * Every component is `min(what the preset allows, what AUTO allows)`: AUTO can only ever take away
   * from the preset the player sees in Settings, never add to it.
   */
  private applyProfile(): void {
    const p = profileOf(settings.get('preset'));
    const a = this.autoTuner.auto ? this.autoTuner.levels : FULL;
    this.pixels.setOutline(p.outline && a.outline > 0);
    this.scene3d.setLightBudget(Math.min(LIGHT_BUDGET[p.id] ?? 2, a.lights));
    // The bottom preset stands still: swaying every blade costs vertex work.
    this.scene3d.setWind(Math.min(p.id === 'vlow' ? 0 : p.id === 'low' ? 0.6 : 1, a.wind));
    this.scene3d.setWater(p.id !== 'vlow' && a.water > 0);
    this.bloomScale = Math.min(p.id === 'vlow' ? 0 : p.id === 'low' ? 0.6 : 1, a.bloom);
    // Baked pools are almost free, so even the bottom preset keeps them — they are what makes
    // the village look lit at night.
    this.scene3d.setLightPools(p.id === 'vlow' ? 1.2 : 1.6);
    this.scene3d.setGroundDetail(p.id === 'vlow' ? 0 : a.detail);
    this.scene3d.setRim(p.id === 'vlow' ? 0.4 : 1);
    this.environment.setBudget(Math.min(p.id === 'vlow' ? 0 : p.id === 'low' ? 0.5 : 1, a.particles));
    this.scene3d.setShadows(p.shadows);
    this.resize();
    this.scene3d.setRenderDistance(this.chunkRadius());
  }

  /**
   * The AUTO section of "Salin laporan": which dials are below the preset right now, and the last
   * decisions with the frame rate that caused each one. Written for a tester reading it on a phone:
   * "why does it look worse than an hour ago" should be answerable from these lines alone.
   */
  private autoReport(): string[] {
    const t = this.autoTuner;
    const lines = [
      `AUTO: ${t.auto ? 'nyala' : 'mati (preset dikunci pemain)'}   langkah ${t.rung}/${AUTO_STEPS}   preset ${PROFILES[settings.get('preset')].name}`,
    ];
    if (t.auto) {
      const lvl = t.levels;
      const lowered = (Object.keys(FULL) as ComponentId[]).filter((c) => lvl[c] !== FULL[c]);
      lines.push(`  diturunkan: ${lowered.length ? lowered.map((c) => `${COMPONENT_LABEL[c]} ${lvl[c]}`).join(', ') : 'tidak ada (semua sesuai preset)'}`);
    }
    if (t.decisions.length) {
      lines.push('  keputusan terakhir (detik sejak mulai, arah, apa, fps rata-rata/terendah):');
      for (const d of [...t.decisions].reverse()) {
        lines.push(`   ${String(d.at).padStart(5)}s  ${d.dir === 'drop' ? 'TURUN' : 'NAIK '}  ${d.what}   (${d.fps}/${d.low} fps)`);
      }
    } else {
      lines.push('  belum ada keputusan');
    }
    return lines;
  }

  /** One frame of AUTO: turn a dial, or — with every dial down — move the preset. */
  private updateAuto(dt: number): void {
    const preset = settings.get('preset');
    const result = this.autoTuner.update(dt, lowerPreset(preset) !== null, higherPreset(preset) !== null, PROFILES[preset].name);
    if (!result) return;
    if (result.preset) {
      const next = result.preset === 'drop' ? lowerPreset(preset) : higherPreset(preset);
      if (next) {
        this.autoMovingPreset = true;
        settings.set('preset', next);
        this.autoMovingPreset = false;
      }
    }
    this.applyProfile();
    const last = this.autoTuner.decisions[this.autoTuner.decisions.length - 1];
    if (last) this.hud.toast(`AUTO: ${last.what}`, 1.6);
  }

  /**
   * How many chunks to keep loaded: what the camera can actually see, plus the preset's margin.
   * A flatter camera or a wider zoom therefore streams more. Capped, so zooming all the way out
   * on a weak phone cannot ask for a hundred ground textures at once.
   */
  private chunkRadius(): number {
    // AUTO's "jarak pandang" dial drops the preset's extra margin, never the visible chunks themselves
    const margin = this.autoTuner.auto && this.autoTuner.levels.distance === 0 ? 0 : profileOf(settings.get('preset')).chunkMargin;
    return Math.max(1, margin + 1);
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

    this.updateSoundtrack();
    this.updateDummyLabels(dt);

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
    this.announceElement();
    this.combat.character = this.character;
    this.heroMesh.setLanternRange(this.character.stats.lanternRange / 100);
    this.hud.setLevel(this.character.level, this.character.exp, this.character.expNeeded);
  }

  /**
   * Announce an element the first time the hero can use it.
   *
   * Elements arrive by equipping a Lantern Core, so "unlocked" means "you now have this" rather
   * than a separate unlock system. The flag lives in the save, so it is announced once per element
   * per playthrough and never again — including across a reload.
   */
  private announceElement(): void {
    const element = this.character.coreElement;
    if (!element) return;
    const flag = `element_${element}`;
    if (this.state.flags[flag]) return;
    this.state.flags[flag] = true;
    const def = ELEMENTS[element];
    this.hud.popup({
      icon: '\u2749',
      title: `Elemen ${def.name} terbuka`,
      sub: this.character.passiveLabel ?? 'Seranganmu kini membawa elemen ini',
      color: `#${def.color.toString(16).padStart(6, '0')}`,
      seconds: 5,
    });
    this.hud.banner(`ELEMEN ${def.name.toUpperCase()}`, 2);
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
    /*
     * The elements. These two lines are the whole reason the element system works in play: before
     * them `hero.element` was never assigned anywhere, so every hit carried no element whatever
     * core was equipped, and reactions only ever happened in tests that set it by hand.
     */
    this.hero.element = this.character.primary ?? undefined;
    this.hero.skillElement = this.character.secondary ?? this.character.primary ?? undefined;
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
      this.hud.popup({
        icon: '\u2b06',
        title: `Level ${this.character.level}`,
        sub: `HP maks ${this.hero.maxHp} \u00b7 ATK ${this.character.stats.atk.toFixed(0)}`,
        color: '#ffd98a',
        seconds: 4.5,
      });
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
        const rarity = rarityMeta(drop.rarity);
        this.hud.popup({
          icon: '\u2727',
          title: `${def.name}${result.added > 1 ? ` x${result.added}` : ''}`,
          sub: rarity.label,
          color: rarity.color,
        });
        this.hud.float(u(x), 1.2 + lifted * 0.35, u(y), def.name, rarity.color, false);
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
   * The tutorial's Lantern Core: into the bag, onto the hero, and through the sheet — which is what
   * unlocks its element and fires the "Elemen Api terbuka" notification.
   *
   * Equipped automatically because the whole point of step one is that the next swing carries
   * fire. Asking the player to find it in the bag first would turn a two-step tutorial into three.
   */
  grantCore(itemId: string): void {
    const def = itemDef(itemId);
    if (!def) return;
    const inv = this.character.inventory;
    inv.add(itemId, 1);
    const cell = inv.slots.findIndex((s) => s?.id === itemId);
    if (cell >= 0) inv.equip(cell, 'lantern');
    this.applySheet();
    this.hud.popup({ icon: '\u2727', title: def.name, sub: 'Terpasang di lenteramu', color: rarityMeta(def.rarity).color, seconds: 5 });
    this.environment.spark(u(this.hero.x), u(this.hero.y), 0xff7a2e, true);
    sfx.lanternLight();
    this.saveNow(true);
  }

  /** Set when the developer menu wants every reaction written on screen. */
  onReactionLog: ((line: string) => void) | null = null;

  /** A reaction fired. Always a short popup; a full log line when the developer menu asks for it. */
  private onReaction(name: string, incoming: ElementId, on: ElementId | null, x: number, y: number): void {
    const line = `${ELEMENTS[incoming].name}${on ? ` + ${ELEMENTS[on].name}` : ''} \u2192 ${name}`;
    this.onReactionLog?.(line);
    this.hud.float(u(x), 1.9, u(y), name.toUpperCase(), '#ffe066', true);
  }

  /** Reused every frame for the dummy labels, so nothing is allocated per frame. */
  private dummyLabels: { x: number; y: number; z: number; text: string }[] = [];

  private dummyLabelT = 0;

  /**
   * Status text above each training dummy: what it carries right now, and what it has taken.
   *
   * Five times a second, not sixty: building the status strings allocates, and a status that lasts
   * seconds does not need to be re-read every 16 ms. The labels themselves are still repositioned
   * every frame by the HUD, so they track the camera smoothly.
   */
  private updateDummyLabels(dt: number): void {
    this.dummyLabelT -= dt;
    if (this.dummyLabelT > 0) return;
    this.dummyLabelT = 0.2;
    const list = this.combat.dummyStatus();
    this.dummyLabels.length = list.length;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const text = d.statuses || d.taken > 0 ? `${d.statuses || 'tanpa status'}${d.taken > 0 ? `  \u00b7  ${d.taken} dmg` : ''}` : 'Boneka Latihan';
      const label = this.dummyLabels[i] ?? { x: 0, y: 0, z: 0, text: '' };
      label.x = u(d.enemy.x);
      label.y = 2.1;
      label.z = u(d.enemy.y);
      label.text = text;
      this.dummyLabels[i] = label;
    }
    this.hud.setWorldLabels(this.dummyLabels);
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
        this.hud.popup({
          icon: '\u2691',
          title: `${def.name}${result.added > 1 ? ` x${result.added}` : ''}`,
          sub: 'Hadiah quest',
          color: rarityMeta(def.rarity).color,
        });
        this.hud.float(u(x), 1.2 + lifted * 0.35, u(y), def.name, rarityMeta(def.rarity).color, false);
        lifted++;
      }
      if (result.overflow > 0) this.hud.toast(`Tas penuh: ${def.name} tidak terbawa!`);
    }
    if (reward.exp) this.gainExp(reward.exp, x, y);
    this.applySheet();
    this.saveNow(true);
  }

  // ───────────────────────── area data ─────────────────────────

  /**
   * Keep the hero out of an area whose data is not on the phone yet.
   *
   * Only *crossing into* one is stopped: a game loaded inside the cave on a phone without the cave's
   * data stays where it is (the ground is baked locally), because sending someone back to the
   * village from their own save would be worse than a slower chunk load.
   */
  private enforceAreaGate(dt: number): void {
    this.gatePromptT = Math.max(0, this.gatePromptT - dt);
    const area = areaAtTile(Math.floor(this.hero.x / 16));
    if (area === this.lastSafe.area || !this.areaData.blocked(area)) {
      this.lastSafe.x = this.hero.x;
      this.lastSafe.y = this.hero.y;
      this.lastSafe.area = area;
      return;
    }
    // back to the last spot outside it, and stop the run so it does not immediately try again
    this.hero.x = this.lastSafe.x;
    this.hero.y = this.lastSafe.y;
    this.hero.vx = 0;
    this.hero.vy = 0;
    this.camera.snap(u(this.hero.x), u(this.hero.y));
    if (!this.dataRequired.isOpen && this.gatePromptT <= 0) {
      this.gatePromptT = 3;
      void this.dataRequired.show(area);
    }
  }

  /** The adapter the two data panels read. Everything in it comes from `AreaData`. */
  private makeDataSource(): DataSource {
    const listeners = new Set<() => void>();
    this.areaData.onChange = () => {
      for (const fn of listeners) fn();
    };
    return {
      available: this.areaData.available,
      manifestError: () => this.areaData.manifestError,
      areas: async (): Promise<DataAreaView[]> => {
        const m = this.areaData.manifest;
        if (!m) return [];
        return Promise.all(
          Object.keys(m.areas).map(async (id) => {
            const p = this.areaData.progress(id);
            const status = this.areaData.status(id);
            const done = p && status === 'mengunduh' ? p.done : await this.areaData.cachedBytes(id);
            return {
              id,
              name: AREAS[id as keyof typeof AREAS]?.name ?? id,
              status,
              bytes: this.areaData.sizeOf(id),
              done,
              error: status === 'gagal' ? p?.error : undefined,
              core: id === m.core,
            };
          }),
        );
      },
      download: (id) => this.areaData.download(id),
      remove: (id) => this.areaData.remove(id),
      storage: () => this.areaData.storage(),
      requestPersist: () => this.areaData.requestPersist(),
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
  }

  // ───────────────────────── developer menu ─────────────────────────

  /** The developer menu holds the world still while it is open, like the pause menu. */
  setDevPaused(on: boolean): void {
    this.paused = on || this.pause.isOpen || this.sheet.isOpen;
    input.enabled = !this.paused && !this.dialogue.open;
    if (on) input.reset();
    this.hud.setVisible(!on);
  }

  /** Current time of day, 0..1 (0 = midnight, 0.5 = noon). */
  get timeOfDay(): number {
    return this.dayTime;
  }

  /** Jump the clock. The day keeps running from there. */
  setTimeOfDay(t: number): void {
    if (!Number.isFinite(t)) return;
    this.dayTime = ((t % 1) + 1) % 1;
    this.state.dayTime = this.dayTime;
  }

  get currentWeather(): Weather {
    return this.weather;
  }

  /**
   * Set the weather. The rain mesh is created on first use, so a session that never touches the
   * weather never allocates it.
   */
  setWeather(w: Weather): void {
    this.weather = w;
    if (WEATHER[w].rain > 0 && !this.rain) this.rain = new Rain(this.pixels.scene);
    // the ambience follows: force the soundtrack to re-pick next frame
    this.nowAmbient = '';
  }

  /** Put the hero somewhere, and bring the world with them without a frame of emptiness. */
  teleport(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.hero.reset(x, y, this.hero.hp);
    this.camera.snap(u(x), u(y));
    this.scene3d.preload(u(x), u(y), 1);
  }

  // ───────────────────────── cutscenes ─────────────────────────

  /**
   * Play a cutscene by id.
   *
   * `auto` is how the story triggers one: an auto-play is skipped entirely if the save says it has
   * already been watched, while replaying from Settings always plays. Returns false when nothing
   * started, so the caller can carry straight on.
   */
  playCutscene(id: string, opts: { auto?: boolean } = {}): boolean {
    const def = CUTSCENES[id];
    if (!def) return false;
    if (opts.auto && this.state.hasSeen(id)) return false;
    if (this.cutscene.running) return false;

    this.cutscene.play(def, {
      vars: { nama: playerName() },
      textSpeed: () => settings.get('textSpeed'),
    });
    // The world holds still and the game UI gets out of the way.
    this.paused = true;
    input.enabled = false;
    input.reset();
    this.sheet.hide();
    this.hud.setVisible(false);
    this.minimap.setVisible(false);
    this.sheet.setVisible(false);
    this.onCutsceneChange(true);
    this.csOverlay.setVisible(true);
    return true;
  }

  /**
   * Drive the running cutscene, if any: the overlay, the scripted actor walk, and the timeline.
   *
   * Public because it is the whole cutscene frame in one call — `step()` uses it, and so can a
   * test, which matters because a full `step()` cannot run without a GPU.
   */
  tickCutscene(dt: number): void {
    if (!this.cutscene.active) return;
    const view = this.cutscene.view;
    if (view) this.csOverlay.render(view, dt);
    this.tickActors(dt);
    this.camera.tick(dt);
    if (!this.cutscene.update(dt)) this.endCutscene();
  }

  // ───────────────────────── pause menu content ─────────────────────────

  /**
   * Senjata: the two slots the hero carries, what the sword's combo is worth, and what each draw
   * of the bow does — read from the live `ATTACKS`/`BOW_SHOTS` tables, so a number changed in the
   * combat tuning panel shows up here too.
   */
  private weaponLines(): InfoLine[] {
    const held = this.hero.weapon;
    const lines: InfoLine[] = [];
    for (const slot of [0, 1] as const) {
      const id = this.hero.loadout[slot];
      const def = WEAPONS[id];
      lines.push({ label: `Slot ${slot + 1}: ${def.name}`, value: id === held ? 'DIPEGANG' : 'siap' });
    }
    const swordDamage = ATTACKS.map((a: { dmg: number }) => a.dmg).join(' / ');
    lines.push({ label: 'Kombo pedang', value: swordDamage, note: 'Tiga tebasan ringan; tahan tombol untuk serangan berat (angka terakhir).' });
    for (const shot of BOW_SHOTS) {
      lines.push({ label: shot.name, value: `${shot.dmg} dmg, tembus ${shot.pierce}`, note: shot.needsCharge > 0 ? `Butuh tarikan ${(shot.needsCharge * 100).toFixed(0)}%` : 'Tanpa tarikan' });
    }
    const element = this.character.coreElement;
    lines.push({ label: 'Elemen serangan', value: element ? ELEMENTS[element].name : 'tidak ada', note: element ? undefined : 'Pasang Inti Lentera di Karakter untuk memberi elemen pada seranganmu.' });
    const locked = (Object.keys(WEAPONS) as (keyof typeof WEAPONS)[]).filter((id) => !WEAPONS[id].implemented);
    for (const id of locked) lines.push({ label: WEAPONS[id].name, value: 'belum ada', dim: true });
    return lines;
  }

  /**
   * Skill: what the hero can actually do, with the numbers the combat code uses.
   *
   * There is one skill, so this lists one skill. Filling the page with locked slots would look
   * like content; saying there is one and it costs seven seconds is the truth.
   */
  private skillLines(): InfoLine[] {
    const ready = this.hero.skillReady;
    return [
      { label: 'Ledakan Lentera', value: ready ? 'siap' : `${this.hero.skillCd.toFixed(1)} dtk` },
      { label: 'Damage', value: `${HERO_STATS.skillDmg}` },
      { label: 'Jangkauan', value: `${HERO_STATS.skillRadius} px` },
      { label: 'Jeda', value: `${HERO_STATS.skillCooldown} dtk` },
      { label: 'Gerak berguling', value: `${HERO_STATS.rollInvuln.toFixed(2)} dtk kebal`, note: 'Berguling membatalkan seranganmu dan memberi kebal singkat.' },
      { label: '', value: '', note: 'Skill elemen, weapon skill, dan ultimate belum diimplementasikan — rencananya di batch berikutnya.' },
    ];
  }

  /** Quest: the live tracker, plus what the hero has to show for it. */
  private questLines(): InfoLine[] {
    const q = this.story.questText();
    const lines: InfoLine[] = [{ label: q.title, value: `tahap ${this.state.quest.stage}/4` }];
    for (const line of q.lines) lines.push({ label: line, value: '' });
    lines.push({ label: 'Monster hutan', value: `${this.state.quest.kills}/${KILLS_NEEDED}` });
    lines.push({ label: 'Puzzle batu', value: this.state.puzzleSolved ? 'selesai' : 'belum' });
    lines.push({ label: 'Kolosus Kelam', value: this.state.bossDefeated ? 'tumbang' : 'masih hidup' });
    lines.push({ label: 'Lentera Agung', value: this.state.flags.lanternLit ? 'menyala' : 'padam' });
    lines.push({ label: 'Level', value: `${this.character.level} (${this.character.exp}/${this.character.expNeeded || '-'} EXP)` });
    return lines;
  }

  /** Set by the boot code so the touch controls can show the contextual interact button. */
  onInteractPrompt: (label: string | null) => void = () => undefined;

  /** Set by the boot code: open the settings overlay from the pause menu. */
  onOpenSettings: () => void = () => undefined;
  /** Set by the boot code: save is already done, take the player back to the title screen. */
  onQuit: () => void = () => undefined;

  /** Set by the boot code so the touch controls can hide while a scene plays. */
  onCutsceneChange: (playing: boolean) => void = () => undefined;

  /** Tidy up after a scene: give the world back, remember it was watched, save. */
  private endCutscene(): void {
    const id = this.cutscene.id;
    this.cutscene.clear();
    this.csOverlay.setVisible(false);
    this.actorMove = null;
    this.dayTimeOverride = null;
    this.tintOverride = null;
    this.hud.setVisible(true);
    this.minimap.setVisible(true);
    this.sheet.setVisible(true);
    this.paused = false;
    input.enabled = true;
    this.onCutsceneChange(false);
    if (id) {
      this.state.markSeen(id);
      this.saveNow(true);
    }
  }

  /**
   * Walk an actor, or put it somewhere.
   *
   * Only the hero is an actor the engine can move today: the parents in the opening are *heard*
   * and never seen, which is how the script in docs/STORY.md tells it, so nothing else needed
   * staging. An unknown id is ignored rather than throwing — a cutscene must not be able to crash
   * the game over a typo in a name.
   */
  private moveActor(spec: ActorSpec): void {
    if (spec.id !== 'hero') return;
    if (spec.face !== undefined) this.hero.aim = spec.face;
    if (spec.anim === 'idle') {
      this.hero.vx = 0;
      this.hero.vy = 0;
      this.actorMove = null;
    }
    if (spec.x === undefined && spec.y === undefined) return;
    const toX = spec.x ?? this.hero.x;
    const toY = spec.y ?? this.hero.y;
    if (spec.dur <= 0) {
      this.hero.reset(toX, toY, this.hero.hp);
      this.camera.snap(u(toX), u(toY));
      this.actorMove = null;
      return;
    }
    this.actorMove = { id: spec.id, fromX: this.hero.x, fromY: this.hero.y, toX, toY, t: 0, dur: spec.dur };
  }

  /**
   * Advance a cutscene's actor walk.
   *
   * The velocity is written as well as the position, because `HeroMesh3D` decides whether to play
   * the walk animation from `vx/vy` — so a scripted walk animates exactly like a played one
   * instead of sliding along frozen.
   */
  private tickActors(dt: number): void {
    const m = this.actorMove;
    if (!m) return;
    m.t = Math.min(m.dur, m.t + dt);
    const k = m.t / m.dur;
    const x = m.fromX + (m.toX - m.fromX) * k;
    const y = m.fromY + (m.toY - m.fromY) * k;
    this.hero.vx = dt > 0 ? (x - this.hero.x) / dt : 0;
    this.hero.vy = dt > 0 ? (y - this.hero.y) / dt : 0;
    this.hero.x = x;
    this.hero.y = y;
    if (m.t >= m.dur) {
      this.hero.vx = 0;
      this.hero.vy = 0;
      this.actorMove = null;
    }
  }

  /**
   * The named particle effects a script may ask for.
   *
   * The table is here, in the game, not in the script — so a scene asks for "the lantern catching"
   * and this decides what that looks like with whatever the renderer has.
   */
  private cutsceneFx(spec: FxSpec): void {
    const x = spec.x ?? this.hero.x;
    const y = spec.y ?? this.hero.y;
    switch (spec.kind) {
      case 'lantern-blue':
        this.environment.spark(u(x), u(y), spec.color ?? 0x6fd8ff, true);
        break;
      case 'lantern-warm':
        this.environment.spark(u(x), u(y), spec.color ?? 0xffd98a, true);
        break;
      case 'spark':
        this.environment.spark(u(x), u(y), spec.color ?? 0xffffff, spec.big ?? false);
        break;
      case 'dust':
        for (let i = 0; i < 6; i++) {
          this.environment.spark(u(x) + (Math.random() - 0.5) * 2, u(y) + (Math.random() - 0.5) * 2, spec.color ?? 0x8a7f6a, false);
        }
        break;
      default:
        break;
    }
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
    // ── a cutscene owns the world while it runs ──
    this.tickCutscene(dt);

    if (!this.paused && dt > 0) {
      this.dayTime = (this.dayTime + simDt / DAY_SECONDS) % 1;
      this.updateHero(simDt);
      this.enforceAreaGate(dt);
      this.combat.update(simDt, dt, this.hero);
      this.camera.follow(u(this.hero.x), u(this.hero.y), dt);
      this.camera.tick(dt);
      this.perf.push(dt);
      this.updateAuto(dt);
    }
    this.heroMesh.update(simDt, dt, this.hero, this.clock);
    this.onWeaponState(
      WEAPONS[this.hero.loadout[this.hero.slot === 0 ? 1 : 0]].name.toUpperCase(),
      this.hero.charge,
      { label: this.hero.isRanged ? 'PANAH' : 'TEBAS', ranged: this.hero.isRanged },
    );
    // The contextual interact button: the world decides the word, the controls draw it.
    this.onInteractPrompt(this.paused || this.dialogue.open ? null : this.story.interactPrompt);

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
    const look = WEATHER[this.weather];
    const fogFar = Math.min(rawFar, loadedReach) * look.fogScale;
    const fogNear = Math.min(rawNear * look.fogScale, fogFar - 8);
    if (this.dayTimeOverride !== null) this.dayTime = this.dayTimeOverride;
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
    // no rain underground, whatever the sky is doing
    this.rain?.update(dt, this.camera.target, this.camera.yawRadians, WEATHER[this.weather].rain * (1 - cave));
    this.pixels.render(this.camera.camera);
  }

  /**
   * Pick the music and the ambience for where the hero is standing.
   *
   * The *rules* live in `core/audio/select.ts` so they can be tested; this only notices when the
   * answer changes and hands the new name to the mixer. A cutscene sets its own soundtrack, so it
   * is left alone while one plays — and the next frame after it ends puts the area's music back.
   */
  private updateSoundtrack(): void {
    if (this.cutscene.active) return;
    const boss = this.combat.bossRef;
    const situation = {
      area: areaAtTile(Math.floor(this.hero.x / 16)),
      night: nightAmount(this.dayTime),
      boss: !!boss && boss.awake && !boss.dead,
    };
    const track = musicFor(situation);
    if (track !== this.nowMusic) {
      bus.music(track, fadeFor(this.nowMusic, track));
      this.nowMusic = track;
    }
    const bed = WEATHER[this.weather].ambient ?? ambientFor(situation);
    if (bed !== this.nowAmbient) {
      bus.ambient(bed);
      this.nowAmbient = bed;
    }
  }

  /** Bloom, vignette and colour grade for the current time of day, scaled by the preset. */
  private applyGrade(cave: number): void {
    const g = gradeAt(this.dayTime, cave);
    // A cutscene can push the whole picture toward a colour. It goes into the grade's lift, which
    // is the one knob that tints the shadows without washing the highlights out.
    const w = WEATHER[this.weather].tint;
    const tint: [number, number, number] | null = this.tintOverride
      ? [this.tintOverride[0] + w[0], this.tintOverride[1] + w[1], this.tintOverride[2] + w[2]]
      : w[0] || w[1] || w[2]
        ? w
        : null;
    const p = profileOf(settings.get('preset'));
    const allow = settings.get('bloom') && p.bloom ? 1 : 0;
    this.pixels.setGrade({
      bloom: g.bloom * allow * this.bloomScale,
      vignette: g.vignette * (p.outline ? 1 : 0.6),
      lift: tint
        ? this.gradeLift.setRGB(g.lift[0] + tint[0], g.lift[1] + tint[1], g.lift[2] + tint[2])
        : this.gradeLift.setRGB(g.lift[0], g.lift[1], g.lift[2]),
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
      cutsceneSeen: (id) => this.state.hasSeen(id),
      openDownloads: () => this.downloads.show(),
      playCutscene: (id) => {
        this.playCutscene(id);
      },
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
      `audio: musik ${music.nowPlaying || '-'}   suasana ${ambientPlayer.playing || '-'}   ` +
        `unlocked ${audioReady() ? 'ya' : 'belum'}`,
      `cutscene: ${this.cutscene.active ? `${this.cutscene.id} jalan` : 'tidak'}   ` +
        `sudah ditonton: ${this.state.cutscenesSeen.join(', ') || '-'}`,
      `hero: (${Math.round(this.hero.x)}, ${Math.round(this.hero.y)}) hp ${this.hero.hp}/${this.hero.maxHp} state ${this.hero.state}`,
      `senjata: ${this.hero.weapon}${this.hero.isRanged ? ` (charge ${(this.hero.charge * 100).toFixed(0)}%)` : ` (combo ${this.hero.combo})`}`,
      `musuh hidup: ${this.combat.enemyCount}   status aktif: ${this.combat.statusSummary()}   reaksi terdaftar: ${this.combat.reactionCount}`,
      ...(this.saveNotes.length ? [`migrasi save: ${this.saveNotes.join('; ')}`] : []),
      `area: ${this.world.areaAt(Math.floor(this.hero.x / 16), Math.floor(this.hero.y / 16))}`,
      `kamera: sudut ${this.camera.pitch}\u00b0  zoom ${this.camera.zoom.toFixed(2)}x  ` +
        `target (${this.camera.target.x.toFixed(1)}, ${this.camera.target.z.toFixed(1)})  radius pandang ${this.camera.viewRadius.toFixed(1)} unit`,
      `kabut: ${this.sky.fog.near.toFixed(0)} - ${this.sky.fog.far.toFixed(0)} (gua ${(this.caveWeight() * 100).toFixed(0)}%)`,
      ...this.autoReport(),
      this.areaData.describe(),
      `tanah chunk: ${this.scene3d.groundStats.fromPack} dari paket, ${this.scene3d.groundStats.baked} dipanggang di HP`,
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
    this.downloads.destroy();
    this.dataRequired.destroy();
    this.rain?.dispose();
    this.csOverlay.destroy();
    this.pause.destroy();
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

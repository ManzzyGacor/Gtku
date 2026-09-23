import Phaser from 'phaser';
import { input, type Action } from '../core/input';
import { FONT_LINE_H, wrapText } from '../art/font';
import { settings } from '../core/settings';
import { P } from '../art/palette';
import { pixelText } from '../ui/pixeltext';
import { trackerLines } from '../core/systems/quest';
import { TILE, WORLD_TILES_H, WORLD_TILES_W } from '../config';
import { T } from '../core/world/tiles';
import type { GameScene } from './GameScene';

interface Btn {
  action: Action;
  size: number;
  icon: string;
  img: Phaser.GameObjects.Image;
  ico: Phaser.GameObjects.Image;
  dim: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.BitmapText;
  cx: number;
  cy: number;
  pointer: number;
}

export interface DialogSpec {
  name: string;
  look?: string;
  lines: string[];
  onDone?: () => void;
}

const BASE_STICK_R = 24;
/** Dialogue box height in logical px. */
const DLG_H = 86;

/** HUD, touch controls, dialogue box, banners. Runs on top of GameScene with its own (unzoomed) camera. */
export class UIScene extends Phaser.Scene {
  private game_!: GameScene;
  private joyBase!: Phaser.GameObjects.Image;
  private joyKnob!: Phaser.GameObjects.Image;
  private joyHome = { x: 60, y: 200 };
  private stickPointer = -1;
  private stickCenter = { x: 0, y: 0 };
  private btns: Btn[] = [];
  private touchUI = false;
  private unsubscribeSettings: (() => void) | null = null;

  // HUD
  private hpTrail!: Phaser.GameObjects.Rectangle;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private hpFillHi!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.BitmapText;
  private trailHp = 12;
  private questText!: Phaser.GameObjects.BitmapText;
  private fsBtn!: Phaser.GameObjects.Image;
  private mapImg!: Phaser.GameObjects.Image;
  private mapFrame!: Phaser.GameObjects.Rectangle;
  private mapGfx!: Phaser.GameObjects.Graphics;
  private mapPos = { x: 0, y: 0 };
  private hint!: Phaser.GameObjects.BitmapText;
  private flashRect!: Phaser.GameObjects.Rectangle;
  private flashT = 0;
  private flashDur = 1;
  private flashA = 0;

  // banner
  private banner!: Phaser.GameObjects.BitmapText;
  private bannerT = 0;
  private toastText!: Phaser.GameObjects.BitmapText;
  private toastT = 0;

  // boss bar
  private bossBg!: Phaser.GameObjects.Rectangle;
  private bossFill!: Phaser.GameObjects.Rectangle;
  private bossTrail!: Phaser.GameObjects.Rectangle;
  private bossName!: Phaser.GameObjects.BitmapText;
  private bossRatio: number | null = null;
  private bossTrailRatio = 1;

  // dialogue
  private dlgBox!: Phaser.GameObjects.Container;
  private dlgBg!: Phaser.GameObjects.Rectangle;
  private dlgFrame!: Phaser.GameObjects.Rectangle;
  private dlgName!: Phaser.GameObjects.BitmapText;
  private dlgText!: Phaser.GameObjects.BitmapText;
  private dlgPortrait!: Phaser.GameObjects.Image;
  private dlgArrow!: Phaser.GameObjects.BitmapText;
  private dlgPages: string[] = [];
  private dlgPage = 0;
  private dlgChars = 0;
  private dlgSpec: DialogSpec | null = null;
  dialogOpen = false;

  constructor() {
    super('UI');
  }

  create(): void {
    this.game_ = this.scene.get('Game') as GameScene;
    this.touchUI = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    input.lastDevice = this.touchUI ? 'touch' : 'keyboard';

    this.buildTouch();
    this.buildHud();
    this.buildMinimap();
    this.buildDialog();
    this.layout();
    this.game_.events.on('quest-changed', () => this.setQuest(trackerLines(this.game_.state)));
    this.setQuest(trackerLines(this.game_.state));
    this.setNpcMarks(this.game_.npcMarks());

    this.applySettings();
    this.unsubscribeSettings = settings.on((key) => {
      if (key === 'stickScale' || key === 'stickX' || key === 'stickY' || key === 'buttonScale' || key === 'textScale') this.applySettings();
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeSettings?.();
      this.unsubscribeSettings = null;
    });
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.layout());
    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('gameout', () => this.releaseAll());
  }

  /** Joystick throw in px at the player's chosen size. */
  private get stickR(): number {
    return BASE_STICK_R * settings.get('stickScale');
  }

  /** Dialogue text scale; the HUD sits one step smaller so it never covers the action. */
  private get hudTextScale(): number {
    return Math.max(1, settings.get('textScale') - 1);
  }

  /** Push the touch-layout and text-size settings into the objects, then re-place everything. */
  private applySettings(): void {
    const ss = settings.get('stickScale');
    const bs = settings.get('buttonScale');
    this.joyBase.setScale(ss);
    this.joyKnob.setScale(ss);
    for (const b of this.btns) {
      b.img.setScale(bs);
      b.dim.setScale(bs);
      b.ico.setScale((b.action === 'attack' ? 2 : b.action === 'skill' ? 1.5 : 1) * bs);
      b.label.setScale(bs);
    }
    const hud = this.hudTextScale;
    this.questText.setScale(hud);
    this.hint.setScale(hud);
    this.toastText.setScale(hud);
    this.dlgText.setScale(settings.get('textScale'));
    this.layout();
    if (this.dialogOpen && this.dlgSpec) {
      this.repaginateDialog();
      this.dlgPage = Math.min(this.dlgPage, Math.max(0, this.dlgPages.length - 1));
      this.dlgChars = 0;
    }
  }

  // ───────────────────────────── build ─────────────────────────────

  private buildTouch(): void {
    this.joyBase = this.add.image(0, 0, 'ui', 'joy_base').setDepth(10);
    this.joyKnob = this.add.image(0, 0, 'ui', 'joy_knob').setDepth(11);
    const mk = (action: Action, size: number, icon: string, label: string): void => {
      const img = this.add.image(0, 0, 'ui', `btn_${size}`).setDepth(10);
      const ico = this.add.image(0, 0, 'ui', icon).setDepth(11);
      const dim = this.add.image(0, 0, 'ui', `btn_${size}`).setDepth(12).setTint(0x000000).setAlpha(0);
      const lab = pixelText(this, 0, 0, label, { color: 0xffffff, origin: [0.5, 0.5], depth: 13 });
      this.btns.push({ action, size, icon, img, ico, dim, label: lab, cx: 0, cy: 0, pointer: -1 });
    };
    mk('attack', 48, 'ic_sword', '');
    mk('dodge', 30, 'ic_roll', '');
    mk('skill', 36, 'ic_burst', '');
    mk('interact', 26, 'ic_talk', '');
    // icon sizes come from applySettings(), which runs right after create() builds everything
    this.setTouchVisible(this.touchUI);
  }

  private buildHud(): void {
    this.flashRect = this.add.rectangle(0, 0, 10, 10, 0xffffff, 0).setOrigin(0).setDepth(5);
    this.add.image(4, 3, 'ui', 'heart_full').setOrigin(0, 0).setDepth(20);
    this.add.rectangle(22, 6, 76, 10, P.ink0).setOrigin(0).setDepth(20).setStrokeStyle(1, P.s4);
    this.hpTrail = this.add.rectangle(24, 8, 72, 6, P.y4).setOrigin(0).setDepth(21);
    this.hpFill = this.add.rectangle(24, 8, 72, 6, P.r2).setOrigin(0).setDepth(22);
    this.hpFillHi = this.add.rectangle(24, 8, 72, 2, P.r4).setOrigin(0).setDepth(23);
    this.hpText = pixelText(this, 61, 3, '12/12', { origin: [0.5, 0], depth: 24, color: 0xffffff });
    this.questText = pixelText(this, 6, 22, '', { depth: 20, color: 0xffe9a8 });
    this.fsBtn = this.add.image(0, 0, 'ui', 'ic_fullscreen').setDepth(20).setAlpha(0.8).setInteractive();
    this.fsBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.toggleFullscreen();
    });
    this.hint = pixelText(this, 0, 0, '', { depth: 20, origin: [0.5, 1], color: 0xffffff });
    this.banner = pixelText(this, 0, 0, '', { depth: 30, origin: [0.5, 0.5], scale: 2, color: 0xffe9a8 });
    this.banner.setAlpha(0);
    this.toastText = pixelText(this, 0, 0, '', { depth: 30, origin: [0.5, 0.5], color: 0xffffff });
    this.toastText.setAlpha(0);

    this.bossBg = this.add.rectangle(0, 0, 200, 10, P.ink0).setDepth(20).setStrokeStyle(1, P.c3).setVisible(false);
    this.bossTrail = this.add.rectangle(0, 0, 196, 6, P.y4).setOrigin(0, 0.5).setDepth(21).setVisible(false);
    this.bossFill = this.add.rectangle(0, 0, 196, 6, P.c2).setOrigin(0, 0.5).setDepth(22).setVisible(false);
    this.bossName = pixelText(this, 0, 0, '', { depth: 22, origin: [0.5, 1], color: 0xd8cfff }).setVisible(false);
  }

  private buildMinimap(): void {
    const w = WORLD_TILES_W;
    const h = WORLD_TILES_H;
    if (this.textures.exists('minimap')) this.textures.remove('minimap');
    const tex = this.textures.createCanvas('minimap', w, h)!;
    const ctx = tex.getContext();
    const world = this.game_.world;
    const colors: Record<number, string> = {
      [T.GRASS]: '#4f9a42', [T.FLOWERS]: '#5aa84a', [T.FOREST]: '#2b6b3a', [T.DIRT]: '#a16e3f', [T.COBBLE]: '#a8a0a0',
      [T.SAND]: '#dcba82', [T.WATER]: '#2673ac', [T.SHALLOW]: '#3f9fcf', [T.CAVE]: '#3a3e5e', [T.WALL]: '#141024',
      [T.BRIDGE_H]: '#8e5b33', [T.BRIDGE_V]: '#8e5b33', [T.ARENA]: '#5a4a9a',
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = world.tileAt(x, y);
        let c = colors[t] ?? '#000';
        if (world.solidAt(x, y) && t !== T.WALL && t !== T.WATER) c = t === T.FOREST || t === T.GRASS || t === T.FLOWERS ? '#1b4a2c' : '#6a4a3a';
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    tex.refresh();
    this.mapImg = this.add.image(0, 0, 'minimap').setOrigin(0).setScale(2).setDepth(19);
    this.mapFrame = this.add.rectangle(0, 0, 100, 68, 0x0f0b1c, 0.9).setOrigin(0).setDepth(18).setStrokeStyle(1, P.s4);
    this.mapGfx = this.add.graphics().setDepth(20);
  }

  private updateMinimap(): void {
    const g = this.game_;
    const VIEW_W = 48;
    const VIEW_H = 32;
    const hx = g.hero.x / TILE;
    const hy = g.hero.y / TILE;
    const cx0 = Phaser.Math.Clamp(Math.round(hx - VIEW_W / 2), 0, WORLD_TILES_W - VIEW_W);
    const cy0 = Phaser.Math.Clamp(Math.round(hy - VIEW_H / 2), 0, WORLD_TILES_H - VIEW_H);
    const fx = this.mapPos.x + 2;
    const fy = this.mapPos.y + 2;
    this.mapImg.setPosition(fx - cx0 * 2, fy - cy0 * 2);
    this.mapImg.setCrop(cx0, cy0, VIEW_W, VIEW_H);
    const gfx = this.mapGfx;
    gfx.clear();
    const dot = (tx: number, ty: number, color: number, size = 2): void => {
      const px = fx + (tx - cx0) * 2;
      const py = fy + (ty - cy0) * 2;
      if (px < fx || py < fy || px > fx + VIEW_W * 2 - size || py > fy + VIEW_H * 2 - size) return;
      gfx.fillStyle(color, 1);
      gfx.fillRect(Math.round(px), Math.round(py), size, size);
    };
    // objectives and NPCs
    const stage = g.state.quest.stage;
    for (const npc of this.npcMarks) dot(npc.x / TILE, npc.y / TILE, npc.id === 'wulan' && (stage === 0 || stage === 3) ? 0xffd15a : 0x66e0ff);
    if (stage === 2) dot(g.world.markers.boss.spawn.x / TILE, g.world.markers.boss.spawn.y / TILE, 0xff5a4a, 3);
    for (const cp of g.world.markers.checkpoints) dot(cp.x / TILE, cp.y / TILE, 0xffb04a);
    // hero (blinks)
    if (Math.floor(this.time.now / 350) % 2 === 0) dot(hx - 0.5, hy - 1, 0xffffff, 3);
    else dot(hx - 0.5, hy - 1, 0xff5a5a, 3);
  }

  private npcMarks: { id: string; x: number; y: number }[] = [];

  /** GameScene tells us where NPCs stand so the minimap can mark them. */
  setNpcMarks(list: { id: string; x: number; y: number }[]): void {
    this.npcMarks = list;
  }

  private buildDialog(): void {
    this.dlgBg = this.add.rectangle(0, 0, 100, 60, P.ink0, 0.92).setOrigin(0);
    this.dlgFrame = this.add.rectangle(0, 0, 100, 60, 0, 0).setOrigin(0).setStrokeStyle(1, P.y3);
    this.dlgPortrait = this.add.image(0, 0, 'npc', 'portrait_elder').setOrigin(0.5, 0).setScale(3);
    this.dlgName = pixelText(this, 0, 0, '', { color: 0xffd98a, scale: 1 });
    this.dlgText = pixelText(this, 0, 0, '', { color: 0xffffff, scale: 2 });
    this.dlgArrow = pixelText(this, 0, 0, '>', { color: 0xffd98a, origin: [1, 1] });
    this.dlgBox = this.add.container(0, 0, [this.dlgBg, this.dlgFrame, this.dlgPortrait, this.dlgName, this.dlgText, this.dlgArrow]);
    this.dlgBox.setDepth(40).setVisible(false);
  }

  // ───────────────────────────── layout ─────────────────────────────

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.flashRect.setSize(w, h);
    const ss = settings.get('stickScale');
    const bs = settings.get('buttonScale');
    this.joyHome = {
      x: Math.round(Phaser.Math.Clamp(w * settings.get('stickX'), 34 * ss, w * 0.5 - 10)),
      y: Math.round(Phaser.Math.Clamp(h * settings.get('stickY'), 40 * ss, h - 34 * ss)),
    };
    if (this.stickPointer < 0) this.placeStick(this.joyHome.x, this.joyHome.y, 0, 0);
    const place = (a: Action, x: number, y: number): void => {
      const b = this.btns.find((q) => q.action === a)!;
      b.cx = x;
      b.cy = y;
      for (const o of [b.img, b.ico, b.dim, b.label]) o.setPosition(x, y);
    };
    place('attack', w - 48 * bs, h - 50 * bs);
    place('dodge', w - 100 * bs, h - 34 * bs);
    place('skill', w - 90 * bs, h - 84 * bs);
    place('interact', w - 48 * bs, h - 106 * bs);
    this.fsBtn.setPosition(w - 12, 12);
    this.mapPos = { x: w - 104, y: 22 };
    this.mapFrame.setPosition(this.mapPos.x, this.mapPos.y).setSize(100, 68);
    this.hint.setPosition(w / 2, h - 6);
    this.banner.setPosition(w / 2, 46);
    this.toastText.setPosition(w / 2, h - 44);
    const bw = Math.min(220, w - 160);
    this.bossBg.setPosition(w / 2, 14).setSize(bw + 4, 10);
    this.bossTrail.setPosition(w / 2 - bw / 2, 14);
    this.bossFill.setPosition(w / 2 - bw / 2, 14);
    this.bossName.setPosition(w / 2, 8);
    this.layoutDialog();
  }

  private layoutDialog(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const bw = Math.min(w - 16, 480);
    const bh = DLG_H;
    const x = Math.round((w - bw) / 2);
    const y = h - bh - 8;
    this.dlgBox.setPosition(x, y);
    this.dlgBg.setSize(bw, bh);
    this.dlgFrame.setSize(bw, bh);
    this.dlgPortrait.setPosition(34, 8);
    this.dlgName.setPosition(70, 6);
    this.dlgText.setPosition(70, 20);
    this.dlgArrow.setPosition(bw - 8, bh - 4);
  }

  private setTouchVisible(v: boolean): void {
    this.joyBase.setVisible(v);
    this.joyKnob.setVisible(v);
    for (const b of this.btns) for (const o of [b.img, b.ico, b.dim, b.label]) o.setVisible(v && !(b.action === 'interact'));
  }

  // ───────────────────────────── touch input ─────────────────────────────

  private placeStick(cx: number, cy: number, kx: number, ky: number): void {
    this.joyBase.setPosition(cx, cy);
    this.joyKnob.setPosition(cx + kx, cy + ky);
  }

  private hitButton(x: number, y: number): Btn | null {
    for (const b of this.btns) {
      if (!b.img.visible) continue;
      if (Math.hypot(x - b.cx, y - b.cy) <= (b.size / 2) * settings.get('buttonScale') + 8) return b;
    }
    return null;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (p.wasTouch && !this.touchUI) {
      this.touchUI = true;
      this.setTouchVisible(true);
    }
    if (p.wasTouch) input.lastDevice = 'touch';
    if (this.dialogOpen) {
      this.advanceDialog();
      return;
    }
    const b = this.hitButton(p.x, p.y);
    if (b) {
      b.pointer = p.id;
      input.press(b.action);
      b.img.setTexture('ui', `btn_${b.size}_down`);
      return;
    }
    if (this.stickPointer < 0 && p.x < this.scale.width * 0.5) {
      this.stickPointer = p.id;
      const cx = Phaser.Math.Clamp(p.x, 40, this.scale.width * 0.5 - 10);
      const cy = Phaser.Math.Clamp(p.y, 50, this.scale.height - 40);
      this.stickCenter = { x: cx, y: cy };
      this.placeStick(cx, cy, 0, 0);
      this.joyBase.setAlpha(1);
      this.updateStick(p);
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (p.id === this.stickPointer) this.updateStick(p);
  }

  private updateStick(p: Phaser.Input.Pointer): void {
    const R = this.stickR;
    let dx = p.x - this.stickCenter.x;
    let dy = p.y - this.stickCenter.y;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
      // drag the base along so the thumb never runs out of room
      this.stickCenter.x += (p.x - this.stickCenter.x) - dx;
      this.stickCenter.y += (p.y - this.stickCenter.y) - dy;
    }
    const m = Math.min(1, Math.hypot(dx, dy) / R);
    const dead = 0.14;
    if (m < dead) {
      input.stick.x = 0;
      input.stick.y = 0;
    } else {
      const k = (m - dead) / (1 - dead);
      input.stick.x = (dx / (m * R)) * k;
      input.stick.y = (dy / (m * R)) * k;
    }
    this.placeStick(this.stickCenter.x, this.stickCenter.y, dx, dy);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (p.id === this.stickPointer) {
      this.stickPointer = -1;
      input.stick.x = 0;
      input.stick.y = 0;
      this.placeStick(this.joyHome.x, this.joyHome.y, 0, 0);
    }
    for (const b of this.btns) {
      if (b.pointer === p.id) {
        b.pointer = -1;
        input.release(b.action);
        b.img.setTexture('ui', `btn_${b.size}`);
      }
    }
  }

  private releaseAll(): void {
    this.stickPointer = -1;
    input.reset();
    for (const b of this.btns) {
      b.pointer = -1;
      b.img.setTexture('ui', `btn_${b.size}`);
    }
    this.placeStick(this.joyHome.x, this.joyHome.y, 0, 0);
  }

  private toggleFullscreen(): void {
    const s = this.scale;
    if (s.isFullscreen) s.stopFullscreen();
    else {
      s.startFullscreen();
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      o?.lock?.('landscape').catch(() => undefined);
    }
  }

  // ───────────────────────────── public API ─────────────────────────────

  /** Full-screen colour flash that fades out (damage, blast, phase change). */
  flash(color: number, alpha: number, ms: number): void {
    this.flashRect.setFillStyle(color, 1);
    this.flashA = alpha;
    this.flashDur = ms / 1000;
    this.flashT = ms / 1000;
  }

  showBanner(text: string): void {
    this.banner.setText(text);
    this.bannerT = 2.6;
  }

  toast(text: string): void {
    this.toastText.setText(text);
    this.toastT = 2.2;
  }

  setQuest(lines: string[]): void {
    this.questText.setText(lines.join('\n'));
  }

  setBoss(name: string | null, ratio = 1): void {
    if (name === null) {
      this.bossRatio = null;
    } else {
      if (this.bossRatio === null) this.bossTrailRatio = 1;
      this.bossName.setText(name);
      this.bossRatio = ratio;
    }
  }

  /** Split the current dialogue into pages that fit the box at the player's text size. */
  private repaginateDialog(): void {
    const spec = this.dlgSpec;
    if (!spec) return;
    const scale = settings.get('textScale');
    const maxW = Math.floor((Math.min(this.scale.width - 16, 480) - 82) / scale);
    const perPage = Math.max(1, Math.floor((DLG_H - 22) / (FONT_LINE_H * scale)));
    this.dlgPages = [];
    for (const line of spec.lines) {
      const wrapped = wrapText(line, maxW);
      for (let i = 0; i < wrapped.length; i += perPage) this.dlgPages.push(wrapped.slice(i, i + perPage).join('\n'));
    }
  }

  showDialog(spec: DialogSpec): void {
    this.dlgSpec = spec;
    this.repaginateDialog();
    this.dlgPage = 0;
    this.dlgChars = 0;
    this.dialogOpen = true;
    input.enabled = false;
    input.stick.x = input.stick.y = 0;
    this.dlgName.setText(spec.name);
    const frame = spec.look ? `portrait_${spec.look}` : 'portrait_elder';
    this.dlgPortrait.setFrame(frame).setVisible(!!spec.look);
    this.dlgBox.setVisible(true);
    this.dlgText.setText('');
    this.setTouchAlpha(0.35);
  }

  private setTouchAlpha(a: number): void {
    for (const o of [this.joyBase, this.joyKnob, ...this.btns.flatMap((b) => [b.img, b.ico, b.label])]) o.setAlpha(a);
  }

  private advanceDialog(): void {
    const page = this.dlgPages[this.dlgPage] ?? '';
    if (this.dlgChars < page.length) {
      this.dlgChars = page.length;
      return;
    }
    this.dlgPage += 1;
    this.dlgChars = 0;
    if (this.dlgPage >= this.dlgPages.length) this.closeDialog();
  }

  private closeDialog(): void {
    this.dialogOpen = false;
    this.dlgBox.setVisible(false);
    input.enabled = true;
    input.clear();
    this.setTouchAlpha(1);
    const done = this.dlgSpec?.onDone;
    this.dlgSpec = null;
    done?.();
  }

  // ───────────────────────────── update ─────────────────────────────

  override update(t: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const g = this.game_;
    if (!g?.hero) return;

    // dialogue typewriter + keyboard advance
    if (this.dialogOpen) {
      const page = this.dlgPages[this.dlgPage] ?? '';
      if (this.dlgChars < page.length) this.dlgChars = Math.min(page.length, this.dlgChars + dt * 55);
      this.dlgText.setText(page.slice(0, Math.floor(this.dlgChars)));
      this.dlgArrow.setVisible(this.dlgChars >= page.length && Math.floor(t / 300) % 2 === 0);
      if (input.consume('interact', 60) || input.consume('attack', 60)) this.advanceDialog();
    }

    // HP bar
    const hero = g.hero;
    const ratio = Phaser.Math.Clamp(hero.hp / hero.maxHp, 0, 1);
    const fullW = 72;
    const fillW = Math.round(fullW * ratio);
    this.hpFill.setSize(fillW, 6);
    this.hpFillHi.setSize(fillW, 2);
    this.trailHp += (hero.hp - this.trailHp) * Math.min(1, dt * (hero.hp < this.trailHp ? 2.2 : 12));
    this.hpTrail.setSize(Math.round((fullW * Phaser.Math.Clamp(this.trailHp, 0, hero.maxHp)) / hero.maxHp), 6);
    this.hpText.setText(`${Math.ceil(hero.hp)}/${hero.maxHp}`);
    this.hpFill.setFillStyle(ratio < 0.3 ? P.r1 : P.r2);

    // skill / dodge buttons
    for (const b of this.btns) {
      if (!b.img.visible) continue;
      if (b.action === 'skill') {
        const cd = hero.skillCd;
        b.dim.setAlpha(cd > 0 ? 0.6 : 0);
        b.label.setText(cd > 0 ? String(Math.ceil(cd)) : '');
        b.ico.setAlpha(cd > 0 ? 0.5 : 1);
      } else if (b.action === 'dodge') {
        b.dim.setAlpha(hero.rollCd > 0.02 ? 0.5 : 0);
      }
    }
    // interact prompt
    const prompt = this.registry.get('interact') as string | null | undefined;
    const ib = this.btns.find((b) => b.action === 'interact')!;
    const showI = !!prompt && this.touchUI && !this.dialogOpen;
    for (const o of [ib.img, ib.ico, ib.dim, ib.label]) o.setVisible(showI);
    if (prompt && !this.dialogOpen) this.hint.setText(this.touchUI ? prompt : `[E] ${prompt}`);
    else this.hint.setText('');

    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.flashRect.setAlpha(this.flashA * (this.flashT / this.flashDur));
    } else this.flashRect.setAlpha(0);

    this.updateMinimap();

    // banner/toast fades
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      this.banner.setAlpha(Math.min(1, this.bannerT * 2, (2.6 - this.bannerT) * 3));
    } else this.banner.setAlpha(0);
    if (this.toastT > 0) {
      this.toastT -= dt;
      this.toastText.setAlpha(Math.min(1, this.toastT * 2));
    } else this.toastText.setAlpha(0);

    // boss bar
    const bossVisible = this.bossRatio !== null;
    for (const o of [this.bossBg, this.bossFill, this.bossTrail, this.bossName]) o.setVisible(bossVisible);
    if (bossVisible) {
      const bw = this.bossBg.width - 4;
      const r = this.bossRatio ?? 0;
      this.bossTrailRatio += (r - this.bossTrailRatio) * Math.min(1, dt * (r < this.bossTrailRatio ? 1.8 : 10));
      this.bossFill.setSize(Math.round(bw * r), 6);
      this.bossTrail.setSize(Math.round(bw * this.bossTrailRatio), 6);
    }
  }
}


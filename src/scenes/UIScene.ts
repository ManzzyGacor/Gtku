import Phaser from 'phaser';
import { input, type Action } from '../core/input';
import { wrapText } from '../art/font';
import { P } from '../art/palette';
import { pixelText } from '../ui/pixeltext';
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

const DEFAULT_STICK_R = 24;

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

  // HUD
  private hpTrail!: Phaser.GameObjects.Rectangle;
  private hpFill!: Phaser.GameObjects.Rectangle;
  private hpFillHi!: Phaser.GameObjects.Rectangle;
  private hpText!: Phaser.GameObjects.BitmapText;
  private trailHp = 12;
  private questText!: Phaser.GameObjects.BitmapText;
  private fsBtn!: Phaser.GameObjects.Image;
  private hint!: Phaser.GameObjects.BitmapText;

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
    this.buildDialog();
    this.layout();

    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.layout());
    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('gameout', () => this.releaseAll());
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
    for (const b of this.btns) {
      if (b.action === 'attack') b.ico.setScale(2);
      else if (b.action === 'skill') b.ico.setScale(1.5);
    }
    this.setTouchVisible(this.touchUI);
  }

  private buildHud(): void {
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
    this.joyHome = { x: 62, y: h - 58 };
    if (this.stickPointer < 0) this.placeStick(this.joyHome.x, this.joyHome.y, 0, 0);
    const place = (a: Action, x: number, y: number): void => {
      const b = this.btns.find((q) => q.action === a)!;
      b.cx = x;
      b.cy = y;
      for (const o of [b.img, b.ico, b.dim, b.label]) o.setPosition(x, y);
    };
    place('attack', w - 48, h - 50);
    place('dodge', w - 100, h - 34);
    place('skill', w - 90, h - 84);
    place('interact', w - 48, h - 106);
    this.fsBtn.setPosition(w - 12, 12);
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
    const bh = 86;
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
      if (Math.hypot(x - b.cx, y - b.cy) <= b.size / 2 + 8) return b;
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
    let dx = p.x - this.stickCenter.x;
    let dy = p.y - this.stickCenter.y;
    const len = Math.hypot(dx, dy);
    if (len > DEFAULT_STICK_R) {
      dx = (dx / len) * DEFAULT_STICK_R;
      dy = (dy / len) * DEFAULT_STICK_R;
      // drag the base along so the thumb never runs out of room
      this.stickCenter.x += (p.x - this.stickCenter.x) - dx;
      this.stickCenter.y += (p.y - this.stickCenter.y) - dy;
    }
    const m = Math.min(1, Math.hypot(dx, dy) / DEFAULT_STICK_R);
    const dead = 0.14;
    if (m < dead) {
      input.stick.x = 0;
      input.stick.y = 0;
    } else {
      const k = (m - dead) / (1 - dead);
      input.stick.x = (dx / (m * DEFAULT_STICK_R)) * k;
      input.stick.y = (dy / (m * DEFAULT_STICK_R)) * k;
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

  showDialog(spec: DialogSpec): void {
    this.dlgSpec = spec;
    const maxW = Math.floor((Math.min(this.scale.width - 16, 480) - 82) / 2);
    this.dlgPages = [];
    for (const line of spec.lines) {
      const wrapped = wrapText(line, maxW);
      for (let i = 0; i < wrapped.length; i += 2) this.dlgPages.push(wrapped.slice(i, i + 2).join('\n'));
    }
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
    this.hpFill.width = Math.round(fullW * ratio);
    this.hpFillHi.width = this.hpFill.width;
    this.trailHp += (hero.hp - this.trailHp) * Math.min(1, dt * (hero.hp < this.trailHp ? 2.2 : 12));
    this.hpTrail.width = Math.round((fullW * Phaser.Math.Clamp(this.trailHp, 0, hero.maxHp)) / hero.maxHp);
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
      this.bossFill.width = Math.round(bw * r);
      this.bossTrail.width = Math.round(bw * this.bossTrailRatio);
    }
  }
}


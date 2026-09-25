/**
 * Mode Pengembang — the developer menu.
 *
 * Built for exactly one person testing on a phone with no PC: every action is a button, nothing
 * needs typing except a level number, and the content opens beside the section list so a wide
 * landscape screen is used rather than scrolled. It is renderer-free UI like every other panel:
 * it talks to the game only through `DevActions`, which `render3d/DevTools.ts` implements.
 *
 * Only built for an account whose role the **server** reported as "dev" (boot3d.ts), and every
 * action it offers is authorised — and for grants, carried out — by the server (DevTools.ts). A
 * player never sees it; and a player who digs the code out of the bundle gets 403 from the server.
 */
import { el, injectStyle, onTap } from './dom';

const CSS = `
.lm-dev { position: fixed; inset: 0; z-index: 97; display: none; pointer-events: auto;
  background: rgba(6, 10, 14, 0.88);
  font: 12px/1.45 ui-monospace, monospace; color: #d7f5e6; }
.lm-dev.on { display: flex; }
.lm-dev-wrap { display: flex; gap: 8px; width: 100%;
  padding: calc(8px + var(--lm-sat, 0px)) calc(8px + var(--lm-sar, 0px))
           calc(8px + var(--lm-sab, 0px)) calc(8px + var(--lm-sal, 0px)); }
.lm-dev-side { flex: 0 0 auto; width: min(190px, 28vw); display: flex; flex-direction: column; gap: 4px;
  overflow-y: auto; }
.lm-dev-title { color: #7dffb0; letter-spacing: 2px; padding: 2px 4px 6px; }
.lm-dev-tab { min-height: 40px; padding: 0 10px; text-align: left; border-radius: 4px; cursor: pointer;
  font: inherit; color: #bfe8d2; background: rgba(20, 40, 32, 0.9); border: 1px solid rgba(125, 255, 176, 0.25);
  touch-action: manipulation; }
.lm-dev-tab.on { color: #062014; background: #7dffb0; border-color: #7dffb0; }
.lm-dev-main { flex: 1 1 auto; min-width: 0; overflow-y: auto; padding: 4px 8px 12px; border-radius: 6px;
  background: rgba(10, 22, 18, 0.8); border: 1px solid rgba(125, 255, 176, 0.2); }
.lm-dev-h { color: #7dffb0; margin: 10px 0 5px; letter-spacing: 1px; }
.lm-dev-row { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 4px; align-items: center; }
.lm-dev-btn { min-height: 40px; padding: 0 12px; border-radius: 4px; cursor: pointer; font: inherit;
  color: #d7f5e6; background: rgba(28, 56, 44, 0.95); border: 1px solid rgba(125, 255, 176, 0.35);
  touch-action: manipulation; }
.lm-dev-btn:active { background: #7dffb0; color: #062014; }
.lm-dev-btn.on { background: #2f7a55; border-color: #7dffb0; }
.lm-dev-btn.warn { color: #ffc0c0; border-color: rgba(255, 120, 140, 0.5); background: rgba(60, 22, 30, 0.9); }
.lm-dev-note { color: #86a898; font-size: 11px; margin: 2px 0 6px; white-space: pre-line; }
.lm-dev-num { width: 5em; min-height: 40px; font: inherit; text-align: center; border-radius: 4px;
  color: #fff; background: #0a1a14; border: 1px solid rgba(125, 255, 176, 0.4); }
.lm-dev-status { color: #ffe9a8; margin: 4px 0 8px; min-height: 1.4em; }

/* the reaction log: a small always-on-top feed, not part of the menu */
.lm-rlog { position: fixed; z-index: 79; pointer-events: none; display: none;
  left: calc(8px + var(--lm-sal, 0px)); bottom: calc(40vh + var(--lm-sab, 0px));
  max-width: min(46vw, 420px); font: 11px/1.4 ui-monospace, monospace; }
.lm-rlog.on { display: block; }
.lm-rlog div { color: #ffe9a8; background: rgba(10, 8, 20, 0.72); padding: 1px 6px; margin-top: 2px;
  border-left: 2px solid #ffd15a; border-radius: 2px; animation: lm-rlog-in 160ms ease both; }
@keyframes lm-rlog-in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
`;

export interface DevOption {
  id: string;
  label: string;
}

/**
 * What an action answers: a line for the status bar, now or once the server has replied. Every
 * action that changes anything goes through the server first (`POST /dev/action`).
 */
export type Reply = string | Promise<string>;

/** Everything the menu can do. Implemented in `render3d/DevTools.ts`, against the live game. */
export interface DevActions {
  items(): { id: string; name: string; kind: string }[];
  rarities(): DevOption[];
  giveItem(id: string, rarity: string, count: number): Reply;
  giveAllCores(): Reply;
  giveKit(): Reply;
  giveCoins(n: number): Reply;

  elements(): { id: string; name: string; unlocked: boolean }[];
  unlockAllElements(): Reply;
  primary(): string | null;
  secondary(): string | null;
  setElement(slot: 'primary' | 'secondary', id: string | null): Reply;

  level(): { level: number; exp: number; need: number };
  setLevel(level: number): Reply;
  addExp(n: number): Reply;

  spawn(kind: 'slime' | 'archer' | 'bat' | 'boss' | 'dummy'): Reply;
  clearSpawns(): Reply;

  teleports(): DevOption[];
  teleport(id: string): Reply;

  setTime(which: 'pagi' | 'siang' | 'sore' | 'malam'): Reply;
  weathers(): DevOption[];
  weather(): string;
  /** A weather id, or 'petir' for one lightning strike now. */
  setWeather(id: string): Reply;
  /** World events: every one by id, which is running, and start / end. */
  worldEvents(): DevOption[];
  activeEvent(): string | null;
  startEvent(id: string | null): Reply;

  godMode(): boolean;
  setGodMode(on: boolean): Reply;
  heal(): Reply;
  resetCutscenes(): Reply;
  resetSave(): Reply;
  /** Stats a developer may set freely (on top of level and gear). */
  stats(): Record<string, number>;
  setStats(stats: Record<string, number>): Reply;
}

type Section = 'item' | 'elemen' | 'level' | 'musuh' | 'teleport' | 'dunia' | 'lain';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'item', label: 'Item & Koin' },
  { id: 'elemen', label: 'Elemen' },
  { id: 'level', label: 'Level & EXP' },
  { id: 'musuh', label: 'Musuh & Boneka' },
  { id: 'teleport', label: 'Teleport' },
  { id: 'dunia', label: 'Jam, Cuaca & Event' },
  { id: 'lain', label: 'Lainnya' },
];

const LOG_LINES = 6;

export class DevMenu {
  private root: HTMLDivElement;
  private main: HTMLDivElement;
  private status: HTMLDivElement;
  private tabs = new Map<Section, HTMLButtonElement>();
  private section: Section = 'item';
  private rarity = 'common';
  private open = false;
  private log: HTMLDivElement;
  private logOn = true;

  onToggle: (open: boolean) => void = () => undefined;

  constructor(
    private readonly actions: DevActions,
    parent: HTMLElement = document.body,
  ) {
    injectStyle('lm-ui-dev', CSS);
    this.root = el('div');
    this.root.className = 'lm-dev';
    const wrap = el('div');
    wrap.className = 'lm-dev-wrap';
    const side = el('div');
    side.className = 'lm-dev-side';
    const title = el('div', {}, 'MODE PENGEMBANG');
    title.className = 'lm-dev-title';
    side.appendChild(title);
    for (const s of SECTIONS) {
      const b = el('button', {}, s.label);
      b.className = 'lm-dev-tab';
      onTap(b, () => this.show(s.id));
      this.tabs.set(s.id, b);
      side.appendChild(b);
    }
    const close = el('button', {}, 'TUTUP');
    close.className = 'lm-dev-tab';
    onTap(close, () => this.close());
    side.appendChild(close);

    this.main = el('div');
    this.main.className = 'lm-dev-main';
    this.status = el('div');
    this.status.className = 'lm-dev-status';

    wrap.append(side, this.main);
    this.root.appendChild(wrap);
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) this.root.addEventListener(type, (e) => e.stopPropagation());
    parent.appendChild(this.root);

    this.log = el('div');
    this.log.className = 'lm-rlog on';
    parent.appendChild(this.log);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  openMenu(): void {
    this.open = true;
    this.root.classList.add('on');
    this.render();
    this.onToggle(true);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('on');
    this.onToggle(false);
  }

  /** A reaction fired: "Api + Es → Lebur". Newest at the bottom, oldest dropped. */
  pushReaction(line: string): void {
    if (!this.logOn) return;
    const row = el('div', {}, line);
    this.log.appendChild(row);
    while (this.log.childNodes.length > LOG_LINES) this.log.removeChild(this.log.childNodes[0] as never);
  }

  get reactionLog(): string[] {
    return Array.from(this.log.childNodes as unknown as { textContent: string }[]).map((n) => n.textContent);
  }

  private show(s: Section): void {
    this.section = s;
    this.render();
  }

  private say(text: string): void {
    this.status.textContent = text;
  }

  private btn(label: string, run: () => Reply | void, cls = ''): HTMLButtonElement {
    const b = el('button', {}, label);
    b.className = `lm-dev-btn${cls ? ` ${cls}` : ''}`;
    onTap(b, () => {
      const msg = run();
      if (msg instanceof Promise) {
        // the server decides; say so until it has
        this.say('Menunggu server\u2026');
        void msg.then(
          (text) => {
            this.say(text);
            this.render();
          },
          () => this.say('Server tidak bisa dihubungi.'),
        );
        return;
      }
      if (msg) this.say(msg);
      this.render();
    });
    return b;
  }

  private h(text: string): HTMLDivElement {
    const d = el('div', {}, text);
    d.className = 'lm-dev-h';
    return d;
  }

  private note(text: string): HTMLDivElement {
    const d = el('div', {}, text);
    d.className = 'lm-dev-note';
    return d;
  }

  private row(...nodes: HTMLElement[]): HTMLDivElement {
    const r = el('div');
    r.className = 'lm-dev-row';
    r.append(...nodes);
    return r;
  }

  render(): void {
    for (const [id, b] of this.tabs) b.classList.toggle('on', id === this.section);
    this.main.innerHTML = '';
    this.main.appendChild(this.status);
    const a = this.actions;
    switch (this.section) {
      case 'item': {
        this.main.appendChild(this.h('CEPAT'));
        this.main.appendChild(this.row(
          this.btn('Semua Inti Lentera', () => a.giveAllCores()),
          this.btn('Set perlengkapan', () => a.giveKit()),
          this.btn('+100 koin', () => a.giveCoins(100)),
          this.btn('+1000 koin', () => a.giveCoins(1000)),
        ));
        this.main.appendChild(this.h('RARITY UNTUK ITEM DI BAWAH'));
        this.main.appendChild(this.row(...a.rarities().map((r) => {
          const b = this.btn(r.label, () => {
            this.rarity = r.id;
            return `Rarity: ${r.label}`;
          });
          b.classList.toggle('on', r.id === this.rarity);
          return b;
        })));
        const groups = new Map<string, { id: string; name: string }[]>();
        for (const it of a.items()) {
          const list = groups.get(it.kind) ?? [];
          list.push(it);
          groups.set(it.kind, list);
        }
        for (const [kind, list] of groups) {
          this.main.appendChild(this.h(kind.toUpperCase()));
          this.main.appendChild(this.row(...list.map((it) => this.btn(it.name, () => a.giveItem(it.id, this.rarity, 1)))));
        }
        break;
      }
      case 'elemen': {
        this.main.appendChild(this.row(this.btn('Buka semua elemen', () => a.unlockAllElements())));
        const els = a.elements();
        for (const slot of ['primary', 'secondary'] as const) {
          const current = slot === 'primary' ? a.primary() : a.secondary();
          this.main.appendChild(this.h(slot === 'primary' ? 'PRIMER (senjata)' : 'SEKUNDER (skill)'));
          const buttons = els.filter((e) => e.unlocked).map((e) => {
            const b = this.btn(e.name, () => a.setElement(slot, e.id));
            b.classList.toggle('on', e.id === current);
            return b;
          });
          const none = this.btn('kosong', () => a.setElement(slot, null));
          none.classList.toggle('on', current === null);
          this.main.appendChild(this.row(...buttons, none));
        }
        this.main.appendChild(this.note('Primer dibawa setiap tebasan dan panah; sekunder dibawa Skill.\nPukul boneka latihan untuk melihat statusnya, dan log reaksi muncul di kiri layar.'));
        break;
      }
      case 'level': {
        const lv = a.level();
        this.main.appendChild(this.note(`Sekarang: Level ${lv.level}, EXP ${lv.exp}/${lv.need || '-'}`));
        const input = el('input');
        input.className = 'lm-dev-num';
        input.setAttribute('inputmode', 'numeric');
        input.value = String(lv.level);
        this.main.appendChild(this.h('ATUR LEVEL'));
        this.main.appendChild(this.row(
          input,
          this.btn('Terapkan', () => a.setLevel(Number(input.value))),
          this.btn('Lv 1', () => a.setLevel(1)),
          this.btn('Lv 10', () => a.setLevel(10)),
          this.btn('Lv 30', () => a.setLevel(30)),
        ));
        this.main.appendChild(this.h('TAMBAH EXP'));
        this.main.appendChild(this.row(this.btn('+50', () => a.addExp(50)), this.btn('+500', () => a.addExp(500)), this.btn('+5000', () => a.addExp(5000))));
        const st = a.stats();
        const bump = (id: string, by: number) => (): Reply => a.setStats({ ...st, [id]: (st[id] ?? 0) + by });
        this.main.appendChild(this.h('STATS BEBAS'));
        this.main.appendChild(this.note(`Tambahan di atas level & perlengkapan: ${Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ') || 'tidak ada'}`));
        this.main.appendChild(this.row(
          this.btn('+100 ATK', bump('atk', 100)),
          this.btn('+100 DEF', bump('def', 100)),
          this.btn('+500 HP', bump('maxHp', 500)),
          this.btn('+20 Kritis', bump('crit', 20)),
          this.btn('+50 Kecepatan', bump('speed', 50)),
          this.btn('Reset stats', () => a.setStats({})),
        ));
        break;
      }
      case 'musuh': {
        this.main.appendChild(this.note('Muncul di dekat hero. Yang dimunculkan dari sini tidak dihitung quest dan tidak tersimpan.'));
        this.main.appendChild(this.row(
          this.btn('Lendir', () => a.spawn('slime')),
          this.btn('Pemanah', () => a.spawn('archer')),
          this.btn('Kelelawar x3', () => a.spawn('bat')),
          this.btn('Kolosus (boss)', () => a.spawn('boss')),
          this.btn('Boneka latihan', () => a.spawn('dummy')),
        ));
        this.main.appendChild(this.row(this.btn('Hapus semua yang dimunculkan', () => a.clearSpawns(), 'warn')));
        break;
      }
      case 'teleport': {
        this.main.appendChild(this.row(...a.teleports().map((t) => this.btn(t.label, () => {
          const msg = a.teleport(t.id);
          this.close();
          return msg;
        }))));
        break;
      }
      case 'dunia': {
        this.main.appendChild(this.h('JAM'));
        this.main.appendChild(this.row(
          this.btn('Pagi', () => a.setTime('pagi')),
          this.btn('Siang', () => a.setTime('siang')),
          this.btn('Sore', () => a.setTime('sore')),
          this.btn('Malam', () => a.setTime('malam')),
        ));
        this.main.appendChild(this.h('CUACA'));
        const now = a.weather();
        this.main.appendChild(this.row(...a.weathers().map((w) => {
          const b = this.btn(w.label, () => a.setWeather(w.id));
          b.classList.toggle('on', w.id === now);
          return b;
        })));
        this.main.appendChild(this.row(this.btn('Petir sekarang', () => a.setWeather('petir'))));
        this.main.appendChild(this.note('Hujan membuat genangan yang terisi ± 25 dtk dan mengering ± 60 dtk setelah reda. Badai: petir tiap ± 9 dtk. Angka kabut & hujan ada di Salin laporan. Cuaca juga berubah sendiri saat event Badai, Kabut, atau Purnama berjalan.'));
        this.main.appendChild(this.h('EVENT DUNIA'));
        const running = a.activeEvent();
        this.main.appendChild(this.row(...a.worldEvents().map((w) => {
          const b = this.btn(w.label, () => a.startEvent(w.id));
          b.classList.toggle('on', w.id === running);
          return b;
        }), this.btn('Akhiri event', () => a.startEvent(null))));
        this.main.appendChild(this.note('Event juga muncul sendiri setelah tutorial: dicek tiap 90 detik bermain, peluang 40%.'));
        break;
      }
      case 'lain': {
        const god = a.godMode();
        const godBtn = this.btn(god ? 'Kebal: NYALA' : 'Kebal: mati', () => a.setGodMode(!god));
        godBtn.classList.toggle('on', god);
        const logBtn = this.btn(this.logOn ? 'Log reaksi: NYALA' : 'Log reaksi: mati', () => {
          this.logOn = !this.logOn;
          this.log.classList.toggle('on', this.logOn);
          return this.logOn ? 'Log reaksi dinyalakan' : 'Log reaksi dimatikan';
        });
        logBtn.classList.toggle('on', this.logOn);
        this.main.appendChild(this.row(godBtn, this.btn('Pulihkan HP', () => a.heal()), logBtn));
        this.main.appendChild(this.h('RESET'));
        this.main.appendChild(this.row(
          this.btn('Reset status cutscene', () => a.resetCutscenes()),
          this.btn('Hapus save & mulai ulang', () => a.resetSave(), 'warn'),
        ));
        break;
      }
      default:
        break;
    }
  }

  destroy(): void {
    this.root.remove();
    this.log.remove();
  }
}

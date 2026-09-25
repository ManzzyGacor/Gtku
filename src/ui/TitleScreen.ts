/**
 * The title screen: logo → "Sentuh untuk memulai" → Masuk / Daftar → main menu.
 *
 * A DOM overlay rather than a rendered scene, so the game can decide whether to continue *before*
 * the world is built — which is what lets a loaded save place the hero and the day-night clock
 * correctly on the very first frame. The animated 3D night behind it (`render3d/TitleBackdrop.ts`)
 * arrives with the renderer chunk and fades in underneath; until then this gradient is the sky.
 *
 * **Stages.** The first tap is not decoration: it is the one guaranteed user gesture, and the
 * browser only allows sound and fullscreen inside one. So it starts the theme and asks for
 * fullscreen, and *then* the menu fades in.
 *
 * **An account is required.** There is no guest option. Until the backend of Batch 7 exists the
 * accounts are stored on this phone only, and the register form says so in plain words — including
 * that clearing the browser's data deletes them. There is no way past the login: developer mode
 * belongs to an account the server calls "dev", not to a button on this screen.
 */
import { clearSave, hasSave, setSaveScope } from '../core/save';
// Imported from the engine rather than the barrel on purpose: the barrel pulls in the music and
// ambience schedulers, and the title screen lives in the entry chunk that has to arrive first.
import { unlockAudio } from '../core/audio/engine';
import { NAME_FALLBACK, sanitizeName, settings } from '../core/settings';
import { PASSWORD_RULE, USERNAME_RULE, type AccountSession, type AuthAdapter } from '../core/account/auth';
import { el, injectStyle, onTap } from './dom';

const CSS = `
.lm-title { position: fixed; inset: 0; z-index: 90; display: flex; flex-direction: column;
  align-items: center; justify-content: safe center; gap: 16px; text-align: center; overflow-y: auto;
  padding: calc(10px + var(--lm-sat, 0px)) calc(12px + var(--lm-sar, 0px)) calc(28px + var(--lm-sab, 0px)) calc(12px + var(--lm-sal, 0px));
  box-sizing: border-box;
  background: radial-gradient(120% 90% at 50% 40%, #241c44 0%, #120d22 55%, #08060f 100%);
  font: 14px/1.5 ui-monospace, monospace; color: #e7e0ff; transition: background 1.2s ease; }
/* once the 3D night is running underneath, only a vignette stays so the text keeps its contrast */
.lm-title.has3d { background: radial-gradient(90% 80% at 50% 45%, rgba(8,6,15,0) 30%, rgba(8,6,15,0.55) 75%, rgba(8,6,15,0.85) 100%); }
.lm-title.leaving { animation: lm-title-out 600ms ease forwards; pointer-events: none; }
@keyframes lm-title-out { to { opacity: 0; } }

/* the logo: a small lantern over the two words, glowing and breathing */
.lm-title-logo { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.lm-title-lamp { width: 18px; height: 22px; border-radius: 3px; background: #ffe066;
  box-shadow: 0 0 14px 5px rgba(255,190,90,0.75), 0 0 48px 16px rgba(255,150,60,0.35);
  border-top: 5px solid #4a4e6f; border-bottom: 4px solid #4a4e6f; animation: lm-lamp 2.8s ease-in-out infinite; }
@keyframes lm-lamp { 0%,100% { filter: brightness(1); } 45% { filter: brightness(1.25); } 60% { filter: brightness(0.9); } }
.lm-title-name { font-size: clamp(30px, 8vw, 62px); letter-spacing: 6px; line-height: 1.05; }
.lm-title-name span { display: block; }
.lm-title-name .a { color: #ffd98a; text-shadow: 0 0 18px rgba(255,190,90,0.55); }
.lm-title-name .b { color: #a795ff; text-shadow: 0 0 18px rgba(140,110,255,0.45); }
.lm-title-sub { color: #d9cfff; opacity: 0.85; }
/* a boot failure needs its message readable, wrapped, and selectable so it can be copied */
.lm-title-status { color: #ffc0c0; white-space: pre-wrap; max-width: min(90vw, 620px);
  font-size: 11px; line-height: 1.5; user-select: text; -webkit-user-select: text; }

/* stage 1: tap to start */
.lm-title-gate { letter-spacing: 4px; color: #ffe9b8; animation: lm-pulse 1.8s ease-in-out infinite; padding: 14px 24px; }
@keyframes lm-pulse { 0%,100% { opacity: 0.45; } 50% { opacity: 1; } }

/* stage 2 and 3 fade in the same way */
.lm-title-stage { display: none; flex-direction: column; gap: 9px; align-items: center; animation: lm-rise-in 380ms ease both; }
.lm-title-stage.on { display: flex; }
.lm-title-menu { width: min(260px, 70vw); }
.lm-title-acct { font-size: 11px; color: #a79dc4; }
.lm-title-acct b { color: #ffd98a; font-weight: normal; }
.lm-title-btn { padding: 11px 14px; min-height: 44px; font: inherit; letter-spacing: 2px; cursor: pointer;
  color: #f2e2c2; border-radius: 5px; touch-action: manipulation; width: 100%;
  background: linear-gradient(180deg, rgba(58,47,94,0.9), rgba(26,20,48,0.9));
  border: 1px solid rgba(255,217,138,0.45); }
.lm-title-btn:active { background: #ffb82e; color: #1a1430; }
.lm-title-btn:disabled { opacity: 0.5; }
.lm-title-btn.ghost { border-color: rgba(154,140,214,0.4); color: #b9b0d8; }
.lm-title-btn.dev { border-color: #7dffb0; color: #7dffb0; background: rgba(8,26,18,0.85); }
.lm-title-link { background: none; border: 0; color: #a795ff; font: inherit; font-size: 12px; cursor: pointer;
  min-height: 40px; text-decoration: underline; touch-action: manipulation; }
.lm-title-foot { font-size: 11px; color: #8189a8; padding: 0 16px; }

/* the account form */
.lm-title-auth { width: min(340px, 86vw); }
.lm-title-auth h2 { margin: 0; font-size: 13px; letter-spacing: 3px; color: #ffd98a; font-weight: normal; }
.lm-title-field { width: 100%; display: flex; flex-direction: column; gap: 3px; text-align: left; font-size: 11px; color: #a79dc4; }
.lm-title-input { width: 100%; box-sizing: border-box; min-height: 44px; padding: 0 12px; font: inherit;
  font-size: 15px; letter-spacing: 1px; border-radius: 5px; color: #fff8e6;
  background: rgba(12,9,26,0.9); border: 1px solid rgba(255,217,138,0.5); }
.lm-title-err { min-height: 1.4em; color: #ff9a8a; font-size: 12px; }
.lm-title-warn { text-align: left; font-size: 11px; line-height: 1.5; color: #ffe0a8; padding: 8px 10px;
  border-radius: 5px; background: rgba(70,44,10,0.75); border: 1px solid rgba(255,176,74,0.6); }
.lm-title-note { font-size: 10.5px; color: #8189a8; }

/* naming the character, asked once at New Game */
.lm-title-name-ask { width: min(300px, 80vw); }
.lm-title-name-ask .lm-title-input { text-align: center; letter-spacing: 2px; }
/* Akun / Kredit: a panel that slides up over the menu */
.lm-title-panel { display: none; flex-direction: column; gap: 12px; align-items: center;
  width: min(560px, 86vw); padding: 14px 16px; border-radius: 6px; text-align: left;
  background: rgba(14,10,28,0.92); border: 1px solid rgba(154,140,214,0.4);
  animation: lm-rise-in 220ms ease both; }
.lm-title-panel.on { display: flex; }
.lm-title-panel-body { white-space: pre-line; color: #d9cfff; font-size: 12px; line-height: 1.6; }
@keyframes lm-rise-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
/* a few embers drifting up, so the screen is not static even before the 3D night arrives */
.lm-ember { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: #ffb04a;
  animation: lm-rise linear infinite; opacity: 0; pointer-events: none; }
@keyframes lm-rise {
  0% { transform: translateY(0); opacity: 0; }
  20% { opacity: 0.9; }
  100% { transform: translateY(-60vh); opacity: 0; }
}
`;

export interface TitleChoice {
  /** True when the player asked to continue a save. */
  continueGame: boolean;
}

export interface TitleHooks {
  /** Open the settings overlay (the same one the gear opens in game). */
  settings?(): void;
  /**
   * Where accounts live. `null` means this browser cannot keep one safely (no Web Crypto — an
   * http:// page, for one); the screen says so instead of storing a password badly.
   */
  auth?: AuthAdapter | null;
  /** The first tap: the one guaranteed user gesture, for the theme music and fullscreen. */
  started?(): void;
  /**
   * Logged in (or out). The game files saves under this account — and a server account connects
   * first. A string back means "the server ended this session": the login form comes back with it.
   */
  account?(session: AccountSession | null): void | Promise<void | string>;
}

type Stage = 'gate' | 'auth' | 'menu' | 'name' | 'busy';

export class TitleScreen {
  private root: HTMLDivElement;
  private resolve: ((c: TitleChoice) => void) | null = null;
  private stage: Stage = 'gate';
  private gate: HTMLDivElement;
  private authBox: HTMLDivElement;
  private menu: HTMLDivElement;
  private nameBox: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private panel: HTMLDivElement;
  private status: HTMLDivElement | null = null;
  private session: AccountSession | null = null;
  private confirmed = false;

  constructor(parent: HTMLElement = document.body, private readonly hooks: TitleHooks = {}) {
    injectStyle('lm-ui-title', CSS);
    this.root = el('div');
    this.root.className = 'lm-title';

    const logo = el('div');
    logo.className = 'lm-title-logo';
    const lamp = el('div');
    lamp.className = 'lm-title-lamp';
    const name = el('div');
    name.className = 'lm-title-name';
    const a = el('span', {}, 'LENTERA');
    a.className = 'a';
    const b = el('span', {}, 'MALAM');
    b.className = 'b';
    name.append(a, b);
    logo.append(lamp, name);

    const sub = el('div', {}, 'Nyalakan kembali cahaya desa');
    sub.className = 'lm-title-sub';

    this.gate = el('div', {}, 'SENTUH UNTUK MEMULAI');
    this.gate.className = 'lm-title-gate';

    this.authBox = el('div');
    this.authBox.className = 'lm-title-stage lm-title-auth';
    this.menu = el('div');
    this.menu.className = 'lm-title-stage lm-title-menu';

    /*
     * Naming the character.
     *
     * Asked here rather than in a menu because this is the one moment it belongs to: a new game.
     * The story's script calls the hero Arka, but every line is written with `{nama}`, so whatever
     * is typed here is what the opening cutscene says. Skipping is allowed — "Pengembara" is a
     * perfectly good name for someone who will not say his own.
     */
    this.nameBox = el('div');
    this.nameBox.className = 'lm-title-stage lm-title-name-ask';
    const prompt = el('div', {}, 'Siapa namamu?');
    prompt.className = 'lm-title-sub';
    this.nameInput = el('input');
    this.nameInput.className = 'lm-title-input';
    this.nameInput.setAttribute('maxlength', '14');
    this.nameInput.setAttribute('placeholder', NAME_FALLBACK);
    this.nameInput.setAttribute('autocomplete', 'off');
    this.nameInput.value = settings.get('playerName');
    const go = el('button', {}, 'MULAI');
    go.className = 'lm-title-btn';
    onTap(go, () => this.confirmName());
    this.nameInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.confirmName();
    });
    this.nameBox.append(prompt, this.nameInput, go);

    const foot = el('div', {}, 'Sentuh: joystick kiri, tombol kanan  |  Keyboard: WASD, J tebas, K geser, Q ganti senjata, E bicara');
    foot.className = 'lm-title-foot';

    for (let i = 0; i < 14; i++) {
      const ember = el('div');
      ember.className = 'lm-ember';
      ember.style.left = `${5 + Math.random() * 90}%`;
      ember.style.bottom = `${Math.random() * 30}%`;
      ember.style.animationDuration = `${5 + Math.random() * 7}s`;
      ember.style.animationDelay = `${Math.random() * 6}s`;
      this.root.appendChild(ember);
    }

    this.panel = el('div');
    this.panel.className = 'lm-title-panel';
    this.root.append(logo, sub, this.gate, this.authBox, this.menu, this.nameBox, this.panel, foot);
    parent.appendChild(this.root);

    /*
     * The whole screen is the start button while the gate is up. A plain listener, not `onTap`:
     * that one cancels the event, and later on this same root holds text fields a tap must reach.
     */
    this.root.addEventListener('pointerup', () => {
      if (this.stage === 'gate') this.start();
    });
  }

  /** Which stage is showing — for tests and for the renderer that paints the backdrop. */
  get currentStage(): Stage {
    return this.stage;
  }

  /** The 3D night is running underneath: let it show through. */
  setBackdrop(on: boolean): void {
    this.root.classList.toggle('has3d', on);
  }

  private setStage(stage: Stage): void {
    this.stage = stage;
    this.gate.style.display = stage === 'gate' ? 'block' : 'none';
    this.authBox.classList.toggle('on', stage === 'auth');
    this.menu.classList.toggle('on', stage === 'menu');
    this.nameBox.classList.toggle('on', stage === 'name');
    if (stage !== 'menu') this.panel.classList.remove('on');
  }

  /** The first tap: sound, fullscreen, then the account (or straight to the menu if remembered). */
  start(): void {
    if (this.stage !== 'gate') return;
    unlockAudio();
    this.hooks.started?.();
    const remembered = this.hooks.auth?.current() ?? null;
    if (remembered) this.enter(remembered);
    else this.showAuth(false);
  }

  // ───────────────────────── account ─────────────────────────

  private showAuth(register: boolean, error = ''): void {
    const box = this.authBox;
    box.innerHTML = '';
    const auth = this.hooks.auth;
    const head = el('h2', {}, register ? 'DAFTAR AKUN' : 'MASUK');
    box.appendChild(head);

    if (!auth) {
      const msg = el(
        'div',
        {},
        'Browser ini tidak bisa menyimpan akun dengan aman (butuh halaman HTTPS dan Web Crypto). ' +
          'Buka game lewat alamat https:// untuk masuk atau mendaftar.',
      );
      msg.className = 'lm-title-warn';
      box.appendChild(msg);
      this.setStage('auth');
      return;
    }

    if (register && auth.kind === 'local') {
      /*
       * The honesty the plan asks for, where it matters: before the player invents a password.
       * Not in small print, and not "secure account".
       */
      const warn = el(
        'div',
        {},
        '⚠ Akun ini hanya tersimpan di PERANGKAT INI. Belum ada server: akun dan progresmu akan hilang ' +
          'kalau data browser atau situs dibersihkan, dan tidak bisa dipakai di HP lain.\n' +
          'Kata sandi disimpan sebagai hash, bukan teks asli — tetap jangan pakai kata sandi yang sama dengan akun pentingmu.',
      );
      warn.className = 'lm-title-warn';
      warn.style.whiteSpace = 'pre-line';
      box.appendChild(warn);
    }

    const field = (label: string, type: string, auto: string): HTMLInputElement => {
      const wrap = el('label');
      wrap.className = 'lm-title-field';
      wrap.appendChild(el('span', {}, label));
      const input = el('input');
      input.className = 'lm-title-input';
      input.setAttribute('type', type);
      input.setAttribute('autocomplete', auto);
      input.setAttribute('autocapitalize', 'none');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('maxlength', type === 'password' ? '256' : '20');
      wrap.appendChild(input);
      box.appendChild(wrap);
      return input;
    };
    const user = field('Nama akun', 'text', 'username');
    if (register && auth.checkUsername) {
      // tell them the name is taken before they invent a password for it
      const hint = el('div', {}, '');
      hint.className = 'lm-title-note';
      box.appendChild(hint);
      const check = auth.checkUsername.bind(auth);
      user.addEventListener('blur', () => {
        const name = user.value.trim();
        if (!name) return;
        hint.textContent = 'Memeriksa nama\u2026';
        void check(name).then((r) => {
          if (user.value.trim() !== name) return;
          hint.textContent = r.message;
          hint.style.color = r.available ? '#9be59b' : '#ff9a8a';
        });
      });
    }
    const pass = field('Kata sandi', 'password', register ? 'new-password' : 'current-password');
    const again = register ? field('Ulangi kata sandi', 'password', 'new-password') : null;
    // only a server can use an email (to reset a forgotten password); a local account has no use for one
    const email = register && auth.kind === 'remote' ? field('Email (opsional, untuk lupa sandi)', 'email', 'email') : null;
    if (register) {
      const rules = el('div', {}, `${USERNAME_RULE} ${PASSWORD_RULE}`);
      rules.className = 'lm-title-note';
      box.appendChild(rules);
    }

    const err = el('div', {}, error);
    err.className = 'lm-title-err';
    const submit = el('button', {}, register ? 'DAFTAR' : 'MASUK');
    submit.className = 'lm-title-btn';
    const send = async (): Promise<void> => {
      if (submit.disabled) return;
      if (again && again.value !== pass.value) {
        err.textContent = 'Kedua kata sandi tidak sama.';
        return;
      }
      submit.disabled = true;
      err.textContent = register ? 'Membuat akun…' : 'Memeriksa…';
      const result = register ? await auth.register(user.value, pass.value, email?.value) : await auth.login(user.value, pass.value);
      submit.disabled = false;
      if (!result.ok) {
        err.textContent = result.message;
        pass.value = '';
        if (again) again.value = '';
        return;
      }
      this.enter(result.session);
    };
    onTap(submit, () => void send());
    for (const input of [user, pass, again]) {
      input?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') void send();
      });
    }
    const swap = el('button', {}, register ? 'Sudah punya akun? MASUK' : 'Belum punya akun? DAFTAR');
    swap.className = 'lm-title-link';
    onTap(swap, () => this.showAuth(!register));
    const where = el(
      'div',
      {},
      auth.kind === 'local'
        ? 'Akun tersimpan di perangkat ini saja (mode tes tanpa server).'
        : 'Akun tersimpan di server Lentera Malam; progres disinkronkan. Tetap bisa main saat offline.',
    );
    where.className = 'lm-title-note';
    box.append(err, submit, swap, where);
    this.setStage('auth');
  }

  /** Logged in: file saves under the account, show the menu. */
  private enter(session: AccountSession | null): void {
    this.session = session;
    setSaveScope(session?.id ?? null);
    const pending = this.hooks.account?.(session);
    if (pending instanceof Promise) {
      // a server account fetches its save first, so "Lanjutkan" knows what there is to continue
      this.setBusy('Menghubungkan ke server\u2026');
      const done = (relogin: string | void): void => {
        this.status?.remove();
        this.status = null;
        if (typeof relogin === 'string') {
          this.session = null;
          setSaveScope(null);
          this.showAuth(false, relogin);
          return;
        }
        this.buildMenu();
        this.setStage('menu');
      };
      // whatever happens on the network, the player ends up somewhere they can act
      void pending.then(done, () => done(undefined));
      return;
    }
    this.buildMenu();
    this.setStage('menu');
  }

  private async logout(): Promise<void> {
    await this.hooks.auth?.logout();
    this.session = null;
    setSaveScope(null);
    this.hooks.account?.(null);
    this.showAuth(false);
  }

  // ───────────────────────── menu ─────────────────────────

  /** Built on entering, because whether there is a save depends on whose account it is. */
  private buildMenu(): void {
    const menu = this.menu;
    menu.innerHTML = '';
    this.confirmed = false;
    const who = el('div');
    who.className = 'lm-title-acct';
    if (this.session) {
      who.appendChild(el('span', {}, 'Akun: '));
      who.appendChild(el('b', {}, this.session.name));
      who.appendChild(el('span', {}, this.session.kind === 'local' ? ' · di perangkat ini' : ' · tersambung'));
    } else {
      who.appendChild(el('span', {}, 'Belum masuk'));
    }
    menu.appendChild(who);

    const saved = hasSave();
    if (saved) {
      const cont = el('button', {}, 'LANJUTKAN');
      cont.className = 'lm-title-btn';
      onTap(cont, () => this.pick(true));
      menu.appendChild(cont);
    }
    const fresh = el('button', {}, 'MAIN BARU');
    fresh.className = `lm-title-btn${saved ? ' ghost' : ''}`;
    onTap(fresh, () => {
      if (saved && !this.confirmed) {
        this.confirmed = true;
        fresh.textContent = 'HAPUS SAVE & MULAI?';
        return;
      }
      clearSave();
      this.askName();
    });
    menu.appendChild(fresh);

    const settingsBtn = el('button', {}, 'PENGATURAN');
    settingsBtn.className = 'lm-title-btn ghost';
    onTap(settingsBtn, () => {
      unlockAudio();
      this.hooks.settings?.();
    });
    menu.appendChild(settingsBtn);

    const account = el('button', {}, 'AKUN');
    account.className = 'lm-title-btn ghost';
    onTap(account, () => this.showAccount());
    menu.appendChild(account);

    const credits = el('button', {}, 'KREDIT');
    credits.className = 'lm-title-btn ghost';
    onTap(credits, () => {
      this.showPanel(
        'KREDIT',
        'LENTERA MALAM\n\n' +
          'Kode, desain, dan seluruh pixel art dibuat khusus untuk proyek ini.\n' +
          'Semua gambar dihasilkan dari kode (src/art) dengan palet original.\n' +
          'Musik dan efek suara disintesis WebAudio (src/core/audio).\n' +
          'Cerita, nama, dan karakter original — naskahnya di docs/STORY.md.\n\n' +
          'Library: Three.js (MIT), TypeScript, Vite.\n' +
          'Belum ada aset pihak ketiga. Daftar lengkapnya di CREDITS.md.',
      );
    });
    menu.appendChild(credits);
  }

  private showAccount(): void {
    const s = this.session;
    const body = s
      ? `Nama akun: ${s.name}\nTersimpan: ${s.kind === 'local' ? 'di perangkat ini saja' : 'di server'}\n\n` +
        (s.kind === 'local'
          ? 'Belum ada server. Akun dan progresmu hilang kalau data browser dibersihkan, dan belum bisa dipindah ke HP lain. ' +
            'Sinkronisasi ke server direncanakan (docs/BACKEND.md).'
          : 'Progresmu disinkronkan ke server.')
      : 'Belum masuk.';
    this.showPanel('AKUN', body, [{ label: s ? 'KELUAR AKUN' : 'MASUK / DAFTAR', run: () => void this.logout() }]);
  }

  /** A simple text panel over the menu, for Akun and Kredit. */
  private showPanel(title: string, body: string, actions: { label: string; run: () => void }[] = []): void {
    this.menu.classList.remove('on');
    this.panel.innerHTML = '';
    const h = el('div', {}, title);
    h.className = 'lm-title-sub';
    h.style.color = '#ffd98a';
    h.style.letterSpacing = '3px';
    const text = el('div', {}, body);
    text.className = 'lm-title-panel-body';
    this.panel.append(h, text);
    for (const act of actions) {
      const btn = el('button', {}, act.label);
      btn.className = 'lm-title-btn';
      onTap(btn, () => {
        this.panel.classList.remove('on');
        act.run();
      });
      this.panel.appendChild(btn);
    }
    const back = el('button', {}, 'KEMBALI');
    back.className = 'lm-title-btn ghost';
    onTap(back, () => {
      this.panel.classList.remove('on');
      this.menu.classList.add('on');
    });
    this.panel.appendChild(back);
    this.panel.classList.add('on');
  }

  private askName(): void {
    this.setStage('name');
    // focus is best-effort: some mobile browsers refuse it outside a direct gesture
    try {
      this.nameInput.focus();
    } catch {
      /* ignore */
    }
  }

  private confirmName(): void {
    settings.set('playerName', sanitizeName(this.nameInput.value));
    this.pick(false);
  }

  private pick(continueGame: boolean): void {
    // the tap that dismisses the title is also the gesture that lets audio start
    unlockAudio();
    // The screen stays up until the world is ready: the renderer is a separate chunk, and a black
    // screen while it arrives reads as a crash.
    this.setStage('busy');
    this.resolve?.({ continueGame });
    this.resolve = null;
  }

  /** Replace the menu with a line of status text (loading the world, or failing to). */
  setBusy(text: string): void {
    this.setStage('busy');
    if (!this.status) {
      this.status = el('div');
      this.status.className = 'lm-title-sub lm-title-status';
      this.root.appendChild(this.status);
    }
    this.status.textContent = text;
  }

  /** Take the title down with a fade, once there is something behind it. */
  close(): void {
    this.root.classList.add('leaving');
    setTimeout(() => this.root.remove(), 650);
  }

  /** Resolves once the player has chosen. */
  choice(): Promise<TitleChoice> {
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  destroy(): void {
    this.root.remove();
  }
}

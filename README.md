# Lentera Malam

Open-world action RPG **3D pixel-art** (Three.js). Semua karakter, nama, cerita, dan aset **original**;
seluruh pixel art, geometri, musik, dan efek suara dihasilkan lewat kode. Dirancang untuk browser
HP Android (landscape); keyboard tetap didukung.

Rencana induk dan urutan batch: [`docs/OVERHAUL.md`](docs/OVERHAUL.md) (Batch 0–7 selesai). Naskah
cerita: [`docs/STORY.md`](docs/STORY.md). Status pekerjaan dan cara mengetesnya:
[`docs/PROGRESS.md`](docs/PROGRESS.md). Desain server: [`docs/BACKEND.md`](docs/BACKEND.md).

## Memulai

1. Buka game → **Sentuh untuk memulai** (musik tema mulai, dan game meminta layar penuh; kalau
   browser menolak, ketuk tombol **⛶ Layar Penuh** di atas).
2. **Masuk** atau **Daftar** (wajib). Akun disimpan di server Lentera Malam (`https://api.varesa.mom`,
   kode di `server/`); progres disinkronkan, dan game tetap bisa dimainkan offline dari save di HP.
   Kalau server tidak bisa dihubungi, layar mengatakannya. Nama akun 3–16 huruf/angka/`_`.
3. Menu: Lanjutkan · Main Baru · Pengaturan · Akun · Kredit.

## Cara main

| Aksi | Sentuh (HP) | Keyboard |
| --- | --- | --- |
| Jalan 8 arah | Joystick kiri bawah (posisi tetap; atur di Pengaturan) | `WASD` / panah |
| Serang / kombo (tahan = serangan berat) | Tombol **TEBAS** (berubah jadi **PANAH** saat busur dipegang) | `J` / `Z` / `Spasi` |
| Tarik busur | Tahan tombol serang saat busur dipegang | tahan `J` |
| Berguling (kebal sesaat) | **GESER** | `K` / `X` / `Shift` |
| Skill *Ledakan Lentera* (membawa elemen sekunder) | **SKILL** | `L` / `C` |
| Ganti senjata | Tombol di atas TEBAS (menyebut senjata tujuan) | `1` / `2` / `Q` |
| Bicara · Baca · Buka · Berdoa | Tombol yang **muncul saat dekat** objek, labelnya sesuai objek | `E` / `Enter` |
| Karakter & tas | Tombol 🎒 (kanan atas) | `I` / `Tab` |
| Menu jeda | Tombol ☰ (kanan atas) | `Esc` / `P` |
| Pengaturan | Tombol ⚙ (kanan atas) | `Esc` di layar judul |
| Dagang (event Pedagang Keliling) | Tombol **Dagang** saat dekat pedagang | `E` |

**Awal permainan:** setelah prolog, berdoa di shrine Ravenhollow (di plaza, satu langkah dari titik
mulai) untuk mendapat **Inti Bara** dan elemen **Api**, lalu coba pada boneka latihan di sebelah timur
shrine. Setelah itu quest utama: bicara dengan tetua di plaza.

**World event** muncul sendiri setelah tutorial (dicek tiap 90 detik bermain): Invasi Monster,
Badai Elemen, Kabut Misterius, Pedagang Keliling (belanja dengan koin), Malam Purnama. Baris event
tampil di bawah objektif.

## Mode Pengembang

Hanya untuk akun **`manzzy`**, yang perannya `dev` di database — **ditentukan server**. Masuk sebagai
`manzzy` → tombol **DEV** hijau di kanan atas dan penanda **DEV** di HUD muncul sendiri. Akun lain
tidak melihat apa pun dari panel itu, dan tidak ada jalan lain untuk membukanya (`?debug=1`, ketuk
versi, dan lewati-login sudah dihapus).

Isinya: semua item/perlengkapan/senjata/Inti Lentera/elemen, atur level, EXP, koin, dan stats bebas,
mode kebal, teleport, jam & cuaca, munculkan musuh dan boneka latihan, log reaksi elemen, event dunia,
reset save dan status cutscene. **Setiap aksi dijalankan atau disetujui server** dan dicatat di log
server; save akun pengembang ditandai `devSave` supaya tidak bercampur dengan progres normal.

Akun `manzzy` dibuat dari VPS: `cd server && npm run create-dev-account`. Nama itu (dan `admin`,
`dev`, `moderator`, `gm`, `system`) tidak bisa didaftarkan dari game. Detail: `docs/BACKEND.md` §5.

## Menjalankan

```bash
npm install
npm run dev      # Vite di 127.0.0.1:5173 (di server ini dibuka lewat https://game.varesa.mom)
npm run build    # typecheck + lint + build produksi ke dist/
npm test         # Vitest: logika inti, playthrough headless, Game3D asli dengan WebGL stub, tata letak
npm run lint     # oxlint
```

Parameter URL: `?fps=1` (penghitung FPS), `?bloom=0`, `?preset=vlow|low|medium|high|ultra`.

Variabel build: `VITE_API_URL` (bawaan `https://api.varesa.mom`; `local` = akun hanya di HP untuk
tes tanpa server).

### Server akun

```bash
cd server && npm install
cp .env.example .env && chmod 600 .env   # isi MONGODB_URI dan JWT_SECRET di server, jangan di-commit
tmux new-session -d -s api -c "$PWD" "npm start"   # 127.0.0.1:3000 → Cloudflare Tunnel api.varesa.mom
```

Detail, endpoint, keamanan, dan langkah Cloudflare: [`docs/BACKEND.md`](docs/BACKEND.md).

## Dokumentasi

- `docs/OVERHAUL.md` — rencana induk & urutan batch
- `docs/STORY.md` — naskah (nama tokoh utama diambil dari setelan pemain)
- `docs/PROGRESS.md` — status fitur, bug yang ditemukan, cara mengetes di HP
- `docs/GAME_DESIGN.md` — ringkasan desain
- `docs/BACKEND.md` — API akun & save, keamanan, rencana penerapan server
- `CLAUDE.md` — stack, struktur folder, konvensi (untuk sesi pengembangan berikutnya)
- `CREDITS.md` — kredit aset & library

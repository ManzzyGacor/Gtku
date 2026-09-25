# Lentera Malam

Open-world action RPG **3D pixel-art** (Three.js). Semua karakter, nama, cerita, dan aset **original**;
seluruh pixel art, geometri, musik, dan efek suara dihasilkan lewat kode. Dirancang untuk browser
HP Android (landscape); keyboard tetap didukung.

Rencana induk dan urutan batch: [`docs/OVERHAUL.md`](docs/OVERHAUL.md). Naskah cerita:
[`docs/STORY.md`](docs/STORY.md). Status pekerjaan dan cara mengetesnya: [`docs/PROGRESS.md`](docs/PROGRESS.md).

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
| Pengaturan | Tombol ⚙ (kanan atas) | — |

**Awal permainan:** setelah prolog, berdoa di shrine Ravenhollow (di plaza, satu langkah dari titik
mulai) untuk mendapat **Inti Bara** dan elemen **Api**, lalu coba pada boneka latihan di sebelah timur
shrine. Setelah itu quest utama: bicara dengan tetua di plaza.

## Mode Pengembang

Menu untuk mengetes tanpa harus memainkan seluruh game: memberi item/Inti Lentera/koin, membuka
keempat elemen dan mengatur elemen primer & sekunder, mengatur level & EXP, memunculkan tiap jenis
musuh dan boneka latihan, log reaksi elemen di layar, teleport ke setiap area & tempat penting
(termasuk tiap peti), mengatur jam & cuaca, mode kebal, reset status cutscene, dan hapus save.

**Cara membuka** (salah satu):

1. Tambahkan **`?debug=1`** di URL, misalnya `https://game.varesa.mom/?debug=1` — menu langsung terbuka.
2. Buka **Pengaturan** (⚙), gulir ke paling bawah, lalu **ketuk nomor versi 5 kali dengan cepat**
   (setelah ketukan kedua muncul hitungan mundur "3 lagi…").

Setelah terbuka sekali, tombol **DEV** hijau muncul di kanan atas dan tetap ada setelah reload.
Selama menu terbuka, dunia berhenti. Musuh yang dimunculkan dari menu **tidak** dihitung quest dan
**tidak** tersimpan.

**Tidak pernah ada di build rilis.** Pintu masuknya memakai `import.meta.env.DEV`, yang diganti
menjadi `false` oleh `vite build`, sehingga kode menunya bahkan tidak ikut dibangun — bukan
disembunyikan, tapi tidak ada. `tests/devmode.test.ts` membangun versi rilis sungguhan dan memeriksa
bahwa tidak ada potongan menu pengembang di dalamnya. Untuk build staging yang sengaja membawanya:
`VITE_DEV_TOOLS=1 npm run build`.

## Menjalankan

```bash
npm install
npm run dev      # Vite di 127.0.0.1:5173 (di server ini dibuka lewat https://game.varesa.mom)
npm run build    # typecheck + lint + build produksi ke dist/
npm test         # Vitest: logika inti, playthrough headless, Game3D asli dengan WebGL stub, tata letak
npm run lint     # oxlint
```

Parameter URL: `?fps=1` (penghitung FPS), `?bloom=0`, `?preset=vlow|low|medium|high|ultra`,
`?debug=1` (Mode Pengembang, hanya build pengembangan).

## Dokumentasi

- `docs/OVERHAUL.md` — rencana induk & urutan batch
- `docs/STORY.md` — naskah (nama tokoh utama diambil dari setelan pemain)
- `docs/PROGRESS.md` — status fitur, bug yang ditemukan, cara mengetes di HP
- `docs/GAME_DESIGN.md` — ringkasan desain
- `CLAUDE.md` — stack, struktur folder, konvensi (untuk sesi pengembangan berikutnya)
- `CREDITS.md` — kredit aset & library

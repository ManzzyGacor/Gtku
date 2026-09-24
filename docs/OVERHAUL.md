# Lentera Malam — Rencana Overhaul 3D

> **Dokumen induk.** Ini acuan untuk semua sesi kerja, bukan tugas sekali jalan.
> Pekerjaan dibagi per **BATCH**. Selesai satu batch → berhenti, beri ringkasan, tunggu laporan tes dari HP.
> Nama game: **Lentera Malam** (sebelumnya "Lentera Kelam").
> Jangan membuat project baru. Jangan menghapus sistem yang masih jalan sebelum penggantinya siap.

---

## 1. Visi

Lentera Malam 2D berevolusi menjadi **RPG 3D pixel-art**: open-world action RPG dengan eksplorasi, combat,
elemen, dan dua senjata. Target utama **browser Android mode landscape**; desktop tetap didukung.
Harus terasa sebagai game yang sama, bukan game baru.

**Visual:** geometri low-poly, tekstur pixel-art, rendering pixelated, kamera 3/4 isometrik (sudut tetap,
zoom terbatas). Bukan realistis, bukan voxel ala Minecraft, bukan low-poly generik yang mulus.

Semua aset, nama, dan cerita **original**.

## 2. Batasan lingkungan

- Pengembang bermain/menguji **hanya dari HP Android, tanpa PC**. Jangan merencanakan alat desktop
  (Blender GUI, Tiled). Gamepad bukan prioritas.
- VPS: **RAM 4 GB, tanpa swap, tanpa GPU**. Jangan menjalankan browser headless atau proses berat.
  Script generator aset harus bertahap (streaming/per-file) supaya tidak kehabisan memori.
- Claude **tidak bisa melihat hasil visual**. Semua verifikasi visual dan FPS dilakukan pemain di HP
  lewat alat debug Fase 0.
- Dev server tetap `127.0.0.1:5173`, diakses lewat `https://game.varesa.mom`
  (`allowedHosts`, HMR `wss` port 443), dijalankan di sesi tmux bernama `game`.

## 3. Teknis

- **Renderer:** Three.js + TypeScript + Vite, baseline **WebGL2**. WebGPU opsional nanti dengan fallback WebGL2.
- **Pisahkan GAME LOGIC dari RENDERING.** Quest, stats, inventaris, kalkulasi combat, AI musuh, save,
  world state, dan progresi ada di `src/core/` dan **tidak boleh mengimpor Phaser atau Three.js**.
- **Pipeline pixel:** render scene ke render target resolusi rendah tetap (tinggi ±270–360 px), lalu
  perbesar ke layar dengan nearest-neighbor. Tekstur `NearestFilter`, texel density konsisten.
  Outline tipis lewat post-process yang bisa dimatikan. **Render scale** (performa) adalah pengaturan
  terpisah dari resolusi pixel ini.
- **Aset 3D:** geometri low-poly dibuat prosedural lewat kode; tekstur pixel lewat script generator
  dengan palet konsisten; disimpan sebagai **GLB + atlas PNG/WebP**. Boleh memakai paket low-poly CC0
  (Kenney, Quaternius) dengan mencatat sumber & lisensi di `CREDITS.md`. Folder aset harus mudah
  diganti dengan buatan tangan.
- **Batas ukuran:** data inti ≤ 15 MB, tiap area ≤ 25 MB, tiap file ≤ 20 MB (siap host di Cloudflare Pages).
- **Tes:** **Vitest** untuk logika di `src/core`. Setiap fitur wajib lolos `npm run build` dan `npm test`.

## 4. Sistem game

Detail tiap sistem diputuskan saat fase-nya dikerjakan. Ringkasan target:

**Dunia.** Desa Lentera, Hutan Bisik, Gua Kelam dulu (Batch 2: 256x128 tile, ~3x per area). Area berikutnya disiapkan sebagai *slot data* saja:
Pantai Senja, Rawa Kelam, Pegunungan Arunika, Lembah Kabut, Hutan Purba, Kota Tua, Gurun Bara,
Kepulauan Lentera, Ruins, dungeon rahasia.

**Lingkungan hidup.** Rumput bergerak tertiup angin dan tersibak saat dilewati player — dianimasikan di
**shader dengan instancing**, bukan loop JS per helai. Daun dan bunga bergoyang, air beriak dengan
pantulan sederhana, api dan lentera berkedip dengan partikel, kabut bergerak, kunang-kunang beterbangan.
Semua gerakan halus dan tidak serempak.

**Atmosfer.** Siang hangat, sore keemasan, malam biru gelap dengan lentera dan jendela menyala,
dungeon ungu kebiruan dengan obor dan kristal bercahaya.

**Elemen.** Semua elemen didefinisikan di data: Fajar, Api, Air, Angin, Tanah, Petir, Es, Bayangan,
Cahaya, Astral, Kabut, Kristal, Alam, Roh, Void. Yang diimplementasikan penuh dulu **empat**:
Api, Air, Es, Petir. Tabel reaksi data-driven (Api+rumput terbakar, Api+Es mencair, Air+Petir area
listrik, Es+Air membeku). Elemen dibuka lewat quest, boss, shrine, eksplorasi. Player punya
elemen primer dan sekunder.

**Senjata.** Dua slot aktif yang bisa diganti cepat: tombol `[PEDANG]↔[BUSUR]` di HP, tombol `1`/`2`
di keyboard. Ganti senjata bisa menjadi bagian dari combo. Penuh dulu: **Pedang** (light 1, light 2,
heavy, finisher) dan **Busur** (quick, charged, piercing, elemental arrow). Kategori lain hanya data.

**Stats.** Satu pipeline kalkulasi berbasis modifier untuk player, musuh, dan boss:
`base + senjata + equipment + level + elemen + buff − debuff → final damage`.
Stat dasar, sekunder, dan resistensi (HP, ATK, DEF, crit, elemental mastery, resistensi per elemen, dst)
disimpan sebagai data. **Wajib punya tes.**

**Equipment.** Weapon, Helmet, Armor, Gloves, Boots, Accessory 1–2, **Lantern Core**.
Lantern Core = inti kekuatan MC: bonus elemen, passive, efek visual.
Rarity Common → Mythic **memengaruhi stats**, bukan hanya kosmetik.

**Skill & status.** Skill data-driven (normal, weapon skill, element skill, ultimate, passive).
Status effect: Burn, Freeze, Wet, Shock, Poison, Bleed, Slow, Stun, Root, Blind, Silence, Fear, Mark,
Expose, Shield, Regeneration — masing-masing dengan durasi, batas stack, tick, dan resistensi.

**Progresi.** Level & EXP dari monster, quest, dungeon, boss, eksplorasi. Quest data-driven
(main, side, world, dungeon, boss, exploration) dengan objective, reward, prerequisite, dialog, cutscene.
World event (invasi monster, badai elemen, kabut misterius, pedagang keliling) juga lewat data.

**Cerita.** MC punya ikatan khusus dengan Lentera yang menjaga keseimbangan dunia. Elemen dunia mulai
tidak stabil, monster makin agresif, Lentera utama meredup. Game dibuka dengan cutscene singkat yang
menyedihkan tentang masa lalu MC — sebuah kehilangan yang berhubungan dengan Lentera.
Naskah di `docs/STORY.md`. Lore expandable per chapter.

**Cutscene.** Dijalankan engine (kamera, dialog, animasi, fade, cahaya, partikel, suara), bukan video.
**Selalu ada tombol Skip.**

**Akun (ManzzyCompany).** Login, Register (username, password, konfirmasi password, email opsional),
tombol "Main sebagai Tamu". Lalu pemain membuat nama karakter, bisa diganti lewat Profile.
Data akun dipisah dari data save. Selama backend belum ada: adapter lokal berlabel jelas
**"mode pengembangan"**, jangan diklaim aman, jangan simpan password plaintext.

**Grafik.** Preset **AUTO** (default), Sangat Rendah, Rendah, Sedang, Tinggi, Ultra, plus pengaturan
individual: jarak render, bayangan, tekstur, cahaya, partikel, kepadatan rumput/pohon/NPC, efek, bloom,
AO, air, cuaca, outline pixel, render scale. AUTO memantau FPS lalu menurunkan/menaikkan kualitas
bertahap dengan **cooldown** supaya tidak naik-turun terus. Semua pengaturan tersimpan.

**Streaming & Download Manager.** Data inti diunduh saat game pertama dibuka. Data tiap area diunduh
saat area itu pertama kali dimasuki, dengan UI "Data Dunia Diperlukan" (ukuran + progres).
Simpan di Cache Storage / IndexedDB dengan manifest versi supaya tidak diunduh ulang.
Menu Download Manager menampilkan status tiap area.

**UI.** Modern fantasy RPG, bukan dashboard website. Panel semi-transparan, ikon pixel-art, transisi
singkat dan halus. HUD: kiri atas karakter + HP + energi; kanan atas minimap; tengah atas objektif quest;
kiri bawah joystick; kanan bawah serang/skill/dodge/ganti senjata (senjata aktif di-highlight).
Menu utama: Lanjutkan, Game Baru, Pengaturan, Akun, Kredit.
Menu pause: Lanjut, Inventaris, Karakter, Senjata, Skill, Quest, Peta, Pengaturan, Simpan/Keluar.
Inventaris grid per kategori.

**Save.** Pertahankan autosave; naikkan ke `saveVersion 2` dengan **migrasi dari save lama**.
Cakupan: akun, karakter, dunia, quest, inventaris, equipment, elemen, senjata, pengaturan,
dan status data yang sudah diunduh.

**Audio.** BGM, SFX, ambient, combat, UI. Musik berbeda per area, volume diatur terpisah.

**Performa prioritas.** Frustum culling, instancing, pooling objek & partikel, texture atlas, LOD,
chunk streaming, jumlah cahaya dinamis & bayangan dibatasi.

## 5. Urutan batch

| Batch | Isi | Status |
| --- | --- | --- |
| **1** | Fase 0 (persiapan), Fase 1 (fondasi 3D), Fase 2 (player 3D) | ✅ selesai |
| 2 | Lingkungan desa, cahaya & atmosfer, animasi rumput, air, pohon + perbaikan kamera & perluasan dunia | ✅ selesai |
| 3 | Migrasi combat, dua senjata, sistem elemen (4 elemen) | ✅ selesai |
| 4 | Stats, equipment, Lantern Core, inventaris, progresi | ⬜ |
| 5 | Cutscene pembuka + sistem cutscene, audio, UI/HUD, menu | ⬜ |
| 6 | World streaming, Download Manager, grafik AUTO lengkap | ⬜ |
| 7 | Akun & backend, world event, optimasi performa, dokumentasi akhir | ⬜ |

### Batch 1 — rincian

**Fase 0 — persiapan, tanpa mengubah tampilan.** Versi 2D harus tetap jalan seperti sebelumnya.
1. Audit arsitektur → bagian 6 dokumen ini.
2. Rencana migrasi → bagian 7 dokumen ini.
3. Pindahkan logika game ke `src/core/`.
4. Pasang **Vitest** + tes logika inti.
5. Ganti nama ke **Lentera Malam**.
6. Alat debug: penghitung FPS (lewat menu dan `?fps=1`), panel error, tombol **"Salin laporan"**
   (info perangkat, FPS, preset, error terakhir).

**Fase 1 — fondasi 3D.**
1. Renderer Three.js dengan pipeline pixel (render target resolusi rendah → nearest upscale).
2. Kamera isometrik 3/4 (sudut tetap, zoom terbatas).
3. Desa Lentera versi sederhana: greybox dengan tekstur pixel.
4. Preset grafik dasar.
5. Versi 2D tetap bisa dibuka lewat `?renderer=2d` sampai versi 3D menyamai fiturnya.

**Fase 2 — player 3D.**
1. Model + animasi dasar.
2. Gerak dengan joystick dan keyboard.
3. Kamera mengikuti.
4. Collision memakai logika yang sudah ada.

## 6. Audit arsitektur (23 September 2026, sebelum migrasi)

Basis kode 2D: **±9.500 baris TypeScript**, 37 file di `src/`. Yang penting: **pemisahan
logika/rendering sudah separuh jalan** — 20 dari 37 file sudah tidak mengimpor Phaser.

### Sudah murni (tanpa import Phaser) — siap dipindah ke `src/core/`

| File | Baris | Isi |
| --- | --- | --- |
| `entities/enemies.ts` | 884 | AI + state machine semua musuh & boss |
| `world/worldgen.ts` | 537 | Generator dunia 3 area, marker, spawn |
| `entities/HeroCore.ts` | 366 | Gerak, kombo, dodge, skill, HP hero |
| `systems/quest.ts` | 152 | Quest state machine + dialog |
| `world/bake.ts` | 107 | Komposisi tile chunk → pixmap |
| `systems/puzzleLogic.ts` | 108 | Puzzle dorong batu |
| `world/collision.ts` | 104 | Grid tabrakan + surface/speed |
| `world/props.ts` | 90 | Definisi prop + light |
| `state/GameState.ts` | 72 | Quest/kill/flag/waktu + serialisasi save |
| `world/source.ts` | 72 | Interface `WorldSource` + `ChunkData` |
| `systems/daynight.ts` | 61 | Siklus siang-malam, ambient |
| `world/areas.ts`, `world/tiles.ts` | 46+ | Batas area, enum tile |
| `systems/interactables.ts` | — | Pencarian interactable terdekat |
| `core/*` | — | `rng`, `save`, `input`, `display`, `errors`, `settings`, `perf`, `graphics`, `anim`, `quality` |
| `art/*` | ±2.600 | Pipeline seni murni-kode (Pixmap, palet, generator sheet) |

### Terikat Phaser — akan diganti/diadaptasi di Fase 1–2

| File | Baris | Peran | Rencana |
| --- | --- | --- | --- |
| `scenes/GameScene.ts` | 529 | Orkestrator utama | jadi acuan; `Game3DScene` ekuivalen di Three.js |
| `scenes/UIScene.ts` | 559 | HUD, kontrol sentuh, dialog, minimap | UI dipindah ke overlay DOM/canvas yang renderer-agnostik |
| `systems/EnemyDirector.ts` | 370 | Spawn/despawn + jembatan AI→view | logika spawn dipisah ke `core`, view diganti |
| `systems/chunks.ts` | 233 | Streaming chunk + bake tekstur | diganti chunk mesh 3D |
| `systems/lighting.ts` | 235 | Lightmap kanvas 2D + MULTIPLY | diganti cahaya Three.js |
| `systems/fx.ts` | 196 | Partikel, slash, angka damage | diganti partikel 3D (pooled) |
| `systems/PuzzleSystem.ts` | 203 | View puzzle | logika sudah murni; view diganti |
| `entities/HeroView/EnemyView/NpcView` | 400 | Sprite + animasi | diganti mesh + animasi |
| `systems/parallax.ts`, `cameraRig.ts` | 164 | Parallax layer, kamera | `cameraRig` jadi acuan kamera isometrik |
| `art/register.ts`, `ui/pixeltext.ts` | 97 | Jembatan pixmap→tekstur Phaser | dibuat versi Three.js (`DataTexture`) |
| `scenes/BootScene.ts`, `TitleScene.ts`, `main.ts` | 179 | Boot & judul | boot jadi renderer-agnostik |

### Temuan penting

1. **`art/*` adalah aset yang bisa dipakai ulang.** Pipeline seni murni-kode menghasilkan `Pixmap`
   (RGBA `Uint8ClampedArray`). Three.js bisa memakainya langsung lewat `DataTexture` —
   **tidak perlu menulis ulang generator tekstur**, cukup ganti jembatannya.
2. **Tes tidak bergantung Phaser nyata.** Phaser di-mock (`tests/mocks/phaser-mock.ts`) lewat hook
   resolve Node. Artinya migrasi ke Vitest cukup mengganti hook dengan `resolve.alias`.
3. **Simulasi sudah berbasis `dt` detik dan piksel logis.** 1 tile = 16 px. Untuk 3D, 1 tile = 1 unit
   dunia (skala `1/16`) supaya angka logika (kecepatan, radius serang, jarak AI) tidak perlu diubah.
4. **Kunci `localStorage` masih `lentera-kelam/...`.** Diganti ke `lentera-malam/...` dengan migrasi
   satu kali baca dari kunci lama supaya save pemain tidak hilang.
5. **`core/quality.ts` sudah digantikan** `core/graphics.ts` + `core/perf.ts`; file lama dihapus saat
   `GameScene` dipindahkan ke preset baru.

## 7. Rencana migrasi

### Target struktur folder

```
src/
  core/            LOGIKA MURNI — dilarang mengimpor phaser / three
    world/         worldgen, chunk data, collision, tile, area, props, bake
    entities/      HeroCore, enemies (AI)
    systems/       quest, puzzleLogic, daynight, interactables
    state/         GameState + serialisasi save
    stats/         (Batch 4) pipeline modifier, elemen, status effect
    ...            rng, save, input, settings, perf, graphics, display, errors
  art/             pipeline seni murni-kode (Pixmap) — dipakai 2D dan 3D
  render2d/        semua kode Phaser (scenes, views, systems lama)  ← bertahan sampai 3D setara
  render3d/        Three.js: renderer pixel, kamera iso, mesh, material, chunk 3D
  ui/              overlay UI renderer-agnostik (HUD, menu, panel debug)
  main.ts          memilih renderer (?renderer=2d|3d) lalu menyalakan yang dipilih
```

### Langkah (satu fitur per commit, `npm run build` + `npm test` hijau tiap langkah)

**Fase 0** — selesai
1. ✅ `docs/OVERHAUL.md` (dokumen ini) + audit.
2. ✅ Ganti nama → Lentera Malam, migrasi kunci `localStorage`.
3. ✅ Pindahkan file murni ke `src/core/**`; `tests/architecture.test.ts` menjaga batas lapisan.
4. ✅ Pasang Vitest (`npm test` → vitest), seluruh tes lama dipertahankan termasuk smoke test.
5. ✅ Alat debug: menu Pengaturan in-game, penghitung FPS, panel error + "Salin laporan".

**Fase 1** — selesai
6. ✅ `npm i three`; `render3d/PixelRenderer.ts`: render target resolusi rendah + upscale nearest +
   outline pixel dari kedalaman; `?renderer=2d|3d` + baris Renderer di menu.
7. ✅ Kamera isometrik 3/4 ortografik, sudut tetap, zoom 0,75–1,6, 16 px = 1 unit.
8. ✅ Greybox seluruh dunia dari data `worldgen` + tekstur pixel `art/greybox.ts`; tanah memakai
   `bakeChunk` yang sama dengan versi 2D.
9. ✅ Preset grafik dasar untuk 3D (pixelHeight, renderScale, outline, bayangan, anggaran cahaya).

**Fase 2** — selesai
10. ✅ Model + animasi player low-poly prosedural (`render3d/HeroMesh3D.ts`), lentera menyala
    sebagai cahaya nyata.
11. ✅ Gerak joystick/keyboard memakai `HeroCore` yang sama (arah joystick diputar ke ruang kamera);
    kamera mengikuti; collision memakai `core/world/collision.ts` yang sama.

### Belum dikerjakan di mode 3D (menyusul sesuai batch)

| Hal | Batch |
| --- | --- |
| ~~Musuh, kombat, damage, dua senjata, elemen~~ | ~~3~~ ✅ |
| Stats, equipment, Lantern Core, inventaris | 4 |
| NPC, dialog, quest, cutscene, audio, menu utama & pause, HUD lengkap | 5 |
| **Save/load** (mode 3D belum menyimpan posisi; save 2D lama tidak disentuh), world streaming | 6 |
| Akun, world event | 7 |

### Aturan yang dipegang selama migrasi

- **Jangan hapus `render2d/` sebelum 3D setara.** `?renderer=2d` wajib tetap bisa dibuka.
- **Jangan ubah perilaku saat memindahkan file.** Pemindahan dan perubahan logika = commit berbeda.
- **Jangan buat UI palsu.** Fitur yang belum jadi = interface/data model yang ditandai jelas `TODO(batch N)`.
- Update `README.md`, `CLAUDE.md`, `docs/GAME_DESIGN.md`, `docs/PROGRESS.md` sesuai perubahan.
- Pesan commit jelas, diakhiri baris `Co-Authored-By` sesuai instruksi harness.

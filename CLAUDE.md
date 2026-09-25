# CLAUDE.md — Lentera Malam

Open-world action RPG **3D pixel-art (Three.js)**. Renderer 2D (Phaser) sudah **dihapus** setelah
seluruh fiturnya pindah — inventarisnya di `docs/PROGRESS.md`, dan tag **`v0.2-2d-final`** adalah
titik pulang kalau ada yang ternyata terlewat.
Rencana induk & urutan batch: **`docs/OVERHAUL.md` (baca ini dulu)**.
Ringkasan desain: `docs/GAME_DESIGN.md`. Status pekerjaan: `docs/PROGRESS.md`
(**perbarui setiap satu fitur selesai**). Kredit aset: `CREDITS.md`. Naskah cerita: `docs/STORY.md`.

## Lingkungan pemain (penting)

- Pemain/penguji **hanya memakai HP Android, tanpa PC**. Mode landscape. **Jangan merencanakan alat
  desktop** (Blender GUI, Tiled, editor sprite desktop) dan **gamepad bukan prioritas** — utamakan
  kontrol sentuh.
- Claude tidak bisa melihat hasil visual. Verifikasi visual & FPS dilakukan pemain di HP lewat menu
  Pengaturan (penghitung FPS, panel error, tombol "Salin laporan") dan flag URL seperti `?fps=1`.
- Semua aset harus **original**. Aset CC0 boleh dipakai bila sumber + lisensinya dicatat di `CREDITS.md`.
- Susun folder aset supaya mudah diganti gambar/model buatan tangan.

## Stack

- **Three.js 0.186** (WebGL2), **TypeScript 7 (strict)**, **Vite 8**. Tidak ada Phaser lagi.
- Tes: **Vitest** (`npm test`), konfigurasi `vitest.config.ts`. Objek scene-graph Three.js jalan
  di Node — hanya `WebGLRenderer` yang butuh konteks nyata — jadi tes membangun mesh, musuh, dan
  quest sungguhan tanpa pernah merender satu pixel pun. **`tests/playthrough.test.ts`** memainkan
  seluruh quest secara headless; **`tests/architecture.test.ts`** menjaga batas antar lapisan.
  Tidak ada tes piksel/browser — render nyata hanya bisa dicek di perangkat.

## Menjalankan

```bash
npm install
npm run dev        # Vite di 127.0.0.1:5173 (dipakai lewat Cloudflare Tunnel https://game.varesa.mom)
npm run build      # tsc --noEmit && vite build  → HARUS hijau sebelum commit
npm test           # Vitest: logika inti, playthrough headless, kebocoran GPU, kasus tepi, penjaga lapisan
npm run lint       # oxlint
npm run test:watch # Vitest mode tonton
npm run assets     # ekspor semua sheet seni ke .preview/*.png (untuk dilihat/diedit, tidak di-commit)
npx tsx scripts/plan-stats.ts        # jumlah chunk/instance/draw group/lampu per area di mode 3D
npx tsx scripts/stream-budget.ts     # anggaran chunk/tekstur/draw per preset untuk ukuran layar apa pun
npx tsx scripts/preview-textures.ts  # ekspor 12 tekstur 3D ke .preview/textures.png
npx tsx scripts/ascii-map.ts 3       # cetak dunia sebagai ASCII (periksa tata letak tanpa GPU)
npx tsx scripts/crop-reference.ts docs/reference/referensi-visual.png 400 0 420 320 2 .preview/x.png
```

Flag URL untuk menguji di HP: `?fps=1`, `?bloom=0`, `?preset=vlow|low|medium|high|ultra`, `?debug=1`.
Variabel build: `VITE_API_URL` (akun server), `VITE_DEV_TOOLS=1` (Mode Pengembang di build staging).
Semuanya juga ada di menu Pengaturan (gerigi di pojok kanan atas).

- **Server akun** (`server/`, Fastify + MongoDB, `127.0.0.1:3000` → `https://api.varesa.mom`) hidup di
  **sesi tmux `api`**: `tmux new-session -d -s api -c <repo>/server "npm start"`. Rahasia hanya di
  `server/.env` (di-.gitignore; contoh nama variabel di `server/.env.example`). **Jangan pernah membaca,
  mencetak, atau menyalin isi `server/.env`** — termasuk ke log, dokumen, atau pesan commit.
  Tes server berjalan lewat `npm test` di akar repo (`server/tests/`, tanpa database).
- Dev server harus hidup di **sesi tmux bernama `game`**: `tmux new-session -d -s game -c <repo> "npm run dev"`.
  Cek: `tmux capture-pane -t game -p | tail`. `vite.config.ts` sudah berisi `allowedHosts: ['game.varesa.mom']` dan HMR `wss`/443.
- VPS: RAM 4 GB tanpa swap/GPU → **jangan menjalankan browser headless**. Verifikasi visual dilakukan lewat `npm run assets`
  (menghasilkan PNG dari pipeline seni murni-kode yang lalu bisa dibuka dengan alat baca gambar) dan tes logika.
- Jangan mengubah apa pun di luar folder repo.

## Struktur folder

```
src/
  main.ts            entry: overlay debug, layar judul + akun, lalu muat render3d/boot3d secara dinamis
  cloud.ts           setelah login ke server: peran, save server vs HP, antrean sinkron (dibatasi waktu)
  config.ts          konstanta global (TILE, ukuran dunia, key save/setelan, versi)
  core/              LOGIKA GAME MURNI — dilarang mengimpor three, dan hanya boleh mengimpor
                     src/core/** + src/config (dijaga tests/architecture.test.ts)
    world/           tile, worldgen, chunk data, WorldSource, koordinat area, collision grid
    entities/        HeroCore (gerak/kombo/senjata/HP), enemies (AI musuh & boss),
                     combatTuning (65 angka combat + busur yang bisa disetel dari HP)
    combat/          elements (15 elemen + 16 status + tabel reaksi), weapons (Pedang/Busur + BOW),
                     arrows (lintasan panah: sapuan, tembus, menancap)
    story/           cutscene (mesin timeline, bebas renderer), cutscenes (SKRIP sebagai data)
    audio/           engine (context + 5 bus kategori), sfx, tracks (musik sebagai data),
                     music (scheduler + crossfade), beds (suasana sebagai data), ambient,
                     select (aturan track/bed per situasi), lifecycle
    stats/           stats (pipeline modifier), damage (satu formula untuk SEMUA hit),
                     character (level + equipment + buff -> satu StatBlock + passive Inti Lentera)
    items/           items (8 slot, 6 rarity, katalog), inventory (grid 48 sel + equipped),
                     drops (tabel loot), look (perlengkapan → warna di model hero)
    download/        pack (format paket area), manifest, downloader (aman & bisa dilanjutkan),
                     gate (area mana yang butuh data)
    account/         auth (AuthAdapter + aturan dari shared/), local (PBKDF2, tes tanpa server),
                     remote (API server: access token di memori, refresh lewat cookie HttpOnly)
    sync/            saveSync (save lokal-dulu → server: revisi, konflik berdasarkan progres)
    (akar)           autotune (AUTO per komponen), devtools (gerbang Mode Pengembang)
    (akar)           progression (level/EXP), lifecycle (pause/context-lost/orientasi), saveMigrate
    systems/         quest, puzzleLogic, daynight, interactables, tutorial, weather,
                     worldEvents (event dunia sebagai data + sutradara)
    state/           GameState (quest, kill, flag, waktu) + serialisasi save
    (akar)           rng, save, storage, input, display, errors, settings, perf, graphics, anim, audio
  art/               PIPELINE SENI MURNI-KODE (tanpa DOM, tanpa renderer): Pixmap, palette,
                     generator sprite/tile/fx/ui/font, bake (chunk → pixmap + light mask),
                     greybox (tekstur 3D 32x32), markers (penanda quest)
  ui/                OVERLAY UI NETRAL-RENDERER (DOM): TitleScreen (gerbang → akun → menu), Hud,
                     Dialogue, Minimap, TouchControls, CharacterPanel (karakter + tas + avatar),
                     PauseMenu, CutsceneOverlay, SettingsPanel, DebugUi, DevMenu, DownloadManager,
                     ShopPanel, fullscreen, FpsMeterView, safearea, fx — dilarang mengimpor three
  render3d/          SEMUA KODE THREE.JS: boot3d, Game3D, PixelRenderer (pipeline pixel),
                     IsoCamera, World3D (streaming), Combat3D, Story3D, Puzzle3D, HeroMesh3D,
                     EnemyMesh3D, NpcMesh3D, Environment, Sky, WaterSurface, InstancePool,
                     lightmap, occlusion, PerfProbe, AreaData (paket area), Rain, DevTools,
                     Cutscene3D, Portrait3D (avatar), TitleBackdrop (malam di layar judul),
                     worldPlan + pixelPlan (BEBAS three, jadi bisa dites di Node)
tests/               Vitest: logika inti, playthrough headless, dan penjaga lapisan
scripts/             skrip node — termasuk areaPacks.ts (paket data area; dipakai plugin Vite),
                     ekspor sheet, preview dunia, ascii-map, plan-stats,
                     stream-budget, preview-textures, crop-reference, debug-puzzle)
shared/              api.ts: kontrak game ↔ server (tipe, aturan nama/sandi, kode galat) — murni
server/              backend akun & save (Fastify + MongoDB + argon2id + JWT), paket npm sendiri:
                     src/app (rute), config, repo (antarmuka + memori), repo.mongo, index (start)
docs/                OVERHAUL.md (rencana induk), GAME_DESIGN.md, PROGRESS.md, STORY.md, BACKEND.md
docs/reference/      TARGET VISUAL (referensi-visual.png). Buka dengan scripts/crop-reference.ts
                     untuk memeriksa bagiannya dari dekat; scripts/png.ts bisa decode PNG.
```

Aturan lapisan (dijaga `tests/architecture.test.ts`): `core` tidak tahu renderer apa pun,
`art` juga tidak, `ui` tidak boleh mengimpor three, dan tidak ada apa pun yang boleh mengimpor
phaser.

## Konvensi kode

- TypeScript strict **plus** `noUnusedLocals/Parameters`, `noImplicitReturns`, `exactOptionalPropertyTypes`,
  `noFallthroughCasesInSwitch`, `noImplicitOverride`. Tidak ada `any` kecuali di batas dengan tipe pihak ketiga
  yang kurang. Properti opsional yang boleh diisi `undefined` ditulis eksplisit `?: T | undefined`.
  (`noUncheckedIndexedAccess` dan `noPropertyAccessFromIndexSignature` **sengaja tidak** dinyalakan: 400 dan 102
  temuan yang hanya bisa dipuaskan dengan ratusan `!` di loop piksel/grid — itu membuat kode berbohong.)
- Linter: **oxlint** (`npm run lint`, ikut di `npm run build`). Konfigurasi `.oxlintrc.json`: kategori
  correctness/suspicious/perf sebagai error. `toReversed`/`toSorted` (ES2023) **dihindari** — WebView Android
  lama belum punya; salin dulu (`[...a].reverse()`).
- Kode & komentar dalam **bahasa Inggris**; teks yang tampil di game, dokumen, dan pesan commit boleh **bahasa Indonesia**.
- Logika permainan (gerak, tabrakan, AI, kombat, quest, save, worldgen) ditulis sebagai **kelas/fungsi murni
  tanpa import renderer** supaya bisa dites di Node. Kelas di `render3d/` hanya menggambar dan menghubungkan
  input; kalau sebuah aturan permainan hanya ada di sana, itu aturan yang tidak bisa dites.
- Waktu simulasi memakai `dt` detik. Hit-stop = simulasi dibekukan sementara (`Game3D.freeze(ms)`), render & UI jalan terus.
- **Alokasi per frame itu bug.** GC pause tidak muncul di rata-rata fps, munculnya sebagai game yang terasa
  tidak rata. Jangan `map/filter/sort/{}`/`new` di jalur per-frame; pakai buffer yang sudah dialokasikan
  atau cache dengan kunci (lihat `World3D.pickNearestLights`, `Story3D.mapMarks`, `Minimap.update`).
  Dijaga `tests/frametime.test.ts`.
- **Angka yang masuk ke HP/damage harus dijepit** (`Number.isFinite` + `Math.max(0, …)`): satu NaN membuat
  hero/musuh tidak hidup dan tidak mati, dan tidak pernah pulih. Lihat `tests/edgecases.test.ts`.
- Semua posisi dunia dalam piksel logis (bukan piksel layar). 1 tile = 16 px. Kamera zoom selalu 1; skala integer dilakukan CSS.
- **Nama tokoh utama datang dari setelan pemain** (`settings.playerName`, fallback `Pengembara`).
  Naskah di `docs/STORY.md` memanggilnya Arka, tapi setiap baris yang dibaca pemain ditulis dengan
  placeholder `{nama}`. Jangan pernah menulis "Arka" di teks yang tampil di game.
- **Mode Pengembang tidak boleh ada di build rilis.** Gerbangnya harus ekspresi literal
  `import.meta.env.DEV`, bukan panggilan fungsi — kalau tidak, chunk-nya tetap ter-emit ke `dist/`.
  Dijaga `tests/devmode.test.ts`, yang membangun versi rilis sungguhan.
- **Efek layar penuh (blur) hanya di preset Tinggi ke atas** (`ui/fx.ts` `blurAllowed()`).
- **Nama class CSS global.** Setiap overlay menyuntikkan stylesheet global; beri awalan per komponen
  (`lm-set-*`, `lm-shop-*`, …). Class `lm-title` milik layar judul pernah dipakai header Pengaturan
  dan menutupi seluruh panelnya. Dijaga `tests/source.test.ts` (satu class, satu stylesheet) dan
  `tests/settingspanel.test.ts` (cascade CSS nyata ke setiap elemen panel).
- **Akun:** tidak pernah simpan kata sandi plaintext, tidak ada rahasia/API key di klien, access token
  hanya di memori, dan peran (`dev`) hanya dari jawaban server. Lihat `docs/BACKEND.md`.
- **Semua panel UI wajib menghormati safe area** lewat `var(--lm-sa*)` di CSS, atau `safeInsets()`
  kalau memposisikan dengan JavaScript. Dijaga `tests/layout.test.ts` di 2318x759.
- **Jangan pakai backtick di dalam komentar yang berada DI DALAM template literal** (blok CSS di
  `src/ui/*`, blok GLSL di `src/render3d/*`). Backtick-nya menutup string itu dan errornya muncul
  sebagai `TS1005: ',' expected` di baris komentar — bukan di tempat yang bisa ditebak. Sudah **tiga**
  kali kejadian, jadi sekarang dijaga `tests/source.test.ts`. Tulis `position:fixed`, bukan
  backtick-position:fixed-backtick.
- Jangan memakai `Math.random()` untuk hal yang harus konsisten (worldgen, variasi tile): pakai `core/rng.ts` (seeded).
- Satu fitur per langkah: `npm run build` hijau → commit jelas → `git push origin main` → update `docs/PROGRESS.md`.
- Pesan commit diakhiri baris `Co-Authored-By` sesuai instruksi harness.

## Catatan API Three.js (sudah diverifikasi di repo ini)

- **Colour management dimatikan** (`THREE.ColorManagement.enabled = false`, `outputColorSpace = LinearSRGBColorSpace`,
  tekstur `colorSpace = NoColorSpace`). Palet di `src/art/palette.ts` dipilih tangan; kami ingin byte-nya
  keluar apa adanya, bukan hasil pulang-balik sRGB.
- `DataTexture` **tidak bisa diandalkan menghormati `flipY`** di semua driver. Untuk bidang tanah, baris
  pixmap dibalik saat upload (`pixmapTexture(pm, { flipRows: true })`). Pixmap baris 0 = utara, dan bidang
  yang dirotasi `-PI/2` punya `v = 1` di utara.
- `WebGLRenderTarget.setSize()` **hanya mengubah ukuran attachment warna, bukan `depthTexture`** — buat
  `DepthTexture` baru dan pasang ulang (lihat `PixelRenderer.resize`).
- `InstancedMesh.setColorAt()` bekerja dengan material standar (`MeshLambertMaterial`/`MeshBasicMaterial`):
  Three mendefinisikan `USE_INSTANCING_COLOR` sendiri, tidak perlu `vertexColors: true`.
- Varying UV untuk `map` bernama **`vMapUv`** (r152+), dihitung di chunk `<uv_vertex>`. Tambal lewat
  `onBeforeCompile` **setelah** `#include <uv_vertex>` dan bungkus `#ifdef USE_MAP`.
- Setiap material yang memakai `onBeforeCompile` **wajib** punya `customProgramCacheKey()`, kalau tidak
  Three akan memakai ulang program milik material lain.
- Kamera ortografik: kedalaman bersifat linear, jadi outline bisa dibuat dari selisih depth tetangga
  tanpa linearisasi (`PixelRenderer` shader quad).
- Geometri dibuat prosedural lewat kode; **tidak ada alat desktop** (lihat batasan pemain di atas).

## Mengganti aset dengan gambar buatan tangan

Semua gambar dihasilkan dari `src/art/*`. Untuk melihatnya:
`npm run assets` (sheet sprite → `.preview/*.png`) dan `npx tsx scripts/preview-textures.ts`
(tekstur 3D → `.preview/textures.png`).

> **Catatan jujur:** mekanisme override PNG (`public/assets/override/`) dulu dipasang di
> `BootScene` Phaser dan **ikut terhapus bersama renderer 2D**. Penggantinya untuk 3D belum
> dibuat: yang dibutuhkan adalah memuat PNG lalu menimpa piksel `DataTexture` di
> `render3d/textures.ts`. Folder dan manifestnya tetap ada supaya jalurnya tidak hilang.
> Masuk daftar pekerjaan Batch 5 (aset & UI).

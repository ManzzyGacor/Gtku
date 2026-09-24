# CLAUDE.md — Lentera Malam

Open-world action RPG pixel art. **Sedang dioverhaul dari 2D (Phaser) ke 3D pixel-art (Three.js)** —
rencana induk & urutan batch: **`docs/OVERHAUL.md` (baca ini dulu)**.
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

- **Phaser 4.2.x** (renderer baru berbasis RenderNode; BUKAN Phaser 3 — lihat catatan API di bawah), **TypeScript 7 (strict)**, **Vite 8**.
- Dokumentasi Phaser 4 ada lokal: `node_modules/phaser/skills/*/SKILL.md`, `node_modules/phaser/docs`, tipe di `node_modules/phaser/types/phaser.d.ts`.
- Tes: **Vitest** (`npm test` = `vitest run`, `npm run test:watch` untuk mode tonton), konfigurasi di `vitest.config.ts`.
  Tes logika murni `src/core` + **`tests/smoke.test.ts`**: menjalankan GameScene/UIScene asli terhadap Phaser palsu
  (`tests/mocks/phaser-mock.ts`, dialihkan lewat `resolve.alias` Vitest) selama ribuan frame (jalan, kombat, dialog, puzzle,
  boss, save/load, respawn, cek kebocoran objek, validasi nama frame). Plus `tests/core-purity.test.ts` yang menjaga
  `src/core` bebas renderer. Tidak ada tes piksel/browser — render nyata WebGL hanya bisa dicek di perangkat.

## Menjalankan

```bash
npm install
npm run dev        # Vite di 127.0.0.1:5173 (dipakai lewat Cloudflare Tunnel https://game.varesa.mom)
npm run build      # tsc --noEmit && vite build  → HARUS hijau sebelum commit
npm test           # Vitest: logika inti (dunia, kombat, AI, quest, save) + smoke test + penjaga lapisan
npm run test:watch # Vitest mode tonton
npm run assets     # ekspor semua sheet seni ke .preview/*.png (untuk dilihat/diedit, tidak di-commit)
npx tsx scripts/plan-stats.ts        # jumlah chunk/instance/draw group/lampu per area di mode 3D
npx tsx scripts/stream-budget.ts     # anggaran chunk/tekstur/draw per preset untuk ukuran layar apa pun
npx tsx scripts/preview-textures.ts  # ekspor 12 tekstur 3D ke .preview/textures.png
npx tsx scripts/ascii-map.ts 3       # cetak dunia sebagai ASCII (periksa tata letak tanpa GPU)
npx tsx scripts/crop-reference.ts docs/reference/referensi-visual.png 400 0 420 320 2 .preview/x.png
```

Flag URL untuk menguji di HP: `?renderer=2d|3d`, `?fps=1`, `?bloom=0`, `?preset=vlow|low|medium|high|ultra`.
Semuanya juga ada di menu Pengaturan (gerigi di pojok kanan atas).

- Dev server harus hidup di **sesi tmux bernama `game`**: `tmux new-session -d -s game -c <repo> "npm run dev"`.
  Cek: `tmux capture-pane -t game -p | tail`. `vite.config.ts` sudah berisi `allowedHosts: ['game.varesa.mom']` dan HMR `wss`/443.
- VPS: RAM 4 GB tanpa swap/GPU → **jangan menjalankan browser headless**. Verifikasi visual dilakukan lewat `npm run assets`
  (menghasilkan PNG dari pipeline seni murni-kode yang lalu bisa dibuka dengan alat baca gambar) dan tes logika.
- Jangan mengubah apa pun di luar folder repo.

## Struktur folder

```
src/
  main.ts            entry: konfigurasi Phaser + skala integer (core/display.ts)
  config.ts          konstanta global (TILE, ukuran dunia, key save/setelan)
  core/              LOGIKA GAME MURNI — dilarang mengimpor phaser/three, dan hanya boleh
                     mengimpor src/core/** + src/config (dijaga tests/core-purity.test.ts)
    world/           tile, worldgen, chunk data, WorldSource, koordinat area, collision grid
    entities/        HeroCore (gerak/kombo/HP), enemies (AI musuh & boss)
    systems/         quest, puzzleLogic, daynight, interactables
    state/           GameState (quest, kill, flag, waktu) + serialisasi save
    (akar)           rng, save, storage, input, display, errors, settings, perf, graphics, anim
  art/               PIPELINE SENI MURNI-KODE (tanpa DOM, tanpa renderer): Pixmap, palette,
                     generator sprite/tile/fx/ui/font, bake (chunk → pixmap), greybox (tekstur 3D)
  ui/                OVERLAY UI NETRAL-RENDERER (DOM): menu Pengaturan, penghitung FPS,
                     kontrol sentuh, antarmuka DiagnosticsSource — dilarang mengimpor phaser/three
  render2d/          SEMUA KODE PHASER: boot2d, scenes (Boot/Title/Game/UI), entities *View,
                     systems (chunks, lighting, parallax, fx, cameraRig, EnemyDirector, PuzzleSystem),
                     register (pixmap → tekstur Phaser), pixeltext
  render3d/          SEMUA KODE THREE.JS: boot3d, Game3D, PixelRenderer (pipeline pixel),
                     IsoCamera, World3D, textures (pixmap → DataTexture),
                     worldPlan (BEBAS three, jadi tata letak 3D bisa dites di Node)
tests/               Vitest: logika inti, smoke test, dan tests/architecture.test.ts yang menjaga
                     batas antar lapisan di atas
scripts/             skrip node (ekspor sheet ke PNG, preview dunia)
public/assets/override/   TARUH PNG buatan tangan di sini untuk menimpa aset generatif (lihat di bawah)
docs/                OVERHAUL.md (rencana induk), GAME_DESIGN.md, PROGRESS.md, STORY.md
docs/reference/      TARGET VISUAL (referensi-visual.png). Buka dengan scripts/crop-reference.ts
                     untuk memeriksa bagiannya dari dekat; scripts/png.ts bisa decode PNG.
```

Aturan lapisan (dijaga `tests/architecture.test.ts`): `core` tidak tahu renderer apa pun,
`art` juga tidak, `ui` tidak boleh mengimpor phaser/three, dan kedua folder renderer tidak boleh
saling mengimpor. `main.ts` memilih renderer lewat `?renderer=2d|3d` (atau menu) dan hanya memuat
bundle yang dipilih.

## Konvensi kode

- TypeScript strict; tidak ada `any` kecuali di batas dengan Phaser yang tipenya kurang. `noUnusedLocals/Parameters` aktif.
- Kode & komentar dalam **bahasa Inggris**; teks yang tampil di game, dokumen, dan pesan commit boleh **bahasa Indonesia**.
- Logika permainan (gerak, tabrakan, AI, kombat, quest, save, worldgen) ditulis sebagai **kelas/fungsi murni tanpa import Phaser** bila
  memungkinkan supaya bisa dites di Node. Kelas Phaser hanya menggambar/menghubungkan input.
- Waktu simulasi memakai `dt` detik. Hit-stop = simulasi dibekukan sementara (`GameScene.freeze(ms)`), render & UI jalan terus.
- Semua posisi dunia dalam piksel logis (bukan piksel layar). 1 tile = 16 px. Kamera zoom selalu 1; skala integer dilakukan CSS.
- Y-sort: `setDepth(footY)` untuk objek dinamis dan statis. Layer khusus: tanah 0, bayangan 1, objek = y (2..3000), lightmap 5000 (partikel 4000 di bawahnya; slash/telegraf/proyektil 5150, teks damage 5200 di atasnya agar terbaca saat gelap).
- Jangan memakai `Math.random()` untuk hal yang harus konsisten (worldgen, variasi tile): pakai `core/rng.ts` (seeded).
- Satu fitur per langkah: `npm run build` hijau → commit jelas → `git push origin main` → update `docs/PROGRESS.md`.
- Pesan commit diakhiri baris `Co-Authored-By` sesuai instruksi harness.

## Catatan API Phaser 4 (beda dari v3)

- `roundPixels` default `false`; game ini memakai `render.pixelArt: true` (mengaktifkannya). Kamera zoom 1.
- FX `preFX/postFX` dan pipeline dihapus → **Filters**: `camera.filters.external.addVignette(...)`, `Phaser.Actions.AddEffectBloom(...)`.
  Filter hanya WebGL; selalu bungkus try/catch dan sediakan fallback tanpa filter.
- `RenderTexture/DynamicTexture` harus memanggil `render()`. Game ini menghindarinya: tekstur dinamis dibuat dengan **CanvasTexture**
  (`textures.addCanvas` lalu `refresh()`).
- `Rectangle`/shape: ubah ukuran dengan `setSize()` — mengubah `.width` langsung TIDAK memperbarui geometri.
- Pencahayaan dipakai **manual** (lightmap kanvas 2D + blend MULTIPLY), bukan `setLighting()` bawaan, agar hasilnya deterministik.
- `Geom.Point` tak ada (pakai `Vector2`); `Math.TAU` = 2π.

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

Semua gambar dihasilkan dari `src/art/*` menjadi **sheet** (atlas) dengan nama frame tetap (`src/art/sheets.ts`). Untuk mengganti:
1. `npm run assets` → lihat layout di `.preview/<sheet>.png` dan `.preview/<sheet>.json`.
2. Gambar ulang dengan ukuran & layout frame yang sama, simpan sebagai `public/assets/override/<sheet>.png`.
3. Tambahkan nama sheet ke `public/assets/override/manifest.json` (`{"sheets": ["hero", ...]}`); saat boot PNG itu menggantikan piksel sheet
   generatif (nama frame tetap sama).

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
  main.ts            entry: pasang overlay debug lalu muat render3d/boot3d secara dinamis
  config.ts          konstanta global (TILE, ukuran dunia, key save/setelan, versi)
  core/              LOGIKA GAME MURNI — dilarang mengimpor three, dan hanya boleh mengimpor
                     src/core/** + src/config (dijaga tests/architecture.test.ts)
    world/           tile, worldgen, chunk data, WorldSource, koordinat area, collision grid
    entities/        HeroCore (gerak/kombo/senjata/HP), enemies (AI musuh & boss),
                     combatTuning (39 angka combat yang bisa disetel dari HP)
    combat/          elements (15 elemen + 16 status + tabel reaksi), weapons (Pedang/Busur)
    systems/         quest, puzzleLogic, daynight, interactables
    state/           GameState (quest, kill, flag, waktu) + serialisasi save
    (akar)           rng, save, storage, input, display, errors, settings, perf, graphics, anim, audio
  art/               PIPELINE SENI MURNI-KODE (tanpa DOM, tanpa renderer): Pixmap, palette,
                     generator sprite/tile/fx/ui/font, bake (chunk → pixmap + light mask),
                     greybox (tekstur 3D 32x32), markers (penanda quest)
  ui/                OVERLAY UI NETRAL-RENDERER (DOM): TitleScreen, Hud, Dialogue, Minimap,
                     TouchControls, SettingsPanel, DebugUi, FpsMeterView — dilarang mengimpor three
  render3d/          SEMUA KODE THREE.JS: boot3d, Game3D, PixelRenderer (pipeline pixel),
                     IsoCamera, World3D (streaming), Combat3D, Story3D, Puzzle3D, HeroMesh3D,
                     EnemyMesh3D, NpcMesh3D, Environment, Sky, WaterSurface, InstancePool,
                     lightmap, occlusion, PerfProbe,
                     worldPlan + pixelPlan (BEBAS three, jadi bisa dites di Node)
tests/               Vitest: logika inti, playthrough headless, dan penjaga lapisan
scripts/             skrip node (ekspor sheet, preview dunia, ascii-map, plan-stats,
                     stream-budget, preview-textures, crop-reference, debug-puzzle)
docs/                OVERHAUL.md (rencana induk), GAME_DESIGN.md, PROGRESS.md, STORY.md
docs/reference/      TARGET VISUAL (referensi-visual.png). Buka dengan scripts/crop-reference.ts
                     untuk memeriksa bagiannya dari dekat; scripts/png.ts bisa decode PNG.
```

Aturan lapisan (dijaga `tests/architecture.test.ts`): `core` tidak tahu renderer apa pun,
`art` juga tidak, `ui` tidak boleh mengimpor three, dan tidak ada apa pun yang boleh mengimpor
phaser.

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

Semua gambar dihasilkan dari `src/art/*`. Untuk melihatnya:
`npm run assets` (sheet sprite → `.preview/*.png`) dan `npx tsx scripts/preview-textures.ts`
(tekstur 3D → `.preview/textures.png`).

> **Catatan jujur:** mekanisme override PNG (`public/assets/override/`) dulu dipasang di
> `BootScene` Phaser dan **ikut terhapus bersama renderer 2D**. Penggantinya untuk 3D belum
> dibuat: yang dibutuhkan adalah memuat PNG lalu menimpa piksel `DataTexture` di
> `render3d/textures.ts`. Folder dan manifestnya tetap ada supaya jalurnya tidak hilang.
> Masuk daftar pekerjaan Batch 5 (aset & UI).

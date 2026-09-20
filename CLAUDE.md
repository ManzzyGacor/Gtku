# CLAUDE.md — Lentera Kelam

Open-world action RPG 2D top-down pixel art. Ringkasan desain: `docs/GAME_DESIGN.md`. Status pekerjaan: `docs/PROGRESS.md`
(**perbarui setiap satu fitur selesai**). Kredit aset: `CREDITS.md`.

## Stack

- **Phaser 4.2.x** (renderer baru berbasis RenderNode; BUKAN Phaser 3 — lihat catatan API di bawah), **TypeScript 7 (strict)**, **Vite 8**.
- Dokumentasi Phaser 4 ada lokal: `node_modules/phaser/skills/*/SKILL.md`, `node_modules/phaser/docs`, tipe di `node_modules/phaser/types/phaser.d.ts`.
- Tes murni-logika: `node --import tsx --test tests/*.test.ts` (`npm test`). Tidak ada tes berbasis browser.

## Menjalankan

```bash
npm install
npm run dev        # Vite di 127.0.0.1:5173 (dipakai lewat Cloudflare Tunnel https://game.varesa.mom)
npm run build      # tsc --noEmit && vite build  → HARUS hijau sebelum commit
npm test           # tes logika (dunia, kombat, AI, quest, save)
npm run assets     # ekspor semua sheet seni ke .preview/*.png (untuk dilihat/diedit, tidak di-commit)
```

- Dev server harus hidup di **sesi tmux bernama `game`**: `tmux new-session -d -s game -c <repo> "npm run dev"`.
  Cek: `tmux capture-pane -t game -p | tail`. `vite.config.ts` sudah berisi `allowedHosts: ['game.varesa.mom']` dan HMR `wss`/443.
- VPS: RAM 4 GB tanpa swap/GPU → **jangan menjalankan browser headless**. Verifikasi visual dilakukan lewat `npm run assets`
  (menghasilkan PNG dari pipeline seni murni-kode yang lalu bisa dibuka dengan alat baca gambar) dan tes logika.
- Jangan mengubah apa pun di luar folder repo.

## Struktur folder

```
src/
  main.ts            entry: konfigurasi Phaser + skala integer (core/display.ts)
  config.ts          konstanta global (TILE, ukuran dunia, key save)
  core/              utilitas tanpa/sedikit Phaser: display, input, save, kualitas adaptif, rng, error overlay
  art/               PIPELINE SENI MURNI-KODE (tanpa DOM): Pixmap, palette, generator sprite/tile/fx/ui/font, registry sheet
  world/             data dunia: tile, worldgen, chunk, WorldSource, koordinat area, collision grid
  entities/          Hero, Enemy(+brains), Npc, Projectile, objek puzzle
  systems/           lighting, day-night, combat/fx, dialog, quest, minimap, spawner
  scenes/            Boot, Title, Game, UI (HUD + kontrol sentuh + dialog)
tests/               tes logika (node:test + tsx)
scripts/             skrip node (ekspor sheet ke PNG, preview dunia)
public/assets/override/   TARUH PNG buatan tangan di sini untuk menimpa aset generatif (lihat di bawah)
docs/                GAME_DESIGN.md, PROGRESS.md
```

## Konvensi kode

- TypeScript strict; tidak ada `any` kecuali di batas dengan Phaser yang tipenya kurang. `noUnusedLocals/Parameters` aktif.
- Kode & komentar dalam **bahasa Inggris**; teks yang tampil di game, dokumen, dan pesan commit boleh **bahasa Indonesia**.
- Logika permainan (gerak, tabrakan, AI, kombat, quest, save, worldgen) ditulis sebagai **kelas/fungsi murni tanpa import Phaser** bila
  memungkinkan supaya bisa dites di Node. Kelas Phaser hanya menggambar/menghubungkan input.
- Waktu simulasi memakai `dt` detik. Hit-stop = simulasi dibekukan sementara (`GameScene.freeze(ms)`), render & UI jalan terus.
- Semua posisi dunia dalam piksel logis (bukan piksel layar). 1 tile = 16 px. Kamera zoom selalu 1; skala integer dilakukan CSS.
- Y-sort: `setDepth(footY)` untuk objek dinamis dan statis. Layer khusus: tanah 0, bayangan 1, objek = y (2..3000), lightmap 5000, efek layar 6000.
- Jangan memakai `Math.random()` untuk hal yang harus konsisten (worldgen, variasi tile): pakai `core/rng.ts` (seeded).
- Satu fitur per langkah: `npm run build` hijau → commit jelas → `git push origin main` → update `docs/PROGRESS.md`.
- Pesan commit diakhiri baris `Co-Authored-By` sesuai instruksi harness.

## Catatan API Phaser 4 (beda dari v3)

- `roundPixels` default `false`; game ini memakai `render.pixelArt: true` (mengaktifkannya). Kamera zoom 1.
- FX `preFX/postFX` dan pipeline dihapus → **Filters**: `camera.filters.external.addVignette(...)`, `Phaser.Actions.AddEffectBloom(...)`.
  Filter hanya WebGL; selalu bungkus try/catch dan sediakan fallback tanpa filter.
- `RenderTexture/DynamicTexture` harus memanggil `render()`. Game ini menghindarinya: tekstur dinamis dibuat dengan **CanvasTexture**
  (`textures.addCanvas` lalu `refresh()`).
- Pencahayaan dipakai **manual** (lightmap kanvas 2D + blend MULTIPLY), bukan `setLighting()` bawaan, agar hasilnya deterministik.
- `Geom.Point` tak ada (pakai `Vector2`); `Math.TAU` = 2π.

## Mengganti aset dengan gambar buatan tangan

Semua gambar dihasilkan dari `src/art/*` menjadi **sheet** (atlas) dengan nama frame tetap (`src/art/sheets.ts`). Untuk mengganti:
1. `npm run assets` → lihat layout di `.preview/<sheet>.png` dan `.preview/<sheet>.json`.
2. Gambar ulang dengan ukuran & layout frame yang sama, simpan sebagai `public/assets/override/<sheet>.png`.
3. Tambahkan nama sheet ke `public/assets/override/manifest.json` (`{"sheets": ["hero", ...]}`); saat boot PNG itu menggantikan piksel sheet
   generatif (nama frame tetap sama).

# Lentera Malam

Open-world action RPG bergaya pixel art. Semua karakter, nama, cerita, dan aset **original**; seluruh pixel art dan
geometri dihasilkan lewat kode. Dirancang untuk browser HP Android (landscape); keyboard tetap didukung.

> **Sedang dioverhaul dari 2D ke 3D pixel-art.** Rencana induk dan urutan batch: [`docs/OVERHAUL.md`](docs/OVERHAUL.md).

## Dua mesin tampilan

| Mode | Buka | Isi |
| --- | --- | --- |
| **3D** (default) | `?renderer=3d` | Three.js + pipeline pixel, kamera 3/4 isometrik, seluruh dunia greybox bertekstur pixel, player low-poly dengan lentera menyala. Combat, quest, dan NPC menyusul per batch. |
| **2D** (lengkap) | `?renderer=2d` | Phaser 4 — game utuh: kombat, quest, puzzle, boss, save. Tetap dipertahankan sampai versi 3D menyamainya. |

Ganti mode kapan saja dari **gerigi di pojok kanan atas → Renderer** (halaman dimuat ulang).
Menu yang sama berisi preset grafik (AUTO + 5 tingkat), penghitung FPS, ukuran/posisi joystick, ukuran tombol,
ukuran teks, panel error, dan tombol **"Salin laporan"** untuk melaporkan masalah dari HP.

## Cara main (mode 2D)

| Aksi | Sentuh (HP) | Keyboard |
| --- | --- | --- |
| Jalan 8 arah | Joystick virtual — sentuh & geser di separuh kiri layar | `WASD` / panah |
| Serang (kombo 3 pukulan) | Tombol pedang (kanan bawah) — ketuk berulang | `J` / `Z` / `Spasi` |
| Dodge roll (kebal sesaat) | Tombol panah melingkar | `K` / `X` / `Shift` |
| Skill *Ledakan Fajar* (cooldown 7 dtk) | Tombol bintang | `L` / `C` |
| Bicara / baca / istirahat di altar | Tombol gelembung (muncul saat dekat) | `E` / `Enter` |
| Lanjut dialog | Ketuk layar | `E` / `Enter` |

Tujuan: bicara dengan **Tetua Wulan** di plaza desa → kalahkan 6 monster hutan → masuki **Gua Kelam** (dorong batu ke pelat untuk membuka
gerbang) → kalahkan **Kolosus Kelam** → bawa **Kristal Fajar** kembali dan nyalakan Lentera Agung.
Sentuh altar berapi / Lentera Agung untuk memulihkan HP dan menyimpan progres (autosave juga berjalan).

## Menjalankan

```bash
npm install
npm run dev      # http://127.0.0.1:5173 (di server ini dibuka lewat https://game.varesa.mom)
npm run build    # typecheck + build produksi ke dist/
npm test         # tes logika + smoke test terintegrasi (Phaser di-mock)
npm run assets   # ekspor semua sheet seni & preview dunia ke .preview/*.png
```

Parameter URL untuk pengujian: `?bloom=0` (matikan bloom), `?q=0|1|2` (kunci level kualitas: 0 minimal, 2 penuh).

## Dokumentasi

- `docs/GAME_DESIGN.md` — ringkasan desain
- `docs/PROGRESS.md` — status fitur + usulan Fase 2
- `CLAUDE.md` — stack, struktur folder, konvensi (untuk sesi pengembangan berikutnya)
- `CREDITS.md` — kredit aset & library

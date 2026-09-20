# Lentera Kelam

Open-world action RPG 2D top-down bergaya pixel art (Phaser 4 + TypeScript + Vite). Semua karakter, nama, cerita, dan aset **original**;
seluruh pixel art dihasilkan lewat kode. Dirancang untuk browser HP Android (landscape) dan keyboard.

## Cara main

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

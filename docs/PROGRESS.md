# Progress — Fase 1

Legenda: ✅ selesai · 🚧 sedang dikerjakan · ⬜ belum

## Fondasi
- ✅ Scaffold Phaser 4 + TS + Vite, skala integer, dev server (tmux `game`, host `game.varesa.mom`), dokumen desain, CLAUDE.md

## Rencana fitur (urutan pengerjaan)
1. ✅ Scaffold & dokumentasi
2. ✅ Pipeline seni murni-kode (Pixmap, palet, ekspor PNG, font piksel, tileset, props)
3. ✅ Data dunia: worldgen 3 area, chunk, collision, preview PNG (tes keterjangkauan)
4. ✅ GameScene: streaming chunk, kamera halus, hero bergerak (keyboard) + tabrakan
5. ✅ Sprite hero + animasi (rig humanoid parametrik, 3 arah + flip)
6. ✅ Kontrol sentuh (joystick dinamis + tombol) + HUD (UIScene, dialog, banner, boss bar)
7. ✅ Kombat hero: kombo 3 hit, dodge roll, skill, hit-stop, shake, angka damage, slash/partikel, auto-aim, pickup heal
8. ✅ Musuh 1: Lendir Lumut (pengejar: hop → telegraf → terkam)
9. ✅ Musuh 2: Pemanah Duri (kiting, bidik bertelegraf, tembak duri)
10. ✅ Musuh 3: Kelelawar Kelam (kawanan mengitari, maks 2 penyelam bergiliran)
11. ⬜ Pencahayaan dinamis, siklus siang-malam, vignette, bloom
12. ⬜ Air & rumput beranimasi, partikel (debu/daun/air), parallax
13. ⬜ NPC + dialog + quest
14. ⬜ Puzzle dorong batu + gerbang
15. ⬜ Boss Kolosus Kelam
16. ⬜ Save/load, checkpoint, respawn
17. ⬜ Minimap + banner area
18. ⬜ Polesan performa & ringkasan akhir

## Catatan
- Verifikasi visual dilakukan lewat PNG hasil pipeline seni (`npm run assets`), karena browser headless tidak dipakai di VPS.

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
11. ✅ Pencahayaan dinamis (lightmap + halo aditif), siklus siang-malam (7 menit), vignette, bloom opsional, kualitas adaptif
12. ✅ Air & rumput beranimasi (rumput menyibak saat dilewati), partikel debu/daun/air, parallax (kanopi hutan, bayangan awan, debu gua)
13. ✅ NPC (4) + dialog (efek ketik) + quest "Cahaya untuk Desa" (tes transisi, Lentera Agung menyala di akhir)
14. ✅ Puzzle dorong batu ke pelat → gerbang terbuka (tes bisa diselesaikan; batu reset bila keluar ruangan)
15. ✅ Boss Kolosus Kelam (3 fase, pintu arena menutup, HP bar besar, ledakan kematian)
16. ✅ Save/load localStorage (autosave 30 dtk + event), checkpoint altar/Lentera, respawn, layar judul Lanjutkan/Main Baru
17. ✅ Minimap jendela 48x32 tile + banner nama area
18. ✅ Polesan: kualitas adaptif, smoke test terintegrasi (53 tes), dokumentasi, README

## Catatan
- Verifikasi visual dilakukan lewat PNG hasil pipeline seni (`npm run assets`), karena browser headless tidak dipakai di VPS.

## Status verifikasi (jujur)
- ✅ Terverifikasi otomatis: worldgen (keterjangkauan semua titik), collision, HeroCore, AI musuh/boss, quest, puzzle solvable, day/night, save round-trip,
  serta **seluruh alur GameScene+UIScene** lewat smoke test dengan Phaser palsu (jalan → kombat → dialog → puzzle → boss → save/load → respawn, tanpa kebocoran objek).
- ✅ Art diverifikasi visual lewat PNG hasil pipeline (`npm run assets`): tileset, prop, hero, NPC, musuh, boss, UI, font, dan seluruh dunia.
- ⚠️ Belum bisa diverifikasi di VPS (tanpa browser/GPU): tampilan WebGL nyata (lightmap MULTIPLY, bloom filter, halo aditif, partikel), 60 fps di HP,
  dan rasa kontrol sentuh. Bila ada yang aneh: coba `?bloom=0`, `?q=0`; error JS tampil di panel merah di bawah layar.

## Usulan Fase 2
1. **Audio**: SFX chiptune (WebAudio sintetis) + musik adaptif per area/boss.
2. **Progresi**: koin & loot, inventaris, upgrade pedang/skill, toko Bu Rengga, pohon skill.
3. **Konten dunia**: chunk baru (pantai, rawa, pegunungan), dungeon tambahan, chunk dibuat dari file Tiled/JSON lewat `WorldSource`, mini-boss & musuh elit.
4. **Cerita**: quest sampingan, dialog bercabang, jurnal, jadwal NPC, cutscene singkat saat boss.
5. **Pertarungan**: parry/counter, efek status (racun, beku), hero kedua/party switch, kombo cancel.
6. **Atmosfer**: cuaca (hujan/kabut), musuh khusus malam, bayangan dinamis dari pohon/rumah.
7. **Sistem**: menu pause + pengaturan (volume, tata letak tombol, kualitas), gamepad, multi-slot save, lokalisasi ID/EN.
8. **Performa & aset**: atlas PNG hasil ekspor + override buatan tangan, `SpriteGPULayer`/`TilemapGPULayer` bila perlu, uji perangkat nyata.

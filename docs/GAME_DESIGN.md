# Lentera Kelam — Ringkasan Desain

Open-world action RPG 2D top-down bergaya pixel art, terinspirasi rasa "petualangan ringan + aksi cepat" ala Guardian Tales,
tetapi dengan **visual lebih modern** (pencahayaan dinamis, partikel, bloom, palet lebih kaya).
Semua karakter, nama, cerita, dan aset **original** — tidak ada aset/nama/karakter dari Guardian Tales.

## Cerita singkat (original)

Desa Lentera hidup dari cahaya **Lentera Agung** di tengah desa. Suatu malam cahayanya padam: **Kolosus Kelam**, golem batu
purba di dasar Gua Kelam, terbangun dan menelan cahaya. Kabut gelap membuat hewan hutan menjadi buas.
**Arka**, penjaga lentera muda, membawa pedang pemantik dan Kristal Fajar dari Tetua Wulan untuk menyalakan Lentera Agung lagi.

## Target teknis

| Hal | Keputusan |
| --- | --- |
| Engine | Phaser 4 (stabil terbaru, `4.2.x`) + TypeScript + Vite |
| Target | Browser HP Android, **landscape**, 60 fps di HP kelas menengah |
| Kontrol | Sentuh: joystick virtual kiri; serang / dodge / skill kanan. Keyboard tetap didukung (WASD/panah, J/K/L, E) |
| Resolusi | Kanvas internal kecil (tinggi ≈ 270 px) di-scale **integer** lewat CSS `image-rendering: pixelated` → tajam & murah di GPU |
| Server | Vite dev di `127.0.0.1:5173`, diakses via Cloudflare Tunnel `https://game.varesa.mom` (HMR `wss`/443) |
| Batasan VPS | RAM 4 GB, tanpa swap/GPU → tanpa browser headless; verifikasi visual lewat ekspor PNG dari pipeline seni murni-kode |

## Visual

- Pixel art tajam (`pixelArt: true`), skala integer. Palet tunggal original (`src/art/palette.ts`), outline berwarna (bukan hitam pekat).
- Semua aset dibuat **lewat kode** (`src/art`), diberi struktur *sheet + nama frame* supaya bisa diganti PNG buatan tangan
  (lihat "Mengganti aset" di `CLAUDE.md`).
- Pencahayaan dinamis 2D: siklus siang-malam, cahaya obor / kristal / lentera, cahaya skill. Diimplementasikan sebagai *lightmap*
  resolusi-rendah (multiply) + glow aditif, plus vignette.
- Partikel: serangan, debu langkah, daun jatuh, percikan air. Efek ringan: bloom (opsional, otomatis mati bila FPS turun) + vignette.
- Game-feel: squash & stretch, hit-stop, screen shake, kedipan saat terkena, bayangan di bawah karakter, angka damage.
- Air dan rumput beranimasi; parallax (kabut/awan/dedaunan lapisan depan) untuk kesan kedalaman.

## Dunia

Dunia dibagi **chunk 16×16 tile** (tile 16 px → chunk 256 px). Chunk dimuat/dibuang berdasarkan posisi kamera (tanpa loading screen),
dan sumber chunk berada di balik antarmuka `WorldSource` sehingga dunia mudah diperluas.

Ukuran Fase 1: **8 × 5 chunk = 128 × 80 tile (2048 × 1280 px)**, tiga area tersambung mulus:

1. **Desa Lentera** (barat) — rumah, plaza dengan Lentera Agung, sumur, kolam, kebun. Titik awal + checkpoint.
2. **Hutan Bisik** (tengah) — pepohonan lebat, sungai dengan jembatan, semak berumput, jamur bercahaya. Musuh luar ruangan.
3. **Gua Kelam** (timur) — lorong gelap berobor, kristal, ruang puzzle (dorong batu ke tombol), gerbang, dan arena boss.

## Hero: Arka

- Jalan 8 arah (analog di sentuh), kecepatan ≈ 80 px/s.
- **Kombo 3 serangan** (tebasan kiri → kanan → tusukan lompat) dengan jendela sambung; hit ke-3 knockback besar.
- **Dodge roll** dengan i-frame singkat dan cooldown.
- **Skill: Ledakan Fajar** — semburan cahaya radial, damage + stun + knockback, cooldown ~7 dtk.
- HP bar, respawn di checkpoint terakhir, save/load ke `localStorage`.

## Musuh

| Musuh | Area | Perilaku |
| --- | --- | --- |
| **Lendir Lumut** | Desa tepi / hutan | *Pengejar*: mengejar, melompat menerkam, berhenti sejenak setelah menyerang |
| **Pemanah Duri** | Hutan / gua | *Penembak jarak jauh*: menjaga jarak (kiting), bidik dengan telegraf, tembak duri |
| **Kelelawar Kelam** | Gua (dan hutan malam) | *Penyerang berkelompok*: kawanan mengitari, satu-dua ekor menyelam bergiliran (koordinasi kawanan) |
| **Kolosus Kelam** (boss) | Ujung gua | 3 fase: hantaman + gelombang kejut, lemparan batu berpola, memanggil kelelawar. HP bar besar di atas layar |

Musuh dimunculkan per chunk (spawn point) dan respawn setelah beberapa menit waktu game.

## NPC, Quest, Puzzle

- NPC: **Tetua Wulan** (pemberi quest), **Bu Rengga** (tips kontrol/pandai besi), **Mita** (petunjuk puzzle), **Pak Jagat** (penjaga gerbang gua).
- Dialog dengan efek ketik + tombol lanjut.
- Quest tunggal **"Cahaya untuk Desa"**: bicara Tetua → kalahkan 6 musuh di hutan → kalahkan Kolosus Kelam → serahkan Kristal Fajar ke Tetua.
- Puzzle: di pintu masuk gua, **dorong batu ke pelat tombol** → gerbang ke lorong boss terbuka.

## Sistem

- Kamera halus mengikuti hero (lerp + look-ahead, dibatasi batas dunia).
- Minimap sederhana (jendela di sekitar hero, penanda quest/NPC).
- Save/load `localStorage` (posisi, HP, quest, puzzle, boss, waktu dunia); autosave saat berganti area/quest dan tiap 30 dtk.
- Kualitas adaptif: bila FPS rata-rata < ~48, efek berat (bloom → partikel) dikurangi otomatis.

## Ide Fase 2 (usulan)

Lihat bagian akhir `docs/PROGRESS.md`.

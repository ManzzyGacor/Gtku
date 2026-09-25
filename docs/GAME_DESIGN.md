# Lentera Malam — Ringkasan Desain

Open-world action RPG **3D pixel-art** untuk browser HP Android (landscape): petualangan ringan dan
aksi cepat, dengan pencahayaan dinamis, kabut, bloom, dan outline pixel. Semua karakter, nama,
cerita, dan aset **original**; seluruh gambar, geometri, musik, dan suara dihasilkan lewat kode.

Rencana induk: `docs/OVERHAUL.md`. Naskah: `docs/STORY.md`. Status & cara tes: `docs/PROGRESS.md`.
Server: `docs/BACKEND.md`.

## Cerita singkat

Desa Ravenhollow hidup dari cahaya **Lentera Agung**. Elemen dunia mulai tidak stabil, monster makin
agresif, dan lentera meredup: **Kolosus Kelam** terbangun di dasar gua dan menelan cahayanya. Tokoh
utama — namanya dipilih pemain (naskah memanggilnya Arka, tapi game tidak pernah) — punya ikatan
khusus dengan Lentera, dan game dibuka dengan prolog tentang kehilangan yang berhubungan dengannya.

## Teknis

| Hal | Keputusan |
| --- | --- |
| Engine | Three.js 0.186 (WebGL2) + TypeScript 7 + Vite 8, tanpa engine game |
| Tampilan | Kamera ortografik 3/4 sudut tetap; dunia dirender ke buffer kecil (270–540 baris) lalu diperbesar tajam, dengan outline dari kedalaman, bloom, grading warna |
| Target | HP Android kelas menengah, 60 fps; AUTO menurunkan komponen satu per satu bila perlu |
| Kontrol | Sentuh (joystick tetap + tombol kontekstual); keyboard didukung; gamepad bukan prioritas |
| Logika | `src/core` murni (tanpa renderer) → dites di Node, termasuk playthrough headless |

## Dunia

Chunk 16×16 tile (tile 16 px), dialirkan sesuai kamera. Tiga area bersambung tanpa loading screen:

1. **Ravenhollow** — desa, alun-alun dengan Lentera Agung, shrine, boneka latihan, rumah, kolam.
2. **Hutan Noctis** — pepohonan lebat, sungai & jembatan, jamur bercahaya.
3. **Gua Lumen** — lorong berobor, kristal, puzzle dorong batu, arena boss.

Siklus siang-malam dan cuaca (cerah, berkabut, hujan, badai). Tanah tiap area bisa datang dari
**paket data area** yang diunduh (Download Manager) supaya HP tidak memanggangnya sendiri.

## Tokoh utama

- Jalan 8 arah; **guling** dengan i-frame; **skill Ledakan Lentera** (membawa elemen sekunder).
- **Pedang**: kombo 3 tebasan + serangan berat (tahan). **Busur**: tarik untuk mengisi — tembakan
  cepat, terisi, dan tembus (charge penuh); garis bidik, cincin target, panah menancap.
- **Inti Lentera** memberi elemen + passive. Elemen primer (serangan senjata) dan sekunder (skill).
  Empat elemen aktif: Api, Air, Es, Petir; reaksi antar elemen (mis. Api + Es → Lebur).
- Level & EXP, 8 slot perlengkapan, 6 rarity (Biasa → Mitos) yang memengaruhi stats. Perlengkapan
  **terlihat** di model: helm, pelindung bahu, sarung tangan, sepatu, gagang pedang, warna lentera.
- Satu formula damage untuk semua serangan (ATK, DEF, crit, elemen, reaksi, lifesteal).

## Musuh

| Musuh | Perilaku |
| --- | --- |
| **Lendir** | pengejar, menerkam, jeda setelah menyerang |
| **Pemanah Duri** | menjaga jarak, telegraf, menembak duri |
| **Kelelawar** | kawanan mengitari, menyelam bergiliran |
| **Kolosus Kelam** (boss) | 3 fase: hantaman + gelombang kejut, lemparan batu berpola, memanggil kelelawar |
| **Boneka latihan** | tidak mati; menampilkan status elemen aktif |

## Cerita, quest, event

- **Tutorial "Bara Pertama"**: berdoa di shrine → Inti Bara + elemen Api → uji pada boneka.
- **Quest utama "Cahaya untuk Desa"**: tetua → berburu di hutan → puzzle gua → boss → nyalakan lentera.
- Cutscene dijalankan engine (kamera, dialog, cahaya, suara), selalu bisa dilewati, bisa diputar ulang.
- **World event** (data): Invasi Monster, Badai Elemen, Kabut Misterius, Pedagang Keliling (lapak
  berkoin), Malam Purnama — muncul sendiri setelah tutorial, satu per satu, dengan cooldown.
- Peti, papan, dan shrine memberi EXP penemuan; musuh memberi EXP, koin, dan kadang barang.

## Antarmuka

- **Layar judul**: malam 3D di sekitar Lentera Agung, lagu tema, "Sentuh untuk memulai" → **Masuk /
  Daftar (wajib)** → Lanjutkan · Main Baru · Pengaturan · Akun · Kredit.
- HUD: HP/energi/level kiri atas, minimap kanan atas, objektif + baris event di tengah atas,
  joystick kiri bawah, tombol aksi kanan bawah; tombol interaksi muncul dengan label sesuai objek.
- Menu jeda (Lanjut, Inventaris, Karakter, Senjata, Skill, Quest, Peta, Pengaturan, Simpan & Keluar),
  panel Karakter dengan **avatar 3D langsung**, tas grid per kategori.
- **Pengaturan**: Grafik (AUTO → Ultra + 10 komponen), Kamera, Kontrol, Tampilan, Audio (5 kategori),
  Combat (±65 angka), Cutscene, Data (Download Manager, hapus data dunia, reset save), Diagnostik.
- Layar penuh otomatis saat landscape (atau tombol "Layar Penuh"), kunci orientasi bila didukung.
- Semua panel menghormati safe area; diuji di 2318×759 dengan teks 2x dan tombol 1,3x.

## Save & akun

Autosave lokal per akun; save lama dimigrasi. Akun lokal (kata sandi di-hash PBKDF2, peringatan
jelas bahwa hanya di perangkat ini) sampai server ada; lalu akun server + sinkronisasi save dengan
revisi dan penyelesaian konflik berdasarkan progres (`docs/BACKEND.md`).

## Audio

Semua disintesis WebAudio: musik per area + tema judul + boss + prolog (sebagai data), suasana
(angin, serangga, tetes gua, api), efek tempur & UI. Lima bus volume terpisah.

## Pengujian di HP

Pemain tidak punya PC: Pengaturan → Diagnostik → **Salin laporan** (perangkat, FPS, keputusan AUTO,
data area, error), `?fps=1`, dan **Mode Pengembang** (`?debug=1` atau ketuk nomor versi 5 kali;
tidak ada di build rilis).

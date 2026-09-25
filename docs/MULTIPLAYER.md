# Multiplayer co-op

**Rencana:** co-op berbasis *room*. Dunia utama tetap pribadi (tiap pemain punya dunianya sendiri, save
sendiri). Pemain bertemu lewat **Papan Misi** di Desa Lentera (alun-alun Ravenhollow, dekat Lentera
Agung) untuk melawan boss bersama, **maksimal 4 pemain** per room.

**Status:** tahap 1 dan 2 selesai: koneksi WebSocket + sinkron posisi, lalu **satu boss co-op yang bisa
dimainkan: Bayang Kolosus**. Belum ada: boss/misi lain, obrolan, emote, pemulihan setelah server restart.

## 1. Arsitektur

```
HP (game)                               VPS (server/)
─────────                               ─────────────
Papan Misi → CoopPanel ──┐
Coop3D (gambar) ◄─ CoopClient ◄─ wss://api.varesa.mom/ws ─► coop/ws.ts ─► RoomManager ─► CoopSim (20 Hz)
                  (prediksi,              (auth, batas)            (room, loot)   (shared/coop/sim.ts)
                   interpolasi)
```

| File | Isi |
| --- | --- |
| `shared/coop/protocol.ts` | pesan, validasi ketat, konstanta (tick, batas, kode room, teks galat) |
| `shared/coop/sim.ts` | **simulasi pertarungan** — dipakai server; gerakannya (`stepMovement`) juga dipakai prediksi klien |
| `server/src/coop/rooms.ts` | room, lobby, sambung ulang, penutupan, loot |
| `server/src/coop/ws.ts` | pintu WebSocket: origin, auth, batas ukuran & laju, heartbeat |
| `src/core/coop/client.ts` | klien: input hemat, prediksi + rekonsiliasi, interpolasi, sambung ulang |
| `src/render3d/Coop3D.ts` | arena, pemain, boss, telegraf, bara — hanya menggambar |
| `src/ui/CoopPanel.ts` | panel Papan Misi: buat/gabung room, lobby, hasil; strip party saat bertarung |
| `src/render3d/Game3D.ts` | papan → panel → arena (dunia berhenti), kamera, kontrol, hasil ke save |

## 2. Server yang menentukan

Klien **hanya** mengirim: stik (−100..100), arah bidik (derajat), tombol (serang/guling/skill),
nomor urut. Pesan dengan field lain — misalnya `dmg` — ditolak. Semuanya ditentukan server:

- posisi semua pemain (klien hanya *memprediksi* posisinya sendiri; server selalu menang),
- posisi, pilihan serangan, dan HP boss,
- kena/tidaknya setiap serangan dan **besar damage** (dari level & rarity senjata di **save yang
  tersimpan di server**, bukan dari klien; `devStats` tidak berlaku di co-op),
- jatuh/bangkit, menang/kalah,
- **loot**: diroll server, **ditulis server ke save** pemain, baru dikirim ke game bersama save barunya.

## 3. Pertarungan: Bayang Kolosus

- Arena bundar (radius 170 px) dengan 4 pilar; arena berada di luar peta dunia.
- HP boss = 2600 × (0,6 + 0,4 × jumlah pemain).
- Fase 1: **slam** (lingkaran merah di tempatmu berdiri) dan **sweep** (kipas oranye di depannya).
  Fase 2 (< 66%): + **hujan bara** (cincin proyektil). Fase 3 (< 33%): + **terjangan**.
- Semua serangan boss punya telegraf; **berguling** menembus semuanya.
- Pemain yang HP-nya habis **jatuh**, bangkit sendiri setelah 8 dtk (lebih cepat kalau teman berdiri
  di dekatnya). Kalah hanya bila semua jatuh bersamaan.
- Menang: +150 EXP, +120 koin, satu perlengkapan/Inti (Langka 50%, Epik 35%, Legendaris 13%, Mitos 2%)
  + 2 Serpihan Fajar — per pemain.
- Kontrol sama dengan dunia: joystick, TEBAS (serang), GESER (guling), SKILL. Diam = otomatis
  membidik boss.

## 4. Jaringan seluler (ping 50–150 ms)

- **Prediksi** posisi sendiri dengan kode gerak yang sama dengan server, **rekonsiliasi** saat
  snapshot mengakui input (`ack`): mulai dari posisi server, ulangi input yang belum diakui; beda kecil
  dihaluskan (~0,2 dtk), beda besar langsung dipindah.
- **Interpolasi** pemain lain dan boss 150 ms di belakang snapshot terbaru.
- **Hemat kuota**: input dikirim hanya saat berubah + detak tiap 0,25 dtk (maks 20/dtk, ±40 byte);
  snapshot 10/dtk, < 0,9 KB untuk room penuh (dijaga tes) → ± 5–8 KB/dtk turun, < 1 KB/dtk naik.
- **Ringan untuk VPS 4 GB**: satu timer 20 Hz untuk semua room; simulasi kecil tanpa alokasi besar.

## 5. Room

- **Privat**: dibuat dengan tombol, dapat **kode 5 huruf** (tanpa 0/O/1/I/L), siapa pun dengan kode bisa
  masuk selama masih di lobby. **Publik**: "Cari room publik" mengisi room publik yang ada dulu.
- Pembuat room memulai setelah semua pemain lain **siap**.
- **Putus koneksi**: tempatmu disimpan 30 dtk (heromu diam dan tetap bisa kena); game menyambung
  sendiri dengan jeda bertambah dan kembali ke room dengan **token room** (orang lain tidak bisa
  memakai token itu).
- **Room kosong** (tidak ada yang tersambung) ditutup setelah 30 dtk.
- **Akun pengembang hanya boleh room privat**: tidak bisa Cari room publik, tidak bisa masuk kode room
  publik. Save pengembang tetap ditandai `devSave`.

## 6. Keamanan

- `wss://` lewat Cloudflare Tunnel; upgrade ditolak bila `Origin` bukan `https://game.varesa.mom`.
- Pesan pertama wajib `auth` dengan access token yang sama dengan REST (tanda tangan, kedaluwarsa,
  sesi masih hidup) dalam 5 dtk; token tidak pernah di URL.
- Pesan maks 512 byte, diurai ketat; > 40 pesan/dtk → diputus.
- Heartbeat ping/pong tiap 15 dtk menutup koneksi yang mati diam-diam.
- Satu soket per akun; soket baru menggantikan yang lama.

## 7. Tes

`tests/coopsim.test.ts` (simulasi: gerak, kena/meleset, telegraf, skala HP, **satu pertarungan penuh
dimainkan bot dan menang, deterministik**, kalah bila semua jatuh), `server/tests/coop.test.ts` (aturan
room, pengembang, sambung ulang, token curian, room kosong, snapshot & loot, **soket sungguhan**),
`server/tests/coop-e2e.test.ts` (dua klien sungguhan: kode room, gerak bersama, prediksi vs server,
sambung ulang, menang + loot), `server/tests/coop-game.test.ts` (**dua game sungguhan** di satu room:
papan misi, arena, boss, loot masuk tas), `tests/cooppanel.test.ts`.

## 8. Cara tes di HP (dua tab)

1. Pastikan server berjalan (`curl -s https://api.varesa.mom/health`).
2. Tab 1: masuk akun A → jalan ke **Papan Misi** di alun-alun (tanda oranye di minimap) → **Papan Misi**
   → **BUAT ROOM PRIVAT** → catat kodenya.
3. Tab 2: masuk akun **B** (akun lain) → Papan Misi → ketik kode → **GABUNG** → **SIAP**.
4. Tab 1: **MULAI**. Ganti-ganti tab: kedua hero terlihat di kedua tab, boss mengejar yang paling
   banyak memukulnya.
5. Tes putus: di tab 2 nyalakan mode pesawat 5–10 dtk lalu matikan → "menyambung kembali…" → kembali.
6. Menang → layar hasil dengan loot → **KEMBALI KE DESA** → cek tas: barangnya ada.

Catatan: browser HP sering menidurkan tab yang tidak terlihat; hero di tab itu akan diam (dan tetap
bisa kena) — itu perilaku yang benar, bukan bug.

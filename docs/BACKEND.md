# Backend — akun & save Lentera Malam

Server akun dan sinkronisasi save untuk game. **Node.js + TypeScript + Fastify + MongoDB**, di
folder `server/`, berjalan di VPS ini pada `127.0.0.1:3000` dan dibuka ke internet hanya lewat
Cloudflare Tunnel sebagai **`https://api.varesa.mom`**. Tipe data yang dipakai bersama game dan
server ada di `shared/api.ts`.

## 1. Menjalankan

```bash
cd server
npm install                      # sekali saja
cp .env.example .env             # lalu isi nilainya (lihat §2) — file ini tidak pernah di-commit
chmod 600 .env
npm start                        # atau: npm run dev (memuat ulang saat kode berubah)
```

Jalankan di sesi tmux bernama **`api`**, sama seperti dev server game di sesi `game`:

```bash
tmux new-session -d -s api -c /home/dev/projects/Gtku/server "npm start"
tmux capture-pane -t api -p | tail        # lihat log
curl -s http://127.0.0.1:3000/health      # {"ok":true,"db":"ok"}
```

Kalau ada yang salah, server berhenti dengan pesan yang menyebut **nama** masalahnya, tidak pernah
isinya: `Variabel MONGODB_URI belum diisi di server/.env`, atau `Tidak bisa terhubung ke MongoDB
(MongoServerSelectionError). Periksa MONGODB_URI…`.

Tes (tanpa database, tanpa jaringan): `npm test` di akar repo menjalankan `server/tests/` (API
lewat `app.inject()` dengan penyimpanan di memori) dan `tests/backend.test.ts` (adapter game
melawan app server yang sama). Typecheck server: `cd server && npm run typecheck`.

## 2. Variabel `.env`

Semua rahasia **hanya** ada di `server/.env` di VPS. `.gitignore` mengabaikan `.env` dan `.env.*`
(kecuali `.env.example`, yang hanya berisi nama variabel tanpa nilai).

| Variabel | Wajib | Isi |
| --- | --- | --- |
| `MONGODB_URI` | ya | Connection string MongoDB. Server hanya membacanya dari `process.env` dan tidak pernah menulisnya ke log, pesan error, atau dokumen. |
| `JWT_SECRET` | ya | Rahasia penanda access token (HS256), **minimal 32 karakter acak**. Buat dengan `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Mengganti nilainya membuat semua access token lama tidak berlaku (pemain cukup di-refresh otomatis). |
| `MONGODB_DB` | tidak | Nama database (bawaan `lentera_malam`). |
| `CORS_ORIGIN` | tidak | Origin game yang boleh memanggil API (bawaan `https://game.varesa.mom`). |

## 3. Endpoint

Semua JSON. Galat selalu berbentuk `{ "error": "<kode>" }` — tidak pernah stack trace atau pesan
driver. Kode-kodenya ada di `shared/api.ts` (`ApiErrorCode`) beserta teks bahasa Indonesianya.

| Metode & jalur | Autentikasi | Body | Jawaban |
| --- | --- | --- | --- |
| `GET /health` | — | — | `{ ok, db: "ok" \| "down" }` |
| `GET /auth/check-username?username=` | — | — | `{ available: true }` atau `{ available: false, reason }` |
| `POST /auth/register` | — | `{ username, password, email? }` | `201 { accessToken, expiresIn, user }` + cookie refresh |
| `POST /auth/login` | — | `{ username, password }` | `200 { accessToken, expiresIn, user }` + cookie refresh |
| `POST /auth/refresh` | cookie | — | `200 { accessToken, expiresIn, user }` + cookie baru (rotasi) |
| `POST /auth/logout` | cookie | — | `204`, sesi dicabut (access token ikut mati), cookie dihapus |
| `GET /auth/me` | Bearer | — | `{ username, role }` |
| `GET /save` | Bearer | — | `200 { data, saveVersion, rev, updatedAt }` atau `204` |
| `PUT /save` | Bearer | `{ data, baseRev, clientUpdatedAt? }` | `200 { rev, updatedAt }` · `409 { error: "conflict", current }` · `413` · `422 { error: "save_rejected", reason, detail }` |
| `POST /dev/action` | Bearer, peran `dev` | `{ action, save? }` | `200 { ok, note?, save? }` · `403 forbidden` · `400` |

`user` = `{ username, role }`, `role` = `"player"` atau `"dev"`.

### Aturan input

- **username:** 3–16 karakter, hanya huruf, angka, dan `_`. Unik tanpa membedakan huruf besar-kecil
  (`Pemain` dan `pemain` adalah nama yang sama) — dijaga **unique index** pada `usernameLower`.
- **password:** 8–128 karakter. **email:** opsional, format email wajar, ≤ 254.
- Setiap body divalidasi skema **ketat**: field yang tidak dikenal ditolak (bukan dibuang diam-diam),
  tipe tidak dikonversi otomatis. Body maksimal ± 272 KB.

## 4. Keamanan

**Password.** Di-hash dengan **argon2id** (19 MiB, 2 iterasi, 1 lajur — batas bawah rekomendasi
OWASP), salt acak per akun di dalam hash. Tidak pernah disimpan atau dikirim balik; jawaban API
tidak pernah memuat hash. Login untuk nama yang tidak ada tetap memverifikasi hash tiruan, jadi
waktu jawabannya tidak membocorkan nama mana yang terdaftar, dan pesannya sama.

**Token.**
- **Access token** (JWT HS256, 15 menit) dikirim di JSON dan disimpan game **di memori saja** —
  tidak pernah di `localStorage`.
- **Refresh token** (acak 256 bit, 30 hari) hanya sebagai cookie
  `lm_refresh; HttpOnly; Secure; SameSite=Strict; Path=/auth` — JavaScript tidak bisa membacanya.
  Di database hanya **hash SHA-256**-nya. Setiap `/auth/refresh` **merotasi** token; memakai token
  lama yang sudah dirotasi mencabut seluruh sesi login itu (tanda token disalin).
- `game.varesa.mom` dan `api.varesa.mom` satu *site* (`varesa.mom`), jadi cookie SameSite=Strict tetap
  terkirim dari game ke API.
- Yang disimpan game di `localStorage` hanya **siapa** yang masuk (nama, peran terakhir) supaya layar
  judul bisa langsung ke menu dan game bisa dimainkan offline.

**CORS & CSRF.** CORS hanya mengizinkan `https://game.varesa.mom` (dengan kredensial). Endpoint
yang memakai cookie (`/auth/refresh`, `/auth/logout`) juga menolak header `Origin` lain.

**Batas laju** (per IP asli dari header `CF-Connecting-IP`, karena di belakang tunnel semua koneksi
datang dari 127.0.0.1):
- login: 20/menit per IP, dan **5/menit per (IP, akun)**;
- register: 5 per 10 menit per IP; cek nama: 30/menit; refresh: 60/menit; `PUT /save`: 12/menit.

**Tidak ada rahasia di klien.** Bundle game hanya tahu alamat API. `MONGODB_URI` hanya dibaca dari
`process.env`; pesan error dan log melewati `redact()` yang menghapus apa pun yang berbentuk
connection string MongoDB. Log Fastify menyamarkan header `Authorization`, `Cookie`, `Set-Cookie`.

**Bind 127.0.0.1.** Server tidak mendengarkan antarmuka publik; satu-satunya jalan masuk adalah
Cloudflare Tunnel.

## 5. Peran & Mode Pengembang

Mode Pengembang hanya untuk akun **`manzzy`**, yang tersimpan dengan `role: "dev"` di database.
**Server yang memutuskan; klien hanya mengikuti.**

**Nama dilindungi.** `manzzy`, `admin`, `dev`, `moderator`, `gm`, dan `system` ditolak saat register
(`username_reserved`), apa pun huruf besar-kecilnya, ada atau belum ada akunnya. Akun `manzzy` hanya
bisa dibuat dari VPS:

```bash
cd server && npm run create-dev-account
```

Skrip itu meminta kata sandi **tanpa menampilkannya** (tidak masuk layar, riwayat shell, atau
daftar proses), lalu membuat akun `manzzy` dengan peran `dev` — atau, kalau sudah ada, mengatur
perannya ke `dev` dan mengganti kata sandinya. `npm run set-role -- <nama> <dev|player>` tetap ada.

**Klien.** Panel pengembang dan penanda **DEV** di HUD hanya muncul bila server menjawab
`role: "dev"` di sesi itu (`/auth/me` setelah login). Tidak ada pintu lain: `?debug=1`, ketuk nomor
versi, tombol lewati login, dan flag build sudah **dihapus**. Peran tidak pernah disimpulkan dari
teks nama di klien, dan peran yang tersimpan di `localStorage` tidak dihitung (jadi offline pun tidak
membukanya). Setelan Combat dan Uji performa di Pengaturan juga hanya tampil untuk pengembang.

**Setiap aksi lewat server** — `POST /dev/action` (Bearer), ditolak `403 forbidden` untuk akun yang
perannya di database bukan `dev` (dan percobaannya dicatat). Aksi divalidasi ketat
(`shared/devActions.ts`) dan dicatat di log server (`aksi pengembang`, dengan nama akun dan aksinya).

| Jenis | Aksi | Yang terjadi |
| --- | --- | --- |
| Hadiah (mengubah save) | beri item/equipment/senjata (rarity apa pun), semua Inti Lentera, set perlengkapan Legendaris, atur koin, atur level, tambah EXP, buka semua elemen, atur elemen primer/sekunder, atur stats bebas (`devStats`), reset status cutscene, reset save | **Server** menerapkannya pada save, menyimpan, dan mengembalikan save baru; game hanya memakai save dari server |
| Alat sesi | mode kebal, teleport, jam, cuaca, munculkan musuh/boneka, hapus musuh, pulihkan HP, mulai/akhiri event | server mengizinkan & mencatat; game menjalankannya setelah jawaban "ya" |

Offline, tidak ada aksi yang jalan ("Server tidak bisa dihubungi").

**Save pengembang ditandai.** Setiap save akun pengembang diberi `devSave: true` oleh server dan
`characters.dev = true` di database, apa pun yang dikirim klien. Akun biasa yang mengirim `devSave`
atau `devStats` ditolak. Room co-op publik tidak menerima save pengembang (docs/MULTIPLAYER.md).

**Save pemain divalidasi** (`shared/saveRules.ts`, katalog di `shared/catalog.ts` yang dijaga tes agar
sama dengan katalog game):
- *integritas*: hanya item yang ada, rarity sah, jumlah ≤ tumpukan, perlengkapan di slot yang benar,
  level 1–30 dan EXP sesuai kurva, koin dalam batas, elemen hanya dari Inti Lentera yang dimiliki,
  tidak ada field pengembang;
- *laju progres* (dibanding save yang sudah di server): per tulis maksimal +3 level, +5.000 koin,
  30 barang baru, 3 barang Legendaris/Mitos baru — **ditambah** sesuai waktu sejak tulis terakhir
  (mis. +1 level per 4 menit), jadi main lama offline tetap bisa tersinkron. Tulis pertama (impor
  progres HP) hanya dicek integritasnya.
- Ditolak → `422 save_rejected` dengan alasan; game memberi tahu sekali dan menyimpan progres itu di
  HP saja.

**Batas yang jujur.** Save tetap dibuat oleh game di HP, jadi pemain yang mengubah save sedikit demi
sedikit di bawah batas per-tulis masih bisa lolos. Menutup itu butuh progres yang dimiliki server —
dan itulah yang dilakukan room co-op: HP boss, damage, dan loot ditentukan server.

## 6. Data (MongoDB)

**`users`** — `username` (tampilan), `usernameLower` (**unique index** `username_unik`),
`passwordHash` (argon2id), `email` (opsional), `role` (`player`/`dev`), `createdAt`, `lastLogin`.

**`sessions`** — `tokenHash` (unique), `userId`, `family`, `expiresAt` (**TTL index**: sesi kedaluwarsa
terhapus sendiri), `revokedAt`, `createdAt`.

**`characters`** — satu dokumen per karakter, unique `(userId, slot)` (sekarang slot 0):
`data` (save lengkap game: posisi, level & EXP, stats, tas, perlengkapan, elemen, quest, flag
dunia, event, cutscene), `saveVersion` (= `data.v`), `rev`, `level` (disalin untuk kueri),
`updatedAt` (waktu server), `clientUpdatedAt` (waktu HP, hanya informasi), `createdAt`.

Index dibuat otomatis saat server mulai (`ensureIndexes`).

## 7. Sinkronisasi save

- **Lokal dulu, selalu.** Game tetap menulis save ke HP. Setiap save juga masuk antrean dan dikirim
  paling sering tiap 20 detik, saat kembali online (`online`), dan saat halaman disembunyikan.
- **Versi:** `PUT /save` membawa `baseRev`. Server menulis hanya bila revisinya masih `baseRev`
  (operasi atomik `findOneAndUpdate`), lalu `rev + 1`. Kalau tidak → `409` dengan salinan server.
- **Konflik** diputuskan game (`resolveConflict`): **progres** dulu (boss → tahap quest → level →
  EXP), lalu **waktu** sebagai pemecah seri (waktu tulis HP vs `updatedAt` server). Salinan yang kalah
  disimpan sebagai cadangan (`lentera-malam/save-backup@<akun>`). Kalau salinan server menang saat
  bermain, game berhenti mengirim dan meminta muat ulang.
- **Setelah masuk:** game mengambil save server; kalau lebih jauh, dipakai; kalau save HP lebih jauh,
  dikirim. Semuanya dibatasi waktu (8 detik) — menu selalu muncul.
- **Offline:** game main dari save di HP, menampilkan pemberitahuan, dan menyinkronkan otomatis nanti.
  Server tidak bisa dihubungi saat login → pesan "Server tidak bisa dihubungi…", form tetap bisa dipakai.
- **Sesi berakhir** (logout di tempat lain, token dicabut) → kembali ke form masuk dengan pesan.

## 8. Integrasi game

| File | Isi |
| --- | --- |
| `shared/api.ts` | tipe, aturan nama/sandi, kode & teks galat — dipakai game **dan** server |
| `src/core/account/auth.ts` | `AuthAdapter` (tidak berubah bentuknya) |
| `src/core/account/remote.ts` | `RemoteAuth`: token di memori, refresh lewat cookie, timeout 10 dtk, cek nama |
| `src/core/account/local.ts` | `LocalAuth` untuk tes tanpa server (`VITE_API_URL=local`) |
| `src/core/sync/saveSync.ts` | `RemoteSaveStore` + `SaveSync` |
| `src/cloud.ts` | menyambungkan akun setelah login: peran, save, antrean sinkron (dibatasi waktu) |
| `src/main.ts` | memilih adapter: bawaan `https://api.varesa.mom`; `VITE_API_URL=local` = akun di HP |

## 9. Yang harus dilakukan di VPS & Cloudflare

1. **MongoDB:** buat database (mis. MongoDB Atlas, tier gratis cukup). Buat user database khusus
   aplikasi dengan hak `readWrite` hanya pada database `lentera_malam`. Di Network Access Atlas,
   izinkan IP publik VPS ini saja.
2. **`server/.env`:** `cp server/.env.example server/.env`, isi `MONGODB_URI` dan `JWT_SECRET`
   (perintah pembuatnya di §2), `chmod 600 server/.env`.
3. **Akun pengembang:** `cd server && npm run create-dev-account` (kata sandi diketik tanpa tampil).
4. **Jalankan:** `tmux new-session -d -s api -c /home/dev/projects/Gtku/server "npm start"`,
   cek `curl -s http://127.0.0.1:3000/health`.
5. **Cloudflare Tunnel:** tambahkan public hostname **`api.varesa.mom` → `http://127.0.0.1:3000`**
   pada tunnel yang sama dengan `game.varesa.mom` (Zero Trust → Networks → Tunnels → tunnel →
   Public Hostname → Add; atau `ingress` di `config.yml` cloudflared lalu restart cloudflared).
   DNS CNAME dibuat otomatis oleh dashboard.
6. **Cloudflare, disarankan:** SSL/TLS mode *Full*; *Always Use HTTPS*; jangan aktifkan cache untuk
   `api.varesa.mom` (semua jawaban API memang tidak boleh di-cache). Rate limiting rule opsional di
   Cloudflare sebagai lapis kedua untuk `/auth/login` dan `/auth/register`.
7. **Uji di HP:** buka game → Daftar → main → buka di browser lain → Masuk → progres sama.

## 10. Belum ada

- Lupa sandi lewat email (email opsional sudah disimpan; butuh layanan kirim email).
- Ganti kata sandi, hapus akun, dan daftar sesi aktif.
- Menampilkan cadangan save di menu Akun untuk dipulihkan manual.
- Progres yang sepenuhnya dimiliki server di dunia utama (lihat batas jujur di §5).

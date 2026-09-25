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
| `DEV_SETUP_CODE` | tidak | Kode untuk mendaftarkan akun pengembang `manzzy` lewat API (§5). Kosong = nama itu tidak bisa didaftarkan lewat API. Hapus lagi setelah dipakai. |

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
| `POST /auth/logout` | cookie | — | `204`, sesi dicabut, cookie dihapus |
| `GET /auth/me` | Bearer | — | `{ username, role }` |
| `GET /save` | Bearer | — | `200 { data, saveVersion, rev, updatedAt }` atau `204` |
| `PUT /save` | Bearer | `{ data, baseRev, clientUpdatedAt? }` | `200 { rev, updatedAt }` · `409 { error: "conflict", current }` · `413` · `422` |

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

Mode Pengembang hanya untuk akun **`manzzy`**, disimpan sebagai `role: "dev"` di database. **Server
yang memutuskan**:

- Mendaftar dengan nama `manzzy` ditolak (`username_reserved`) kecuali body menyertakan
  `devSetupCode` yang sama dengan `DEV_SETUP_CODE` di `.env`. Tanpa ini, orang pertama yang kebetulan
  mendaftar "manzzy" akan mendapat mode pengembang.
- Cara lain (tanpa kode): daftarkan akun biasa, lalu di VPS: `cd server && npm run set-role -- manzzy dev`
  (butuh akses shell ke server — itulah kuncinya).
- Game hanya membuka Mode Pengembang bila **server** menjawab `role: "dev"` di sesi itu
  (`/auth/me` setelah masuk). Peran yang tersimpan di `localStorage` tidak dihitung, jadi mengedit
  storage atau bermain offline tidak membukanya. Build rilis tetap tidak membawa kode menunya sama
  sekali (`tests/devmode.test.ts`).
- Batas yang jujur: isi save dibuat oleh game di HP pemain, jadi server tidak bisa membuktikan item
  di dalamnya "sah". Yang dijaga server: siapa yang boleh membaca/menulis save mana, bentuk dan
  ukuran save, versi, dan peran. Untuk ekonomi yang tidak bisa dicurangi, logika itu harus pindah
  ke server (belum).

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
3. **Akun pengembang:** isi `DEV_SETUP_CODE` sementara, daftar sebagai `manzzy` dengan kode itu
   (atau daftar biasa lalu `npm run set-role -- manzzy dev`), lalu kosongkan lagi kodenya.
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
- Validasi isi save yang lebih dalam di server (lihat batas jujur di §5).

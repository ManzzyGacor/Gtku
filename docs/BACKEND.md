# Backend — akun & sinkronisasi save

Status: **dirancang, belum dibangun.** Sisi klien sudah siap dan dites terhadap tiruan API ini
(`tests/backend.test.ts`). Selama server belum ada, game memakai akun **lokal** (`LocalAuth`), dan
layar Daftar mengatakan dengan jelas bahwa akun hanya tersimpan di perangkat ini.

## 1. Prinsip

1. **Klien tidak menyimpan rahasia apa pun.** Tidak ada API key di bundle. Yang diketahui klien
   hanya alamat API (`VITE_API_URL`). Sesi = cookie `HttpOnly; Secure; SameSite=Strict` yang tidak
   bisa dibaca JavaScript. Yang disimpan klien di `localStorage` hanya *siapa* yang masuk
   (`id`, `name`) untuk ditampilkan di menu.
2. **Save lokal lebih dulu, selalu.** Game tetap menulis save ke HP seperti sekarang; sinkronisasi
   hanya cermin di belakangnya. Bermain offline tidak kehilangan apa pun.
3. **Revisi, bukan jam.** Setiap save di server punya nomor revisi. Konflik diputuskan berdasarkan
   **progres** (boss → tahap quest → level → EXP → waktu main), bukan waktu tulis, karena jam HP
   bisa salah. Salinan yang kalah **tidak dibuang**: disimpan sebagai cadangan.
4. **Adapter bisa diganti.** Semua akses akun lewat `AuthAdapter` (`src/core/account/auth.ts`) dan
   semua akses save server lewat `SaveStore` (`src/core/sync/saveSync.ts`). Mengganti lokal → server
   adalah satu variabel build, bukan perubahan di layar.

## 2. Yang sudah ada di klien

| File | Isi |
| --- | --- |
| `src/core/account/auth.ts` | `AuthAdapter`, aturan nama akun & kata sandi |
| `src/core/account/local.ts` | `LocalAuth`: PBKDF2-SHA-256 310 000 iterasi, salt per akun, tanpa plaintext |
| `src/core/account/remote.ts` | `RemoteAuth`: API di bawah, cookie sesi, pesan galat berbahasa Indonesia |
| `src/core/sync/saveSync.ts` | `RemoteSaveStore`, `SaveSync` (antrian, jeda 20 dtk, offline, konflik), `resolveConflict` |
| `src/core/save.ts` | save per akun (`save/v1@<akun>`), `setSaveMirror`, `adoptSave` |
| `src/main.ts` | memilih adapter: `VITE_API_URL` ada → server, tidak ada → lokal |

Menyalakan server nanti: build dengan `VITE_API_URL=https://game.varesa.mom/api npm run build`.

## 3. API

Semua di bawah `/api/v1`, JSON, `credentials: include`. **Satu origin dengan game**
(`https://game.varesa.mom/api/...`), jadi tidak perlu CORS sama sekali.

### Akun

| Metode & jalur | Body | Jawaban |
| --- | --- | --- |
| `POST /v1/auth/register` | `{ username, password, email? }` | `201 { user: { id, name } }` + `Set-Cookie` |
| `POST /v1/auth/login` | `{ username, password }` | `200 { user: { id, name } }` + `Set-Cookie` |
| `POST /v1/auth/logout` | — | `204`, cookie dihapus |
| `GET /v1/auth/me` | — | `200 { user }` atau `401` |
| `DELETE /v1/account` | `{ password }` | `204` — hapus akun **dan** save-nya |

- `username`: 3–20 karakter `[a-z0-9_]` (klien sudah menormalkan ke huruf kecil).
- `password`: 8–256 karakter. Tidak ada aturan komposisi.
- `email`: opsional, hanya untuk lupa sandi. Tidak ditampilkan ke siapa pun.

### Save

| Metode & jalur | Body | Jawaban |
| --- | --- | --- |
| `GET /v1/save` | — | `200 { data, rev, updatedAt }`, `204` bila belum ada, `401` |
| `PUT /v1/save` | `{ data, baseRev }` | `200 { rev }`; `409 { error: "conflict", current: { data, rev, updatedAt } }` bila `baseRev` ≠ revisi server; `413` bila > 256 KB; `422` bila `data` tidak lolos validasi |

`data` adalah `SaveData` yang sama dengan save lokal. Server **memvalidasi** dengan aturan
`sanitizeSave` yang sama (dipindah ke paket bersama, lihat §6) dan menolak yang tidak masuk akal.

### Galat

`{ "error": "<kode>" }`. Kode yang dikenal klien: `username_taken`, `invalid_username`,
`weak_password`, `invalid_credentials`, `rate_limited`, `unauthorized`, `conflict`, `not_found`.
Kode lain ditampilkan sebagai "Server menolak permintaan (kode N)".

## 4. Keamanan

- **Hash kata sandi:** Argon2id (m = 19 MiB, t = 2, p = 1 — rekomendasi OWASP), per akun salt acak.
  Akun lokal yang dibuat sebelum server ada **tidak dipindahkan** (hash PBKDF2 lokal tidak dikirim ke
  mana-mana); pemain mendaftar ulang, lalu progres HP-nya otomatis naik sebagai save pertama
  (`SaveSync.reconcile`).
- **Cookie sesi:** `HttpOnly; Secure; SameSite=Strict; Path=/api`, ID acak 256 bit, disimpan di
  server sebagai hash SHA-256, berlaku 30 hari, diperbarui saat dipakai. Logout menghapusnya di server.
- **CSRF:** SameSite=Strict + satu origin + server menolak permintaan yang header `Origin`-nya bukan
  `https://game.varesa.mom`.
- **Batas laju:** login 5 kali/menit per nama akun dan 20 kali/menit per IP; register 5 kali/jam per
  IP; `PUT /v1/save` 12 kali/menit per akun (klien mengirim paling sering tiap 20 dtk).
- **Batas ukuran:** body maksimal 256 KB. Save sekarang ± 5–15 KB.
- **Tidak ada yang dipercaya dari klien:** revisi dihitung server, `id` pengguna dari sesi (bukan
  dari body), save divalidasi.
- **Privasi:** email opsional; `DELETE /v1/account` menghapus semuanya; tidak ada pelacakan.
- **Yang tidak dijanjikan:** keamanan akun lokal. Ia hanya menjaga kata sandi tidak tersimpan dalam
  bentuk asli; siapa pun yang memegang HP bisa menghapus atau mengubah data browser.

## 5. Model data (SQLite)

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- = username (huruf kecil)
  pass_hash     TEXT NOT NULL,             -- argon2id encoded
  email         TEXT,
  created_at    INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,          -- sha256(cookie)
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    INTEGER NOT NULL
);
CREATE TABLE saves (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rev           INTEGER NOT NULL,
  data          TEXT NOT NULL,             -- JSON SaveData
  updated_at    INTEGER NOT NULL
);
CREATE TABLE save_history (                -- 10 revisi terakhir per akun, untuk pemulihan
  user_id TEXT, rev INTEGER, data TEXT, updated_at INTEGER, PRIMARY KEY (user_id, rev)
);
```

`PUT /v1/save` = satu transaksi: `UPDATE saves SET … WHERE user_id = ? AND rev = ?`; nol baris
berubah → 409 dengan salinan saat ini.

## 6. Rencana penerapan

VPS yang sama (RAM 4 GB, tanpa GPU), di belakang Cloudflare Tunnel yang sudah ada.

1. **Paket bersama.** Pindahkan `sanitizeSave`, aturan nama/sandi, dan tipe `SaveData` ke modul yang
   bisa diimpor klien *dan* server (sudah murni, tanpa DOM).
2. **Server** `server/` di repo ini: Node 22 + **Hono** (kecil, tanpa dependensi berat) +
   **better-sqlite3** + **argon2**. Satu proses, ± 40 MB RAM. Tes Vitest memakai tiruan yang sama
   dengan `tests/backend.test.ts` — dokumen ini, tiruan itu, dan server harus sepakat.
3. **Satu origin.** Dev: `vite.config.ts` mem-proxy `/api` → `127.0.0.1:8787`. Produksi: server yang
   sama menyajikan `dist/` dan `/api`, jadi Cloudflare Tunnel tetap menunjuk satu port.
4. **Jalankan** di sesi tmux `api` (seperti `game`), lalu systemd user service bila sudah stabil.
5. **Cadangan:** salinan harian file SQLite (`sqlite3 .backup`) ke folder di luar direktori kerja,
   simpan 14 hari.
6. **Nyalakan di klien:** build dengan `VITE_API_URL`. Layar Daftar otomatis mengganti peringatan
   "hanya di perangkat ini" dan menampilkan kolom email opsional.
7. **Uji di HP:** daftar → main → buka di browser lain / HP lain → masuk → progres sama; mode
   pesawat saat main → kembali online → tersinkron; dua HP main bersamaan → yang progresnya lebih
   jauh menang, yang lain muncul pemberitahuan "muat ulang".

## 7. Belum diputuskan / belum ada

- Lupa sandi lewat email (butuh layanan kirim email; email opsional sudah disiapkan di API).
- Menampilkan cadangan save (`save-backup@<akun>`) di menu Akun untuk dipulihkan manual.
- Mengganti nama karakter lewat Profile tersinkron (sekarang nama karakter adalah setelan per HP).

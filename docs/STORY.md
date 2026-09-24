# LENTERA MALAM — Naskah

> **Nama tokoh utama.** Naskah ini memanggilnya **Arka**, tapi itu nama *naskah*. Di dalam game,
> pemain menamai karakternya sendiri (Pengaturan → Nama karakter), jadi **setiap baris dialog
> ditulis dengan placeholder `{nama}`** dan mesin cutscene menggantinya saat diputar
> (`interpolate()` di `src/core/story/cutscene.ts`). Kalau pemain belum memilih nama, dipakai
> `NAME_FALLBACK` = "Pengembara".
>
> Jadi: baca "Arka" di dokumen ini, tulis `{nama}` di kode.

---

## Chapter 1 — Cahaya yang Tidak Pernah Padam

### Ringkasan

Tujuh tahun lalu, pada satu malam badai, kedua orang tua Arka menghilang. Yang tertinggal hanya
sebuah lentera hitam kecil dengan ukiran aneh — hangat di tangan meski tanpa api — dan sebuah
peringatan yang ia dengar dari kegelapan: *"Kalau lentera itu menyala, berarti mereka sudah
menemukanmu."* Malam itu lentera menyala sendiri, apinya biru pucat, dan seluruh lampu desa padam.

Tujuh tahun kemudian Arka kembali ke desa tempat semuanya dimulai — **Ravenhollow** — dan menemukan
buku catatan ayahnya di bawah lantai rumah lamanya. Dari buku itu ia tahu tiga hal: orang tuanya
tidak pergi karena ingin meninggalkannya, ada sesuatu yang sedang mencari keluarganya, dan ada satu
tempat yang tidak boleh ia masuki setelah matahari terbenam — **Hutan Noctis**.

Tentu saja ia masuk.

Di dalam hutan ia bertemu **Nara**, seorang gadis yang membawa lentera serupa — miliknya berwarna
merah. Nara mengatakan orang tua Arka masih hidup, tapi berada "di tempat yang tidak bisa kau
datangi": **Nocturne**, ruang di antara dunia manusia dan sesuatu yang seharusnya tidak pernah
terbuka. Orang tuanya adalah bagian dari **Ordo Lumen**, penjaga batas itu. Tujuh tahun lalu sebuah
pintu terbuka, mereka berhasil menutupnya, dan harganya adalah tinggal di sisi yang salah.

Malam itu mereka hampir ditemukan oleh **Penjaga Malam** — makhluk tanpa wajah dengan satu mata besar
di dadanya, yang hanya bisa dilihat oleh pemegang lentera. Di sebuah menara tua Arka membaca tulisan
tangan ayahnya: *"Jika segel pertama rusak, maka tujuh lentera akan kembali menyala."* Di kejauhan,
tujuh cahaya menyala sekaligus — padahal seharusnya baru satu.

Chapter ditutup dengan rumah masa kecil Arka terbakar api biru, dua sosok yang berdiri di depan
pintu dan terlihat seperti ayah dan ibunya, suara ayahnya di dalam kepalanya — *"Jangan percaya
Nara"* — dan Nara yang berkata, tanpa berani menoleh: *"Yang kau lihat bukan orang tuamu."*

### Tokoh

| Tokoh | Peran |
| --- | --- |
| **{nama}** (naskah: Arka) | Tokoh utama. 17 tahun saat prolog, 24 saat Chapter 1. Pemegang Lentera Malam (api biru). |
| **Nara** | Pemegang lentera merah. Menolong, tapi tidak semua perkataannya bisa dipercaya. |
| **Ayah & Ibu** | Ordo Lumen. Menghilang tujuh tahun lalu; di prolog hanya **terdengar**, tidak terlihat. |
| **Penjaga Malam** | Pemburu dari Nocturne. Tanpa wajah, satu mata besar di dada. |
| **Ordo Lumen** | Kelompok penjaga batas dunia. Simbol: lingkaran dengan mata di tengah. |

### Tempat

| Tempat | Catatan |
| --- | --- |
| **Ravenhollow** | Desa berkabut tempat semuanya dimulai. Sumur tua di tengah, rumah-rumah kayu. |
| **Hutan Noctis** | "Jangan pernah masuk ke sini setelah matahari terbenam." |
| **Menara Lumen** | Menara tua di dalam hutan, berisi ukiran simbol Ordo. |
| **Nocturne** | Ruang di antara dunia manusia dan yang lain. Belum bisa dimasuki di Chapter 1. |

### Benda & aturan dunia

- **Lentera Malam** bukan alat penerang. Apinya menunjukkan jalan menuju Nocturne, dan
  memperlihatkan apa yang tidak bisa dilihat manusia biasa.
- **Tujuh lentera = tujuh segel.** Satu menyala berarti satu segel rusak.
- Yang bisa melihat Penjaga Malam, bisa dilihat olehnya.

### Misteri yang disimpan untuk chapter berikutnya

1. Orang tua Arka memang masih hidup, tapi alasan mereka menghilang lebih rumit dari sekadar
   menyelamatkan dunia.
2. Lentera Malam adalah **kunci** — bisa membuka, bukan hanya menutup.
3. Nara punya alasannya sendiri.
4. Sosok di akhir chapter: ilusi, rekaman masa lalu, atau sesuatu yang menyamar.
5. Hubungan Arka sendiri dengan Nocturne.

---

## Cutscene pembuka (`intro`) — "Malam Terakhir"

Ini prolognya, dimainkan **engine 3D** (bukan video) saat pemain memilih **Game Baru**, dan bisa
diputar ulang dari Pengaturan. Durasi ±100 detik kalau tidak di-skip; tombol **LEWATI** selalu
terlihat. Skrip datanya di `src/core/story/cutscenes.ts`.

Suasana: malam, hujan, kabut, cahaya lentera. Kamera bergerak lambat; orang tua hanya **terdengar**
— itu bukan penghematan, itu memang cara ceritanya bekerja (Arka berlari keluar dan *tidak ada
siapa-siapa*).

| # | Adegan | Isi |
| --- | --- | --- |
| 1 | Hitam | Suara hujan. Caption: "Tujuh tahun yang lalu." |
| 2 | Desa dari atas, malam badai | Guntur. Caption: "Ravenhollow." |
| 3 | Rumah keluarga | Kamera turun mendekat. "Malam itu hujan tidak berhenti." |
| 4 | Di dalam, gelap | Suara gelas pecah. {nama} terbangun. "…Ayah?" |
| 5 | Lentera tua di ruang tengah | "Setiap malam Ayah menyalakan lentera itu. Malam itu lenteranya padam." |
| 6 | Pintu depan terbuka | Angin. Pecahan gelas di lantai. Lentera hitam kecil dengan ukiran aneh. |
| 7 | Mengambil lentera | "Hangat. Padahal tidak ada api di dalamnya." |
| 8 | Suara Ibu dari luar | "{nama}…" — kamera berputar ke pintu. |
| 9 | Berlari keluar | Tidak ada siapa-siapa. Hanya jalan desa yang kosong. |
| 10 | Suara Ibu, makin jauh | "{nama}… jangan cari kami…" |
| 11 | Suara Ayah | "Kalau lentera itu menyala…" — hening — "…berarti mereka sudah menemukanmu." |
| 12 | Lentera menyala sendiri | Api **biru pucat**. Getaran kamera. |
| 13 | Seluruh lampu desa padam | Fade ke hitam. Debar jantung. |
| 14 | Caption | "Tujuh tahun kemudian." |
| 15 | Fade masuk ke gameplay | Musik desa, ambient malam, kendali diserahkan ke pemain. |

**Yang belum selaras dengan naskah ini:** isi dunia yang sekarang masih memakai cerita lama
("Cahaya untuk Desa", Tetua Wulan, Lentera Agung). Nama **area** sudah diselaraskan di Batch 5;
penulisan ulang rangkaian quest-nya menjadi Chapter 1 (Nara, buku ayah, Menara Lumen, tujuh lentera)
adalah pekerjaan konten tersendiri — dicatat di `docs/PROGRESS.md`, bukan diam-diam setengah jalan.

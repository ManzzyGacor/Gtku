# Progress

Legenda: ✅ selesai · 🚧 sedang dikerjakan · ⬜ belum

> Rencana induk & urutan batch: **`docs/OVERHAUL.md`**.
> Game sedang dioverhaul dari 2D (Phaser) ke 3D pixel-art (Three.js). Versi 2D tetap jalan.

---

## Batch 1 — Fase 0: persiapan (selesai)

Tanpa mengubah tampilan game. 82 tes hijau.

1. ✅ Audit arsitektur + rencana migrasi → `docs/OVERHAUL.md` §6–§7
2. ✅ Ganti nama **Lentera Kelam → Lentera Malam**, kunci `localStorage` pindah ke
   `lentera-malam/*` dengan migrasi sekali baca dari kunci lama (save pemain tidak hilang)
3. ✅ Logika game murni pindah ke `src/core/**` (pemindahan saja; bundle hasil build byte-identik).
   `tests/core-purity.test.ts` menjaga `src/core` bebas renderer dan hanya boleh mengimpor
   `src/core/**` + `src/config`
4. ✅ **Vitest** jadi runner tes (`npm test`), Phaser di-alias ke mock lewat `resolve.alias`
5. ✅ Preset grafik **AUTO + 5 tingkat** (Sangat Rendah…Ultra): turun saat < 45 fps 3 dtk, naik saat
   > 57 fps, cooldown 8 dtk, syarat naik berlipat tiap kali turun. Saran preset awal dari kemampuan
   perangkat (core, memori, WebGL2, ukuran layar)
6. ✅ **Alat debug**: menu Pengaturan in-game (overlay DOM, netral-renderer), penghitung FPS
   (rata-rata + terendah + jumlah objek) lewat menu atau `?fps=1`, panel error dengan riwayat
   12 error terakhir, dan tombol **"Salin laporan"**

### Cara mengetes Fase 0 di HP

- Ketuk **gerigi** di kanan atas → menu Pengaturan. Game ikut berhenti selama menu terbuka.
- Nyalakan **Penghitung FPS** (atau buka `?fps=1`). Angkanya: rata-rata, `min` = setengah detik
  terburuk, lalu jumlah objek aktif dan ukuran buffer.
- Coba ubah **ukuran/posisi joystick**, **ukuran tombol**, dan **ukuran teks**, lalu tutup menu
  dan main sebentar — semuanya tersimpan dan langsung berlaku.
- Kalau ada yang aneh: ketuk **Salin laporan** lalu tempel hasilnya ke chat.
- Gerigi berubah **merah** kalau ada error tercatat; ketuk **Error terakhir → Lihat**.

---

## Batch 1 — Fase 1: fondasi 3D (selesai)

1. ✅ **Pipeline pixel** (`render3d/PixelRenderer.ts`): scene → render target resolusi rendah →
   quad nearest → kanvas. Dua tombol terpisah: **pixelHeight** (grid pixel 270/324/360 dari preset)
   dan **renderScale** (tombol performa). Kanvas diukur kelipatan bulat grid pixel, jadi satu texel
   jatuh di jumlah device pixel yang utuh. Pass yang sama menggambar **outline pixel** dari
   perbandingan kedalaman 4 tetangga (butuh WebGL2)
2. ✅ **Kamera 3/4 isometrik** ortografik, sudut tetap (yaw 45°, pitch 42°), zoom 0,75–1,6,
   16 px = 1 unit dunia sehingga satu tile menutupi jumlah pixel yang sama seperti versi 2D
3. ✅ **Dunia greybox bertekstur pixel**: tanah memakai `bakeChunk` yang sama dengan versi 2D
   (seni tanah 3D benar-benar seni tanah 2D), prop & tembok jadi `InstancedMesh` yang dikelompokkan
   per (bentuk, tekstur, emissive). Seluruh dunia = 40 chunk, ~6.700 instance, 10 grup draw
   (cek sendiri: `npx tsx scripts/plan-stats.ts`)
4. ✅ **Preset grafik dasar 3D**: outline, bayangan matahari, anggaran cahaya dinamis per preset
5. ✅ **Pemilih renderer**: `?renderer=2d|3d` atau menu Pengaturan; Vite memecah bundle jadi HP
   hanya mengunduh salah satu (entry 20 kB + boot3d 559 kB **atau** boot2d 1,48 MB)

## Batch 1 — Fase 2: player 3D (selesai)

1. ✅ **Model & animasi** (`render3d/HeroMesh3D.ts`): tubuh low-poly prosedural dari balok pada
   hierarki sendi — torso, kepala, jubah yang mengayun, dua lengan, dua kaki, pedang, dan
   **lentera yang menyala sebagai cahaya nyata**. Warnanya dari `HERO_LOOK` yang sama dengan
   sprite 2D. Pose: idle bernapas, jalan/lari, tebasan per fase kombo, guling, kena pukul,
   merapal, dan tumbang
2. ✅ **Gerak joystick & keyboard** memakai `HeroCore` yang sama — arah joystick diputar ke ruang
   kamera, jadi "dorong ke atas" berarti menjauh dari kamera
3. ✅ **Kamera mengikuti** hero dengan easing
4. ✅ **Collision** memakai `core/world/collision.ts` yang sama; diuji 25 detik simulasi menyapu
   segala arah tanpa pernah masuk tile solid
5. ✅ **Kontrol sentuh DOM** (`ui/TouchControls.ts`): joystick dinamis + tombol TEBAS dan GESER,
   ukuran & posisinya ikut menu Pengaturan

### Cara mengetes Batch 1 di HP

1. Buka game seperti biasa — sekarang **langsung masuk mode 3D**. Kalau ingin versi 2D lengkap:
   gerigi → **Renderer → 2D (lama)**, atau buka `?renderer=2d`.
2. Nyalakan **Penghitung FPS** di menu (atau `?fps=1`). Baris kedua menunjukkan jumlah objek dan
   ukuran render target.
3. Jalan-jalan dengan joystick, coba **GESER** (guling) dan **TEBAS** (animasi kombo).
   Lihat apakah lentera hero menerangi sekitar saat malam tiba (siklus siang-malam ±7 menit).
4. Coba tiap **preset grafik** (AUTO + Sangat Rendah…Ultra) dan laporkan FPS-nya. Perhatikan
   perbedaan ketajaman pixel dan garis outline.
5. Kalau ada yang aneh atau gelap total: **Salin laporan** lalu tempel ke chat. Laporan mode 3D
   memuat grid pixel, ukuran render target, jumlah chunk/instance/lampu, ketersediaan outline,
   posisi hero, dan area.

---

## Batch 2 — kamera, dunia luas, lingkungan hidup (selesai)

131 tes hijau. Laporan tes Batch 1 dari HP: **59,7 fps rata-rata (terendah 56,1) di preset Ultra**,
2318x759 dpr 2,8, 8 core / 8 GB, WebGL2 ada, 0 error.

### 1. Kamera (dari laporan: "terlalu tinggi")
- Sudut default **42° → 38°** dari tanah, zoom default **1,0 → 1,25** (lebih dekat ke hero).
- **Sudut (22–55°) dan zoom (0,8–2,2x) jadi setelan pemain** + tombol **Reset kamera**. Yaw tetap
  dipaku 45° supaya diamond isometriknya tidak pernah rusak.
- Kamera membidik 0,55 unit di atas tanah (dada hero), jadi hero duduk di tengah layar.
- **Langit + kabut jarak jauh**: kamera ortografik tidak punya titik hilang, jadi dunia yang
  berhingga tadinya "berhenti" begitu saja. Sekarang ada gradien langit (siang/sore/malam/gua,
  dengan dither supaya tidak berpita di 270 px) dan kabut linear berwarna sama, jadi tanah jauh
  larut ke latar — sekaligus menyembunyikan batas chunk.
- **Objek tinggi yang menghalangi hero larut**: tiap fragment bertanya sendiri apakah ia lebih
  dekat ke kamera daripada hero dan berada di dalam elips di sekitarnya; kalau ya ia `discard`
  lewat dither Bayer 4x4. Tanpa raycast, tanpa sorting transparansi, depth buffer tetap bersih.

### 2. Dunia diperluas ~3x per area
Dari 8x5 chunk (128x80 tile) ke **16x8 (256x128)** — 128 chunk, ~19.000 instance.
- **Desa Lentera**: plaza, balai, lima rumah inti, **pinggiran desa** (ladang utara berpagar
  dengan jerami, kincir selatan), kolam diperbesar, **anak sungai** sebagai tepi timur desa
  dengan jembatan di jalan utama, dan tujuh jalan setapak baru.
- **Hutan Bisik**: sungai dengan **dua jembatan + satu ford**, danau diperbesar, **empat tanah
  lapang** yang benar-benar tanah terbuka, **reruntuhan** (cincin pilar patah) di dua tempat,
  dan **titik pandang** di timur laut dengan bangku batang kayu.
- **Gua Kelam**: bukan lorong tunggal lagi — balai puzzle, cavern utara & selatan, **grotto
  kristal buntu**, dan **dua jalur memutar**. Semua cabang tetap di barat gerbang, jadi gerbang
  puzzle masih satu-satunya jalan ke boss (dibuktikan tes).
- **6 peti tersembunyi** jauh dari jalan (membukanya + loot menyusul Batch 4).
- **Streaming chunk**: chunk dimuat dari yang terdekat dengan anggaran bake per frame dan dilepas
  dengan histeresis, memakai kolam instance bersama (`InstancePool`) dengan swap-remove — jadi
  dunia 3x lebih luas justru menggambar lebih sedikit instance daripada sebelumnya.
- Minimap 2D ikut menyesuaikan sendiri karena digerakkan ukuran dunia.

### 3. Lingkungan hidup
- **Angin di vertex shader dengan instancing** (bukan loop JS per helai): embusan dua frekuensi
  yang fasenya dari posisi dunia tiap instance, jadi sehamparan rumput tidak bergerak serempak.
  **Hero menyibak tumbuhan** dengan rumus yang sama.
- **Air beriak**: dua rangkaian gelombang bersilangan dari koordinat dunia, dikuantisasi jadi
  empat pita (gradien mulus akan terlihat salah di samping pixel art), puncaknya memungut warna
  langit sebagai pantulan murah.
- **64 kunang-kunang** billboard aditif, digerakkan di shader dari seed per-instance dengan fase
  kedip masing-masing. Hanya malam, tidak pernah di gua.
- **Kabut tanah bergerak**: dua lapis noise beda kecepatan, paling tebal di gua, lalu hutan saat
  malam, dan selapis tipis saat fajar.
- **Obor & api altar berkedip** memakai nilai flicker dari definisi cahaya 2D yang sama.
- **Matahari benar-benar bergerak**: terbit di timur, puncak tengah hari, terbenam di barat, jadi
  bayangan menyapu tanah. Setelah terbenam berganti bulan dingin dari atas.
- **Jendela rumah menyala saat malam** — ini yang membuat desa terbaca ada penghuninya.

### Cara mengetes Batch 2 di HP

1. **Kamera dulu.** Gerigi → Pengaturan → **Sudut kamera** dan **Jarak / zoom**. Coba beberapa
   nilai, lalu **Salin laporan** — angkanya ikut terkirim. Kalau ada yang paling enak, sebutkan
   saja dan aku jadikan default.
2. **Sembunyi di balik rumah/pohon**: berdiri sampai atap atau tajuk menutupi hero, pastikan ia
   benar-benar larut (bukan hilang total, bukan tetap menutupi).
3. **Jelajahi**: ikuti jalan ke ladang utara, kincir selatan, kolam, lalu timur menyeberangi
   jembatan anak sungai → hutan → dua jembatan sungai → reruntuhan → titik pandang → gua.
   Cari 6 peti. Perhatikan apakah ada chunk yang terlambat muncul (pop-in) di tepi layar.
4. **Tunggu malam** (siklus ±7 menit). Yang harus terlihat: langit berubah, jendela rumah menyala,
   kunang-kunang keluar, obor berkedip, lentera hero menerangi, kabut menebal di hutan.
5. **Rumput**: jalan menembus rumput tinggi, lihat apakah tersibak dan tertiup angin.
6. **Air**: kolam desa, danau hutan, dan sungai — riaknya harus bergerak dan memantulkan langit.

### Lokasi paling berat untuk diukur FPS

Ukur di sini dengan **Ultra, Sedang, dan Rendah**, sambil penghitung FPS menyala:

| Lokasi | Kenapa berat |
| --- | --- |
| **Tengah Hutan Bisik saat malam**, sekitar jembatan sungai utama (ikuti jalan utama ke timur sampai jembatan kedua) | Paling berat: pohon terpadat + air beriak + kabut hutan + kunang-kunang + angin, semuanya sekaligus |
| **Danau hutan** (jalur bercabang ke selatan dari jalan utama) | Permukaan air paling luas di satu layar |
| **Plaza Desa Lentera saat malam** | Jendela menyala + lampu jalan + Lentera Agung = paling banyak cahaya dinamis |
| **Grotto kristal di Gua Kelam** (cabang buntu di barat balai puzzle) | Kristal terpadat + kabut gua paling tebal |
| **Arena boss** | Ruang terbuka terbesar sekaligus dinding terbanyak di layar |

---

## Perbaikan visual (target: `docs/reference/referensi-visual.png`)

146 tes hijau. Laporan tes Batch 2: **59,7 fps di Ultra**, tapi **gambar hanya mengisi ~setengah
layar di Ultra**, langit/kabut kurang enak, air tanpa pantulan, dan pop-in chunk.

### 0. BUG: gambar tidak penuh layar — **diperbaiki paling pertama**

| | |
| --- | --- |
| **Sebelum** | Pipeline 3D memakai ulang konstanta renderer 2D `MAX_LOGICAL_W = 720`. Di layar 3:1 (2318x759, dpr 2,8) kanvas hanya **514 dari 828 px CSS = 62% lebar** di preset Tinggi/Ultra, dan 93% di preset 270 px. |
| **Sesudah** | Kanvas **selalu** seukuran viewport penuh pada resolusi perangkat. Layar raksasa mengecilkan buffer, bukan memotong tampilan. Matematikanya dipisah ke `render3d/pixelPlan.ts` sebagai fungsi murni dan dijaga 7 tes di 7 bentuk layar × 5 preset. |

### 1. Resolusi pixel per preset

| | |
| --- | --- |
| **Sebelum** | 270 / 270 / 270 / 324 / 360 baris, dan lebarnya dipotong 720. Menaikkan preset juga **menggeser framing** (kamera ikut menjauh), karena frustum diturunkan dari jumlah pixel. |
| **Sesudah** | **216 / 270 / 360 / 450 / 540** baris, lebar mengikuti bentuk layar (Ultra = 1649x540 di HP penguji). Framing sekarang diatur dalam **tile** (`VIEW_TILES_H = 19`, diukur dari referensi: hero mengisi ~8% tinggi layar), jadi menaikkan preset **hanya** memperkecil pixel. Upscale memakai *sharp bilinear* supaya skala pecahan (540 baris di layar 759 baris) tidak berkerlip. |

### 2. Texel density & detail tekstur

| | |
| --- | --- |
| **Sebelum** | 8 tekstur **16x16**, satu warna dasar + noise. Tanpa AO, tanpa sorotan tepi, tanpa variasi per elemen. |
| **Sesudah** | 12 tekstur **32x32** (**2x texel density**), dan tiap generator melakukan empat hal: ramp **empat tingkat** (gelap/tengah/terang/highlight), **AO dipanggang** di tiap nat & tumpangan, **sorotan tepi** di sisi yang kena cahaya, dan **variasi** per bata/papan/sirap + speckle. Tekstur baru: `logwall` (kayu balok horizontal dengan shading silinder — dinding kabin di referensi), `beam` (kayu berat + sabuk besi + rivet), `thatch`, `cloth` (tenda bergaris). Sirap ditulis ulang total: percobaan pertama hanya mewarnai kisi bata dan memang terbaca sebagai bata. Lihat sendiri: `npx tsx scripts/preview-textures.ts`. |
| **Tanah** | Tetap dipanggang 16 px/tile (menggandakannya = ~1 MB per chunk × 51 chunk = 53 MB), tapi kini dapat **lapis grain bersama** yang dihamparkan pada 2x kerapatan tile dan dikalikan di shader — detail frekuensi tinggi, gratis di memori — plus **AO kontak dipanggang** di tempat tanah bertemu benda solid, yang membuat bangunan berhenti terlihat seperti stiker di lantai. |

### 3. Bentuk model

| | |
| --- | --- |
| **Sebelum** | Rumah = satu balok + satu limas. Terbaca persis seperti itu. |
| **Sesudah** | Tiap rumah punya daftar bagian seperti referensi: **sendi batu**, dinding balok, **tiang sudut**, balok atas, atap dengan **teritisan sungguhan** + **papan lisplang**, **tutup bubungan**, pintu **berkusen**, dan jendela dengan **kusen + ambang + kaca**. Balai desa dapat beranda beratap; sumur dapat katrol & timba; lapak dapat 4 tiang + **tenda bergaris** + barang; pagar dapat 2 palang + tiang + sendi batu; pohon dapat akar melebar + 3 massa tajuk; lampion jadi tiang + kurungan besi + tudung. Dunia: 19.000 → **28.000 instance**, 10 → **19 grup draw**. |

### 4. Pencahayaan malam

| | |
| --- | --- |
| **Sebelum** | Ambient + matahari terarah + maksimal 12 lampu dinamis. Tidak ada genangan cahaya di tanah, tidak ada bloom, tidak ada grading. |
| **Sesudah** | Lampu statis **dipanggang jadi light map per chunk** (`render3d/lightmap.ts`): genangan hangat di tanah untuk **sebanyak apa pun** lampion, nol biaya per frame, dipanggang dari chunk ini **dan delapan tetangganya** supaya tidak ada jahitan di batas. Kurvanya sengaja bukan inverse-square (yang cuma menghasilkan titik keras) melainkan *genangan*: rata di bawah lampu lalu melandai. Ditambah **bloom** lembut (bright pass + blur 9-tap di 1/4 resolusi), **color grading** (lift ke biru malam, gain hangat), **vignette** tipis, **rim light** hangat di tepi tiap objek, **jendela menyala**, dan obor berkedip. Beberapa lampu dinamis tetap ada di dekat hero. |

### 5. Air

| | |
| --- | --- |
| **Sebelum** | Dua gelombang, empat pita, tanpa busa, tanpa pantulan, mask 1 texel/tile. |
| **Sesudah** | Lima hal seperti referensi: **gradasi kedalaman** (hampir hitam di palung → teal terang di tepian), **riak** dua train kasar + satu halus dalam lima pita, **garis busa** yang memeluk tepi, **pantulan** langit di puncak riak **dan genangan lampion yang dipanggang** disaput mengikuti riak, serta **kilau** spekular yang berkedip. Mask naik ke 2 texel/tile dengan tiga kanal (ada-air, kedalaman, jarak-ke-tepi); jaraknya diukur ke **tepi** tile daratan, bukan pusatnya — mengukur ke pusat mentok di setengah tile sehingga pita busa tak pernah bisa mencapai nol. |

### 6. Karakter

| | |
| --- | --- |
| **Sebelum** | Kepala **19%** dari tinggi tubuh (proporsi realistis). Tanpa wajah. Pedang kecil. |
| **Sesudah** | **Chibi: kepala 37%**, diukur dari referensi — pada jarak kamera ini kepala hanya ~14 px layar, dan kepala besar itulah yang membuatnya terbaca. Rambut = topi + **7 paku** yang dimiringkan masing-masing. **Wajah**: dua mata dengan kilau, dua tanda rona, mulut. Mantel lebar + ikat pinggang + kerah terang + tali serong + syal, kaki gempal dengan bot bersorotan, tangan bersarung. Pedang diperbesar (bilah baja, pelindung emas, gagang dibalut) + **jejak tebasan biru bercahaya** pada frame aktif ayunan. |

### 7. Langit & kabut

| | |
| --- | --- |
| **Sebelum** | Satu blend linear haze→top. Palet siang pucat dan kabut siang kuat, jadi dunia terlihat pudar. Tanpa bintang. Dither 2x2. |
| **Sesudah** | **Ramp dua tahap** (jatuh cepat di dekat cakrawala, lambat di atasnya) — satu blend linear itulah yang membuat versi pertama terasa datar. Palet diturunkan jauh lebih dalam (teal-ke-hitam) mengikuti referensi; kabut siang dilemahkan supaya dunia tidak pudar dan diperkuat malam. **Bintang berkelip** muncul saat malam (tetap di layar, yang benar: kamera tidak pernah berputar dan langit di tak-hingga). Dither **Bayer 4x4** menggantikan 2x2 → tanpa pita warna. |

### 8. Pop-in chunk

| | |
| --- | --- |
| **Sebelum** | Chunk muncul mendadak. |
| **Sesudah** | Dua fade, keduanya **tanpa biaya CPU per frame**: tiap instance prop menyimpan **waktu kemunculannya** di atribut per-instance dan shader melarutkannya masuk lewat dither Bayer yang sama dengan potongan objek; tanah dimulai tertimpa warna kabut lalu menyelesaikan diri keluar darinya. Margin chunk juga dinaikkan. |

### 9. Performa

| | |
| --- | --- |
| **Sebelum** | Ultra: buffer 720x379 = **273k pixel**, 19k instance, 50 draw → 59,7 fps. |
| **Sesudah** | Ultra: buffer 1649x540 = **890k pixel** (3,3x lebih banyak fragment) + pass bloom, 13k instance termuat, 90 draw, 15,5 MB tekstur tanah. **Ini risiko nyata untuk 60 fps** dan perlu diukur. Tuas baru: setelan **"Skala render" (50–100%)** menurunkan jumlah pixel yang diwarnai tanpa mengubah ukuran pixel seni, dan AUTO tetap menurunkan preset sendiri kalau FPS jatuh. Cek anggaran apa pun ukuran layar: `npx tsx scripts/stream-budget.ts`. |

### Yang TIDAK bisa dicapai dengan aset buatan kode — dan alternatifnya

Jujur: beberapa hal di referensi itu **lukisan tangan**, dan primitif balok/limas prosedural
tidak akan pernah sampai ke sana.

| Yang tidak tercapai | Kenapa | Alternatif konkret |
| --- | --- | --- |
| **Siluet organik** tumbuhan, bunga, rumput, batu | Referensi menggambar tiap helai dan tiap kelopak dengan garis luar tak beraturan. Balok dan limas tidak bisa. Ini **selisih visual terbesar yang tersisa.** | **Billboard sprite**: proyeksikan seni prop 2D yang SUDAH ADA (`src/art/props.ts` — pohon, bunga, rumput, jamur sudah digambar detail) sebagai quad yang selalu menghadap kamera. Murah, dan langsung menutup sebagian besar selisih ini. Rekomendasiku untuk batch berikutnya. |
| **Detail wajah & lipatan pakaian** hero | Referensi melukis shading di mantel. Balok tidak. | Sama: billboard sprite hero 2D (sudah ada, 3 arah + flip), atau tekstur buatan tangan yang ditempel ke balok lewat mekanisme override yang sudah ada. |
| **Komposisi khas per bangunan** | Rumah di referensi adalah satu lukisan unik; rumahku adalah kit berparameter. | Model GLB buatan tangan — tapi kamu tidak punya PC, jadi realistisnya: menambah bagian pada kit (sudah dilakukan) atau paket low-poly CC0 (Kenney/Quaternius) dengan sumbernya dicatat di `CREDITS.md`. |
| **Air terjun** di kanan referensi | Belum ada sama sekali. | Bisa dibuat: bidang bertekstur bergulir + partikel di dasarnya. Masuk daftar Batch berikutnya, bukan hal yang mustahil. |
| **Blur kedalaman (depth of field)** | Referensi punya fokus lembut di kejauhan. | Bisa didekati dengan kabut + bloom yang sudah ada; DoF sungguhan butuh satu pass blur lagi — bisa, tapi mahal di HP. |

### Cara mengetes di HP

1. **Pertama: apakah gambar sudah penuh layar di SEMUA preset?** Coba kelimanya. Ini bug utama
   yang diperbaiki. Kalau masih ada pinggiran hitam, **Salin laporan** — laporan sekarang memuat
   ukuran kanvas, ukuran layar, grid pixel, ukuran render target, dan skala.
2. **FPS per preset** (nyalakan penghitung FPS). Resolusi Ultra naik 3,3x, jadi angka ini yang
   paling kubutuhkan. Kalau Ultra tidak 60 fps, coba turunkan **Skala render** ke 80% atau 70%
   dan laporkan bedanya.
3. **Kamera**: sudut 38° dan zoom 1,00 sekarang berarti framing referensi (19 tile tinggi).
   `camZoom` lamamu 1,25 akan terasa lebih dekat dari sebelumnya — reset lewat **Reset kamera**.
4. **Malam** (tunggu ±3 menit): genangan cahaya di tanah di bawah lampion, jendela menyala,
   bintang, rim light hangat di tepi objek, bloom di sekitar lampu.
5. **Air**: kolam desa & sungai hutan — busa di tepi, riak jelas, pantulan langit, dan pantulan
   lampion di malam hari.
6. **Berjalan cepat** menyeberangi batas chunk: pop-in harus jadi larut halus, bukan muncul mendadak.
7. **Hero**: kepala besar, wajah terlihat, dan jejak tebasan biru saat menekan TEBAS.

---

---

## Prioritas 1: performa dikembalikan

Laporan: **25,7 fps di Ultra** (sebelumnya ~60), 59 chunk, 10.803 instance, 96 draw group,
12 lampu, grid 1649x540.

### Cara mengukurnya (karena aku tidak punya GPU)

Menu Pengaturan → **Uji performa**. A/B di HP-mu sendiri: 14 skenario, mulai dari "semua
menyala" lalu mematikan satu fitur per giliran (lampu dinamis, bayangan, air, bloom, angin,
grain tanah, rim light, kunang/kabut, outline, skala render 60%, grid 360, grid 270, radius
chunk −1). Tiap skenario ditahan ~1,5 detik dan diukur **median** waktu frame — median, bukan
rata-rata, karena satu hentakan GC akan merusak seluruh sampel. Hasilnya tabel
"bloom hemat 1,8 ms, air hemat 4,1 ms" yang bisa langsung ditempel ke laporan.

Laporan tes juga sekarang memuat **waktu frame (ms)**, **draw call**, jumlah triangle, dan
jumlah program shader.

### Enam perbaikan

| # | Apa | Sebelum | Sesudah |
| --- | --- | --- | --- |
| 1 | **Lampu dinamis** | 12 lampu, dan jumlahnya berubah saat hero lewat lampion — Three mengompilasi loop pencahayaan **per jumlah lampu**, jadi menyalakan/mematikan `visible` memicu **recompile shader di tengah permainan** | Kolam berukuran **tetap** yang selalu ada di scene; yang tak terpakai diparkir dengan intensitas nol. Satu program untuk seluruh sesi. Anggaran maksimal **3** (lampu statis sudah dipanggang) |
| 2 | **Bayangan** | `high`/`ultra` memakai shadow map 1024 → satu **pass geometri tambahan** atas setiap pool dan setiap chunk | **Mati di semua preset.** AO kontak yang dipanggang sudah melakukan tugas yang dibutuhkan referensi. Tetap jadi tombol supaya probe bisa mengukurnya |
| 3 | **Composite** | outline + bloom + grade + vignette dihitung di blit akhir = **6 sampel tekstur × 1,76 juta pixel** padahal gambarnya hanya 0,89 juta | Composite di resolusi render target, lalu **satu** sampel sharp-bilinear per pixel layar ≈ setengah biaya |
| 4 | **Visibilitas chunk** | lingkaran radius `hypot(lebar, dalam)`; di layar 3:1 itu menutupi **hampir 2× area yang benar-benar di layar** | **Persegi pandang kamera.** 51 → **33 chunk**, 11.357 → **6.425 instance**, 80 → **55 draw**, tekstur tanah 13,4 → **8,7 MB** |
| 5 | **Air** | satu quad seukuran chunk per chunk berair, bagian keringnya dibuang dengan `discard` — di HP itu mematikan **early-Z untuk seluruh draw**, dan chunk yang 5% kolam tetap men-shade 100% areanya lewat shader transparan | Geometri **hanya di atas tile air**, digabung per baris |
| 6 | **Kabut** | mencapai 155 padahal dunia di sekitar hero hanya ~64 unit — kabut tidak menyembunyikan apa pun, dan radius chunk membayar tanah yang seharusnya ditelan kabut | Dibatasi radius yang benar-benar dimuat |

### AUTO

Dulu hanya menurunkan **preset**, yang langkahnya besar dan kelihatan (ukuran pixel berubah).
Sekarang menapaki **tangga dua dimensi** yang menyelang preset dan skala render:
`ultra@1.0 → ultra@0.85 → high@1.0 → high@0.85 → medium@1.0 → …`. Memotong skala render tidak
mengorbankan kesetiaan seni, hanya ketajaman, jadi AUTO bisa mengendap jauh lebih dekat ke
sasaran. Ambang dinaikkan ke **48/58 fps** supaya targetnya sekitar 55–60.

Tuas manual baru: setelan **Skala render (50–100%)**.

---

## Prioritas 2: serangan tidak lagi kaku

Laporan: "Serangan terasa SANGAT KAKU."

| Apa | Sebelum | Sesudah |
| --- | --- | --- |
| **Transisi animasi** | pose disetel **langsung** dan melompat antar 3 frame diskret | Pose menulis **target**, tubuh meluncur ke arahnya dengan pendekatan eksponensial bebas frame-rate. **Ini penyebab utama kekakuannya.** |
| **Fase serangan** | 3 fase (windup/active/recover) | **4 sub-fase** yang memang dibaca mata sebagai ayunan: ancang-ancang (bilah ditarik, berat pindah ke kaki belakang), tebasan (melesat, jejak muncul), **ayunan lanjutan** (tubuh terus berputar melewati sasaran), pemulihan. Laju crossfade beda per fase: 45/s saat tebasan, 14/s saat pemulihan |
| **Kendali saat menyerang** | terkunci: tidak bisa berputar maupun bergerak | Masih **berputar** ke arah joystick (dibatasi 420°/s — bukan seketika; snap akan terlihat lebih buruk daripada terkunci) dan menyimpan **30% kecepatan jalan** selama ancang-ancang |
| **Langkah maju** | lunge 90 px/s | 130 / 150 / 210 / 250 px/s per ayunan |
| **Dodge cancel** | hanya setelah bilah lewat | **Di titik mana pun** |
| **Ketuk vs tahan** | tidak ada | Ketuk = combo ringan (3 ayunan). **Tahan 0,26 s = serangan berat** (damage 7, jangkauan 44, knockback 230, ancang-ancang 0,22 s untuk telegraf). Untuk busur: tahan = menarik, lepas = melesat |
| **Bidik otomatis** | ada di 2D, **belum tersambung di 3D** | Tersambung: kerucut 55°, jarak 62 px, keduanya bisa disetel |
| **Umpan balik** | tidak ada musuh di 3D | Hit-stop, knockback, **kedip musuh**, getaran kamera, percikan, jejak tebasan, **suara** |
| **Angka sebagai data** | konstanta di kode | **39 angka** di menu **"Setelan Combat"** di HP, tersimpan di localStorage |

---

## Prioritas 3 (Batch 3): combat, dua senjata, elemen

- **Elemen**: 15 terdeklarasi sebagai data, **4 implemented** (Api, Air, Es, Petir). Yang belum
  tidak menerapkan apa pun — ditandai, tidak dipalsukan.
- **Status**: 16 terdeklarasi, 4 aktif (Burn, Wet, Freeze, Shock) dengan durasi, stack, tick,
  pengali kecepatan, dan **resistensi per status**. Boss tahan crowd control.
- **6 reaksi** data-driven, semuanya bisa dicapai saat bermain: Lebur (Api+Es, 2×), Uap
  (Api+Basah), Padam (Air+Terbakar), Beku (Es+Basah), **Hantar** (Petir+Basah, 1,8× + area
  listrik radius 46), Pecah (Petir+Es, 2,2×).
- **Dua senjata**: Pedang dan Busur penuh; 4 kategori lain sebagai data. Busur punya tembakan
  Cepat / Terisi / **Tembus** (menembus 4 musuh). Ganti cepat tidak bisa memotong frame aktif
  tebasan tapi bisa memotong pemulihan — jadi ganti senjata bisa jadi bagian dari combo.
- **Musuh di 3D**: simulasinya `EnemyWorld` **yang sama** dengan versi 2D. Tubuh prosedural
  dengan siluet yang terbaca dari kamera 3/4, kedip saat kena, dan **cincin telegraf** yang
  menutup sebelum menyerang.
- **Suara**: SFX chiptune sintetis dari osilator, nol unduhan, aktif setelah sentuhan pertama.

---

## Cara mengetes di HP

**Urutan yang paling kubutuhkan:**

1. **Uji performa** (Pengaturan → Uji performa → tunggu ~15 dtk → Salin laporan). Ini yang
   paling berguna: ia memberi tahu kita apa yang benar-benar mahal di HP-mu, bukan dugaanku.
2. **FPS per preset** di lokasi berat (tabel di bawah). Target: Ultra ≥ 55 fps.
3. **Pilih AUTO** dan main 1–2 menit di desa saat malam. AUTO harus mengendap di sekitar
   60 fps dan tidak naik-turun terus. Laporkan di preset/skala berapa ia berhenti.
4. **Serangan**: ketuk berulang (combo 3), lalu **tahan** (serangan berat), lalu coba
   membatalkan ayunan dengan **GESER** di tengah-tengah. Apakah masih terasa kaku?
5. **Busur**: ketuk tombol **BUSUR** untuk menukar, ketuk = tembakan cepat, **tahan** = cincin
   tarikan mengisi lalu lepas = tembakan tembus.
6. **Elemen**: belum ada senjata berelemen yang bisa dipilih pemain (itu Batch 4 — equipment),
   jadi reaksinya belum bisa kamu picu di dalam permainan. Yang bisa kamu lihat sekarang:
   musuh berkedip, telegraf, hit-stop, dan suara.
7. **Setelan Combat**: buka, ubah satu angka (misalnya "Tebas 1: langkah maju"), lalu ayun lagi.
   Kalau ada kombinasi yang terasa jauh lebih enak, sebutkan angkanya dan aku jadikan bawaan.

**Lokasi paling berat untuk FPS:**

| Lokasi | Kenapa |
| --- | --- |
| **Plaza Desa Lentera saat malam** | Paling berat sekarang: jendela menyala + lampion + genangan cahaya dipanggang + bloom + kunang-kunang |
| **Tengah Hutan Bisik saat malam**, sekitar jembatan sungai utama | Pohon terpadat + air + kabut hutan + angin |
| **Danau hutan** | Permukaan air terluas di satu layar |
| **Gerombolan kelelawar di Gua Kelam** | Musuh terbanyak sekaligus di layar + kristal + kabut gua |
| **Arena boss** | Boss besar + pilar + ruang terbuka terbesar |

---

### Yang belum ada di mode 3D

Musuh & kombat (Batch 3), stats & inventaris (Batch 4), NPC/quest/cutscene/audio/menu (Batch 5),
**save/load** dan world streaming (Batch 6), akun (Batch 7). Save 2D lama tidak disentuh —
mode 3D belum menulis apa pun ke save.

---

## Fase 1 lama (versi 2D) — selesai

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

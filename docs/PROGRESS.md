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

---

## Inventaris fitur 2D → 3D (sebelum renderer 2D dihapus)

Tag pengaman: **`v0.2-2d-final`** (sudah di-push). Kalau ada fitur yang ternyata terlewat:
`git checkout v0.2-2d-final`.

Daftar ini dibuat dengan menyisir `src/render2d/scenes/GameScene.ts` (529 baris) dan
`UIScene.ts` (559 baris) baris demi baris. Kolom terakhir diisi saat fitur itu benar-benar
jalan di 3D.

| Fitur 2D | Logikanya | Status di 3D |
| --- | --- | --- |
| Gerak 8 arah + tabrakan | `core/world/collision` | ✅ sejak Fase 2 |
| Streaming chunk | — | ✅ Batch 2 (persegi pandang kamera) |
| Siklus siang-malam | `core/systems/daynight` | ✅ Batch 2 |
| Pencahayaan + vignette + bloom | — | ✅ Batch 2 (light map dipanggang + grading) |
| Air & rumput beranimasi, partikel, parallax | — | ✅ Batch 2 (shader angin, riak, kunang, kabut) |
| Kombat: kombo, dodge, skill, hit-stop, getaran | `core/entities/HeroCore` | ✅ Batch 3 (+ 4 fase, tahan = berat) |
| Musuh: lendir, pemanah, kelelawar, boss | `core/entities/enemies` | ✅ Batch 3 (`Combat3D`) |
| Bidik otomatis | `HeroCore.aimAssist` | ✅ Batch 3 |
| Angka damage | — | ✅ **sudah pindah** |
| Pickup penyembuh dari musuh | — | ✅ **sudah pindah** |
| HUD: bar HP + trail, teks quest, hint, banner area, toast | — | ✅ **sudah pindah** |
| Bar HP boss | — | ✅ **sudah pindah** |
| NPC (4) + penanda `!`/`?` | `core/world/source` (NpcDef) | ✅ **sudah pindah** |
| Dialog dengan efek ketik + potret | — | ✅ **sudah pindah** |
| Interactable: bicara, baca papan, istirahat di altar | `core/systems/interactables` | ✅ **sudah pindah** |
| Quest "Cahaya untuk Desa" (4 tahap) | `core/systems/quest` | ✅ **sudah pindah** |
| Puzzle dorong batu → gerbang terbuka | `core/systems/puzzleLogic` | ✅ **sudah pindah** |
| Pintu arena boss menutup saat boss bangun | `PuzzleSystem` (view) | ✅ **sudah pindah** |
| Lentera Agung menyala di akhir quest | — | ✅ **sudah pindah** |
| Minimap jendela 48x32 tile | — | ✅ **sudah pindah** |
| Save/load + autosave 30 dtk + saat event | `core/save`, `core/state/GameState` | ✅ **sudah pindah** |
| Checkpoint + respawn saat mati | — | ✅ **sudah pindah** |
| Layar judul: Lanjutkan / Main Baru | — | ✅ **sudah pindah** |
| Tombol fullscreen + lock landscape | — | ✅ **sudah pindah** |
| Kontrol sentuh (joystick + tombol) | `core/input` | ⚠️ `ui/TouchControls` (DOM) — **tombol interaksi ("gelembung") terlewat saat porting**, baru ditambahkan setelah laporan tes. Baris ini dulu ditandai ✅ padahal salah. |
| Menu Pengaturan, penghitung FPS, panel error | — | ✅ Fase 0 (DOM, netral renderer) |

**Hasil:** keenam belas fitur sudah pindah dan dibuktikan `tests/playthrough.test.ts` (memainkan
seluruh quest secara headless). Renderer 2D, parameter `?renderer=2d`, dependency Phaser, dan
mock Phaser di tes **sudah dihapus**.

**Yang sengaja tidak dipindah:** semuanya yang khas Phaser — `Fx` (partikel Phaser), `Lighting`
(lightmap kanvas 2D), `Parallax`, `chunks` (bake tekstur chunk Phaser), `cameraRig`,
`pixeltext`, `register`, dan keempat `Scene`. Penggantinya di 3D sudah ada dan lebih murah.

**Aset:** pipeline seni `src/art/*` **tetap dipakai** — tanah 3D dipanggang dengan `bakeChunk`
yang sama, dan palet yang sama dipakai tekstur greybox. Yang jadi khusus-2D hanyalah sheet
sprite (`characters`, `enemies`, `props`, `fx`, `ui`, `font`); itu tetap dipertahankan karena
masih dipakai untuk minimap, potret dialog, dan ekspor pratinjau — dan karena rencananya
`docs/OVERHAUL.md` §"Yang tidak tercapai" mengusulkan memakainya sebagai billboard sprite.

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

### Save lama dari versi 2D

Save versi 2D disimpan di key `lentera-kelam/save/v1` (nama game waktu itu) dengan bentuk `v: 1`
yang sama seperti sekarang, jadi isinya bisa dibaca langsung. Yang **tidak** sama adalah dunianya:
Batch 2 memperbesarnya dari 128x80 menjadi 256x128 petak dan memindahkan semua area, sehingga
posisi yang dulu halaman desa bisa jadi bagian dalam pohon sekarang. Save yang menaruh hero di
dalam dinding = game yang terkunci, jadi migrasinya nyata, bukan cuma ganti nama key.

`src/core/saveMigrate.ts` (murni, tanpa renderer) mengerjakan dua hal:

1. **`sanitizeSave`** — memaksa setiap field ke bentuk yang benar: NaN/Infinity ditolak, `hp`
   dijepit ke 1..maxHp, tahap quest ke 0..4, jumlah kill tidak boleh negatif, `dayTime` dilipat
   ke satu hari, cap waktu kill yang bukan angka dibuang, dan flag yang bukan `true` diabaikan.
   Save yang tidak bisa diselamatkan mengembalikan `null` — mulai baru lebih baik daripada game
   yang crash saat boot. Dipakai `loadGame()`, jadi berlaku untuk semua save, bukan hanya yang lama.
2. **`placeHero`** — memeriksa posisi simpanan terhadap grid tabrakan dunia *sekarang*, lalu
   memindahkan hero ke petak bebas terdekat (pencarian cincin, radius 16), atau ke checkpoint yang
   tersimpan, atau ke titik awal dunia. Checkpoint yang id-nya sudah tidak ada juga diganti.

Setiap perubahan dicatat sebagai `notes` dan muncul di laporan diagnostik sebagai baris
`migrasi save: ...`, jadi migrasi tidak pernah terjadi diam-diam.

Dijaga `tests/savemigrate.test.ts` (13 tes) dengan dua payload 2D asli — persis apa yang
`GameState.toJSON` tulis di commit `20b1c2d`, memakai koordinat dunia lama (altar hutan petak
60,32 dan altar gua petak 97,36): key lama diadopsi lalu dihapus, save baru selalu menang atas
sisa save lama, hero mendarat di petak yang bisa dipijak **dan benar-benar bisa berjalan lebih
dari satu petak**, hero yang tersimpan di dalam dinding atau di luar dunia ditarik ke tempat aman,
progres (quest/puzzle/boss/flag/jam) utuh, save rusak ditolak (10 bentuk: JSON terpotong, `v: 2`,
hero null, koordinat string), NaN/Infinity tidak pernah sampai ke state, dan localStorage yang
melempar SecurityError (jendela privat) tidak menjatuhkan game.

### Angka setelah renderer 2D dihapus

| Yang diukur | Sebelum | Sesudah |
| --- | --- | --- |
| Baris kode `src/` | 14.812 | 12.184 |
| `node_modules` | 271 MB | 153 MB |
| Bundle yang dikirim ke browser | 2.144 kB (entry 21 + boot3d 662 + **boot2d 1.461**) | 763 kB (entry 35 + boot3d 728) |
| Yang benar-benar diunduh pemain 3D | 683 kB | 763 kB |
| Berkas tes | 25 (186 tes) | 24 (171 tes) |

Bundle total turun **64%** karena chunk `boot2d` 1,4 MB tidak lagi ikut dibangun. Yang diunduh
pemain naik 80 kB: HUD, dialog, minimap, quest, dan puzzle yang baru pindah ke 3D ada di dalamnya.
Entry naik 21 → 35 kB karena `SettingsPanel` mengimpor `combatTuning` → `HeroCore` secara statis;
itu ditangani di bagian optimasi bundle.

## Bagian 2 — Bug dan optimasi

### Ukuran bundle dan waktu muat pertama

| Yang diunduh | Sebelum | Sesudah |
| --- | --- | --- |
| Sebelum ada yang tampil di layar | 1.516 kB (entry 21 + **boot2d 1.461**) | **32 kB** (entry saja) |
| — dalam gzip | 409 kB | **12,5 kB** |
| Total untuk mulai bermain | 2.144 kB / 409 kB gzip | 771 kB / 213 kB gzip |
| Chunk | 2 (entry, boot2d/boot3d) | 4 (entry, boot3d, three, combatTuning) |
| Yang diunduh ulang saat game di-update | semuanya (770 kB) | **237 kB** (three ter-cache) |

Tiga perubahan:

1. **Layar judul pindah ke entry chunk.** Dulu `main.ts` menunggu seluruh `boot3d` (730 kB, berisi
   Three.js) selesai diunduh, baru membuat `TitleScreen`. Artinya di HP dengan data seluler:
   layar hitam dulu, baru judul. Sekarang judul ada di chunk entry (32 kB) dan muncul hampir
   langsung; unduhan renderer **mulai di saat yang sama** dan hanya di-`await` setelah pemain
   memilih, jadi biasanya sudah selesai sebelum pemain selesai membaca menu. Kalau belum,
   judulnya berganti jadi "Menyiapkan dunia…" — bukan layar hitam yang terlihat seperti crash.
2. **Three.js dipisah ke chunk sendiri** (534 kB). Ini hal terbesar yang kita kirim dan yang paling
   jarang berubah. Update game berikutnya hanya perlu mengunduh ulang 237 kB kode game, karena nama
   berkas `three-*.js` tidak berubah dan masih ada di cache browser.
3. **`combatTuning` (39 angka + `HeroCore`) tidak lagi ikut di entry.** `SettingsPanel` dulu
   mengimpornya statis, jadi panel debug menyeret seluruh model combat ke chunk yang menghalangi
   layar judul. Sekarang di-`import()` saat panelnya benar-benar dibuka.

**Yang tidak bisa diperkecil lagi, terus terang:** 534 kB itu sudah Three.js yang di-tree-shake —
tidak ada loader, tidak ada animation system, tidak ada PMREM/env-map (sudah diperiksa di bundle
hasil build). Yang tersisa sebagian besar `WebGLRenderer` sendiri, dan itu bercabang ke
`SkinnedMesh`/`BatchedMesh`/`Sprite`/`Points`/WebXR sehingga tidak bisa dibuang tanpa mem-fork
Three. Batas bawah realistis untuk aplikasi WebGLRenderer memang ~500 kB minified / ~130 kB gzip.

### Bug yang ditemukan dan diperbaiki di bagian ini

Semua ditemukan dengan menyodok logika murni sampai keluar hasil yang absurd, bukan dengan
memainkan game — dan tiap satu sekarang dijaga tes.

| # | Bug | Akibatnya kalau dibiarkan | Tes penjaga |
| --- | --- | --- | --- |
| 1 | `dt` NaN/Infinity membuat kecepatan hero NaN, dan `Collision.move` lalu menghitung jumlah sub-langkah dari NaN → nol iterasi → hero dikembalikan ke posisi semula **setiap frame** | Hero terkunci selamanya, tidak bisa pulih tanpa reload | `edgecases` |
| 2 | `takeDamage(-50)` **menyembuhkan** hero sampai 62 HP (di atas maks); `heal(-3)` **melukainya** | Modifier pertahanan Batch 4 yang kelebihan akan langsung menabrak ini | `edgecases`, `stats` |
| 3 | Hal yang sama pada musuh: `hp` NaN = musuh yang tidak pernah mati dan tidak bisa dibunuh | Boss abadi | `edgecases` |
| 4 | Knockback dari posisi penyerang NaN meracuni kecepatan lewat `atan2` | Musuh/hero terbang ke koordinat NaN | `edgecases` |
| 5 | Musuh yang terjebak **di dalam** dinding mengembara 1214 px/10 detik menembus terrain | Pintu arena boss dan gerbang puzzle menambah tabrakan saat game jalan; musuh di ambang pintu jadi bisa keliling peta lewat dalam batu | `edgecases` |
| 6 | `formatErrors().reverse()` **membalik ring buffer error yang asli** setiap kali panel dibuka | Riwayat error jadi acak setelah dibuka dua kali | — (dihapus polanya) |
| 7 | `errors.ts` memasang `el.onclick` **di dalam** `show()`, yang dipanggil ulang setiap error | Menimpa pendengar lain, menumpuk kerja | — |
| 8 | `u(c.h) * 0.0` dan `yy + ti * 0` — sisa offset yang dikalikan nol | Kode yang tampak berefek tapi tidak | oxlint `erasing-op` |
| 9 | `r` (radius stick) ditimpa `r` (radius tombol) di `TouchControls` | Ukuran tombol salah kalau kode di sekitarnya diubah | oxlint `no-shadow` |
| 10 | `gainExp` dengan level NaN → `Math.max(1, Math.min(30, NaN))` = NaN | Hero level NaN, permanen | `inventory` |
| 11 | `boot3d` memasang `window resize` listener yang tidak pernah dilepas | Kebocoran pendengar tiap kali dunia dibangun ulang | `lifecycle` |
| 12 | Tidak ada penanganan `webglcontextlost` | Kanvas hitam selamanya saat GPU reset / tekanan memori | `lifecycle` |
| 13 | `preload(radius kecil)` + berdiri diam = sisa radius penuh tidak pernah dimuat (regresi dari throttle streaming, ketangkap tes yang sudah ada) | Dunia berhenti memuat setelah teleport | `streaming` |
| 14 | DOM palsu di tes: `innerHTML = ''` tidak menghapus anak, `textContent` tidak menggabungkan keturunan | Mock berbohong → tes lulus untuk alasan yang salah | `characterpanel` |

## Batch 4 — stats, equipment, Inti Lentera, inventaris, progresi

Semua logikanya di `src/core` tanpa satu pun import renderer, jadi semuanya dites di Node.

| Bagian | Di mana | Yang dijamin tes |
| --- | --- | --- |
| Pipeline stats | `core/stats/stats.ts` | flat sebelum persen ((10+6)×1,5 = 24); persen dijumlah bukan dilipat; modifier khusus elemen tidak muncul di lembar tapi kena ke damage; tidak ada gear/buff/save rusak yang bisa membuat stat NaN atau HP maks 0 |
| Formula damage | `core/stats/damage.ts` | satu fungsi untuk **semua** hit; DEF sebagai rasio `100/(100+def)` (zirah tinggi tidak pernah membuat pukulan jadi nol, dan tidak pernah jadi kebal); penguasaan elemen melandai; kritis diundi pemanggil jadi kedua cabang bisa dites; reaksi elemen dikali paling akhir; hit yang kena minimal 1 |
| 8 slot equipment | `core/items/items.ts` | tiap slot punya item yang cocok; aksesori masuk dua slot; item bukan-perlengkapan tidak bisa dipakai |
| Rarity Biasa→Mitos | `core/items/items.ts` | **mengalikan angka item** (×1 … ×2,5), monoton naik, bukan kosmetik |
| 4 Inti Lentera | `core/items/items.ts` + `core/stats/character.ts` | satu per elemen yang sudah diimplementasikan (Api/Air/Es/Petir), masing-masing bonus elemen + satu passive bernama yang jadi aturan di satu file: Perisai Bara, Pasang Pemulih, Mata Badai, Tameng Beku |
| Inventaris | `core/items/inventory.ts` | grid tetap 48 sel; stack terisi dulu; tas penuh melaporkan overflow, tidak menelan item; melepas saat tas penuh **ditolak**; **menukar** tetap bisa saat tas penuh; rarity menempel pada salinan; item yang sudah tidak ada di katalog dibuang saat load, bukan menolak seluruh save |
| Loot | `core/items/drops.ts` | tabel per jenis musuh + peti, undian rarity bertingkat; satu drop per musuh, peti mengundi seluruh tabel |
| Progresi | `core/progression.ts` | level 1–30, kurva naik, level pertama ≈ 3 kill, EXP boss = beberapa level, mentok di cap tanpa bar lewat penuh, dan angka rusak tidak pernah mengurangi EXP |
| Lembar karakter | `core/stats/character.ts` | level + equipment + buff → satu `StatBlock`; buff kedaluwarsa sendiri; `sources()` bisa menyebut asal setiap angka |
| Hadiah quest | `core/systems/quest.ts` | tiap tahap membayar EXP + item bernama, sebagai bagian definisi quest |

**Yang benar-benar berubah saat bermain** (bukan angka di menu):

- Setiap hit — dari hero maupun ke hero — lewat `computeDamage`. `ATTACKS[i].dmg` tetap jadi bentuk
  kombo (2/2/4/7) dan sekarang dipakai sebagai pengali relatif terhadap tebasan pertama, jadi
  **panel tuning combat tetap bekerja seperti sebelumnya**.
- Damage yang masuk dikurangi DEF, tanpa kritis: kritis musuh yang tidak bisa dibaca pemain hanya
  terasa tidak adil.
- Angka kritis muncul oranye. Serap hidup dan Pasang Pemulih mengembalikan HP. Tameng Beku
  memperlambat yang memukul. Mata Badai menambah 20% kritis untuk serangan berat.
- Level naik → HP maks naik **tanpa menyembuhkan**; `setMaxHp` menjepit, tidak menskala, supaya
  melepas helm +5 HP tidak bisa membunuh hero yang sedang sekarat.
- Kecepatan jalan dan **jangkauan lentera** ikut stats. Jangkauan lentera adalah satu-satunya stat
  yang bisa dilihat langsung: lingkaran cahaya di sekitar hero melebar.
- **Peti sekarang bisa dibuka** (sebelumnya cuma hiasan): sekali saja, ditandai flag di save.
  Papan yang dibaca dan altar yang ditemukan pertama kali memberi EXP penemuan.
- HUD: lencana level di potret + bar EXP tipis di bawah HP/energi.

**UI (`src/ui/CharacterPanel.ts`)** — dua tab, KARAKTER dan TAS. Target sentuh minimal 44 px,
lembar detail muncul dari bawah tempat jempol berada, chip kategori untuk grid tas, warna rarity
di bingkai dan nama, kotak Inti Lentera yang menuliskan passive-nya dengan kata-kata. Dibuka lewat
tombol tas di HUD atau `I`/`Tab`; selama terbuka simulasi berhenti dan input dimatikan seperti saat
dialog. 12 tes menjalankan panel asli di DOM palsu, dan satu "tap" di situ adalah pemanggilan
listener nyata pada elemen yang akan disentuh pemain.

**Save v2.** Menyimpan level, EXP, tas, dan slot equipment. Save v1 (termasuk save 2D) tetap
dimuat sebagai hero level 1 bertas kosong, dan itu dicatat di notes migrasi yang muncul di laporan
diagnostik. Save dari versi **lebih baru** ditolak, bukan dibaca separuh — membaca separuh lalu
menimpanya akan menghapus progres.

## Batch 5 — cutscene, audio, UI/HUD, menu

### Bagian 1 — sistem cutscene

Cutscene adalah **data**: daftar langkah di sebuah timeline (`src/core/story/cutscene.ts`).
Menambah cutscene baru = menambah satu entri di `cutscenes.ts`, **tanpa mengubah kode engine**.

| Langkah | Isi |
| --- | --- |
| `wait` | jeda; keheningan itu alat bercerita |
| `say` | dialog, muncul huruf per huruf. Dengan `dur` lanjut sendiri, tanpa `dur` menunggu ketukan |
| `caption` | narasi di tengah layar (nama tempat, lompatan waktu) |
| `fade` | fade ke warna, dengan durasi |
| `camera` | pan + sudut + zoom, dengan easing |
| `light` | seberapa gelap (`night` 0..1) + tint ambient |
| `actor` | pindahkan/pose aktor; hero berjalan dengan animasi jalan yang benar |
| `sfx` / `music` / `ambient` | cue bernama; tabelnya milik renderer, bukan skrip |
| `fx` | partikel bernama |
| `shake` | getaran kamera |
| `flag` | menulis flag di save, jadi dunia bisa bereaksi |

**Cara timeline bekerja.** Tiap langkah dimulai, lalu timeline menunggu `hold` detik sebelum
langkah berikutnya. `hold` default = durasi langkah itu sendiri (jadi daftar biasa terbaca
berurutan); `hold: 0` memulai langkah lalu langsung lanjut — itu cara pan kamera 4 detik berjalan
**di bawah** tiga baris dialog. Satu angka, tanpa blok paralel bersarang.

**Skip** tidak boleh meninggalkan dunia setengah jadi: `skip()` menerapkan semua langkah sisa
dengan durasi nol, jadi kamera, cahaya, pose aktor, dan flag berakhir tepat di tempat cutscene
seharusnya meninggalkannya. Dialog, jeda, dan suara dibuang. Ada tesnya.

Kecepatan teks dari setelan (dibaca lewat fungsi, jadi slider berlaku di tengah cutscene). Ketukan
pertama menyelesaikan baris, ketukan kedua lanjut. Tombol **LEWATI** selalu terlihat, di dalam
safe area. Status tertonton ada di **save** (bukan settings — itu progres, bukan preferensi), dan
bisa diputar ulang dari Pengaturan → Cerita.

### Bagian 2 — cutscene pembuka "Malam Terakhir"

Naskah lengkap Chapter 1 ada di `docs/STORY.md`. Prolognya (66 langkah, ±95 detik) dipentaskan di
tempat **nyata** di dunia yang akan dimasuki pemain: rumah di tepi barat Ravenhollow, jalan desa,
dan plaza. Suasana malam badai, kabut, cahaya lentera, musik dua nada.

Ringkasan adegan: hujan tidak berhenti → lentera ayah yang biasanya menyala malam itu **padam** →
suara gelas pecah → pintu depan terbuka → lentera hitam kecil berukiran aneh, **hangat tanpa api**
→ suara ibu dari luar → berlari keluar, **tidak ada siapa-siapa** → "jangan cari kami…" → suara
ayah: "kalau lentera itu menyala… berarti mereka sudah menemukanmu" → lentera menyala sendiri, api
**biru pucat** → seluruh lampu desa padam → "Tujuh tahun kemudian" → diserahkan ke gameplay.

Orang tuanya hanya **terdengar**, tidak pernah terlihat. Itu bukan penghematan — itu memang
adegannya: anak itu berlari keluar dan tidak ada siapa-siapa.

**Nama tokoh utama** ditanyakan sekali, di layar judul, saat menekan MAIN BARU. Naskah memanggilnya
Arka, tapi setiap baris ditulis dengan placeholder `{nama}` dan diisi saat diputar. Boleh dilewati
("Pengembara"). Dibatasi 14 karakter karena nama itu muncul di HUD, kotak dialog, dan di atas kepala
hero.

Nama area diselaraskan: **Ravenhollow**, **Hutan Noctis**, **Gua Lumen**. ID-nya
(`village`/`forest`/`cave`) sengaja tidak diubah — ada di save, id checkpoint, dan tes.

> **Belum selaras:** rangkaian quest-nya masih cerita lama (Tetua Wulan, "Cahaya untuk Desa",
> Lentera Agung). Menulis ulangnya menjadi Chapter 1 (Nara, buku ayah, Menara Lumen, tujuh lentera)
> adalah pekerjaan konten tersendiri, bukan bagian dari keempat bagian Batch 5 — dicatat di sini,
> bukan dikerjakan setengah jalan.

### Bagian 3 — audio

Lima kategori dengan volume masing-masing: **Musik, Suasana, Tempur, Efek, Antarmuka**. Bukan satu
slider master, karena itu lima masalah berbeda.

Enam track prosedural: Ravenhollow (siang), Ravenhollow Malam, Hutan Noctis, Gua Lumen, Kolosus
Kelam, Malam Terakhir. **Semuanya satu nada dasar (A minor)** — crossfade antar dua lagu beda nada
terdengar seperti kesalahan, dan pemain melewati batas area terus-terusan. Yang berbeda antar area
adalah register, tempo, dan seberapa banyak ruang kosongnya.

Enam bed suasana: angin (dengan embusan), malam (jangkrik + angin tipis), gua (drone + tetesan air
+ gemuruh), api (kerak-kerik), badai, badai jauh.

| Aturan | Kenapa |
| --- | --- |
| Boss menimpa semuanya | musik harus datang bersama pertarungannya |
| Gua mengabaikan waktu | di dalam gua tidak ada langit |
| Desa punya track malam sendiri | |
| Crossfade 1,2 s masuk boss | pendek, supaya tiba bersamaan |
| Crossfade 4,5 s di batas area | batas di dunia ini tidak kelihatan; fade pendek akan mengumumkan garis yang tidak bisa dilihat pemain |

Musik dijadwalkan **di depan waktu**, satu bar sekaligus, dari timer yang cuma memutuskan "sudah
dekat belum". WebAudio memutar pada `currentTime` yang tepat, jadi timer-nya boleh di-throttle
browser tanpa musiknya melayang. Clock context berhenti saat tab disembunyikan, jadi scheduler ikut
berhenti — kalau tidak, semua yang sudah dijadwalkan meletus sekaligus saat kembali.

Folder `public/assets/audio/` + README menjelaskan cara mengganti dengan file buatan manusia.
**Jujur:** pemuat berkasnya belum ada; yang sudah ada seam-nya (semua pemanggil memakai nama, bukan
berkas), jadi pemuatnya bisa dipasang di satu tempat. Masuk Batch 7.

### Bagian 4 — UI, HUD, menu

**Safe area.** `viewport-fit=cover` + `--lm-sa*` custom property untuk CSS + `safeInsets()` untuk
yang memposisikan dengan JavaScript. Yang sekarang menghindar dari notch dan lengkungan: vitals,
minimap, objektif quest, tombol gear/tas/jeda/fullscreen, dialog, overlay cutscene, panel karakter,
panel pengaturan, joystick, dan 4 tombol aksi.

**Menu utama:** Lanjutkan, Main Baru, Pengaturan, Akun, Kredit. Akun jujur soal dirinya (Batch 7,
dan progres sekarang hanya di HP ini lewat penyimpanan browser).

**Menu pause:** Lanjut, Inventaris, Karakter, Senjata, Skill, Quest, Peta, Pengaturan, Simpan &
Keluar — semuanya menampilkan state nyata (senjata dibaca dari `ATTACKS`/`BOW_SHOTS` jadi ikut
berubah kalau panel tuning diubah; skill menampilkan satu skill yang memang ada, bukan slot palsu;
peta menggambar atlas dunia yang sudah dibuat minimap). Tata letak satu kolom di kiri + isi di
sebelahnya, supaya layar 2318x759 dipakai bukan diberi bantalan.

**Notifikasi bertumpuk** untuk loot, langkah quest, level up, dan elemen terbuka. Maksimal 4,
animasi hanya transform + opacity (properti compositor, tidak memicu layout pass).

**Blur** hanya di preset Tinggi ke atas.

### Dua perbaikan dari laporan tes

**1. Pengaturan tidak muncul apa-apa dari menu utama.** Panelnya dibangun, ditata, dan terbuka —
tapi di `z-index: 85`, sementara layar judul di `90` dengan latar gradien penuh. Jadi panelnya
benar-benar ada, persis di belakang sesuatu yang menutupi seluruh layar, dan tidak ada yang cukup
rusak untuk melempar error. Sekarang di `96`, di atas layar judul (90), menu jeda (86), dan lembar
karakter (88) — karena bisa dibuka dari ketiganya. Urutan lapisannya sekarang ditulis di satu
tempat (komentar di `SettingsPanel.ts`) **dan** dijaga tes yang membaca z-index langsung dari
stylesheet-nya, bukan dari komentar:

```
66 HUD   70 kontrol sentuh   72 dialog   80 tombol sudut
86 menu jeda   88 lembar karakter   90 layar judul   94 overlay cutscene
96 pengaturan   99 panel error
```

**2. Joystick sekarang posisi tetap.** Sebelumnya dinamis: base-nya muncul di tempat jempol mendarat
dan ikut bergeser kalau jempol keluar dari cincin. Sekarang base tinggal di tempat yang diatur di
Pengaturan dan hanya knob-nya yang bergerak. Alasannya masuk akal: dengan base tetap, jempol hafal
satu titik dan bisa menemukannya tanpa melihat — yang justru dibutuhkan saat ada yang mengayun ke
arahmu.

Dua detail yang ikut dijaga supaya tidak jadi masalah baru:
- Jempol yang melewati tepi cincin **dijepit ke pinggirnya** dan tetap terbaca sebagai tilt penuh,
  jadi kamu bisa menggeser jauh keluar lingkaran dan tetap berjalan.
- Sentuhan hanya menangkap stick kalau jaraknya dalam **2,4x radius** base. Tanpa batas itu,
  seluruh paruh kiri layar jadi satu stick raksasa dan ketukan tidak sengaja di tepi terbaca
  sebagai tilt penuh. Ada tesnya: ketukan jauh dari base tidak menggerakkan hero.

### Performa

Yang ditambahkan ke jalur per-frame, dan kenapa tidak menurunkan FPS:

| Tambahan | Biaya per frame |
| --- | --- |
| `tickCutscene` | langsung `return` kalau tidak ada cutscene |
| `updateSoundtrack` | 3 perbandingan + `nightAmount` (yang sudah dihitung di frame yang sama); bus hanya dipanggil saat jawabannya BERUBAH |
| `updatePopups` | loop paling banyak 4 elemen |
| Notifikasi | node DOM dibuat hanya saat ada kejadian, dianimasikan compositor |
| Scheduler musik | timer 250 ms di luar frame; ~21 node/detik di track tercepat |
| Scheduler suasana | timer 200 ms; buffer noise di-cache per context (dulu 144k sampel per pergantian bed) |

Tidak ada penambahan draw call, tidak ada material/geometri baru, tidak ada shader baru.

### Interaksi di HP (dari laporan tes, sudah dicek pemain di HP)

**1. Tombol interaksi kontekstual.** Penyebab "tidak bisa bicara/membuka apa pun" di HP: kontrol
sentuh **tidak punya tombol interaksi sama sekali**. `E` jalan di keyboard, teks prompt muncul di
atas kepala hero, tapi tidak ada yang bisa menekannya di layar. Sekarang ada tombol di atas tombol
ganti senjata yang hanya muncul (`display:none`, jadi tidak menelan ketukan saat tersembunyi) bila
ada sesuatu dalam jangkauan, dengan kata dari dunia: **Bicara / Baca / Buka / Kosong / Berdoa**.
Kalau tombolnya hilang saat masih ditekan, pelepasannya disintesis supaya aksi tidak tersangkut.

**2. Penanda chevron.** Satu sprite `v` kecil melayang di atas benda terdekat yang bisa
diinteraksi (tinggi per jenis lewat `Interactable.markerLift`). Satu sprite yang dipindah-pindah,
bukan satu per benda: tanpa draw call tambahan saat tidak ada target.

**3. Jangkauan & label.** Jangkauan diperlebar supaya bisa dikenai dengan jempol (NPC 34→44,
papan 26→38, peti 28→38, altar 32→42). Peti kosong bilang "Kosong", bukan diam; checkpoint jadi
"Berdoa". Bunyi interaksi pakai `sfx.pickup`.

Tes: `tests/interaction.test.ts` (setiap NPC, papan, peti, dan altar di dunia hasil generate
didatangi dan ditekan), dua tes baru di `touchcontrols.test.ts`, dan `tests/source.test.ts`
yang menjaga backtick di dalam blok CSS/GLSL (sudah tiga kali memecahkan build).

## Perbaikan sebelum Batch 6

### Bagian 1 — tombol interaksi tidak berfungsi di HP

**Penyebab:** tombol interaksi **tidak ada sama sekali** di kontrol sentuh. Tombol `E` bekerja di
keyboard, dan teks "Bicara"/"Baca" muncul di atas hero — tapi di HP tidak ada satu pun elemen di
layar yang bisa memicu aksi `interact`. Jadi game bilang "Bicara" lalu mengabaikan setiap ketukan,
yang terbaca seperti tombol rusak padahal tombolnya memang tidak pernah dibuat. Logika interaksinya
sendiri (`nearestInteractable`, dialog, quest) selalu benar; tes lama menekan `input.press('interact')`
langsung, jadi tidak pernah menyentuh jalur sentuh.

**Perbaikan:**
- Tombol interaksi **kontekstual** di `TouchControls`: tersembunyi total (`display:none`, jadi tidak
  bisa menelan ketukan) sampai ada sesuatu dalam jangkauan, lalu muncul dengan label dari dunia.
  Kalau hilang saat masih ditekan, rilisnya disintesis supaya aksi tidak macet tertekan.
- Label per jenis: **Bicara** (warga), **Baca** (papan), **Buka** / **Kosong** (peti), **Berdoa**
  (shrine — mekanismenya tetap simpan + pulihkan HP, kata yang tadinya "Istirahat").
- Satu penanda chevron melayang di atas objek terdekat (satu sprite yang dipindah, bukan satu per
  objek), tingginya menyesuaikan jenis objek.
- Jangkauan dilonggarkan: 34→44 px warga, 26→38 papan, 28→38 peti, 32→42 shrine. Nyaris-cukup-dekat
  tanpa prompt terasa seperti tombol rusak saat menyetir dengan jempol.
- Keyboard tetap `E`/`Enter`.

**Tes:** `tests/interaction.test.ts` (10) mendatangi **setiap** warga (4), papan (8), peti (6), dan
shrine (3) di dunia yang digenerate, lalu menekan interaksi; peti yang dikosongkan tetap kosong
setelah save/reload; prompt hilang saat menjauh, saat dialog terbuka, dan saat hero mati; jangkauan
2–2,5 petak berhasil. `touchcontrols.test.ts` +2: tombol tersembunyi tidak menelan ketukan, dan
menghilang di tengah tekanan tidak meninggalkan aksi macet. `layout.test.ts`: 5 tombol tidak
bertumpuk dan tetap di safe area pada teks 2x/tombol 1.3x dan 1.8x.

Plus `tests/source.test.ts`: tidak ada backtick di dalam blok CSS/GLSL (sudah tiga kali kejadian).

### Bagian 2 — Inti Lentera & elemen pertama lebih awal

**Temuan yang lebih besar dari yang diminta:** `hero.element` **tidak pernah di-set di mana pun**
sejak Batch 3. Jadi walaupun Inti Lentera dipasang, setiap serangan tidak membawa elemen, dan reaksi
hanya pernah terjadi di tes yang men-set-nya manual. Sistem elemen praktis tidak bisa dicapai dalam
permainan normal. Sekarang `applySheet()` men-set elemen **primer** ke senjata dan **sekunder** ke
skill.

Ditambah: **panah tidak lewat pipeline damage** — level, ATK, kritis, dan DEF musuh tidak
berpengaruh sama sekali pada busur. Sekarang lewat `computeDamage` seperti pedang.

**Tutorial "Bara Pertama"** (`src/core/systems/tutorial.ts`, murni):

1. Setelah prolog, objektif di layar: **Berdoa di shrine Ravenhollow** — shrine itu 1 petak dari
   titik mulai Game Baru.
2. Berdoa → lentera menjawab → **Inti Bara** masuk tas **dan langsung terpasang** → Api dipelajari
   → notifikasi "Elemen Api terbuka" → objektif: **pukul boneka latihan dengan Api**.
3. Boneka latihan berdiri permanen di plaza (5 petak timur shrine). Satu tebasan ber-Api → label di
   atasnya menunjukkan "Terbakar" + damage → tutorial selesai → tracker kembali ke quest utama.

Save lama yang sudah punya elemen otomatis dianggap selesai. Quest utama tidak diubah dan bisa
dikerjakan paralel.

**Elemen primer & sekunder** (`Character`): primer di senjata, sekunder di skill — jadi pedang Api +
ledakan Es bisa memicu reaksi Lebur sendirian. Elemen dipelajari dengan memasang Inti yang
membawanya, dan **tetap** dipelajari setelah Inti dilepas. Pemilihnya ada di panel Karakter.

**Boneka latihan** (`TrainingDummy`): tidak bergerak, tidak menyerang, tidak pernah mati, tanpa DEF
atau resistensi, tanpa EXP/loot, dan tidak pernah memicu event `died` (yang akan menghitung kill
quest). Status aktifnya tampil di atasnya, diperbarui 5x/detik.

**Tes:** `tests/tutorial.test.ts` (5) — termasuk jalur lengkap di `Game3D` asli: Game Baru → skip
prolog → objektif tutorial → jalan ke shrine → prompt "Berdoa" → tekan → Inti Bara terpasang, Api
dipelajari, `hero.element === 'api'` → tebas boneka → status "Terbakar" → selesai → tracker kembali
ke quest utama → save/reload tetap utuh.


### Bagian 3 — Mode Pengembang

Cara membuka ada di `README.md`: **`?debug=1`**, atau **ketuk nomor versi di dasar Pengaturan 5 kali
cepat**. Setelah itu tombol **DEV** hijau muncul di kanan atas dan bertahan setelah reload.

| Bagian | Isi |
| --- | --- |
| Item & Koin | setiap item di katalog pada rarity pilihan, semua Inti Lentera, satu set perlengkapan Legendaris, +100/+1000 koin |
| Elemen | buka Api/Air/Es/Petir, pilih primer (senjata) dan sekunder (skill) |
| Level & EXP | atur level 1–30 (HP dipulihkan), tambah EXP |
| Musuh & Boneka | lendir, pemanah, 3 kelelawar, boss, boneka latihan — di depan hero, di petak yang bisa dicapai; tombol hapus semua |
| Teleport | titik mulai, Lentera Agung, boneka latihan, 3 shrine, ruang puzzle, pintu & dalam arena boss, **setiap peti** |
| Jam & Cuaca | pagi/siang/sore/malam; cerah/berkabut/hujan/badai |
| Lainnya | kebal (serangan terasa, HP tidak berkurang), pulihkan HP, log reaksi nyala/mati, reset status cutscene, hapus save |

**Log reaksi** muncul di kiri layar selama mode pengembang aktif: `Api + Es → Lebur`. **Boneka
latihan** menampilkan status aktif dan damage yang diterima di atasnya.

Musuh dari menu ditandai `dev_`: memberi EXP dan koin, memicu passive Inti, tapi **tidak** dihitung
quest, tidak diingat sebagai mati di save, dan boss-nya tidak menutup pintu arena yang asli.

**Tambahan yang dibutuhkan menu ini:**
- **Koin** — sekarang angka nyata yang tersimpan, didapat dari setiap monster (2–5, boss 120). Belum
  ada toko yang memakainya; dicatat terus terang, bukan UI palsu.
- **Cuaca** (`core/systems/weather.ts`) + **hujan** (`render3d/Rain.ts`): satu draw call, dianimasikan
  seluruhnya di vertex shader (nol kerja CPU per frame), dan **tidak digambar sama sekali** saat
  cuaca tidak hujan. Belum ada sistem cuaca yang berubah sendiri — itu world event Batch 7.

**Tidak ada di build rilis — dan versi pertamanya salah soal ini.** Gerbang awalnya memanggil fungsi
`devToolsBuild()`; menunya memang tidak pernah dimuat di rilis, tapi **dua chunk-nya tetap ikut di
`dist/`**, bisa diunduh siapa pun yang menebak nama berkasnya. Sekarang gerbangnya ekspresi literal
`import.meta.env.DEV`, yang diganti `false` saat build sehingga bundler membuang impornya. Dijaga
`tests/devmode.test.ts` yang **membangun versi rilis sungguhan** dan memeriksa outputnya (sudah
diverifikasi: gerbang lama membuat tes itu merah).

**Tes:** `tests/devmode.test.ts` (11) — pintu masuk, build rilis bersih, dan setiap tombol pada
`Game3D` asli: item/inti/set/koin, elemen & primer/sekunder sampai ke hero, level/EXP, spawn tiap
jenis tanpa menyentuh quest/save, **setiap teleport mendarat di petak yang bisa dipijak**, jam,
cuaca, kebal, reset, dan log reaksi `Api + Es → Lebur` pada boneka.


## Batch 6 — data area, Download Manager, AUTO per komponen

### AUTO per komponen

AUTO lama berjalan di satu tangga **preset utuh**: saat FPS turun, seluruh tampilan turun sekaligus.
Sekarang (`core/autotune.ts`) AUTO memutar **satu dial satu takik**, kerugian visual termurah dulu,
dan baru menurunkan preset saat semua dial sudah minimum. Urutan 16 langkahnya (dari uji performa
A/B di HPmu): partikel → angin rumput → grain tanah → bloom → … → lampu dinamis → resolusi → air →
jarak pandang → … → **outline paling terakhir**. Setiap komponen = min(preset, AUTO): AUTO hanya bisa
mengurangi dari preset yang tampil di Pengaturan.

**Di laporan tes** ("Salin laporan"): AUTO nyala/mati, langkah ke berapa dari 16, komponen mana
saja yang sedang diturunkan, dan 12 keputusan terakhir dengan waktu, arah, apa, dan fps
rata-rata/terendah yang memicunya. Toast "AUTO: bloom 1 → 0.6" muncul saat terjadi.

### Data area dan kenapa ada

Dunia ini digenerate, jadi sebenarnya tidak ada yang *harus* diunduh — dan itu kutulis terus terang.
Tapi `bakeChunk` (memanggang tekstur tanah satu chunk) adalah kerja paling mahal saat berjalan:
**11–22 ms per chunk di Node**, beberapa kali lipat di HP, tepat saat chunk baru dimuat. Paket area
berisi tanah yang **sudah dipanggang saat build** dan dikompres:

| Area | Chunk | Ukuran |
| --- | --- | --- |
| Ravenhollow (inti) | 48 | 439 KB |
| Hutan Noctis | 48 | 545 KB |
| Gua Lumen | 32 | 180 KB |

Jadi paket mengubah hitch di setiap chunk menjadi sekadar lookup, sekaligus menjadi jalur kirim untuk
aset buatan tangan per area nanti. Dijaga tes bahwa paket yang didekode **identik byte-per-byte**
dengan yang akan dipanggang HP, dan bahwa build dua kali menghasilkan berkas identik (supaya build
ulang tidak memaksa unduh ulang).

- **Format** (`core/download/pack.ts`): kontainer sederhana, satu payload deflate per chunk; berkas
  terpotong / format asing / berlebih ditolak, tidak dibaca setengah.
- **Manifest** (`core/download/manifest.ts`): versi per area = hash isi; URL berkas = hash berkas
  (tidak pernah berubah di bawah URL yang sama); maks **20 MB per berkas** (area besar dipecah).
  URL absolut / `..` / bukan `.bin` ditolak.
- **Dibangun oleh plugin Vite** (`scripts/areaPacks.ts`): dev server membuatnya saat start dan
  menyajikan dari memori; `vite build` menulisnya ke `dist/data/`. Tidak di-commit ke git.

### Download Manager

Pengaturan → **Data dunia → Download Manager**:
- status tiap area (Terpasang / Belum diunduh / Versi baru tersedia / Mengunduh / Gagal)
- progres **"x KB dari y KB"** dengan bar, tombol Unduh / Perbarui / Coba lagi / Hapus
- **sisa penyimpanan** dari `navigator.storage.estimate()`
- **penyimpanan permanen**: status + tombol "Minta izin" (`navigator.storage.persist()`)

### "Data Dunia Diperlukan"

Melangkah ke Hutan Noctis / Gua Lumen tanpa datanya → hero dikembalikan ke tepi area, muncul prompt
dengan nama area, ukuran, bar progres, tombol **Unduh** (atau **Coba lagi**), dan **Nanti** /
**Lanjut di latar**. Begitu terpasang, prompt tertutup sendiri dan hero bisa masuk.

Aturannya (`core/download/gate.ts`): **Ravenhollow tidak pernah digerbang** (diunduh diam-diam di
latar; sampai tiba, HP memanggang sendiri); versi lama tetap boleh masuk (pembaruan ditawarkan, tidak
dipaksa di tengah jalan); **save yang sudah berada di dalam area tanpa data tidak dilempar keluar**;
dan kalau browser tidak punya Cache Storage, tidak ada gerbang sama sekali — dunia selalu bisa
digenerate lokal, dan mengunci dua pertiga game karena browser tidak bisa menyimpan berkas adalah
pertukaran yang salah.

### Unduhan yang aman

`core/download/downloader.ts`, dites dengan fetch & cache palsu:
- berkas ditulis ke cache **hanya setelah lengkap dan SHA-256-nya cocok** — koneksi putus di 40%
  tidak meninggalkan apa pun untuk berkas itu, sedangkan berkas yang sudah selesai tetap ada, jadi
  **coba lagi melanjutkan dari berkas pertama yang hilang**;
- penanda "terpasang" ditulis **terakhir** — area setengah jadi tidak pernah dianggap siap;
- data yang sudah ada tidak diunduh ulang kecuali versinya berubah;
- versi lama dihapus **setelah** versi baru lengkap — pembaruan yang gagal meninggalkan versi lama yang
  masih bekerja.

### Bug yang ketangkap tes di bagian ini

Batas tunggu chunk yang tekstur paketnya masih di-inflate dihitung **per kunjungan antrean**. Dengan
~15 chunk antre dan 1 chunk/frame, tiap chunk baru dikunjungi setiap frame ke-15, jadi "20 kunjungan"
berarti **5 detik tanah kosong** kalau paketnya lambat. Sekarang batasnya waktu: 0,35 dtk, lalu HP
memanggang sendiri. Teleport dan frame pertama tidak menunggu sama sekali.

**Tes baru Batch 6:** `autotune` (10), `download` (13), `areadata` (9), `downloadui` (5).

## Perbaikan: Pengaturan kosong (hanya judul "PENGATURAN")

**Penyebab:** tabrakan nama class CSS. Setiap overlay menyuntikkan stylesheet global sendiri, dan
header menu Pengaturan memakai class `lm-title` — nama yang sama dengan **akar layar judul**
(`position: fixed; inset: 0; z-index: 90`, latar gradien gelap, isi di tengah). Header itu
membesar menutupi seluruh panel: yang terlihat hanya kata "PENGATURAN" di tengah layar, semua baris
setelan tetap ada di DOM tapi tertutup. Perbaikan z-index sebelumnya (85 → 96) membuat panelnya
tampil di atas layar judul, tapi headernya tetap menutupi isinya. Layar judul dan menu jeda memakai
komponen yang **sama** (`SettingsPanel` lewat `DebugUi`), jadi keduanya kena.

Ditemukan juga dua tabrakan lain (`lm-hint` dengan HUD, `lm-note` dengan panel Karakter) dan satu
bug gulir: badan daftar tidak punya `min-height: 0`, jadi di layar setinggi 759 px bagian bawah
daftar bisa terpotong alih-alih bisa digulir.

**Perbaikan:** semua class Pengaturan kini berawalan `lm-set-*`; badan daftar bisa menyusut dan
menggulir; baris "chip" di atas untuk lompat ke tiap kelompok.

**Isi Pengaturan sekarang:** Grafik (preset AUTO → Ultra, skala render, bloom, partikel, angin
rumput, lampu dinamis, grain tanah, air beriak, jarak pandang ekstra, outline, reset grafik) ·
Kamera (sudut, zoom, reset) · Kontrol (ukuran & posisi joystick, ukuran tombol, reset) · Tampilan
(ukuran teks, kecepatan teks dialog, nama, penghitung FPS) · Audio (5 kategori) · Combat · Cutscene
(putar ulang) · Data (Download Manager, **hapus data dunia**, **reset save**) · Diagnostik.

Setelan grafik individual bekerja sebagai **batas atas milik pemain**: setiap komponen =
min(preset, AUTO, pilihan pemain). AUTO tetap bisa menurunkan, pilihan pemain tidak pernah menaikkan
di atas preset. Reset save bertanya dua kali, lalu save **dikunci terhapus** sampai halaman dimuat
ulang (`wipeSave`) — sebelumnya `pagehide` saat reload bisa menulis save yang baru dihapus kembali
(ini juga memperbaiki tombol reset save di Mode Pengembang).

**Tes:** `tests/settingspanel.test.ts` (7) membangun Pengaturan bersama layar judul, menu jeda, HUD
dan dialog, lalu **menghitung CSS yang akan diterapkan browser** dari semua stylesheet ke setiap
elemen panel: tidak boleh ada elemen di dalam panel yang jadi `position: fixed` atau diberi gaya
oleh stylesheet lain. Diverifikasi: mengembalikan class lama membuat tes ini gagal dengan pesan
`"PENGATURAN" is position:fixed via lm-ui-title .lm-title`. Plus: semua kelompok & setelan ada dan
berfungsi, preset berputar AUTO→Ultra, daftar bisa digulir di 2318x759 dengan teks 2x/tombol 1.3x,
dibuka dari layar judul dan menu jeda (panel yang sama), reset save. `tests/source.test.ts`
menambah penjaga: **tidak boleh ada class yang diberi gaya oleh dua stylesheet berbeda**.

## Busur: rasa yang diperbaiki

Laporan tes: "busur terasa kurang bagus". Yang ternyata salah atau tidak ada:

- **Panah terbang menyamping.** Mesh-nya diputar `-sudut + 90°`, jadi setiap panah meluncur
  melintang seperti batang kayu. Sekarang panah (batang + mata + bulu) menghadap arah terbangnya,
  dijaga tes yang memeriksa sumbu mesh.
- **Terlalu cepat untuk dilihat.** 300/420/520 px/dtk = 17 px per frame di 30 fps. Sekarang
  230/285/340 px/dtk.
- **Deteksi kena berupa titik**, jadi panah cepat bisa melompati musuh kecil di antara dua frame.
  Sekarang lintasannya disapu per frame dan musuh dikenai sesuai urutan jalur
  (`core/combat/arrows.ts`, murni dan dites).
- **Hero memegang pedang saat memanah.** Sekarang ada model busur (dengan tali yang tertarik
  sesuai charge dan anak panah terpasang), pose menarik busur, dan tali yang terlepas saat panah
  dilepas.
- **Auto-aim busur memakai jangkauan pedang (62 px).** Busur kini punya sendiri: 170 px, kerucut 22°.

Yang ditambahkan:
- **Garis bidik** di tanah yang memanjang sesuai charge dan berubah emas saat penuh; **cincin
  target** di bawah musuh yang akan dikunci auto-aim.
- Gerak melambat saat menarik (45%), bunyi "krek" saat mulai menarik dan "klik" + getar pendek saat
  charge penuh.
- Saat lepas: getaran kamera sesuai charge, dan untuk charge penuh hit-stop singkat + **getar HP**
  (`navigator.vibrate`, diam saja kalau browser tidak mendukung).
- **Panah menancap** di dinding (dengan debu dan bunyi "tuk") atau di musuh (ikut bergerak, hilang
  saat musuh mati), lalu mengecil dan hilang. Tembakan tembus (charge penuh) punya jejak cahaya
  berwarna elemen.
- **Semua angka di `BOW` + `BOW_SHOTS`** (26 angka: waktu tarik, gerak saat menarik, jangkauan &
  kerucut bidik, panjang garis, umur panah, lama menancap, getaran, hit-stop, getar HP, dan
  kecepatan/damage/jeda/pemulihan/tembus tiap tembakan) ada di **Pengaturan → Combat → Setelan
  Combat**.

Tes: `tests/arrows.test.ts` (10) dan dua tambahan di `tests/combat3d.test.ts`.

## Avatar hero di panel Karakter + perlengkapan yang terlihat

- **Avatar 3D langsung** (`render3d/Portrait3D.ts`): model hero yang sama, di scene kecil sendiri
  dengan framing setengah badan, cahaya kunci hangat, rim biru, lentera hero sendiri, dan latar
  gradien. Dirender 84x104 lalu diperbesar tanpa haluskan (pixelated) supaya cocok dengan gaya game.
  Bernapas (animasi idle), memegang senjata yang sedang aktif (pedang atau busur).
- **Biaya:** dibuat hanya saat panel pertama kali dibuka; hanya merender saat tab Karakter tampil,
  10 fps; ukuran baca-balik 35 KB. Di luar panel tidak ada biaya. Saat perlengkapan berganti, satu
  frame digambar walaupun panel tertutup, supaya sudah benar saat dibuka lagi. Kalau driver menolak
  baca-balik, potret berhenti di gambar terakhir (tidak crash).
- **Perlengkapan kini terlihat di hero** (di dunia dan di avatar) — sebelumnya model hero sama
  saja apa pun yang dipakai: helm = lingkar besi dengan permata warna rarity; badan = pelindung
  bahu; sarung tangan & sepatu diwarnai rarity; pelindung gagang pedang warna rarity senjata;
  lentera bercahaya warna elemen Inti Lentera. `core/items/look.ts` (murni) memetakan slot →
  warna.
- Tes: `tests/portrait.test.ts` (3) — warna dari rarity, helm/pelindung bahu muncul/hilang, potret
  masuk ke panel, 10 gambar/dtk saat tampil, nol saat tertutup, satu gambar saat gear berganti.
  (Piksel sungguhan hanya bisa dicek di HP: stub GL tidak bisa mengompilasi shader.)

## Layar judul, akun wajib, layar penuh

**Alur baru:** logo (lentera bercahaya) → **"Sentuh untuk memulai"** → **Masuk / Daftar** → menu
(Lanjutkan, Main Baru, Pengaturan, Akun, Kredit). Ketukan pertama itu adalah satu-satunya gestur
pengguna yang pasti ada, jadi di situlah musik tema (`title`, "Lentera Malam") mulai dan layar penuh
diminta. Tidak ada opsi "Main sebagai Tamu".

**Akun (lokal dulu, `core/account/`):**
- `AuthAdapter` = antarmuka yang nanti diganti adapter server (Batch 7). Sekarang `LocalAuth`.
- Kata sandi **tidak pernah disimpan**: hanya hash PBKDF2-SHA-256 (Web Crypto, 310 000 iterasi,
  salt acak 16 byte per akun). Tes mencari kata sandi di seluruh isi storage dan tidak menemukannya.
  Perbandingan konstan-waktu; salah 5 kali → jeda bertahap (5 dtk, 10 dtk, … maks 5 menit).
- Nama akun 3–20 huruf kecil/angka/_; kata sandi minimal 8 karakter.
- **Peringatan di form Daftar**, sebelum kata sandi dibuat: akun hanya tersimpan di perangkat ini,
  hilang kalau data browser dibersihkan, tidak bisa dipakai di HP lain, dan jangan pakai kata sandi
  yang sama dengan akun penting. Tidak ada kata "aman".
- Browser tanpa Web Crypto (halaman http://) tidak diberi akun lemah: layar menjelaskan perlu HTTPS.
- **Save per akun** (`save/v1@<akun>`): dua orang di satu HP tidak saling menimpa. Akun pertama yang
  masuk di HP yang sudah punya progres **mengadopsi** save lama itu.
- **Jalur pengembang:** tombol "LEWATI LOGIN (MODE PENGEMBANG)" hanya di build dev/staging; teks dan
  tombolnya tidak ada di bundle rilis (dicek).

**Layar penuh (`ui/fullscreen.ts`):** diputar ke landscape → coba masuk layar penuh; kalau browser
menolak (butuh ketukan), muncul tombol **⛶ Layar Penuh** di atas tengah (bisa ditutup ×, muncul
lagi setelah HP diputar). Setelah masuk, orientasi dikunci ke landscape kalau didukung (iOS tidak).
Masuk/keluar layar penuh memicu resize dua kali (langsung dan setelah 350 ms) supaya ukuran render
tidak salah. Tombol ⛶ di HUD memakai aturan yang sama.

Tes: `account` (7), `title` (7), `fullscreen` (4), plus lapisan z tombol Layar Penuh di `layout`.

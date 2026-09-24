# Mengganti audio sintetis dengan file buatan manusia

Semua musik, suasana, dan efek suara di game ini **dihasilkan kode** (WebAudio: osilator + noise
yang difilter). Alasannya ukuran: satu loop dua menit sebagai `.ogg` itu 1–2 MB **per area**, dan
game ini harus bisa dibuka lewat data seluler. Lima area musik prosedural memakan beberapa ratus
byte angka.

Tapi musik buatan manusia selalu lebih baik. Jadi jalurnya sudah disiapkan:

## Cara kerjanya sekarang

Semua suara diminta lewat **nama**, bukan lewat berkas:

```ts
bus.music('forest');     // core/audio/bus.ts
bus.ambient('cave');
sfx.thunder();
```

Nama itu diterjemahkan jadi bunyi di:

| Nama | Definisinya di | Bentuknya |
| --- | --- | --- |
| Musik (`village`, `night`, `forest`, `cave`, `boss`, `intro`) | `src/core/audio/tracks.ts` | data: bpm, tangga nada, progresi akor, pola 16 langkah |
| Suasana (`wind`, `night`, `cave`, `fire`, `storm`, `storm-far`) | `src/core/audio/beds.ts` | data: lapisan noise + kejadian acak (jangkrik, tetesan, gemuruh) |
| Efek (`swing`, `hit`, `thunder`, …) | `src/core/audio/sfx.ts` | kode: osilator + noise |

## Cara menggantinya

Taruh berkasnya di folder ini dengan nama yang **sama persis** dengan nama di tabel atas:

```
public/assets/audio/music/forest.ogg
public/assets/audio/ambient/cave.ogg
public/assets/audio/sfx/thunder.ogg
```

lalu daftarkan di `manifest.json`:

```json
{ "music": ["forest"], "ambient": ["cava"], "sfx": ["thunder"] }
```

> **Status jujur:** pemuat berkasnya **belum ada**. Yang sudah ada adalah seam-nya — semua pemanggil
> sudah memakai nama, bukan berkas, jadi pemuatnya bisa dipasang di satu tempat
> (`src/core/audio/bus.ts`) tanpa menyentuh satu pun pemanggil. Ini dicatat sebagai pekerjaan
> Batch 7, bukan diklaim selesai.

Format yang disarankan: `.ogg` (Vorbis) untuk Android, ~96 kbps mono untuk suasana dan efek,
~128 kbps stereo untuk musik. Loop musik sebaiknya tepat pada bar supaya tidak terdengar jahitannya.

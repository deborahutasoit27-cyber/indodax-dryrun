# Laporan & Refleksi — Bot Dry Run Indodax

Mata kuliah Algorithmic Trading · UAS · Debora
Strategi `crypto-donchian-1.0.0` · dry run, tanpa uang sungguhan

---

## 1. Ringkasan

Saya membangun satu bot yang membaca candle dan order book Indodax sungguhan, lalu
mengeksekusi order simulasi dengan menelusuri level bid/ask. Strategi Donchian dari UTS
(150/40 harian) saya pindahkan ke kripto 1 jam (168/48) dan tambahkan filter tren EMA200
serta trailing stop ATR.

Hasil backtest 3 tahun: **+65,67% (CAGR 18,32%), MDD −12,86%, 238 trade, PF 1,61**.
Pembanding BTC/IDR buy & hold pada periode yang sama: **+153,18%** dengan MDD **−49,61%**.

Kesimpulan yang jujur: **strategi ini kalah return dari sekadar membeli BTC**, tetapi
menghasilkan drawdown yang jauh lebih kecil. Nilainya ada pada pembatasan kerugian,
bukan pada penciptaan alpha.

---

## 2. Apa yang benar-benar diukur

| Hal | Nilai | Sumber |
|---|---|---|
| Candle | 131.490 bar 1 jam | `data/candles/*.json` |
| Coverage | 100,00% | `data/history_manifest.json` |
| Snapshot order book | 100 | `data/snapshots/*.json` |
| Trade backtest | 238 | `data/backtest_full.json` |
| Baris CSV trade | 238 | `data/trades_full.csv` |
| Unit test | 17 lulus | `npm test` |
| Pemeriksaan konsistensi | 19 | `npm run verify` |

Semua angka di dashboard dihitung dari file-file ini. Tidak ada yang ditulis tangan.

---

## 3. Hasil backtest dan cara membacanya

| Metrik | Nilai |
|---|---|
| Total return | +65,67% |
| CAGR | 18,32% |
| Max drawdown harian | −12,86% |
| Max drawdown intraday | −14,44% |
| Sharpe (harian, annualisasi) | 1,05 |
| Trade | 238 |
| Win rate | 29,41% |
| Profit factor | 1,61 |
| Avg win | Rp2.477.992 |
| Avg loss | −Rp641.579 |
| Payoff ratio (win/loss) | 3,86 |
| Rata-rata tahan | 76,8 bar (≈3,2 hari) |
| Hari kena daily loss limit | 7 |

**Konsistensi internal.** Dengan 238 trade, win rate 29,41%, avg win Rp2,48 juta, dan
avg loss Rp0,64 juta:

```
238 × (0,2941 × 2.477.992 − 0,7059 × 641.579)
= 238 × 275.943
= Rp65.674.000  ≈ total return Rp65.674.254
```

Angka total return bisa direkonstruksi dari daftar trade. Itu yang membuatnya bisa
diaudit.

**Bacaan.** Win rate rendah (29%) tetapi payoff ratio tinggi (3,86) — ini pola khas
trend following: sering salah kecil, jarang benar besar. Profit factor 1,61 berarti
setiap Rp1 kerugian menghasilkan Rp1,61 laba kotor. Tipis, tapi positif.

**Yang tidak boleh disimpulkan.** CAGR 18,32% bukan "bagus" secara absolut ketika
BTC menghasilkan 36,29% CAGR di periode yang sama. Strategi ini menang pada risiko,
bukan pada return.

---

## 4. Analisis biaya — bagian yang paling menentukan

| Komponen | Nilai | Porsi |
|---|---|---|
| Fee taker 0,30% | Rp26.748.672 | 63,5% |
| Spread | Rp5.750.000 | 13,6% |
| Slippage | Rp9.648.297 | 22,9% |
| **Total** | **Rp42.146.968** | 100% |
| Laba kotor (trade profit) | Rp183.316.650 | — |
| **Biaya / laba kotor** | **23,0%** | — |

Artinya: **hampir seperempat laba kotor habis untuk biaya**. Ini bukan detail teknis —
ini penentu utama apakah strategi layak. Dengan 238 trade dan rata-rata tahan 3,2 hari,
strategi ini bertransaksi cukup sering sehingga fee 0,30% per sisi (0,60% pulang-pergi)
menjadi beban besar.

Jika fee 0,20% (angka API) dipakai, biaya fee turun sekitar sepertiga. Tetapi aturan
meminta memakai yang lebih tinggi, dan halaman resmi tidak bisa diverifikasi, jadi
0,30% adalah pilihan yang bisa dipertanggungjawabkan.

**Implikasi.** Strategi dengan frekuensi lebih rendah, atau pair dengan spread lebih
sempit (BTC/ETH), akan lebih efisien secara biaya. BNB dengan spread 0,71% adalah
penyumbang kerugian: 41 trade, **−Rp8,45 juta**.

---

## 5. Kenapa kalah dari BTC buy & hold

Tiga alasan yang bisa dibuktikan dari data:

1. **Exposure rendah.** Batas 1% nilai transaksi candle membatasi order. Pada 2023,
   median volume BTC hanya Rp632 juta/jam, sehingga 1% = Rp6,3 juta. Dengan modal
   Rp100 juta, posisi jarang mendekati 25% ekuitas. Bot memegang sebagian besar kas.
2. **BTC tidak pernah terisi.** Dengan 4 slot untuk 5 pair, slot sering sudah penuh
   saat sinyal BTC muncul. Akibatnya bot melewatkan aset yang justru paling naik.
3. **Biaya.** Buy & hold hanya membayar biaya sekali; bot membayar 238 kali.

Ini bukan alasan untuk mengubah aturan setelah melihat hasil. Ini adalah temuan yang
harus dilaporkan, dan menjadi bahan evaluasi untuk versi berikutnya — bukan sesuatu
yang diperbaiki diam-diam lalu dilaporkan sebagai "berhasil".

---

## 6. Perubahan dari UTS

| Aspek | UTS | UAS | Alasan |
|---|---|---|---|
| Timeframe | Harian | 1 jam | 10 hari forward = 10 candle harian, terlalu sedikit |
| Donchian | 150/40 | 168/48 | Skala waktu setara (7 hari / 2 hari) |
| Filter tren | Tidak ada | EMA200 | Kripto punya tren turun panjang |
| Stop | Statis | Trailing ATR ×2,5 | Volatilitas kripto 3–5× saham |
| Risiko | Per emiten | Portofolio: 4 slot, 25% | Risiko total, bukan per posisi |
| Biaya | Asisten | Fee + spread + slippage terukur | Biaya kripto jauh lebih besar |
| Universe | Kompas100 | 5 pair IDR likuid di awal periode | Hindari survivorship bias |
| Rebalance | Bulanan | Event-driven per candle | Breakout butuh reaksi cepat |

Perubahan yang **tidak** dilakukan: tidak ada optimasi parameter pada data hasil.
Parameter ditetapkan sebelum backtest dijalankan.

---

## 7. Kejujuran data

**Fee.** `/api/pairs` melaporkan taker 0,20% (diakses 4 Nov 2026). Halaman resmi
rincian biaya Indodax mengembalikan **HTTP 404** dari lingkungan ini pada tanggal
akses. Karena aturan meminta memakai yang lebih tinggi dan yang lebih tinggi tidak
dapat diverifikasi, saya memakai **0,30%** dan menyebutnya sebagai asumsi konservatif.
Saya **tidak** mengklaim halaman resmi menyebut 0,30%.

**Universe.** Pemilihan awal memakai volume hari ini dan menghasilkan hanya 2 pair yang
lolos. Setelah diperlebar ke 120 kandidat dan disaring memakai data Nov 2023, diperoleh
5 pair. Banyak kandidat mengembalikan **0 candle** pada Nov 2023 karena belum listing —
bukti bahwa memilih berdasarkan volume hari ini memang bias.

**Forward test.** Forward test **sudah dijalankan**, namun **terlambat dimulai**:
tick pertama **9 Nov 2026 20.44 WIB** (terlambat 5 hari 8 jam dari jendela soal 4 Nov
12.00 WIB) karena storage persisten baru tersedia pada tanggal itu; sebelum itu
endpoint bot menolak berjalan tanpa storage (perancangan, bukan kegagalan diam-diam).
Hasil dihitung apa adanya dari log mentah — lihat Bagian 9. Tidak ada angka karangan:
cakupan evaluasi 17 dari ±118 siklus jam juga dilaporkan terbuka.

---

## 8. Keterbatasan

1. Backtest memakai **model biaya**, bukan replay order book historis. API publik
   Indodax tidak menyediakan order book historis.
2. Slippage diukur pada order Rp10–25 juta. Order lebih besar akan lebih mahal.
3. Dengan 4 slot untuk 5 pair, satu pair bisa tidak pernah terisi (terjadi pada BTCIDR).
4. Hasil 3 tahun mencakup satu siklus bull dan satu koreksi; belum tentu mewakili
   rezim pasar lain.
5. Dry run tidak mengalami antrean order, penolakan bursa, atau perubahan likuiditas
   mendadak seperti eksekusi nyata.

---

## 9. Hasil evaluasi forward test

Jendela: **4 Nov 2026 12.00 WIB → 14 Nov 2026 12.00 WIB**.
Eksekusi aktual: **9 Nov 2026 20.44 WIB → 14 Nov 2026 12.00 WIB** (4,9 hari aktif,
mulai terlambat 5 hari 8 jam — dicatat apa adanya, tanpa angka pengganti).

Yang diukur dari log mentah (`data/forward_logs.json`, diekspor 14 Nov 2026 20.33 WIB):

| Metrik | Cara hitung | Hasil |
|---|---|---|
| Total return | ekuitas terakhir / modal awal − 1 | **0,00%** (equity datar Rp100.000.000) |
| Max drawdown | peak-to-trough log equity tiap tick | **0,00%** |
| Trade tertutup | order SELL | **0** (0 BUY, 0 SELL) |
| Profit factor / win rate | dari order SELL | n/a (tidak ada trade) |
| Avg win / avg loss | dari order SELL | n/a |
| Biaya / laba kotor | (fee + spread + slippage) / laba kotor | Rp0 / n/a |
| Benchmark BTC | beli-tahan dalam jendela aktif | **−9,11%** |
| Gap vs backtest jendela identik | forward − backtest(4–14 Nov) | +1,10 poin persen (0,00% vs −1,10%) |
| Uptime | tick tercatat / tick seharusnya | **17/118 (14,4%)** |
| API error | log `error` tipe `fetch` | **0** |
| Kill switch | aktivasi | **0** (tidak pernah dipakai) |
| Evaluasi candle | signal log per pair | 85 evaluasi (17 siklus × 5 pair) |

Angka di atas dihitung ulang oleh `scripts/recompute.js` dari log mentah dan bisa
direproduksi siapa pun (`node scripts/recompute.js`).

**Interpretasi jujur:**

1. Bot **tidak membuka satu posisi pun**. Donchian-168 + filter EMA200 mensyaratkan
   breakout 168 candle; dalam jendela aktif 4,9 hari (±111 candle per pair) kondisi
   entry tidak pernah terpenuhi. Backtest pada jendela identik 4–14 Nov hanya
   menghasilkan 1 trade dengan return −1,10%, jadi karakter "tidak trading saat pasar
   jatuh" konsisten antara backtest dan forward — bukan anomali.
2. **Uptime 14,4%**: penjadwal jam-an memakai GitHub Actions cron `7 * * * *`. Dari
   ±118 slot hanya 17 yang dieksekusi; GitHub secara nyata menjatuhkan/menunda
   sebagian besar event `schedule` (17 run tercatat, semuanya sukses — yang hilang
   adalah eventnya, bukan gagalnya eksekusi). Konsekuensinya, ±83% candle jam di
   jendela tidak dievaluasi bot; jika ada sinyal pada candle yang terlewat, bot akan
   melewatkannya. Ini keterbatasan operasional yang disebut terbuka, bukan disembunyikan.
3. **Zero cost & zero error**: tidak ada order berarti tidak ada fee/spread/slippage;
   0 API error, kill switch tidak pernah dipakai, idempotensi berjalan (satu candle
   hanya diproses sekali, baris "candle sudah diproses" pada tick berulang).
4. Pertanyaan evaluasi:
   - Slippage nyata vs model — tidak dapat dijawab dari trade karena 0 order;
     snapshot order book (95 baris) tetap tersimpan sebagai bukti data eksekusi.
   - Kehilangan candle karena penjadwal — **ya, terjadi** (poin 2).
   - Gap forward−backtest (+1,10 pp) — dijelaskan oleh (a) bot meng-eksekusi sinyal
     hanya pada candle yang dievaluasi, bukan seluruh candle jendela; (b) backtest
     10 hari berbasis candle dengan model biaya, forward berbasis order book asli.
     Keduanya konsisten: tidak ada trade yang berubah menjadi rugi besar di salah
     satu sisi.

---

## 10. Refleksi

Hal terpenting yang saya pelajari bukan cara membuat sinyal, tetapi cara **membuktikan**
bahwa sinyal itu bekerja atau tidak.

Di UTS, angka bisa terlihat bagus tanpa bisa diaudit. Di UAS, setiap angka harus punya
jejak: candle mentah, snapshot order book, log order, dan skrip yang menghitung ulang.
Ketika saya memaksa diri memakai biaya yang lebih tinggi dan mengukur spread dari order
book asli, hasilnya turun — dan justru itu yang membuat hasilnya bisa dipercaya.

Saya juga belajar bahwa **batas likuiditas adalah bagian dari strategi**. Order yang
tidak bisa dieksekusi tanpa menggerakkan pasar bukan order yang valid, seberapa pun
bagus sinyalnya. Batas 1% nilai candle membuat bot ini jarang memakai modal penuh, dan
itu terlihat langsung pada return yang lebih rendah dari BTC.

Terakhir: hasil buruk yang bisa dibuktikan lebih berguna daripada hasil bagus yang
tidak bisa dipertanggungjawabkan. Laporan ini sengaja memuat angka yang kurang
menguntungkan — underperform BTC, 0 trade di BTCIDR, kerugian di BNB, forward test
yang mulai 5 hari terlambat dengan uptime penjadwal 14,4% dan 0 trade — karena itulah
yang bisa saya pertanggungjawabkan dari data.

---

## 11. Cara memeriksa laporan ini

```bash
npm test                 # 17 unit test
npm run verify           # 19 pemeriksaan konsistensi
node scripts/recompute.js  # hitung ulang metrik forward dari log mentah
```

Atau buka `dashboard.html` dan klik **"Hitung ulang dari data mentah"**.

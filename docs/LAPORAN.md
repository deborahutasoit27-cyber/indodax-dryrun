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

**Forward test.** Saat laporan ini ditulis, forward test **belum berjalan**. Tidak ada
satu pun angka forward di dashboard. Bagian 9 di bawah adalah rencana evaluasi, bukan
hasil.

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

## 9. Rencana evaluasi forward test (belum dijalankan)

Jendela: **4 Nov 2026 12.00 WIB → 14 Nov 2026 12.00 WIB**.

Yang akan diukur dari log mentah (`data/forward_logs.json`):

| Metrik | Cara hitung |
|---|---|
| Total return | ekuitas terakhir / modal awal − 1 |
| Max drawdown | peak-to-trough log equity tiap tick |
| Profit factor | Σ laba bersih / abs(Σ rugi bersih) dari order SELL |
| Win rate | trade SELL dengan `netPnl > 0` |
| Avg win / avg loss | dari order SELL |
| Biaya / laba kotor | (fee + spread + slippage) / laba kotor |
| Benchmark BTC | beli-tahan dari harga di log equity |
| Gap vs backtest | return forward − backtest jendela identik |
| Uptime | tick tercatat / tick seharusnya |
| API error | baris log `error` tipe `fetch` |
| Kill switch | jumlah aktivasi + status akhir |

Pertanyaan yang ingin dijawab:

1. Apakah slippage nyata lebih besar dari model? (bandingkan `slipPct` log vs snapshot)
2. Apakah bot kehilangan candle karena penjadwal terlambat?
3. Apakah gap forward−backtest bisa dijelaskan oleh biaya dan waktu eksekusi?

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
menguntungkan — underperform BTC, 0 trade di BTCIDR, kerugian di BNB — karena itulah
yang bisa saya pertanggungjawabkan dari data.

---

## 11. Cara memeriksa laporan ini

```bash
npm test                 # 17 unit test
npm run verify           # 19 pemeriksaan konsistensi
node scripts/recompute.js  # hitung ulang metrik forward dari log mentah
```

Atau buka `dashboard.html` dan klik **"Hitung ulang dari data mentah"**.

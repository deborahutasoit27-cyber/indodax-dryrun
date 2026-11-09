# Bot Dry Run Indodax — UAS Algorithmic Trading

Bot trading **dry run** (tanpa uang, tanpa API key) untuk pasar kripto IDR Indodax.
Strategi Donchian breakout yang dipakai di UTS diadaptasi ke timeframe 1 jam, lalu
dijalankan sebagai satu endpoint Vercel yang dipanggil penjadwal tiap jam.

> **Status jujur.** Backtest 3 tahun **sudah selesai** dengan data Indodax sungguhan.
> Forward test 10 hari **belum berjalan** saat paket ini disusun (mulai 4 Nov 2026 12.00 WIB).
> Dashboard menampilkan status "belum berjalan" dan tidak menampilkan angka forward apa pun.
> Tidak ada hasil yang dikarang.

---

## 1. Hasil backtest 3 tahun

Periode **4 Nov 2023 17.00 WIB → 4 Nov 2026 10.00 WIB** (1.096 hari), modal awal Rp100.000.000,
5 pair, 131.490 candle 1 jam (kelengkapan 100%).

| Metrik | Nilai |
|---|---|
| Total return | **+65,67%** |
| CAGR | **18,32%** |
| Max drawdown (harian) | **−12,86%** (intraday −14,44%) |
| Sharpe (harian, annualisasi) | 1,05 |
| Trade tertutup | 238 |
| Win rate | 29,4% |
| Profit factor | 1,61 |
| Avg win / avg loss | Rp2.477.992 / −Rp641.579 |
| Rata-rata tahan | 76,8 bar (≈3,2 hari) |
| Hari kena daily loss limit | 7 |
| Total biaya | Rp42.146.968 |
| **Biaya / laba kotor** | **23,0%** |
| Benchmark BTC/IDR buy & hold | +153,18% (MDD −49,61%) |

**Bacaan yang benar:** strategi ini **kalah return** dari beli-tahan BTC, tetapi dengan
drawdown jauh lebih kecil (−12,9% vs −49,6%). Ini bukan strategi yang "menang" — ini
strategi yang membatasi kerugian. Biaya menggerus 23% laba kotor, dan itu angka yang
harus dibaca sebelum menyimpulkan apa pun.

Rincian per pair:

| Pair | Trade | PnL bersih |
|---|---|---|
| DOGEIDR | 72 | +Rp31.896.848 |
| ETHIDR | 57 | +Rp31.895.901 |
| ADAIDR | 68 | +Rp10.327.059 |
| BNBIDR | 41 | −Rp8.445.554 |
| BTCIDR | 0 | — |

BTCIDR tidak pernah terisi. Dengan 4 slot untuk 5 pair, slot sering sudah penuh saat
sinyal BTC muncul. Ini konsekuensi aturan "maks 4 posisi" dan dicatat sebagai batasan,
bukan disembunyikan.

---

## 2. Strategi (dibekukan)

Timeframe **1 jam**, long-only, tanpa short/margin/leverage.

**Masuk** (semua harus benar, dievaluasi pada candle tertutup):
1. `Close > highest High 168 bar sebelumnya`
2. `Close > EMA200`

**Keluar** (salah satu):
1. `Close < lowest Low 48 bar sebelumnya`, atau
2. `Close < peak − 2,5 × ATR(24)`, atau
3. ditahan ≥ 720 bar

**Ukuran & risiko:**
- maksimum 4 posisi bersamaan
- 25% ekuitas per slot
- order dibatasi 1% nilai transaksi candle (batas likuiditas)
- **daily loss limit 3%**, batas hari **00.00 WIB**
- order minimum **Rp25.000** (API menyebut Rp10.000 — dipakai yang lebih ketat)
- 1 candle diproses tepat sekali (idempotency)

Fungsi sinyal ada di **`lib/strategy.js`** dan dipakai **oleh backtest dan bot** —
bukan dua implementasi terpisah.

---

## 3. Perubahan dari UTS

| UTS (saham) | UAS (kripto Indodax) | Alasan |
|---|---|---|
| Donchian 150/40, timeframe harian | Donchian **168/48**, timeframe **1 jam** | 10 hari forward test hanya menghasilkan 10 candle harian; 1 jam memberi cukup trade |
| Tanpa filter tren | **EMA200** | Menghindari breakout di pasar turun |
| Stop statis | **Trailing stop ATR(24) × 2,5** | Volatilitas kripto jauh lebih tinggi |
| Ukuran posisi tetap | **25% ekuitas, maks 4 posisi** | Risiko portofolio, bukan per-saham |
| Biaya Asisten | **Fee 0,30% + spread/slippage terukur** | Biaya kripto jauh lebih besar dan harus diukur |
| Universe Kompas100 | **5 pair IDR likuid di awal periode** | Menghindari survivorship bias |
| Rebalance bulanan | **Event-driven per candle** | Strategi breakout butuh reaksi cepat |

---

## 4. Data

| Hal | Nilai |
|---|---|
| Sumber | API publik Indodax (`tradingview/history_v2`, `depth`, `pairs`) |
| Pair | BTCIDR, ETHIDR, DOGEIDR, ADAIDR, BNBIDR |
| Candle | 131.490 bar 1 jam, coverage **100,00%** |
| Metode universe | Median volume IDR/jam pada **30 hari pertama** jendela backtest (bukan hari ini) |
| Ambang | median ≥ Rp10 juta/jam, kelengkapan ≥ 90% |
| Snapshot order book | 100 snapshot (20 per pair, 5 pair) |

Stablecoin dan token saham (akhiran `X`) dikecualikan. Likuiditas diukur pada
2023-11-05, bukan pada hari pemilihan, supaya pair yang baru populer belakangan
tidak masuk secara curang.

---

## 5. Biaya: apa yang benar-benar dipakai

- `/api/pairs` (diakses **4 Nov 2026**) melaporkan `trade_fee_percent_taker = 0,20%`.
- Halaman resmi rincian biaya Indodax **mengembalikan HTTP 404** dari lingkungan ini
  pada tanggal akses, sehingga angka halaman resmi **tidak dapat diverifikasi**.
- Aturan UAS meminta memakai yang **lebih tinggi**. Karena yang lebih tinggi tidak bisa
  diverifikasi, dipakai **0,30%** sebagai asumsi konservatif yang diumumkan.
- Ini **bukan** klaim bahwa halaman resmi menyebut 0,30%.

Spread dan slippage **tidak diasumsikan**:

| Pair | Spread median | Slippage beli Rp10 jt | Slippage jual |
|---|---|---|---|
| BTCIDR | 0,0001% | 0,0000% | 0,0000% |
| ETHIDR | 0,0369% | 0,0185% | 0,0899% |
| DOGEIDR | 0,0754% | 0,0377% | 0,1878% |
| ADAIDR | 0,2087% | 0,1044% | 0,2330% |
| BNBIDR | 0,7088% | 0,3544% | 0,3544% |

---

## 6. Struktur

```
indodax-dryrun/
├─ api/
│  ├─ tick.js          # satu endpoint bot (CRON_SECRET)
│  ├─ kill.js          # kill switch tanpa deploy ulang
│  └─ export.js        # unduh seluruh log mentah
├─ lib/
│  ├─ strategy.js      # SATU fungsi sinyal untuk backtest + bot
│  ├─ indicators.js    # EMA, ATR, Donchian (tanpa state global)
│  ├─ execution.js     # fill menelusuri bid/ask, pembulatan, fee
│  ├─ risk.js          # batas hari WIB, daily loss, equity di best bid
│  ├─ tick.js          # satu siklus bot
│  ├─ store.js         # Upstash Redis / file lokal
│  └─ indodax.js       # klien API publik
├─ scripts/
│  ├─ select_universe.js
│  ├─ collect_history.js
│  ├─ collect_snapshots.js
│  ├─ backtest.js
│  ├─ dryrun_local.js
│  ├─ recompute.js     # hitung ulang dari log mentah
│  ├─ build_dashboard.js
│  └─ verify_all.js
├─ tests/strategy.test.js   # 17 unit test
├─ data/                    # candle, snapshot, hasil backtest, log
├─ dashboard.html           # dashboard mandiri (offline)
├─ docs/STRATEGY.md
├─ docs/LAPORAN.md
├─ .env.example
├─ vercel.json
└─ .github/workflows/tick.yml
```

---

## 7. Menjalankan lokal

```bash
node --version            # butuh >= 20
npm test                  # 17 unit test
npm run backtest          # tulis data/backtest_full.json
npm run dashboard         # tulis dashboard.html
npm run verify            # 19 pemeriksaan konsistensi

# satu tick terhadap API sungguhan (state terpisah, tidak mengganggu forward test)
LOCAL_STORE_FILE=data/test-store.json node scripts/dryrun_local.js
```

Tidak ada dependensi npm. Tidak ada build step.

> Jika PowerShell memblokir `npm` (execution policy), pakai `npm.cmd test`, atau
> langsung `node --test tests/strategy.test.js` dan `node scripts/*.js`.

---

## 8. Deploy ke Vercel

1. Buat repo GitHub, push folder ini.
2. Vercel → **Add New Project** → import repo. Framework: **Other**. Tidak ada build command.
3. Environment variables:
   - `CRON_SECRET` — string acak ≥32 karakter
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — dari upstash.com (gratis)
   - `CAPITAL_IDR` — opsional, default `100000000`
4. Deploy. Uji:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<proyek>.vercel.app/api/tick
   ```
5. GitHub repo → Settings → Secrets → Actions:
   - `BOT_URL` = `https://<proyek>.vercel.app`
   - `CRON_SECRET` = sama dengan di Vercel
6. Workflow `.github/workflows/tick.yml` memanggil `/api/tick` tiap jam pada menit ke-7.
   **Vercel Cron Hobby hanya sekali sehari**, karena itu penjadwal jam-an memakai GitHub Actions.

Batas 300 detik per panggilan cukup: satu tick lokal berjalan ±4,9 detik untuk 5 pair.

### Dashboard live (`/`)

Halaman `index.html` disajikan di `/` dan menampilkan:

- **Tabel pasar live** (5 pair universe) — harga, perubahan 24 jam, bid/ask, spread,
  volume 24 jam, waktu sumber WIB; pembaruan otomatis tiap 30 detik via `GET /api/market`
  (public, tanpa kunci; hanya data pasar publik).
- **Panel bot yang terkunci** — kas/posisi virtual disembunyikan; dibuka dengan
  **kunci dashboard** (= `CRON_SECRET`) lewat `GET /api/status` (tanpa kunci → 401).
- Strategi/crypto-donchian-1.0.0 tidak diubah oleh tampilan. Setiap angka yang
  muncul berasal dari log/state yang dapat dihitung ulang (`/api/export`).

---

## 9. Forward test 10 hari

| Hal | Nilai |
|---|---|
| Mulai | Rabu, 4 Nov 2026, 12.00 WIB |
| Selesai | Sabtu, 14 Nov 2026, 12.00 WIB |
| Perubahan aturan | **Tidak boleh** |
| Perbaikan bug | Boleh, wajib dicatat di log |

Setelah selesai:

```bash
# 1. unduh log mentah
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<proyek>.vercel.app/api/export" -o data/forward_logs.json

# 2. hitung ulang metrik dari log
node scripts/recompute.js

# 3. backtest pada jendela yang sama (12.00 WIB 4 Nov – 12.00 WIB 14 Nov)
node scripts/backtest.js --from=2026-11-04T05:00:00Z --to=2026-11-14T05:00:00Z --tag=10d

# 4. ulangi recompute agar gap forward−backtest terisi
node scripts/recompute.js

# 5. bangun ulang dashboard + verifikasi
node scripts/build_dashboard.js
node scripts/verify_all.js
```

Dashboard akan otomatis mengganti status "belum berjalan" dengan angka sebenarnya.

---

## 10. Hitung ulang

`node scripts/recompute.js` membaca **log mentah** (`data/forward_logs.json`) dan
menghitung sendiri: return, MDD, PF, win rate, biaya, uptime, API error, pemakaian
kill switch, benchmark BTC, dan gap terhadap backtest.

Dashboard juga punya tombol **"Hitung ulang dari data mentah"** yang mengulang
perhitungan di browser dari data yang tertanam di file HTML itu sendiri.

`node scripts/verify_all.js` menjalankan 19 pemeriksaan, termasuk:
- return & MDD cocok dengan kurva ekuitas
- jumlah trade cocok dengan CSV
- total biaya = fee + spread + slippage
- dashboard tidak memuat aset eksternal
- tidak ada kredensial di repo

---

## 11. Freeze

Isi `data/freeze.json` setelah commit freeze:

```json
{
  "commit": "<hash lengkap>",
  "timeWib": "2026-11-04 12:00:00",
  "note": "Commit terakhir sebelum forward test; aturan tidak diubah setelah ini."
}
```

Perintah:

```bash
git init
git add .
git commit -m "freeze: aturan strategi v1.0.0 sebelum forward test"
git rev-parse HEAD
git log --format="%H %cI %s" -1
```

Bukti freeze dapat dicek dari `git log` (repo publik) atau folder `.git` di dalam ZIP.

---

## 12. Yang tidak bisa dikerjakan otomatis

| Hal | Siapa |
|---|---|
| Deploy ke Vercel + isi environment | pemilik akun |
| Menjalankan forward test 10 hari | waktu (4–14 Nov 2026) |
| Commit & push bukti freeze | pemilik repo |
| Mengisi angka refleksi setelah forward test | setelah log tersedia |

---

## 13. Batasan yang diakui

- Backtest memakai **model biaya** (spread/2 + slippage terukur), bukan replay order book
  historis, karena order book historis tidak disediakan API publik Indodax.
- Slippage diukur pada ukuran order Rp10–25 juta; order jauh lebih besar akan lebih mahal.
- Forward test memakai order book nyata, jadi selisih dengan backtest adalah bagian dari
  hasil, bukan kesalahan yang disembunyikan.
- Hasil masa lalu tidak menjamin masa depan. Bot ini **dry run**: tidak ada uang sungguhan.

Repo publik: https://github.com/deborahutasoit27-cyber/indodax-dryrun  (commit freeze: 0aed4df)  


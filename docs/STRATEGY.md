# Spesifikasi Strategi — `crypto-donchian-1.0.0`

Dokumen ini adalah aturan lengkap yang **dibekukan** sebelum forward test.
Implementasi: `lib/strategy.js`. Fungsi `decide()` dipakai oleh backtest **dan** bot.

---

## 1. Pasar dan batasan

| Hal | Nilai |
|---|---|
| Bursa | Indodax (API publik, tanpa API key) |
| Quote | IDR |
| Instrumen | BTCIDR, ETHIDR, DOGEIDR, ADAIDR, BNBIDR |
| Timeframe | 1 jam |
| Arah | **Long-only** |
| Short / margin / leverage | **Tidak ada** |

## 2. Universe

Kandidat diambil dari seluruh pair IDR, lalu disaring dengan data **30 hari pertama
jendela backtest** (5 Nov – 5 Des 2023), bukan volume hari ini:

1. quote = IDR
2. bukan stablecoin (USDT, USDC, DAI, IDRT, …)
3. bukan token saham (akhiran `X`, mis. AAPLX)
4. median volume IDR per jam ≥ Rp10.000.000
5. kelengkapan candle ≥ 90%

Diambil 5 teratas. Hasil: **BTCIDR, ETHIDR, DOGEIDR, ADAIDR, BNBIDR**.

Alasan: memilih pair berdasarkan volume hari ini akan memasukkan koin yang belum ada
saat backtest dimulai (survivorship bias). Terbukti saat pengujian: dari 30 kandidat
bervolume terbesar hari ini, banyak yang mengembalikan **0 candle** pada Nov 2023.

## 3. Indikator

| Indikator | Parameter | Definisi |
|---|---|---|
| Donchian masuk | 168 bar | highest High dari 168 bar **sebelum** bar terakhir |
| Donchian keluar | 48 bar | lowest Low dari 48 bar **sebelum** bar terakhir |
| EMA tren | 200 | EMA atas close, dihitung dari awal seri |
| ATR | 24 | rata-rata True Range 24 bar terakhir (Wilder sederhana) |

Semua indikator **mengecualikan bar terakhir** dari jendela perhitungan, sehingga
sinyal pada bar `i` hanya memakai data `0..i`. Tidak ada look-ahead.

## 4. Aturan masuk

```
JIKA tidak punya posisi
DAN  Close[i] > max(High[i-168 .. i-1])
DAN  Close[i] > EMA200[i]
MAKA BUY di open candle i+1
```

Kedua syarat harus benar. Breakout tanpa tren tidak diambil.

## 5. Aturan keluar

```
JIKA punya posisi
DAN ( Close[i] < min(Low[i-48 .. i-1])
   ATAU Close[i] < peak - 2.5 * ATR24[i]
   ATAU (time[i] - openedCandle) >= 720 bar )
MAKA SELL di open candle i+1
```

`peak` adalah harga tertinggi yang pernah dicapai sejak masuk (diperbarui tiap candle).
Urutan pemeriksaan: Donchian → trailing stop → batas waktu.

## 6. Ukuran posisi

```
budget = min( kas,
              ekuitas × 25%,
              nilai transaksi candle × 1% )
```

- `nilai transaksi candle = Close × Volume` (IDR)
- Batas 1% mencegah order lebih besar dari likuiditas yang wajar
- Jika `budget < Rp25.000` → tidak ada order (dan dicatat)

## 7. Batas risiko

| Aturan | Nilai | Titik pemeriksaan |
|---|---|---|
| Maks posisi | 4 | saat eksekusi |
| Ukuran per posisi | 25% ekuitas | saat eksekusi |
| Daily loss limit | 3% | setiap tick, batas hari 00.00 WIB |
| Order minimum | Rp25.000 | sebelum order |
| Kill switch | manual | setiap tick |

**Daily loss limit.** Equity awal hari diambil pada tick pertama setelah 00.00 WIB.
Jika `(ekuitas − ekuitas awal hari) / ekuitas awal hari ≤ −3%`, tidak ada posisi baru
sampai hari WIB berikutnya. Posisi yang sudah terbuka tetap dikelola (bisa keluar).

**Kill switch.** Flag di storage (`bot:killswitch` di Redis / file lokal). Bisa
dinyalakan lewat `POST /api/kill` tanpa deploy ulang. Setiap aktivasi tercatat di log.

## 8. Validasi data (setiap tick, setiap pair)

Ditolak dan **dicatat di log** jika:

| Kondisi | Pesan |
|---|---|
| Candle < 202 bar | `candle kurang: N < 202` |
| Candle terakhir lebih tua dari 2× timeframe | `candle terakhir terlalu tua` |
| Celah / duplikat waktu antar candle | `candle hilang/duplikat di ...` |
| Harga atau volume nol | `harga/volume candle terakhir nol` |
| Order book kosong | `order book kosong` |
| Bid/ask tidak valid (`ask < bid`) | `bid/ask tidak valid` |
| Spread > 2% | `spread X% > 2%` |

Penolakan **tidak** menghentikan pair lain dan tidak menghentikan bot.

## 9. Eksekusi

Order **selalu** menelusuri order book sungguhan:

- **Beli** menelusuri `asks` dari harga terendah, menghabiskan budget level demi level.
- **Jual** menelusuri `bids` dari harga tertinggi.
- Harga rata-rata = total nilai / total kuantitas.
- Kuantitas dibulatkan **ke bawah** sesuai `quantity_increment` pair.
- **Tidak pernah** memakai mid, close, atau last price sebagai harga fill.

Fee taker **0,30%** per sisi (lihat README bagian 5 untuk alasan).

## 10. Idempotency

State menyimpan `candleTimes[pair] = waktu candle tertutup terakhir yang diproses`.
Jika bot dipanggil dua kali untuk candle yang sama:

- `candleTimes[pair] >= candle.time` → pair dilewati
- tidak ada order baru

Diuji langsung: tick pertama mengevaluasi 5 pair, tick kedua mengevaluasi **0** pair
dan mencatat `candle sudah diproses` untuk kelimanya.

Selain itu ada lock `lockUntil` (240 detik) agar dua panggilan bersamaan tidak
mengeksekusi order ganda.

## 11. Retry dan error

- Maksimum **3 percobaan** per request, backoff 400 ms → 800 ms.
- Timeout 12 detik (30 detik untuk `pairs` dan `history`).
- Respons kosong atau bukan JSON dianggap gagal.
- Kegagalan satu pair dicatat di log `error` dan tidak menghentikan pair lain.

## 12. Model backtest

| Hal | Backtest | Bot (forward) |
|---|---|---|
| Data harga | candle 1 jam historis | candle 1 jam terkini |
| Harga fill | open candle berikutnya + biaya | order book nyata (telusur level) |
| Spread | `spread_median / 2` terukur | spread nyata saat itu |
| Slippage | median terukur per pair | selisih harga rata-rata vs best price |
| Fee | 0,30% | 0,30% |
| Batas likuiditas | 1% nilai candle | 1% nilai candle |

Perbedaan ini **disengaja**: backtest tidak bisa mereplay order book historis karena
API publik tidak menyediakannya. Selisih hasil forward vs backtest dilaporkan apa adanya
sebagai bagian dari evaluasi.

## 13. Parameter lengkap

```js
{
  timeframe: "60",
  entryLookback: 168,
  exitLookback: 48,
  trendEma: 200,
  atrPeriod: 24,
  atrMult: 2.5,
  maxPositions: 4,
  positionPct: 0.25,
  maxOrderPctOfCandle: 0.01,
  dailyLossLimitPct: 3.0,
  minOrderIdr: 25000,
  takerFeePct: 0.30,
  maxSpreadPct: 2.0,
  maxCandleAgeMult: 2,
  maxHoldBars: 720
}
```

// tests/strategy.test.js — uji unit tanpa dependensi (node --test).
import test from "node:test";
import assert from "node:assert/strict";

import { atr, donchian, ema } from "../lib/indicators.js";
import { PARAMS, decide, validateBook, validateCandles } from "../lib/strategy.js";
import { buyAtAsk, roundDown, sellAtBid, feeFor } from "../lib/execution.js";
import { canOpenPosition, dayKeyWIB } from "../lib/risk.js";

const T0 = 1_700_000_000; // detik, kelipatan jam

function candle(i, close, { high = null, low = null, volume = 10 } = {}) {
  return {
    time: T0 + i * 3600,
    open: close,
    high: high ?? close * 1.01,
    low: low ?? close * 0.99,
    close,
    volume,
  };
}

function series(closes, opts = {}) {
  return closes.map((c, i) => candle(i, c, typeof opts === "function" ? opts(i, c) : opts));
}

test("donchian tidak memakai bar terakhir (tanpa look-ahead)", () => {
  const bars = series([10, 11, 12, 100]);
  const band = donchian(bars, 3);
  assert.equal(band.high, 12 * 1.01);
  assert.equal(band.low, 10 * 0.99);
});

test("ema mendekati rata-rata pada seri datar", () => {
  const bars = series(Array(250).fill(50));
  const value = ema(bars.map((b) => b.close), 200);
  assert.ok(Math.abs(value - 50) < 1e-9);
});

test("atr positif pada data normal", () => {
  const bars = series(Array.from({ length: 60 }, (_, i) => 100 + i));
  const value = atr(bars, 24);
  assert.ok(value > 0);
});

test("validateCandles menolak candle basi", () => {
  const bars = series(Array(220).fill(100));
  const now = bars[bars.length - 1].time + 3 * 3600; // 3x tf
  const issues = validateCandles(bars, now);
  assert.ok(issues.some((i) => i.includes("terlalu tua")), issues.join("; "));
});

test("validateCandles menolak celah candle", () => {
  const bars = series(Array(220).fill(100));
  bars.splice(bars.length - 5, 1); // celah di dalam jendela indikator
  const now = bars[bars.length - 1].time + 3600;
  const issues = validateCandles(bars, now);
  assert.ok(issues.some((i) => i.includes("hilang") || i.includes("kurang")), issues.join("; "));
});

test("validateCandles menolak harga nol", () => {
  const bars = series(Array(220).fill(100));
  bars[bars.length - 1].close = 0;
  const issues = validateCandles(bars, bars[bars.length - 1].time + 3600);
  assert.ok(issues.some((i) => i.includes("nol")));
});

test("validateBook menolak buku kosong dan spread lebar", () => {
  assert.ok(validateBook({ bids: [], asks: [] }).issues.some((i) => i.includes("kosong")));
  const wide = validateBook({ bids: [[99, 1]], asks: [[103, 1]] }); // ~4%
  assert.ok(wide.issues.some((i) => i.includes("spread")));
  const tight = validateBook({ bids: [[99.9, 1]], asks: [[100.1, 1]] });
  assert.equal(tight.issues.length, 0);
});

test("decide membeli saat breakout + tren", () => {
  const closes = [...Array(210).fill(100), 120];
  const bars = series(closes);
  const signal = decide(bars, null, PARAMS, bars[bars.length - 1].time + 3600);
  assert.equal(signal.action, "BUY", signal.reason);
});

test("decide menahan saat tren turun walau ada breakout lokal", () => {
  const closes = [...Array(210).fill(200), 210];
  const bars = series(closes);
  // tren masih naik; buat EMA di atas harga dengan penurunan panjang
  const down = [...Array(200).fill(300), ...Array(10).fill(100), 101];
  const s2 = decide(series(down), null, PARAMS, T0 + (down.length - 1) * 3600 + 3600);
  assert.equal(s2.action, "HOLD", s2.reason);
  assert.ok(signalOk(bars));
});

function signalOk(bars) {
  const s = decide(bars, null, PARAMS, bars[bars.length - 1].time + 3600);
  return s.action === "BUY";
}

test("decide menjual saat close di bawah Low keluar", () => {
  const closes = [...Array(210).fill(100), ...Array(30).fill(200), 50];
  const bars = series(closes);
  const pos = { entryPrice: 200, peakPrice: 200, openedCandle: bars[210].time };
  const signal = decide(bars, pos, PARAMS, bars[bars.length - 1].time + 3600);
  assert.equal(signal.action, "SELL", signal.reason);
});

test("buyAtAsk menelusuri beberapa level dan membulatkan qty", () => {
  const book = { bids: [[99, 1]], asks: [[100, 0.5], [101, 1]] };
  const fill = buyAtAsk(book, 150, 0.0001);
  assert.ok(fill.filled);
  assert.ok(Math.abs(fill.avgPrice - 100.6666) < 0.01, String(fill.avgPrice));
  assert.ok(fill.levels >= 2);
  assert.ok(fill.qty <= 1.5);
});

test("sellAtBid menelusuri level bid", () => {
  const book = { bids: [[100, 0.4], [99, 1]], asks: [[101, 1]] };
  const fill = sellAtBid(book, 1);
  assert.ok(fill.filled);
  assert.equal(fill.levels, 2);
  assert.ok(fill.avgPrice < 100);
});

test("roundDown mengikuti increment", () => {
  assert.equal(roundDown(1.23456789, 0.0001), 1.2345);
  assert.equal(roundDown(0.00009, 0.0001), 0);
});

test("fee memakai tarif konservatif 0,30%", () => {
  assert.ok(Math.abs(feeFor(1_000_000) - 3000) < 1e-9);
});

test("batas hari WIB berganti pukul 17.00 UTC", () => {
  assert.equal(dayKeyWIB(Date.UTC(2026, 10, 4, 16, 59) / 1000), "2026-11-04");
  assert.equal(dayKeyWIB(Date.UTC(2026, 10, 4, 17, 0) / 1000), "2026-11-05");
});

test("daily loss limit memblokir posisi baru", () => {
  const state = {
    killSwitch: false,
    cashIdr: 97_000_000,
    positions: {},
    day: { key: "2026-11-04", startEquity: 100_000_000 },
  };
  const verdict = canOpenPosition(state, 96_900_000, PARAMS);
  assert.equal(verdict.allowed, false);
  assert.ok(verdict.reason.includes("daily loss"));
});

test("kill switch memblokir posisi baru", () => {
  const state = { killSwitch: true, cashIdr: 100_000_000, positions: {}, day: { key: "x", startEquity: 100_000_000 } };
  assert.equal(canOpenPosition(state, 100_000_000, PARAMS).allowed, false);
});

// lib/indodax.js — klien API publik Indodax (tanpa API key).
// Semua endpoint sesuai soal UAS halaman 2.

import { getJson } from "./http.js";

const BASE = "https://indodax.com";

export const TF_SECONDS = { "1": 60, "15": 900, "30": 1800, "60": 3600, "240": 14400, "1D": 86400 };

export async function serverTime() {
  const data = await getJson(`${BASE}/api/server_time`, { label: "server_time" });
  // server_time dalam milidetik
  return Math.floor(Number(data.server_time) / 1000);
}

export async function pairs() {
  return getJson(`${BASE}/api/pairs`, { label: "pairs", timeoutMs: 30000 });
}

export async function tickerAll() {
  const data = await getJson(`${BASE}/api/ticker_all`, { label: "ticker_all", timeoutMs: 30000 });
  return data.tickers ?? {};
}

export async function depth(pairId) {
  return getJson(`${BASE}/api/depth/${pairId}`, { label: `depth:${pairId}` });
}

export async function priceIncrements() {
  const data = await getJson(`${BASE}/api/price_increments`, { label: "price_increments" });
  return data.increments ?? {};
}

/**
 * Candle historis via tradingview/history_v2.
 * Catatan: API mengembalikan ~650 bar terakhir sebelum `to`; penarikan 3 tahun
 * harus mundur bertahap (lihat scripts/collect_history.js).
 */
export async function history(symbol, tf, from, to) {
  const url = `${BASE}/tradingview/history_v2?symbol=${symbol}&tf=${tf}&from=${from}&to=${to}`;
  const data = await getJson(url, { label: `history:${symbol}:${tf}`, timeoutMs: 30000 });
  if (!Array.isArray(data)) return [];
  return data.map((b) => ({
    time: Number(b.Time),
    open: Number(b.Open),
    high: Number(b.High),
    low: Number(b.Low),
    close: Number(b.Close),
    volume: Number(b.Volume),
  }));
}

/** Hanya candle yang sudah tertutup: Time + durasi <= server_time. */
export function closedCandles(candles, tf, nowSec) {
  const duration = TF_SECONDS[tf] ?? Number(tf);
  return candles.filter((c) => c.time + duration <= nowSec);
}

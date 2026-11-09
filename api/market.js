// api/market.js — endpoint publik data pasar live Indodax untuk dashboard.
// TANPA autentikasi (hanya data publik pasar; state bot TIDAK pernah lewat sini.
// Lihat api/status.js untuk panel bot yang dilindungi CRON_SECRET).
// Sumber: /api/ticker_all (harga, bid, ask, volume 24 jam) + history_v2 (close 24 jam
// lalu, dipakai menghitung perubahan 24 jam). Cache 60 detik per instance.

import fs from "node:fs";
import path from "node:path";
import { tickerAll, history, serverTime } from "../lib/indodax.js";

export const maxDuration = 60;

const CACHE_MS = 60_000;
let cache = null; // { atMs, payload }

function loadUniverse() {
  const file = path.join(process.cwd(), "data", "universe.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).universe;
}

/** Tanda tangan kunci ticker_all: "btc_idr" -> "btcidr". */
function tickerKeyFor(tickers, pairId) {
  const target = String(pairId).toLowerCase();
  return Object.keys(tickers).find((k) => k.replace(/_/g, "") === target) ?? null;
}

function wibIso(unixSec) {
  return new Date(unixSec * 1000).toLocaleString("en-GB", {
    timeZone: "Asia/Jakarta",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }) + " WIB";
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function issuesFor(row) {
  const issues = [];
  if (row.last === null || row.last <= 0) issues.push("harga nol/kosong");
  if (row.bid === null || row.ask === null || row.ask <= row.bid) issues.push("order book tidak konsisten");
  if (row.spreadPct !== null && row.spreadPct > 2) issues.push(`spread ${row.spreadPct.toFixed(2)}% > 2%`);
  if (row.volumeBase === null || row.volumeQuote === null || row.volumeQuote <= 0) issues.push("volume nol/kosong");
  return issues;
}

async function buildMarket() {
  const universe = loadUniverse();
  const nowSec = await serverTime();
  const tickers = await tickerAll(); // 1 request untuk semua pair

  // Close 24 jam lalu dari candle 1h yang sudah tertutup (untuk % perubahan 24 jam).
  const change24 = {};
  await Promise.allSettled(
    universe.map(async (pair) => {
      const from = nowSec - 3 * 86400;
      const raw = await history(pair.symbol, "60", from, nowSec);
      const closed = raw.filter((c) => c.time + 3600 <= nowSec && c.close > 0);
      const prev = [...closed].reverse().find((c) => c.time <= nowSec - 23.5 * 3600);
      if (prev) change24[pair.symbol] = { candleTime: prev.time, close: prev.close };
    })
  );

  const pairs = universe.map((pair) => {
    const key = tickerKeyFor(tickers, pair.id);
    if (!key) {
      return { pair: pair.symbol, pairId: pair.id, missing: true, issues: ["pair tidak ada di ticker_all"] };
    }
    const t = tickers[key] ?? {};
    const st = num(t.server_time);
      const volKey = Object.keys(t).find((k) => /^vol_(?!idr)/.test(k));
      const row = {
        pair: pair.symbol,
        pairId: pair.id,
        tickerKey: key,
        last: num(t.last),
        bid: num(t.buy),
        ask: num(t.sell),
        high24h: num(t.high),
        low24h: num(t.low),
        volumeBase: num(volKey ? t[volKey] : null),
        volumeQuote: num(t.vol_idr),
        serverTimeUnix: st,
      };
    row.spreadPct =
      row.bid !== null && row.ask !== null && row.last !== null && row.last > 0
        ? ((row.ask - row.bid) / row.last) * 100
        : null;
    const prev = change24[pair.symbol];
    row.change24hPct =
      prev && row.last !== null ? ((row.last / prev.close - 1) * 100) : null;
    row.prevClose24hCandle = prev ? { time: prev.candleTime, close: prev.close } : null;
    row.sourceTime = st ? wibIso(st) : null;
    row.issues = issuesFor(row);
    return row;
  });

  return {
    ok: true,
    dryRun: true,
    strategy: "crypto-donchian-1.0.0 (tidak diubah)",
    universeNote: "Likuiditas diukur pada awal periode backtest (Nov 2023), bukan hari ini.",
    fetchedAtUnix: nowSec,
    fetchedAt: new Date(nowSec * 1000).toISOString(),
    serverTimeWib: wibIso(nowSec),
    source: "Indodax API publik: /api/ticker_all + /tradingview/history_v2 (tanpa API key)",
    pairs,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  // Sajikan cache segar bila ada.
  if (cache && Date.now() - cache.atMs < CACHE_MS) {
    res.status(200).json({ ...cache.payload, cached: true, cacheAgeSec: Math.round((Date.now() - cache.atMs) / 1000) });
    return;
  }

  try {
    const payload = await buildMarket();
    cache = { atMs: Date.now(), payload };
    res.status(200).json(payload);
  } catch (error) {
    // Bila API Indodax gagal, sajikan data terakhir yang pernah berhasil (ditandai stale).
    if (cache) {
      res.status(200).json({
        ...cache.payload,
        cached: true,
        stale: true,
        error: String(error.message ?? error),
        cacheAgeSec: Math.round((Date.now() - cache.atMs) / 1000),
      });
      return;
    }
    res.status(502).json({ ok: false, error: String(error.message ?? error) });
  }
}

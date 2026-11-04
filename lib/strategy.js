// lib/strategy.js — SATU fungsi sinyal untuk backtest dan bot.
// Mengubah Donchian harian UTS (150/40) ke kripto 1 jam: 168/48.
// Long-only. Tidak ada short, margin, atau leverage.

import { atr, donchian, ema } from "./indicators.js";
import { TF_SECONDS } from "./indodax.js";

export const STRATEGY_VERSION = "crypto-donchian-1.0.0";

export const PARAMS = Object.freeze({
  version: STRATEGY_VERSION,
  timeframe: "60",              // 1 jam
  entryLookback: 168,           // 7 hari
  exitLookback: 48,             // 2 hari
  trendEma: 200,                // filter tren
  atrPeriod: 24,
  atrMult: 2.5,                 // trailing stop
  maxPositions: 4,
  positionPct: 0.25,            // 25% ekuitas per slot
  maxOrderPctOfCandle: 0.01,    // maks 1% nilai transaksi candle
  dailyLossLimitPct: 3.0,
  minOrderIdr: 25000,           // lebih ketat dari API (Rp10.000)
  takerFeePct: 0.30,            // API 0.20%; dipakai 0.30% konservatif (lihat README)
  maxSpreadPct: 2.0,
  maxCandleAgeMult: 2,
  maxHoldBars: 720,             // 30 hari; pengaman tambahan
});

export const INDICATOR_WINDOW = Math.max(PARAMS.entryLookback, PARAMS.trendEma, PARAMS.exitLookback) + 2;

/**
 * Validasi data sebelum sinyal. Mengembalikan daftar masalah (kosong = valid).
 * Aturan soal: candle tertutup terakhir > 2x timeframe, candle hilang,
 * harga/volume nol, order book kosong, spread > 2%.
 */
export function validateCandles(candles, nowSec, params = PARAMS) {
  const tf = TF_SECONDS[params.timeframe] ?? Number(params.timeframe);
  const issues = [];
  if (!Array.isArray(candles) || candles.length < INDICATOR_WINDOW) {
    issues.push(`candle kurang: ${candles?.length ?? 0} < ${INDICATOR_WINDOW}`);
    return issues;
  }
  const last = candles[candles.length - 1];
  const age = nowSec - last.time;
  if (age > params.maxCandleAgeMult * tf) {
    issues.push(`candle terakhir terlalu tua: ${Math.round(age / 60)} menit > ${params.maxCandleAgeMult} x ${tf / 60} menit`);
  }
  if (!(last.close > 0) || !(last.volume > 0) || !(last.high > 0) || !(last.low > 0)) {
    issues.push("harga/volume candle terakhir nol");
  }
  const window = candles.slice(-INDICATOR_WINDOW);
  for (let i = 1; i < window.length; i += 1) {
    const gap = window[i].time - window[i - 1].time;
    if (gap !== tf) {
      issues.push(`candle hilang/duplikat di ${new Date(window[i].time * 1000).toISOString()} (gap ${gap}s)`);
      break;
    }
  }
  return issues;
}

export function validateBook(book, params = PARAMS) {
  const issues = [];
  const bestBid = book?.bids?.[0];
  const bestAsk = book?.asks?.[0];
  if (!bestBid || !bestAsk) {
    issues.push("order book kosong");
    return { issues, spreadPct: null, bestBid: null, bestAsk: null };
  }
  const bid = Number(bestBid[0]);
  const ask = Number(bestAsk[0]);
  if (!(bid > 0) || !(ask > 0) || ask < bid) {
    issues.push("bid/ask tidak valid");
  }
  const mid = (bid + ask) / 2;
  const spreadPct = ((ask - bid) / mid) * 100;
  if (spreadPct > params.maxSpreadPct) {
    issues.push(`spread ${spreadPct.toFixed(2)}% > ${params.maxSpreadPct}%`);
  }
  return { issues, spreadPct, bestBid: bid, bestAsk: ask };
}

/**
 * Keputusan strategi pada candle tertutup.
 * @param {Array} candles candle tertutup, urut naik
 * @param {null|{entryPrice:number, peakPrice:number, openedCandle:number}} position
 * @returns {{action:"BUY"|"SELL"|"HOLD", reason:string, meta:object}}
 */
export function decide(candles, position = null, params = PARAMS, nowSec = null) {
  const meta = { strategy: params.version };
  const issues = validateCandles(candles, nowSec ?? candles[candles.length - 1].time, params);
  if (issues.length) {
    return { action: "HOLD", reason: `data tidak valid: ${issues.join("; ")}`, meta: { ...meta, issues } };
  }

  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const trend = ema(closes, params.trendEma);
  const atrValue = atr(candles, params.atrPeriod);
  const entryBand = donchian(candles, params.entryLookback);
  const exitBand = donchian(candles, params.exitLookback);

  Object.assign(meta, {
    candleTime: last.time,
    close: last.close,
    ema: trend,
    atr: atrValue,
    entryHigh: entryBand?.high ?? null,
    exitLow: exitBand?.low ?? null,
  });

  if (position) {
    const peak = Math.max(position.peakPrice ?? position.entryPrice, last.close);
    meta.peakPrice = peak;
    const stop = atrValue === null ? null : peak - params.atrMult * atrValue;
    meta.stopPrice = stop;
    const heldBars = Math.round((last.time - position.openedCandle) / (TF_SECONDS[params.timeframe] ?? 3600));

    if (exitBand && last.close < exitBand.low) {
      return { action: "SELL", reason: `Close ${last.close} < Low ${params.exitLookback} bar (${exitBand.low})`, meta };
    }
    if (stop !== null && last.close < stop) {
      return { action: "SELL", reason: `Close ${last.close} < trailing stop ATR ${params.atrMult}x (${stop.toFixed(2)})`, meta };
    }
    if (heldBars >= params.maxHoldBars) {
      return { action: "SELL", reason: `Batas waktu ${params.maxHoldBars} bar tercapai`, meta };
    }
    return { action: "HOLD", reason: "posisi terbuka, tidak ada sinyal keluar", meta };
  }

  if (entryBand && last.close > entryBand.high && trend !== null && last.close > trend) {
    return {
      action: "BUY",
      reason: `Close ${last.close} > High ${params.entryLookback} bar (${entryBand.high}) dan > EMA${params.trendEma} (${trend.toFixed(2)})`,
      meta,
    };
  }
  return { action: "HOLD", reason: "tidak ada breakout + tren", meta };
}

export function strategySummary() {
  return {
    ...PARAMS,
    rules: {
      entry: `Close > highest High ${PARAMS.entryLookback} bar sebelumnya DAN Close > EMA${PARAMS.trendEma}`,
      exit: `Close < lowest Low ${PARAMS.exitLookback} bar sebelumnya ATAU Close < peak - ${PARAMS.atrMult}xATR${PARAMS.atrPeriod} ATAU ditahan ${PARAMS.maxHoldBars} bar`,
      sizing: `Ekuitas / ${PARAMS.maxPositions} per posisi, dibatasi ${PARAMS.maxOrderPctOfCandle * 100}% nilai transaksi candle`,
      risk: `Maks ${PARAMS.maxPositions} posisi; daily loss limit ${PARAMS.dailyLossLimitPct}% (batas hari 00.00 WIB)`,
    },
  };
}

// lib/indicators.js — indikator murni (dipakai backtest dan bot; tidak ada state global).

export function sma(values, period) {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i += 1) sum += values[i];
  return sum / period;
}

/** EMA penuh dari awal seri; mengembalikan nilai terakhir. */
export function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let acc = sma(values.slice(0, period), period);
  for (let i = period; i < values.length; i += 1) acc = values[i] * k + acc * (1 - k);
  return acc;
}

export function trueRanges(candles) {
  const out = [];
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    if (i === 0) {
      out.push(c.high - c.low);
      continue;
    }
    const prevClose = candles[i - 1].close;
    out.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return out;
}

/** ATR Wilder sederhana memakai rata-rata TR periode terakhir. */
export function atr(candles, period) {
  if (candles.length < period + 1) return null;
  const trs = trueRanges(candles).slice(-period);
  return trs.reduce((a, b) => a + b, 0) / period;
}

/** Highest high / lowest low dari `period` bar SEBELUM bar terakhir (tanpa look-ahead). */
export function donchian(candles, period) {
  if (candles.length < period + 1) return null;
  const window = candles.slice(-period - 1, -1);
  let high = -Infinity;
  let low = Infinity;
  for (const c of window) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  return { high, low };
}

export function median(values) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

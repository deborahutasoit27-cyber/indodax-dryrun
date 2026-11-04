// lib/tick.js — satu siklus bot: baca state -> ambil data -> sinyal -> eksekusi -> simpan.
// Dipakai oleh api/tick.js (Vercel) DAN scripts/dryrun_local.js (lokal).
// Semua order disimulasikan terhadap order book sungguhan (bid/ask, bukan mid/close).

import { closedCandles, depth, history, priceIncrements, serverTime } from "./indodax.js";
import { PARAMS, decide, validateBook } from "./strategy.js";
import { buyAtAsk, feeFor, meetsMinOrder, normalizeBook, sellAtBid } from "./execution.js";
import { canOpenPosition, dayKeyWIB, dailyLossPct, equityAtBid, rollDay } from "./risk.js";
import * as store from "./store.js";

const TF = "60";
const TF_SEC = 3600;
const HISTORY_DAYS = 25; // ~600 bar: cukup untuk EMA200 + Donchian168

export function initialState(nowSec, capitalIdr) {
  return {
    version: 1,
    startedAt: new Date(nowSec * 1000).toISOString(),
    startedAtUnix: nowSec,
    cashIdr: capitalIdr,
    positions: {},
    candleTimes: {},
    day: null,
    killSwitch: false,
    tickCount: 0,
    lastTickAt: null,
    lockUntil: 0,
    apiErrors: 0,
    firstTickUnix: null,
  };
}

function pairMeta(universe, symbol) {
  return universe.find((u) => u.symbol === symbol) ?? { quantityIncrement: 1e-8 };
}

/**
 * Jalankan satu tick penuh.
 * @returns {{nowSec:number, equity:number, orders:Array, evaluated:number, skipped:Array}}
 */
export async function runTick({ universe, capitalIdr = 100_000_000, params = PARAMS, fetchImpl = null }) {
  const nowSec = await serverTime();
  let state = await store.getState();
  if (!state) {
    state = initialState(nowSec, capitalIdr);
    await store.setState(state);
  }
  if (!state.firstTickUnix) state.firstTickUnix = nowSec;

  if (state.lockUntil && state.lockUntil > nowSec) {
    await store.appendLog("error", { type: "tick_skipped", reason: "lock aktif", lockUntil: state.lockUntil, nowSec });
    return { nowSec, skippedLock: true, orders: [], evaluated: 0, equity: null };
  }
  state.lockUntil = nowSec + 240;
  await store.setState(state);

  const orders = [];
  const skipped = [];
  const bids = {};
  let evaluated = 0;

  // Setiap penolakan dicatat, bukan hanya dihitung.
  const reject = async (pair, reason, extra = {}) => {
    skipped.push({ pair, reason });
    await store.appendLog("error", { t: nowSec, pair, type: "reject", reason, ...extra });
  };

  try {
    const killSwitch = await store.getKillSwitch();
    state.killSwitch = killSwitch;

    const increments = await priceIncrements().catch(() => ({}));

    // ---------- 1. Ambil data & catat snapshot ----------
    const market = {};
    for (const pair of universe) {
      const symbol = pair.symbol;
      try {
        const from = nowSec - HISTORY_DAYS * 86400;
        const rawCandles = await history(symbol, TF, from, nowSec);
        const candles = closedCandles(rawCandles, TF, nowSec);
        const rawBook = await depth(pair.id);
        const book = normalizeBook(rawBook);
        const check = validateBook(book, params);
        bids[symbol] = check.bestBid;
        market[symbol] = { candles, book, check };
        await store.appendLog("snapshot", {
          t: nowSec, pair: symbol,
          bid: check.bestBid, ask: check.bestAsk, spreadPct: check.spreadPct,
          bidLevels: book.bids.length, askLevels: book.asks.length,
          issues: check.issues,
        });
      } catch (error) {
        state.apiErrors = (state.apiErrors ?? 0) + 1;
        await store.appendLog("error", { t: nowSec, pair: symbol, type: "fetch", message: String(error.message ?? error) });
        skipped.push({ pair: symbol, reason: `fetch gagal: ${error.message ?? error}` });
      }
    }

    // ---------- 2. Equity & batas harian ----------
    let equity = equityAtBid(state, bids);
    rollDay(state, nowSec, equity);
    const loss = dailyLossPct(state, equity);

    // ---------- 3. Keluar posisi lebih dulu (membebaskan slot) ----------
    for (const [symbol, pos] of Object.entries(state.positions)) {
      const m = market[symbol];
      if (!m) continue;
      const last = m.candles[m.candles.length - 1];
      if (!last) continue;
      if ((state.candleTimes[symbol] ?? 0) >= last.time) {
        skipped.push({ pair: symbol, reason: "candle sudah diproses" });
        continue;
      }
      if (m.check.issues.length) {
        await reject(symbol, `book tidak valid: ${m.check.issues.join("; ")}`);
        continue;
      }
      evaluated += 1;
      const signal = decide(m.candles, pos, params, nowSec);
      await store.appendLog("signal", { t: nowSec, pair: symbol, candleTime: last.time, action: signal.action, reason: signal.reason, meta: signal.meta });
      if (signal.action !== "SELL") {
        pos.peakPrice = Math.max(pos.peakPrice ?? pos.entryPrice, last.close);
        state.candleTimes[symbol] = last.time;
        continue;
      }
      const fill = sellAtBid(m.book, pos.qty);
      if (!fill.filled) {
        await reject(symbol, "book bid tidak cukup untuk menjual");
        continue;
      }
      const bestBid = m.book.bids[0]?.[0] ?? null;
      const fee = feeFor(fill.notional, params);
      const cashIn = fill.notional - fee;
      state.cashIdr += cashIn;
      const grossPnl = fill.notional - (pos.entryNotional ?? pos.qty * pos.entryPrice);
      const netPnl = grossPnl - fee - (pos.entryFee ?? 0);
      const order = {
        t: nowSec, pair: symbol, side: "SELL", qty: fill.qty, avgPrice: fill.avgPrice,
        notional: fill.notional, fee, levels: fill.levels, reason: signal.reason,
        candleTime: last.time, entryPrice: pos.entryPrice, entryFee: pos.entryFee ?? 0,
        grossPnl, netPnl, heldBars: Math.round((last.time - pos.openedCandle) / TF_SEC),
        spreadPct: m.check.spreadPct, bestPrice: bestBid,
        slipPct: bestBid > 0 ? (1 - fill.avgPrice / bestBid) * 100 : 0,
      };
      orders.push(order);
      await store.appendLog("order", order);
      delete state.positions[symbol];
      state.candleTimes[symbol] = last.time;
      equity = equityAtBid(state, bids);
    }

    // ---------- 4. Buka posisi baru ----------
    const permission = canOpenPosition(state, equity, params);
    if (!permission.allowed) {
      await store.appendLog("error", { t: nowSec, type: "entry_blocked", reason: permission.reason, lossPct: permission.lossPct, killSwitch: state.killSwitch });
    } else {
      for (const pair of universe) {
        const symbol = pair.symbol;
        const m = market[symbol];
        if (!m) continue;
        if (state.positions[symbol]) continue;
        const last = m.candles[m.candles.length - 1];
        if (!last) continue;
        if ((state.candleTimes[symbol] ?? 0) >= last.time) {
          skipped.push({ pair: symbol, reason: "candle sudah diproses" });
          continue;
        }
        if (m.check.issues.length) {
          await reject(symbol, `book tidak valid: ${m.check.issues.join("; ")}`);
          state.candleTimes[symbol] = last.time;
          continue;
        }
        evaluated += 1;
        const signal = decide(m.candles, null, params, nowSec);
        await store.appendLog("signal", { t: nowSec, pair: symbol, candleTime: last.time, action: signal.action, reason: signal.reason, meta: signal.meta });
        state.candleTimes[symbol] = last.time;
        if (signal.action !== "BUY") continue;
        if (Object.keys(state.positions).length >= params.maxPositions) break;

        const candleQuote = last.close * last.volume;
        const budget = Math.min(
          state.cashIdr,
          equity * params.positionPct,
          candleQuote * params.maxOrderPctOfCandle
        );
        if (budget < params.minOrderIdr) {
          await reject(symbol, `anggaran ${budget.toFixed(0)} < minimum ${params.minOrderIdr}`);
          continue;
        }
        const inc = Number(increments[pair.id] ?? pair.quantityIncrement ?? 1e-8);
        const fill = buyAtAsk(m.book, budget, inc);
        if (!fill.filled) {
          await reject(symbol, "book ask tidak cukup");
          continue;
        }
        const fee = feeFor(fill.notional, params);
        if (!meetsMinOrder(fill.notional, params)) {
          await reject(symbol, `nilai ${fill.notional.toFixed(0)} < minimum`);
          continue;
        }
        if (fill.notional + fee > state.cashIdr) {
          await reject(symbol, "kas tidak cukup setelah fee");
          continue;
        }
        state.cashIdr -= fill.notional + fee;
        const pos = {
          qty: fill.qty, entryPrice: fill.avgPrice, entryNotional: fill.notional,
          entryFee: fee, openedCandle: last.time, peakPrice: last.close,
          openedAt: new Date(nowSec * 1000).toISOString(),
        };
        state.positions[symbol] = pos;
        const order = {
          t: nowSec, pair: symbol, side: "BUY", qty: fill.qty, avgPrice: fill.avgPrice,
          notional: fill.notional, fee, levels: fill.levels, reason: signal.reason,
          candleTime: last.time, budget, candleQuote,
          spreadPct: m.check.spreadPct, bestPrice: m.book.asks[0]?.[0] ?? null,
          slipPct: m.book.asks[0]?.[0] > 0 ? (fill.avgPrice / m.book.asks[0][0] - 1) * 100 : 0,
        };
        orders.push(order);
        await store.appendLog("order", order);
        equity = equityAtBid(state, bids);
      }
    }

    // ---------- 5. Log equity ----------
    equity = equityAtBid(state, bids);
    const equityRow = {
      t: nowSec, equity, cashIdr: state.cashIdr,
      positions: Object.keys(state.positions).length,
      openPairs: Object.keys(state.positions),
      dayKey: dayKeyWIB(nowSec), dayLossPct: dailyLossPct(state, equity),
      killSwitch: state.killSwitch,
      prices: Object.fromEntries(Object.entries(market).map(([s, m]) => [s, m.candles[m.candles.length - 1]?.close ?? null])),
    };
    await store.appendLog("equity", equityRow);
    await store.appendLog("tick", {
      t: nowSec, equity, orders: orders.length, evaluated,
      skipped: skipped.length, killSwitch: state.killSwitch, apiErrors: state.apiErrors,
    });

    return { nowSec, equity, orders, evaluated, skipped, state };
  } finally {
    state.lockUntil = 0;
    state.tickCount = (state.tickCount ?? 0) + 1;
    state.lastTickAt = new Date(nowSec * 1000).toISOString();
    await store.setState(state);
  }
}

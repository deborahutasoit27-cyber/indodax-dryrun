// scripts/backtest.js — backtest memakai fungsi sinyal yang SAMA dengan bot (lib/strategy.js).
//
// Eksekusi:
//   sinyal dihitung pada candle tertutup ke-i
//   fill pada OPEN candle ke-i+1, disesuaikan biaya terukur:
//     beli  = open * (1 + spread/2 + slippage_beli)
//     jual  = open * (1 - spread/2 - slippage_jual)
//   spread & slippage berasal dari snapshot order book sungguhan
//   (data/snapshot_summary.json), bukan angka karangan. Tidak ada fill di mid/close.
//
// Pemakaian:
//   node scripts/backtest.js
//   node scripts/backtest.js --from=2026-11-04T05:00:00Z --to=2026-11-14T05:00:00Z --tag=10d

import fs from "node:fs";
import { PARAMS, INDICATOR_WINDOW, decide } from "../lib/strategy.js";
import { median } from "../lib/indicators.js";
import { dayKeyWIB } from "../lib/risk.js";

const TF_SEC = 3600;

function arg(name, fallback = null) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const CAPITAL = Number(arg("capital", process.env.CAPITAL_IDR ?? 100_000_000));
const OUT_TAG = arg("tag", "full");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadCandles(symbol) {
  const rows = loadJson(`data/candles/${symbol}.json`);
  const seen = new Set();
  const clean = [];
  for (const r of rows) {
    const c = { time: Number(r.time), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume) };
    if (!(c.time > 0) || seen.has(c.time)) continue;
    if (!(c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)) continue;
    if (!(c.volume >= 0)) continue;
    seen.add(c.time);
    clean.push(c);
  }
  clean.sort((a, b) => a.time - b.time);
  return clean;
}

function buildCostModel(snapshotSummary, symbols) {
  const model = {};
  for (const symbol of symbols) {
    const s = snapshotSummary.summary?.[symbol];
    const spread = Number(s?.medianSpreadPct ?? 0);
    const buySlip = Number(s?.medianBuySlipPct?.[10_000_000] ?? s?.medianSellSlipPct ?? 0);
    const sellSlip = Number(s?.medianSellSlipPct ?? 0);
    model[symbol] = {
      halfSpreadPct: spread / 2,
      buySlipPct: buySlip,
      sellSlipPct: sellSlip,
      buyCostPct: spread / 2 + buySlip,
      sellCostPct: spread / 2 + sellSlip,
      snapshots: s?.valid ?? 0,
    };
  }
  return model;
}

function maxDrawdown(series) {
  let peak = -Infinity;
  let mdd = 0;
  let peakAt = null;
  let troughAt = null;
  for (const p of series) {
    if (p.equity > peak) { peak = p.equity; peakAt = p.d; }
    const dd = (p.equity / peak - 1) * 100;
    if (dd < mdd) { mdd = dd; troughAt = p.d; }
  }
  return { mdd, peakAt, troughAt };
}

function annualised(series, startEquity, endEquity, days) {
  if (days <= 0) return 0;
  const total = endEquity / startEquity;
  return (Math.pow(total, 365.25 / days) - 1) * 100;
}

function sharpe(dailyReturns) {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (dailyReturns.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return 0;
  return (mean / sd) * Math.sqrt(365);
}

function main() {
  const universe = loadJson("data/universe.json").universe;
  const symbols = universe.map((u) => u.symbol);
  const snapshots = loadJson("data/snapshot_summary.json");
  const cost = buildCostModel(snapshots, symbols);

  const data = {};
  const quality = {};
  for (const u of universe) {
    const candles = loadCandles(u.symbol);
    data[u.symbol] = candles;
    quality[u.symbol] = {
      bars: candles.length,
      first: candles.length ? new Date(candles[0].time * 1000).toISOString() : null,
      last: candles.length ? new Date(candles[candles.length - 1].time * 1000).toISOString() : null,
    };
  }

  const allTimes = [...new Set(symbols.flatMap((s) => data[s].map((c) => c.time)))].sort((a, b) => a - b);
  const fromArg = arg("from");
  const toArg = arg("to");
  const firstData = allTimes[0];
  const lastData = allTimes[allTimes.length - 1];
  const windowStart = fromArg ? Math.floor(new Date(fromArg).getTime() / 1000) : firstData;
  const windowEnd = toArg ? Math.floor(new Date(toArg).getTime() / 1000) : lastData;

  const indexByTime = {};
  for (const s of symbols) {
    const m = new Map();
    data[s].forEach((c, i) => m.set(c.time, i));
    indexByTime[s] = m;
  }

  const increments = Object.fromEntries(universe.map((u) => [u.symbol, Number(u.quantityIncrement ?? 1e-8)]));
  const roundQty = (qty, symbol) => {
    const inc = increments[symbol] > 0 ? increments[symbol] : 1e-8;
    const decimals = Math.max(0, (String(inc).split(".")[1] ?? "").length);
    return Number((Math.floor(qty / inc + 1e-9) * inc).toFixed(decimals));
  };

  let cash = CAPITAL;
  const positions = {};
  const pending = {};
  const lastClose = {};
  const trades = [];
  const equitySeries = [];
  const dailyMap = new Map();
  let dayKey = null;
  let dayStartEquity = CAPITAL;
  let entriesBlockedDays = 0;
  let blockedToday = false;
  let peakEquity = CAPITAL;
  let maxDD = 0;
  let maxDDat = null;

  const wx = (sec) => new Date((sec + 7 * 3600) * 1000).toISOString().replace("T", " ").slice(0, 19);

  for (const T of allTimes) {
    if (T < windowStart || T > windowEnd) continue;

    // ---- 1. Eksekusi order yang dijadwalkan dari candle sebelumnya ----
    for (const symbol of [...symbols].sort()) {
      const idx = indexByTime[symbol].get(T);
      if (idx === undefined) continue;
      const candle = data[symbol][idx];
      const order = pending[symbol];
      if (!order) continue;
      delete pending[symbol];

      const c = cost[symbol];
      if (order.action === "SELL" && positions[symbol]) {
        const pos = positions[symbol];
        const px = candle.open * (1 - c.sellCostPct / 100);
        const notional = pos.qty * px;
        const fee = (notional * PARAMS.takerFeePct) / 100;
        cash += notional - fee;
        const gross = notional - pos.entryNotional;
        const net = gross - fee - pos.entryFee;
        trades.push({
          pair: symbol, entryTime: wx(pos.openedCandle), entryCandle: pos.openedCandle,
          exitTime: wx(T), exitCandle: T, qty: pos.qty,
          entryPrice: pos.entryPrice, exitPrice: px,
          entryNotional: pos.entryNotional, exitNotional: notional,
          entryFee: pos.entryFee, exitFee: fee,
          grossPnl: gross, netPnl: net,
          returnPct: (net / pos.entryNotional) * 100,
          barsHeld: Math.round((T - pos.openedCandle) / TF_SEC),
          entryReason: pos.entryReason, exitReason: order.reason,
          spreadCost: ((pos.entryNotional + notional) * c.halfSpreadPct) / 100,
          slipCost: (pos.entryNotional * c.buySlipPct + notional * c.sellSlipPct) / 100,
        });
        delete positions[symbol];
      } else if (order.action === "BUY" && !positions[symbol]) {
        // batas portofolio & risiko diperiksa pada saat eksekusi
        const equityNow = cash + Object.entries(positions).reduce((a, [s, p]) => a + p.qty * (lastClose[s] ?? p.entryPrice), 0);
        const dayLoss = ((equityNow - dayStartEquity) / dayStartEquity) * 100;
        const canOpen = !blockedToday && dayLoss > -Math.abs(PARAMS.dailyLossLimitPct) && Object.keys(positions).length < PARAMS.maxPositions;
        if (canOpen) {
          const budget = Math.min(cash, equityNow * PARAMS.positionPct, order.candleQuote * PARAMS.maxOrderPctOfCandle);
          if (budget >= PARAMS.minOrderIdr) {
            const px = candle.open * (1 + c.buyCostPct / 100);
            const qty = roundQty(budget / px, symbol);
            const notional = qty * px;
            const fee = (notional * PARAMS.takerFeePct) / 100;
            if (qty > 0 && notional >= PARAMS.minOrderIdr && notional + fee <= cash) {
              cash -= notional + fee;
              positions[symbol] = {
                qty, entryPrice: px, entryNotional: notional, entryFee: fee,
                openedCandle: T, peakPrice: candle.close, entryReason: order.reason,
              };
            }
          }
        }
      }
    }

    // ---- 2. Mark-to-market pada close T (hanya pair yang punya candle T) ----
    for (const symbol of symbols) {
      const idx = indexByTime[symbol].get(T);
      if (idx !== undefined) lastClose[symbol] = data[symbol][idx].close;
    }
    const equity = cash + Object.entries(positions).reduce((a, [s, p]) => a + p.qty * (lastClose[s] ?? p.entryPrice), 0);

    // ---- 3. Batas hari WIB ----
    const key = dayKeyWIB(T);
    if (key !== dayKey) {
      if (dayKey && !blockedToday) {
        // hari sebelumnya selesai tanpa blokir
      }
      dayKey = key;
      dayStartEquity = equity;
      blockedToday = false;
    }
    const dayLoss = ((equity - dayStartEquity) / dayStartEquity) * 100;
    if (!blockedToday && dayLoss <= -Math.abs(PARAMS.dailyLossLimitPct)) {
      blockedToday = true;
      entriesBlockedDays += 1;
    }

    if (equity > peakEquity) peakEquity = equity;
    const dd = (equity / peakEquity - 1) * 100;
    if (dd < maxDD) { maxDD = dd; maxDDat = wx(T); }

    // equity harian = nilai terakhir pada tanggal WIB tersebut
    if (key) {
      dailyMap.set(key, { d: key, equity, cash, positions: Object.keys(positions).length, blocked: blockedToday });
    }

    // ---- 4. Sinyal pada candle tertutup T, dieksekusi di candle berikutnya ----
    for (const symbol of symbols) {
      const idx = indexByTime[symbol].get(T);
      if (idx === undefined) continue;
      if (idx + 1 >= data[symbol].length) continue; // tidak ada candle berikutnya
      if (idx < INDICATOR_WINDOW - 1) continue;
      if (pending[symbol]) continue;

      const slice = data[symbol].slice(0, idx + 1);
      const pos = positions[symbol]
        ? { entryPrice: positions[symbol].entryPrice, peakPrice: positions[symbol].peakPrice, openedCandle: positions[symbol].openedCandle }
        : null;
      const signal = decide(slice, pos, PARAMS, T + TF_SEC);
      if (signal.action === "HOLD") continue;
      if (signal.action === "SELL" && !pos) continue;
      if (signal.action === "BUY" && pos) continue;
      pending[symbol] = {
        action: signal.action,
        reason: signal.reason,
        candleQuote: data[symbol][idx].close * data[symbol][idx].volume,
      };
      if (positions[symbol]) positions[symbol].peakPrice = Math.max(positions[symbol].peakPrice, data[symbol][idx].close);
    }
  }

  // ---- Metrik ----
  const daily = [...dailyMap.values()].sort((a, b) => a.d.localeCompare(b.d));
  let peakDaily = -Infinity;
  let mddDaily = 0;
  let mddDailyAt = null;
  for (const row of daily) {
    if (row.equity > peakDaily) peakDaily = row.equity;
    const dd = (row.equity / peakDaily - 1) * 100;
    if (dd < mddDaily) { mddDaily = dd; mddDailyAt = row.d; }
  }
  const startEquity = CAPITAL;
  const endEquity = daily.length ? daily[daily.length - 1].equity : CAPITAL;
  const days = daily.length ? (new Date(daily[daily.length - 1].d) - new Date(daily[0].d)) / 86400000 : 0;
  const dailyReturns = [];
  for (let i = 1; i < daily.length; i += 1) dailyReturns.push(daily[i].equity / daily[i - 1].equity - 1);

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0));
  const costs = {
    fees: trades.reduce((a, t) => a + t.entryFee + t.exitFee, 0),
    spread: trades.reduce((a, t) => a + t.spreadCost, 0),
    slippage: trades.reduce((a, t) => a + t.slipCost, 0),
  };
  costs.total = costs.fees + costs.spread + costs.slippage;
  const grossPositive = trades.filter((t) => t.grossPnl > 0).reduce((a, t) => a + t.grossPnl, 0);

  const metrics = {
    startEquity,
    endEquity,
    totalReturnPct: (endEquity / startEquity - 1) * 100,
    cagrPct: annualised(daily, startEquity, endEquity, days),
    maxDrawdownPct: mddDaily,
    maxDrawdownAt: mddDailyAt,
    maxDrawdownHourlyPct: maxDD,
    maxDrawdownHourlyAt: maxDDat,
    sharpe: sharpe(dailyReturns),
    days: Number(days.toFixed(2)),
    trades: trades.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0),
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    avgTradePct: trades.length ? trades.reduce((a, t) => a + t.returnPct, 0) / trades.length : 0,
    avgBarsHeld: trades.length ? trades.reduce((a, t) => a + t.barsHeld, 0) / trades.length : 0,
    entriesBlockedDays,
    costs,
    grossProfitPositive: grossPositive,
    costSharePct: grossPositive > 0 ? (costs.total / grossPositive) * 100 : null,
  };

  // ---- Benchmark BTC buy & hold, biaya sama ----
  const btc = data.BTCIDR ?? data[symbols[0]];
  const btcWin = btc.filter((c) => c.time >= windowStart && c.time <= windowEnd);
  let benchmark = null;
  if (btcWin.length > 1 && cost.BTCIDR) {
    const c = cost.BTCIDR;
    const buyPx = btcWin[0].open * (1 + c.buyCostPct / 100);
    const qty = (CAPITAL * 0.999) / buyPx;
    const fee = (qty * buyPx * PARAMS.takerFeePct) / 100;
    const qtyNet = ((CAPITAL - fee) / buyPx);
    const dailyB = [];
    let peakB = CAPITAL;
    let mddB = 0;
    for (const candle of btcWin) {
      const eq = qtyNet * candle.close;
      if (eq > peakB) peakB = eq;
      mddB = Math.min(mddB, (eq / peakB - 1) * 100);
      dailyB.push({ d: dayKeyWIB(candle.time), equity: eq });
    }
    const byDay = new Map();
    for (const row of dailyB) byDay.set(row.d, row);
    const series = [...byDay.values()];
    const endB = qtyNet * btcWin[btcWin.length - 1].close;
    const daysB = (btcWin[btcWin.length - 1].time - btcWin[0].time) / 86400;
    benchmark = {
      pair: "BTCIDR",
      totalReturnPct: (endB / CAPITAL - 1) * 100,
      cagrPct: annualised(series, CAPITAL, endB, daysB),
      maxDrawdownPct: mddB,
      buyPrice: buyPx,
      note: "Beli di open candle pertama jendela, tahan sampai akhir, biaya beli/jual terukur.",
    };
  }

  const monthly = new Map();
  for (const row of daily) {
    const m = row.d.slice(0, 7);
    if (!monthly.has(m)) monthly.set(m, { m, first: row.equity, last: row.equity });
    else monthly.get(m).last = row.equity;
  }
  const monthlyOut = [...monthly.values()].map((x) => ({ m: x.m, retPct: (x.last / x.first - 1) * 100 }));

  const out = {
    generatedAt: new Date().toISOString(),
    tag: OUT_TAG,
    strategy: PARAMS,
    window: {
      from: new Date(windowStart * 1000).toISOString(),
      to: new Date(windowEnd * 1000).toISOString(),
      fromWib: wx(windowStart),
      toWib: wx(windowEnd),
      days: Number(days.toFixed(2)),
    },
    universe: universe.map((u) => ({ symbol: u.symbol, medianHourlyIdrAtStart: u.medianHourlyIdrAtStart })),
    costModel: cost,
    feePct: PARAMS.takerFeePct,
    metrics,
    benchmark,
    trades,
    daily,
    monthly: monthlyOut,
    dataQuality: quality,
    notes: [
      "Sinyal memakai lib/strategy.js yang sama dengan bot.",
      `Eksekusi di open candle berikutnya dengan spread/2 + slippage terukur; fee taker ${PARAMS.takerFeePct}%.`,
      "Tidak ada fill di mid atau close.",
      "Daily loss limit dihitung pada batas hari 00.00 WIB.",
    ],
  };

  fs.writeFileSync(`data/backtest_${OUT_TAG}.json`, JSON.stringify(out, null, 2), "utf8");

  const header = "pair,entry_time,exit_time,qty,entry_price,exit_price,entry_notional,exit_notional,entry_fee,exit_fee,gross_pnl,net_pnl,return_pct,bars_held,exit_reason";
  const csv = [header, ...trades.map((t) => [
    t.pair, t.entryTime, t.exitTime, t.qty, t.entryPrice, t.exitPrice,
    t.entryNotional.toFixed(2), t.exitNotional.toFixed(2), t.entryFee.toFixed(2), t.exitFee.toFixed(2),
    t.grossPnl.toFixed(2), t.netPnl.toFixed(2), t.returnPct.toFixed(4), t.barsHeld,
    `"${String(t.exitReason).replace(/"/g, "'")}"`,
  ].join(","))].join("\n");
  fs.writeFileSync(`data/trades_${OUT_TAG}.csv`, csv, "utf8");

  console.log(`Backtest ${OUT_TAG}: ${out.window.fromWib} -> ${out.window.toWib} (${out.window.days} hari)`);
  console.log(`  Return ${metrics.totalReturnPct.toFixed(2)}% | CAGR ${metrics.cagrPct.toFixed(2)}% | MDD ${metrics.maxDrawdownPct.toFixed(2)}%`);
  console.log(`  Trade ${metrics.trades} | PF ${metrics.profitFactor === null ? "n/a" : metrics.profitFactor.toFixed(2)} | Win ${metrics.winRatePct.toFixed(1)}%`);
  console.log(`  Biaya total Rp${costs.total.toLocaleString("id-ID", { maximumFractionDigits: 0 })} = ${metrics.costSharePct === null ? "n/a" : metrics.costSharePct.toFixed(1) + "% laba kotor"}`);
  console.log(`  Benchmark BTC ${benchmark ? benchmark.totalReturnPct.toFixed(2) + "%" : "n/a"}`);
  console.log(`  Ditulis: data/backtest_${OUT_TAG}.json, data/trades_${OUT_TAG}.csv`);
}

main();

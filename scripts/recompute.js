// scripts/recompute.js — menghitung ulang SEMUA metrik forward test dari log mentah.
// Tidak membaca angka dari dashboard. Sumber: data/forward_logs.json (hasil /api/export)
// atau data/local-store.json.
//
//   node scripts/recompute.js
//   node scripts/recompute.js --file=data/forward_logs.json
//   node scripts/recompute.js --backtest=data/backtest_10d.json

import fs from "node:fs";

function arg(name, fallback = null) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const FEE_PCT = 0.30;
const CAPITAL = Number(arg("capital", 100_000_000));

function loadLogs() {
  const file = arg("file");
  if (file) {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return { logs: raw.logs ?? raw, state: raw.state ?? null, source: file };
  }
  for (const candidate of ["data/forward_logs.json", "data/local-store.json"]) {
    if (fs.existsSync(candidate)) {
      const raw = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return { logs: raw.logs ?? raw, state: raw.state ?? null, source: candidate };
    }
  }
  throw new Error("Tidak ada log: jalankan /api/export atau scripts/dryrun_local.js dulu");
}

function mdd(equitySeries) {
  let peak = -Infinity;
  let worst = 0;
  let peakAt = null;
  let troughAt = null;
  for (const p of equitySeries) {
    if (p.equity > peak) { peak = p.equity; peakAt = p.t; }
    const dd = (p.equity / peak - 1) * 100;
    if (dd < worst) { worst = dd; troughAt = p.t; }
  }
  return { pct: worst, peakAt, troughAt };
}

function dayOf(unixSec) {
  return new Date((unixSec + 7 * 3600) * 1000).toISOString().slice(0, 10);
}

function round(n, d = 4) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function main() {
  const { logs, state, source } = loadLogs();
  const equityRows = (logs.equity ?? []).slice().sort((a, b) => a.t - b.t);
  const orders = (logs.order ?? []).slice().sort((a, b) => a.t - b.t);
  const errors = logs.error ?? [];
  const tickRows = logs.tick ?? [];
  const snapshots = logs.snapshot ?? [];

  if (!equityRows.length) throw new Error("Log equity kosong — forward test belum berjalan");

  const first = equityRows[0];
  const last = equityRows[equityRows.length - 1];
  const startEquity = CAPITAL;
  const endEquity = last.equity;
  const totalReturnPct = (endEquity / startEquity - 1) * 100;

  // equity harian = baris terakhir per tanggal WIB
  const byDay = new Map();
  for (const row of equityRows) byDay.set(dayOf(row.t), row);
  const daily = [...byDay.entries()].map(([d, row]) => ({ d, t: row.t, equity: row.equity })).sort((a, b) => a.d.localeCompare(b.d));

  const dd = mdd(equityRows.map((r) => ({ t: r.t, equity: r.equity })));

  const sells = orders.filter((o) => o.side === "SELL");
  const buys = orders.filter((o) => o.side === "BUY");
  const wins = sells.filter((o) => o.netPnl > 0);
  const losses = sells.filter((o) => o.netPnl <= 0);
  const grossWin = wins.reduce((a, o) => a + o.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, o) => a + o.netPnl, 0));

  const fees = orders.reduce((a, o) => a + (o.fee ?? 0), 0);
  const spreadCost = orders.reduce((a, o) => a + ((o.notional ?? 0) * (o.spreadPct ?? 0)) / 200, 0);
  const slippageCost = orders.reduce((a, o) => a + ((o.notional ?? 0) * (o.slipPct ?? 0)) / 100, 0);
  const grossPositive = sells.filter((o) => o.grossPnl > 0).reduce((a, o) => a + o.grossPnl, 0);
  const totalCost = fees + spreadCost + slippageCost;

  // uptime: tick yang benar-benar tercatat vs yang seharusnya (1/jam)
  const expectedTicks = Math.max(1, Math.floor((last.t - first.t) / 3600) + 1);
  const recordedTicks = new Set(equityRows.map((r) => Math.floor(r.t / 3600))).size;
  const uptimePct = Math.min(100, (recordedTicks / expectedTicks) * 100);

  // benchmark BTC dari harga yang tercatat di log equity
  const btcRows = equityRows.filter((r) => r.prices?.BTCIDR > 0);
  let benchmark = null;
  if (btcRows.length > 1) {
    const p0 = btcRows[0].prices.BTCIDR;
    const p1 = btcRows[btcRows.length - 1].prices.BTCIDR;
    const costBuy = 0.30 / 100;
    const costSell = 0.30 / 100;
    const qty = (CAPITAL * (1 - costBuy)) / p0;
    const endVal = qty * p1 * (1 - costSell);
    let peak = -Infinity;
    let worst = 0;
    for (const r of btcRows) {
      const eq = qty * r.prices.BTCIDR;
      if (eq > peak) peak = eq;
      worst = Math.min(worst, (eq / peak - 1) * 100);
    }
    benchmark = {
      pair: "BTCIDR",
      totalReturnPct: round(((endVal / CAPITAL) - 1) * 100),
      maxDrawdownPct: round(worst),
      firstPrice: p0,
      lastPrice: p1,
      feePct: FEE_PCT,
    };
  }

  const killSwitchEvents = errors.filter((e) => e.type === "kill_switch");
  const apiErrors = errors.filter((e) => e.type === "fetch");
  const out = {
    generatedAt: new Date().toISOString(),
    source,
    window: {
      from: new Date(first.t * 1000).toISOString(),
      to: new Date(last.t * 1000).toISOString(),
      days: round((last.t - first.t) / 86400, 2),
      fromWib: dayOf(first.t),
      toWib: dayOf(last.t),
    },
    capital: startEquity,
    endEquity,
    totalReturnPct: round(totalReturnPct),
    maxDrawdownPct: round(dd.pct),
    maxDrawdownAt: dd.troughAt ? new Date(dd.troughAt * 1000).toISOString() : null,
    trades: { buys: buys.length, sells: sells.length, closed: sells.length },
    winRatePct: sells.length ? round((wins.length / sells.length) * 100) : 0,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    avgWin: wins.length ? round(grossWin / wins.length) : 0,
    avgLoss: losses.length ? round(-grossLoss / losses.length) : 0,
    costs: {
      fees: round(fees),
      spread: round(spreadCost),
      slippage: round(slippageCost),
      total: round(totalCost),
      grossProfitPositive: round(grossPositive),
      costSharePct: grossPositive > 0 ? round((totalCost / grossPositive) * 100) : null,
    },
    operational: {
      ticksRecorded: recordedTicks,
      expectedTicks,
      uptimePct: round(uptimePct),
      apiErrors: apiErrors.length,
      killSwitchUsed: killSwitchEvents.length,
      killSwitchActive: Boolean(state?.killSwitch),
      errorRows: errors.length,
      snapshots: snapshots.length,
      tickRows: tickRows.length,
    },
    benchmark,
    daily,
    state: state ? { cashIdr: state.cashIdr, positions: Object.keys(state.positions ?? {}), tickCount: state.tickCount } : null,
  };

  // Pembanding backtest pada jendela yang sama (bila tersedia)
  const btFile = arg("backtest", "data/backtest_10d.json");
  if (fs.existsSync(btFile)) {
    const bt = JSON.parse(fs.readFileSync(btFile, "utf8"));
    out.sameWindowBacktest = {
      file: btFile,
      window: bt.window,
      totalReturnPct: round(bt.metrics.totalReturnPct),
      maxDrawdownPct: round(bt.metrics.maxDrawdownPct),
      trades: bt.metrics.trades,
      profitFactor: bt.metrics.profitFactor,
      winRatePct: round(bt.metrics.winRatePct),
      costSharePct: bt.metrics.costSharePct,
      benchmarkBtcPct: bt.benchmark ? round(bt.benchmark.totalReturnPct) : null,
    };
    out.gap = {
      returnGapPct: round(out.totalReturnPct - out.sameWindowBacktest.totalReturnPct),
      note: "Forward dikurangi backtest pada jendela identik. Selisih wajar karena fill forward memakai order book nyata, backtest memakai model biaya.",
    };
  }

  fs.writeFileSync("data/forward_metrics.json", JSON.stringify(out, null, 2), "utf8");

  console.log(`Sumber            : ${source}`);
  console.log(`Jendela           : ${out.window.from} -> ${out.window.to} (${out.window.days} hari)`);
  console.log(`Return forward    : ${out.totalReturnPct.toFixed(2)}%`);
  console.log(`Max drawdown      : ${out.maxDrawdownPct.toFixed(2)}%`);
  console.log(`Trade             : ${sells.length} tertutup (${buys.length} beli)`);
  console.log(`Profit factor     : ${out.profitFactor ?? "n/a"} | Win ${out.winRatePct.toFixed(1)}%`);
  console.log(`Biaya             : Rp${totalCost.toLocaleString("id-ID", { maximumFractionDigits: 0 })} (${out.costs.costSharePct ?? "n/a"}% laba kotor)`);
  console.log(`Uptime            : ${out.operational.uptimePct.toFixed(1)}% (${recordedTicks}/${expectedTicks} tick)`);
  console.log(`API error / kill  : ${apiErrors.length} / ${killSwitchEvents.length}`);
  console.log(`Benchmark BTC     : ${benchmark ? benchmark.totalReturnPct.toFixed(2) + "%" : "n/a"}`);
  if (out.gap) console.log(`Gap vs backtest   : ${out.gap.returnGapPct.toFixed(2)} poin persen`);
  console.log("Ditulis: data/forward_metrics.json");
}

main();

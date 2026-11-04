// scripts/select_universe.js
// Memilih 3-10 pasangan IDR yang likuid DI AWAL periode backtest (bukan hari ini),
// supaya tidak terkena bias likuiditas/survivorship.

import fs from "node:fs";
import path from "node:path";
import { history, pairs, tickerAll } from "../lib/indodax.js";
import { median } from "../lib/indicators.js";

const BACKTEST_START = Math.floor(new Date("2023-11-05T00:00:00Z").getTime() / 1000);
const TF = 3600;
const TARGET = 5;
const MIN_MEDIAN_HOURLY_IDR = 10_000_000; // Rp10 juta/jam pada awal periode
const CANDIDATES = 120; // ambil jauh lebih banyak dari volume hari ini, lalu saring di awal periode

const EXCLUDE = new Set([
  "usdt", "usdc", "dai", "ausd", "idrt", "busd", "tusd", "fdusd",
]);

function eligible(pair) {
  const desc = String(pair.description ?? "").toUpperCase();
  if (!desc.endsWith("/IDR")) return false;
  const base = String(pair.traded_currency ?? "").toLowerCase();
  if (EXCLUDE.has(base)) return false;
  if (base.endsWith("x")) return false; // token saham (AAPLX, AMZNX, ...)
  if (pair.is_maintenance || pair.is_market_suspended) return false;
  return true;
}

async function main() {
  const [allPairs, tickers] = await Promise.all([pairs(), tickerAll()]);
  const candidates = allPairs
    .filter(eligible)
    .map((p) => ({ ...p, volIdrNow: Number(tickers[p.id]?.vol_idr ?? 0) }))
    .sort((a, b) => b.volIdrNow - a.volIdrNow)
    .slice(0, CANDIDATES);

  console.log(`Kandidat awal (${candidates.length}): ${candidates.map((c) => c.symbol).join(", ")}`);

  const measured = [];
  for (const pair of candidates) {
    const to = BACKTEST_START + 30 * 86400;
    const from = to - 650 * TF;
    let bars = [];
    try {
      bars = await history(pair.symbol, "60", from, to);
    } catch (error) {
      console.log(`  ${pair.symbol}: gagal ${error.message}`);
      continue;
    }
    if (bars.length < 500) {
      console.log(`  ${pair.symbol}: bar terlalu sedikit (${bars.length})`);
      continue;
    }
    const quoteVolumes = bars.map((b) => b.close * b.volume).filter((v) => v > 0);
    const med = median(quoteVolumes);
    const expected = Math.floor((bars[bars.length - 1].time - bars[0].time) / TF) + 1;
    const completeness = bars.length / expected;
    const ok = med !== null && med >= MIN_MEDIAN_HOURLY_IDR && completeness >= 0.9;
    console.log(
      `  ${pair.symbol.padEnd(12)} median ${(med ?? 0).toExponential(2)} IDR/jam  ` +
      `lengkap ${(completeness * 100).toFixed(1)}%  ${ok ? "LOLOS" : "tolak"}`
    );
    if (ok) {
      measured.push({
        id: pair.id,
        symbol: pair.symbol,
        description: pair.description,
        medianHourlyIdrAtStart: Math.round(med),
        completeness: Number(completeness.toFixed(4)),
        quantityIncrement: Number(pair.quantity_increment ?? 1e-8),
        minBaseCurrency: Number(pair.trade_min_base_currency ?? 0),
        feeTakerPct: Number(pair.trade_fee_percent_taker ?? 0.2),
      });
    }
  }

  measured.sort((a, b) => b.medianHourlyIdrAtStart - a.medianHourlyIdrAtStart);
  const universe = measured.slice(0, TARGET);

  const out = {
    generatedAt: new Date().toISOString(),
    criteria: {
      quote: "IDR",
      excluded: "stablecoin dan token saham (berakhiran X)",
      liquidityMeasuredAt: new Date(BACKTEST_START * 1000).toISOString(),
      minMedianHourlyIdr: MIN_MEDIAN_HOURLY_IDR,
      minCompleteness: 0.9,
      target: TARGET,
      note: "Likuiditas diukur pada 30 hari pertama periode backtest, bukan hari ini.",
    },
    universe,
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/universe.json", JSON.stringify(out, null, 2), "utf8");
  console.log(`\nUniverse final (${universe.length}): ${universe.map((u) => u.symbol).join(", ")}`);
  console.log("Ditulis ke data/universe.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

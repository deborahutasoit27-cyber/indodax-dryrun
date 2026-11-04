// scripts/collect_history.js
// Menarik candle 1 jam mundur 3 tahun untuk seluruh universe.
// history_v2 hanya memberi ~650 bar terakhir sebelum `to`, jadi kita mundur
// bertahap; maksimal 3 request/detik dan tidak paralel (lihat lib/http.js).

import fs from "node:fs";
import path from "node:path";
import { history, serverTime } from "../lib/indodax.js";

const TF = "60";
const TF_SEC = 3600;
const YEARS = 3;

function loadUniverse() {
  const file = "data/universe.json";
  if (!fs.existsSync(file)) throw new Error("Jalankan dulu: npm run select-universe");
  return JSON.parse(fs.readFileSync(file, "utf8")).universe;
}

async function collectPair(symbol, startSec, endSec) {
  const byTime = new Map();
  let to = endSec;
  let requests = 0;
  let oldest = endSec;

  while (to > startSec) {
    const from = Math.max(startSec, to - 650 * TF_SEC);
    const bars = await history(symbol, TF, from, to);
    requests += 1;
    if (!bars.length) break;
    let added = 0;
    for (const bar of bars) {
      if (bar.time >= startSec && bar.time <= endSec && !byTime.has(bar.time)) {
        byTime.set(bar.time, bar);
        added += 1;
      }
    }
    const minTime = Math.min(...bars.map((b) => b.time));
    if (minTime >= oldest && added === 0) break; // tidak maju
    oldest = Math.min(oldest, minTime);
    to = minTime - 1;
    if (requests % 5 === 0) {
      process.stdout.write(`  ${symbol}: ${requests} req, ${byTime.size} bar, sampai ${new Date(oldest * 1000).toISOString().slice(0, 10)}\n`);
    }
    if (requests > 80) break; // pengaman
  }

  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  const expected = Math.floor((endSec - startSec) / TF_SEC);
  return {
    symbol,
    requests,
    candles,
    coverage: Number((candles.length / expected).toFixed(4)),
    first: candles.length ? new Date(candles[0].time * 1000).toISOString() : null,
    last: candles.length ? new Date(candles[candles.length - 1].time * 1000).toISOString() : null,
  };
}

async function main() {
  const universe = loadUniverse();
  const now = await serverTime();
  const startSec = now - Math.round(YEARS * 365.25 * 86400);
  const endSec = now;

  fs.mkdirSync("data/candles", { recursive: true });
  const manifest = {
    collectedAt: new Date().toISOString(),
    timeframe: TF,
    requestedStart: new Date(startSec * 1000).toISOString(),
    requestedEnd: new Date(endSec * 1000).toISOString(),
    pairs: [],
  };

  for (const pair of universe) {
    console.log(`\n${pair.symbol} ...`);
    const result = await collectPair(pair.symbol, startSec, endSec);
    fs.writeFileSync(`data/candles/${pair.symbol}.json`, JSON.stringify(result.candles), "utf8");
    manifest.pairs.push({
      symbol: pair.symbol,
      bars: result.candles.length,
      requests: result.requests,
      coverage: result.coverage,
      first: result.first,
      last: result.last,
    });
    console.log(`  selesai: ${result.candles.length} bar, coverage ${(result.coverage * 100).toFixed(1)}%, ${result.requests} request`);
  }

  fs.writeFileSync("data/history_manifest.json", JSON.stringify(manifest, null, 2), "utf8");
  console.log("\nManifest: data/history_manifest.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

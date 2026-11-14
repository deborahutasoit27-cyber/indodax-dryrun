// scripts/refresh_history.js — menambahkan bar candle 1 jam TERBARU ke data/candles/
// tanpa menggeser awal window 3 tahun (beda dengan collect_history.js yang menulis
// ulang seluruh window). Dipakai saat menutup forward test agar backtest jendela
// forward memakai candle asli hingga 14 Nov 2026.
//
//   node scripts/refresh_history.js

import fs from "node:fs";
import { history, serverTime } from "../lib/indodax.js";

function loadUniverse() {
  return JSON.parse(fs.readFileSync("data/universe.json", "utf8")).universe;
}

async function main() {
  const universe = loadUniverse();
  const now = await serverTime();
  let addedTotal = 0;

  for (const pair of universe) {
    const file = `data/candles/${pair.symbol}.json`;
    const candles = JSON.parse(fs.readFileSync(file, "utf8"));
    const lastTime = candles[candles.length - 1].time;
    if (lastTime + 3600 > now) {
      console.log(`${pair.symbol}: sudah segar (terakhir ${new Date(lastTime * 1000).toISOString()})`);
      continue;
    }
    const bars = await history(pair.symbol, "60", lastTime, now); // < 650 bar
    const byTime = new Map(candles.map((c) => [c.time, c]));
    let added = 0;
    for (const bar of bars) {
      if (!byTime.has(bar.time)) { byTime.set(bar.time, bar); added += 1; }
    }
    const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
    fs.writeFileSync(file, JSON.stringify(merged), "utf8");
    addedTotal += added;
    console.log(`${pair.symbol}: +${added} bar -> ${merged.length} (s.d. ${new Date(merged[merged.length - 1].time * 1000).toISOString()})`);

    // perbarui entri manifest untuk pair ini (tambah informasi refresh)
    try {
      const manifest = JSON.parse(fs.readFileSync("data/history_manifest.json", "utf8"));
      const entry = manifest.pairs.find((p) => p.symbol === pair.symbol);
      if (entry) {
        entry.bars = merged.length;
        entry.last = new Date(merged[merged.length - 1].time * 1000).toISOString();
      }
      manifest.refreshedAt = new Date().toISOString();
      manifest.refreshNote = "Bar 5-14 Nov 2026 ditambahkan untuk menutup jendela forward test (awal window tidak digeser).";
      fs.writeFileSync("data/history_manifest.json", JSON.stringify(manifest, null, 2), "utf8");
    } catch {}
  }
  console.log(`Selesai. Total bar baru: ${addedTotal}`);
}

main().catch((error) => { console.error(error); process.exit(1); });

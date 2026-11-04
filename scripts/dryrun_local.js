// scripts/dryrun_local.js — menjalankan tick yang sama persis seperti di Vercel,
// tetapi memakai penyimpanan file lokal (data/local-store.json).
//   node scripts/dryrun_local.js            -> satu tick
//   node scripts/dryrun_local.js --loop     -> tick tiap 10 menit (untuk uji)
//   node scripts/dryrun_local.js --reset    -> hapus state lokal lalu tick baru

import fs from "node:fs";
import { runTick } from "../lib/tick.js";

const args = new Set(process.argv.slice(2));
const STORE = process.env.LOCAL_STORE_FILE || "data/local-store.json";

if (args.has("--reset") && fs.existsSync(STORE)) {
  fs.rmSync(STORE);
  console.log(`State lokal dihapus: ${STORE}`);
}

function loadUniverse() {
  if (!fs.existsSync("data/universe.json")) throw new Error("Jalankan dulu: npm run select-universe");
  return JSON.parse(fs.readFileSync("data/universe.json", "utf8")).universe;
}

async function once() {
  const universe = loadUniverse();
  const t0 = Date.now();
  const r = await runTick({ universe, capitalIdr: Number(process.env.CAPITAL_IDR ?? 100_000_000) });
  const wib = new Date((r.nowSec + 7 * 3600) * 1000).toISOString().replace("T", " ").slice(0, 19);
  console.log(`[${wib} WIB] ekuitas Rp${(r.equity ?? 0).toLocaleString("id-ID")} | dievaluasi ${r.evaluated} | order ${r.orders.length} | ${Date.now() - t0} ms`);
  for (const o of r.orders) {
    console.log(`  ${o.side} ${o.pair} ${o.qty} @ ${o.avgPrice} (${o.levels} level) — ${o.reason}`);
  }
  for (const s of r.skipped.slice(0, 8)) console.log(`  lewati ${s.pair}: ${s.reason}`);
}

await once();

if (args.has("--loop")) {
  const everyMs = Number(process.env.LOOP_MS ?? 10 * 60 * 1000);
  console.log(`Mode loop: tick tiap ${Math.round(everyMs / 60000)} menit. Ctrl+C untuk berhenti.`);
  setInterval(() => {
    once().catch((e) => console.error("tick gagal:", e.message));
  }, everyMs);
}

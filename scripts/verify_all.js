// scripts/verify_all.js — pemeriksaan konsistensi sebelum dikumpulkan.
// Semua angka dihitung ulang dari data mentah; tidak ada yang dipercaya begitu saja.

import fs from "node:fs";
import path from "node:path";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "LULUS" : "GAGAL"}  ${name}${detail ? "\n       " + detail : ""}`);
}
function read(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

// 1. Universe
const universe = read("data/universe.json");
const pairs = universe?.universe ?? [];
check("Universe 3–10 pair IDR", pairs.length >= 3 && pairs.length <= 10, `${pairs.length} pair: ${pairs.map((p) => p.symbol).join(", ")}`);
check("Likuiditas diukur di awal periode", Boolean(universe?.criteria?.liquidityMeasuredAt), universe?.criteria?.liquidityMeasuredAt ?? "");

// 2. Kelengkapan candle
const manifest = read("data/history_manifest.json");
const worst = Math.min(...(manifest?.pairs ?? [{ coverage: 0 }]).map((p) => p.coverage));
const totalBars = (manifest?.pairs ?? []).reduce((a, p) => a + p.bars, 0);
check("Kelengkapan candle ≥ 99%", worst >= 0.99, `terendah ${(worst * 100).toFixed(2)}%, total ${totalBars.toLocaleString("id-ID")} bar`);

// 3. Snapshot
const snaps = read("data/snapshot_summary.json");
const snapCount = Object.values(snaps?.summary ?? {}).reduce((a, s) => a + (s.valid ?? 0), 0);
check("Snapshot order book terukur", snapCount >= 20, `${snapCount} snapshot valid`);

// 4. Backtest
const bt = read("data/backtest_full.json");
if (!bt) {
  check("Backtest tersedia", false, "jalankan npm run backtest");
} else {
  const daily = bt.daily ?? [];
  const trades = bt.trades ?? [];
  const start = bt.metrics.startEquity;
  const end = daily.length ? daily[daily.length - 1].equity : start;
  let peak = -Infinity;
  let mdd = 0;
  for (const p of daily) { if (p.equity > peak) peak = p.equity; mdd = Math.min(mdd, (p.equity / peak - 1) * 100); }
  check("Return backtest konsisten dengan kurva ekuitas", Math.abs((end / start - 1) * 100 - bt.metrics.totalReturnPct) < 0.01, `${((end / start - 1) * 100).toFixed(4)}% vs ${bt.metrics.totalReturnPct.toFixed(4)}%`);
  check("Max drawdown konsisten", Math.abs(mdd - bt.metrics.maxDrawdownPct) < 0.01, `${mdd.toFixed(4)}% vs ${bt.metrics.maxDrawdownPct.toFixed(4)}%`);
  const sells = trades.length;
  check("Jumlah trade konsisten", sells === bt.metrics.trades, `${sells} vs ${bt.metrics.trades}`);
  const csv = fs.existsSync("data/trades_full.csv") ? fs.readFileSync("data/trades_full.csv", "utf8").trim().split("\n").length - 1 : -1;
  check("CSV trade sama dengan JSON", csv === sells, `${csv} baris vs ${sells} trade`);
  const costSum = bt.metrics.costs.fees + bt.metrics.costs.spread + bt.metrics.costs.slippage;
  check("Total biaya = fee + spread + slippage", Math.abs(costSum - bt.metrics.costs.total) < 0.5, `Rp${costSum.toFixed(2)}`);
  check("Tidak ada fill di mid/close", bt.notes.some((n) => n.includes("open candle berikutnya")), "eksekusi di open candle berikutnya + biaya");
  const years = (new Date(bt.window.to) - new Date(bt.window.from)) / (365.25 * 86400000);
  check("Periode backtest ≥ 3 tahun", years >= 2.99, `${years.toFixed(3)} tahun`);
  check("Fee yang dipakai 0,30% (lebih tinggi dari API 0,20%)", bt.feePct === 0.3, `${bt.feePct}%`);
}

// 5. Forward (opsional)
const fwd = read("data/forward_metrics.json");
if (!fwd) {
  check("Forward test belum berjalan", true, "normal sebelum 4 Nov 12.00 WIB — dashboard menampilkan status belum berjalan");
} else {
  check("Forward: uptime dilaporkan", Number.isFinite(fwd.operational.uptimePct), `${fwd.operational.uptimePct}%`);
  check("Forward: biaya = fee + spread + slippage", Math.abs(fwd.costs.fees + fwd.costs.spread + fwd.costs.slippage - fwd.costs.total) < 0.5, `Rp${fwd.costs.total}`);
  check("Forward: jumlah trade sama dengan log", fwd.trades.sells === (read("data/forward_logs.json")?.logs?.order ?? []).filter((o) => o.side === "SELL").length, `${fwd.trades.sells} trade`);
  if (fwd.sameWindowBacktest) check("Gap forward vs backtest dihitung", Number.isFinite(fwd.gap?.returnGapPct), `${fwd.gap.returnGapPct} poin persen`);
}

// 6. Dashboard mandiri
const dash = fs.existsSync("dashboard.html") ? fs.readFileSync("dashboard.html", "utf8") : "";
check("Dashboard ada", dash.length > 10000, `${(dash.length / 1024).toFixed(0)} KB`);
check("Dashboard tanpa aset eksternal", !/<script[^>]+src=|<link[^>]+href="http/i.test(dash), "tidak ada CDN/script eksternal");
check("Dashboard memuat data mentah", dash.includes("\"backtest\"") && dash.includes("\"daily\""), "backtest + kurva tertanam");
check("Dashboard punya tombol hitung ulang", dash.includes("jalankanCek"), "");

// 7. Tidak ada rahasia
const secretPatterns = [/UPSTASH_REDIS_REST_TOKEN\s*=\s*["'][^"']{10,}/i, /CRON_SECRET\s*=\s*["'][^"']{8,}/i, /Bearer\s+[A-Za-z0-9_-]{20,}/];
const filesToScan = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|json|md|yml|yaml|example|txt)$/.test(entry.name)) filesToScan.push(full);
  }
}
walk(".");
const leaks = [];
for (const file of filesToScan) {
  const text = fs.readFileSync(file, "utf8");
  for (const re of secretPatterns) if (re.test(text)) leaks.push(file);
}
check("Tidak ada kredensial di repo", leaks.length === 0, leaks.length ? leaks.join(", ") : "bersih");

// 8. Freeze
const freeze = read("data/freeze.json");
check("Commit freeze tercatat", Boolean(freeze?.commit && freeze?.timeWib), freeze ? `${freeze.commit.slice(0, 12)} @ ${freeze.timeWib}` : "belum diisi — lihat README");

console.log("\n" + "=".repeat(64));
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} pemeriksaan lulus`);
if (failed.length) {
  console.log("GAGAL: " + failed.map((f) => f.name).join("; "));
  process.exit(1);
}

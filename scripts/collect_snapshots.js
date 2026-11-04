// scripts/collect_snapshots.js
// Mengambil snapshot order book sungguhan untuk mengukur spread dan slippage.
// Angka ini dipakai backtest sebagai model biaya (bukan asumsi karangan).

import fs from "node:fs";
import { depth } from "../lib/indodax.js";
import { normalizeBook } from "../lib/execution.js";
import { median } from "../lib/indicators.js";
import { sleep } from "../lib/http.js";

const SHOTS = 20;            // snapshot per pair
const GAP_MS = 1200;         // jarak antar snapshot
const SIZES = [1_000_000, 5_000_000, 10_000_000, 25_000_000]; // IDR

function loadUniverse() {
  const file = "data/universe.json";
  if (!fs.existsSync(file)) throw new Error("Jalankan dulu: npm run select-universe");
  return JSON.parse(fs.readFileSync(file, "utf8")).universe;
}

/** Telusuri book untuk membeli `budgetIdr`; kembalikan avg price & slippage vs mid. */
function walkBuy(book, budgetIdr) {
  let remaining = budgetIdr;
  let qty = 0;
  let notional = 0;
  let levels = 0;
  for (const [price, available] of book.asks) {
    if (remaining <= 1e-9) break;
    if (!(price > 0) || !(available > 0)) continue;
    const take = Math.min(available, remaining / price);
    qty += take;
    notional += take * price;
    remaining -= take * price;
    levels += 1;
  }
  return { filled: remaining <= 1e-6, avg: qty > 0 ? notional / qty : 0, levels, notional };
}

function walkSell(book, qty) {
  let remaining = qty;
  let sold = 0;
  let notional = 0;
  let levels = 0;
  for (const [price, available] of book.bids) {
    if (remaining <= 1e-12) break;
    if (!(price > 0) || !(available > 0)) continue;
    const take = Math.min(available, remaining);
    sold += take;
    notional += take * price;
    remaining -= take;
    levels += 1;
  }
  return { filled: remaining <= 1e-12, avg: sold > 0 ? notional / sold : 0, levels, notional, sold };
}

async function main() {
  const universe = loadUniverse();
  fs.mkdirSync("data/snapshots", { recursive: true });
  const summary = {};

  for (const pair of universe) {
    const rows = [];
    for (let i = 0; i < SHOTS; i += 1) {
      try {
        const raw = await depth(pair.id);
        const book = normalizeBook(raw);
        const bid = book.bids[0]?.[0] ?? 0;
        const ask = book.asks[0]?.[0] ?? 0;
        if (!(bid > 0) || !(ask > 0)) throw new Error("book kosong");
        const mid = (bid + ask) / 2;
        const spreadPct = ((ask - bid) / mid) * 100;
        const buy = {};
        for (const size of SIZES) {
          const r = walkBuy(book, size);
          buy[size] = r.filled ? ((r.avg - mid) / mid) * 100 : null;
        }
        const sellQty = 10_000_000 / mid;
        const s = walkSell(book, sellQty);
        const sellSlipPct = s.filled ? ((mid - s.avg) / mid) * 100 : null;
        rows.push({ t: Math.floor(Date.now() / 1000), bid, ask, spreadPct, mid, buySlipPct: buy, sellSlipPct, askLevels: book.asks.length, bidLevels: book.bids.length });
      } catch (error) {
        rows.push({ t: Math.floor(Date.now() / 1000), error: String(error.message ?? error) });
      }
      if (i < SHOTS - 1) await sleep(GAP_MS);
    }

    const good = rows.filter((r) => !r.error);
    const med = (arr) => median(arr.filter((v) => Number.isFinite(v)));
    const perSize = {};
    for (const size of SIZES) perSize[size] = med(good.map((r) => r.buySlipPct[size]));

    summary[pair.symbol] = {
      snapshots: rows.length,
      valid: good.length,
      medianSpreadPct: med(good.map((r) => r.spreadPct)),
      medianBuySlipPct: perSize,
      medianSellSlipPct: med(good.map((r) => r.sellSlipPct)),
      medianAskLevels: med(good.map((r) => r.askLevels)),
      medianBidLevels: med(good.map((r) => r.bidLevels)),
    };

    fs.writeFileSync(`data/snapshots/${pair.symbol}.json`, JSON.stringify({ pair: pair.symbol, collectedAt: new Date().toISOString(), sizes: SIZES, rows }, null, 2), "utf8");
    const s = summary[pair.symbol];
    console.log(`${pair.symbol.padEnd(10)} spread ${(s.medianSpreadPct ?? 0).toFixed(4)}% | slip beli 10jt ${(s.medianBuySlipPct[10_000_000] ?? 0).toFixed(4)}% | jual ${(s.medianSellSlipPct ?? 0).toFixed(4)}%`);
  }

  fs.writeFileSync("data/snapshot_summary.json", JSON.stringify({ collectedAt: new Date().toISOString(), shotsPerPair: SHOTS, sizes: SIZES, summary }, null, 2), "utf8");
  console.log("\nDitulis: data/snapshot_summary.json");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

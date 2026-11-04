// lib/execution.js — simulasi fill memakai order book sungguhan.
// Beli menelusuri ask, jual menelusuri bid. Tidak pernah memakai mid/close.

import { PARAMS } from "./strategy.js";

export function spreadPct(book) {
  const bid = Number(book?.buy?.[0]?.[0] ?? book?.bids?.[0]?.[0]);
  const ask = Number(book?.sell?.[0]?.[0] ?? book?.asks?.[0]?.[0]);
  if (!(bid > 0) || !(ask > 0)) return null;
  return ((ask - bid) / ((ask + bid) / 2)) * 100;
}

/** Normalisasi depth Indodax: buy = bid (turun), sell = ask (naik). */
export function normalizeBook(raw) {
  return {
    bids: (raw?.buy ?? raw?.bids ?? []).map((l) => [Number(l[0]), Number(l[1])]),
    asks: (raw?.sell ?? raw?.asks ?? []).map((l) => [Number(l[0]), Number(l[1])]),
  };
}

export function roundDown(value, increment) {
  if (!(increment > 0)) return value;
  const decimals = Math.max(0, (String(increment).split(".")[1] ?? "").length);
  const steps = Math.floor(value / increment + 1e-9);
  return Number((steps * increment).toFixed(decimals));
}

/**
 * Beli dengan anggaran IDR tertentu, menelusuri ask.
 * @returns {{qty:number, notional:number, avgPrice:number, levels:number, filled:boolean}}
 */
export function buyAtAsk(book, budgetIdr, quantityIncrement) {
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
  const avgRaw = qty > 0 ? notional / qty : 0;
  const rounded = roundDown(qty, quantityIncrement);
  if (!(rounded > 0)) return { qty: 0, notional: 0, avgPrice: 0, levels: 0, filled: false };
  return {
    qty: rounded,
    notional: rounded * avgRaw,
    avgPrice: avgRaw,
    levels,
    filled: true,
  };
}

/**
 * Jual seluruh kuantitas menelusuri bid.
 * @returns {{qty:number, notional:number, avgPrice:number, levels:number, filled:boolean}}
 */
export function sellAtBid(book, quantity) {
  let remaining = quantity;
  let sold = 0;
  let notional = 0;
  let levels = 0;
  for (const [price, available] of book.bids) {
    if (remaining <= 0) break;
    const take = Math.min(available, remaining);
    sold += take;
    notional += take * price;
    remaining -= take;
    levels += 1;
  }
  if (sold <= 0) return { qty: 0, notional: 0, avgPrice: 0, levels: 0, filled: false };
  return { qty: sold, notional, avgPrice: notional / sold, levels, filled: true };
}

export function feeFor(notional, params = PARAMS) {
  return (notional * params.takerFeePct) / 100;
}

export function meetsMinOrder(notional, params = PARAMS) {
  return notional >= params.minOrderIdr;
}

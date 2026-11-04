// lib/risk.js — batas risiko wajib (soal UAS halaman 3).

import { PARAMS } from "./strategy.js";

/** Batas hari WIB (UTC+7). Berganti pukul 00.00 WIB = 17.00 UTC. */
export function dayKeyWIB(unixSec) {
  return new Date((unixSec + 7 * 3600) * 1000).toISOString().slice(0, 10);
}

export function emptyDayState(unixSec, equity) {
  return { key: dayKeyWIB(unixSec), startEquity: equity, equityAtClose: null };
}

/**
 * Pastikan state harian sesuai tanggal WIB. Equity awal hari diambil pada
 * panggilan pertama setelah 00.00 WIB.
 */
export function rollDay(state, unixSec, equity) {
  const key = dayKeyWIB(unixSec);
  if (!state.day || state.day.key !== key) {
    const previous = state.day ?? null;
    state.day = emptyDayState(unixSec, equity);
    state.day.previous = previous;
  }
  return state.day;
}

export function dailyLossPct(state, equity) {
  const start = state.day?.startEquity;
  if (!(start > 0)) return 0;
  return ((equity - start) / start) * 100;
}

/**
 * Keputusan boleh-tidaknya membuka posisi baru.
 * @returns {{allowed:boolean, reason:string, lossPct:number}}
 */
export function canOpenPosition(state, equity, params = PARAMS) {
  const lossPct = dailyLossPct(state, equity);
  if (state.killSwitch) {
    return { allowed: false, reason: "kill switch aktif", lossPct };
  }
  if (lossPct <= -Math.abs(params.dailyLossLimitPct)) {
    return {
      allowed: false,
      reason: `daily loss limit ${params.dailyLossLimitPct}% terlampaui (${lossPct.toFixed(2)}%)`,
      lossPct,
    };
  }
  if (Object.keys(state.positions ?? {}).length >= params.maxPositions) {
    return { allowed: false, reason: `slot penuh (${params.maxPositions})`, lossPct };
  }
  return { allowed: true, reason: "ok", lossPct };
}

/** Equity: kas + posisi dinilai pada best bid (nilai jika dijual sekarang). */
export function equityAtBid(state, bestBids) {
  let total = state.cashIdr ?? 0;
  for (const [pair, pos] of Object.entries(state.positions ?? {})) {
    const bid = bestBids[pair];
    if (!(bid > 0)) {
      total += (pos.qty ?? 0) * (pos.lastBid ?? pos.entryPrice ?? 0);
    } else {
      total += (pos.qty ?? 0) * bid;
    }
  }
  return total;
}

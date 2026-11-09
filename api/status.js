// api/status.js — ringkasan bot dry run untuk panel dashboard yang dilindungi kunci.
// Dilindungi CRON_SECRET (Bearer or ?secret=). Tanpa kunci yang benar -> 401.
// Berbeda dari api/market.js: DI SINI ada state virtual bot (kas, posisi, order).
// Hanya status terkini — bukan data mentah utk rekap; data mentah tetap di /api/export.

import fs from "node:fs";
import path from "node:path";
import { PARAMS } from "../lib/strategy.js";
import { getState, getKillSwitch, readLogs } from "../lib/store.js";

export const maxDuration = 60;

function loadUniverse() {
  const file = path.join(process.cwd(), "data", "freeze.json");
  let universe = null;
  try {
    universe = JSON.parse(fs.readFileSync(file, "utf8")).forward?.universe ?? null;
  } catch {}
  if (!Array.isArray(universe) || universe.length === 0) {
    const u = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "universe.json"), "utf8")).universe;
    universe = u.map((p) => p.symbol);
  }
  return universe;
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = typeof req.query?.secret === "string" ? req.query.secret : "";
  return bearer === secret || query === secret;
}

const WIB_OFFSET_MS = 7 * 3600 * 1000;
function wibFromUnix(unixSec) {
  if (!unixSec) return null;
  return new Date(unixSec * 1000 + WIB_OFFSET_MS).toISOString().replace("Z", "") + " WIB";
}

// Window forward sesuai soal: 4 Nov 2026 12:00 WIB -> 14 Nov 2026 12:00 WIB.
const FWD_START_UNIX = Date.UTC(2026, 10, 4, 5, 0, 0) / 1000; // 12:00 WIB
const FWD_END_UNIX = Date.UTC(2026, 10, 14, 5, 0, 0) / 1000;

function forwardMeta(firstTickUnix, lastTickUnix) {
  const nowSec = Date.now() / 1000;
  const started = firstTickUnix ?? null;
  return {
    windowStartUnix: FWD_START_UNIX,
    windowEndUnix: FWD_END_UNIX,
    windowStartWib: wibFromUnix(FWD_START_UNIX),
    windowEndWib: wibFromUnix(FWD_END_UNIX),
    activeNow: nowSec >= FWD_START_UNIX && nowSec <= FWD_END_UNIX,
    remainingHours: nowSec < FWD_END_UNIX ? Math.max(0, Math.round((FWD_END_UNIX - nowSec) / 3600)) : 0,
    firstTickUnix: started,
    firstTickWib: wibFromUnix(started),
    lastTickWib: wibFromUnix(lastTickUnix),
    startedLate: Boolean(started && started > FWD_START_UNIX),
    minutesLate: started > FWD_START_UNIX ? Math.round((started - FWD_START_UNIX) / 60) : 0,
    coverageHours: started ? Math.max(0, (Math.min(nowSec, FWD_END_UNIX) - Math.max(started, FWD_START_UNIX)) / 3600) : 0,
    fullWindowHours: (FWD_END_UNIX - FWD_START_UNIX) / 3600,
    note:
      started
        ? started > FWD_START_UNIX
          ? "Uji forward dimulai terlambat dari jendela; dihitung apa adanya, tanpa angka karangan."
          : "Uji forward berjalan dalam jendela soal."
        : "Uji forward BELUM berjalan (menunggu storage persisten/kredensial). Panel harus menampakkan status ini apa adanya.",
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!process.env.CRON_SECRET) {
    res.status(500).json({ ok: false, error: "CRON_SECRET belum diset di environment" });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  try {
    const persisted = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
    if (!persisted && process.env.VERCEL) {
      res.status(503).json({
        ok: false,
        error: "Storage persisten (UPSTASH_REDIS_REST_URL/TOKEN) belum diset — bot belum bisa menyimpan state.",
      });
      return;
    }

    const [state, killSwitch, tickLogs, orderLogs, errorLogs, equityLogs] = await Promise.all([
      getState(),
      getKillSwitch(),
      readLogs("tick"),
      readLogs("order"),
      readLogs("error"),
      readLogs("equity"),
    ]);

    const lastEquity = equityLogs[equityLogs.length - 1] ?? null;
    const positions = Object.entries(state?.positions ?? {}).map(([pair, p]) => {
      const mark = lastEquity?.prices?.[pair] ?? null;
      const markValue = mark != null ? p.qty * mark : null;
      return {
        pair,
        qty: p.qty,
        entryPrice: p.entryPrice,
        entryNotional: p.entryNotional,
        entryFee: p.entryFee ?? null,
        openedCandle: p.openedCandle,
        openedAtWib: p.openedAt ? wibFromUnix(Math.round(new Date(p.openedAt).getTime() / 1000)) : null,
        markPrice: mark,
        markValue,
        unrealizedPct: markValue != null ? ((markValue - p.entryNotional) / p.entryNotional) * 100 : null,
      };
    });

    const closed = orderLogs.filter((o) => typeof o.netPnl === "number");
    const totalNet = closed.reduce((s, o) => s + o.netPnl, 0);
    const wins = closed.filter((o) => o.netPnl > 0).length;

    const lastTickUnix = state?.lastTickAt ? Math.round(new Date(state.lastTickAt).getTime() / 1000) : null;
    const forward = forwardMeta(state?.firstTickUnix ?? null, lastTickUnix);
    res.status(200).json({
      ok: true,
      dryRun: true,
      stored: "Upstash Redis (REST) — persistent",
      strategy: { version: PARAMS.version, note: "Strategi tidak diubah; hanya penambahan tampilan/status." },
      universe: loadUniverse(),
      forward,
      state: {
        startedAt: state?.startedAt ?? null,
        exactCashIdr: state?.cashIdr ?? null,
        tickCount: state?.tickCount ?? 0,
        lastTickAt: state?.lastTickAt ?? null,
        live: {
          cashIdr: lastEquity?.cashIdr ?? state?.cashIdr ?? null,
          equityIdr: lastEquity?.equity ?? null,
          openPositions: positions,
          openPairCount: positions.length,
          dayKey: lastEquity?.dayKey ?? null,
          dayLossPct: lastEquity?.dayLossPct ?? null,
        },
      },
      killSwitch: { on: Boolean(killSwitch), onState: Boolean(state?.killSwitch) },
      stats: {
        closedTrades: closed.length,
        winRatePct: closed.length ? (wins / closed.length) * 100 : null,
        netPnlIdr: totalNet,
      },
      logs: {
        ticks: tickLogs.length,
        orders: orderLogs.length,
        errors: errorLogs.length,
        lastOrders: orderLogs.slice(-5).reverse(),
        lastErrors: errorLogs.slice(-5).reverse(),
      },
      operational: { apiErrorsTotal: state?.apiErrors ?? 0, killSwitchUsed: Boolean(state?.killSwitch) || killSwitch },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error.message ?? error) });
  }
}

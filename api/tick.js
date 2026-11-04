// api/tick.js — satu-satunya endpoint bot di Vercel.
// Dipanggil penjadwal eksternal (GitHub Actions) setiap jam pada menit ke-7.
// Dilindungi CRON_SECRET; tanpa secret yang benar tidak ada yang dijalankan.

import fs from "node:fs";
import path from "node:path";
import { runTick } from "../lib/tick.js";
import { PARAMS } from "../lib/strategy.js";
import { getState } from "../lib/store.js";

export const maxDuration = 300;

function loadUniverse() {
  const file = path.join(process.cwd(), "data", "universe.json");
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw).universe;
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = typeof req.query?.secret === "string" ? req.query.secret : "";
  return bearer === secret || query === secret;
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!process.env.CRON_SECRET) {
    res.status(500).json({ error: "CRON_SECRET belum diset di environment Vercel" });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!process.env.UPSTASH_REDIS_REST_URL && process.env.VERCEL) {
    res.status(500).json({ error: "UPSTASH_REDIS_REST_URL/TOKEN wajib diisi di Vercel (state tidak boleh di filesystem)" });
    return;
  }

  const started = Date.now();
  try {
    const universe = loadUniverse();
    const result = await runTick({
      universe,
      capitalIdr: Number(process.env.CAPITAL_IDR ?? 100_000_000),
      params: PARAMS,
    });
    const state = await getState();
    res.status(200).json({
      ok: true,
      nowSec: result.nowSec,
      serverTimeWib: new Date(result.nowSec * 1000 + 7 * 3600 * 1000).toISOString().replace("Z", "+07:00"),
      equity: result.equity,
      cashIdr: state?.cashIdr ?? null,
      positions: state ? Object.keys(state.positions ?? {}) : [],
      orders: result.orders,
      evaluated: result.evaluated,
      skipped: result.skipped.length,
      elapsedMs: Date.now() - started,
      strategy: PARAMS.version,
      dryRun: true,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: String(error.message ?? error),
      elapsedMs: Date.now() - started,
    });
  }
}

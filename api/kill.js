// api/kill.js — kill switch manual tanpa deploy ulang.
// POST { on: true|false, note: "..." } dengan header Authorization: Bearer <CRON_SECRET>
// GET mengembalikan status. Setiap perubahan tercatat di log "error" (tipe kill_switch).

import { getKillSwitch, getState, setKillSwitch } from "../lib/store.js";

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = typeof req.query?.secret === "string" ? req.query.secret : "";
  return bearer === secret || query === secret;
}

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET) {
    res.status(500).json({ error: "CRON_SECRET belum diset" });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  if (req.method === "GET") {
    const state = await getState();
    res.status(200).json({
      killSwitch: await getKillSwitch(),
      positions: state ? Object.keys(state.positions ?? {}) : [],
      cashIdr: state?.cashIdr ?? null,
      tickCount: state?.tickCount ?? 0,
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  const on = Boolean(body.on);
  const note = String(body.note ?? "").slice(0, 200);
  const entry = await setKillSwitch(on, note);
  res.status(200).json({ ok: true, killSwitch: entry.on, note: entry.note, at: entry.at });
}

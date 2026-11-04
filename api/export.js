// api/export.js — mengunduh SELURUH log mentah + state sebagai satu JSON.
// Ini yang dijadikan lampiran "log mentah" pada paket UAS.
// GET /api/export?secret=<CRON_SECRET>

import { allLogs, getKillSwitch, getState } from "../lib/store.js";

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
  const [state, logs, killSwitch] = await Promise.all([getState(), allLogs(), getKillSwitch()]);
  res.setHeader("content-disposition", `attachment; filename="forward_logs_${new Date().toISOString().slice(0, 10)}.json"`);
  res.status(200).json({
    exportedAt: new Date().toISOString(),
    killSwitch,
    state,
    logs,
    counts: Object.fromEntries(Object.entries(logs).map(([k, v]) => [k, v.length])),
  });
}

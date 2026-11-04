// lib/store.js — state & log persisten.
// Produksi: Upstash Redis REST (gratis). Lokal: file JSON di data/local-store.json.
// Tidak ada kredensial di repo; hanya environment variable.

import fs from "node:fs";
import path from "node:path";

const KEY_STATE = "bot:state";
const LOG_TYPES = ["tick", "order", "equity", "error", "snapshot", "signal"];

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const LOCAL_FILE = process.env.LOCAL_STORE_FILE || path.join("data", "local-store.json");

function useRedis() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

async function redis(command, ...args) {
  const res = await fetch(`${REDIS_URL}/${[command, ...args].map(encodeURIComponent).join("/")}`, {
    headers: { authorization: `Bearer ${REDIS_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(`Redis: ${data.error ?? res.status}`);
  return data.result;
}

function readLocal() {
  if (!fs.existsSync(LOCAL_FILE)) {
    return { state: null, logs: Object.fromEntries(LOG_TYPES.map((t) => [t, []])) };
  }
  return JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
}

function writeLocal(db) {
  fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(db, null, 2), "utf8");
}

export async function getState() {
  if (useRedis()) {
    const raw = await redis("get", KEY_STATE);
    return raw ? JSON.parse(raw) : null;
  }
  return readLocal().state;
}

export async function setState(state) {
  if (useRedis()) {
    await redis("set", KEY_STATE, JSON.stringify(state));
    return;
  }
  const db = readLocal();
  db.state = state;
  writeLocal(db);
}

export async function appendLog(type, entry) {
  if (!LOG_TYPES.includes(type)) throw new Error(`Tipe log tidak dikenal: ${type}`);
  const row = { ...entry, loggedAt: new Date().toISOString() };
  if (useRedis()) {
    await redis("rpush", `log:${type}`, JSON.stringify(row));
    return row;
  }
  const db = readLocal();
  db.logs[type] ??= [];
  db.logs[type].push(row);
  writeLocal(db);
  return row;
}

export async function readLogs(type) {
  if (useRedis()) {
    const rows = (await redis("lrange", `log:${type}`, "0", "-1")) ?? [];
    return rows.map((r) => JSON.parse(r));
  }
  return readLocal().logs[type] ?? [];
}

export async function allLogs() {
  const out = {};
  for (const type of LOG_TYPES) out[type] = await readLogs(type);
  return out;
}

/** Kill switch dapat dinyalakan tanpa deploy ulang (Redis key / endpoint /api/kill). */
export async function setKillSwitch(on, note = "") {
  const entry = { on: Boolean(on), note, at: new Date().toISOString() };
  if (useRedis()) {
    await redis("set", "bot:killswitch", on ? "1" : "0");
  } else {
    const db = readLocal();
    db.killSwitch = entry;
    writeLocal(db);
  }
  await appendLog("error", { type: "kill_switch", ...entry });
  return entry;
}

export async function getKillSwitch() {
  if (useRedis()) return (await redis("get", "bot:killswitch")) === "1";
  return Boolean(readLocal().killSwitch?.on);
}

// lib/http.js — fetch dengan timeout, retry terbatas, dan rate limit global.
// Batas Indodax: 180 request/menit. Kita pakai <= 3 request/detik dan tidak paralel.

const MIN_GAP_MS = 350;
let lastCall = 0;

export class HttpError extends Error {
  constructor(message, { status = 0, url = "", body = "" } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastCall + MIN_GAP_MS - now);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

/**
 * GET JSON dengan retry eksponensial (maks 3 percobaan).
 * @param {string} url
 * @param {{timeoutMs?:number, retries?:number, label?:string}} opts
 */
export async function getJson(url, opts = {}) {
  const { timeoutMs = 12000, retries = 3, label = "GET" } = opts;
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    await throttle();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": "indodax-dryrun-uas/1.0" },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new HttpError(`${label} HTTP ${res.status}`, {
          status: res.status, url, body: text.slice(0, 300),
        });
      }
      if (!text || !text.trim()) {
        throw new HttpError(`${label} respons kosong`, { status: res.status, url });
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new HttpError(`${label} bukan JSON`, { status: res.status, url, body: text.slice(0, 300) });
      }
      return json;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(400 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

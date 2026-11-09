process.env.CRON_SECRET ||= "testkey123";
process.env.LOCAL_STORE_FILE ||= "data/test-store.json";

const mkt = await import("../api/market.js");
const st = await import("../api/status.js");
function fakeRes() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; return this; } };
}

const r1 = fakeRes();
await mkt.default({ method: "GET", query: {} }, r1);
console.log("MARKET status:", r1.statusCode, "cached:", r1.body.cached ?? false);
console.log(JSON.stringify(r1.body.pairs?.map(p => ({ pair: p.pair, last: p.last, bid: p.bid, ask: p.ask, spread: p.spreadPct, ch24: p.change24hPct, volIDR: p.volumeQuote, issues: p.issues })), null, 1));

const r2 = fakeRes();
await st.default({ method: "GET", query: { secret: "WRONG" }, headers: {} }, r2);
console.log("STATUS wrong key ->", r2.statusCode, r2.body?.error);

const r3 = fakeRes();
await st.default({ method: "GET", query: { secret: "testkey123" }, headers: {} }, r3);
console.log("STATUS right key ->", r3.statusCode);
console.log(JSON.stringify(r3.body, null, 1).slice(0, 1600));

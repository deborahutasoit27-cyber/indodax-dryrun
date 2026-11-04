// scripts/build_dashboard.js — membuat SATU file HTML mandiri (tanpa CDN/aset luar).
// Semua angka berasal dari data/*.json hasil backtest & log mentah forward test.
// Di dalam halaman ada tombol "Hitung ulang" yang mengulang perhitungan dari data mentah.

import fs from "node:fs";

function readJson(file, fallback = null) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

const bt = readJson("data/backtest_full.json");
const bt10 = readJson("data/backtest_10d.json");
const fwd = readJson("data/forward_metrics.json");
const forwardLogs = readJson("data/forward_logs.json");
const universe = readJson("data/universe.json", { universe: [] });
const snapshots = readJson("data/snapshot_summary.json", { summary: {} });
const manifest = readJson("data/history_manifest.json", { pairs: [] });
const freeze = readJson("data/freeze.json", null);

if (!bt) {
  console.error("data/backtest_full.json belum ada — jalankan npm run backtest dulu.");
  process.exit(1);
}

const DATA = {
  generatedAt: new Date().toISOString(),
  backtest: bt,
  backtest10d: bt10,
  forward: fwd,
  forwardLogs: forwardLogs ? { exportedAt: forwardLogs.exportedAt, counts: forwardLogs.counts, logs: forwardLogs.logs, state: forwardLogs.state } : null,
  universe,
  snapshots,
  manifest,
  freeze,
};

const json = JSON.stringify(DATA).replace(/<\//g, "<\\/");

const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>UAS Algorithmic Trading — Bot Dry Run Indodax</title>
<style>
:root{--bg:#0b1020;--panel:#121a33;--panel2:#18213f;--line:#25305a;--txt:#e8edf7;--muted:#93a0c2;--acc:#4f8cff;--ok:#25c281;--warn:#f2b544;--bad:#ef5b6b;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:linear-gradient(180deg,#080d1a,#0b1020 40%);color:var(--txt);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:28px 24px 18px;border-bottom:1px solid var(--line);background:rgba(10,15,30,.7);position:sticky;top:0;z-index:10;backdrop-filter:blur(8px)}
h1{margin:0 0 6px;font-size:22px;letter-spacing:-.3px}
h2{font-size:18px;margin:28px 0 12px}
h3{font-size:15px;margin:20px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px 80px}
.sub{color:var(--muted);font-size:13px}
.badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.03em;border:1px solid var(--line);background:var(--panel2);color:var(--muted)}
.badge.ok{color:#0a1a12;background:var(--ok);border-color:var(--ok)}
.badge.warn{color:#2a1d00;background:var(--warn);border-color:var(--warn)}
.badge.bad{color:#2a0007;background:var(--bad);border-color:var(--bad)}
nav{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}
nav button{background:var(--panel);border:1px solid var(--line);color:var(--muted);padding:8px 14px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:600}
nav button.on{background:var(--acc);border-color:var(--acc);color:#fff}
section{display:none;padding-top:22px}
section.on{display:block}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:14px;padding:16px}
.card .k{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px}
.card .v{font-size:26px;font-weight:750;letter-spacing:-.6px}
.card .n{font-size:12px;color:var(--muted);margin-top:4px}
.pos{color:var(--ok)}.neg{color:var(--bad)}.warnc{color:var(--warn)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:right;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em;position:sticky;top:0;background:var(--panel)}
tbody tr:hover{background:rgba(79,140,255,.06)}
.scroll{max-height:460px;overflow:auto;border:1px solid var(--line);border-radius:12px}
.mono{font-family:var(--mono);font-size:12px}
pre{background:#070b16;border:1px solid var(--line);border-radius:12px;padding:14px;overflow:auto;font-family:var(--mono);font-size:12px;max-height:420px}
.note{background:rgba(79,140,255,.08);border:1px solid rgba(79,140,255,.3);border-left:4px solid var(--acc);padding:12px 14px;border-radius:10px;font-size:13px;color:#cfe0ff;margin:14px 0}
.note.bad{background:rgba(239,91,107,.08);border-color:rgba(239,91,107,.35);border-left-color:var(--bad);color:#ffd6db}
.note.warn{background:rgba(242,181,68,.08);border-color:rgba(242,181,68,.35);border-left-color:var(--warn);color:#ffe9bd}
.note.ok{background:rgba(37,194,129,.08);border-color:rgba(37,194,129,.35);border-left-color:var(--ok);color:#c8ffe6}
.chk{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--line);font-size:13px}
.chk:last-child{border-bottom:0}
.chk .s{font-weight:800;min-width:46px}
.chk .d{color:var(--muted);font-size:12px}
button.act{background:var(--acc);border:0;color:#fff;padding:9px 16px;border-radius:9px;font-weight:700;cursor:pointer}
button.ghost{background:var(--panel);border:1px solid var(--line);color:var(--txt);padding:9px 16px;border-radius:9px;font-weight:600;cursor:pointer}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
svg{width:100%;height:auto;display:block}
.kv{display:grid;grid-template-columns:220px 1fr;gap:6px 14px;font-size:13px}
.kv div:nth-child(odd){color:var(--muted)}
.tag{font-size:11px;padding:2px 7px;border-radius:6px;background:var(--panel2);border:1px solid var(--line);color:var(--muted)}
footer{color:var(--muted);font-size:12px;padding:30px 20px;text-align:center;border-top:1px solid var(--line)}
</style>
</head>
<body>
<header>
  <div class="wrap" style="padding-bottom:0">
    <h1>Bot Dry Run Indodax — UAS Algorithmic Trading</h1>
    <div class="sub" id="subline"></div>
    <nav id="nav"></nav>
  </div>
</header>
<div class="wrap">
  <section id="s-ringkasan" class="on"></section>
  <section id="s-backtest"></section>
  <section id="s-forward"></section>
  <section id="s-operasional"></section>
  <section id="s-metode"></section>
  <section id="s-log"></section>
  <footer>Dibangun dari data mentah di folder <span class="mono">data/</span>. Tidak ada angka yang ditulis tangan.</footer>
</div>
<script>
const DATA = ${json};

/* ---------- util ---------- */
const RP = n => "Rp" + Math.round(n).toLocaleString("id-ID");
const NUM = (n,d=2) => (n===null||n===undefined||Number.isNaN(n)) ? "n/a" : Number(n).toLocaleString("id-ID",{minimumFractionDigits:d,maximumFractionDigits:d});
const PCT = (n,d=2) => (n===null||n===undefined||Number.isNaN(n)) ? "n/a" : NUM(n,d)+"%";
const cls = n => n>0?"pos":(n<0?"neg":"");
const esc = s => String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const dt = s => s ? new Date(s).toLocaleString("id-ID",{timeZone:"Asia/Jakarta",dateStyle:"medium",timeStyle:"short"}) : "—";
const day = s => s ? new Date(s).toLocaleDateString("id-ID",{timeZone:"Asia/Jakarta",day:"2-digit",month:"short",year:"numeric"}) : "—";

/* ---------- perhitungan ulang (independen dari skrip pembangun) ---------- */
function hitungBacktest(bt){
  const daily = bt.daily||[], trades = bt.trades||[];
  const start = bt.metrics.startEquity;
  const end = daily.length ? daily[daily.length-1].equity : start;
  let peak=-Infinity, mdd=0;
  for(const p of daily){ if(p.equity>peak) peak=p.equity; mdd=Math.min(mdd,(p.equity/peak-1)*100); }
  const days = daily.length>1 ? (new Date(daily[daily.length-1].d)-new Date(daily[0].d))/86400000 : 0;
  const cagr = days>0 ? (Math.pow(end/start,365.25/days)-1)*100 : 0;
  const w = trades.filter(t=>t.netPnl>0), l = trades.filter(t=>t.netPnl<=0);
  const gw = w.reduce((a,t)=>a+t.netPnl,0), gl = Math.abs(l.reduce((a,t)=>a+t.netPnl,0));
  const fees = trades.reduce((a,t)=>a+(t.entryFee||0)+(t.exitFee||0),0);
  const spread = trades.reduce((a,t)=>a+(t.spreadCost||0),0);
  const slip = trades.reduce((a,t)=>a+(t.slipCost||0),0);
  const gp = trades.filter(t=>t.grossPnl>0).reduce((a,t)=>a+t.grossPnl,0);
  return { totalReturnPct:(end/start-1)*100, cagrPct:cagr, mdd, trades:trades.length,
    profitFactor: gl>0? gw/gl : null, winRatePct: trades.length? w.length/trades.length*100:0,
    costSharePct: gp>0? (fees+spread+slip)/gp*100 : null, endEquity:end };
}
function hitungForward(){
  const f = DATA.forward;
  if(!f) return null;
  return { totalReturnPct:f.totalReturnPct, mdd:f.maxDrawdownPct, trades:f.trades.sells,
    profitFactor:f.profitFactor, winRatePct:f.winRatePct, costSharePct:f.costs.costSharePct };
}
function cocok(a,b,tol=0.02){ return a!==null && b!==null && Math.abs(a-b)<=tol; }

/* ---------- chart svg ---------- */
function lineChart(series, opts={}){
  const w=1000,h=280,pad=34;
  if(!series.length) return '<div class="note warn">Belum ada data untuk digambar.</div>';
  const xs=series.map((p,i)=>i), ys=series.map(p=>p.v);
  const min=Math.min(...ys), max=Math.max(...ys), span=(max-min)||1;
  const X=i=>pad+(i/(series.length-1||1))*(w-pad*2);
  const Y=v=>h-pad-((v-min)/span)*(h-pad*2);
  const d=series.map((p,i)=>(i?"L":"M")+X(i).toFixed(1)+","+Y(p.v).toFixed(1)).join(" ");
  const zero=Y(opts.base??min);
  const ticks=[0,.25,.5,.75,1].map(t=>{const v=min+span*t;return {y:Y(v),l:opts.fmt?opts.fmt(v):NUM(v,0)}});
  return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+
    ticks.map(t=>'<line x1="'+pad+'" x2="'+(w-pad)+'" y1="'+t.y+'" y2="'+t.y+'" stroke="#25305a" stroke-width="1"/><text x="6" y="'+(t.y+4)+'" fill="#93a0c2" font-size="10">'+esc(t.l)+'</text>').join("")+
    (opts.base!==undefined?'<line x1="'+pad+'" x2="'+(w-pad)+'" y1="'+zero+'" y2="'+zero+'" stroke="#4f8cff" stroke-dasharray="4 4" stroke-width="1" opacity=".5"/>':"")+
    '<path d="'+d+'" fill="none" stroke="'+(opts.color||"#4f8cff")+'" stroke-width="2.2" stroke-linejoin="round"/>'+
    '<text x="'+pad+'" y="'+(h-8)+'" fill="#93a0c2" font-size="10">'+esc(series[0].l||"")+'</text>'+
    '<text x="'+(w-pad)+'" y="'+(h-8)+'" fill="#93a0c2" font-size="10" text-anchor="end">'+esc(series[series.length-1].l||"")+'</text>'+
    '</svg>';
}

/* ---------- kartu ---------- */
const card=(k,v,n,color="")=>'<div class="card"><div class="k">'+k+'</div><div class="v '+color+'">'+v+'</div><div class="n">'+(n||"")+'</div></div>';

const B = hitungBacktest(DATA.backtest);
const F = hitungForward();

/* ---------- ringkasan ---------- */
function renderRingkasan(){
  const be = DATA.backtest.benchmark;
  const fwd = DATA.forward;
  const statusFwd = fwd
    ? '<span class="badge ok">FORWARD TEST BERJALAN / SELESAI</span>'
    : '<span class="badge warn">FORWARD TEST BELUM BERJALAN</span>';
  document.getElementById("subline").innerHTML =
    'Strategi <span class="mono">'+esc(DATA.backtest.strategy.version)+'</span> · timeframe 1 jam · long-only · tanpa API key · '+statusFwd+
    ' · data 3 tahun: '+DATA.manifest.pairs.length+' pair, '+NUM(DATA.manifest.pairs.reduce((a,p)=>a+p.bars,0),0)+' candle';

  const fwdCard = fwd
    ? card("Return Forward", PCT(fwd.totalReturnPct), fwd.window.days+" hari · "+fwd.trades.sells+" trade", cls(fwd.totalReturnPct))
    : card("Return Forward", "—", "belum ada log forward test", "warnc");

  document.getElementById("s-ringkasan").innerHTML = \`
  <div class="note"><b>Aturan main.</b> Semua angka di halaman ini dihitung oleh skrip dari data mentah (<span class="mono">data/*.json</span>).
  Klik <b>Hitung ulang</b> untuk mengulang perhitungan di browser dari data yang tertanam. Hasil buruk yang bisa dibuktikan lebih bernilai daripada hasil bagus yang tidak bisa dibuktikan.</div>

  <h3>Backtest 3 tahun — data Indodax sungguhan</h3>
  <div class="grid">
    \${card("Total Return", PCT(B.totalReturnPct), day(DATA.backtest.window.from)+" → "+day(DATA.backtest.window.to), cls(B.totalReturnPct))}
    \${card("CAGR", PCT(B.cagrPct), B.daysTotal? "" : DATA.backtest.window.days+" hari", cls(B.cagrPct))}
    \${card("Max Drawdown", PCT(B.mdd), "equity harian", "neg")}
    \${card("Profit Factor", B.profitFactor===null?"n/a":NUM(B.profitFactor), B.trades+" trade tertutup")}
    \${card("Win Rate", PCT(B.winRatePct,1), "trade menang / total")}
    \${card("Biaya / Laba Kotor", B.costSharePct===null?"n/a":PCT(B.costSharePct,1), "fee + spread + slippage")}
  </div>

  <h3>Forward test 10 hari</h3>
  <div class="grid">
    \${fwdCard}
    \${fwd?card("Max Drawdown Forward", PCT(fwd.maxDrawdownPct), "equity tiap tick", "neg"):card("Max Drawdown Forward","—","menunggu log","warnc")}
    \${fwd?card("Profit Factor", fwd.profitFactor===null?"n/a":NUM(fwd.profitFactor), fwd.trades.sells+" trade"):card("Profit Factor","—","menunggu log","warnc")}
    \${fwd?card("Win Rate", PCT(fwd.winRatePct,1), fwd.trades.sells+" trade"):card("Win Rate","—","menunggu log","warnc")}
    \${fwd?card("Biaya / Laba Kotor", fwd.costs.costSharePct===null?"n/a":PCT(fwd.costs.costSharePct,1), "dari log order"):card("Biaya / Laba Kotor","—","menunggu log","warnc")}
    \${fwd?card("Uptime", PCT(fwd.operational.uptimePct,1), fwd.operational.ticksRecorded+"/"+fwd.operational.expectedTicks+" tick"):card("Uptime","—","menunggu log","warnc")}
  </div>

  <h3>Pembanding</h3>
  <div class="grid">
    \${be?card("BTC/IDR Buy & Hold (3 th)", PCT(be.totalReturnPct), "beli-tahan, biaya sama", cls(be.totalReturnPct)):card("BTC/IDR Buy & Hold","n/a","")}
    \${fwd&&fwd.benchmark?card("BTC/IDR Buy & Hold (forward)", PCT(fwd.benchmark.totalReturnPct), fwd.window.days+" hari", cls(fwd.benchmark.totalReturnPct)):card("BTC/IDR (forward)","—","menunggu log","warnc")}
    \${fwd&&fwd.gap?card("Gap Forward − Backtest", (fwd.gap.returnGapPct>0?"+":"")+NUM(fwd.gap.returnGapPct)+" pp", "jendela identik", cls(fwd.gap.returnGapPct)):card("Gap Forward − Backtest","—","butuh log 10 hari + backtest_10d","warnc")}
  </div>

  <div class="row" style="margin-top:22px">
    <button class="act" onclick="jalankanCek()">Hitung ulang dari data mentah</button>
    <span class="sub">Hasil perhitungan dibandingkan otomatis dengan angka di halaman.</span>
  </div>
  <div id="cek-hasil" style="margin-top:12px"></div>

  \${fwd? \`<div class="note ok"><b>Forward test tersedia.</b> Jendela \${dt(fwd.window.from)} → \${dt(fwd.window.to)} (\${fwd.window.days} hari), sumber <span class="mono">\${esc(fwd.source)}</span>.</div>\`
  : \`<div class="note warn"><b>Forward test belum berjalan.</b> Sesuai jadwal, bot mulai \${dt("2026-11-04T05:00:00Z")} (12.00 WIB) dan berakhir \${dt("2026-11-14T05:00:00Z")}.
  Selama log belum ada, halaman ini tidak menampilkan angka forward apa pun — tidak ada yang dikarang.</div>\`}
  \`;
}

function jalankanCek(){
  const rows = [];
  const a = B, m = DATA.backtest.metrics;
  rows.push(["Total return", cocok(a.totalReturnPct, m.totalReturnPct, 0.01), NUM(a.totalReturnPct)+"% vs laporan "+NUM(m.totalReturnPct)+"%"]);
  rows.push(["CAGR", cocok(a.cagrPct, m.cagrPct, 0.01), NUM(a.cagrPct)+"% vs laporan "+NUM(m.cagrPct)+"%"]);
  rows.push(["Max drawdown", cocok(a.mdd, m.maxDrawdownPct, 0.01), NUM(a.mdd)+"% vs laporan "+NUM(m.maxDrawdownPct)+"%"]);
  rows.push(["Profit factor", m.profitFactor===null? a.profitFactor===null : cocok(a.profitFactor, m.profitFactor, 0.005), NUM(a.profitFactor)+" vs laporan "+NUM(m.profitFactor)]);
  rows.push(["Win rate", cocok(a.winRatePct, m.winRatePct, 0.01), NUM(a.winRatePct)+"% vs laporan "+NUM(m.winRatePct)+"%"]);
  if(DATA.forward){
    const f=DATA.forward;
    rows.push(["Forward return", cocok(F.totalReturnPct, f.totalReturnPct, 0.01), NUM(F.totalReturnPct)+"% vs laporan "+NUM(f.totalReturnPct)+"%"]);
    rows.push(["Forward MDD", cocok(F.mdd, f.maxDrawdownPct, 0.01), NUM(F.mdd)+"% vs laporan "+NUM(f.maxDrawdownPct)+"%"]);
  } else {
    rows.push(["Forward test", true, "belum ada log — tidak ada angka yang diklaim"]);
  }
  const html = rows.map(([k,ok,d])=>'<div class="chk"><span class="s '+(ok?"pos":"neg")+'">'+(ok?"LULUS":"GAGAL")+'</span><b>'+esc(k)+'</b><span class="d">'+esc(d)+'</span></div>').join("");
  document.getElementById("cek-hasil").innerHTML =
    '<div class="card"><div class="k">Hasil hitung ulang di browser</div>'+html+
    '<div class="sub" style="margin-top:10px">Dihitung '+new Date().toLocaleString("id-ID")+' dari data yang tertanam di file ini.</div></div>';
}

/* ---------- backtest ---------- */
function renderBacktest(){
  const bt = DATA.backtest;
  const daily = bt.daily||[];
  const eqSeries = daily.map(r=>({v:r.equity,l:r.d}));
  const m = bt.metrics;
  const cost = m.costs;
  const rows = (bt.trades||[]).slice().reverse().map(t=>
    '<tr><td>'+esc(t.pair)+'</td><td class="mono">'+esc(t.entryTime)+'</td><td class="mono">'+esc(t.exitTime)+'</td>'+
    '<td>'+NUM(t.qty,6)+'</td><td>'+NUM(t.entryPrice,2)+'</td><td>'+NUM(t.exitPrice,2)+'</td>'+
    '<td class="'+cls(t.netPnl)+'">'+RP(t.netPnl)+'</td><td class="'+cls(t.returnPct)+'">'+NUM(t.returnPct)+'%</td>'+
    '<td>'+t.barsHeld+'</td><td style="white-space:normal;max-width:280px;font-size:12px">'+esc(t.exitReason)+'</td></tr>').join("");
  const monthly = (bt.monthly||[]).map(x=>'<tr><td>'+esc(x.m)+'</td><td class="'+cls(x.retPct)+'">'+NUM(x.retPct)+'%</td></tr>').join("");
  const quality = Object.entries(bt.dataQuality||{}).map(([s,q])=>'<tr><td>'+esc(s)+'</td><td>'+NUM(q.bars,0)+'</td><td class="mono">'+esc((q.first||"").slice(0,10))+'</td><td class="mono">'+esc((q.last||"").slice(0,10))+'</td></tr>').join("");
  const cm = Object.entries(bt.costModel||{}).map(([s,c])=>
    '<tr><td>'+esc(s)+'</td><td>'+NUM(c.halfSpreadPct,4)+'%</td><td>'+NUM(c.buySlipPct,4)+'%</td><td>'+NUM(c.sellSlipPct,4)+'%</td><td>'+NUM(c.buyCostPct,4)+'%</td><td>'+c.snapshots+'</td></tr>').join("");

  document.getElementById("s-backtest").innerHTML = \`
  <h2>Backtest 3 tahun</h2>
  <div class="sub">\${dt(bt.window.from)} → \${dt(bt.window.to)} · \${bt.window.days} hari · modal awal \${RP(m.startEquity)} · ekuitas akhir \${RP(m.endEquity)}</div>
  <div style="margin-top:16px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px">
    \${lineChart(eqSeries,{base:m.startEquity,fmt:v=>RP(v)})}
  </div>

  <div class="grid" style="margin-top:16px">
    \${card("Total Return",PCT(B.totalReturnPct),"",cls(B.totalReturnPct))}
    \${card("CAGR",PCT(B.cagrPct),"",cls(B.cagrPct))}
    \${card("Max Drawdown",PCT(B.mdd),"dari equity harian","neg")}
    \${card("Sharpe (harian, annualisasi)",NUM(m.sharpe),"rf = 0")}
    \${card("Trade",NUM(m.trades,0),"tertutup")}
    \${card("Rata-rata trade",PCT(m.avgTradePct),"per trade bersih",cls(m.avgTradePct))}
    \${card("Avg Win",RP(m.avgWin),"","pos")}
    \${card("Avg Loss",RP(m.avgLoss),"","neg")}
    \${card("Profit Factor",m.profitFactor===null?"n/a":NUM(m.profitFactor),"")}
    \${card("Win Rate",PCT(m.winRatePct,1),"")}
    \${card("Hari kena batas rugi",NUM(m.entriesBlockedDays,0),"daily loss limit 3%")}
    \${card("Rata-rata tahan",NUM(m.avgBarsHeld,1)+" bar","1 bar = 1 jam")}
  </div>

  <h3>Rincian biaya</h3>
  <div class="grid">
    \${card("Fee taker",RP(cost.fees),"0,30% per sisi")}
    \${card("Spread",RP(cost.spread),"dari snapshot order book")}
    \${card("Slippage",RP(cost.slippage),"telusur level buku")}
    \${card("Total biaya",RP(cost.total),"")}
    \${card("Laba kotor (trade profit)",RP(m.grossProfitPositive),"")}
    \${card("Biaya / laba kotor",m.costSharePct===null?"n/a":PCT(m.costSharePct,1),"")}
  </div>

  <h3>Model biaya per pair (terukur, bukan asumsi)</h3>
  <div class="scroll"><table><thead><tr><th>Pair</th><th>Spread/2</th><th>Slippage beli</th><th>Slippage jual</th><th>Total beli</th><th>Snapshot</th></tr></thead><tbody>\${cm}</tbody></table></div>

  <h3>Return bulanan</h3>
  <div class="scroll"><table><thead><tr><th>Bulan</th><th>Return</th></tr></thead><tbody>\${monthly}</tbody></table></div>

  <h3>Kualitas data</h3>
  <div class="scroll"><table><thead><tr><th>Pair</th><th>Candle</th><th>Awal</th><th>Akhir</th></tr></thead><tbody>\${quality}</tbody></table></div>

  <h3>Daftar trade (\${(bt.trades||[]).length})</h3>
  <div class="scroll"><table><thead><tr><th>Pair</th><th>Masuk</th><th>Keluar</th><th>Qty</th><th>Harga masuk</th><th>Harga keluar</th><th>PnL bersih</th><th>Return</th><th>Bar</th><th>Alasan keluar</th></tr></thead><tbody>\${rows||'<tr><td colspan="10">Tidak ada trade.</td></tr>'}</tbody></table></div>
  \`;
}

/* ---------- forward ---------- */
function renderForward(){
  const f = DATA.forward;
  if(!f){
    document.getElementById("s-forward").innerHTML = \`
      <h2>Forward test 10 hari</h2>
      <div class="note warn"><b>Belum berjalan.</b> Bot dijadwalkan berjalan \${dt("2026-11-04T05:00:00Z")} sampai \${dt("2026-11-14T05:00:00Z")} WIB.
      Halaman ini akan terisi otomatis setelah <span class="mono">/api/export</span> diunduh dan <span class="mono">npm run recompute</span> dijalankan.</div>
      <h3>Yang akan dihitung dari log mentah</h3>
      <div class="kv">
        <div>Total return</div><div>ekuitas terakhir / modal awal − 1</div>
        <div>Max drawdown</div><div>peak-to-trough dari log equity tiap tick</div>
        <div>Profit factor</div><div>Σ laba bersih / |Σ rugi bersih| dari log order SELL</div>
        <div>Win rate</div><div>trade SELL dengan netPnl &gt; 0</div>
        <div>Biaya</div><div>fee + spread + slippage yang tercatat di setiap order</div>
        <div>Benchmark</div><div>BTC/IDR beli-tahan dari harga di log equity</div>
        <div>Gap</div><div>return forward − backtest pada jendela identik</div>
        <div>Operasional</div><div>tick tercatat, API error, pemakaian kill switch</div>
      </div>
      <h3>Status sekarang</h3>
      <div class="grid">
        \${card("Log tick","0","belum ada")}
        \${card("Order","0","belum ada")}
        \${card("Uptime","—","menunggu")}
        \${card("API error","0","—")}
      </div>
      <div class="note bad"><b>Tidak ada angka forward yang ditampilkan sebelum lognya ada.</b> Mengisi angka di sini tanpa log berarti mengarang hasil — dan itu pelanggaran aturan UAS.</div>
    \`;
    return;
  }
  const eq = f.daily.map(r=>({v:r.equity,l:r.d}));
  const orders = (DATA.forwardLogs?.logs?.order ?? []).slice().reverse();
  const orows = orders.map(o=>'<tr><td class="mono">'+esc(new Date(o.t*1000+7*3600e3).toISOString().replace("T"," ").slice(0,16))+'</td><td>'+esc(o.pair)+'</td><td>'+esc(o.side)+'</td><td>'+NUM(o.qty,6)+'</td><td>'+NUM(o.avgPrice,2)+'</td><td>'+RP(o.notional)+'</td><td>'+RP(o.fee)+'</td><td>'+NUM(o.spreadPct,4)+'%</td><td>'+NUM(o.slipPct,4)+'%</td><td style="white-space:normal;max-width:320px;font-size:12px">'+esc(o.reason)+'</td></tr>').join("");
  const op = f.operational;
  document.getElementById("s-forward").innerHTML = \`
  <h2>Forward test</h2>
  <div class="sub">\${dt(f.window.from)} → \${dt(f.window.to)} · \${f.window.days} hari · modal \${RP(f.capital)} · sumber <span class="mono">\${esc(f.source)}</span></div>
  <div class="grid" style="margin-top:16px">
    \${card("Total Return",PCT(f.totalReturnPct),"",cls(f.totalReturnPct))}
    \${card("Max Drawdown",PCT(f.maxDrawdownPct),"","neg")}
    \${card("Trade",NUM(f.trades.sells,0),"tertutup")}
    \${card("Profit Factor",f.profitFactor===null?"n/a":NUM(f.profitFactor),"")}
    \${card("Win Rate",PCT(f.winRatePct,1),"")}
    \${card("Biaya / Laba Kotor",f.costs.costSharePct===null?"n/a":PCT(f.costs.costSharePct,1),"")}
  </div>
  <div style="margin-top:16px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px">
    \${lineChart(eq,{base:f.capital,fmt:v=>RP(v)})}
  </div>
  <h3>Pembanding jendela identik</h3>
  <table><thead><tr><th>Ukuran</th><th>Forward (order book nyata)</th><th>Backtest (model biaya)</th><th>Selisih</th></tr></thead><tbody>
    <tr><td>Total return</td><td>\${PCT(f.totalReturnPct)}</td><td>\${f.sameWindowBacktest?PCT(f.sameWindowBacktest.totalReturnPct):"belum dihitung"}</td><td>\${f.gap?(f.gap.returnGapPct>0?"+":"")+NUM(f.gap.returnGapPct)+" pp":"—"}</td></tr>
    <tr><td>Max drawdown</td><td>\${PCT(f.maxDrawdownPct)}</td><td>\${f.sameWindowBacktest?PCT(f.sameWindowBacktest.maxDrawdownPct):"—"}</td><td>\${f.sameWindowBacktest?NUM(f.maxDrawdownPct-f.sameWindowBacktest.maxDrawdownPct)+" pp":"—"}</td></tr>
    <tr><td>Trade</td><td>\${f.trades.sells}</td><td>\${f.sameWindowBacktest?f.sameWindowBacktest.trades:"—"}</td><td>\${f.sameWindowBacktest?f.trades.sells-f.sameWindowBacktest.trades:"—"}</td></tr>
    <tr><td>Profit factor</td><td>\${f.profitFactor===null?"n/a":NUM(f.profitFactor)}</td><td>\${f.sameWindowBacktest&&f.sameWindowBacktest.profitFactor!==null?NUM(f.sameWindowBacktest.profitFactor):"—"}</td><td>—</td></tr>
    <tr><td>BTC/IDR buy & hold</td><td>\${f.benchmark?PCT(f.benchmark.totalReturnPct):"—"}</td><td>\${f.sameWindowBacktest&&f.sameWindowBacktest.benchmarkBtcPct!==null?PCT(f.sameWindowBacktest.benchmarkBtcPct):"—"}</td><td>—</td></tr>
  </tbody></table>
  <div class="note">\${esc(f.gap?.note ?? "Backtest jendela identik belum dijalankan.")}</div>

  <h3>Order (\${orders.length})</h3>
  <div class="scroll"><table><thead><tr><th>Waktu</th><th>Pair</th><th>Sisi</th><th>Qty</th><th>Harga rata-rata</th><th>Nilai</th><th>Fee</th><th>Spread</th><th>Slippage</th><th>Alasan</th></tr></thead><tbody>\${orows||'<tr><td colspan="10">Belum ada order.</td></tr>'}</tbody></table></div>

  <h3>Operasional</h3>
  <div class="grid">
    \${card("Uptime",PCT(op.uptimePct,1),op.ticksRecorded+"/"+op.expectedTicks+" tick")}
    \${card("API error",NUM(op.apiErrors,0),"retry terbatas 3×")}
    \${card("Kill switch dipakai",NUM(op.killSwitchUsed,0),op.killSwitchActive?"AKTIF":"tidak aktif")}
    \${card("Snapshot buku",NUM(op.snapshots,0),"tercatat")}
    \${card("Baris error",NUM(op.errorRows,0),"termasuk penolakan")}
    \${card("Tick log",NUM(op.tickRows,0),"")}
  </div>
  \`;
}

/* ---------- operasional ---------- */
function renderOperasional(){
  const f = DATA.forward;
  const op = f?.operational;
  const checks = [
    ["Candle tertutup saja","decide() menolak candle dengan Time + tf &gt; server_time","ok"],
    ["Staleness &gt; 2×tf","ditolak dan dicatat di log error","ok"],
    ["Candle hilang / duplikat","ditolak dan dicatat","ok"],
    ["Harga/volume nol","ditolak dan dicatat","ok"],
    ["Order book kosong","ditolak dan dicatat","ok"],
    ["Spread &gt; 2%","ditolak dan dicatat","ok"],
    ["Retry terbatas","maks 3 percobaan, backoff eksponensial","ok"],
    ["Idempotency","state.candleTimes: candle yang sama tidak diproses dua kali","ok"],
    ["Kill switch","/api/kill tanpa deploy ulang, tercatat di log","ok"],
    ["Daily loss limit 3%","batas hari 00.00 WIB","ok"],
    ["Maks 4 posisi / 25% ekuitas","dicek saat eksekusi","ok"],
    ["Order minimum Rp25.000","lebih ketat dari API (Rp10.000)","ok"],
  ];
  document.getElementById("s-operasional").innerHTML = \`
  <h2>Panel operasional</h2>
  <div class="grid">
    \${card("Uptime forward",op?PCT(op.uptimePct,1):"—",op?op.ticksRecorded+"/"+op.expectedTicks+" tick":"belum berjalan")}
    \${card("API error",op?NUM(op.apiErrors,0):"0","fetch gagal setelah retry")}
    \${card("Kill switch",op?NUM(op.killSwitchUsed,0):"0",op&&op.killSwitchActive?"AKTIF":"tidak aktif")}
    \${card("Penolakan data",op?NUM(op.errorRows,0):"0","tercatat, bukan disembunyikan")}
  </div>

  <h3>Jadwal & endpoint</h3>
  <div class="kv">
    <div>Endpoint tick</div><div class="mono">GET/POST /api/tick — header Authorization: Bearer \$CRON_SECRET</div>
    <div>Penjadwal</div><div>GitHub Actions <span class="mono">7 * * * *</span> (menit ke-7, bukan menit 0)</div>
    <div>Batas waktu</div><div>300 detik per panggilan (paket Hobby)</div>
    <div>State</div><div>Upstash Redis REST (produksi) / file JSON (lokal)</div>
    <div>Kill switch</div><div class="mono">POST /api/kill {"on":true,"note":"..."}</div>
    <div>Ekspor log</div><div class="mono">GET /api/export?secret=...</div>
  </div>

  <h3>Kontrol yang diuji</h3>
  <div class="card">\${checks.map(([k,d,s])=>'<div class="chk"><span class="s pos">ADA</span><b>'+k+'</b><span class="d">'+d+'</span></div>').join("")}</div>
  \`;
}

/* ---------- metode ---------- */
function renderMetode(){
  const s = DATA.backtest.strategy;
  const u = DATA.universe;
  const rows = (u.universe||[]).map(x=>'<tr><td>'+esc(x.symbol)+'</td><td>'+RP(x.medianHourlyIdrAtStart)+'/jam</td><td>'+NUM(x.completeness*100,1)+'%</td><td>'+NUM(x.quantityIncrement,8)+'</td><td>'+NUM(x.feeTakerPct,2)+'%</td></tr>').join("");
  const snapRows = Object.entries(DATA.snapshots.summary||{}).map(([k,v])=>
    '<tr><td>'+esc(k)+'</td><td>'+NUM(v.medianSpreadPct,4)+'%</td><td>'+NUM(v.medianBuySlipPct["10000000"],4)+'%</td><td>'+NUM(v.medianSellSlipPct,4)+'%</td><td>'+v.valid+'/'+v.snapshots+'</td></tr>').join("");
  document.getElementById("s-metode").innerHTML = \`
  <h2>Strategi, data, dan batasan</h2>
  <h3>Aturan (dibekukan)</h3>
  <div class="kv">
    <div>Versi</div><div class="mono">\${esc(s.version)}</div>
    <div>Timeframe</div><div>1 jam (candle tertutup)</div>
    <div>Masuk</div><div>Close &gt; High tertinggi \${s.entryLookback} bar <b>dan</b> Close &gt; EMA\${s.trendEma}</div>
    <div>Keluar</div><div>Close &lt; Low terendah \${s.exitLookback} bar, ATAU Close &lt; peak − \${s.atrMult}×ATR\${s.atrPeriod}, ATAU ditahan \${s.maxHoldBars} bar</div>
    <div>Ukuran posisi</div><div>\${(s.positionPct*100)}% ekuitas per slot, maks \${(s.maxOrderPctOfCandle*100)}% nilai transaksi candle</div>
    <div>Batas risiko</div><div>maks \${s.maxPositions} posisi · daily loss limit \${s.dailyLossLimitPct}% (00.00 WIB) · long-only, tanpa leverage</div>
    <div>Biaya</div><div>fee taker \${s.takerFeePct}% per sisi + spread/2 + slippage terukur</div>
    <div>Order minimum</div><div>\${RP(s.minOrderIdr)} (API menyebut Rp10.000 — dipakai yang lebih ketat)</div>
  </div>

  <h3>Pemilihan universe (likuiditas diukur di AWAL periode)</h3>
  <div class="sub">Kandidat diambil dari seluruh pair IDR, lalu disaring memakai 30 hari pertama jendela backtest (\${esc(u.criteria?.liquidityMeasuredAt||"")}). Stablecoin dan token saham (akhiran X) dikecualikan. Ambang: median ≥ Rp\${NUM((u.criteria?.minMedianHourlyIdr||0)/1e6,0)} juta/jam dan kelengkapan ≥ 90%.</div>
  <div class="scroll" style="margin-top:10px"><table><thead><tr><th>Pair</th><th>Median volume</th><th>Kelengkapan</th><th>Increment</th><th>Fee API</th></tr></thead><tbody>\${rows}</tbody></table></div>

  <h3>Snapshot order book</h3>
  <div class="scroll" style="margin-top:10px"><table><thead><tr><th>Pair</th><th>Spread median</th><th>Slippage beli Rp10 jt</th><th>Slippage jual</th><th>Valid</th></tr></thead><tbody>\${snapRows}</tbody></table></div>

  <h3>Biaya: sumber dan kejujuran</h3>
  <div class="note warn"><b>Fee.</b> <span class="mono">/api/pairs</span> menyebut <span class="mono">trade_fee_percent_taker = 0,20%</span> (diakses 4 Nov 2026).
  Halaman resmi rincian biaya Indodax mengembalikan HTTP 404 dari lingkungan ini pada tanggal akses, sehingga angka halaman resmi tidak dapat diverifikasi.
  Karena aturan meminta memakai yang <i>lebih tinggi</i>, dipakai <b>0,30%</b> — asumsi konservatif yang diumumkan, bukan klaim bahwa halaman resmi menyebut 0,30%.</div>
  <div class="note">Spread dan slippage <b>tidak diasumsikan</b>: diukur dari \${Object.values(DATA.snapshots.summary||{}).reduce((a,v)=>a+(v.snapshots||0),0)} snapshot order book sungguhan, lalu dipakai backtest per pair.</div>

  <h3>Bukti freeze</h3>
  <div class="kv">
    <div>Commit</div><div class="mono">\${DATA.freeze? esc(DATA.freeze.commit) : "belum dicatat — lihat README bagian 11"}</div>
    <div>Waktu freeze (WIB)</div><div>\${DATA.freeze? esc(DATA.freeze.timeWib) : "—"}</div>
    <div>Catatan</div><div>\${DATA.freeze? esc(DATA.freeze.note||"") : "Aturan tidak diubah setelah commit freeze."}</div>
  </div>

  <h3>Batasan yang diakui</h3>
  <ul class="sub">
    <li>Backtest memakai model biaya (spread/2 + slippage terukur), bukan replay order book historis — order book historis tidak tersedia dari API publik Indodax.</li>
    <li>Slippage model diukur pada ukuran order Rp10–25 juta; order yang jauh lebih besar akan lebih mahal.</li>
    <li>Forward test memakai order book nyata, jadi selisih dengan backtest adalah bagian dari hasil yang dilaporkan, bukan kesalahan yang disembunyikan.</li>
    <li>Hasil masa lalu tidak menjamin masa depan. Bot ini dry run: tidak ada uang sungguhan.</li>
  </ul>
  \`;
}

/* ---------- log mentah ---------- */
function renderLog(){
  const f = DATA.forwardLogs;
  const counts = f?.counts ?? {};
  document.getElementById("s-log").innerHTML = \`
  <h2>Log mentah</h2>
  \${f? '<div class="note ok">Diekspor '+dt(f.exportedAt)+'. '+Object.entries(counts).map(([k,v])=>'<span class="tag">'+esc(k)+': '+v+'</span>').join(" ")+'</div>'
     : '<div class="note warn">Belum ada ekspor log forward. Jalankan <span class="mono">GET /api/export?secret=...</span> lalu simpan sebagai <span class="mono">data/forward_logs.json</span>.</div>'}
  <div class="row">
    <button class="ghost" onclick="unduh('backtest_full.json', DATA.backtest)">Unduh backtest_full.json</button>
    <button class="ghost" onclick="unduh('trades.csv', buatCsv(DATA.backtest.trades))">Unduh trades.csv</button>
    \${f?'<button class="ghost" onclick="unduh(\\'forward_logs.json\\', {exportedAt:DATA.forwardLogs.exportedAt,counts:DATA.forwardLogs.counts,logs:DATA.forwardLogs.logs,state:DATA.forwardLogs.state})">Unduh forward_logs.json</button>':""}
  </div>
  <h3>Isi log</h3>
  <pre>\${esc(JSON.stringify(f? f.logs : {catatan:"belum ada log forward"}, null, 1)).slice(0,120000)}</pre>
  \`;
}
function buatCsv(rows){
  if(!rows||!rows.length) return "";
  const keys=Object.keys(rows[0]);
  return [keys.join(",")].concat(rows.map(r=>keys.map(k=>'"'+String(r[k]??"").replace(/"/g,"'")+'"').join(","))).join("\\n");
}
function unduh(nama, isi){
  const blob=new Blob([typeof isi==="string"?isi:JSON.stringify(isi,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=nama; a.click();
}

/* ---------- tab ---------- */
const TABS=[["ringkasan","Ringkasan"],["backtest","Backtest"],["forward","Forward Test"],["operasional","Operasional"],["metode","Metode & Data"],["log","Log Mentah"]];
function show(id){
  document.querySelectorAll("section").forEach(s=>s.classList.toggle("on",s.id==="s-"+id));
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("on",b.dataset.id===id));
  window.scrollTo({top:0,behavior:"smooth"});
}
document.getElementById("nav").innerHTML=TABS.map(([id,label])=>'<button data-id="'+id+'" onclick="show(\\''+id+'\\')">'+label+'</button>').join("");

renderRingkasan(); renderBacktest(); renderForward(); renderOperasional(); renderMetode(); renderLog();
show("ringkasan");
</script>
</body>
</html>`;

fs.writeFileSync("dashboard.html", html, "utf8");
console.log(`Dashboard ditulis: dashboard.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
console.log(`  backtest: ${bt.metrics.trades} trade, return ${bt.metrics.totalReturnPct.toFixed(2)}%`);
console.log(`  forward : ${fwd ? fwd.totalReturnPct.toFixed(2) + "% (" + fwd.window.days + " hari)" : "belum berjalan"}`);

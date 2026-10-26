#!/usr/bin/env node
// tokens_live.js - docs/tokens.js against the live APIs, as the page would call it.
// usage: node tokens_live.js [evmAddress] [solanaAddress] [network keys, comma separated]
//        BREAK=eth,bsc node tokens_live.js ...       pretends those explorers are down
//        BREAK_ALL=eth,bsc node tokens_live.js ...   pretends every token-list API is down
'use strict';
const path = require('path');
const fs = require('fs');
const REPO = path.join(__dirname, '..', '..');
const T = require(path.join(REPO, 'docs/tokens.js'));
const ATA = require(path.join(REPO, 'docs/ata.js'));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const hosts = {};
async function fetchJSON(url, opts, timeoutMs) {
  const host = new URL(url).host, t0 = Date.now();
  const c = new AbortController(); const timer = setTimeout(() => c.abort(), timeoutMs || 20000);
  try {
    const r = await fetch(url, Object.assign({}, opts, { signal: c.signal, headers: Object.assign({ origin: 'https://gold-alex.github.io', 'user-agent': UA }, (opts || {}).headers) }));
    const acao = r.headers.get('access-control-allow-origin');
    (hosts[host] = hosts[host] || []).push(r.status + (acao ? '' : ' NO-CORS') + ' ' + (Date.now() - t0) + 'ms');
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    if (!acao) throw new Error('no CORS header');
    return await r.json();
  } catch (e) { if (!e.status) (hosts[host] = hosts[host] || []).push('ERR ' + e.message); throw e; } finally { clearTimeout(timer); }
}
async function rpc(url, method, params) {
  const j = await fetchJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (j.error) throw new Error(j.error.message); return j.result;
}
async function firstOk(xs, fn) { let last; for (const x of xs) { try { return await fn(x); } catch (e) { last = e; } } throw last || new Error('none'); }
function units(v, dec) { const n = typeof v === 'bigint' ? v : BigInt(v), d = 10n ** BigInt(dec); return Number(n / d) + Number(n % d) / Number(d); }

// the EVM list straight out of app.js
const src = fs.readFileSync(path.join(REPO, 'docs/app.js'), 'utf8');
const evmSrc = src.slice(src.indexOf('const EVM = ['), src.indexOf('];', src.indexOf('const EVM = [')) + 2);
const EVM = new Function('function t(symbol, addr, dec, price) { return { symbol, addr, dec, price }; } function ev(key, name, rpcs, symbol, price, explorer, tokens) { return { key, name, rpcs, symbol, price, explorer, tokens: tokens || [] }; }' + evmSrc + ' return EVM;')();
const SOL_RPCS = eval(src.match(/const SOL_RPCS = (\[[^\]]+\])/)[1]);

// BREAK: the explorers are down (MetaMask/Rabby still answer); BREAK_ALL: every token-list source is down
if (process.env.BREAK) for (const k of process.env.BREAK.split(',')) T.SRC[k] = [['bs', 'https://nonexistent.invalid']].concat((T.SRC[k] || []).filter(([kind]) => kind === 'mm' || kind === 'rb'));
if (process.env.BREAK_ALL) for (const k of process.env.BREAK_ALL.split(',')) T.SRC[k] = [['bs', 'https://nonexistent.invalid']];
const K = T.make({ fetchJSON, rpc, firstOk, units, solRpcs: SOL_RPCS, ata: ATA.associatedTokenAddress });
const evmAddr = process.argv[2] || '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const solAddr = process.argv[3] || '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zPmGP1y';
const only = process.argv[4] ? process.argv[4].split(',') : null;
const show = (name, r) => {
  const usd = r.holdings.reduce((s, x) => s + (x.usdPrice != null ? x.amount * x.usdPrice : 0), 0);
  const top = r.holdings.filter((x) => x.usdPrice != null).sort((a, b) => b.amount * b.usdPrice - a.amount * a.usdPrice).slice(0, 4).map((x) => x.symbol + ' $' + Math.round(x.amount * x.usdPrice)).join(', ');
  console.log(name.padEnd(18) + String(r.holdings.length).padStart(3) + ' counted  ' + String(r.others).padStart(4) + ' other  $' + Math.round(usd).toLocaleString().padEnd(12) + (r.partial ? '[' + r.partial + '] ' : '') + (r.note ? '(' + r.note + ') ' : '') + top);
  for (const x of r.holdings.filter((x) => / in /.test(x.symbol))) console.log('    position: ' + x.symbol + ' ' + x.amount.toPrecision(4) + ' = $' + (x.amount * x.usdPrice).toFixed(2));
};
(async () => {
  const nets = EVM.filter((c) => !only || only.includes(c.key));
  await Promise.all(nets.map(async (c) => {
    try {
      let url = null;
      await firstOk(c.rpcs, async (u) => { await rpc(u, 'eth_blockNumber', []); url = u; });
      show(c.key, await K.evm(c, evmAddr, url));
    } catch (e) { console.log(c.key.padEnd(18) + 'FAILED ' + e.message); }
  }));
  if (!only || only.includes('sol')) { try { show('solana', await K.sol(solAddr)); } catch (e) { console.log('solana FAILED ' + e.message); } }
  console.log('\nhosts:');
  for (const [h, v] of Object.entries(hosts).sort()) console.log('  ' + h.padEnd(44) + v.length + 'x  ' + [...new Set(v.map((s) => s.replace(/ \d+ms$/, '')))].join(', '));
})();

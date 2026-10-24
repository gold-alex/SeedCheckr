#!/usr/bin/env node
// Runs docs/app.js unchanged against the live public endpoints, with a stub DOM,
// and records every fetch the page makes plus the CORS headers a browser would need.
// usage: node site_live.js demo | random | <payload>     (random needs ./build.sh first)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { createHash, randomBytes } = require('crypto');

const REPO = path.join(__dirname, '..', '..');
const ORIGIN = 'https://gold-alex.github.io';
const appSrc = fs.readFileSync(path.join(REPO, 'docs/app.js'), 'utf8');

// ---- payload ----
let arg = process.argv[2] || 'demo';
const MORE = process.argv.includes('--more');
let FRAMES = [];
let payload;
if (arg === 'demo') {
  payload = appSrc.match(/DEMO_PAYLOAD = '([^']+)'/)[1];
} else if (arg === 'random') {
  const WORDS = fs.readFileSync(path.join(REPO, 'seedbox/bip39_words.h'), 'utf8').match(/"([a-z]+)"/g).map(w => w.slice(1, -1));
  const ent = randomBytes(16), cs = createHash('sha256').update(ent).digest();
  let bits = '';
  for (const b of ent) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < 4; i++) bits += (cs[0] >> (7 - i)) & 1;
  const words = [];
  for (let i = 0; i < bits.length; i += 11) words.push(WORDS[parseInt(bits.slice(i, i + 11), 2)]);
  const out = execFileSync(path.join(REPO, 'seedbox/test/test_portfolio'), [words.join(' ')], { encoding: 'utf8' });
  payload = Object.fromEntries(out.trim().split('\n').map(l => l.split('|'))).PORTFOLIO;
} else if (arg.startsWith('mnemonic:')) {
  const out = execFileSync(path.join(REPO, 'seedbox/test/test_portfolio'), [arg.slice(9)], { encoding: 'utf8' }).trim().split('\n');
  payload = out.find((l) => l.startsWith('PORTFOLIO|')).split('|')[1];
  FRAMES = out.filter((l) => l.startsWith('FRAME|')).map((l) => l.slice(6));
} else payload = arg;

// ---- stub DOM ----
function el(tag) {
  const e = {
    tag, children: [], attrs: {}, style: {}, classes: new Set(), hidden: true /* sections start hidden in the HTML */, innerHTML: '', _text: '',
    get textContent() { return this._text; }, set textContent(v) { this._text = v; this.children = []; },
    setAttribute(k, v) { e.attrs[k] = v; },
    appendChild(c) { e.children.push(c); return c; },
    append(...cs) { e.children.push(...cs); },
    handlers: {},
    addEventListener(ev, fn) { e.handlers[ev] = fn; },
    scrollIntoView() {},
    getContext() { return null; },
  };
  e.classList = { add: (c) => e.classes.add(c), remove: (c) => e.classes.delete(c), toggle: (c) => e.classes.has(c) ? e.classes.delete(c) : e.classes.add(c), contains: (c) => e.classes.has(c) };
  return e;
}
const els = {};
globalThis.window = globalThis;
globalThis.document = { querySelector: (s) => (els[s] = els[s] || el(s)), createElement: (t) => el(t) };
globalThis.location = { hash: '#' + payload, reload() {} };
globalThis.matchMedia = () => ({ matches: true });   // reduced motion: no waits, no confetti
globalThis.addEventListener = () => {};
globalThis.SeedDecode = require(path.join(REPO, 'docs/decode.js'));
globalThis.SolanaATA = require(path.join(REPO, 'docs/ata.js'));
globalThis.SeedScan = require(path.join(REPO, 'docs/scan.js'));
globalThis.SeedExtra = require(path.join(REPO, 'docs/extra.js'));
globalThis.SeedTokens = require(path.join(REPO, 'docs/tokens.js'));
// stand-in camera: hands the device's frames to the page as if it read them off the screen
globalThis.SeedScan.startCamera = (video, onText) => { const stop = () => {}; stop.ready = Promise.resolve('test'); setTimeout(() => { FRAMES.forEach((f) => onText(f)); FRAMES.forEach((f) => onText(f)); }, 50); return stop; };

// ---- fetch wrapper: what a browser would see ----
const realFetch = globalThis.fetch;
const log = [];
globalThis.fetch = async (url, opts = {}) => {
  const method = (opts.method || 'GET').toUpperCase();
  const entry = { url: String(url), method, status: null, acao: null, preflight: null, err: null, ms: 0 };
  log.push(entry);
  const t0 = Date.now();
  const hasJson = Object.keys(opts.headers || {}).some((k) => k.toLowerCase() === 'content-type');
  if (method === 'POST' && hasJson) {
    try {
      const p = await realFetch(url, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' }, signal: opts.signal });
      entry.preflight = { status: p.status, acao: p.headers.get('access-control-allow-origin'), acah: p.headers.get('access-control-allow-headers') };
    } catch (e) { entry.preflight = { err: e.message }; }
  }
  try {
    const r = await realFetch(url, Object.assign({}, opts, { headers: Object.assign({}, opts.headers || {}, { origin: ORIGIN, 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }) }));
    entry.status = r.status; entry.acao = r.headers.get('access-control-allow-origin');
    return r;
  } catch (e) { entry.err = e.message; throw e; } finally { entry.ms = Date.now() - t0; }
};

// ---- run the page ----
vm.runInThisContext(appSrc, { filename: 'app.js' });

(async () => {
  const t0 = Date.now();
  const q = globalThis.document.querySelector;
  for (const s of ['#casefile', '#error', '#error-text', '#case-id', '#verdict', '#verdict-text', '#verdict-sub', '#verdict-fine', '#rows', '#rows-nothing', '#nothing-wrap', '#nothing-summary', '#more-text', '#more-start', '#more-status']) q(s);
  while (Date.now() - t0 < 90000) {
    if (!els['#casefile'].hidden || !els['#error'].hidden) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (MORE && els['#casefile'] && !els['#casefile'].hidden) {
    console.log('(pressing "Scan the moving QR" with ' + FRAMES.length + ' frames)');
    els['#more-start'].handlers.click();
    const t1 = Date.now();
    while (Date.now() - t1 < 90000 && !/^Added /.test(els['#more-text'].textContent)) await new Promise((r) => setTimeout(r, 200));
    console.log('more: ' + els['#more-text'].textContent + '  (' + ((Date.now() - t1) / 1000).toFixed(1) + 's)');
  }
  const took = ((Date.now() - t0) / 1000).toFixed(1);
  if (!els['#error'].hidden) { console.log('ERROR PAGE:', els['#error-text'].textContent); process.exit(1); }
  if (els['#casefile'].hidden) { console.log('TIMED OUT waiting for the verdict'); }
  console.log('=== verdict (' + took + 's) ===');
  console.log(els['#case-id'].textContent, '|', [...els['#verdict'].classes].join(','));
  console.log(els['#verdict-text'].innerHTML.replace(/<\/?em>/g, ''));
  console.log(els['#verdict-sub'].textContent);
  console.log(els['#verdict-fine'].textContent);
  console.log('=== case file ===');
  const quiet = els['#rows-nothing'].children;
  console.log('(collapsed: ' + els['#nothing-summary'].textContent + ': ' + quiet.map((li) => li.children[0].textContent).join(', ') + ')');
  for (const li of els['#rows'].children) {
    const name = li.children.find((c) => c.className === 'name');
    const amount = li.children.find((c) => c.className === 'amount');
    const more = li.children.find((c) => c.className === 'more');
    const amt = amount.textContent || amount.children.map((c) => c.textContent).join(' ');
    console.log((li.classes.has('has-coins') ? '$ ' : '  ') + name.textContent.padEnd(22) + amt.padEnd(28) + (more.textContent || ''));
  }
  if (process.env.SHOWHOST) for (const e of log) if (e.url.includes(process.env.SHOWHOST)) console.log("HOST", e.status, e.acao, e.err, e.url.slice(0, 120));
  console.log('=== endpoints (CORS as a browser would see it, origin ' + ORIGIN + ') ===');
  const seen = new Map();
  for (const e of log) {
    const host = new URL(e.url).host;
    if (seen.has(host)) { const s = seen.get(host); s.n++; s.bad = s.bad || !(e.acao === '*' || e.acao === ORIGIN) || (e.err != null) || (e.preflight && e.preflight.status && e.preflight.status >= 300); continue; }
    seen.set(host, { n: 1, e, bad: !(e.acao === '*' || e.acao === ORIGIN) || (e.err != null) || (e.preflight && e.preflight.status && e.preflight.status >= 300) });
  }
  for (const [host, s] of seen) {
    const e = s.e;
    console.log((s.bad ? '!! ' : 'ok ') + host.padEnd(40) + 'x' + String(s.n).padEnd(3) + e.method + ' ' + (e.status ?? e.err) + ' acao=' + e.acao + (e.preflight ? ' preflight=' + JSON.stringify(e.preflight) : '') + ' ' + e.ms + 'ms');
  }
})();

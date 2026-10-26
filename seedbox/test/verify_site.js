#!/usr/bin/env node
// verify_site.js - round trip the one-scan QR, end to end, on the host:
//
//   random mnemonic -> test_portfolio (the device's C code) -> payload + addresses
//   payload -> docs/decode.js (the web page's code) -> must give the same 20 addresses
//   URL + payload -> test_qr (the device's QR encoder) -> jsQR (independent reader) -> same URL
//
// usage: node verify_site.js [N]    N random mnemonics of each length, 12/15/18/21/24 words (default 5)
// needs: ./build.sh first; `npm install` in this folder for the jsQR step (skipped if missing)
'use strict';
const { execFileSync } = require('child_process');
const { createHash, randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');
const D = require('../../docs/decode.js');
let jsQR = null;
try { jsQR = require('jsqr'); } catch (e) { console.log('jsqr not installed (npm install in test/): skipping the QR decode step'); }

const N = parseInt(process.argv[2] || '5', 10);
const here = __dirname;
const sketch = fs.readFileSync(path.join(here, '..', 'seedbox.ino'), 'utf8');
const URL = (sketch.match(/#define PORTFOLIO_URL\s+"([^"]+)"/) || [])[1];
if (!URL) throw new Error('PORTFOLIO_URL not found in seedbox.ino');

const WORDS = fs.readFileSync(path.join(here, '..', 'bip39_words.h'), 'utf8').match(/"([a-z]+)"/g).map(w => w.slice(1, -1));
if (WORDS.length !== 2048) throw new Error('wordlist parse gave ' + WORDS.length + ' words');

function mnemonic(entBytes) {
  const ent = randomBytes(entBytes);
  const cs = createHash('sha256').update(ent).digest();
  let bits = '';
  for (const b of ent) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < entBytes * 8 / 32; i++) bits += (cs[0] >> (7 - i)) & 1;
  const words = [];
  for (let i = 0; i < bits.length; i += 11) words.push(WORDS[parseInt(bits.slice(i, i + 11), 2)]);
  return words.join(' ');
}

// keccak sanity: keccak256("") is the well-known constant
const k0 = D.bytesToHex(D.keccak256(new Uint8Array(0)));
if (k0 !== 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470') throw new Error('keccak256 broken: ' + k0);

// firmware row name -> path into the decoded address object
const MAP = {
  'ETH / all EVM': a => a.evm, 'BTC addr 1': a => a.btc, 'LTC': a => a.ltc, 'DOGE': a => a.doge,
  'SOL': a => a.sol, 'TRX': a => a.trx, 'ATOM': a => a.cosmos.atom, 'OSMO': a => a.cosmos.osmo,
  'TIA': a => a.cosmos.tia, 'DYDX': a => a.cosmos.dydx, 'SEI': a => a.cosmos.sei, 'AKT': a => a.cosmos.akt,
  'JUNO': a => a.cosmos.juno, 'STARS': a => a.cosmos.stars, 'INJ': a => a.inj, 'XRP': a => a.xrp,
  'SUI': a => a.sui, 'APT': a => a.apt, 'BTC legacy addr 1': a => a.btcLegacy,
};

function decodeGrid(text) {
  const lines = text.trim().split('\n');
  const [, v, s] = lines[0].match(/^V(\d+) S(\d+)$/);
  const size = parseInt(s, 10), scale = 4, quiet = 4;
  const w = (size + 2 * quiet) * scale;
  const img = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (lines[1 + y][x] !== '#') continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4;
      img[i] = img[i + 1] = img[i + 2] = 0;
    }
  }
  const r = jsQR(img, w, w);
  return { version: parseInt(v, 10), size, data: r ? r.data : null };
}

(async () => {
  let fails = 0, total = 0, maxVersion = 0, maxLen = 0;
  for (const entBytes of [16, 20, 24, 28, 32]) for (let i = 0; i < N; i++) {
    const m = mnemonic(entBytes);
    const out = execFileSync(path.join(here, 'test_portfolio'), [m], { encoding: 'utf8' }).trim().split('\n');
    const rows = Object.fromEntries(out.map(l => l.split('|')));
    const payload = rows.PORTFOLIO;
    maxLen = Math.max(maxLen, payload.length);
    total++;
    let bad = [];
    try {
      const a = await D.addressesFrom(D.parsePayload(payload));
      for (const [name, pick] of Object.entries(MAP)) {
        if (!(name in rows)) { bad.push(name + ': missing from firmware output'); continue; }
        if (pick(a) !== rows[name]) bad.push(name + ': device ' + rows[name] + ' page ' + pick(a));
      }
    } catch (e) { bad.push('decode threw: ' + e.message); }
    if (jsQR) {
      const grid = execFileSync(path.join(here, 'test_qr'), [URL, payload], { encoding: 'utf8' });
      const r = decodeGrid(grid);
      maxVersion = Math.max(maxVersion, r.version);
      if (r.data !== URL + payload) bad.push('QR: decoded ' + (r.data === null ? 'nothing' : 'different text') + ' (v' + r.version + ')');
      // the fragment must survive a real URL parser too
      const u = new (require('url').URL)(URL + payload);
      if (D.parseFragment(u.hash) !== payload) bad.push('URL fragment mangled: ' + u.hash.slice(0, 40));
    }
    if (bad.length) { fails++; console.log('FAIL: ' + m); for (const b of bad) console.log('  ' + b); }
  }
  if (jsQR) {
    // the per-chain QR path, with the longest things the device shows
    for (const t of ['https://blockchair.com/bitcoin/xpub/zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']) {
      const r = decodeGrid(execFileSync(path.join(here, 'test_qr'), ['-t', t], { encoding: 'utf8' }));
      total++;
      if (r.data !== t) { fails++; console.log('FAIL plain QR v' + r.version + ': ' + t.slice(0, 30)); }
    }
  }
  // every local script in the page carries the hash of its current contents (stamp.js), so a
  // returning browser never mixes a new page with cached old scripts
  const S = require('./stamp.js');
  const html = fs.readFileSync(path.join(S.DOCS, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script src="([a-z0-9_.-]+\.js)(\?v=([0-9a-f]+))?"/g)) {
    total++;
    if (m[3] !== S.stamp(m[1])) { fails++; console.log('FAIL: ' + m[1] + ' is not stamped with its current hash: run node stamp.js'); }
  }
  console.log(`mnemonics: ${5 * N}, checks: ${total}, failures: ${fails}, longest payload: ${maxLen} chars, largest portfolio QR: v${maxVersion || '?'}`);
  process.exit(fails ? 1 : 0);
})();

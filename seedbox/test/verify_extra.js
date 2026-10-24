#!/usr/bin/env node
// verify_extra.js - the "more chains" path end to end, on the host:
//
//   random mnemonic -> test_portfolio (device C code) -> FRAME| lines
//   frames -> docs/scan.js (the page's assembler) -> records
//   records -> docs/extra.js (the page's address builders) -> must reproduce every
//   address the device itself shows for those rows (test_chains output)
//
// Also checks extra.js's own hash functions against node's crypto / known vectors.
// usage: node verify_extra.js [N]   N mnemonics of each length (default 2)
'use strict';
const { execFileSync } = require('child_process');
const { createHash, randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');
globalThis.SeedDecode = require('../../docs/decode.js');
const X = require('../../docs/extra.js');
const S = require('../../docs/scan.js');

let fails = 0, checks = 0;
const ok = (cond, what) => { checks++; if (!cond) { fails++; console.log('FAIL ' + what); } };

// ---- hash functions vs node ----
for (let i = 0; i < 40; i++) {
  const m = randomBytes(i * 7 % 300);
  ok(X.hex(X.sha256(m)) === createHash('sha256').update(m).digest('hex'), 'sha256 len ' + m.length);
  ok(X.hex(X.sha224(m)) === createHash('sha224').update(m).digest('hex'), 'sha224 len ' + m.length);
  ok(X.hex(X.sha512_256(m)) === createHash('sha512-256').update(m).digest('hex'), 'sha512/256 len ' + m.length);
  ok(X.hex(X.blake2b(m, 64)) === createHash('blake2b512').update(m).digest('hex'), 'blake2b-512 len ' + m.length);
}
// blake2b short outputs: RFC 7693 appendix A has "abc" for 64; for 32/20/4 compare with python if present
const py = process.env.PYTHON || 'python3';
for (const n of [4, 20, 28, 32]) {
  const m = randomBytes(33);
  let ref = null;
  try { ref = execFileSync(py, ['-c', `import hashlib;print(hashlib.blake2b(bytes.fromhex('${m.toString('hex')}'),digest_size=${n}).hexdigest())`], { encoding: 'utf8' }).trim(); } catch (e) { /* no python */ }
  if (ref) ok(X.hex(X.blake2b(m, n)) === ref, 'blake2b-' + n);
}
ok(X.crc32(Buffer.from('123456789')) === 0xcbf43926, 'crc32 check value');
ok(X.crc16xmodem(Buffer.from('123456789')) === 0x31c3, 'crc16-xmodem check value');

// ---- device frames -> page records -> page addresses == device addresses ----
const WORDS = fs.readFileSync(path.join(__dirname, '..', 'bip39_words.h'), 'utf8').match(/"([a-z]+)"/g).map((w) => w.slice(1, -1));
function mnemonic(entBytes) {
  const ent = randomBytes(entBytes), cs = createHash('sha256').update(ent).digest();
  let bits = ''; for (const b of ent) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < entBytes / 4; i++) bits += (cs[0] >> (7 - i)) & 1;
  const w = []; for (let i = 0; i < bits.length; i += 11) w.push(WORDS[parseInt(bits.slice(i, i + 11), 2)]);
  return w.join(' ');
}
const K = new Proxy({}, { get: (t, k) => (k === 'evm' ? () => ({ explorer: '' }) : () => {}) });   // builders only; nothing is fetched
const N = parseInt(process.argv[2] || '2', 10);
const TV = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const mns = [TV];
for (const e of [16, 20, 24, 28, 32]) for (let i = 0; i < N; i++) mns.push(mnemonic(e));
let types = new Set();
for (const m of mns) {
  const dev = execFileSync(path.join(__dirname, 'test_chains'), [m], { encoding: 'utf8' }).trim().split('\n').map((l) => l.split('|'));
  const frames = execFileSync(path.join(__dirname, 'test_portfolio'), [m], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('FRAME|')).map((l) => l.slice(6));
  const asm = new S.Assembler();
  let res;
  for (const f of frames.slice().reverse()) res = asm.add(f);                        // any order
  ok(res && res.done, 'frames assemble');
  const recs = S.records(res.bytes);
  const ext = dev.slice(20);                                                          // device rows after the 20 core rows
  ok(recs.length === ext.length, 'one record per device extension row (' + recs.length + ' vs ' + ext.length + ')');
  const built = X.build(recs, K);
  const pageAddrs = new Set(built.map((c) => c.addr.replace(/^[PX]-/, '')));
  for (const [name, a] of ext) {
    const want = a.replace(/^[PX]-/, '');
    ok(pageAddrs.has(want), 'page rebuilds device row "' + name + '" = ' + a);
  }
  for (const r of recs) types.add(r.type);
}
console.log('mnemonics: ' + mns.length + ', record types: ' + types.size + ', checks: ' + checks + ', failures: ' + fails);
process.exit(fails ? 1 : 0);

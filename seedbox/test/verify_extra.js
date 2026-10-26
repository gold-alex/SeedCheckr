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
for (let i = 0; i < 30; i++) {
  const m = randomBytes(i * 7 % 200), k = randomBytes(i % 150);
  ok(X.hex(X.ripemd160(m)) === createHash('ripemd160').update(m).digest('hex'), 'ripemd160 len ' + m.length);
  ok(X.hex(X.hmacSha512(k, m)) === require('crypto').createHmac('sha512', k).update(m).digest('hex'), 'hmac-sha512');
}

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
let types = new Set(), prev70 = null;
for (const m of mns) {
  const dev = execFileSync(path.join(__dirname, 'test_chains'), [m], { encoding: 'utf8' }).trim().split('\n').map((l) => l.split('|'));
  const frames = execFileSync(path.join(__dirname, 'test_portfolio'), [m], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('FRAME|')).map((l) => l.slice(6));
  const asm = new S.Assembler();
  let res;
  for (const f of frames.slice().reverse()) res = asm.add(f);                        // any order
  ok(res && res.done, 'frames assemble');
  const recs = S.records(res.bytes);
  const ext = dev.slice(20);                                                          // device rows after the 20 core rows
  const acct = recs.filter((r) => r.type >= 0x70 && r.type <= 0x7F);                  // account xpub records
  ok(recs.length - acct.length === ext.length, 'one record per device extension row (' + (recs.length - acct.length) + ' vs ' + ext.length + ')');
  ok(acct.length === 12, "twelve account records");
  const built = X.build(recs, K);
  const pageAddrs = new Set(built.map((c) => c.addr.replace(/^[PX]-/, '')));
  for (const [name, a] of ext) {
    const want = a.replace(/^[PX]-/, '');
    ok(pageAddrs.has(want), 'page rebuilds device row "' + name + '" = ' + a);
  }
  // the zpub and legacy xpub the page builds are the ones the device shows on rows 1 and 3
  ok(pageAddrs.has(dev[1][1]), 'page zpub == device "' + dev[1][0] + '"');
  ok(pageAddrs.has(dev[3][1]), 'page xpub == device "' + dev[3][0] + '"');
  // the nested ypub and the BCH xpub are not shown on the device: compare with bip_utils
  try {
    const ref = execFileSync(py, ['-c', "import sys,bip_utils as b;s=b.Bip39SeedGenerator(sys.argv[1]).Generate();print(b.Bip49.FromSeed(s,b.Bip49Coins.BITCOIN).Purpose().Coin().Account(0).PublicKey().ToExtended());print(b.Bip44.FromSeed(s,b.Bip44Coins.BITCOIN_CASH).Purpose().Coin().Account(0).PublicKey().ToExtended())", m], { encoding: 'utf8' }).trim().split('\n');
    ok(pageAddrs.has(ref[0]), 'page ypub == bip_utils ' + ref[0]);
    ok(pageAddrs.has(ref[1]), 'page BCH xpub == bip_utils ' + ref[1]);
  } catch (e) { console.log('(bip_utils not available: skipped the ypub / BCH xpub check)'); }
  // binding: the 0x70 account key derives the Portfolio QR's first segwit address (m/84'/0'/0'/0/0)
  const v1 = execFileSync(path.join(__dirname, 'test_portfolio'), [m], { encoding: 'utf8' }).split('\n').find((l) => l.startsWith('PORTFOLIO|')).split('|')[1];
  const pv1 = globalThis.SeedDecode.parsePayload(v1);
  const r70 = recs.find((r) => r.type === 0x70);
  ok(X.hex(X.firstPkh(r70.bytes)) === X.hex(pv1.btc), 'moving QR binds to its own Portfolio QR');
  if (prev70) ok(X.hex(X.firstPkh(prev70)) !== X.hex(pv1.btc), "another seed's moving QR does not bind");
  prev70 = r70.bytes;
  // wallets the page scans itself: its first addresses equal the device's rows
  const rec = (ty) => recs.find((r) => r.type === ty).bytes;
  const devAddr = (name) => (dev.find((d) => d[0] === name) || [])[1];
  ok(X.childAddrs(rec(0x74), 'btc-tr', 0, 0, 1)[0] === devAddr('BTC taproot'), 'taproot wallet address 0 == device');
  ok(X.childAddrs(rec(0x75), 'ltc-wpkh', 0, 0, 1)[0] === devAddr('LTC'), 'LTC segwit wallet address 0 == device');
  ok(X.childAddrs(rec(0x76), 'ltc-pkh', 0, 0, 1)[0] === devAddr('LTC legacy (L..)'), 'LTC legacy wallet address 0 == device');
  ok(X.childAddrs(rec(0x78), 'doge-pkh', 0, 0, 1)[0] === dev[5][1], 'DOGE wallet address 0 == device');
  ok(X.childAddrs(rec(0x79), 'dash-pkh', 0, 0, 1)[0] === devAddr('DASH'), 'Dash wallet address 0 == device');
  ok(X.base58check(Uint8Array.from([0x3c, ...X.firstPkh(rec(0x7A))])) === devAddr('RVN'), 'Ravencoin wallet address 0 == device');
  const ethChain = rec(0x77);
  ok(X.walletAddr('eth', X.ckdPub(ethChain.slice(36, 69), ethChain.slice(4, 36), 0).pub) === dev[0][1], 'MetaMask account 1 == device ETH row');
  try {
    const ref = execFileSync(py, ['-c', "import sys,bip_utils as b;s=b.Bip39SeedGenerator(sys.argv[1]).Generate();e=b.Bip44.FromSeed(s,b.Bip44Coins.ETHEREUM).Purpose().Coin().Account(0).Change(b.Bip44Changes.CHAIN_EXT);print(e.AddressIndex(1).PublicKey().ToAddress());print(e.AddressIndex(4).PublicKey().ToAddress());t=b.Bip86.FromSeed(s,b.Bip86Coins.BITCOIN).Purpose().Coin().Account(0);print(t.Change(b.Bip44Changes.CHAIN_EXT).AddressIndex(4).PublicKey().ToAddress());print(t.Change(b.Bip44Changes.CHAIN_INT).AddressIndex(2).PublicKey().ToAddress())", m], { encoding: 'utf8' }).trim().split('\n');
    ok(X.walletAddr('eth', X.ckdPub(ethChain.slice(36, 69), ethChain.slice(4, 36), 1).pub) === ref[0], 'MetaMask account 2 == bip_utils');
    ok(X.walletAddr('eth', X.ckdPub(ethChain.slice(36, 69), ethChain.slice(4, 36), 4).pub) === ref[1], 'MetaMask account 5 == bip_utils');
    ok(X.childAddrs(rec(0x74), 'btc-tr', 0, 4, 1)[0] === ref[2], 'taproot receive #4 == bip_utils');
    ok(X.childAddrs(rec(0x74), 'btc-tr', 1, 2, 1)[0] === ref[3], 'taproot change #2 == bip_utils');
  } catch (e) { console.log('(bip_utils not available: skipped MetaMask / taproot index checks)'); }
  // Ledger Live accounts 2-5 (m/44'/60'/i'/0/0): the device sends the addresses, the page labels them
  ok(rec(0x7B).length === 80, 'Ledger Live record is 4 addresses');
  const ledger = built.filter((c) => / \(Ledger Live\)$/.test(c.name)).map((c) => c.addr);
  ok(ledger.length === 4, 'page builds 4 Ledger Live accounts');
  try {
    const ref = execFileSync(py, ['-c', "import sys,bip_utils as b;s=b.Bip39SeedGenerator(sys.argv[1]).Generate();c=b.Bip44.FromSeed(s,b.Bip44Coins.ETHEREUM).Purpose().Coin();print('\\n'.join(c.Account(i).Change(b.Bip44Changes.CHAIN_EXT).AddressIndex(0).PublicKey().ToAddress() for i in range(1,5)))", m], { encoding: 'utf8' }).trim().split('\n');
    for (let i = 0; i < 4; i++) ok(ledger[i] === ref[i], 'Ledger Live account ' + (i + 2) + ' == bip_utils');
  } catch (e) { console.log('(bip_utils not available: skipped the Ledger Live check)'); }
  for (const r of recs) types.add(r.type);
}
console.log('mnemonics: ' + mns.length + ', record types: ' + types.size + ', checks: ' + checks + ', failures: ' + fails);
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
// verify_electrum.js - the device's Electrum seed code (src/electrum.c, through test_chains
// "electrum:<words>") against Electrum itself:
//   1. Electrum's own test vectors (tests/test_wallet_vertical.py): a standard and a segwit
//      seed, their master public keys and first receive addresses
//   2. Electrum's seed vector with a seed extension in mixed case (tests/test_mnemonic.py,
//      "english_with_passphrase"): Electrum lowercases the extension, so must the device
//   3. random seeds made the way Electrum makes them (12 random words until the version
//      HMAC has the prefix), random extensions with capitals and stray spaces: type, xpub,
//      first address and payload v2 against Python (electrum's normalize_text + bip_utils)
//   4. random BIP39 phrases: never taken for Electrum unless the HMAC says so
// usage: PYTHON=/path/to/venv/bin/python node verify_electrum.js [N, default 40]   (needs ./build.sh, bip_utils)
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const D = require('../../docs/decode.js');
const here = __dirname, py = process.env.PYTHON || 'python3';
const N = parseInt(process.argv[2] || '40', 10);
let checks = 0, fails = 0;
const ok = (c, what) => { checks++; if (!c) { fails++; console.log('FAIL ' + what); } };
const device = (words, pass) => {
  const out = execFileSync(path.join(here, 'test_chains'), ['electrum:' + words, pass || ''], { encoding: 'utf8' });
  return Object.fromEntries(out.trim().split('\n').map((l) => [l.split('|')[0], l.slice(l.indexOf('|') + 1)]));
};

// 1. Electrum's wallet vectors
{
  const s = device('cycle rocket west magnet parrot shuffle foot correct salt library feed song');
  ok(s.type === 'standard', 'standard vector type ' + s.type);
  ok(s['BTC xpub (Electrum)'] === 'xpub661MyMwAqRbcFWohJWt7PHsFEJfZAvw9ZxwQoDa4SoMgsDDM1T7WK3u9E4edkC4ugRnZ8E4xDZRpk8Rnts3Nbt97dPwT52CwBdDWroaZf8U', 'standard vector xpub');
  ok(s['BTC addr 1'] === '1NNkttn1YvVGdqBW4PR6zvc3Zx3H5owKRf', 'standard vector address');
  const w = device('bitter grass shiver impose acquire brush forget axis eager alone wine silver');
  ok(w.type === 'segwit', 'segwit vector type ' + w.type);
  ok(w['BTC zpub (Electrum)'] === 'zpub6nsHdRuY92FsMKdbn9BfjBCG6X8pyhCibNP6uDvpnw2cyrVhecvHRMa3Ne8kdJZxjxgwnpbHLkcR4bfnhHy6auHPJyDTQ3kianeuVLdkCYQ', 'segwit vector zpub');
  ok(w['BTC addr 1'] === 'bc1q3g5tmkmlvxryhh843v4dz026avatc0zzr6h3af', 'segwit vector address');
}

const ref = (jobs) => JSON.parse(execFileSync(py, ['-c', `
import json, sys, hashlib, hmac, string, unicodedata
from bip_utils import Bip32Slip10Secp256k1, P2PKHAddrEncoder, P2WPKHAddrEncoder, Bip32KeyNetVersions
# electrum/mnemonic.py normalize_text, as is
def is_CJK(c): return False
def normalize_text(seed):
    seed = unicodedata.normalize('NFKD', seed)
    seed = seed.lower()
    seed = u''.join([c for c in seed if not unicodedata.combining(c)])
    seed = u' '.join(seed.split())
    seed = u''.join([seed[i] for i in range(len(seed)) if not (seed[i] in string.whitespace and is_CJK(seed[i-1]) and is_CJK(seed[i+1]))])
    return seed
def stype(x):
    h = hmac.new(b"Seed version", normalize_text(x).encode(), hashlib.sha512).hexdigest()
    n = len(x.split())
    if h.startswith("01"): return "standard"
    if h.startswith("100"): return "segwit"
    if h.startswith("101") and (n == 12 or n >= 20): return "2fa"
    if h.startswith("102"): return "2fa_segwit"
    return "none"
ZPUB = Bip32KeyNetVersions(bytes.fromhex("04b24746"), bytes.fromhex("04b2430c"))
out = []
for words, pw, seedhex in json.load(sys.stdin):
    t = stype(words); r = {"type": t}
    if t in ("standard", "segwit"):
        seed = bytes.fromhex(seedhex) if seedhex else hashlib.pbkdf2_hmac("sha512", normalize_text(words).encode(), b"electrum" + normalize_text(pw).encode(), 2048)
        if t == "standard":
            k = Bip32Slip10Secp256k1.FromSeed(seed)
            r["xpub"] = k.PublicKey().ToExtended()
            r["addr"] = P2PKHAddrEncoder.EncodeKey(k.DerivePath("0/0").PublicKey().RawCompressed().ToBytes(), net_ver=b"\\x00")
        else:
            k = Bip32Slip10Secp256k1.FromSeed(seed, key_net_ver=ZPUB).DerivePath("0'")
            r["xpub"] = k.PublicKey().ToExtended()
            r["addr"] = P2WPKHAddrEncoder.EncodeKey(k.DerivePath("0/0").PublicKey().RawCompressed().ToBytes(), hrp="bc")
        pk = k.PublicKey()
        r["rec"] = (k.ParentFingerPrint().ToBytes() if t == "segwit" else bytes(4)).hex() + k.ChainCode().ToBytes().hex() + pk.RawCompressed().ToBytes().hex()
    out.append(r)
print(json.dumps(out))
`], { input: JSON.stringify(jobs), encoding: 'utf8' }));

function compare(words, pass, r, what) {
  const d = device(words, pass);
  ok(d.type === r.type, what + ': type ' + d.type + ' vs ' + r.type);
  if (r.type !== 'standard' && r.type !== 'segwit') return;
  const key = r.type === 'segwit' ? 'BTC zpub (Electrum)' : 'BTC xpub (Electrum)';
  ok(d[key] === r.xpub, what + ': xpub ' + d[key] + ' vs ' + r.xpub);
  ok(d['BTC addr 1'] === r.addr, what + ': address ' + d['BTC addr 1'] + ' vs ' + r.addr);
  const p = D.parsePayload(d.payload);
  ok(p.version === 2 && p.electrum === r.type && D.bytesToHex(p.key) === r.rec, what + ': payload v2 does not decode to the key');
}

// 1b. the page: payload v2 -> record 0x81 / 0x82 -> the wallet key shown as Electrum shows it,
//     and Electrum's own first receive and change addresses from it
{
  const X = require('../../docs/extra.js');
  const page = (words, kind) => {
    const p = D.parsePayload(device(words).payload);
    const [c] = X.build([{ type: p.electrum === 'segwit' ? 0x82 : 0x81, bytes: p.key }], { h: () => 0, units: () => 0, firstOk: () => 0 });
    return { shown: c.addr, recv: X.childAddrs(p.key, kind, 0, 0, 1)[0], change: X.childAddrs(p.key, kind, 1, 0, 1)[0] };
  };
  const s = page('cycle rocket west magnet parrot shuffle foot correct salt library feed song', 'btc-pkh');
  ok(s.shown === 'xpub661MyMwAqRbcFWohJWt7PHsFEJfZAvw9ZxwQoDa4SoMgsDDM1T7WK3u9E4edkC4ugRnZ8E4xDZRpk8Rnts3Nbt97dPwT52CwBdDWroaZf8U', 'page: standard xpub ' + s.shown);
  ok(s.recv === '1NNkttn1YvVGdqBW4PR6zvc3Zx3H5owKRf' && s.change === '1KSezYMhAJMWqFbVFB2JshYg69UpmEXR4D', 'page: standard addresses ' + s.recv + ' ' + s.change);
  const w = page('bitter grass shiver impose acquire brush forget axis eager alone wine silver', 'btc-wpkh');
  ok(w.shown === 'zpub6nsHdRuY92FsMKdbn9BfjBCG6X8pyhCibNP6uDvpnw2cyrVhecvHRMa3Ne8kdJZxjxgwnpbHLkcR4bfnhHy6auHPJyDTQ3kianeuVLdkCYQ', 'page: segwit zpub ' + w.shown);
  ok(w.recv === 'bc1q3g5tmkmlvxryhh843v4dz026avatc0zzr6h3af' && w.change === 'bc1qdy94n2q5qcp0kg7v9yzwe6wvfkhnvyzje7nx2p', 'page: segwit addresses ' + w.recv + ' ' + w.change);
}

// 2. Electrum's seed vector with an extension (its bip32 seed given; the device must reach it)
{
  const words = 'wild father tree among universe such mobile favorite target dynamic credit identify';
  const pass = 'Did you ever hear the tragedy of Darth Plagueis the Wise?';
  const [r] = ref([[words, '', '4aa29f2aeb0127efb55138ab9e7be83b36750358751906f86c662b21a1ea1370f949e6d1a12fa56d3d93cadda93038c76ac8118597364e46f5156fde6183c82f']]);
  compare(words, pass, r, 'english_with_passphrase');
  const [r0] = ref([[words, '', 'aac2a6302e48577ab4b46f23dbae0774e2e62c796f797d0a1b5faeb528301e3064342dafb79069e7c4c6b8c38ae11d7a973bec0d4f70626f8cc5184a8d0b0756']]);
  compare(words, '', r0, 'english');
}

// 3 and 4. random seeds: Electrum-style (searched for the prefix) and plain random phrases
const W = require('fs').readFileSync(path.join(here, '../src/trezor/bip39_english.c'), 'utf8').match(/"[a-z]+"/g).map((s) => s.slice(1, -1));
const crypto = require('crypto');
const pick = () => W[crypto.randomInt(W.length)];
const hm = (x) => crypto.createHmac('sha512', 'Seed version').update(x).digest('hex');
const passes = ['', 'Correct Horse', '  two  spaces  ', 'MiXeD 123 !@#', 'trailing ', '~`{}|\\"\''];
const jobs = [];
let electrumSeeds = 0;
for (let k = 0; k < N; k++) {
  const want = k % 2 ? '100' : '01';
  let words;
  do { words = Array.from({ length: 12 }, pick).join(' '); } while (!hm(words).startsWith(want));
  jobs.push([words, passes[k % passes.length], '']); electrumSeeds++;
}
for (let k = 0; k < N; k++) jobs.push([Array.from({ length: k % 3 ? 12 : 24 }, pick).join(' '), '', '']);
const refs = ref(jobs);
jobs.forEach(([w, p], i) => compare(w, p, refs[i], (i < electrumSeeds ? 'electrum seed ' : 'random phrase ') + i));

console.log(`electrum seeds: ${electrumSeeds}, random phrases: ${N}, checks: ${checks}, failures: ${fails}`);
process.exit(fails ? 1 : 0);

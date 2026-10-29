#!/usr/bin/env node
// verify_slip39.js - the device's SLIP-39 code (src/slip39.c, through test_slip39) against
// SatoshiLabs' reference:
//   1. the 45 official vectors (vectors.json of python-shamir-mnemonic, passphrase "TREZOR"):
//      valid sets give the same master secret, invalid ones are refused
//   2. random backups made by the reference (1 to 4 groups, thresholds up to 3 of 5, 16 or
//      32 bytes, with and without a passphrase, extendable or not), shares fed in random
//      order: enough shares give the secret; one share fewer is "not enough"; a share from
//      another backup or the same share twice is refused
//   3. the SLIP-0023 Cardano root of test vector 1 (ref_seed.py's cardano_root, which
//      compare.sh holds the device to)
// usage: PYTHON=/path/to/venv/bin/python node verify_slip39.js [N random backups, default 40]
// needs: ./build.sh; pip install shamir-mnemonic bip_utils; vectors.json next to this file
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const here = __dirname, py = process.env.PYTHON || 'python3';
const N = parseInt(process.argv[2] || '40', 10);
let checks = 0, fails = 0;
const ok = (c, what) => { checks++; if (!c) { fails++; console.log('FAIL ' + what); } };
const device = (shares, pass) => execFileSync(path.join(here, 'test_slip39'), pass === undefined ? [] : [pass], { input: shares.join('\n') + '\n', encoding: 'utf8' }).trim().split('\n').pop();
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 1. official vectors
const vectors = JSON.parse(fs.readFileSync(path.join(here, 'vectors.json'), 'utf8'));
for (const [name, mnemonics, secret] of vectors) {
  const r = device(mnemonics, 'TREZOR');
  if (secret) ok(r === 'OK ' + secret, name + ': ' + r);
  else ok(r.startsWith('ERR'), name + ': accepted (' + r + ')');
}

// 2. random backups from the reference implementation
const gen = execFileSync(py, ['-c', `
import json, os, random, shamir_mnemonic as s
out = []
for k in range(${N}):
    ng = random.randint(1, 4); gt = random.randint(1, ng)
    groups = []
    for g in range(ng):
        t = random.randint(1, 3); c = t if t == 1 else random.randint(t, 5)
        groups.append((t, c))
    secret = os.urandom(random.choice([16, 32]))
    pw = random.choice(["", "TREZOR", "correct horse battery staple", "~!@ #$"])
    m = s.generate_mnemonics(gt, groups, secret, pw.encode(), extendable=random.random() < 0.5, iteration_exponent=random.randint(0, 1))
    out.append({"gt": gt, "groups": [[t for t, c in groups], m], "secret": secret.hex(), "pw": pw})
other = s.generate_mnemonics(1, [(2, 3)], os.urandom(16))[0]
print(json.dumps({"backups": out, "other": other}))
`], { encoding: 'utf8', maxBuffer: 1 << 26 });
const { backups, other } = JSON.parse(gen);
let words20 = 0, words33 = 0;
for (const bk of backups) {
  const [thr, groups] = bk.groups;
  // gt groups chosen at random, thr shares of each, in random order
  const gs = shuffle(groups.map((m, i) => i)).slice(0, bk.gt);
  const enough = shuffle(gs.flatMap((g) => shuffle(groups[g].slice()).slice(0, thr[g])));
  const nw = enough[0].split(' ').length;
  if (nw === 20) words20++; else if (nw === 33) words33++;
  ok(device(enough, bk.pw) === 'OK ' + bk.secret, 'random backup (' + bk.gt + ' of ' + groups.length + ' groups, ' + nw + ' words): ' + device(enough, bk.pw));
  // one share fewer: not enough (unless every needed group is 1-of-1 and there is nothing to drop)
  if (enough.length > 1) ok(device(enough.slice(1), bk.pw) === 'ERR 0 NOT_ENOUGH', 'one share fewer accepted');
  // the same share twice: refused at the second copy
  ok(device([enough[0], enough[0]], bk.pw) === 'ERR 2 ' + 5, 'duplicate share not refused: ' + device([enough[0], enough[0]], bk.pw));
  // a share of another backup: refused
  ok(device([enough[0], other[0]], bk.pw) === 'ERR 2 6', 'share of another backup not refused');
  // a wrong passphrase gives a different secret, not an error (as on Trezor)
  if (bk.pw) ok(/^OK /.test(device(enough, '')) && device(enough, '') !== 'OK ' + bk.secret, 'no passphrase gave the same secret');
  // one word changed: the checksum catches it
  const w = enough[0].split(' '); const i = Math.floor(Math.random() * w.length); w[i] = w[i] === 'academic' ? 'acid' : 'academic';
  ok(device([w.join(' ')], bk.pw).startsWith('ERR 1 '), 'changed word not caught');
}
ok(words20 > 0 && words33 > 0, 'both 20- and 33-word backups tried (' + words20 + ', ' + words33 + ')');

// 3. SLIP-0023 test vector 1 through ref_seed.py
const root = execFileSync(py, ['-c', `
import sys; sys.argv = ["x", "slip39:578d685d20b602683dc5171df411d3e2"]
sys.path.insert(0, ${JSON.stringify(here)})
from ref_seed import cardano_root
k, c = cardano_root(); print(int.from_bytes(k[:32], "little"), k[32:].hex(), c.hex())
`], { encoding: 'utf8' }).trim();
ok(root === '38096432269777187972282727382530464140043628323029465813805073381215192153792 4064253ffefc4127489bce1b825a47329010c5afb4d21154ef949ef786204405 22c12755afdd192742613b3062069390743ea232bc1b366c8f41e37292af9305', 'SLIP-0023 vector 1 root: ' + root);

console.log(`official vectors: ${vectors.length}, random backups: ${backups.length}, checks: ${checks}, failures: ${fails}`);
process.exit(fails ? 1 : 0);

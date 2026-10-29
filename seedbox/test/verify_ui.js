#!/usr/bin/env node
// verify_ui.js - the device's own UI code (seedbox.ino, built for the PC by sim/sim.cpp with a
// framebuffer for a screen and a script for a knob) taken through whole recoveries, and every
// address it derives compared with test_chains for the same secret:
//   1. 12 words (BIP39) with a passphrase typed on the passphrase keyboard
//   2. 20 words (SLIP-39), a 2-of-3 backup: one share, the same share again (refused), another
//   3. 33 words (SLIP-39), 2 of 3 groups (2-of-3, 1-of-1, 2-of-2), shares out of order, passphrase
//   4. a share of another backup in the middle (refused, the recovery goes on)
//   5. the idle timeout on the passphrase help screen: everything wiped, nothing derived after
//   6. a full 100-character passphrase, reopened for editing: one press adds nothing
//   7. an Electrum segwit seed (no BIP39 checksum) with a seed extension in mixed case
//   8. a phrase that is both a BIP39 phrase and an Electrum seed: asked, answered each way
//   9. a 13-word Electrum seed (standard), from "Other length"
// Screenshots of every step go to SHOTS=/some/dir when set.
// usage: PYTHON=/path/to/venv/bin/python node verify_ui.js     (needs ./build.sh, zlib, shamir-mnemonic)
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const here = __dirname, sim = path.join(here, 'sim'), py = process.env.PYTHON || 'python3';
let checks = 0, fails = 0;
const ok = (c, what) => { checks++; if (!c) { fails++; console.log('FAIL ' + what); } };

execFileSync('g++', ['-std=gnu++17', '-O1', '-w', '-I.', '-Iinc', '-I../../src/trezor', '-o', 'sim', '-x', 'c++', 'sim.cpp', '-x', 'none',
  ...fs.readdirSync(here).filter((f) => /^obj_.*\.o$/.test(f)).map((f) => '../' + f), '-lz'], { cwd: sim });

const shots = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'seedbox-ui-'));
function run(name, steps) {
  const dir = path.join(shots, name); fs.mkdirSync(dir, { recursive: true });
  return execFileSync(path.join(sim, 'sim'), [dir], { input: steps.join('\n') + '\n', encoding: 'utf8' });
}
const reference = (arg, pass) => execFileSync(path.join(here, 'test_chains'), pass ? [arg, pass] : [arg], { encoding: 'utf8' });
// enter a share whose first word is the list's first ("abandon" / "academic"): the sim fills the
// slots, then hold (to the word list) and press pick the first word and open the overview
const typeAll = (words) => ['words ' + words, 'hold', 'press'];
// on the passphrase keyboard (cursor on "a"): put the text in, then "done" (one step back) and "Yes"
const passphrase = (text) => ['cw 1', 'press', 'pass ' + text, 'ccw 1', 'press', 'press'];

// 1. BIP39 + passphrase
{
  const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const out = run('bip39', ['press', 'press', ...typeAll(m), 'press', ...passphrase('Correct horse'), 'wait 3000', 'shot addresses', 'dump']);
  ok(out === reference(m, 'Correct horse'), '12 words + passphrase: addresses differ from test_chains');
  ok(out !== reference(m), '12 words + passphrase: same as without');
}

// SLIP-39 backups from the reference implementation, identifier 7: every share starts "academic"
const sets = JSON.parse(execFileSync(py, ['-c', `
import json, os, shamir_mnemonic as s
s.shamir._random_identifier = lambda: 7
a_sec = os.urandom(16); a = s.generate_mnemonics(1, [(2, 3)], a_sec)[0]
b_sec = os.urandom(32); b = s.generate_mnemonics(2, [(2, 3), (1, 1), (2, 2)], b_sec, b"TREZOR", extendable=False)
s.shamir._random_identifier = lambda: 8
other = s.generate_mnemonics(1, [(2, 3)], os.urandom(16))[0]
print(json.dumps({"a": a, "a_sec": a_sec.hex(), "b": b, "b_sec": b_sec.hex(), "other": other}))
`], { encoding: 'utf8' }));

// 2. 20 words, 2 of 3, with the first share typed twice
{
  const a = sets.a;
  const out = run('slip39-20', ['press', 'cw 2', 'press', ...typeAll(a[0]), 'press', 'shot status', 'press',
    ...typeAll(a[0]), 'press', 'shot duplicate', 'press', 'press', ...typeAll(a[2]), 'press', 'press', 'wait 3000', 'shot addresses', 'dump']);
  ok(out === reference('slip39:' + sets.a_sec), '20-word 2-of-3: addresses differ from test_chains');
}

// 3. 33 words, 2 of 3 groups, out of order, passphrase TREZOR
{
  const g = sets.b, steps = ['press', 'cw 3', 'press', 'cw 4', 'press'];
  [g[2][0], g[0][0], g[2][1], g[1][0]].forEach((m, i, all) => { steps.push(...typeAll(m), 'press', 'shot status' + i); if (i < all.length - 1) steps.push('press'); });
  const out = run('slip39-33', [...steps, ...passphrase('TREZOR'), 'wait 8000', 'shot addresses', 'dump']);
  ok(out === reference('slip39:' + sets.b_sec), '33-word groups + passphrase: addresses differ from test_chains');
}

// 4. a share of another backup: refused, then the right one finishes the recovery
{
  const a = sets.a;
  const out = run('slip39-other', ['press', 'cw 2', 'press', ...typeAll(a[1]), 'press', 'press', ...typeAll(sets.other[0]), 'press', 'shot other-backup',
    'press', 'press', ...typeAll(a[2]), 'press', 'press', 'wait 3000', 'dump']);
  ok(out === reference('slip39:' + sets.a_sec), 'other backup share: recovery did not finish with the right addresses');
}

// 5. idle on "What is a passphrase?" until the wipe, then pick "No passphrase": no addresses
{
  const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const out = run('timeout', ['press', 'press', ...typeAll(m), 'press', 'cw 2', 'press', 'wait 310000', 'shot after-timeout', 'ccw 2', 'press', 'wait 3000', 'dump']);
  ok(out.trim() === 'NOT LOADED', 'timeout on the help screen still derived: ' + out.slice(0, 80));
}

// 6. 100 characters, "done", "Edit", press: still 100
{
  const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const out = run('passfull', ['press', 'press', ...typeAll(m), 'press', 'cw 1', 'press', 'pass ' + 'x'.repeat(100), 'ccw 1', 'press', 'cw 1', 'press', 'shot reopened', 'press', 'press', 'passlen']);
  ok(out.trim() === 'PASSLEN 100', 'full passphrase grew: ' + out.trim());
}

// Electrum seeds starting "abandon" (typeAll's first word): 11 random words until the version
// HMAC fits; `bip39` also wants the BIP39 checksum to pass, `bip39: false` wants it to fail.
const crypto = require('crypto');
const W = fs.readFileSync(path.join(here, '../src/trezor/bip39_english.c'), 'utf8').match(/"[a-z]+"/g).map((x) => x.slice(1, -1));
function bip39Valid(words) {
  const bits = words.map((w) => W.indexOf(w).toString(2).padStart(11, '0')).join('');
  const cs = bits.length / 33, ent = Buffer.from(bits.slice(0, bits.length - cs).match(/.{8}/g).map((b) => parseInt(b, 2)));
  return crypto.createHash('sha256').update(ent).digest()[0].toString(2).padStart(8, '0').slice(0, cs) === bits.slice(bits.length - cs);
}
function electrumSeed(n, prefix, bip39) {
  for (;;) {
    const w = ['abandon', ...Array.from({ length: n - 1 }, () => W[crypto.randomInt(2048)])], m = w.join(' ');
    if (!crypto.createHmac('sha512', 'Seed version').update(m).digest('hex').startsWith(prefix)) continue;
    if (n % 3 === 0 && bip39Valid(w) !== bip39) continue;
    return m;
  }
}
const electrumRef = (m, pass) => reference('electrum:' + m, pass).split('\n').filter((l) => l && !/^(type|payload)\|/.test(l)).join('\n') + '\n';

// 7. Electrum segwit seed + extension "Correct Horse" (Electrum lowercases it)
{
  const m = electrumSeed(12, '100', false);
  const out = run('electrum', ['press', 'press', ...typeAll(m), 'press', 'shot detected', 'press', ...passphrase('Correct Horse'), 'wait 3000', 'shot addresses', 'dump']);
  ok(out === electrumRef(m, 'Correct Horse'), 'Electrum segwit + extension: ' + out.slice(0, 120));
  ok(out === electrumRef(m, 'correct horse'), 'Electrum extension not case-insensitive');
}

// 8. both kinds at once: "Which wallet?" -> Electrum, and again -> Another wallet
{
  const m = electrumSeed(12, '01', true);
  const a = run('both-electrum', ['press', 'press', ...typeAll(m), 'press', 'shot which', 'ccw 1', 'press', 'press', 'wait 3000', 'dump']);
  ok(a === electrumRef(m, ''), 'ambiguous phrase, Electrum chosen: ' + a.slice(0, 120));
  const b = run('both-bip39', ['press', 'press', ...typeAll(m), 'press', 'press', 'press', 'wait 3000', 'dump']);
  ok(b === reference(m), 'ambiguous phrase, other wallet chosen: ' + b.slice(0, 120));
}

// 9. 13 words, standard Electrum seed, no extension
{
  const m = electrumSeed(13, '01');
  const out = run('electrum-13', ['press', 'cw 3', 'press', 'press', ...typeAll(m), 'press', 'press', 'press', 'wait 3000', 'shot addresses', 'dump']);
  ok(out === electrumRef(m, ''), '13-word Electrum seed: ' + out.slice(0, 120));
}

console.log(`flows: 9, checks: ${checks}, failures: ${fails}, screenshots: ${shots}`);
process.exit(fails ? 1 : 0);

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
  const g = sets.b, steps = ['press', 'cw 3', 'press', 'cw 3', 'press'];
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

console.log(`flows: 6, checks: ${checks}, failures: ${fails}, screenshots: ${shots}`);
process.exit(fails ? 1 : 0);

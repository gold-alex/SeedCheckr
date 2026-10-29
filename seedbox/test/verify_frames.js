#!/usr/bin/env node
// verify_frames.js - round trip the "more chains" frames (docs/EXTENSIONS.md) on the host:
//
//   random extension rows (types and lengths from the spec, core rows mixed in)
//   -> test_frames (the device's portfolio.c) -> extension bytes + frame texts
//   -> test_qr -f (the device's frame QR encoder) -> jsQR (independent reader)
//   -> docs/scan.js Assembler, frames shuffled with duplicates -> records == input
//   fountain frames: with chunks missing, or from fountain frames alone, the Assembler
//   rebuilds the same bytes; reports how many frames past n a reader needs on average
//
// Also: frames from another set (different CRC) are rejected, a corrupted chunk
// is rejected, and records() parses unknown types.
//
// usage: node verify_frames.js [N]    N random row sets (default 10)
// needs: ./build.sh first; `npm install` in this folder (jsQR)
'use strict';
const { execFileSync } = require('child_process');
const { randomBytes, randomInt } = require('crypto');
const path = require('path');
const zlib = require('zlib');
const S = require('../../docs/scan.js');
const jsQR = require('jsqr');

const N = parseInt(process.argv[2] || '10', 10);
const here = __dirname;

// [type, len] for every record type in the spec
const TYPES = [];
for (let t = 0x10; t <= 0x1A; t++) TYPES.push([t, 20]);
TYPES[1] = [0x11, 32];
for (let t = 0x20; t <= 0x28; t++) TYPES.push([t, 20]);
TYPES.push([0x29, 32], [0x2A, 33], [0x2B, 33], [0x2C, 20]);
for (let t = 0x30; t <= 0x3C; t++) TYPES.push([t, 20]);
for (const t of [0x50, 0x51, 0x52, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59]) TYPES.push([t, 32]);
TYPES.push([0x53, 20], [0x60, 56]);

let fails = 0, checks = 0;
function check(ok, what) { checks++; if (!ok) { fails++; console.log('FAIL: ' + what); } }
const hex = b => Buffer.from(b).toString('hex');

function deviceFrames(rows) {
  const input = rows.map(([t, b]) => t.toString(16).padStart(2, '0') + ' ' + hex(b)).join('\n') + '\n';
  const out = execFileSync(path.join(here, 'test_frames'), { input, encoding: 'utf8' }).trim().split('\n');
  const bytes = Buffer.from(out.find(l => l.startsWith('BYTES|')).slice(6), 'hex');
  const count = parseInt(out.find(l => l.startsWith('COUNT|')).slice(6), 10);
  const frames = out.filter(l => l.startsWith('FRAME|')).map(l => l.slice(6));
  const fount = out.filter(l => l.startsWith('FOUNT|')).map(l => l.slice(6));
  return { bytes, count, frames, fount };
}

function qrRead(text) {
  const grid = execFileSync(path.join(here, 'test_qr'), ['-f', text], { encoding: 'utf8' });
  const lines = grid.trim().split('\n');
  const [, v, s] = lines[0].match(/^V(\d+) S(\d+)$/);
  const size = parseInt(s, 10), scale = 4, quiet = 4, w = (size + 2 * quiet) * scale;
  const img = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (lines[1 + y][x] !== '#') continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4;
      img[i] = img[i + 1] = img[i + 2] = 0;
    }
  }
  const r = jsQR(img, w, w);
  return { version: parseInt(v, 10), data: r ? r.data : null };
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function randomRows(minBytes) {
  const rows = [];
  let len = 0;
  // always include the odd sizes (33 and 56 bytes), then random types until big enough
  for (const t of [[0x60, 56], [0x2A, 33]]) { rows.push([t[0], randomBytes(t[1])]); len += 2 + t[1]; }
  while (len < minBytes) {
    if (randomInt(5) === 0) rows.push([0, randomBytes([20, 32][randomInt(2)])]);   // core row: not in the frames
    const [t, l] = TYPES[randomInt(TYPES.length)];
    rows.push([t, randomBytes(l)]);
    len += 2 + l;
  }
  return shuffle(rows);
}

let maxVersion = 0, maxText = 0, report = [];
const extra = [];   // frames past n a reader needed, fountain trials
for (let k = 0; k < N; k++) {
  // 500..1500 bytes: 3 to 7 frames; the first run is ~1000 bytes for the report line
  const target = k === 0 ? 1000 : 500 + randomInt(1000);
  const rows = randomRows(target);
  const ext = rows.filter(([t]) => t !== 0);
  const { bytes, count, frames, fount } = deviceFrames(rows);

  // the device's bytes are exactly the spec's records
  const want = Buffer.concat(ext.map(([t, b]) => Buffer.concat([Buffer.from([t, b.length]), b])));
  check(bytes.equals(want), 'extension bytes differ from the spec layout');
  check(count === Math.ceil(want.length / 240) && frames.length === count, 'frame count ' + count);
  const crc = (zlib.crc32 ? zlib.crc32(want) : S.crc32(want)) >>> 0;
  check(crc === S.crc32(want), 'scan.js crc32 differs from zlib');

  // every frame through the device QR encoder and an independent reader
  const read = [];
  const versions = [];
  for (const f of frames) {
    maxText = Math.max(maxText, f.length);
    const r = qrRead(f);
    versions.push(r.version);
    maxVersion = Math.max(maxVersion, r.version);
    check(r.version <= 11, 'frame QR is v' + r.version);
    check(r.data === f, 'QR read back ' + (r.data === null ? 'nothing' : 'different text') + ' (v' + r.version + ')');
    read.push(r.data);
  }
  check(fount.length === 8 * count, 'fountain frames ' + fount.length);
  for (const f of fount.slice(0, 2 * count)) {
    maxText = Math.max(maxText, f.length);
    const r = qrRead(f);
    maxVersion = Math.max(maxVersion, r.version);
    check(r.version <= 11, 'fountain frame QR is v' + r.version);
    check(r.data === f, 'fountain QR read back ' + (r.data === null ? 'nothing' : 'different text'));
  }
  // chunks missing: the rest, then fountain frames in random order, rebuild the same bytes
  for (let trial = 0; trial < 20; trial++) {
    const keep = shuffle(frames.slice()).slice(randomInt(Math.min(count, 4) + 1));
    const a = new S.Assembler();
    let last = null, used = 0;
    for (const t of keep.concat(shuffle(fount.slice()))) { last = a.add(t); used++; if (last.done || last.error) break; }
    check(last.done && Buffer.from(last.bytes).equals(want), 'fountain rebuild failed (' + keep.length + ' of ' + count + ' chunks)');
    if (last.done) extra.push(used - count);
  }
  // fountain frames alone
  { const a = new S.Assembler(); let last = null;
    for (const t of shuffle(fount.slice())) { last = a.add(t); if (last.done) break; }
    check(last.done && Buffer.from(last.bytes).equals(want), 'fountain frames alone did not rebuild'); }
  if (k === 0) report.push(`${want.length} bytes of records -> ${count} frames, QR versions ${versions.join(',')}, longest frame text ${Math.max(...frames.map(f => f.length))} chars`);

  // assemble shuffled, with duplicates and noise
  const a = new S.Assembler();
  const stream = shuffle(read.concat(read.slice(0, randomInt(read.length) + 1), ['https://example.com/not-a-frame', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045']));
  let last = null, sawDone = 0;
  for (const t of stream) {
    last = a.add(t);
    if (last.done) sawDone++;
    if (last.error) check(false, 'assembler error: ' + last.error);
  }
  check(last.done && last.have === count && last.total === count, 'not done: ' + last.have + '/' + last.total);
  check(last.bytes && Buffer.from(last.bytes).equals(want), 'assembled bytes differ');
  const recs = S.records(last.bytes);
  check(recs.length === ext.length && recs.every((r, i) => r.type === ext[i][0] && Buffer.from(r.bytes).equals(ext[i][1])), 'records differ from input rows');

  // a frame of another set (different seed -> different CRC) is rejected, before and after done
  const other = deviceFrames(randomRows(target)).frames;
  const b = new S.Assembler();
  b.add(frames[0]);
  const rej = b.add(other[Math.min(1, other.length - 1)]);
  check(rej.rejected && !rej.added && rej.have === 1, 'frame from another CRC accepted');
  check(a.add(other[0]).rejected, 'frame from another CRC accepted after done');
  // same set id but a corrupted chunk: a parse failure or, at worst, a CRC failure at the end
  const c = new S.Assembler();
  const bad = frames[0].slice(0, -1) + (frames[0].slice(-1) === '0' ? '1' : '0');
  for (const t of [bad].concat(frames.slice(1))) c.add(t);
  const fin = c.add(frames[0]);
  check(!(fin.done && !Buffer.from(fin.bytes).equals(want)), 'corrupted chunk produced wrong bytes');
}

// the real device's frames for a mnemonic (14 today), with chunk frames missing, rebuilt
// from its first loop of fountain frames (for 14 chunks those 28 alone already span)
{
  const out = execFileSync(path.join(here, 'test_portfolio'), ['abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'], { encoding: 'utf8' }).split('\n');
  const src = out.filter(l => l.startsWith('FRAME|')).map(l => l.slice(6)), mix = out.filter(l => l.startsWith('FOUNT|')).map(l => l.slice(6));
  const whole = new S.Assembler(); let want = null;
  for (const t of src) want = whole.add(t);
  check(want.done && mix.length === 2 * src.length, 'device frames: ' + src.length + ' chunks, ' + mix.length + ' fountain');
  const need = [];
  for (let trial = 0; trial < 200; trial++) {
    const keep = shuffle(src.slice()).slice(1 + randomInt(src.length));   // 1 to n chunk frames missing
    const a = new S.Assembler(); let last = null, used = 0;
    for (const t of keep.concat(shuffle(mix.slice()))) { last = a.add(t); used++; if (last.done || last.error) break; }
    if (last.done) { check(Buffer.from(last.bytes).equals(Buffer.from(want.bytes)), 'device fountain rebuild differs'); need.push(used - src.length); }
    else check(false, 'device fountain rebuild failed with ' + keep.length + ' of ' + src.length + ' chunks');   // its first loop spans all 14
  }
  report.push('device: ' + src.length + ' chunk frames; with 1 to ' + src.length + ' of them missing, ' + need.length + ' of 200 rebuilt from one loop of fountain frames, frames past n needed: mean ' + (need.reduce((x, y) => x + y, 0) / need.length).toFixed(2));
}

// parser edge cases
check(S.parseFrame('SB2 0 3 00000000 1') === null, 'frame 0 accepted');
check(S.parseFrame('SB2 4 3 00000000 1') === null, 'short fountain frame accepted');
check(S.parseFrame('SB2 1000 3 00000000 1') === null, 'frame number above 999 accepted');
check(S.parseFrame('SB2 1 1 0000000a 1') === null, 'lowercase CRC accepted');
check(S.parseFrame('sb2 1 1 00000000 1') === null, 'lowercase tag accepted');
check(JSON.stringify(S.records(Uint8Array.from([0xEE, 2, 7, 8, 0x10, 0]))) === JSON.stringify([{ type: 0xEE, bytes: { 0: 7, 1: 8 } }, { type: 0x10, bytes: {} }]), 'records() with an unknown type');
let threw = false; try { S.records(Uint8Array.from([0x10, 20, 1])); } catch (e) { threw = true; }
check(threw, 'truncated record accepted');
// no extension rows: no frames
check(deviceFrames([[0, randomBytes(20)]]).count === 0, 'frames with no extension rows');

for (const r of report) console.log(r);
console.log('fountain: ' + extra.length + ' rebuilds, frames past n needed: mean ' + (extra.reduce((x, y) => x + y, 0) / extra.length).toFixed(2) + ', max ' + Math.max(...extra));
console.log(`row sets: ${N}, checks: ${checks}, failures: ${fails}, largest frame QR: v${maxVersion}, longest frame text: ${maxText} chars`);
process.exit(fails ? 1 : 0);

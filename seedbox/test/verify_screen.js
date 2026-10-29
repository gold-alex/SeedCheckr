#!/usr/bin/env node
// verify_screen.js - can a phone actually read the moving QR off this screen, and how
// long should each frame stay up?
//
// 1. Renders the device's real frames (test_portfolio FRAME| lines -> test_qr -f) onto the
//    160x128 panel exactly as paintQR draws them (2 px per module, white quiet zone,
//    black margins with label-like clutter).
// 2. "Films" the panel like a phone camera: 1280x720 sensor, the panel filling part of the
//    frame at 10-20 cm, tilt, off-centre framing, focus blur, LCD grey blacks / dim whites,
//    glare, sensor noise. Then runs the page's own decode path (docs/scan.js): 1920x1080
//    camera, centre square of <= 800 px at full resolution, jsQR with inversionAttempts 'dontInvert' (what iPhones use; Android's
//    BarcodeDetector is faster and more tolerant, so this is the worst case).
// 3. Monte Carlo of the loop: device shows each frame for T ms (redrawn in D ms, during
//    which a capture sees two codes mixed and fails); the page captures, decodes (measured
//    time x a phone slowdown factor), waits 30 ms, repeats. Reports the time to collect
//    every frame for several T.
//
// usage: node verify_screen.js [samples per condition, default 40]
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const jsQR = require('jsqr');

const N = parseInt(process.argv[2] || '40', 10);
const here = __dirname;
const MN = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const frames = execFileSync(path.join(here, 'test_portfolio'), [MN], { encoding: 'utf8' }).split('\n').filter((l) => l.startsWith('FRAME|')).map((l) => l.slice(6));
if (!frames.length) throw new Error('no frames: build test_portfolio first');

// ---- the panel, pixel for pixel ----
const W = 160, Hh = 128;
function panelFor(text, seed) {
  const g = execFileSync(path.join(here, 'test_qr'), ['-f', text], { encoding: 'utf8' }).trim().split('\n');
  const size = parseInt(g[0].match(/S(\d+)/)[1], 10);
  const img = new Float32Array(W * Hh);              // 0 = black, 1 = white (ideal panel)
  const cells = size + 2, sq = Math.min(W, Hh), s = Math.floor(sq / cells), px = s * cells;
  const x0 = (W - px) >> 1, y0 = (Hh - px) >> 1, qx = (W - sq) >> 1, qy = (Hh - sq) >> 1;
  for (let y = qy; y < qy + sq; y++) for (let x = qx; x < qx + sq; x++) img[y * W + x] = 1;
  for (let my = 0; my < size; my++) for (let mx = 0; mx < size; mx++) if (g[1 + my][mx] === '#')
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) img[(y0 + (my + 1) * s + dy) * W + x0 + (mx + 1) * s + dx] = 0;
  // margin labels: sparse bright pixels like the sideways text
  let r = seed; const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let y = 4; y < 100; y++) for (const x0m of [3, W - 12]) for (let x = x0m; x < x0m + 8; x++) if (rnd() < 0.3) img[y * W + x] = 0.9;
  return { img, size, version: parseInt(g[0].match(/V(\d+)/)[1], 10) };
}

// ---- the camera ----
function film(panel, o, rnd) {
  const CW = 1920, CH = 1080;                          // what docs/scan.js asks the camera for
  const scale = o.camPxPerPanelPx;                     // camera px per panel px
  const ang = o.tiltDeg * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  const cx = CW / 2 + o.offX * CW, cy = CH / 2 + o.offY * CH;
  const lo = o.black, hi = o.white;
  // the page takes the centre square of <= 800 px at full resolution, or after two misses
  // the whole picture height scaled to 800 px (docs/scan.js); o.wide picks the second
  const side = o.wide ? Math.min(CW, CH) : Math.min(CW, CH, 800), out = Math.min(side, 800), k = side / out;
  const sx0 = (CW - side) / 2, sy0 = (CH - side) / 2;
  const g = new Float32Array(out * out);
  for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) {
    const X = sx0 + x * k - cx, Y = sy0 + y * k - cy;    // camera coords relative to the panel centre
    let u = (ca * X + sa * Y) / scale + W / 2, v = (-sa * X + ca * Y) / scale + Hh / 2;
    u *= 1 + o.persp * (v / Hh - 0.5);                   // a little keystone
    let val = 0.02;                                      // outside the panel: dark bezel
    if (u >= 0 && v >= 0 && u < W - 1 && v < Hh - 1) {
      const iu = u | 0, iv = v | 0, fu = u - iu, fv = v - iv, I = panel.img;
      val = (I[iv * W + iu] * (1 - fu) + I[iv * W + iu + 1] * fu) * (1 - fv) + (I[(iv + 1) * W + iu] * (1 - fu) + I[(iv + 1) * W + iu + 1] * fu) * fv;
      val = lo + (hi - lo) * val;
      val += o.glare * Math.max(0, 1 - Math.hypot(x / out - 0.7, y / out - 0.3) * 2.5);
    }
    g[y * out + x] = val;
  }
  // focus blur (separable gaussian, sigma in output px)
  const sig = o.blur / k;
  if (sig > 0.3) {
    const R = Math.ceil(sig * 2.5), ker = []; let sum = 0;
    for (let i = -R; i <= R; i++) { const w = Math.exp(-(i * i) / (2 * sig * sig)); ker.push(w); sum += w; }
    for (let i = 0; i < ker.length; i++) ker[i] /= sum;
    const tmp = new Float32Array(out * out);
    for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) { let a = 0; for (let i = -R; i <= R; i++) { const xx = Math.min(out - 1, Math.max(0, x + i)); a += g[y * out + xx] * ker[i + R]; } tmp[y * out + x] = a; }
    for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) { let a = 0; for (let i = -R; i <= R; i++) { const yy = Math.min(out - 1, Math.max(0, y + i)); a += tmp[yy * out + x] * ker[i + R]; } g[y * out + x] = a; }
  }
  const rgba = new Uint8ClampedArray(out * out * 4);
  for (let i = 0; i < out * out; i++) {
    const n = (rnd() + rnd() + rnd() - 1.5) * o.noise;   // ~gaussian sensor noise
    const v = Math.max(0, Math.min(255, (g[i] + n) * 255));
    rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = v; rgba[4 * i + 3] = 255;
  }
  return { data: rgba, out };
}

function decodeRate(conds, label, wide) {
  let rs = 1;
  const rnd = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
  let ok = 0, wrong = 0, ms = 0, n = 0;
  for (let t = 0; t < N; t++) {
    const f = frames[t % frames.length];
    const panel = panelFor(f, t + 7);
    const o = {};
    for (const [k, [a, b]] of Object.entries(conds)) o[k] = a + (b - a) * rnd();
    o.wide = !!wide;
    const shot = film(panel, o, rnd);
    const t0 = process.hrtime.bigint();
    const r = jsQR(shot.data, shot.out, shot.out, { inversionAttempts: 'dontInvert' });
    ms += Number(process.hrtime.bigint() - t0) / 1e6; n++;
    if (r && r.data === f) ok++; else if (r) wrong++;
  }
  console.log(label.padEnd(44) + ('read ' + ok + '/' + N).padEnd(12) + (wrong ? 'WRONG ' + wrong + ' ' : '') + 'jsQR ' + (ms / n).toFixed(0) + ' ms/frame (this computer)');
  return { p: ok / N, ms: ms / n };
}

console.log('frames: ' + frames.length + ', QR versions: ' + frames.map((f) => panelFor(f, 1).version).join(','));
console.log('\n### one capture, decoded by the page\'s jsQR path (centre crop <= 800 px)');
// camera px per panel px at distance d (cm): the 3.5 cm wide panel against a ~70 degree main camera
const kpp = (d) => 1920 * 3.5 / (2 * d * Math.tan(35 * Math.PI / 180)) / 160;
const base = { camPxPerPanelPx: [kpp(13), kpp(11)], tiltDeg: [-6, 6], offX: [-0.05, 0.05], offY: [-0.05, 0.05], persp: [-0.05, 0.05], black: [0.08, 0.15], white: [0.75, 0.95], glare: [0, 0.1], noise: [0.02, 0.05], blur: [0.6, 1.4] };
const cond = (over) => Object.assign({}, base, over);
const rows = [
  ['typical: 11-13 cm, steady, in focus', cond({})],
  ['15 cm', cond({ camPxPerPanelPx: [kpp(16), kpp(14)] })],
  ['20 cm (phones that cannot focus closer)', cond({ camPxPerPanelPx: [kpp(21), kpp(19)] })],
  ['close: 7-8 cm', cond({ camPxPerPanelPx: [kpp(8), kpp(7)], blur: [1.2, 2.2] })],
  ['soft focus', cond({ blur: [2.0, 3.0] })],
  ['tilted 10-15 deg', cond({ tiltDeg: [10, 15] })],
  ['off centre (15% of the frame)', cond({ offX: [0.12, 0.15], offY: [-0.12, 0.12] })],
  ['washed-out LCD + glare', cond({ black: [0.2, 0.3], white: [0.65, 0.8], glare: [0.15, 0.3] })],
  ['noisy (dim room)', cond({ noise: [0.08, 0.12] })],
];
const res = {};
for (const [l, c] of rows) res[l] = decodeRate(c, l);
const wideTypical = decodeRate(rows[0][1], 'typical, wide view (after two misses)', true);

// ---- timing ----
console.log('\n### time to collect all ' + frames.length + ' frames (Monte Carlo, 2000 runs each)');
const typical = res['typical: 11-13 cm, steady, in focus'];
// The device's sequence (seedbox.ino moreFrameAt): the n chunks, then 2n fountain frames
// with fresh numbers each loop. fountain = false: the old loop of the n chunks alone.
const S = require('../../docs/scan.js');
function frameAt(pos, n, fountain) {
  if (!fountain) return pos % n + 1;
  const loop = Math.floor(pos / (3 * n)), k = pos % (3 * n);
  return k < n ? k + 1 : n + 1 + (loop * 2 * n + (k - n)) % (999 - n);
}
const maskOf = (i, n) => i <= n ? 1 << (i - 1) : S.fountainMask(i, n).reduce((m, b, j) => m | (b << j), 0);   // n < 31
function sim(T, D, p, pWide, decodeMs, runs, fountain) {
  let r = 99; const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const n = frames.length, times = [], span = T * n * (fountain ? 3 : 1);
  for (let k = 0; k < runs; k++) {
    // the user starts at a random point in the loop; got: XOR basis of what was read (rank = chunks known)
    const t0 = rnd() * span;
    let t = t0, guard = 0, misses = 0, rank = 0;
    const basis = new Array(n).fill(0);
    while (rank < n && guard++ < 100000) {
      const pos = Math.floor(t / T), into = t - pos * T;
      const exposure = 16;                               // ms the sensor integrates one frame
      const clean = into >= D + exposure || into < 0;    // a capture spanning the redraw sees two codes
      const wide = misses % 3 === 2;                     // the scanner's wide view after two misses
      const hit = clean && rnd() < (wide ? pWide : p);
      if (hit) {
        let m = maskOf(frameAt(pos, n, fountain), n);
        for (let j = n - 1; j >= 0 && m; j--) if (m >> j & 1) { if (basis[j]) m ^= basis[j]; else { basis[j] = m; rank++; m = 0; } }
        misses = 0;
      } else misses++;
      t += decodeMs + 20 + rnd() * 60;                   // the page's jittered scan interval
    }
    times.push(t - t0);                                  // from the first look, wherever the loop was
  }
  times.sort((a, b) => a - b);
  return { med: times[runs >> 1] / 1000, p90: times[Math.floor(runs * 0.9)] / 1000 };
}
const D = 12;                                            // ms: measured on the board as "MORE i/n Xms"; 10-15 expected
for (const phone of [{ name: 'fast phone (jsQR 2x this computer)', f: 2 }, { name: 'older phone (jsQR 5x)', f: 5 }]) {
  for (const p of [...new Set([typical.p, Math.min(typical.p, 0.6)])]) {
    for (const fountain of [false, true]) {
      const line = [];
      for (const T of [250, 400, 500, 700, 1000]) { const s = sim(T, D, p, wideTypical.p * (p / typical.p), typical.ms * phone.f, 2000, fountain); line.push(T + 'ms: ' + s.med.toFixed(1) + 's/' + s.p90.toFixed(1) + 's'); }
      console.log((phone.name + ', p=' + p.toFixed(2) + (fountain ? ', fountain' : ', chunks only')).padEnd(60) + line.join('  '));
    }
  }
}
console.log('(median / 90th percentile seconds to finish, per frame duration T; the device uses 400 ms)');

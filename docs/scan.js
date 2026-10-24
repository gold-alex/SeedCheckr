// scan.js - reads the SeedBox "more chains" frames (format: docs/EXTENSIONS.md)
// with the phone camera, from inside the page.
//
// Pure functions (parseFrame, Assembler, records, crc32, base43Decode) run in a
// browser and in node; seedbox/test/verify_frames.js requires this file.
// The camera part uses BarcodeDetector when the browser has it, otherwise it
// loads vendor/jsQR.js (next to this file) on first use. No other dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeedScan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const B43 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:';
  const CHUNK = 240;
  const FRAME_RE = /^SB2 ([1-9][0-9]*) ([1-9][0-9]*) ([0-9A-F]{8}) ([0-9A-Z$*+\-./:]+)$/;

  // ---- bytes ----
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function crcHex(bytes) { return crc32(bytes).toString(16).toUpperCase().padStart(8, '0'); }

  // base43 text -> big-endian bytes (no leading zero bytes, as the device encodes them)
  function base43Decode(text) {
    let n = 0n;
    for (const ch of text) {
      const d = B43.indexOf(ch);
      if (d < 0) throw new Error('bad base43 character ' + JSON.stringify(ch));
      n = n * 43n + BigInt(d);
    }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  // ---- frames ----
  // "SB2 <i> <n> <CRC> <DATA>" -> { i, n, crc, chunk }, or null if the text is not a
  // well formed frame (another QR, a misread, a chunk of the wrong size).
  const MAX_FRAMES = 64;   // 64 x 240 bytes is far beyond any SeedBox (today 6 frames)
  function parseFrame(text) {
    if (typeof text !== 'string') return null;
    const m = FRAME_RE.exec(text.trim());
    if (!m) return null;
    const i = parseInt(m[1], 10), n = parseInt(m[2], 10);
    if (i < 1 || i > n || n > MAX_FRAMES) return null;   // a foreign QR must not make us allocate millions of slots
    let raw;
    try { raw = base43Decode(m[4]); } catch (e) { return null; }
    if (raw.length < 2 || raw[0] !== 0x01) return null;
    const chunk = raw.slice(1);
    if (chunk.length > CHUNK || (i < n && chunk.length !== CHUNK)) return null;
    return { i, n, crc: m[3], chunk };
  }

  // Collects frames in any order. The first good frame fixes the set (its n and
  // CRC); frames from another set are rejected, duplicates are ignored. add()
  // returns the progress:
  //   { have, total, done, bytes, added, duplicate, rejected, error }
  // bytes is the joined extension (Uint8Array) once done, else null.
  // added: this frame was new. rejected: not a frame, or from another set.
  // error: the joined bytes failed the CRC (should not happen; the set is reset).
  class Assembler {
    constructor() { this.reset(); }
    reset() { this.n = 0; this.crc = null; this.chunks = []; this.have = 0; this.bytes = null; }
    progress(extra) {
      return Object.assign({ have: this.have, total: this.n, done: !!this.bytes, bytes: this.bytes,
                             added: false, duplicate: false, rejected: false, error: null }, extra);
    }
    add(text) {
      const f = parseFrame(text);
      if (!f) return this.progress({ rejected: true });
      if (this.crc === null) { this.n = f.n; this.crc = f.crc; this.chunks = new Array(f.n).fill(null); }
      else if (f.crc !== this.crc || f.n !== this.n) return this.progress({ rejected: true });
      if (this.chunks[f.i - 1]) return this.progress({ duplicate: true });
      this.chunks[f.i - 1] = f.chunk;
      this.have++;
      if (this.have === this.n) {
        const len = this.chunks.reduce((a, c) => a + c.length, 0);
        const all = new Uint8Array(len);
        let off = 0;
        for (const c of this.chunks) { all.set(c, off); off += c.length; }
        if (crcHex(all) !== this.crc) { this.reset(); return this.progress({ error: 'CRC mismatch, scan again' }); }
        this.bytes = all;
      }
      return this.progress({ added: true });
    }
  }

  // Extension bytes -> [{ type, bytes }], in device row order. Unknown types are
  // returned too; the caller skips what it does not know.
  function records(bytes) {
    const out = [];
    let off = 0;
    while (off < bytes.length) {
      if (off + 2 > bytes.length) throw new Error('truncated record header at ' + off);
      const type = bytes[off], len = bytes[off + 1];
      if (off + 2 + len > bytes.length) throw new Error('truncated record at ' + off);
      out.push({ type, bytes: bytes.slice(off + 2, off + 2 + len) });
      off += 2 + len;
    }
    return out;
  }

  // ---- camera ----
  // Remembered at load time: vendor/jsQR.js is resolved against this script's URL.
  const SCRIPT_URL = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  let jsQRPromise = null;
  function loadJsQR() {
    if (typeof self !== 'undefined' && self.jsQR) return Promise.resolve(self.jsQR);
    if (!jsQRPromise) jsQRPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('vendor/jsQR.js', SCRIPT_URL || document.baseURI).href;
      s.onload = () => self.jsQR ? resolve(self.jsQR) : reject(new Error('jsQR did not load'));
      s.onerror = () => { jsQRPromise = null; reject(new Error('could not load vendor/jsQR.js')); };
      document.head.appendChild(s);
    });
    return jsQRPromise;
  }

  // A detect(source) -> Promise<string[]> function: BarcodeDetector if it reads QR
  // codes here, else jsQR on a canvas copy of the video's center square.
  async function makeDetector() {
    if (typeof BarcodeDetector !== 'undefined') {
      try {
        const formats = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : ['qr_code'];
        if (formats.includes('qr_code')) {
          const bd = new BarcodeDetector({ formats: ['qr_code'] });
          return { kind: 'BarcodeDetector', detect: async v => (await bd.detect(v)).map(c => c.rawValue) };
        }
      } catch (e) { /* fall through to jsQR */ }
    }
    const jsQR = await loadJsQR();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let misses = 0;
    return {
      kind: 'jsQR',
      detect: async v => {
        const vw = v.videoWidth, vh = v.videoHeight;
        if (!vw || !vh) return [];
        // the device's screen sits in the middle of the picture: take the centre square at
        // full camera resolution (never scaled down: the QR's modules are only 2 panel px,
        // and from 15-20 cm, where many phones can still focus, every camera pixel counts).
        // seedbox/test/verify_screen.js: about 2 in 3 single captures read at 15 cm this way,
        // against about 1 in 3 for a 720p picture scaled to fit.
        // After two misses in a row, one attempt looks at the whole picture height instead
        // (scaled to 800 px), so a screen that is not in the middle of the picture is still
        // found; a centred screen keeps getting the sharp full-resolution view.
        const wide = misses % 3 === 2;
        const side = wide ? Math.min(vw, vh) : Math.min(vw, vh, 800), out = Math.min(side, 800);
        if (canvas.width !== out) { canvas.width = out; canvas.height = out; }
        ctx.drawImage(v, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, out, out);
        const img = ctx.getImageData(0, 0, out, out);
        const r = jsQR(img.data, out, out, { inversionAttempts: 'dontInvert' });
        misses = r ? 0 : misses + 1;
        return r ? [r.data] : [];
      },
    };
  }

  // Starts the back camera into videoEl and calls onFrameText(text) for every QR
  // text it reads (each distinct text once in a row, any QR, not only frames).
  // Returns stop(), which releases the camera. stop.ready is a Promise that
  // resolves to 'BarcodeDetector' or 'jsQR' once the camera is running, and
  // rejects if the camera or the decoder is unavailable (permission denied, no
  // HTTPS, no camera); the camera is already released in that case.
  function startCamera(videoEl, onFrameText) {
    let stopped = false, stream = null, timer = null, last = null;
    function stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (stream) for (const t of stream.getTracks()) t.stop();
      stream = null;
      try { videoEl.pause(); } catch (e) { /* ignore */ }
      videoEl.srcObject = null;
    }
    stop.ready = (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no camera access in this browser (the page must be on https)');
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      // keep refocusing while the phone moves in (ignored where the camera cannot)
      try {
        const tr = s.getVideoTracks()[0], caps = tr.getCapabilities ? tr.getCapabilities() : {};
        // applyConstraints replaces the whole set, so the resolution goes in the same call
        if (caps.focusMode && caps.focusMode.includes('continuous'))
          await tr.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: 'continuous' }] });
      } catch (e) { /* not supported: the camera keeps its own focus */ }
      if (stopped) { for (const t of s.getTracks()) t.stop(); throw new Error('stopped'); }
      stream = s;
      videoEl.setAttribute('playsinline', '');   // iOS: play inline, not fullscreen
      videoEl.muted = true;
      videoEl.srcObject = s;
      await videoEl.play();
      const det = await makeDetector();
      const tick = async () => {
        if (stopped) return;
        try {
          if (videoEl.readyState >= 2) {
            for (const text of await det.detect(videoEl)) {
              if (text === last || stopped) continue;
              last = text;
              onFrameText(text);
            }
          }
        } catch (e) { /* a frame that fails to decode is normal */ }
        // a little jitter, so the decode rhythm cannot lock onto the device's frame rhythm
        // and keep missing the same frames
        if (!stopped) timer = setTimeout(tick, 20 + Math.random() * 60);
      };
      tick();
      return det.kind;
    })().catch(e => { stop(); throw e; });
    return stop;
  }

  return { CHUNK, crc32, base43Decode, parseFrame, Assembler, records, startCamera, loadJsQR };
});

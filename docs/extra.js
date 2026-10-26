// extra.js - the "more chains" records (docs/EXTENSIONS.md) turned into addresses and
// balance checks. The device sends public key material only; this file rebuilds each
// chain's address format and says how to ask a public API for its balance.
// Runs in the browser and in node (the host tests require it). No dependencies.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeedExtra = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------- small crypto, all synchronous ----------------
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const cat = (...arrs) => { const o = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0)); let p = 0; for (const x of arrs) { o.set(x, p); p += x.length; } return o; };
  const utf8 = (s) => new TextEncoder().encode(s);

  // SHA-256 / SHA-224 (FIPS 180-4). WebCrypto has no SHA-224, and a sync SHA-256 keeps base58check simple.
  const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha2_32(msg, iv, outLen) {
    const H = new Uint32Array(iv);
    const l = msg.length, nb = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(nb); m.set(msg); m[l] = 0x80;
    const bits = l * 8; for (let i = 0; i < 8; i++) m[nb - 1 - i] = Math.floor(bits / 2 ** (8 * i)) & 0xff;
    const W = new Uint32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = H[i] >>> 16; out[4 * i + 2] = H[i] >>> 8; out[4 * i + 3] = H[i]; }
    return out.slice(0, outLen);
  }
  const sha256 = (m) => sha2_32(m, [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], 32);
  const sha224 = (m) => sha2_32(m, [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4], 28);

  // SHA-512/256 (Algorand checksum), with BigInt lanes: inputs here are 32 bytes.
  const K512 = ['428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc', '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118', 'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2', '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694', 'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65', '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5', '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4', 'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70', '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df', '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b', 'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30', 'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8', '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8', '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3', '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec', '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b', 'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178', '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b', '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c', '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817'].map((x) => BigInt('0x' + x));
  const IV512_256 = ['22312194fc2bf72c', '9f555fa3c84c64c2', '2393b86b6f53b151', '963877195940eabd', '96283ee2a88effe3', 'be5e1e2553863992', '2b0199fc2c85b8aa', '0eb72ddc81c52ca2'];
  const IV512 = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'];
  const sha512_256 = (msg) => sha512core(msg, IV512_256, 32);
  const sha512 = (msg) => sha512core(msg, IV512, 64);
  function hmacSha512(key, msg) {
    const k = new Uint8Array(128); k.set(key.length > 128 ? sha512(key) : key);
    const ip = k.map((x) => x ^ 0x36), op = k.map((x) => x ^ 0x5c);
    return sha512(cat(op, sha512(cat(ip, msg))));
  }
  function sha512core(msg, iv, outLen) {
    const M = (1n << 64n) - 1n, rot = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M;
    const H = iv.map((x) => BigInt('0x' + x));
    const l = msg.length, nb = ((l + 17 + 127) >> 7) << 7;
    const m = new Uint8Array(nb); m.set(msg); m[l] = 0x80;
    const bits = BigInt(l) * 8n; for (let i = 0; i < 16; i++) m[nb - 1 - i] = Number((bits >> BigInt(8 * i)) & 0xffn);
    for (let o = 0; o < nb; o += 128) {
      const W = [];
      for (let i = 0; i < 16; i++) { let v = 0n; for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(m[o + 8 * i + j]); W.push(v); }
      for (let i = 16; i < 80; i++) {
        const s0 = rot(W[i - 15], 1) ^ rot(W[i - 15], 8) ^ (W[i - 15] >> 7n), s1 = rot(W[i - 2], 19) ^ rot(W[i - 2], 61) ^ (W[i - 2] >> 6n);
        W.push((W[i - 16] + s0 + W[i - 7] + s1) & M);
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 80; i++) {
        const t1 = (h + (rot(e, 14) ^ rot(e, 18) ^ rot(e, 41)) + ((e & f) ^ (~e & M & g)) + K512[i] + W[i]) & M;
        const t2 = ((rot(a, 28) ^ rot(a, 34) ^ rot(a, 39)) + ((a & b) ^ (a & c) ^ (b & c))) & M;
        h = g; g = f; f = e; e = (d + t1) & M; d = c; c = b; b = a; a = (t1 + t2) & M;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) & M; });
    }
    const out = new Uint8Array(outLen);
    for (let i = 0; i < outLen / 8; i++) for (let j = 0; j < 8; j++) out[8 * i + j] = Number((H[i] >> BigInt(56 - 8 * j)) & 0xffn);
    return out;
  }

  // RIPEMD-160 (for HASH160 = RIPEMD160(SHA256(x))); browsers have no built-in one.
  function ripemd160(msg) {
    const rl = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13];
    const rr = [5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11];
    const sl = [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6];
    const sr = [8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11];
    const KL = [0, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e], KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0];
    const f = (j, x, y, z) => (j < 16 ? x ^ y ^ z : j < 32 ? (x & y) | (~x & z) : j < 48 ? (x | ~y) ^ z : j < 64 ? (x & z) | (y & ~z) : x ^ (y | ~z));
    const rol = (x, n) => (x << n) | (x >>> (32 - n));
    const l = msg.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb); m.set(msg); m[l] = 0x80;
    const bits = l * 8; for (let i = 0; i < 8; i++) m[nb - 8 + i] = Math.floor(bits / 2 ** (8 * i)) & 0xff;
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    for (let o = 0; o < nb; o += 64) {
      const X = []; for (let i = 0; i < 16; i++) X.push(m[o + 4 * i] | (m[o + 4 * i + 1] << 8) | (m[o + 4 * i + 2] << 16) | (m[o + 4 * i + 3] << 24));
      let al = h0, bl = h1, cl = h2, dl = h3, el = h4, ar = h0, br = h1, cr = h2, dr = h3, er = h4;
      for (let j = 0; j < 80; j++) {
        let t = (rol((al + f(j, bl, cl, dl) + X[rl[j]] + KL[j >> 4]) | 0, sl[j]) + el) | 0;
        al = el; el = dl; dl = rol(cl, 10); cl = bl; bl = t;
        t = (rol((ar + f(79 - j, br, cr, dr) + X[rr[j]] + KR[j >> 4]) | 0, sr[j]) + er) | 0;
        ar = er; er = dr; dr = rol(cr, 10); cr = br; br = t;
      }
      const t = (h1 + cl + dr) | 0; h1 = (h2 + dl + er) | 0; h2 = (h3 + el + ar) | 0; h3 = (h4 + al + br) | 0; h4 = (h0 + bl + cr) | 0; h0 = t;
    }
    const out = new Uint8Array(20);
    [h0, h1, h2, h3, h4].forEach((v, i) => { for (let k = 0; k < 4; k++) out[4 * i + k] = (v >>> (8 * k)) & 0xff; });
    return out;
  }
  const hash160 = (b) => ripemd160(sha256(b));

  // secp256k1, just enough for public child derivation (BIP32 CKDpub).
  const SP = (1n << 256n) - (1n << 32n) - 977n, SN = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const SG = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
  const mod = (a) => ((a % SP) + SP) % SP;
  function inv(a) { let [r0, r1, s0, s1] = [mod(a), SP, 1n, 0n]; while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; } return mod(s0); }
  function padd(A, B) {
    if (!A) return B; if (!B) return A;
    if (A[0] === B[0]) { if (mod(A[1] + B[1]) === 0n) return null; const l = mod(3n * A[0] * A[0] * inv(2n * A[1])); const x = mod(l * l - 2n * A[0]); return [x, mod(l * (A[0] - x) - A[1])]; }
    const l = mod((B[1] - A[1]) * inv(B[0] - A[0])); const x = mod(l * l - A[0] - B[0]); return [x, mod(l * (A[0] - x) - A[1])];
  }
  // k * P in Jacobian coordinates (one inversion at the end instead of one per step):
  // a wallet scan derives dozens of addresses, on a phone, while the page stays responsive.
  function pmul(k, P) {
    let X = 0n, Y = 1n, Z = 0n;                                           // the point at infinity
    const double = () => {
      if (Z === 0n) return;
      const YY = mod(Y * Y), S = mod(4n * X * YY), M = mod(3n * X * X), X3 = mod(M * M - 2n * S);
      const Y3 = mod(M * (S - X3) - 8n * YY * YY), Z3 = mod(2n * Y * Z);
      X = X3; Y = Y3; Z = Z3;
    };
    const addAffine = (x2, y2) => {                                       // (X,Y,Z) += (x2,y2)
      if (Z === 0n) { X = x2; Y = y2; Z = 1n; return; }
      const ZZ = mod(Z * Z), U2 = mod(x2 * ZZ), S2 = mod(y2 * ZZ * Z), Hh = mod(U2 - X), r = mod(S2 - Y);
      if (Hh === 0n) { if (r === 0n) double(); else Z = 0n; return; }
      const HH = mod(Hh * Hh), HHH = mod(HH * Hh), V = mod(X * HH);
      const X3 = mod(r * r - HHH - 2n * V), Y3 = mod(r * (V - X3) - Y * HHH), Z3 = mod(Z * Hh);
      X = X3; Y = Y3; Z = Z3;
    };
    for (let i = BigInt(k.toString(2).length) - 1n; i >= 0n; i--) { double(); if ((k >> i) & 1n) addAffine(P[0], P[1]); }
    if (Z === 0n) return null;
    const zi = inv(Z), zi2 = mod(zi * zi);
    return [mod(X * zi2), mod(Y * zi2 * zi)];
  }
  const big = (b) => { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; };
  const be32 = (v) => { const o = new Uint8Array(32); for (let i = 31; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
  function decompress(pub33) { const x = big(pub33.slice(1)); let y = 1n, b = mod(x * x * x + 7n), e = (SP + 1n) / 4n; while (e) { if (e & 1n) y = mod(y * b); b = mod(b * b); e >>= 1n; } if ((y & 1n) !== BigInt(pub33[0] & 1)) y = SP - y; return [x, y]; }
  const compress = (P) => cat(Uint8Array.of(P[1] & 1n ? 3 : 2), be32(P[0]));
  function ckdPub(pub33, chain, i) {   // non-hardened child i of (pub33, chain)
    const I = hmacSha512(chain, cat(pub33, Uint8Array.of(i >>> 24, (i >>> 16) & 255, (i >>> 8) & 255, i & 255)));
    const il = big(I.slice(0, 32)); if (il >= SN) throw new Error('invalid child');
    const P = padd(pmul(il, SG), decompress(pub33)); if (!P) throw new Error('invalid child');
    return { pub: compress(P), chain: I.slice(32) };
  }
  // First receive address hash (m/.../0/0) of an account xpub record (0x70-0x73 layout).
  function firstPkh(rec) { const c = ckdPub(rec.slice(36, 69), rec.slice(4, 36), 0); return hash160(ckdPub(c.pub, c.chain, 0).pub); }

  // Address of a child public key, per wallet kind.
  function taprootKey(pub33) {                                           // BIP86: Q = P + H_TapTweak(P)G, P with even y
    let P = decompress(pub33); if (P[1] & 1n) P = [P[0], SP - P[1]];
    const xo = be32(P[0]), tag = sha256(utf8('TapTweak'));
    const t = big(sha256(cat(tag, tag, xo))); if (t >= SN) throw new Error('invalid tweak');
    return be32(padd(pmul(t, SG), P)[0]);
  }
  function walletAddr(kind, pub33) {
    if (kind === 'btc-tr') return bech32('bc', [1, ...toWords(taprootKey(pub33))], true);
    if (kind === 'btc-wpkh') return bech32('bc', [0, ...toWords(hash160(pub33))]);
    if (kind === 'ltc-wpkh') return bech32('ltc', [0, ...toWords(hash160(pub33))]);
    if (kind === 'ltc-pkh') return base58check(cat(Uint8Array.of(0x30), hash160(pub33)));
    if (kind === 'doge-pkh') return base58check(cat(Uint8Array.of(0x1e), hash160(pub33)));
    if (kind === 'dash-pkh') return base58check(cat(Uint8Array.of(0x4c), hash160(pub33)));
    if (kind === 'eth') { const P = decompress(pub33); return eip55(keccakAddr(P)); }
    throw new Error('unknown kind ' + kind);
  }
  function keccakAddr(P) {
    const D = (typeof self !== 'undefined' && self.SeedDecode) || (typeof require === 'function' ? require('./decode.js') : null);
    return D.keccak256(cat(be32(P[0]), be32(P[1]))).slice(12);
  }
  // Child addresses of an account key (rec: fp || chain code || pubkey), chain 0 = receive, 1 = change.
  function childAddrs(rec, kind, chainIdx, from, count) {
    const c = ckdPub(rec.slice(36, 69), rec.slice(4, 36), chainIdx), out = [];
    for (let i = from; i < from + count; i++) out.push(walletAddr(kind, ckdPub(c.pub, c.chain, i).pub));
    return out;
  }
  // Gap-limit scan: walk receive and change addresses in batches until `gap` unused ones in a row.
  // query(addr) -> { used: bool, sats: BigInt }. Returns { sats, used, first }.
  async function scanWallet(rec, kind, query, gaps, per = 5) {
    let sats = 0n, used = 0;
    for (const [chainIdx, gap] of [[0, gaps[0]], [1, gaps[1]]]) {
      let i = 0, empty = 0;
      while (empty < gap && i < 400) {
        const batch = childAddrs(rec, kind, chainIdx, i, per);
        const res = await Promise.all(batch.map(query));
        for (const r of res) { if (r.used) { used++; empty = 0; sats += r.sats; } else empty++; }
        i += per;
      }
    }
    return { sats, used, first: childAddrs(rec, kind, 0, 0, 1)[0] };
  }

  // BLAKE2b with any output length (RFC 7693), BigInt lanes; inputs here are tiny.
  const B2IV = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'].map((x) => BigInt('0x' + x));
  const SIGMA = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3], [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4], [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8], [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13], [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9], [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11], [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10], [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5], [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0]];
  function blake2b(msg, outlen) {
    const M = (1n << 64n) - 1n, rot = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M;
    const h = B2IV.slice(); h[0] ^= 0x01010000n ^ BigInt(outlen);
    const blocks = Math.max(1, Math.ceil(msg.length / 128));
    for (let bi = 0; bi < blocks; bi++) {
      const last = bi === blocks - 1;
      const blk = new Uint8Array(128); blk.set(msg.subarray(bi * 128, bi * 128 + 128));
      const m = []; for (let i = 0; i < 16; i++) { let v = 0n; for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(blk[8 * i + j]); m.push(v); }
      const v = h.concat(B2IV);
      const t = BigInt(last ? msg.length : (bi + 1) * 128);
      v[12] ^= t & M; v[13] ^= t >> 64n; if (last) v[14] ^= M;
      const G = (a, b, c, d, x, y) => {
        v[a] = (v[a] + v[b] + x) & M; v[d] = rot(v[d] ^ v[a], 32); v[c] = (v[c] + v[d]) & M; v[b] = rot(v[b] ^ v[c], 24);
        v[a] = (v[a] + v[b] + y) & M; v[d] = rot(v[d] ^ v[a], 16); v[c] = (v[c] + v[d]) & M; v[b] = rot(v[b] ^ v[c], 63);
      };
      for (let r = 0; r < 12; r++) {
        const s = SIGMA[r % 10];
        G(0, 4, 8, 12, m[s[0]], m[s[1]]); G(1, 5, 9, 13, m[s[2]], m[s[3]]); G(2, 6, 10, 14, m[s[4]], m[s[5]]); G(3, 7, 11, 15, m[s[6]], m[s[7]]);
        G(0, 5, 10, 15, m[s[8]], m[s[9]]); G(1, 6, 11, 12, m[s[10]], m[s[11]]); G(2, 7, 8, 13, m[s[12]], m[s[13]]); G(3, 4, 9, 14, m[s[14]], m[s[15]]);
      }
      for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
    }
    const out = new Uint8Array(outlen);
    for (let i = 0; i < outlen; i++) out[i] = Number((h[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn);
    return out;
  }

  function crc32(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; }
  function crc16xmodem(b) { let c = 0; for (const x of b) { c ^= x << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; }

  // ---------------- encodings ----------------
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function base58(bytes) {
    let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
    let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
    return s;
  }
  const base58check = (payload) => base58(cat(payload, sha256(sha256(payload)).slice(0, 4)));
  function base32(bytes, lower) {
    const A = lower ? 'abcdefghijklmnopqrstuvwxyz234567' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let out = '', acc = 0, bits = 0;
    for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out += A[(acc >>> bits) & 31]; } acc &= 0xff; }
    if (bits) out += A[(acc << (5 - bits)) & 31];
    return out;
  }
  const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  function polymod(v) { const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let c = 1; for (const x of v) { const t = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((t >>> i) & 1) c ^= G[i]; } return c >>> 0; }
  function toWords(bytes) { const o = []; let a = 0, n = 0; for (const x of bytes) { a = ((a << 8) | x) & 0x1fff; n += 8; while (n >= 5) { n -= 5; o.push((a >>> n) & 31); } } if (n) o.push((a << (5 - n)) & 31); return o; }
  function bech32(hrp, words, bech32m) {
    const e = []; for (const c of hrp) e.push(c.charCodeAt(0) >>> 5); e.push(0); for (const c of hrp) e.push(c.charCodeAt(0) & 31);
    const pm = (polymod([...e, ...words, 0, 0, 0, 0, 0, 0]) ^ (bech32m ? 0x2bc830a3 : 1)) >>> 0;
    let s = hrp + '1'; for (const w of words) s += BECH[w]; for (let i = 0; i < 6; i++) s += BECH[(pm >>> (5 * (5 - i))) & 31];
    return s;
  }
  const bech32Bytes = (hrp, bytes) => bech32(hrp, toWords(bytes));
  // CashAddr (BCH, eCash) and Kaspa share this checksum; Kaspa uses its own version byte meaning.
  function cashaddr(prefix, version, payload) {
    const words = toWords(cat(Uint8Array.of(version), payload));
    const G = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
    let c = 1n;
    for (const d of [...[...prefix].map((ch) => ch.charCodeAt(0) & 31), 0, ...words, 0, 0, 0, 0, 0, 0, 0, 0]) {
      const c0 = c >> 35n; c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
      for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= G[i];
    }
    c ^= 1n;
    let out = prefix + ':'; for (const w of words) out += BECH[w];
    for (let i = 0; i < 8; i++) out += BECH[Number((c >> BigInt(5 * (7 - i))) & 31n)];
    return out;
  }
  function eip55(a20) {
    // keccak lives in decode.js; this module stays standalone by asking for it lazily.
    const D = (typeof self !== 'undefined' && self.SeedDecode) || (typeof require === 'function' ? require('./decode.js') : null);
    const low = hex(a20), hh = hex(D.keccak256(utf8(low)));
    let out = '0x'; for (let i = 0; i < 40; i++) out += parseInt(hh[i], 16) >= 8 ? low[i].toUpperCase() : low[i];
    return out;
  }

  // ---------------- address builders per record type ----------------
  // ICP self-authenticating principals hash the DER SubjectPublicKeyInfo of the UNCOMPRESSED
  // secp256k1 key (what ic-agent / dfx do). The record carries the compressed key, so expand it.
  const ICP_DER_PREFIX = Uint8Array.from([0x30, 0x56, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x03, 0x42, 0x00]);
  function secpUncompress(pub33) {
    const P = (1n << 256n) - (1n << 32n) - 977n;
    const pow = (b, e) => { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
    let x = 0n; for (const v of pub33.slice(1)) x = (x << 8n) | BigInt(v);
    let y = pow((x * x % P * x + 7n) % P, (P + 1n) / 4n);          // p = 3 mod 4, so this is the square root
    if ((y & 1n) !== BigInt(pub33[0] & 1)) y = P - y;
    const out = new Uint8Array(65); out[0] = 4;
    for (let i = 0; i < 32; i++) { out[32 - i] = Number((x >> BigInt(8 * i)) & 0xffn); out[64 - i] = Number((y >> BigInt(8 * i)) & 0xffn); }
    return out;
  }
  const addr = {
    p2sh: (ver, h) => base58check(cat(Uint8Array.of(...ver), h)),
    taproot: (k) => bech32('bc', [1, ...toWords(k)], true),
    filecoin: (h) => 'f1' + base32(cat(h, blake2b(cat(Uint8Array.of(0x01), h), 4)), true),
    kaspa: (k) => cashaddr('kaspa', 0, k),
    ergo: (pub) => { const b = cat(Uint8Array.of(0x01), pub); return base58(cat(b, blake2b(b, 32).slice(0, 4))); },
    icpAccount: (pub) => {
      const principal = cat(sha224(cat(ICP_DER_PREFIX, secpUncompress(pub))), Uint8Array.of(0x02));
      const h = sha224(cat(Uint8Array.of(0x0a), utf8('account-id'), principal, new Uint8Array(32)));
      const c = crc32(h);
      return hex(cat(Uint8Array.of(c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255), h));
    },
    stellar: (pub) => { const b = cat(Uint8Array.of(6 << 3), pub); const c = crc16xmodem(b); return base32(cat(b, Uint8Array.of(c & 255, c >>> 8))); },
    tezos: (h) => base58check(cat(Uint8Array.of(0x06, 0xa1, 0x9f), h)),
    algorand: (pub) => base32(cat(pub, sha512_256(pub).slice(28))),
    cardanoBase: (pay, stake) => bech32('addr', toWords(cat(Uint8Array.of(0x01), pay, stake))),
    cardanoStake: (stake) => bech32('stake', toWords(cat(Uint8Array.of(0xe1), stake))),
    // account extended public key from a 0x70-0x73 record: fp(4) || chain code(32) || pubkey(33)
    xpub: (rec, version, account = 0) => base58check(cat(Uint8Array.of(version >>> 24, (version >>> 16) & 255, (version >>> 8) & 255, version & 255, 3),
      rec.slice(0, 4), Uint8Array.of(0x80, 0, 0, account), rec.slice(4, 36), rec.slice(36, 69))),
  };
  const XPUB = 0x0488b21e, YPUB = 0x049d7cb2, ZPUB = 0x04b24746;

  // ---------------- per-type checks ----------------
  // build(records, K) -> list of { name, addr, explorer, run, unavailable?, account? (a further account: 2-5) } using the fetch
  // helpers app.js passes in K (fetchJSON, rpc, firstOk, units, h, checkEvm, evm(key), ...).
  const cz = (name, rest, denom, dec, symbol, price, explorer, extra) => Object.assign({ name, rest, denom, dec, symbol, price, explorer }, extra || {});
  const COSMOS_BY_TYPE = {
    0x30: [cz('Terra', 'https://rest.cosmos.directory/terra2', 'uluna', 6, 'LUNA', 'terra-luna-2', 'https://www.mintscan.io/terra/address/', { hrp: 'terra', rest2: 'https://terra-rest.publicnode.com' }),
      cz('Terra Classic', 'https://terra-classic-lcd.publicnode.com', 'uluna', 6, 'LUNC', 'terra-luna', 'https://finder.terra-classic.hexxagon.io/mainnet/address/', { hrp: 'terra', rest2: 'https://rest.cosmos.directory/terra', stables: { uusd: ['USTC', 6, 'terrausd'] } })],
    0x31: [cz('Kava', 'https://rest.cosmos.directory/kava', 'ukava', 6, 'KAVA', 'kava', 'https://www.mintscan.io/kava/address/', { hrp: 'kava', rest2: 'https://kava-rest.publicnode.com' })],
    0x32: [cz('Secret', 'https://rest.lavenderfive.com:443/secretnetwork', 'uscrt', 6, 'SCRT', 'secret', 'https://www.mintscan.io/secret/address/', { hrp: 'secret', rest2: 'https://rest.cosmos.directory/secretnetwork' })],
    0x33: [cz('Cronos POS (Crypto.org)', 'https://rest.cosmos.directory/cryptoorgchain', 'basecro', 8, 'CRO', 'crypto-com-chain', 'https://www.mintscan.io/crypto-org/address/', { hrp: 'cro' })],
    0x34: [cz('Band', 'https://rest.cosmos.directory/bandchain', 'uband', 6, 'BAND', 'band-protocol', 'https://www.mintscan.io/band/address/', { hrp: 'band' })],
    0x35: [cz('THORChain', 'https://rest.cosmos.directory/thorchain', 'rune', 8, 'RUNE', 'thorchain', 'https://runescan.io/address/', { hrp: 'thor' }),
      cz('Maya', 'https://mayanode.mayachain.info', 'cacao', 10, 'CACAO', 'cacao', 'https://www.explorer.mayachain.info/address/', { hrp: 'maya' })],
    0x36: [cz('BitSong', 'https://rest.cosmos.directory/bitsong', 'ubtsg', 6, 'BTSG', 'bitsong', 'https://ping.pub/bitsong/account/', { hrp: 'bitsong' })],
    0x37: [cz('Desmos', 'https://rest.cosmos.directory/desmos', 'udsm', 6, 'DSM', 'desmos', 'https://ping.pub/desmos/account/', { hrp: 'desmos' })],
    0x38: [cz('Persistence (old path)', 'https://rest.cosmos.directory/persistence', 'uxprt', 6, 'XPRT', 'persistence', 'https://www.mintscan.io/persistence/address/', { hrp: 'persistence' })],
    0x39: [cz('Lum', 'https://rest.cosmos.directory/lumnetwork', 'ulum', 6, 'LUM', 'lum-network', 'https://ping.pub/lum/account/', { hrp: 'lum', unavailable: 'Lum Network has halted; no server answers' })],
    0x3A: [cz('Provenance', 'https://rest.cosmos.directory/provenance', 'nhash', 9, 'HASH', 'hash-2', 'https://explorer.provenance.io/accounts/', { hrp: 'pb' })],
    0x3B: [cz('Coreum (TX)', 'https://rest.cosmos.directory/coreum', 'ucore', 6, 'TX', 'tx', 'https://explorer.tx.org/tx/account/', { hrp: 'core' })],
    0x3C: [cz('Agoric', 'https://rest.cosmos.directory/agoric', 'ubld', 6, 'BLD', 'agoric', 'https://agoric.explorers.guru/account/', { hrp: 'agoric' })],
  };

  function build(records, K) {
    const { fetchJSON, rpc, firstOk, units, h } = K;
    const one = (r) => ({ holdings: [r], others: 0, partial: null });
    const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = [];
    const add = (name, a, explorer, run, extra) => out.push(Object.assign({ name, addr: a, explorer, run }, extra || {}));
    // A whole wallet from its xpub: Haskoin walks every used address, receive and change.
    const haskoin = async (xpub, chain, derive, symbol, price) => {
      const j = await fetchJSON('https://api.haskoin.com/' + chain + '/xpub/' + xpub + '?derive=' + derive);
      if (!j.balance || j.balance.confirmed === undefined) throw new Error('unexpected answer');
      const used = j.indices ? (j.indices.external || 0) + (j.indices.change || 0) : 0;
      return { holdings: [h(symbol, units(BigInt(j.balance.confirmed) + BigInt(j.balance.unconfirmed || 0), 8), price)], others: 0, partial: null, note: used ? used + ' addresses used' : null };
    };
    // One address of a whole-wallet scan -> { used, sats }, from whichever API `src` names.
    const utxoQuery = async (src, a, symbol) => {
      if (src.startsWith('https://')) {   // mempool.space-style (Esplora)
        const j = await fetchJSON(src + a), c = j.chain_stats, m = j.mempool_stats;
        if (!c || !m) throw new Error('unexpected answer');
        return { used: c.tx_count + m.tx_count > 0, sats: BigInt(c.funded_txo_sum) - BigInt(c.spent_txo_sum) + BigInt(m.funded_txo_sum) - BigInt(m.spent_txo_sum) };
      }
      if (src === 'bitcore') {            // BitPay: an empty coin list means never used
        const base = 'https://api.bitcore.io/api/' + symbol + '/mainnet/address/' + a;
        const coins = await fetchJSON(base + '?limit=1');
        if (!Array.isArray(coins)) throw new Error('unexpected answer');
        if (!coins.length) return { used: false, sats: 0n };
        const j = await fetchJSON(base + '/balance');
        if (j.balance === undefined) throw new Error('unexpected answer');
        return { used: true, sats: BigInt(j.balance) };
      }
      if (src === 'insight') {            // insight.dash.org
        const j = await fetchJSON('https://insight.dash.org/insight-api/addr/' + a + '?noTxList=1');
        if (j.balanceSat === undefined) throw new Error('unexpected answer');
        return { used: (j.txApperances || 0) + (j.unconfirmedTxApperances || 0) > 0, sats: BigInt(j.balanceSat) + BigInt(j.unconfirmedBalanceSat || 0) };
      }
      if (src === 'blockcypher') {
        const j = await fetchJSON('https://api.blockcypher.com/v1/' + symbol.toLowerCase() + '/main/addrs/' + a + '/balance');
        if (j.final_balance === undefined) throw new Error('unexpected answer');
        return { used: (j.final_n_tx || 0) > 0, sats: BigInt(j.final_balance) };
      }
      throw new Error('unknown source ' + src);
    };

    for (const { type, bytes: b } of records) {
      switch (type) {
        // ---- Bitcoin family ----
        case 0x10: { const a = addr.p2sh([0x05], b); add('Bitcoin nested segwit (3...)', a, 'https://mempool.space/address/', () => K.checkBtc(a)); break; }
        case 0x11: { const a = addr.taproot(b); add('Bitcoin taproot (bc1p)', a, 'https://mempool.space/address/', () => K.checkBtc(a)); break; }
        case 0x12: { const a = addr.p2sh([0x30], b); add('Litecoin legacy (L...)', a, 'https://litecoinspace.org/address/', () => K.checkLtc(a)); break; }
        case 0x13: { const a = addr.p2sh([0x32], b); add('Litecoin nested (M...)', a, 'https://litecoinspace.org/address/', () => K.checkLtc(a)); break; }
        case 0x14: { const a = cashaddr('bitcoincash', 0, b); add('Bitcoin Cash (BCH wallets)', a, 'https://blockchair.com/bitcoin-cash/address/', () => K.checkBch(a)); break; }
        case 0x15: { const a = addr.p2sh([0x00], b); add('Bitcoin SV (BSV wallets)', a, 'https://whatsonchain.com/address/', () => K.checkBsv(a)); break; }
        case 0x16: { const a = cashaddr('ecash', 0, b); add('eCash (XEC wallets)', a, 'https://explorer.e.cash/address/', () => K.checkXecHash(hex(b))); break; }
        case 0x17: { const a = addr.p2sh([0x4c], b);
          add('Dash', a, 'https://insight.dash.org/insight/address/', () => firstOk(['insight', 'blockcypher', '3xpl'], async (src) => {
            if (src === 'insight') { const j = await fetchJSON('https://insight.dash.org/insight-api/addr/' + a + '?noTxList=1'); if (j.balanceSat === undefined) throw new Error('unexpected answer'); return one(h('DASH', units(BigInt(j.balanceSat) + BigInt(j.unconfirmedBalanceSat || 0), 8), 'dash')); }
            if (src === 'blockcypher') { const j = await fetchJSON('https://api.blockcypher.com/v1/dash/main/addrs/' + a + '/balance'); return one(h('DASH', units(BigInt(j.final_balance), 8), 'dash')); }
            const j = await fetchJSON('https://sandbox-api.3xpl.com/dash/address/' + a + '?data=balances');
            if (!j.data || !j.data.balances) throw new Error('unexpected answer'); const v = (j.data.balances['dash-main'] || {}).dash; return one(h('DASH', units(BigInt(v ? v.balance : 0), 8), 'dash'));
          })); break; }
        case 0x18: { const a = addr.p2sh([0x1c, 0xb8], b);
          add('Zcash (transparent)', a, 'https://mainnet.zcashexplorer.app/address/', () => firstOk(['3xpl', 'blockchair'], async (src) => {
            if (src === '3xpl') { const j = await fetchJSON('https://sandbox-api.3xpl.com/zcash/address/' + a + '?data=balances'); if (!j.data || !j.data.balances) throw new Error('unexpected answer'); const v = (j.data.balances['zcash-main'] || {}).zcash; return one(h('ZEC', units(BigInt(v ? v.balance : 0), 8), 'zcash')); }
            const j = await fetchJSON('https://api.blockchair.com/zcash/dashboards/address/' + a); const d = ((j.data || {})[a] || {}).address || {}; return one(h('ZEC', units(BigInt(d.balance || 0), 8), 'zcash'));
          })); break; }
        case 0x19: { const a = addr.p2sh([0x1e], b);
          add('DigiByte', a, 'https://chainz.cryptoid.info/dgb/address.dws?' + a, () => firstOk(['https://digiexplorer.info/api/address/', 'cryptoid'], async (src) => {
            if (src !== 'cryptoid') return K.checkMempoolStyle(src, a, 'DGB', 'digibyte');
            const v = await fetchJSON('https://chainz.cryptoid.info/dgb/api.dws?q=getbalance&a=' + a);
            if (typeof v !== 'number') throw new Error('unexpected answer');
            return one(h('DGB', v, 'digibyte'));
          })); break; }
        case 0x1A: { const a = addr.p2sh([0x3c], b);
          add('Ravencoin', a, 'https://blockbook.ravencoin.org/address/', async () => {
            const j = await fetchJSON('https://blockbook.ravencoin.org/api/v2/address/' + a + '?details=basic');
            if (j.balance === undefined) throw new Error('unexpected answer');
            return one(h('RVN', units(BigInt(j.balance || 0) + BigInt(j.unconfirmedBalance || 0), 8), 'ravencoin'));
          }); break; }
        // ---- ETH-style coin types ----
        case 0x20: case 0x21: case 0x22: case 0x25: {
          const key = { 0x20: 'etc', 0x21: 'celo', 0x22: 'one', 0x25: 'kaia' }[type];
          const label = { 0x20: 'Ethereum Classic (ETC wallets)', 0x21: 'Celo (Valora)', 0x22: 'Harmony (ONE wallets)', 0x25: 'Kaia (Kaikas)' }[type];
          const c = K.evm(key); const a = eip55(b);
          const shown = type === 0x22 ? bech32Bytes('one', b) : a;     // Harmony wallets show one1...
          add(label, shown, c.explorer, () => K.checkEvm(c, a)); break;
        }
        case 0x23: { const a = eip55(b);
          add('VeChain', a, 'https://vechainstats.com/account/', async () => {
            const j = await firstOk(['https://mainnet.vechain.org', 'https://node-mainnet.vechain.energy'], (u) => fetchJSON(u + '/accounts/' + a));
            return { holdings: [h('VET', units(BigInt(j.balance), 18), 'vechain'), h('VTHO', units(BigInt(j.energy), 18), 'vethor-token')], others: 0, partial: null };
          }); break; }
        case 0x24: { const a = eip55(b);
          add('Theta', a, 'https://explorer.thetatoken.org/account/', async () => {
            const j = await fetchJSON('https://theta-bridge-rpc.thetatoken.org/rpc', post({ jsonrpc: '2.0', id: 1, method: 'theta.GetAccount', params: [{ address: a }] }));
            if (j.error) { if (/not found/i.test(j.error.message || '')) return { holdings: [h('THETA', 0, 'theta-token')], others: 0, partial: null }; throw new Error(j.error.message); }
            const c = (j.result || {}).coins || {};
            return { holdings: [h('THETA', units(BigInt(c.thetawei || 0), 18), 'theta-token'), h('TFUEL', units(BigInt(c.tfuelwei || 0), 18), 'theta-fuel')], others: 0, partial: null };
          }); break; }
        case 0x26: { const a = bech32Bytes('zil', b);
          add('Zilliqa', a, 'https://viewblock.io/zilliqa/address/', async () => {
            const j = await fetchJSON('https://api.zilliqa.com/', post({ id: '1', jsonrpc: '2.0', method: 'GetBalance', params: [hex(b)] }));
            if (j.error) { if (/not created/i.test(j.error.message || '')) return one(h('ZIL', 0, 'zilliqa')); throw new Error(j.error.message); }
            return one(h('ZIL', units(BigInt(j.result.balance), 12), 'zilliqa'));
          }); break; }
        case 0x27: { const a = 'hx' + hex(b);
          add('ICON', a, 'https://tracker.icon.community/address/', async () => {
            const j = await fetchJSON('https://ctz.solidwallet.io/api/v3', post({ jsonrpc: '2.0', id: 1, method: 'icx_getBalance', params: { address: a } }));
            if (j.error) throw new Error(j.error.message);
            return one(h('ICX', units(BigInt(j.result), 18), 'icon'));
          }); break; }
        case 0x28: { const a = addr.filecoin(b);
          add('Filecoin (f1)', a, 'https://filfox.info/en/address/', async () => one(h('FIL', units(BigInt(await rpc('https://api.node.glif.io/rpc/v1', 'Filecoin.WalletBalance', [a])), 18), 'filecoin'))); break; }
        case 0x29: { const a = addr.kaspa(b);
          add('Kaspa', a, 'https://explorer.kaspa.org/addresses/', async () => { const j = await fetchJSON('https://api.kaspa.org/addresses/' + a + '/balance'); if (j.balance === undefined) throw new Error('unexpected answer'); return one(h('KAS', units(BigInt(j.balance || 0), 8), 'kaspa')); }); break; }
        case 0x2A: { const a = addr.ergo(b);
          add('Ergo', a, 'https://explorer.ergoplatform.com/en/addresses/', async () => {
            const j = await fetchJSON('https://api.ergoplatform.com/api/v1/addresses/' + a + '/balance/confirmed');
            return { holdings: [h('ERG', units(BigInt(j.nanoErgs || 0), 9), 'ergo')], others: (j.tokens || []).length, partial: null };
          }); break; }
        case 0x2B: { const a = addr.icpAccount(b);
          add('Internet Computer', a, 'https://dashboard.internetcomputer.org/account/', async () => {
            const j = await fetchJSON('https://ledger-api.internetcomputer.org/accounts/' + a);
            if (j.balance === undefined) throw new Error('unexpected answer');
            return one(h('ICP', units(BigInt(j.balance || 0), 8), 'internet-computer'));
          }); break; }
        case 0x2C: { const a = bech32Bytes('avax', b);
          add('Avalanche P-chain', 'P-' + a, 'https://subnets.avax.network/p-chain/address/', async () => {
            const j = await fetchJSON('https://api.avax.network/ext/bc/P', post({ jsonrpc: '2.0', id: 1, method: 'platform.getBalance', params: { addresses: ['P-' + a] } }));
            if (j.error) throw new Error(j.error.message);
            return one(h('AVAX', units(BigInt(j.result.balance || 0), 9), 'avalanche-2'));
          });
          add('Avalanche X-chain', 'X-' + a, 'https://subnets.avax.network/x-chain/address/', async () => {
            const j = await fetchJSON('https://glacier-api.avax.network/v1/networks/mainnet/blockchains/x-chain/balances?addresses=' + a);
            let n = 0n; for (const x of ((j.balances || {}).unlocked || [])) if (x.symbol === 'AVAX') n += BigInt(x.amount || 0);
            return one(h('AVAX', units(n, 9), 'avalanche-2'));
          }); break; }
        // ---- Cosmos with their own coin type ----
        case 0x30: case 0x31: case 0x32: case 0x33: case 0x34: case 0x35: case 0x36: case 0x37: case 0x38: case 0x39: case 0x3A: case 0x3B: case 0x3C:
          for (const c of COSMOS_BY_TYPE[type]) { const a = bech32Bytes(c.hrp, b); add(c.name, a, c.explorer, () => K.checkCosmos(c, a), { unavailable: c.unavailable }); }
          break;
        // ---- ed25519 ----
        case 0x50: case 0x51: { const a = base58(b);
          add(type === 0x50 ? 'Solana (Ledger, Trust path)' : 'Solana (old Solflare path)', a, 'https://solscan.io/account/', () => K.checkSol(a)); break; }
        case 0x52: { const a = addr.stellar(b);
          add('Stellar', a, 'https://stellar.expert/explorer/public/account/', async () => {
            try {
              const j = await firstOk(['https://horizon.stellar.org', 'https://horizon.stellar.lobstr.co'], (u) => fetchJSON(u + '/accounts/' + a));
              const hs = []; let others = 0;
              for (const x of j.balances || []) {
                if (x.asset_type === 'native') hs.unshift(h('XLM', Number(x.balance), 'stellar'));
                else if (x.asset_code === 'USDC' && x.asset_issuer === 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN') hs.push(h('USDC', Number(x.balance), 'usd-coin'));
                else if (Number(x.balance) > 0) others++;
              }
              return { holdings: hs.length ? hs : [h('XLM', 0, 'stellar')], others, partial: null };
            } catch (e) { if (e.status === 404) return one(h('XLM', 0, 'stellar')); throw e; }   // account never funded
          }); break; }
        case 0x53: { const a = addr.tezos(b);
          add('Tezos', a, 'https://tzkt.io/', async () => one(h('XTZ', units(BigInt(await K.fetchText('https://api.tzkt.io/v1/accounts/' + a + '/balance')), 6), 'tezos'))); break; }
        case 0x54: { const a = hex(b);
          add('NEAR', a, 'https://nearblocks.io/address/', async () => {
            const r = await firstOk(['https://rpc.fastnear.com', 'https://rpc.mainnet.near.org'], async (u) => {
              const j = await fetchJSON(u, post({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: a } }));
              if (j.error) { if ((j.error.cause && j.error.cause.name) === 'UNKNOWN_ACCOUNT') return { amount: '0' }; throw new Error((j.error.cause && j.error.cause.name) || j.error.message); }   // UNKNOWN_ACCOUNT: implicit account never funded
              return j.result;
            });
            // staking pools and tokens: FastNEAR's index lists the pools this account ever staked
            // with and its token balances; each pool says what it holds for the account now
            const f = await fetchJSON('https://api.fastnear.com/v1/account/' + a + '/full').catch(() => null);
            const hs = [h('NEAR', units(BigInt(r.amount), 24), 'near')], gaps = [];
            if (!f) gaps.push('staking and tokens not checked');
            const pools = (f && f.pools || []).slice(0, 20);
            const view = (pool) => firstOk(['https://rpc.fastnear.com', 'https://rpc.mainnet.near.org'], async (u) => {
              const j = await fetchJSON(u, post({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: pool, method_name: 'get_account_total_balance', args_base64: btoa(JSON.stringify({ account_id: a })) } }));
              if (j.error || !j.result || !Array.isArray(j.result.result)) throw new Error('unexpected answer');
              return BigInt(JSON.parse(String.fromCharCode(...j.result.result)));
            });
            const staked = await Promise.allSettled(pools.map((p) => view(p.pool_id)));
            let n = 0n;
            for (const x of staked) if (x.status === 'fulfilled') n += x.value;
            if (staked.some((x) => x.status !== 'fulfilled')) gaps.push('some staking pools did not answer');
            if (n > 0n) hs.push(h('NEAR (staked)', units(n, 24), 'near'));
            const rest = (f && f.tokens || []).filter((t) => /^\d+$/.test(String(t.balance)) && BigInt(t.balance) > 0n).map((t) => ({ addr: t.contract_id, raw: t.balance }));
            let t = { holdings: [], others: rest.length, partial: null };
            if (rest.length) try { t = await K.otherTokens('near', rest.slice(0, 400)); } catch (e) { gaps.push('tokens not valued'); }
            return { holdings: hs.concat(t.holdings), others: t.others, partial: [t.partial].concat(gaps).filter(Boolean).join('; ') || null };
          }); break; }
        case 0x55: { const a = addr.algorand(b);
          add('Algorand', a, 'https://allo.info/account/', async () => {
            const j = await fetchJSON('https://mainnet-api.algonode.cloud/v2/accounts/' + a);
            const hs = [h('ALGO', units(BigInt(j.amount || 0), 6), 'algorand')]; let others = 0;
            for (const x of j.assets || []) { if (x['asset-id'] === 31566704) hs.push(h('USDC', units(BigInt(x.amount), 6), 'usd-coin')); else if (x['asset-id'] === 312769) hs.push(h('USDT', units(BigInt(x.amount), 6), 'tether')); else if (x.amount > 0) others++; }
            return { holdings: hs, others, partial: null };
          }); break; }
        case 0x56: { const a = bech32Bytes('erd', b);
          add('MultiversX', a, 'https://explorer.multiversx.com/accounts/', async () => { const j = await fetchJSON('https://api.multiversx.com/accounts/' + a); if (j.balance === undefined) throw new Error('unexpected answer'); return one(h('EGLD', units(BigInt(j.balance || 0), 18), 'elrond-erd-2')); }); break; }
        case 0x57: { const pk = hex(b);
          add('Hedera', pk, 'https://hashscan.io/mainnet/account/', async () => {
            const j = await fetchJSON('https://mainnet-public.mirrornode.hedera.com/api/v1/accounts?account.publickey=' + pk + '&balance=true&limit=25');
            if (!Array.isArray(j.accounts)) throw new Error('unexpected answer');
            let n = 0n; for (const x of j.accounts) n += BigInt(((x.balance || {}).balance) || 0);
            return one(h('HBAR', units(n, 8), 'hedera-hashgraph'));
          }, { explorerAddr: null }); break; }   // Hedera account ids are assigned on chain; there is no address to link
        case 0x58: { const a = '0x' + hex(b);
          add('IOTA', a, 'https://iotascan.com/mainnet/account/', async () => one(h('IOTA', units(BigInt((await rpc('https://api.mainnet.iota.cafe', 'iotax_getBalance', [a])).totalBalance), 9), 'iota'))); break; }
        case 0x59: { const pk = hex(b);
          add('TON (Trust Wallet path)', pk, 'https://tonviewer.com/', async () => {
            const j = await fetchJSON('https://tonapi.io/v2/pubkeys/' + pk + '/wallets');
            if (!Array.isArray(j.accounts)) throw new Error('unexpected answer');
            let n = 0n; for (const x of j.accounts) n += BigInt(x.balance || 0);
            // The index only knows wallets that have sent at least once (deployed contracts), so
            // an empty answer is not proof of nothing: say so instead of claiming zero.
            return { holdings: [h('TON', units(n, 9), 'the-open-network')], others: 0, partial: j.accounts.length ? null : 'a TON wallet that has only ever received may not show up here' };
          }); break; }
        case 0x60: { const pay = b.slice(0, 28), stake = b.slice(28, 56); const base = addr.cardanoBase(pay, stake), st = addr.cardanoStake(stake);
          add('Cardano', base, 'https://cardanoscan.io/stakekey/', async () => {
            return firstOk(['koios', 'yoroi'], async (src) => {
              if (src === 'koios') {
                const j = await fetchJSON('https://graph.xray.app/output/services/koios/mainnet/api/v1/account_info', post({ _stake_addresses: [st] }));
                if (!Array.isArray(j)) throw new Error('unexpected answer');
                return one(h('ADA', units(BigInt((j[0] || {}).total_balance || 0), 6), 'cardano'));   // [] = stake key never seen on chain
              }
              const j = await fetchJSON('https://api.yoroiwallet.com/api/txs/utxoSumForAddresses', post({ addresses: [base] }));
              return { holdings: [h('ADA', units(BigInt(j.sum || 0), 6), 'cardano')], others: 0, partial: 'first address only' };
            });
          }, { explorerAddr: st }); break; }
        // ---- whole wallets from account xpubs (Haskoin derives and scans every used address) ----
        case 0x70: case 0x71: case 0x72: case 0x73: {
          if (b.length !== 69) break;
          const shown = addr.xpub(b, type === 0x70 ? ZPUB : type === 0x72 ? YPUB : XPUB), query = addr.xpub(b, XPUB);
          const wallet = (chain, derive, symbol, price) => () => haskoin(query, chain, derive, symbol, price);
          const ex = 'https://blockchair.com/bitcoin/xpub/';
          if (type === 0x70) add('Bitcoin wallet (segwit, every address)', shown, ex, wallet('btc', 'segwit', 'BTC', 'bitcoin'), { replaces: ['Bitcoin'] });
          if (type === 0x71) {
            add('Bitcoin wallet (legacy, every address)', shown, ex, wallet('btc', 'normal', 'BTC', 'bitcoin'), { replaces: ['Bitcoin (legacy 1...)'] });
            add('Bitcoin Cash, legacy wallet (2017 fork)', shown, 'https://blockchair.com/bitcoin-cash/xpub/', wallet('bch', 'normal', 'BCH', 'bitcoin-cash'), { replaces: ['Bitcoin Cash (2017 fork)'] });
          }
          if (type === 0x72) add('Bitcoin wallet (nested segwit, every address)', shown, ex, wallet('btc', 'compat', 'BTC', 'bitcoin'), { replaces: ['Bitcoin nested segwit (3...)'] });
          if (type === 0x73) add('Bitcoin Cash wallet (every address)', shown, 'https://blockchair.com/bitcoin-cash/xpub/', wallet('bch', 'normal', 'BCH', 'bitcoin-cash'), { replaces: ['Bitcoin Cash (BCH wallets)'] });
          break;
        }
        // ---- Bitcoin native segwit accounts 2 and 3 (m/84'/0'/1', m/84'/0'/2'): two account keys ----
        case 0x7D: {
          if (b.length !== 138) break;
          for (let n = 1; n <= 2; n++) {
            const k = b.slice(69 * (n - 1), 69 * n), shown = addr.xpub(k, ZPUB, n), query = addr.xpub(k, XPUB, n);
            add('Bitcoin account ' + (n + 1) + ' (segwit, every address)', shown, 'https://blockchair.com/bitcoin/xpub/', () => haskoin(query, 'btc', 'segwit', 'BTC', 'bitcoin'), { account: true });
          }
          break;
        }
        // ---- Phantom / Solflare accounts 2-5 (m/44'/501'/1..4'/0'): four public keys ----
        case 0x7C: {
          if (b.length !== 128) break;
          for (let n = 1; n <= 4; n++) {
            const a = base58(b.slice(32 * (n - 1), 32 * n));
            add('Solana account ' + (n + 1) + ' (Phantom, Solflare)', a, 'https://solscan.io/account/', () => K.checkSol(a), { account: true });
          }
          break;
        }
        // ---- whole wallets the page scans itself (no xpub service with browser access) ----
        case 0x74: case 0x75: case 0x76: case 0x78: case 0x79: {
          if (b.length !== 69) break;
          const [kind, name, replaces, symbol, price, apis, explorer] = {
            0x74: ['btc-tr', 'Bitcoin taproot wallet (every address)', 'Bitcoin taproot (bc1p)', 'BTC', 'bitcoin', ['https://mempool.space/api/address/', 'https://blockstream.info/api/address/'], 'https://mempool.space/address/'],
            0x75: ['ltc-wpkh', 'Litecoin wallet (segwit, every address)', 'Litecoin', 'LTC', 'litecoin', ['https://litecoinspace.org/api/address/', 'bitcore'], 'https://litecoinspace.org/address/'],
            0x76: ['ltc-pkh', 'Litecoin legacy wallet (every address)', 'Litecoin legacy (L...)', 'LTC', 'litecoin', ['https://litecoinspace.org/api/address/', 'bitcore'], 'https://litecoinspace.org/address/'],
            0x78: ['doge-pkh', 'Dogecoin wallet (every address)', 'Dogecoin', 'DOGE', 'dogecoin', ['bitcore', 'blockcypher'], 'https://dogechain.info/address/'],
            0x79: ['dash-pkh', 'Dash wallet (every address)', 'Dash', 'DASH', 'dash', ['insight', 'blockcypher'], 'https://insight.dash.org/insight/address/'],
          }[type];
          const first = childAddrs(b, kind, 0, 0, 1)[0];
          const query = (a) => firstOk(apis, (u) => utxoQuery(u, a, symbol));
          add(name, first, explorer, async () => {
            // BlockCypher allows ~3 requests a second per visitor, so its coins go 2 at a time
            const w = await scanWallet(b, kind, query, [10, 5], type >= 0x78 ? 2 : 5);
            return { holdings: [h(symbol, units(w.sats, 8), price)], others: 0, partial: null, note: w.used ? w.used + ' addresses used' : null };
          }, { replaces: [replaces] });
          break;
        }
        // ---- Ravencoin: its Blockbook explorer scans an xpub itself, in one request ----
        case 0x7A: {
          if (b.length !== 69) break;
          const x = addr.xpub(b, XPUB);
          add('Ravencoin wallet (every address)', x, 'https://blockbook.ravencoin.org/xpub/', async () => {
            const j = await fetchJSON('https://blockbook.ravencoin.org/api/v2/xpub/' + x + '?details=basic');
            if (j.balance === undefined) throw new Error('unexpected answer');
            return { holdings: [h('RVN', units(BigInt(j.balance) + BigInt(j.unconfirmedBalance || 0), 8), 'ravencoin')], others: 0, partial: null, note: j.usedTokens ? j.usedTokens + ' addresses used' : null };
          }, { replaces: ['Ravencoin'] });
          break;
        }
        // ---- MetaMask accounts 2-5 (m/44'/60'/0'/0/1..4), every EVM network once used ----
        case 0x77: {
          if (b.length !== 69) break;
          for (let n = 1; n <= 4; n++) {
            const a = walletAddr('eth', ckdPub(b.slice(36, 69), b.slice(4, 36), n).pub);
            add('Ethereum account ' + (n + 1) + ' (MetaMask)', a, 'https://debank.com/profile/', () => K.checkEvmAccount(a), { account: true });
          }
          break;
        }
        // ---- Ledger Live accounts 2-5 (m/44'/60'/1..4'/0/0): hardened, so the device sends addresses ----
        case 0x7B: {
          if (b.length !== 80) break;
          for (let n = 1; n <= 4; n++) {
            const a = eip55(b.slice(20 * (n - 1), 20 * n));
            add('Ethereum account ' + (n + 1) + ' (Ledger Live)', a, 'https://debank.com/profile/', () => K.checkEvmAccount(a), { account: true });
          }
          break;
        }
        default: break;   // a newer device's record type; skipped by design
      }
    }
    return out;
  }

  // Every price id this module can ask for, so the page always requests the full set and the
  // request says nothing about which coins a wallet holds.
  const PRICE_IDS = ['bitcoin', 'litecoin', 'bitcoin-cash', 'bitcoin-cash-sv', 'ecash', 'dash', 'zcash', 'digibyte', 'ravencoin', 'ethereum-classic', 'celo', 'harmony', 'kaia', 'vechain', 'vethor-token', 'theta-token', 'theta-fuel', 'zilliqa', 'icon', 'filecoin', 'kaspa', 'ergo', 'internet-computer', 'avalanche-2', 'terra-luna-2', 'terra-luna', 'terrausd', 'kava', 'secret', 'crypto-com-chain', 'band-protocol', 'thorchain', 'cacao', 'bitsong', 'desmos', 'persistence', 'hash-2', 'tx', 'agoric', 'solana', 'stellar', 'tezos', 'near', 'algorand', 'elrond-erd-2', 'hedera-hashgraph', 'iota', 'the-open-network', 'cardano', 'usd-coin', 'tether'];

  return { build, firstPkh, walletAddr, childAddrs, taprootKey, ripemd160, hmacSha512, sha512, ckdPub, PRICE_IDS, addr, cashaddr, base58, base58check, base32, bech32, toWords, sha256, sha224, sha512_256, blake2b, crc32, crc16xmodem, hex };
});

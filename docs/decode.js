// decode.js - turns the SeedBox portfolio QR payload back into addresses.
// Used by the page (index.html) and by the host test (seedbox/test/verify_site.js),
// so it has to run in a browser and in node. No dependencies.
//
// Payload v1 (see seedbox/src/portfolio.c for the authoritative layout):
// 257 bytes, base43 text. Byte 0 is the version, then raw address material.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeedDecode = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const B43 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:';
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const XRP58 = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
  const BECH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  // [key, byte length], in payload order
  const LAYOUT = [
    ['evm', 20], ['btc', 20], ['btcLegacy', 20], ['ltc', 20], ['doge', 20],
    ['sol', 32], ['trx', 20], ['cosmos', 20], ['xrp', 20], ['sui', 32], ['apt', 32],
  ];
  const PAYLOAD_LEN = 1 + LAYOUT.reduce((a, [, n]) => a + n, 0);   // 257

  // Cosmos chains that share the m/44'/118' key: [key, bech32 prefix]
  const COSMOS = [
    ['atom', 'cosmos'], ['osmo', 'osmo'], ['tia', 'celestia'], ['dydx', 'dydx'],
    ['sei', 'sei'], ['akt', 'akash'], ['juno', 'juno'], ['stars', 'stars'],
    ['noble', 'noble'], ['ntrn', 'neutron'], ['strd', 'stride'], ['axl', 'axelar'],
    ['atone', 'atone'], ['bbn', 'bbn'], ['cheqd', 'cheqd'], ['huahua', 'chihuahua'], ['fet', 'fetch'],
    ['grav', 'gravity'], ['jkl', 'jkl'], ['kyve', 'kyve'], ['nibi', 'nibi'], ['nls', 'nolus'],
    ['orai', 'orai'], ['pasg', 'pasg'], ['xprt', 'persistence'], ['regen', 'regen'], ['saga', 'saga'],
    ['seda', 'seda'], ['dvpn', 'sent'], ['ctk', 'shentu'], ['somm', 'somm'], ['union', 'union'],
    ['ward', 'warden'], ['xion', 'xion'], ['arch', 'archway'], ['aura', 'aura'], ['lore', 'gitopia'],
    ['pokt', 'pokt'],
  ];
  // Cosmos chains on the ETH key (slip44 60): bech32 of the EVM address's 20 bytes.
  const COSMOS_ETH = [
    ['dym', 'dym'], ['islm', 'haqq'], ['xpla', 'xpla'], ['zeta', 'zeta'], ['om', 'mantra'],
    ['aioz', 'aioz'], ['heart', 'human'], ['rio', 'realio'], ['shido', 'shido'],
  ];

  // ---- bytes ----
  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function bytesToHex(b) { let s = ''; for (const x of b) s += x.toString(16).padStart(2, '0'); return s; }
  function concat(a, b) { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }

  function base43Decode(text) {
    let n = 0n;
    for (const ch of text) {
      const d = B43.indexOf(ch);
      if (d < 0) throw new Error('not a SeedBox payload (bad character ' + JSON.stringify(ch) + ')');
      n = n * 43n + BigInt(d);
    }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    return hexToBytes(hex);
  }

  // The text after '#' in the page URL. Returns null when there is none.
  function parseFragment(hash) {
    if (!hash) return null;
    let t = hash.startsWith('#') ? hash.slice(1) : hash;
    try { t = decodeURIComponent(t); } catch (e) { /* leave as is */ }
    t = t.trim();
    return t.length ? t : null;
  }

  function parsePayload(text) {
    const bytes = base43Decode(text);
    if (bytes.length !== PAYLOAD_LEN || bytes[0] !== 1) {
      throw new Error('not a SeedBox v1 payload (' + bytes.length + ' bytes, version ' + bytes[0] + ')');
    }
    const out = {};
    let off = 1;
    for (const [k, n] of LAYOUT) { out[k] = bytes.slice(off, off + n); off += n; }
    return out;
  }

  // ---- hashes ----
  async function sha256(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  }

  // keccak-256 (the pre-NIST padding Ethereum uses). 64-bit lanes as BigInt;
  // it only ever hashes 40 bytes here so speed does not matter.
  const RC = [
    0x1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n,
    0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an,
    0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n,
  ];
  const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
  const M64 = (1n << 64n) - 1n;
  function rotl(v, n) { return n === 0 ? v : (((v << BigInt(n)) | (v >> BigInt(64 - n))) & M64); }
  function keccakF(A) {
    for (let r = 0; r < 24; r++) {
      const C = [0, 1, 2, 3, 4].map(x => A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20]);
      const D = [0, 1, 2, 3, 4].map(x => C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1));
      for (let i = 0; i < 25; i++) A[i] ^= D[i % 5];
      const B = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x][y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & M64) & B[(x + 2) % 5 + 5 * y]);
      A[0] ^= RC[r];
    }
  }
  function keccak256(bytes) {
    const rate = 136;
    const A = new Array(25).fill(0n);
    const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
    padded.set(bytes);
    padded[bytes.length] ^= 0x01;
    padded[padded.length - 1] ^= 0x80;
    for (let off = 0; off < padded.length; off += rate) {
      for (let i = 0; i < rate / 8; i++) {
        let lane = 0n;
        for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
        A[i] ^= lane;
      }
      keccakF(A);
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) {
      let lane = A[i];
      for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; }
    }
    return out;
  }

  // ---- encoders ----
  function eip55(addr20) {
    const low = bytesToHex(addr20);
    const h = bytesToHex(keccak256(new TextEncoder().encode(low)));
    let out = '0x';
    for (let i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? low[i].toUpperCase() : low[i];
    return out;
  }

  function base58(bytes) {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    let s = '';
    while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
    return s;
  }
  async function base58check(payload) {
    const h = await sha256(await sha256(payload));
    return base58(concat(payload, h.slice(0, 4)));
  }
  function xrpAlphabet(s) {
    let out = '';
    for (const c of s) { const i = B58.indexOf(c); out += i < 0 ? c : XRP58[i]; }
    return out;
  }

  function bech32Polymod(values) {
    const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const v of values) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
    }
    return chk >>> 0;
  }
  function bech32Encode(hrp, words) {
    const exp = [];
    for (const c of hrp) exp.push(c.charCodeAt(0) >>> 5);
    exp.push(0);
    for (const c of hrp) exp.push(c.charCodeAt(0) & 31);
    const pm = bech32Polymod([...exp, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
    let s = hrp + '1';
    for (const w of words) s += BECH[w];
    for (let i = 0; i < 6; i++) s += BECH[(pm >>> (5 * (5 - i))) & 31];
    return s;
  }
  function toWords(bytes) {
    const out = [];
    let acc = 0, bits = 0;
    for (const b of bytes) {
      acc = ((acc << 8) | b) & 0x1fff;
      bits += 8;
      while (bits >= 5) { bits -= 5; out.push((acc >>> bits) & 31); }
    }
    if (bits) out.push((acc << (5 - bits)) & 31);
    return out;
  }
  function segwitV0(hrp, pkh) { return bech32Encode(hrp, [0, ...toWords(pkh)]); }

  // Every address string the device shows, rebuilt from the payload.
  async function addressesFrom(p) {
    const cosmos = {};
    for (const [k, hrp] of COSMOS) cosmos[k] = bech32Encode(hrp, toWords(p.cosmos));
    const cosmosEth = {};
    for (const [k, hrp] of COSMOS_ETH) cosmosEth[k] = bech32Encode(hrp, toWords(p.evm));
    return {
      evm: eip55(p.evm),
      inj: bech32Encode('inj', toWords(p.evm)),
      btc: segwitV0('bc', p.btc),
      btcLegacy: await base58check(concat(Uint8Array.of(0x00), p.btcLegacy)),
      ltc: segwitV0('ltc', p.ltc),
      doge: await base58check(concat(Uint8Array.of(0x1e), p.doge)),
      sol: base58(p.sol),
      trx: await base58check(concat(Uint8Array.of(0x41), p.trx)),
      cosmos,
      cosmosEth,
      xrp: xrpAlphabet(await base58check(concat(Uint8Array.of(0x00), p.xrp))),
      sui: '0x' + bytesToHex(p.sui),
      apt: '0x' + bytesToHex(p.apt),
    };
  }

  return { PAYLOAD_LEN, COSMOS, parseFragment, parsePayload, addressesFrom, keccak256, bytesToHex, hexToBytes };
});

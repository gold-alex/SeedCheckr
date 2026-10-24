// ata.js - Solana associated token account derivation, in the browser.
// Public Solana RPCs refuse getTokenAccountsByOwner (it needs an index), but
// they answer getTokenAccountBalance for a specific account. The USDC/USDT
// account of a wallet is a program derived address, so the page computes it
// here and asks for that account directly. Runs in node too (the test uses it).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SolanaATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

  function b58decode(s) {
    let n = 0n;
    for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
    const out = [];
    while (n > 0n) { out.unshift(Number(n & 0xffn)); n >>= 8n; }
    for (const c of s) { if (c === '1') out.unshift(0); else break; }
    return new Uint8Array(out);
  }
  function b58encode(bytes) {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    let s = '';
    while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
    return s;
  }

  // Ed25519 point decompression test, the way curve25519-dalek does it:
  // y from the 32 bytes (top bit is the x sign), then u/v must be a square
  // where u = y^2 - 1 and v = d*y^2 + 1. A sha256 output that decompresses
  // is "on the curve" and rejected as a program address.
  const P = (1n << 255n) - 19n;
  function modPow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
  const D = (P - 121665n) * modPow(121666n, P - 2n, P) % P;   // -121665/121666
  function isOnCurve(bytes) {
    let y = 0n;
    for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
    y %= P;
    const y2 = y * y % P;
    const u = (y2 + P - 1n) % P, v = (D * y2 + 1n) % P;
    if (u === 0n) return true;
    const x2 = u * modPow(v, P - 2n, P) % P;
    return modPow(x2, (P - 1n) / 2n, P) === 1n;
  }

  async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
  function concat(arrs) {
    const o = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0));
    let off = 0;
    for (const x of arrs) { o.set(x, off); off += x.length; }
    return o;
  }
  async function findProgramAddress(seeds, programId) {
    const pid = b58decode(programId);
    const tag = new TextEncoder().encode('ProgramDerivedAddress');
    for (let bump = 255; bump >= 0; bump--) {
      const hash = await sha256(concat([...seeds, Uint8Array.of(bump), pid, tag]));
      if (!isOnCurve(hash)) return b58encode(hash);
    }
    throw new Error('no program address found');
  }
  // The associated token account of owner for mint, as base58 (program: the mint's token
  // program, classic SPL unless given, e.g. Token-2022).
  async function associatedTokenAddress(owner, mint, program) {
    return findProgramAddress([b58decode(owner), b58decode(program || TOKEN_PROGRAM), b58decode(mint)], ATA_PROGRAM);
  }

  return { associatedTokenAddress, findProgramAddress, isOnCurve, b58decode, b58encode };
});

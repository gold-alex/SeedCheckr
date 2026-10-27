// verify_defi.js - docs/tokens.js's on-chain readers and value rules against fixed accounts, offline.
// Every RPC and API answer is stubbed; each expected value is worked out here from the formulas,
// not by calling the page's code.
//   1. Orca position next to a token DefiLlama does not know: the USDC side still counts, flagged
//   2. pump.fun bonding curve: what selling into the curve returns, less the 1.25% fee
//   3. Multicall3 aggregate3: balances decoded from a hand-built answer; a reverted call is a miss
//   4. one token in the wallet and in a liquidity position: capped against its pools once
// usage: node verify_defi.js
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const DOCS = process.env.DOCS || path.join(REPO, 'docs');   // DOCS=...: test a modified copy
const ATA = require(path.join(DOCS, 'ata.js'));
const TOK = require(path.join(DOCS, 'tokens.js'));
globalThis.window = globalThis.window || globalThis;
globalThis.window.SolanaATA = ATA;

let checks = 0, fails = 0;
const ok = (cond, what, detail) => { checks++; if (!cond) fails++; console.log((cond ? 'ok   ' : 'FAIL ') + what + (detail !== undefined ? '  (' + detail + ')' : '')); };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const ORCA = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', WSOL = 'So11111111111111111111111111111111111111112';
const OWNER = 'Fh2jRMGc2dbK8FuNGM2XvWXv3G3S8B1mG4vNuSkk1HXR';
const key = (seed) => ATA.b58encode(Uint8Array.from({ length: 32 }, (_, i) => (seed * 31 + i * 7) & 255 || 1));
const b64 = (u) => [Buffer.from(u).toString('base64'), 'base64'];

// a Solana world: Jupiter's holdings, token search, DefiLlama prices, DexScreener, and accounts by key
function solWorld({ holdings, search = [], llama = {}, nfts = [], accounts = {} }) {
  return {
    units: (v, d) => Number(v) / 10 ** d, solRpcs: ['r'], solScanRpcs: ['v'],
    firstOk: (urls, fn) => fn(urls[0]), ata: ATA.associatedTokenAddress, pda: ATA.findProgramAddress, b58decode: ATA.b58decode, b58encode: ATA.b58encode,
    fetchJSON: async (url) => {
      if (url.includes('/holdings/')) return { tokens: holdings };
      if (url.includes('tokens/v2/search')) return search;
      if (url.includes('coins.llama.fi')) return { coins: Object.fromEntries(Object.entries(llama).map(([m, v]) => ['solana:' + m, v])) };
      if (url.includes('dexscreener')) return { pairs: [] };
      throw new Error('unexpected ' + url);
    },
    rpc: async (u, method, params) => {
      if (method === 'getTokenAccountsByOwner') return { value: params[1].programId.startsWith('Tokenkeg') ? nfts.map((m) => ({ account: { data: { parsed: { info: { mint: m, tokenAmount: { decimals: 0, amount: '1' } } } } } })) : [] };
      if (method === 'getProgramAccounts') return [];
      if (method === 'getMultipleAccounts') return { value: params[0].map((k) => accounts[k] || null) };
      throw new Error(method);
    },
  };
}
// an Orca Whirlpool position (216 bytes) and its pool: price = sqrtPrice^2, Q64.64
function orca(pool, nft, L, lo, hi, sqrtPrice, mintA, mintB) {
  const pos = new Uint8Array(216), pv = new DataView(pos.buffer);
  pos.set(ATA.b58decode(pool), 8); pos.set(ATA.b58decode(nft), 40);
  pv.setBigUint64(72, BigInt(L), true); pv.setInt32(88, lo, true); pv.setInt32(92, hi, true);
  const p = new Uint8Array(653), qv = new DataView(p.buffer), sq = BigInt(Math.round(sqrtPrice * 2 ** 32)) << 32n;
  qv.setBigUint64(65, sq & ((1n << 64n) - 1n), true); qv.setBigUint64(73, sq >> 64n, true);
  p.set(ATA.b58decode(mintA), 101); p.set(ATA.b58decode(mintB), 181);
  return { pos, pool: p };
}

(async () => {
  // ---- 1. MEME/USDC position, MEME unknown to DefiLlama ----
  {
    const MEME = key(1), NFT = key(2), POOL = key(3), L = 10n ** 12n;
    const { pos, pool } = orca(POOL, NFT, L, -20000, 20000, 1, MEME, USDC);
    const posKey = await ATA.findProgramAddress([new TextEncoder().encode('position'), ATA.b58decode(NFT)], ORCA);
    const D = solWorld({ holdings: { [USDC]: [{ uiAmount: 0 }] }, nfts: [NFT], llama: { [USDC]: { price: 1, decimals: 6, symbol: 'USDC', confidence: 0.99 } },
      accounts: { [posKey]: { owner: ORCA, data: b64(pos) }, [POOL]: { owner: ORCA, data: b64(pool) } } });
    const r = await TOK.make(D).sol(OWNER);
    // in range at price 1: token B = L * (sqrt(P) - sqrt(P_low)), P_low = 1.0001^-20000
    const want = Number(L) * (1 - Math.pow(1.0001, -10000)) / 1e6;
    const leg = r.holdings.find((x) => x.symbol === 'USDC in Orca');
    ok(leg && near(leg.amount, want), 'Orca: the USDC side counts though MEME is unpriced', leg && leg.amount.toFixed(2) + ' vs ' + want.toFixed(2));
    ok(/part of a liquidity position not valued/.test(r.partial || ''), 'Orca: the row says part was not valued', r.partial);
  }
  // ---- 2. pump.fun curve ----
  {
    const MINT = ATA.b58encode(ATA.b58decode(key(4)).map((b, i) => (i < 28 ? b : b))).slice(0, 40) + 'pump';
    let mint = MINT;
    try { ATA.b58decode(mint); } catch (e) { mint = key(4); }
    const vt = 900n * 10n ** 12n, vs = 40n * 10n ** 9n, rs = 12n * 10n ** 9n, amount = 5e6;   // 5M tokens, 6 decimals
    const curve = new Uint8Array(150), cv = new DataView(curve.buffer);
    cv.setBigUint64(8, vt, true); cv.setBigUint64(16, vs, true); cv.setBigUint64(24, 10n ** 14n, true); cv.setBigUint64(32, rs, true); cv.setBigUint64(40, 10n ** 15n, true); curve[48] = 0;
    const pda = await ATA.findProgramAddress([new TextEncoder().encode('bonding-curve'), ATA.b58decode(mint)], PUMP);
    const D = solWorld({ holdings: { [mint]: [{ uiAmount: amount }] }, search: [{ id: mint, symbol: 'CURVE', usdPrice: 0.001, liquidity: 5000 }],
      llama: { [WSOL]: { price: 100, decimals: 9, symbol: 'SOL', confidence: 0.99 } }, accounts: { [pda]: { owner: PUMP, data: b64(curve) } } });
    const r = await TOK.make(D).sol(OWNER);
    const raw = amount * 1e6, sol = Math.min(raw * Number(vs) / (Number(vt) + raw), Number(rs)) * 0.9875 / 1e9;
    const h = r.holdings.find((x) => x.symbol === 'CURVE');
    ok(/pump$/.test(mint), 'pump.fun: test mint ends in "pump"', mint);
    ok(h && near(h.amount * h.usdPrice, sol * 100, 1e-4), 'pump.fun: worth the curve sale less 1.25%, not its thin pool', h && (h.amount * h.usdPrice).toFixed(4) + ' vs ' + (sol * 100).toFixed(4));
  }
  // ---- 3. Multicall3 decoding ----
  {
    const toks = ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222', '0x3333333333333333333333333333333333333333'];
    const vals = [123456789n, 0n, null];   // the third call reverted
    // aggregate3 answer: offset, length, offsets of n tuples, each (success, offset 0x40, length, data)
    const w = (n) => BigInt(n).toString(16).padStart(64, '0');
    let tuples = '', offs = '', at = 32 * vals.length;
    for (const v of vals) {
      const t = v == null ? w(0) + w(64) + w(32) + w(999) : w(1) + w(64) + w(32) + w(v);   // a failed call can still return 32 bytes
      offs += w(at); at += t.length / 2; tuples += t;
    }
    const answer = '0x' + w(32) + w(vals.length) + offs + tuples;
    const prices = { '0x1111111111111111111111111111111111111111': 2, '0x2222222222222222222222222222222222222222': 3 };
    let multicallCalls = 0;
    const D = {
      units: (v, d) => Number(v) / 10 ** d,
      firstOk: async (urls, fn) => fn(urls[0]),
      fetchJSON: async (url) => {
        if (url.includes('coins.llama.fi')) return { coins: Object.fromEntries(Object.entries(prices).map(([a, p]) => ['testchain:' + a, { price: p, decimals: 6, symbol: 'T', confidence: 0.99 }])) };
        throw new Error('unexpected ' + url);
      },
      rpc: async (u, method, params) => {
        if (method === 'eth_call' && params[0].to.toLowerCase() === '0xca11bde05977b3631167028862be2a173976ca11') { multicallCalls++; return answer; }
        if (method === 'eth_call') throw new Error('a single call: the batch should have answered');
        throw new Error(method);
      },
    };
    TOK.LLAMA.testchain = 'testchain';
    TOK.TOP.testchain = toks.map((a, i) => ['T' + i, a, 6]);
    const c = { key: 'testchain', name: 'Test', tokens: [] };
    const r = await TOK.make(D).evm(c, '0x00000000000000000000000000000000000000aa', 'rpc', {});
    const t0 = r.holdings.find((x) => x.addr === toks[0]);
    ok(multicallCalls === 1, 'Multicall3: one call for the whole list', multicallCalls + ' call(s)');
    ok(t0 && near(t0.amount, 123.456789) && near(t0.usdPrice, 2), 'Multicall3: balance decoded and priced', t0 && t0.amount + ' at $' + t0.usdPrice);
    ok(/2 of 3 tokens checked/.test(r.partial || ''), 'Multicall3: a reverted call counts as not checked', r.partial);
  }
  // ---- 4. the same token in the wallet and in a position: capped once ----
  {
    const X = key(5), NFT = key(6), POOL = key(7), L = 10n ** 10n, liq = 40000;
    const { pos, pool } = orca(POOL, NFT, L, 1000, 3000, 1, X, USDC);   // price below the range: all X
    const posKey = await ATA.findProgramAddress([new TextEncoder().encode('position'), ATA.b58decode(NFT)], ORCA);
    const D = solWorld({ holdings: { [X]: [{ uiAmount: 50000 }] }, nfts: [NFT], search: [{ id: X, symbol: 'X', usdPrice: 1, liquidity: liq }],
      llama: { [X]: { price: 1, decimals: 6, symbol: 'X', confidence: 0.99 }, [USDC]: { price: 1, decimals: 6, symbol: 'USDC', confidence: 0.99 } },
      accounts: { [posKey]: { owner: ORCA, data: b64(pos) }, [POOL]: { owner: ORCA, data: b64(pool) } } });
    const r = await TOK.make(D).sol(OWNER);
    const sa = Math.pow(1.0001, 500), sb = Math.pow(1.0001, 1500), inPos = Number(L) * (sb - sa) / (sa * sb) / 1e6;
    const total = 50000 + inPos, side = liq / 2, got = side * total / (side + total);   // one sale of both into the pool
    const sum = r.holdings.filter((x) => x.addr === X).reduce((s, x) => s + x.amount * x.usdPrice, 0);
    const twice = side * 50000 / (side + 50000) + side * inPos / (side + inPos);
    ok(r.holdings.filter((x) => x.addr === X).length === 2, 'same token: wallet and Orca lines both shown');
    ok(near(sum, got, 1e-6), 'same token: capped once against its pools', sum.toFixed(2) + ' vs ' + got.toFixed(2) + ' (capped twice: ' + twice.toFixed(2) + ')');
  }
  console.log('checks: ' + checks + ', failures: ' + fails);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + (e.stack || e)); process.exit(1); });

// app.js - reads the SeedBox payload from the URL fragment, checks every chain
// against public endpoints straight from the browser, and delivers the verdict.
// No keys, no server, nothing stored.
'use strict';
(function () {
  const D = window.SeedDecode;
  const $ = (s) => document.querySelector(s);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

  // A payload with a famous public wallet in the EVM slot, for the landing page demo.
  const DEMO_PAYLOAD = '93ROZY8$12RDWJ/HVRS0XO3JSK$UD$NXP$5QC6WU1*8Q*37U+5EJEJV-J.$OK7K:H/46YBB6WS6JG.*SZ.-/O83I-FNIJ36HL-Q29-:+GCBN29T11297YPVJHV-QNPXY:AO981D:+64NDP:DWD*H5ZX4T9TZ2K/5:J01M3INK47B06VDBR+KFDV9FD$KO1R4LIS0Y$*VH3P8TW-*J39M7+C2PL+/BH96EQV2DMLTB.V*HLBMRO5HW3+FE*KJ0IBMO51-EV-U2FU4RN+:ZH/TP:55CXC5F7M2B.F/ARB:VT-AY1UHF:+U:SV5UY9MXIPZT9*K3VPKI/Q:U6HMDP0ZC$/P*9ITGZLBAA$C+Z0P8OI$VZF8C5S2URSB3$';

  // ---------------- chain registry ----------------
  // Stablecoin contracts were checked by calling symbol() on each one.
  const EVM = [
    { key: 'eth', name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', symbol: 'ETH', price: 'ethereum', explorer: 'https://etherscan.io/address/',
      tokens: [t('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'usd-coin'), t('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'tether')] },
    { key: 'base', name: 'Base', rpc: 'https://base-rpc.publicnode.com', symbol: 'ETH', price: 'ethereum', explorer: 'https://basescan.org/address/',
      tokens: [t('USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'usd-coin')] },
    { key: 'arb', name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com', symbol: 'ETH', price: 'ethereum', explorer: 'https://arbiscan.io/address/',
      tokens: [t('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, 'usd-coin'), t('USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6, 'tether'), t('USDC.e', '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', 6, 'usd-coin')] },
    { key: 'op', name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com', symbol: 'ETH', price: 'ethereum', explorer: 'https://optimistic.etherscan.io/address/',
      tokens: [t('USDC', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6, 'usd-coin'), t('USDT', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 6, 'tether')] },
    { key: 'polygon', name: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', symbol: 'POL', price: 'polygon-ecosystem-token', explorer: 'https://polygonscan.com/address/',
      tokens: [t('USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6, 'usd-coin'), t('USDT', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6, 'tether'), t('USDC.e', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 6, 'usd-coin')] },
    { key: 'bsc', name: 'BNB Chain', rpc: 'https://bsc-rpc.publicnode.com', symbol: 'BNB', price: 'binancecoin', explorer: 'https://bscscan.com/address/',
      tokens: [t('USDT', '0x55d398326f99059fF775485246999027B3197955', 18, 'tether'), t('USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18, 'usd-coin')] },
    { key: 'avax', name: 'Avalanche', rpc: 'https://avalanche-c-chain-rpc.publicnode.com', symbol: 'AVAX', price: 'avalanche-2', explorer: 'https://snowscan.xyz/address/',
      tokens: [t('USDC', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 6, 'usd-coin'), t('USDT', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 6, 'tether')] },
    { key: 'linea', name: 'Linea', rpc: 'https://linea-rpc.publicnode.com', symbol: 'ETH', price: 'ethereum', explorer: 'https://lineascan.build/address/', tokens: [] },
    { key: 'scroll', name: 'Scroll', rpc: 'https://scroll-rpc.publicnode.com', symbol: 'ETH', price: 'ethereum', explorer: 'https://scrollscan.com/address/', tokens: [] },
    { key: 'gnosis', name: 'Gnosis', rpc: 'https://gnosis-rpc.publicnode.com', symbol: 'xDAI', price: 'xdai', explorer: 'https://gnosisscan.io/address/', tokens: [] },
    { key: 'blast', name: 'Blast', rpc: 'https://blast-rpc.publicnode.com', symbol: 'ETH', price: 'ethereum', explorer: 'https://blastscan.io/address/', tokens: [] },
  ];
  function t(symbol, addr, dec, price) { return { symbol, addr, dec, price }; }

  const COSMOS = [
    { key: 'atom', name: 'Cosmos Hub', rest: 'https://rest.cosmos.directory/cosmoshub', denom: 'uatom', dec: 6, symbol: 'ATOM', price: 'cosmos', explorer: 'https://www.mintscan.io/cosmos/address/' },
    { key: 'osmo', name: 'Osmosis', rest: 'https://rest.cosmos.directory/osmosis', denom: 'uosmo', dec: 6, symbol: 'OSMO', price: 'osmosis', explorer: 'https://www.mintscan.io/osmosis/address/' },
    { key: 'tia', name: 'Celestia', rest: 'https://rest.cosmos.directory/celestia', denom: 'utia', dec: 6, symbol: 'TIA', price: 'celestia', explorer: 'https://www.mintscan.io/celestia/address/' },
    { key: 'dydx', name: 'dYdX', rest: 'https://rest.cosmos.directory/dydx', denom: 'adydx', dec: 18, symbol: 'DYDX', price: 'dydx-chain', explorer: 'https://www.mintscan.io/dydx/address/' },
    { key: 'sei', name: 'Sei', rest: 'https://rest.cosmos.directory/sei', denom: 'usei', dec: 6, symbol: 'SEI', price: 'sei-network', explorer: 'https://www.mintscan.io/sei/address/' },
    { key: 'akt', name: 'Akash', rest: 'https://rest.cosmos.directory/akash', denom: 'uakt', dec: 6, symbol: 'AKT', price: 'akash-network', explorer: 'https://www.mintscan.io/akash/address/' },
    { key: 'juno', name: 'Juno', rest: 'https://rest.cosmos.directory/juno', denom: 'ujuno', dec: 6, symbol: 'JUNO', price: 'juno-network', explorer: 'https://www.mintscan.io/juno/address/' },
    // No Stargaze REST endpoint sends CORS headers (checked every one in the chain registry), so a browser cannot ask.
    { key: 'stars', name: 'Stargaze', rest: 'https://rest.stargaze-apis.com', denom: 'ustars', dec: 6, symbol: 'STARS', price: 'stargaze', explorer: 'https://www.mintscan.io/stargaze/address/', unavailable: 'No Stargaze server lets a browser ask; tap the explorer link instead' },
  ];
  const INJ = { name: 'Injective', rest: 'https://rest.cosmos.directory/injective', denom: 'inj', dec: 18, symbol: 'INJ', price: 'injective-protocol', explorer: 'https://www.mintscan.io/injective/address/' };

  const SOL_RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
  const SOL_STABLES = [['USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'usd-coin'], ['USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'tether']];
  const TRX_STABLES = { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: ['USDT', 'tether', 6], TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: ['USDC', 'usd-coin', 6] };

  // ---------------- fetch helpers ----------------
  async function fetchJSON(url, opts, timeoutMs) {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), timeoutMs || 15000);
    try {
      const r = await fetch(url, Object.assign({}, opts, { signal: c.signal }));
      if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  async function rpc(url, method, params) {
    const j = await fetchJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result;
  }
  async function firstOk(urls, fn) {
    let last;
    for (const u of urls) { try { return await fn(u); } catch (e) { last = e; } }
    throw last || new Error('no endpoint answered');
  }
  // integer string / hex / bigint in base units -> float
  function units(v, dec) {
    const n = typeof v === 'bigint' ? v : BigInt(v);
    const d = 10n ** BigInt(dec);
    return Number(n / d) + Number(n % d) / Number(d);
  }
  function h(symbol, amount, price) { return { symbol, amount, price }; }

  // ---------------- per-chain checks ----------------
  // Each returns { holdings: [{symbol, amount, price}], others: n, partial: text|null }.
  // holdings decide the verdict; others is a count of tokens that do not.
  async function checkEvm(c, addr) {
    const bal = await rpc(c.rpc, 'eth_getBalance', [addr, 'latest']);
    const holdings = [h(c.symbol, units(bal, 18), c.price)];
    const owner = addr.slice(2).toLowerCase().padStart(64, '0');
    const res = await Promise.allSettled(c.tokens.map((tk) => rpc(c.rpc, 'eth_call', [{ to: tk.addr, data: '0x70a08231' + owner }, 'latest'])));
    let failed = 0;
    res.forEach((r, i) => {
      if (r.status === 'fulfilled' && /^0x[0-9a-fA-F]+$/.test(r.value)) holdings.push(h(c.tokens[i].symbol, units(r.value, c.tokens[i].dec), c.tokens[i].price));
      else failed++;
    });
    return { holdings, others: 0, partial: failed ? 'stablecoins not checked' : null };
  }
  async function checkMempoolStyle(base, addr, symbol, price) {
    const j = await fetchJSON(base + addr);
    const c = j.chain_stats, m = j.mempool_stats;
    const sats = BigInt(c.funded_txo_sum) - BigInt(c.spent_txo_sum) + BigInt(m.funded_txo_sum) - BigInt(m.spent_txo_sum);
    return { holdings: [h(symbol, units(sats, 8), price)], others: 0, partial: null };
  }
  async function checkDoge(addr) {
    const j = await fetchJSON('https://api.blockcypher.com/v1/doge/main/addrs/' + addr + '/balance');
    return { holdings: [h('DOGE', units(BigInt(j.final_balance), 8), 'dogecoin')], others: 0, partial: null };
  }
  // Public Solana RPCs refuse the "list all token accounts" call, so the page
  // derives the wallet's USDC and USDT accounts itself (ata.js) and reads those.
  async function checkSol(addr) {
    const r = await firstOk(SOL_RPCS, (u) => rpc(u, 'getBalance', [addr]));
    const holdings = [h('SOL', units(BigInt(r.value), 9), 'solana')];
    let partial = null;
    try {
      for (const [symbol, mint, price] of SOL_STABLES) {
        const ata = await window.SolanaATA.associatedTokenAddress(addr, mint);
        const info = await firstOk(SOL_RPCS, (u) => rpc(u, 'getAccountInfo', [ata, { encoding: 'jsonParsed' }]));
        const parsed = info && info.value && info.value.data && info.value.data.parsed && info.value.data.parsed.info;
        if (parsed && parsed.mint === mint && parsed.tokenAmount && parsed.tokenAmount.uiAmount > 0) holdings.push(h(symbol, parsed.tokenAmount.uiAmount, price));
      }
    } catch (e) { partial = 'stablecoins not checked'; }
    return { holdings, others: 0, partial: partial || 'other SPL tokens not checked' };
  }
  async function checkTrx(addr) {
    const j = await fetchJSON('https://api.trongrid.io/v1/accounts/' + addr);
    const d = (j.data && j.data[0]) || {};
    const holdings = [h('TRX', units(BigInt(d.balance || 0), 6), 'tron')];
    let others = 0;
    for (const entry of d.trc20 || []) for (const [contract, amt] of Object.entries(entry)) {
      if (BigInt(amt) <= 0n) continue;
      if (TRX_STABLES[contract]) holdings.push(h(TRX_STABLES[contract][0], units(BigInt(amt), TRX_STABLES[contract][2]), TRX_STABLES[contract][1]));
      else others++;
    }
    return { holdings, others, partial: null };
  }
  async function checkCosmos(c, addr) {
    const j = await fetchJSON(c.rest + '/cosmos/bank/v1beta1/balances/' + addr + '?pagination.limit=200');
    let native = 0n, others = 0;
    for (const b of j.balances || []) {
      if (b.denom === c.denom) native = BigInt(b.amount);
      else if (BigInt(b.amount) > 0n) others++;
    }
    return { holdings: [h(c.symbol, units(native, c.dec), c.price)], others, partial: null };
  }
  async function checkXrp(addr) {
    const j = await fetchJSON('https://xrplcluster.com/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'account_info', params: [{ account: addr, ledger_index: 'validated' }] }) });
    const r = j.result || {};
    let drops = 0n;
    if (r.error === 'actNotFound') drops = 0n;
    else if (r.error || r.status === 'error') throw new Error(r.error_message || r.error || 'xrpl error');
    else drops = BigInt(r.account_data.Balance);
    return { holdings: [h('XRP', units(drops, 6), 'ripple')], others: 0, partial: null };
  }
  // Sui's public JSON-RPC nodes send no CORS headers; the GraphQL service does.
  async function checkSui(addr) {
    const j = await fetchJSON('https://graphql.mainnet.sui.io/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      query: 'query($a: SuiAddress!) { address(address: $a) { balances(first: 50) { nodes { coinType { repr } totalBalance } } } }', variables: { a: addr } }) });
    if (j.errors && j.errors.length) throw new Error(j.errors[0].message || 'graphql error');
    const nodes = (j.data && j.data.address && j.data.address.balances && j.data.address.balances.nodes) || [];
    let native = 0n, others = 0;
    for (const b of nodes) {
      if (/::sui::SUI$/.test(b.coinType.repr)) native = BigInt(b.totalBalance);
      else if (BigInt(b.totalBalance) > 0n) others++;
    }
    return { holdings: [h('SUI', units(native, 9), 'sui')], others, partial: null };
  }
  async function checkApt(addr) {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(), 15000);
    try {
      const r = await fetch('https://fullnode.mainnet.aptoslabs.com/v1/accounts/' + addr + '/balance/0x1::aptos_coin::AptosCoin', { signal: c.signal });
      let octas = 0n;
      if (r.ok) octas = BigInt((await r.text()).trim().replace(/"/g, ''));
      else if (r.status !== 404) throw new Error('HTTP ' + r.status);
      return { holdings: [h('APT', units(octas, 8), 'aptos')], others: 0, partial: null };
    } finally { clearTimeout(timer); }
  }

  function buildChecks(a) {
    const list = [];
    list.push({ name: 'Bitcoin', addr: a.btc, explorer: 'https://mempool.space/address/', run: () => checkMempoolStyle('https://mempool.space/api/address/', a.btc, 'BTC', 'bitcoin') });
    list.push({ name: 'Bitcoin (legacy 1...)', addr: a.btcLegacy, explorer: 'https://mempool.space/address/', run: () => checkMempoolStyle('https://mempool.space/api/address/', a.btcLegacy, 'BTC', 'bitcoin') });
    for (const c of EVM) list.push({ name: c.name, addr: a.evm, explorer: c.explorer, run: () => checkEvm(c, a.evm) });
    list.push({ name: 'Solana', addr: a.sol, explorer: 'https://solscan.io/account/', run: () => checkSol(a.sol) });
    list.push({ name: 'Tron', addr: a.trx, explorer: 'https://tronscan.org/#/address/', run: () => checkTrx(a.trx) });
    list.push({ name: 'XRP Ledger', addr: a.xrp, explorer: 'https://xrpscan.com/account/', run: () => checkXrp(a.xrp) });
    list.push({ name: 'Sui', addr: a.sui, explorer: 'https://suiscan.xyz/mainnet/account/', run: () => checkSui(a.sui) });
    list.push({ name: 'Aptos', addr: a.apt, explorer: 'https://explorer.aptoslabs.com/account/', explorerSuffix: '?network=mainnet', run: () => checkApt(a.apt) });
    list.push({ name: 'Litecoin', addr: a.ltc, explorer: 'https://litecoinspace.org/address/', run: () => checkMempoolStyle('https://litecoinspace.org/api/address/', a.ltc, 'LTC', 'litecoin') });
    list.push({ name: 'Dogecoin', addr: a.doge, explorer: 'https://dogechain.info/address/', run: () => checkDoge(a.doge) });
    for (const c of COSMOS) list.push({ name: c.name, addr: a.cosmos[c.key], explorer: c.explorer, unavailable: c.unavailable, run: () => checkCosmos(c, a.cosmos[c.key]) });
    list.push({ name: INJ.name, addr: a.inj, explorer: INJ.explorer, run: () => checkCosmos(INJ, a.inj) });
    return list;
  }

  async function fetchPrices(ids) {
    try {
      const j = await fetchJSON('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=' + encodeURIComponent([...ids].join(',')), undefined, 10000);
      const out = {};
      for (const [k, v] of Object.entries(j)) if (v && typeof v.usd === 'number') out[k] = v.usd;
      return out;
    } catch (e) { return {}; }
  }

  // ---------------- formatting ----------------
  function shortAddr(s) { return s.length > 16 ? s.slice(0, 8) + '…' + s.slice(-6) : s; }
  function fmtAmount(n) {
    if (n === 0) return '0';
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return n.toLocaleString(undefined, { maximumSignificantDigits: 4 });
  }
  function fmtUsd(n) {
    if (n < 0.01) return 'under $0.01';
    if (n >= 100) return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (n >= 1) return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return '$' + n.toLocaleString(undefined, { maximumSignificantDigits: 2 });
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // ---------------- confetti ----------------
  function confetti() {
    const c = $('#confetti');
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr; ctx.scale(dpr, dpr);
    c.style.display = 'block';
    const colors = ['#f5c542', '#f7f1e3', '#2fd57a', '#ffffff', '#2b4ec2'];
    const P = Array.from({ length: 160 }, () => ({
      x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 2.2, vy: 2 + Math.random() * 3,
      s: 5 + Math.random() * 7, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.25, col: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of P) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.035;
        if (p.y < H + 20) alive = true;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      if (alive && now - t0 < 7000) requestAnimationFrame(frame); else c.style.display = 'none';
    })(t0);
  }

  // ---------------- the show ----------------
  async function run(payloadText) {
    let addr;
    try {
      addr = await D.addressesFrom(D.parsePayload(payloadText));
    } catch (e) {
      $('#error-text').textContent = e.message;
      $('#error').hidden = false;
      return;
    }
    const caseId = shortAddr(addr.evm);
    $('#case-id').textContent = 'case ' + caseId;
    $('#case-wallet').textContent = caseId;
    $('#stage').hidden = false;

    const checks = buildChecks(addr);
    const total = checks.length;
    const meter = $('#meter'), fill = $('#meter-fill'), ptext = $('#progress-text');
    meter.setAttribute('aria-valuemax', String(total));
    let done = 0;
    ptext.textContent = 'Checking ' + total + ' networks';

    const priceIds = new Set();
    const results = await Promise.all(checks.map(async (c) => {
      let r;
      try {
        if (c.unavailable) throw new Error(c.unavailable);
        r = await c.run();
        for (const x of r.holdings) if (x.price) priceIds.add(x.price);
        r.ok = true;
      } catch (e) {
        r = { ok: false, error: e.message || String(e), holdings: [], others: 0, partial: null };
      }
      done++;
      fill.style.width = (100 * done / total) + '%';
      meter.setAttribute('aria-valuenow', String(done));
      ptext.textContent = done + ' of ' + total + ' networks answered';
      return Object.assign({ check: c }, r);
    }));
    const prices = await fetchPrices(priceIds);

    // tally
    let usd = 0, chainsWithCoins = 0, answered = 0, otherTokens = 0, priced = true;
    for (const r of results) {
      if (!r.ok) continue;
      answered++;
      otherTokens += r.others;
      let any = false;
      for (const x of r.holdings) {
        if (x.amount <= 0) continue;
        any = true;
        if (prices[x.price] != null) { x.usd = x.amount * prices[x.price]; usd += x.usd; } else priced = false;
      }
      if (any) chainsWithCoins++;
    }
    const unavailable = results.filter((r) => !r.ok && r.check.unavailable).length;
    const failed = total - answered - unavailable;
    const verdictEl = $('#verdict');
    const textEl = $('#verdict-text');
    const subEl = $('#verdict-sub');
    const fineEl = $('#verdict-fine');

    if (answered === 0) {
      textEl.innerHTML = 'The lab <em>lost the envelope.</em>';
      subEl.textContent = 'No network answered. Check your connection and scan again.';
      fineEl.textContent = '';
    } else if (chainsWithCoins > 0) {
      verdictEl.classList.add('yes');
      textEl.innerHTML = 'You <em>are</em> in possession of coins.';
      subEl.textContent = (usd > 0 ? fmtUsd(usd) + (priced ? '' : ' or more') + ' across ' : 'Coins on ') + plural(chainsWithCoins, 'network', 'networks') + '.';
      fineEl.textContent = (otherTokens ? 'Plus ' + plural(otherTokens, 'other token', 'other tokens') + ' that did not count. ' : '') + (failed ? plural(failed, 'network', 'networks') + ' did not answer.' : '');
    } else {
      verdictEl.classList.add('no');
      textEl.innerHTML = 'You are <em>not</em> in possession of coins.';
      subEl.textContent = answered + ' networks checked. Nothing. Not even dust.';
      fineEl.textContent = (otherTokens ? plural(otherTokens, 'airdropped token', 'airdropped tokens') + ' found, which does not count. ' : '') + (failed ? plural(failed, 'network', 'networks') + ' did not answer, so there is still a sliver of hope.' : '');
    }

    // the reveal
    const env = $('#envelope');
    env.classList.remove('checking');
    await wait(900);
    env.classList.add('open');
    await wait(750);
    $('#stage').hidden = true;
    if (!reduced) verdictEl.classList.add('animate');
    verdictEl.hidden = false;
    if (chainsWithCoins > 0 && !reduced) confetti();
    renderCaseFile(results, failed);
    await wait(500);
    $('#casefile').hidden = false;
  }

  function renderCaseFile(results, failed) {
    const ul = $('#rows');
    const rank = (r) => (!r.ok ? (r.check.unavailable ? 3 : 1) : r.holdings.some((x) => x.amount > 0) ? 0 : 2);
    const sorted = results.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
    for (const r of sorted) {
      const li = document.createElement('li');
      li.tabIndex = 0;
      const nonzero = r.holdings.filter((x) => x.amount > 0);
      if (nonzero.length) li.classList.add('has-coins');
      const name = document.createElement('span'); name.className = 'name'; name.textContent = r.check.name;
      const addrShort = document.createElement('span'); addrShort.className = 'addr short'; addrShort.textContent = shortAddr(r.check.addr);
      const addrFull = document.createElement('span'); addrFull.className = 'addr full'; addrFull.textContent = r.check.addr;
      const amount = document.createElement('span'); amount.className = 'amount';
      if (!r.ok) { amount.classList.add('failed'); amount.textContent = r.check.unavailable ? 'not checkable' : 'did not answer'; }
      else if (!nonzero.length) { amount.classList.add('none'); amount.textContent = 'nothing'; }
      else {
        let usd = 0, anyUsd = false;
        for (const x of nonzero) {
          const line = document.createElement('span'); line.className = 'h'; line.textContent = fmtAmount(x.amount) + ' ' + x.symbol;
          amount.appendChild(line);
          if (x.usd != null) { usd += x.usd; anyUsd = true; }
        }
        if (anyUsd) { const u = document.createElement('span'); u.className = 'usd'; u.textContent = fmtUsd(usd); amount.appendChild(u); }
      }
      const more = document.createElement('span'); more.className = 'more';
      const bits = [];
      if (r.ok && r.others) bits.push(plural(r.others, 'other token', 'other tokens') + ' not counted');
      if (r.ok && r.partial) bits.push(r.partial);
      if (!r.ok) bits.push(r.error);
      more.textContent = bits.join('. ');
      const link = document.createElement('a');
      link.href = r.check.explorer + r.check.addr + (r.check.explorerSuffix || '');
      link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open in explorer';
      more.appendChild(link);
      li.append(name, amount, addrShort, addrFull, more);
      const toggle = () => li.classList.toggle('expanded');
      li.addEventListener('click', (e) => { if (e.target.tagName !== 'A') toggle(); });
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      ul.appendChild(li);
    }
    $('#casefile-note').textContent = 'Bitcoin and Litecoin show the first receive address only; a wallet that has been used may hold coins on later addresses, which the BTC zpub entry on the device covers.' + (failed ? ' Tap a row for the reason it did not answer.' : '');
  }

  // ---------------- entry ----------------
  const frag = D.parseFragment(location.hash);
  if (!frag) {
    $('#landing').hidden = false;
    $('#demo-link').href = '#' + DEMO_PAYLOAD;
  } else {
    run(frag);
  }
  window.addEventListener('hashchange', () => location.reload());
})();

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
  // Every network here is read from a key the device already puts in the QR, so adding
  // one costs nothing on the device. Stablecoin contracts were checked by calling
  // symbol() and decimals() on each one; every endpoint was checked for CORS from a
  // browser. rpcs: the first that answers is used, so one flaky public node does not
  // lose a network.
  const EVM = [
    { key: 'eth', name: 'Ethereum', rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://etherscan.io/address/',
      tokens: [t('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'usd-coin'), t('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'tether')] },
    { key: 'base', name: 'Base', rpcs: ['https://base-rpc.publicnode.com', 'https://base.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://basescan.org/address/',
      tokens: [t('USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'usd-coin')] },
    { key: 'arb', name: 'Arbitrum', rpcs: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://arbiscan.io/address/',
      tokens: [t('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, 'usd-coin'), t('USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6, 'tether'), t('USDC.e', '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', 6, 'usd-coin')] },
    { key: 'op', name: 'Optimism', rpcs: ['https://optimism-rpc.publicnode.com', 'https://optimism.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://optimistic.etherscan.io/address/',
      tokens: [t('USDC', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6, 'usd-coin'), t('USDT', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 6, 'tether')] },
    { key: 'polygon', name: 'Polygon', rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'], symbol: 'POL', price: 'polygon-ecosystem-token', explorer: 'https://polygonscan.com/address/',
      tokens: [t('USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6, 'usd-coin'), t('USDT', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6, 'tether'), t('USDC.e', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 6, 'usd-coin')] },
    { key: 'bsc', name: 'BNB Chain', rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'], symbol: 'BNB', price: 'binancecoin', explorer: 'https://bscscan.com/address/',
      tokens: [t('USDT', '0x55d398326f99059fF775485246999027B3197955', 18, 'tether'), t('USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18, 'usd-coin')] },
    { key: 'avax', name: 'Avalanche', rpcs: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org'], symbol: 'AVAX', price: 'avalanche-2', explorer: 'https://snowscan.xyz/address/',
      tokens: [t('USDC', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 6, 'usd-coin'), t('USDT', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 6, 'tether')] },
    { key: 'linea', name: 'Linea', rpcs: ['https://linea-rpc.publicnode.com', 'https://linea.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://lineascan.build/address/', tokens: [] },
    { key: 'scroll', name: 'Scroll', rpcs: ['https://scroll-rpc.publicnode.com', 'https://scroll.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://scrollscan.com/address/', tokens: [] },
    { key: 'gnosis', name: 'Gnosis', rpcs: ['https://gnosis-rpc.publicnode.com', 'https://gnosis.drpc.org'], symbol: 'xDAI', price: 'xdai', explorer: 'https://gnosisscan.io/address/', tokens: [] },
    { key: 'blast', name: 'Blast', rpcs: ['https://blast-rpc.publicnode.com', 'https://blast.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://blastscan.io/address/', tokens: [] },
    { key: 'zksync', name: 'zkSync Era', rpcs: ['https://mainnet.era.zksync.io', 'https://zksync.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://explorer.zksync.io/address/',
      tokens: [t('USDC', '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', 6, 'usd-coin'), t('USDT', '0x493257fD37EDB34451f62EDf8D2a0C418852bA4C', 6, 'tether'), t('USDC.e', '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4', 6, 'usd-coin')] },
    { key: 'mantle', name: 'Mantle', rpcs: ['https://mantle-rpc.publicnode.com', 'https://rpc.mantle.xyz'], symbol: 'MNT', price: 'mantle', explorer: 'https://mantlescan.xyz/address/',
      tokens: [t('USDC', '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9', 6, 'usd-coin'), t('USDT', '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE', 6, 'tether')] },
    { key: 'sonic', name: 'Sonic', rpcs: ['https://sonic-rpc.publicnode.com', 'https://rpc.soniclabs.com'], symbol: 'S', price: 'sonic-3', explorer: 'https://sonicscan.org/address/',
      tokens: [t('USDC', '0x29219dd400f2Bf60E5a23d13Be72B486D4038894', 6, 'usd-coin'), t('USDT', '0x6047828dc181963ba44974801FF68e538dA5eaF9', 6, 'tether')] },
    { key: 'ftm', name: 'Fantom', rpcs: ['https://fantom.drpc.org'], symbol: 'FTM', price: 'fantom', explorer: 'https://ftmscan.com/address/',
      tokens: [t('USDC', '0x28a92dde19D9989F39A49905d7C9C2FAc7799bDf', 6, 'usd-coin'), t('USDC.e', '0x04068DA6C83AFCFA0e13ba15A6696662335D5B75', 6, 'usd-coin'), t('USDT', '0xcc1b99dDAc1a33c201a742A1851662E87BC7f22C', 6, 'tether'), t('fUSDT', '0x049d68029688eAbF473097a2fC38ef61633A3C7A', 6, 'tether')] },
    { key: 'celo', name: 'Celo', rpcs: ['https://celo-rpc.publicnode.com', 'https://forno.celo.org'], symbol: 'CELO', price: 'celo', explorer: 'https://celoscan.io/address/',
      tokens: [t('USDC', '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', 6, 'usd-coin'), t('USDT', '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', 6, 'tether'), t('USDm', '0x765DE816845861e75A25fCA122bb6898B8B1282a', 18, 'celo-dollar')] },
    { key: 'cro', name: 'Cronos', rpcs: ['https://cronos-evm-rpc.publicnode.com', 'https://evm.cronos.org'], symbol: 'CRO', price: 'crypto-com-chain', explorer: 'https://cronoscan.com/address/',
      tokens: [t('USDC', '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59', 6, 'usd-coin'), t('USDT', '0x66e428c3f67a68878562e79A0234c1F83c208770', 6, 'tether')] },
    { key: 'opbnb', name: 'opBNB', rpcs: ['https://opbnb-rpc.publicnode.com', 'https://opbnb-mainnet-rpc.bnbchain.org'], symbol: 'BNB', price: 'binancecoin', explorer: 'https://opbnbscan.com/address/',
      tokens: [t('USDT', '0x9e5AAC1Ba1a2e6aEd6b32689DFcF62A509Ca96f3', 18, 'tether')] },
    { key: 'bera', name: 'Berachain', rpcs: ['https://berachain-rpc.publicnode.com', 'https://rpc.berachain.com'], symbol: 'BERA', price: 'berachain-bera', explorer: 'https://berascan.com/address/',
      tokens: [t('USDC.e', '0x549943e04f40284185054145c6E4e9568C1D3241', 6, 'usd-coin')] },
    { key: 'uni', name: 'Unichain', rpcs: ['https://unichain-rpc.publicnode.com', 'https://mainnet.unichain.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://uniscan.xyz/address/',
      tokens: [t('USDC', '0x078D782b760474a361dDA0AF3839290b0EF57AD6', 6, 'usd-coin')] },
    { key: 'zkevm', name: 'Polygon zkEVM', rpcs: ['https://zkevm-rpc.com', 'https://polygon-zkevm.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://zkevm.polygonscan.com/address/',
      tokens: [t('USDC', '0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035', 6, 'usd-coin'), t('USDT', '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', 6, 'tether')] },
    { key: 'world', name: 'World Chain', rpcs: ['https://worldchain-mainnet.g.alchemy.com/public', 'https://worldchain.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://worldscan.org/address/',
      tokens: [t('USDC', '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', 6, 'usd-coin')] },
    { key: 'hyperevm', name: 'HyperEVM', rpcs: ['https://rpc.hyperliquid.xyz/evm', 'https://hyperliquid-rpc.publicnode.com'], symbol: 'HYPE', price: 'hyperliquid', explorer: 'https://hyperevmscan.io/address/',
      tokens: [t('USDT0', '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', 6, 'usdt0')] },
  ];
  function t(symbol, addr, dec, price) { return { symbol, addr, dec, price }; }

  // Cosmos chains on the m/44'/118' key. stables: denoms that count like a stablecoin,
  // native USDC on Noble and Axelar, Noble USDC carried over IBC elsewhere. Each IBC hash
  // was resolved through the chain's own denom trace endpoint.
  const USDC = ['USDC', 6, 'usd-coin'], AXLUSDC = ['axlUSDC', 6, 'usd-coin'];
  const COSMOS = [
    { key: 'atom', name: 'Cosmos Hub', rest: 'https://rest.cosmos.directory/cosmoshub', denom: 'uatom', dec: 6, symbol: 'ATOM', price: 'cosmos', explorer: 'https://www.mintscan.io/cosmos/address/',
      stables: { 'ibc/F663521BF1836B00F5F177680F74BFB9A8B5654A694D0D2BC249E03CF2509013': USDC } },
    { key: 'osmo', name: 'Osmosis', rest: 'https://rest.cosmos.directory/osmosis', denom: 'uosmo', dec: 6, symbol: 'OSMO', price: 'osmosis', explorer: 'https://www.mintscan.io/osmosis/address/',
      stables: { 'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4': USDC, 'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858': AXLUSDC } },
    { key: 'tia', name: 'Celestia', rest: 'https://rest.cosmos.directory/celestia', denom: 'utia', dec: 6, symbol: 'TIA', price: 'celestia', explorer: 'https://www.mintscan.io/celestia/address/' },
    { key: 'dydx', name: 'dYdX', rest: 'https://rest.cosmos.directory/dydx', denom: 'adydx', dec: 18, symbol: 'DYDX', price: 'dydx-chain', explorer: 'https://www.mintscan.io/dydx/address/',
      stables: { 'ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5': USDC } },
    { key: 'sei', name: 'Sei', rest: 'https://rest.cosmos.directory/sei', denom: 'usei', dec: 6, symbol: 'SEI', price: 'sei-network', explorer: 'https://www.mintscan.io/sei/address/' },
    { key: 'akt', name: 'Akash', rest: 'https://rest.cosmos.directory/akash', denom: 'uakt', dec: 6, symbol: 'AKT', price: 'akash-network', explorer: 'https://www.mintscan.io/akash/address/' },
    { key: 'juno', name: 'Juno', rest: 'https://rest.cosmos.directory/juno', denom: 'ujuno', dec: 6, symbol: 'JUNO', price: 'juno-network', explorer: 'https://www.mintscan.io/juno/address/' },
    // No Stargaze REST endpoint sends CORS headers (checked every one in the chain registry), so a browser cannot ask.
    { key: 'stars', name: 'Stargaze', rest: 'https://rest.stargaze-apis.com', denom: 'ustars', dec: 6, symbol: 'STARS', price: 'stargaze', explorer: 'https://www.mintscan.io/stargaze/address/', unavailable: 'No Stargaze server lets a browser ask; tap the explorer link instead' },
    { key: 'noble', name: 'Noble', rest: 'https://rest.cosmos.directory/noble', denom: 'uusdc', dec: 6, symbol: 'USDC', price: 'usd-coin', explorer: 'https://www.mintscan.io/noble/address/' },
    { key: 'ntrn', name: 'Neutron', rest: 'https://rest.cosmos.directory/neutron', denom: 'untrn', dec: 6, symbol: 'NTRN', price: 'neutron-3', explorer: 'https://www.mintscan.io/neutron/address/',
      stables: { 'ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81': USDC } },
    { key: 'strd', name: 'Stride', rest: 'https://rest.cosmos.directory/stride', denom: 'ustrd', dec: 6, symbol: 'STRD', price: 'stride', explorer: 'https://www.mintscan.io/stride/address/' },
    { key: 'axl', name: 'Axelar', rest: 'https://rest.cosmos.directory/axelar', denom: 'uaxl', dec: 6, symbol: 'AXL', price: 'axelar', explorer: 'https://www.mintscan.io/axelar/address/',
      stables: { uusdc: AXLUSDC } },
  ];
  const INJ = { name: 'Injective', rest: 'https://rest.cosmos.directory/injective', denom: 'inj', dec: 18, symbol: 'INJ', price: 'injective-protocol', explorer: 'https://www.mintscan.io/injective/address/',
    stables: { 'ibc/2CBC2EA121AE42563B08028466F37B600F2D7D4282342DE938283CC3FB2BC00E': USDC } };

  const SOL_RPCS = ['https://solana-rpc.publicnode.com', 'https://solana.leorpc.com/?api_key=FREE']   // mainnet-beta refuses browser origins (403);
  const SOL_STABLES = [['USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'usd-coin'], ['USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'tether']];
  const TRX_STABLES = { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: ['USDT', 'tether', 6], TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: ['USDC', 'usd-coin', 6] };
  // Hyperliquid's own ledger, same address as the EVM key. Spot coins that count.
  const HL_INFO = 'https://api.hyperliquid.xyz/info';
  const HL_COINS = { USDC: 'usd-coin', HYPE: 'hyperliquid', USDT0: 'usdt0', USDH: 'usdh-2' };   // usdh-2 is Native Markets' USDH on Hyperliquid

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
    let url = c.rpcs[0];
    const bal = await firstOk(c.rpcs, async (u) => { const r = await rpc(u, 'eth_getBalance', [addr, 'latest']); url = u; return r; });
    const holdings = [h(c.symbol, units(bal, 18), c.price)];
    const owner = addr.slice(2).toLowerCase().padStart(64, '0');
    const res = await Promise.allSettled(c.tokens.map((tk) => rpc(url, 'eth_call', [{ to: tk.addr, data: '0x70a08231' + owner }, 'latest'])));
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
    const holdings = [];
    for (const b of j.balances || []) {
      const st = c.stables && c.stables[b.denom];
      if (b.denom === c.denom) native = BigInt(b.amount);
      else if (st) { if (BigInt(b.amount) > 0n) holdings.push(h(st[0], units(b.amount, st[1]), st[2])); }
      else if (BigInt(b.amount) > 0n) others++;
    }
    holdings.unshift(h(c.symbol, units(native, c.dec), c.price));
    return { holdings, others, partial: null };
  }
  // Perps account value plus spot balances on Hyperliquid itself.
  async function checkHyperliquid(addr) {
    const ask = (type) => fetchJSON(HL_INFO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, user: addr }) });
    const [perp, spot] = await Promise.all([ask('clearinghouseState'), ask('spotClearinghouseState')]);
    const holdings = [];
    const perpUsd = Number(((perp || {}).marginSummary || {}).accountValue || 0);
    if (perpUsd > 0) holdings.push(h('USDC (perps)', perpUsd, 'usd-coin'));
    let others = 0;
    for (const b of (spot || {}).balances || []) {
      const amt = Number(b.total || 0);
      if (!(amt > 0)) continue;
      if (b.coin in HL_COINS) holdings.push(h(b.coin, amt, HL_COINS[b.coin]));
      else others++;
    }
    if (!holdings.length) holdings.push(h('USDC', 0, 'usd-coin'));
    return { holdings, others, partial: null };
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
    list.push({ name: 'Hyperliquid', addr: a.evm, explorer: 'https://app.hyperliquid.xyz/explorer/address/', run: () => checkHyperliquid(a.evm) });
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

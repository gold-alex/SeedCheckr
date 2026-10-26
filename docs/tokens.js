// tokens.js - every token a wallet holds, not just its native coin and stablecoins.
//
// EVM: ask a free API that lists an address's tokens: the network's explorer (Blockscout,
// Routescan, Ethplorer/Binplorer, the zkSync explorer, Oasis Nexus, Fantom's own API),
// then the wallet APIs MetaMask and Rabby call without a key (first that answers wins).
// Where none answers, read a fixed list of the network's biggest tokens with eth_call.
// Solana: Jupiter lists every token account (public RPCs refuse to); otherwise read the
// associated accounts of the biggest tokens.
//
// Spam: airdropped tokens often carry a market price nobody could sell at (a token "worth"
// $323k that traded $203 that day). So a token counts at what selling it into its DEX
// pools would return (constant-product: never more than the pools' other side; liquidity
// from DexScreener, or Jupiter's own figure on Solana), not at all below $20k of
// liquidity, and only from $1 up. The
// biggest tokens of each network (TOP) are trusted as they are. Everything else is
// reported as "other tokens", which never decide the verdict.
//
// DeFi: positions that are not plain tokens (lending, staking, liquidity pools) come from
// MetaMask's DeFi API (49 protocols, mostly on Ethereum), and Uniswap-v3-style liquidity
// NFTs are also read on-chain on the networks below. A protocol with debt on a network
// counts as one line, its deposits minus that debt. A receipt token counted as a position
// (aUSDC, stETH, a pool token) is not counted again from the token list.
//
// Privacy: the explorer or wallet API (MetaMask, Rabby/DeBank) sees the address, as every
// balance check does. DefiLlama and DexScreener see only token contracts, never the address.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeedTokens = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // network key (app.js EVM list) -> token-list sources, best first:
  // rs = Routescan chain id, bs = Blockscout v2 host, es = Etherscan-style Blockscout host,
  // ep = Ethplorer-style host, zk = zkSync-style explorer API, ox = Oasis Nexus paratime,
  // fx = Fantom GraphQL API. MM and RABBY below add mm / rb fallbacks.
  const SRC = {
    eth: [['rs', '1'], ['bs', 'https://eth.blockscout.com'], ['ep', 'https://api.ethplorer.io']],
    base: [],   // Blockscout's token list takes 6-8 s for an ordinary wallet here, so MetaMask (below) goes first
    arb: [['bs', 'https://arbitrum.blockscout.com']],
    op: [['bs', 'https://explorer.optimism.io']],
    polygon: [['bs', 'https://polygon.blockscout.com']],
    bsc: [['ep', 'https://api.binplorer.com']],
    avax: [['rs', '43114']],
    linea: [['bs', 'https://api-explorer.linea.build']],
    scroll: [['bs', 'https://scrollscan.com']],
    gnosis: [['bs', 'https://gnosisscan.io'], ['bs', 'https://blockscout.com/poa/xdai']],
    blast: [['rs', '81457']],
    zksync: [['zk', 'https://block-explorer-api.mainnet.zksync.io'], ['bs', 'https://zksync.blockscout.com']],
    mantle: [['rs', '5000']],
    celo: [['bs', 'https://celo.blockscout.com']],
    uni: [['bs', 'https://unichain.blockscout.com']],
    world: [['bs', 'https://worldchain-mainnet.explorer.alchemy.com']],
    etc: [['bs', 'https://etc.blockscout.com']],
    pls: [['bs', 'https://api.scan.pulsechain.com']],
    nova: [['bs', 'https://arbitrum-nova.blockscout.com']],
    one: [['bs', 'https://explorer.harmony.one']],
    aurora: [['bs', 'https://explorer.mainnet.aurora.dev'], ['bs', 'https://explorer.aurora.dev']],
    metis: [['rs', '1088']],
    boba: [['rs', '288']],
    astr: [['bs', 'https://astar.blockscout.com']],
    tlos: [['bs', 'https://teloscan.io']],
    sapphire: [['ox', 'https://nexus.oasis.io/v1/sapphire']],
    emerald: [['ox', 'https://nexus.oasis.io/v1/emerald']],
    manta: [['bs', 'https://pacific-explorer.manta.network']],
    mode: [['bs', 'https://explorer.mode.network']],
    ron: [['bs', 'https://explorer.roninchain.com']],
    flr: [['bs', 'https://flare-explorer.flare.network']],
    sgb: [['bs', 'https://songbird-explorer.flare.network']],
    rbtc: [['bs', 'https://rootstock.blockscout.com']],
    merlin: [['bs', 'https://scan.merlinchain.io']],
    abs: [['zk', 'https://block-explorer-api.mainnet.abs.xyz']],
    ink: [['bs', 'https://explorer.inkonchain.com']],
    soneium: [['bs', 'https://soneium.blockscout.com']],
    lisk: [['bs', 'https://blockscout.lisk.com']],
    ape: [['bs', 'https://apechain.calderaexplorer.xyz'], ['bs', 'https://apechain.blockscout.com']],
    story: [['bs', 'https://www.datanetscan.io']],
    chz: [['rs', '88888']],
    gravity: [['bs', 'https://api.explorer.gravity.xyz']],
    morph: [['bs', 'https://explorer-api.morph.network']],
    lens: [['bs', 'https://explorer.lens.xyz']],
    plume: [['bs', 'https://explorer.plume.org']],
    hemi: [['rs', '43111'], ['es', 'https://explorer.hemi.xyz']],
    etherlink: [['bs', 'https://explorer.etherlink.com']],
    shape: [['bs', 'https://shapescan.xyz']],
    fuse: [['bs', 'https://explorer.fuse.io']],
    fil: [['bs', 'https://filecoin.blockscout.com']],
    sys: [['bs', 'https://explorer.syscoin.org']],
    kcc: [['bs', 'https://scan.kcc.io']],
    plasma: [['rs', '9745']],
    cyber: [['bs', 'https://cyberscan.co']],
    vana: [['bs', 'https://vanascan.io']],
    imx: [['bs', 'https://explorer.immutable.com']],
    vlx: [['es', 'https://evmexplorer.velas.com']],
    nrg: [['es', 'https://explorer.energi.network']],
    ftm: [['fx', 'https://xapi.fantom.network']],
    megaeth: [['bs', 'https://megaeth.blockscout.com']],
    kite: [['bs', 'https://kitescan.ai']],
    dbk: [['es', 'https://scan.dbkchain.io']],
  };
  // MetaMask's Accounts API (chain id): no key, no rate limit seen, unpriced. Its DeFi API
  // uses the same chain ids and covers the networks in DEFI.
  const MM = { eth: 1, op: 10, bsc: 56, polygon: 137, hyperevm: 999, monad: 143, seievm: 1329, avax: 43114, linea: 59144, base: 8453, arb: 42161, hood: 4663 };
  // Rabby's wallet API (its chain id; DeBank's index): priced and spam-flagged, but it blocks
  // a visitor for about 15 minutes after a handful of calls, so it comes last, is asked only
  // about networks where its one-call balance summary shows value, and not again once it refuses.
  const RABBY = {
    eth: 'eth', base: 'base', arb: 'arb', op: 'op', polygon: 'matic', bsc: 'bsc', avax: 'avax', linea: 'linea', scroll: 'scrl',
    gnosis: 'xdai', zksync: 'era', mantle: 'mnt', sonic: 'sonic', celo: 'celo', cro: 'cro', opbnb: 'opbnb', bera: 'bera',
    uni: 'uni', world: 'world', hyperevm: 'hyper', kavaevm: 'kava', kaia: 'klay', metis: 'metis', core: 'core', cfx: 'cfx',
    manta: 'manta', mode: 'mode', taiko: 'taiko', zora: 'zora', fraxtal: 'frax', ron: 'ron', flr: 'flr', rbtc: 'rsk',
    merlin: 'merlin', bitlayer: 'btr', bob: 'bob', abs: 'abs', ink: 'ink', soneium: 'soneium', lisk: 'lisk', seievm: 'sei',
    ape: 'ape', story: 'story', chz: 'chiliz', zircuit: 'zircuit', morph: 'morph', lens: 'lens', plume: 'plume', hemi: 'hemi',
    monad: 'monad', katana: 'katana', etherlink: 'ethlink', xlayer: 'xlayer', fuse: 'fuse', sophon: 'sophon', plasma: 'plasma',
    cyber: 'cyber', imx: 'itze', megaeth: 'megaeth', hood: 'hood', xdc: 'xdc', og: 'g0', citrea: 'citrea',
    b2: 'b2', wemix: 'wemix', kite: 'kite', dbk: 'dbk',
  };
  const DEFI = ['eth', 'op', 'bsc', 'polygon', 'base', 'arb', 'avax', 'linea'];
  // Morpho's API networks (chain id -> network key); its other networks are not on this page
  const MORPHO = { 1: 'eth', 8453: 'base', 747474: 'katana', 999: 'hyperevm', 42161: 'arb', 137: 'polygon', 130: 'uni', 10: 'op', 480: 'world', 143: 'monad', 4663: 'hood' };
  const MORPHO_API = 'https://blue-api.morpho.org/graphql';
  // Aave v3 pools, each checked live (it lists reserves; its first aToken's POOL() points back)
  const AAVE = { eth: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2', base: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', bsc: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB', linea: '0xc47b8C00b0f69a36fa203Ffeac0334874574a8Ac',
    arb: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', op: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', avax: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    ftm: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', one: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', scroll: '0x11fCfe756c05AD438e312a7fd934381537D3cFfe', gnosis: '0xb50201558B00496A145fE76f7424749556E326D8',
    metis: '0x90df02551bB792286e8D4f13E0e357b4Bf1D6a57', zksync: '0x78e30497a3c7527d953c6B1E3541b021A98Ac43c', celo: '0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402', sonic: '0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3',
    mantle: '0x458F293454fE0d67EC0655f3672301301DD51422', soneium: '0xDd3d7A7d03D9fD9ef45f3E587287922eF65CA38B', plasma: '0x925a2A7214Ed92428B5b1B090F80b25700095e12', ink: '0x2816cf15F6d2A220E789aA011D5EE4eB6c47FEbA' };
  // Uniswap-v3-style position managers (each checked on-chain): [name, address, slipstream].
  // Slipstream (Aerodrome, Velodrome) keys pools by tick spacing instead of fee.
  const UNI = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88', CAKE = '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364';
  const LP_NFT = {
    eth: [['Uniswap V3', UNI], ['PancakeSwap V3', CAKE], ['SushiSwap V3', '0x2214A42d8e2A1d20635c2cb0664422c528B6A432']],
    arb: [['Uniswap V3', UNI], ['PancakeSwap V3', CAKE], ['SushiSwap V3', '0xF0cBce1942A68BEB3d1b73F0dd86C8DCc363eF49']],
    op: [['Uniswap V3', UNI], ['Velodrome', '0x416b433906b1B72FA758e166e239c43d68dC6F29', 1], ['Velodrome', '0xbB5DFE1380333CEE4c2EeBd7202c80dE2256AdF4', 1]],
    polygon: [['Uniswap V3', UNI], ['SushiSwap V3', '0xb7402ee99F0A008e461098AC3A27F4957Df89a40']],
    base: [['Uniswap V3', '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1'], ['PancakeSwap V3', CAKE], ['SushiSwap V3', '0x80C7DD17B01855a6D2347444a0FCC36136a314de'],
      ['Aerodrome', '0x827922686190790b37229fd06084350E74485b72', 1], ['Aerodrome', '0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F', 1]],
    bsc: [['PancakeSwap V3', CAKE], ['Uniswap V3', '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613']],
    avax: [['Uniswap V3', '0x655C406EBFa14EE2006250925e54ec43AD184f8B']],
    blast: [['Uniswap V3', '0xB218e4f7cF0533d4696fDfC419A0023D33345F28']],
    uni: [['Uniswap V3', '0x943e6e07a7E8E791dAFC44083e54041D743C46E9']],
    zksync: [['Uniswap V3', '0x0616e5762c1E7Dc3723c50663dF10a162D690a86'], ['PancakeSwap V3', '0xa815e2eD7f7d5B0c49fda367F249232a1B9D2883']],
    world: [['Uniswap V3', '0xec12a9F9a09f50550686363766Cc153D03c27b5e']],
    celo: [['Uniswap V3', '0x3d79EdAaBC0EaB6F08ED885C05Fc0B014290D95A']],
    linea: [['PancakeSwap V3', CAKE], ['Uniswap V3', '0x4615C383F85D0a2BbED973d83ccecf5CB7121463']],
    opbnb: [['PancakeSwap V3', CAKE]],
    scroll: [['Uniswap V3', '0xB39002E4033b162fAc607fc3471E205FA2aE5967']],
    ink: [['Uniswap V3', '0xC0836E5B058BBE22ae2266e1AC488A1A0fD8DCE8']],
    mode: [['Velodrome', '0x991d5546C4B442B4c5fdc4c8B8b8d131DEB24702', 1]],
  };
  for (const [k, id] of Object.entries(MM)) (SRC[k] = SRC[k] || []).push(['mm', String(id)]);
  SRC.base.push(['bs', 'https://base.blockscout.com']);
  for (const [k, id] of Object.entries(RABBY)) (SRC[k] = SRC[k] || []).push(['rb', id]);
  // DefiLlama chain names, for tokens a source lists without a price
  const LLAMA = {
    eth: 'ethereum', base: 'base', arb: 'arbitrum', op: 'optimism', polygon: 'polygon', bsc: 'bsc',
    avax: 'avax', linea: 'linea', scroll: 'scroll', gnosis: 'xdai', blast: 'blast', zksync: 'era',
    mantle: 'mantle', sonic: 'sonic', ftm: 'fantom', celo: 'celo', cro: 'cronos', opbnb: 'op_bnb',
    bera: 'berachain', uni: 'unichain', zkevm: 'polygon_zkevm', world: 'wc', hyperevm: 'hyperliquid',
    etc: 'ethereumclassic', pls: 'pulse', nova: 'arbitrum_nova', one: 'harmony', aurora: 'aurora',
    kavaevm: 'kava', kaia: 'klaytn', metis: 'metis', movr: 'moonriver', glmr: 'moonbeam', astr: 'astar',
    tlos: 'telos', iotx: 'iotex', core: 'core', cfx: 'conflux', manta: 'manta', mode: 'mode', taiko: 'taiko',
    zora: 'zora', fraxtal: 'fraxtal', ron: 'ronin', flr: 'flare', rbtc: 'rsk', merlin: 'merlin', bob: 'bob',
    abs: 'abstract', ink: 'ink', soneium: 'soneium', seievm: 'sei', ape: 'apechain', story: 'sty',
    zircuit: 'zircuit', morph: 'morph', plume: 'plume_mainnet', hemi: 'hemi', monad: 'monad', katana: 'katana',
    etherlink: 'etlk', xlayer: 'xlayer', fuse: 'fuse', kcc: 'kcc', plasma: 'plasma', imx: 'imx',
    vic: 'tomochain', nrg: 'energi', bitlayer: 'bitlayer', sophon: 'sophon', wan: 'wanchain', ethw: 'ethereumpow',
    okt: 'okexchain', theta: 'theta', megaeth: 'megaeth', hood: 'robinhood', xdc: 'xdc', og: '0g',
    citrea: 'citrea', b2: 'bsquared', wemix: 'wemix', kite: 'kite', dbk: 'dbk',
  };
  // The biggest tokens per network, read directly when no token-list source answers.
  // Each address was checked on-chain (symbol(), decimals()) and against DefiLlama.
  const TOP = {
    eth: [['USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6], ['USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6], ['stETH', '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', 18], ['wstETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', 18], ['USDS', '0xdC035D45d973E3EC169d2276DDab16f1e407384F', 18], ['WBTC', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 8], ['LINK', '0x514910771AF9Ca656af840dff83E8264EcF986CA', 18], ['cbBTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', 8], ['WETH', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18], ['weETH', '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee', 18], ['USDe', '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3', 18], ['DAI', '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18], ['UNI', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 18], ['PYUSD', '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8', 6], ['SHIB', '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', 18], ['ENA', '0x57e114B691Db790C35207b2e685D4A43181e6061', 18], ['AAVE', '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', 18], ['ONDO', '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3', 18], ['PEPE', '0x6982508145454Ce325dDbE47a25d4ec3d2311933', 18], ['MNT', '0x3c3a81e81dc49A522A592e7622A7E711c06bf354', 18], ['SKY', '0x56072C95FAA701256059aa122697B133aDEd9279', 18]],
    base: [['USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6], ['USDS', '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc', 18], ['WBTC', '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', 8], ['LINK', '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196', 18], ['cbBTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', 8], ['weETH', '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A', 18], ['USDe', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', 18], ['ENA', '0x58538e6A46E07434d7E7375Bc268D3cb839C0133', 18], ['AAVE', '0x63706e401c06ac8513145b7687A14804d17f814b', 18], ['MORPHO', '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842', 18], ['WETH', '0x4200000000000000000000000000000000000006', 18], ['ZRO', '0x6985884C4392D348587B19cb9eAAf157F13271cd', 18], ['AERO', '0x940181a94A35A4569E4529A3CDfB74e38FD98631', 18], ['EURC', '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', 6], ['cbETH', '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', 18], ['VIRTUAL', '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', 18], ['DAI', '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 18], ['wstETH', '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', 18], ['DEGEN', '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', 18], ['BRETT', '0x532f27101965dd16442E59d40670FaF5eBB142E4', 18], ['TOSHI', '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4', 18], ['USDbC', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', 6], ['USDT', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 6]],
    arb: [['USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6], ['LINK', '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', 18], ['cbBTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', 8], ['USDe', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', 18], ['UNI', '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0', 18], ['USDT0', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6], ['AAVE', '0xba5DdD1f9d7F570dc94a51479a000E3BCE967196', 18], ['ARB', '0x912CE59144191C1204E64559FE8253a0e49E6548', 18], ['rETH', '0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8', 18], ['GHO', '0x7dfF72693f6A4149b17e7C6314655f6A9F7c8B33', 18], ['ZRO', '0x6985884C4392D348587B19cb9eAAf157F13271cd', 18], ['WBTC', '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', 8], ['CRV', '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978', 18], ['PENDLE', '0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8', 18], ['LDO', '0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60', 18], ['WETH', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 18], ['DAI', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 18], ['GMX', '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', 18], ['USDC', '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', 6]],
    op: [['USDC', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6], ['WBTC', '0x68f180fcCe6836688e9084f035309E29Bf0A2095', 8], ['LINK', '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6', 18], ['USDe', '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', 18], ['UNI', '0x6fd9d7AD17242c41f7131d257212c54A0e816691', 18], ['USDT0', '0x01bFF41798a0BcF287b996046Ca68b395DbC1071', 6], ['AAVE', '0x76FB31fb4af56892A25e32cFC43De717950c9278', 18], ['WLD', '0xdC6fF44d5d932Cbd77B52E5612Ba0529DC6226F1', 18], ['rETH', '0x9Bcef72be871e61ED4fBbc7630889beE758eb81D', 18], ['CRV', '0x0994206dfE8De6Ec6920FF4D779B0d950605Fb53', 18], ['EURC', '0xDCB612005417Dc906fF72c87DF732e5a90D49e11', 6], ['LDO', '0xFdb794692724153d1488CcdBE0C56c252596735F', 18], ['OP', '0x4200000000000000000000000000000000000042', 18], ['SNX', '0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4', 18], ['wstETH', '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb', 18], ['WETH', '0x4200000000000000000000000000000000000006', 18], ['DAI', '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 18], ['VELO', '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db', 18], ['USDC', '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', 6]],
    polygon: [['USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6], ['LINK', '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', 18], ['UNI', '0xb33EaAd8d922B1083446DC23f610c2567fB5180f', 18], ['USDT0', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6], ['AAVE', '0xD6DF932A45C0f255f85145f286eA0b292B21C90B', 18], ['USDC', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 6], ['CRV', '0x172370d5Cd63279eFa6d502DAB29171933a610AF', 18], ['DAI', '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', 18], ['LDO', '0xC3C7d422809852031b44ab29EEC9F1EfF2A58756', 18], ['GRT', '0x5fe2B58c013d7601147DcdD68C143A77499f5531', 18], ['WETH', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 18], ['WBTC', '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', 8], ['MANA', '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4', 18], ['SAND', '0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683', 18], ['APE', '0xB7b31a6BC18e48888545CE79e83E06003bE70930', 18], ['WPOL', '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 18]],
    bsc: [['USDT', '0x55d398326f99059fF775485246999027B3197955', 18], ['USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18], ['WBNB', '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 18], ['ETH', '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', 18], ['BTCB', '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', 18], ['Cake', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', 18], ['DAI', '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', 18], ['FDUSD', '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409', 18], ['XRP', '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', 18], ['DOGE', '0xbA2aE424d960c26247Dd6c32edC70B295c744C43', 8], ['ADA', '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', 18], ['LINK', '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD', 18], ['DOT', '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402', 18], ['TWT', '0x4B0F1812e5Df2A09796481Ff14017e6005508003', 18], ['BUSD', '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', 18], ['USD1', '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d', 18], ['UNI', '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1', 18], ['SOL', '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF', 18], ['TRX', '0xCE7de646e7208a4Ef112cb6ed5038FA6cC6b12e3', 6], ['AVAX', '0x1CE0c2827e2eF14D5C4f29a091d735A204794041', 18]],
    avax: [['WAVAX', '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', 18], ['USDC', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 6], ['USDt', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 6], ['WETH.e', '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', 18], ['BTC.b', '0x152b9d0FdC40C096757F570A51E494bd4b943E50', 8], ['DAI.e', '0xd586E7F844cEa2F87f50152665BCbc2C279D8d70', 18], ['USDC.e', '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664', 6], ['USDT.e', '0xc7198437980c041c805A1EDcbA50c1Ce5db95118', 6], ['LINK.e', '0x5947BB275c521040051D82396192181b413227A3', 18], ['JOE', '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd', 18], ['sAVAX', '0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE', 18], ['AAVE.e', '0x63a72806098Bd3D9520cC43356dD78afe5D386D9', 18], ['QI', '0x8729438EB15e2C8B576fCc6AeCdA6A148776C0F5', 18], ['GMX', '0x62edc0692BD897D2295872a9FFCac5425011c661', 18], ['EURC', '0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD', 6], ['COQ', '0x420FcA0121DC28039145009570975747295f2329', 18], ['PNG', '0x60781C2586D68229fde47564546784ab3fACA982', 18]],
    // smaller networks (Fantom: when its API is down; the rest have no token-list API): their few tokens DefiLlama prices
    ftm: [['WFTM', '0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83', 18], ['axlUSDC', '0x1b6382dbdea11d97f24495c9a90b7c88469134a4', 6], ['BOO', '0x841fad6eae12c286d1fd18d1d525dffa75c7effe', 18]],
    iotx: [['WIOTX', '0xa00744882684c3e4747faefd68d283ea44099d03', 18], ['USDT-matic', '0x3cdb7c48e70b854ed2fa392e21687501d84b3afc', 6], ['WMATIC', '0x8e66c0d6b70c0b23d39f4b21a1eac52bba8ed89a', 18]],
    vic: [['C98', '0x0fd0288aaae91eaf935e2ec14b23486f86516c8c', 18], ['WETH', '0x2eaa73bd0db20c64f53febea7b5f5e5bccc7fb8b', 18]],
    glmr: [['xcDOT', '0xFfFFfFff1FcaCBd218EDc0EbA20Fc2308C778080', 10], ['WELL', '0x511aB53F793683763E5a8829738301368a2411E3', 18], ['LINK', '0x012414a392f9fa442a3109f1320c439c45518ac3', 18], ['FRAX', '0x322e86852e492a7ee17f28a78c663da38fb33bfb', 18], ['frxETH', '0x82bbd1b6f6de2b7bb63d3e1546e6b1553508be99', 18], ['AXL', '0x467719ad09025fcc6cf6f8311755809d45a5e5f3', 6], ['BRLA', '0xfeb25f3fddad13f82c4d6dbc1481516f62236429', 18]],
    movr: [['WMOVR', '0x98878B06940aE243284CA214f92Bb71a2b032B8A', 18], ['USDC', '0xE3F5a90F9cb311505cd691a46596599aA1A0AD7D', 6], ['LINK', '0x8b12ac23bfe11cab03a634c1f117d64a7f2cfd3e', 18], ['FRAX', '0x1a93b23281cc1cde4c4741353f3064709a16197d', 18], ['FXS', '0x6f1d1ee50846fcbc3de91723e61cb68cfa6d0e98', 18]],
    zkevm: [['USDC', '0x37eAA0eF3549a5Bb7D431be78a3D99BD360d19e5', 6], ['USDT', '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', 6], ['POL', '0x22B21BedDef74FE62F031D2c5c8F7a9F8a4b304D', 18]],
    // networks whose only token list is Rabby's (or an explorer with no backup): their biggest tokens
    // by market cap (CoinGecko), each checked on-chain and priced by DefiLlama, read when the list fails
    og: [['WETH', '0x564770837ef8bbf077cfe54e5f6106538c815b22', 18]],
    xlayer: [['USDC', '0xb6ceceab302e2e4948951ee7843fc24e92933061', 6], ['LINK', '0x8af9711b44695a5a081f25ab9903ddb73acf8fa9', 18], ['USDe', '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', 18], ['USDT0', '0x779ded0c9e1022225f8e0630b35a9b54be713736', 6], ['USDG', '0x4ae46a509f6b1d9056937ba4500cb143933d2dc8', 6], ['sUSDe', '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', 18], ['frxUSD', '0x80eede496655fb9047dd39d9f418d5483ed600df', 18], ['xBTC', '0xb7c00000bcdeef966b20b3d884b98e64d2b06b4f', 8]],
    nrg: [['LINK', '0x68ca48ca2626c415a89756471d4ade2cc9034008', 18], ['UNI', '0x665b3a802979ec24e076c80025bff33c18eb6007', 18], ['QNT', '0x462b35452e552a66b519ecf70aedb1835d434965', 18], ['AAVE', '0xa7f2f790355e0c32cab03f92f6eb7f488e6f049a', 18], ['eTRX', '0xdc5f62055a2911f85cf16df9f7662403387c8d46', 18], ['NEXO', '0x04640dc771edd73cbeb934fb5461674830baea11', 18], ['CRV', '0xd3319eaf3c4743ac75aace77befcfa445ed6e69e', 18], ['BTT', '0xf1bdcf2d4163adf9554111439dabdd6f18ff9ba7', 18]],
    cfx: [['USDT0', '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff', 6], ['XAUt0', '0xacc6efbe554397b741baadecf0120780b858f5f4', 6]],
    kavaevm: [['USDT', '0x919c1c267bc06a7039e03fcc2ef738525769109c', 6], ['USDe', '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', 18], ['ENA', '0x58538e6a46e07434d7e7375bc268d3cb839c0133', 18], ['sUSDe', '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', 18], ['ATOM', '0x15932e26f5bd4923d46a2b205191c4b5d5f43fe3', 6]],
    core: [['LINK', '0x3902228d6a3d2dc44731fd9d45fee6a61c722d0b', 18], ['AUSD', '0x00000000efe302beaa2b3e6e1b18d08d69a9012a', 6], ['WCORE', '0x191e94fa59739e188dce837f7f6978d84727ad01', 18]],
    fraxtal: [['LINK', '0xd6a6ba37faac229b9665e86739ca501401f5a940', 18], ['USDe', '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', 18], ['ENA', '0x58538e6a46e07434d7e7375bc268d3cb839c0133', 18], ['sUSDe', '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', 18], ['crvUSD', '0xb102f7efa0d5de071a8d37b3548e1c7cb148caf3', 18], ['AUSD', '0x00000000efe302beaa2b3e6e1b18d08d69a9012a', 6], ['ezETH', '0x2416092f143378750bb29b79ed961ab195cceea5', 18], ['FRAX', '0xfc00000000000000000000000000000000000001', 18]],
    katana: [['LINK', '0xc2c447b04e0ed3476ddbdae8e9e39be7159d27b6', 18], ['MORPHO', '0x1e5efca3d0db2c6d5c67a4491845c43253eb9e4e', 18], ['JitoSOL', '0x6c16e26013f2431e8b2e1ba7067ecccad0db6c52', 18], ['LBTC', '0xecac9c5f704e954931349da37f60e39f515c11c1', 8], ['AUSD', '0x00000000efe302beaa2b3e6e1b18d08d69a9012a', 6], ['frxUSD', '0x80eede496655fb9047dd39d9f418d5483ed600df', 18], ['SUSHI', '0x17bff452dae47e07cea877ff0e1aba17eb62b0ab', 18], ['sfrxUSD', '0x5bff88ca1442c2496f7e475e9e7786383bc070c0', 18]],
    kaia: [['USD₮', '0xd077a400968890eacc75cdc901f0356c943e4fdb', 6], ['LINK', '0x7311ded199cc28d80e58e81e8589aa160199fcd2', 18], ['JPYC', '0xe7c3d8c9a439fede00d2600032d5db0be71c3c29', 18], ['BORA', '0x02cbe46fb8a1f579254a9b485788f2d86cad51aa', 18], ['PYBOBO', '0x2b94e669139b1b546a0c28c3b78fd7a35d5a5f94', 18], ['USDC.e', '0xe2053bcf56d2030d2470fb454574237cf9ee3d4b', 6], ['WETH', '0x09d428a066e77806f9de48fe3a57e837ccd0912f', 18], ['MBX', '0xd068c52d81f4409b9502da926ace3301cc41f623', 18]],
    xdc: [['USDC', '0xfa2958cb79b0491cc627c1557f441ef849ca8eb1', 6], ['LINK', '0xe27dd9bf01b55ce6803c0d81386a04212c718b95', 18], ['USDf', '0x8210c0634ab8f273806e4b7866e9db353773c44b', 18], ['GAMA', '0x3a170c7c987f55c84f28733bfa27962d8cdd5d3b', 18], ['USDC.e', '0xcc0587aebda397146cc828b445db130a94486e74', 6], ['WETH', '0xa7348290de5cf01772479c48d50dec791c3fc212', 18]],
    bitlayer: [['LINK', '0x56b275c0ec034a229a1ded8db17089544bc276d9', 18], ['BTR', '0x0e4cf4affdb72b39ea91fa726d291781cbd020bf', 18]],
    b2: [['LINK', '0x709229d9587886a1edfee6b5ce636e1d70d1ce39', 18]],
    bob: [['WBTC', '0x0555e30da8f98308edb960aa94c0db47230d2b9c', 8], ['LINK', '0x5ab885cda7216b163fb6f813dec1e1532516c833', 18], ['TBTC', '0xbba2ef945d523c4e2608c9e1214c2cc64d4fc2e2', 18], ['EUL', '0xde1763afa5eb658cffffd16835afeb47e7ac0b8d', 18], ['BOB', '0xb0bd54846a92b214c04a63b26ad7dc5e19a60808', 18]],
    okt: [['OKB', '0xdf54b6c6195ea4d948d03bfd818d365cf175cfc2', 18], ['RACA', '0x12bb890508c125661e03b09ec06e404bc9289040', 18]],
    taiko: [['LINK', '0x917a3964c37993e99a47c779beb5db1e9d13804d', 18], ['crvUSD', '0xc8f4518ed4bab9a972808a493107926ce8237068', 18], ['TAIKO', '0xa9d23408b9ba935c230493c40c73824df71a0975', 18], ['USDC.e', '0x19e26b0638bf63aa9fa4d14c6baf8d52ebe86c5c', 6]],
    wemix: [['LINK', '0x80f1fcdc96b55e459bf52b998abbe2c364935d69', 18]],
    zircuit: [['USDe', '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34', 18], ['ENA', '0x813635891aa06bd55036bbd8f7d1a34ab3de9a0f', 18], ['sUSDe', '0x211cc4dd073734da055fbf44a2b4667d5e5fe5d2', 18]],
    zora: [['LINK', '0x3662b6f73c5560229d1a98af6e59e6649d568374', 18]],
    citrea: [['CTR', '0x547afd93b9c47d552059feb556909e017f8a9b25', 18]],
  };
  // stablecoins of the non-EVM networks, trusted as they are (each checked on DefiLlama); on NEAR
  // also wrapped NEAR and the two big liquid-staking tokens, whose DEX pools are thin next to them
  const STABLE = {
    cardano: ['c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d', '8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61446a65644d6963726f555344',
      'f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b6988069555344', 'fe7c786ab321f41c654ef6c1af7b3250a613c24e4213e0425a7ae45655534441'],   // USDM, DJED, iUSD, USDA
    near: ['usdt.tether-token.near', '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', 'wrap.near', 'meta-pool.near', 'linear-protocol.near'],
    tron: ['TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn', 'TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4'],
    sui: ['0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
      '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN'],
    aptos: ['0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b', '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b',
      '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDC', '0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDT'],
  };
  const T22 = 1;   // Token-2022 program (the rest are classic SPL tokens)
  const SOL_TOP = [['SOL', 'So11111111111111111111111111111111111111112', 9], ['USDC', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6], ['USDT', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6], ['PUMP', 'pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn', 6, T22], ['JitoSOL', 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', 9], ['JUP', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 6], ['JLP', '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4', 6], ['RENDER', 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof', 8], ['PYUSD', '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', 6, T22], ['PENGU', '2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv', 6], ['PYTH', 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', 6], ['RAY', '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', 6], ['TRUMP', '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN', 6], ['Bonk', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 5], ['cbBTC', 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', 8], ['mSOL', 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', 9], ['JTO', 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', 9], ['INF', '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm', 9], ['$WIF', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 6], ['Fartcoin', '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', 6], ['ETH', '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', 8], ['ORCA', 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', 6], ['bSOL', 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', 9], ['W', '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ', 6], ['HNT', 'hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux', 8], ['POPCAT', '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', 9], ['USDS', 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA', 6]];

  const MIN_USD = 1;      // a token worth less than this is not "coins"
  const VERIFY = 20;      // tokens checked against DEX liquidity, most valuable first
  const MIN_LIQ = 20000;  // USD in pools below which an unlisted token is airdrop bait, not money
  const PAGES = 4;        // token-list pages read per address (a spammed wallet can list thousands)
  const PRICED = 400;     // unpriced tokens sent to DefiLlama, 80 per request
  const DEX_MAX = 90;     // tokens per network DefiLlama could not price that are looked up on DexScreener, 30 per request
  const DEX_CALLS = 90;   // DexScreener price lookups per minute: it allows 300, and its liquidity checks need the rest
  // DexScreener's chain ids, each confirmed with tokens known on that network
  const DS = { eth: 'ethereum', base: 'base', arb: 'arbitrum', op: 'optimism', polygon: 'polygon', bsc: 'bsc', avax: 'avalanche', linea: 'linea', scroll: 'scroll',
    blast: 'blast', zksync: 'zksync', mantle: 'mantle', sonic: 'sonic', ftm: 'fantom', celo: 'celo', cro: 'cronos', opbnb: 'opbnb', bera: 'berachain', uni: 'unichain',
    world: 'worldchain', hyperevm: 'hyperevm', kavaevm: 'kava', metis: 'metis', tlos: 'telos', cfx: 'conflux', abs: 'abstract', ink: 'ink', soneium: 'soneium',
    seievm: 'seiv2', monad: 'monad', fuse: 'fuse', plasma: 'plasma', pls: 'pulsechain', ape: 'apechain', megaeth: 'megaeth', hood: 'robinhood' };
  const LP_MAX = 20;      // liquidity NFTs read per position manager, newest first

  const MM_API = 'https://accounts.api.cx.metamask.io/v4/multiaccount/balances';
  const RABBY_API = 'https://api.rabby.io/v1/user/';
  const DEFI_API = 'https://defiadapters.api.cx.metamask.io/positions/';
  const NATIVE = ['0x0000000000000000000000000000000000000000', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'];   // how APIs write a network's own coin

  function make(D) {      // D: { fetchJSON, rpc, firstOk, units, solRpcs, ata }
    const lc = (s) => String(s || '').toLowerCase();
    const sym = (s) => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 16) || '?';   // token names are attacker-chosen
    const num = (x) => (x == null || x === '' || x === false ? null : Number(x));
    const empty404 = (p) => p.catch((e) => { if (e && e.status === 404) return null; throw e; });
    const isAddr = (x) => /^0x[0-9a-fA-F]{40}$/.test(x) && !/^0x0{40}$/.test(x);
    // one request at a time, gapMs apart, for APIs that answer a burst with 429s
    const serial = (gapMs) => {
      let tail = Promise.resolve();
      return (fn) => { const p = tail.then(fn); tail = p.then(() => new Promise((r) => setTimeout(r, gapMs)), () => {}); return p; };
    };
    // Rabby: one at a time, and once it refuses (rate limit) the rest of the scan stops asking
    const rabbyQueue = serial(300);
    let rabbyDown = null;
    const rabby = (path) => rabbyQueue(() => {
      if (rabbyDown) throw rabbyDown;
      return D.fetchJSON(RABBY_API + path, { retry: false }).catch((e) => { rabbyDown = e; throw e; });   // its 429 lasts ~15 minutes
    });
    // Rabby networks where an address holds anything: one call instead of one per network
    // (null when Rabby does not answer: then each network is asked directly)
    const rabbySeen = new Map();
    const rabbyChains = (a) => {
      if (!rabbySeen.has(a)) rabbySeen.set(a, rabby('total_balance?id=' + a)
        .then((j) => (Array.isArray(j.chain_list) ? new Set(j.chain_list.filter((c) => c.usd_value > 0).map((c) => c.id)) : null), () => null));
      return rabbySeen.get(a);
    };

    // ---- one lister per source kind -> [{ addr, symbol, dec, raw or amount, price }] ----
    const listers = {
      rs: async (id, a) => {
        const out = [];
        let next = '/v2/network/mainnet/evm/' + id + '/address/' + a + '/erc20-holdings?limit=100';
        for (let page = 0; next && page < PAGES; page++) {
          const j = await D.fetchJSON('https://api.routescan.io' + next);
          if (!Array.isArray(j.items)) throw new Error('unexpected answer');
          for (const x of j.items) out.push({ addr: x.tokenAddress, symbol: x.tokenSymbol, dec: +x.tokenDecimals, raw: x.tokenQuantity, price: num(x.tokenPrice) });
          next = j.link && j.link.next;
        }
        out.more = !!next;
        return out;
      },
      bs: async (host, a) => {
        const out = [];
        let query = '';
        for (let page = 0; query !== null && page < PAGES; page++) {
          const j = await empty404(D.fetchJSON(host + '/api/v2/addresses/' + a + '/tokens?type=ERC-20' + query));
          if (j === null) break;                       // an address the explorer never saw
          if (!Array.isArray(j.items)) throw new Error('unexpected answer');
          for (const x of j.items) out.push({ addr: x.token.address_hash || x.token.address, symbol: x.token.symbol, dec: +x.token.decimals, raw: x.value, price: num(x.token.exchange_rate) });
          query = j.next_page_params ? '&' + new URLSearchParams(j.next_page_params).toString() : null;
        }
        out.more = query !== null && out.length > 0;
        return out;
      },
      es: async (host, a) => {
        const j = await D.fetchJSON(host + '/api?module=account&action=tokenlist&address=' + a);
        if (!Array.isArray(j.result)) { if (/no tokens/i.test(j.message || '')) return []; throw new Error('unexpected answer'); }
        return j.result.filter((x) => !x.type || x.type === 'ERC-20').map((x) => ({ addr: x.contractAddress, symbol: x.symbol, dec: +x.decimals, raw: x.balance, price: null }));
      },
      ep: async (host, a) => {
        const j = await D.fetchJSON(host + '/getAddressInfo/' + a + '?apiKey=freekey', undefined, 25000);
        if (!j.address) throw new Error('unexpected answer');
        return (j.tokens || []).map((x) => ({ addr: x.tokenInfo.address, symbol: x.tokenInfo.symbol, dec: +x.tokenInfo.decimals, raw: x.rawBalance, price: x.tokenInfo.price ? num(x.tokenInfo.price.rate) : null }));
      },
      zk: async (host, a) => {
        const j = await D.fetchJSON(host + '/address/' + a);
        if (!j.balances) throw new Error('unexpected answer');
        return Object.entries(j.balances).filter(([t]) => !/^0x0+800a$/i.test(t)).map(([t, x]) => ({ addr: t, symbol: x.token ? x.token.symbol : '?', dec: x.token ? +x.token.decimals : 0, raw: x.balance, price: x.token ? num(x.token.usdPrice) : null }));
      },
      ox: async (base, a) => {
        const j = await empty404(D.fetchJSON(base + '/accounts/' + a));
        if (j === null) return [];
        if (!Array.isArray(j.evm_balances)) throw new Error('unexpected answer');
        return j.evm_balances.map((x) => ({ addr: x.token_contract_addr_eth, symbol: x.token_symbol, dec: +x.token_decimals, raw: x.balance, price: null }));
      },
      fx: async (url, a) => {
        const j = await D.fetchJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          query: 'query($a: Address!) { erc20Assets(owner: $a, count: 100) { address symbol decimals balanceOf(owner: $a) } }', variables: { a } }) });
        if (!j.data || !Array.isArray(j.data.erc20Assets)) throw new Error('unexpected answer');
        return j.data.erc20Assets.map((x) => ({ addr: x.address, symbol: x.symbol, dec: +x.decimals, raw: /^0x[0-9a-fA-F]+$/.test(x.balanceOf) ? BigInt(x.balanceOf).toString() : null, price: null }));
      },
      mm: async (id, a) => {
        const j = await D.fetchJSON(MM_API + '?networks=' + id + '&accountAddresses=eip155:' + id + ':' + a);
        if (!Array.isArray(j.balances) || (j.unprocessedNetworks || []).length) throw new Error('unexpected answer');
        return j.balances.filter((x) => x.type !== 'native' && isAddr(x.address)).map((x) => ({ addr: x.address, symbol: x.symbol, dec: +x.decimals, amount: Number(x.balance), price: null }));
      },
      rb: async (chain, a) => {
        const seen = await rabbyChains(a);
        if (seen && !seen.has(chain)) return [];
        const j = await rabby('token_list?id=' + a + '&chain_id=' + chain + '&is_all=false');
        if (!Array.isArray(j)) throw new Error('unexpected answer');
        // a token Rabby flags as a scam gets price 0, so it is reported but never counted
        return j.filter((x) => isAddr(x.id) && /^0x[0-9a-fA-F]+$/.test(x.raw_amount_hex_str)).map((x) => ({ addr: x.id, symbol: x.optimized_symbol || x.symbol, dec: +x.decimals,
          raw: BigInt(x.raw_amount_hex_str).toString(), price: x.is_suspicious ? 0 : x.price > 0 ? num(x.price) : null }));
      },
    };

    // DefiLlama prices by contract, for what a source listed unpriced (the first PRICED;
    // a request that fails just leaves its tokens unpriced)
    async function llamaPrices(slug, addrs) {
      const out = {};
      if (!slug) return out;
      const chunks = [];
      let failed = 0;
      for (let i = 0; i < addrs.length && i < PRICED; i += 80) chunks.push(addrs.slice(i, i + 80));
      await Promise.all(chunks.map(async (chunk) => {
        try {
          const j = await D.fetchJSON('https://coins.llama.fi/prices/current/' + chunk.map((x) => slug + ':' + x).join(','));
          for (const [k, v] of Object.entries(j.coins || {})) if (v && typeof v.price === 'number') out[lc(k.slice(k.indexOf(':') + 1))] = v;
        } catch (e) { failed++; }      // its tokens stay unpriced; callers say prices were not checked
      }));
      Object.defineProperty(out, 'failed', { value: failed });
      return out;
    }
    // Total DEX liquidity (USD) of the pools a token trades in, on either side (stablecoins and
    // wrapped coins are mostly the quote side); 0 when no pool trades it. Each pool counts at
    // twice what its other side holds, not at DexScreener's dollar figure: a pool it called
    // $469k held $15 of WBNB against a mountain of the token itself.
    async function liquidity(addr) {
      const j = await D.fetchJSON('https://api.dexscreener.com/latest/dex/tokens/' + addr);
      let usd = 0;
      for (const p of j.pairs || []) {
        const l = p.liquidity || {}, px = Number(p.priceUsd), pn = Number(p.priceNative);
        let other = 0;
        if (lc(p.baseToken && p.baseToken.address) === lc(addr)) other = px > 0 && pn > 0 ? Number(l.quote) * px / pn : 0;   // quote's price = base's USD price / base's price in quote
        else if (lc(p.quoteToken && p.quoteToken.address) === lc(addr)) other = Number(l.base) * px;
        else continue;
        if (other > 0) usd += Math.min(2 * other, Number(l.usd) || Infinity);
      }
      return usd;
    }

    // tokens [{ addr, symbol, amount, price }] -> { holdings, others: [addr], unverified }
    // Tokens no price API knows (a memecoin launched last week): their DexScreener pools,
    // counted only where the other side is a token DefiLlama itself prices with confidence, so
    // a pool of two junk tokens proves nothing. Price = the deepest such pool's rate times that
    // side's price; liquidity = twice what that side holds, over all such pools. DexScreener's
    // own dollar figures are not used. -> { addr: { price, liq } }
    // Tokens still on four.meme's bonding curve (BNB Chain launches before they reach a DEX):
    // the curve itself buys them back, so they count at what trySell says selling the whole
    // balance returns, after its fee, in BNB or the launch's quote token. -> { addr: usd }
    const FOUR_MEME = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034', WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
    async function curveValues(url, tokens) {
      const word = (h, i) => BigInt('0x' + ((h || '').slice(2 + 64 * i, 2 + 64 * (i + 1)) || '0'));
      const arg = (x) => x.toString(16).padStart(64, '0');
      // four.meme's tokens carry vanity addresses ending 4444 or ffff: those are asked first
      const list = tokens.slice().sort((a, b) => /(4444|ffff)$/i.test(b.addr) - /(4444|ffff)$/i.test(a.addr)).slice(0, 40);
      let failed = tokens.length > 40;
      const sold = await Promise.all(list.map(async (t) => {
        const info = await D.rpc(url, 'eth_call', [{ to: FOUR_MEME, data: '0x1f69565f' + arg(BigInt(t.addr)) }, 'latest']);
        if (word(info, 0) === 0n || word(info, 11) !== 0n) return null;   // not a four.meme token, or already on a DEX
        const raw = BigInt(Math.floor(t.amount * 1e6)) * 10n ** 12n;      // four.meme tokens have 18 decimals
        const r = await D.rpc(url, 'eth_call', [{ to: FOUR_MEME, data: '0xc6f43e8c' + arg(BigInt(t.addr)) + arg(raw) }, 'latest']);
        const funds = word(r, 2), fee = word(r, 3), quote = '0x' + word(r, 1).toString(16).padStart(40, '0');
        return funds > fee ? { t, net: funds - fee, quote: quote === '0x' + '0'.repeat(40) ? WBNB : quote } : null;
      }).map((p) => p.catch(() => { failed = true; return null; })));
      const hits = sold.filter(Boolean), out = {};
      if (failed) Object.defineProperty(out, 'cut', { value: true });
      if (!hits.length) return out;
      const px = await llamaPrices('bsc', [...new Set(hits.map((x) => x.quote))].concat(WBNB));
      for (const x of hits) {
        const q = px[lc(x.quote)];
        if (q && q.price > 0 && q.decimals >= 0) out[lc(x.t.addr)] = Number(x.net) / 10 ** q.decimals * q.price;
      }
      return out;
    }
    const dexCalls = [];   // when each recent lookup went out
    const dexBudget = () => { const now = Date.now(); while (dexCalls.length && now - dexCalls[0] > 60000) dexCalls.shift(); if (dexCalls.length >= DEX_CALLS) return false; dexCalls.push(now); return true; };
    async function dexPrices(key, addrs) {
      const out = {}, ds = DS[key];
      if (!ds || !addrs.length) return out;
      const want = new Set(addrs.map(lc)), chunks = [];
      if (addrs.length > DEX_MAX) out.cut = true;
      for (let i = 0; i < addrs.length && i < DEX_MAX; i += 30) { if (!dexBudget()) { out.cut = true; break; } chunks.push(addrs.slice(i, i + 30)); }
      const pairs = (await Promise.all(chunks.map((ch) => D.fetchJSON('https://api.dexscreener.com/tokens/v1/' + ds + '/' + ch.join(','), { retry: false }).catch(() => []))))
        .flat().filter((p) => p && p.chainId === ds && p.baseToken && p.quoteToken && want.has(lc(p.baseToken.address)) && p.liquidity && Number(p.liquidity.quote) > 0 && Number(p.priceNative) > 0);
      if (!pairs.length) return out;
      const qp = await llamaPrices(LLAMA[key], [...new Set(pairs.map((p) => lc(p.quoteToken.address)))]);
      for (const p of pairs) {
        const q = qp[lc(p.quoteToken.address)];
        if (!q || !(q.price > 0) || !(q.confidence >= 0.9) || want.has(lc(p.quoteToken.address))) continue;
        const a = lc(p.baseToken.address), liq = 2 * Number(p.liquidity.quote) * q.price;
        const o = out[a] = out[a] || { liq: 0, best: 0, price: null };
        o.liq += liq;
        if (liq > o.best) { o.best = liq; o.price = Number(p.priceNative) * q.price; }
      }
      return out;
    }
    async function judge(tokens, known) {
      const holdings = [], others = [];
      let unverified = 0;
      const valued = [];
      for (const t of tokens) {
        if (!(t.amount > 0)) continue;
        const usd = t.price != null ? t.amount * t.price : 0;
        if (usd >= MIN_USD) valued.push(Object.assign({ usd }, t)); else others.push(t.addr);
      }
      // the same token held twice (in the wallet and in a liquidity position) is sold into the
      // same pools once, so each token's entries are capped together
      const groups = new Map();
      for (const t of valued) {
        if (known.has(lc(t.addr)) || t.exact) continue;   // exact: what the token's own buyer pays (a launch curve)
        const g = groups.get(lc(t.addr)) || { usd: 0, liq: null, items: [] };
        g.usd += t.usd; g.items.push(t); if (t.liq != null) g.liq = t.liq;
        groups.set(lc(t.addr), g);
      }
      const order = [...groups.values()].sort((a, b) => b.usd - a.usd);
      await Promise.all(order.map(async (g, i) => {
        // selling usd worth into pools holding liq/2 of each side returns side * usd / (side + usd)
        const cap = (liq) => { const side = liq / 2, got = liq < MIN_LIQ ? 0 : side * g.usd / (side + g.usd); for (const t of g.items) t.usd *= got / g.usd; };
        if (g.liq != null) cap(g.liq);
        else if (i >= VERIFY) cap(0);
        else { try { cap(await liquidity(g.items[0].addr)); } catch (e) { unverified++; } }
      }));
      for (const t of valued) {
        if (t.usd >= MIN_USD) holdings.push({ symbol: sym(t.symbol) + (t.where || ''), amount: t.amount, price: null, usdPrice: t.usd / t.amount, addr: t.addr });
        else others.push(t.addr);
      }
      return { holdings, others, unverified };
    }

    // ---- DeFi positions ----
    const defiSeen = new Map();
    const defiFor = (a) => {        // every position on every network, one call per address (null: no answer)
      if (!defiSeen.has(a)) defiSeen.set(a, D.fetchJSON(DEFI_API + a, undefined, 20000).then((j) => (Array.isArray(j.data) ? j.data : null), () => null));
      return defiSeen.get(a);
    };
    // a position token's priced parts (fees owed included); false when part of it has no price
    function parts(t, out) {
      if (t.type !== 'protocol' && t.price != null) {
        const amount = Number(t.balance) || 0;
        if (amount > 0) out.push({ addr: t.address, symbol: t.symbol, amount, price: Number(t.price) });
        return true;
      }
      if (!(t.tokens || []).length) return !(Number(t.balance) > 0);
      return t.tokens.reduce((ok, x) => parts(x, out) && ok, true);
    }
    const word = (hex, i) => hex.slice(2 + 64 * i, 66 + 64 * i);
    const arg = (x) => (typeof x === 'bigint' ? BigInt.asUintN(256, x).toString(16) : x.slice(2).toLowerCase()).padStart(64, '0');
    const int24 = (w) => Number(BigInt.asIntN(256, BigInt('0x' + w)));
    const call = (url, to, data) => D.rpc(url, 'eth_call', [{ to, data }, 'latest']).then((r) => { if (!/^0x[0-9a-fA-F]*$/.test(r)) throw new Error('bad answer'); return r; });
    function abiString(hex) {        // string, or bytes32 from old tokens; '?' when neither
      const b = hex.slice(2);
      try {
        if (b.length >= 192) { const n = parseInt(b.slice(64, 128), 16); return decodeURIComponent(b.slice(128, 128 + 2 * Math.min(n, 64)).replace(/(..)/g, '%$1')); }
        return decodeURIComponent(b.slice(0, 64).replace(/(00)+$/, '').replace(/(..)/g, '%$1'));
      } catch (e) { return '?'; }
    }
    // Uniswap-v3-style liquidity NFTs of addr on network c, skipping those in skip
    // -> [{ name, addr, symbol, amount }] (unpriced), and how many managers did not answer
    async function lpNfts(c, addr, url, skip) {
      const raw = [];
      let failed = 0, more = 0;
      await Promise.all((LP_NFT[c.key] || []).map(async ([name, npm, slip]) => {
        try {
          const all = Number(BigInt(await call(url, npm, '0x70a08231' + arg(addr))));
          if (!all) return;
          if (all > LP_MAX) more++;
          const n = Math.min(all, LP_MAX);
          const factory = '0x' + word(await call(url, npm, '0xc45a0155'), 0).slice(24);
          await Promise.all(Array.from({ length: n }, async (_, i) => { try {
            const id = BigInt(await call(url, npm, '0x2f745c59' + arg(addr) + arg(BigInt(all - 1 - i))));   // newest first: old ones are mostly closed
            if (skip.has(lc(npm) + ':' + id)) return;
            const p = await call(url, npm, '0x99fbab88' + arg(id));
            const t0 = '0x' + word(p, 2).slice(24), t1 = '0x' + word(p, 3).slice(24);
            const lo = int24(word(p, 5)), hi = int24(word(p, 6)), L = Number(BigInt('0x' + word(p, 7)));
            const owed0 = Number(BigInt('0x' + word(p, 10))), owed1 = Number(BigInt('0x' + word(p, 11)));
            let a0 = owed0, a1 = owed1;
            if (L > 0) {
              const pool = '0x' + word(await call(url, factory, (slip ? '0x28af8d0b' : '0x1698ee82') + arg(t0) + arg(t1) + arg(BigInt(int24(word(p, 4))))), 0).slice(24);
              const [s0, g0, g1, tLo, tHi, r0, r1] = await Promise.all([call(url, pool, '0x3850c7bd'), call(url, pool, '0xf3058399'), call(url, pool, '0x46141319'),
                call(url, pool, '0xf30dba93' + arg(BigInt(lo))), call(url, pool, '0xf30dba93' + arg(BigInt(hi))),
                call(url, t0, '0x70a08231' + arg(pool)), call(url, t1, '0x70a08231' + arg(pool))]);
              // principal at the pool's current price
              const sp = Number(BigInt('0x' + word(s0, 0))) / 2 ** 96, tick = int24(word(s0, 1));
              const sa = Math.pow(1.0001, lo / 2), sb = Math.pow(1.0001, hi / 2), sq = Math.min(Math.max(sp, sa), sb);
              a0 += L * (sb - sq) / (sb * sq);
              a1 += L * (sq - sa);
              // fees earned since the last collect: liquidity * growth inside the range since then
              const M = 1n << 256n, o = slip ? 3 : 2, Lb = BigInt('0x' + word(p, 7));
              const wrap = (x) => ((x % M) + M) % M;
              const fees = (k, g) => {
                const out0 = BigInt('0x' + word(tLo, o + k)), out1 = BigInt('0x' + word(tHi, o + k));
                const inside = wrap(g - (tick >= lo ? out0 : g - out0) - (tick < hi ? out1 : g - out1));
                return Number(Lb * wrap(inside - BigInt('0x' + word(p, 8 + k))) >> 128n);
              };
              // a position can never take out more than its pool holds: principal is capped there,
              // and fees the pool could not pay mean a misread, so they are left out
              const pool0 = Number(BigInt('0x' + word(r0, 0))), pool1 = Number(BigInt('0x' + word(r1, 0)));
              const f0 = fees(0, BigInt('0x' + word(g0, 0))), f1 = fees(1, BigInt('0x' + word(g1, 0)));
              a0 = Math.min(a0 + (a0 + f0 <= pool0 ? f0 : 0), pool0);
              a1 = Math.min(a1 + (a1 + f1 <= pool1 ? f1 : 0), pool1);
            }
            raw.push({ name, addr: t0, raw: a0 }, { name, addr: t1, raw: a1 });
          } catch (e) { failed++; } }));
        } catch (e) { failed++; }
      }));
      const meta = {};
      await Promise.all([...new Set(raw.filter((x) => x.raw > 0).map((x) => lc(x.addr)))].map(async (a) => {
        try {
          const [d, s] = await Promise.all([call(url, a, '0x313ce567'), call(url, a, '0x95d89b41').then(abiString, () => '?')]);
          meta[a] = { dec: Number(BigInt(d)), symbol: s };
        } catch (e) { failed++; }
      }));
      const out = raw.filter((x) => x.raw > 0 && meta[lc(x.addr)] && meta[lc(x.addr)].dec <= 36)
        .map((x) => ({ name: x.name, addr: x.addr, symbol: meta[lc(x.addr)].symbol, amount: x.raw / 10 ** meta[lc(x.addr)].dec }));
      return { list: out, failed, more };
    }
    // positions of addr on network c -> { holdings, others: [addr], covered: Set, partial }
    async function positions(c, addr, url, known) {
      const out = { holdings: [], others: [], covered: new Set(), partial: [] };
      const supply = {}, debt = {}, unvalued = new Set(), unpriced = {};
      const proto = (p) => String(p).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/([a-z])V(\d)/g, '$1 V$2').trim().slice(0, 24) || '?';   // UniswapV3 -> Uniswap V3, as the on-chain names
      if (MM[c.key] && DEFI.includes(c.key)) {
        const all = await defiFor(addr);
        if (!all) out.partial.push('DeFi positions not checked');
        for (const p of all || []) {
          if (!p.success || p.chainId !== MM[c.key]) continue;
          const name = proto(p.protocolDisplayName || p.protocolId);
          for (const t of p.tokens || []) {
            const got = [];
            const ok = parts(t, got);
            if (p.positionType === 'borrow') {
              if (!ok) unvalued.add(name);
              debt[name] = (debt[name] || 0) + got.reduce((sum, x) => sum + x.amount * x.price, 0);
            } else if (ok) (supply[name] = supply[name] || []).push(...got);
            else { (unpriced[name] = unpriced[name] || []).push(t); continue; }   // the token list still sees its receipt token
            out.covered.add(t.tokenId != null ? lc(t.address) + ':' + t.tokenId : lc(t.address));
          }
        }
      }
      // a deposit we cannot price next to a debt we can: counting the receipt token without the debt
      // would overstate, so the whole protocol is left out and said so
      for (const name of Object.keys(debt)) for (const t of unpriced[name] || []) { unvalued.add(name); out.covered.add(lc(t.address)); out.others.push(t.address); }
      for (const name of unvalued) if (!supply[name]) out.partial.push('debt in ' + name + ' not valued');
      if (LP_NFT[c.key]) {
        const lp = await lpNfts(c, addr, url, out.covered);
        if (lp.failed) out.partial.push('some liquidity positions not read');
        if (lp.more) out.partial.push('newest ' + LP_MAX + ' liquidity positions per pool manager checked');
        const p = await llamaPrices(LLAMA[c.key], [...new Set(lp.list.map((x) => x.addr))]);
        for (const x of lp.list) {
          const v = p[lc(x.addr)];
          if (v) (supply[x.name] = supply[x.name] || []).push({ addr: x.addr, symbol: x.symbol, amount: x.amount, price: v.price });
          else out.others.push(x.addr);
        }
      }
      for (const [name, list] of Object.entries(supply)) {
        const merged = {};                       // one line per token per protocol
        for (const x of list) { const k = lc(x.addr); if (merged[k]) merged[k].amount += x.amount; else merged[k] = Object.assign({}, x); }
        const r = await judge(Object.values(merged), known);
        out.others.push(...r.others);
        if (unvalued.has(name)) { out.others.push(...r.holdings.map((x) => x.addr)); out.partial.push('debt in ' + name + ' not valued'); continue; }
        if (debt[name]) {
          const net = r.holdings.reduce((sum, x) => sum + x.amount * x.usdPrice, 0) - debt[name];
          out.holdings.push({ symbol: 'USD in ' + name + ', after debt', amount: Math.max(0, net), price: null, usdPrice: 1 });
        } else for (const x of r.holdings) out.holdings.push(Object.assign(x, { symbol: x.symbol + ' in ' + name }));
      }
      return out;
    }

    // Aave deposits and debt held as tokens, wherever MetaMask's DeFi API did not already count
    // them: aTokens have no DEX pool, so the liquidity check would drop them, and debt tokens are
    // often unpriced. A token counts as Aave's only if its POOL() is the network's Aave pool; it
    // is worth its underlying asset 1:1. -> { usd, unvalued, addrs }
    async function aave(c, url, tokens) {
      const pool = AAVE[c.key];
      const cands = pool ? tokens.filter((t) => /^(a[A-Z0-9]|variableDebt|stableDebt)/.test(t.symbol || '') && t.amount > 0).slice(0, 40) : [];
      if (!cands.length) return null;
      const word = (h) => (/^0x[0-9a-fA-F]{64}/.test(h || '') ? '0x' + h.slice(26, 66).toLowerCase() : null);
      const found = (await Promise.all(cands.map(async (t) => {
        const [p, u] = await Promise.all([D.rpc(url, 'eth_call', [{ to: t.addr, data: '0x7535d246' }, 'latest']), D.rpc(url, 'eth_call', [{ to: t.addr, data: '0xb16a19de' }, 'latest'])]);
        return word(p) === lc(pool) && word(u) ? Object.assign({ underlying: word(u), debt: /Debt/.test(t.symbol) }, t) : null;
      }).map((p) => p.catch(() => null)))).filter(Boolean);
      if (!found.length) return null;
      const px = await llamaPrices(LLAMA[c.key], [...new Set(found.map((x) => x.underlying))]);
      let dep = 0, debt = 0, unvalued = false;
      for (const x of found) {
        const v = px[x.underlying];
        if (!v || !(v.price > 0)) { unvalued = true; continue; }
        if (x.debt) debt += x.amount * v.price; else dep += x.amount * v.price;
      }
      return { usd: dep - debt, unvalued, addrs: new Set(found.map((x) => lc(x.addr))) };
    }

    // Vault shares (ERC-4626: Euler, Fluid, Yearn, Spark, Morpho off its API's networks...) have no DEX
    // pool, so the liquidity check drops them. One counts when DefiLlama prices the share and the
    // vault itself agrees: convertToAssets of one share times the asset's DefiLlama price within 2%
    // of that price. -> [{ addr, symbol, amount, usd }]
    async function vaults(c, url, cands) {
      const word = (h, i = 0) => (/^0x[0-9a-fA-F]+$/.test(h || '') && h.length >= 66 + 64 * i ? BigInt('0x' + h.slice(2 + 64 * i, 66 + 64 * i)) : null);
      const call = (to, data) => D.rpc(url, 'eth_call', [{ to, data }, 'latest']);
      const got = (await Promise.all(cands.slice(0, 20).map(async (t) => {
        const [a, dec] = await Promise.all([call(t.addr, '0x38d52e0f'), call(t.addr, '0x313ce567')]);   // asset(), decimals()
        const asset = word(a), d = word(dec);
        if (!asset || d == null || d > 36n) return null;
        const per = word(await call(t.addr, '0x07a2d13a' + (10n ** d).toString(16).padStart(64, '0')));   // convertToAssets(one share)
        return per ? { t, asset: '0x' + asset.toString(16).padStart(40, '0'), per } : null;
      }).map((p) => p.catch(() => null)))).filter(Boolean);
      if (!got.length) return [];
      const px = await llamaPrices(LLAMA[c.key], [...new Set(got.map((x) => x.asset))]);
      const out = [];
      for (const x of got) {
        const q = px[lc(x.asset)];
        if (!q || !(q.price > 0) || !(q.decimals >= 0)) continue;
        const implied = Number(x.per) / 10 ** q.decimals * q.price;
        if (Math.abs(implied / x.t.price - 1) <= 0.02) out.push({ addr: x.t.addr, symbol: x.t.symbol, amount: x.t.amount, usd: x.t.amount * implied });
      }
      return out;
    }

    // Morpho: vault deposits (v1 and v2) and lending positions (supply and collateral less borrow)
    // from Morpho's own API, one query for every network, shared by the networks' checks.
    // -> { networkKey: { usd, unvalued, vaults: Set(vault address) } }
    const morphoMemo = new Map();
    const morpho = (addr) => { if (!morphoMemo.has(lc(addr))) morphoMemo.set(lc(addr), morphoAll(addr)); return morphoMemo.get(lc(addr)); };
    async function morphoAll(addr) {
      const a = JSON.stringify(addr), ids = Object.keys(MORPHO);
      const query = '{ ' + ids.map((id) => 'c' + id + ': userByAddress(address: ' + a + ', chainId: ' + id + ') { vaultV2Positions { vault { address } assets assetsUsd } }').join(' ')
        + ' v: vaultPositions(first: 200, where: { userAddress_in: [' + a + '] }) { items { vault { address chain { id } } state { assets assetsUsd } } }'
        + ' m: marketPositions(first: 200, where: { userAddress_in: [' + a + '] }) { items { market { morphoBlue { chain { id } } } state { collateral collateralUsd borrowAssets borrowAssetsUsd supplyAssets supplyAssetsUsd } } } }';
      const j = await D.fetchJSON(MORPHO_API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
      if (!j.data || !j.data.v || !j.data.m) throw new Error('unexpected answer');
      const out = {};
      const at = (id) => { const k = MORPHO[id]; return k ? (out[k] = out[k] || { usd: 0, unvalued: false, vaults: new Set() }) : null; };
      const add = (o, raw, usd, sign) => { if (!(Number(raw) > 0)) return; if (usd == null || !Number.isFinite(Number(usd))) o.unvalued = true; else o.usd += sign * Number(usd); };
      for (const id of ids) for (const p of ((j.data['c' + id] || {}).vaultV2Positions) || []) { const o = at(id); add(o, p.assets, p.assetsUsd, 1); o.vaults.add(lc(p.vault.address)); }
      for (const p of j.data.v.items || []) { const o = at(p.vault.chain.id); if (!o) continue; add(o, p.state.assets, p.state.assetsUsd, 1); o.vaults.add(lc(p.vault.address)); }
      for (const p of j.data.m.items || []) {
        const o = at(p.market.morphoBlue.chain.id), st = p.state || {};
        if (!o) continue;
        add(o, st.supplyAssets, st.supplyAssetsUsd, 1); add(o, st.collateral, st.collateralUsd, 1); add(o, st.borrowAssets, st.borrowAssetsUsd, -1);
      }
      if ((j.data.v.items || []).length >= 200 || (j.data.m.items || []).length >= 200) for (const o of Object.values(out)) o.unvalued = true;
      return out;
    }

    // ---- EVM: every token of `addr` on network c; url = an RPC that answered ----
    async function evm(c, addr, url, opts) {
      const known = new Set((TOP[c.key] || []).map((t) => lc(t[1])).concat(c.tokens.map((t) => lc(t.addr)), NATIVE));
      const [t, d] = await Promise.all([tokenList(c, addr, url, known, opts), positions(c, addr, url, known).catch(() => null)]);
      const count = (xs) => new Set(xs.map(lc)).size;
      const covered = (a) => d && d.covered.has(lc(a));
      const av = await aave(c, url, (t.all || []).filter((x) => !covered(x.addr))).catch(() => null);
      // Morpho from its own API, in place of MetaMask's Morpho lines: MetaMask's adapter counts a
      // vault share as one unit of the asset, but shares grow (889,528 steakUSDC were 1,019,047
      // USDC on-chain, as Morpho's API says). MetaMask's lines stay only if Morpho's API fails.
      const mo = Object.values(MORPHO).includes(c.key) ? await morpho(addr).then((m) => m[c.key] || null, () => 'failed') : null;
      if (d && mo !== 'failed' && Object.values(MORPHO).includes(c.key)) d.holdings = d.holdings.filter((x) => !/morpho/i.test(x.symbol));
      const taken = (a) => covered(a) || (av && av.addrs.has(lc(a))) || (mo && mo.vaults && mo.vaults.has(lc(a)));
      // priced tokens the liquidity check dropped: vault shares, if the vault agrees with the price
      const counted = new Set(t.holdings.map((x) => lc(x.addr)));
      const vs = await vaults(c, url, (t.all || []).filter((x) => x.price > 0 && x.amount * x.price >= 10 && !counted.has(lc(x.addr)) && !taken(x.addr)).sort((p, q) => q.amount * q.price - p.amount * p.price)).catch(() => []);
      for (const v of vs) t.holdings.push({ symbol: sym(v.symbol), amount: v.amount, price: null, usdPrice: v.usd / v.amount, addr: v.addr });
      const free = (a) => !a || !taken(a);
      if (mo === 'failed') t.partial = [t.partial, 'Morpho not checked'].filter(Boolean).join('; ');
      else if (mo) {
        if (mo.unvalued) t.partial = [t.partial, 'Morpho position not valued'].filter(Boolean).join('; ');
        else if (mo.usd > 0) t.holdings.push({ symbol: 'USD in Morpho, after debt', amount: mo.usd, price: null, usdPrice: 1 });
        t.others = t.others.filter(free);
      }
      if (av) {
        if (av.unvalued) t.partial = [t.partial, 'Aave position not valued'].filter(Boolean).join('; ');
        else t.holdings.push({ symbol: 'USD in Aave, after debt', amount: Math.max(0, av.usd), price: null, usdPrice: 1 });
        t.others = t.others.filter(free);
      }
      // debt held as a token and not already netted by a DeFi position: the tokens become one
      // line, their worth less the debt (the deposit it was borrowed against is among them)
      const netted = (hs) => {
        const debt = (t.debts || []).filter((x) => free(x.addr)).reduce((sum, x) => sum + x.usd, 0);
        if (!(debt > 0)) return hs;
        const worth = hs.reduce((sum, x) => sum + x.amount * (x.usdPrice || 0), 0);
        return [{ symbol: 'USD in tokens, after debt', amount: Math.max(0, worth - debt), price: null, usdPrice: 1 }];
      };
      if (!d) return Object.assign(t, { holdings: netted(t.holdings.filter((x) => free(x.addr))), others: count(t.others), partial: [t.partial, 'DeFi positions not checked'].filter(Boolean).join('; ') });
      return {
        holdings: netted(t.holdings.filter((x) => free(x.addr))).concat(d.holdings),
        others: count(t.others.filter(free).concat(d.others)),
        partial: [t.partial].concat(d.partial).filter(Boolean).join('; ') || null,
        note: t.note,
      };
    }
    // opts.extra: a further account of the seed; Rabby's few calls are kept for the first one
    async function tokenList(c, addr, url, known, opts) {
      const src = (SRC[c.key] || []).filter(([kind]) => !(opts && opts.extra && kind === 'rb'));
      if (src.length) {
        try {
          const list = await D.firstOk(src, ([kind, arg]) => listers[kind](arg, addr));
          const tokens = list.filter((t) => t.addr && (t.amount != null ? t.amount > 0 : t.dec >= 0 && t.dec <= 36 && /^\d+$/.test(String(t.raw)) && BigInt(t.raw) > 0n))
            .map((t) => ({ addr: t.addr, symbol: t.symbol || '?', amount: t.amount != null ? t.amount : D.units(BigInt(t.raw), t.dec), price: t.price }));
          let noPrices = false;
          // the network's known big tokens first: a spammed wallet can list thousands
          const missing = tokens.filter((t) => t.price == null).map((t) => t.addr).sort((a, b) => known.has(lc(b)) - known.has(lc(a)));
          if (missing.length) {
            const p = await llamaPrices(LLAMA[c.key], missing);
            for (const t of tokens) if (t.price == null && p[lc(t.addr)]) t.price = p[lc(t.addr)].price;
            if (p.failed) noPrices = true;
          }
          // still unpriced: DexScreener (fresh memecoins), never for spam whose name is a link or a "claim"
          const spam = (t) => /https?:|www\.|\.(com|io|org|net|xyz|app|site|vip|cc|me|us|gg)\b|t\.me|claim|visit|reward|airdrop|voucher|\$\s?\d/i.test(t.symbol || '');
          const unpriced = tokens.filter((t) => t.price == null && !spam(t)).map((t) => t.addr);
          let dx = {};
          if (unpriced.length) {
            dx = await dexPrices(c.key, unpriced).catch(() => ({}));
            for (const t of tokens) { const d = dx[lc(t.addr)]; if (t.price == null && d && d.price > 0) { t.price = d.price; t.liq = d.liq; } }
          }
          const onCurve = c.key === 'bsc' ? tokens.filter((t) => t.price == null && !spam(t)) : [];
          if (onCurve.length) {
            const cv = await curveValues(url, onCurve).catch(() => ({ cut: true }));
            if (cv.cut) dx.cut = true;
            for (const t of tokens) { const usd = cv[lc(t.addr)]; if (t.price == null && usd > 0) { t.price = usd / t.amount; t.exact = true; } }
          }
          // debt tokens (Aave's variableDebt..., which DefiLlama prices below zero): what is owed
          const debts = tokens.filter((t) => t.price < 0).map((t) => ({ addr: t.addr, usd: t.amount * -t.price }));
          const r = await judge(tokens.filter((t) => !(t.price < 0)), known);
          const partial = [list.more && 'first ' + list.length + ' tokens checked', noPrices && 'token prices not checked', dx.cut && 'not every unknown token looked up', !list.more && !noPrices && r.unverified && 'token values not cross-checked'].filter(Boolean).join('; ') || null;
          return { holdings: r.holdings, others: r.others, partial, debts, all: tokens };
        } catch (e) { /* fall through to the fixed list */ }
      }
      // fixed list: the stablecoins app.js prices by CoinGecko id, plus the network's top tokens
      const list = c.tokens.map((t) => ({ symbol: t.symbol, addr: t.addr, dec: t.dec, cg: t.price }));
      for (const [symbol, a, dec] of TOP[c.key] || []) if (!list.some((t) => lc(t.addr) === lc(a))) list.push({ symbol, addr: a, dec });
      const owner = addr.slice(2).toLowerCase().padStart(64, '0');
      const res = await Promise.allSettled(list.map((t) => D.rpc(url, 'eth_call', [{ to: t.addr, data: '0x70a08231' + owner }, 'latest'])));
      const holdings = [], toPrice = [];
      let failed = 0;
      res.forEach((r, i) => {
        if (r.status !== 'fulfilled' || !/^0x[0-9a-fA-F]+$/.test(r.value)) { failed++; return; }
        const t = list[i], amount = D.units(r.value === '0x' ? 0n : BigInt(r.value), t.dec);
        if (t.cg) holdings.push({ symbol: t.symbol, amount, price: t.cg, addr: t.addr });
        else if (amount > 0) toPrice.push(Object.assign({ amount }, t));
      });
      const unpriced = [];
      if (toPrice.length) {
        const p = await llamaPrices(LLAMA[c.key], toPrice.map((t) => t.addr));
        for (const t of toPrice) {
          const usd = p[lc(t.addr)] && p[lc(t.addr)].price;
          if (usd != null) holdings.push({ symbol: t.symbol, amount: t.amount, price: null, usdPrice: usd, addr: t.addr });
          else unpriced.push(t.addr);
        }
      }
      const what = src.length ? 'token list did not answer; only major tokens checked' : null;
      return { holdings, others: unpriced, partial: failed ? (list.length - failed) + ' of ' + list.length + ' tokens checked' : what, note: src.length || !list.length ? null : 'only major tokens checked' };
    }

    // ---- Tron, Sui, Aptos: a wallet's other tokens [{ addr, raw }], priced and sized by
    // DefiLlama (which also knows their decimals), then the same liquidity check ----
    async function other(slug, list, known) {
      known = (known || []).concat(STABLE[slug] || []);
      const p = await llamaPrices(slug, list.map((t) => t.addr));
      const tokens = [], unpriced = [];
      for (const t of list) {
        const v = p[lc(t.addr)];
        if (v && v.decimals >= 0 && v.decimals <= 36) tokens.push({ addr: t.addr, symbol: v.symbol || '?', amount: Number(BigInt(t.raw)) / 10 ** v.decimals, price: v.price });
        else unpriced.push(t.addr);
      }
      const r = await judge(tokens, new Set(known.map(lc)));
      return { holdings: r.holdings, others: r.others.length + unpriced.length, partial: p.failed ? 'token prices not checked' : r.unverified ? 'token values not cross-checked' : null };
    }

    // ---- Solana ----
    // getMultipleAccounts, 10 at a time: publicnode refuses more in one call
    async function many(keys, encoding) {
      const parts = [];
      for (let i = 0; i < keys.length; i += 10) parts.push(keys.slice(i, i + 10));
      const got = await Promise.all(parts.map((p) => D.firstOk(D.solRpcs, (u) => D.rpc(u, 'getMultipleAccounts', [p, { encoding }]))));
      return got.flatMap((r) => r.value || []);
    }
    // Orca Whirlpool and Raydium CLMM positions: NFTs in the wallet, each with a position
    // account at a PDA of its mint. Amounts from liquidity, range and the pool's price (the
    // Uniswap v3 formulas, prices in Q64.64), plus fees already owed to the position; fees
    // accrued since its last update are left out. -> [{ addr: mint, amount }] per token, and
    // the position mints (which are not counted again as tokens)
    const CLMM = [
      // program, position: [pool, liquidity, tick lower, tick upper, fee owed a, fee owed b], pool: [sqrt price, mint a, mint b]
      ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', [8, 72, 88, 92, 112, 136], [65, 101, 181], 'Orca'],
      ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', [41, 81, 73, 77, 129, 137], [253, 73, 105], 'Raydium'],
    ];
    async function clmmPositions(mints) {
      const legs = [], held = [], gaps = [];
      if (mints.length > 100) gaps.push('first 100 NFTs checked for liquidity positions');
      if (!mints.length) return { legs, held, gaps };
      const seed = new TextEncoder().encode('position');
      const keys = [], meta = [];
      for (const m of mints.slice(0, 100)) for (const c of CLMM) { keys.push(D.pda([seed, D.b58decode(m)], c[0])); meta.push({ m, c }); }
      const accs = await many(await Promise.all(keys), 'base64');
      const bytes = (a) => Uint8Array.from(atob(a.data[0]), (ch) => ch.charCodeAt(0));
      const view = (b) => new DataView(b.buffer);
      const u128 = (v, o) => v.getBigUint64(o, true) + (v.getBigUint64(o + 8, true) << 64n);
      const key = (b, o) => D.b58encode(b.subarray(o, o + 32));
      const pos = [];
      accs.forEach((a, i) => {
        if (!a || a.owner !== meta[i].c[0]) return;
        const b = bytes(a), v = view(b), o = meta[i].c[1];
        pos.push({ mint: meta[i].m, c: meta[i].c, pool: key(b, o[0]), L: u128(v, o[1]), lo: v.getInt32(o[2], true), hi: v.getInt32(o[3], true), feeA: v.getBigUint64(o[4], true), feeB: v.getBigUint64(o[5], true) });
      });
      if (!pos.length) return { legs, held, gaps };
      const poolKeys = [...new Set(pos.map((p) => p.pool))];
      const pools = {};
      (await many(poolKeys, 'base64')).forEach((a, i) => { if (a) pools[poolKeys[i]] = bytes(a); });
      const tokenMints = new Set();
      for (const p of pos) {
        const b = pools[p.pool];
        if (!b) continue;
        const v = view(b), q = p.c[2];
        Object.assign(p, { sqrt: Number(u128(v, q[0])) / 2 ** 64, a: key(b, q[1]), bm: key(b, q[2]) });
        tokenMints.add(p.a); tokenMints.add(p.bm);
      }
      const px = await llamaPrices('solana', [...tokenMints]);   // decimals (and prices) by mint
      if (px.failed) gaps.push('liquidity positions not valued');
      for (const p of pos) {
        if (p.sqrt == null) { gaps.push('a liquidity position not read'); continue; }
        held.push(p.mint);
        const L = Number(p.L), sa = Math.pow(1.0001, p.lo / 2), sb = Math.pow(1.0001, p.hi / 2), sp = Math.min(Math.max(p.sqrt, sa), sb);
        const rawA = L * (sb - sp) / (sp * sb) + Number(p.feeA), rawB = L * (sp - sa) + Number(p.feeB);
        // each side on its own: a fresh memecoin DefiLlama does not know must not take the SOL or USDC side with it
        for (const [m, raw, d] of [[p.a, rawA, px[lc(p.a)]], [p.bm, rawB, px[lc(p.bm)]]]) if (raw > 0 && !d) gaps.push('part of a liquidity position not valued'); else if (raw > 0) legs.push({ addr: m, symbol: /^[a-z0-9]+$/.test(d.symbol || '') ? d.symbol.toUpperCase() : d.symbol || '?', where: ' in ' + p.c[3], amount: raw / 10 ** d.decimals, price: d.price });
      }
      return { legs, held, gaps };
    }
    // Meteora DLMM positions: accounts the wallet owns (owner at byte 40), not NFTs. Each holds
    // liquidity shares for up to 70 bins; a bin's reserves split by its share of the bin's total
    // (bins live in bin arrays of 70, PDAs of the pair and the array index). Pending fees are
    // left out. -> legs like clmmPositions
    const DLMM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
    async function dlmmPositions(addr) {
      const legs = [];
      legs.gaps = [];
      const accts = await D.firstOk(D.solScanRpcs, (u) => D.rpc(u, 'getProgramAccounts', [DLMM, { encoding: 'base64', filters: [{ memcmp: { offset: 40, bytes: addr } }] }]));
      if (!Array.isArray(accts)) throw new Error('unexpected answer');
      const bytes = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
      const u128 = (v, o) => v.getBigUint64(o, true) + (v.getBigUint64(o + 8, true) << 64n);
      if (accts.length > 40) legs.gaps.push('first 40 Meteora positions checked');
      const pos = accts.map((a) => bytes(a.account.data[0])).filter((b) => b.length >= 7920).slice(0, 40).map((b) => {
        const v = new DataView(b.buffer);
        return { v, pair: D.b58encode(b.subarray(8, 40)), lo: v.getInt32(7912, true), hi: v.getInt32(7916, true) };
      }).filter((p) => p.hi >= p.lo && p.hi - p.lo < 70);
      if (!pos.length) return legs;
      const pairKeys = [...new Set(pos.map((p) => p.pair))], pairs = {};
      (await many(pairKeys, 'base64')).forEach((a, i) => { if (a) { const b = bytes(a.data[0]); pairs[pairKeys[i]] = [D.b58encode(b.subarray(88, 120)), D.b58encode(b.subarray(120, 152))]; } });
      const arr = (b) => Math.floor(b / 70), want = [], seed = new TextEncoder().encode('bin_array');
      for (const p of pos) for (let i = arr(p.lo); i <= arr(p.hi); i++) if (!want.some((w) => w.pair === p.pair && w.i === i)) want.push({ pair: p.pair, i });
      const keys = await Promise.all(want.map((w) => { const ib = new Uint8Array(8); new DataView(ib.buffer).setBigInt64(0, BigInt(w.i), true); return D.pda([seed, D.b58decode(w.pair), ib], DLMM); }));
      const arrays = {};
      (await many(keys, 'base64')).forEach((a, k) => { if (a) arrays[want[k].pair + ' ' + want[k].i] = new DataView(bytes(a.data[0]).buffer); });
      const sums = [];
      for (const p of pos) {
        const mints = pairs[p.pair];
        if (!mints) continue;
        let x = 0n, y = 0n;
        for (let b = p.lo; b <= p.hi; b++) {
          const share = u128(p.v, 72 + 16 * (b - p.lo)), ba = arrays[p.pair + ' ' + arr(b)];
          if (!share || !ba) continue;
          const o = 56 + 144 * (b - arr(b) * 70), supply = u128(ba, o + 32);
          if (supply) { x += ba.getBigUint64(o, true) * share / supply; y += ba.getBigUint64(o + 8, true) * share / supply; }
        }
        sums.push([mints[0], x], [mints[1], y]);
      }
      const px = await llamaPrices('solana', [...new Set(sums.map((x) => x[0]))]);
      for (const [m, raw] of sums) {
        const d = px[lc(m)];
        if (!d && raw > 0n) legs.gaps.push('part of a Meteora position not valued');
        if (d && raw > 0n) legs.push({ addr: m, symbol: /^[a-z0-9]+$/.test(d.symbol || '') ? d.symbol.toUpperCase() : d.symbol || '?', where: ' in Meteora', amount: Number(raw) / 10 ** d.decimals, price: d.price });
      }
      return legs;
    }
    // pump.fun: a token still on its bonding curve (its mint ends in "pump"; once it graduates it
    // trades on PumpSwap and is priced like any other) counts at what selling it into the curve
    // returns: constant product on the curve's virtual reserves, never more than the SOL the
    // curve really holds, less pump.fun's 1.25% fee. -> { mint: SOL }
    const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', WSOL = 'So11111111111111111111111111111111111111112';
    async function pumpCurves(tokens) {
      const list = tokens.filter((t) => /pump$/.test(t.addr)).slice(0, 50), out = {};
      if (!list.length) return out;
      const seed = new TextEncoder().encode('bonding-curve');
      const pdas = await Promise.all(list.map((t) => D.pda([seed, D.b58decode(t.addr)], PUMP)));
      (await many(pdas, 'base64')).forEach((acc, i) => {
        if (!acc || acc.owner !== PUMP || !acc.data) return;
        const b = Uint8Array.from(atob(acc.data[0]), (ch) => ch.charCodeAt(0));
        if (b.length < 49 || b[48]) return;                                   // complete: graduated
        const v = new DataView(b.buffer), u64 = (o) => v.getBigUint64(o, true);
        const vt = u64(8), vs = u64(16), rs = u64(32), amt = BigInt(Math.floor(list[i].amount * 1e6));   // pump.fun tokens: 6 decimals
        let lamports = amt * vs / (vt + amt);
        if (lamports > rs) lamports = rs;
        out[list[i].addr] = Number(lamports * 9875n / 10000n) / 1e9;
      });
      return out;
    }
    const jupQueue = serial(250);          // Jupiter's free tier allows a few calls a window
    const jup = (url) => jupQueue(() => D.fetchJSON(url));
    async function sol(addr, opts) {
      // 1. amounts: every token account from Jupiter, else the biggest tokens' accounts
      let amounts = {}, partial = null, listed = -1;   // listed: token accounts, empty ones too (-1: unknown)
      try {
        const j = await jup('https://lite-api.jup.ag/ultra/v1/holdings/' + addr);
        if (!j.tokens) throw new Error('unexpected answer');
        listed = Object.keys(j.tokens).length;
        for (const [mint, accts] of Object.entries(j.tokens)) for (const a of accts || []) amounts[mint] = (amounts[mint] || 0) + (Number(a.uiAmount) || 0);
      } catch (e) {
        amounts = {};
        partial = 'token list did not answer; only major tokens checked';
        const atas = await Promise.all(SOL_TOP.map((t) => D.ata(addr, t[1], t[3] ? 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' : undefined)));
        const r = { value: await many(atas, 'jsonParsed') };
        (r.value || []).forEach((acc, i) => {
          const p = acc && acc.data && acc.data.parsed && acc.data.parsed.info;
          if (p && p.mint === SOL_TOP[i][1] && p.tokenAmount) amounts[p.mint] = Number(p.tokenAmount.uiAmount) || 0;
        });
      }
      // liquidity positions: NFTs, which Jupiter's list leaves out, so the one public RPC that
      // lists an owner's token accounts (the stake-search one) is asked for those
      let lp = { legs: [], held: [], gaps: [] };
      // 'auto' (a further account with little SOL): only if it ever had a token account
      const scan = !opts || opts.positions !== 'auto' || listed !== 0;
      if (scan) try {
        const nfts = [];
        for (const prog of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
          const r = await D.firstOk(D.solScanRpcs, (u) => D.rpc(u, 'getTokenAccountsByOwner', [addr, { programId: prog }, { encoding: 'jsonParsed' }]));
          for (const a of r.value || []) { const i = a.account.data.parsed.info; if (i.tokenAmount.decimals === 0 && i.tokenAmount.amount === '1') nfts.push(i.mint); }
        }
        const [c, m] = await Promise.all([clmmPositions(nfts), dlmmPositions(addr)]);
        lp = { legs: c.legs.concat(m), held: c.held, gaps: c.gaps.concat(m.gaps) };
      } catch (e) { partial = partial || 'liquidity positions not checked'; }
      for (const m of lp.held) delete amounts[m];
      const mints = Object.keys(amounts).filter((m) => amounts[m] > 0);
      const names = Object.fromEntries(SOL_TOP.map((t) => [t[1], t[0]]));
      const tokens = mints.map((m) => ({ addr: m, symbol: names[m] || '?', amount: amounts[m], price: null }));
      // 2. prices: Jupiter (with its own liquidity figure), whatever it did not answer from DefiLlama
      const byMint = Object.fromEntries(tokens.map((t) => [t.addr, t]));
      try {
        for (let i = 0; i < mints.length && i < 200; i += 50) {
          const r = await jup('https://lite-api.jup.ag/tokens/v2/search?query=' + mints.slice(i, i + 50).join(','));
          for (const x of Array.isArray(r) ? r : []) {
            const t = byMint[x.id];
            if (t && x.usdPrice) { t.price = x.usdPrice; t.liq = x.liquidity || 0; t.symbol = x.symbol || t.symbol; }
          }
        }
      } catch (e) { /* rate limited: DefiLlama below */ }
      const rest = tokens.filter((t) => t.price == null).map((t) => t.addr).sort((a, b) => (b in names) - (a in names));
      const p = await llamaPrices('solana', rest);
      for (const t of tokens) { const v = p[lc(t.addr)]; if (t.price == null && v) { t.price = v.price; if (t.symbol === '?') t.symbol = v.symbol; } }
      try {
        const curve = await pumpCurves(tokens);
        if (Object.keys(curve).length) {
          const sol = (await llamaPrices('solana', [WSOL]))[lc(WSOL)];
          for (const t of tokens) if (curve[t.addr] > 0 && sol && sol.price > 0) { t.price = curve[t.addr] * sol.price / t.amount; t.exact = true; delete t.liq; }
        }
      } catch (e) { /* curve tokens stay judged by their (thin) liquidity */ }
      const r = await judge(tokens.concat(lp.legs), new Set(SOL_TOP.map((t) => lc(t[1]))));
      const notes = [partial].concat([...new Set(lp.gaps)], r.unverified && !partial ? ['token values not cross-checked'] : []).filter(Boolean);
      return { holdings: r.holdings, others: r.others.length, partial: notes.join('; ') || null, listed };
    }

    return { evm, sol, other };
  }

  return { make, SRC, TOP, LLAMA, SOL_TOP, MM, RABBY, DEFI, LP_NFT };
});

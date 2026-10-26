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
    iotx: [['WIOTX', '0xa00744882684c3e4747faefd68d283ea44099d03', 18], ['USDT-matic', '0x3cdb7c48e70b854ed2fa392e21687501d84b3afc', 6]],
    vic: [['C98', '0x0fd0288aaae91eaf935e2ec14b23486f86516c8c', 18]],
    glmr: [['xcDOT', '0xFfFFfFff1FcaCBd218EDc0EbA20Fc2308C778080', 10], ['WELL', '0x511aB53F793683763E5a8829738301368a2411E3', 18]],
    movr: [['WMOVR', '0x98878B06940aE243284CA214f92Bb71a2b032B8A', 18], ['USDC', '0xE3F5a90F9cb311505cd691a46596599aA1A0AD7D', 6]],
    zkevm: [['USDC', '0x37eAA0eF3549a5Bb7D431be78a3D99BD360d19e5', 6], ['USDT', '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', 6], ['POL', '0x22B21BedDef74FE62F031D2c5c8F7a9F8a4b304D', 18]],
  };
  // stablecoins of the non-EVM networks, trusted as they are (each checked on DefiLlama)
  const STABLE = {
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
      return D.fetchJSON(RABBY_API + path).catch((e) => { rabbyDown = e; throw e; });
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
    // wrapped coins are mostly the quote side); 0 when no pool trades it.
    async function liquidity(addr) {
      const j = await D.fetchJSON('https://api.dexscreener.com/latest/dex/tokens/' + addr);
      let usd = 0;
      for (const p of j.pairs || []) if (lc(p.baseToken && p.baseToken.address) === lc(addr) || lc(p.quoteToken && p.quoteToken.address) === lc(addr)) usd += (p.liquidity && p.liquidity.usd) || 0;
      return usd;
    }

    // tokens [{ addr, symbol, amount, price }] -> { holdings, others: [addr], unverified }
    async function judge(tokens, known) {
      const holdings = [], others = [];
      let unverified = 0;
      const valued = [];
      for (const t of tokens) {
        if (!(t.amount > 0)) continue;
        const usd = t.price != null ? t.amount * t.price : 0;
        if (usd >= MIN_USD) valued.push(Object.assign({ usd }, t)); else others.push(t.addr);
      }
      valued.sort((a, b) => b.usd - a.usd);
      await Promise.all(valued.map(async (t, i) => {
        if (known.has(lc(t.addr))) return;
        // selling usd worth into pools holding liq/2 of each side returns side * usd / (side + usd)
        const cap = (liq) => { const side = liq / 2; t.usd = liq < MIN_LIQ ? 0 : side * t.usd / (side + t.usd); };
        if (t.liq != null) cap(t.liq);
        else if (i >= VERIFY) t.usd = 0;
        else { try { cap(await liquidity(t.addr)); } catch (e) { unverified++; } }
      }));
      for (const t of valued) {
        if (t.usd >= MIN_USD) holdings.push({ symbol: sym(t.symbol), amount: t.amount, price: null, usdPrice: t.usd / t.amount, addr: t.addr });
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

    // ---- EVM: every token of `addr` on network c; url = an RPC that answered ----
    async function evm(c, addr, url, opts) {
      const known = new Set((TOP[c.key] || []).map((t) => lc(t[1])).concat(c.tokens.map((t) => lc(t.addr)), NATIVE));
      const [t, d] = await Promise.all([tokenList(c, addr, url, known, opts), positions(c, addr, url, known).catch(() => null)]);
      const count = (xs) => new Set(xs.map(lc)).size;
      if (!d) return Object.assign(t, { others: count(t.others), partial: [t.partial, 'DeFi positions not checked'].filter(Boolean).join('; ') });
      const free = (a) => !a || !d.covered.has(lc(a));
      return {
        holdings: t.holdings.filter((x) => free(x.addr)).concat(d.holdings),
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
          const r = await judge(tokens, known);
          const partial = [list.more && 'first ' + list.length + ' tokens checked', noPrices && 'token prices not checked', !list.more && !noPrices && r.unverified && 'token values not cross-checked'].filter(Boolean).join('; ') || null;
          return { holdings: r.holdings, others: r.others, partial };
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
    const jupQueue = serial(250);          // Jupiter's free tier allows a few calls a window
    const jup = (url) => jupQueue(() => D.fetchJSON(url));
    async function sol(addr) {
      // 1. amounts: every token account from Jupiter, else the biggest tokens' accounts
      let amounts = {}, partial = null;
      try {
        const j = await jup('https://lite-api.jup.ag/ultra/v1/holdings/' + addr);
        if (!j.tokens) throw new Error('unexpected answer');
        for (const [mint, accts] of Object.entries(j.tokens)) for (const a of accts || []) amounts[mint] = (amounts[mint] || 0) + (Number(a.uiAmount) || 0);
      } catch (e) {
        amounts = {};
        partial = 'token list did not answer; only major tokens checked';
        const atas = await Promise.all(SOL_TOP.map((t) => D.ata(addr, t[1], t[3] ? 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' : undefined)));
        const r = await D.firstOk(D.solRpcs, (u) => D.rpc(u, 'getMultipleAccounts', [atas, { encoding: 'jsonParsed' }]));
        (r.value || []).forEach((acc, i) => {
          const p = acc && acc.data && acc.data.parsed && acc.data.parsed.info;
          if (p && p.mint === SOL_TOP[i][1] && p.tokenAmount) amounts[p.mint] = Number(p.tokenAmount.uiAmount) || 0;
        });
      }
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
      const r = await judge(tokens, new Set(SOL_TOP.map((t) => lc(t[1]))));
      return { holdings: r.holdings, others: r.others.length, partial: partial || (r.unverified ? 'token values not cross-checked' : null) };
    }

    return { evm, sol, other };
  }

  return { make, SRC, TOP, LLAMA, SOL_TOP, MM, RABBY, DEFI, LP_NFT };
});

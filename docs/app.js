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
    { key: 'eth', name: 'Ethereum', rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://rpc.flashbots.net', 'https://1rpc.io/eth'], symbol: 'ETH', price: 'ethereum', explorer: 'https://etherscan.io/address/',
      tokens: [t('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'usd-coin'), t('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'tether')] },
    { key: 'base', name: 'Base', rpcs: ['https://base-rpc.publicnode.com', 'https://base.drpc.org', 'https://mainnet.base.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://basescan.org/address/',
      tokens: [t('USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'usd-coin'), t('USDT', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 6, 'tether')] },
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
    { key: 'linea', name: 'Linea', rpcs: ['https://linea-rpc.publicnode.com', 'https://linea.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://lineascan.build/address/',
      tokens: [t('USDC', '0x176211869cA2b568f2A7D4EE941E073a821EE1ff', 6, 'usd-coin'), t('USDT', '0xA219439258ca9da29E9Cc4cE5596924745e12B93', 6, 'tether')] },
    { key: 'scroll', name: 'Scroll', rpcs: ['https://scroll-rpc.publicnode.com', 'https://scroll.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://scrollscan.com/address/',
      tokens: [t('USDC', '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', 6, 'usd-coin'), t('USDT', '0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df', 6, 'tether')] },
    { key: 'gnosis', name: 'Gnosis', rpcs: ['https://gnosis-rpc.publicnode.com', 'https://gnosis.drpc.org'], symbol: 'xDAI', price: 'xdai', explorer: 'https://gnosisscan.io/address/',
      tokens: [t('USDC', '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', 6, 'usd-coin'), t('USDC.e', '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0', 6, 'usd-coin'), t('USDT', '0x4ECaBa5870353805a9F068101A40E0f32ed605C6', 6, 'tether')] },
    { key: 'blast', name: 'Blast', rpcs: ['https://blast-rpc.publicnode.com', 'https://blast.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://blastscan.io/address/',
      tokens: [t('USDB', '0x4300000000000000000000000000000000000003', 18, 'usdb')] },
    { key: 'zksync', name: 'zkSync Era', rpcs: ['https://mainnet.era.zksync.io', 'https://zksync.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://explorer.zksync.io/address/',
      tokens: [t('USDC', '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4', 6, 'usd-coin'), t('USDT', '0x493257fD37EDB34451f62EDf8D2a0C418852bA4C', 6, 'tether'), t('USDC.e', '0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4', 6, 'usd-coin')] },
    { key: 'mantle', name: 'Mantle', rpcs: ['https://mantle-rpc.publicnode.com', 'https://rpc.mantle.xyz'], symbol: 'MNT', price: 'mantle', explorer: 'https://mantlescan.xyz/address/',
      tokens: [t('USDC', '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9', 6, 'usd-coin'), t('USDT', '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE', 6, 'tether'), t('USDT0', '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', 6, 'usdt0')] },
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
      tokens: [t('USDC', '0x078D782b760474a361dDA0AF3839290b0EF57AD6', 6, 'usd-coin'), t('USDT0', '0x9151434b16b9763660705744891fA906F660EcC5', 6, 'usdt0')] },
    { key: 'zkevm', name: 'Polygon zkEVM', rpcs: ['https://zkevm-rpc.com', 'https://polygon-zkevm.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://zkevm.polygonscan.com/address/',
      tokens: [t('USDC', '0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035', 6, 'usd-coin'), t('USDT', '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', 6, 'tether')] },
    { key: 'world', name: 'World Chain', rpcs: ['https://worldchain-mainnet.g.alchemy.com/public', 'https://worldchain.drpc.org'], symbol: 'ETH', price: 'ethereum', explorer: 'https://worldscan.org/address/',
      tokens: [t('USDC', '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', 6, 'usd-coin')] },
    { key: 'hyperevm', name: 'HyperEVM', rpcs: ['https://rpc.hyperliquid.xyz/evm', 'https://hyperliquid-rpc.publicnode.com'], symbol: 'HYPE', price: 'hyperliquid', explorer: 'https://hyperevmscan.io/address/',
      tokens: [t('USDT0', '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', 6, 'usdt0')] },
    // ---- added 2026-10-24: every EVM network since 2015 with a browser-reachable public RPC ----
    // Ethereum forks: anything on the ETH address before the fork exists here too.
    ev('etc', 'Ethereum Classic (2016 fork)', ['https://etc.drpc.org', 'https://etc.etcdesktop.com'], 'ETC', 'ethereum-classic', 'https://etc.blockscout.com/address/'),
    ev('ethw', 'EthereumPoW (2022 fork)', ['https://mainnet.ethereumpow.org'], 'ETHW', 'ethereum-pow-iou', 'https://www.oklink.com/ethw/address/'),
    ev('pls', 'PulseChain (2023 fork)', ['https://pulsechain-rpc.publicnode.com', 'https://rpc.pulsechain.com', 'https://rpc-pulsechain.g4mm4.io'], 'PLS', 'pulsechain', 'https://otter.pulsechain.com/address/'),
    ev('nova', 'Arbitrum Nova', ['https://arbitrum-nova-rpc.publicnode.com', 'https://nova.arbitrum.io/rpc', 'https://arbitrum-nova.drpc.org'], 'ETH', 'ethereum', 'https://nova.arbiscan.io/address/',
      [t('USDC', '0x750ba8b76187092B0D1E87E28daaf484d1b5273b', 6, 'usd-coin')]),
    ev('one', 'Harmony', ['https://api.harmony.one', 'https://harmony-0.drpc.org', 'https://api.s0.t.hmny.io'], 'ONE', 'harmony', 'https://explorer.harmony.one/address/'),
    ev('aurora', 'Aurora', ['https://mainnet.aurora.dev', 'https://aurora.drpc.org'], 'ETH', 'ethereum', 'https://explorer.aurora.dev/address/',
      [t('USDC', '0x368EBb46ACa6b8D0787C96B2b20bD3CC3F2c45F7', 6, 'usd-coin'), t('USDC.e', '0xB12BFcA5A55806AaF64E99521918A4bf0fC40802', 6, 'usd-coin'), t('USDT.e', '0x4988a896b1227218e4A686fdE5EabdcAbd91571f', 6, 'tether')]),
    ev('kavaevm', 'Kava EVM', ['https://kava-evm-rpc.publicnode.com', 'https://evm.kava.io', 'https://kava.drpc.org'], 'KAVA', 'kava', 'https://kavascan.com/address/',
      [t('USDT', '0x919C1c267BC06a7039e03fcc2eF738525769109c', 6, 'tether'), t('USDC', '0xfA9343C3897324496A05fC75abeD6bAC29f8A40f', 6, 'usd-coin')]),
    ev('kaia', 'Kaia (Klaytn)', ['https://public-en.node.kaia.io'], 'KAIA', 'kaia', 'https://kaiascan.io/address/',
      [t('USDT', '0xd077a400968890eacc75cdc901f0356c943e4fdb', 6, 'tether'), t('USDC', '0x608792Deb376CCE1c9FA4D0E6B7b44f507CfFa6A', 6, 'usd-coin')]),
    ev('metis', 'Metis', ['https://metis-rpc.publicnode.com', 'https://andromeda.metis.io/?owner=1088', 'https://metis.drpc.org'], 'METIS', 'metis-token', 'https://andromeda-explorer.metis.io/address/',
      [t('m.USDC', '0xEA32A96608495e54156Ae48931A7c20f0dcc1a21', 6, 'usd-coin'), t('m.USDT', '0xbB06DCA3AE6887fAbF931640f67cab3e3a16F4dC', 6, 'tether')]),
    ev('boba', 'Boba', ['https://mainnet.boba.network', 'https://boba-eth.drpc.org'], 'ETH', 'ethereum', 'https://bobascan.com/address/'),
    ev('movr', 'Moonriver', ['https://moonriver.drpc.org'], 'MOVR', 'moonriver', 'https://moonriver.moonscan.io/address/'),
    ev('glmr', 'Moonbeam', ['https://moonbeam.drpc.org', 'https://1rpc.io/glmr', 'https://moonbeam.api.onfinality.io/public'], 'GLMR', 'moonbeam', 'https://moonscan.io/address/',
      [t('USDC', '0x931715FEE2d06333043d11F658C8CE934aC61D0c', 6, 'usd-coin'), t('xcUSDT', '0xFFFFFFfFea09FB06d082fd1275CD48b191cbCD1d', 6, 'tether'), t('xcUSDC', '0xFFfffffF7D2B0B761Af01Ca8e25242976ac0aD7D', 6, 'usd-coin')]),
    ev('astr', 'Astar', ['https://evm.astar.network', 'https://astar.drpc.org'], 'ASTR', 'astar', 'https://astar.blockscout.com/address/',
      [t('USDC', '0x6a2d262D56735DbA19Dd70682B39F6bE9a931D98', 6, 'usd-coin'), t('USDT', '0x3795C36e7D12A8c252A20C5a7B455f7c57b60283', 6, 'tether')]),
    ev('tlos', 'Telos EVM', ['https://rpc.telos.net', 'https://telos.drpc.org'], 'TLOS', 'telos', 'https://teloscan.io/address/',
      [t('USDC.e', '0xF1815bd50389c46847f0Bda824eC8da914045D14', 6, 'usd-coin'), t('USDT', '0x674843C06FF83502ddb4D37c2E09C01cdA38cbc8', 6, 'tether')]),
    ev('iotx', 'IoTeX', ['https://babel-api.mainnet.iotex.io', 'https://iotex-network.rpc.thirdweb.com'], 'IOTX', 'iotex', 'https://iotexscan.io/address/',
      [t('ioUSDC', '0x3B2bf2b523f54C4E454F08Aa286D03115aFF326c', 6, 'usd-coin'), t('ioUSDT', '0x6fbCdc1169B5130C59E72E51Ed68A84841C98cd1', 6, 'tether')]),
    ev('sapphire', 'Oasis Sapphire', ['https://sapphire.oasis.io'], 'ROSE', 'oasis-network', 'https://explorer.oasis.io/mainnet/sapphire/address/'),
    ev('emerald', 'Oasis Emerald', ['https://emerald.oasis.io', 'https://emerald.oasis.dev'], 'ROSE', 'oasis-network', 'https://explorer.oasis.io/mainnet/emerald/address/'),
    ev('core', 'Core', ['https://rpc.coredao.org', 'https://core.drpc.org'], 'CORE', 'coredaoorg', 'https://scan.coredao.org/address/',
      [t('USDT', '0x900101d06A7426441Ae63e9AB3B9b0F63Be145F1', 6, 'tether'), t('USDC', '0xa4151B2B3e269645181dCcF2D426cE75fcbDeca9', 6, 'usd-coin')]),
    ev('cfx', 'Conflux eSpace', ['https://evm.confluxrpc.com'], 'CFX', 'conflux-token', 'https://evm.confluxscan.org/address/',
      [t('USDT', '0xfe97E85d13ABD9c1c33384E796F10B73905637cE', 18, 'tether'), t('USDC', '0x6963EfED0aB40F6C3d7BdA44A05dcf1437C44372', 18, 'usd-coin')]),
    ev('manta', 'Manta Pacific', ['https://pacific-rpc.manta.network/http', 'https://manta-pacific.drpc.org'], 'ETH', 'ethereum', 'https://pacific-explorer.manta.network/address/'),
    ev('mode', 'Mode', ['https://mainnet.mode.network'], 'ETH', 'ethereum', 'https://explorer.mode.network/address/',
      [t('USDC', '0xd988097fb8612cc24eeC14542bC03424c656005f', 6, 'usd-coin'), t('USDT', '0xf0F161fDA2712DB8b566946122a5af183995e2eD', 6, 'tether')]),
    ev('taiko', 'Taiko', ['https://taiko-rpc.publicnode.com', 'https://rpc.mainnet.taiko.xyz', 'https://taiko.drpc.org'], 'ETH', 'ethereum', 'https://taikoscan.io/address/',
      [t('USDC', '0x07d83526730c7438048D55A4fc0b850e2aaB6f0b', 6, 'usd-coin'), t('USDT', '0x2DEF195713CF4a606B49D07E520e22C17899a736', 6, 'tether')]),
    ev('zora', 'Zora', ['https://rpc.zora.energy', 'https://zora.drpc.org'], 'ETH', 'ethereum', 'https://explorer.zora.energy/address/'),
    ev('fraxtal', 'Fraxtal', ['https://fraxtal-rpc.publicnode.com', 'https://rpc.frax.com', 'https://fraxtal.drpc.org'], 'FRAX', 'frax-share', 'https://fraxscan.com/address/'),
    ev('ron', 'Ronin', ['https://api.roninchain.com/rpc', 'https://ronin.drpc.org'], 'RON', 'ronin', 'https://app.roninchain.com/address/',
      [t('USDC', '0x0B7007c13325C48911F73A2daD5FA5dCBf808aDc', 6, 'usd-coin')]),
    ev('flr', 'Flare', ['https://flare-api.flare.network/ext/C/rpc', 'https://flare.drpc.org', 'https://flare.rpc.thirdweb.com'], 'FLR', 'flare-networks', 'https://flare-explorer.flare.network/address/',
      [t('USDT0', '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', 6, 'usdt0'), t('USDC.e', '0xFbDa5F676cB37624f28265A144A48B0d6e87d3b6', 6, 'usd-coin')]),
    ev('sgb', 'Songbird', ['https://songbird-api.flare.network/ext/C/rpc'], 'SGB', 'songbird', 'https://songbird-explorer.flare.network/address/'),
    ev('rbtc', 'Rootstock', ['https://public-node.rsk.co', 'https://mycrypto.rsk.co'], 'RBTC', 'rootstock', 'https://explorer.rootstock.io/address/',
      [t('USDT0', '0x779Ded0c9e1022225f8E0630b35a9b54bE713736', 6, 'usdt0'), t('rUSDT', '0xef213441a85df4d7acbdae0cf78004e1e486bb96', 18, 'tether')]),
    ev('merlin', 'Merlin', ['https://rpc.merlinchain.io', 'https://merlin.drpc.org'], 'BTC', 'bitcoin', 'https://scan.merlinchain.io/address/'),
    ev('bitlayer', 'Bitlayer', ['https://rpc.bitlayer.org'], 'BTC', 'bitcoin', 'https://www.btrscan.com/address/'),
    ev('bob', 'BOB', ['https://rpc.gobob.xyz', 'https://bob.drpc.org'], 'ETH', 'ethereum', 'https://explorer.gobob.xyz/address/',
      [t('USDC.e', '0xe75D0fB2C24A55cA1e3F96781a2bCC7bdba058F0', 6, 'usd-coin'), t('USDT', '0x05D032ac25d322df992303dCa074EE7392C117b9', 6, 'tether')]),
    ev('abs', 'Abstract', ['https://api.mainnet.abs.xyz', 'https://abstract.drpc.org'], 'ETH', 'ethereum', 'https://abscan.org/address/',
      [t('USDC.e', '0x84A71ccD554Cc1b02749b35d22F684CC8ec987e1', 6, 'usd-coin'), t('USDT', '0x0709F39376dEEe2A2dfC94A58EdEb2Eb9DF012bD', 6, 'tether')]),
    ev('ink', 'Ink', ['https://rpc-gel.inkonchain.com', 'https://rpc-qnd.inkonchain.com', 'https://ink.drpc.org'], 'ETH', 'ethereum', 'https://explorer.inkonchain.com/address/',
      [t('USDC.e', '0xF1815bd50389c46847f0Bda824eC8da914045D14', 6, 'usd-coin'), t('USDT0', '0x0200C29006150606B650577BBE7B6248F58470c1', 6, 'usdt0')]),
    ev('soneium', 'Soneium', ['https://rpc.soneium.org', 'https://soneium.drpc.org'], 'ETH', 'ethereum', 'https://soneium.blockscout.com/address/',
      [t('USDC.e', '0xbA9986D2381edf1DA03B0B9c1f8b00dc4AacC369', 6, 'usd-coin'), t('USDT', '0x3A337a6adA9d885b6Ad95ec48F9b75f197b5AE35', 6, 'tether')]),
    ev('lisk', 'Lisk', ['https://rpc.api.lisk.com', 'https://lisk.drpc.org'], 'ETH', 'ethereum', 'https://blockscout.lisk.com/address/',
      [t('USDT', '0x05D032ac25d322df992303dCa074EE7392C117b9', 6, 'tether'), t('USDC.e', '0xF242275d3a6527d877f2c927a82D9b057609cc71', 6, 'usd-coin')]),
    ev('seievm', 'Sei EVM', ['https://sei-evm-rpc.publicnode.com', 'https://evm-rpc.sei-apis.com'], 'SEI', 'sei-network', 'https://seitrace.com/address/',
      [t('USDC', '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392', 6, 'usd-coin'), t('USDT0', '0x9151434b16b9763660705744891fA906F660EcC5', 6, 'usdt0'), t('USDC.n', '0x3894085Ef7Ff0f0aeDf52E2A2704928d1Ec074F1', 6, 'usd-coin')]),
    ev('ape', 'ApeChain', ['https://rpc.apechain.com', 'https://apechain.drpc.org'], 'APE', 'apecoin', 'https://apescan.io/address/'),
    ev('story', 'Story', ['https://mainnet.storyrpc.io'], 'IP', 'story-2', 'https://www.storyscan.io/address/',
      [t('USDC.e', '0xF1815bd50389c46847f0Bda824eC8da914045D14', 6, 'usd-coin')]),
    ev('chz', 'Chiliz', ['https://chiliz-rpc.publicnode.com', 'https://rpc.chiliz.com'], 'CHZ', 'chiliz', 'https://chiliscan.com/address/'),
    ev('zircuit', 'Zircuit', ['https://mainnet.zircuit.com'], 'ETH', 'ethereum', 'https://explorer.zircuit.com/address/',
      [t('USDC.e', '0x3b952c8C9C44e8Fe201e2b26F6B2200203214cfF', 6, 'usd-coin'), t('USDT', '0x46dDa6a5a559d861c06EC9a95Fb395f5C3Db0742', 6, 'tether')]),
    ev('gravity', 'Gravity', ['https://rpc.gravity.xyz'], 'G', 'g-token', 'https://explorer.gravity.xyz/address/',
      [t('USDC.e', '0xFbDa5F676cB37624f28265A144A48B0d6e87d3b6', 6, 'usd-coin'), t('USDT', '0x816E810f9F787d669FB71932DeabF6c83781Cd48', 6, 'tether')]),
    ev('morph', 'Morph', ['https://rpc.morphl2.io', 'https://rpc-quicknode.morphl2.io'], 'ETH', 'ethereum', 'https://explorer.morphl2.io/address/',
      [t('USDC', '0xe34c91815d7fc18A9e2148bcD4241d0a5848b693', 6, 'usd-coin'), t('USDT', '0xc7D67A9cBB121b3b0b9c053DD9f469523243379A', 6, 'tether')]),
    ev('lens', 'Lens', ['https://rpc.lens.xyz', 'https://api.lens.matterhosted.dev'], 'GHO', 'gho', 'https://explorer.lens.xyz/address/'),
    ev('plume', 'Plume', ['https://rpc.plume.org'], 'PLUME', 'plume', 'https://explorer.plume.org/address/',
      [t('USDC.e', '0x78adD880A697070c1e765Ac44D65323a0DcCE913', 6, 'usd-coin')]),
    ev('hemi', 'Hemi', ['https://rpc.hemi.network/rpc', 'https://hemi.drpc.org'], 'ETH', 'ethereum', 'https://explorer.hemi.xyz/address/',
      [t('USDC.e', '0xad11a8BEb98bbf61dbb1aa0F6d6F2ECD87b35afA', 6, 'usd-coin'), t('USDT', '0xbB0D083fb1be0A9f6157ec484b6C79E0A4e31C2e', 6, 'tether')]),
    ev('monad', 'Monad', ['https://rpc.monad.xyz', 'https://monad-mainnet.drpc.org', 'https://rpc1.monad.xyz'], 'MON', 'monad', 'https://monadscan.com/address/',
      [t('USDC', '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', 6, 'usd-coin'), t('USDT0', '0xe7cd86e13AC4309349F30B3435a9d337750fC82D', 6, 'usdt0')]),
    ev('katana', 'Katana', ['https://rpc.katana.network', 'https://katana.drpc.org'], 'ETH', 'ethereum', 'https://katanascan.com/address/',
      [t('vbUSDC', '0x203A662b0BD271A6ed5a60EdFbd04bFce608FD36', 6, 'usd-coin'), t('vbUSDT', '0x2DCa96907fde857dd3D816880A0df407eeB2D2F2', 6, 'tether')]),
    ev('etherlink', 'Etherlink', ['https://node.mainnet.etherlink.com', 'https://etherlink.drpc.org'], 'XTZ', 'tezos', 'https://explorer.etherlink.com/address/',
      [t('USDC', '0x796Ea11Fa2dD751eD01b53C372fFDB4AAa8f00F9', 6, 'usd-coin'), t('USDT', '0x2C03058C8AFC06713be23e58D2febC8337dbfE6A', 6, 'tether')]),
    ev('shape', 'Shape', ['https://mainnet.shape.network', 'https://shape-mainnet.g.alchemy.com/public'], 'ETH', 'ethereum', 'https://shapescan.xyz/address/'),
    ev('xlayer', 'X Layer', ['https://xlayer.drpc.org', 'https://rpc.xlayer.tech', 'https://xlayerrpc.okx.com'], 'OKB', 'okb', 'https://www.oklink.com/xlayer/address/',
      [t('USDT', '0x1E4a5963aBFD975d8c9021ce480b42188849D41d', 6, 'tether'), t('USDC', '0x74b7F16337b8972027F6196A17a631aC6dE26d22', 6, 'usd-coin')]),
    ev('fuse', 'Fuse', ['https://rpc.fuse.io', 'https://fuse.drpc.org'], 'FUSE', 'fuse-network-token', 'https://explorer.fuse.io/address/',
      [t('USDC', '0x28C3d1cD466Ba22f6cae51b1a4692a831696391A', 6, 'usd-coin'), t('USDT', '0x68c9736781E9316ebf5c3d49FE0C1f45D2D104Cd', 6, 'tether')]),
    ev('fil', 'Filecoin EVM', ['https://api.node.glif.io/rpc/v1', 'https://filecoin.drpc.org'], 'FIL', 'filecoin', 'https://filfox.info/en/address/'),
    ev('sys', 'Syscoin NEVM', ['https://rpc.syscoin.org', 'https://syscoin-evm.publicnode.com'], 'SYS', 'syscoin', 'https://explorer.syscoin.org/address/'),
    ev('kcc', 'KCC', ['https://rpc-mainnet.kcc.network', 'https://kcc-rpc.com'], 'KCS', 'kucoin-shares', 'https://scan.kcc.io/address/'),
    ev('theta', 'Theta', ['https://eth-rpc-api.thetatoken.org/rpc'], 'TFUEL', 'theta-fuel', 'https://explorer.thetatoken.org/account/'),
    ev('sophon', 'Sophon', ['https://rpc.sophon.xyz'], 'SOPH', 'sophon', 'https://sophscan.xyz/address/'),
    ev('plasma', 'Plasma', ['https://rpc.plasma.to', 'https://plasma.drpc.org'], 'XPL', 'plasma', 'https://plasmascan.to/address/',
      [t('USDT0', '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', 6, 'usdt0')]),
    ev('megaeth', 'MegaETH', ['https://mainnet.megaeth.com/rpc', 'https://megaeth.drpc.org'], 'ETH', 'ethereum', 'https://megaeth.blockscout.com/address/'),
    ev('hood', 'Robinhood Chain', ['https://rpc.mainnet.chain.robinhood.com', 'https://robinhood-rpc.publicnode.com', 'https://robinhood.drpc.org'], 'ETH', 'ethereum', 'https://robinhoodchain.blockscout.com/address/'),
    ev('xdc', 'XDC Network', ['https://erpc.xdcrpc.com', 'https://rpc.xdcrpc.com', 'https://rpc.ankr.com/xdc'], 'XDC', 'xdce-crowd-sale', 'https://xdcscan.com/address/'),
    ev('og', '0G', ['https://evmrpc.0g.ai'], '0G', 'zero-gravity', 'https://chainscan.0g.ai/address/'),
    ev('citrea', 'Citrea', ['https://rpc.mainnet.citrea.xyz'], 'cBTC', 'bitcoin', 'https://explorer.mainnet.citrea.xyz/address/'),
    ev('b2', 'B² Network', ['https://rpc.bsquared.network', 'https://b2.drpc.org', 'https://b2-mainnet.alt.technology'], 'BTC', 'bitcoin', 'https://explorer.bsquared.network/address/'),
    ev('wemix', 'WEMIX', ['https://api.wemix.com', 'https://wemix.drpc.org'], 'WEMIX', 'wemix-token', 'https://explorer.wemix.com/address/'),
    ev('kite', 'Kite AI', ['https://rpc.gokite.ai', 'https://kite.drpc.org'], 'KITE', 'kite', 'https://kitescan.ai/address/'),
    ev('dbk', 'DBK Chain', ['https://rpc.mainnet.dbkchain.io'], 'ETH', 'ethereum', 'https://scan.dbkchain.io/address/'),
    ev('cyber', 'Cyber', ['https://rpc.cyber.co', 'https://cyber.alt.technology'], 'ETH', 'ethereum', 'https://cyberscan.co/address/'),
    ev('vana', 'Vana', ['https://rpc.vana.org'], 'VANA', 'vana', 'https://vanascan.io/address/'),
    ev('imx', 'Immutable zkEVM', ['https://rpc.immutable.com'], 'IMX', 'immutable-x', 'https://explorer.immutable.com/address/',
      [t('USDC', '0x6de8aCC0D406837030CE4dd28e7c08C5a96a30d2', 6, 'usd-coin'), t('USDT', '0x68bcc7F1190AF20e7b572BCFb431c3Ac10A936Ab', 6, 'tether')]),
    ev('vic', 'Viction (TomoChain)', ['https://rpc.viction.xyz', 'https://viction.drpc.org'], 'VIC', 'tomochain', 'https://vicscan.xyz/address/',
      [t('USDT', '0x381B31409e4D220919B2cFF012ED94d70135A59e', 6, 'tether')]),
    ev('vlx', 'Velas', ['https://evmexplorer.velas.com/rpc', 'https://mainnet.velas.com/rpc'], 'VLX', 'velas', 'https://evmexplorer.velas.com/address/'),
    ev('wan', 'Wanchain', ['https://gwan-ssl.wandevs.org:56891'], 'WAN', 'wanchain', 'https://www.wanscan.org/address/'),
    ev('nrg', 'Energi', ['https://nodeapi.energi.network'], 'NRG', 'energi', 'https://explorer.energi.network/address/'),
    ev('okt', 'OKT Chain', ['https://exchainrpc.okex.org'], 'OKT', 'oec-token', 'https://www.oklink.com/oktc/address/'),
  ];
  function ev(key, name, rpcs, symbol, price, explorer, tokens) { return { key, name, rpcs, symbol, price, explorer, tokens: tokens || [] }; }
  function t(symbol, addr, dec, price) { return { symbol, addr, dec, price }; }

  // Cosmos chains on the m/44'/118' key. stables: denoms that count like a stablecoin,
  // native USDC on Noble and Axelar, Noble USDC carried over IBC elsewhere. Each IBC hash
  // was resolved through the chain's own denom trace endpoint.
  const USDC = ['USDC', 6, 'usd-coin'], AXLUSDC = ['axlUSDC', 6, 'usd-coin'];
  const COSMOS = [
    { key: 'atom', name: 'Cosmos Hub', rest: 'https://rest.cosmos.directory/cosmoshub', rest2: 'https://cosmos-rest.publicnode.com', denom: 'uatom', dec: 6, symbol: 'ATOM', price: 'cosmos', explorer: 'https://www.mintscan.io/cosmos/address/',
      stables: { 'ibc/F663521BF1836B00F5F177680F74BFB9A8B5654A694D0D2BC249E03CF2509013': USDC } },
    { key: 'osmo', name: 'Osmosis', rest: 'https://rest.cosmos.directory/osmosis', rest2: 'https://osmosis-rest.publicnode.com', denom: 'uosmo', dec: 6, symbol: 'OSMO', price: 'osmosis', explorer: 'https://www.mintscan.io/osmosis/address/',
      stables: { 'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4': USDC, 'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858': AXLUSDC } },
    { key: 'tia', name: 'Celestia', rest: 'https://rest.cosmos.directory/celestia', rest2: 'https://celestia-rest.publicnode.com', denom: 'utia', dec: 6, symbol: 'TIA', price: 'celestia', explorer: 'https://www.mintscan.io/celestia/address/' },
    { key: 'dydx', name: 'dYdX', rest: 'https://rest.cosmos.directory/dydx', rest2: 'https://dydx-rest.publicnode.com', denom: 'adydx', dec: 18, symbol: 'DYDX', price: 'dydx-chain', explorer: 'https://www.mintscan.io/dydx/address/',
      stables: { 'ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5': USDC } },
    { key: 'sei', name: 'Sei', rest: 'https://rest.cosmos.directory/sei', rest2: 'https://sei-rest.publicnode.com', denom: 'usei', dec: 6, symbol: 'SEI', price: 'sei-network', explorer: 'https://www.mintscan.io/sei/address/' },
    { key: 'akt', name: 'Akash', rest: 'https://rest.cosmos.directory/akash', rest2: 'https://akash-rest.publicnode.com', denom: 'uakt', dec: 6, symbol: 'AKT', price: 'akash-network', explorer: 'https://www.mintscan.io/akash/address/' },
    { key: 'juno', name: 'Juno', rest: 'https://rest.cosmos.directory/juno', rest2: 'https://juno-rest.publicnode.com', denom: 'ujuno', dec: 6, symbol: 'JUNO', price: 'juno-network', explorer: 'https://www.mintscan.io/juno/address/' },
    // No Stargaze REST endpoint sends CORS headers (checked every one in the chain registry), so a browser cannot ask.
    { key: 'stars', name: 'Stargaze', rest: 'https://rest.stargaze-apis.com', denom: 'ustars', dec: 6, symbol: 'STARS', price: 'stargaze', explorer: 'https://www.mintscan.io/stargaze/address/', unavailable: 'No Stargaze server lets a browser ask; tap the explorer link instead' },
    { key: 'noble', name: 'Noble', rest: 'https://rest.cosmos.directory/noble', denom: 'uusdc', dec: 6, symbol: 'USDC', price: 'usd-coin', explorer: 'https://www.mintscan.io/noble/address/' },
    { key: 'ntrn', name: 'Neutron', rest: 'https://rest.cosmos.directory/neutron', denom: 'untrn', dec: 6, symbol: 'NTRN', price: 'neutron-3', explorer: 'https://www.mintscan.io/neutron/address/',
      stables: { 'ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81': USDC } },
    { key: 'strd', name: 'Stride', rest: 'https://rest.cosmos.directory/stride', denom: 'ustrd', dec: 6, symbol: 'STRD', price: 'stride', explorer: 'https://www.mintscan.io/stride/address/' },
    { key: 'axl', name: 'Axelar', rest: 'https://rest.cosmos.directory/axelar', denom: 'uaxl', dec: 6, symbol: 'AXL', price: 'axelar', explorer: 'https://www.mintscan.io/axelar/address/',
      stables: { uusdc: AXLUSDC } },
    // ---- added 2026-10-24 from the chain registry: every ATOM-key (slip44 118) chain whose
    // REST answers a browser and whose coin has a market price. dec = the display exponent.
    cz('atone', 'AtomOne', 'atomone', 'uatone', 6, 'ATONE', 'atomone', 'https://ping.pub/atomone/account/', 'https://atomone-rest.publicnode.com'),
    cz('bbn', 'Babylon', 'babylon', 'ubbn', 6, 'BABY', 'babylon', 'https://www.mintscan.io/babylon/address/', 'https://babylon-rest.publicnode.com'),
    cz('cheqd', 'cheqd', 'cheqd', 'ncheq', 9, 'CHEQ', 'cheqd-network', 'https://explorer.cheqd.io/accounts/', 'https://cheqd-rest.publicnode.com'),
    cz('huahua', 'Chihuahua', 'chihuahua', 'uhuahua', 6, 'HUAHUA', 'chihuahua-token', 'https://ping.pub/chihuahua/account/'),
    cz('fet', 'Fetch.ai', 'fetchhub', 'afet', 18, 'FET', 'fetch-ai', 'https://www.mintscan.io/fetchai/address/'),
    cz('grav', 'Gravity Bridge', 'gravitybridge', 'ugraviton', 6, 'GRAV', 'graviton', 'https://www.mintscan.io/gravity-bridge/address/'),
    cz('jkl', 'Jackal', 'jackal', 'ujkl', 6, 'JKL', 'jackal-protocol', 'https://ping.pub/jackal/account/'),
    cz('kyve', 'KYVE', 'kyve', 'ukyve', 6, 'KYVE', 'kyve-network', 'https://www.mintscan.io/kyve/address/'),
    cz('nibi', 'Nibiru', 'nibiru', 'unibi', 6, 'NIBI', 'nibiru', 'https://ping.pub/nibiru/account/'),
    cz('nls', 'Nolus', 'nolus', 'unls', 6, 'NLS', 'nolus', 'https://ping.pub/nolus/account/'),
    cz('orai', 'Oraichain', 'oraichain', 'orai', 6, 'ORAI', 'oraichain-token', 'https://scan.orai.io/account/', 'https://oraichain-rest.publicnode.com'),
    cz('pasg', 'Passage', 'passage', 'upasg', 6, 'PASG', 'passage', 'https://www.mintscan.io/passage/address/'),
    cz('xprt', 'Persistence', 'persistence', 'uxprt', 6, 'XPRT', 'persistence', 'https://www.mintscan.io/persistence/address/'),
    cz('regen', 'Regen', 'regen', 'uregen', 6, 'REGEN', 'regen', 'https://ping.pub/regen/account/'),
    cz('saga', 'Saga', 'saga', 'usaga', 6, 'SAGA', 'saga-2', 'https://www.mintscan.io/saga/address/', 'https://saga-rest.publicnode.com'),
    cz('seda', 'SEDA', 'seda', 'aseda', 18, 'SEDA', 'seda-2', 'https://explorer.seda.xyz/account/'),
    cz('dvpn', 'Sentinel', 'sentinel', 'udvpn', 6, 'P2P', 'sentinel', 'https://explorer.sentinel.co/accounts/', 'https://sentinel-rest.publicnode.com'),
    cz('ctk', 'Shentu', 'shentu', 'uctk', 6, 'CTK', 'certik', 'https://ping.pub/shentu/account/'),
    cz('somm', 'Sommelier', 'sommelier', 'usomm', 6, 'SOMM', 'sommelier', 'https://www.mintscan.io/sommelier/address/'),
    cz('union', 'Union', 'union', 'au', 18, 'U', 'union-2', 'https://explorer.union.build/union/account/'),
    cz('ward', 'Warden', 'wardenprotocol', 'award', 18, 'WARD', 'warden-2', 'https://explorer.wardenprotocol.org/address/'),
    cz('xion', 'XION', 'xion', 'uxion', 6, 'XION', 'xion-2', 'https://www.mintscan.io/xion/address/'),
    cz('arch', 'Archway', 'archway', 'aarch', 18, 'ARCH', 'archway', 'https://ping.pub/archway/account/'),
    cz('aura', 'Aura', 'aura', 'uaura', 6, 'AURA', 'aura-network', 'https://aurascan.io/address/'),
    cz('lore', 'Gitopia', 'gitopia', 'ulore', 6, 'LORE', 'gitopia', 'https://ping.pub/gitopia/account/'),
    cz('pokt', 'Pocket Network', 'pocket', 'upokt', 6, 'POKT', 'pocket-network', 'https://shannon.pokt.network/poktroll/account/'),
    // ETH-key (slip44 60) Cosmos chains: the same 20-byte hash as the EVM address, their own prefix.
    cz('dym', 'Dymension', 'dymension', 'adym', 18, 'DYM', 'dymension', 'https://www.mintscan.io/dymension/address/', null, true),
    cz('islm', 'HAQQ', 'haqq', 'aISLM', 18, 'ISLM', 'islamic-coin', 'https://ping.pub/haqq/account/', 'https://haqq-rest.publicnode.com', true),
    cz('xpla', 'XPLA', 'xpla', 'axpla', 18, 'XPLA', 'xpla', 'https://ping.pub/xpla/account/', 'https://xpla-rest.publicnode.com', true),
    cz('zeta', 'ZetaChain', 'zetachain', 'azeta', 18, 'ZETA', 'zetachain', 'https://ping.pub/zetachain/account/', null, true),
    cz('om', 'MANTRA', 'mantrachain', 'amantra', 18, 'MANTRA', 'mantra', 'https://www.mintscan.io/mantra/address/', null, true),
    cz('aioz', 'AIOZ Network', 'aioz', 'attoaioz', 18, 'AIOZ', 'aioz-network', 'https://explorer.aioz.network/address/', null, true),
    cz('heart', 'Humans.ai', 'humans', 'aheart', 18, 'HEART', 'humans-ai', 'https://ping.pub/humans/account/', null, true),
    cz('rio', 'Realio', 'realio', 'ario', 18, 'RIO', 'realio-network', 'https://ping.pub/realio/account/', null, true),
    cz('shido', 'Shido', 'shido', 'shido', 18, 'SHIDO', 'shido-2', 'https://shidoscan.com/address/', null, true),
  ];
  function cz(key, name, chain, denom, dec, symbol, price, explorer, rest2, eth) {
    return { key, name, rest: 'https://rest.cosmos.directory/' + chain, rest2: rest2 || null, denom, dec, symbol, price, explorer, eth: !!eth };
  }
  const INJ = { name: 'Injective', rest: 'https://rest.cosmos.directory/injective', denom: 'inj', dec: 18, symbol: 'INJ', price: 'injective-protocol', explorer: 'https://www.mintscan.io/injective/address/',
    stables: { 'ibc/2CBC2EA121AE42563B08028466F37B600F2D7D4282342DE938283CC3FB2BC00E': USDC } };

  // api.mainnet-beta.solana.com refuses browser origins (403), so it is not on this list.
  const SOL_STAKE_RPCS = ['https://public.rpc.solanavibestation.com'];   // the one public RPC that answers a stake-account search
  const SOL_RPCS = ['https://solana-rpc.publicnode.com', 'https://solana.leorpc.com/?api_key=FREE', 'https://rpc.solanatracker.io/public', 'https://public.rpc.solanavibestation.com'];
  const TRX_STABLES = { TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: ['USDT', 'tether', 6], TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: ['USDC', 'usd-coin', 6] };
  // Fallbacks for the single-source chains (each checked for browser CORS).
  const BTC_APIS = ['https://mempool.space/api/address/', 'https://blockstream.info/api/address/'];
  const XRP_RPCS = ['https://xrplcluster.com/', 'https://xrpl.ws/'];
  const XRP_STABLES = { 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De 524C555344000000000000000000000000000000': ['RLUSD', 'ripple-usd'], 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE 5553444300000000000000000000000000000000': ['USDC', 'usd-coin'] };
  const APT_APIS = ['https://fullnode.mainnet.aptoslabs.com/v1', 'https://api.mainnet.aptoslabs.com/v1', 'https://aptos-rest.publicnode.com/v1'];
  const XAH_RPCS = ['https://xahau.network', 'https://xahau.org'];
  const ECLIPSE_RPC = 'https://mainnetbeta-rpc.eclipse.xyz';
  const MOVE_API = 'https://mainnet.movementnetwork.xyz/v1';
  // Hyperliquid's own ledger, same address as the EVM key. Spot coins priced by CoinGecko;
  // any other spot token counts at its USDC mark price when that pair trades HL_MIN_VOLUME a day.
  const HL_INFO = 'https://api.hyperliquid.xyz/info';
  const HL_COINS = { USDC: 'usd-coin', HYPE: 'hyperliquid', USDT0: 'usdt0', USDH: 'usdh-2' };   // usdh-2 is Native Markets' USDH on Hyperliquid
  const HL_MIN_VOLUME = 20000;

  // ---------------- fetch helpers ----------------
  // A scan fires well over a hundred requests at once, and several go to the same host
  // (rest.cosmos.directory serves every Cosmos chain). Public endpoints answer a burst
  // like that with 429s, so each host gets at most HOST_LIMIT requests in flight, and a
  // 429 or 5xx is retried twice with a short backoff before the next endpoint is tried.
  // Each request has one deadline that also covers time spent waiting for a slot, so a
  // hung host can't stack its timeouts wave after wave; the request fails on time and the
  // network's fallback endpoint gets its turn.
  const HOST_LIMIT = 6, SLOT_HOLD = 5000;
  const hostSlots = new Map();
  function timeoutError() { return new Error('timed out'); }
  async function withHost(url, deadline, fn) {
    const host = new URL(url).host;
    const q = hostSlots.get(host) || { busy: 0, wait: [] };
    hostSlots.set(host, q);
    if (q.busy >= HOST_LIMIT) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { const i = q.wait.indexOf(go); if (i >= 0) q.wait.splice(i, 1); reject(timeoutError()); }, Math.max(0, deadline - Date.now()));
        function go() { clearTimeout(timer); resolve(); }
        q.wait.push(go);
      });
    }
    // a request still running after SLOT_HOLD gives its slot up (and carries on): one hung chain
    // must not hold most of rest.cosmos.directory's slots while 45 others queue behind it
    q.busy++;
    let held = true;
    const release = () => { if (!held) return; held = false; q.busy--; const next = q.wait.shift(); if (next) next(); };
    const hold = setTimeout(release, SLOT_HOLD);
    try { return await fn(); } finally { clearTimeout(hold); release(); }
  }
  // A host that has let three requests in a row run 5 s or more into their timeout, and
  // answered none since, is taken as down: further requests to it fail at once, so a wallet
  // scan's next address goes straight to the fallback instead of waiting 15 s each time.
  // A server is its host plus the first part of the path: rest.cosmos.directory serves 46 chains,
  // and one hung chain must not take the other 45 down. Timeouts that land together (one
  // chain's three staking queries) count once.
  const silent = new Map();
  const notAnswering = (host) => { if ((silent.get(host) || {}).n >= 3) throw new Error('not answering'); };
  const timedOut = (host) => { const s = silent.get(host) || { n: 0, at: 0 }; if (Date.now() - s.at >= 1000) { s.n++; s.at = Date.now(); } silent.set(host, s); };
  async function fetchOnce(url, opts, timeoutMs, as) {
    const u0 = new URL(url), deadline = Date.now() + (timeoutMs || 15000), host = u0.host + '/' + u0.pathname.split('/')[1];
    for (let attempt = 0; ; attempt++) {
      notAnswering(host);
      if (Date.now() >= deadline) throw timeoutError();
      const res = await withHost(url, deadline, async () => {
        notAnswering(host);   // it may have been found down while this request queued
        const c = new AbortController();
        const timer = setTimeout(() => c.abort(), Math.max(1, deadline - Date.now()));
        const t0 = Date.now();
        try {
          let r;
          try { r = await fetch(url, Object.assign({}, opts, { signal: c.signal })); silent.delete(host); }
          catch (e) {
            if (e && e.name === 'AbortError') { if (Date.now() - t0 >= 5000) timedOut(host); throw timeoutError(); }
            // A 429/5xx without CORS headers reaches the page as a network error, not a
            // status (Haskoin's 503s do this), so a network error is retried like one.
            return { retry: 'network error' };
          }
          if (r.status === 429 || r.status >= 500) return { retry: r.status };
          if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
          try { return { body: as === 'bytes' ? new Uint8Array(await r.arrayBuffer()) : as === 'text' ? await r.text() : await r.json() }; }
          catch (e) { if (e && e.name === 'AbortError') throw timeoutError(); throw e; }
        } finally { clearTimeout(timer); }
      });
      if (!res.retry) return res.body;
      // a CORS-blocked 4xx also looks like a network error, so those get one retry, not two
      const maxAttempts = opts && opts.retry === false ? 0 : res.retry === 'network error' ? 1 : 2;   // retry: false, a server whose 429 means minutes
      if (attempt >= maxAttempts || Date.now() + 700 * (attempt + 1) >= deadline) { const e = new Error(typeof res.retry === 'number' ? 'HTTP ' + res.retry : res.retry); if (typeof res.retry === 'number') e.status = res.retry; throw e; }
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  function fetchJSON(url, opts, timeoutMs) { return fetchOnce(url, opts, timeoutMs, 'json'); }
  const TOKENS = window.SeedTokens.make({ fetchJSON, rpc, firstOk, units, solRpcs: SOL_RPCS, solScanRpcs: SOL_STAKE_RPCS, ata: (o, m, p) => window.SolanaATA.associatedTokenAddress(o, m, p),
    pda: (seeds, p) => window.SolanaATA.findProgramAddress(seeds, p), b58decode: (x) => window.SolanaATA.b58decode(x), b58encode: (x) => window.SolanaATA.b58encode(x) });
  // Solana Vibe Station answers the account searches no other public RPC allows, and refuses
  // bursts: its requests leave 900 ms apart (measured: one a second is fine, three at once are not)
  let vibeNext = 0;
  async function rpc(url, method, params) {
    if (SOL_STAKE_RPCS.includes(url)) { const at = Math.max(Date.now(), vibeNext); vibeNext = at + 900; await new Promise((r) => setTimeout(r, at - Date.now())); }
    const j = await fetchJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result;
  }
  // The first source that answers, tried in order. One that has said nothing after HEDGE_MS
  // gets company from the next, so a server that is down (most fail by timing out, after 15 s)
  // does not hold the verdict up; whichever answers first wins.
  const HEDGE_MS = 4000;
  function firstOk(urls, fn) {
    return new Promise((resolve, reject) => {
      let next = 0, running = 0, done = false, last, timer = null;
      const start = () => {
        clearTimeout(timer);
        if (done || next >= urls.length) return;
        const u = urls[next++];
        running++;
        timer = setTimeout(start, HEDGE_MS);
        Promise.resolve().then(() => fn(u)).then((v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } }, (e) => {
          if (!(last && last.status && !e.status)) last = e;   // a server's own answer (a 404) says more than another's timeout
          running--;
          if (done) return;
          if (next < urls.length) start();
          else if (!running) { done = true; reject(last); }
        });
      };
      if (!urls.length) reject(new Error('no endpoint answered')); else start();
    });
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
  // Native coin from an RPC, then every token (tokens.js: explorer token lists, else the
  // network's biggest tokens by eth_call).
  async function checkEvm(c, addr, opts) {
    let url = c.rpcs[0];
    const bal = await firstOk(c.rpcs, async (u) => { const r = await rpc(u, 'eth_getBalance', [addr, 'latest']); url = u; return r; });
    let t;
    try { t = await TOKENS.evm(c, addr, url, opts); } catch (e) { t = { holdings: [], others: 0, partial: 'tokens not checked' }; }
    return { holdings: [h(c.symbol, units(bal, 18), c.price)].concat(t.holdings), others: t.others, partial: t.partial, note: t.note };
  }
  // A further account of the same seed (MetaMask's account 2, Ledger Live's account 2, ...),
  // checked on every EVM network once it shows any sign of use: a balance on MetaMask's
  // networks (one call) or a transaction on the ten biggest. An account that only ever
  // received coins on a smaller network, and nothing anywhere else, is missed.
  const BIG_EVM = ['eth', 'base', 'arb', 'op', 'polygon', 'bsc', 'avax', 'linea', 'zksync', 'scroll'];
  async function evmUsed(addr) {
    const ids = Object.values(window.SeedTokens.MM);
    // a MetaMask answer that is missing or leaves networks out is no proof of "unused" (a
    // receive-only account has no transactions anywhere), so it counts as used
    const mm = fetchJSON('https://accounts.api.cx.metamask.io/v4/multiaccount/balances?networks=' + ids.join(',') + '&accountAddresses=' + ids.map((i) => 'eip155:' + i + ':' + addr).join(','), undefined, 20000)
      .then((j) => !Array.isArray(j.balances) || (j.unprocessedNetworks || []).length > 0 || j.balances.some((b) => Number(b.balance) > 0), () => true);
    // a network whose transaction count could not be read is a gap, said under the row
    const missed = [];
    const sent = BIG_EVM.map((k) => EVM.find((c) => c.key === k)).map((c) => firstOk(c.rpcs, (u) => rpc(u, 'eth_getTransactionCount', [addr, 'latest']).then(hexCount))
      .then((n) => n > 0n, () => { missed.push(c.name); return false; }));
    const used = (await Promise.all([mm].concat(sent))).some(Boolean);
    return { used, missed };
  }
  const hexCount = (x) => { if (typeof x !== 'string' || !/^0x[0-9a-f]+$/i.test(x)) throw new Error('unexpected answer'); return BigInt(x); };
  async function checkEvmAccount(addr, knownUsed) {
    if (!knownUsed) {
      const u = await evmUsed(addr);
      if (!u.used) return { holdings: [h('ETH', 0, 'ethereum')], others: 0, partial: u.missed.length ? 'use not tested on ' + u.missed.join(', ') : null,
        note: 'never used: no transaction on the ' + (BIG_EVM.length - u.missed.length) + ' biggest networks that answered, nothing on MetaMask\'s' };
    }
    const rs = await Promise.allSettled(EVM.map((c) => checkEvm(c, addr, { extra: true })));
    const holdings = [], partly = [];
    let failed = 0, others = 0;
    rs.forEach((r, i) => {
      if (r.status !== 'fulfilled') { failed++; return; }
      for (const x of r.value.holdings) if (x.amount > 0) holdings.push(Object.assign({}, x, { symbol: x.symbol + ' on ' + EVM[i].name }));
      others += r.value.others || 0;
      if (r.value.partial) partly.push(EVM[i].name + ': ' + r.value.partial);
    });
    if (failed === EVM.length) throw new Error('no network answered');
    const gaps = [failed && failed + ' of ' + EVM.length + ' networks did not answer', partly.length && partly.length + ' only partly checked (' + partly.slice(0, 3).join('; ') + (partly.length > 3 ? '; ...' : '') + ')'].filter(Boolean);
    return { holdings: holdings.length ? holdings : [h('ETH', 0, 'ethereum')], others, partial: gaps.length ? gaps.join(', ') : null, note: 'all ' + EVM.length + ' EVM networks checked' };
  }
  // Many accounts at once (MetaMask's 6 to 30): which were ever used is found in about 13
  // requests, not 11 an account. Each of the ten biggest networks gets one JSON-RPC batch of
  // nonce and balance for every address; MetaMask's balances call takes 10 addresses at a time
  // (more make the URL too long). Only the used ones are then checked on every network.
  // dRPC's free tier takes batches of 3 at most (publicnode takes 50 and more), so its
  // batches go 3 calls at a time; every answer must be a hex number, as a count or balance is
  async function rpcBatch(url, calls) {
    const size = /drpc\.org/.test(url) ? 3 : calls.length;
    const out = [];
    for (let i = 0; i < calls.length; i += size) {
      const part = calls.slice(i, i + size);
      const j = await fetchJSON(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(part.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params }))) });
      const byId = new Map((Array.isArray(j) ? j : []).map((x) => [x.id, x.result]));
      // a server that refuses batches, or answers only some (mainnet.base.org), is no answer
      for (let k = 0; k < part.length; k++) out.push(hexCount(byId.get(k)));
    }
    return out;
  }
  async function checkEvmAccounts(accts) {
    const used = new Set(), gaps = [], mmGaps = [];
    let answered = 0;
    const ids = Object.values(window.SeedTokens.MM), parts = [];
    for (let i = 0; i < accts.length; i += 10) parts.push(accts.slice(i, i + 10));
    await Promise.all(BIG_EVM.map((k) => EVM.find((c) => c.key === k)).map((c) =>
      firstOk(c.rpcs, (u) => rpcBatch(u, accts.flatMap((a) => [['eth_getTransactionCount', [a.addr, 'latest']], ['eth_getBalance', [a.addr, 'latest']]])))
        .then((r) => { answered++; accts.forEach((a, i) => { if (r[2 * i] > 0n || r[2 * i + 1] > 0n) used.add(a); }); }, () => gaps.push(c.name)))
      .concat(parts.map(async (part) => {
        const which = 'accounts ' + part[0].n + '-' + part[part.length - 1].n;
        try {
          const j = await fetchJSON('https://accounts.api.cx.metamask.io/v4/multiaccount/balances?networks=' + ids.join(',') + '&accountAddresses=' + part.flatMap((a) => ids.map((n) => 'eip155:' + n + ':' + a.addr)).join(','), undefined, 20000);
          if (!Array.isArray(j.balances)) throw new Error('unexpected answer');
          answered++;
          for (const b of j.balances) if (Number(b.balance) > 0) { const a = part.find((x) => String(b.accountAddress || '').toLowerCase().endsWith(x.addr.toLowerCase())); if (a) used.add(a); }
          const left = (j.unprocessedNetworks || []).length;
          if (left) mmGaps.push('MetaMask\'s balances left out ' + left + ' network' + (left > 1 ? 's' : '') + ' for ' + which);
        } catch (e) { mmGaps.push('MetaMask\'s balances did not answer for ' + which); }
      })));
    if (!answered) throw new Error('no network answered');
    const list = accts.filter((a) => used.has(a));
    const holdings = [], partly = [];
    let others = 0;
    // a used account is checked like the first, four at a time (each is 97 networks)
    for (let i = 0; i < list.length; i += 4) {
      const rs = await Promise.allSettled(list.slice(i, i + 4).map((a) => checkEvmAccount(a.addr, true)));
      rs.forEach((r, k) => {
        const a = list[i + k];
        if (r.status !== 'fulfilled') { partly.push('account ' + a.n + ' did not answer'); return; }
        for (const x of r.value.holdings) if (x.amount > 0) holdings.push(Object.assign({}, x, { symbol: x.symbol + ', account ' + a.n }));
        others += r.value.others || 0;
        if (r.value.partial) partly.push('account ' + a.n + ': ' + r.value.partial);
      });
    }
    const not = gaps.length ? 'use not tested on ' + gaps.join(', ') : null;
    return { holdings: holdings.length ? holdings : [h('ETH', 0, 'ethereum')], others, partial: [not, ...mmGaps, ...partly].filter(Boolean).join('; ') || null,
      note: list.length ? 'used: account' + (list.length > 1 ? 's ' : ' ') + list.map((a) => a.n).join(', ') + '; each checked on all ' + EVM.length + ' EVM networks' : 'none of the ' + accts.length + ' ever used on the ' + BIG_EVM.length + ' biggest networks or MetaMask\'s' };
  }
  // Smart accounts this wallet owns on Ethereum hold their positions at their own address: an
  // Instadapp account (DSA; Instadapp's list links owners to accounts, the account's isAuth()
  // confirms) and a DSProxy (Maker, DeFi Saver, Summer.fi; the registry names it, its owner()
  // confirms). Each is checked like the wallet itself. A wallet whose Spark position
  // (104,276 wstETH less 79.7M DAI, $223M net) sits in its Instadapp account was $223M short.
  const INSTA_LIST = '0x4c8a1BEb8a87765788946D6B19C6C6355194AbEb', DS_PROXY_REGISTRY = '0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4';
  async function ownedAccounts(addr) {
    const eth = EVM.find((c) => c.key === 'eth'), word = (n) => n.toString(16).padStart(64, '0'), who = addr.slice(2).toLowerCase().padStart(64, '0');
    const call = (to, data) => firstOk(eth.rpcs, (u) => rpc(u, 'eth_call', [{ to, data }, 'latest']));
    const words = (h) => ((h || '').slice(2).match(/.{64}/g) || []).map((x) => BigInt('0x' + x));
    const asAddr = (n) => '0x' + n.toString(16).padStart(40, '0');
    const out = [];
    // Instadapp: userLink(owner) -> (first, last, count); accountAddr(id); userList(owner, id) -> (prev, next)
    const [first, , count] = words(await call(INSTA_LIST, '0xf227a99f' + who));
    for (let id = first, i = 0; id && i < Math.min(Number(count || 0), 5); i++) {
      const a = asAddr(words(await call(INSTA_LIST, '0x60330d79' + word(id)))[0] || 0n);
      if (words(await call(a, '0x2520e7ff' + who))[0] === 1n) out.push({ kind: 'Instadapp account', address: a });
      id = (words(await call(INSTA_LIST, '0x748e6e18' + who + word(id)))[1]) || 0n;
    }
    const proxy = asAddr(words(await call(DS_PROXY_REGISTRY, '0xc4552791' + who))[0] || 0n);
    if (!/^0x0+$/.test(proxy) && asAddr(words(await call(proxy, '0x8da5cb5b'))[0] || 0n) === addr.toLowerCase()) out.push({ kind: 'DSProxy', address: proxy });
    return out;
  }
  async function checkOwnedAccounts(addr) {
    const accts = await ownedAccounts(addr);
    if (!accts.length) return { holdings: [h('ETH', 0, 'ethereum')], others: 0, partial: null, note: 'no Instadapp account or DSProxy' };
    const eth = EVM.find((c) => c.key === 'eth');
    const rs = await Promise.allSettled(accts.map((a) => checkEvm(eth, a.address)));
    const holdings = [], gaps = [];
    let others = 0;
    rs.forEach((r, i) => {
      const tag = ' (' + accts[i].kind + ' ' + accts[i].address.slice(0, 8) + '…)';
      if (r.status !== 'fulfilled') { gaps.push(accts[i].kind + ' did not answer'); return; }
      for (const x of r.value.holdings) if (x.amount > 0) holdings.push(Object.assign({}, x, { symbol: x.symbol + tag }));
      others += r.value.others || 0;
      if (r.value.partial) gaps.push(accts[i].kind + ': ' + r.value.partial);
    });
    if (rs.every((r) => r.status !== 'fulfilled')) throw new Error('no account answered');
    return { holdings: holdings.length ? holdings : [h('ETH', 0, 'ethereum')], others, partial: gaps.join('; ') || null, note: accts.map((a) => a.kind + ' ' + a.address).join(', ') };
  }
  async function checkMempoolStyle(base, addr, symbol, price) {
    const j = await fetchJSON(base + addr);
    const c = j.chain_stats, m = j.mempool_stats;
    const sats = BigInt(c.funded_txo_sum) - BigInt(c.spent_txo_sum) + BigInt(m.funded_txo_sum) - BigInt(m.spent_txo_sum);
    return { holdings: [h(symbol, units(sats, 8), price)], others: 0, partial: null };
  }
  async function checkBtc(addr) {
    return firstOk(BTC_APIS, (b) => checkMempoolStyle(b, addr, 'BTC', 'bitcoin'));
  }
  async function checkLtc(addr) {
    return firstOk(['mempool', 'bitcore', 'blockcypher'], async (src) => {
      if (src === 'mempool') return checkMempoolStyle('https://litecoinspace.org/api/address/', addr, 'LTC', 'litecoin');
      if (src === 'bitcore') {
        const j = await fetchJSON('https://api.bitcore.io/api/LTC/mainnet/address/' + addr + '/balance');
        if (j.balance === undefined) throw new Error('unexpected answer');
        return { holdings: [h('LTC', units(BigInt(j.balance), 8), 'litecoin')], others: 0, partial: null };
      }
      const j = await fetchJSON('https://api.blockcypher.com/v1/ltc/main/addrs/' + addr + '/balance');
      return { holdings: [h('LTC', units(BigInt(j.final_balance), 8), 'litecoin')], others: 0, partial: null };
    });
  }
  // Bitcoin forks. Coins that sat on the legacy (1...) Bitcoin address before a fork exist at
  // the same key on the forked chain, so each is read at that address.
  async function checkBch(legacy) {   // Haskoin accepts the legacy form for BCH
    const j = await fetchJSON('https://api.haskoin.com/bch/address/' + legacy + '/balance');
    return { holdings: [h('BCH', units(BigInt(j.confirmed) + BigInt(j.unconfirmed), 8), 'bitcoin-cash')], others: 0, partial: null };
  }
  async function checkBsv(legacy) {
    const j = await fetchJSON('https://api.whatsonchain.com/v1/bsv/main/address/' + legacy + '/balance');
    return { holdings: [h('BSV', units(BigInt(j.confirmed) + BigInt(j.unconfirmed), 8), 'bitcoin-cash-sv')], others: 0, partial: null };
  }
  // eCash's only browser-reachable index (Chronik) answers in protobuf. ScriptUtxos is
  // { 2: repeated ScriptUtxo }, and ScriptUtxo field 5 is the amount in sats (1 XEC = 100 sats).
  function pbVarint(b, p) { let r = 0n, sh = 0n; for (;;) { const x = b[p++]; if (x === undefined) throw new Error('bad protobuf'); r |= BigInt(x & 0x7f) << sh; sh += 7n; if (!(x & 0x80)) return [r, p]; } }
  function pbFields(b, s, e, cb) {
    let p = s;
    while (p < e) {
      let k; [k, p] = pbVarint(b, p);
      const f = Number(k >> 3n), w = Number(k & 7n);
      if (w === 0) { let v; [v, p] = pbVarint(b, p); cb(f, w, v); }
      else if (w === 2) { let l; [l, p] = pbVarint(b, p); cb(f, w, [p, p + Number(l)]); p += Number(l); }
      else if (w === 1) p += 8; else if (w === 5) p += 4; else throw new Error('bad protobuf');
    }
  }
  async function checkXec(legacy) {
    const raw = window.SolanaATA.b58decode(legacy);            // version byte, 20-byte hash, checksum
    return checkXecHash(D.bytesToHex(raw.slice(1, 21)));
  }
  async function checkXecHash(hash) {
    const b = await fetchOnce('https://chronik.e.cash/script/p2pkh/' + hash + '/utxos', undefined, 15000, 'bytes');
    let sats = 0n;
    pbFields(b, 0, b.length, (f, w, v) => { if (f === 2 && w === 2) pbFields(b, v[0], v[1], (f2, w2, v2) => { if (f2 === 5 && w2 === 0) sats += v2; }); });
    return { holdings: [h('XEC', units(sats, 2), 'ecash')], others: 0, partial: null };
  }
  async function checkXahau(addr) {
    return firstOk(XAH_RPCS, async (u) => {
      const j = await fetchJSON(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'account_info', params: [{ account: addr, ledger_index: 'validated' }] }) });
      const r = j.result || {};
      if (r.error === 'actNotFound') return { holdings: [h('XAH', 0, 'xahau')], others: 0, partial: null };
      if (r.error || r.status === 'error') throw new Error(r.error_message || r.error || 'xahau error');
      return { holdings: [h('XAH', units(BigInt(r.account_data.Balance), 6), 'xahau')], others: 0, partial: null };
    });
  }
  // Eclipse is an SVM chain on the Solana key; its native coin is ETH with 9 decimals.
  async function checkEclipse(addr) {
    const r = await rpc(ECLIPSE_RPC, 'getBalance', [addr]);
    return { holdings: [h('ETH', units(BigInt(r.value), 9), 'ethereum')], others: 0, partial: null };
  }
  // Aptos-style coin balance (also Movement, which uses the Aptos key and REST API).
  async function aptosBalance(base, addr) {
    // An account that does not exist yet answers 200 with 0; any error is a real fault.
    const t = await fetchOnce(base + '/accounts/' + addr + '/balance/0x1::aptos_coin::AptosCoin', undefined, 15000, 'text');
    if (!/^\s*"?\d+"?\s*$/.test(t)) throw new Error('unexpected answer');
    return BigInt(t.trim().replace(/"/g, ''));
  }
  async function checkMovement(addr) {
    return { holdings: [h('MOVE', units(await aptosBalance(MOVE_API, addr), 8), 'movement')], others: 0, partial: null };
  }
  async function checkDoge(addr) {
    const sats = await firstOk(['bitcore', 'blockcypher'], async (src) => {
      if (src === 'bitcore') { const j = await fetchJSON('https://api.bitcore.io/api/DOGE/mainnet/address/' + addr + '/balance'); if (j.balance === undefined) throw new Error('unexpected answer'); return BigInt(j.balance); }
      const j = await fetchJSON('https://api.blockcypher.com/v1/doge/main/addrs/' + addr + '/balance');
      if (j.final_balance === undefined) throw new Error('unexpected answer');
      return BigInt(j.final_balance);
    });
    return { holdings: [h('DOGE', units(sats, 8), 'dogecoin')], others: 0, partial: null };
  }
  // SOL from an RPC, then every token: public RPCs refuse "list all token accounts", so
  // tokens.js asks Jupiter, else reads the biggest tokens' accounts (ata.js).
  // Native staking: every stake account whose withdraw authority is this wallet (what
  // Phantom, Solflare and Ledger Live create), at its full balance: stake, rewards and the
  // rent reserve all come back to the wallet. Finding them needs getProgramAccounts on the
  // Stake program, which most public RPCs refuse.
  async function solStaked(addr) {
    const accts = await firstOk(SOL_STAKE_RPCS, (u) => rpc(u, 'getProgramAccounts', ['Stake11111111111111111111111111111111111111',
      { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: addr } }] }]));
    if (!Array.isArray(accts)) throw new Error('unexpected answer');
    return accts.reduce((sum, a) => sum + BigInt(a.account.lamports || 0), 0n);
  }
  // Kamino lending: one account search finds this wallet's obligations in every Kamino market
  // (the owner sits at byte 64 of an obligation, its market at 32), then Kamino's API gives
  // each market's refreshed net value, deposits minus debt, in USD.
  const KAMINO = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
  async function kamino(addr) {
    const accts = await firstOk(SOL_STAKE_RPCS, (u) => rpc(u, 'getProgramAccounts', [KAMINO,
      { encoding: 'base64', dataSlice: { offset: 32, length: 32 }, filters: [{ dataSize: 3344 }, { memcmp: { offset: 64, bytes: addr } }] }]));
    if (!Array.isArray(accts)) throw new Error('unexpected answer');
    const markets = [...new Set(accts.map((a) => window.SolanaATA.b58encode(Uint8Array.from(atob(a.account.data[0]), (ch) => ch.charCodeAt(0)))))];
    let usd = 0;
    for (const m of markets) {
      const j = await fetchJSON('https://api.kamino.finance/kamino-market/' + m + '/users/' + addr + '/obligations');
      if (!Array.isArray(j)) throw new Error('unexpected answer');
      for (const o of j) {
        const v = Number(o.refreshedStats && o.refreshedStats.netAccountValue);
        if (!Number.isFinite(v)) throw new Error('unexpected answer');
        usd += Math.max(0, v);
      }
    }
    return usd;
  }
  // opts.extra: a further account (Phantom 2-5, other paths). The DeFi searches are four more
  // calls to the one RPC that allows them, which takes about one a second, so a further account
  // with under 0.01 SOL runs them only if it ever had a token account (a position or loan needs one).
  async function checkSol(addr, opts) {
    const bal = firstOk(SOL_RPCS, (u) => rpc(u, 'getBalance', [addr]));
    const low = opts && opts.extra ? await bal.then((r) => BigInt(r.value) < 10000000n, () => false) : false;
    const tok = TOKENS.sol(addr, { positions: low ? 'auto' : true }).catch(() => ({ holdings: [], others: 0, partial: 'tokens not checked', listed: -1 }));
    const lending = low ? tok.then((t) => (t.listed === 0 ? 0 : kamino(addr))) : kamino(addr);
    const [r, staked, lent, t] = await Promise.all([bal, solStaked(addr).catch(() => null), lending.catch(() => null), tok]);
    const holdings = [h('SOL', units(BigInt(r.value), 9), 'solana')];
    if (staked) holdings.push(h('SOL (staked)', units(staked, 9), 'solana'));
    if (lent > 0) holdings.push({ symbol: 'USD in Kamino, after debt', amount: lent, price: null, usdPrice: 1 });
    return { holdings: holdings.concat(t.holdings), others: t.others, partial: [t.partial, staked === null && 'staking not checked', lent === null && 'Kamino not checked'].filter(Boolean).join('; ') || null };
  }
  async function checkTrx(addr) {
    const j = await fetchJSON('https://api.trongrid.io/v1/accounts/' + addr);
    const d = (j.data && j.data[0]) || {};
    const holdings = [h('TRX', units(BigInt(d.balance || 0), 6), 'tron')];
    const rest = [];
    for (const entry of d.trc20 || []) for (const [contract, amt] of Object.entries(entry)) {
      if (!/^\d+$/.test(String(amt)) || BigInt(amt) <= 0n) continue;
      if (TRX_STABLES[contract]) holdings.push(h(TRX_STABLES[contract][0], units(BigInt(amt), TRX_STABLES[contract][2]), TRX_STABLES[contract][1]));
      else rest.push({ addr: contract, raw: amt });
    }
    // staked TRX (Stake 2.0): frozen, unfreezing, and frozen then lent out as resources; TRX
    // others lent to this account (acquired_...) is theirs, not counted
    const res = d.account_resource || {};
    const n = (x) => BigInt(x || 0);
    const staked = (d.frozenV2 || []).reduce((s, x) => s + n(x.amount), 0n) + (d.unfrozenV2 || []).reduce((s, x) => s + n(x.unfreeze_amount), 0n)
      + n(res.delegated_frozenV2_balance_for_energy) + n(d.delegated_frozenV2_balance_for_bandwidth)
      // Stake 1.0 (before 2023): frozen until the owner unfreezes it, so old wallets still hold it
      + (d.frozen || []).reduce((s, x) => s + n(x.frozen_balance), 0n) + n(res.frozen_balance_for_energy && res.frozen_balance_for_energy.frozen_balance)
      + n(d.delegated_frozen_balance_for_bandwidth) + n(res.delegated_frozen_balance_for_energy);
    if (staked > 0n) holdings.push(h('TRX (staked)', units(staked, 6), 'tron'));
    if (n(d.allowance) > 0n) holdings.push(h('TRX (voting rewards)', units(n(d.allowance), 6), 'tron'));
    let t = { holdings: [], others: rest.length, partial: rest.length ? 'tokens not valued' : null };
    if (rest.length) try { t = await TOKENS.other('tron', rest, Object.keys(TRX_STABLES)); } catch (e) { /* counted as others */ }
    return { holdings: holdings.concat(t.holdings), others: t.others, partial: t.partial };
  }
  // Spendable balances, plus what is staked: delegations, unbonding (still the owner's for
  // up to a few weeks) and unclaimed rewards. Staking calls go to the second server first,
  // so 48 chains do not queue up three more requests each on rest.cosmos.directory.
  async function checkCosmos(c, addr) {
    const servers = [c.rest, c.rest2].filter(Boolean);
    const ask = (list, path, ms) => firstOk(list, (base) => fetchJSON(base + path, undefined, ms));
    const staking = servers.slice().reverse();
    const [j, del, unb, rew] = await Promise.all([ask(servers, '/cosmos/bank/v1beta1/balances/' + addr + '?pagination.limit=200'),
      ...['/cosmos/staking/v1beta1/delegations/' + addr, '/cosmos/staking/v1beta1/delegators/' + addr + '/unbonding_delegations', '/cosmos/distribution/v1beta1/delegators/' + addr + '/rewards']
        .map((p) => ask(staking, p, 12000).catch((e) => (e.status === 404 || e.status === 501 ? {} : undefined)))]);   // 404/501: a chain without staking; anything else (a 429, 12 s of silence, queueing included) was not checked
    let native = 0n, others = 0;
    const holdings = [];
    for (const b of j.balances || []) {
      const st = c.stables && c.stables[b.denom];
      if (b.denom === c.denom) native = BigInt(b.amount);
      else if (st) { if (BigInt(b.amount) > 0n) holdings.push(h(st[0], units(b.amount, st[1]), st[2])); }
      else if (BigInt(b.amount) > 0n) others++;
    }
    holdings.unshift(h(c.symbol, units(native, c.dec), c.price));
    // amounts are integers, except rewards, which carry 18 decimals of fraction
    const whole = (x) => BigInt(String(x).split('.')[0] || '0');
    let staked = 0n, rewards = 0n;
    for (const d of (del && del.delegation_responses) || []) if (d.balance && d.balance.denom === c.denom) staked += whole(d.balance.amount);
    // unbonding entries carry no denom: they are in the chain's bond denom, which is not always the
    // row's coin (Noble stakes ustake, its row counts USDC), so they count only when it is
    let unbonding = 0n;
    for (const u of (unb && unb.unbonding_responses) || []) for (const e of u.entries || []) unbonding += whole(e.balance);
    let missedUnbonding = false;
    if (unbonding > 0n) {
      const p = await ask(staking, '/cosmos/staking/v1beta1/params').catch(() => null);
      if (p && p.params && p.params.bond_denom === c.denom) staked += unbonding; else if (!p) missedUnbonding = true;
    }
    for (const r of (rew && rew.total) || []) {
      if (r.denom === c.denom) rewards += whole(r.amount);
      else if (c.stables && c.stables[r.denom] && whole(r.amount) > 0n) { const st = c.stables[r.denom]; holdings.push(h(st[0] + ' (rewards)', units(whole(r.amount), st[1]), st[2])); }
    }
    if (staked > 0n) holdings.push(h(c.symbol + ' (staked)', units(staked, c.dec), c.price));
    if (rewards > 0n) holdings.push(h(c.symbol + ' (rewards)', units(rewards, c.dec), c.price));
    const missed = [del, unb, rew].some((x) => x === undefined) || missedUnbonding;
    return { holdings, others, partial: missed ? 'staking not fully checked' : null };
  }
  // Perps account value, spot balances, staked HYPE and vault deposits on Hyperliquid itself.
  async function checkHyperliquid(addr) {
    const ask = (body) => fetchJSON(HL_INFO, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const opt = (p) => p.catch(() => undefined);
    const [perp, spot, staked, vaults, market] = await Promise.all([ask({ type: 'clearinghouseState', user: addr }), ask({ type: 'spotClearinghouseState', user: addr }),
      opt(ask({ type: 'delegatorSummary', user: addr })), opt(ask({ type: 'userVaultEquities', user: addr })), opt(ask({ type: 'spotMetaAndAssetCtxs' }))]);
    const holdings = [];
    const perpUsd = Number(((perp || {}).marginSummary || {}).accountValue || 0);
    if (perpUsd > 0) holdings.push(h('USDC (perps)', perpUsd, 'usd-coin'));
    const px = {};   // spot token index -> USDC mark price
    if (Array.isArray(market)) {
      const ctx = Object.fromEntries((market[1] || []).map((c) => [c.coin, c]));   // by pair name: not in universe order
      for (const u of (market[0] || {}).universe || []) {
        const c = ctx[u.name];
        if (u.tokens[1] === 0 && c && Number(c.dayNtlVlm) >= HL_MIN_VOLUME && Number(c.markPx) > 0) px[u.tokens[0]] = Number(c.markPx);
      }
    }
    let others = 0;
    for (const b of (spot || {}).balances || []) {
      const amt = Number(b.total || 0);
      if (!(amt > 0)) continue;
      if (b.coin in HL_COINS) holdings.push(h(b.coin, amt, HL_COINS[b.coin]));
      else if (px[b.token]) holdings.push({ symbol: String(b.coin).slice(0, 16), amount: amt, price: null, usdPrice: px[b.token] });
      else others++;
    }
    const hype = staked ? Number(staked.delegated || 0) + Number(staked.undelegated || 0) + Number(staked.totalPendingWithdrawal || 0) : 0;
    if (hype > 0) holdings.push(h('HYPE (staked)', hype, 'hyperliquid'));
    const inVaults = (Array.isArray(vaults) ? vaults : []).reduce((sum, v) => sum + (Number(v.equity) || 0), 0);
    if (inVaults > 0) holdings.push(h('USDC (vaults)', inVaults, 'usd-coin'));
    if (!holdings.length) holdings.push(h('USDC', 0, 'usd-coin'));
    const missed = [staked === undefined && 'staking', vaults === undefined && 'vaults', market === undefined && others && 'spot prices'].filter(Boolean);
    return { holdings, others, partial: missed.length ? missed.join(', ') + ' not checked' : null };
  }
  async function checkXrp(addr) {
    const j = await firstOk(XRP_RPCS, (u) => fetchJSON(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'account_info', params: [{ account: addr, ledger_index: 'validated' }] }) }));
    const r = j.result || {};
    let drops = 0n;
    if (r.error === 'actNotFound') drops = 0n;
    else if (r.error || r.status === 'error') throw new Error(r.error_message || r.error || 'xrpl error');
    else drops = BigInt(r.account_data.Balance);
    const holdings = [h('XRP', units(drops, 6), 'ripple')];
    if (r.error === 'actNotFound') return { holdings, others: 0, partial: null };
    // tokens are trust lines: Ripple's RLUSD and Circle's USDC count (issuers checked by their
    // on-chain domains, ripple.com and circle.com); any other line is an "other token"
    let others = 0, partial = null;
    try {
      const l = await firstOk(XRP_RPCS, (u) => fetchJSON(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'account_lines', params: [{ account: addr, ledger_index: 'validated', limit: 400 }] }) }));
      if (!l.result || !Array.isArray(l.result.lines)) throw new Error('unexpected answer');
      for (const x of l.result.lines) {
        const st = XRP_STABLES[x.account + ' ' + x.currency], amt = Number(x.balance);
        if (st && amt > 0) holdings.push(h(st[0], amt, st[1])); else if (amt > 0) others++;
      }
      if (l.result.marker) partial = 'first 400 tokens checked';
    } catch (e) { partial = 'tokens not checked'; }
    return { holdings, others, partial };
  }
  // Sui's public JSON-RPC nodes send no CORS headers (and are being retired); the GraphQL service does.
  const suiQuery = async (query, variables) => {
    const j = await fetchJSON('https://graphql.mainnet.sui.io/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    if (j.errors && j.errors.length) throw new Error(j.errors[0].message || 'graphql error');
    return j.data;
  };
  // Staking rewards, as Sui's own estimate works them out: the stake bought pool tokens at
  // its pool's exchange rate in the epoch it became active, and they are worth the pool's
  // rate now. Stakes with a validator that has since left the active set get no reward here.
  async function suiRewards(stakes) {
    const pools = {};
    let after = null, epoch = 0;
    for (let page = 0; page < 6; page++) {
      const d = await suiQuery('query($c: String) { epoch { epochId validatorSet { activeValidators(first: 50, after: $c) { pageInfo { hasNextPage endCursor } nodes { contents { json } } } } } }', { c: after });
      epoch = Number(d.epoch.epochId);
      const v = d.epoch.validatorSet.activeValidators;
      for (const n of v.nodes) { const p = n.contents && n.contents.json && n.contents.json.staking_pool; if (p) pools[p.id] = p; }
      if (!v.pageInfo.hasNextPage) break;
      after = v.pageInfo.endCursor;
    }
    const due = stakes.filter((s) => pools[s.pool_id] && Number(s.stake_activation_epoch) < epoch);
    if (!due.length) return 0n;
    // each rate is a table entry keyed by epoch (u64, little-endian, base64): one aliased query
    const key = (n) => { let x = BigInt(n), b = ''; for (let i = 0; i < 8; i++) { b += String.fromCharCode(Number(x & 255n)); x >>= 8n; } return btoa(b); };
    const d = await suiQuery('query { ' + due.map((s, i) => 'r' + i + ': address(address: "' + pools[s.pool_id].exchange_rates.id + '") { dynamicField(name: { type: "u64", bcs: "' + key(s.stake_activation_epoch) + '" }) { value { ... on MoveValue { json } } } }').join(' ') + ' }');
    let reward = 0n;
    due.forEach((s, i) => {
      const r = d['r' + i] && d['r' + i].dynamicField && d['r' + i].dynamicField.value && d['r' + i].dynamicField.value.json, p = pools[s.pool_id];
      if (!r || !(BigInt(r.sui_amount) > 0n) || !(BigInt(p.pool_token_balance) > 0n)) return;
      const tokens = BigInt(s.principal) * BigInt(r.pool_token_amount) / BigInt(r.sui_amount);
      const now = tokens * BigInt(p.sui_balance) / BigInt(p.pool_token_balance);
      if (now > BigInt(s.principal)) reward += now - BigInt(s.principal);
    });
    return reward;
  }
  async function checkSui(addr) {
    const j = { data: await suiQuery('query($a: SuiAddress!) { address(address: $a) { balances(first: 50) { nodes { coinType { repr } totalBalance } }'
        + ' objects(filter: { type: "0x3::staking_pool::StakedSui" }, first: 50) { pageInfo { hasNextPage } nodes { contents { json } } } } }', { a: addr }) };
    const a = (j.data && j.data.address) || {};
    let native = 0n;
    const rest = [];
    for (const b of (a.balances && a.balances.nodes) || []) {
      if (/^0x0*2::sui::SUI$/.test(b.coinType.repr)) native = BigInt(b.totalBalance);
      else if (BigInt(b.totalBalance) > 0n) rest.push({ addr: b.coinType.repr, raw: b.totalBalance });
    }
    // native staking: StakedSui objects, principal plus the rewards they have earned
    const stakes = ((a.objects && a.objects.nodes) || []).map((o) => (o.contents && o.contents.json) || {});
    const staked = stakes.reduce((s, o) => s + BigInt(o.principal || 0), 0n);
    const rewards = staked > 0n ? await suiRewards(stakes).catch(() => null) : 0n;
    const holdings = [h('SUI', units(native, 9), 'sui')];
    if (staked > 0n) holdings.push(h('SUI (staked)', units(staked, 9), 'sui'));
    if (rewards > 0n) holdings.push(h('SUI (rewards)', units(rewards, 9), 'sui'));
    let t = { holdings: [], others: rest.length, partial: rest.length ? 'tokens not valued' : null };
    if (rest.length) try { t = await TOKENS.other('sui', rest, ['0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC']); } catch (e) { /* counted as others */ }
    const more = a.objects && a.objects.pageInfo && a.objects.pageInfo.hasNextPage ? 'first 50 stakes counted' : null;
    return { holdings: holdings.concat(t.holdings), others: t.others, partial: [t.partial, more, rewards === null && 'staking rewards not checked'].filter(Boolean).join('; ') || null };
  }
  // Delegated APT: the indexer names the delegation pools this account has shares in, and
  // each pool's get_stake gives what is the account's now (active, unlocking, withdrawable),
  // rewards included.
  async function aptStaked(addr) {
    const j = await fetchJSON('https://api.mainnet.aptoslabs.com/v1/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      query: 'query($a: String!) { current_delegator_balances(distinct_on: pool_address, where: { delegator_address: { _eq: $a }, shares: { _gt: "0" } }, limit: 50) { pool_address } }', variables: { a: addr } }) });
    const rows = !j.errors && j.data && j.data.current_delegator_balances;
    if (!Array.isArray(rows)) throw new Error('unexpected answer');
    const stakes = await Promise.all(rows.map((r) => firstOk(APT_APIS, (base) => fetchJSON(base + '/view', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ function: '0x1::delegation_pool::get_stake', type_arguments: [], arguments: [r.pool_address, addr] }) }))));
    return stakes.reduce((sum, s) => { if (!Array.isArray(s)) throw new Error('unexpected answer'); return s.reduce((t, x) => t + BigInt(x), sum); }, 0n);
  }
  // APT from the node; every other fungible asset from Aptos Labs' indexer (no key), valued
  // like any other token
  async function checkApt(addr) {
    const [octas, idx, staked] = await Promise.all([firstOk(APT_APIS, (base) => aptosBalance(base, addr)), 
      fetchJSON('https://api.mainnet.aptoslabs.com/v1/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        query: 'query($a: String!) { current_fungible_asset_balances(where: { owner_address: { _eq: $a }, amount: { _gt: "0" } }, limit: 100) { asset_type amount } }', variables: { a: addr } }) }).catch(() => null),
      aptStaked(addr).catch(() => null)]);
    const rows = (idx && !idx.errors && idx.data && idx.data.current_fungible_asset_balances) || null;
    // amounts come as JSON numbers: past 2^53 they are approximate, which is fine for a value
    const rest = (rows || []).filter((b) => !/^0x1::aptos_coin::AptosCoin$|^0x0*a$/.test(b.asset_type) && Number(b.amount) > 0)
      .map((b) => ({ addr: b.asset_type, raw: /^\d+$/.test(String(b.amount)) ? String(b.amount) : BigInt(Math.trunc(Number(b.amount))).toString() }));
    let t = { holdings: [], others: rest.length, partial: !rows ? 'tokens not checked' : rows.length >= 100 ? 'first 100 tokens checked' : null };
    if (rest.length) try { const cut = t.partial; t = await TOKENS.other('aptos', rest, ['0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b']); t.partial = [cut, t.partial].filter(Boolean).join('; ') || null; } catch (e) { t.partial = 'tokens not valued'; }
    const holdings = [h('APT', units(octas, 8), 'aptos')];
    if (staked > 0n) holdings.push(h('APT (staked)', units(staked, 8), 'aptos'));
    return { holdings: holdings.concat(t.holdings), others: t.others, partial: [t.partial, staked === null && 'staking not checked'].filter(Boolean).join('; ') || null };
  }

  // CashAddr (BCH and eCash address format) for the legacy Bitcoin address's hash.
  function cashaddr(prefix, legacy) {
    const CH = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const raw = window.SolanaATA.b58decode(legacy);
    const payload = [0, ...raw.slice(1, 21)];                 // version 0 = P2PKH, 160-bit hash
    const words = []; let acc = 0, bits = 0;
    for (const b of payload) { acc = ((acc << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { bits -= 5; words.push((acc >>> bits) & 31); } }
    if (bits) words.push((acc << (5 - bits)) & 31);
    const G = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
    let c = 1n;
    for (const d of [...[...prefix].map((ch) => ch.charCodeAt(0) & 31), 0, ...words, 0, 0, 0, 0, 0, 0, 0, 0]) {
      const c0 = c >> 35n; c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
      for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= G[i];
    }
    c ^= 1n;
    let out = prefix + ':';
    for (const w of words) out += CH[w];
    for (let i = 0; i < 8; i++) out += CH[Number((c >> BigInt(5 * (7 - i))) & 31n)];
    return out;
  }

  function buildChecks(a) {
    const list = [];
    list.push({ name: 'Bitcoin', addr: a.btc, explorer: 'https://mempool.space/address/', run: () => checkBtc(a.btc) });
    list.push({ name: 'Bitcoin (legacy 1...)', addr: a.btcLegacy, explorer: 'https://mempool.space/address/', run: () => checkBtc(a.btcLegacy) });
    const bch = cashaddr('bitcoincash', a.btcLegacy), xec = cashaddr('ecash', a.btcLegacy);
    list.push({ name: 'Bitcoin Cash (2017 fork)', addr: bch, explorer: 'https://blockchair.com/bitcoin-cash/address/', run: () => checkBch(a.btcLegacy) });
    list.push({ name: 'Bitcoin SV (2018 fork)', addr: a.btcLegacy, explorer: 'https://whatsonchain.com/address/', run: () => checkBsv(a.btcLegacy) });
    list.push({ name: 'eCash (2020 fork)', addr: xec, explorer: 'https://explorer.e.cash/address/', run: () => checkXec(a.btcLegacy) });
    for (const c of EVM) list.push({ name: c.name, addr: a.evm, explorer: c.explorer, run: () => checkEvm(c, a.evm) });
    list.push({ name: 'Hyperliquid', addr: a.evm, explorer: 'https://app.hyperliquid.xyz/explorer/address/', run: () => checkHyperliquid(a.evm) });
    list.push({ name: 'Smart accounts you own (Instadapp, DSProxy)', addr: a.evm, explorer: 'https://debank.com/profile/', run: () => checkOwnedAccounts(a.evm) });
    list.push({ name: 'Solana', addr: a.sol, explorer: 'https://solscan.io/account/', run: () => checkSol(a.sol) });
    list.push({ name: 'Eclipse', addr: a.sol, explorer: 'https://eclipsescan.xyz/account/', run: () => checkEclipse(a.sol) });
    list.push({ name: 'Tron', addr: a.trx, explorer: 'https://tronscan.org/#/address/', run: () => checkTrx(a.trx) });
    list.push({ name: 'XRP Ledger', addr: a.xrp, explorer: 'https://xrpscan.com/account/', run: () => checkXrp(a.xrp) });
    list.push({ name: 'Xahau', addr: a.xrp, explorer: 'https://xahauexplorer.com/account/', run: () => checkXahau(a.xrp) });
    list.push({ name: 'Sui', addr: a.sui, explorer: 'https://suiscan.xyz/mainnet/account/', run: () => checkSui(a.sui) });
    list.push({ name: 'Aptos', addr: a.apt, explorer: 'https://explorer.aptoslabs.com/account/', explorerSuffix: '?network=mainnet', run: () => checkApt(a.apt) });
    list.push({ name: 'Movement', addr: a.apt, explorer: 'https://explorer.movementnetwork.xyz/account/', explorerSuffix: '?network=mainnet', run: () => checkMovement(a.apt) });
    list.push({ name: 'Litecoin', addr: a.ltc, explorer: 'https://litecoinspace.org/address/', run: () => checkLtc(a.ltc) });
    list.push({ name: 'Dogecoin', addr: a.doge, explorer: 'https://dogechain.info/address/', run: () => checkDoge(a.doge) });
    for (const c of COSMOS) { const ad = c.eth ? a.cosmosEth[c.key] : a.cosmos[c.key]; list.push({ name: c.name, addr: ad, explorer: c.explorer, unavailable: c.unavailable, run: () => checkCosmos(c, ad) }); }
    list.push({ name: INJ.name, addr: a.inj, explorer: INJ.explorer, run: () => checkCosmos(INJ, a.inj) });
    return list;
  }

  // Prices by CoinGecko id. DefiLlama's price API takes the same ids, has no key and no
  // tight rate limit, so it goes first; CoinGecko fills any gaps (its free API allows only
  // a few calls a minute). Results are cached in this browser for five minutes so a quick
  // rescan does not ask again. Only coin ids are sent, never addresses.
  const PRICE_CACHE = 'seedcheckr-prices', PRICE_TTL = 5 * 60 * 1000;
  const priceMemo = {};
  async function fetchPrices(ids) {
    const out = {};
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(PRICE_CACHE) || '{}'); } catch (e) { cache = {}; }
    const now = Date.now();
    for (const id of ids) if (cache[id] && now - cache[id].t < PRICE_TTL) out[id] = cache[id].p;
    for (const id of ids) if (!(id in out) && priceMemo[id] && now - priceMemo[id].t < PRICE_TTL) out[id] = priceMemo[id].p;   // private mode: no localStorage
    const cached = new Set(Object.keys(out));
    let missing = [...ids].filter((id) => !(id in out));
    const chunks = [];
    for (let i = 0; i < missing.length; i += 60) chunks.push(missing.slice(i, i + 60));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const j = await fetchJSON('https://coins.llama.fi/prices/current/' + chunk.map((id) => 'coingecko:' + encodeURIComponent(id)).join(','), undefined, 10000);
        for (const [k, v] of Object.entries(j.coins || {})) if (v && typeof v.price === 'number') out[k.replace(/^coingecko:/, '')] = v.price;
      } catch (e) { /* fall through to CoinGecko */ }
    }));
    missing = missing.filter((id) => !(id in out));
    if (missing.length) {
      try {
        const j = await fetchJSON('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=' + encodeURIComponent(missing.join(',')), undefined, 10000);
        for (const [k, v] of Object.entries(j)) if (v && typeof v.usd === 'number') out[k] = v.usd;
      } catch (e) { /* amounts still show, without dollars */ }
    }
    for (const [id, p] of Object.entries(out)) if (!cached.has(id)) priceMemo[id] = { p, t: now };
    try {
      for (const [id, p] of Object.entries(out)) if (!cached.has(id)) cache[id] = { p, t: now };
      localStorage.setItem(PRICE_CACHE, JSON.stringify(cache));
    } catch (e) { /* private mode: no cache */ }
    return out;
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

  // ---------------- confetti: a shower of coins ----------------
  function confetti() {
    const c = $('#confetti');
    const ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr; ctx.scale(dpr, dpr);
    c.style.display = 'block';
    const P = Array.from({ length: 90 }, () => ({
      x: Math.random() * W, y: -30 - Math.random() * H * 0.7, vx: (Math.random() - 0.5) * 1.6, vy: 2 + Math.random() * 3,
      s: 9 + Math.random() * 9, spin: Math.random() * Math.PI, vs: 0.08 + Math.random() * 0.12, gold: Math.random() < 0.8,
    }));
    const t0 = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of P) {
        p.x += p.vx; p.y += p.vy; p.spin += p.vs; p.vy += 0.04;
        if (p.y < H + 30) alive = true;
        const sx = Math.max(0.15, Math.abs(Math.cos(p.spin)));   // a coin turning edge-on
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(sx, 1);
        ctx.beginPath(); ctx.arc(0, 0, p.s, 0, Math.PI * 2);
        ctx.fillStyle = p.gold ? '#ffc531' : '#5b3df5'; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = p.gold ? '#c98a00' : '#3a22c4'; ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, p.s * 0.55, 0, Math.PI * 2);
        ctx.strokeStyle = p.gold ? 'rgba(201, 138, 0, 0.55)' : 'rgba(255, 255, 255, 0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
      if (alive && now - t0 < 7000) requestAnimationFrame(frame); else c.style.display = 'none';
    })(t0);
  }

  // ---------------- the board: one cell per network ----------------
  // partial: it answered, but not every token was read, so "nothing" is not certain there.
  // skip: a network known to be unreachable from a browser, not a failure of this scan.
  const hasCoins = (r) => r.holdings.some((x) => x.amount > 0);
  const cellState = (r) => (!r.ok ? (r.check.unavailable ? 'skip' : 'fail') : hasCoins(r) ? 'hit' : r.partial ? 'part' : 'empty');
  // what the retry button runs again: no answer, or answered without reading every token
  const retryable = (r) => cellState(r) === 'fail' || cellState(r) === 'part';
  function addCells(board, checks) {
    return checks.map((c, i) => {
      const d = document.createElement('span');
      d.className = 'cell wait';
      d.title = c.name;
      d.style.animationDelay = ((i % 23) * 0.07) + 's';
      board.appendChild(d);
      return d;
    });
  }
  function renderBoard(results) {
    const board = $('#board');
    board.textContent = '';
    return results.map((r) => {
      const d = document.createElement('span');
      d.className = 'cell ' + cellState(r);
      d.title = r.check.name;
      board.appendChild(d);
      return d;
    });
  }
  function describe(r) {
    if (!r.ok) return r.check.skipped ? 'skipped by you' : r.check.unavailable ? 'not checkable' : 'no answer';
    if (cellState(r) === 'part') return 'partly answered';
    const hit = r.holdings.filter((x) => x.amount > 0);
    if (!hit.length) return 'nothing';
    return fmtAmount(hit[0].amount) + ' ' + hit[0].symbol + (hit.length > 1 ? ' and ' + (hit.length - 1) + ' more' : '');
  }
  // Live progress for a set of checks: cells light up, the counter climbs, the ticker shows
  // the latest answers, and the last few stragglers are named so a slow network is not a mystery.
  function liveProgress(checks, ui) {
    const cells = addCells($('#board'), checks);
    const pending = new Set(checks.map((c, i) => i));
    const recent = [];
    const ticker = $('#ticker');
    ui.meter.setAttribute('aria-valuemax', String(checks.length));
    return (done, total, r, i) => {
      pending.delete(i);
      const st = cellState(r);
      cells[i].className = 'cell ' + st + (reduced ? '' : ' pop');
      ui.fill.style.width = (100 * done / total) + '%';
      ui.meter.setAttribute('aria-valuenow', String(done));
      if (ui.pct) ui.pct.innerHTML = Math.floor(100 * done / total) + '<small>%</small>';
      const left = total - done;
      const waitingOn = left > 0 && left <= 3 ? '. Waiting on ' + [...pending].map((k) => checks[k].name).join(', ') : '';
      ui.text.textContent = done + ' of ' + total + ' ' + ui.noun + ' answered' + waitingOn;
      recent.unshift({ name: r.check.name, said: describe(r), st });
      recent.length = Math.min(recent.length, 3);
      ticker.textContent = '';
      for (const x of recent) {
        const li = document.createElement('li'); li.className = x.st;
        const n = document.createElement('span'); n.textContent = x.name;
        const v = document.createElement('span'); v.className = 'r'; v.textContent = x.said;
        li.append(n, v); ticker.appendChild(li);
      }
    };
  }

  // ---------------- the show ----------------
  async function run(payloadText) {
    let addr;
    try {
      state.v1 = D.parsePayload(payloadText);
      addr = await D.addressesFrom(state.v1);
    } catch (e) {
      $('#error-text').textContent = e.message;
      $('#error').hidden = false;
      return;
    }
    const caseId = shortAddr(addr.evm);
    $('#case-id').textContent = caseId;
    $('#case-wallet').textContent = caseId;
    $('#stage').hidden = false;

    const checks = buildChecks(addr);
    $('#stage-title').textContent = 'Checking ' + checks.length + ' networks';
    const progress = liveProgress(checks, { meter: $('#meter'), fill: $('#meter-fill'), pct: $('#pct'), text: $('#progress-text'), noun: 'networks' });
    fetchPricesEarly();
    state.results = await runChecks(checks, progress);
    $('#meter').classList.add('done');
    $('#progress-text').textContent = 'All ' + checks.length + ' networks answered. Adding it up';
    const v = await showVerdict(state.results);

    // the reveal: the counter gives way to the verdict, the board stays as the summary
    await wait(700);
    $('#stage-head').hidden = true;
    $('#ticker').hidden = true;
    $('#stage').classList.add('summary');
    const verdictEl = $('#verdict');
    if (!reduced) verdictEl.classList.add('animate');
    verdictEl.hidden = false;
    window.scrollTo && window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    if (v.chainsWithCoins > 0 && !reduced) confetti();
    await wait(500);
    $('#more').hidden = !window.SeedScan || !window.SeedExtra;
    $('#casefile').hidden = false;
  }

  const state = { results: [], extraDone: false, busy: false };

  // A whole-wallet scan supersedes the first-address check it covers, but only if it answered;
  // otherwise the first-address result stays, so nothing is lost and nothing is counted twice.
  // If the wallet scan reports less than the single address did (an index lagging behind),
  // keep the first-address result instead; never let one source erase coins another found.
  function supersede(all, fresh) {
    const total = (r) => r.holdings.reduce((a, x) => a + (x.amount > 0 ? x.amount : 0), 0);
    const drop = new Set();
    for (const w of fresh) {
      if (!w.ok || !w.check.replaces) continue;
      for (const old of all.filter((r) => r !== w && w.check.replaces.includes(r.check.name))) {
        if (!old.ok || total(w) + 1e-12 >= total(old)) drop.add(old); else drop.add(w);
      }
    }
    return all.filter((r) => !drop.has(r));
  }

  // Runs the networks that did not answer (or only partly) again, in place: their cells go back
  // to waiting and light up as they answer, then the verdict, legend and rows are redone.
  // A retry never makes things worse: a partial answer is kept if the retry gets no answer at all.
  async function retry() {
    if (state.busy) return;
    const idx = state.results.map((r, i) => (retryable(r) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return;
    state.busy = true;
    silent.clear();   // servers taken as down get another chance
    const btn = $('#retry');
    btn.disabled = true;
    const cells = renderBoard(state.results);
    for (const i of idx) cells[i].className = 'cell wait';
    btn.textContent = 'Retrying ' + plural(idx.length, 'network', 'networks');
    const fresh = await runChecks(idx.map((i) => state.results[i].check), (done, total, r, k) => {
      cells[idx[k]].className = 'cell ' + cellState(r) + (reduced ? '' : ' pop');
      btn.textContent = 'Retrying: ' + done + ' of ' + total + ' answered';
    });
    const results = state.results.slice();
    idx.forEach((i, k) => { if (fresh[k].ok || !results[i].ok) results[i] = fresh[k]; });
    state.results = supersede(results, fresh.filter((r) => results.includes(r)));
    await showVerdict(state.results);
    btn.disabled = false;
    state.busy = false;
  }

  // Every price id the page can ask for goes in every request, so a request says nothing
  // about which coins this wallet holds.
  function allPriceIds() {
    const ids = new Set(Object.values(HL_COINS).filter(Boolean));
    if (window.SeedExtra) for (const id of window.SeedExtra.PRICE_IDS) ids.add(id);
    return ids;
  }
  // The coins every scan asks about anyway (each network's own coin and listed stablecoins),
  // fetched while the networks are still answering instead of after; the verdict then only
  // asks for what is left (token prices come with the tokens).
  let pricesEarly = null;
  function fetchPricesEarly() {
    const ids = allPriceIds();
    for (const c of EVM) { ids.add(c.price); for (const t of c.tokens) ids.add(t.price); }
    for (const c of COSMOS.concat([INJ])) { ids.add(c.price); for (const st of Object.values(c.stables || {})) ids.add(st[2]); }
    for (const id of ['bitcoin', 'bitcoin-cash', 'bitcoin-cash-sv', 'ecash', 'solana', 'ethereum', 'tron', 'ripple', 'xahau', 'sui', 'aptos', 'movement', 'litecoin', 'dogecoin']) ids.add(id);
    ids.delete(undefined); ids.delete(null);
    pricesEarly = fetchPrices(ids).catch(() => null);
  }

  async function runChecks(checks, onProgress) {
    let done = 0;
    return Promise.all(checks.map(async (c, i) => {
      let r;
      try {
        if (c.unavailable) throw new Error(c.unavailable);
        r = await c.run();
        r.ok = true;
      } catch (e) {
        r = { ok: false, error: e.message || String(e), holdings: [], others: 0, partial: null };
      }
      done++;
      const res = Object.assign({ check: c }, r);
      if (onProgress) onProgress(done, checks.length, res, i);
      return res;
    }));
  }

  // Prices, tally, verdict text and case file for every result so far. Safe to call again
  // after the "more chains" scan adds results.
  async function showVerdict(results) {
    const priceIds = allPriceIds();
    for (const r of results) for (const x of r.holdings) if (x.price) priceIds.add(x.price);
    if (pricesEarly) await pricesEarly;
    const prices = await fetchPrices(priceIds);
    const total = results.length;
    let usd = 0, chainsWithCoins = 0, answered = 0, otherTokens = 0, priced = true;
    for (const r of results) {
      if (!r.ok) continue;
      answered++;
      otherTokens += r.others;
      let any = false;
      for (const x of r.holdings) {
        if (x.amount <= 0) continue;
        any = true;
        x.usd = undefined;
        const p = x.usdPrice != null ? x.usdPrice : prices[x.price];   // usdPrice: a token tokens.js valued itself
        if (p != null) { x.usd = x.amount * p; usd += x.usd; } else priced = false;
      }
      if (any) chainsWithCoins++;
    }
    const skipped = results.filter((r) => !r.ok && r.check.skipped).length;
    const unavailable = results.filter((r) => !r.ok && r.check.unavailable).length - skipped;
    const failed = total - answered - unavailable - skipped;
    const partly = results.filter((r) => r.ok && r.partial && !r.holdings.some((x) => x.amount > 0)).length;   // answered, but not every token was read
    const verdictEl = $('#verdict');
    const textEl = $('#verdict-text');
    const subEl = $('#verdict-sub');
    const fineEl = $('#verdict-fine');
    verdictEl.classList.remove('yes', 'no');

    if (answered === 0) {
      textEl.innerHTML = 'No network answered.';
      subEl.textContent = 'Check your connection, then retry.';
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
      const gaps = [];
      if (failed) gaps.push(plural(failed, 'network', 'networks') + ' did not answer');
      if (partly) gaps.push(plural(partly, 'network', 'networks') + ' only partly answered');
      if (skipped) gaps.push(plural(skipped, 'further account was', 'further accounts were') + ' skipped by you');
      fineEl.textContent = (otherTokens ? plural(otherTokens, 'airdropped token', 'airdropped tokens') + ' found, which does not count. ' : '') + (gaps.length ? gaps.join(' and ') + ', so there is still a sliver of hope.' : '');
    }
    renderCaseFile(results, failed);
    renderBoard(results);
    const legend = $('#legend');
    legend.textContent = '';
    for (const [cls, n, one, many] of [['l-hit', chainsWithCoins, 'network with coins', 'networks with coins'], ['l-empty', answered - chainsWithCoins - partly, 'empty', 'empty'],
      ['l-part', partly, 'partly answered', 'partly answered'], ['l-fail', failed, 'no answer', 'no answer'], ['l-skip', unavailable, 'not checkable', 'not checkable'], ['l-skip', skipped, 'skipped by you', 'skipped by you']]) {
      if (!n && cls !== 'l-hit') continue;
      const li = document.createElement('li'); li.className = cls;
      const b = document.createElement('b'); b.textContent = String(n);
      const t = document.createElement('span'); t.textContent = n === 1 ? one : many;
      li.append(b, t);
      legend.appendChild(li);
    }
    legend.hidden = false;
    const again = results.filter(retryable).length;
    const btn = $('#retry');
    btn.hidden = again === 0;
    btn.textContent = 'Retry ' + plural(again, 'network', 'networks') + ' that did not ' + (failed ? 'answer' : 'fully answer');
    return { chainsWithCoins };
  }

  // ---------------- "more chains": the moving QR on the device ----------------
  // The Portfolio QR is full, so every other key family comes from a short loop of QR
  // frames the device shows after it (docs/EXTENSIONS.md). The page reads them with the
  // camera, decodes the records, and checks those networks too.
  const extraHelpers = {
    fetchJSON, rpc, firstOk, units, h, checkEvm, checkEvmAccount, checkEvmAccounts, checkMempoolStyle, checkBtc, checkLtc, checkBch, checkBsv, checkXecHash, checkCosmos, checkSol,
    fetchText: (url) => fetchOnce(url, undefined, 15000, 'text'),
    otherTokens: (slug, list, known) => TOKENS.other(slug, list, known),
    evm: (key) => EVM.find((c) => c.key === key),
  };
  let stopCamera = null;
  function moreStatus(t) { $('#more-status').textContent = t; }
  function frameBar(have, total) {
    const bar = $('#more-frames');
    bar.textContent = '';
    for (let i = 0; i < total; i++) { const s = document.createElement('span'); if (i < have) s.className = 'got'; bar.appendChild(s); }
  }
  function closeCamera() { if (stopCamera) { stopCamera(); stopCamera = null; } $('#more-cam').hidden = true; $('#more-start').hidden = $('#more-accounts-opt').hidden = state.extraDone; }
  // The moving QR must come from the same seed as the Portfolio QR: the segwit account key
  // it carries (0x70) derives the first segwit address, which the Portfolio QR also holds.
  function sameSeed(records) {
    const r = records.find((x) => x.type === 0x70 && x.bytes.length === 69);
    if (!r || !state.v1) return null;                                      // nothing to compare against
    try { return D.bytesToHex(window.SeedExtra.firstPkh(r.bytes)) === D.bytesToHex(state.v1.btc); } catch (e) { return false; }
  }
  async function addExtra(records) {
    if (state.extraDone) return;          // later frames of a finished set must not add the networks again
    if (sameSeed(records) === false) {
      moreStatus('That moving QR comes from a different seed than the Portfolio QR you scanned. Scan both from the same SeedBox.');
      return false;
    }
    state.extraDone = true;
    closeCamera();
    while (state.busy) await new Promise((r) => setTimeout(r, 100));   // a retry is still running
    state.busy = true;
    silent.clear();   // servers taken as down during the first scan get another chance
    $('#retry').hidden = true;
    // further accounts the visitor chose not to check: shown as rows, never asked
    const skip = !$('#more-accounts').checked;
    const checks = window.SeedExtra.build(records, extraHelpers).map((c) => (skip && c.account ? Object.assign(c, { unavailable: 'you chose to check only the main accounts', skipped: true }) : c));
    $('#more-accounts-opt').hidden = true;
    $('#more-text').textContent = 'Checking ' + checks.length + ' more networks';
    $('#more-meter').hidden = false;
    const more = await runChecks(checks, liveProgress(checks, { meter: $('#more-meter'), fill: $('#more-fill'), text: $('#more-text'), noun: 'more networks' }));
    $('#more-meter').classList.add('done');
    const before = state.results.length;
    state.results = supersede(state.results.concat(more), more);
    await showVerdict(state.results);
    state.busy = false;
    $('#more-text').textContent = 'Added ' + plural(state.results.length - before, 'network', 'networks') + ' from the moving QR, including whole Bitcoin and Litecoin wallets' + (skip ? '' : ' and further accounts of Ethereum, Solana and Bitcoin') + '. The verdict above now covers ' + state.results.length + '.';
    $('#verdict').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }
  function startScan() {
    if (stopCamera || state.extraDone) return;
    const asm = new window.SeedScan.Assembler();
    frameBar(0, 0);
    $('#more-cam').hidden = false;
    $('#more-start').hidden = true;
    $('#more-accounts-opt').hidden = true;
    moreStatus('Starting the camera…');
    const session = window.SeedScan.startCamera($('#more-video'), (text) => {
      if (stopCamera !== session || state.extraDone) return;
      const p = asm.add(text);
      if (p.error) moreStatus(p.error);
      else if (p.total) { moreStatus('Got ' + p.have + ' of ' + p.total + ' frames. Keep it steady.'); frameBar(p.have, p.total); }
      if (p.done) {
        let recs;
        try { recs = window.SeedScan.records(p.bytes); } catch (e) { moreStatus('Those frames did not decode: ' + e.message); asm.reset(); return; }
        Promise.resolve(addExtra(recs)).then((r) => { if (r === false) asm.reset(); });   // wrong seed: start over, camera stays on
      }
    });
    stopCamera = session;
    session.ready.then(() => { if (stopCamera === session) moreStatus('Point the camera at the moving QR on the SeedBox.'); })
      .catch((e) => {
        if (stopCamera !== session) return;   // an older, cancelled session: leave the current one alone
        if (String(e && e.message || e) !== 'stopped') moreStatus('Camera not available: ' + (e && e.message || e));
        stopCamera = null; $('#more-cam').hidden = true; $('#more-start').hidden = $('#more-accounts-opt').hidden = state.extraDone;
      });
  }

  function renderCaseFile(results, failed) {
    const ul = $('#rows');
    const quiet = $('#rows-nothing');
    ul.textContent = ''; quiet.textContent = '';
    let nothingCount = 0;
    const rank = (r) => (!r.ok ? (r.check.unavailable ? 3 : 1) : r.holdings.some((x) => x.amount > 0) ? 0 : 2);
    const sorted = results.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
    for (const r of sorted) {
      const li = document.createElement('li');
      li.tabIndex = 0;
      const nonzero = r.holdings.filter((x) => x.amount > 0);
      if (nonzero.length) li.classList.add('has-coins');
      if (!r.ok) li.classList.add(r.check.unavailable ? 'is-skip' : 'is-failed');
      const dot = document.createElement('span'); dot.className = 'dot';
      const name = document.createElement('span'); name.className = 'name'; name.textContent = r.check.name;
      const addrShort = document.createElement('span'); addrShort.className = 'addr short'; addrShort.textContent = shortAddr(r.check.addr);
      const addrFull = document.createElement('span'); addrFull.className = 'addr full'; addrFull.textContent = r.check.addr;
      const amount = document.createElement('span'); amount.className = 'amount';
      if (!r.ok) { amount.classList.add('failed'); if (r.check.unavailable) amount.classList.add('skip'); amount.textContent = r.check.skipped ? 'not checked (skipped by you)' : r.check.unavailable ? 'not checkable' : 'did not answer'; }
      else if (!nonzero.length) { amount.classList.add('none'); amount.textContent = 'nothing'; }
      else {
        let usd = 0, anyUsd = false;
        nonzero.forEach((x, k) => {
          const line = document.createElement('span'); line.className = k < 3 ? 'h' : 'h later'; line.textContent = fmtAmount(x.amount) + ' ' + x.symbol;
          amount.appendChild(line);
          if (x.usd != null) { usd += x.usd; anyUsd = true; }
        });
        if (nonzero.length > 3) { const m = document.createElement('span'); m.className = 'h fold'; m.textContent = 'and ' + (nonzero.length - 3) + ' more'; amount.appendChild(m); }
        if (anyUsd) { const u = document.createElement('span'); u.className = 'usd'; u.textContent = fmtUsd(usd); amount.appendChild(u); }
      }
      const more = document.createElement('span'); more.className = 'more';
      const bits = [];
      if (r.ok && r.others) bits.push(plural(r.others, 'other token', 'other tokens') + ' not counted');
      if (r.ok && r.partial) bits.push(r.partial);
      if (r.ok && r.note) bits.push(r.note);
      if (!r.ok) bits.push(r.error);
      more.textContent = bits.join('. ');
      const link = document.createElement('a');
      const linkAddr = r.check.explorerAddr !== undefined ? r.check.explorerAddr : r.check.addr;
      if (linkAddr && r.check.explorer) {
        link.href = r.check.explorer.includes('{a}') ? r.check.explorer.replace('{a}', linkAddr) : r.check.explorer + linkAddr + (r.check.explorerSuffix || '');
        link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open in explorer';
        more.appendChild(link);
      }
      li.append(dot, name, amount, addrShort, addrFull, more);
      const toggle = () => li.classList.toggle('expanded');
      li.addEventListener('click', (e) => { if (e.target.tagName !== 'A') toggle(); });
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      if (r.ok && !nonzero.length && !r.others && !r.partial) { quiet.appendChild(li); nothingCount++; }
      else ul.appendChild(li);
    }
    $('#nothing-wrap').hidden = nothingCount === 0;
    $('#nothing-summary').textContent = plural(nothingCount, 'network', 'networks') + ' with nothing on them';
    $('#casefile-note').textContent = 'Bitcoin and Litecoin show the first receive address only; a wallet that has been used may hold coins on later addresses, which the BTC zpub entry on the device covers. Bitcoin Cash, Bitcoin SV and eCash are read at the legacy Bitcoin address, and Ethereum Classic, EthereumPoW and PulseChain at the Ethereum address, so they show coins that were there when each chain split off.' + (failed ? ' Tap a row for the reason it did not answer.' : '');
  }

  // ---------------- entry ----------------
  const frag = D.parseFragment(location.hash);
  if (!frag) {
    $('#landing').hidden = false;
    $('#demo-link').href = '#' + DEMO_PAYLOAD;
    const lb = $('#landing-board');
    for (let i = 0; i < 152; i++) {
      const d = document.createElement('span');
      d.className = 'cell ' + ([7, 31, 58, 103].includes(i) ? 'hit' : [44, 120].includes(i) ? 'fail' : 'empty');
      lb.appendChild(d);
    }
  } else {
    run(frag);
  }
  $('#more-start').addEventListener('click', startScan);
  $('#more-stop').addEventListener('click', closeCamera);
  $('#retry').addEventListener('click', retry);
  window.addEventListener('hashchange', () => location.reload());
})();

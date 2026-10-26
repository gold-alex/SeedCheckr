# SeedBox

Offline box: type a 12, 15, 18, 21 or 24-word seed in with the knob, it derives your **public** addresses (68 rows on the device, from about 60 key families) and shows them as text and QR. The first entry, **Portfolio**, is one QR with the main keys: scan it with your phone and the web page in `docs/` checks 161 networks on those keys. Turn the knob and a moving QR carries the rest; the page reads it with the camera, adds 51 more networks (212 in all), scans your whole Bitcoin, Bitcoin Cash, Litecoin and Dogecoin wallets, every used address, instead of only the first one, and checks further accounts (Ethereum, Solana and Bitcoin accounts 2 and up, as MetaMask, Phantom and Ledger Live create them). Then it tells you, Maury style, whether you ARE or are NOT in possession of coins. Per-chain QRs open that chain's explorer. The seed is zeroed from RAM the moment derivation finishes, nothing ever touches flash, and the build has USB disabled so a computer can't talk to it.

Pico 2 + 1.8" ST7735 (Lee's PID 18403) + Bourns PEC11R encoder.

**Orientation:** built for landscape, 160 wide x 128 tall, pin header on the left (`TFT_ROTATION 1`). If it's upside down use 3. For a vertical build use 0 or 2; menus, address wrap, word review and QR all re-flow from the actual screen size.

## Flash it (no Arduino IDE needed)

1. Hold BOOTSEL on the Pico 2, plug it into a computer, release. A drive called `RP2350` appears.
2. Drag `seedbox.ino.uf2` onto it. The Pico reboots into SeedBox.
3. Unplug from the computer. Run it from a power bank or battery from now on.

## Or build it yourself

1. Arduino IDE > File > Preferences > Additional boards manager URLs:
   `https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json`
2. Boards Manager: install **Raspberry Pi Pico/RP2040/RP2350** (Earle Philhower). Built against 6.3.0.
3. Library Manager: install **Adafruit ST7735 and ST7789 Library** (pulls in GFX + BusIO). That's the only library; the QR encoder (Nayuki's qrcodegen) and trezor-crypto are vendored in `src/`.
4. Tools > Board > **Raspberry Pi Pico 2**. Tools > USB Stack > **No USB**.
5. Open `seedbox.ino`, Upload with BOOTSEL held (No USB means every upload needs BOOTSEL).

## Wiring

The GP labels are printed on the underside of the Pico, so count holes instead. Hold the Pico with the USB connector at the top and count down from the USB end. Every GND pin has a square pad (holes 3, 8, 13 and 18 from the top on each side); if hole 3 isn't square you're counting from the wrong end.

Right-hand column (display):

| Display pin | Hole from USB end | Pico pin | GPIO |
|---|---|---|---|
| GND | 3 (square) | 38 | GND |
| VDD | 5 | 36 | 3V3 OUT |
| BLK | 5 (shares the 3V3 hole with VDD) | 36 | 3V3 OUT |
| (empty) | 14 | 27 | GP21 (the sketch drives it high, but a GPIO can't power the backlight; wire BLK to 3V3 instead) |
| RST | 15 | 26 | GP20 |
| SDA | 16 | 25 | GP19 (SPI0 TX) |
| SCL | 17 | 24 | GP18 (SPI0 SCK) |
| (empty) | 18 (square) | 23 | GND |
| CS | 19 | 22 | GP17 |
| DC | 20 (last hole) | 21 | GP16 |

Left-hand column (encoder):

| Encoder pin | Hole from USB end | Pico pin | GPIO |
|---|---|---|---|
| A (outer, 3-pin side) | 2 | 2 | GP1 |
| C (middle, 3-pin side) | 3 (square) | 3 | GND |
| B (outer, 3-pin side) | 4 | 4 | GP2 |
| Switch (2-pin side) | 5 | 5 | GP3 |
| Switch (2-pin side) | 8 (square) | 8 | GND |

If the USB end sits at breadboard row R, hole N is row R+N-1. The display is set up once at boot, so after any wiring change unplug and replug the Pico. A white screen means power and backlight are fine but the five signal wires (RST, SDA, SCL, CS, DC) aren't reaching the right pins. A dark grey screen after that means the signals are right and the backlight is off (BLK on a GPIO). Pressing the knob and watching the screen fade and restart means the encoder is on the wrong side of the Pico and is shorting 3V3 to GND.

## Controls

Turn = move. Press = select. Hold 0.8 s = back (on the word screen it jumps between the word list and the keyboard instead). While you hold, a yellow bar grows along the bottom edge (the top edge on the word screen) and fires when it reaches the far side.

- **Main menu:** double-size type, four items: 12-word seed, 24-word seed, Other length, About. Other length opens a second menu with 15, 18 and 21-word seeds (hold to come back). 12 and 24 words are what nearly every wallet uses, so they stay one press away and the menu fits the screen without scrolling.
- **Entering words:** one screen per word. The words that match what you have typed fill the top, a letter keyboard sits under them, and under that three word controls: `< prev`, `see all`, `next >`. The knob runs one cursor through the words, then the keys, then the controls. Press a word to take it; letters that lead nowhere are greyed out and skipped. The cursor always starts on the keyboard: after a letter it stays on that key (or the nearest live one), after a delete on the arrow, and after picking a word on the first letter of the next slot. Hold to jump up to the words. The arrow key deletes a letter, steps back a word when nothing is typed, and on word 1 returns to the menu (it asks first if words are already in). Hold the knob to jump from the list to the keyboard or back, so a long list never has to be scrolled through; the hint line between them says so. What you have typed so far is shown big and yellow at the top, with an underscore cursor. `< prev` and `next >` move to the neighbouring slot, filled or not, without retyping anything; on a slot that already holds a word, that word is shown in grey where the typed letters go, and picking a new word replaces it. `see all` opens the phrase screen.
- **Phrase screen:** the whole phrase at once in two columns, shown after the last word and whenever you press `see all`. A 12-word phrase uses double-height letters to fill the screen; 15, 18, 21 and 24 words use normal type, in rows that shrink as the phrase grows. Turn = move over the words, the selected one on a yellow bar; press = edit that word; hold = back. Every slot can be selected in any order, even before any word is entered; empty slots are grey dashes. After you pick a word, entry moves on to the next empty slot, so typing straight through still works. Once every slot is in, one turn up from word 1 highlights the title bar, `> Derive addresses`; press to go. The BIP39 checksum is checked at that point and a bad one sends you back to this screen to fix a word, not to the menu. The screen exists because the checksum lets 1 in 16 wrong words through on a 12-word seed (1 in 32, 64 and 128 on 15, 18 and 21; 1 in 256 on 24); a wrong word just gives you empty addresses with no error, so look.
- **QR screens:** labels sit sideways in the margins: what the code is in yellow (EXPLORER, ADDRESS, ALL CHAINS) with a hint, and the chain name on the other side.
- **Portfolio (top of the list):** press = one QR with the main keys. Scan it with the phone camera; the web page opens and checks 161 networks (next section). Then turn the knob: the **moving QR** loops 12 frames, 400 ms each (`MORE 2/12` in the margin; pause it with a press to see how long the screen took to draw the code). On the page, tap **Scan the moving QR** and hold the phone 10 to 15 cm from the box for a few seconds; it adds 51 more networks and the whole-wallet scans (Bitcoin, Bitcoin Cash, Litecoin, Dogecoin, Dash, Ravencoin). In the moving QR, turn = step one frame and pause, press = pause/play, hold = back to the Portfolio QR.
- **Address text screen:** the address in large type, alternating yellow and white every 4 characters so it can be compared in chunks (xpubs drop to small type to fit). The title shows the chain and its position, e.g. `3/20`. Turn = next/prev chain, press = QR, hold = back to list.
- **QR screen:** turn = toggle LINK (opens explorer/portfolio page) vs RAW (just the address, for pasting into any app). Press = back.
- Idle 5 min = addresses wiped. "Wipe & exit" at the bottom of the list does it now (holding on the list jumps the cursor there; it doesn't wipe by itself).

## The one-scan check (the website)

`docs/` in the repo is a static page, served by GitHub Pages at the address in `PORTFOLIO_URL` near the top of `seedbox.ino`. Host it anywhere else and change that one line (keep it under about 58 characters or the QR stops fitting).

How it works:

- The Portfolio QR is the page URL plus, after the `#`, a 257-byte payload: a version byte and the raw bytes behind each address (20-byte hashes for the secp256k1 chains, 32-byte keys for SOL/SUI/APT). Layout in `src/portfolio.c`, mirrored in `docs/decode.js`.
- The payload is sent as base43 text in the QR's alphanumeric mode (5.5 bits per character instead of 8), after a byte-mode segment for the URL. That is what makes all 20 chains fit in one version 11 code (61x61 modules, 2 px each on this screen). The eight Cosmos chains share one key and INJ is the ETH key, so the page expands those itself; they cost nothing in the QR.
- Everything after `#` stays in the phone. Browsers never send the fragment to the server, so GitHub (or whoever hosts the page) never sees the addresses. The page then asks public RPCs and explorers (publicnode, mempool.space, TronGrid, cosmos.directory, XRPL Cluster, CoinGecko for prices...) straight from the browser, with no API keys. Those services do see the addresses, same as any explorer would.
- Verdict: native coins and every token with real money behind it count (`docs/tokens.js`). On 88 of the 97 EVM networks the page gets the address's whole token list from a free API, first that answers: the network's explorer (Blockscout, Routescan, Ethplorer/Binplorer, the zkSync explorer, Oasis Nexus, Fantom's own API) on 62, then the wallet APIs MetaMask and Rabby (DeBank's index) call without a key, which also cover HyperEVM, Monad, Sonic, Berachain, Cronos, Kaia, Sei and the rest; 46 networks have two or more of these. Up to 4 pages are read (a spammed wallet lists thousands of tokens; the case file says when it stopped). On Solana it asks Jupiter. Where none answers it reads the network's biggest tokens directly (15 to 25 on the big networks; 1 to 12 on 23 smaller ones, among them every network whose only list is Rabby's, picked by market cap from CoinGecko's contract list; every contract checked on-chain and against DefiLlama). Airdropped junk is everywhere (Vitalik's address holds thousands of tokens, one "worth" $323k that traded $203 that day), so a token outside the known lists counts only if DEX pools hold at least $20k of it, and then at what selling it into those pools would return (constant product). A pool's size is twice what its other side holds, worked out from DexScreener's pool reserves rather than its dollar figure, which can be gamed: one BNB Chain pool it called $469k held $15 of WBNB. Tokens no price API knows, such as a memecoin launched last week (about 4 in 10 of the BNB Chain memecoins with real trading), are priced from their DexScreener pools on 36 EVM networks, counting only pools whose other side DefiLlama prices with confidence; up to 90 such tokens a network and 90 lookups a minute (the row says when there were more), and never tokens named like links or "claim your reward" spam. BNB Chain tokens still on four.meme's bonding curve count at what the curve's own `trySell` says selling the whole balance returns, after its fee; Rabby's scam flags count for nothing; everything else is listed as "other tokens" and never decides the verdict. DeFi positions count too: MetaMask's DeFi API (no key, one call per address) reports 49 protocols (Aave, Compound, Spark, Morpho, Lido, Rocket Pool, EtherFi, Ethena, Pendle, Curve, Convex, Balancer, Uniswap v2 to v4 and more), mostly on Ethereum and some on Base, Arbitrum, Optimism, Polygon, Avalanche and Linea. Their parts go through the same liquidity check, a protocol with debt on a network counts as one line of deposits minus debt, and a receipt token counted as a position (aUSDC, stETH, a pool token) is not counted again from the token list. Uniswap-v3-style liquidity NFTs (Uniswap, PancakeSwap and SushiSwap v3, Aerodrome and Velodrome Slipstream) are also read straight from the chain on 18 networks, principal at the pool's price plus uncollected fees, checked against MetaMask's figures for the same positions to the last digit. 161 networks are checked, all from the keys already in the QR, so the device never had to change:
  - **Bitcoin and its forks:** Bitcoin (first native segwit and first legacy address), plus Bitcoin Cash, Bitcoin SV and eCash read at the legacy address. Coins that sat there before each fork (2017, 2018, 2020) are still spendable on those chains. eCash's only browser-reachable index answers in protobuf, so the page decodes that itself.
  - **The EVM address, 97 networks:** Ethereum and its forks Ethereum Classic (2016), EthereumPoW (2022) and PulseChain (2023); the major rollups and sidechains (Base, Arbitrum, Arbitrum Nova, Optimism, Polygon, Polygon zkEVM, zkSync Era, Linea, Scroll, Blast, Mantle, Mode, Taiko, Zora, Manta, Metis, Boba, Unichain, Ink, Soneium, Lisk, Abstract, World Chain, Morph, Zircuit, Shape, Cyber, Katana, Hemi, BOB, Fraxtal, X Layer, Immutable zkEVM, Arbitrum Orbit and OP Stack chains like ApeChain, Gravity, Plume, Lens, Sophon); and the L1s with an EVM side (BNB Chain, opBNB, Avalanche, Gnosis, Fantom, Sonic, Celo, Cronos, Kava, Kaia, Harmony, Aurora, Moonbeam, Moonriver, Astar, Telos, IoTeX, Oasis Sapphire and Emerald, Core, Conflux, Ronin, Flare, Songbird, Rootstock, Merlin, Bitlayer, Sei, Story, Chiliz, Monad, Berachain, HyperEVM, Plasma, Etherlink, Fuse, Filecoin, Syscoin, KCC, Theta, Vana, Viction, Velas, Wanchain, Energi, OKT Chain, XDC, 0G, WEMIX, Kite AI), and the newer chains MegaETH, Robinhood Chain, Citrea, B² Network and DBK Chain. Stablecoin and top-token contracts on each were checked by calling `symbol()` and `decimals()` live. Hyperliquid itself is read on the same address: perps account value, every spot token (at its USDC mark price when that pair trades $20k a day), staked HYPE and vault deposits.
  - **Solana key:** Solana and Eclipse. **Aptos key:** Aptos and Movement. **XRP key:** XRP Ledger and Xahau. Plus Tron, Sui, Litecoin and Dogecoin. Tokens on Tron, Sui, Aptos and NEAR are valued like EVM tokens (DefiLlama price and decimals, the same liquidity check; their main stablecoins trusted as they are).
  - **Staked coins count:** delegations, unbonding and unclaimed rewards on every Cosmos chain (dYdX's USDC rewards too); native SOL stake accounts the wallet can withdraw (found with one stake-account search; only one public RPC, Solana Vibe Station, allows it, so when it is down the row says staking was not checked); staked, unfreezing and lent-out TRX (Stake 2.0, not TRX others lent to you); staked SUI with its rewards (worked out the way Sui's own estimate does: the pool's exchange rate when the stake started against its rate now, matching Sui's figure to the last unit); delegated APT in Aptos delegation pools, rewards included (the indexer names the pools, each pool's `get_stake` gives the amount); NEAR in staking pools (FastNEAR's index names the pools, each pool reports the account's balance); staked HYPE on Hyperliquid.
  - **Cosmos, 48 chains:** 38 on the ATOM key (Cosmos Hub, Osmosis, Celestia, dYdX, Sei, Akash, Juno, Noble, Neutron, Stride, Axelar, Babylon, Fetch.ai, Persistence, Sentinel, Saga, XION, Archway and more, picked from the chain registry where the REST API answers a browser and the coin has a market price), 9 that use the ETH key with their own prefix (Dymension, HAQQ, XPLA, ZetaChain, MANTRA, AIOZ, Humans.ai, Realio, Shido), and Injective. Noble USDC counts on Noble, the Hub, Osmosis, Neutron, dYdX and Injective, axlUSDC on Axelar and Osmosis. Stargaze is listed but no Stargaze server lets a browser ask.
  - **Reliability:** most networks have a second or third public endpoint, and the first to answer is used. A scan fires about 300 requests, so the page holds each host to six at a time and retries a 429 or 5xx twice before moving on. A full scan takes 10 to 30 seconds (the demo wallet, with thousands of tokens and one explorer timing out, about 26).
  - **Morpho on 11 networks:** vault deposits (v1 and v2) and lending positions, collateral and supply less borrow, from Morpho's own API in one query for every network. It replaces MetaMask's Morpho lines, which count a vault share as one unit of the asset although shares grow in value (889,528 steakUSDC shares were 1,019,047 USDC on-chain, and MetaMask said 889,528).
  - **Aave on 20 networks, and debt held as tokens:** an aToken has no DEX pool, so the liquidity check alone would drop it. Wherever MetaMask's DeFi API has not already counted it, a token named like an Aave token counts as one only if its `POOL()` is that network's Aave v3 pool (20 pools, each checked live), at its underlying asset's price, deposits minus debt on one line. Any other debt token DefiLlama prices (it gives them negative prices) is subtracted from the network's tokens.
  - **Cardano tokens:** native tokens from Koios, valued by policy id and asset name like other tokens (USDM, DJED, iUSD and USDA trusted as stablecoins); ADA includes unclaimed staking rewards.
  - **Solana DeFi:** Kamino lending (one account search finds the wallet's obligations in all of Kamino's markets, Kamino's API gives each one's refreshed value, deposits minus debt); Orca Whirlpool and Raydium CLMM liquidity positions (NFTs: amounts from liquidity, range and the pool's price, read on-chain, plus fees already owed to the position); Meteora DLMM positions (each bin's reserves split by the position's share of it). The position tokens go through the same liquidity check as any other. Tokens still on pump.fun's bonding curve count at what selling into the curve returns, after its 1.25% fee. The account searches need Solana Vibe Station, the one public RPC that allows them; when it is down those rows say so.
  - **Tokens on other networks:** RLUSD (Ripple) and USDC (Circle) on the XRP Ledger, issuers confirmed by their on-chain domains; TON tokens on Tonkeeper's curated list at tonapi's price (airdropped fakes named USDT are on its blacklist and do not count).
  - **Slow or dead servers:** wherever a network has a second source, a first one that has said nothing for 4 s gets company from the next and whichever answers first counts, so a dead server costs 4 s instead of its 15 s timeout. A server that lets three requests in a row time out is skipped for the rest of the scan (Retry gives it another chance), which keeps a whole-wallet scan from waiting on it address after address.
  - **Prices:** DefiLlama first (no key, no tight rate limit), CoinGecko for anything it lacks, cached in the browser for five minutes. Only coin ids are sent, never addresses. Token prices the explorers do not give come from DefiLlama by contract, and DexScreener sees the contracts it checks for liquidity; neither ever sees the wallet address. The token-list APIs (explorers, MetaMask, Rabby) see the address, as every balance check does. Rabby blocks a visitor for about 15 minutes after a handful of calls, so it is asked last, one call at a time, only about networks its one-call summary shows value on (a typical wallet needs one to four calls), and not again once it refuses; then those networks fall back to their biggest tokens.
  - **The case file** lists networks with coins first; the ones with nothing fold into one collapsed line.
  - **Left out on purpose:** Bitcoin Gold (no explorer answers a browser), Canto, Kujira, Migaloo and a few dozen small Cosmos chains whose public REST is down or whose coin has no market.
- **More chains, the moving QR** (spec in `docs/EXTENSIONS.md`): one QR this screen can show holds about 300 bytes, and the Portfolio code is full. Everything else goes in records of `[type][length][key bytes]`, split across frames of at most 240 bytes. Each frame is an ordinary version 10 QR like the Portfolio one, tagged `SB2 <i> <n> <crc32>`, so the page can collect them in any order and never mixes two scans. The device loops them every half second; the page reads them through the camera from inside the page (BarcodeDetector where the browser has it, the vendored jsQR otherwise). Today that is 48 key families plus 16 account records (15 account keys, 4 Ledger Live Ethereum addresses, 4 Phantom and 4 Ledger Live Solana keys) in 12 frames, giving 51 more networks, whole wallets and more accounts:
  - **Whole Bitcoin wallets:** the account extended public keys for native segwit, legacy and nested segwit Bitcoin and for Bitcoin Cash. The page asks Haskoin for the balance of every used address in each wallet, receive and change, so a used wallet is no longer judged by its first address. The legacy wallet is also scanned on Bitcoin Cash, which covers every pre-2017 coin. Taproot, both Litecoin wallets (litecoinspace, BitPay's Bitcore as fallback), Dogecoin (BitPay's Bitcore, BlockCypher as fallback) and Dash (insight.dash.org, BlockCypher as fallback) are scanned by the page itself: it derives the addresses (BIP32 public derivation and the BIP86 tweak, in plain JavaScript, checked against bip_utils) and walks them until 10 unused receive and 5 unused change addresses in a row. Ravencoin's Blockbook explorer scans its xpub in one request. Every call comes from the visitor's own browser, so a rate limit like BlockCypher's 100 an hour is per visitor, plenty for one wallet. A wallet result replaces the first-address check when it answered and found at least as much, so nothing is counted twice or lost.
  - **Ethereum accounts 2 to 5, MetaMask and Ledger Live:** MetaMask's come from the address-chain key (m/44'/60'/0'/0, the page derives indexes 1 to 4). Ledger Live puts each account on its own hardened path (m/44'/60'/1'/0/0 to 4'), which no public key can stand in for, so the device derives those four addresses itself and sends them (record 0x7B, 80 bytes). Each account is first tested for use: one MetaMask call for balances on its 12 networks and the transaction count on the 10 biggest. A used account is then checked like the first: all 97 EVM networks, every token, DeFi positions. An account that only ever received coins on a smaller network, with nothing on the big ones, is missed.
  - **Solana accounts 2 to 5 (Phantom, Solflare):** each on its own hardened path m/44'/501'/1..4'/0', so the device sends the four public keys (record 0x7C) and the page checks each like the first: SOL, every token, staked SOL.
  - **Bitcoin accounts 2 and 3 (native segwit, m/84'/0'/1' and 2'):** what Ledger Live, Sparrow and others create with "add account". The device sends both account keys (record 0x7D) and Haskoin scans each whole wallet.
  - **Solana accounts 2 to 5 (Ledger Live) and Bitcoin taproot accounts 2 and 3:** Ledger Live puts each Solana account at m/44'/501'/1..4' (record 0x7E, four public keys); taproot accounts 2 and 3 are m/86'/0'/1' and 2' (record 0x7F, two account keys, each scanned address by address like the first taproot wallet). Both compared with bip_utils.
  - **Skipping them:** before scanning the moving QR, untick "Also check accounts 2 to 5" and the page checks only each network's main account. The further accounts still show up, as rows marked "skipped by you", and the verdict says how many were skipped.
  - **Bitcoin family:** Bitcoin nested segwit (3...) and taproot (bc1p), Litecoin legacy and nested, the BCH, BSV and eCash wallet paths (145', 236', 899'), Dash, Zcash (transparent), DigiByte, Ravencoin.
  - **ETH-style keys on their own coin types:** Ethereum Classic wallets (61'), Celo Valora, Harmony ONE wallets, VeChain (VET and VTHO), Theta (THETA and TFUEL), Kaia/Kaikas.
  - **Other secp256k1:** Zilliqa, ICON, Filecoin (f1), Kaspa, Ergo, Internet Computer, Avalanche P-chain and X-chain.
  - **Cosmos with their own coin type:** Terra and Terra Classic, Kava, Secret, Cronos POS (Crypto.org), Band, THORChain and Maya, BitSong, Desmos, the old Persistence path, Provenance, Coreum, Agoric (Lum is listed but halted).
  - **ed25519:** Solana's Ledger/Trust and old Solflare paths, Stellar, Tezos, NEAR (with its staking pools and tokens), Algorand, MultiversX, Hedera (looked up by public key), IOTA, TON (Trust Wallet path, looked up by public key).
  - **Cardano:** Shelley Icarus derivation (Yoroi, Eternl, Lace, Nami), checked by stake key so every address in the account counts.
  - Not possible: Monero (a balance needs the private view key, which must never leave the box) and Polkadot/Kusama (sr25519 keys; no C implementation here).
- Bitcoin from the Portfolio QR alone, and Litecoin always: the page only sees the first receive address, because an extended public key does not fit in that QR. The moving QR fixes this for Bitcoin, Bitcoin Cash, Litecoin, Dogecoin, Dash and Ravencoin (whole-wallet scans above). A wallet that has been used may hold coins on later addresses; the BTC zpub entry on the device covers that through Blockchair.

With no `#` the page explains itself and offers a demo with a famous public wallet.

## Chains

Explorer link formats were checked against each site's documented pattern but not opened live from here (several are JS apps). If one 404s, it's a one-line edit in `CHAINS[]`.

One EVM address covers Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche C, zkSync, Linea, Scroll, Blast, Fantom, Gnosis, and every other EVM chain. Its link opens Zerion, which scans 50+ of them for tokens and NFTs. Swap the link for DeBank (`https://debank.com/profile/%s`) in `src/chains.c` if you prefer it.

| Entry | Path | What |
|---|---|---|
| ETH / all EVM | m/44'/60'/0'/0/0 | MetaMask / Rabby / Ledger Live default |
| BTC zpub | m/84'/0'/0' | watch-only, all native segwit addresses (Blockchair link) |
| BTC addr 1 | m/84'/0'/0'/0/0 | first receive address |
| BTC xpub | m/44'/0'/0' | legacy 1... addresses, for old wallets |
| LTC, DOGE | m/84'/2'..., m/44'/3'... | first address |
| SOL | m/44'/501'/0'/0' | Phantom / Solflare default |
| TRX | m/44'/195'/0'/0/0 | TronLink default (USDT-TRC20 lives here) |
| ATOM, OSMO, TIA, DYDX, SEI, AKT, JUNO, STARS | m/44'/118'/0'/0/0 | Keplr default, same key, chain prefix |
| INJ | m/44'/60'/0'/0/0 | Keplr/Ledger default (ETH key, inj prefix) |
| XRP | m/44'/144'/0'/0/0 | Ledger / Xaman default |
| SUI, APT | m/44'/784'/0'/0'/0', m/44'/637'/0'/0'/0' | Sui Wallet / Petra default |

The table above is the 20 core rows. The 48 extension rows (moving QR) are listed in `docs/EXTENSIONS.md` with their paths. Not included: Polkadot/Kusama (sr25519) and Monero (balances need the private view key). Only account 0 / address 0; add rows to `CHAINS[]` in `src/chains.c` for more. No BIP39 passphrase support (one-line change: second arg of `derive_all`).

## What was verified

- SHA-256, BIP39 checksum, word search: 500 vectors vs the reference `mnemonic` Python library, 100 each of 12, 15, 18, 21 and 24 words, plus the word count <-> entropy size table for every length (`test/`).
- Every chain: 25 random mnemonics, 5 each of 12, 15, 18, 21 and 24 words, all 20 addresses byte-identical to the independent `bip_utils` library, plus the published test vectors for the `abandon x11 about` mnemonic.
- Extension rows: all 48 match `bip_utils` (or an independent Python derivation where it lacks a coin) on random mnemonics of every length; the BIP49 and BIP86 rows reproduce the published test vectors.
- Tokens (`test/tokens_live.js`): `docs/tokens.js` run against the live APIs with real wallets (Vitalik's for spam, a Binance hot wallet for size, $1B on BNB Chain read and valued), with `BREAK=eth,bsc` (explorers down: MetaMask/Rabby take over) and `BREAK_ALL=eth,bsc` (every list down: top tokens read directly).
- Moving QR, end to end (`test/verify_extra.js`): the device's real frames for 16 mnemonics decoded by the page's `scan.js`, every record rebuilt into an address by the page's `extra.js`, and every one compared with the address the device itself shows: zero differences (1,633 checks for 16 mnemonics; Ledger Live Ethereum and Solana accounts 2 to 5, Phantom accounts 2 to 5, and Bitcoin segwit and taproot accounts 2 and 3 compared with bip_utils). `extra.js`'s own SHA-224, SHA-512/256, BLAKE2b and CRC code is checked against node's crypto and Python's hashlib. `test/verify_frames.js` draws every frame with the device's QR encoder and reads it back with jsQR, shuffled and duplicated, and rejects frames from another scan.
- Reading the moving QR off this screen (`test/verify_screen.js`): the device's real frames are drawn pixel for pixel on a 160x128 panel, then "filmed" like a phone (1080p, 10 to 20 cm, tilt, off-centre, blur, LCD greys, glare, noise) and decoded with the page's own jsQR path. That simulation chose the 400 ms frame time, the 1080p full-resolution centre crop (16 of 20 reads at 15 cm against 7 of 20 for a scaled-down 720p picture) and the jittered scan rhythm; with all 12 frames it predicts about 12 seconds (median) to collect them on a recent phone and about 26 on an old one that falls back to jsQR. The QR is streamed to the panel in one pass (~12 ms at 32 MHz SPI, shown on screen), so a camera almost never catches a half-drawn code. Real phones and the real board still need to confirm it.
- Deploys (`test/stamp.js`): every script in `docs/index.html` carries a hash of its contents (`app.js?v=...`), so a returning visitor never runs a new page against scripts their browser cached from the old one; `verify_site.js` fails when a stamp is stale.
- One-scan round trip (`test/verify_site.js`): 15 random mnemonics, 3 of each length, through the device's C code, the payload decoded with the page's own `decode.js`, all 20 addresses byte-identical; the full URL encoded with the device's QR code and read back with jsQR, an unrelated decoder. Longest payload seen: 378 characters, always version 11.
- QR: the per-chain codes (addresses, explorer links, the 111-char zpub) encode and decode back the same way.
- Compiled with the real Pico toolchain (arduino-pico 6.3.0, gnu23, No USB): 153 KB flash, 44 KB RAM, zero warnings in project files. `seedbox.ino.uf2` in this folder is that build.
- Layout geometry checked numerically for 160x128 and 128x160.
- Live data sources (`test/site_live.js`): the page's code run unchanged against the real public endpoints. Every checkable network answers with CORS headers a browser accepts from a github.io origin, and the demo wallet's ETH, USDT, BTC, SOL, TRX, XRP, ATOM and APT balances match an independent second source. On 2026-10-24 all 151 checkable networks answered for both the demo wallet (coins on 79 of them) and fresh empty wallets, in about 9 seconds.
- On the real board (2026-10-23): display init, colors, knob direction and the Portfolio scan all confirmed. Rotation, colors and knob direction are one-line fixes listed below if your parts differ.

## Security model, read this

- **Design:** seed in, public addresses out. Addresses are safe to show a phone; that's what every explorer displays. Same model as a hardware wallet exporting an xpub.
- **Seed lifetime:** RAM only, from the last word entered until derivation ends (a few seconds). Then zeroed, plus the stack is scrubbed. trezor-crypto's seed/key caches are disabled in `src/trezor/options.h`.
- **After power-off:** nothing to extract. Flash is never written; SRAM is gone in seconds.
- **While powered with a seed loaded:** someone with the DEBUG header (SWD) or a reset into BOOTSEL could in theory dump RAM during those few seconds. If that bothers you, the RP2350 can permanently disable SWD via OTP.
- **USB:** built with No USB. A computer sees nothing. Power it from a bank or battery. Flashing needs the physical BOOTSEL button.
- **Privacy, not funds:** an xpub lets anyone who sees it enumerate all your BTC addresses. Scan the BTC zpub only into something you trust. The Portfolio QR holds single addresses, not xpubs, and only public ones; it cannot be used to spend anything.
- **No secure element.** This is "nothing worth stealing" security, not tamper-resistant hardware.
- **Unaudited hobby code.** Read `seedbox.ino` and `src/chains.c` (about 600 lines together) before trusting it with a real seed. The rest is Trezor's shipping crypto library, vendored unmodified except: caches off, `aesopt.h` C++ branch removed, one `<sha2.h>` include quoted.

## If something looks wrong

- Colors inverted or wrong: change `INITR_BLACKTAB` to `INITR_GREENTAB` or `INITR_REDTAB`.
- Upside down: `#define TFT_ROTATION 3`. Vertical mount: 0 or 2.
- Knob scrolls backwards: flip `ENC_REVERSE` (1 on the reference build; 0 if your encoder is wired the other way round).
- Skipped clicks: add the Bourns RC filter (10k pull-up, 10k series, 10nF to GND) on A and B.
- QR won't scan: the Portfolio code and the zpub/xpub codes are the dense ones (2 px per module). Hold the phone 8-12 cm away, dim the room, or for a single chain scan RAW instead of LINK. Everything else is 3+ px per module and scans easily.
- Portfolio screen says "QR failed": `PORTFOLIO_URL` is too long for the code. Shorten the URL.

## Ideas

- A short custom domain for `PORTFOLIO_URL` frees about 20 bytes of QR for more chains.
- DeFi gaps: positions on protocols MetaMask's DeFi API does not cover, outside Ethereum and its six networks, or not held as a token or Uniswap-style NFT in the wallet (an Aerodrome or Velodrome position staked in its gauge belongs to the gauge, a vault share whose vault nobody prices) are not counted. Only the newest 20 liquidity NFTs per position manager are read. On Solana, MarginFi, Drift, Jupiter Lend and Perps, and Orca or Raydium positions staked in a farm (the farm holds the NFT) are not counted. NFTs as collectibles are not counted at all.
- Memecoin gaps: tokens on launchpad bonding curves other than four.meme's and pump.fun's (letsbonk, Base launchpads), and tokens whose DEX pools hold under $20k, are not counted.
- Staking gaps: Ethereum validators run from the seed; SUI staked with a validator that has since left the active set counts without its rewards; Aptos's older direct stake pools (not delegation pools); NEAR pools FastNEAR's index does not know. (Cardano and Tezos delegation leaves the coins in the wallet, so their balance already includes them.)
- Further accounts: Bitcoin legacy and nested segwit accounts 2+, and any account past 5 (Ethereum, Solana) or past 3 (Bitcoin) are not checked.
- Ethereum accounts: MetaMask and Ledger Live accounts 2 to 5 only (not 6 and up, not Ledger's old MEW-style path m/44'/60'/0'/i, not smart-contract wallets such as Safe, which live at a contract address no seed derives).
- 9 small EVM networks have no token-list API a browser can call: Polygon zkEVM, Moonbeam, Moonriver, IoTeX and Viction get their few priced tokens read directly; EthereumPoW, Theta, Wanchain and OKT Chain the native coin and stablecoins only. Tempo, Arc and Stable pay gas in a stablecoin that is also an ERC-20, so they are left out until a funded address shows whether the two balances are one.

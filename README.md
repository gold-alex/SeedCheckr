# SeedBox

Offline box: type a 12/24-word seed in with the knob, it derives your **public** addresses for 20 chains and shows them as text and QR. The first entry, **Portfolio**, is one QR that carries every address: scan it with your phone and the web page in `docs/` checks all 20 chains and tells you, Maury style, whether you ARE or are NOT in possession of coins. Per-chain QRs open that chain's explorer. The seed is zeroed from RAM the moment derivation finishes, nothing ever touches flash, and the build has USB disabled so a computer can't talk to it.

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

Turn = move. Press = select. Hold 0.8 s = back (on the word screen it jumps between the word list and the keyboard instead).

- **Main menu:** double-size type, three items: 12-word seed, 24-word seed, About.
- **Entering words:** one screen per word. The words that match what you have typed fill the top, a letter keyboard sits under them, and under that three word controls: `< prev`, `see all`, `next >`. The knob runs one cursor through the words, then the keys, then the controls. Press a word to take it; letters that lead nowhere are greyed out and skipped. The arrow key deletes a letter, steps back a word when nothing is typed, and on word 1 returns to the menu (it asks first if words are already in). Hold the knob to jump from the list to the keyboard or back, so a long list never has to be scrolled through; the hint line between them says so. What you have typed so far is shown big and yellow at the top, with an underscore cursor. `< prev` and `next >` move between words you have already entered without retyping them; on a slot that already holds a word, that word is shown in grey where the typed letters go, and picking a new word replaces it. `see all` opens the phrase screen.
- **Phrase screen:** every slot in two columns, shown after the last word and whenever you press `see all`. Turn = move over the words, press = edit that word, hold = back. Once every slot is in, one turn up from word 1 highlights the title bar, `> Derive addresses`; press to go. The BIP39 checksum is checked at that point and a bad one sends you back to this screen to fix a word, not to the menu. The screen exists because the checksum lets 1 in 16 wrong words through on a 12-word seed (1 in 256 on 24); a wrong word just gives you empty addresses with no error, so look.
- **Portfolio (top of the list):** press = one QR with all 20 addresses. Scan it, the web page does the rest (next section). Press = back, hold = back to list.
- **Address text screen:** turn = next/prev chain, press = QR, hold = back to list.
- **QR screen:** turn = toggle LINK (opens explorer/portfolio page) vs RAW (just the address, for pasting into any app). Press = back.
- Idle 5 min = addresses wiped. "Wipe & exit" at the bottom of the list does it now (holding on the list jumps the cursor there; it doesn't wipe by itself).

## The one-scan check (the website)

`docs/` in the repo is a static page, served by GitHub Pages at the address in `PORTFOLIO_URL` near the top of `seedbox.ino`. Host it anywhere else and change that one line (keep it under about 58 characters or the QR stops fitting).

How it works:

- The Portfolio QR is the page URL plus, after the `#`, a 257-byte payload: a version byte and the raw bytes behind each address (20-byte hashes for the secp256k1 chains, 32-byte keys for SOL/SUI/APT). Layout in `src/portfolio.c`, mirrored in `docs/decode.js`.
- The payload is sent as base43 text in the QR's alphanumeric mode (5.5 bits per character instead of 8), after a byte-mode segment for the URL. That is what makes all 20 chains fit in one version 11 code (61x61 modules, 2 px each on this screen). The eight Cosmos chains share one key and INJ is the ETH key, so the page expands those itself; they cost nothing in the QR.
- Everything after `#` stays in the phone. Browsers never send the fragment to the server, so GitHub (or whoever hosts the page) never sees the addresses. The page then asks public RPCs and explorers (publicnode, mempool.space, TronGrid, cosmos.directory, XRPL Cluster, CoinGecko for prices...) straight from the browser, with no API keys. Those services do see the addresses, same as any explorer would.
- Verdict: native coins and major stablecoins (USDC, USDT) count. Airdropped tokens are listed but do not count, because every used Solana or Tron wallet has spam tokens. 29 networks are checked: Bitcoin (first native segwit and first legacy address), 11 EVM networks on the one EVM address, Solana, Tron, XRP, Sui, Aptos, Litecoin, Dogecoin, 8 Cosmos chains and Injective.
- Bitcoin and Litecoin: the page only sees the first receive address, because a zpub does not fit in the QR. A wallet that has been used may hold coins on later addresses; the BTC zpub entry on the device covers that through Blockchair.

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

Not included: Cardano, Polkadot, TON, XMR (each a different key scheme; Monero isn't BIP39 at all). Only account 0 / address 0; add rows to `CHAINS[]` in `src/chains.c` for more. No BIP39 passphrase support (one-line change: second arg of `derive_all`).

## What was verified

- SHA-256, BIP39 checksum, word search: 306 vectors vs the reference `mnemonic` Python library (`test/`).
- Every chain: 30 random 12/24-word mnemonics, all 20 addresses byte-identical to the independent `bip_utils` library, plus the published test vectors for the `abandon x11 about` mnemonic.
- One-scan round trip (`test/verify_site.js`): 20 random mnemonics through the device's C code, the payload decoded with the page's own `decode.js`, all 20 addresses byte-identical; the full URL encoded with the device's QR code and read back with jsQR, an unrelated decoder. Longest payload seen: 378 characters, always version 11.
- QR: the per-chain codes (addresses, explorer links, the 111-char zpub) encode and decode back the same way.
- Compiled with the real Pico toolchain (arduino-pico 6.3.0, gnu23, No USB): 129 KB flash, 14 KB RAM, zero warnings in project files. `seedbox.ino.uf2` in this folder is that build.
- Layout geometry checked numerically for 160x128 and 128x160.
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
- With an indexer key (Alchemy, Helius) the page could list every ERC-20 and SPL token instead of just the stablecoins. It would have to live in the page source, so it is left out on purpose.

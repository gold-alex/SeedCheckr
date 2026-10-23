# SeedBox

Offline box: type a 12/24-word seed in with the knob, it derives your **public** addresses for 20 chains and shows them as text and QR. Scan the QR with your phone to open a portfolio/explorer page for that address. The seed is zeroed from RAM the moment derivation finishes, nothing ever touches flash, and the build has USB disabled so a computer can't talk to it.

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
3. Library Manager: install **Adafruit ST7735 and ST7789 Library** (pulls in GFX + BusIO). That's the only library; the QR encoder and trezor-crypto are vendored in `src/`.
4. Tools > Board > **Raspberry Pi Pico 2**. Tools > USB Stack > **No USB**.
5. Open `seedbox.ino`, Upload with BOOTSEL held (No USB means every upload needs BOOTSEL).

## Wiring

Pico right side, USB end = row 1, pin N = breadboard row N.

| Display pin | Pico | GPIO |
|---|---|---|
| GND | pin 38 | GND |
| VDD | pin 36 | 3V3 OUT |
| SCL | pin 24 | GP18 (SPI0 SCK) |
| SDA | pin 25 | GP19 (SPI0 TX) |
| RST | pin 26 | GP20 |
| DC  | pin 21 | GP16 |
| CS  | pin 22 | GP17 |
| BLK | pin 27 | GP21 |

| Encoder pin | Pico | GPIO |
|---|---|---|
| A (outer, 3-pin side) | pin 2 | GP1 |
| C (middle, 3-pin side) | pin 3 | GND |
| B (outer, 3-pin side) | pin 4 | GP2 |
| Switch (2-pin side) | pin 5 | GP3 |
| Switch (2-pin side) | pin 8 | GND |

GP16 is the Pico's default SPI MISO. The sketch moves MISO to unused GP0 (`SPI.setRX(0)`) so SPI can't steal the DC line. Keep that line.

## Controls

Turn = move. Press = select. Hold 0.8 s = back / backspace / cancel.

- **Entering words:** pick letters until the list is short enough, then pick the word. Hold = delete a letter, then back a word, then cancel. Checksum is checked after the last word.
- **Review screen:** all words shown once more before deriving. Press = derive, hold = redo the last word. This exists because the BIP39 checksum lets 1 in 16 wrong words through on a 12-word seed (1 in 256 on 24); a wrong word just gives you empty addresses with no error, so look.
- **Address text screen:** turn = next/prev chain, press = QR, hold = back to list.
- **QR screen:** turn = toggle LINK (opens explorer/portfolio page) vs RAW (just the address, for pasting into any app). Press = back.
- Idle 5 min = addresses wiped. "Wipe & exit" at the bottom of the list does it now (holding on the list jumps the cursor there; it doesn't wipe by itself).

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
- QR: every version 1-7 encodes and decodes back with OpenCV.
- Compiled with the real Pico toolchain (arduino-pico 6.3.0, gnu23): 125 KB flash, 12 KB RAM, zero warnings in project files.
- Layout geometry checked numerically for 160x128 and 128x160.
- Not tested: the physical display init and knob direction (no hardware here). Both are one-line fixes listed below.

## Security model, read this

- **Design:** seed in, public addresses out. Addresses are safe to show a phone; that's what every explorer displays. Same model as a hardware wallet exporting an xpub.
- **Seed lifetime:** RAM only, from the last word entered until derivation ends (a few seconds). Then zeroed, plus the stack is scrubbed. trezor-crypto's seed/key caches are disabled in `src/trezor/options.h`.
- **After power-off:** nothing to extract. Flash is never written; SRAM is gone in seconds.
- **While powered with a seed loaded:** someone with the DEBUG header (SWD) or a reset into BOOTSEL could in theory dump RAM during those few seconds. If that bothers you, the RP2350 can permanently disable SWD via OTP.
- **USB:** built with No USB. A computer sees nothing. Power it from a bank or battery. Flashing needs the physical BOOTSEL button.
- **Privacy, not funds:** an xpub lets anyone who sees it enumerate all your BTC addresses. Scan the BTC zpub only into something you trust.
- **No secure element.** This is "nothing worth stealing" security, not tamper-resistant hardware.
- **Unaudited hobby code.** Read `seedbox.ino` and `src/chains.c` (about 600 lines together) before trusting it with a real seed. The rest is Trezor's shipping crypto library, vendored unmodified except: caches off, `aesopt.h` C++ branch removed, one `<sha2.h>` include quoted.

## If something looks wrong

- Colors inverted or wrong: change `INITR_BLACKTAB` to `INITR_GREENTAB` or `INITR_REDTAB`.
- Upside down: `#define TFT_ROTATION 3`. Vertical mount: 0 or 2.
- Knob scrolls backwards: `#define ENC_REVERSE 1`.
- Skipped clicks: add the Bourns RC filter (10k pull-up, 10k series, 10nF to GND) on A and B.
- QR won't scan: zpub/xpub QRs are the dense ones (2 px per module). Hold the phone 8-12 cm away, dim the room, or scan RAW instead of LINK. Everything else is 3+ px per module and scans easily.

## Next step

Your own portfolio page: QR encodes `https://yoursite/#e=0x..&s=..&t=..` (fragment, so addresses never hit server logs), the page fans out to Alchemy/Zerion/Helius/Blockchair APIs and shows every chain on one screen. Keep it under ~150 characters per QR for this display; EVM + SOL + TRX fits.

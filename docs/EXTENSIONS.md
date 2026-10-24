# SeedBox "more chains" frames

The Portfolio QR (payload v1, see `seedbox/src/portfolio.h`) is full: it is the
largest code the 128 px tall screen can show at 2 px per module. Every other key
family travels in **animated frames** that the device loops after the Portfolio
QR, and that the web page reads with the phone camera from inside the page
(`docs/scan.js`). Same screen, same QR size per frame, no limit on chain count.

## Bytes

The extension is a list of records, in device row order:

    [type: 1 byte][len: 1 byte][len bytes of public key material]

Unknown types are skipped by `len`, so old pages keep working with new devices.

## Frames

The extension bytes `E` are split into chunks of at most 240 bytes, `n` frames (8 today).
The device shows each for 400 ms (`MORE_FRAME_MS`), chosen with `seedbox/test/verify_screen.js`.
Frame `i` (1-based) is one QR, alphanumeric mode only, ECC L, version 1-11:

    SB2 <i> <n> <CRC> <DATA>

- `<i>`, `<n>`: decimal.
- `<CRC>`: CRC-32 (IEEE 802.3, same as zlib.crc32) of all of `E`, 8 uppercase hex
  digits. Frames from a different scan or seed never mix.
- `<DATA>`: base43 (alphabet `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:`, same as
  the Portfolio QR) of `0x01 || chunk`. The leading 0x01 keeps leading zero bytes.

Spaces are legal in QR alphanumeric mode and never appear in base43, so the five
fields split on single spaces.

## Record types

All paths end at account 0, first receive address. `pkh` = RIPEMD160(SHA256(compressed pubkey)).

### secp256k1: Bitcoin family and ETH-style coin types (`chains_ext_utxo.c`)

| type | chain | path | bytes |
|---|---|---|---|
| 0x10 | Bitcoin nested segwit (3...) | m/49'/0'/0'/0/0 | 20: HASH160(0x0014 \|\| pkh) |
| 0x11 | Bitcoin taproot (bc1p) | m/86'/0'/0'/0/0 | 32: BIP341 tweaked x-only output key |
| 0x12 | Litecoin legacy (L...) | m/44'/2'/0'/0/0 | 20: pkh |
| 0x13 | Litecoin nested segwit (M...) | m/49'/2'/0'/0/0 | 20: script hash |
| 0x14 | Bitcoin Cash | m/44'/145'/0'/0/0 | 20: pkh |
| 0x15 | Bitcoin SV | m/44'/236'/0'/0/0 | 20: pkh |
| 0x16 | eCash | m/44'/899'/0'/0/0 | 20: pkh |
| 0x17 | Dash | m/44'/5'/0'/0/0 | 20: pkh |
| 0x18 | Zcash transparent (t1) | m/44'/133'/0'/0/0 | 20: pkh |
| 0x19 | DigiByte | m/44'/20'/0'/0/0 | 20: pkh |
| 0x1A | Ravencoin | m/44'/175'/0'/0/0 | 20: pkh |
| 0x20 | Ethereum Classic (ETC wallets) | m/44'/61'/0'/0/0 | 20: ETH-style address |
| 0x21 | Celo (Valora) | m/44'/52752'/0'/0/0 | 20: ETH-style address |
| 0x22 | Harmony (ONE wallets) | m/44'/1023'/0'/0/0 | 20: ETH-style address |
| 0x23 | VeChain | m/44'/818'/0'/0/0 | 20: ETH-style address |
| 0x24 | Theta | m/44'/500'/0'/0/0 | 20: ETH-style address |
| 0x25 | Kaia / Klaytn | m/44'/8217'/0'/0/0 | 20: ETH-style address |
| 0x26 | Zilliqa | m/44'/313'/0'/0/0 | 20: SHA256(compressed pub)[12..32] |
| 0x27 | ICON | m/44'/74'/0'/0/0 | 20: SHA3-256(uncompressed pub without 0x04)[12..32] |
| 0x28 | Filecoin (f1) | m/44'/461'/0'/0/0 | 20: BLAKE2b-160(uncompressed pub, 65 bytes) |
| 0x29 | Kaspa | m/44'/111111'/0'/0/0 | 32: x-only pubkey |
| 0x2A | Ergo | m/44'/429'/0'/0/0 | 33: compressed pubkey |
| 0x2B | Internet Computer | m/44'/223'/0'/0/0 | 33: compressed pubkey |
| 0x2C | Avalanche X/P-chain | m/44'/9000'/0'/0/0 | 20: pkh |

### Cosmos SDK chains with their own coin type (`chains_ext_cosmos.c`)

All m/44'/C'/0'/0/0, 20 bytes: pkh. The page adds the bech32 prefix.

| type | chain(s) | C | prefix |
|---|---|---|---|
| 0x30 | Terra (Terra 2 and Terra Classic) | 330 | terra |
| 0x31 | Kava | 459 | kava |
| 0x32 | Secret | 529 | secret |
| 0x33 | Cronos POS / Crypto.org | 394 | cro |
| 0x34 | Band | 494 | band |
| 0x35 | THORChain and Maya | 931 | thor, maya |
| 0x36 | BitSong | 639 | bitsong |
| 0x37 | Desmos | 852 | desmos |
| 0x38 | Persistence (old Keplr path) | 750 | persistence |
| 0x39 | Lum | 880 | lum |
| 0x3A | Provenance | 505 | pb |
| 0x3B | Coreum | 990 | core |
| 0x3C | Agoric | 564 | agoric |

### ed25519 and Cardano (`chains_ext_ed.c`)

SLIP-10 ed25519 unless noted; all path elements hardened.

| type | chain | path | bytes |
|---|---|---|---|
| 0x50 | Solana (Ledger Live, Trust) | m/44'/501'/0' | 32: pubkey |
| 0x51 | Solana (old Solflare / Sollet root) | m/44'/501' | 32: pubkey |
| 0x52 | Stellar | m/44'/148'/0' | 32: pubkey |
| 0x53 | Tezos (tz1) | m/44'/1729'/0'/0' | 20: BLAKE2b-160(pubkey) |
| 0x54 | NEAR | m/44'/397'/0' | 32: pubkey |
| 0x55 | Algorand (Ledger, Pera BIP39) | m/44'/283'/0'/0'/0' | 32: pubkey |
| 0x56 | MultiversX | m/44'/508'/0'/0'/0' | 32: pubkey |
| 0x57 | Hedera | m/44'/3030'/0'/0'/0' | 32: pubkey |
| 0x58 | IOTA (rebased) | m/44'/4218'/0'/0'/0' | 32: BLAKE2b-256(0x00 \|\| pubkey) |
| 0x59 | TON (Trust Wallet path) | m/44'/607'/0' | 32: pubkey |
| 0x60 | Cardano Shelley (Icarus: Yoroi, Eternl, Lace, Nami) | m/1852'/1815'/0'/0/0 and m/1852'/1815'/0'/2/0 | 56: BLAKE2b-224(payment pub) \|\| BLAKE2b-224(stake pub) |

### Whole wallets: account extended public keys

These ride as a second record on an existing row (ChainAddr.ext2 / xraw), so the
device's address list does not change. 69 bytes each: parent fingerprint (4, big
endian) || chain code (32) || compressed public key (33) of the account node. The
page rebuilds the xpub and asks Haskoin for the balance of every used address
(gap-limit scan), and that result replaces the matching first-address check.

| type | wallet | account path | carried on row |
|---|---|---|---|
| 0x70 | Bitcoin native segwit | m/84'/0'/0' | core row 1 (zpub) |
| 0x71 | Bitcoin legacy (also scanned on Bitcoin Cash, the 2017 fork) | m/44'/0'/0' | core row 3 (xpub) |
| 0x72 | Bitcoin nested segwit | m/49'/0'/0' | 0x10 |
| 0x73 | Bitcoin Cash | m/44'/145'/0' | 0x14 |
| 0x74 | Bitcoin taproot (page scans it itself) | m/86'/0'/0' | 0x11 |
| 0x75 | Litecoin native segwit (page scans it itself) | m/84'/2'/0' | core row 4 (LTC) |
| 0x76 | Litecoin legacy (page scans it itself) | m/44'/2'/0' | 0x12 |
| 0x77 | Ethereum address chain: MetaMask accounts 2-5 | m/44'/60'/0'/0 (fingerprint 0) | core row 0 (ETH) |

For 0x74-0x76 no xpub service answers a browser, so the page derives the addresses
itself (BIP32 public derivation, plus the BIP86 tweak for taproot) and walks them
until 10 unused receive and 5 unused change addresses in a row, asking mempool.space /
blockstream.info / litecoinspace.org about each. For 0x77 it derives indexes 1-4
(MetaMask's accounts 2-5) and checks each on the ten largest EVM networks.

An extended public key reveals every address of that account (privacy, not funds):
it goes to Haskoin only, never to price APIs.

Not possible: Monero (a balance needs the private view key), Polkadot and
Kusama (sr25519, derived from the entropy rather than the seed; no C library here).

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

The extension bytes `E` are split into chunks of at most 240 bytes, `n` frames (14 today).
The device shows each for 400 ms (`MORE_FRAME_MS`), chosen with `seedbox/test/verify_screen.js`.
Frame `i` (1-based) is one QR, alphanumeric mode only, ECC L, version 1-11:

    SB2 <i> <n> <CRC> <DATA>

- `<i>`: decimal, 1 to 999. `<n>`: decimal, the number of chunks (at most 64), on every
  frame, so the first frame read tells the page how many it needs.
- `<CRC>`: CRC-32 (IEEE 802.3, same as zlib.crc32) of all of `E`, 8 uppercase hex
  digits. Frames from a different scan or seed never mix.
- `<DATA>`: base43 (alphabet `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:`, same as
  the Portfolio QR) of
  - `i <= n` (chunk frame): `0x01 || chunk i`. The leading 0x01 keeps leading zero bytes.
  - `i > n` (fountain frame): `0x02 || len(E), 2 bytes big endian || X`, where X (240
    bytes) is the XOR of the chunks the mask of `i` picks, each zero padded to 240 bytes.

Spaces are legal in QR alphanumeric mode and never appear in base43, so the five
fields split on single spaces.

### Fountain frames

The mask of fountain frame `i` for `n` chunks, as `seedbox/src/portfolio.c` and
`docs/scan.js` compute it (32-bit unsigned arithmetic):

    s = (i * 0x9E3779B1) XOR 0x5EED5EED;  if s == 0: s = 1
    for j = 0 .. n-1:  s ^= s << 13;  s ^= s >> 17;  s ^= s << 5;  chunk j+1 is in the mask if s >> 31 == 1
    if no chunk is in it: chunk ((i-1) mod n) + 1

The device loops the `n` chunk frames, then `2n` fountain frames, with new fountain
numbers each loop (n+1 upward, back to n+1 after 999). The page treats every frame as
one equation over GF(2) and keeps them in reduced row echelon form: a frame that adds
nothing new is a duplicate, and once `n` are independent each row is one chunk. A phone
that missed a chunk rebuilds it from whatever it reads next rather than waiting a whole
loop for it; `verify_frames.js` measures under one frame past `n` on average. Pages
from before fountain frames reject `i > n` and still finish from the chunk frames.

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
device's address list does not change. 69 bytes each (0x7B-0x80 excepted, see their rows): parent fingerprint (4, big
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
| 0x77 | Ethereum address chain: MetaMask accounts 2-30 | m/44'/60'/0'/0 (fingerprint 0) | core row 0 (ETH) |
| 0x78 | Dogecoin (page scans it itself) | m/44'/3'/0' | core row 5 (DOGE) |
| 0x79 | Dash (page scans it itself) | m/44'/5'/0' | 0x17 |
| 0x7A | Ravencoin (its Blockbook explorer scans the xpub) | m/44'/175'/0' | 0x1A |
| 0x7C | Phantom / Solflare accounts 2-5: 128 bytes, four ed25519 public keys (ed25519 has only hardened steps) | m/44'/501'/1'/0' .. m/44'/501'/4'/0' | core row 6 (SOL) |
| 0x7D | Bitcoin native segwit accounts 2 and 3: 138 bytes, two 69-byte account keys back to back | m/84'/0'/1', m/84'/0'/2' | core row 2 (BTC addr 1) |
| 0x7E | Ledger Live Solana accounts 2-5: 128 bytes, four ed25519 public keys | m/44'/501'/1' .. m/44'/501'/4' | extension row 0x50 (SOL Ledger/Trust) |
| 0x7F | Bitcoin taproot accounts 2 and 3: 138 bytes, two 69-byte account keys back to back | m/86'/0'/1', m/86'/0'/2' | extension row 0x13 (LTC nested; its second slot was free) |
| 0x7B | Ledger Live Ethereum accounts 2-5: 80 bytes, four 20-byte addresses, not a key (the account level is hardened) | m/44'/60'/1'/0/0 .. m/44'/60'/4'/0/0 | core row 16 (INJ, the same ETH key) |
| 0x80 | Ledger Live Ethereum accounts 6-30: 1 byte, the first account's number, then up to 12 20-byte addresses (three records: accounts 6-17, 18-29, 30) | m/44'/60'/5'/0/0 .. m/44'/60'/29'/0/0 | extension rows 0x20, 0x21, 0x22 (ETC, Celo, Harmony; second slots free) |

Two more types never travel in frames: the page makes them itself from the Portfolio QR of an
Electrum seed (payload v2, below), so the same code checks them.

| Type | What | Path | From |
|---|---|---|---|
| 0x81 | Electrum standard wallet: the root key (fingerprint 0), P2PKH at m/0/i and m/1/i; also checked on Bitcoin Cash | m | payload v2, kind 0 |
| 0x82 | Electrum segwit wallet: the key at m/0', P2WPKH at m/0'/0/i and m/0'/1/i | m/0' | payload v2, kind 1 |

Payload v2 (the Portfolio QR of an Electrum seed, in place of the 257-byte v1): 71 bytes, base43 like v1:
`0x02`, kind (0 standard, 1 segwit), then the key in the 69-byte layout above. Haskoin scans it; if
Haskoin does not answer, the page walks it to Electrum's gap limits (20 unused receive, 10 unused change).

For 0x74-0x76, 0x78 and 0x79 no xpub service answers a browser, so the page derives the addresses
itself (BIP32 public derivation, plus the BIP86 tweak for taproot) and walks them
until 10 unused receive and 5 unused change addresses in a row, asking mempool.space /
blockstream.info / litecoinspace.org / BitPay's Bitcore (DOGE) / insight.dash.org about each,
with BlockCypher as the fallback for DOGE and Dash (about 3 requests a second and 100 an hour
per visitor, so those scans go 2 addresses at a time). For 0x77 it derives indexes 1-29
(MetaMask's accounts 2-30). Each of those, and each 0x7B and 0x80 address, is checked on every EVM network once it shows any sign of use (a balance on MetaMask's networks or a transaction on the ten largest).

An extended public key reveals every address of that account (privacy, not funds):
it goes to Haskoin only, never to price APIs.

Not possible: Monero (a balance needs the private view key), Polkadot and
Kusama (sr25519, derived from the entropy rather than the seed; no C library here).

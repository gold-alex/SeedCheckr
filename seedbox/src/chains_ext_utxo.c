// chains_ext_utxo.c - more secp256k1 keys: Bitcoin script types, Bitcoin-family coins, ETH-style coin types
// Rows here are appended after the 20 core rows by derive_all() and carried in the
// animated "more chains" QR frames (record type = row.ext, see docs/EXTENSIONS.md).
//
// Cost: every row is purpose'/coin'/0'/0/0. The hardened steps are HMAC only; the two
// non-hardened steps each need the parent's public key and the leaf needs its own, so
// 3 EC multiplications per row (24 rows = 72) plus 1 for the taproot tweak = 73.
// Sharing the purpose node (m/44', m/49') only saves HMACs; nothing above coin' can be
// shared between coins, so there is no multiplication to save. The uncompressed keys
// (ETH-style, ICON, Filecoin, ICP) come from ecdsa_uncompress_pubkey (a square root,
// no point multiplication) instead of cu_eth_addr_bytes, which would add one more per row.
#include "chains.h"
#include "chains_util.h"
#include <string.h>
#include <stdio.h>
#include "trezor/bip32.h"
#include "trezor/curves.h"
#include "trezor/ecdsa.h"
#include "trezor/secp256k1.h"
#include "trezor/sha2.h"
#include "trezor/sha3.h"
#include "trezor/base58.h"
#include "trezor/segwit_addr.h"
#include "trezor/blake2b.h"
#include "trezor/memzero.h"

#define BTC_LINK "https://mempool.space/address/%s"

typedef struct { uint8_t type; uint32_t purpose, coin; const char* name; const char* path; const char* link; } UtxoRow;

static const UtxoRow ROWS[] = {
  { 0x10, 49,   0,    "BTC nested (3..)", "m/49'/0'/0'/0/0",      BTC_LINK },
  { 0x11, 86,   0,    "BTC taproot",      "m/86'/0'/0'/0/0",      BTC_LINK },
  { 0x12, 44,   2,    "LTC legacy (L..)", "m/44'/2'/0'/0/0",      "https://blockchair.com/litecoin/address/%s" },
  { 0x13, 49,   2,    "LTC nested (M..)", "m/49'/2'/0'/0/0",      "https://blockchair.com/litecoin/address/%s" },
  { 0x14, 44,   145,  "BCH",              "m/44'/145'/0'/0/0",    "https://blockchair.com/bitcoin-cash/address/%s" },
  { 0x15, 44,   236,  "BSV",              "m/44'/236'/0'/0/0",    "https://whatsonchain.com/address/%s" },
  { 0x16, 44,   899,  "XEC (eCash)",      "m/44'/899'/0'/0/0",    "https://explorer.e.cash/address/%s" },
  { 0x17, 44,   5,    "DASH",             "m/44'/5'/0'/0/0",      "https://blockchair.com/dash/address/%s" },
  { 0x18, 44,   133,  "ZEC transparent",  "m/44'/133'/0'/0/0",    "https://blockchair.com/zcash/address/%s" },
  { 0x19, 44,   20,   "DGB",              "m/44'/20'/0'/0/0",     NULL },
  { 0x1A, 44,   175,  "RVN",              "m/44'/175'/0'/0/0",    NULL },
  { 0x20, 44,   61,   "ETC",              "m/44'/61'/0'/0/0",     "https://etc.blockscout.com/address/%s" },
  { 0x21, 44,   52752,"CELO",             "m/44'/52752'/0'/0/0",  "https://celoscan.io/address/%s" },
  { 0x22, 44,   1023, "ONE (Harmony)",    "m/44'/1023'/0'/0/0",   "https://explorer.harmony.one/address/%s" },
  { 0x23, 44,   818,  "VET (VeChain)",    "m/44'/818'/0'/0/0",    "https://vechainstats.com/account/%s" },
  { 0x24, 44,   500,  "THETA",            "m/44'/500'/0'/0/0",    "https://explorer.thetatoken.org/account/%s" },
  { 0x25, 44,   8217, "KAIA (Klaytn)",    "m/44'/8217'/0'/0/0",   "https://kaiascan.io/address/%s" },
  { 0x26, 44,   313,  "ZIL",              "m/44'/313'/0'/0/0",    "https://viewblock.io/zilliqa/address/%s" },
  { 0x27, 44,   74,   "ICX (ICON)",       "m/44'/74'/0'/0/0",     "https://tracker.icon.community/address/%s" },
  { 0x28, 44,   461,  "FIL",              "m/44'/461'/0'/0/0",    "https://filfox.info/en/address/%s" },
  { 0x29, 44,   111111,"KAS (Kaspa)",     "m/44'/111111'/0'/0/0", "https://explorer.kaspa.org/addresses/%s" },
  { 0x2A, 44,   429,  "ERG (Ergo)",       "m/44'/429'/0'/0/0",    "https://explorer.ergoplatform.com/en/addresses/%s" },
  { 0x2B, 44,   223,  "ICP account",      "m/44'/223'/0'/0/0",    "https://dashboard.internetcomputer.org/account/%s" },
  { 0x2C, 44,   9000, "AVAX X/P",         "m/44'/9000'/0'/0/0",   NULL },
};
#define N_ROWS ((int)(sizeof ROWS / sizeof ROWS[0]))

int ext_utxo_count(void) { return N_ROWS; }

static const char B32[] = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

static void hex_lower(const uint8_t* b, int n, char* out) {
  static const char hx[] = "0123456789abcdef";
  for (int i = 0; i < n; i++) { out[2*i] = hx[b[i] >> 4]; out[2*i + 1] = hx[b[i] & 15]; }
  out[2*n] = 0;
}

// CashAddr (BCH, eCash) and Kaspa: "prefix:" + base32(version || payload) + 40-bit BCH checksum.
static uint64_t cash_polymod(const uint8_t* v, size_t n) {
  uint64_t c = 1;
  for (size_t i = 0; i < n; i++) {
    uint8_t c0 = (uint8_t)(c >> 35);
    c = ((c & 0x07ffffffffull) << 5) ^ v[i];
    if (c0 & 0x01) c ^= 0x98f2bc8e61ull;
    if (c0 & 0x02) c ^= 0x79b76d99e2ull;
    if (c0 & 0x04) c ^= 0xf33e5fb3c4ull;
    if (c0 & 0x08) c ^= 0xae2eabe2a8ull;
    if (c0 & 0x10) c ^= 0x1e4f43e470ull;
  }
  return c ^ 1;
}
static void cashaddr(const char* prefix, uint8_t version, const uint8_t* data, size_t len, char* out) {
  uint8_t v[16 + 1 + 60 + 8]; size_t n = 0, d0;
  for (const char* p = prefix; *p; p++) v[n++] = *p & 0x1f;
  v[n++] = 0; d0 = n;
  uint32_t acc = version; int bits = 8;
  for (size_t i = 0; i <= len; i++) {
    while (bits >= 5) { bits -= 5; v[n++] = (acc >> bits) & 31; }
    if (i < len) { acc = (acc << 8) | data[i]; bits += 8; }
  }
  if (bits) v[n++] = (acc << (5 - bits)) & 31;
  size_t dn = n;
  for (int i = 0; i < 8; i++) v[n++] = 0;
  uint64_t chk = cash_polymod(v, n);
  int o = sprintf(out, "%s:", prefix);
  for (size_t i = d0; i < dn; i++) out[o++] = B32[v[i]];
  for (int i = 0; i < 8; i++) out[o++] = B32[(chk >> (5 * (7 - i))) & 31];
  out[o] = 0;
}

// BIP341 key-path output key for a BIP86 wallet: x(P' + H_TapTweak(x(P))G), P' = P with even y.
static int taproot_key(const uint8_t pub33[33], uint8_t out32[32]) {
  static const uint8_t tag[] = "TapTweak";
  uint8_t th[32], t[32], even[33], q[33];
  SHA256_CTX c;
  sha256_Raw(tag, sizeof tag - 1, th);
  sha256_Init(&c); sha256_Update(&c, th, 32); sha256_Update(&c, th, 32);
  sha256_Update(&c, pub33 + 1, 32); sha256_Final(&c, t);
  even[0] = 0x02; memcpy(even + 1, pub33 + 1, 32);
  int rc = ecdsa_tweak_pubkey(&secp256k1, even, t, q) == ECDSA_TWEAK_PUBKEY_SUCCESS ? 0 : -1;
  memcpy(out32, q + 1, 32);
  return rc;
}

// Filecoin f1: "f1" + base32 lowercase (RFC 4648, no padding) of hash || blake2b-4(0x01 || hash)
static void filecoin_addr(const uint8_t h[20], char* out) {
  static const char A[] = "abcdefghijklmnopqrstuvwxyz234567";
  uint8_t b[24], pre[21]; pre[0] = 0x01; memcpy(pre + 1, h, 20);
  memcpy(b, h, 20); blake2b(pre, 21, b + 20, 4);
  int o = 0; uint32_t acc = 0; int bits = 0;
  out[o++] = 'f'; out[o++] = '1';
  for (int i = 0; i < 24; i++) {
    acc = (acc << 8) | b[i]; bits += 8;
    while (bits >= 5) { bits -= 5; out[o++] = A[(acc >> bits) & 31]; }
  }
  if (bits) out[o++] = A[(acc << (5 - bits)) & 31];
  out[o] = 0;
}

// SHA-224 = SHA-256 with another IV, truncated
static void sha224(const uint8_t* d, size_t n, uint8_t out[28]) {
  static const uint32_t IV[8] = { 0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939,
                                  0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4 };
  SHA256_CTX c; uint8_t h[32];
  sha256_Init_ex(&c, IV, 0); sha256_Update(&c, d, n); sha256_Final(&c, h);
  memcpy(out, h, 28);
}
static uint32_t crc32_ieee(const uint8_t* d, size_t n) {
  uint32_t c = 0xffffffffu;
  for (size_t i = 0; i < n; i++) { c ^= d[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xedb88320u & (0u - (c & 1))); }
  return ~c;
}
// ICP ledger account identifier (default subaccount) of a self-authenticating principal
static void icp_account(const uint8_t pub65[65], char* out) {
  static const uint8_t SPKI[23] = { 0x30,0x56,0x30,0x10,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,
                                    0x06,0x05,0x2b,0x81,0x04,0x00,0x0a,0x03,0x42,0x00 };
  uint8_t der[23 + 65], buf[11 + 29 + 32], id[32];
  memcpy(der, SPKI, 23); memcpy(der + 23, pub65, 65);
  memcpy(buf, "\x0a" "account-id", 11);
  sha224(der, sizeof der, buf + 11); buf[11 + 28] = 0x02;   // principal = sha224(DER) || 0x02
  memset(buf + 40, 0, 32);                                  // subaccount 0
  sha224(buf, sizeof buf, id + 4);
  uint32_t crc = crc32_ieee(id + 4, 28);
  id[0] = crc >> 24; id[1] = crc >> 16; id[2] = crc >> 8; id[3] = crc;
  hex_lower(id, 32, out);
}

// Fill one row from its leaf node.
static int fill(const UtxoRow* d, const HDNode* n, ChainAddr* r) {
  const uint8_t* pub = n->public_key;
  uint8_t pub65[65], h[32], buf[64];
  int rc = 0;
  if (!ecdsa_uncompress_pubkey(&secp256k1, pub, pub65)) return -1;
  switch (d->type) {
    case 0x10: case 0x13: {   // P2SH-P2WPKH
      ecdsa_get_address_segwit_p2sh_raw(pub, d->type == 0x10 ? 0x05 : 0x32, HASHER_SHA2_RIPEMD, buf);
      base58_encode_check(buf, 21, HASHER_SHA2D, r->addr, CHAIN_ADDR_MAX);
      memcpy(r->raw, buf + 1, 20); r->rawlen = 20; break; }
    case 0x11:
      if (taproot_key(pub, r->raw)) { rc = -1; break; }
      segwit_addr_encode(r->addr, "bc", 1, r->raw, 32); r->rawlen = 32; break;
    case 0x12: case 0x15: case 0x17: case 0x18: case 0x19: case 0x1A: {   // base58 P2PKH
      uint32_t ver = d->type == 0x12 ? 0x30 : d->type == 0x15 ? 0x00 : d->type == 0x17 ? 0x4c
                   : d->type == 0x18 ? 0x1cb8 : d->type == 0x19 ? 0x1e : 0x3c;
      ecdsa_get_address(pub, ver, HASHER_SHA2_RIPEMD, HASHER_SHA2D, r->addr, CHAIN_ADDR_MAX);
      ecdsa_get_pubkeyhash(pub, HASHER_SHA2_RIPEMD, r->raw); r->rawlen = 20; break; }
    case 0x14: case 0x16: case 0x2C:   // cashaddr / avax bech32 of pkh
      ecdsa_get_pubkeyhash(pub, HASHER_SHA2_RIPEMD, r->raw); r->rawlen = 20;
      if (d->type == 0x2C) { r->addr[0] = 'X'; r->addr[1] = '-'; cu_bech32_bytes("avax", r->raw, 20, r->addr + 2); }
      else cashaddr(d->type == 0x14 ? "bitcoincash" : "ecash", 0x00, r->raw, 20, r->addr);
      break;
    case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: case 0x25:   // ETH-style
      keccak_256(pub65 + 1, 64, h); memcpy(r->raw, h + 12, 20); r->rawlen = 20;
      if (d->type == 0x22) cu_bech32_bytes("one", r->raw, 20, r->addr);
      else cu_eth_checksum(r->raw, r->addr);
      break;
    case 0x26:
      sha256_Raw(pub, 33, h); memcpy(r->raw, h + 12, 20); r->rawlen = 20;
      cu_bech32_bytes("zil", r->raw, 20, r->addr); break;
    case 0x27:
      sha3_256(pub65 + 1, 64, h); memcpy(r->raw, h + 12, 20); r->rawlen = 20;
      r->addr[0] = 'h'; r->addr[1] = 'x'; hex_lower(r->raw, 20, r->addr + 2); break;
    case 0x28:
      blake2b(pub65, 65, r->raw, 20); r->rawlen = 20;
      filecoin_addr(r->raw, r->addr); break;
    case 0x29:
      memcpy(r->raw, pub + 1, 32); r->rawlen = 32;
      cashaddr("kaspa", 0x00, r->raw, 32, r->addr); break;
    case 0x2A: {   // Ergo P2PK: base58(0x01 || pub33 || blake2b256(0x01 || pub33)[0..4])
      buf[0] = 0x01; memcpy(buf + 1, pub, 33);
      blake2b(buf, 34, h, 32); memcpy(buf + 34, h, 4);
      size_t sz = CHAIN_ADDR_MAX; if (!b58enc(r->addr, &sz, buf, 38)) rc = -1;
      memcpy(r->raw, pub, 33); r->rawlen = 33; break; }
    case 0x2B:
      icp_account(pub65, r->addr);
      memcpy(r->raw, pub, 33); r->rawlen = 33; break;
    default: rc = -1;
  }
  memzero(pub65, sizeof pub65); memzero(h, sizeof h); memzero(buf, sizeof buf);
  return rc;
}

// Fills ext_utxo_count() rows. Returns 0 on success, -1 on failure.
// Zero every HDNode / private buffer before returning.
int ext_utxo_derive(const char* mnemonic, const uint8_t seed[64], ChainAddr* out) {
  (void)mnemonic;
  HDNode p44, p49, p86, n;
  int rc = -1;
  if (!hdnode_from_seed(seed, 64, SECP256K1_NAME, &p44)) goto done;
  p49 = p44; p86 = p44;
  if (!hdnode_private_ckd(&p44, 44|H) || !hdnode_private_ckd(&p49, 49|H) || !hdnode_private_ckd(&p86, 86|H)) goto done;
  for (int i = 0; i < N_ROWS; i++) {
    const UtxoRow* d = &ROWS[i];
    cu_row(&out[i], d->name, d->path, d->link, d->type);
    n = d->purpose == 49 ? p49 : d->purpose == 86 ? p86 : p44;
    if (!hdnode_private_ckd(&n, d->coin|H)) goto done;
    // BTC nested, BCH, taproot, LTC legacy, Dash and Ravencoin also send their account xpub so the page can scan the whole wallet
    uint8_t xt = d->type == 0x10 ? 0x72 : d->type == 0x14 ? 0x73 : d->type == 0x11 ? 0x74 : d->type == 0x12 ? 0x76 : d->type == 0x17 ? 0x79 : d->type == 0x1A ? 0x7A : 0;
    uint32_t fp = xt ? hdnode_fingerprint(&n) : 0;
    if (!hdnode_private_ckd(&n, 0|H)) goto done;
    if (xt) { hdnode_fill_public_key(&n); cu_xpub_record(&out[i], xt, &n, fp); }
    if (!hdnode_private_ckd(&n, 0) || !hdnode_private_ckd(&n, 0)) goto done;
    hdnode_fill_public_key(&n);
    if (fill(d, &n, &out[i])) goto done;
  }
  rc = 0;
done:
  memzero(&p44, sizeof p44); memzero(&p49, sizeof p49); memzero(&p86, sizeof p86); memzero(&n, sizeof n);
  return rc;
}

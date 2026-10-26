// chains_ext_ed.c - ed25519 chains (Stellar, Tezos, NEAR, ...) and Cardano
// Rows here are appended after the 20 core rows by derive_all() and carried in the
// animated "more chains" QR frames (record type = row.ext, see docs/EXTENSIONS.md).
#include "chains.h"
#include "chains_util.h"
#include <string.h>
#include "trezor/bip32.h"
#include "trezor/bip39.h"
#include "trezor/curves.h"
#include "trezor/base58.h"
#include "trezor/hasher.h"
#include "trezor/blake2b.h"
#include "trezor/sha2.h"
#include "trezor/hmac.h"
#include "trezor/pbkdf2.h"
#include "trezor/segwit_addr.h"
#include "trezor/memzero.h"
#include "trezor/ed25519-donna/ed25519.h"

#define N_ED 11

int ext_ed_count(void) { return N_ED; }

// ---------------- encoders ----------------
static void hex_plain(const uint8_t* b, int n, char* out) {   // lowercase hex, no prefix
  static const char hx[] = "0123456789abcdef";
  for (int i = 0; i < n; i++) { out[2*i] = hx[b[i] >> 4]; out[2*i + 1] = hx[b[i] & 15]; }
  out[2*n] = 0;
}

// RFC 4648 base32, upper case, no padding
static void base32_nopad(const uint8_t* in, size_t n, char* out) {
  static const char A[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  uint32_t acc = 0; int bits = 0; size_t o = 0;
  for (size_t i = 0; i < n; i++) {
    acc = (acc << 8) | in[i]; bits += 8;
    while (bits >= 5) { bits -= 5; out[o++] = A[(acc >> bits) & 31]; }
  }
  if (bits) out[o++] = A[(acc << (5 - bits)) & 31];
  out[o] = 0;
}

static uint16_t crc16_xmodem(const uint8_t* d, size_t n) {
  uint16_t c = 0;
  for (size_t i = 0; i < n; i++) {
    c ^= (uint16_t)d[i] << 8;
    for (int b = 0; b < 8; b++) c = (c & 0x8000) ? (uint16_t)((c << 1) ^ 0x1021) : (uint16_t)(c << 1);
  }
  return c;
}

// SHA-512/256 (FIPS 180-4): SHA-512 with its own IV, truncated to 32 bytes
static void sha512_256(const uint8_t* in, size_t n, uint8_t out[32]) {
  static const uint64_t IV[8] = {
    0x22312194FC2BF72Cull, 0x9F555FA3C84C64C2ull, 0x2393B86B6F53B151ull, 0x963877195940EABDull,
    0x96283EE2A88EFFE3ull, 0xBE5E1E2553863992ull, 0x2B0199FC2C85B8AAull, 0x0EB72DDC81C52CA2ull };
  SHA512_CTX c; uint8_t full[64];
  sha512_Init(&c); memcpy(c.state, IV, sizeof IV);
  sha512_Update(&c, in, n); sha512_Final(&c, full);
  memcpy(out, full, 32);
}

// bech32 without the 90-char limit (Cardano base addresses are 103 chars)
static uint32_t b32_polymod(uint32_t pre) {
  uint8_t b = pre >> 25;
  return ((pre & 0x1FFFFFF) << 5) ^ (-((b >> 0) & 1) & 0x3b6a57b2UL) ^ (-((b >> 1) & 1) & 0x26508e6dUL) ^
         (-((b >> 2) & 1) & 0x1ea119faUL) ^ (-((b >> 3) & 1) & 0x3d4233ddUL) ^ (-((b >> 4) & 1) & 0x2a1462b3UL);
}
static void bech32_long(const char* hrp, const uint8_t* in, size_t n, char* out) {
  static const char CS[] = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  uint8_t d5[100]; size_t m = 0; uint32_t acc = 0; int bits = 0;
  for (size_t i = 0; i < n; i++) {
    acc = (acc << 8) | in[i]; bits += 8;
    while (bits >= 5) { bits -= 5; d5[m++] = (acc >> bits) & 31; }
  }
  if (bits) d5[m++] = (acc << (5 - bits)) & 31;
  uint32_t chk = 1; size_t o = 0;
  for (const char* h = hrp; *h; h++) chk = b32_polymod(chk) ^ ((uint8_t)*h >> 5);
  chk = b32_polymod(chk);
  for (const char* h = hrp; *h; h++) { chk = b32_polymod(chk) ^ (*h & 31); out[o++] = *h; }
  out[o++] = '1';
  for (size_t i = 0; i < m; i++) { chk = b32_polymod(chk) ^ d5[i]; out[o++] = CS[d5[i]]; }
  for (int i = 0; i < 6; i++) chk = b32_polymod(chk);
  chk ^= 1;
  for (int i = 0; i < 6; i++) out[o++] = CS[(chk >> ((5 - i) * 5)) & 31];
  out[o] = 0;
}

// ---------------- Cardano Icarus / BIP32-Ed25519 (CIP-3, CIP-1852) ----------------
typedef struct { uint8_t k[64]; uint8_t c[32]; uint8_t pub[32]; } CardNode;   // k = kL || kR

static void card_add28mul8(const uint8_t* kl, const uint8_t* zl, uint8_t* out) {
  unsigned carry = 0;
  for (int i = 0; i < 32; i++) {
    unsigned r = kl[i] + (i < 28 ? ((unsigned)zl[i] << 3) : 0) + carry;
    out[i] = r & 0xff; carry = r >> 8;
  }
}
static void card_add256(const uint8_t* a, const uint8_t* b, uint8_t* out) {
  unsigned carry = 0;
  for (int i = 0; i < 32; i++) { unsigned r = a[i] + b[i] + carry; out[i] = r & 0xff; carry = r >> 8; }
}

static void card_ckd(CardNode* n, uint32_t idx) {
  uint8_t buf[1 + 64 + 4], z[64], ch[64];
  size_t len;
  if (idx & H) { buf[0] = 0x00; memcpy(buf + 1, n->k, 64); len = 65; }
  else         { buf[0] = 0x02; memcpy(buf + 1, n->pub, 32); len = 33; }
  buf[len] = idx & 0xff; buf[len + 1] = (idx >> 8) & 0xff; buf[len + 2] = (idx >> 16) & 0xff; buf[len + 3] = idx >> 24;
  len += 4;
  hmac_sha512(n->c, 32, buf, len, z);
  buf[0] = (idx & H) ? 0x01 : 0x03;
  hmac_sha512(n->c, 32, buf, len, ch);
  uint8_t nk[64];
  card_add28mul8(n->k, z, nk);
  card_add256(n->k + 32, z + 32, nk + 32);
  memcpy(n->k, nk, 64);
  memcpy(n->c, ch + 32, 32);
  ed25519_publickey_ext(n->k, n->pub);
  memzero(buf, sizeof buf); memzero(z, sizeof z); memzero(ch, sizeof ch); memzero(nk, sizeof nk);
}

// Icarus master key from the BIP39 entropy, empty passphrase
static int card_master(const char* mnemonic, CardNode* n) {
  uint8_t ent[33], data[128];
  int rc = -1;
  size_t bits = mnemonic_to_bits(mnemonic, ent);
  if (bits == 0 || bits % 33) goto out;
  size_t entlen = bits * 32 / 33 / 8;
  PBKDF2_HMAC_SHA512_CTX pc;
  for (uint32_t blk = 1; blk <= 2; blk++) {   // 96 bytes = two SHA-512 blocks
    pbkdf2_hmac_sha512_Init(&pc, (const uint8_t*)"", 0, ent, entlen, blk);
    pbkdf2_hmac_sha512_Update(&pc, 4096);
    pbkdf2_hmac_sha512_Final(&pc, data + 64 * (blk - 1));
  }
  memzero(&pc, sizeof pc);
  data[0] &= 0xF8; data[31] &= 0x1F; data[31] |= 0x40;
  memcpy(n->k, data, 64); memcpy(n->c, data + 64, 32);
  ed25519_publickey_ext(n->k, n->pub);
  rc = 0;
out:
  memzero(ent, sizeof ent); memzero(data, sizeof data);
  return rc;
}

// ---------------- rows ----------------
// out_pub = real 32-byte ed25519 key at the SLIP-10 path
static int slip10_pub(const uint8_t seed[64], const uint32_t* p, int depth, uint8_t out_pub[32]) {
  HDNode n;
  int rc = cu_derive(&n, seed, ED25519_NAME, p, depth);
  if (!rc) memcpy(out_pub, n.public_key + 1, 32);
  memzero(&n, sizeof n);
  return rc;
}

int ext_ed_derive(const char* mnemonic, const uint8_t seed[64], ChainAddr* out) {
  uint8_t pub[32];
  CardNode acct, leaf;
  int rc = -1;
  size_t sz;

  // 0x50 Solana m/44'/501'/0'
  { uint32_t p[] = { 44|H, 501|H, 0|H };
    if (slip10_pub(seed, p, 3, pub)) goto done;
    cu_row(&out[0], "SOL Ledger/Trust", "m/44'/501'/0'", "https://solscan.io/account/%s", 0x50);
    sz = CHAIN_ADDR_MAX; b58enc(out[0].addr, &sz, pub, 32);
    memcpy(out[0].raw, pub, 32); out[0].rawlen = 32;
    // Ledger Live's Solana accounts 2-5 (m/44'/501'/1..4'): hardened, so the four public keys
    // ride as record 0x7E (128 bytes) on this row
    for (uint32_t i = 1; i <= 4; i++) {
      uint32_t q[] = { 44|H, 501|H, i|H };
      if (slip10_pub(seed, q, 3, pub)) goto done;
      memcpy(out[0].xraw + 32 * (i - 1), pub, 32);
    }
    out[0].xlen = 128; out[0].ext2 = 0x7E; }

  // 0x51 Solana m/44'/501'
  { uint32_t p[] = { 44|H, 501|H };
    if (slip10_pub(seed, p, 2, pub)) goto done;
    cu_row(&out[1], "SOL root (old)", "m/44'/501'", "https://solscan.io/account/%s", 0x51);
    sz = CHAIN_ADDR_MAX; b58enc(out[1].addr, &sz, pub, 32);
    memcpy(out[1].raw, pub, 32); out[1].rawlen = 32; }

  // 0x52 Stellar: StrKey G...
  { uint32_t p[] = { 44|H, 148|H, 0|H };
    if (slip10_pub(seed, p, 3, pub)) goto done;
    cu_row(&out[2], "Stellar XLM", "m/44'/148'/0'", "https://stellar.expert/explorer/public/account/%s", 0x52);
    uint8_t b[35]; b[0] = 6 << 3; memcpy(b + 1, pub, 32);
    uint16_t c = crc16_xmodem(b, 33); b[33] = c & 0xff; b[34] = c >> 8;
    base32_nopad(b, 35, out[2].addr);
    memcpy(out[2].raw, pub, 32); out[2].rawlen = 32; }

  // 0x53 Tezos tz1: base58check(06 a1 9f || blake2b-160(pub))
  { uint32_t p[] = { 44|H, 1729|H, 0|H, 0|H };
    if (slip10_pub(seed, p, 4, pub)) goto done;
    cu_row(&out[3], "Tezos tz1", "m/44'/1729'/0'/0'", "https://tzkt.io/%s", 0x53);
    uint8_t b[23] = { 0x06, 0xa1, 0x9f };
    blake2b(pub, 32, b + 3, 20);
    base58_encode_check(b, 23, HASHER_SHA2D, out[3].addr, CHAIN_ADDR_MAX);
    memcpy(out[3].raw, b + 3, 20); out[3].rawlen = 20; }

  // 0x54 NEAR implicit account: hex(pub)
  { uint32_t p[] = { 44|H, 397|H, 0|H };
    if (slip10_pub(seed, p, 3, pub)) goto done;
    cu_row(&out[4], "NEAR", "m/44'/397'/0'", "https://nearblocks.io/address/%s", 0x54);
    hex_plain(pub, 32, out[4].addr);
    memcpy(out[4].raw, pub, 32); out[4].rawlen = 32; }

  // 0x55 Algorand: base32(pub || sha512_256(pub)[28..32])
  { uint32_t p[] = { 44|H, 283|H, 0|H, 0|H, 0|H };
    if (slip10_pub(seed, p, 5, pub)) goto done;
    cu_row(&out[5], "Algorand", "m/44'/283'/0'/0'/0'", "https://allo.info/account/%s", 0x55);
    uint8_t b[36], h[32]; memcpy(b, pub, 32);
    sha512_256(pub, 32, h); memcpy(b + 32, h + 28, 4);
    base32_nopad(b, 36, out[5].addr);
    memcpy(out[5].raw, pub, 32); out[5].rawlen = 32; }

  // 0x56 MultiversX erd1...
  { uint32_t p[] = { 44|H, 508|H, 0|H, 0|H, 0|H };
    if (slip10_pub(seed, p, 5, pub)) goto done;
    cu_row(&out[6], "MultiversX EGLD", "m/44'/508'/0'/0'/0'", "https://explorer.multiversx.com/accounts/%s", 0x56);
    cu_bech32_bytes("erd", pub, 32, out[6].addr);
    memcpy(out[6].raw, pub, 32); out[6].rawlen = 32; }

  // 0x57 Hedera: public key (account id is assigned on chain; the page looks it up)
  { uint32_t p[] = { 44|H, 3030|H, 0|H, 0|H, 0|H };
    if (slip10_pub(seed, p, 5, pub)) goto done;
    cu_row(&out[7], "Hedera HBAR", "m/44'/3030'/0'/0'/0'", NULL, 0x57);
    hex_plain(pub, 32, out[7].addr);
    memcpy(out[7].raw, pub, 32); out[7].rawlen = 32; }

  // 0x58 IOTA (rebased): 0x || blake2b-256(0x00 || pub)
  { uint32_t p[] = { 44|H, 4218|H, 0|H, 0|H, 0|H };
    if (slip10_pub(seed, p, 5, pub)) goto done;
    cu_row(&out[8], "IOTA", "m/44'/4218'/0'/0'/0'", "https://explorer.iota.org/address/%s", 0x58);
    uint8_t b[33], h[32]; b[0] = 0x00; memcpy(b + 1, pub, 32);
    blake2b(b, 33, h, 32);
    cu_hex_0x(h, 32, out[8].addr);
    memcpy(out[8].raw, h, 32); out[8].rawlen = 32; }

  // 0x59 TON (Trust Wallet path): public key; the page computes the wallet contract address
  { uint32_t p[] = { 44|H, 607|H, 0|H };
    if (slip10_pub(seed, p, 3, pub)) goto done;
    cu_row(&out[9], "TON (Trust path)", "m/44'/607'/0'", NULL, 0x59);
    hex_plain(pub, 32, out[9].addr);
    memcpy(out[9].raw, pub, 32); out[9].rawlen = 32; }

  // 0x60 Cardano Shelley base address (Icarus master key, CIP-1852)
  { if (card_master(mnemonic, &acct)) goto done;
    card_ckd(&acct, 1852|H); card_ckd(&acct, 1815|H); card_ckd(&acct, 0|H);
    uint8_t b[57]; b[0] = 0x01;
    leaf = acct; card_ckd(&leaf, 0); card_ckd(&leaf, 0);
    blake2b(leaf.pub, 32, b + 1, 28);
    leaf = acct; card_ckd(&leaf, 2); card_ckd(&leaf, 0);
    blake2b(leaf.pub, 32, b + 29, 28);
    cu_row(&out[10], "Cardano ADA", "m/1852'/1815'/0'/0/0", "https://cardanoscan.io/address/%s", 0x60);
    bech32_long("addr", b, 57, out[10].addr);
    memcpy(out[10].raw, b + 1, 56); out[10].rawlen = 56; }

  rc = 0;
done:
  memzero(pub, sizeof pub);
  memzero(&acct, sizeof acct);
  memzero(&leaf, sizeof leaf);
  return rc;
}

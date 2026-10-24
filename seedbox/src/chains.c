// chains.c - see chains.h
#include "chains.h"
#include "chains_util.h"
#include <string.h>
#include <stdio.h>
#include "trezor/bip32.h"
#include "trezor/bip39.h"
#include "trezor/curves.h"
#include "trezor/ecdsa.h"
#include "trezor/secp256k1.h"
#include "trezor/sha3.h"
#include "trezor/base58.h"
#include "trezor/segwit_addr.h"
#include "trezor/blake2b.h"
#include "trezor/memzero.h"
#include "trezor/rand.h"

// ---- RNG hook ----
// trezor-crypto randomizes projective coordinates during EC multiplication
// (side-channel blinding) and loops until it gets a non-zero value, so the
// RNG must never return all zeros. The sketch installs the RP2350 TRNG via
// chains_set_rng(); the fallback is a xorshift PRNG so nothing can hang.
// The RNG never affects which addresses come out, only side-channel noise.
static void (*g_rng)(uint8_t*, size_t) = 0;
static uint64_t g_xs = 0x9E3779B97F4A7C15ull;
void chains_set_rng(void (*fill)(uint8_t*, size_t)) { g_rng = fill; }
void random_buffer(uint8_t* buf, size_t len) {
  if (g_rng) { g_rng(buf, len); return; }
  for (size_t i = 0; i < len; i++) {
    g_xs ^= g_xs << 13; g_xs ^= g_xs >> 7; g_xs ^= g_xs << 17;
    buf[i] = (uint8_t)(g_xs >> 24);
  }
}

// trezor-crypto's fault-injection checks call this. Halt rather than continue
// with possibly corrupted key material. The sketch can't be reached from here,
// so just spin; the idle wipe doesn't run but nothing secret is displayed either.
void tc_fault_handler(const char* msg) { (void)msg; for (;;) {} }


// ---------------- helpers ----------------
int cu_derive(HDNode* n, const uint8_t seed[64], const char* curve, const uint32_t* path, int depth) {
  if (!hdnode_from_seed(seed, 64, curve, n)) return -1;
  for (int i = 0; i < depth; i++) if (!hdnode_private_ckd(n, path[i])) return -1;
  hdnode_fill_public_key(n);
  return 0;
}

void cu_hex_0x(const uint8_t* b, int n, char* out) {
  static const char hx[] = "0123456789abcdef";
  out[0] = '0'; out[1] = 'x';
  for (int i = 0; i < n; i++) { out[2 + 2*i] = hx[b[i] >> 4]; out[3 + 2*i] = hx[b[i] & 15]; }
  out[2 + 2*n] = 0;
}

// keccak256(uncompressed pubkey)[12..32]
void cu_eth_addr_bytes(const HDNode* n, uint8_t out[20]) {
  uint8_t pub65[65], h[32];
  ecdsa_get_public_key65(&secp256k1, n->private_key, pub65);
  keccak_256(pub65 + 1, 64, h);
  memcpy(out, h + 12, 20);
  memzero(pub65, sizeof pub65);
}

// EIP-55 mixed-case checksum
void cu_eth_checksum(const uint8_t a[20], char* out) {
  char low[43]; cu_hex_0x(a, 20, low);
  uint8_t h[32]; keccak_256((const uint8_t*)low + 2, 40, h);
  out[0] = '0'; out[1] = 'x';
  for (int i = 0; i < 40; i++) {
    char c = low[2 + i];
    int nib = (i & 1) ? (h[i / 2] & 0xF) : (h[i / 2] >> 4);
    if (c >= 'a' && nib >= 8) c -= 32;
    out[2 + i] = c;
  }
  out[42] = 0;
}

void cu_bech32_bytes(const char* hrp, const uint8_t* in, size_t inlen, char* out) {
  uint8_t d5[64]; size_t o = 0; uint32_t acc = 0; int bits = 0;
  for (size_t i = 0; i < inlen; i++) {
    acc = (acc << 8) | in[i]; bits += 8;
    while (bits >= 5) { bits -= 5; d5[o++] = (acc >> bits) & 31; }
  }
  if (bits) d5[o++] = (acc << (5 - bits)) & 31;
  bech32_encode(out, hrp, d5, o, BECH32_ENCODING_BECH32);
}

// XRP uses base58check with a shuffled alphabet; same algorithm, so just remap characters.
static void xrp_remap(char* s) {
  static const char BTC_A[] = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  static const char XRP_A[] = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
  for (; *s; s++) { const char* p = strchr(BTC_A, *s); if (p) *s = XRP_A[p - BTC_A]; }
}

// ---------------- chain table ----------------
typedef struct { const char* name; const char* path; const char* link; } ChainInfo;

static const ChainInfo CHAINS[] = {
  { "ETH / all EVM",     "m/44'/60'/0'/0/0",     "https://app.zerion.io/%s/overview" },
  { "BTC zpub (segwit)", "m/84'/0'/0'",          "https://blockchair.com/bitcoin/xpub/%s" },
  { "BTC addr 1",        "m/84'/0'/0'/0/0",      "https://mempool.space/address/%s" },
  { "BTC xpub (legacy)", "m/44'/0'/0'",          "https://blockchair.com/bitcoin/xpub/%s" },
  { "LTC",               "m/84'/2'/0'/0/0",      "https://blockchair.com/litecoin/address/%s" },
  { "DOGE",              "m/44'/3'/0'/0/0",      "https://blockchair.com/dogecoin/address/%s" },
  { "SOL",               "m/44'/501'/0'/0'",     "https://solscan.io/account/%s" },
  { "TRX",               "m/44'/195'/0'/0/0",    "https://tronscan.org/#/address/%s" },
  { "ATOM",              "m/44'/118'/0'/0/0",    "https://www.mintscan.io/cosmos/address/%s" },
  { "OSMO",              "m/44'/118'/0'/0/0",    "https://www.mintscan.io/osmosis/address/%s" },
  { "TIA",               "m/44'/118'/0'/0/0",    "https://www.mintscan.io/celestia/address/%s" },
  { "DYDX",              "m/44'/118'/0'/0/0",    "https://www.mintscan.io/dydx/address/%s" },
  { "SEI",               "m/44'/118'/0'/0/0",    "https://www.mintscan.io/sei/address/%s" },
  { "AKT",               "m/44'/118'/0'/0/0",    "https://www.mintscan.io/akash/address/%s" },
  { "JUNO",              "m/44'/118'/0'/0/0",    "https://www.mintscan.io/juno/address/%s" },
  { "STARS",             "m/44'/118'/0'/0/0",    "https://www.mintscan.io/stargaze/address/%s" },
  { "INJ",               "m/44'/60'/0'/0/0",     "https://www.mintscan.io/injective/address/%s" },
  { "XRP",               "m/44'/144'/0'/0/0",    "https://xrpscan.com/account/%s" },
  { "SUI",               "m/44'/784'/0'/0'/0'",  "https://suiscan.xyz/mainnet/account/%s" },
  { "APT",               "m/44'/637'/0'/0'/0'",  "https://explorer.aptoslabs.com/account/%s?network=mainnet" },
};
#define N_CHAINS ((int)(sizeof CHAINS / sizeof CHAINS[0]))

int chains_count(void) { return N_CHAINS + ext_utxo_count() + ext_cosmos_count() + ext_ed_count(); }

void cu_row(ChainAddr* r, const char* name, const char* path, const char* link, uint8_t ext) {
  r->name = name; r->path = path; r->link = link; r->ext = ext; r->addr[0] = 0; r->rawlen = 0;
}

static const char* COSMOS_HRP[] = { "cosmos", "osmo", "celestia", "dydx", "sei", "akash", "juno", "stars" };

int derive_all(const char* mnemonic, const char* passphrase, ChainAddr* out,
               void (*progress)(int done, int total)) {
  uint8_t seed[64];
  HDNode n, parent;
  int rc = -1, k = 0;
  if (chains_count() > CHAINS_MAX) return -1;   // every ChainAddr array is CHAINS_MAX long
  memset(out, 0, sizeof(ChainAddr) * chains_count());
  for (int i = 0; i < N_CHAINS; i++) { out[i].name = CHAINS[i].name; out[i].path = CHAINS[i].path; out[i].link = CHAINS[i].link; }
  if (progress) progress(0, chains_count());

  mnemonic_to_seed(mnemonic, passphrase, seed, NULL);

  // ---- ETH (and INJ, which is the ETH key with a bech32 wrapper) ----
  { uint32_t p[] = { 44|H, 60|H, 0|H, 0, 0 };
    if (cu_derive(&n, seed, SECP256K1_NAME, p, 5)) goto done;
    uint8_t a[20]; cu_eth_addr_bytes(&n, a);
    cu_eth_checksum(a, out[0].addr);          k = 1;  if (progress) progress(k, chains_count());
    cu_bech32_bytes("inj", a, 20, out[16].addr);
    memcpy(out[0].raw, a, 20);  out[0].rawlen = 20;
    memcpy(out[16].raw, a, 20); out[16].rawlen = 20; }

  // ---- BTC zpub + first native segwit address ----
  { uint32_t p[] = { 84|H, 0|H };
    if (cu_derive(&parent, seed, SECP256K1_NAME, p, 2)) goto done;
    uint32_t fp = hdnode_fingerprint(&parent);
    n = parent;
    if (!hdnode_private_ckd(&n, 0|H)) goto done;
    hdnode_fill_public_key(&n);
    hdnode_serialize_public(&n, fp, 0x04b24746, out[1].addr, CHAIN_ADDR_MAX);   // "zpub"
    k = 2; if (progress) progress(k, chains_count());
    if (!hdnode_private_ckd(&n, 0) || !hdnode_private_ckd(&n, 0)) goto done;
    hdnode_fill_public_key(&n);
    uint8_t pkh[20]; ecdsa_get_pubkeyhash(n.public_key, HASHER_SHA2_RIPEMD, pkh);
    segwit_addr_encode(out[2].addr, "bc", 0, pkh, 20);
    memcpy(out[2].raw, pkh, 20); out[2].rawlen = 20;
    k = 3; if (progress) progress(k, chains_count()); }

  // ---- BTC legacy xpub ----
  { uint32_t p[] = { 44|H, 0|H };
    if (cu_derive(&parent, seed, SECP256K1_NAME, p, 2)) goto done;
    uint32_t fp = hdnode_fingerprint(&parent);
    n = parent;
    if (!hdnode_private_ckd(&n, 0|H)) goto done;
    hdnode_fill_public_key(&n);
    hdnode_serialize_public(&n, fp, 0x0488B21E, out[3].addr, CHAIN_ADDR_MAX);   // "xpub"
    if (!hdnode_private_ckd(&n, 0) || !hdnode_private_ckd(&n, 0)) goto done;   // first legacy address, raw only
    hdnode_fill_public_key(&n);
    ecdsa_get_pubkeyhash(n.public_key, HASHER_SHA2_RIPEMD, out[3].raw); out[3].rawlen = 20;
    k = 4; if (progress) progress(k, chains_count()); }

  // ---- LTC native segwit ----
  { uint32_t p[] = { 84|H, 2|H, 0|H, 0, 0 };
    if (cu_derive(&n, seed, SECP256K1_NAME, p, 5)) goto done;
    uint8_t pkh[20]; ecdsa_get_pubkeyhash(n.public_key, HASHER_SHA2_RIPEMD, pkh);
    segwit_addr_encode(out[4].addr, "ltc", 0, pkh, 20);
    memcpy(out[4].raw, pkh, 20); out[4].rawlen = 20;
    k = 5; if (progress) progress(k, chains_count()); }

  // ---- DOGE P2PKH ----
  { uint32_t p[] = { 44|H, 3|H, 0|H, 0, 0 };
    if (cu_derive(&n, seed, SECP256K1_NAME, p, 5)) goto done;
    ecdsa_get_address(n.public_key, 0x1e, HASHER_SHA2_RIPEMD, HASHER_SHA2D, out[5].addr, CHAIN_ADDR_MAX);
    ecdsa_get_pubkeyhash(n.public_key, HASHER_SHA2_RIPEMD, out[5].raw); out[5].rawlen = 20;
    k = 6; if (progress) progress(k, chains_count()); }

  // ---- SOL (SLIP-10 ed25519, Phantom/Solflare default path) ----
  { uint32_t p[] = { 44|H, 501|H, 0|H, 0|H };
    if (cu_derive(&n, seed, ED25519_NAME, p, 4)) goto done;
    size_t sz = CHAIN_ADDR_MAX; b58enc(out[6].addr, &sz, n.public_key + 1, 32);
    memcpy(out[6].raw, n.public_key + 1, 32); out[6].rawlen = 32;
    k = 7; if (progress) progress(k, chains_count()); }

  // ---- TRX ----
  { uint32_t p[] = { 44|H, 195|H, 0|H, 0, 0 };
    if (cu_derive(&n, seed, SECP256K1_NAME, p, 5)) goto done;
    uint8_t raw[21]; raw[0] = 0x41; cu_eth_addr_bytes(&n, raw + 1);
    base58_encode_check(raw, 21, HASHER_SHA2D, out[7].addr, CHAIN_ADDR_MAX);
    memcpy(out[7].raw, raw + 1, 20); out[7].rawlen = 20;
    k = 8; if (progress) progress(k, chains_count()); }

  // ---- Cosmos family: one key, many prefixes ----
  { uint32_t p[] = { 44|H, 118|H, 0|H, 0, 0 };
    if (cu_derive(&n, seed, SECP256K1_NAME, p, 5)) goto done;
    uint8_t pkh[20]; ecdsa_get_pubkeyhash(n.public_key, HASHER_SHA2_RIPEMD, pkh);
    for (int i = 0; i < 8; i++) {
      cu_bech32_bytes(COSMOS_HRP[i], pkh, 20, out[8 + i].addr);
      memcpy(out[8 + i].raw, pkh, 20); out[8 + i].rawlen = 20;
    }
    k = 17; if (progress) progress(k, chains_count()); }   // 16 = INJ, already filled

  // ---- XRP ----
  { uint32_t p[] = { 44|H, 144|H, 0|H, 0, 0 };
    if (cu_derive(&n, seed, SECP256K1_NAME, p, 5)) goto done;
    uint8_t raw[21]; raw[0] = 0x00; ecdsa_get_pubkeyhash(n.public_key, HASHER_SHA2_RIPEMD, raw + 1);
    base58_encode_check(raw, 21, HASHER_SHA2D, out[17].addr, CHAIN_ADDR_MAX);
    xrp_remap(out[17].addr);
    memcpy(out[17].raw, raw + 1, 20); out[17].rawlen = 20;
    k = 18; if (progress) progress(k, chains_count()); }

  // ---- SUI: blake2b-256(0x00 || pubkey) ----
  { uint32_t p[] = { 44|H, 784|H, 0|H, 0|H, 0|H };
    if (cu_derive(&n, seed, ED25519_NAME, p, 5)) goto done;
    uint8_t buf[33], h[32]; buf[0] = 0x00; memcpy(buf + 1, n.public_key + 1, 32);
    blake2b(buf, 33, h, 32);
    cu_hex_0x(h, 32, out[18].addr);
    memcpy(out[18].raw, h, 32); out[18].rawlen = 32;
    k = 19; if (progress) progress(k, chains_count()); }

  // ---- APT: sha3-256(pubkey || 0x00) ----
  { uint32_t p[] = { 44|H, 637|H, 0|H, 0|H, 0|H };
    if (cu_derive(&n, seed, ED25519_NAME, p, 5)) goto done;
    uint8_t buf[33], h[32]; memcpy(buf, n.public_key + 1, 32); buf[32] = 0x00;
    sha3_256(buf, 33, h);
    cu_hex_0x(h, 32, out[19].addr);
    memcpy(out[19].raw, h, 32); out[19].rawlen = 32;
    k = 20; if (progress) progress(k, chains_count()); }

  // ---- extension groups (animated "more chains" frames) ----
  { int total = chains_count(), at = N_CHAINS;
    if (progress) progress(at, total);
    if (ext_utxo_derive(mnemonic, seed, out + at) < 0) goto done;   at += ext_utxo_count();   if (progress) progress(at, total);
    if (ext_cosmos_derive(mnemonic, seed, out + at) < 0) goto done; at += ext_cosmos_count(); if (progress) progress(at, total);
    if (ext_ed_derive(mnemonic, seed, out + at) < 0) goto done;     at += ext_ed_count();     if (progress) progress(at, total); }

  rc = 0;
done:
  memzero(seed, sizeof seed);
  memzero(&n, sizeof n);
  memzero(&parent, sizeof parent);
  return rc;
}

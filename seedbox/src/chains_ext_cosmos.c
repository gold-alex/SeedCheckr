// chains_ext_cosmos.c - Cosmos-SDK chains with their own coin type (not 118 or 60)
// Rows here are appended after the 20 core rows by derive_all() and carried in the
// animated "more chains" QR frames (record type = row.ext, see docs/EXTENSIONS.md).
//
// Every row: m/44'/C'/0'/0/0 secp256k1, raw = RIPEMD160(SHA256(compressed pubkey)),
// shown as bech32 with the chain's prefix. THORChain and Maya share coin type 931,
// so one row (thor1...) covers both; the results page re-encodes the bytes as maya1.
#include <string.h>
#include "chains.h"
#include "chains_util.h"
#include "trezor/curves.h"
#include "trezor/ecdsa.h"
#include "trezor/memzero.h"

typedef struct {
  uint16_t coin;
  uint8_t ext;
  const char* hrp;
  const char* name;
  const char* path;
  const char* link;
} CosmosExt;

static const CosmosExt ROWS[] = {
  { 330, 0x30, "terra",       "LUNA (Terra)",      "m/44'/330'/0'/0/0", "https://www.mintscan.io/terra/address/%s" },
  { 459, 0x31, "kava",        "KAVA",              "m/44'/459'/0'/0/0", "https://www.mintscan.io/kava/address/%s" },
  { 529, 0x32, "secret",      "SCRT",              "m/44'/529'/0'/0/0", "https://www.mintscan.io/secret/address/%s" },
  { 394, 0x33, "cro",         "CRO (Cronos POS)",  "m/44'/394'/0'/0/0", "https://www.mintscan.io/crypto-org/address/%s" },
  { 494, 0x34, "band",        "BAND",              "m/44'/494'/0'/0/0", "https://www.mintscan.io/band/address/%s" },
  { 931, 0x35, "thor",        "RUNE / CACAO",      "m/44'/931'/0'/0/0", "https://runescan.io/address/%s" },
  { 639, 0x36, "bitsong",     "BTSG",              "m/44'/639'/0'/0/0", "https://ping.pub/bitsong/account/%s" },
  { 852, 0x37, "desmos",      "DSM",               "m/44'/852'/0'/0/0", "https://ping.pub/desmos/account/%s" },
  { 750, 0x38, "persistence", "XPRT (old 750)",    "m/44'/750'/0'/0/0", "https://www.mintscan.io/persistence/address/%s" },
  { 880, 0x39, "lum",         "LUM",               "m/44'/880'/0'/0/0", "https://ping.pub/lum-network/account/%s" },
  { 505, 0x3A, "pb",          "HASH (Provenance)", "m/44'/505'/0'/0/0", "https://explorer.provenance.io/accounts/%s" },
  { 990, 0x3B, "core",        "COREUM",            "m/44'/990'/0'/0/0", "https://www.mintscan.io/coreum/address/%s" },
  { 564, 0x3C, "agoric",      "BLD (Agoric)",      "m/44'/564'/0'/0/0", "https://www.mintscan.io/agoric/address/%s" },
};
#define N_ROWS ((int)(sizeof ROWS / sizeof ROWS[0]))

int ext_cosmos_count(void) { return N_ROWS; }

// Fills ext_cosmos_count() rows. Returns 0 on success, -1 on failure.
// m/44' is derived once and every row branches from it (hardened steps cost only an
// HMAC; the two soft steps and the final public key are 3 EC multiplications per row).
int ext_cosmos_derive(const char* mnemonic, const uint8_t seed[64], ChainAddr* out) {
  (void)mnemonic;
  HDNode root, n;
  int rc = -1;
  if (!hdnode_from_seed(seed, 64, SECP256K1_NAME, &root)) goto done;
  if (!hdnode_private_ckd(&root, 44 | H)) goto done;

  for (int i = 0; i < N_ROWS; i++) {
    const CosmosExt* c = &ROWS[i];
    n = root;
    if (!hdnode_private_ckd(&n, c->coin | H)) goto done;
    if (!hdnode_private_ckd(&n, 0 | H)) goto done;
    if (!hdnode_private_ckd(&n, 0)) goto done;
    if (!hdnode_private_ckd(&n, 0)) goto done;
    hdnode_fill_public_key(&n);
    cu_row(&out[i], c->name, c->path, c->link, c->ext);
    ecdsa_get_pubkeyhash(n.public_key, HASHER_SHA2_RIPEMD, out[i].raw);
    out[i].rawlen = 20;
    cu_bech32_bytes(c->hrp, out[i].raw, 20, out[i].addr);
  }
  rc = 0;
done:
  memzero(&root, sizeof root);
  memzero(&n, sizeof n);
  return rc;
}

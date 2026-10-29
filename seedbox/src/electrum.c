// electrum.c - see electrum.h
#include "electrum.h"
#include "chains_util.h"
#include <string.h>
#include "trezor/hmac.h"
#include "trezor/pbkdf2.h"
#include "trezor/curves.h"
#include "trezor/ecdsa.h"
#include "trezor/secp256k1.h"
#include "trezor/segwit_addr.h"
#include "trezor/memzero.h"

ElectrumType electrum_seed_type(const char* mnemonic, int nwords) {
  uint8_t h[64];
  hmac_sha512((const uint8_t*)"Seed version", 12, (const uint8_t*)mnemonic, strlen(mnemonic), h);
  // the hex digest starts with the prefix: "01", "100", "101", "102"
  int hi = h[1] >> 4;
  ElectrumType t = ELECTRUM_NONE;
  if (h[0] == 0x01) t = ELECTRUM_STANDARD;
  else if (h[0] == 0x10 && hi == 0) t = ELECTRUM_SEGWIT;
  else if (h[0] == 0x10 && hi == 1 && (nwords == 12 || nwords >= 20)) t = ELECTRUM_2FA;
  else if (h[0] == 0x10 && hi == 2) t = ELECTRUM_2FA_SEGWIT;
  memzero(h, sizeof h);
  return t;
}

// Electrum's normalize_text() for the passphrase ("seed extension"), on printable ASCII:
// lowercase, runs of whitespace to one space, none at either end.
static int normalize(const char* in, char* out, int cap) {
  int n = 0, space = 0;
  for (const char* c = in; *c; c++) {
    if (*c == ' ' || (*c >= '\t' && *c <= '\r')) { space = n > 0; continue; }
    if (n + space + 1 >= cap) return -1;
    if (space) { out[n++] = ' '; space = 0; }
    out[n++] = (*c >= 'A' && *c <= 'Z') ? *c + 32 : *c;
  }
  out[n] = 0;
  return n;
}

int derive_electrum(const char* mnemonic, const char* passphrase, ElectrumType t, ChainAddr* out,
                    void (*progress)(int done, int total)) {
  if (t != ELECTRUM_STANDARD && t != ELECTRUM_SEGWIT) return -1;
  const int sw = (t == ELECTRUM_SEGWIT);
  uint8_t salt[8 + 256], seed[64];
  HDNode n;
  int rc = -1;
  memset(out, 0, sizeof(ChainAddr) * ELECTRUM_ROWS);
  cu_row(&out[0], sw ? "BTC zpub (Electrum)" : "BTC xpub (Electrum)", sw ? "m/0'" : "m", "https://blockchair.com/bitcoin/xpub/%s", 0);
  cu_row(&out[1], "BTC addr 1", sw ? "m/0'/0/0" : "m/0/0", "https://mempool.space/address/%s", 0);
  if (progress) progress(0, ELECTRUM_ROWS);
  memcpy(salt, "electrum", 8);
  int plen = normalize(passphrase, (char*)salt + 8, sizeof salt - 8);
  if (plen < 0) goto done;
  pbkdf2_hmac_sha512((const uint8_t*)mnemonic, strlen(mnemonic), salt, 8 + plen, 2048, seed, 64);
  if (!hdnode_from_seed(seed, 64, SECP256K1_NAME, &n)) goto done;
  hdnode_fill_public_key(&n);
  uint32_t fp = 0;
  if (sw) {
    fp = hdnode_fingerprint(&n);
    if (!hdnode_private_ckd(&n, 0 | H)) goto done;
    hdnode_fill_public_key(&n);
  }
  hdnode_serialize_public(&n, fp, sw ? 0x04b24746 : 0x0488B21E, out[0].addr, CHAIN_ADDR_MAX);   // zpub / xpub
  out[0].xraw[0] = fp >> 24; out[0].xraw[1] = fp >> 16; out[0].xraw[2] = fp >> 8; out[0].xraw[3] = fp;
  memcpy(out[0].xraw + 4, n.chain_code, 32);
  memcpy(out[0].xraw + 36, n.public_key, 33);
  out[0].xlen = 69;                                       // ext2 stays 0: no moving QR for this wallet
  if (progress) progress(1, ELECTRUM_ROWS);
  if (!hdnode_private_ckd(&n, 0) || !hdnode_private_ckd(&n, 0)) goto done;
  hdnode_fill_public_key(&n);
  ecdsa_get_pubkeyhash(n.public_key, HASHER_SHA2_RIPEMD, out[1].raw); out[1].rawlen = 20;
  if (sw) segwit_addr_encode(out[1].addr, "bc", 0, out[1].raw, 20);
  else ecdsa_get_address(n.public_key, 0x00, HASHER_SHA2_RIPEMD, HASHER_SHA2D, out[1].addr, CHAIN_ADDR_MAX);
  if (progress) progress(2, ELECTRUM_ROWS);
  rc = 0;
done:
  memzero(&n, sizeof n); memzero(seed, sizeof seed); memzero(salt, sizeof salt);
  return rc;
}

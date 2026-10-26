// chains.h - derive public addresses / extended public keys for many chains
// from a BIP39 mnemonic. Plain C on top of trezor-crypto. Private key material
// exists only inside derive_all() and is zeroed before it returns.
#pragma once
#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define CHAIN_ADDR_MAX 120   // longest output is a 111-char zpub/xpub

typedef struct {
  const char* name;    // short label for the menu, e.g. "ETH / all EVM"
  const char* path;    // derivation path shown on screen
  const char* link;    // explorer URL prefix; address is appended (NULL = none)
  char addr[CHAIN_ADDR_MAX];
  uint8_t raw[64];     // the bytes behind addr: 20-byte hash for secp256k1 chains, 32 for SOL/SUI/APT,
                       // up to 64 for extension rows (e.g. Cardano: payment + stake key hash)
  uint8_t rawlen;      // 0 on the zpub row; on the legacy xpub row it is the pkh of m/44'/0'/0'/0/0
  uint8_t ext;         // 0 = core row (in the v1 portfolio QR). Otherwise the record type this row
                       // gets in the animated "more chains" frames; see docs/EXTENSIONS.md
  uint8_t ext2;        // optional second record from the same row: the account's extended public key
  uint8_t xlen;        // (parent fingerprint, chain code, compressed key) so the page can scan every
  uint8_t xraw[138];   // address of the wallet, not just the first one (0x7B-0x7F: several accounts). 0 = none.
} ChainAddr;           // raw feeds the one-scan portfolio QR, see portfolio.h

#define CHAINS_MAX 128   // upper bound on chains_count(); size ChainAddr arrays with this

// Number of entries derive_all() produces.
int chains_count(void);

// mnemonic: space separated words. passphrase: "" for none.
// out must have room for chains_count() entries.
// progress(done,total) is called between chains so the UI can draw a bar; may be NULL.
// Returns 0 on success.
int derive_all(const char* mnemonic, const char* passphrase, ChainAddr* out,
               void (*progress)(int done, int total));

// Optional RNG hook required by trezor-crypto's link step (only used for signing,
// which this device never does). Fill with anything; defaults to zeros.
void chains_set_rng(void (*fill)(uint8_t* buf, size_t len));

#ifdef __cplusplus
}
#endif

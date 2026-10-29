// electrum.h - Electrum's own seeds (Electrum 2.0 and later): words from the BIP39 English
// list, but no BIP39 checksum. The version is an HMAC of the words instead, and the wallet is
// Bitcoin only. Follows electrum/mnemonic.py; checked against Electrum's own test vectors in
// test/verify_electrum.js.
#pragma once
#include <stdint.h>
#include "chains.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
  ELECTRUM_NONE = 0,
  ELECTRUM_STANDARD,     // "01":  P2PKH (1...), keys at m/0/i (receive) and m/1/i (change)
  ELECTRUM_SEGWIT,       // "100": P2WPKH (bc1q...), keys at m/0'/0/i and m/0'/1/i
  ELECTRUM_2FA,          // "101": TrustedCoin 2-of-3, not supported here
  ELECTRUM_2FA_SEGWIT,   // "102": the same, segwit
} ElectrumType;

// mnemonic: lowercase words joined by single spaces (what the box builds). Electrum's
// calc_seed_type(), less its pre-2.0 "old" seeds (a different word list).
ElectrumType electrum_seed_type(const char* mnemonic, int nwords);

// Rows derive_electrum() fills: the wallet's extended public key (zpub at m/0' for segwit,
// xpub of the root for standard; its fp || chain code || key in xraw, xlen 69, ext2 0 so
// no moving QR) and the first receive address.
#define ELECTRUM_ROWS 2
int derive_electrum(const char* mnemonic, const char* passphrase, ElectrumType t, ChainAddr* out,
                    void (*progress)(int done, int total));

#ifdef __cplusplus
}
#endif

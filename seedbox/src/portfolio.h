// portfolio.h - pack every derived address into one QR so the web page
// (docs/index.html in the repo) can check all chains from a single scan.
//
// Payload v1 is 257 bytes: one version byte, then the raw address bytes of
// each distinct key (see portfolio.c for the layout). The web page re-derives
// the bech32 / base58 / EIP-55 strings itself and expands the Cosmos key to
// all eight chains and the EVM key to INJ, so none of that costs QR space.
//
// The bytes are sent as base43 text (QR alphanumeric charset, minus ' ' and
// '%' which are not URL-fragment safe). Alphanumeric mode packs 5.5 bits per
// character against 8 for byte mode; together with a byte-mode segment for the
// URL prefix, the whole thing fits a version 11 QR (61x61) at ECC L, which is
// the largest code that still gets 2 px per module on a 128 px tall screen.
//
// Nothing here touches the seed: it only reads the public address material
// that derive_all() already produced.
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "chains.h"

#ifdef __cplusplus
extern "C" {
#endif

#define PORTFOLIO_VERSION   1
#define PORTFOLIO_BYTES     257   // 1 + 8*20 + 3*32
#define PORTFOLIO_TEXT_MAX  400   // base43 of 257 bytes is at most 379 chars, plus NUL

// Builds the payload from the ChainAddr rows derive_all() filled in.
// Returns PORTFOLIO_BYTES, or -1 if a row is missing its raw bytes.
int portfolio_pack(const ChainAddr* rows, uint8_t out[PORTFOLIO_BYTES]);

// Payload as base43 text, ready to append to the page URL after '#'.
// Returns the string length, or -1 on error / if cap is too small.
int portfolio_text(const ChainAddr* rows, char* out, int cap);

// Encodes url_prefix (byte mode) followed by payload (alphanumeric mode) into
// one QR code, choosing the smallest version <= max_version that fits.
// temp and qrcode must each be qrcodegen_BUFFER_LEN_FOR_VERSION(max_version) bytes.
// url_prefix is limited to 64 bytes. Returns false if it does not fit.
bool portfolio_qr(const char* url_prefix, const char* payload,
                  uint8_t* temp, uint8_t* qrcode, int max_version);

#ifdef __cplusplus
}
#endif

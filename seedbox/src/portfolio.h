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

// ---- "more chains": animated frames, format in docs/EXTENSIONS.md ----
// Rows with ext != 0 become records [type][len][raw], in row order. The records
// are split into chunks of 240 bytes, one alphanumeric QR per chunk:
//   SB2 <i> <n> <CRC-32 of all records, 8 hex> <base43 of 0x01 || chunk>
// Nothing is buffered: each call walks the rows again (a few KB at most).
#define PORTFOLIO_FRAME_CHUNK     240
#define PORTFOLIO_FRAME_TEXT_MAX  400   // "SB2 999 999 XXXXXXXX " + 356 base43 chars + NUL

// The extension bytes. out == NULL: just returns their length.
// Returns the length, or -1 if cap is too small.
int portfolio_ext_bytes(const ChainAddr* rows, int n, uint8_t* out, int cap);

// Number of frames, 0 when no row has ext set.
int portfolio_frame_count(const ChainAddr* rows, int n);

// Text of frame i, 1-based (1..portfolio_frame_count()), as the spec numbers them.
// Returns the string length, or -1 if i is out of range or cap is too small.
int portfolio_frame_text(const ChainAddr* rows, int n, int i, char* out, int cap);

// One frame as a QR: alphanumeric mode, ECC L (raised if it fits the same version),
// smallest version <= max_version. temp and qrcode must each be
// qrcodegen_BUFFER_LEN_FOR_VERSION(max_version) bytes. False if it does not fit.
bool portfolio_frame_qr(const char* text, uint8_t* temp, uint8_t* qrcode, int max_version);

#ifdef __cplusplus
}
#endif

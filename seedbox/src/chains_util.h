// chains_util.h - helpers shared by chains.c and the chains_ext_*.c files.
// Internal to the derivation code; nothing here touches the UI.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "chains.h"
#include "trezor/bip32.h"

#define H 0x80000000u   // hardened index flag

#ifdef __cplusplus
extern "C" {
#endif

// seed -> node at path (curve: SECP256K1_NAME, ED25519_NAME, NIST256P1_NAME...), public key filled.
// Returns 0 on success.
int cu_derive(HDNode* n, const uint8_t seed[64], const char* curve, const uint32_t* path, int depth);
void cu_hex_0x(const uint8_t* b, int n, char* out);                  // "0x" + lowercase hex
void cu_eth_addr_bytes(const HDNode* n, uint8_t out[20]);            // keccak256(uncompressed pub)[12..32]
void cu_eth_checksum(const uint8_t a[20], char* out);                // EIP-55 string
void cu_bech32_bytes(const char* hrp, const uint8_t* in, size_t inlen, char* out);   // bech32 (not m) of raw bytes
// Fill one row's labels. Call before writing addr/raw.
void cu_row(ChainAddr* r, const char* name, const char* path, const char* link, uint8_t ext);
// Account-level extended public key as a second record on row r: fp (4, big endian) || chain code (32) ||
// compressed public key (33). node must have its public key filled; fp is its parent's fingerprint.
void cu_xpub_record(ChainAddr* r, uint8_t type, const HDNode* node, uint32_t fp);

// Extension groups (one file each). Each fills its rows after the 20 core rows.
int ext_utxo_count(void);   int ext_utxo_derive(const char* mnemonic, const uint8_t seed[64], ChainAddr* out);
int ext_cosmos_count(void); int ext_cosmos_derive(const char* mnemonic, const uint8_t seed[64], ChainAddr* out);
int ext_ed_count(void);     int ext_ed_derive(const char* mnemonic, const uint8_t seed[64], ChainAddr* out);

#ifdef __cplusplus
}
#endif

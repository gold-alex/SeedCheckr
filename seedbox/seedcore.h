// seedcore.h - SHA-256, BIP39 encode/decode, SeedQR helpers.
// Plain C++, no Arduino dependencies, so it can be unit-tested on a PC.
#pragma once
#include <stdint.h>
#include <string.h>
#include "bip39_words.h"

// ============================================================
// SHA-256 (FIPS 180-4)
// ============================================================
struct Sha256 {
  uint32_t h[8];
  uint8_t  buf[64];
  uint64_t total;   // bytes hashed so far
  size_t   blen;    // bytes waiting in buf
};

static const uint32_t SHA256_K[64] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

static inline uint32_t sha_ror(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

static void sha256_init(Sha256* s) {
  static const uint32_t H0[8] = {
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };
  memcpy(s->h, H0, sizeof H0);
  s->total = 0;
  s->blen = 0;
}

static void sha256_block(uint32_t h[8], const uint8_t* p) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++)
    w[i] = ((uint32_t)p[4*i] << 24) | ((uint32_t)p[4*i+1] << 16) | ((uint32_t)p[4*i+2] << 8) | p[4*i+3];
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = sha_ror(w[i-15], 7) ^ sha_ror(w[i-15], 18) ^ (w[i-15] >> 3);
    uint32_t s1 = sha_ror(w[i-2], 17) ^ sha_ror(w[i-2], 19) ^ (w[i-2] >> 10);
    w[i] = w[i-16] + s0 + w[i-7] + s1;
  }
  uint32_t a=h[0], b=h[1], c=h[2], d=h[3], e=h[4], f=h[5], g=h[6], hh=h[7];
  for (int i = 0; i < 64; i++) {
    uint32_t S1 = sha_ror(e, 6) ^ sha_ror(e, 11) ^ sha_ror(e, 25);
    uint32_t ch = (e & f) ^ (~e & g);
    uint32_t t1 = hh + S1 + ch + SHA256_K[i] + w[i];
    uint32_t S0 = sha_ror(a, 2) ^ sha_ror(a, 13) ^ sha_ror(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = S0 + maj;
    hh = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  h[0]+=a; h[1]+=b; h[2]+=c; h[3]+=d; h[4]+=e; h[5]+=f; h[6]+=g; h[7]+=hh;
}

static void sha256_update(Sha256* s, const uint8_t* data, size_t len) {
  s->total += len;
  while (len) {
    size_t n = 64 - s->blen; if (n > len) n = len;
    memcpy(s->buf + s->blen, data, n);
    s->blen += n; data += n; len -= n;
    if (s->blen == 64) { sha256_block(s->h, s->buf); s->blen = 0; }
  }
}

static void sha256_final(Sha256* s, uint8_t out[32]) {
  uint64_t bits = s->total * 8;
  uint8_t pad = 0x80;
  sha256_update(s, &pad, 1);
  uint8_t z = 0;
  while (s->blen != 56) sha256_update(s, &z, 1);
  uint8_t lenb[8];
  for (int i = 0; i < 8; i++) lenb[i] = (uint8_t)(bits >> (56 - 8*i));
  sha256_update(s, lenb, 8);
  for (int i = 0; i < 8; i++) {
    out[4*i] = s->h[i] >> 24; out[4*i+1] = s->h[i] >> 16; out[4*i+2] = s->h[i] >> 8; out[4*i+3] = s->h[i];
  }
  memset(s, 0, sizeof *s);
}

static void sha256(const uint8_t* data, size_t len, uint8_t out[32]) {
  Sha256 s; sha256_init(&s); sha256_update(&s, data, len); sha256_final(&s, out);
}

// ============================================================
// BIP39
//   entropy (16 or 32 bytes) -> 12 or 24 word indices, and back.
//   checksum = first ENT/32 bits of SHA256(entropy), appended to entropy,
//   then the whole bit string is split into 11-bit word indices.
// ============================================================
static int bip39_words_for(int nbytes) { return nbytes == 16 ? 12 : nbytes == 32 ? 24 : 0; }
static int bip39_bytes_for(int nwords) { return nwords == 12 ? 16 : nwords == 24 ? 32 : 0; }

// Returns number of words written to idx (12 or 24), or 0 on bad size.
static inline int bip39_encode(const uint8_t* entropy, int nbytes, uint16_t* idx) {
  int nwords = bip39_words_for(nbytes);
  if (!nwords) return 0;
  uint8_t h[32]; sha256(entropy, nbytes, h);
  uint8_t bits[33];
  memcpy(bits, entropy, nbytes);
  bits[nbytes] = h[0];                       // checksum bits live at the top of this byte
  for (int w = 0; w < nwords; w++) {
    uint16_t v = 0;
    for (int b = 0; b < 11; b++) {
      int bit = w * 11 + b;
      v = (v << 1) | ((bits[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    idx[w] = v;
  }
  memset(h, 0, sizeof h); memset(bits, 0, sizeof bits);
  return nwords;
}

// Rebuilds entropy from word indices and checks the checksum.
// Returns true if valid (entropy_out filled), false otherwise.
static bool bip39_decode(const uint16_t* idx, int nwords, uint8_t* entropy_out) {
  int nbytes = bip39_bytes_for(nwords);
  if (!nbytes) return false;
  uint8_t bits[33]; memset(bits, 0, sizeof bits);
  for (int w = 0; w < nwords; w++)
    for (int b = 0; b < 11; b++) {
      int bit = w * 11 + b;
      if ((idx[w] >> (10 - b)) & 1) bits[bit >> 3] |= (uint8_t)(0x80 >> (bit & 7));
    }
  uint8_t h[32]; sha256(bits, nbytes, h);
  int csbits = nbytes / 4;                           // ENT/32: 4 bits for 12 words, 8 for 24
  uint8_t mask = (uint8_t)(0xFF << (8 - csbits));
  bool ok = (bits[nbytes] & mask) == (h[0] & mask);
  if (ok) memcpy(entropy_out, bits, nbytes);
  memset(bits, 0, sizeof bits); memset(h, 0, sizeof h);
  return ok;
}

// Exact word lookup. Returns index or -1.
static inline int bip39_find(const char* word) {
  int lo = 0, hi = 2047;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    int c = strcmp(WORDS[mid], word);
    if (c == 0) return mid;
    if (c < 0) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

// Prefix search. Writes up to max indices into out (out may be NULL when max is 0).
// *total receives the number of words matching the prefix. Returns how many were written.
static int bip39_prefix(const char* prefix, uint16_t* out, int max, int* total) {
  size_t n = strlen(prefix);
  int cnt = 0, wrote = 0;
  for (int i = 0; i < 2048; i++) {
    if (strncmp(WORDS[i], prefix, n) == 0) {
      if (wrote < max) out[wrote++] = (uint16_t)i;
      cnt++;
    } else if (cnt) break;   // list is sorted, so matches are contiguous
  }
  if (total) *total = cnt;
  return wrote;
}

// ============================================================
// SeedQR (SeedSigner format)
//   Standard: each index as 4 decimal digits, concatenated, numeric QR, ECC L.
//   Compact:  raw entropy bytes in byte mode, ECC L (just use entropy directly).
// ============================================================
// out must hold nwords*4 + 1 chars.
static inline void seedqr_digits(const uint16_t* idx, int nwords, char* out) {
  for (int i = 0; i < nwords; i++) {
    uint16_t v = idx[i];
    out[4*i]   = '0' + (v / 1000) % 10;
    out[4*i+1] = '0' + (v / 100) % 10;
    out[4*i+2] = '0' + (v / 10) % 10;
    out[4*i+3] = '0' + v % 10;
  }
  out[4*nwords] = 0;
}

// Best-effort secure zero that the optimizer won't drop.
static void secure_zero(void* p, size_t n) {
  volatile uint8_t* v = (volatile uint8_t*)p;
  while (n--) *v++ = 0;
}

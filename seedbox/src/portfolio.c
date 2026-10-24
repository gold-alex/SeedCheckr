// portfolio.c - see portfolio.h
#include "portfolio.h"
#include <string.h>
#include <stdio.h>
#include "qr/qrcodegen.h"

// Payload v1 layout. Row numbers are the indexes derive_all() writes
// (the CHAINS[] table in chains.c); the web page mirrors this list in
// docs/decode.js, so change both or neither.
//
//   offset  len  row  what the page makes of it
//   0       1    -    version byte, 0x01
//   1       20   0    EVM address        -> ETH + every EVM chain, and INJ (bech32 of the same bytes)
//   21      20   2    BTC segwit pkh     -> bc1q... (m/84'/0'/0'/0/0)
//   41      20   3    BTC legacy pkh     -> 1...    (m/44'/0'/0'/0/0; the row's text is the xpub)
//   61      20   4    LTC segwit pkh     -> ltc1q...
//   81      20   5    DOGE pkh           -> D...
//   101     32   6    SOL public key     -> base58
//   133     20   7    TRX address bytes  -> base58check with 0x41 prefix
//   153     20   8    Cosmos pkh         -> ATOM, OSMO, TIA, DYDX, SEI, AKT, JUNO, STARS
//   173     20   17   XRP account id     -> base58check, XRP alphabet
//   193     32   18   SUI address        -> 0x hex
//   225     32   19   APT address        -> 0x hex
static const struct { uint8_t row; uint8_t len; } LAYOUT[] = {
  { 0, 20 }, { 2, 20 }, { 3, 20 }, { 4, 20 }, { 5, 20 }, { 6, 32 },
  { 7, 20 }, { 8, 20 }, { 17, 20 }, { 18, 32 }, { 19, 32 },
};

int portfolio_pack(const ChainAddr* rows, uint8_t out[PORTFOLIO_BYTES]) {
  int off = 0;
  out[off++] = PORTFOLIO_VERSION;
  for (size_t i = 0; i < sizeof LAYOUT / sizeof LAYOUT[0]; i++) {
    const ChainAddr* r = &rows[LAYOUT[i].row];
    if (r->rawlen != LAYOUT[i].len) return -1;
    memcpy(out + off, r->raw, LAYOUT[i].len);
    off += LAYOUT[i].len;
  }
  return off == PORTFOLIO_BYTES ? off : -1;
}

// 43 of the 45 QR alphanumeric characters: every one is legal in a URL fragment
// without escaping. Same alphabet Electrum uses for its QR codes.
static const char B43[] = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:";

// Big-endian bytes -> base43 digits, most significant first. Leading zero
// bytes would be lost, which is fine here because byte 0 is always nonzero
// (the payload version, or the 0x01 every frame chunk starts with).
// Digits are written straight into out, least significant first, then reversed.
#define B43_MAX_IN PORTFOLIO_BYTES   // largest input: the v1 payload (frames need 1 + 240)
static int base43_encode(const uint8_t* in, int n, char* out, int cap) {
  uint8_t num[B43_MAX_IN];
  int len = 0, start = 0;
  if (n > B43_MAX_IN) return -1;
  memcpy(num, in, n);
  while (start < n && num[start] == 0) start++;
  while (start < n) {
    unsigned rem = 0;
    for (int i = start; i < n; i++) {
      unsigned v = (rem << 8) | num[i];
      num[i] = (uint8_t)(v / 43);
      rem = v % 43;
    }
    if (len + 1 >= cap) return -1;
    out[len++] = B43[rem];
    while (start < n && num[start] == 0) start++;
  }
  if (len == 0) { if (cap < 2) return -1; out[len++] = '0'; }
  for (int i = 0, j = len - 1; i < j; i++, j--) { char t = out[i]; out[i] = out[j]; out[j] = t; }
  out[len] = 0;
  return len;
}

int portfolio_text(const ChainAddr* rows, char* out, int cap) {
  uint8_t bytes[PORTFOLIO_BYTES];
  if (portfolio_pack(rows, bytes) < 0) return -1;
  return base43_encode(bytes, PORTFOLIO_BYTES, out, cap);
}

bool portfolio_qr(const char* url_prefix, const char* payload,
                  uint8_t* temp, uint8_t* qrcode, int max_version) {
  static uint8_t url_bits[64];
  static uint8_t payload_bits[300];   // 379 alphanumeric chars need 262 bytes
  size_t ul = strlen(url_prefix), pl = strlen(payload);
  if (ul == 0 || ul > sizeof url_bits) return false;
  if (!qrcodegen_isAlphanumeric(payload)) return false;
  if (qrcodegen_calcSegmentBufferSize(qrcodegen_Mode_ALPHANUMERIC, pl) > sizeof payload_bits) return false;
  struct qrcodegen_Segment segs[2];
  segs[0] = qrcodegen_makeBytes((const uint8_t*)url_prefix, ul, url_bits);
  segs[1] = qrcodegen_makeAlphanumeric(payload, payload_bits);
  return qrcodegen_encodeSegmentsAdvanced(segs, 2, qrcodegen_Ecc_LOW, 1, max_version,
                                          qrcodegen_Mask_AUTO, true, temp, qrcode);
}

// ---------------- "more chains" frames, see docs/EXTENSIONS.md ----------------

// Walks the extension bytes E = [type][len][raw...] for every row with ext != 0,
// in row order, without holding E in memory: updates the CRC-32 over all of E and
// copies the bytes at offsets [from, to) into dst (when dst is not NULL).
// Returns the length of E.
static int ext_walk(const ChainAddr* rows, int n, uint32_t* crc, uint8_t* dst, int from, int to) {
  uint32_t c = 0xFFFFFFFFu;
  int off = 0;
  for (int r = 0; r < n; r++) {
    if (!rows[r].ext) continue;
    int len = rows[r].rawlen;
    if (len > (int)sizeof rows[r].raw) len = (int)sizeof rows[r].raw;
    for (int k = -2; k < len; k++, off++) {
      uint8_t b = k == -2 ? rows[r].ext : k == -1 ? (uint8_t)len : rows[r].raw[k];
      c ^= b;
      for (int bit = 0; bit < 8; bit++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1)));
      if (dst && off >= from && off < to) dst[off - from] = b;
    }
  }
  if (crc) *crc = ~c;
  return off;
}

int portfolio_ext_bytes(const ChainAddr* rows, int n, uint8_t* out, int cap) {
  int len = ext_walk(rows, n, NULL, NULL, 0, 0);
  if (!out) return len;
  if (len > cap) return -1;
  ext_walk(rows, n, NULL, out, 0, len);
  return len;
}

int portfolio_frame_count(const ChainAddr* rows, int n) {
  int len = ext_walk(rows, n, NULL, NULL, 0, 0);
  return (len + PORTFOLIO_FRAME_CHUNK - 1) / PORTFOLIO_FRAME_CHUNK;
}

int portfolio_frame_text(const ChainAddr* rows, int n, int i, char* out, int cap) {
  uint8_t chunk[1 + PORTFOLIO_FRAME_CHUNK];
  uint32_t crc;
  int from = (i - 1) * PORTFOLIO_FRAME_CHUNK;
  int len = ext_walk(rows, n, &crc, chunk + 1, from, from + PORTFOLIO_FRAME_CHUNK);
  int total = (len + PORTFOLIO_FRAME_CHUNK - 1) / PORTFOLIO_FRAME_CHUNK;
  if (i < 1 || i > total) return -1;
  int clen = len - from < PORTFOLIO_FRAME_CHUNK ? len - from : PORTFOLIO_FRAME_CHUNK;
  chunk[0] = 0x01;
  int h = snprintf(out, cap, "SB2 %d %d %08lX ", i, total, (unsigned long)crc);
  if (h < 0 || h >= cap) return -1;
  int d = base43_encode(chunk, 1 + clen, out + h, cap - h);
  return d < 0 ? -1 : h + d;
}

bool portfolio_frame_qr(const char* text, uint8_t* temp, uint8_t* qrcode, int max_version) {
  if (!qrcodegen_isAlphanumeric(text)) return false;   // so encodeText picks alphanumeric mode
  return qrcodegen_encodeText(text, temp, qrcode, qrcodegen_Ecc_LOW, 1, max_version,
                              qrcodegen_Mask_AUTO, true);
}

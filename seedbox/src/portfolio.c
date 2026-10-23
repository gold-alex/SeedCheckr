// portfolio.c - see portfolio.h
#include "portfolio.h"
#include <string.h>
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
// bytes would be lost, which is fine here because byte 0 is the version (1).
static int base43_encode(const uint8_t* in, int n, char* out, int cap) {
  uint8_t num[PORTFOLIO_BYTES];
  char digits[PORTFOLIO_TEXT_MAX];
  int len = 0, start = 0;
  if (n > PORTFOLIO_BYTES) return -1;
  memcpy(num, in, n);
  while (start < n && num[start] == 0) start++;
  while (start < n) {
    unsigned rem = 0;
    for (int i = start; i < n; i++) {
      unsigned v = (rem << 8) | num[i];
      num[i] = (uint8_t)(v / 43);
      rem = v % 43;
    }
    if (len >= (int)sizeof digits) return -1;
    digits[len++] = B43[rem];
    while (start < n && num[start] == 0) start++;
  }
  if (len == 0) digits[len++] = '0';
  if (len + 1 > cap) return -1;
  for (int i = 0; i < len; i++) out[i] = digits[len - 1 - i];
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

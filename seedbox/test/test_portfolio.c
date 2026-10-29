// test_portfolio.c - host side. Derives everything for one mnemonic and prints
// the portfolio payload (the text the device puts after '#' in the QR) followed
// by every address, so verify_site.js can decode the payload with the web
// page's own decode.js and compare.
//
//   PORTFOLIO|<base43>
//   <name>|<addr>            one line per chain row, as test_chains prints them
//   BTC legacy addr 1|1...   first m/44'/0'/0'/0/0 address (raw-only on the device)
//   FRAME|SB2 ...            the "more chains" frames, if any row has ext set
//   FOUNT|SB2 ...            then the device's first loop of fountain frames (n+1..3n)
#include <stdio.h>
#include <string.h>
#include "../src/chains.h"
#include "../src/portfolio.h"
#include "../src/trezor/base58.h"
#include "../src/trezor/hasher.h"

int main(int argc, char** argv) {
  static ChainAddr out[CHAINS_MAX];
  static char text[PORTFOLIO_TEXT_MAX];
  if (argc < 2) { fprintf(stderr, "usage: test_portfolio \"word word ...\" [passphrase]\n"); return 2; }
  if (derive_all(argv[1], argc > 2 ? argv[2] : "", out, NULL)) { printf("ERR derive\n"); return 1; }
  int n = portfolio_text(out, text, sizeof text);
  if (n < 0) { printf("ERR portfolio\n"); return 1; }
  printf("PORTFOLIO|%s\n", text);
  for (int i = 0; i < chains_count(); i++) printf("%s|%s\n", out[i].name, out[i].addr);
  uint8_t raw[21]; raw[0] = 0x00; memcpy(raw + 1, out[3].raw, 20);
  char legacy[64]; base58_encode_check(raw, 21, HASHER_SHA2D, legacy, sizeof legacy);
  printf("BTC legacy addr 1|%s\n", legacy);
  // the "more chains" frames for rows with ext != 0 (docs/EXTENSIONS.md); none if there are none
  int frames = portfolio_frame_count(out, chains_count());
  for (int f = 1; f <= frames; f++) {
    char ft[PORTFOLIO_FRAME_TEXT_MAX];
    if (portfolio_frame_text(out, chains_count(), f, ft, sizeof ft) < 0) { printf("ERR frame %d\n", f); return 1; }
    printf("FRAME|%s\n", ft);
  }
  for (int f = frames + 1; frames && f <= 3 * frames; f++) {   // the first loop's fountain frames
    char ft[PORTFOLIO_FRAME_TEXT_MAX];
    if (portfolio_frame_text(out, chains_count(), f, ft, sizeof ft) < 0) { printf("ERR frame %d\n", f); return 1; }
    printf("FOUNT|%s\n", ft);
  }
  return 0;
}

// test_frames.c - host side. Builds the "more chains" frames (docs/EXTENSIONS.md)
// with the device's own portfolio.c from rows given on stdin, so verify_frames.js
// can check them against docs/scan.js without needing a real derivation.
//
// stdin, one row per line:  <ext type, hex> <raw bytes, hex>
//   type 00 makes a core row (ext = 0), which must not appear in the frames.
// stdout:
//   BYTES|<hex of the extension bytes>
//   COUNT|<n>
//   FRAME|<text>             one line per frame, 1..n
//   FOUNT|<text>             fountain frames n+1..9n (the device's first four loops' worth)
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../src/chains.h"
#include "../src/portfolio.h"

static ChainAddr rows[CHAINS_MAX];

int main(void) {
  char line[512];
  int n = 0;
  while (n < CHAINS_MAX && fgets(line, sizeof line, stdin)) {
    unsigned type; char hex[300];
    if (sscanf(line, "%x %299s", &type, hex) < 1) continue;
    if (sscanf(line, "%x %299s", &type, hex) < 2) hex[0] = 0;
    ChainAddr* r = &rows[n++];
    memset(r, 0, sizeof *r);
    r->name = "test";
    r->ext = (uint8_t)type;
    int len = (int)strlen(hex) / 2;
    if (len > (int)sizeof r->raw) { fprintf(stderr, "row %d too long\n", n); return 2; }
    for (int i = 0; i < len; i++) { unsigned b; sscanf(hex + 2 * i, "%2x", &b); r->raw[i] = (uint8_t)b; }
    r->rawlen = (uint8_t)len;
  }
  int len = portfolio_ext_bytes(rows, n, NULL, 0);
  uint8_t* e = malloc(len + 1);
  if (portfolio_ext_bytes(rows, n, e, len) != len) { printf("ERR bytes\n"); return 1; }
  printf("BYTES|");
  for (int i = 0; i < len; i++) printf("%02x", e[i]);
  printf("\n");
  int count = portfolio_frame_count(rows, n);
  printf("COUNT|%d\n", count);
  for (int i = 1; i <= count; i++) {
    char text[PORTFOLIO_FRAME_TEXT_MAX];
    if (portfolio_frame_text(rows, n, i, text, sizeof text) < 0) { printf("ERR frame %d\n", i); return 1; }
    printf("FRAME|%s\n", text);
  }
  for (int i = count + 1; count && i <= 9 * count; i++) {
    char text[PORTFOLIO_FRAME_TEXT_MAX];
    if (portfolio_frame_text(rows, n, i, text, sizeof text) < 0) { printf("ERR frame %d\n", i); return 1; }
    printf("FOUNT|%s\n", text);
  }
  char t[PORTFOLIO_FRAME_TEXT_MAX];
  if (portfolio_frame_text(rows, n, 0, t, sizeof t) >= 0 || portfolio_frame_text(rows, n, PORTFOLIO_FRAME_MAX + 1, t, sizeof t) >= 0) {
    printf("ERR out-of-range frame accepted\n"); return 1;
  }
  free(e);
  return 0;
}

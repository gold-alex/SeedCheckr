// test_qr.c - host side. Encodes exactly what the device encodes and dumps the
// modules as text ('#' dark, '.' light) so verify_site.js can decode the image
// with an independent reader (jsQR) and check the text survives.
//
//   test_qr URLPREFIX PAYLOAD   portfolio code: byte segment + alphanumeric segment
//   test_qr -t TEXT             plain text, the call the per-chain QR screen makes
//
// First line: V<version> S<size>. Prints TOOLONG and exits 1 if it does not fit.
#include <stdio.h>
#include <string.h>
#include "../src/qr/qrcodegen.h"
#include "../src/portfolio.h"

#define MAXV 11   // same ceiling as QR_MAX_VERSION in seedbox.ino

int main(int argc, char** argv) {
  static uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(MAXV)], tmp[qrcodegen_BUFFER_LEN_FOR_VERSION(MAXV)];
  bool ok;
  if (argc == 3 && !strcmp(argv[1], "-t"))
    ok = qrcodegen_encodeText(argv[2], tmp, qr, qrcodegen_Ecc_LOW, 1, MAXV, qrcodegen_Mask_AUTO, true);
  else if (argc == 3)
    ok = portfolio_qr(argv[1], argv[2], tmp, qr, MAXV);
  else { fprintf(stderr, "usage: test_qr URLPREFIX PAYLOAD | test_qr -t TEXT\n"); return 2; }
  if (!ok) { printf("TOOLONG\n"); return 1; }
  int size = qrcodegen_getSize(qr);
  printf("V%d S%d\n", (size - 17) / 4, size);
  for (int y = 0; y < size; y++) {
    for (int x = 0; x < size; x++) putchar(qrcodegen_getModule(qr, x, y) ? '#' : '.');
    putchar('\n');
  }
  return 0;
}

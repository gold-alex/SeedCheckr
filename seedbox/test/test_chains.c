#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "../src/chains.h"
int main(int argc, char** argv) {
  const char* pass = argc > 2 ? argv[2] : "";
  static ChainAddr out[CHAINS_MAX];
  // argv[1]: a BIP39 mnemonic, or "slip39:<hex>" for a SLIP-39 master secret (see ref_seed.py)
  if (!strncmp(argv[1], "slip39:", 7)) {
    uint8_t sec[32]; int len = (int)strlen(argv[1] + 7) / 2;
    for (int i = 0; i < len && i < 32; i++) { unsigned b; sscanf(argv[1] + 7 + 2 * i, "%2x", &b); sec[i] = (uint8_t)b; }
    if (derive_all_slip39(sec, len, out, NULL)) { printf("ERR\n"); return 1; }
  } else if (derive_all(argv[1], pass, out, NULL)) { printf("ERR\n"); return 1; }
  for (int i = 0; i < chains_count(); i++) printf("%s|%s\n", out[i].name, out[i].addr);
  return 0;
}

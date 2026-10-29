#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "../src/chains.h"
#include "../src/electrum.h"
#include "../src/portfolio.h"
int main(int argc, char** argv) {
  const char* pass = argc > 2 ? argv[2] : "";
  static ChainAddr out[CHAINS_MAX];
  // argv[1]: a BIP39 mnemonic, "slip39:<hex>" for a SLIP-39 master secret (see ref_seed.py),
  // or "electrum:<words>" for an Electrum seed (its type, two rows and the v2 payload)
  if (!strncmp(argv[1], "electrum:", 9)) {
    const char* m = argv[1] + 9;
    int nw = 1; for (const char* c = m; *c; c++) nw += *c == ' ';
    static const char* const T[] = { "none", "standard", "segwit", "2fa", "2fa_segwit" };
    ElectrumType t = electrum_seed_type(m, nw);
    printf("type|%s\n", T[t]);
    if (t != ELECTRUM_STANDARD && t != ELECTRUM_SEGWIT) return 0;
    if (derive_electrum(m, pass, t, out, NULL)) { printf("ERR\n"); return 1; }
    for (int i = 0; i < ELECTRUM_ROWS; i++) printf("%s|%s\n", out[i].name, out[i].addr);
    char text[200];
    if (portfolio_electrum_text(out, t == ELECTRUM_SEGWIT, text, sizeof text) < 0) { printf("ERR\n"); return 1; }
    printf("payload|%s\n", text);
    return 0;
  }
  if (!strncmp(argv[1], "slip39:", 7)) {
    uint8_t sec[32]; int len = (int)strlen(argv[1] + 7) / 2;
    for (int i = 0; i < len && i < 32; i++) { unsigned b; sscanf(argv[1] + 7 + 2 * i, "%2x", &b); sec[i] = (uint8_t)b; }
    if (derive_all_slip39(sec, len, out, NULL)) { printf("ERR\n"); return 1; }
  } else if (derive_all(argv[1], pass, out, NULL)) { printf("ERR\n"); return 1; }
  for (int i = 0; i < chains_count(); i++) printf("%s|%s\n", out[i].name, out[i].addr);
  return 0;
}

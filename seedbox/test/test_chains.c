#include <stdio.h>
#include <string.h>
#include "../src/chains.h"
int main(int argc, char** argv) {
  const char* pass = argc > 2 ? argv[2] : "";
  static ChainAddr out[CHAINS_MAX];
  if (derive_all(argv[1], pass, out, NULL)) { printf("ERR\n"); return 1; }
  for (int i = 0; i < chains_count(); i++) printf("%s|%s\n", out[i].name, out[i].addr);
  return 0;
}

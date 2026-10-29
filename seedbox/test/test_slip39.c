// test_slip39.c - host side. Runs the device's slip39.c on share mnemonics from stdin, one
// share per line, for verify_slip39.js. argv[1]: the passphrase (optional).
// Output: "OK <master secret hex>", or "ERR <step> <code>" where step is the share number
// (1-based) that failed to parse or add, or 0 for the recovery itself; "ERR 0 NOT_ENOUGH"
// when the shares are fine but too few. Also prints "STATUS gdone/gthr" before the result.
#include <stdio.h>
#include <string.h>
#include "../src/slip39.h"

static int word_index(const char* w) {
  int first, n = slip39_prefix(w, &first);
  for (int i = first; i < first + n; i++) if (!strcmp(slip39_word(i), w)) return i;
  return -1;
}

int main(int argc, char** argv) {
  const char* pass = argc > 1 ? argv[1] : "";
  static Slip39Set set;
  slip39_init(&set);
  char line[1024];
  int k = 0;
  while (fgets(line, sizeof line, stdin)) {
    uint16_t idx[64]; int n = 0;
    for (char* t = strtok(line, " \t\r\n"); t; t = strtok(NULL, " \t\r\n")) {
      int i = word_index(t);
      if (i < 0 || n >= 64) { printf("ERR %d WORD\n", k + 1); return 0; }
      idx[n++] = (uint16_t)i;
    }
    if (!n) continue;
    k++;
    Slip39Share sh;
    Slip39Result r = slip39_parse(idx, n, &sh);
    if (r == SLIP39_OK) r = slip39_add(&set, &sh);
    if (r != SLIP39_OK) { printf("ERR %d %d\n", k, (int)r); return 0; }
  }
  Slip39Status st; slip39_status(&set, &st);
  printf("STATUS %d/%d\n", st.gdone, st.gthr);
  uint8_t out[32]; int len = 0;
  Slip39Result r = slip39_recover(&set, pass, out, &len, NULL);
  if (r == SLIP39_NOT_ENOUGH) { printf("ERR 0 NOT_ENOUGH\n"); return 0; }
  if (r != SLIP39_OK) { printf("ERR 0 %d\n", (int)r); return 0; }
  printf("OK ");
  for (int i = 0; i < len; i++) printf("%02x", out[i]);
  printf("\n");
  return 0;
}

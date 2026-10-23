// Host-side test for seedcore.h. Reads vectors from stdin:
//   <hex entropy> <mnemonic words...>
// Checks SHA-256 known answers, BIP39 encode/decode round trips,
// checksum rejection, prefix search, and SeedQR digit strings.
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include "../seedcore.h"

static int fails = 0;
#define CHECK(c, msg) do { if (!(c)) { fails++; printf("FAIL: %s\n", msg); } } while (0)

static std::string hex(const uint8_t* p, int n) {
  char b[80]; for (int i = 0; i < n; i++) sprintf(b + 2*i, "%02x", p[i]); b[2*n] = 0; return b;
}
static void unhex(const std::string& s, uint8_t* out) {
  for (size_t i = 0; i < s.size() / 2; i++) out[i] = (uint8_t)strtoul(s.substr(2*i, 2).c_str(), 0, 16);
}

int main() {
  // SHA-256 known answers
  uint8_t h[32];
  sha256((const uint8_t*)"", 0, h);
  CHECK(hex(h, 32) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256 empty");
  sha256((const uint8_t*)"abc", 3, h);
  CHECK(hex(h, 32) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256 abc");
  // 1,000,000 'a' via streaming update in odd chunk sizes
  { Sha256 s; sha256_init(&s); uint8_t buf[997]; memset(buf, 'a', sizeof buf);
    size_t left = 1000000; while (left) { size_t n = left < sizeof buf ? left : sizeof buf; sha256_update(&s, buf, n); left -= n; }
    sha256_final(&s, h);
    CHECK(hex(h, 32) == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0", "sha256 million a"); }

  // BIP39 vectors from stdin
  std::string line; int n = 0;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    std::istringstream ss(line);
    std::string ent; ss >> ent;
    std::vector<std::string> words; std::string w; while (ss >> w) words.push_back(w);
    uint8_t e[32]; unhex(ent, e); int nbytes = (int)ent.size() / 2;
    uint16_t idx[24]; int nw = bip39_encode(e, nbytes, idx);
    CHECK(nw == (int)words.size(), "word count");
    for (int i = 0; i < nw; i++) CHECK(words[i] == WORDS[idx[i]], ("word mismatch: " + ent).c_str());
    // decode round trip
    uint8_t back[32]; CHECK(bip39_decode(idx, nw, back), "decode valid");
    CHECK(memcmp(back, e, nbytes) == 0, "entropy round trip");
    // flip the last word -> checksum must fail (last word carries checksum bits)
    uint16_t bad[24]; memcpy(bad, idx, sizeof bad); bad[nw-1] ^= 1;
    CHECK(!bip39_decode(bad, nw, back), "checksum rejects altered word");
    // exact lookup
    for (int i = 0; i < nw; i++) CHECK(bip39_find(words[i].c_str()) == idx[i], "bip39_find");
    // seedqr digits
    char d[24*4+1]; seedqr_digits(idx, nw, d);
    CHECK((int)strlen(d) == nw*4, "seedqr length");
    for (int i = 0; i < nw; i++) CHECK(atoi(std::string(d + 4*i, 4).c_str()) == idx[i], "seedqr digits");
    n++;
  }
  printf("vectors checked: %d\n", n);

  // prefix search
  uint16_t out[32]; int total;
  int got = bip39_prefix("act", out, 32, &total);
  CHECK(total == got && total > 1, "prefix act count");
  for (int i = 0; i < got; i++) CHECK(strncmp(WORDS[out[i]], "act", 3) == 0, "prefix act content");
  bip39_prefix("zzz", nullptr, 0, &total); CHECK(total == 0, "prefix none");
  bip39_prefix("", nullptr, 0, &total); CHECK(total == 2048, "prefix all");
  bip39_prefix("zoo", nullptr, 0, &total); CHECK(total == 1, "prefix zoo");
  // every 4-letter-or-shorter unique prefix: BIP39 guarantees first 4 letters are unique
  for (int i = 0; i < 2048; i++) { char p[5]; strncpy(p, WORDS[i], 4); p[4] = 0; bip39_prefix(p, out, 32, &total);
    bool found = false; for (int k = 0; k < total && k < 32; k++) if (out[k] == i) found = true;
    CHECK(found, "4-letter prefix finds own word"); }

  CHECK(bip39_find("notaword") == -1, "find miss");
  printf(fails ? "FAILED (%d)\n" : "ALL OK\n", fails);
  return fails ? 1 : 0;
}

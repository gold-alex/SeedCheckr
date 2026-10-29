// slip39.c - SLIP-39 share parsing, collection and master secret recovery. See slip39.h.
#include "slip39.h"
#include "slip39_wordlist.h"
#include <string.h>
#include "trezor/hmac.h"
#include "trezor/pbkdf2.h"
#include "trezor/memzero.h"

// ---------------- words ----------------
const char* slip39_word(int i) { return (i >= 0 && i < 1024) ? SLIP39_WORDS[i] : ""; }

int slip39_prefix(const char* prefix, int* first) {
  size_t n = strlen(prefix);
  int cnt = 0, at = 0;
  for (int i = 0; i < 1024; i++) {
    if (strncmp(SLIP39_WORDS[i], prefix, n) == 0) { if (!cnt) at = i; cnt++; }
    else if (cnt) break;
  }
  if (first) *first = at;
  return cnt;
}

// ---------------- RS1024 checksum ----------------
static uint32_t polymod_step(uint32_t chk, uint32_t v) {
  static const uint32_t GEN[10] = { 0xE0E040, 0x1C1C080, 0x3838100, 0x7070200, 0xE0E0009,
                                    0x1C0C2412, 0x38086C24, 0x3090FC48, 0x21B1F890, 0x3F3F120 };
  uint32_t b = chk >> 20;
  chk = ((chk & 0xFFFFF) << 10) ^ v;
  for (int i = 0; i < 10; i++) if ((b >> i) & 1) chk ^= GEN[i];
  return chk;
}

static int checksum_ok(const uint16_t* idx, int n, int ext) {
  const char* cs = ext ? "shamir_extendable" : "shamir";
  uint32_t chk = 1;
  for (const char* c = cs; *c; c++) chk = polymod_step(chk, (uint8_t)*c);
  for (int i = 0; i < n; i++) chk = polymod_step(chk, idx[i]);
  return chk == 1;
}

// ---------------- parsing ----------------
Slip39Result slip39_parse(const uint16_t* idx, int nwords, Slip39Share* out) {
  memset(out, 0, sizeof *out);
  if (nwords < 20) return SLIP39_ERR_LENGTH;
  for (int i = 0; i < nwords; i++) if (idx[i] > 1023) return SLIP39_ERR_LENGTH;
  int vbits = 10 * (nwords - 7), pad = vbits % 16;          // value words, less 2+2 metadata and 3 checksum
  if (pad > 8) return SLIP39_ERR_LENGTH;
  int vlen = (vbits - pad) / 8;
  if (vlen > SLIP39_MAX_SECRET) return SLIP39_ERR_LENGTH;

  uint32_t idexp = ((uint32_t)idx[0] << 10) | idx[1];
  out->id = (uint16_t)(idexp >> 5);
  out->ext = (idexp >> 4) & 1;
  out->exp = idexp & 15;
  if (!checksum_ok(idx, nwords, out->ext)) { memset(out, 0, sizeof *out); return SLIP39_ERR_CHECKSUM; }

  uint32_t par = ((uint32_t)idx[2] << 10) | idx[3];
  out->gidx = (par >> 16) & 15;
  out->gthr = ((par >> 12) & 15) + 1;
  out->gcnt = ((par >> 8) & 15) + 1;
  out->midx = (par >> 4) & 15;
  out->mthr = (par & 15) + 1;
  if (out->gthr > out->gcnt) { memset(out, 0, sizeof *out); return SLIP39_ERR_PARAMS; }

  // value: the bits of words 4 .. n-4, big endian; the first pad bits must be zero
  int bit = 0, acc = 0, nb = 0;
  for (int w = 4; w < nwords - 3; w++) {
    for (int k = 9; k >= 0; k--, bit++) {
      int b = (idx[w] >> k) & 1;
      if (bit < pad) { if (b) { memset(out, 0, sizeof *out); return SLIP39_ERR_PADDING; } continue; }
      acc = (acc << 1) | b;
      if (++nb == 8) { out->value[out->len++] = (uint8_t)acc; acc = 0; nb = 0; }
    }
  }
  if (out->len != vlen) { memset(out, 0, sizeof *out); return SLIP39_ERR_LENGTH; }
  return SLIP39_OK;
}

// ---------------- collecting ----------------
void slip39_init(Slip39Set* set) { memzero(set, sizeof *set); }

Slip39Result slip39_add(Slip39Set* set, const Slip39Share* sh) {
  for (int i = 0; i < set->n; i++) {
    const Slip39Share* o = &set->s[i];
    if (o->id != sh->id || o->ext != sh->ext || o->exp != sh->exp || o->gthr != sh->gthr || o->gcnt != sh->gcnt)
      return SLIP39_OTHER_BACKUP;
    if (o->len != sh->len) return SLIP39_OTHER_BACKUP;
    if (o->gidx == sh->gidx) {
      if (o->mthr != sh->mthr) return SLIP39_GROUP_MISMATCH;
      if (o->midx == sh->midx) return memcmp(o->value, sh->value, sh->len) ? SLIP39_GROUP_MISMATCH : SLIP39_DUPLICATE;
    }
  }
  if (set->n >= SLIP39_MAX_SHARES) return SLIP39_FULL;
  set->s[set->n++] = *sh;
  return SLIP39_OK;
}

void slip39_status(const Slip39Set* set, Slip39Status* st) {
  memset(st, 0, sizeof *st);
  if (!set->n) return;
  st->gthr = set->s[0].gthr; st->gcnt = set->s[0].gcnt;
  for (int i = 0; i < set->n; i++) { st->have[set->s[i].gidx]++; st->need[set->s[i].gidx] = set->s[i].mthr; }
  for (int g = 0; g < 16; g++) if (st->need[g] && st->have[g] >= st->need[g]) st->gdone++;
}

int slip39_ready(const Slip39Set* set) {
  Slip39Status st; slip39_status(set, &st);
  return set->n && st.gdone >= st.gthr;
}

// ---------------- Shamir over GF(256) ----------------
static uint8_t EXP[255], LOG[256];
static void gf_tables(void) {
  if (EXP[0]) return;
  unsigned poly = 1;
  for (int i = 0; i < 255; i++) {
    EXP[i] = (uint8_t)poly; LOG[poly] = (uint8_t)i;
    poly = (poly << 1) ^ poly;
    if (poly & 0x100) poly ^= 0x11B;
  }
}

typedef struct { uint8_t x; const uint8_t* y; } Point;

// f(x) from the k points (x_i, y_i), each y len bytes (Lagrange, as the reference does)
static void interpolate(const Point* p, int k, uint8_t x, int len, uint8_t* out) {
  gf_tables();
  for (int i = 0; i < k; i++) if (p[i].x == x) { memcpy(out, p[i].y, len); return; }
  int log_prod = 0;
  for (int i = 0; i < k; i++) log_prod += LOG[p[i].x ^ x];
  memset(out, 0, len);
  for (int i = 0; i < k; i++) {
    int s = 0;
    for (int j = 0; j < k; j++) s += LOG[p[i].x ^ p[j].x];      // j == i adds LOG[0] = 0
    int lb = ((log_prod - LOG[p[i].x ^ x] - s) % 255 + 255) % 255;
    for (int b = 0; b < len; b++) if (p[i].y[b]) out[b] ^= EXP[(LOG[p[i].y[b]] + lb) % 255];
  }
}

// threshold 1: the one value. Otherwise f(255), checked against the digest at f(254).
static int recover_secret(const Point* p, int k, int len, uint8_t* out) {
  if (k == 1) { memcpy(out, p[0].y, len); return 0; }
  uint8_t d[SLIP39_MAX_SECRET], mac[32];
  interpolate(p, k, 255, len, out);
  interpolate(p, k, 254, len, d);
  hmac_sha256(d + 4, len - 4, out, len, mac);
  int ok = memcmp(mac, d, 4) == 0;
  memzero(d, sizeof d); memzero(mac, sizeof mac);
  return ok ? 0 : -1;
}

// ---------------- recovery ----------------
Slip39Result slip39_recover(const Slip39Set* set, const char* passphrase, uint8_t out[SLIP39_MAX_SECRET],
                            int* len, void (*progress)(int done, int total)) {
  if (!slip39_ready(set)) return SLIP39_NOT_ENOUGH;
  const Slip39Share* f = &set->s[0];
  const int L = f->len, gthr = f->gthr;
  Slip39Status st; slip39_status(set, &st);
  uint8_t gsec[16][SLIP39_MAX_SECRET], ems[SLIP39_MAX_SECRET];
  Point gp[16], mp[16];
  int ng = 0;
  Slip39Result rc = SLIP39_ERR_DIGEST;
  // each complete group, up to the group threshold: its first mthr shares give its secret
  for (int g = 0; g < 16 && ng < gthr; g++) {
    if (!st.need[g] || st.have[g] < st.need[g]) continue;
    int k = 0;
    for (int i = 0; i < set->n && k < st.need[g]; i++) if (set->s[i].gidx == g) { mp[k].x = set->s[i].midx; mp[k].y = set->s[i].value; k++; }
    if (recover_secret(mp, k, L, gsec[ng])) goto done;
    gp[ng].x = (uint8_t)g; gp[ng].y = gsec[ng]; ng++;
  }
  if (recover_secret(gp, ng, L, ems)) goto done;

  // decrypt: 4-round Feistel, each round PBKDF2-HMAC-SHA256((round || passphrase), salt || R)
  {
    const int half = L / 2;
    const uint32_t iters = (10000u << f->exp) / 4;
    uint8_t l[SLIP39_MAX_SECRET / 2], r[SLIP39_MAX_SECRET / 2], key[32];
    uint8_t pass[1 + SLIP39_MAX_PASS], salt[8 + SLIP39_MAX_SECRET / 2];
    size_t plen = strlen(passphrase);
    if (plen > SLIP39_MAX_PASS) { rc = SLIP39_ERR_PASSPHRASE; goto done; }
    memcpy(pass + 1, passphrase, plen);
    int slen = 0;
    if (!f->ext) { memcpy(salt, "shamir", 6); salt[6] = f->id >> 8; salt[7] = f->id & 0xFF; slen = 8; }
    memcpy(l, ems, half); memcpy(r, ems + half, half);
    const uint32_t CHUNK = 1000;
    for (int i = 3; i >= 0; i--) {
      PBKDF2_HMAC_SHA256_CTX pc;
      pass[0] = (uint8_t)i;
      memcpy(salt + slen, r, half);
      pbkdf2_hmac_sha256_Init(&pc, pass, plen + 1, salt, slen + half, 1);
      for (uint32_t done = 0; done < iters; ) {             // Init counts as the first iteration
        uint32_t step = iters - done < CHUNK ? iters - done : CHUNK;
        pbkdf2_hmac_sha256_Update(&pc, step);
        done += step;
        if (progress) progress((int)((3 - i) * (iters / 100) + done / 100), (int)(4 * (iters / 100)));
      }
      pbkdf2_hmac_sha256_Final(&pc, key);
      for (int b = 0; b < half; b++) { uint8_t t = r[b]; r[b] = l[b] ^ key[b]; l[b] = t; }
    }
    memcpy(out, r, half); memcpy(out + half, l, half);
    *len = L;
    memzero(l, sizeof l); memzero(r, sizeof r); memzero(key, sizeof key); memzero(pass, sizeof pass); memzero(salt, sizeof salt);
  }
  rc = SLIP39_OK;
done:
  memzero(gsec, sizeof gsec); memzero(ems, sizeof ems);
  return rc;
}

// slip39.h - SLIP-39 (Shamir) backups, as Trezor (Safe 3, Safe 5, Model T) and Keystone make
// them: 20 words for a 128-bit secret, 33 for 256, one share or several. Parses shares,
// collects them until enough are in, and recovers the master secret with the passphrase.
// Plain C on trezor-crypto; follows SatoshiLabs' reference (python-shamir-mnemonic) and is
// checked against its official vectors in test/verify_slip39.js.
#pragma once
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SLIP39_MAX_SHARES 32       // shares one recovery can hold (16 groups x 16 members is the format's limit)
#define SLIP39_MAX_SECRET 32       // bytes; 33 words
#define SLIP39_MAX_PASS   128      // passphrase bytes recover() accepts

typedef struct {
  uint16_t id;                     // 15-bit identifier, the same on every share of one backup
  uint8_t ext;                     // extendable backup flag
  uint8_t exp;                     // iteration exponent: PBKDF2 runs 10000 << exp times in all
  uint8_t gidx, gthr, gcnt;        // group index, groups needed, groups in all
  uint8_t midx, mthr;              // member index, members of this group needed
  uint8_t len;                     // share value length in bytes
  uint8_t value[SLIP39_MAX_SECRET];
} Slip39Share;

typedef struct {
  Slip39Share s[SLIP39_MAX_SHARES];
  int n;
} Slip39Set;

typedef enum {
  SLIP39_OK = 0,
  SLIP39_ERR_LENGTH,               // not a share length (fewer than 20 words, or bad padding length)
  SLIP39_ERR_CHECKSUM,             // a word is wrong
  SLIP39_ERR_PADDING,              // the share value's padding bits are not zero
  SLIP39_ERR_PARAMS,               // group threshold above group count
  SLIP39_DUPLICATE,                // this share is already in
  SLIP39_OTHER_BACKUP,             // from a different backup (identifier or settings differ)
  SLIP39_GROUP_MISMATCH,           // same group, different member threshold or length
  SLIP39_FULL,                     // SLIP39_MAX_SHARES already in
  SLIP39_NOT_ENOUGH,               // recover() before enough shares
  SLIP39_ERR_DIGEST,               // the shares do not combine (one is from another backup or wrong)
  SLIP39_ERR_PASSPHRASE,           // passphrase longer than SLIP39_MAX_PASS
} Slip39Result;

// Words: SLIP39 word i, and the words starting with prefix (the list is sorted, so the
// matches are contiguous): first index and count. Returns the count.
const char* slip39_word(int i);
int slip39_prefix(const char* prefix, int* first);

// Word indices -> share. nwords: 20 or 33 for Trezor and Keystone backups (any valid length works).
Slip39Result slip39_parse(const uint16_t* idx, int nwords, Slip39Share* out);

// Collecting shares. add() keeps the share unless it is a duplicate or does not belong.
void slip39_init(Slip39Set* set);
Slip39Result slip39_add(Slip39Set* set, const Slip39Share* sh);

// How far along: groups complete / groups needed, and per group index shares in / needed
// (need = 0: no share of that group yet, so its threshold is not known).
typedef struct {
  int gthr, gcnt, gdone;
  uint8_t have[16], need[16];
} Slip39Status;
void slip39_status(const Slip39Set* set, Slip39Status* st);
int slip39_ready(const Slip39Set* set);

// The master secret (len bytes) from enough shares and the passphrase ("" for none;
// printable ASCII). progress(done, total) runs during the PBKDF2 rounds; may be NULL.
Slip39Result slip39_recover(const Slip39Set* set, const char* passphrase, uint8_t out[SLIP39_MAX_SECRET],
                            int* len, void (*progress)(int done, int total));

#ifdef __cplusplus
}
#endif

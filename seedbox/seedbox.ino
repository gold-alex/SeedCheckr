/*
 * SeedBox - offline seed phrase -> public address viewer
 *
 * Hardware: Raspberry Pi Pico 2 (RP2350)
 *           1.8" ST7735 TFT, 128x160, SPI  (Lee's PID 18403)
 *           Bourns PEC11R rotary encoder with push switch
 *
 * Flow:
 *   1. Type a 12 or 24 word BIP39 seed in with the knob.
 *   2. The device derives public addresses for 20 chains (one EVM address
 *      covers Ethereum, Base, Arbitrum, Polygon, BSC, Optimism, Avalanche...).
 *   3. The seed is zeroed from RAM the moment derivation finishes.
 *   4. Browse addresses as text or QR. The first entry, "Portfolio", is one
 *      QR holding every address: scan it and the web page (docs/ in the repo)
 *      checks all 20 chains for coins at once. Per-chain QRs open that
 *      chain's explorer. Public data only, either way.
 *
 * Nothing is ever written to flash or sent over USB. Build with
 * Tools > USB Stack > "No USB" so a computer can't even see the device.
 *
 * See README.md for wiring, Arduino IDE setup and libraries.
 */

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include "src/qr/qrcodegen.h"
#include "ui_types.h"
#include "seedcore.h"
#include "src/chains.h"
#include "src/portfolio.h"

// ---------------- Pins (match the breadboard) ----------------
#define TFT_CS    17
#define TFT_DC    16
#define TFT_RST   20
#define TFT_BL    21
#define SPI_SCK   18
#define SPI_MOSI  19
#define SPI_MISO   0   // display never talks back; parked on a free pin so SPI can't grab GP16 (DC)
#define ENC_A      1
#define ENC_B      2
#define ENC_SW     3

// ---------------- Tunables ----------------
#define ENC_REVERSE    0                        // 1 if the knob scrolls the wrong way
#define LONG_PRESS_MS  800
#define IDLE_WIPE_MS   (5UL * 60UL * 1000UL)    // forget addresses after 5 min of no input
// Where the Portfolio QR points. The page lives in docs/ in the repo; host it anywhere
// and change this. Keep it under about 58 characters or the QR stops fitting (see portfolio.h).
#define PORTFOLIO_URL  "https://gold-alex.github.io/SeedCheckr/#"
// 1 = landscape, pin header on the left (default). 3 = landscape, header on the right.
// 0 / 2 = portrait, header top / bottom. Layout adapts to whichever you pick.
#define TFT_ROTATION   1

// ---------------- Screen ----------------
static int SCR_W = 160, SCR_H = 128;   // set from the display after rotation
#define C_BG  ST77XX_BLACK
#define C_FG  ST77XX_WHITE
#define C_DIM 0x8410            // grey
#define C_HI  ST77XX_YELLOW
#define C_OK  ST77XX_GREEN
#define C_BAD ST77XX_RED

Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);

// ---------------- State ----------------
// Secret: only exists between the last word being entered and derivation finishing.
static uint16_t gIdx[24];
static char     gMnemonic[24 * 9];
// Public: derived addresses, kept until wipe / idle timeout / power off.
static ChainAddr gAddr[32];
static bool      gLoaded = false;

static void wipeSecret() {
  secure_zero(gIdx, sizeof gIdx);
  secure_zero(gMnemonic, sizeof gMnemonic);
}

static void wipeAll() {
  wipeSecret();
  secure_zero(gAddr, sizeof gAddr);
  gLoaded = false;
}

// Overwrite the stack region below the current frame. Derivation leaves copies
// of key material in dead stack frames; this clears them.
static void __attribute__((noinline)) scrubStack() {
  volatile uint8_t junk[6144];
  for (size_t i = 0; i < sizeof junk; i++) junk[i] = 0;
}

// ---------------- Encoder: interrupt driven, bounce tolerant ----------------
// Standard quadrature transition table indexed by (previous AB << 2 | current AB).
// Valid steps give +1/-1, bounces cancel out, impossible jumps give 0.
// A click is only counted when the knob lands back on a detent (both contacts open = 11).
volatile int32_t encPos = 0;

void encISR() {
  static const int8_t T[16] = {0, 1, -1, 0, -1, 0, 0, 1, 1, 0, 0, -1, 0, -1, 1, 0};
  static uint8_t state = 3;
  static int8_t acc = 0;
  uint8_t ab = (digitalRead(ENC_A) << 1) | digitalRead(ENC_B);
  state = ((state << 2) | ab) & 0x0F;
  acc += T[state];
  if (ab == 3) {
    if (acc >= 3) encPos++;
    else if (acc <= -3) encPos--;
    acc = 0;
  }
}

// ---------------- Input events ----------------
static int32_t  lastEnc = 0;
static uint32_t lastInputMs = 0;

static Ev pollEvent() {
  uint32_t now = millis();

  int32_t p = encPos;
  if (p != lastEnc) {
    int d = (p > lastEnc) ? 1 : -1;
    lastEnc += d;                 // consume one click per call
    lastInputMs = now;
    if (ENC_REVERSE) d = -d;
    return d > 0 ? EV_CW : EV_CCW;
  }

  static bool down = false;
  static bool longFired = false;
  static uint32_t downAt = 0, lastChange = 0;
  bool pressed = (digitalRead(ENC_SW) == LOW);
  if (pressed != down && now - lastChange > 30) {   // 30 ms debounce
    down = pressed; lastChange = now; lastInputMs = now;
    if (down) { downAt = now; longFired = false; }
    else if (!longFired) return EV_PRESS;
  }
  if (down && !longFired && now - downAt >= LONG_PRESS_MS) { longFired = true; return EV_LONG; }

  if (now - lastInputMs > IDLE_WIPE_MS) { lastInputMs = now; return EV_TIMEOUT; }
  return EV_NONE;
}

static Ev waitEvent() {
  for (;;) {
    Ev e = pollEvent();
    if (e == EV_TIMEOUT) { wipeAll(); return e; }
    if (e != EV_NONE) return e;
    delay(2);
  }
}

static bool isBack(Ev e) { return e == EV_LONG || e == EV_TIMEOUT; }

// ---------------- Drawing helpers ----------------
static void clearScreen() { tft.fillScreen(C_BG); }

static void drawTitle(const char* t) {
  tft.fillRect(0, 0, SCR_W, 11, C_DIM);
  tft.setTextColor(ST77XX_BLACK);
  tft.setCursor(2, 2);
  tft.print(t);
  tft.setTextColor(C_FG);
}

static void textAt(int x, int y, const char* s, uint16_t color) {
  tft.setTextColor(color);
  tft.setCursor(x, y);
  tft.print(s);
}

static void textAt(int x, int y, const char* s) { textAt(x, y, s, C_FG); }

// Full-screen message, waits for a press.
static void message(const char* l1, const char* l2, const char* l3, uint16_t color) {
  clearScreen();
  textAt(4, 30, l1, color);
  if (l2) textAt(4, 48, l2);
  if (l3) textAt(4, 66, l3);
  textAt(4, SCR_H - 16, "press knob", C_DIM);
  for (;;) {
    Ev e = waitEvent();
    if (e == EV_PRESS || isBack(e)) return;
  }
}

// Scrollable list. Knob moves, press selects. Returns index, MENU_BACK or MENU_TIMEOUT.
static int runMenu(const char* t, const char* const* items, int n, int sel) {
  const int VIS = (SCR_H - 14) / 9;
  int top = 0;
  if (sel < 0 || sel >= n) sel = 0;
  for (;;) {
    if (sel < top) top = sel;
    if (sel >= top + VIS) top = sel - VIS + 1;
    clearScreen();
    drawTitle(t);
    for (int i = 0; i < VIS && top + i < n; i++) {
      bool cur = (top + i == sel);
      tft.setCursor(2, 14 + i * 9);
      tft.setTextColor(cur ? C_HI : C_FG);
      tft.print(cur ? "> " : "  ");
      tft.print(items[top + i]);
    }
    if (n > VIS) {   // scrollbar
      int h = (SCR_H - 14) * VIS / n; if (h < 4) h = 4;
      int y = 14 + (SCR_H - 14 - h) * top / (n - VIS);
      tft.fillRect(SCR_W - 3, y, 2, h, C_DIM);
    }
    Ev e = waitEvent();
    if (e == EV_CW) sel = (sel + 1) % n;
    else if (e == EV_CCW) sel = (sel + n - 1) % n;
    else if (e == EV_PRESS) return sel;
    else if (e == EV_LONG) return MENU_BACK;
    else if (e == EV_TIMEOUT) return MENU_TIMEOUT;
  }
}

// ---------------- QR ----------------
// Nayuki's qrcodegen picks the smallest version that fits. Version 11 (61x61)
// is the largest that still gets 2 px per module, plus a 1 module quiet zone,
// on a 128 px tall screen. Dense codes scan fine from 8-12 cm.
#define QR_MAX_VERSION 11
static uint8_t qrCode[qrcodegen_BUFFER_LEN_FOR_VERSION(QR_MAX_VERSION)];
static uint8_t qrTemp[qrcodegen_BUFFER_LEN_FOR_VERSION(QR_MAX_VERSION)];

// Paints qrCode centered with a 1 module quiet zone.
static void paintQR() {
  int size = qrcodegen_getSize(qrCode);
  int cells = size + 2;
  int s = (SCR_W < SCR_H ? SCR_W : SCR_H) / cells;
  int px = s * cells;
  int x0 = (SCR_W - px) / 2, y0 = (SCR_H - px) / 2;
  tft.fillRect(x0, y0, px, px, ST77XX_WHITE);
  for (int y = 0; y < size; y++)
    for (int x = 0; x < size; x++)
      if (qrcodegen_getModule(qrCode, x, y))
        tft.fillRect(x0 + (x + 1) * s, y0 + (y + 1) * s, s, s, ST77XX_BLACK);
}

// An address or explorer link. Returns false if it does not fit.
static bool drawQR(const char* text) {
  if (!qrcodegen_encodeText(text, qrTemp, qrCode, qrcodegen_Ecc_LOW, 1, QR_MAX_VERSION,
                            qrcodegen_Mask_AUTO, true)) return false;
  paintQR();
  return true;
}

// The portfolio link: URL prefix in byte mode, then the base43 payload in
// alphanumeric mode (5.5 bits per character instead of 8). That is what lets
// all 20 chains fit in one code. Returns false if it does not fit.
static bool drawPortfolioQR() {
  static char payload[PORTFOLIO_TEXT_MAX];
  if (portfolio_text(gAddr, payload, sizeof payload) < 0) return false;
  if (!portfolio_qr(PORTFOLIO_URL, payload, qrTemp, qrCode, QR_MAX_VERSION)) return false;
  paintQR();
  return true;
}

// ---------------- Address screens ----------------
// Text view. Press = QR, turn = next/prev chain, hold = back to list.
// Returns the chain index to continue with, or -1 for back.
static int showAddressText(int i) {
  const ChainAddr& a = gAddr[i];
  clearScreen();
  drawTitle(a.name);
  textAt(2, 14, a.path, C_DIM);
  // wrap the address to the screen width
  int cpl = (SCR_W - 4) / 6;            // chars per line (26 landscape, 20 portrait)
  int len = strlen(a.addr), y = 28;
  for (int o = 0; o < len && y < SCR_H - 28; o += cpl, y += 10) {
    char line[32]; strncpy(line, a.addr + o, cpl); line[cpl] = 0;
    textAt(2, y, line, C_HI);
  }
  textAt(2, SCR_H - 24, "turn: next chain", C_DIM);
  textAt(2, SCR_H - 14, "press: QR  hold: back", C_DIM);
  for (;;) {
    Ev e = waitEvent();
    if (e == EV_CW)  return (i + 1) % chains_count();
    if (e == EV_CCW) return (i + chains_count() - 1) % chains_count();
    if (e == EV_PRESS) return i | 0x100;    // flag: open QR
    if (isBack(e)) return -1;
  }
}

// QR view. Turn = toggle link / raw address, press = back to text, hold = back to list.
static bool showAddressQR(int i) {
  const ChainAddr& a = gAddr[i];
  bool link = (a.link != NULL);
  for (;;) {
    clearScreen();
    char buf[200];
    if (link) snprintf(buf, sizeof buf, a.link, a.addr);
    else      snprintf(buf, sizeof buf, "%s", a.addr);
    bool ok = drawQR(buf);
    if (!ok) textAt(4, 60, "too long for QR", C_BAD);
    // label in the left margin, one character per line
    const char* tag = link ? "LINK" : "RAW";
    for (int k = 0; tag[k]; k++) { char c[2] = {tag[k], 0}; textAt(2, 2 + k * 10, c, C_DIM); }
    Ev e = waitEvent();
    if (e == EV_CW || e == EV_CCW) { if (a.link) link = !link; continue; }
    if (e == EV_PRESS) return true;
    if (isBack(e)) return false;
  }
}

// Portfolio view. Press = QR with every address, press again = back here, hold = back to list.
static void showPortfolio() {
  for (;;) {
    clearScreen();
    drawTitle("Portfolio");
    textAt(2, 16, "All 20 addresses in", C_FG);
    textAt(2, 26, "one QR, public only.", C_FG);
    textAt(2, 42, "Scan: the web page", C_DIM);
    textAt(2, 52, "checks every chain.", C_DIM);
    textAt(2, 68, "BTC: 1st addr only.", C_DIM);
    textAt(2, SCR_H - 14, "press: QR  hold: back", C_DIM);
    Ev e = waitEvent();
    if (isBack(e)) return;
    if (e != EV_PRESS) continue;
    clearScreen();
    if (!drawPortfolioQR()) textAt(4, 60, "QR failed", C_BAD);
    const char* tag = "ALL";
    for (int k = 0; tag[k]; k++) { char c[2] = {tag[k], 0}; textAt(2, 2 + k * 10, c, C_DIM); }
    for (;;) {
      e = waitEvent();
      if (e == EV_PRESS) break;
      if (isBack(e)) return;
    }
  }
}

static void browseAddresses() {
  static const char* items[34];
  int n = chains_count();
  items[0] = "Portfolio (all chains)";
  for (int i = 0; i < n; i++) items[i + 1] = gAddr[i].name;
  items[n + 1] = "Wipe & exit";
  int sel = 0;
  while (gLoaded) {
    sel = runMenu("Addresses", items, n + 2, sel);
    if (sel == MENU_BACK) { sel = n + 1; continue; }    // hold just jumps to "Wipe & exit"
    if (sel < 0 || sel == n + 1) break;
    if (sel == 0) { showPortfolio(); continue; }
    int i = sel - 1;
    while (i >= 0 && gLoaded) {
      int r = showAddressText(i);
      if (r < 0) break;
      if (r & 0x100) { i = r & 0xFF; if (!showAddressQR(i)) break; }
      else i = r;
    }
    if (i >= 0) sel = (i & 0xFF) + 1;
  }
  wipeAll();
  clearScreen();
}

// ---------------- Derivation ----------------
static void deriveProgress(int done, int total) {
  tft.fillRect(5, 71, ((SCR_W - 10) * done) / total, 8, C_OK);
}

static void rngFill(uint8_t* buf, size_t len) {
  while (len) {
    uint32_t r = rp2040.hwrand32();     // RP2350 hardware TRNG
    size_t n = len < 4 ? len : 4;
    memcpy(buf, &r, n); buf += n; len -= n;
  }
}

static bool deriveFromEntered(int nwords) {
  // build the mnemonic string
  gMnemonic[0] = 0;
  for (int i = 0; i < nwords; i++) {
    if (i) strcat(gMnemonic, " ");
    strcat(gMnemonic, WORDS[gIdx[i]]);
  }
  clearScreen();
  drawTitle("Deriving addresses");
  textAt(4, 40, "Seed is in RAM only", C_DIM);
  textAt(4, 52, "for the next second.", C_DIM);
  tft.drawRect(4, 70, SCR_W - 8, 10, C_FG);
  int rc = derive_all(gMnemonic, "", gAddr, deriveProgress);
  wipeSecret();
  scrubStack();
  if (rc != 0) { wipeAll(); message("Derivation failed", nullptr, nullptr, C_BAD); return false; }
  gLoaded = true;
  return true;
}

// ---------------- Review before derive ----------------
// Shows every entered word. Returns 1 = derive, 0 = go back and fix the last word, -1 = aborted.
static int reviewWords(int nwords) {
  clearScreen();
  // "24mushroom" is 10 chars = 60 px, so 2 columns fit both landscape (160) and portrait (128)
  drawTitle(SCR_W >= 150 ? "Check  press:go  hold:fix" : "press:go  hold:fix");
  int cols = SCR_W / 62; if (cols < 1) cols = 1; if (cols > 3) cols = 3;
  int rows = (nwords + cols - 1) / cols;
  int rh = (SCR_H - 14) / rows; if (rh > 12) rh = 12;
  for (int i = 0; i < nwords; i++) {
    int c = i / rows, r = i % rows;
    tft.setCursor(2 + c * 62, 14 + r * rh);
    tft.setTextColor(C_DIM);
    if (i + 1 < 10) tft.print(' ');
    tft.print(i + 1);
    tft.setTextColor(C_HI);
    tft.print(WORDS[gIdx[i]]);
  }
  for (;;) {
    Ev e = waitEvent();
    if (e == EV_PRESS) return 1;
    if (e == EV_LONG) return 0;
    if (e == EV_TIMEOUT) return -1;   // words already wiped
  }
}

// ---------------- Seed entry ----------------
// Pick letters until the candidate list is short, then pick the word.
// Long press = backspace (or back one word, or cancel).
// Fills gIdx[startWord..nwords-1]; returns true when all words are in and the checksum passes.
static bool enterWords(int nwords, int startWord) {
  char prefix[6] = "";
  int plen = 0, w = startWord;
  static char ibuf[26][10];
  static const char* items[26];
  char t[40];
  while (w < nwords) {
    uint16_t cand[16];
    int total = 0;
    int nc = bip39_prefix(prefix, cand, 16, &total);
    int n = 0;
    bool pickingWord = (total <= 16);
    if (pickingWord) {
      for (int i = 0; i < nc; i++) { strncpy(ibuf[n], WORDS[cand[i]], 9); ibuf[n][9] = 0; items[n] = ibuf[n]; n++; }
    } else {
      for (char c = 'a'; c <= 'z'; c++) {
        char p2[7]; snprintf(p2, sizeof p2, "%s%c", prefix, c);
        int tt = 0; bip39_prefix(p2, nullptr, 0, &tt);
        if (tt) { ibuf[n][0] = c; ibuf[n][1] = 0; items[n] = ibuf[n]; n++; }
      }
    }
    snprintf(t, sizeof t, "Word %d/%d:  %s_", w + 1, nwords, prefix);
    int sel = runMenu(t, items, n, 0);
    if (sel == MENU_TIMEOUT) { clearScreen(); return false; }
    if (sel == MENU_BACK) {
      if (plen > 0) prefix[--plen] = 0;
      else if (w > 0) { w--; gIdx[w] = 0; }
      else { wipeSecret(); clearScreen(); return false; }
      continue;
    }
    if (pickingWord) { gIdx[w++] = cand[sel]; plen = 0; prefix[0] = 0; }
    else if (plen < 5) { prefix[plen++] = items[sel][0]; prefix[plen] = 0; }
  }
  uint8_t ent[32];
  bool ok = bip39_decode(gIdx, nwords, ent);
  secure_zero(ent, sizeof ent);
  if (!ok) {
    message("Checksum invalid", "A word is wrong, most", "likely the last one.", C_BAD);
    wipeSecret();
    return false;
  }
  return true;
}

// Entry, then review, then derive. The checksum only catches 15 of 16 wrong words
// on a 12-word seed (255 of 256 on 24), so the user eyeballs the list first.
static bool enterSeed(int nwords) {
  int start = 0;
  for (;;) {
    if (!enterWords(nwords, start)) return false;
    int r = reviewWords(nwords);
    if (r < 0) { wipeSecret(); clearScreen(); return false; }
    if (r == 1) return deriveFromEntered(nwords);
    start = nwords - 1;            // hold on review = redo the last word
    gIdx[start] = 0;
  }
}

// ---------------- Arduino entry points ----------------
void setup() {
  pinMode(ENC_A, INPUT_PULLUP);
  pinMode(ENC_B, INPUT_PULLUP);
  pinMode(ENC_SW, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(ENC_A), encISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(ENC_B), encISR, CHANGE);

  chains_set_rng(rngFill);

  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  SPI.setSCK(SPI_SCK);
  SPI.setTX(SPI_MOSI);
  SPI.setRX(SPI_MISO);
  tft.initR(INITR_BLACKTAB);   // if colors look wrong try INITR_GREENTAB or INITR_REDTAB
  tft.setRotation(TFT_ROTATION);
  tft.setTextWrap(false);
  tft.setTextSize(1);
  SCR_W = tft.width();
  SCR_H = tft.height();

  clearScreen();
  textAt((SCR_W - 13 * 6) / 2, 28, "S E E D B O X", C_HI);
  textAt(4, 50, "Seed in, addresses out.");
  textAt(4, 64, "Nothing is stored.", C_DIM);
  textAt(4, 76, "Power off = wiped.", C_DIM);
  textAt(4, SCR_H - 16, "press knob", C_DIM);
  lastInputMs = millis();
  while (waitEvent() != EV_PRESS) {}
  lastEnc = encPos;
}

void loop() {
  static const char* const items[] = { "Enter 12-word seed", "Enter 24-word seed", "About" };
  int sel = runMenu("SeedBox", items, 3, 0);
  switch (sel) {
    case 0: if (enterSeed(12)) browseAddresses(); break;
    case 1: if (enterSeed(24)) browseAddresses(); break;
    case 2: message("SeedBox v0.3", "20 chains, one-scan QR", "seed wiped after derive", C_FG); break;
    default: break;
  }
}

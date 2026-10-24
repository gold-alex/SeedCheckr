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
#define ENC_REVERSE    1                        // flip if the knob scrolls the wrong way (1 matches the reference board)
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

// Grey bar across the top. s = text size (1 = 8 px glyphs, 2 = 16 px).
static void drawTitle(const char* t, int s) {
  tft.fillRect(0, 0, SCR_W, 8 * s + 3, C_DIM);
  tft.setTextSize(s);
  tft.setTextColor(ST77XX_BLACK);
  tft.setCursor(2, 2);
  tft.print(t);
  tft.setTextSize(1);
  tft.setTextColor(C_FG);
}

static void drawTitle(const char* t) { drawTitle(t, 1); }

static void textAt(int x, int y, const char* s, uint16_t color) {
  tft.setTextColor(color);
  tft.setCursor(x, y);
  tft.print(s);
}

static void textAt(int x, int y, const char* s) { textAt(x, y, s, C_FG); }

// Text with the background painted too, padded with spaces to `width` characters,
// so it overwrites whatever was on that line. Screens that change on a knob turn
// use this instead of a full clear, which is what flashed.
static void lineAt(int x, int y, const char* s, uint16_t color, int width) {
  tft.setTextColor(color, C_BG);
  tft.setCursor(x, y);
  int n = 0;
  for (; s[n] && n < width; n++) tft.write(s[n]);
  for (; n < width; n++) tft.write(' ');
  tft.setTextColor(C_FG);
}

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

// One row of a list: the item on a yellow bar when it is the cursor, on black
// otherwise, and a blank row past the end of the list. s = text size.
static void menuRow(const char* const* items, int n, int top, int sel, int i, int s) {
  int rowH = 9 * s, y = 8 * s + 6 + i * rowH;
  bool cur = (top + i < n) && (top + i == sel);
  tft.fillRect(0, y, SCR_W - 4, rowH, cur ? C_HI : C_BG);
  if (top + i >= n) return;
  tft.setTextSize(s);
  tft.setTextColor(cur ? ST77XX_BLACK : C_FG);
  tft.setCursor(2 * s, y + (rowH - 8 * s) / 2);
  tft.print(items[top + i]);
  tft.setTextSize(1);
  tft.setTextColor(C_FG);
}

// Scrollable list. Knob moves, press selects. Returns index, MENU_BACK or MENU_TIMEOUT.
// s = text size: 1 for long lists, 2 for the main menu (12 px wide glyphs, so 12
// characters fit a 160 px screen). Never clears the screen: every row is painted
// over whatever was there, and a knob turn repaints only the two rows that changed.
static int runMenu(const char* t, const char* const* items, int n, int sel, int s) {
  const int rowH = 9 * s, y0 = 8 * s + 6;         // rows start 3 px under the title bar
  const int VIS = (SCR_H - y0) / rowH;
  int top = 0, prevTop = -1, prevSel = -1;
  if (sel < 0 || sel >= n) sel = 0;
  drawTitle(t, s);
  tft.fillRect(0, y0 - 3, SCR_W, 3, C_BG);                                  // gap under the title
  tft.fillRect(0, y0 + VIS * rowH, SCR_W, SCR_H - y0 - VIS * rowH, C_BG);   // strip under the last row
  for (;;) {
    if (sel < top) top = sel;
    if (sel >= top + VIS) top = sel - VIS + 1;
    if (top != prevTop) {                       // first draw, or the list scrolled
      for (int i = 0; i < VIS; i++) menuRow(items, n, top, sel, i, s);
      tft.fillRect(SCR_W - 4, y0, 4, SCR_H - y0, C_BG);
      if (n > VIS) {   // scrollbar
        int h = (SCR_H - y0) * VIS / n; if (h < 4) h = 4;
        int y = y0 + (SCR_H - y0 - h) * top / (n - VIS);
        tft.fillRect(SCR_W - 3, y, 2, h, C_DIM);
      }
    } else if (sel != prevSel) {                // cursor moved within the visible rows
      menuRow(items, n, top, sel, prevSel - top, s);
      menuRow(items, n, top, sel, sel - top, s);
    }
    prevTop = top; prevSel = sel;
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
  int sq = (SCR_W < SCR_H ? SCR_W : SCR_H);
  tft.fillRect((SCR_W - sq) / 2, (SCR_H - sq) / 2, sq, sq, ST77XX_WHITE);   // the quiet zone, and it
                                                                            // covers whatever QR was here
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
static bool gAddrScreenLive = false;    // the fixed parts of the text view are already on screen

static int showAddressText(int i) {
  const ChainAddr& a = gAddr[i];
  int cpl = (SCR_W - 4) / 6;            // chars per line (26 landscape, 20 portrait)
  if (!gAddrScreenLive) {
    clearScreen();
    textAt(2, SCR_H - 24, "turn: next chain", C_DIM);
    textAt(2, SCR_H - 14, "press: QR  hold: back", C_DIM);
    gAddrScreenLive = true;
  }
  drawTitle(a.name);
  lineAt(2, 14, a.path, C_DIM, cpl);
  // wrap the address to the screen width; unused lines are blanked so a shorter
  // address fully replaces a longer one when the knob moves to the next chain
  int len = strlen(a.addr);
  for (int o = 0, y = 28; y < SCR_H - 28; o += cpl, y += 10)
    lineAt(2, y, o < len ? a.addr + o : "", C_HI, cpl);
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
  gAddrScreenLive = false;
  clearScreen();
  for (;;) {
    char buf[200];
    if (link) snprintf(buf, sizeof buf, a.link, a.addr);
    else      snprintf(buf, sizeof buf, "%s", a.addr);
    bool ok = drawQR(buf);
    if (!ok) { clearScreen(); textAt(4, 60, "too long for QR", C_BAD); }
    // label in the left margin, one character per line
    tft.fillRect(0, 0, 10, 44, C_BG);
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
    sel = runMenu("Addresses", items, n + 2, sel, 1);
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
    gAddrScreenLive = false;
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

// ---------------- Phrase overview ----------------
// Every slot of the phrase on one screen, two columns. Turn moves over the words
// that are in (plus the next empty slot), press edits that word, hold goes back.
// Once every slot is filled an extra item sits above word 1, drawn in the title
// bar: derive. Nothing here clears the screen; each cell paints its own background.
#define PS_DERIVE  (-1)
#define PS_BACK    (-2)
#define PS_TIMEOUT (-3)

// Returns a slot index to edit, PS_DERIVE, PS_BACK or PS_TIMEOUT.
static int phraseScreen(int nwords, int filled, int cur) {
  const bool full = (filled == nwords);
  const int cols = 2, rows = (nwords + cols - 1) / cols;
  const int cellW = (SCR_W - 4) / cols, cpl = cellW / 6;      // 13 / 10 chars per cell
  int rh = (SCR_H - 14) / rows; if (rh > 12) rh = 12;         // 12 px rows for 12 words, 9 for 24
  const int lo = full ? PS_DERIVE : 0, hi = full ? nwords - 1 : filled;
  if (cur < lo) cur = lo;
  if (cur > hi) cur = hi;

  // number (black on yellow when it is the cursor), then the word or "----"
  auto cell = [&](int i, bool sel) {
    int x = 2 + (i / rows) * cellW, y = 14 + (i % rows) * rh, pad = (rh - 8) / 2;
    tft.setCursor(x, y + pad);
    tft.setTextColor(sel ? ST77XX_BLACK : C_DIM, sel ? C_HI : C_BG);
    if (i + 1 < 10) tft.write(' ');
    tft.print(i + 1);
    int n = 2;
    const char* w = (i < filled) ? WORDS[gIdx[i]] : "----";
    tft.setTextColor(sel ? C_HI : (i < filled ? C_FG : C_DIM), C_BG);
    if (cpl >= 12) { tft.write(' '); n++; }
    for (; *w && n < cpl; w++, n++) tft.write(*w);
    for (; n < cpl; n++) tft.write(' ');
    tft.setTextColor(C_FG);
    tft.fillRect(x + cpl * 6, y, cellW - cpl * 6, rh, C_BG);    // pixels no character covers
    tft.fillRect(x, y, cellW, pad, C_BG);
    tft.fillRect(x, y + pad + 8, cellW, rh - pad - 8, C_BG);
  };
  auto title = [&](int c) {
    if (c == PS_DERIVE) {
      tft.fillRect(0, 0, SCR_W, 11, C_HI);
      textAt(2, 2, "> Derive addresses", ST77XX_BLACK);
    } else drawTitle(c < filled ? "press: edit   hold: back" : "press: type   hold: back");
  };

  // frame: the strips no cell covers, then every cell
  tft.fillRect(0, 11, SCR_W, 3, C_BG);
  tft.fillRect(0, 14, 2, rows * rh, C_BG);
  tft.fillRect(2 + cols * cellW, 14, SCR_W - 2 - cols * cellW, rows * rh, C_BG);
  tft.fillRect(0, 14 + rows * rh, SCR_W, SCR_H - 14 - rows * rh, C_BG);
  for (int i = 0; i < nwords; i++) cell(i, i == cur);

  int prev = cur, shown = -9;
  for (;;) {
    int kind = (cur == PS_DERIVE) ? 0 : (cur < filled ? 1 : 2);
    if (kind != shown) { title(cur); shown = kind; }
    if (prev != cur) {
      if (prev >= 0) cell(prev, false);
      if (cur >= 0) cell(cur, true);
    }
    prev = cur;
    Ev e = waitEvent();
    if (e == EV_CW)        cur = (cur == hi) ? lo : cur + 1;
    else if (e == EV_CCW)  cur = (cur == lo) ? hi : cur - 1;
    else if (e == EV_PRESS) return cur;
    else if (e == EV_LONG)  return PS_BACK;
    else if (e == EV_TIMEOUT) return PS_TIMEOUT;
  }
}

// ---------------- Seed entry ----------------
// One screen per word. What has been typed so far sits big and yellow at the top,
// the words that match it fill the middle, a letter keyboard sits under them, and
// a row of word controls under that. One knob
// cursor runs through the words, then the keys, then the controls. Press a word to
// take it, a letter to narrow the list, the arrow to delete a letter (or step back
// a word when nothing is typed, or quit on the first word). Holding the knob jumps
// between the list and the keyboard, so a long list never has to be scrolled through.
// "< prev" and "next >" move between words without retyping them, "see all" shows
// the whole phrase.
#define KEY_COLS 9
#define KEY_DEL  26
#define KEY_PREV 27
#define KEY_ALL  28
#define KEY_NEXT 29
#define NKEYS    30                  // a-z, delete, and the 3 word controls
#define WS_DEL     (-1)
#define WS_PREV    (-2)
#define WS_NEXT    (-3)
#define WS_ALL     (-4)
#define WS_TIMEOUT (-5)
#define WS_LETTER  0x1000            // return value: WS_LETTER | 'x'

static void wsGeometry(WordScreen& g) {
  g.keyH = 12;
  g.keyY = SCR_H - 4 * g.keyH;                   // 80 landscape, 112 portrait: 3 letter rows + controls
  g.keyW = (SCR_W - 2) / KEY_COLS;               // 17 / 14
  g.ctlW = (SCR_W - 2) / 3;                      // 52 / 42
  g.listY = 22;                                  // under the top strip (wsDrawTop)
  g.lines = (g.keyY - 3 - g.listY) / 10;         // 5 / 8
  g.cols = 2;
  g.cellW = (SCR_W - 4) / g.cols;                // 78 / 62
  g.cpl = g.cellW / 6;                           // 13 / 10 chars, marker included
  g.perPage = g.lines * g.cols;                  // 10 / 16
}

// Top strip: "Word" and "n/N" small on the left, what is being typed in double-size
// yellow beside them with an underscore cursor. With nothing typed, the word the
// slot already holds in grey, or just the cursor. Painted in place, no clear.
static void wsDrawTop(const WordScreen& g, int w, int nwords, int filled, const char* prefix) {
  char num[8]; snprintf(num, sizeof num, "%d/%d", w + 1, nwords);
  lineAt(2, 2, "Word", C_FG, 5);
  lineAt(2, 12, num, C_FG, 5);
  const int bx = 34, bw = 8 * 12;                // 8 glyphs of 12 px: the longest BIP39 word
  char big[10];
  uint16_t color = C_HI;
  if (prefix[0]) snprintf(big, sizeof big, "%s_", prefix);
  else if (w < filled) { snprintf(big, sizeof big, "%s", WORDS[gIdx[w]]); color = C_DIM; }
  else snprintf(big, sizeof big, "_");
  tft.setTextSize(2);
  tft.setTextColor(color, C_BG);
  tft.setCursor(bx, 2);
  int n = 0;
  for (; big[n] && n < 8; n++) tft.write(big[n]);
  for (; n < 8; n++) tft.write(' ');
  tft.setTextSize(1);
  tft.setTextColor(C_FG);
  // the pixels no glyph covers
  tft.fillRect(0, 0, SCR_W, 2, C_BG);
  tft.fillRect(0, 2, 2, g.listY - 2, C_BG);
  tft.fillRect(2, 10, bx - 2, 2, C_BG);
  tft.fillRect(2, 20, bx - 2, g.listY - 20, C_BG);
  tft.fillRect(2 + 5 * 6, 2, bx - 2 - 5 * 6, 18, C_BG);   // between the small lines and the big one
  tft.fillRect(bx, 18, SCR_W - bx, g.listY - 18, C_BG);
  if (SCR_W > bx + bw) tft.fillRect(bx + bw, 2, SCR_W - bx - bw, 16, C_BG);
}

// One word cell: marker, word, padding; the 2 px under it is cleared too so the
// cell fully covers whatever screen was here before. No clear, no flash.
static void wsDrawWord(const WordScreen& g, int first, int total, int page, int k, bool cur) {
  int idx = page * g.perPage + k;
  int x = 2 + (k / g.lines) * g.cellW, y = g.listY + (k % g.lines) * 10;
  const char* w = (idx < total) ? WORDS[first + idx] : "";
  tft.setTextColor(cur ? C_HI : C_FG, C_BG);
  tft.setCursor(x, y);
  tft.write(cur ? '>' : ' ');
  int n = 1;
  for (; *w && n < g.cpl; w++, n++) tft.write(*w);
  for (; n < g.cpl; n++) tft.write(' ');
  tft.setTextColor(C_FG);
  tft.fillRect(x + g.cpl * 6, y, g.cellW - g.cpl * 6, 10, C_BG);   // leftover width, if any
  tft.fillRect(x, y + 8, g.cellW, 2, C_BG);
}

// A letter key, the delete key, or one of the three word controls on the bottom row.
static void wsDrawKey(const WordScreen& g, int k, bool enabled, bool cur) {
  int x, y, w;
  char one[2] = { (char)('a' + k), 0 };
  const char* label = one;
  if (k < KEY_PREV) {
    x = 1 + (k % KEY_COLS) * g.keyW; y = g.keyY + (k / KEY_COLS) * g.keyH; w = g.keyW;
    if (k == KEY_DEL) one[0] = '\x1B';           // 0x1B is the left arrow in the built-in font
  } else {
    x = 1 + (k - KEY_PREV) * g.ctlW; y = g.keyY + 3 * g.keyH; w = g.ctlW;
    label = (k == KEY_PREV) ? "< prev" : (k == KEY_ALL) ? "see all" : "next >";
  }
  tft.fillRect(x, y, w, g.keyH, cur ? C_HI : C_BG);
  tft.setTextColor(cur ? ST77XX_BLACK : (enabled ? C_FG : C_DIM));
  tft.setCursor(x + (w - 6 * (int)strlen(label)) / 2, y + 2);
  tft.print(label);
  tft.setTextColor(C_FG);
}

// Word w of nwords; slots 0..filled-1 already hold a word. Returns a word index,
// WS_LETTER | letter, or one of the WS_ codes.
static int wordScreen(int w, int nwords, int filled, const char* prefix) {
  WordScreen g; wsGeometry(g);
  uint16_t f1[1]; int total = 0;
  int first = bip39_prefix(prefix, f1, 1, &total) ? f1[0] : 0;   // matches are contiguous in the sorted list
  bool keyOk[NKEYS];
  for (int k = 0; k < 26; k++) {
    char p2[10]; snprintf(p2, sizeof p2, "%s%c", prefix, 'a' + k);
    int tt = 0; bip39_prefix(p2, nullptr, 0, &tt);
    keyOk[k] = tt > 0;
  }
  keyOk[KEY_DEL]  = true;
  keyOk[KEY_PREV] = w > 0;
  keyOk[KEY_ALL]  = true;
  keyOk[KEY_NEXT] = w < filled;                  // only past a slot that already has a word
  const int nItems = total + NKEYS;
  auto enabled = [&](int c) { return c < total || keyOk[c - total]; };
  int cur = (total <= g.perPage) ? 0 : total;      // on the first word if they all fit, else on the keyboard
  while (!enabled(cur)) cur++;

  // frame: top strip, the strips no cell covers, the keyboard
  wsDrawTop(g, w, nwords, filled, prefix);
  int listBottom = g.listY + g.lines * 10;
  tft.fillRect(0, g.listY, 2, listBottom - g.listY, C_BG);
  tft.fillRect(2 + g.cols * g.cellW, g.listY, SCR_W - 2 - g.cols * g.cellW, listBottom - g.listY, C_BG);
  tft.fillRect(0, listBottom, SCR_W, g.keyY - listBottom, C_BG);
  {
    const char* hint = "hold: words <-> keys";       // the gap between list and keys is 8 px: one text line
    textAt((SCR_W - 6 * (int)strlen(hint)) / 2, g.keyY - 8, hint, C_DIM);
  }
  tft.fillRect(0, g.keyY, 1, SCR_H - g.keyY, C_BG);
  tft.fillRect(1 + KEY_COLS * g.keyW, g.keyY, SCR_W - 1 - KEY_COLS * g.keyW, SCR_H - g.keyY, C_BG);
  for (int k = 0; k < NKEYS; k++) wsDrawKey(g, k, keyOk[k], cur == total + k);

  int page = -1, prev = -1;
  for (;;) {
    int np = (cur < total) ? cur / g.perPage : (page < 0 ? 0 : page);
    if (np != page) {
      page = np;
      for (int k = 0; k < g.perPage; k++) wsDrawWord(g, first, total, page, k, cur == page * g.perPage + k);
    }
    int cs[2] = { prev, cur };                   // repaint the two cells that changed
    for (int j = 0; j < 2; j++) {
      int c = cs[j];
      if (c < 0) continue;
      if (c >= total) wsDrawKey(g, c - total, keyOk[c - total], c == cur);
      else if (c / g.perPage == page) wsDrawWord(g, first, total, page, c % g.perPage, c == cur);
    }
    prev = cur;
    Ev e = waitEvent();
    if (e == EV_CW || e == EV_CCW) {
      int d = (e == EV_CW) ? 1 : -1;
      do { cur = (cur + d + nItems) % nItems; } while (!enabled(cur));
    } else if (e == EV_PRESS) {
      if (cur < total) return first + cur;
      int k = cur - total;
      if (k == KEY_DEL)  return WS_DEL;
      if (k == KEY_PREV) return WS_PREV;
      if (k == KEY_ALL)  return WS_ALL;
      if (k == KEY_NEXT) return WS_NEXT;
      return WS_LETTER | ('a' + k);
    } else if (e == EV_LONG) {                     // jump: list <-> keyboard
      if (cur < total) { cur = total; while (!enabled(cur)) cur++; }
      else if (total > 0) cur = page * g.perPage;   // top of the page that is showing
    } else if (e == EV_TIMEOUT) return WS_TIMEOUT;
  }
}

static bool checksumOk(int nwords) {
  uint8_t ent[32];
  bool ok = bip39_decode(gIdx, nwords, ent);
  secure_zero(ent, sizeof ent);
  if (!ok) message("Checksum invalid", "One word is wrong.", "Pick it and retype it.", C_BAD);
  return ok;
}

// Entry: one word screen at a time, the phrase overview whenever the user asks for
// it and once every slot is in. The checksum only catches 15 of 16 wrong words on a
// 12-word seed (255 of 256 on 24), so the user eyeballs the phrase before deriving.
// A wrong checksum sends them back to the overview to fix a word, not to the menu.
static bool enterSeed(int nwords) {
  char prefix[8] = "";
  int plen = 0, w = 0, filled = 0;             // slots 0..filled-1 hold a word; w is the one on screen
  auto clearPrefix = [&]() { plen = 0; prefix[0] = 0; };
  for (;;) {
    if (w >= nwords) {                         // every slot is in: check the phrase, then derive
      int p = phraseScreen(nwords, filled, PS_DERIVE);
      if (p == PS_TIMEOUT) { clearScreen(); return false; }
      if (p == PS_BACK) { w = nwords - 1; continue; }
      if (p >= 0) { w = p; continue; }
      if (!checksumOk(nwords)) continue;
      return deriveFromEntered(nwords);
    }
    int r = wordScreen(w, nwords, filled, prefix);
    if (r >= 0 && !(r & WS_LETTER)) {          // a word was picked
      gIdx[w] = (uint16_t)r;
      if (w == filled) filled++;
      w++; clearPrefix();
    } else if (r >= 0) {                       // a letter
      if (plen < 6) { prefix[plen++] = (char)(r & 0xFF); prefix[plen] = 0; }
    } else if (r == WS_DEL) {
      if (plen > 0) prefix[--plen] = 0;
      else if (w > 0) w--;
      else if (filled == 0) { clearScreen(); return false; }    // nothing typed yet: back to the menu
      else {                                                    // words are in: make sure
        static const char* const q[] = { "Keep typing", "Quit, forget words" };
        int a = runMenu("Quit?", q, 2, 0, 1);
        if (a == MENU_TIMEOUT) { clearScreen(); return false; }
        if (a == 1) { wipeSecret(); clearScreen(); return false; }
      }
    } else if (r == WS_PREV) { w--; clearPrefix(); }
    else if (r == WS_NEXT) { w++; clearPrefix(); }
    else if (r == WS_ALL) {
      int p = phraseScreen(nwords, filled, w);
      if (p == PS_TIMEOUT) { clearScreen(); return false; }
      if (p >= 0) { w = p; clearPrefix(); }
      else if (p == PS_DERIVE) {
        if (checksumOk(nwords)) return deriveFromEntered(nwords);
        w = nwords;                            // back to the overview to fix a word
      }
      // PS_BACK: stay on this word, typed letters kept
    } else { clearScreen(); return false; }    // WS_TIMEOUT: already wiped
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
  static const char* const items[] = { "12-word seed", "24-word seed", "About" };
  int s = (SCR_W >= 150) ? 2 : 1;        // double-size type; 12 chars x 12 px fit the 160 px screen
  int sel = runMenu("SeedBox", items, 3, 0, s);
  switch (sel) {
    case 0: if (enterSeed(12)) browseAddresses(); break;
    case 1: if (enterSeed(24)) browseAddresses(); break;
    case 2: message("SeedBox v0.3", "20 chains, one-scan QR", "seed wiped after derive", C_FG); break;
    default: break;
  }
}

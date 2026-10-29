/*
 * SeedBox - offline seed phrase -> public address viewer
 *
 * Hardware: Raspberry Pi Pico 2 (RP2350)
 *           1.8" ST7735 TFT, 128x160, SPI  (Lee's PID 18403)
 *           Bourns PEC11R rotary encoder with push switch
 *
 * Flow:
 *   1. Type a 12, 15, 18, 21 or 24 word BIP39 seed in with the knob, or a 20 or 33
 *      word SLIP-39 (Shamir) backup, every share it needs; then an optional passphrase.
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
#include <glcdfont.c>          // Adafruit GFX's built-in 5x7 font, for the sideways QR labels
#include "seedcore.h"
#include "src/slip39.h"
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
#define C_BAR 0x2A31            // title bars: deep blue, white text on it
#define C_TRK 0x2104            // empty part of a progress track

Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);

// ---------------- State ----------------
// Secret: only exists between the first word being entered and derivation finishing.
#define MAX_WORDS 33              // SLIP-39 256-bit shares; BIP39 tops out at 24
#define PASS_MAX  100             // passphrase length (Ledger allows 100, Trezor 50)
static uint16_t gIdx[MAX_WORDS];
static bool     gHave[MAX_WORDS]; // slot i holds a word (slots can be filled in any order)
static char     gMnemonic[24 * 9];
static bool     gSlip = false;    // the words being typed are a SLIP-39 share (20/33-word backup)
static int      gShareNo = 0;     // SLIP-39: which share is on screen (1, 2, ...)
static Slip39Set gShares;         // SLIP-39 shares typed so far
static char     gPass[PASS_MAX + 1];   // passphrase, "" for none
// Public: derived addresses, kept until wipe / idle timeout / power off.
static ChainAddr gAddr[CHAINS_MAX];
static bool      gLoaded = false;
static bool      gUsedPass = false;   // the addresses were derived with a passphrase (shown in titles)

static int haveCount(int nwords) { int n = 0; for (int i = 0; i < nwords; i++) n += gHave[i]; return n; }

static void wipeWords() {
  secure_zero(gIdx, sizeof gIdx);
  secure_zero(gHave, sizeof gHave);
  secure_zero(gMnemonic, sizeof gMnemonic);
}

static void wipeSecret() {
  wipeWords();
  secure_zero(&gShares, sizeof gShares);
  secure_zero(gPass, sizeof gPass);
}

static void wipeAll() {
  wipeSecret();
  secure_zero(gAddr, sizeof gAddr);
  gLoaded = false;
  gUsedPass = false;
}

// The word list being typed from: BIP39 (2048 words) or SLIP-39 (1024).
static const char* wordAt(int i) { return gSlip ? slip39_word(i) : WORDS[i]; }
// How many words start with prefix; *first = the first of them (lists are sorted).
static int matches(const char* prefix, int* first) {
  if (gSlip) return slip39_prefix(prefix, first);
  uint16_t f = 0; int total = 0;
  bip39_prefix(prefix, &f, 1, &total);
  if (first) *first = total ? f : 0;
  return total;
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
// While the knob is held, a yellow bar grows across a 2 px strip and reaches the
// far edge the moment the hold fires, so "back" is never a guess. It starts after
// 200 ms so ordinary presses draw nothing. The strip is the bottom of the screen,
// or the top on the word screen, whose keyboard reaches the bottom edge.
static int  gHoldY  = -1;        // strip row; -1 = bottom of the screen
static bool gHoldQR = false;     // a QR is up: its white quiet zone reaches the bottom
static int  holdW   = 0;         // how much of the bar is drawn

static void holdClear() {
  if (!holdW) return;
  int y = gHoldY < 0 ? SCR_H - 2 : gHoldY;
  tft.fillRect(0, y, SCR_W, 2, C_BG);
  if (gHoldQR && gHoldY < 0) {
    int sq = SCR_W < SCR_H ? SCR_W : SCR_H;
    tft.fillRect((SCR_W - sq) / 2, y, sq, 2, ST77XX_WHITE);
  }
  holdW = 0;
}

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
    else { holdClear(); if (!longFired) return EV_PRESS; }
  }
  if (down && !longFired) {
    uint32_t held = now - downAt;
    if (held >= LONG_PRESS_MS) { longFired = true; holdClear(); return EV_LONG; }
    if (held >= 200) {
      int w = (int)((SCR_W * (held - 200)) / (LONG_PRESS_MS - 200));
      if (w > holdW) { tft.fillRect(holdW, gHoldY < 0 ? SCR_H - 2 : gHoldY, w - holdW, 2, C_HI); holdW = w; }
    }
  }

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

// Like waitEvent, but gives up after ms and returns EV_NONE (for animations).
static Ev waitEventFor(uint32_t ms) {
  uint32_t t0 = millis();
  for (;;) {
    Ev e = pollEvent();
    if (e == EV_TIMEOUT) { wipeAll(); return e; }
    if (e != EV_NONE) return e;
    if (millis() - t0 >= ms) return EV_NONE;
    delay(2);
  }
}

static bool isBack(Ev e) { return e == EV_LONG || e == EV_TIMEOUT; }

// ---------------- Drawing helpers ----------------
static void clearScreen() { tft.fillScreen(C_BG); }

// Grey bar across the top. s = text size (1 = 8 px glyphs, 2 = 16 px).
static void drawTitle(const char* t, int s) {
  tft.fillRect(0, 0, SCR_W, 8 * s + 3, C_BAR);
  tft.setTextSize(s);
  tft.setTextColor(C_FG);
  tft.setCursor(2, 2);
  tft.print(t);
  tft.setTextSize(1);
  tft.setTextColor(C_FG);
}

static void drawTitle(const char* t) { drawTitle(t, 1); }

// Small text at the right end of a size-1 title bar, e.g. "3/20".
static void titleTag(const char* t) {
  tft.setTextColor(C_HI);
  tft.setCursor(SCR_W - 2 - 6 * (int)strlen(t), 2);
  tft.print(t);
  tft.setTextColor(C_FG);
}

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

// Full-screen message, waits for a press. Returns true if it ended in the idle timeout:
// everything secret is wiped by then, and the caller must stop, not carry on.
static bool message(const char* l1, const char* l2, const char* l3, uint16_t color) {
  clearScreen();
  textAt(4, 30, l1, color);
  if (l2) textAt(4, 48, l2);
  if (l3) textAt(4, 66, l3);
  textAt(4, SCR_H - 16, "press knob", C_DIM);
  for (;;) {
    Ev e = waitEvent();
    if (e == EV_TIMEOUT) return true;
    if (e == EV_PRESS || e == EV_LONG) return false;
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
// Streams the code to the panel in one pass, top to bottom, one pixel row at a time:
// every pixel of the square is written exactly once (white or black), so a new code
// replaces the old one without a blank square in between. At the display's 32 MHz SPI
// a version 10 code (118 x 118 px) is about 28 KB, roughly 10 ms on the wire, against
// ~1700 separate small rectangles after a white fill before. A phone camera filming the
// moving QR therefore almost never catches a half-drawn frame. gQrDrawUs keeps the last
// measured time so the "more chains" view can show it.
static uint32_t gQrDrawUs = 0;
static void paintQR() {
  uint32_t t0 = micros();
  int size = qrcodegen_getSize(qrCode);
  int cells = size + 2;                                    // 1 module of quiet zone each side
  int sq = (SCR_W < SCR_H ? SCR_W : SCR_H);
  int s = sq / cells;
  int px = s * cells;
  int x0 = (SCR_W - px) / 2, y0 = (SCR_H - px) / 2;
  int qx = (SCR_W - sq) / 2, qy = (SCR_H - sq) / 2;
  if (px < sq) {                                           // white band between the code and the square
    tft.fillRect(qx, qy, sq, y0 - qy, ST77XX_WHITE);
    tft.fillRect(qx, y0 + px, sq, qy + sq - y0 - px, ST77XX_WHITE);
    tft.fillRect(qx, y0, x0 - qx, px, ST77XX_WHITE);
    tft.fillRect(x0 + px, y0, qx + sq - x0 - px, px, ST77XX_WHITE);
  }
  static uint16_t line[160];                               // one pixel row; px <= min(SCR_W, SCR_H)
  tft.startWrite();
  tft.setAddrWindow(x0, y0, px, px);
  for (int cy = 0; cy < cells; cy++) {
    int my = cy - 1;
    for (int cx = 0; cx < cells; cx++) {
      int mx = cx - 1;
      bool dark = mx >= 0 && my >= 0 && mx < size && my < size && qrcodegen_getModule(qrCode, mx, my);
      uint16_t c = dark ? ST77XX_BLACK : ST77XX_WHITE;
      for (int k = 0; k < s; k++) line[cx * s + k] = c;
    }
    for (int k = 0; k < s; k++) tft.writePixels(line, px, true, false);
  }
  tft.endWrite();
  gQrDrawUs = micros() - t0;
}

// Text turned on its side, using the same font as everything else. dir > 0 reads
// bottom to top from (x, y) = bottom-left; dir < 0 reads top to bottom from (x, y) = top-left.
static void vtext(int x, int y, const char* t, uint16_t c, int dir) {
  for (int k = 0; t[k]; k++) {
    const unsigned char* g = &font[(unsigned char)t[k] * 5];
    for (int col = 0; col < 5; col++) {
      uint8_t bits = pgm_read_byte(g + col);
      for (int r = 0; r < 8; r++) {
        if (!(bits & (1 << r))) continue;
        if (dir > 0) tft.drawPixel(x + r, y - 6 * k - 1 - col, c);
        else         tft.drawPixel(x + 7 - r, y + 6 * k + col, c);
      }
    }
  }
}

// Labels in the margins beside a QR: on the left, what the code is (yellow) and a
// hint (grey) reading up; on the right, what it belongs to, reading down. Portrait
// has its margins above and below instead, so the labels go there flat.
static void qrLabels(const char* what, const char* hint, const char* whose) {
  int sq = SCR_W < SCR_H ? SCR_W : SCR_H;
  int m = (SCR_W - sq) / 2;
  if (m >= 10) {
    tft.fillRect(0, 0, m, SCR_H, C_BG);
    tft.fillRect(SCR_W - m, 0, m, SCR_H, C_BG);
    int x = (m - 8) / 2, yb = SCR_H - 4;
    vtext(x, yb, what, C_HI, 1);
    vtext(x, yb - 6 * (int)strlen(what), hint, C_DIM, 1);
    vtext(SCR_W - m + x, 4, whose, C_FG, -1);
  } else {
    int mt = (SCR_H - sq) / 2;
    if (mt < 10) return;
    tft.fillRect(0, 0, SCR_W, mt, C_BG);
    tft.fillRect(0, SCR_H - mt, SCR_W, mt, C_BG);
    textAt(2, (mt - 8) / 2, what, C_HI);
    textAt(2 + 6 * (int)strlen(what), (mt - 8) / 2, hint, C_DIM);
    textAt(2, SCR_H - mt + (mt - 8) / 2, whose, C_FG);
  }
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

// Frame i (1-based) of the "more chains" codes: every row with ext != 0, as the
// animated frames of docs/EXTENSIONS.md. Returns false if it does not fit.
static bool drawMoreFrame(int i) {
  char text[PORTFOLIO_FRAME_TEXT_MAX];
  if (portfolio_frame_text(gAddr, chains_count(), i, text, sizeof text) < 0) return false;
  if (!portfolio_frame_qr(text, qrTemp, qrCode, QR_MAX_VERSION)) return false;
  paintQR();
  return true;
}

// ---------------- Address screens ----------------
// Text view. Press = QR, turn = next/prev chain, hold = back to list.
// Returns the chain index to continue with, or -1 for back.
static bool gAddrScreenLive = false;    // the fixed parts of the text view are already on screen

// The address as large as it fits: text size 2 (13 characters a line) when it
// fits the area, size 1 otherwise (xpubs). Characters alternate yellow / white in
// groups of 4 so it can be read off and compared in chunks. Painted in place; the
// area is only blanked when the size changes between chains.
static int gAddrSize = 0;

static void drawAddress(const char* addr, int y0, int y1) {
  int len = strlen(addr);
  int s = 2, cpl = (SCR_W - 4) / 12, lh = 17;
  if (len > cpl * ((y1 - y0) / lh)) { s = 1; cpl = (SCR_W - 4) / 6; lh = 10; }
  if (s != gAddrSize) { tft.fillRect(0, y0, SCR_W, y1 - y0, C_BG); gAddrSize = s; }
  int lines = (y1 - y0) / lh;
  tft.setTextSize(s);
  for (int l = 0; l < lines; l++) {
    tft.setCursor(2, y0 + l * lh);
    for (int c = 0; c < cpl; c++) {
      int i = l * cpl + c;
      tft.setTextColor(((i / 4) & 1) ? C_FG : C_HI, C_BG);
      tft.write(i < len ? addr[i] : ' ');
    }
  }
  tft.setTextSize(1);
  tft.setTextColor(C_FG);
}

static int showAddressText(int i) {
  const ChainAddr& a = gAddr[i];
  int cpl = (SCR_W - 4) / 6;            // chars per line (26 landscape, 20 portrait)
  if (!gAddrScreenLive) {
    clearScreen();
    gAddrSize = 0;
    textAt(2, SCR_H - 10, "press: QR", C_DIM);
    textAt(SCR_W - 2 - 6 * 10, SCR_H - 10, "hold: back", C_DIM);
    gAddrScreenLive = true;
  }
  char pos[28]; snprintf(pos, sizeof pos, "\x11%d/%d\x10", i + 1, chains_count());   // turn arrows
  drawTitle(a.name);
  titleTag(pos);
  lineAt(2, 14, a.path, C_DIM, cpl);
  drawAddress(a.addr, 26, SCR_H - 12);
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
    gHoldQR = ok;
    if (!ok) { clearScreen(); textAt(4, 60, "too long for QR", C_BAD); }
    if (link)        qrLabels("EXPLORER", "  turn: raw", a.name);
    else if (a.link) qrLabels("ADDRESS", "  turn: link", a.name);
    else             qrLabels("ADDRESS", "", a.name);
    Ev e = waitEvent();
    if (e == EV_CW || e == EV_CCW) { if (a.link) link = !link; continue; }
    gHoldQR = false;
    if (e == EV_PRESS) return true;
    if (isBack(e)) return false;
  }
}

// "More chains" view: the rows the Portfolio QR has no room for, as frames that
// loop by themselves for the page's in-page camera scanner. Turn = step one frame
// and pause, press = pause / play, hold = back to the Portfolio QR.
// One loop is the n chunks, then 2n fountain frames (each the XOR of about half the
// chunks): a phone that missed a chunk rebuilds it from whatever it reads next instead
// of waiting a whole loop for that one frame to come round again. Each loop shows new
// fountain frames (numbers n+1 up to 999, then round again), so the mixes keep changing.
#define MORE_FRAME_MS 400   // per frame. Chosen with test/verify_screen.js: 350-400 ms collects all
                            // frames fastest for both quick and slow phones; the QR itself redraws in ~12 ms
static int moreFrameAt(uint32_t pos, int n) {   // frame number shown at step pos of the sequence
  uint32_t loop = pos / (3 * n), k = pos % (3 * n);
  if ((int)k < n) return (int)k + 1;
  return n + 1 + (int)((loop * 2 * n + (k - n)) % (PORTFOLIO_FRAME_MAX - n));
}

static void showMore(int n) {
  uint32_t pos = 0;
  bool paused = false, redraw = true;
  uint32_t shownAt = 0;
  clearScreen();
  while (gLoaded) {
    if (redraw) {
      int i = moreFrameAt(pos, n);
      shownAt = millis();
      gHoldQR = drawMoreFrame(i);
      if (!gHoldQR) { clearScreen(); textAt(4, 60, "QR failed", C_BAD); }
      char what[28];
      if (i <= n) snprintf(what, sizeof what, "MORE %d/%d", i, n);
      else snprintf(what, sizeof what, "MORE mix %d", i - n);
      char right[40];   // a margin holds ~21 sideways characters; the measured draw time shows while paused
      if (paused) snprintf(right, sizeof right, "hold:back  draw %ums", (unsigned)((gQrDrawUs + 500) / 1000));
      else snprintf(right, sizeof right, "turn:step hold:back");
      qrLabels(what, paused ? " press:play" : "  scan me", right);
      redraw = false;
    }
    uint32_t spent = millis() - shownAt;
    Ev e = paused ? waitEvent() : waitEventFor(spent < MORE_FRAME_MS ? MORE_FRAME_MS - spent : 0);
    if (isBack(e)) break;
    if (e == EV_CW)  { pos++; paused = true; redraw = true; }
    if (e == EV_CCW) { if (pos) pos--; paused = true; redraw = true; }
    if (e == EV_PRESS) { paused = !paused; redraw = true; }
    // time's up: next frame, unless the knob is down (a hold is starting; its bar
    // is drawn over the bottom of the code and a repaint would erase it)
    if (e == EV_NONE && digitalRead(ENC_SW) != LOW) { pos++; redraw = true; }
  }
  gHoldQR = false;
}

// Portfolio view. Press = QR with every address, press again = back here, hold = back to list.
// On the QR, a turn opens the "more chains" frames when there are any.
static void showPortfolio() {
  const int frames = portfolio_frame_count(gAddr, chains_count());
  int more = 0;
  for (int i = 0; i < chains_count(); i++) more += gAddr[i].ext != 0;
  for (;;) {
    clearScreen();
    drawTitle("Portfolio");
    textAt(2, 16, "All 20 addresses in", C_FG);
    textAt(2, 26, "one QR, public only.", C_FG);
    textAt(2, 42, "Scan: the web page", C_DIM);
    textAt(2, 52, "checks every chain.", C_DIM);
    textAt(2, 68, "BTC: 1st addr only.", C_DIM);
    if (frames > 0) {
      char l[24];
      snprintf(l, sizeof l, "Then turn: %d more", more);
      textAt(2, 84, l, C_FG);
      textAt(2, 94, "chains, moving QRs.", C_FG);
    }
    textAt(2, SCR_H - 14, "press: QR  hold: back", C_DIM);
    Ev e = waitEvent();
    if (isBack(e)) return;
    if (e != EV_PRESS) continue;
    bool redraw = true;
    for (;;) {
      if (redraw) {
        clearScreen();
        gHoldQR = drawPortfolioQR();
        if (!gHoldQR) textAt(4, 60, "QR failed", C_BAD);
        qrLabels("ALL CHAINS", "  scan me", frames > 0 ? "turn: more chains" : "press: back");
        redraw = false;
      }
      e = waitEvent();
      if (e == EV_PRESS) break;
      if (isBack(e)) { gHoldQR = false; return; }
      if (frames > 0 && (e == EV_CW || e == EV_CCW)) {
        showMore(frames);
        if (!gLoaded) return;       // idle timeout wiped everything
        redraw = true;
      }
    }
    gHoldQR = false;
  }
}

static void browseAddresses() {
  static const char* items[CHAINS_MAX + 2];
  int n = chains_count();
  items[0] = "Portfolio (all chains)";
  for (int i = 0; i < n; i++) items[i + 1] = gAddr[i].name;
  items[n + 1] = "Wipe & exit";
  int sel = 0;
  while (gLoaded) {
    sel = runMenu(gUsedPass ? "Addresses (passphrase)" : "Addresses", items, n + 2, sel, 1);
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

static void deriveScreen(const char* title) {
  clearScreen();
  drawTitle(title);
  textAt(4, 40, "Seed is in RAM only", C_DIM);
  textAt(4, 52, "for a few seconds.", C_DIM);
  tft.drawRect(4, 70, SCR_W - 8, 10, C_FG);
}

// BIP39: the typed words and gPass -> gAddr. Wipes every secret either way.
static bool deriveFromEntered(int nwords) {
  uint8_t ent[32];
  bool valid = haveCount(nwords) == nwords && bip39_decode(gIdx, nwords, ent);
  secure_zero(ent, sizeof ent);
  if (!valid) { wipeAll(); message("Phrase incomplete", "Nothing was derived.", "Start again.", C_BAD); return false; }
  gMnemonic[0] = 0;
  for (int i = 0; i < nwords; i++) {
    if (i) strcat(gMnemonic, " ");
    strcat(gMnemonic, WORDS[gIdx[i]]);
  }
  bool withPass = gPass[0] != 0;
  deriveScreen("Deriving addresses");
  int rc = derive_all(gMnemonic, gPass, gAddr, deriveProgress);
  wipeSecret();
  scrubStack();
  if (rc != 0) { wipeAll(); message("Derivation failed", nullptr, nullptr, C_BAD); return false; }
  gLoaded = true; gUsedPass = withPass;
  return true;
}

// SLIP-39: the collected shares and gPass -> master secret -> gAddr. The decryption runs
// PBKDF2 20,000 times (Trezor's default), a few seconds, so it gets its own bar.
static void unlockProgress(int done, int total) {
  if (total > 0) tft.fillRect(5, 71, ((SCR_W - 10) * done) / total, 8, C_OK);
}
static bool deriveFromShares() {
  uint8_t secret[SLIP39_MAX_SECRET];
  int len = 0;
  if (!slip39_ready(&gShares)) { wipeAll(); message("Shares incomplete", "Nothing was derived.", "Start again.", C_BAD); return false; }
  bool withPass = gPass[0] != 0;
  deriveScreen("Unlocking backup");
  Slip39Result r = slip39_recover(&gShares, gPass, secret, &len, unlockProgress);
  wipeSecret();
  int rc = -1;
  if (r == SLIP39_OK) {
    deriveScreen("Deriving addresses");
    rc = derive_all_slip39(secret, len, gAddr, deriveProgress);
  }
  secure_zero(secret, sizeof secret);
  scrubStack();
  if (r == SLIP39_ERR_DIGEST) { wipeAll(); message("Shares do not match", "One share is mistyped or", "from another backup.", C_BAD); return false; }
  if (r != SLIP39_OK) { wipeAll(); message("Could not unlock", "Nothing was derived.", "Start again.", C_BAD); return false; }
  if (rc != 0) { wipeAll(); message("Derivation failed", nullptr, nullptr, C_BAD); return false; }
  gLoaded = true; gUsedPass = withPass;
  return true;
}

// ---------------- Phrase overview ----------------
// The whole phrase on one screen, two columns, numbered down the left column then
// the right. 12 words get 19 px rows and letters drawn double height (6 x 16 px, so
// 8-letter words still fit a column); 15/18/21/24 words get normal-size letters in
// 14/12/10/9 px rows. Every slot can be selected, filled or not, in any order;
// empty ones show as grey dashes. Once every slot is filled an extra item sits
// above word 1, drawn in the title bar: derive. Each cell paints its own background, so nothing flashes.
#define PS_DERIVE  (-1)
#define PS_BACK    (-2)
#define PS_TIMEOUT (-3)

// Returns a slot index to edit, PS_DERIVE, PS_BACK or PS_TIMEOUT.
// 33-word shares do not fit one screen: the overview shows 24 at a time (two pages, the
// page turning as the cursor crosses), with the page in the title bar.
#define PS_PER_PAGE 24
static int phraseScreen(int nwords, int cur) {
  const bool full = (haveCount(nwords) == nwords);
  const int per = nwords < PS_PER_PAGE ? nwords : PS_PER_PAGE, pages = (nwords + PS_PER_PAGE - 1) / PS_PER_PAGE;
  const int cols = 2, rows = (per + cols - 1) / cols;
  const int y0 = 14, rh = (SCR_H - y0) / rows;              // 19 px for 12 words, 14/12/11/10 for 15/18/20/21, 9 for 24 and 33
  const int sy = (rh >= 18) ? 2 : 1;                        // letter height multiplier
  const int cellW = (SCR_W - 4) / cols;                     // 78 landscape
  const int lo = full ? PS_DERIVE : 0, hi = nwords - 1;
  if (cur < lo) cur = lo;
  if (cur > hi) cur = hi;
  int page = -1;

  auto cell = [&](int i, bool sel) {
    int li = i - page * PS_PER_PAGE;
    int x = 2 + (li / rows) * cellW, y = y0 + (li % rows) * rh;
    tft.fillRect(x, y, cellW - 2, rh - 1, sel ? C_HI : C_BG);
    tft.setTextColor(sel ? ST77XX_BLACK : C_DIM);
    tft.setCursor(x + 1, y + (rh - 1 - 8) / 2);
    if (i + 1 < 10) tft.write(' ');
    tft.print(i + 1);
    tft.setTextSize(1, sy);
    tft.setTextColor(sel ? ST77XX_BLACK : (gHave[i] ? C_FG : C_DIM));
    tft.setCursor(x + 16, y + (rh - 1 - 8 * sy) / 2);
    tft.print(gHave[i] ? wordAt(gIdx[i]) : "----");
    tft.setTextSize(1);
    tft.setTextColor(C_FG);
  };
  auto title = [&](int c) {
    if (c == PS_DERIVE) {
      tft.fillRect(0, 0, SCR_W, 11, C_HI);
      textAt(2, 2, gSlip ? "> Use this share" : "> Derive addresses", ST77XX_BLACK);
    } else if (pages > 1) {
      drawTitle(gHave[c] ? "press:edit hold:back" : "press:type hold:back");
      char tag[24]; snprintf(tag, sizeof tag, "%d/%d", page + 1, pages);
      titleTag(tag);
    } else drawTitle(gHave[c] ? "press: edit   hold: back" : "press: type   hold: back");
  };
  // frame: the strips no cell covers, then every cell of the page
  auto drawPage = [&](int pg) {
    page = pg;
    tft.fillRect(0, 11, SCR_W, y0 - 11, C_BG);
    tft.fillRect(0, y0, 2, rows * rh, C_BG);
    for (int c = 0; c < cols; c++) {
      int x = 2 + c * cellW;
      tft.fillRect(x + cellW - 2, y0, 2, rows * rh, C_BG);                       // gutter
      for (int r = 0; r < rows; r++) tft.drawFastHLine(x, y0 + r * rh + rh - 1, cellW - 2, C_BG);
    }
    tft.fillRect(2 + cols * cellW, y0, SCR_W - 2 - cols * cellW, rows * rh, C_BG);
    tft.fillRect(0, y0 + rows * rh, SCR_W, SCR_H - y0 - rows * rh, C_BG);
    int from = pg * PS_PER_PAGE, to = from + PS_PER_PAGE < nwords ? from + PS_PER_PAGE : nwords;
    for (int i = from; i < to; i++) cell(i, i == cur);
    for (int li = to - from; li < rows * cols; li++)       // 15, 21 and page 2 of 33 leave cells empty
      tft.fillRect(2 + (li / rows) * cellW, y0 + (li % rows) * rh, cellW, rh, C_BG);
  };

  int prev = cur, shown = -9;
  for (;;) {
    int pg = cur < 0 ? (page < 0 ? 0 : page) : cur / PS_PER_PAGE;
    if (pg != page) { drawPage(pg); shown = -9; prev = cur; }
    int kind = (cur == PS_DERIVE) ? 0 : (gHave[cur] ? 1 : 2);
    if (kind != shown) { title(cur); shown = kind; }
    if (prev != cur) {
      if (prev >= 0 && prev / PS_PER_PAGE == page) cell(prev, false);
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
static void wsDrawTop(const WordScreen& g, int w, int nwords, const char* prefix) {
  char num[24], what[16];
  snprintf(num, sizeof num, "%d/%d", w + 1, nwords);
  if (gSlip && gShareNo > 1) snprintf(what, sizeof what, "Sh %d", gShareNo);   // which SLIP-39 share
  else snprintf(what, sizeof what, "Word");
  lineAt(2, 2, what, gShareNo > 1 ? C_HI : C_FG, 5);
  lineAt(2, 12, num, C_FG, 5);
  const int bx = 34, bw = 8 * 12;                // 8 glyphs of 12 px: the longest BIP39 word
  char big[10];
  uint16_t color = C_HI;
  if (prefix[0]) snprintf(big, sizeof big, "%s_", prefix);
  else if (gHave[w]) { snprintf(big, sizeof big, "%s", wordAt(gIdx[w])); color = C_DIM; }
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
  tft.fillRect(2 + 5 * 6, 2, bx - 2 - 5 * 6, 18, C_BG);   // between the small lines and the big one
  tft.fillRect(bx, 18, SCR_W - bx, 2, C_BG);
  if (SCR_W > bx + bw) tft.fillRect(bx + bw, 2, SCR_W - bx - bw, 16, C_BG);
  // progress: words entered so far, full width, 2 px
  int done = (SCR_W * haveCount(nwords)) / nwords;
  tft.fillRect(0, 20, done, 2, C_OK);
  tft.fillRect(done, 20, SCR_W - done, 2, C_TRK);
}

// One word cell: marker, word, padding; the 2 px under it is cleared too so the
// cell fully covers whatever screen was here before. No clear, no flash.
static void wsDrawWord(const WordScreen& g, int first, int total, int page, int k, bool cur) {
  int idx = page * g.perPage + k;
  int x = 2 + (k / g.lines) * g.cellW, y = g.listY + (k % g.lines) * 10;
  const char* w = (idx < total) ? wordAt(first + idx) : "";
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

// Word w of nwords. Returns a word index,
// WS_LETTER | letter, or one of the WS_ codes.
// startKey: the key pressed last on the previous screen (-1 = none); the cursor
// lands on or next to it instead of jumping back to the start of the keyboard.
static int wordScreen(int w, int nwords, const char* prefix, int startKey) {
  WordScreen g; wsGeometry(g);
  int first = 0;
  int total = matches(prefix, &first);           // matches are contiguous in the sorted list
  bool keyOk[NKEYS];
  for (int k = 0; k < 26; k++) {
    char p2[10]; snprintf(p2, sizeof p2, "%s%c", prefix, 'a' + k);
    keyOk[k] = matches(p2, nullptr) > 0;
  }
  keyOk[KEY_DEL]  = true;
  keyOk[KEY_PREV] = w > 0;
  keyOk[KEY_ALL]  = true;
  keyOk[KEY_NEXT] = w < nwords - 1;
  const int nItems = total + NKEYS;
  auto enabled = [&](int c) { return c < total || keyOk[c - total]; };
  int cur;
  if (startKey == KEY_DEL) cur = total + KEY_DEL;  // deleting again is one press
  else if (startKey >= 0 && startKey < 26) {      // the letter just typed, or the nearest live one
    cur = total;
    for (int d = 0; d < 26; d++) {
      if (startKey + d < 26 && keyOk[startKey + d]) { cur = total + startKey + d; break; }
      if (startKey - d >= 0 && keyOk[startKey - d]) { cur = total + startKey - d; break; }
    }
  } else cur = total;
  while (!enabled(cur)) cur++;

  // frame: top strip, the strips no cell covers, the keyboard
  wsDrawTop(g, w, nwords, prefix);
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

// The typed words make a valid phrase: the BIP39 checksum, or for a SLIP-39 share its
// RS1024 checksum (which catches any 3 wrong words) and a well-formed header.
// Returns 1 if valid, 0 if not (after saying so), -1 if the message timed out (all wiped).
static int checksumOk(int nwords) {
  bool ok;
  if (gSlip) {
    Slip39Share sh;
    Slip39Result r = slip39_parse(gIdx, nwords, &sh);
    secure_zero(&sh, sizeof sh);
    ok = (r == SLIP39_OK);
    if (r == SLIP39_ERR_CHECKSUM) { if (message("Checksum invalid", "One word is wrong.", "Pick it and retype it.", C_BAD)) return -1; }
    else if (!ok) { if (message("Not a valid share", "Check every word against", "the backup card.", C_BAD)) return -1; }
    return ok ? 1 : 0;
  }
  uint8_t ent[32];
  ok = bip39_decode(gIdx, nwords, ent);
  secure_zero(ent, sizeof ent);
  if (!ok && message("Checksum invalid", "One word is wrong.", "Pick it and retype it.", C_BAD)) return -1;
  return ok ? 1 : 0;
}

// Entry: one word screen at a time, the phrase overview whenever the user asks for
// it and once every slot is in. The checksum only catches 15 of 16 wrong words on a
// 12-word seed (31/32, 63/64, 127/128 on 15/18/21; 255 of 256 on 24), so the user
// eyeballs the phrase before deriving.
// A wrong checksum sends them back to the overview to fix a word, not to the menu.
// Returns true once all nwords are in and pass the checksum (gIdx holds them).
static bool enterSeed(int nwords) {
  char prefix[8] = "";
  int plen = 0, w = 0;                         // w is the slot on screen
  wipeWords();                                 // every slot starts empty (earlier SLIP-39 shares stay)
  int lastKey = -1;                            // keyboard key pressed on the previous screen
  auto clearPrefix = [&]() { plen = 0; prefix[0] = 0; };
  for (;;) {
    if (w >= nwords) {                         // every slot is in: check the phrase
      int p = phraseScreen(nwords, PS_DERIVE);
      if (p == PS_TIMEOUT) { clearScreen(); return false; }
      if (p == PS_BACK) { w = nwords - 1; continue; }
      if (p >= 0) { w = p; continue; }
      int c = checksumOk(nwords);
      if (c < 0) { clearScreen(); return false; }
      if (!c) continue;
      return true;
    }
    gHoldY = 0;                                // keyboard reaches the bottom: hold bar on top
    int r = wordScreen(w, nwords, prefix, lastKey);
    gHoldY = -1;
    lastKey = (r >= 0 && (r & WS_LETTER)) ? (r & 0xFF) - 'a' : (r == WS_DEL ? KEY_DEL : -1);
    if (r >= 0 && !(r & WS_LETTER)) {          // a word was picked
      gIdx[w] = (uint16_t)r; gHave[w] = true;
      clearPrefix();
      int nx = nwords;                         // the next empty slot after this one, wrapping; none = all in
      for (int k = 1; k < nwords; k++) if (!gHave[(w + k) % nwords]) { nx = (w + k) % nwords; break; }
      w = nx;
    } else if (r >= 0) {                       // a letter
      if (plen < 6) { prefix[plen++] = (char)(r & 0xFF); prefix[plen] = 0; }
    } else if (r == WS_DEL) {
      if (plen > 0) prefix[--plen] = 0;
      else if (w > 0) w--;
      else if (haveCount(nwords) == 0 && gShares.n == 0) { clearScreen(); return false; }   // nothing typed yet: back to the menu
      else {                                                    // words are in: make sure
        static const char* const q[] = { "Keep typing", "Quit, forget words" };
        static const char* const qs[] = { "Keep typing", "Quit, forget all shares" };
        int a = runMenu("Quit?", gShares.n ? qs : q, 2, 0, 1);
        if (a == MENU_TIMEOUT) { clearScreen(); return false; }
        if (a == 1) { wipeSecret(); clearScreen(); return false; }
      }
    } else if (r == WS_PREV) { w--; clearPrefix(); }
    else if (r == WS_NEXT) { w++; clearPrefix(); }
    else if (r == WS_ALL) {
      int p = phraseScreen(nwords, w);
      if (p == PS_TIMEOUT) { clearScreen(); return false; }
      if (p >= 0) { w = p; clearPrefix(); }
      else if (p == PS_DERIVE) {
        int c = checksumOk(nwords);
        if (c < 0) { clearScreen(); return false; }
        if (c) return true;
        w = nwords;                            // back to the overview to fix a word
      }
      // PS_BACK: stay on this word, typed letters kept
    } else { clearScreen(); return false; }    // WS_TIMEOUT: already wiped
  }
}

// Two choices on rows y and y + 14, the cursor on a yellow bar. Returns 0 or 1,
// MENU_BACK (hold) or MENU_TIMEOUT. For screens that explain something above the choice.
static int choiceAt(int y, const char* a, const char* b, int sel) {
  const char* items[2] = { a, b };
  int prev = -1;
  for (;;) {
    if (sel != prev) {
      for (int i = 0; i < 2; i++) {
        tft.fillRect(0, y + 14 * i, SCR_W, 13, i == sel ? C_HI : C_BG);
        textAt(4, y + 14 * i + 3, items[i], i == sel ? ST77XX_BLACK : C_FG);
      }
      prev = sel;
    }
    Ev e = waitEvent();
    if (e == EV_CW || e == EV_CCW) sel ^= 1;
    else if (e == EV_PRESS) return sel;
    else if (e == EV_LONG) return MENU_BACK;
    else if (e == EV_TIMEOUT) return MENU_TIMEOUT;
  }
}

// ---------------- Passphrase ----------------
// The optional "25th word" (BIP39) or SLIP-39 passphrase. Asked once the words are in;
// "No passphrase" is first, since most people have none. The keyboard: 27 character keys
// in 3 rows of 9 and a control row, as on the word screen. Four pages of keys (abc, ABC,
// 123, #+=), every printable ASCII character between them. The text shows spaces as dots,
// so a stray space is visible, and the review screen shows it all once more before use.
#define PK_COLS  9
#define PK_CHARS 27                  // character keys per page
#define PK_MODE  27                  // control row: next page, delete, done
#define PK_DEL   28
#define PK_DONE  29
#define PK_KEYS  30
static const char* const PK_PAGE[4] = {
  "abcdefghijklmnopqrstuvwxyz ",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ ",
  "0123456789.,-_@!?#$%&*+=/:;",
  "\"'()<>[\\]^`{|}~ ",
};
static const char* const PK_NAME[4] = { "abc", "ABC", "123", "#+=" };

// The passphrase in four lines of 26 from y, spaces as small dots, cursor after it if asked.
static void drawPassText(int y, bool cursor) {
  int len = strlen(gPass);
  for (int i = 0; i < 4 * 26; i++) {
    int x = 2 + (i % 26) * 6, yy = y + (i / 26) * 10;
    char c = i < len ? gPass[i] : (i == len && cursor ? '_' : ' ');
    tft.setTextColor(i == len ? C_HI : C_FG, C_BG);
    tft.setCursor(x, yy);
    tft.write(c == ' ' ? ' ' : c);
    if (i < len && c == ' ') tft.fillRect(x + 2, yy + 3, 2, 2, C_DIM);
  }
  tft.setTextColor(C_FG);
}

#define PK_DONE_RET    1
#define PK_BACK_RET    0
#define PK_TIMEOUT_RET (-1)
static int passKeyboard() {
  const int keyH = 12, keyY = SCR_H - 4 * keyH, keyW = (SCR_W - 2) / PK_COLS, ctlW = (SCR_W - 2) / 3;
  int page = 0, cur = 0, prev = -1;
  bool redrawAll = true;
  clearScreen();
  gHoldY = 0;                                    // the keys reach the bottom: hold bar on top
  auto enabled = [&](int k) {
    if (k >= PK_CHARS) return k != PK_DEL || gPass[0] != 0;
    return k < (int)strlen(PK_PAGE[page]) && (int)strlen(gPass) < PASS_MAX;
  };
  while (!enabled(cur)) cur = (cur + 1) % PK_KEYS;   // reopened on a full passphrase: start on a control
  auto drawKey = [&](int k) {
    int x, y, w;
    char one[4] = { 0 };
    const char* label = one;
    if (k < PK_CHARS) {
      x = 1 + (k % PK_COLS) * keyW; y = keyY + (k / PK_COLS) * keyH; w = keyW;
      char c = k < (int)strlen(PK_PAGE[page]) ? PK_PAGE[page][k] : 0;
      if (c == ' ') label = "sp"; else one[0] = c;
    } else {
      x = 1 + (k - PK_MODE) * ctlW; y = keyY + 3 * keyH; w = ctlW;
      label = k == PK_MODE ? PK_NAME[(page + 1) % 4] : k == PK_DEL ? "\x1B del" : "done";
    }
    bool c = (k == cur);
    tft.fillRect(x, y, w, keyH, c ? C_HI : C_BG);
    tft.setTextColor(c ? ST77XX_BLACK : (enabled(k) ? C_FG : C_DIM));
    tft.setCursor(x + (w - 6 * (int)strlen(label)) / 2, y + 2);
    tft.print(label);
    tft.setTextColor(C_FG);
  };
  for (;;) {
    if (redrawAll) {
      char tag[16]; snprintf(tag, sizeof tag, "%d/%d", (int)strlen(gPass), PASS_MAX);
      drawTitle("Passphrase");
      titleTag(tag);
      tft.fillRect(0, 11, SCR_W, 3, C_BG);
      drawPassText(14, true);
      lineAt(2, 56, "Case matters. hold: back", C_DIM, 26);
      char m[27]; snprintf(m, sizeof m, "Keys: %s  (next: %s)", PK_NAME[page], PK_NAME[(page + 1) % 4]);
      lineAt(2, 66, m, C_DIM, 26);
      tft.fillRect(0, 54, SCR_W, 2, C_BG);
      tft.fillRect(0, 74, SCR_W, keyY - 74, C_BG);
      tft.fillRect(1 + PK_COLS * keyW, keyY, SCR_W - 1 - PK_COLS * keyW, 3 * keyH, C_BG);
      for (int k = 0; k < PK_KEYS; k++) drawKey(k);
      redrawAll = false; prev = cur;
    } else if (prev != cur) { drawKey(prev); drawKey(cur); prev = cur; }
    Ev e = waitEvent();
    if (e == EV_CW || e == EV_CCW) {
      int d = (e == EV_CW) ? 1 : -1;
      do { cur = (cur + d + PK_KEYS) % PK_KEYS; } while (!enabled(cur));
    } else if (e == EV_PRESS) {
      int len = strlen(gPass);
      if (cur < PK_CHARS) { if (len < PASS_MAX) { gPass[len] = PK_PAGE[page][cur]; gPass[len + 1] = 0; } }
      else if (cur == PK_MODE) page = (page + 1) % 4;
      else if (cur == PK_DEL) { if (len) gPass[len - 1] = 0; }
      else { gHoldY = -1; return PK_DONE_RET; }
      while (!enabled(cur)) cur = (cur + 1) % PK_KEYS;   // full, emptied or a shorter page
      redrawAll = true;
    } else if (e == EV_LONG) { gHoldY = -1; return PK_BACK_RET; }
    else if (e == EV_TIMEOUT) { gHoldY = -1; return PK_TIMEOUT_RET; }
  }
}

// Returns true to go on (gPass holds the passphrase, "" for none), false to quit (timeout,
// or quit confirmed; secrets wiped).
static bool askPassphrase() {
  static const char* const q[] = { "No passphrase", "Type a passphrase", "What is a passphrase?" };
  int sel = gPass[0] ? 1 : 0;
  for (;;) {
    int a = runMenu("Extra passphrase?", q, 3, sel, 1);
    if (a == MENU_TIMEOUT) return false;
    if (a == MENU_BACK) {
      static const char* const k[] = { "Keep going", "Quit, forget words" };
      int b = runMenu("Quit?", k, 2, 0, 1);
      if (b == MENU_TIMEOUT) return false;
      if (b == 1) { wipeSecret(); clearScreen(); return false; }
      continue;
    }
    sel = a;
    if (a == 0) { secure_zero(gPass, sizeof gPass); return true; }
    if (a == 2) {
      if (message("Optional: some wallets", "add a passphrase to the", "words. Not sure? Pick No.", C_HI)) return false;
      continue;
    }
    // type it, then look it over: a typo opens a different (empty) wallet, nothing warns
    for (;;) {
      int r = passKeyboard();
      if (r == PK_TIMEOUT_RET) return false;
      if (r == PK_BACK_RET) break;
      if (!gPass[0]) return true;                 // done on an empty passphrase: none
      clearScreen();
      drawTitle("Is this right?");
      drawPassText(14, false);
      char n[40]; snprintf(n, sizeof n, "%d chars; dots are spaces", (int)strlen(gPass));
      textAt(2, 56, n, C_DIM);
      textAt(2, 66, "A typo opens a different", C_DIM);
      textAt(2, 76, "wallet with nothing in it.", C_DIM);
      int c = choiceAt(SCR_H - 30, "Yes, use it", "Edit", 0);
      if (c == MENU_TIMEOUT) return false;
      if (c == 0) return true;
    }
  }
}

// ---------------- Whole flows ----------------
// BIP39 (12-24 words): words, passphrase, derive.
static bool runBip39(int nwords) {
  gSlip = false; gShareNo = 0;
  wipeSecret();
  if (!enterSeed(nwords)) return false;
  if (!askPassphrase()) { wipeSecret(); return false; }
  return deriveFromEntered(nwords);
}

// SLIP-39 (20 or 33 words): one share or several. After each share the device says how
// many more it needs (it reads the thresholds from the share itself), then the passphrase.
static bool runSlip39(int nwords) {
  gSlip = true; gShareNo = 1;
  wipeSecret();
  slip39_init(&gShares);
  for (;;) {
    if (!enterSeed(nwords)) { wipeSecret(); return false; }
    Slip39Share sh;
    slip39_parse(gIdx, nwords, &sh);             // checksumOk() has parsed it once already
    Slip39Result r = slip39_add(&gShares, &sh);
    secure_zero(&sh, sizeof sh);
    wipeWords();
    bool late = false;                            // a message ran into the idle timeout: all wiped, stop
    if (r == SLIP39_DUPLICATE) late = message("Already entered", "That share is in already.", "Type a different one.", C_BAD);
    else if (r == SLIP39_OTHER_BACKUP) late = message("Different backup", "That share belongs to", "another backup. Skipped.", C_BAD);
    else if (r == SLIP39_GROUP_MISMATCH) late = message("Share does not fit", "It clashes with a share", "already in. Skipped.", C_BAD);
    else if (r == SLIP39_FULL) { wipeSecret(); message("Too many shares", nullptr, nullptr, C_BAD); return false; }
    else gShareNo = gShares.n + 1;
    if (late) { clearScreen(); return false; }
    if (slip39_ready(&gShares)) break;

    // progress: one group (the usual case) or several
    Slip39Status st; slip39_status(&gShares, &st);
    clearScreen();
    drawTitle("Shamir backup");
    char l[32];
    int y = 18;
    if (st.gcnt == 1) {
      int g = gShares.s[0].gidx;
      snprintf(l, sizeof l, "%d of %d shares in.", st.have[g], st.need[g]);
      textAt(4, y, l, C_OK); y += 14;
      snprintf(l, sizeof l, "Type %d more share%s.", st.need[g] - st.have[g], st.need[g] - st.have[g] == 1 ? "" : "s");
      textAt(4, y, l); y += 12;
      textAt(4, y, "Any of them, any order.", C_DIM);
    } else {
      snprintf(l, sizeof l, "%d of %d groups done.", st.gdone, st.gthr);
      textAt(4, y, l, C_OK); y += 12;
      snprintf(l, sizeof l, "(%d groups; any %d do.)", st.gcnt, st.gthr);
      textAt(4, y, l, C_DIM); y += 12;
      int started = 0, shown = 0;
      for (int g = 0; g < 16; g++) started += st.need[g] != 0;
      for (int g = 0; g < 16; g++) {
        if (!st.need[g]) continue;
        if (y >= SCR_H - 74 && shown < started - 1) {   // no room: say how many are left out
          snprintf(l, sizeof l, "+%d more groups started", started - shown);
          textAt(4, y, l, C_DIM); break;
        }
        shown++;
        snprintf(l, sizeof l, "Group %d: %d of %d share%s", g + 1, st.have[g] < st.need[g] ? st.have[g] : st.need[g], st.need[g], st.need[g] == 1 ? "" : "s");
        textAt(4, y, l, st.have[g] >= st.need[g] ? C_FG : C_HI); y += 10;
      }
    }
    // every share of one backup begins with the same two words (identifier and settings):
    // shown so the right cards are easy to pick out
    {
      const Slip39Share& f = gShares.s[0];
      uint32_t idexp = ((uint32_t)f.id << 5) | ((uint32_t)f.ext << 4) | f.exp;
      snprintf(l, sizeof l, "%s %s ...", slip39_word(idexp >> 10), slip39_word(idexp & 1023));
      textAt(4, SCR_H - 54, "Its shares all start with", C_DIM);
      textAt(4, SCR_H - 44, l, C_HI);
    }
    int c;
    do c = choiceAt(SCR_H - 30, "Type the next share", "Quit, forget shares", 0); while (c == MENU_BACK);
    if (c == 0) continue;
    if (c == 1) wipeSecret();                    // a timeout has wiped everything already
    clearScreen();
    return false;
  }
  if (!askPassphrase()) { wipeSecret(); return false; }
  if (gShares.s[0].exp > 4 &&                    // Trezor uses 1 (a few seconds); each step doubles it
      message("Slow backup", "This one was made to take", "minutes to unlock. Wait.", C_HI)) return false;
  return deriveFromShares();
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
  auto centered = [](int y, const char* t, uint16_t c) { textAt((SCR_W - 6 * (int)strlen(t)) / 2, y, t, c); };
  tft.setTextSize(3);
  textAt((SCR_W - 7 * 18) / 2, 18, "SEEDBOX", C_HI);      // 126 px wide
  tft.setTextSize(1);
  tft.fillRect((SCR_W - 126) / 2, 46, 126, 2, C_BAR);
  centered(56, "Seed in, addresses out.", C_FG);
  centered(74, "Nothing is stored.", C_DIM);
  centered(86, "Power off = wiped.", C_DIM);
  tft.fillRoundRect((SCR_W - 80) / 2, SCR_H - 22, 80, 15, 7, C_HI);
  centered(SCR_H - 18, "press knob", ST77XX_BLACK);
  lastInputMs = millis();
  while (waitEvent() != EV_PRESS) {}
  lastEnc = encPos;
}

void loop() {
  // Pick what is written on the backup: 12 and 24 words (BIP39, nearly every wallet, in
  // their old places) and 20 (Trezor Safe 3 / Safe 5 / Model T and Keystone Shamir backups,
  // SLIP-39) are one press away; the rare 15/18/21 and 33 sit behind "Other length" so the menu fits without scrolling.
  // BIP39 has no 20- or 33-word phrases, so the count alone tells the two kinds apart.
  static const char* const items[] = { "12 words", "24 words", "20 words", "Other length", "About" };
  static const char* const other[] = { "15 words", "18 words", "21 words", "33 words" };
  int s = (SCR_W >= 150) ? 2 : 1;        // double-size type; 12 chars x 12 px fit the 160 px screen
  int sel = runMenu("Backup words", items, 5, 0, s);
  switch (sel) {
    case 0: if (runBip39(12)) browseAddresses(); break;
    case 1: if (runBip39(24)) browseAddresses(); break;
    case 2: if (runSlip39(20)) browseAddresses(); break;
    case 3: {
      int o = runMenu("Other length", other, 4, 0, s);   // hold = back to the main menu
      if (o == 3) { if (runSlip39(33)) browseAddresses(); }
      else if (o >= 0 && runBip39(15 + 3 * o)) browseAddresses();
      break;
    }
    case 4: message("SeedBox v0.5", "BIP39 12-24 words, SLIP39", "20/33 words, passphrase", C_FG); break;
    default: break;
  }
}

// A 160x128 framebuffer with the bits of Adafruit_ST7735 / Adafruit_GFX the sketch uses,
// drawing text with the same 5x7 font the same way GFX does.
#pragma once
#include "Arduino.h"
#define ST77XX_BLACK  0x0000
#define ST77XX_WHITE  0xFFFF
#define ST77XX_RED    0xF800
#define ST77XX_GREEN  0x07E0
#define ST77XX_YELLOW 0xFFE0
#define INITR_BLACKTAB 0
extern const unsigned char* simFont;
struct Adafruit_ST7735 {
  static const int W = 160, H = 128;
  uint16_t fb[W * H];
  int cx = 0, cy = 0, sx = 1, sy = 1; uint16_t fg = 0xFFFF, bg = 0xFFFF;
  int wx, wy, ww, wh, wp;
  Adafruit_ST7735(int, int, int) { memset(fb, 0, sizeof fb); }
  void initR(int) {}
  void setRotation(int) {}
  void setTextWrap(bool) {}
  int width() { return W; }
  int height() { return H; }
  void drawPixel(int x, int y, uint16_t c) { if (x >= 0 && y >= 0 && x < W && y < H) fb[y * W + x] = c; }
  void fillRect(int x, int y, int w, int h, uint16_t c) { for (int j = y; j < y + h; j++) for (int i = x; i < x + w; i++) drawPixel(i, j, c); }
  void fillScreen(uint16_t c) { fillRect(0, 0, W, H, c); }
  void drawFastHLine(int x, int y, int w, uint16_t c) { fillRect(x, y, w, 1, c); }
  void drawRect(int x, int y, int w, int h, uint16_t c) { fillRect(x, y, w, 1, c); fillRect(x, y + h - 1, w, 1, c); fillRect(x, y, 1, h, c); fillRect(x + w - 1, y, 1, h, c); }
  void fillRoundRect(int x, int y, int w, int h, int, uint16_t c) { fillRect(x, y, w, h, c); }
  void setTextSize(int s) { sx = sy = s; }
  void setTextSize(int a, int b) { sx = a; sy = b; }
  void setTextColor(uint16_t c) { fg = bg = c; }
  void setTextColor(uint16_t c, uint16_t b) { fg = c; bg = b; }
  void setCursor(int x, int y) { cx = x; cy = y; }
  void write(char ch) {
    unsigned char c = (unsigned char)ch;
    if (c == '\n') { cx = 0; cy += 8 * sy; return; }
    if (c == '\r') return;
    for (int i = 0; i < 6; i++) {
      uint8_t line = i < 5 ? simFont[c * 5 + i] : 0;
      for (int j = 0; j < 8; j++, line >>= 1) {
        if (line & 1) fillRect(cx + i * sx, cy + j * sy, sx, sy, fg);
        else if (bg != fg) fillRect(cx + i * sx, cy + j * sy, sx, sy, bg);
      }
    }
    cx += 6 * sx;
  }
  void print(const char* s) { while (*s) write(*s++); }
  void print(int v) { char b[16]; snprintf(b, sizeof b, "%d", v); print(b); }
  void startWrite() {}
  void endWrite() {}
  void setAddrWindow(int x, int y, int w, int h) { wx = x; wy = y; ww = w; wh = h; wp = 0; }
  void writePixels(uint16_t* c, uint32_t n, bool, bool) { for (uint32_t k = 0; k < n; k++, wp++) drawPixel(wx + wp % ww, wy + wp / ww, c[k]); }
};

// sim.cpp - runs seedbox.ino on a PC for screenshots of the UI: a 160x128 framebuffer
// (Adafruit_ST7735.h here), a virtual clock, and the knob driven by a script on stdin:
//   cw N | ccw N        turn the knob N clicks
//   press | hold        short press, or a hold past LONG_PRESS_MS
//   words w1 w2 ...     put words straight into the slots (gIdx/gHave), for long phrases
//   pass TEXT           put TEXT straight into the passphrase buffer
//   wait MS             let MS of virtual time pass
//   shot NAME           save the screen as NAME.png in argv[1]
//   dump                print every derived row as "name|address" to stdout ("NOT LOADED" if none)
//   passlen             print the passphrase buffer's length
//   end                 save "end.png" and stop
#include "Arduino.h"
#include "SPI.h"
#include <zlib.h>
#include <string>
#include <vector>
#include <sstream>
#include <iostream>

static uint32_t simNow = 0;
static int simSw = HIGH;
Rp2040 rp2040;
SPIClass SPI;
uint32_t millis() { return simNow; }
uint32_t micros() { return simNow * 1000; }
static void simStep();
void delay(uint32_t ms) { simNow += ms ? ms : 1; simStep(); }
int digitalRead(int pin) { return pin == 3 ? simSw : HIGH; }

#include "../../seedbox.ino"
const unsigned char* simFont = font;

static std::vector<std::string> script;
static size_t pc = 0;
static uint32_t busyUntil = 0, releaseAt = 0;
static std::string outDir = ".";

static void png(const std::string& name) {
  const int W = 160, H = 128;
  std::vector<uint8_t> raw;
  for (int y = 0; y < H; y++) {
    raw.push_back(0);
    for (int x = 0; x < W; x++) {
      uint16_t c = tft.fb[y * W + x];
      raw.push_back((c >> 11) * 255 / 31); raw.push_back(((c >> 5) & 63) * 255 / 63); raw.push_back((c & 31) * 255 / 31);
    }
  }
  uLongf zl = compressBound(raw.size());
  std::vector<uint8_t> z(zl);
  compress(z.data(), &zl, raw.data(), raw.size());
  FILE* f = fopen((outDir + "/" + name + ".png").c_str(), "wb");
  auto be = [&](uint32_t v) { uint8_t b[4] = { (uint8_t)(v >> 24), (uint8_t)(v >> 16), (uint8_t)(v >> 8), (uint8_t)v }; fwrite(b, 1, 4, f); };
  auto chunk = [&](const char* t, const uint8_t* d, uint32_t n) {
    be(n); fwrite(t, 1, 4, f); if (n) fwrite(d, 1, n, f);
    uint32_t c = crc32(0, (const Bytef*)t, 4); c = crc32(c, d, n); be(c);
  };
  fwrite("\x89PNG\r\n\x1a\n", 1, 8, f);
  uint8_t ihdr[13] = { 0, 0, 0, W, 0, 0, 0, H, 8, 2, 0, 0, 0 };
  chunk("IHDR", ihdr, 13); chunk("IDAT", z.data(), zl); chunk("IEND", nullptr, 0);
  fclose(f);
}

static int lookup(const std::string& w) {
  int first = 0, n = matches(w.c_str(), &first);
  for (int i = first; i < first + n; i++) if (w == wordAt(i)) return i;
  fprintf(stderr, "sim: no word %s\n", w.c_str()); exit(2);
}

static void simStep() {
  if (releaseAt && simNow >= releaseAt) { simSw = HIGH; releaseAt = 0; }
  if (simNow < busyUntil) return;
  if (pc >= script.size()) { png("end"); exit(0); }
  std::istringstream in(script[pc++]);
  std::string op; in >> op;
  if (op == "cw" || op == "ccw") {
    int n = 1; in >> n;
    script.insert(script.begin() + pc, n - 1, op + " 1");
    encPos += (op == "cw") == (ENC_REVERSE != 0) ? -1 : 1;     // pollEvent flips when ENC_REVERSE
    busyUntil = simNow + 20;
  } else if (op == "press") { simSw = LOW; releaseAt = simNow + 60; busyUntil = simNow + 140; }
  else if (op == "hold") { simSw = LOW; releaseAt = simNow + LONG_PRESS_MS + 100; busyUntil = releaseAt + 80; }
  else if (op == "words") { std::string w; int i = 0; while (in >> w) { gIdx[i] = (uint16_t)lookup(w); gHave[i] = true; i++; } }
  else if (op == "pass") { std::string rest; std::getline(in, rest); snprintf(gPass, sizeof gPass, "%s", rest.c_str() + (rest.size() && rest[0] == ' ')); }
  else if (op == "wait") { uint32_t ms = 0; in >> ms; busyUntil = simNow + ms; }
  else if (op == "shot") { std::string n; in >> n; png(n); }
  else if (op == "dump") {
    if (!gLoaded) printf("NOT LOADED\n");
    else for (int i = 0; i < chains_count(); i++) printf("%s|%s\n", gAddr[i].name, gAddr[i].addr);
  }
  else if (op == "passlen") printf("PASSLEN %d\n", (int)strlen(gPass));
  else if (op == "end") { png("end"); exit(0); }
  else if (!op.empty()) { fprintf(stderr, "sim: unknown step %s\n", op.c_str()); exit(2); }
}

int main(int argc, char** argv) {
  if (argc > 1) outDir = argv[1];
  std::string l;
  while (std::getline(std::cin, l)) if (!l.empty() && l[0] != '#') script.push_back(l);
  setup();
  for (;;) loop();
}

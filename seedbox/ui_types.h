// Types shared by the sketch. Kept in a header so Arduino's auto-generated
// function prototypes can see them.
#pragma once

enum Ev {
  EV_NONE,
  EV_CW,       // knob turned clockwise one click
  EV_CCW,      // knob turned counter-clockwise one click
  EV_PRESS,    // short press and release
  EV_LONG,     // held for LONG_PRESS_MS (fires once, no EV_PRESS follows)
  EV_TIMEOUT   // no input for IDLE_WIPE_MS; secret has already been wiped
};

// runMenu() return codes besides a selected index (>= 0)
#define MENU_BACK    (-1)   // long press
#define MENU_TIMEOUT (-2)   // idle timeout (secret wiped)

// Word entry screen geometry (seedbox.ino). Lives here because the Arduino
// preprocessor puts its generated prototypes above anything defined in the .ino.
struct WordScreen {
  int listY, lines, cols, cellW, cpl, perPage;   // word area
  int keyY, keyW, keyH;                          // letter keys, 3 rows
  int ctlW;                                      // the 3 word controls on the 4th row
};

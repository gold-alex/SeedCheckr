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

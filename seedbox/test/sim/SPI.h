#pragma once
#include "Arduino.h"
struct SPIClass { void setSCK(int) {} void setTX(int) {} void setRX(int) {} };
extern SPIClass SPI;

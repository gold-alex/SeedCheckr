// Host stand-ins for the Arduino core, so seedbox.ino runs on a PC (sim.cpp drives it).
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#define HIGH 1
#define LOW 0
#define INPUT_PULLUP 2
#define OUTPUT 1
#define CHANGE 3
#define pgm_read_byte(p) (*(const uint8_t*)(p))
uint32_t millis();
uint32_t micros();
void delay(uint32_t ms);
int digitalRead(int pin);
inline void digitalWrite(int, int) {}
inline void pinMode(int, int) {}
inline int digitalPinToInterrupt(int p) { return p; }
inline void attachInterrupt(int, void (*)(), int) {}
struct Rp2040 { uint32_t hwrand32() { return (uint32_t)rand(); } };
extern Rp2040 rp2040;

#!/bin/bash
# Builds the host-side test binaries next to this script. Needs gcc.
set -e
cd "$(dirname "$0")"
rm -f obj_*.o
( cd ../src && for f in trezor/*.c trezor/aes/*.c trezor/ed25519-donna/*.c chains.c chains_ext_*.c slip39.c portfolio.c qr/qrcodegen.c; do
    gcc -std=gnu11 -O2 -w -DNDEBUG -I trezor -c "$f" -o "../test/obj_$(basename "$f" .c).o"
  done )
gcc -O2 -w -o test_chains test_chains.c obj_*.o
gcc -O2 -w -o test_portfolio test_portfolio.c obj_*.o
gcc -O2 -w -o test_frames test_frames.c obj_*.o
gcc -O2 -w -o test_qr test_qr.c obj_portfolio.o obj_qrcodegen.o
gcc -O2 -w -o test_slip39 test_slip39.c obj_*.o
echo "built: test_chains test_portfolio test_frames test_qr test_slip39"

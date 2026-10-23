#!/bin/bash
# usage: compare.sh N  -> N random 12-word + N random 24-word mnemonics
fails=0; total=0
for n in 128 256; do for i in $(seq 1 $1); do
  m=$(python3 -c "from mnemonic import Mnemonic;print(Mnemonic('english').generate($n))")
  ./test_chains "$m" > mine.txt; python3 ref_chains.py "$m" > ref.txt 2>/dev/null
  total=$((total+1)); if ! diff -q mine.txt ref.txt >/dev/null; then fails=$((fails+1)); echo "MISMATCH: $m"; diff mine.txt ref.txt; fi
done; done
echo "mnemonics compared: $total, mismatches: $fails"

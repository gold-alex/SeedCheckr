#!/bin/bash
# usage: compare.sh N  -> N random mnemonics of each length: 12, 15, 18, 21 and 24 words
# Uses $PYTHON if set (e.g. a venv with mnemonic + bip_utils), else python3.
PY=${PYTHON:-python3}
fails=0; total=0
for n in 128 160 192 224 256; do for i in $(seq 1 $1); do
  m=$($PY -c "from mnemonic import Mnemonic;print(Mnemonic('english').generate($n))")
  ./test_chains "$m" > mine.txt; { $PY ref_chains.py "$m"; for r in ref_ext_utxo.py ref_ext_cosmos.py ref_ext_ed.py; do [ -f $r ] && $PY $r "$m"; done; } > ref.txt 2>/dev/null
  total=$((total+1)); if ! diff -q mine.txt ref.txt >/dev/null; then fails=$((fails+1)); echo "MISMATCH: $m"; diff mine.txt ref.txt; fi
done; done
echo "mnemonics compared: $total, mismatches: $fails"

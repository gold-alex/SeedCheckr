#!/bin/bash
# usage: compare.sh N  -> N random mnemonics of each length: 12, 15, 18, 21 and 24 words, each
# also with a random passphrase, plus N random SLIP-39 master secrets of 16 and 32 bytes
# (20- and 33-word backups). Every address the device derives against bip_utils.
# Uses $PYTHON if set (e.g. a venv with mnemonic + bip_utils), else python3.
PY=${PYTHON:-python3}
fails=0; total=0
check() {   # $1: mnemonic or slip39:<hex>, $2: passphrase
  ./test_chains "$1" "$2" > mine.txt; { $PY ref_chains.py "$1" "$2"; for r in ref_ext_utxo.py ref_ext_cosmos.py ref_ext_ed.py; do [ -f $r ] && $PY $r "$1" "$2"; done; } > ref.txt 2>/dev/null
  total=$((total+1)); if ! diff -q mine.txt ref.txt >/dev/null; then fails=$((fails+1)); echo "MISMATCH: $1 / $2"; diff mine.txt ref.txt; fi
}
for n in 128 160 192 224 256; do for i in $(seq 1 $1); do
  m=$($PY -c "from mnemonic import Mnemonic;print(Mnemonic('english').generate($n))")
  check "$m" ""
  check "$m" "$($PY -c "import secrets,string;print(''.join(secrets.choice(string.printable[:95]) for _ in range(secrets.randbelow(20)+1)))")"
done; done
for n in 16 32; do for i in $(seq 1 $1); do check "slip39:$($PY -c "import os;print(os.urandom($n).hex())")" ""; done; done
echo "derivations compared: $total, mismatches: $fails"

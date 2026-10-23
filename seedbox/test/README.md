Host-side tests (PC, not Arduino). Needs gcc/g++ and `pip install mnemonic bip_utils`.

    # core: SHA-256, BIP39 checksum, prefix search
    python3 -c "import os;from mnemonic import Mnemonic as M;m=M('english');[print(e.hex(),m.to_mnemonic(e)) for e in [os.urandom(16) for _ in range(100)]+[os.urandom(32) for _ in range(100)]]" > vectors.txt
    g++ -std=c++17 -O2 -o test_seedcore test_seedcore.cpp && ./test_seedcore < vectors.txt

    # chains: every address vs bip_utils, N random 12-word + N random 24-word mnemonics
    cd ../src && for f in trezor/*.c trezor/aes/*.c trezor/ed25519-donna/*.c chains.c; do gcc -std=gnu11 -O2 -w -DNDEBUG -I trezor -c $f -o ../test/obj_$(basename $f .c).o; done; cd ../test
    gcc -O2 -w -o test_chains test_chains.c obj_*.o
    ./compare.sh 10

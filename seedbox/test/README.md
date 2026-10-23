Host-side tests (PC, not Arduino). Needs gcc/g++. The chain comparison needs `pip install mnemonic bip_utils`; the QR read-back needs node and `npm install` in this folder.

    ./build.sh      # trezor-crypto, chains.c, portfolio.c, qrcodegen.c -> test_chains, test_portfolio, test_qr

    # core: SHA-256, BIP39 checksum, prefix search
    python3 -c "import os;from mnemonic import Mnemonic as M;m=M('english');[print(e.hex(),m.to_mnemonic(e)) for e in [os.urandom(16) for _ in range(100)]+[os.urandom(32) for _ in range(100)]]" > vectors.txt
    g++ -std=c++17 -O2 -o test_seedcore test_seedcore.cpp && ./test_seedcore < vectors.txt

    # chains: every address vs bip_utils, N random 12-word + N random 24-word mnemonics
    ./compare.sh 10

    # one-scan QR, end to end: device payload -> docs/decode.js -> the same 20 addresses,
    # then URL + payload -> the device's QR encoder -> jsQR (an unrelated reader) -> the same URL
    npm install && node verify_site.js 10

`test_portfolio "words..."` prints the payload and every address for one mnemonic. `test_qr URL PAYLOAD` (or `test_qr -t TEXT`) dumps the QR modules as text, exactly what the screen would show.

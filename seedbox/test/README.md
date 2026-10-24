Host-side tests (PC, not Arduino). Needs gcc/g++. The chain comparison needs `pip install mnemonic bip_utils`; the QR read-back needs node and `npm install` in this folder.

    ./build.sh      # trezor-crypto, chains.c, portfolio.c, qrcodegen.c -> test_chains, test_portfolio, test_qr

    # core: SHA-256, BIP39 checksum, prefix search
    python3 -c "import os;from mnemonic import Mnemonic as M;m=M('english');[print(e.hex(),m.to_mnemonic(e)) for n in (16,20,24,28,32) for e in [os.urandom(n) for _ in range(100)]]" > vectors.txt
    g++ -std=c++17 -O2 -o test_seedcore test_seedcore.cpp && ./test_seedcore < vectors.txt

    # chains: every address vs bip_utils, N random mnemonics of each length (12/15/18/21/24 words)
    ./compare.sh 10             # or PYTHON=/path/to/venv/bin/python ./compare.sh 10

    # one-scan QR, end to end: device payload -> docs/decode.js -> the same 20 addresses,
    # then URL + payload -> the device's QR encoder -> jsQR (an unrelated reader) -> the same URL
    npm install && node verify_site.js 10     # N mnemonics of each length, 12 to 24 words

    # "more chains" frames (docs/EXTENSIONS.md): random extension rows -> device framing (test_frames)
    # -> device QR encoder (test_qr -f) -> jsQR -> docs/scan.js, shuffled with duplicates -> same records
    node verify_frames.js 10

    # the moving QR against the page: device frames -> docs/scan.js -> docs/extra.js -> every address
    # equals the device's own (test_chains); also checks extra.js's hashes against node / hashlib
    PYTHON=/path/to/venv/bin/python node verify_extra.js 3

    # can a phone read the moving QR off this 160x128 screen, and how long should each frame stay up?
    # renders the real frames on the panel, films them like a phone camera, decodes with the page's jsQR path
    node verify_screen.js 24      # slow: a few minutes

    # the page against the live networks: runs docs/app.js unchanged with a stub DOM, prints the
    # verdict and case file, and checks every endpoint's CORS answer for a github.io origin
    node site_live.js demo      # a famous wallet, expects "are in possession"
    node site_live.js random    # a fresh mnemonic, expects "not in possession"
    node site_live.js "mnemonic:abandon ... about" --more   # both QRs; a stand-in camera feeds the device's frames

`test_portfolio "words..."` prints the payload and every address for one mnemonic. `test_frames < rows` prints the extension bytes and `FRAME|` lines for rows given as `<type hex> <raw hex>` lines. `test_qr URL PAYLOAD` (or `test_qr -t TEXT`, or `test_qr -f FRAMETEXT`) dumps the QR modules as text, exactly what the screen would show.

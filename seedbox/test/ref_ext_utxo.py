# Reference for chains_ext_utxo.c: bip_utils derivation, printed as "name|addr" in device row order.
# Coins bip_utils knows use its own address encoders; the rest (eCash at 899, Ravencoin, Kaia,
# Kaspa, ICP) derive the key with bip_utils' generic BIP32 and build the address here.
import sys, hashlib, zlib, bip_utils as b
m = sys.argv[1]
seed = b.Bip39SeedGenerator(m).Generate()
C = b.Bip44Coins
EXT = b.Bip44Changes.CHAIN_EXT

def leaf(cls, coin):
    return cls.FromSeed(seed, coin).Purpose().Coin().Account(0).Change(EXT).AddressIndex(0).PublicKey()
def b44(coin): return leaf(b.Bip44, coin).ToAddress()
def pub(path):   # generic BIP32 secp256k1
    return b.Bip32Secp256k1.FromSeed(seed).DerivePath(path).PublicKey().KeyObject()

def ecash():
    return b.BchP2PKHAddrEncoder.EncodeKey(pub("m/44'/899'/0'/0/0"), hrp="ecash", net_ver=b"\x00")
def rvn():
    return b.P2PKHAddrEncoder.EncodeKey(pub("m/44'/175'/0'/0/0"), net_ver=b"\x3c")
def kaia():
    return b.EthAddrEncoder.EncodeKey(pub("m/44'/8217'/0'/0/0"))
def kaspa():
    x = pub("m/44'/111111'/0'/0/0").RawCompressed().ToBytes()[1:]
    return "kaspa:" + b.BchBech32Encoder.Encode("kaspa", b"\x00", x).split(":")[1]
def icp():
    p65 = pub("m/44'/223'/0'/0/0").RawUncompressed().ToBytes()
    der = bytes.fromhex("3056301006072a8648ce3d020106052b8104000a034200") + p65
    principal = hashlib.sha224(der).digest() + b"\x02"
    h = hashlib.sha224(b"\x0aaccount-id" + principal + bytes(32)).digest()
    return (zlib.crc32(h).to_bytes(4, "big") + h).hex()

rows = [
 ("BTC nested (3..)", leaf(b.Bip49, b.Bip49Coins.BITCOIN).ToAddress()),
 ("BTC taproot",      leaf(b.Bip86, b.Bip86Coins.BITCOIN).ToAddress()),
 ("LTC legacy (L..)", b44(C.LITECOIN)),
 ("LTC nested (M..)", leaf(b.Bip49, b.Bip49Coins.LITECOIN).ToAddress()),
 ("BCH",              b44(C.BITCOIN_CASH)),
 ("BSV",              b44(C.BITCOIN_SV)),
 ("XEC (eCash)",      ecash()),
 ("DASH",             b44(C.DASH)),
 ("ZEC transparent",  b44(C.ZCASH)),
 ("DGB",              b44(C.DIGIBYTE)),
 ("RVN",              rvn()),
 ("ETC",              b44(C.ETHEREUM_CLASSIC)),
 ("CELO",             b44(C.CELO)),
 ("ONE (Harmony)",    b44(C.HARMONY_ONE_ATOM)),
 ("VET (VeChain)",    b44(C.VECHAIN)),
 ("THETA",            b44(C.THETA)),
 ("KAIA (Klaytn)",    kaia()),
 ("ZIL",              b44(C.ZILLIQA)),
 ("ICX (ICON)",       b44(C.ICON)),
 ("FIL",              b44(C.FILECOIN)),
 ("KAS (Kaspa)",      kaspa()),
 ("ERG (Ergo)",       b44(C.ERGO)),
 ("ICP account",      icp()),
 ("AVAX X/P",         b44(C.AVAX_X_CHAIN)),
]
for n, a in rows: print(f"{n}|{a}")

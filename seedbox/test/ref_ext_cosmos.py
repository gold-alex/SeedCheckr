# Reference for chains_ext_cosmos.c: Cosmos-SDK chains with their own coin type.
# usage: python ref_ext_cosmos.py "mnemonic" [passphrase]  -> name|address lines, same order as the firmware
import sys
import bip_utils as b

from ref_seed import m, pw, seed, cardano_root
C = b.Bip44Coins

def b44(coin):
    return b.Bip44.FromSeed(seed, coin).Purpose().Coin().Account(0).Change(b.Bip44Changes.CHAIN_EXT).AddressIndex(0).PublicKey().ToAddress()

def generic(ct, hrp):
    k = b.Bip32Slip10Secp256k1.FromSeed(seed).DerivePath(f"m/44'/{ct}'/0'/0/0")
    return b.AtomAddrEncoder.EncodeKey(k.PublicKey().RawCompressed().ToBytes(), hrp=hrp)

def coin_or(name, ct, hrp):
    return b44(getattr(C, name)) if hasattr(C, name) else generic(ct, hrp)

rows = [
 ("LUNA (Terra)",        coin_or("TERRA", 330, "terra")),
 ("KAVA",                coin_or("KAVA", 459, "kava")),
 ("SCRT",                coin_or("SECRET_NETWORK_NEW", 529, "secret")),
 ("CRO (Cronos POS)",    generic(394, "cro")),
 ("BAND",                coin_or("BAND_PROTOCOL", 494, "band")),
 ("RUNE / CACAO",        generic(931, "thor")),
 ("BTSG",                generic(639, "bitsong")),
 ("DSM",                 generic(852, "desmos")),
 ("XPRT (old 750)",      generic(750, "persistence")),
 ("LUM",                 generic(880, "lum")),
 ("HASH (Provenance)",   generic(505, "pb")),
 ("COREUM",              generic(990, "core")),
 ("BLD (Agoric)",        generic(564, "agoric")),
]
for n, a in rows: print(f"{n}|{a}")

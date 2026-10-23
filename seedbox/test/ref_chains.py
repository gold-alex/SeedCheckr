# Reference derivation with bip_utils, printed in the same "name|addr" format as test_chains.
import sys, bip_utils as b
m = sys.argv[1]
seed = b.Bip39SeedGenerator(m).Generate()
def b44(coin): return b.Bip44.FromSeed(seed, coin).Purpose().Coin().Account(0).Change(b.Bip44Changes.CHAIN_EXT).AddressIndex(0).PublicKey().ToAddress()
def b84(coin): return b.Bip84.FromSeed(seed, coin).Purpose().Coin().Account(0).Change(b.Bip44Changes.CHAIN_EXT).AddressIndex(0).PublicKey().ToAddress()
C = b.Bip44Coins
def cosmos_hrp(hrp):
    pub = b.Bip44.FromSeed(seed, C.COSMOS).Purpose().Coin().Account(0).Change(b.Bip44Changes.CHAIN_EXT).AddressIndex(0).PublicKey().RawCompressed().ToBytes()
    return b.AtomAddrEncoder.EncodeKey(pub, hrp=hrp)
rows = [
 ("ETH / all EVM", b44(C.ETHEREUM)),
 ("BTC zpub (segwit)", b.Bip84.FromSeed(seed, b.Bip84Coins.BITCOIN).Purpose().Coin().Account(0).PublicKey().ToExtended()),
 ("BTC addr 1", b84(b.Bip84Coins.BITCOIN)),
 ("BTC xpub (legacy)", b.Bip44.FromSeed(seed, C.BITCOIN).Purpose().Coin().Account(0).PublicKey().ToExtended()),
 ("LTC", b84(b.Bip84Coins.LITECOIN)),
 ("DOGE", b44(C.DOGECOIN)),
 ("SOL", b.Bip44.FromSeed(seed, C.SOLANA).Purpose().Coin().Account(0).Change(b.Bip44Changes.CHAIN_EXT).PublicKey().ToAddress()),
 ("TRX", b44(C.TRON)),
 ("ATOM", b44(C.COSMOS)),
 ("OSMO", b44(C.OSMOSIS)),
 ("TIA", b44(C.CELESTIA)),
 ("DYDX", b44(C.DYDX) if hasattr(C,'DYDX') else '?'),
 ("SEI", cosmos_hrp("sei")),
 ("AKT", b44(C.AKASH_NETWORK)),
 ("JUNO", cosmos_hrp("juno")),
 ("STARS", cosmos_hrp("stars")),
 ("INJ", b44(C.INJECTIVE) if hasattr(C,'INJECTIVE') else '?'),
 ("XRP", b44(C.RIPPLE)),
 ("SUI", b.Bip44.FromSeed(seed, C.SUI).Purpose().Coin().Account(0).Change(b.Bip44Changes.CHAIN_EXT).AddressIndex(0).PublicKey().ToAddress()),
 ("APT", b.Bip44.FromSeed(seed, C.APTOS).Purpose().Coin().Account(0).Change(b.Bip44Changes.CHAIN_EXT).AddressIndex(0).PublicKey().ToAddress()),
]
for n, a in rows: print(f"{n}|{a}")

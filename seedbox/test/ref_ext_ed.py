# Reference for chains_ext_ed.c rows (types 0x50-0x60), printed as "name|addr" in device row order.
# SLIP-10 keys come from bip_utils' Bip32Slip10Ed25519; where bip_utils has the coin, its
# Bip44 address is used and checked against the generic derivation. Cardano uses Cip1852 Icarus.
import sys, hashlib, bip_utils as b
m = sys.argv[1]
seed = b.Bip39SeedGenerator(m).Generate()
C = b.Bip44Coins

def pub(path):
    return b.Bip32Slip10Ed25519.FromSeed(seed).DerivePath(path).PublicKey().RawCompressed().ToBytes()[1:]

def bip44(coin, levels):
    ctx = b.Bip44.FromSeed(seed, coin).Purpose().Coin()
    if levels >= 3: ctx = ctx.Account(0)
    if levels >= 4: ctx = ctx.Change(b.Bip44Changes.CHAIN_EXT)
    if levels >= 5: ctx = ctx.AddressIndex(0)
    return ctx.PublicKey().ToAddress()

def both(a, b_):
    assert a == b_, (a, b_)
    return a

rows = []
p = pub("m/44'/501'/0'")
rows.append(("SOL Ledger/Trust", both(b.SolAddrEncoder.EncodeKey(p), bip44(C.SOLANA, 3))))
rows.append(("SOL root (old)", b.SolAddrEncoder.EncodeKey(pub("m/44'/501'"))))
p = pub("m/44'/148'/0'")
rows.append(("Stellar XLM", both(b.XlmAddrEncoder.EncodeKey(p, addr_type=b.XlmAddrTypes.PUB_KEY), bip44(C.STELLAR, 3))))
p = pub("m/44'/1729'/0'/0'")
rows.append(("Tezos tz1", both(b.XtzAddrEncoder.EncodeKey(p, prefix=b.XtzAddrPrefixes.TZ1), bip44(C.TEZOS, 4))))
p = pub("m/44'/397'/0'")
rows.append(("NEAR", both(b.NearAddrEncoder.EncodeKey(p), bip44(C.NEAR_PROTOCOL, 3))))
p = pub("m/44'/283'/0'/0'/0'")
rows.append(("Algorand", both(b.AlgoAddrEncoder.EncodeKey(p), bip44(C.ALGORAND, 5))))
p = pub("m/44'/508'/0'/0'/0'")
rows.append(("MultiversX EGLD", both(b.EgldAddrEncoder.EncodeKey(p), bip44(C.ELROND, 5))))
rows.append(("Hedera HBAR", pub("m/44'/3030'/0'/0'/0'").hex()))
rows.append(("IOTA", "0x" + hashlib.blake2b(b"\x00" + pub("m/44'/4218'/0'/0'/0'"), digest_size=32).hexdigest()))
rows.append(("TON (Trust path)", pub("m/44'/607'/0'").hex()))

ent = b.CardanoIcarusSeedGenerator(m).Generate()
acct = b.Cip1852.FromSeed(ent, b.Cip1852Coins.CARDANO_ICARUS).Purpose().Coin().Account(0)
sh = b.CardanoShelley.FromCip1852Object(acct).Change(b.Bip44Changes.CHAIN_EXT).AddressIndex(0)
rows.append(("Cardano ADA", sh.PublicKeys().ToAddress()))

for n, a in rows: print(f"{n}|{a}")

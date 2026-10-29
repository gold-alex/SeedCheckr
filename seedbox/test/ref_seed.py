# Shared by the ref_*.py scripts: what the device derives from.
#   argv[1]: a BIP39 mnemonic, or "slip39:<hex>" for a SLIP-39 master secret (16 or 32 bytes)
#   argv[2]: the passphrase (BIP39 only; a SLIP-39 secret is already decrypted with it)
# seed: the BIP32 seed. cardano_root(): (kL || kR, chain code) of the Cardano master key,
# Icarus for BIP39 (passphrase as the PBKDF2 password), SLIP-0023 for SLIP-39.
import sys, hashlib, hmac, bip_utils as b
m = sys.argv[1]
pw = sys.argv[2] if len(sys.argv) > 2 else ""
slip39 = m.startswith("slip39:")
seed = bytes.fromhex(m[7:]) if slip39 else b.Bip39SeedGenerator(m).Generate(pw)

def cardano_root():
    if slip39:
        i = hmac.new(b"ed25519 cardano seed", seed, hashlib.sha512).digest()
        k = bytearray(hashlib.sha512(i[:32]).digest()); c = i[32:]
    else:
        ent = b.Bip39MnemonicDecoder().Decode(m)
        s = hashlib.pbkdf2_hmac("sha512", pw.encode(), ent, 4096, 96)
        k = bytearray(s[:64]); c = s[64:]
    k[0] &= 0xF8; k[31] = (k[31] & 0x1F) | 0x40
    return bytes(k), c

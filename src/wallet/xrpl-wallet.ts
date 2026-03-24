import { Wallet, ECDSA } from "xrpl";
import { encrypt, decrypt } from "./crypto.js";
import type { StoredXrplWallet } from "../types/index.js";

export type XrplAlgorithm = "ed25519" | "secp256k1";

export interface XrplWalletResult {
  address: string;
  secret: string;
  publicKey: string;
  algorithm: XrplAlgorithm;
}

function toECDSA(algorithm: XrplAlgorithm): ECDSA {
  return algorithm === "secp256k1" ? ECDSA.secp256k1 : ECDSA.ed25519;
}

export function generateXrplWallet(algorithm: XrplAlgorithm = "ed25519"): XrplWalletResult {
  const wallet = Wallet.generate(toECDSA(algorithm));
  return {
    address: wallet.address,
    secret: wallet.seed!,
    publicKey: wallet.publicKey,
    algorithm,
  };
}

export function importXrplWalletFromSecret(secret: string): XrplWalletResult {
  const wallet = Wallet.fromSeed(secret);
  return {
    address: wallet.address,
    secret: wallet.seed!,
    publicKey: wallet.publicKey,
    algorithm: wallet.publicKey.startsWith("ED") ? "ed25519" : "secp256k1",
  };
}

export function serializeXrplWallet(
  name: string,
  wallet: XrplWalletResult,
  password: string,
): StoredXrplWallet {
  return {
    name,
    chain: "xrpl",
    address: wallet.address,
    encrypted_secret: encrypt(wallet.secret, password),
    algorithm: wallet.algorithm,
    created_at: new Date().toISOString(),
  };
}

export function decryptXrplSecret(stored: StoredXrplWallet, password: string): string {
  return decrypt(stored.encrypted_secret, password);
}

export function restoreXrplWallet(stored: StoredXrplWallet, password: string): Wallet {
  const secret = decryptXrplSecret(stored, password);
  return Wallet.fromSeed(secret);
}

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts";
import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { encrypt, decrypt } from "./crypto.js";
import type { StoredEvmWallet, EvmChainName } from "../types/index.js";

export interface EvmWalletResult {
  address: string;
  privateKey: string;
}

export function generateEvmWallet(): EvmWalletResult {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey,
  };
}

export function importEvmWalletFromPrivateKey(privateKey: string): EvmWalletResult {
  const key = privateKey.startsWith("0x") ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`);
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    privateKey: key,
  };
}

export function importEvmWalletFromMnemonic(mnemonic: string, index = 0): EvmWalletResult {
  if (!validateMnemonic(mnemonic, english)) {
    throw new Error("Invalid mnemonic phrase.");
  }

  const hdAccount = mnemonicToAccount(mnemonic, { addressIndex: index });
  const seed = mnemonicToSeedSync(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const child = root.derive(`m/44'/60'/0'/0/${index}`);

  if (!child.privateKey) {
    throw new Error("Unable to derive a private key from the mnemonic.");
  }

  return {
    address: hdAccount.address,
    privateKey: `0x${Buffer.from(child.privateKey).toString("hex")}`,
  };
}

export function generateEvmMnemonic(): string {
  return generateMnemonic(english);
}

export function serializeEvmWallet(
  name: string,
  wallet: EvmWalletResult,
  password: string,
  chain: EvmChainName = "ethereum",
): StoredEvmWallet {
  return {
    name,
    chain,
    address: wallet.address,
    encrypted_private_key: encrypt(wallet.privateKey, password),
    created_at: new Date().toISOString(),
  };
}

export function decryptEvmPrivateKey(stored: StoredEvmWallet, password: string): string {
  return decrypt(stored.encrypted_private_key, password);
}

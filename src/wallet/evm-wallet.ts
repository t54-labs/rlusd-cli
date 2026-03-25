import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts";
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
  const hdAccount = mnemonicToAccount(mnemonic, { addressIndex: index });
  return {
    address: hdAccount.address,
    privateKey: mnemonic,
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

import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ensureConfigDir, getWalletsDir, loadConfig, saveConfig } from "../config/config.js";
import type { StoredWallet, StoredXrplWallet, StoredEvmWallet, ChainName } from "../types/index.js";

const WALLET_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

function walletPath(name: string): string {
  if (!WALLET_NAME_PATTERN.test(name)) {
    throw new Error(
      "Invalid wallet name. Use only letters, numbers, dots, underscores, and hyphens.",
    );
  }
  return join(getWalletsDir(), `${name}.json`);
}

export function saveWallet(wallet: StoredWallet): void {
  ensureConfigDir();
  const path = walletPath(wallet.name);
  writeFileSync(path, JSON.stringify(wallet, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function loadWallet(name: string): StoredWallet | null {
  const path = walletPath(name);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as StoredWallet;
}

export function deleteWallet(name: string): boolean {
  const path = walletPath(name);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export function listWallets(): StoredWallet[] {
  const dir = getWalletsDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), "utf-8");
    return JSON.parse(raw) as StoredWallet;
  });
}

export function listWalletsByChain(chain: ChainName): StoredWallet[] {
  return listWallets().filter((w) => w.chain === chain);
}

export function getDefaultWallet(chain: ChainName): StoredWallet | null {
  const config = loadConfig();
  const chainConfig = config.chains[chain];
  const walletName = chainConfig?.default_wallet;

  if (walletName) {
    const wallet = loadWallet(walletName);
    if (wallet) return wallet;
  }

  const wallets = listWalletsByChain(chain);
  return wallets.length > 0 ? wallets[0] : null;
}

export function setDefaultWallet(chain: ChainName, walletName: string): void {
  if (!loadWallet(walletName)) {
    throw new Error(`Wallet '${walletName}' does not exist.`);
  }
  const config = loadConfig();
  if (!config.chains[chain]) {
    config.chains[chain] = {};
  }
  config.chains[chain].default_wallet = walletName;
  saveConfig(config);
}

export function isXrplWallet(wallet: StoredWallet): wallet is StoredXrplWallet {
  return wallet.chain === "xrpl";
}

export function isEvmWallet(wallet: StoredWallet): wallet is StoredEvmWallet {
  return wallet.chain !== "xrpl";
}

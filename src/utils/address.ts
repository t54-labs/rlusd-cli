import type { ChainName } from "../types/index.js";

export function detectChainFromAddress(address: string): ChainName | null {
  if (isXrplAddress(address)) return "xrpl";
  if (isEvmAddress(address)) return "ethereum";
  return null;
}

export function isXrplAddress(address: string): boolean {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address);
}

export function isEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function validateAddress(address: string, chain: ChainName): boolean {
  if (chain === "xrpl") return isXrplAddress(address);
  return isEvmAddress(address);
}

import { parseUnits } from "viem";

/**
 * Convert XRP to drops (1 XRP = 1,000,000 drops).
 */
export function xrpToDrops(xrp: string | number): string {
  const num = typeof xrp === "string" ? parseFloat(xrp) : xrp;
  return Math.round(num * 1_000_000).toString();
}

/**
 * Convert drops to XRP.
 */
export function dropsToXrp(drops: string | number): string {
  const num = typeof drops === "string" ? parseInt(drops, 10) : drops;
  return (num / 1_000_000).toString();
}

/**
 * Convert a human-readable amount to the smallest ERC-20 unit (wei-like).
 */
export function toErc20Units(amount: string | number, decimals: number): bigint {
  const normalized = typeof amount === "string" ? amount : String(amount);
  return parseUnits(normalized, decimals);
}

/**
 * Convert ERC-20 smallest units to human-readable amount.
 */
export function fromErc20Units(units: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const remainder = units % divisor;
  const paddedRemainder = remainder.toString().padStart(decimals, "0");
  const trimmed = paddedRemainder.replace(/0+$/, "") || "0";
  if (trimmed === "0") return whole.toString();
  return `${whole}.${trimmed}`;
}

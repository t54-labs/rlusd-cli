import type { DefiVenueAdapter } from "../types.js";
import { CURVE_DEFI_ADAPTER } from "./curve.js";
import { UNISWAP_DEFI_ADAPTER } from "./uniswap.js";

const ADAPTERS = new Map<string, DefiVenueAdapter>([
  ["uniswap", UNISWAP_DEFI_ADAPTER],
  ["curve", CURVE_DEFI_ADAPTER],
]);

export function getDefiVenueAdapter(venue: string): DefiVenueAdapter {
  const adapter = ADAPTERS.get(venue.trim().toLowerCase());
  if (!adapter) {
    throw new Error(`Venue ${venue} is not configured.`);
  }
  return adapter;
}

export function listDefiVenueAdapters(): DefiVenueAdapter[] {
  return [...ADAPTERS.values()];
}

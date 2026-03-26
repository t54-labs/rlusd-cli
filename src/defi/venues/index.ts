import { resolveCurvePool } from "../curve-pool.js";
import type { DefiSwapQuoteRequest, DefiVenueAdapter } from "../types.js";
import { UNISWAP_DEFI_ADAPTER } from "./uniswap.js";

function unsupported(venue: string, method: string): never {
  throw new Error(`Venue ${venue} does not support ${method} in this batch.`);
}

async function quoteCurveSwap(input: DefiSwapQuoteRequest) {
  resolveCurvePool(input.chain.label, input.config);
  return unsupported("curve", "quoteSwap");
}

const CURVE_DEFI_ADAPTER: DefiVenueAdapter = {
  venue: "curve",
  quoteSwap: quoteCurveSwap,
  buildSwapPlan: async () => unsupported("curve", "buildSwapPlan"),
  previewLp: async () => unsupported("curve", "previewLp"),
  buildLpPlan: async () => unsupported("curve", "buildLpPlan"),
};

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

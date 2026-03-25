import type { PriceApiConfig } from "../types/index.js";
import { DEFAULT_PRICE_API } from "../config/constants.js";

const REQUEST_TIMEOUT_MS = 10_000;

export interface XrpUsdPrice {
  usd: number;
  source: string;
}

/**
 * Fetch XRP/USD price using the configured price API provider.
 * Falls back to null on any network or parsing error so callers can degrade gracefully.
 */
export async function fetchXrpUsdPrice(priceApi?: PriceApiConfig): Promise<XrpUsdPrice | null> {
  const cfg = priceApi ?? DEFAULT_PRICE_API;
  const provider = cfg.provider || "coingecko";
  const baseUrl = cfg.base_url || DEFAULT_PRICE_API.base_url;

  try {
    if (provider === "coingecko") {
      return await fetchFromCoingecko(baseUrl, cfg.api_key);
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchFromCoingecko(baseUrl: string, apiKey?: string): Promise<XrpUsdPrice | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const url = `${baseUrl}/simple/price?ids=ripple&vs_currencies=usd`;
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["x-cg-pro-api-key"] = apiKey;
  }

  const res = await fetch(url, { signal: controller.signal, headers });
  clearTimeout(timer);

  if (!res.ok) return null;

  const data = (await res.json()) as { ripple?: { usd?: number } };
  const usd = data?.ripple?.usd;
  if (typeof usd !== "number" || !Number.isFinite(usd)) return null;

  return { usd, source: "coingecko" };
}

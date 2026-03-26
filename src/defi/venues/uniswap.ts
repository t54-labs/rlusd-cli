import { formatUnits, parseUnits } from "viem";

import { UNISWAP_QUOTER_V2_ABI } from "../../abi/uniswap-router.js";
import { getEvmPublicClient } from "../../clients/evm-client.js";
import {
  UNISWAP_V3_QUOTER_V2,
  UNISWAP_V3_SWAP_ROUTER,
  WELL_KNOWN_TOKENS,
} from "../../config/constants.js";
import { getRlusdContractAddress } from "../../utils/evm-support.js";
import { createQuoteWindow } from "../../services/price-feed.js";
import type { AppConfig, EvmChainName } from "../../types/index.js";
import type { DefiSwapQuoteRequest, DefiSwapQuoteResult, DefiVenueAdapter } from "../types.js";

const DEFAULT_FEE_TIER = 3000;

export function resolveUniswapRouter(chain: EvmChainName, config: AppConfig): `0x${string}` {
  return (config.contracts?.[chain]?.uniswap_router || UNISWAP_V3_SWAP_ROUTER) as `0x${string}`;
}

export function resolveUniswapQuoter(chain: EvmChainName, config: AppConfig): `0x${string}` {
  return (config.contracts?.[chain]?.uniswap_quoter || UNISWAP_V3_QUOTER_V2) as `0x${string}`;
}

export function resolveTokenAddress(symbol: string): { address: string; decimals: number } | null {
  const upper = symbol.toUpperCase();
  const token = WELL_KNOWN_TOKENS[upper];
  if (token) return { address: token.address, decimals: token.decimals };
  return null;
}

export function parseFeeTier(feeTier: string | undefined): number {
  const fee = Number.parseInt(feeTier || String(DEFAULT_FEE_TIER), 10);
  if (![100, 500, 3000, 10000].includes(fee)) {
    throw new Error("Invalid --fee-tier. Supported values: 100, 500, 3000, 10000.");
  }
  return fee;
}

function unsupported(method: string): never {
  throw new Error(`Venue uniswap does not support ${method} in this batch.`);
}

export async function quoteUniswapSwap(input: DefiSwapQuoteRequest): Promise<DefiSwapQuoteResult> {
  if (input.fromSymbol.toUpperCase() !== "RLUSD") {
    throw new Error(`Only RLUSD swap quotes are supported today (received ${input.fromSymbol}).`);
  }

  const outToken = resolveTokenAddress(input.toSymbol);
  if (!outToken) {
    throw new Error(`Unknown token: ${input.toSymbol}`);
  }

  const publicClient =
    input.publicClient ?? getEvmPublicClient(input.chain.chain, input.chain.network);
  if (!publicClient.simulateContract) {
    throw new Error("Venue uniswap requires a client with simulateContract support.");
  }
  const amountIn = parseUnits(input.amount, input.config.rlusd.eth_decimals);
  const fee = parseFeeTier(input.feeTier);
  const quoteResult = await publicClient.simulateContract({
    address: resolveUniswapQuoter(input.chain.chain, input.config),
    abi: UNISWAP_QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: getRlusdContractAddress(input.chain.chain, input.config),
        tokenOut: outToken.address as `0x${string}`,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const [amountOut, , , gasEstimate] = quoteResult.result;
  const quotedAt = new Date().toISOString();

  return {
    request: {
      from: input.fromSymbol.toUpperCase(),
      to: input.toSymbol.toUpperCase(),
      amount: input.amount,
    },
    route: {
      venue: "uniswap",
      pricing_source: "live_quote",
      amount_out: formatUnits(amountOut, outToken.decimals),
      fee_bps: fee / 100,
      gas_estimate: gasEstimate.toString(),
      ...createQuoteWindow(quotedAt, 30),
    },
  };
}

export const UNISWAP_DEFI_ADAPTER: DefiVenueAdapter = {
  venue: "uniswap",
  quoteSwap: quoteUniswapSwap,
  buildSwapPlan: async () => unsupported("buildSwapPlan"),
  previewLp: async () => unsupported("previewLp"),
  buildLpPlan: async () => unsupported("buildLpPlan"),
};

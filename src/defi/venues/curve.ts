import { encodeFunctionData, formatUnits, parseUnits } from "viem";

import { CURVE_STABLESWAP_POOL_ABI } from "../../abi/curve-stableswap-pool.js";
import { RLUSD_ERC20_ABI } from "../../abi/rlusd-erc20.js";
import { getEvmPublicClient } from "../../clients/evm-client.js";
import { WELL_KNOWN_TOKENS } from "../../config/constants.js";
import { createQuoteWindow } from "../../services/price-feed.js";
import { resolveCurvePool } from "../curve-pool.js";
import type {
  DefiSwapPlanRequest,
  DefiSwapPlanResult,
  DefiSwapQuoteRequest,
  DefiSwapQuoteResult,
  DefiVenueAdapter,
} from "../types.js";

type SupportedCurveSymbol = "RLUSD" | "USDC";

function unsupported(method: string): never {
  throw new Error(`Venue curve does not support ${method} in this batch.`);
}

function resolveCurveSwapPair(input: {
  chainLabel: string;
  config: DefiSwapQuoteRequest["config"];
  fromSymbol: string;
  toSymbol: string;
}) {
  const pool = resolveCurvePool(input.chainLabel, input.config);
  const from = input.fromSymbol.toUpperCase() as SupportedCurveSymbol;
  const to = input.toSymbol.toUpperCase() as SupportedCurveSymbol;

  if (!["RLUSD", "USDC"].includes(from) || !["RLUSD", "USDC"].includes(to) || from === to) {
    throw new Error("Venue curve only supports RLUSD <-> USDC swaps in this batch.");
  }

  const fromCoin = pool.coins[pool.coinIndexBySymbol[from]];
  const toCoin = pool.coins[pool.coinIndexBySymbol[to]];

  return { pool, fromCoin, toCoin, from, to };
}

function curveIndex(value: 0 | 1): bigint {
  return BigInt(value);
}

export async function quoteCurveSwap(input: DefiSwapQuoteRequest): Promise<DefiSwapQuoteResult> {
  const { pool, fromCoin, toCoin, from, to } = resolveCurveSwapPair({
    chainLabel: input.chain.label,
    config: input.config,
    fromSymbol: input.fromSymbol,
    toSymbol: input.toSymbol,
  });
  const publicClient =
    input.publicClient ?? getEvmPublicClient(input.chain.chain, input.chain.network);
  if (!publicClient.readContract) {
    throw new Error("Venue curve requires a client with readContract support.");
  }

  const amountIn = parseUnits(input.amount, fromCoin.decimals);
  const amountOut = await publicClient.readContract({
    address: pool.address,
    abi: CURVE_STABLESWAP_POOL_ABI,
    functionName: "get_dy",
    args: [curveIndex(fromCoin.index), curveIndex(toCoin.index), amountIn],
  });
  const quotedAt = new Date().toISOString();

  return {
    request: {
      from,
      to,
      amount: input.amount,
    },
    route: {
      venue: "curve",
      pricing_source: "live_quote",
      amount_out: formatUnits(amountOut, toCoin.decimals),
      gas_estimate: "0",
      pool_name: pool.name,
      pool_address: pool.address,
      ...createQuoteWindow(quotedAt, 30),
    },
  };
}

export async function buildCurveSwapPlan(input: DefiSwapPlanRequest): Promise<DefiSwapPlanResult> {
  const { pool, fromCoin, toCoin, from, to } = resolveCurveSwapPair({
    chainLabel: input.chain.label,
    config: input.config,
    fromSymbol: input.fromSymbol,
    toSymbol: input.toSymbol,
  });
  const publicClient =
    input.publicClient ?? getEvmPublicClient(input.chain.chain, input.chain.network);
  if (!publicClient.readContract) {
    throw new Error("Venue curve requires a client with readContract support.");
  }

  const amountIn = parseUnits(input.amount, fromCoin.decimals);
  const expectedAmountOut = await publicClient.readContract({
    address: pool.address,
    abi: CURVE_STABLESWAP_POOL_ABI,
    functionName: "get_dy",
    args: [curveIndex(fromCoin.index), curveIndex(toCoin.index), amountIn],
  });
  const minAmountOut =
    expectedAmountOut - (expectedAmountOut * BigInt(input.slippageBps)) / 10_000n;

  return {
    asset: {
      symbol: from,
      name: from === "RLUSD" ? "Ripple USD" : WELL_KNOWN_TOKENS.USDC.name,
      chain: input.chain.chain,
      family: "evm",
      address: fromCoin.address,
      decimals: fromCoin.decimals,
    },
    human_summary: `Swap ${input.amount} ${from} for ${to} via ${pool.name} from ${input.walletName} on ${input.chain.displayName}`,
    params: {
      venue: "curve",
      from: input.walletName,
      input_symbol: from,
      output_symbol: to,
      amount: input.amount,
      slippage_bps: String(input.slippageBps),
      pool_address: pool.address,
    },
    intent: {
      venue: "curve",
      from_symbol: from,
      to_symbol: to,
      amount_in: input.amount,
      expected_amount_out: formatUnits(expectedAmountOut, toCoin.decimals),
      min_amount_out: formatUnits(minAmountOut, toCoin.decimals),
      steps: [
        {
          step: "approve",
          to: fromCoin.address,
          value: "0",
          data: encodeFunctionData({
            abi: RLUSD_ERC20_ABI,
            functionName: "approve",
            args: [pool.address, amountIn],
          }),
        },
        {
          step: "swap",
          to: pool.address,
          value: "0",
          data: encodeFunctionData({
            abi: CURVE_STABLESWAP_POOL_ABI,
            functionName: "exchange",
            args: [
              curveIndex(fromCoin.index),
              curveIndex(toCoin.index),
              amountIn,
              minAmountOut,
              input.walletAddress,
            ],
          }),
        },
      ],
    },
    warnings: ["quote_expires"],
  };
}

export const CURVE_DEFI_ADAPTER: DefiVenueAdapter = {
  venue: "curve",
  quoteSwap: quoteCurveSwap,
  buildSwapPlan: buildCurveSwapPlan,
  previewLp: async () => unsupported("previewLp"),
  buildLpPlan: async () => unsupported("buildLpPlan"),
};

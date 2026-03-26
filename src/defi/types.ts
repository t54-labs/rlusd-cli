import type { ResolvedEvmChainRef } from "../clients/evm-client.js";
import type { AppConfig, DefiVenueName } from "../types/index.js";

export type DefiIntentStep = {
  step: string;
  to: `0x${string}`;
  data: `0x${string}`;
  value: string;
};

export type DefiExecutionResult = {
  step: string;
  tx_hash: `0x${string}`;
  status: string;
};

export type DefiSwapQuoteResult = {
  request: {
    from: string;
    to: string;
    amount: string;
  };
  route: {
    venue: DefiVenueName | string;
    pricing_source: "live_quote";
    amount_out: string;
    gas_estimate: string;
    quoted_at: string;
    ttl_seconds: number;
    expires_at: string;
    fee_bps?: number;
  };
};

export type QuotePublicClient = {
  simulateContract: (args: unknown) => Promise<{
    result: readonly [bigint, bigint, number, bigint];
  }>;
};

export type DefiSwapQuoteRequest = {
  chain: ResolvedEvmChainRef;
  config: AppConfig;
  fromSymbol: string;
  toSymbol: string;
  amount: string;
  feeTier?: string;
  publicClient?: QuotePublicClient;
};

export type DefiVenueAdapter = {
  venue: DefiVenueName;
  quoteSwap: (input: DefiSwapQuoteRequest) => Promise<DefiSwapQuoteResult>;
  buildSwapPlan: (input: unknown) => Promise<unknown>;
  previewLp: (input: unknown) => Promise<unknown>;
  buildLpPlan: (input: unknown) => Promise<unknown>;
};

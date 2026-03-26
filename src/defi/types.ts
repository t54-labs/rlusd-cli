import type { ResolvedEvmChainRef } from "../clients/evm-client.js";
import type { AppConfig, DefiLpOperation, DefiVenueName, ResolvedAsset } from "../types/index.js";

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
    pool_name?: string;
    pool_address?: `0x${string}`;
  };
};

export type QuotePublicClient = {
  simulateContract?: (args: unknown) => Promise<{
    result: readonly [bigint, bigint, number, bigint];
  }>;
  readContract?: (args: unknown) => Promise<bigint>;
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

export type DefiSwapPlanIntent = {
  venue: DefiVenueName;
  from_symbol: string;
  to_symbol: string;
  amount_in: string;
  expected_amount_out: string;
  min_amount_out: string;
  steps: DefiIntentStep[];
};

export type DefiSwapPlanRequest = {
  chain: ResolvedEvmChainRef;
  config: AppConfig;
  walletName: string;
  walletAddress: `0x${string}`;
  fromSymbol: string;
  toSymbol: string;
  amount: string;
  slippageBps: number;
  feeTier?: string;
  publicClient?: QuotePublicClient;
};

export type DefiSwapPlanResult = {
  asset: ResolvedAsset;
  human_summary: string;
  params: Record<string, string>;
  intent: DefiSwapPlanIntent;
  warnings: string[];
};

export type DefiLpPreviewRequest = {
  chain: ResolvedEvmChainRef;
  config: AppConfig;
  operation: DefiLpOperation;
  rlusdAmount?: string;
  usdcAmount?: string;
  lpAmount?: string;
  receiveToken?: string;
  publicClient?: QuotePublicClient;
};

export type DefiLpPreviewResult = {
  venue: DefiVenueName;
  operation: DefiLpOperation;
  pool_name: string;
  pool_address: `0x${string}`;
  quoted_at: string;
  ttl_seconds: number;
  expires_at: string;
  expected_lp_amount?: string;
  expected_receive_amount?: string;
  receive_token?: "RLUSD" | "USDC";
};

export type DefiLpPlanIntent = {
  venue: DefiVenueName;
  operation: DefiLpOperation;
  expected_lp_amount?: string;
  min_lp_amount?: string;
  expected_receive_amount?: string;
  min_receive_amount?: string;
  receive_token?: "RLUSD" | "USDC";
  steps: DefiIntentStep[];
};

export type DefiLpPlanRequest = {
  chain: ResolvedEvmChainRef;
  config: AppConfig;
  walletName: string;
  walletAddress: `0x${string}`;
  operation: DefiLpOperation;
  slippageBps: number;
  rlusdAmount?: string;
  usdcAmount?: string;
  lpAmount?: string;
  receiveToken?: string;
  publicClient?: QuotePublicClient;
};

export type DefiLpPlanResult = {
  asset: ResolvedAsset;
  human_summary: string;
  params: Record<string, string>;
  intent: DefiLpPlanIntent;
  warnings: string[];
};

export type DefiVenueAdapter = {
  venue: DefiVenueName;
  quoteSwap: (input: DefiSwapQuoteRequest) => Promise<DefiSwapQuoteResult>;
  buildSwapPlan: (input: DefiSwapPlanRequest) => Promise<DefiSwapPlanResult>;
  previewLp: (input: DefiLpPreviewRequest) => Promise<DefiLpPreviewResult>;
  buildLpPlan: (input: DefiLpPlanRequest) => Promise<DefiLpPlanResult>;
};

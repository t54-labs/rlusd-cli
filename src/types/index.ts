export type ChainName = "xrpl" | "ethereum" | "base" | "optimism" | "ink" | "unichain";

export type EvmChainName = Exclude<ChainName, "xrpl">;

export type NetworkEnvironment = "mainnet" | "testnet" | "devnet";

export type OutputFormat = "table" | "json" | "json-compact";

export interface ChainConfig {
  websocket?: string;
  json_rpc?: string;
  rpc?: string;
  default_wallet?: string;
}

export interface RlusdConfig {
  xrpl_issuer: string;
  xrpl_currency: string;
  eth_contract: string;
  eth_decimals: number;
  chainlink_oracle: string;
}

export interface PriceApiConfig {
  provider: string;
  base_url: string;
  api_key?: string;
}

export interface ChainContracts {
  uniswap_router?: string;
  uniswap_quoter?: string;
  aave_v3_pool?: string;
  curve_rlusd_usdc_pool?: string;
}

export interface FaucetConfig {
  xrpl_testnet: string;
  xrpl_devnet: string;
}

export interface AppConfig {
  environment: NetworkEnvironment;
  default_chain: ChainName;
  output_format: OutputFormat;
  chains: Record<string, ChainConfig>;
  rlusd: RlusdConfig;
  price_api?: PriceApiConfig;
  contracts?: Record<string, ChainContracts>;
  faucet?: FaucetConfig;
}

export interface WalletInfo {
  name: string;
  chain: ChainName;
  address: string;
  algorithm?: string;
  created_at: string;
}

export interface StoredXrplWallet extends WalletInfo {
  chain: "xrpl";
  encrypted_secret: string;
  algorithm: string;
}

export interface StoredEvmWallet extends WalletInfo {
  chain: EvmChainName;
  encrypted_private_key: string;
}

export type StoredWallet = StoredXrplWallet | StoredEvmWallet;

export interface BalanceResult {
  chain: ChainName;
  address: string;
  rlusd_balance: string;
  native_balance?: string;
  native_symbol?: string;
}

export interface TransactionResult {
  hash: string;
  chain: ChainName;
  status: "success" | "failed" | "pending";
  timestamp?: string;
  fee?: string;
}

export type PrepareAction =
  | "evm.transfer"
  | "evm.approve"
  | "defi.supply"
  | "defi.swap"
  | "defi.lp"
  | "xrpl.trustline"
  | "xrpl.payment";

export interface PreparePolicy {
  requires_confirmation: boolean;
  warnings: string[];
}

export type ChainFamily = "evm" | "xrpl";

export interface ResolvedAsset {
  symbol: string;
  name: string;
  chain: string;
  family: ChainFamily;
  address?: string;
  address_type?: string;
  implementation_address?: string;
  decimals?: number;
  issuer?: string;
  currency?: string;
}

export interface PreparedPlanIntent {
  [key: string]: unknown;
}

export interface PreparedPlanData<
  TParams extends Record<string, string> = Record<string, string>,
  TIntent extends PreparedPlanIntent = PreparedPlanIntent,
> {
  plan_id: string;
  plan_path: string;
  action: PrepareAction;
  requires_confirmation: boolean;
  human_summary: string;
  asset: ResolvedAsset;
  params: TParams;
  intent: TIntent;
}

export interface LoadedPreparedPlan<
  TParams extends Record<string, string> = Record<string, string>,
  TIntent extends PreparedPlanIntent = PreparedPlanIntent,
> {
  ok: true;
  command: string;
  chain: string;
  timestamp: string;
  data: PreparedPlanData<TParams, TIntent>;
  warnings: string[];
  next: Array<{ command: string }>;
}

export type WalletOptionName = "--wallet" | "--from-wallet" | "--owner-wallet";

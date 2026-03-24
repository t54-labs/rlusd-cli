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

export interface AppConfig {
  environment: NetworkEnvironment;
  default_chain: ChainName;
  output_format: OutputFormat;
  chains: Record<string, ChainConfig>;
  rlusd: RlusdConfig;
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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { AppConfig, NetworkEnvironment, ChainName, OutputFormat } from "../types/index.js";
import {
  RLUSD_XRPL_ISSUER,
  RLUSD_XRPL_CURRENCY_HEX,
  RLUSD_ETH_CONTRACT,
  RLUSD_ETH_DECIMALS,
  CHAINLINK_RLUSD_USD_ORACLE,
  CONFIG_DIR,
  CONFIG_FILE,
  WALLETS_DIR,
  DEFAULT_PRICE_API,
  DEFAULT_CONTRACTS,
  DEFAULT_FAUCET,
} from "./constants.js";
import { getNetworkPreset, isValidNetwork } from "./networks.js";

const RUNTIME_NETWORK_ENV = "RLUSD_RUNTIME_NETWORK";
const RUNTIME_OUTPUT_ENV = "RLUSD_RUNTIME_OUTPUT";
const RUNTIME_CHAIN_ENV = "RLUSD_RUNTIME_CHAIN";

export function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

export function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILE);
}

export function getWalletsDir(): string {
  return join(getConfigDir(), WALLETS_DIR);
}

function createDefaultConfig(env: NetworkEnvironment = "testnet"): AppConfig {
  const preset = getNetworkPreset(env);
  return {
    environment: env,
    default_chain: "xrpl",
    output_format: "table",
    chains: preset.chains,
    rlusd: {
      xrpl_issuer: RLUSD_XRPL_ISSUER,
      xrpl_currency: RLUSD_XRPL_CURRENCY_HEX,
      eth_contract: RLUSD_ETH_CONTRACT,
      eth_decimals: RLUSD_ETH_DECIMALS,
      chainlink_oracle: CHAINLINK_RLUSD_USD_ORACLE,
    },
    price_api: { ...DEFAULT_PRICE_API },
    contracts: structuredClone(DEFAULT_CONTRACTS),
    faucet: { ...DEFAULT_FAUCET },
  };
}

export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  const walletsDir = getWalletsDir();
  if (!existsSync(walletsDir)) {
    mkdirSync(walletsDir, { recursive: true, mode: 0o700 });
  }
}

function applyRuntimeOverrides(config: AppConfig): AppConfig {
  const runtimeNetwork = process.env[RUNTIME_NETWORK_ENV];
  const runtimeOutput = process.env[RUNTIME_OUTPUT_ENV];
  const runtimeChain = process.env[RUNTIME_CHAIN_ENV];

  if (runtimeNetwork && isValidNetwork(runtimeNetwork)) {
    const preset = getNetworkPreset(runtimeNetwork);
    config = {
      ...config,
      environment: runtimeNetwork,
      chains: { ...config.chains, ...preset.chains },
    };
  }

  if (
    runtimeOutput &&
    (runtimeOutput === "table" ||
      runtimeOutput === "json" ||
      runtimeOutput === "json-compact")
  ) {
    config = { ...config, output_format: runtimeOutput };
  }

  if (
    runtimeChain &&
    (runtimeChain === "xrpl" ||
      runtimeChain === "ethereum" ||
      runtimeChain === "base" ||
      runtimeChain === "optimism" ||
      runtimeChain === "ink" ||
      runtimeChain === "unichain")
  ) {
    config = { ...config, default_chain: runtimeChain };
  }

  return config;
}

export function loadConfig(): AppConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    const defaultConfig = createDefaultConfig();
    saveConfig(defaultConfig);
    return applyRuntimeOverrides(defaultConfig);
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = yamlParse(raw) as Partial<AppConfig>;

  const environment = isValidNetwork(String(parsed.environment))
    ? (parsed.environment as NetworkEnvironment)
    : "testnet";
  const defaultConfig = createDefaultConfig(environment);

  const mergedContracts = { ...defaultConfig.contracts };
  if (parsed.contracts) {
    for (const [chain, overrides] of Object.entries(parsed.contracts)) {
      mergedContracts[chain] = { ...mergedContracts[chain], ...overrides };
    }
  }

  return applyRuntimeOverrides({
    ...defaultConfig,
    ...parsed,
    environment,
    chains: { ...defaultConfig.chains, ...parsed.chains },
    rlusd: { ...defaultConfig.rlusd, ...parsed.rlusd },
    price_api: defaultConfig.price_api
      ? { ...defaultConfig.price_api, ...(parsed.price_api ?? {}) }
      : parsed.price_api,
    contracts: mergedContracts,
    faucet: defaultConfig.faucet
      ? { ...defaultConfig.faucet, ...(parsed.faucet ?? {}) }
      : parsed.faucet,
  });
}

export function saveConfig(config: AppConfig): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  const yamlContent = yamlStringify(config);
  writeFileSync(configPath, yamlContent, { encoding: "utf-8", mode: 0o600 });
}

export function setNetwork(env: NetworkEnvironment): AppConfig {
  const config = loadConfig();
  const preset = getNetworkPreset(env);
  config.environment = env;
  config.chains = { ...config.chains, ...preset.chains };
  saveConfig(config);
  return config;
}

export function setChainRpc(chain: ChainName, rpc: string): AppConfig {
  const config = loadConfig();
  if (!config.chains[chain]) {
    config.chains[chain] = {};
  }
  if (chain === "xrpl") {
    config.chains[chain].websocket = rpc;
  } else {
    config.chains[chain].rpc = rpc;
  }
  saveConfig(config);
  return config;
}

export function setDefaultChain(chain: ChainName): AppConfig {
  const config = loadConfig();
  config.default_chain = chain;
  saveConfig(config);
  return config;
}

export function setOutputFormat(format: OutputFormat): AppConfig {
  const config = loadConfig();
  config.output_format = format;
  saveConfig(config);
  return config;
}

export function setPriceApi(updates: { provider?: string; base_url?: string; api_key?: string }): AppConfig {
  const config = loadConfig();
  config.price_api = { ...config.price_api!, ...updates };
  saveConfig(config);
  return config;
}

export function setContract(chain: ChainName, field: string, address: string): AppConfig {
  const config = loadConfig();
  if (!config.contracts) config.contracts = {};
  if (!config.contracts[chain]) config.contracts[chain] = {};
  (config.contracts[chain] as Record<string, string>)[field] = address;
  saveConfig(config);
  return config;
}

export function setFaucetUrl(env: "testnet" | "devnet", url: string): AppConfig {
  const config = loadConfig();
  if (!config.faucet) config.faucet = { xrpl_testnet: "", xrpl_devnet: "" };
  if (env === "testnet") config.faucet.xrpl_testnet = url;
  else config.faucet.xrpl_devnet = url;
  saveConfig(config);
  return config;
}

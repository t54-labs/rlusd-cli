import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { AppConfig, NetworkEnvironment, ChainName, OutputFormat } from "../types/index.js";
import {
  RLUSD_XRPL_ISSUER,
  RLUSD_XRPL_CURRENCY,
  RLUSD_ETH_CONTRACT,
  RLUSD_ETH_DECIMALS,
  CHAINLINK_RLUSD_USD_ORACLE,
  CONFIG_DIR,
  CONFIG_FILE,
  WALLETS_DIR,
} from "./constants.js";
import { getNetworkPreset } from "./networks.js";

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
      xrpl_currency: RLUSD_XRPL_CURRENCY,
      eth_contract: RLUSD_ETH_CONTRACT,
      eth_decimals: RLUSD_ETH_DECIMALS,
      chainlink_oracle: CHAINLINK_RLUSD_USD_ORACLE,
    },
  };
}

export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  const walletsDir = getWalletsDir();
  if (!existsSync(walletsDir)) {
    mkdirSync(walletsDir, { recursive: true });
  }
}

export function loadConfig(): AppConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    const defaultConfig = createDefaultConfig();
    saveConfig(defaultConfig);
    return defaultConfig;
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = yamlParse(raw) as Partial<AppConfig>;

  const defaultConfig = createDefaultConfig(
    (parsed.environment as NetworkEnvironment) || "testnet",
  );

  return {
    ...defaultConfig,
    ...parsed,
    chains: { ...defaultConfig.chains, ...parsed.chains },
    rlusd: { ...defaultConfig.rlusd, ...parsed.rlusd },
  };
}

export function saveConfig(config: AppConfig): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  const yamlContent = yamlStringify(config);
  writeFileSync(configPath, yamlContent, "utf-8");
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

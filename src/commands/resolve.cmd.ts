import { Command } from "commander";

import { loadConfig } from "../config/config.js";
import { formatOutput } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { ChainName, OutputFormat } from "../types/index.js";

type ResolvedAssetRecord = {
  symbol: string;
  name: string;
  chain: string;
  family: "xrpl" | "evm";
  address?: string;
  decimals?: number;
  issuer?: string;
  currency?: string;
  address_type?: string;
};

const VALID_CHAINS: ChainName[] = ["xrpl", "ethereum", "base", "optimism", "ink", "unichain"];

function normalizeChainLabel(raw: string, environment: string): string | null {
  const base = raw.includes("-") ? raw.split("-")[0] : raw;
  if (!VALID_CHAINS.includes(base as ChainName)) return null;

  if (raw.includes("-")) return raw;
  if (raw === "xrpl") {
    return `xrpl-${environment}`;
  }
  return `${raw}-${environment === "mainnet" ? "mainnet" : "sepolia"}`;
}

function resolveRlusdAsset(chainLabel: string, config: ReturnType<typeof loadConfig>): ResolvedAssetRecord {
  if (chainLabel.startsWith("xrpl-")) {
    return {
      symbol: "RLUSD",
      name: "Ripple USD",
      chain: chainLabel,
      family: "xrpl",
      issuer: config.rlusd.xrpl_issuer,
      currency: config.rlusd.xrpl_currency,
    };
  }

  return {
    symbol: "RLUSD",
    name: "Ripple USD",
    chain: chainLabel,
    family: "evm",
    address: config.rlusd.eth_contract,
    address_type: "proxy",
    decimals: config.rlusd.eth_decimals,
  };
}

export function registerResolveCommand(program: Command): void {
  const resolveCmd = program.command("resolve").description("Resolve stable RLUSD metadata");

  resolveCmd
    .command("asset")
    .description("Resolve RLUSD asset metadata for a chain")
    .option("--chain <chain>", "target chain label, e.g. xrpl-mainnet or ethereum-mainnet")
    .option("--symbol <symbol>", "asset symbol", "RLUSD")
    .action((opts: { chain: string; symbol?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      const symbol = (opts.symbol || "RLUSD").toUpperCase();

      if (symbol !== "RLUSD") {
        logger.error(`Unsupported symbol: ${symbol}. This command currently resolves RLUSD only.`);
        process.exitCode = 1;
        return;
      }

      const chainInput = opts.chain || (program.opts().chain as string | undefined);
      if (!chainInput) {
        logger.error("The --chain option is required.");
        process.exitCode = 1;
        return;
      }
      const chainLabel = normalizeChainLabel(chainInput, config.environment);
      if (!chainLabel) {
        logger.error(`Invalid chain: ${chainInput}. Valid: ${VALID_CHAINS.join(", ")}`);
        process.exitCode = 1;
        return;
      }
      const data = resolveRlusdAsset(chainLabel, config);

      logger.raw(formatOutput(data as unknown as Record<string, unknown>, outputFormat));
    });
}

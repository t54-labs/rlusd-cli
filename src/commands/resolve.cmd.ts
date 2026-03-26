import { Command } from "commander";

import { createErrorEnvelope } from "../agent/envelope.js";
import { loadConfig } from "../config/config.js";
import { formatOutput } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { ChainName, EvmChainName, OutputFormat } from "../types/index.js";
import { assertActiveRlusdEvmChain } from "../utils/evm-support.js";

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

  assertActiveRlusdEvmChain(chainLabel.split("-")[0] as EvmChainName);

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

function emitResolveError(input: {
  outputFormat: OutputFormat;
  command: string;
  chain?: string;
  code: string;
  message: string;
}): void {
  if (input.outputFormat === "json" || input.outputFormat === "json-compact") {
    console.error(
      JSON.stringify(
        createErrorEnvelope({
          command: input.command,
          chain: input.chain,
          timestamp: new Date().toISOString(),
          code: input.code,
          message: input.message,
        }),
        null,
        2,
      ),
    );
    return;
  }

  logger.error(input.message);
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
        emitResolveError({
          outputFormat,
          command: "resolve asset",
          code: "INVALID_ARGUMENT",
          message: `Unsupported symbol: ${symbol}. This command currently resolves RLUSD only.`,
        });
        process.exitCode = 1;
        return;
      }

      const chainInput = opts.chain || (program.opts().chain as string | undefined);
      if (!chainInput) {
        emitResolveError({
          outputFormat,
          command: "resolve asset",
          code: "MISSING_REQUIRED_ARGUMENT",
          message: "The --chain option is required.",
        });
        process.exitCode = 1;
        return;
      }
      const chainLabel = normalizeChainLabel(chainInput, config.environment);
      if (!chainLabel) {
        emitResolveError({
          outputFormat,
          command: "resolve asset",
          chain: chainInput,
          code: "INVALID_ARGUMENT",
          message: `Invalid chain: ${chainInput}. Valid: ${VALID_CHAINS.join(", ")}`,
        });
        process.exitCode = 1;
        return;
      }
      try {
        const data = resolveRlusdAsset(chainLabel, config);

        logger.raw(formatOutput(data as unknown as Record<string, unknown>, outputFormat));
      } catch (error) {
        emitResolveError({
          outputFormat,
          command: "resolve asset",
          chain: chainLabel,
          code: "UNSUPPORTED_CHAIN",
          message: error instanceof Error ? error.message : "Unable to resolve asset metadata.",
        });
        process.exitCode = 1;
      }
    });
}

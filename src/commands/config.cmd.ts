import { Command } from "commander";
import { loadConfig, setNetwork, setChainRpc, setDefaultChain, setOutputFormat } from "../config/config.js";
import { isValidNetwork } from "../config/networks.js";
import { formatOutput } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { ChainName, OutputFormat } from "../types/index.js";

const VALID_CHAINS: ChainName[] = ["xrpl", "ethereum", "base", "optimism", "ink", "unichain"];
const VALID_FORMATS: OutputFormat[] = ["table", "json", "json-compact"];

export function registerConfigCommand(program: Command): void {
  const configCmd = program.command("config").description("Configuration management");

  configCmd
    .command("get")
    .description("Display current configuration")
    .action(() => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      if (outputFormat === "json" || outputFormat === "json-compact") {
        logger.raw(formatOutput(config as unknown as Record<string, unknown>, outputFormat));
        return;
      }

      logger.label("Environment", config.environment);
      logger.label("Default Chain", config.default_chain);
      logger.label("Output Format", config.output_format);
      logger.raw("");
      logger.label("RLUSD XRPL Issuer", config.rlusd.xrpl_issuer);
      logger.label("RLUSD ETH Contract", config.rlusd.eth_contract);
      logger.raw("");

      for (const [chain, chainConfig] of Object.entries(config.chains)) {
        const endpoint = chainConfig.websocket || chainConfig.rpc || "not configured";
        logger.label(`Chain: ${chain}`, endpoint);
      }
    });

  configCmd
    .command("set")
    .description("Update configuration settings")
    .option("-n, --network <network>", "switch network: mainnet | testnet | devnet")
    .option("-c, --chain <chain>", "target chain for --rpc")
    .option("--rpc <url>", "set RPC/WebSocket URL for a chain (requires --chain)")
    .option("--default-chain <chain>", "set default chain")
    .option("--format <format>", "set output format: table | json | json-compact")
    .action((opts) => {
      let changed = false;

      const networkVal = opts.network || program.opts().network;
      if (networkVal) {
        if (!isValidNetwork(networkVal)) {
          logger.error(`Invalid network: ${networkVal}. Valid: mainnet, testnet, devnet`);
          process.exitCode = 1;
          return;
        }
        setNetwork(networkVal);
        logger.success(`Network switched to ${networkVal}`);
        changed = true;
      }

      if (opts.rpc) {
        const chain = (opts.chain as ChainName | undefined) || (program.opts().chain as ChainName | undefined);
        if (!chain) {
          logger.error("--chain is required when setting --rpc");
          process.exitCode = 1;
          return;
        }
        if (!VALID_CHAINS.includes(chain)) {
          logger.error(`Invalid chain: ${chain}. Valid: ${VALID_CHAINS.join(", ")}`);
          process.exitCode = 1;
          return;
        }
        setChainRpc(chain, opts.rpc);
        logger.success(`RPC for ${chain} set to ${opts.rpc}`);
        changed = true;
      }

      if (opts.defaultChain) {
        if (!VALID_CHAINS.includes(opts.defaultChain)) {
          logger.error(`Invalid chain: ${opts.defaultChain}. Valid: ${VALID_CHAINS.join(", ")}`);
          process.exitCode = 1;
          return;
        }
        setDefaultChain(opts.defaultChain);
        logger.success(`Default chain set to ${opts.defaultChain}`);
        changed = true;
      }

      if (opts.format) {
        if (!VALID_FORMATS.includes(opts.format)) {
          logger.error(`Invalid format: ${opts.format}. Valid: ${VALID_FORMATS.join(", ")}`);
          process.exitCode = 1;
          return;
        }
        setOutputFormat(opts.format);
        logger.success(`Output format set to ${opts.format}`);
        changed = true;
      }

      if (!changed) {
        logger.warn("No settings changed. Use --help to see options.");
      }
    });
}

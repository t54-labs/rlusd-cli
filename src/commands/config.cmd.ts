import { Command } from "commander";
import { loadConfig, setNetwork, setChainRpc, setDefaultChain, setOutputFormat, setPriceApi, setContract, setFaucetUrl } from "../config/config.js";
import { isValidNetwork } from "../config/networks.js";
import { formatOutput } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { ChainName, OutputFormat } from "../types/index.js";

const VALID_CHAINS: ChainName[] = ["xrpl", "ethereum", "base", "optimism", "ink", "unichain"];
const VALID_FORMATS: OutputFormat[] = ["table", "json", "json-compact"];
const VALID_PRICE_PROVIDERS = ["coingecko"] as const;

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

      if (config.price_api) {
        logger.raw("");
        logger.label("Price API Provider", config.price_api.provider);
        logger.label("Price API URL", config.price_api.base_url);
        if (config.price_api.api_key) {
          logger.label("Price API Key", "***configured***");
        }
      }

      if (config.contracts) {
        for (const [chain, contracts] of Object.entries(config.contracts)) {
          const entries = Object.entries(contracts).filter(([, v]) => v);
          if (entries.length > 0) {
            logger.raw("");
            for (const [key, value] of entries) {
              logger.label(`${chain} ${key}`, value as string);
            }
          }
        }
      }

      if (config.faucet) {
        logger.raw("");
        if (config.faucet.xrpl_testnet) {
          logger.label("Faucet (testnet)", config.faucet.xrpl_testnet);
        }
        if (config.faucet.xrpl_devnet) {
          logger.label("Faucet (devnet)", config.faucet.xrpl_devnet);
        }
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
    .option(
      "--price-provider <provider>",
      `price API provider: ${VALID_PRICE_PROVIDERS.join(", ")}`,
    )
    .option("--price-url <url>", "price API base URL (e.g. https://pro-api.coingecko.com/api/v3)")
    .option("--price-api-key <key>", "price API key (for paid tiers)")
    .option("--uniswap-router <address>", "Uniswap V3 SwapRouter address (requires --chain)")
    .option("--uniswap-quoter <address>", "Uniswap V3 QuoterV2 address (requires --chain)")
    .option("--aave-pool <address>", "Aave V3 Pool address (requires --chain)")
    .option("--faucet-url <url>", "XRPL faucet URL (requires --network testnet|devnet)")
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

      if (opts.priceProvider || opts.priceUrl || opts.priceApiKey) {
        if (
          opts.priceProvider &&
          !VALID_PRICE_PROVIDERS.includes(
            opts.priceProvider as (typeof VALID_PRICE_PROVIDERS)[number],
          )
        ) {
          logger.error(
            `Invalid price provider: ${opts.priceProvider}. Supported: ${VALID_PRICE_PROVIDERS.join(", ")}`,
          );
          process.exitCode = 1;
          return;
        }
        const updates: Record<string, string> = {};
        if (opts.priceProvider) updates.provider = opts.priceProvider;
        if (opts.priceUrl) updates.base_url = opts.priceUrl;
        if (opts.priceApiKey) updates.api_key = opts.priceApiKey;
        setPriceApi(updates);
        logger.success("Price API settings updated");
        changed = true;
      }

      const contractChain = (opts.chain as ChainName | undefined) || (program.opts().chain as ChainName | undefined);
      if (opts.uniswapRouter) {
        if (!contractChain) { logger.error("--chain is required when setting --uniswap-router"); process.exitCode = 1; return; }
        setContract(contractChain, "uniswap_router", opts.uniswapRouter);
        logger.success(`Uniswap Router for ${contractChain} set to ${opts.uniswapRouter}`);
        changed = true;
      }
      if (opts.uniswapQuoter) {
        if (!contractChain) { logger.error("--chain is required when setting --uniswap-quoter"); process.exitCode = 1; return; }
        setContract(contractChain, "uniswap_quoter", opts.uniswapQuoter);
        logger.success(`Uniswap Quoter for ${contractChain} set to ${opts.uniswapQuoter}`);
        changed = true;
      }
      if (opts.aavePool) {
        if (!contractChain) { logger.error("--chain is required when setting --aave-pool"); process.exitCode = 1; return; }
        setContract(contractChain, "aave_v3_pool", opts.aavePool);
        logger.success(`Aave V3 Pool for ${contractChain} set to ${opts.aavePool}`);
        changed = true;
      }

      if (opts.faucetUrl) {
        const net = opts.network || program.opts().network;
        if (!net || (net !== "testnet" && net !== "devnet")) {
          logger.error("--network testnet or --network devnet is required when setting --faucet-url");
          process.exitCode = 1;
          return;
        }
        setFaucetUrl(net, opts.faucetUrl);
        logger.success(`XRPL ${net} faucet URL set to ${opts.faucetUrl}`);
        changed = true;
      }

      if (!changed) {
        logger.warn("No settings changed. Use --help to see options.");
      }
    });
}

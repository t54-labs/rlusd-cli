import { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { getDefaultWallet } from "../wallet/manager.js";
import { getXrplBalance, disconnectXrplClient } from "../clients/xrpl-client.js";
import { getEvmRlusdBalance } from "../clients/evm-client.js";
import { formatOutput, formatRlusdAmount } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { ChainName, OutputFormat, EvmChainName, BalanceResult } from "../types/index.js";

const EVM_CHAINS: EvmChainName[] = ["ethereum", "base", "optimism"];

export function registerBalanceCommand(program: Command): void {
  program
    .command("balance")
    .description("Query RLUSD balance on one or all chains")
    .option("-c, --chain <chain>", "specific chain to query")
    .option("-a, --all", "show balances across all configured chains")
    .option("--address <address>", "query a specific address (overrides default wallet)")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      const showAll = opts.all || false;
      const chain = (opts.chain || program.opts().chain || config.default_chain) as ChainName;

      try {
        if (showAll) {
          await queryAllChains(outputFormat, opts.address);
        } else {
          await querySingleChain(chain, outputFormat, opts.address);
        }
      } catch (err) {
        logger.error(`Balance query failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  program
    .command("gas-balance")
    .description("Show native token balances for gas across chains")
    .action(async () => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      const results: Array<Record<string, string>> = [];

      try {
        const xrplWallet = getDefaultWallet("xrpl");
        if (xrplWallet) {
          const { xrp } = await getXrplBalance(xrplWallet.address);
          results.push({ chain: "xrpl", address: xrplWallet.address, balance: xrp, symbol: "XRP" });
        }

        for (const evmChain of EVM_CHAINS) {
          const evmWallet = getDefaultWallet(evmChain);
          if (evmWallet) {
            try {
              const { native, nativeSymbol } = await getEvmRlusdBalance(evmChain, evmWallet.address);
              results.push({ chain: evmChain, address: evmWallet.address, balance: native, symbol: nativeSymbol });
            } catch {
              results.push({ chain: evmChain, address: evmWallet.address, balance: "error", symbol: "ETH" });
            }
          }
        }

        if (results.length === 0) {
          logger.info("No wallets configured. Use 'rlusd wallet generate' first.");
          return;
        }

        logger.raw(formatOutput(results, outputFormat, ["chain", "address", "balance", "symbol"]));
      } catch (err) {
        logger.error(`Gas balance query failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

async function querySingleChain(chain: ChainName, outputFormat: OutputFormat, addressOverride?: string): Promise<void> {
  const address = addressOverride || getDefaultWallet(chain)?.address;
  if (!address) {
    logger.error(`No wallet for ${chain}. Use 'rlusd wallet generate --chain ${chain}'`);
    process.exitCode = 1;
    return;
  }

  if (chain === "xrpl") {
    const { xrp, rlusd } = await getXrplBalance(address);
    const result: BalanceResult = {
      chain: "xrpl",
      address,
      rlusd_balance: rlusd,
      native_balance: xrp,
      native_symbol: "XRP",
    };
    if (outputFormat === "json" || outputFormat === "json-compact") {
      logger.raw(formatOutput(result as unknown as Record<string, unknown>, outputFormat));
    } else {
      logger.label("Chain", "XRPL");
      logger.label("Address", address);
      logger.label("RLUSD", formatRlusdAmount(rlusd));
      logger.label("XRP", xrp);
    }
  } else {
    const { rlusd, native, nativeSymbol } = await getEvmRlusdBalance(chain as EvmChainName, address);
    const result: BalanceResult = {
      chain,
      address,
      rlusd_balance: rlusd,
      native_balance: native,
      native_symbol: nativeSymbol,
    };
    if (outputFormat === "json" || outputFormat === "json-compact") {
      logger.raw(formatOutput(result as unknown as Record<string, unknown>, outputFormat));
    } else {
      logger.label("Chain", chain);
      logger.label("Address", address);
      logger.label("RLUSD", formatRlusdAmount(rlusd));
      logger.label(nativeSymbol, native);
    }
  }
}

async function queryAllChains(outputFormat: OutputFormat, addressOverride?: string): Promise<void> {
  const results: BalanceResult[] = [];
  let totalRlusd = 0;

  const xrplAddress = addressOverride || getDefaultWallet("xrpl")?.address;
  if (xrplAddress) {
    try {
      const { xrp, rlusd } = await getXrplBalance(xrplAddress);
      results.push({
        chain: "xrpl",
        address: xrplAddress,
        rlusd_balance: rlusd,
        native_balance: xrp,
        native_symbol: "XRP",
      });
      totalRlusd += parseFloat(rlusd) || 0;
    } catch {
      results.push({
        chain: "xrpl",
        address: xrplAddress,
        rlusd_balance: "error",
        native_balance: "error",
        native_symbol: "XRP",
      });
    }
  }

  for (const evmChain of EVM_CHAINS) {
    const evmAddress = addressOverride || getDefaultWallet(evmChain)?.address;
    if (evmAddress) {
      try {
        const { rlusd, native, nativeSymbol } = await getEvmRlusdBalance(evmChain, evmAddress);
        results.push({
          chain: evmChain,
          address: evmAddress,
          rlusd_balance: rlusd,
          native_balance: native,
          native_symbol: nativeSymbol,
        });
        totalRlusd += parseFloat(rlusd) || 0;
      } catch {
        results.push({
          chain: evmChain,
          address: evmAddress,
          rlusd_balance: "error",
          native_balance: "error",
          native_symbol: "ETH",
        });
      }
    }
  }

  if (results.length === 0) {
    logger.info("No wallets configured. Use 'rlusd wallet generate' first.");
    return;
  }

  const rows = results.map((r) => ({
    chain: r.chain,
    address: r.address,
    rlusd: r.rlusd_balance,
    native: `${r.native_balance} ${r.native_symbol}`,
  }));

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput({ balances: results, total_rlusd: totalRlusd.toFixed(2) } as unknown as Record<string, unknown>, outputFormat));
  } else {
    logger.raw(formatOutput(rows, outputFormat, ["chain", "address", "rlusd", "native"]));
    logger.raw("");
    logger.label("Total RLUSD", formatRlusdAmount(totalRlusd.toString()));
  }
}

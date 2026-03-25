import { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { getDefaultWallet } from "../wallet/manager.js";
import { logger } from "../utils/logger.js";
import { formatOutput } from "../utils/format.js";
import { XRPL_TESTNET_FAUCET, XRPL_DEVNET_FAUCET } from "../config/constants.js";
import type { ChainName, OutputFormat } from "../types/index.js";

export function registerFaucetCommand(program: Command): void {
  program
    .command("faucet")
    .description("Request test funds from network faucets")
    .command("fund")
    .description("Request test tokens from the faucet")
    .option("-c, --chain <chain>", "chain to fund: xrpl | ethereum", "xrpl")
    .option("--address <address>", "address to fund (defaults to current wallet)")
    .action(async (opts) => {
      const config = loadConfig();
      const chain = (opts.chain || program.opts().chain || "xrpl") as ChainName;
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      if (config.environment === "mainnet") {
        logger.error("Faucet is only available on testnet and devnet");
        process.exitCode = 1;
        return;
      }

      try {
        if (chain === "xrpl") {
          await fundXrpl(opts.address, config.environment, outputFormat);
        } else {
          fundEvm(chain, opts.address);
        }
      } catch (err) {
        logger.error(`Faucet request failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}

async function fundXrpl(
  addressOverride: string | undefined,
  env: string,
  outputFormat: OutputFormat,
): Promise<void> {
  const address = addressOverride || getDefaultWallet("xrpl")?.address;
  const faucetUrl = env === "devnet" ? XRPL_DEVNET_FAUCET : XRPL_TESTNET_FAUCET;

  logger.info(`Requesting test XRP from ${env} faucet...`);

  const body: Record<string, string> = {};
  if (address) {
    body.destination = address;
  }

  const response = await fetch(faucetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Faucet returned ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    account?: { address?: string; secret?: string };
    balance?: number;
    amount?: number;
  };

  const fundedAddress = data.account?.address || address || "unknown";
  const amount = data.amount || data.balance || 0;
  if (fundedAddress === "unknown" || amount <= 0) {
    throw new Error(
      "Faucet returned an unexpected response payload. No funded address or amount was found.",
    );
  }

  const result = {
    chain: "xrpl",
    address: fundedAddress,
    amount: `${amount} XRP`,
    network: env,
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(result, outputFormat));
  } else {
    logger.success(`Funded ${fundedAddress} with ${amount} XRP`);
    logger.dim("Note: You may still need to set up a RLUSD trust line with 'rlusd xrpl trustline setup'");
  }
}

function fundEvm(chain: ChainName, addressOverride: string | undefined): void {
  const address = addressOverride || getDefaultWallet(chain)?.address;

  if (!address) {
    logger.error(`No wallet for ${chain}. Run: rlusd wallet generate --chain ${chain}`);
    process.exitCode = 1;
    return;
  }

  logger.info(`To fund your ${chain} wallet with test ETH, visit one of these faucets:`);
  logger.raw("");
  logger.label("Your Address", address);
  logger.raw("");
  logger.raw("  Sepolia Faucets:");
  logger.raw("    https://faucet.sepolia.dev/");
  logger.raw("    https://sepoliafaucet.com/");
  logger.raw("    https://www.alchemy.com/faucets/ethereum-sepolia");
  logger.raw("");
  logger.dim("Copy your address and paste it into one of the faucet websites above.");
}

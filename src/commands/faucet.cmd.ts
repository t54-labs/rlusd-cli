import { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { getDefaultWallet } from "../wallet/manager.js";
import {
  disconnectXrplClient,
  getXrplAccountInfo,
  getXrplTrustlineStatus,
} from "../clients/xrpl-client.js";
import { logger } from "../utils/logger.js";
import { formatOutput } from "../utils/format.js";
import { XRPL_TESTNET_FAUCET, XRPL_DEVNET_FAUCET } from "../config/constants.js";
import type { AppConfig } from "../types/index.js";
import type { ChainName, OutputFormat } from "../types/index.js";

type XrplFundingStrategy = "xrp" | "rlusd" | "error";

export function decideXrplFundingStrategy(input: {
  accountExists: boolean;
  xrpBalance: string;
  trustlinePresent: boolean;
  hasMockRlusdFaucet: boolean;
}): XrplFundingStrategy {
  const xrp = Number.parseFloat(input.xrpBalance);
  const hasPositiveXrp = Number.isFinite(xrp) && xrp > 0;

  if (!input.accountExists || !hasPositiveXrp) {
    return "xrp";
  }

  if (!input.hasMockRlusdFaucet || !input.trustlinePresent) {
    return "error";
  }

  return "rlusd";
}

export function registerFaucetCommand(program: Command): void {
  const faucetCmd = program
    .command("faucet")
    .description("Request test funds from network faucets");

  faucetCmd
    .command("fund")
    .description("Request test tokens from the faucet")
    .option("-c, --chain <chain>", "chain to fund: xrpl | ethereum")
    .option("--address <address>", "address to fund (defaults to current wallet)")
    .action(async (opts) => {
      const config = loadConfig();
      const chain = (opts.chain || program.opts().chain || config.default_chain || "xrpl") as ChainName;
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      if (config.environment === "mainnet") {
        logger.error("Faucet is only available on testnet and devnet");
        process.exitCode = 1;
        return;
      }

      try {
        if (chain === "xrpl") {
          await fundXrpl(opts.address, config.environment, outputFormat, config);
        } else {
          fundEvm(chain, opts.address);
        }
      } catch (err) {
        logger.error(`Faucet request failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  faucetCmd
    .command("rlusd")
    .description("Request mock RLUSD from a configured XRPL mock faucet")
    .option("--address <address>", "recipient XRPL address (defaults to current wallet)")
    .option("--amount <amount>", "requested RLUSD amount")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      const address = opts.address || getDefaultWallet("xrpl")?.address;

      if (!address) {
        logger.error("No XRPL wallet configured. Use --address or configure an XRPL wallet first.");
        process.exitCode = 1;
        return;
      }

      if (!config.faucet?.rlusd_mock_url) {
        logger.error("No mock RLUSD faucet URL configured.");
        logger.dim(
          "Set one with: rlusd config set --mock-rlusd-faucet-url http://host:port/fund",
        );
        process.exitCode = 1;
        return;
      }

      try {
        await requestMockRlusd(address, opts.amount, outputFormat, config);
      } catch (err) {
        logger.error(`Mock RLUSD faucet request failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

async function fundXrpl(
  addressOverride: string | undefined,
  env: string,
  outputFormat: OutputFormat,
  config: AppConfig,
): Promise<void> {
  const address = addressOverride || getDefaultWallet("xrpl")?.address;
  if (!address) {
    throw new Error("No XRPL wallet configured. Use --address or configure an XRPL wallet first.");
  }

  const network = env as "testnet" | "devnet";
  const accountInfo = await getXrplAccountInfo(network, address);
  const accountExists = accountInfo.account_exists === true;
  const xrpBalance =
    accountExists && accountInfo.account_data && typeof accountInfo.account_data === "object"
      ? (() => {
          const balance = (accountInfo.account_data as { Balance?: string }).Balance;
          if (!balance) return "0";
          const drops = BigInt(balance);
          const whole = drops / 1_000_000n;
          const fraction = (drops % 1_000_000n)
            .toString()
            .padStart(6, "0")
            .replace(/0+$/, "");
          return fraction ? `${whole}.${fraction}` : whole.toString();
        })()
      : "0";

  const trustlineStatus = accountExists
    ? await getXrplTrustlineStatus(network, address)
    : { present: false, account_exists: false };

  const strategy = decideXrplFundingStrategy({
    accountExists,
    xrpBalance,
    trustlinePresent: Boolean(trustlineStatus.present),
    hasMockRlusdFaucet: Boolean(config.faucet?.rlusd_mock_url),
  });

  if (strategy === "rlusd") {
    logger.info(
      `XRPL account ${address} is already activated with ${xrpBalance} XRP. Requesting mock RLUSD instead...`,
    );
    await requestMockRlusd(address, undefined, outputFormat, config);
    return;
  }

  if (strategy === "error") {
    if (!config.faucet?.rlusd_mock_url) {
      throw new Error(
        "XRPL account already has XRP, but no mock RLUSD faucet is configured. Set one with: rlusd config set --mock-rlusd-faucet-url http://host:port/fund",
      );
    }
    throw new Error(
      "XRPL account already has XRP, but no RLUSD trust line is present. Run: rlusd xrpl trustline setup",
    );
  }

  const faucetUrl =
    env === "devnet"
      ? (config.faucet?.xrpl_devnet || XRPL_DEVNET_FAUCET)
      : (config.faucet?.xrpl_testnet || XRPL_TESTNET_FAUCET);

  logger.info(`Requesting test XRP from XRPL ${env} faucet...`);

  const body: Record<string, string> = {};
  body.destination = address;

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
    logger.dim("Note: This faucet provides XRP only, not RLUSD.");
    logger.dim("To receive RLUSD, first set up a trust line: rlusd xrpl trustline setup");
  }
}

async function requestMockRlusd(
  address: string,
  amount: string | undefined,
  outputFormat: OutputFormat,
  config: AppConfig,
): Promise<void> {
  if (!config.faucet?.rlusd_mock_url) {
    throw new Error("No mock RLUSD faucet URL configured.");
  }

  const response = await fetch(config.faucet.rlusd_mock_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address,
      ...(amount ? { amount } : {}),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mock RLUSD faucet returned ${response.status}: ${text}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data, outputFormat));
  } else {
    logger.success("Mock RLUSD faucet request completed");
    logger.raw(formatOutput(data, "table"));
  }
}

function fundEvm(chain: ChainName, addressOverride: string | undefined): void {
  const address = addressOverride || getDefaultWallet(chain)?.address;

  if (!address) {
    logger.error(`No wallet for ${chain}. Run: rlusd wallet generate --chain ${chain}`);
    process.exitCode = 1;
    return;
  }

  logger.info(`EVM testnet faucets provide native gas tokens (ETH), not RLUSD.`);
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
  logger.dim("Note: RLUSD testnet tokens on Sepolia are not available via public faucets.");
}

import { Command } from "commander";
import { spawn } from "node:child_process";
import { loadConfig } from "../config/config.js";
import { getDefaultWallet } from "../wallet/manager.js";
import {
  disconnectXrplClient,
  getXrplAccountInfo,
} from "../clients/xrpl-client.js";
import { logger } from "../utils/logger.js";
import { formatOutput } from "../utils/format.js";
import {
  XRPL_TESTNET_FAUCET,
  XRPL_DEVNET_FAUCET,
  RLUSD_PUBLIC_TESTNET_FAUCET_URL,
} from "../config/constants.js";
import type { AppConfig } from "../types/index.js";
import type { ChainName, OutputFormat } from "../types/index.js";

type XrplFundingStrategy = "xrp" | "rlusd";

export function decideXrplFundingStrategy(input: {
  accountExists: boolean;
  xrpBalance: string;
}): XrplFundingStrategy {
  const xrp = Number.parseFloat(input.xrpBalance);
  const hasPositiveXrp = Number.isFinite(xrp) && xrp > 0;

  if (!input.accountExists || !hasPositiveXrp) {
    return "xrp";
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

  const strategy = decideXrplFundingStrategy({
    accountExists,
    xrpBalance,
  });

  if (strategy === "rlusd") {
    logger.info(`XRPL account ${address} is already activated with ${xrpBalance} XRP.`);
    emitRlusdFaucetGuidance(address, outputFormat);
    return;
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
    logger.dim("This faucet provides XRP only.");
    logger.dim("After your XRPL account is activated, use the official RLUSD faucet: https://tryrlusd.com/");
  }
}

function emitRlusdFaucetGuidance(
  address: string,
  outputFormat: OutputFormat,
): void {
  const payload = {
    chain: "xrpl",
    address,
    action: "claim_rlusd",
    faucet_url: RLUSD_PUBLIC_TESTNET_FAUCET_URL,
    note: "Your XRPL account already has XRP. Open the official RLUSD faucet and claim testnet RLUSD there.",
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(payload, outputFormat));
  } else {
    logger.success("XRPL account is already funded with XRP");
    logger.label("Address", address);
    logger.label("Official RLUSD Faucet", RLUSD_PUBLIC_TESTNET_FAUCET_URL);
    logger.dim(
      "Use the official faucet above to claim testnet RLUSD for this XRPL account.",
    );
  }

  openInBrowserBestEffort(RLUSD_PUBLIC_TESTNET_FAUCET_URL);
}

function openInBrowserBestEffort(url: string): void {
  try {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "cmd"
          : "xdg-open";
    const args =
      process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // Best effort only: still print the URL even if opening a browser fails.
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

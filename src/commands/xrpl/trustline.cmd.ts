import { Command } from "commander";
import type { TrustSet } from "xrpl";
import { getXrplClient, disconnectXrplClient } from "../../clients/xrpl-client.js";
import { getDefaultWallet } from "../../wallet/manager.js";
import { restoreXrplWallet } from "../../wallet/xrpl-wallet.js";
import { loadConfig } from "../../config/config.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import type { StoredXrplWallet } from "../../types/index.js";
import type { OutputFormat } from "../../types/index.js";

export function registerTrustlineCommand(parent: Command, program: Command): void {
  const trustlineCmd = parent.command("trustline").description("RLUSD trust line management on XRPL");

  trustlineCmd
    .command("setup")
    .description("Set up RLUSD trust line (required before receiving RLUSD on XRPL)")
    .option("--limit <amount>", "maximum RLUSD to hold", "1000000")
    .option("--password <password>", "wallet password")
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const walletData = getDefaultWallet("xrpl") as StoredXrplWallet | null;
        if (!walletData) {
          logger.error("No XRPL wallet configured. Run: rlusd wallet generate --chain xrpl");
          process.exitCode = 1;
          return;
        }

        const password = opts.password || "default-dev-password";
        const wallet = restoreXrplWallet(walletData, password);
        const client = await getXrplClient();

        const trustSetTx: TrustSet = {
          TransactionType: "TrustSet",
          Account: wallet.address,
          LimitAmount: {
            currency: config.rlusd.xrpl_currency,
            issuer: config.rlusd.xrpl_issuer,
            value: opts.limit,
          },
        };

        const prepared = await client.autofill(trustSetTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);

        const meta = result.result.meta;
        const txResult = typeof meta === "object" && meta !== null && "TransactionResult" in meta
          ? (meta as { TransactionResult: string }).TransactionResult
          : "unknown";

        if (txResult === "tesSUCCESS") {
          logger.success(`RLUSD trust line established (limit: ${opts.limit})`);
          logger.label("Account", wallet.address);
          logger.label("Issuer", config.rlusd.xrpl_issuer);
          logger.label("Tx Hash", result.result.hash);
        } else {
          logger.error(`Trust line setup failed: ${txResult}`);
          logger.label("Tx Hash", result.result.hash);
        }
      } catch (err) {
        logger.error(`Trust line setup failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  trustlineCmd
    .command("status")
    .description("Check RLUSD trust line status")
    .option("--address <address>", "XRPL address to check")
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
        const address = opts.address || getDefaultWallet("xrpl")?.address;

        if (!address) {
          logger.error("No XRPL address. Use --address or configure a wallet.");
          process.exitCode = 1;
          return;
        }

        const client = await getXrplClient();
        const lines = await client.request({
          command: "account_lines",
          account: address,
          peer: config.rlusd.xrpl_issuer,
          ledger_index: "validated",
        });

        const rlusdLine = lines.result.lines.find(
          (line) => line.currency === config.rlusd.xrpl_currency,
        );

        if (!rlusdLine) {
          logger.warn("No RLUSD trust line found. Run: rlusd xrpl trustline setup");
          return;
        }

        const data = {
          currency: rlusdLine.currency,
          issuer: rlusdLine.account,
          balance: rlusdLine.balance,
          limit: rlusdLine.limit,
          frozen: rlusdLine.freeze ? "yes" : "no",
        };

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput(data, outputFormat));
        } else {
          logger.success("RLUSD trust line is active");
          logger.label("Balance", rlusdLine.balance);
          logger.label("Limit", rlusdLine.limit);
          logger.label("Frozen", rlusdLine.freeze ? "Yes" : "No");
        }
      } catch (err) {
        logger.error(`Trust line status check failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  trustlineCmd
    .command("remove")
    .description("Remove RLUSD trust line (requires zero balance)")
    .option("--password <password>", "wallet password")
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const walletData = getDefaultWallet("xrpl") as StoredXrplWallet | null;
        if (!walletData) {
          logger.error("No XRPL wallet configured.");
          process.exitCode = 1;
          return;
        }

        const password = opts.password || "default-dev-password";
        const wallet = restoreXrplWallet(walletData, password);
        const client = await getXrplClient();

        const trustSetTx: TrustSet = {
          TransactionType: "TrustSet",
          Account: wallet.address,
          LimitAmount: {
            currency: config.rlusd.xrpl_currency,
            issuer: config.rlusd.xrpl_issuer,
            value: "0",
          },
        };

        const prepared = await client.autofill(trustSetTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);

        const meta = result.result.meta;
        const txResult = typeof meta === "object" && meta !== null && "TransactionResult" in meta
          ? (meta as { TransactionResult: string }).TransactionResult
          : "unknown";

        if (txResult === "tesSUCCESS") {
          logger.success("RLUSD trust line removed");
          logger.label("Tx Hash", result.result.hash);
        } else {
          logger.error(`Trust line removal failed: ${txResult}`);
        }
      } catch (err) {
        logger.error(`Trust line removal failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

import { Command } from "commander";
import { getXrplClient, disconnectXrplClient } from "../../clients/xrpl-client.js";
import { getDefaultWallet } from "../../wallet/manager.js";
import { restoreXrplWallet } from "../../wallet/xrpl-wallet.js";
import { loadConfig } from "../../config/config.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import type { StoredXrplWallet, OutputFormat } from "../../types/index.js";

function getOutputFormat(program: Command, configOutput: OutputFormat): OutputFormat {
  return (program.opts().output as OutputFormat) || configOutput;
}

export function registerPathfindCommand(parent: Command, program: Command): void {
  parent
    .command("pathfind")
    .description("Find payment paths to deliver RLUSD to a destination")
    .requiredOption("--to <address>", "Destination XRPL classic address")
    .requiredOption("--amount <n>", "RLUSD value to deliver")
    .option("--password <password>", "wallet password")
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const outputFormat = getOutputFormat(program, config.output_format);

        const walletData = getDefaultWallet("xrpl") as StoredXrplWallet | null;
        if (!walletData) {
          logger.error("No XRPL wallet configured.");
          process.exitCode = 1;
          return;
        }

        const password = opts.password || "default-dev-password";
        const wallet = restoreXrplWallet(walletData, password);
        const client = await getXrplClient();

        const destinationAmount = {
          currency: config.rlusd.xrpl_currency,
          issuer: config.rlusd.xrpl_issuer,
          value: opts.amount,
        };

        const res = await client.request({
          command: "ripple_path_find",
          source_account: wallet.address,
          destination_account: opts.to,
          destination_amount: destinationAmount,
        });

        const alternatives = res.result.alternatives ?? [];
        const rows: Array<Record<string, unknown>> = alternatives.map((alt, index) => ({
          index,
          source_amount: alt.source_amount,
          path_steps: alt.paths_computed?.length ?? 0,
          paths_computed: alt.paths_computed,
        }));

        const data: Record<string, unknown> = {
          source_account: res.result.source_account,
          destination_account: res.result.destination_account,
          destination_amount: res.result.destination_amount,
          alternatives_count: alternatives.length,
          alternatives: rows,
        };

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput(data, outputFormat));
        } else {
          if (alternatives.length === 0) {
            logger.warn("No paths found for this payment");
            logger.label("From", wallet.address);
            logger.label("To", opts.to);
            return;
          }

          logger.success(`Found ${alternatives.length} path alternative(s)`);
          for (let i = 0; i < alternatives.length; i++) {
            const alt = alternatives[i];
            const src = alt.source_amount;
            const srcStr =
              typeof src === "string"
                ? `${src} drops (XRP)`
                : `${(src as { value?: string }).value ?? JSON.stringify(src)} ${(src as { currency?: string }).currency ?? ""}`;
            logger.label(`Option ${i}`, `source_amount: ${srcStr}`);
          }
          logger.dim("Detailed paths:");
          logger.raw(formatOutput(rows, outputFormat));
        }
      } catch (err) {
        logger.error(`Path find failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

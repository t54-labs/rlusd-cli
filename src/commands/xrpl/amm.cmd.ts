import { Command } from "commander";
import type { AMMDeposit, AMMWithdraw, AMMVote } from "xrpl";
import { AMMDepositFlags, AMMWithdrawFlags, xrpToDrops } from "xrpl";
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

function readTxResult(meta: unknown): string {
  return typeof meta === "object" && meta !== null && "TransactionResult" in meta
    ? (meta as { TransactionResult: string }).TransactionResult
    : "unknown";
}

function poolAssets(config: ReturnType<typeof loadConfig>) {
  return {
    assetXrp: { currency: "XRP" } as const,
    assetRlusd: {
      currency: config.rlusd.xrpl_currency,
      issuer: config.rlusd.xrpl_issuer,
    },
  };
}

export function registerAmmCommand(parent: Command, program: Command): void {
  const ammCmd = parent.command("amm").description("XRPL AMM operations for XRP / RLUSD pool");

  ammCmd
    .command("info")
    .description("Show AMM pool state (TVL, trading fee, LP token)")
    .action(async () => {
      try {
        const config = loadConfig();
        const outputFormat = getOutputFormat(program, config.output_format);
        const client = await getXrplClient();
        const { assetXrp, assetRlusd } = poolAssets(config);

        const res = await client.request({
          command: "amm_info",
          asset: assetXrp,
          asset2: assetRlusd,
          ledger_index: "validated",
        });

        const amm = res.result.amm;
        const data: Record<string, unknown> = {
          amm_account: amm.account,
          pool_xrp_or_first: amm.amount,
          pool_rlusd_or_second: amm.amount2,
          lp_token: amm.lp_token,
          trading_fee: amm.trading_fee,
          trading_fee_percent: `${(amm.trading_fee / 1000).toFixed(3)}%`,
          vote_slots: amm.vote_slots ?? [],
          validated: res.result.validated,
        };

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput(data, outputFormat));
        } else {
          logger.success("AMM pool");
          logger.label("AMM account", amm.account);
          logger.label("Reserve 1", typeof amm.amount === "string" ? amm.amount : JSON.stringify(amm.amount));
          logger.label("Reserve 2", typeof amm.amount2 === "string" ? amm.amount2 : JSON.stringify(amm.amount2));
          logger.label("LP token outstanding", `${amm.lp_token.value} (${amm.lp_token.currency})`);
          logger.label("Trading fee (1/100000 units)", String(amm.trading_fee));
          logger.label("Trading fee (approx %)", `${(amm.trading_fee / 1000).toFixed(3)}%`);
        }
      } catch (err) {
        logger.error(`AMM info failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  ammCmd
    .command("deposit")
    .description("Deposit XRP and RLUSD liquidity (two-asset)")
    .requiredOption("--xrp <n>", "XRP amount to deposit")
    .requiredOption("--rlusd <n>", "RLUSD amount to deposit")
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
        const { assetXrp, assetRlusd } = poolAssets(config);

        const tx: AMMDeposit = {
          TransactionType: "AMMDeposit",
          Account: wallet.address,
          Asset: assetXrp,
          Asset2: assetRlusd,
          Amount: xrpToDrops(opts.xrp),
          Amount2: {
            currency: config.rlusd.xrpl_currency,
            issuer: config.rlusd.xrpl_issuer,
            value: opts.rlusd,
          },
          Flags: AMMDepositFlags.tfTwoAsset,
        };

        const prepared = await client.autofill(tx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        const txResult = readTxResult(result.result.meta);

        if (txResult === "tesSUCCESS") {
          logger.success("AMM deposit submitted");
          logger.label("Tx Hash", result.result.hash);
        } else {
          logger.error(`AMMDeposit failed: ${txResult}`);
          logger.label("Tx Hash", result.result.hash);
        }
      } catch (err) {
        logger.error(`AMM deposit failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  ammCmd
    .command("withdraw")
    .description("Withdraw liquidity by redeeming LP tokens")
    .requiredOption("--lp-tokens <n>", "LP token amount to redeem")
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
        const { assetXrp, assetRlusd } = poolAssets(config);

        const info = await client.request({
          command: "amm_info",
          asset: assetXrp,
          asset2: assetRlusd,
          ledger_index: "validated",
        });
        const lp = info.result.amm.lp_token;

        const tx: AMMWithdraw = {
          TransactionType: "AMMWithdraw",
          Account: wallet.address,
          Asset: assetXrp,
          Asset2: assetRlusd,
          LPTokenIn: {
            currency: lp.currency,
            issuer: lp.issuer,
            value: opts.lpTokens,
          },
          Flags: AMMWithdrawFlags.tfLPToken,
        };

        const prepared = await client.autofill(tx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        const txResult = readTxResult(result.result.meta);

        if (txResult === "tesSUCCESS") {
          logger.success("AMM withdraw submitted");
          logger.label("Tx Hash", result.result.hash);
        } else {
          logger.error(`AMMWithdraw failed: ${txResult}`);
          logger.label("Tx Hash", result.result.hash);
        }
      } catch (err) {
        logger.error(`AMM withdraw failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  ammCmd
    .command("vote")
    .description("Vote on AMM trading fee (fee in 1/100000 units, max 1000 = 1%)")
    .requiredOption("--fee <n>", "Proposed trading fee (1/100000 units)")
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

        const fee = Number.parseInt(String(opts.fee), 10);
        if (!Number.isFinite(fee) || fee < 0) {
          logger.error("Invalid --fee");
          process.exitCode = 1;
          return;
        }

        const password = opts.password || "default-dev-password";
        const wallet = restoreXrplWallet(walletData, password);
        const client = await getXrplClient();
        const { assetXrp, assetRlusd } = poolAssets(config);

        const tx: AMMVote = {
          TransactionType: "AMMVote",
          Account: wallet.address,
          Asset: assetXrp,
          Asset2: assetRlusd,
          TradingFee: fee,
        };

        const prepared = await client.autofill(tx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        const txResult = readTxResult(result.result.meta);

        if (txResult === "tesSUCCESS") {
          logger.success("AMM vote submitted");
          logger.label("Tx Hash", result.result.hash);
        } else {
          logger.error(`AMMVote failed: ${txResult}`);
          logger.label("Tx Hash", result.result.hash);
        }
      } catch (err) {
        logger.error(`AMM vote failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  ammCmd
    .command("swap")
    .description("Swap XRP for RLUSD via AMM (single-asset deposit)")
    .requiredOption("--sell-xrp <n>", "XRP amount to contribute toward the swap")
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
        const { assetXrp, assetRlusd } = poolAssets(config);

        const tx: AMMDeposit = {
          TransactionType: "AMMDeposit",
          Account: wallet.address,
          Asset: assetXrp,
          Asset2: assetRlusd,
          Amount: xrpToDrops(opts.sellXrp),
          Flags: AMMDepositFlags.tfSingleAsset,
        };

        const prepared = await client.autofill(tx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        const txResult = readTxResult(result.result.meta);

        if (txResult === "tesSUCCESS") {
          logger.success("AMM swap (single-asset deposit) submitted");
          logger.label("Tx Hash", result.result.hash);
        } else {
          logger.error(`AMMDeposit swap failed: ${txResult}`);
          logger.label("Tx Hash", result.result.hash);
        }
      } catch (err) {
        logger.error(`AMM swap failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

import { Command } from "commander";
import type { TrustSet } from "xrpl";
import { createErrorEnvelope, createSuccessEnvelope } from "../../agent/envelope.js";
import {
  disconnectXrplClient,
  getXrplAccountInfo,
  getXrplClient,
  resolveXrplChainRef,
} from "../../clients/xrpl-client.js";
import { getDefaultWallet, resolveWalletForChain } from "../../wallet/manager.js";
import { restoreXrplWallet } from "../../wallet/xrpl-wallet.js";
import { loadConfig } from "../../config/config.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import { createPreparedPlan, loadPreparedPlan } from "../../plans/index.js";
import type { ResolvedAsset, StoredXrplWallet } from "../../types/index.js";
import type { OutputFormat } from "../../types/index.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../../utils/secrets.js";
import { validateAddress } from "../../utils/address.js";

const XRPL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function emitEnvelope(value: unknown): void {
  if (value && typeof value === "object" && !Array.isArray(value) && (value as { ok?: boolean }).ok === false) {
    console.error(JSON.stringify(value, null, 2));
    return;
  }
  logger.raw(JSON.stringify(value, null, 2));
}

function buildXrplAsset(config: ReturnType<typeof loadConfig>): ResolvedAsset {
  return {
    symbol: "RLUSD",
    name: "Ripple USD",
    chain: "xrpl",
    family: "xrpl",
    issuer: config.rlusd.xrpl_issuer,
    currency: config.rlusd.xrpl_currency,
  };
}

function normalizeIssuedTokenAmount(value: string, label: string): string {
  const normalized = value.trim();
  if (!XRPL_AMOUNT_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a valid XRPL string number greater than zero`);
  }
  const [significand] = normalized.split(/[eE]/);
  const nonZeroDigits = significand?.replace(".", "").replace(/^0+/, "") ?? "";
  if (nonZeroDigits.length === 0) {
    throw new Error(`${label} must be a valid XRPL string number greater than zero`);
  }
  return normalized;
}

function requirePlanParam(command: string, params: Record<string, string>, key: string): string {
  const value = params[key];
  if (!value) {
    throw new Error(`Prepared plan is missing required param '${key}' for ${command}.`);
  }
  return value;
}

function requireConfirmedExecution(
  plan: Awaited<ReturnType<typeof loadPreparedPlan>>,
  confirmPlanId?: string,
): void {
  if (plan.data.requires_confirmation && confirmPlanId !== plan.data.plan_id) {
    throw new Error("Execution requires an explicit confirmation matching the prepared plan id.");
  }
}

export function registerTrustlineCommand(parent: Command, program: Command): void {
  const trustlineCmd = parent.command("trustline").description("RLUSD trust line management on XRPL");

  trustlineCmd
    .command("prepare")
    .description("Create a prepared RLUSD trust line plan")
    .option("--chain <chain>", "target XRPL chain label, e.g. xrpl-mainnet")
    .requiredOption("--address <address>", "XRPL address to configure")
    .option("--limit <amount>", "maximum RLUSD to hold", "1000000")
    .action(async (opts: { chain?: string; address: string; limit: string }) => {
      const config = loadConfig();
      try {
        const chainInput = opts.chain || (program.opts().chain as string | undefined) || "xrpl";
        const resolved = resolveXrplChainRef(chainInput, config.environment);
        if (!validateAddress(opts.address, "xrpl")) {
          throw new Error(`Invalid XRPL address: ${opts.address}`);
        }
        const limit = normalizeIssuedTokenAmount(opts.limit, "Limit");
        const asset = buildXrplAsset(config);

        const plan = await createPreparedPlan({
          command: "xrpl.trustline.prepare",
          chain: resolved.label,
          timestamp: new Date().toISOString(),
          action: "xrpl.trustline",
          requires_confirmation: resolved.network === "mainnet",
          human_summary: `Set RLUSD trust line limit to ${limit} for ${opts.address} on ${resolved.displayName}`,
          asset,
          params: {
            address: opts.address,
            limit,
          },
          intent: {
            account: opts.address,
            transaction_type: "TrustSet",
            tx_json: {
              TransactionType: "TrustSet",
              Account: opts.address,
              LimitAmount: {
                currency: asset.currency,
                issuer: asset.issuer,
                value: limit,
              },
            },
          },
          warnings: resolved.network === "mainnet" ? ["mainnet", "trustline_change"] : [],
        });

        emitEnvelope(plan);
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "xrpl.trustline.prepare",
            timestamp: new Date().toISOString(),
            code: "PREPARE_FAILED",
            message:
              error instanceof Error ? error.message : "Unable to prepare XRPL trust line.",
          }),
        );
        process.exitCode = 1;
      }
    });

  trustlineCmd
    .command("execute")
    .description("Execute a prepared RLUSD trust line plan")
    .requiredOption("--plan <path>", "path to a prepared plan file")
    .option("--confirm-plan-id <planId>", "explicit confirmation matching the prepared plan id")
    .option("--wallet <name>", "wallet name to use for the trust line")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { plan: string; confirmPlanId?: string; wallet?: string; password?: string }) => {
      try {
        const plan = await loadPreparedPlan(opts.plan);
        if (plan.data.action !== "xrpl.trustline") {
          throw new Error(`Prepared plan action '${plan.data.action}' cannot be executed by xrpl.trustline.execute.`);
        }
        requireConfirmedExecution(plan, opts.confirmPlanId);

        const config = loadConfig();
        const resolved = resolveXrplChainRef(plan.chain, config.environment);
        const signerAddress = requirePlanParam("xrpl.trustline.execute", plan.data.params, "address");
        const walletData = (opts.wallet
          ? resolveWalletForChain("xrpl", {
              walletName: opts.wallet,
              optionName: "--wallet",
            })
          : getDefaultWallet("xrpl")) as StoredXrplWallet | null;

        if (!walletData) {
          throw new Error("No XRPL wallet configured. Run: rlusd wallet generate --chain xrpl");
        }
        if (walletData.address !== signerAddress) {
          throw new Error(`Selected wallet address ${walletData.address} does not match prepared signer ${signerAddress}.`);
        }

        const password = resolveWalletPassword(opts.password, { machineReadable: true });
        const wallet = restoreXrplWallet(walletData, password);
        const client = await getXrplClient(resolved.network);
        const txJson = (plan.data.intent as { tx_json?: TrustSet }).tx_json;
        if (!txJson) {
          throw new Error("Prepared plan is missing XRPL trust line tx_json.");
        }

        const prepared = await client.autofill(txJson);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);

        emitEnvelope(
          createSuccessEnvelope({
            command: "xrpl.trustline.execute",
            chain: plan.chain,
            timestamp: new Date().toISOString(),
            data: {
              plan_id: plan.data.plan_id,
              plan_path: opts.plan,
              action: plan.data.action,
              tx_hash: result.result.hash,
            },
            warnings: plan.warnings,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to execute prepared XRPL trust line.";
        emitEnvelope(
          createErrorEnvelope({
            command: "xrpl.trustline.execute",
            timestamp: new Date().toISOString(),
            code:
              message.includes("explicit confirmation")
                ? "CONFIRMATION_REQUIRED"
                : message.includes("deterministic plan id")
                  ? "PLAN_INTEGRITY_MISMATCH"
                  : "EXECUTION_FAILED",
            message,
          }),
        );
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  trustlineCmd
    .command("setup")
    .description("Set up RLUSD trust line (required before receiving RLUSD on XRPL)")
    .option("--limit <amount>", "maximum RLUSD to hold", "1000000")
    .option("--wallet <name>", "wallet name to use for the trust line")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
        const walletData = resolveWalletForChain("xrpl", {
          walletName: opts.wallet,
          optionName: "--wallet",
        }) as StoredXrplWallet;

        const password = resolveWalletPassword(opts.password, {
          machineReadable: outputFormat === "json" || outputFormat === "json-compact",
        });
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
          process.exitCode = 1;
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
          (line: {
            currency: string;
            account: string;
            balance: string;
            limit: string;
            freeze?: boolean;
          }) =>
            line.currency === config.rlusd.xrpl_currency &&
            line.account === config.rlusd.xrpl_issuer,
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
    .option("--wallet <name>", "wallet name to use for the trust line")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
        const walletData = resolveWalletForChain("xrpl", {
          walletName: opts.wallet,
          optionName: "--wallet",
        }) as StoredXrplWallet;

        const password = resolveWalletPassword(opts.password, {
          machineReadable: outputFormat === "json" || outputFormat === "json-compact",
        });
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
          process.exitCode = 1;
        }
      } catch (err) {
        logger.error(`Trust line removal failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  const accountCmd = parent.command("account").description("XRPL account operations");
  accountCmd
    .command("info")
    .description("Read XRPL account information")
    .option("--chain <chain>", "target XRPL chain label, e.g. xrpl-mainnet")
    .requiredOption("--address <address>", "XRPL address to inspect")
    .action(async (opts: { chain?: string; address: string }) => {
      const config = loadConfig();
      try {
        const chainInput = opts.chain || (program.opts().chain as string | undefined) || "xrpl";
        const resolved = resolveXrplChainRef(chainInput, config.environment);
        if (!validateAddress(opts.address, "xrpl")) {
          throw new Error(`Invalid XRPL address: ${opts.address}`);
        }

        const account = await getXrplAccountInfo(resolved.network, opts.address);
        emitEnvelope(
          createSuccessEnvelope({
            command: "xrpl.account.info",
            chain: resolved.label,
            timestamp: new Date().toISOString(),
            data: {
              address: opts.address,
              account,
            },
          }),
        );
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "xrpl.account.info",
            timestamp: new Date().toISOString(),
            code: "ACCOUNT_INFO_FAILED",
            message:
              error instanceof Error ? error.message : "Unable to read XRPL account information.",
          }),
        );
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

import { Command } from "commander";
import type { Payment } from "xrpl";

import { createErrorEnvelope, createSuccessEnvelope } from "../../agent/envelope.js";
import {
  disconnectXrplClient,
  getXrplClient,
  getXrplPaymentReceipt,
  getXrplTrustlineStatus,
  resolveXrplChainRef,
} from "../../clients/xrpl-client.js";
import { loadConfig } from "../../config/config.js";
import { createPreparedPlan, loadPreparedPlan } from "../../plans/index.js";
import type { ResolvedAsset, StoredXrplWallet } from "../../types/index.js";
import { validateAddress } from "../../utils/address.js";
import { logger } from "../../utils/logger.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../../utils/secrets.js";
import { resolveWalletForChain } from "../../wallet/manager.js";
import { restoreXrplWallet } from "../../wallet/xrpl-wallet.js";

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

export function registerPaymentCommand(parent: Command, program: Command): void {
  const paymentCmd = parent.command("payment").description("Prepared XRPL RLUSD payments");

  paymentCmd
    .command("prepare")
    .description("Create a prepared XRPL RLUSD payment plan")
    .option("--chain <chain>", "target XRPL chain label, e.g. xrpl-mainnet")
    .requiredOption("--from-wallet <name>", "wallet name to send from")
    .requiredOption("--to <address>", "destination XRPL address")
    .requiredOption("--amount <amount>", "amount of RLUSD to send")
    .action(async (opts: { chain?: string; fromWallet: string; to: string; amount: string }) => {
      const config = loadConfig();

      try {
        const chainInput = opts.chain || (program.opts().chain as string | undefined) || "xrpl";
        const resolved = resolveXrplChainRef(chainInput, config.environment);
        if (!validateAddress(opts.to, "xrpl")) {
          throw new Error(`Invalid XRPL address: ${opts.to}`);
        }

        const walletData = resolveWalletForChain("xrpl", {
          walletName: opts.fromWallet,
          optionName: "--from-wallet",
        }) as StoredXrplWallet;
        const amount = normalizeIssuedTokenAmount(opts.amount, "Amount");
        const asset = buildXrplAsset(config);
        const destinationTrustline =
          opts.to === asset.issuer
            ? { present: true, account_exists: true }
            : await getXrplTrustlineStatus(resolved.network, opts.to);

        if (!destinationTrustline.present) {
          if (!destinationTrustline.account_exists) {
            emitEnvelope(
              createErrorEnvelope({
                command: "xrpl.payment.prepare",
                chain: resolved.label,
                timestamp: new Date().toISOString(),
                code: "DESTINATION_ACCOUNT_MISSING",
                message: "Destination XRPL account does not exist or is not activated.",
                next: [
                  {
                    command: `rlusd xrpl account info --chain ${resolved.label} --address ${opts.to} --json`,
                  },
                ],
              }),
            );
            process.exitCode = 1;
            return;
          }

          emitEnvelope(
            createErrorEnvelope({
              command: "xrpl.payment.prepare",
              chain: resolved.label,
              timestamp: new Date().toISOString(),
              code: "TRUSTLINE_MISSING",
              message: "Destination account does not currently have an RLUSD trust line.",
              next: [
                {
                  command: `rlusd xrpl trustline status --chain ${resolved.label} --address ${opts.to} --json`,
                },
              ],
            }),
          );
          process.exitCode = 1;
          return;
        }

        const plan = await createPreparedPlan({
          command: "xrpl.payment.prepare",
          chain: resolved.label,
          timestamp: new Date().toISOString(),
          action: "xrpl.payment",
          requires_confirmation: resolved.network === "mainnet",
          human_summary: `Send ${amount} RLUSD from ${opts.fromWallet} to ${opts.to} on ${resolved.displayName}`,
          asset,
          params: {
            from: opts.fromWallet,
            to: opts.to,
            amount,
          },
          intent: {
            account: walletData.address,
            transaction_type: "Payment",
            tx_json: {
              TransactionType: "Payment",
              Account: walletData.address,
              Destination: opts.to,
              Amount: {
                currency: asset.currency,
                issuer: asset.issuer,
                value: amount,
              },
            },
          },
          warnings: resolved.network === "mainnet" ? ["mainnet", "real_funds"] : [],
        });

        emitEnvelope(plan);
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "xrpl.payment.prepare",
            timestamp: new Date().toISOString(),
            code: "PREPARE_FAILED",
            message: error instanceof Error ? error.message : "Unable to prepare XRPL payment.",
          }),
        );
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  paymentCmd
    .command("execute")
    .description("Execute a prepared XRPL payment plan")
    .requiredOption("--plan <path>", "path to a prepared plan file")
    .option("--confirm-plan-id <planId>", "explicit confirmation matching the prepared plan id")
    .option("--wallet <name>", "wallet name to use for signing")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { plan: string; confirmPlanId?: string; wallet?: string; password?: string }) => {
      try {
        const plan = await loadPreparedPlan(opts.plan);
        if (plan.data.action !== "xrpl.payment") {
          throw new Error(`Prepared plan action '${plan.data.action}' cannot be executed by xrpl.payment.execute.`);
        }
        requireConfirmedExecution(plan, opts.confirmPlanId);

        const config = loadConfig();
        const resolved = resolveXrplChainRef(plan.chain, config.environment);
        const walletName = opts.wallet || requirePlanParam("xrpl.payment.execute", plan.data.params, "from");
        const walletData = resolveWalletForChain("xrpl", {
          walletName,
          optionName: "--wallet",
        }) as StoredXrplWallet;
        const password = resolveWalletPassword(opts.password, {
          machineReadable: true,
          walletName,
        });
        const wallet = restoreXrplWallet(walletData, password);
        const client = await getXrplClient(resolved.network);
        const txJson = (plan.data.intent as { tx_json?: Payment }).tx_json;
        if (!txJson) {
          throw new Error("Prepared plan is missing XRPL payment tx_json.");
        }

        const prepared = await client.autofill(txJson);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);

        emitEnvelope(
          createSuccessEnvelope({
            command: "xrpl.payment.execute",
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
          error instanceof Error ? error.message : "Unable to execute prepared XRPL payment.";
        emitEnvelope(
          createErrorEnvelope({
            command: "xrpl.payment.execute",
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

  paymentCmd
    .command("receipt")
    .description("Read an XRPL payment receipt")
    .option("--chain <chain>", "target XRPL chain label, e.g. xrpl-mainnet")
    .requiredOption("--hash <hash>", "transaction hash")
    .action(async (opts: { chain?: string; hash: string }) => {
      const config = loadConfig();
      try {
        const chainInput = opts.chain || (program.opts().chain as string | undefined) || "xrpl";
        const resolved = resolveXrplChainRef(chainInput, config.environment);
        const receipt = await getXrplPaymentReceipt(resolved.network, opts.hash);
        emitEnvelope(
          createSuccessEnvelope({
            command: "xrpl.payment.receipt",
            chain: resolved.label,
            timestamp: new Date().toISOString(),
            data: receipt,
          }),
        );
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "xrpl.payment.receipt",
            timestamp: new Date().toISOString(),
            code: "PAYMENT_RECEIPT_FAILED",
            message: error instanceof Error ? error.message : "Unable to read XRPL payment receipt.",
          }),
        );
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

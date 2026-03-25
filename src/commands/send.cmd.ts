import { Command } from "commander";
import type { Payment } from "xrpl";
import { getXrplClient, disconnectXrplClient } from "../clients/xrpl-client.js";
import { getEvmPublicClient, getViemChain, resolveEvmChainRef } from "../clients/evm-client.js";
import { isXrplWallet, resolveWalletForChain } from "../wallet/manager.js";
import { restoreXrplWallet } from "../wallet/xrpl-wallet.js";
import { decryptEvmPrivateKey } from "../wallet/evm-wallet.js";
import { loadConfig } from "../config/config.js";
import { detectChainFromAddress, validateAddress } from "../utils/address.js";
import { createErrorEnvelope, createSuccessEnvelope } from "../agent/envelope.js";
import { logger } from "../utils/logger.js";
import { formatOutput } from "../utils/format.js";
import { createPreparedPlan, loadPreparedPlan } from "../plans/index.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../utils/secrets.js";
import { assertActiveRlusdEvmChain, getRlusdContractAddress } from "../utils/evm-support.js";
import { RLUSD_ERC20_ABI } from "../abi/rlusd-erc20.js";
import type { ChainName, OutputFormat, EvmChainName, StoredXrplWallet, StoredEvmWallet, ResolvedAsset } from "../types/index.js";
import { createWalletClient, http, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toErc20Units } from "../utils/amounts.js";

function emitEnvelope(value: unknown): void {
  if (value && typeof value === "object" && !Array.isArray(value) && (value as { ok?: boolean }).ok === false) {
    console.error(JSON.stringify(value, null, 2));
    return;
  }
  logger.raw(JSON.stringify(value, null, 2));
}

function buildEvmAsset(chain: string, contractAddress: `0x${string}`, decimals: number): ResolvedAsset {
  return {
    symbol: "RLUSD",
    name: "Ripple USD",
    chain,
    family: "evm",
    address: contractAddress,
    decimals,
  };
}

function requirePlanParam(command: string, params: Record<string, string>, key: string): string {
  const value = params[key];
  if (!value) {
    throw new Error(`Prepared plan is missing required param '${key}' for ${command}.`);
  }
  return value;
}

function requirePlanIntentField(command: string, intent: Record<string, unknown>, key: string): string {
  const value = intent[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Prepared plan is missing required intent field '${key}' for ${command}.`);
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

export function registerSendCommand(program: Command): void {
  program
    .command("send")
    .description("Send RLUSD to an address")
    .requiredOption("--to <address>", "recipient address")
    .requiredOption("--amount <amount>", "amount of RLUSD to send")
    .option("-c, --chain <chain>", "chain to send on (auto-detected from address if omitted)")
    .option("--from-wallet <name>", "wallet name to send from")
    .option("--tag <tag>", "XRPL destination tag (integer)")
    .option("--memo <memo>", "transaction memo")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .option("--dry-run", "preview transaction without submitting")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      let chain = (opts.chain || program.opts().chain) as ChainName | undefined;
      if (!chain) {
        const detected = detectChainFromAddress(opts.to);
        if (detected === "xrpl") {
          chain = "xrpl";
        } else if (detected === "ethereum") {
          if (config.default_chain === "xrpl") {
            logger.error(
              "EVM recipient detected but default chain is xrpl. Please specify --chain explicitly (e.g. --chain ethereum).",
            );
            process.exitCode = 1;
            return;
          }
          chain = config.default_chain;
        } else {
          chain = config.default_chain;
        }
      }

      if (!validateAddress(opts.to, chain)) {
        logger.error(`Invalid address for ${chain}: ${opts.to}`);
        process.exitCode = 1;
        return;
      }

      try {
        if (chain === "xrpl") {
          await sendXrpl(opts, config, outputFormat);
        } else {
          await sendEvm(chain as EvmChainName, opts, config, outputFormat);
        }
      } catch (err) {
        if (outputFormat === "json" || outputFormat === "json-compact") {
          emitEnvelope(
            createErrorEnvelope({
              command: "send",
              timestamp: new Date().toISOString(),
              code: "COMMAND_ERROR",
              message: `Send failed: ${(err as Error).message}`,
            }),
          );
        } else {
          logger.error(`Send failed: ${(err as Error).message}`);
        }
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

export function registerEvmTransferCommand(parent: Command, program: Command): void {
  const transferCmd = parent.command("transfer").description("Prepared RLUSD transfers on EVM chains");

  transferCmd
    .command("prepare")
    .description("Create a prepared RLUSD transfer plan")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--from-wallet <name>", "wallet name to send from")
    .requiredOption("--to <address>", "recipient address")
    .requiredOption("--amount <amount>", "amount of RLUSD to transfer")
    .action(async (opts: { chain: string; fromWallet: string; to: string; amount: string }) => {
      const config = loadConfig();

      try {
        const chainInput = opts.chain || (program.opts().chain as string | undefined);
        if (!chainInput) {
          throw new Error("The --chain option is required.");
        }
        const resolved = resolveEvmChainRef(chainInput, config.environment);
        if (!validateAddress(opts.to, resolved.chain)) {
          throw new Error(`Invalid recipient address for ${resolved.chain}: ${opts.to}`);
        }

        const contractAddress = getRlusdContractAddress(resolved.chain, config);
        const amountRaw = toErc20Units(opts.amount, config.rlusd.eth_decimals);
        const plan = await createPreparedPlan({
          command: "evm.transfer.prepare",
          chain: resolved.label,
          timestamp: new Date().toISOString(),
          action: "evm.transfer",
          requires_confirmation: resolved.network === "mainnet",
          human_summary: `Transfer ${opts.amount} RLUSD from ${opts.fromWallet} to ${opts.to} on ${resolved.displayName}`,
          asset: buildEvmAsset(resolved.chain, contractAddress, config.rlusd.eth_decimals),
          params: {
            from: opts.fromWallet,
            to: opts.to,
            amount: opts.amount,
          },
          intent: {
            to: contractAddress,
            value: "0",
            function_name: "transfer",
            args: {
              to: opts.to,
              amount_raw: amountRaw.toString(),
            },
            data: encodeFunctionData({
              abi: RLUSD_ERC20_ABI,
              functionName: "transfer",
              args: [opts.to as `0x${string}`, amountRaw],
            }),
          },
          warnings: resolved.network === "mainnet" ? ["mainnet", "real_funds"] : [],
        });

        emitEnvelope(plan);
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "evm.transfer.prepare",
            timestamp: new Date().toISOString(),
            code: "PREPARE_FAILED",
            message: error instanceof Error ? error.message : "Unable to prepare EVM transfer.",
          }),
        );
        process.exitCode = 1;
      }
    });

  transferCmd
    .command("execute")
    .description("Execute a prepared RLUSD transfer plan")
    .requiredOption("--plan <path>", "path to a prepared plan file")
    .option("--confirm-plan-id <planId>", "explicit confirmation matching the prepared plan id")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { plan: string; confirmPlanId?: string; password?: string }) => {
      try {
        const plan = await loadPreparedPlan(opts.plan);
        if (plan.data.action !== "evm.transfer") {
          throw new Error(`Prepared plan action '${plan.data.action}' cannot be executed by evm.transfer.execute.`);
        }
        requireConfirmedExecution(plan, opts.confirmPlanId);

        const config = loadConfig();
        const resolved = resolveEvmChainRef(plan.chain, config.environment);
        const walletName = requirePlanParam("evm.transfer.execute", plan.data.params, "from");
        const walletData = resolveWalletForChain(resolved.chain, {
          walletName,
          optionName: "--from-wallet",
        });

        if (isXrplWallet(walletData)) {
          throw new Error(`Selected wallet is not an EVM wallet for ${resolved.chain}.`);
        }

        const password = resolveWalletPassword(opts.password, {
          machineReadable: true,
          walletName,
        });
        const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, password);
        const rpcUrl = config.chains[resolved.chain]?.rpc;
        if (!rpcUrl) {
          throw new Error(`RPC not configured for ${resolved.chain}`);
        }

        const account = privateKeyToAccount(privateKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: getViemChain(resolved.chain, resolved.network),
          transport: http(rpcUrl),
        });

        const txHash = await walletClient.writeContract({
          address: requirePlanIntentField(
            "evm.transfer.execute",
            plan.data.intent as Record<string, unknown>,
            "to",
          ) as `0x${string}`,
          abi: RLUSD_ERC20_ABI,
          functionName: "transfer",
          args: [
            requirePlanParam("evm.transfer.execute", plan.data.params, "to") as `0x${string}`,
            BigInt(
              requirePlanIntentField(
                "evm.transfer.execute",
                (plan.data.intent as { args?: Record<string, unknown> }).args ?? {},
                "amount_raw",
              ),
            ),
          ],
        });

        emitEnvelope(
          createSuccessEnvelope({
            command: "evm.transfer.execute",
            chain: plan.chain,
            timestamp: new Date().toISOString(),
            data: {
              plan_id: plan.data.plan_id,
              plan_path: opts.plan,
              action: plan.data.action,
              tx_hash: txHash,
            },
            warnings: plan.warnings,
          }),
        );
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "evm.transfer.execute",
            timestamp: new Date().toISOString(),
            code:
              error instanceof Error && error.message.includes("deterministic plan id")
                ? "PLAN_INTEGRITY_MISMATCH"
                : error instanceof Error && error.message.includes("explicit confirmation")
                  ? "CONFIRMATION_REQUIRED"
                  : "EXECUTION_FAILED",
            message:
              error instanceof Error ? error.message : "Unable to execute prepared EVM transfer.",
          }),
        );
        process.exitCode = 1;
      }
    });
}

async function sendXrpl(
  opts: {
    to: string;
    amount: string;
    fromWallet?: string;
    tag?: string;
    memo?: string;
    password?: string;
    dryRun?: boolean;
  },
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const walletData = resolveWalletForChain("xrpl", {
    walletName: opts.fromWallet,
    optionName: "--from-wallet",
  });
  if (!isXrplWallet(walletData)) {
    throw new Error("Selected wallet is not an XRPL wallet.");
  }

  const password = resolveWalletPassword(opts.password, {
    machineReadable: outputFormat === "json" || outputFormat === "json-compact",
    walletName: walletData.name,
  });
  const wallet = restoreXrplWallet(walletData as StoredXrplWallet, password);
  const client = await getXrplClient();

  const paymentTx: Payment = {
    TransactionType: "Payment",
    Account: wallet.address,
    Destination: opts.to,
    Amount: {
      currency: config.rlusd.xrpl_currency,
      issuer: config.rlusd.xrpl_issuer,
      value: opts.amount,
    },
  };

  if (opts.tag) {
    const destinationTag = Number.parseInt(opts.tag, 10);
    if (!Number.isInteger(destinationTag) || destinationTag < 0 || destinationTag > 0xffffffff) {
      throw new Error("Destination tag must be an integer between 0 and 4294967295.");
    }
    paymentTx.DestinationTag = destinationTag;
  }

  if (opts.memo) {
    if (Buffer.byteLength(opts.memo, "utf-8") > 256) {
      throw new Error("Memo is too long. Maximum length is 256 bytes.");
    }
    paymentTx.Memos = [
      {
        Memo: {
          MemoData: Buffer.from(opts.memo, "utf-8").toString("hex").toUpperCase(),
          MemoType: Buffer.from("text/plain", "utf-8").toString("hex").toUpperCase(),
        },
      },
    ];
  }

  const prepared = await client.autofill(paymentTx);

  if (opts.dryRun) {
    logger.info("Dry run — transaction will not be submitted");
    logger.raw(formatOutput(prepared as unknown as Record<string, unknown>, outputFormat));
    return;
  }

  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  const meta = result.result.meta;
  const txResult = typeof meta === "object" && meta !== null && "TransactionResult" in meta
    ? (meta as { TransactionResult: string }).TransactionResult
    : "unknown";

  if (txResult === "tesSUCCESS") {
    const data = {
      status: "success",
      chain: "xrpl",
      hash: result.result.hash,
      from: wallet.address,
      to: opts.to,
      amount: `${opts.amount} RLUSD`,
    };
    if (outputFormat === "json" || outputFormat === "json-compact") {
      logger.raw(formatOutput(data, outputFormat));
    } else {
      logger.success(`Sent ${opts.amount} RLUSD to ${opts.to}`);
      logger.label("Tx Hash", result.result.hash);
    }
  } else {
    logger.error(`Transaction failed: ${txResult}`);
    logger.label("Tx Hash", result.result.hash);
    process.exitCode = 1;
  }
}

async function sendEvm(
  chain: EvmChainName,
  opts: { to: string; amount: string; fromWallet?: string; password?: string; dryRun?: boolean },
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  assertActiveRlusdEvmChain(chain);
  const walletData = resolveWalletForChain(chain, {
    walletName: opts.fromWallet,
    optionName: "--from-wallet",
  });
  if (isXrplWallet(walletData)) {
    throw new Error(`Selected wallet is not an EVM wallet for ${chain}.`);
  }

  const password = resolveWalletPassword(opts.password, {
    machineReadable: outputFormat === "json" || outputFormat === "json-compact",
    walletName: walletData.name,
  });
  const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, password);

  const rpcUrl = config.chains[chain]?.rpc;
  if (!rpcUrl) {
    logger.error(`RPC not configured for ${chain}`);
    process.exitCode = 1;
    return;
  }

  const viemChain = getViemChain(chain, config.environment);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(rpcUrl),
  });

  const contractAddress = getRlusdContractAddress(chain, config);
  const toAddress = opts.to as `0x${string}`;
  const amount = toErc20Units(opts.amount, config.rlusd.eth_decimals);

  if (opts.dryRun) {
    logger.info("Dry run — transaction will not be submitted");
    logger.label("Chain", chain);
    logger.label("From", account.address);
    logger.label("To", opts.to);
    logger.label("Amount", `${opts.amount} RLUSD`);
    logger.label("Contract", contractAddress);
    return;
  }

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: RLUSD_ERC20_ABI,
    functionName: "transfer",
    args: [toAddress, amount],
  });

  const publicClient = getEvmPublicClient(chain);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const data = {
    status: receipt.status === "success" ? "success" : "failed",
    chain,
    hash,
    from: account.address,
    to: opts.to,
    amount: `${opts.amount} RLUSD`,
    gas_used: receipt.gasUsed.toString(),
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data, outputFormat));
  } else {
    if (receipt.status === "success") {
      logger.success(`Sent ${opts.amount} RLUSD to ${opts.to} on ${chain}`);
    } else {
      logger.error(`Transaction reverted on ${chain}`);
      process.exitCode = 1;
    }
    logger.label("Tx Hash", hash);
  }
}

import { Command } from "commander";
import { createWalletClient, http, encodeFunctionData, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../../config/config.js";
import { createErrorEnvelope, createSuccessEnvelope } from "../../agent/envelope.js";
import { isXrplWallet, resolveWalletForChain } from "../../wallet/manager.js";
import { decryptEvmPrivateKey } from "../../wallet/evm-wallet.js";
import { createPreparedPlan, loadPreparedPlan } from "../../plans/index.js";
import { getEvmPublicClient, getViemChain, resolveEvmChainRef } from "../../clients/evm-client.js";
import { RLUSD_ERC20_ABI } from "../../abi/rlusd-erc20.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import type { EvmChainName, OutputFormat, StoredEvmWallet, ResolvedAsset } from "../../types/index.js";
import { validateAddress } from "../../utils/address.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../../utils/secrets.js";
import { assertActiveRlusdEvmChain, getRlusdContractAddress } from "../../utils/evm-support.js";
import { toErc20Units } from "../../utils/amounts.js";

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

function resolveEvmChain(opts: { chain?: string }, program: Command, defaultChain: EvmChainName): EvmChainName {
  const raw = (opts.chain || program.opts().chain || defaultChain) as string;
  if (raw === "xrpl") {
    throw new Error("ERC-20 approve requires an EVM chain.");
  }
  const chain = raw as EvmChainName;
  assertActiveRlusdEvmChain(chain);
  return chain;
}

export function registerApproveCommand(parent: Command, program: Command): void {
  parent
    .command("approve")
    .description("Approve RLUSD spending for a spender")
    .requiredOption("--spender <address>", "spender contract or wallet address")
    .requiredOption("--amount <n>", "allowance amount in RLUSD (token units)")
    .option("-c, --chain <chain>", "EVM chain: ethereum")
    .option("--owner-wallet <name>", "wallet name to use as the RLUSD owner")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { spender: string; amount: string; chain?: string; ownerWallet?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveEvmChain(opts, program, "ethereum");
        if (!validateAddress(opts.spender, chain)) {
          logger.error(`Invalid spender address for ${chain}: ${opts.spender}`);
          process.exitCode = 1;
          return;
        }
        await runApprove(chain, opts.spender, opts.amount, opts.ownerWallet, opts.password, config, outputFormat);
      } catch (err) {
        logger.error(`Approve failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  parent
    .command("allowance")
    .description("Check RLUSD allowance for a spender")
    .requiredOption("--spender <address>", "spender address")
    .option("-c, --chain <chain>", "EVM chain: ethereum")
    .option("--owner-wallet <name>", "wallet name to use as the RLUSD owner")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()}; only used to resolve the active wallet)`,
    )
    .action(async (opts: { spender: string; chain?: string; ownerWallet?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveEvmChain(opts, program, "ethereum");
        if (!validateAddress(opts.spender, chain)) {
          logger.error(`Invalid spender address for ${chain}: ${opts.spender}`);
          process.exitCode = 1;
          return;
        }
        await runAllowance(chain, opts.spender, opts.ownerWallet, config, outputFormat);
      } catch (err) {
        logger.error(`Allowance query failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  parent
    .command("revoke")
    .description("Revoke RLUSD approval (set allowance to 0)")
    .requiredOption("--spender <address>", "spender address to revoke")
    .option("-c, --chain <chain>", "EVM chain: ethereum")
    .option("--owner-wallet <name>", "wallet name to use as the RLUSD owner")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { spender: string; chain?: string; ownerWallet?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveEvmChain(opts, program, "ethereum");
        if (!validateAddress(opts.spender, chain)) {
          logger.error(`Invalid spender address for ${chain}: ${opts.spender}`);
          process.exitCode = 1;
          return;
        }
        await runApprove(chain, opts.spender, "0", opts.ownerWallet, opts.password, config, outputFormat);
      } catch (err) {
        logger.error(`Revoke failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}

export function registerEvmApproveCommand(parent: Command, program: Command): void {
  const approveCmd = parent.command("approve").description("Prepared RLUSD approvals on EVM chains");

  approveCmd
    .command("prepare")
    .description("Create a prepared RLUSD approve plan")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--owner-wallet <name>", "wallet name to use as the RLUSD owner")
    .requiredOption("--spender <address>", "spender address")
    .requiredOption("--amount <amount>", "allowance amount in RLUSD")
    .action(async (opts: { chain: string; ownerWallet: string; spender: string; amount: string }) => {
      const config = loadConfig();

      try {
        const chainInput = opts.chain || (program.opts().chain as string | undefined);
        if (!chainInput) {
          throw new Error("The --chain option is required.");
        }
        const resolved = resolveEvmChainRef(chainInput, config.environment);
        if (!validateAddress(opts.spender, resolved.chain)) {
          throw new Error(`Invalid spender address for ${resolved.chain}: ${opts.spender}`);
        }
        resolveWalletForChain(resolved.chain, {
          walletName: opts.ownerWallet,
          optionName: "--owner-wallet",
        });

        const contractAddress = getRlusdContractAddress(resolved.chain, config);
        const amountRaw = toErc20Units(opts.amount, config.rlusd.eth_decimals);
        const plan = await createPreparedPlan({
          command: "evm.approve.prepare",
          chain: resolved.label,
          timestamp: new Date().toISOString(),
          action: "evm.approve",
          requires_confirmation: resolved.network === "mainnet",
          human_summary: `Approve ${opts.amount} RLUSD from ${opts.ownerWallet} for ${opts.spender} on ${resolved.displayName}`,
          asset: buildEvmAsset(resolved.chain, contractAddress, config.rlusd.eth_decimals),
          params: {
            owner: opts.ownerWallet,
            spender: opts.spender,
            amount: opts.amount,
          },
          intent: {
            to: contractAddress,
            value: "0",
            function_name: "approve",
            args: {
              spender: opts.spender,
              amount_raw: amountRaw.toString(),
            },
            data: encodeFunctionData({
              abi: RLUSD_ERC20_ABI,
              functionName: "approve",
              args: [opts.spender as `0x${string}`, amountRaw],
            }),
          },
          warnings: resolved.network === "mainnet" ? ["mainnet", "token_allowance"] : [],
        });

        emitEnvelope(plan);
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "evm.approve.prepare",
            timestamp: new Date().toISOString(),
            code: "PREPARE_FAILED",
            message: error instanceof Error ? error.message : "Unable to prepare EVM approval.",
          }),
        );
        process.exitCode = 1;
      }
    });

  approveCmd
    .command("execute")
    .description("Execute a prepared RLUSD approve plan")
    .requiredOption("--plan <path>", "path to a prepared plan file")
    .option("--confirm-plan-id <planId>", "explicit confirmation matching the prepared plan id")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { plan: string; confirmPlanId?: string; password?: string }) => {
      try {
        const plan = await loadPreparedPlan(opts.plan);
        if (plan.data.action !== "evm.approve") {
          throw new Error(`Prepared plan action '${plan.data.action}' cannot be executed by evm.approve.execute.`);
        }
        requireConfirmedExecution(plan, opts.confirmPlanId);

        const config = loadConfig();
        const resolved = resolveEvmChainRef(plan.chain, config.environment);
        const walletName = requirePlanParam("evm.approve.execute", plan.data.params, "owner");
        const walletData = resolveWalletForChain(resolved.chain, {
          walletName,
          optionName: "--owner-wallet",
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
            "evm.approve.execute",
            plan.data.intent as Record<string, unknown>,
            "to",
          ) as `0x${string}`,
          abi: RLUSD_ERC20_ABI,
          functionName: "approve",
          args: [
            requirePlanParam("evm.approve.execute", plan.data.params, "spender") as `0x${string}`,
            BigInt(
              requirePlanIntentField(
                "evm.approve.execute",
                (plan.data.intent as { args?: Record<string, unknown> }).args ?? {},
                "amount_raw",
              ),
            ),
          ],
        });

        emitEnvelope(
          createSuccessEnvelope({
            command: "evm.approve.execute",
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
            command: "evm.approve.execute",
            timestamp: new Date().toISOString(),
            code:
              error instanceof Error && error.message.includes("deterministic plan id")
                ? "PLAN_INTEGRITY_MISMATCH"
                : error instanceof Error && error.message.includes("explicit confirmation")
                  ? "CONFIRMATION_REQUIRED"
                  : "EXECUTION_FAILED",
            message:
              error instanceof Error ? error.message : "Unable to execute prepared EVM approval.",
          }),
        );
        process.exitCode = 1;
      }
    });
}

async function runApprove(
  chain: EvmChainName,
  spender: string,
  amountStr: string,
  ownerWallet: string | undefined,
  password: string | undefined,
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const walletData = resolveWalletForChain(chain, {
    walletName: ownerWallet,
    optionName: "--owner-wallet",
  });
  if (isXrplWallet(walletData)) {
    throw new Error(`Selected wallet is not an EVM wallet for ${chain}.`);
  }

  const pwd = resolveWalletPassword(password, {
    machineReadable: outputFormat === "json" || outputFormat === "json-compact",
    walletName: walletData.name,
  });
  const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, pwd);

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
  const spenderAddr = spender as `0x${string}`;
  const decimals = config.rlusd.eth_decimals;
  const value = toErc20Units(amountStr, decimals);

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: RLUSD_ERC20_ABI,
    functionName: "approve",
    args: [spenderAddr, value],
  });

  const publicClient = getEvmPublicClient(chain);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const data = {
    status: receipt.status === "success" ? "success" : "failed",
    chain,
    hash,
    owner: account.address,
    spender,
    amount: amountStr === "0" ? "0" : amountStr,
    action: amountStr === "0" ? "revoke" : "approve",
    gas_used: receipt.gasUsed.toString(),
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data, outputFormat));
  } else {
    if (receipt.status === "success") {
      logger.success(amountStr === "0" ? "Allowance revoked" : "Approval submitted");
    } else {
      logger.error(`Transaction reverted on ${chain}`);
      process.exitCode = 1;
    }
    logger.label("Tx Hash", hash);
  }
}

async function runAllowance(
  chain: EvmChainName,
  spender: string,
  ownerWallet: string | undefined,
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const walletData = resolveWalletForChain(chain, {
    walletName: ownerWallet,
    optionName: "--owner-wallet",
  });
  if (isXrplWallet(walletData)) {
    throw new Error(`Selected wallet is not an EVM wallet for ${chain}.`);
  }

  const owner = walletData.address as `0x${string}`;

  const publicClient = getEvmPublicClient(chain);
  const contractAddress = getRlusdContractAddress(chain, config);
  const spenderAddr = spender as `0x${string}`;

  const raw = await publicClient.readContract({
    address: contractAddress,
    abi: RLUSD_ERC20_ABI,
    functionName: "allowance",
    args: [owner, spenderAddr],
  });

  const human = formatUnits(raw, config.rlusd.eth_decimals);
  const data = {
    chain,
    owner,
    spender,
    allowance_raw: raw.toString(),
    allowance: human,
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data, outputFormat));
  } else {
    logger.label("Chain", chain);
    logger.label("Owner", owner);
    logger.label("Spender", spender);
    logger.label("Allowance (RLUSD)", human);
  }
}

import { Command } from "commander";
import { createWalletClient, http, parseUnits, formatUnits, maxUint256, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../../config/config.js";
import { getDefaultWallet, isXrplWallet, resolveWalletForChain } from "../../wallet/manager.js";
import { decryptEvmPrivateKey } from "../../wallet/evm-wallet.js";
import { getEvmPublicClient, getViemChain, resolveEvmChainRef } from "../../clients/evm-client.js";
import { RLUSD_ERC20_ABI } from "../../abi/rlusd-erc20.js";
import { AAVE_POOL_ABI } from "../../abi/aave-pool.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import type {
  DefiLpOperation,
  EvmChainName,
  OutputFormat,
  StoredEvmWallet,
  ResolvedAsset,
} from "../../types/index.js";
import { AAVE_V3_POOL_ETHEREUM } from "../../config/constants.js";
import type { AppConfig } from "../../types/index.js";
import { getPreparePolicy } from "../../policy/index.js";

function resolveAavePool(chain: EvmChainName, config: AppConfig): `0x${string}` {
  return (config.contracts?.[chain]?.aave_v3_pool || AAVE_V3_POOL_ETHEREUM) as `0x${string}`;
}
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../../utils/secrets.js";
import { assertActiveRlusdEvmChain, getRlusdContractAddress } from "../../utils/evm-support.js";
import { createErrorEnvelope, createSuccessEnvelope } from "../../agent/envelope.js";
import { createPreparedPlan, loadPreparedPlan } from "../../plans/index.js";
import { assertExecutableDefiPlan, executePreparedDefiPlan } from "../../defi/executor.js";
import { getDefiVenueAdapter } from "../../defi/venues/index.js";

const AAVE_VARIABLE_RATE_MODE = 2n;
const BASE_CURRENCY_DECIMALS = 8;
const HEALTH_FACTOR_DECIMALS = 18;

function assertEthereumAave(chain: EvmChainName, config: ReturnType<typeof loadConfig>): void {
  if (chain !== "ethereum") {
    throw new Error("Aave V3 RLUSD commands require --chain ethereum (pool address is Ethereum mainnet)");
  }
  if (config.environment !== "mainnet") {
    logger.warn(
      "Aave pool address is Ethereum mainnet; ensure your RPC and RLUSD token match this deployment or transactions may fail.",
    );
  }
}

function resolveChain(opts: { chain?: string }, program: Command): EvmChainName {
  const raw = (opts.chain || program.opts().chain || "ethereum") as string;
  if (raw === "xrpl") {
    throw new Error("Aave commands require an EVM chain (use --chain ethereum)");
  }
  const chain = raw as EvmChainName;
  assertActiveRlusdEvmChain(chain);
  return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWalletClient = any;

async function getWalletWriteContext(
  chain: EvmChainName,
  password: string | undefined,
  config: ReturnType<typeof loadConfig>,
): Promise<{
  walletClient: AnyWalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
  publicClient: ReturnType<typeof getEvmPublicClient>;
}> {
  const walletData = getDefaultWallet(chain);
  if (!walletData || isXrplWallet(walletData)) {
    throw new Error(`No EVM wallet configured for ${chain}. Run: rlusd wallet generate --chain ${chain}`);
  }

  const rpcUrl = config.chains[chain]?.rpc;
  if (!rpcUrl) {
    throw new Error(`RPC not configured for ${chain}`);
  }

  const pwd = resolveWalletPassword(password, { walletName: walletData.name });
  const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, pwd);
  const viemChain = getViemChain(chain, config.environment);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(rpcUrl),
  });
  const publicClient = getEvmPublicClient(chain);
  return { walletClient, account, publicClient };
}

function parseAmountOrMax(
  amountStr: string | undefined,
  useMax: boolean,
  decimals: number,
): bigint {
  if (useMax) {
    return maxUint256;
  }
  if (amountStr === undefined || amountStr === "") {
    throw new Error("amount is required unless --max is set");
  }
  return parseUnits(amountStr, decimals);
}

export function registerDefiCommand(parent: Command, program: Command): void {
  const defiCmd = parent.command("defi").description("DeFi operations for RLUSD");
  const aaveCmd = defiCmd.command("aave").description("Aave V3 Pool (Ethereum) — raw contract calls");

  aaveCmd
    .command("supply")
    .description("Supply RLUSD to Aave (approve Pool, then supply)")
    .requiredOption("--amount <n>", "amount of RLUSD to supply")
    .option("-c, --chain <chain>", "EVM chain (must be ethereum for Aave pool)")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { amount: string; chain?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveChain(opts, program);
        assertEthereumAave(chain, config);
        const { walletClient, account, publicClient } = await getWalletWriteContext(chain, opts.password, config);
        const rlusd = getRlusdContractAddress(chain, config);
        const pool = resolveAavePool(chain, config);
        const dec = config.rlusd.eth_decimals;
        const amount = parseUnits(opts.amount, dec);

        const approveHash = await walletClient.writeContract({
          address: rlusd,
          abi: RLUSD_ERC20_ABI,
          functionName: "approve",
          args: [pool, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        const supplyHash = await walletClient.writeContract({
          address: pool,
          abi: AAVE_POOL_ABI,
          functionName: "supply",
          args: [rlusd, amount, account.address, 0],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: supplyHash });
        emitTxResult("Supply", chain, supplyHash, receipt.status as "success" | "reverted", outputFormat, {
          amount: opts.amount,
          asset: rlusd,
        });
      } catch (err) {
        logger.error(`Aave supply failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  aaveCmd
    .command("withdraw")
    .description("Withdraw RLUSD from Aave")
    .option("--amount <n>", "amount of RLUSD to withdraw")
    .option("--max", "withdraw full RLUSD position (maxUint256)")
    .option("-c, --chain <chain>", "EVM chain (must be ethereum for Aave pool)")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { amount?: string; max?: boolean; chain?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveChain(opts, program);
        assertEthereumAave(chain, config);
        if (!opts.max && (opts.amount === undefined || opts.amount === "")) {
          throw new Error("Provide --amount <n> or --max");
        }
        const { walletClient, account, publicClient } = await getWalletWriteContext(chain, opts.password, config);
        const rlusd = getRlusdContractAddress(chain, config);
        const pool = resolveAavePool(chain, config);
        const amount = parseAmountOrMax(opts.amount, Boolean(opts.max), config.rlusd.eth_decimals);

        const hash = await walletClient.writeContract({
          address: pool,
          abi: AAVE_POOL_ABI,
          functionName: "withdraw",
          args: [rlusd, amount, account.address],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        emitTxResult("Withdraw", chain, hash, receipt.status as "success" | "reverted", outputFormat, {
          amount: opts.max ? "max" : (opts.amount ?? ""),
          asset: rlusd,
        });
      } catch (err) {
        logger.error(`Aave withdraw failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  aaveCmd
    .command("borrow")
    .description("Borrow RLUSD from Aave (variable rate)")
    .requiredOption("--amount <n>", "amount of RLUSD to borrow")
    .option("-c, --chain <chain>", "EVM chain (must be ethereum for Aave pool)")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { amount: string; chain?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveChain(opts, program);
        assertEthereumAave(chain, config);
        const { walletClient, account, publicClient } = await getWalletWriteContext(chain, opts.password, config);
        const rlusd = getRlusdContractAddress(chain, config);
        const pool = resolveAavePool(chain, config);
        const amount = parseUnits(opts.amount, config.rlusd.eth_decimals);

        const hash = await walletClient.writeContract({
          address: pool,
          abi: AAVE_POOL_ABI,
          functionName: "borrow",
          args: [rlusd, amount, AAVE_VARIABLE_RATE_MODE, 0, account.address],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        emitTxResult("Borrow", chain, hash, receipt.status as "success" | "reverted", outputFormat, {
          amount: opts.amount,
          rate_mode: "variable",
        });
      } catch (err) {
        logger.error(`Aave borrow failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  aaveCmd
    .command("repay")
    .description("Repay RLUSD debt (approve Pool, then repay, variable rate)")
    .option("--amount <n>", "amount of RLUSD to repay")
    .option("--max", "repay full debt (maxUint256)")
    .option("-c, --chain <chain>", "EVM chain (must be ethereum for Aave pool)")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { amount?: string; max?: boolean; chain?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveChain(opts, program);
        assertEthereumAave(chain, config);
        if (!opts.max && (opts.amount === undefined || opts.amount === "")) {
          throw new Error("Provide --amount <n> or --max");
        }
        const { walletClient, account, publicClient } = await getWalletWriteContext(chain, opts.password, config);
        const rlusd = getRlusdContractAddress(chain, config);
        const pool = resolveAavePool(chain, config);
        const amount = parseAmountOrMax(opts.amount, Boolean(opts.max), config.rlusd.eth_decimals);

        const approveHash = await walletClient.writeContract({
          address: rlusd,
          abi: RLUSD_ERC20_ABI,
          functionName: "approve",
          args: [pool, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        const repayHash = await walletClient.writeContract({
          address: pool,
          abi: AAVE_POOL_ABI,
          functionName: "repay",
          args: [rlusd, amount, AAVE_VARIABLE_RATE_MODE, account.address],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: repayHash });
        emitTxResult("Repay", chain, repayHash, receipt.status as "success" | "reverted", outputFormat, {
          amount: opts.max ? "max" : (opts.amount ?? ""),
          rate_mode: "variable",
        });
      } catch (err) {
        logger.error(`Aave repay failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  aaveCmd
    .command("status")
    .description("Show Aave account data (collateral, debt, health factor)")
    .option("-c, --chain <chain>", "EVM chain (must be ethereum for Aave pool)")
    .option("--password <password>", "wallet password (optional; uses default wallet address)")
    .action(async (opts: { chain?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveChain(opts, program);
        assertEthereumAave(chain, config);
        void opts.password;
        const walletData = getDefaultWallet(chain);
        if (!walletData || isXrplWallet(walletData)) {
          throw new Error(`No EVM wallet configured for ${chain}`);
        }
        const user = walletData.address as `0x${string}`;
        const pool = resolveAavePool(chain, config);
        const publicClient = getEvmPublicClient(chain);

        const [
          totalCollateralBase,
          totalDebtBase,
          availableBorrowsBase,
          currentLiquidationThreshold,
          ltv,
          healthFactor,
        ] = await publicClient.readContract({
          address: pool,
          abi: AAVE_POOL_ABI,
          functionName: "getUserAccountData",
          args: [user],
        });

        const hfDisplay =
          healthFactor === maxUint256
            ? "infinity (no debt)"
            : formatUnits(healthFactor, HEALTH_FACTOR_DECIMALS);

        const data = {
          chain,
          user,
          pool,
          total_collateral_base: formatUnits(totalCollateralBase, BASE_CURRENCY_DECIMALS),
          total_debt_base: formatUnits(totalDebtBase, BASE_CURRENCY_DECIMALS),
          available_borrows_base: formatUnits(availableBorrowsBase, BASE_CURRENCY_DECIMALS),
          current_liquidation_threshold_bps: currentLiquidationThreshold.toString(),
          current_liquidation_threshold_pct: (Number(currentLiquidationThreshold) / 100).toFixed(2),
          ltv_bps: ltv.toString(),
          ltv_pct: (Number(ltv) / 100).toFixed(2),
          health_factor: hfDisplay,
          health_factor_raw: healthFactor.toString(),
        };

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput(data, outputFormat));
        } else {
          logger.label("User", user);
          logger.label("Total collateral (base)", data.total_collateral_base);
          logger.label("Total debt (base)", data.total_debt_base);
          logger.label("Available borrows (base)", data.available_borrows_base);
          logger.label("LTV", `${data.ltv_pct}%`);
          logger.label("Liquidation threshold", `${data.current_liquidation_threshold_pct}%`);
          logger.label("Health factor", hfDisplay);
        }
      } catch (err) {
        logger.error(`Aave status failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}

function emitTxResult(
  label: string,
  chain: EvmChainName,
  hash: `0x${string}`,
  status: "success" | "reverted",
  outputFormat: OutputFormat,
  extra: Record<string, string>,
): void {
  const row = {
    action: label,
    chain,
    hash,
    status,
    ...extra,
  };
  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(row, outputFormat));
  } else {
    if (status === "success") {
      logger.success(`${label} transaction confirmed`);
    } else {
      logger.error(`${label} transaction reverted`);
      process.exitCode = 1;
    }
    logger.label("Tx Hash", hash);
  }
}

type DefiVenue = {
  venue: string;
  capabilities: string[];
  approval_mode: "approve";
  collateral_supported: boolean;
  status: "active" | "preview";
  notes: string[];
};

const DEFI_VENUES: DefiVenue[] = [
  {
    venue: "aave",
    capabilities: ["lend", "borrow"],
    approval_mode: "approve",
    collateral_supported: false,
    status: "active",
    notes: ["preview_only"],
  },
  {
    venue: "curve",
    capabilities: ["swap", "lp"],
    approval_mode: "approve",
    collateral_supported: false,
    status: "preview",
    notes: ["routing_only"],
  },
  {
    venue: "uniswap",
    capabilities: ["swap", "lp"],
    approval_mode: "approve",
    collateral_supported: false,
    status: "active",
    notes: ["routing_only"],
  },
];

function emitEnvelope(value: unknown): void {
  if (value && typeof value === "object" && !Array.isArray(value) && (value as { ok?: boolean }).ok === false) {
    console.error(JSON.stringify(value, null, 2));
    return;
  }
  logger.raw(JSON.stringify(value, null, 2));
}

function buildDefiAsset(config: ReturnType<typeof loadConfig>): ResolvedAsset {
  return {
    symbol: "RLUSD",
    name: "Ripple USD",
    chain: "ethereum",
    family: "evm",
    address: getRlusdContractAddress("ethereum", config),
    decimals: config.rlusd.eth_decimals,
  };
}

function getVenue(venue: string): DefiVenue | undefined {
  return DEFI_VENUES.find((candidate) => candidate.venue === venue);
}

function parseCapabilityFilter(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseSlippageBps(raw?: string): number {
  const value = Number.parseInt(raw || "50", 10);
  if (!Number.isInteger(value) || value < 0 || value > 5000) {
    throw new Error("Invalid --slippage. Use basis points between 0 and 5000.");
  }
  return value;
}

function isRetryableUniswapQuoteFailure(venue: string, message: string): boolean {
  if (venue.trim().toLowerCase() !== "uniswap") {
    return false;
  }

  return ![
    "Invalid --fee-tier",
    "Unknown token:",
    "Only RLUSD swap quotes are supported today",
    "Venue uniswap requires a client with simulateContract support.",
  ].some((marker) => message.includes(marker));
}

function requireCurveLpVenue(venue: string): void {
  if (venue.trim().toLowerCase() !== "curve") {
    throw new Error("Only --venue curve is supported for this command today.");
  }
}

function parseLpOperation(raw: string): DefiLpOperation {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "add" || normalized === "remove") {
    return normalized;
  }
  throw new Error("Invalid --operation. Supported values: add, remove.");
}

function resolveDefiChain(opts: { chain?: string }, program: Command, config: ReturnType<typeof loadConfig>): string {
  const raw = opts.chain || program.opts().chain || config.default_chain;
  if (!raw) {
    throw new Error("--chain is required (provide it globally or per-subcommand, or set a default_chain in config)");
  }
  return raw as string;
}

export function registerTopLevelDefiCommand(program: Command): void {
  const defiCmd = program.command("defi").description("Top-level DeFi discovery and prepared execution flows");

  defiCmd
    .command("venues")
    .description("List known DeFi venues for a chain")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .option("--capability <list>", "comma-separated capability filter")
    .action(async (opts: { chain?: string; capability?: string }) => {
      const config = loadConfig();
      try {
        const resolved = resolveEvmChainRef(resolveDefiChain(opts, program, config), config.environment);
        const capabilityFilter = parseCapabilityFilter(opts.capability);
        const venues = DEFI_VENUES.filter((venue) =>
          capabilityFilter.length === 0 || capabilityFilter.some((capability) => venue.capabilities.includes(capability)),
        );

        emitEnvelope(
          createSuccessEnvelope({
            command: "defi.venues",
            chain: resolved.label,
            timestamp: new Date().toISOString(),
            data: {
              capability_filter: capabilityFilter,
              venues,
            },
          }),
        );
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.venues",
            timestamp: new Date().toISOString(),
            code: "UNSUPPORTED_CHAIN",
            message: error instanceof Error ? error.message : "Unsupported chain.",
          }),
        );
        process.exitCode = 1;
      }
    });

  const quoteCmd = defiCmd.command("quote").description("Read-only DeFi quotes");
  quoteCmd
    .command("swap")
    .description("Get a live swap quote for RLUSD")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--venue <venue>", "venue name")
    .requiredOption("--from <symbol>", "source asset symbol")
    .requiredOption("--to <symbol>", "destination asset symbol")
    .requiredOption("--amount <amount>", "amount of source asset")
    .option("--fee-tier <fee>", "Uniswap pool fee tier", "3000")
    .action(async (opts: { chain?: string; venue: string; from: string; to: string; amount: string; feeTier?: string }) => {
      const config = loadConfig();
      try {
        const resolved = resolveEvmChainRef(resolveDefiChain(opts, program, config), config.environment);
        const adapter = getDefiVenueAdapter(opts.venue);
        const quote = await adapter.quoteSwap({
          chain: resolved,
          config,
          fromSymbol: opts.from,
          toSymbol: opts.to,
          amount: opts.amount,
          feeTier: opts.feeTier,
        });
        emitEnvelope(
          createSuccessEnvelope({
            command: "defi.quote.swap",
            chain: resolved.label,
            timestamp: quote.route.quoted_at,
            data: quote,
            warnings: ["quote_expires"],
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to fetch live quote.";
        const retryable = isRetryableUniswapQuoteFailure(opts.venue, message);
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.quote.swap",
            timestamp: new Date().toISOString(),
            code: "QUOTE_UNAVAILABLE",
            message,
            retryable,
            details: retryable
              ? {
                  retry_hint: "retry_fee_tiers",
                  candidate_fee_tiers: [100, 500, 3000, 10000],
                }
              : undefined,
          }),
        );
        process.exitCode = 1;
      }
    });

  const swapCmd = defiCmd.command("swap").description("Prepared RLUSD swap flows");
  swapCmd
    .command("prepare")
    .description("Prepare a DeFi swap flow")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--venue <venue>", "venue name")
    .requiredOption("--from-wallet <name>", "wallet name to swap from")
    .requiredOption("--from <symbol>", "source asset symbol")
    .requiredOption("--to <symbol>", "destination asset symbol")
    .requiredOption("--amount <amount>", "amount of source asset")
    .option("--slippage <bps>", "max slippage in basis points", "50")
    .option("--fee-tier <fee>", "Uniswap pool fee tier", "3000")
    .action(async (opts: {
      chain?: string;
      venue: string;
      fromWallet: string;
      from: string;
      to: string;
      amount: string;
      slippage?: string;
      feeTier?: string;
    }) => {
      const config = loadConfig();
      try {
        const resolved = resolveEvmChainRef(resolveDefiChain(opts, program, config), config.environment);
        const walletData = resolveWalletForChain(resolved.chain, {
          walletName: opts.fromWallet,
          optionName: "--from-wallet",
        });
        if (isXrplWallet(walletData)) {
          throw new Error(`Selected wallet is not an EVM wallet for ${resolved.chain}.`);
        }

        const adapter = getDefiVenueAdapter(opts.venue);
        const swapPlan = await adapter.buildSwapPlan({
          chain: resolved,
          config,
          walletName: opts.fromWallet,
          walletAddress: walletData.address as `0x${string}`,
          fromSymbol: opts.from,
          toSymbol: opts.to,
          amount: opts.amount,
          slippageBps: parseSlippageBps(opts.slippage),
          feeTier: opts.feeTier,
        });
        const policy = getPreparePolicy(resolved.label, "defi.swap");
        const plan = await createPreparedPlan({
          command: "defi.swap.prepare",
          chain: resolved.label,
          timestamp: new Date().toISOString(),
          action: "defi.swap",
          requires_confirmation: policy.requires_confirmation,
          human_summary: swapPlan.human_summary,
          asset: swapPlan.asset,
          params: swapPlan.params,
          intent: swapPlan.intent,
          warnings: [...new Set([...policy.warnings, ...swapPlan.warnings])],
        });

        emitEnvelope(plan);
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.swap.prepare",
            timestamp: new Date().toISOString(),
            code: "PREPARE_FAILED",
            message: error instanceof Error ? error.message : "Unable to prepare swap flow.",
          }),
        );
        process.exitCode = 1;
      }
    });

  swapCmd
    .command("execute")
    .description("Execute a prepared DeFi swap flow")
    .requiredOption("--plan <path>", "path to a prepared plan file")
    .option("--confirm-plan-id <planId>", "explicit confirmation matching the prepared plan id")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { plan: string; confirmPlanId?: string; password?: string }) => {
      try {
        const plan = await loadPreparedPlan(opts.plan);
        assertExecutableDefiPlan(plan, "defi.swap", "defi.swap.execute", opts.confirmPlanId);
        const config = loadConfig();
        const resolved = resolveEvmChainRef(plan.chain, config.environment);
        const walletName = plan.data.params.from;
        if (!walletName) {
          throw new Error("Prepared plan is missing swap sender.");
        }
        const walletData = resolveWalletForChain(resolved.chain, {
          walletName,
          optionName: "--from-wallet",
        });
        if (isXrplWallet(walletData)) {
          throw new Error(`Selected wallet is not an EVM wallet for ${resolved.chain}.`);
        }

        const rpcUrl = config.chains[resolved.chain]?.rpc;
        if (!rpcUrl) {
          throw new Error(`RPC not configured for ${resolved.chain}`);
        }

        const password = resolveWalletPassword(opts.password, {
          machineReadable: true,
          walletName,
        });
        const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, password);
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: getViemChain(resolved.chain, resolved.network),
          transport: http(rpcUrl),
        });
        const publicClient = getEvmPublicClient(resolved.chain, resolved.network);
        const results = await executePreparedDefiPlan({
          callerLabel: "defi.swap.execute",
          expectedAction: "defi.swap",
          plan,
          walletClient,
          publicClient,
          confirmPlanId: opts.confirmPlanId,
        });

        emitEnvelope(
          createSuccessEnvelope({
            command: "defi.swap.execute",
            chain: plan.chain,
            timestamp: new Date().toISOString(),
            data: {
              plan_id: plan.data.plan_id,
              plan_path: opts.plan,
              action: plan.data.action,
              steps: results,
            },
            warnings: plan.warnings,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to execute prepared swap flow.";
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.swap.execute",
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
      }
    });

  const lpCmd = defiCmd.command("lp").description("Prepared Curve LP flows");
  lpCmd
    .command("preview")
    .description("Preview a DeFi LP flow")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--venue <venue>", "venue name")
    .requiredOption("--operation <operation>", "LP operation: add | remove")
    .option("--rlusd-amount <amount>", "RLUSD amount for add liquidity")
    .option("--usdc-amount <amount>", "USDC amount for add liquidity")
    .option("--lp-amount <amount>", "LP token amount for remove liquidity")
    .option("--receive-token <symbol>", "Token to receive on remove: RLUSD | USDC")
    .action(async (opts: {
      chain?: string;
      venue: string;
      operation: string;
      rlusdAmount?: string;
      usdcAmount?: string;
      lpAmount?: string;
      receiveToken?: string;
    }) => {
      const config = loadConfig();
      try {
        const resolved = resolveEvmChainRef(resolveDefiChain(opts, program, config), config.environment);
        requireCurveLpVenue(opts.venue);
        const preview = await getDefiVenueAdapter(opts.venue).previewLp({
          chain: resolved,
          config,
          operation: parseLpOperation(opts.operation),
          rlusdAmount: opts.rlusdAmount,
          usdcAmount: opts.usdcAmount,
          lpAmount: opts.lpAmount,
          receiveToken: opts.receiveToken,
        });

        emitEnvelope(
          createSuccessEnvelope({
            command: "defi.lp.preview",
            chain: resolved.label,
            timestamp: preview.quoted_at,
            data: preview,
            warnings: ["quote_expires"],
          }),
        );
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.lp.preview",
            timestamp: new Date().toISOString(),
            code: "PREVIEW_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Unable to preview LP flow.",
          }),
        );
        process.exitCode = 1;
      }
    });

  lpCmd
    .command("prepare")
    .description("Prepare a DeFi LP flow")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--venue <venue>", "venue name")
    .requiredOption("--operation <operation>", "LP operation: add | remove")
    .requiredOption("--from-wallet <name>", "wallet name to provide liquidity from")
    .option("--rlusd-amount <amount>", "RLUSD amount for add liquidity")
    .option("--usdc-amount <amount>", "USDC amount for add liquidity")
    .option("--lp-amount <amount>", "LP token amount for remove liquidity")
    .option("--receive-token <symbol>", "Token to receive on remove: RLUSD | USDC")
    .option("--slippage <bps>", "max slippage in basis points", "50")
    .action(async (opts: {
      chain?: string;
      venue: string;
      operation: string;
      fromWallet: string;
      rlusdAmount?: string;
      usdcAmount?: string;
      lpAmount?: string;
      receiveToken?: string;
      slippage?: string;
    }) => {
      const config = loadConfig();
      try {
        const resolved = resolveEvmChainRef(resolveDefiChain(opts, program, config), config.environment);
        requireCurveLpVenue(opts.venue);
        const walletData = resolveWalletForChain(resolved.chain, {
          walletName: opts.fromWallet,
          optionName: "--from-wallet",
        });
        if (isXrplWallet(walletData)) {
          throw new Error(`Selected wallet is not an EVM wallet for ${resolved.chain}.`);
        }

        const lpPlan = await getDefiVenueAdapter(opts.venue).buildLpPlan({
          chain: resolved,
          config,
          walletName: opts.fromWallet,
          walletAddress: walletData.address as `0x${string}`,
          operation: parseLpOperation(opts.operation),
          slippageBps: parseSlippageBps(opts.slippage),
          rlusdAmount: opts.rlusdAmount,
          usdcAmount: opts.usdcAmount,
          lpAmount: opts.lpAmount,
          receiveToken: opts.receiveToken,
        });
        const policy = getPreparePolicy(resolved.label, "defi.lp");
        const plan = await createPreparedPlan({
          command: "defi.lp.prepare",
          chain: resolved.label,
          timestamp: new Date().toISOString(),
          action: "defi.lp",
          requires_confirmation: policy.requires_confirmation,
          human_summary: lpPlan.human_summary,
          asset: lpPlan.asset,
          params: lpPlan.params,
          intent: lpPlan.intent,
          warnings: [...new Set([...policy.warnings, ...lpPlan.warnings])],
        });

        emitEnvelope(plan);
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.lp.prepare",
            timestamp: new Date().toISOString(),
            code: "PREPARE_FAILED",
            message: error instanceof Error ? error.message : "Unable to prepare LP flow.",
          }),
        );
        process.exitCode = 1;
      }
    });

  lpCmd
    .command("execute")
    .description("Execute a prepared DeFi LP flow")
    .requiredOption("--plan <path>", "path to a prepared plan file")
    .option("--confirm-plan-id <planId>", "explicit confirmation matching the prepared plan id")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { plan: string; confirmPlanId?: string; password?: string }) => {
      try {
        const plan = await loadPreparedPlan(opts.plan);
        assertExecutableDefiPlan(plan, "defi.lp", "defi.lp.execute", opts.confirmPlanId);
        const config = loadConfig();
        const resolved = resolveEvmChainRef(plan.chain, config.environment);
        const walletName = plan.data.params.from;
        if (!walletName) {
          throw new Error("Prepared plan is missing LP sender.");
        }
        const walletData = resolveWalletForChain(resolved.chain, {
          walletName,
          optionName: "--from-wallet",
        });
        if (isXrplWallet(walletData)) {
          throw new Error(`Selected wallet is not an EVM wallet for ${resolved.chain}.`);
        }

        const rpcUrl = config.chains[resolved.chain]?.rpc;
        if (!rpcUrl) {
          throw new Error(`RPC not configured for ${resolved.chain}`);
        }

        const password = resolveWalletPassword(opts.password, {
          machineReadable: true,
          walletName,
        });
        const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, password);
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: getViemChain(resolved.chain, resolved.network),
          transport: http(rpcUrl),
        });
        const publicClient = getEvmPublicClient(resolved.chain, resolved.network);
        const results = await executePreparedDefiPlan({
          callerLabel: "defi.lp.execute",
          expectedAction: "defi.lp",
          plan,
          walletClient,
          publicClient,
          confirmPlanId: opts.confirmPlanId,
        });

        emitEnvelope(
          createSuccessEnvelope({
            command: "defi.lp.execute",
            chain: plan.chain,
            timestamp: new Date().toISOString(),
            data: {
              plan_id: plan.data.plan_id,
              plan_path: opts.plan,
              action: plan.data.action,
              steps: results,
            },
            warnings: plan.warnings,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to execute prepared LP flow.";
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.lp.execute",
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
      }
    });

  const supplyCmd = defiCmd.command("supply").description("Prepared RLUSD supply flows");
  supplyCmd
    .command("preview")
    .description("Preview a DeFi supply flow")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--venue <venue>", "venue name")
    .requiredOption("--amount <amount>", "amount of RLUSD to supply")
    .action(async (opts: { chain?: string; venue: string; amount: string }) => {
      const config = loadConfig();
      try {
        const resolved = resolveEvmChainRef(resolveDefiChain(opts, program, config), config.environment);
        const venue = getVenue(opts.venue);
        if (!venue) {
          throw new Error(`Venue ${opts.venue} is not configured on ${resolved.label}.`);
        }
        if (!venue.capabilities.includes("lend")) {
          throw new Error(`Venue ${opts.venue} does not support lend on ${resolved.label}.`);
        }

        emitEnvelope(
          createSuccessEnvelope({
            command: "defi.supply.preview",
            chain: resolved.label,
            timestamp: new Date().toISOString(),
            data: {
              venue: opts.venue,
              asset_symbol: "RLUSD",
              amount: opts.amount,
              reference_supply_apy: null,
              collateral_supported: false,
              approval_mode: "approve",
            },
            warnings: ["apy_unavailable", "preview_only", "collateral_unsupported"],
          }),
        );
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.supply.preview",
            timestamp: new Date().toISOString(),
            code: "PREVIEW_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Unable to preview supply flow.",
          }),
        );
        process.exitCode = 1;
      }
    });

  supplyCmd
    .command("prepare")
    .description("Prepare a DeFi supply flow")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--venue <venue>", "venue name")
    .requiredOption("--from-wallet <name>", "wallet name to supply from")
    .requiredOption("--amount <amount>", "amount of RLUSD to supply")
    .action(async (opts: { chain?: string; venue: string; fromWallet: string; amount: string }) => {
      const config = loadConfig();
      try {
        const resolved = resolveEvmChainRef(resolveDefiChain(opts, program, config), config.environment);
        const venue = getVenue(opts.venue);
        if (!venue || !venue.capabilities.includes("lend")) {
          throw new Error(`Venue ${opts.venue} does not support lend on ${resolved.label}.`);
        }

        const walletData = resolveWalletForChain(resolved.chain, {
          walletName: opts.fromWallet,
          optionName: "--from-wallet",
        });
        if (isXrplWallet(walletData)) {
          throw new Error(`Selected wallet is not an EVM wallet for ${resolved.chain}.`);
        }

        const amountRaw = parseUnits(opts.amount, config.rlusd.eth_decimals);
        const asset = buildDefiAsset(config);
        const pool = resolveAavePool(resolved.chain, config);
        const plan = await createPreparedPlan({
          command: "defi.supply.prepare",
          chain: resolved.label,
          timestamp: new Date().toISOString(),
          action: "defi.supply",
          requires_confirmation: resolved.network === "mainnet",
          human_summary: `Supply ${opts.amount} RLUSD to ${opts.venue} from ${opts.fromWallet} on ${resolved.label === "ethereum-mainnet" ? "Ethereum Mainnet" : "Ethereum Sepolia"}`,
          asset,
          params: {
            venue: opts.venue,
            from: opts.fromWallet,
            amount: opts.amount,
          },
          intent: {
            venue: opts.venue,
            steps: [
              {
                step: "approve",
                to: asset.address,
                value: "0",
                data: encodeFunctionData({
                  abi: RLUSD_ERC20_ABI,
                  functionName: "approve",
                  args: [pool, amountRaw],
                }),
              },
              {
                step: "supply",
                to: pool,
                value: "0",
                data: encodeFunctionData({
                  abi: AAVE_POOL_ABI,
                  functionName: "supply",
                  args: [asset.address as `0x${string}`, amountRaw, walletData.address as `0x${string}`, 0],
                }),
              },
            ],
          },
          warnings:
            resolved.network === "mainnet"
              ? ["mainnet", "real_funds", "token_allowance", "collateral_unsupported"]
              : ["collateral_unsupported"],
        });

        emitEnvelope(plan);
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.supply.prepare",
            timestamp: new Date().toISOString(),
            code: "PREPARE_FAILED",
            message: error instanceof Error ? error.message : "Unable to prepare supply flow.",
          }),
        );
        process.exitCode = 1;
      }
    });

  supplyCmd
    .command("execute")
    .description("Execute a prepared DeFi supply flow")
    .requiredOption("--plan <path>", "path to a prepared plan file")
    .option("--confirm-plan-id <planId>", "explicit confirmation matching the prepared plan id")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { plan: string; confirmPlanId?: string; password?: string }) => {
      try {
        const plan = await loadPreparedPlan(opts.plan);
        assertExecutableDefiPlan(plan, "defi.supply", "defi.supply.execute", opts.confirmPlanId);
        const config = loadConfig();
        const resolved = resolveEvmChainRef(plan.chain, config.environment);
        const walletName = plan.data.params.from;
        if (!walletName) {
          throw new Error("Prepared plan is missing supply sender.");
        }
        const walletData = resolveWalletForChain(resolved.chain, {
          walletName,
          optionName: "--from-wallet",
        });
        if (isXrplWallet(walletData)) {
          throw new Error(`Selected wallet is not an EVM wallet for ${resolved.chain}.`);
        }

        const rpcUrl = config.chains[resolved.chain]?.rpc;
        if (!rpcUrl) {
          throw new Error(`RPC not configured for ${resolved.chain}`);
        }

        const password = resolveWalletPassword(opts.password, {
          machineReadable: true,
          walletName,
        });
        const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, password);
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: getViemChain(resolved.chain, resolved.network),
          transport: http(rpcUrl),
        });
        const publicClient = getEvmPublicClient(resolved.chain, resolved.network);
        const results = await executePreparedDefiPlan({
          callerLabel: "defi.supply.execute",
          expectedAction: "defi.supply",
          plan,
          walletClient,
          publicClient,
          confirmPlanId: opts.confirmPlanId,
        });

        emitEnvelope(
          createSuccessEnvelope({
            command: "defi.supply.execute",
            chain: plan.chain,
            timestamp: new Date().toISOString(),
            data: {
              plan_id: plan.data.plan_id,
              plan_path: opts.plan,
              action: plan.data.action,
              steps: results,
            },
            warnings: plan.warnings,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to execute prepared supply flow.";
        emitEnvelope(
          createErrorEnvelope({
            command: "defi.supply.execute",
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
      }
    });
}

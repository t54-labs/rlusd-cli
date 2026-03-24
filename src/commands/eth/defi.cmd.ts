import { Command } from "commander";
import { createWalletClient, http, parseUnits, formatUnits, maxUint256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, base, optimism, baseSepolia, optimismSepolia } from "viem/chains";
import type { Chain } from "viem";
import { loadConfig } from "../../config/config.js";
import { getDefaultWallet, isXrplWallet } from "../../wallet/manager.js";
import { decryptEvmPrivateKey } from "../../wallet/evm-wallet.js";
import { getEvmPublicClient } from "../../clients/evm-client.js";
import { RLUSD_ERC20_ABI } from "../../abi/rlusd-erc20.js";
import { AAVE_POOL_ABI } from "../../abi/aave-pool.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import type { EvmChainName, OutputFormat, StoredEvmWallet, NetworkEnvironment } from "../../types/index.js";
import { AAVE_V3_POOL_ETHEREUM } from "../../config/constants.js";

const AAVE_VARIABLE_RATE_MODE = 2n;
const BASE_CURRENCY_DECIMALS = 8;
const HEALTH_FACTOR_DECIMALS = 18;

function getViemChain(chain: EvmChainName, env: NetworkEnvironment): Chain {
  if (env === "mainnet") {
    switch (chain) {
      case "base":
        return base;
      case "optimism":
        return optimism;
      default:
        return mainnet;
    }
  }
  switch (chain) {
    case "base":
      return baseSepolia;
    case "optimism":
      return optimismSepolia;
    default:
      return sepolia;
  }
}

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
  return raw as EvmChainName;
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

  const pwd = password ?? "default-dev-password";
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
    .option("--password <password>", "wallet password")
    .action(async (opts: { amount: string; chain?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveChain(opts, program);
        assertEthereumAave(chain, config);
        const { walletClient, account, publicClient } = await getWalletWriteContext(chain, opts.password, config);
        const rlusd = config.rlusd.eth_contract as `0x${string}`;
        const pool = AAVE_V3_POOL_ETHEREUM as `0x${string}`;
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
    .option("--password <password>", "wallet password")
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
        const rlusd = config.rlusd.eth_contract as `0x${string}`;
        const pool = AAVE_V3_POOL_ETHEREUM as `0x${string}`;
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
    .option("--password <password>", "wallet password")
    .action(async (opts: { amount: string; chain?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveChain(opts, program);
        assertEthereumAave(chain, config);
        const { walletClient, account, publicClient } = await getWalletWriteContext(chain, opts.password, config);
        const rlusd = config.rlusd.eth_contract as `0x${string}`;
        const pool = AAVE_V3_POOL_ETHEREUM as `0x${string}`;
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
    .option("--password <password>", "wallet password")
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
        const rlusd = config.rlusd.eth_contract as `0x${string}`;
        const pool = AAVE_V3_POOL_ETHEREUM as `0x${string}`;
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
        const pool = AAVE_V3_POOL_ETHEREUM as `0x${string}`;
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
    }
    logger.label("Tx Hash", hash);
  }
}

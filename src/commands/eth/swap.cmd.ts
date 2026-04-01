import { Command } from "commander";
import { createWalletClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../../config/config.js";
import { getDefaultWallet, isXrplWallet } from "../../wallet/manager.js";
import { decryptEvmPrivateKey } from "../../wallet/evm-wallet.js";
import { getEvmPublicClient, getViemChain, resolveEvmChainRef } from "../../clients/evm-client.js";
import { RLUSD_ERC20_ABI } from "../../abi/rlusd-erc20.js";
import { UNISWAP_V3_ROUTER_ABI, UNISWAP_QUOTER_V2_ABI } from "../../abi/uniswap-router.js";
import { WELL_KNOWN_TOKENS } from "../../config/constants.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import type {
  EvmChainName,
  LoadedPreparedPlan,
  OutputFormat,
  StoredEvmWallet,
} from "../../types/index.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../../utils/secrets.js";
import { assertActiveRlusdEvmChain, getRlusdContractAddress } from "../../utils/evm-support.js";
import { executePreparedDefiPlan } from "../../defi/executor.js";
import { getDefiVenueAdapter } from "../../defi/venues/index.js";
import {
  parseFeeTier,
  resolveTokenAddress,
  resolveUniswapQuoter,
  resolveUniswapRouter,
} from "../../defi/venues/uniswap.js";

const DEFAULT_SLIPPAGE_BPS = 50; // 0.5%
const DEFAULT_FEE_TIER = 3000; // 0.3% Uniswap pool fee

function resolveVenueChainRef(
  chain: EvmChainName,
  venue: string,
  config: ReturnType<typeof loadConfig>,
) {
  return resolveEvmChainRef(
    chain,
    venue.trim().toLowerCase() === "curve" ? "mainnet" : config.environment,
  );
}

export function requireUniswapVenue(venue: string): void {
  if (venue.trim().toLowerCase() !== "uniswap") {
    throw new Error("Only --venue uniswap is supported for this command today.");
  }
}

export function registerSwapCommand(parent: Command, program: Command): void {
  const swapCmd = parent.command("swap").description("Swap RLUSD for other tokens on Uniswap V3");

  swapCmd
    .command("sell")
    .description("Sell RLUSD for another token via Uniswap V3 exactInputSingle")
    .requiredOption("--amount <n>", "RLUSD amount to sell")
    .requiredOption("--for <token>", "token to receive: USDC | USDT | WETH | DAI | WBTC")
    .requiredOption("--venue <venue>", "venue name")
    .option("--slippage <bps>", "max slippage in basis points (default: 50 = 0.5%)", String(DEFAULT_SLIPPAGE_BPS))
    .option("--fee-tier <fee>", "Uniswap pool fee tier: 100 | 500 | 3000 | 10000", String(DEFAULT_FEE_TIER))
    .option("-c, --chain <chain>", "EVM chain (default: ethereum)")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .option("--dry-run", "simulate without submitting")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      const chain = (opts.chain || program.opts().chain || "ethereum") as EvmChainName;

      const outToken = resolveTokenAddress(opts.for);
      if (!outToken) {
        logger.error(`Unknown token: ${opts.for}. Supported tokens: ${Object.keys(WELL_KNOWN_TOKENS).join(", ")}`);
        logger.dim(`Known tokens: ${Object.keys(WELL_KNOWN_TOKENS).join(", ")}`);
        process.exitCode = 1;
        return;
      }

      try {
        assertActiveRlusdEvmChain(chain);
        if (opts.venue.trim().toLowerCase() === "uniswap") {
          requireUniswapVenue(opts.venue);
          await executeSwapSell(chain, opts, outToken, config, outputFormat);
        } else {
          await executeAdapterSell(chain, opts, config, outputFormat);
        }
      } catch (err) {
        logger.error(`Swap failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  swapCmd
    .command("buy")
    .description("Buy RLUSD with another token via Uniswap V3")
    .requiredOption("--amount <n>", "RLUSD amount to buy")
    .requiredOption("--with <token>", "token to pay with: USDC | USDT | WETH | DAI | WBTC")
    .requiredOption("--venue <venue>", "venue name")
    .option("--slippage <bps>", "max slippage in basis points (default: 50 = 0.5%)", String(DEFAULT_SLIPPAGE_BPS))
    .option("--fee-tier <fee>", "Uniswap pool fee tier: 100 | 500 | 3000 | 10000", String(DEFAULT_FEE_TIER))
    .option("-c, --chain <chain>", "EVM chain (default: ethereum)")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .option("--dry-run", "simulate without submitting")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      const chain = (opts.chain || program.opts().chain || "ethereum") as EvmChainName;

      const inToken = resolveTokenAddress(opts.with);
      if (!inToken) {
        logger.error(`Unknown token: ${opts.with}. Supported tokens: ${Object.keys(WELL_KNOWN_TOKENS).join(", ")}`);
        process.exitCode = 1;
        return;
      }

      try {
        assertActiveRlusdEvmChain(chain);
        requireUniswapVenue(opts.venue);
        await executeSwapBuy(chain, opts, inToken, config, outputFormat);
      } catch (err) {
        logger.error(`Swap failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  swapCmd
    .command("quote")
    .description("Get a quote for swapping RLUSD (no transaction submitted)")
    .requiredOption("--amount <n>", "RLUSD amount to sell")
    .requiredOption("--for <token>", "token to receive")
    .requiredOption("--venue <venue>", "venue name")
    .option("--fee-tier <fee>", "Uniswap pool fee tier", String(DEFAULT_FEE_TIER))
    .option("-c, --chain <chain>", "EVM chain (default: ethereum)")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      const chain = (opts.chain || program.opts().chain || "ethereum") as EvmChainName;

      const outToken = resolveTokenAddress(opts.for);
      if (!outToken) {
        logger.error(`Unknown token: ${opts.for}`);
        process.exitCode = 1;
        return;
      }

      try {
        assertActiveRlusdEvmChain(chain);
        const quote = await getDefiVenueAdapter(opts.venue).quoteSwap({
          chain: resolveVenueChainRef(chain, opts.venue, config),
          config,
          fromSymbol: "RLUSD",
          toSymbol: opts.for,
          amount: opts.amount,
          feeTier: opts.feeTier,
        });

        const data = {
          venue: quote.route.venue,
          sell: `${opts.amount} RLUSD`,
          receive: `~${quote.route.amount_out} ${opts.for.toUpperCase()}`,
          gas_estimate: quote.route.gas_estimate,
          ...(quote.route.fee_bps ? { fee_tier: `${quote.route.fee_bps / 100}%` } : {}),
        };

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput(data, outputFormat));
        } else {
          logger.success(`${String(quote.route.venue).toUpperCase()} Quote`);
          logger.label("Venue", String(quote.route.venue));
          logger.label("Sell", `${opts.amount} RLUSD`);
          logger.label("Receive (est.)", `${quote.route.amount_out} ${opts.for.toUpperCase()}`);
          if (quote.route.fee_bps) {
            logger.label("Pool Fee", `${quote.route.fee_bps / 100}%`);
          }
          logger.label("Gas Estimate", quote.route.gas_estimate);
        }
      } catch (err) {
        logger.error(`Quote failed: ${(err as Error).message}`);
        if (opts.venue.trim().toLowerCase() === "uniswap") {
          logger.dim("This may mean no Uniswap pool exists for this pair/fee tier.");
        }
        process.exitCode = 1;
      }
    });

  swapCmd
    .command("tokens")
    .description("List well-known tokens available for swapping")
    .action(() => {
      const outputFormat = (program.opts().output as OutputFormat) || loadConfig().output_format;
      const rows = Object.entries(WELL_KNOWN_TOKENS).map(([symbol, info]) => ({
        symbol,
        name: info.name,
        address: info.address,
        decimals: info.decimals.toString(),
      }));
      logger.raw(formatOutput(rows, outputFormat, ["symbol", "name", "address", "decimals"]));
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyWalletClient = any;

function parseSlippageBps(raw: string | undefined): number {
  const value = Number.parseInt(raw || String(DEFAULT_SLIPPAGE_BPS), 10);
  if (!Number.isInteger(value) || value < 0 || value > 5000) {
    throw new Error("Invalid --slippage. Use basis points between 0 and 5000.");
  }
  return value;
}

async function getWalletContext(
  chainRef: ReturnType<typeof resolveVenueChainRef>,
  password: string | undefined,
  config: ReturnType<typeof loadConfig>,
): Promise<{
  walletClient: AnyWalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
  publicClient: ReturnType<typeof getEvmPublicClient>;
  walletName: string;
}> {
  const walletData = getDefaultWallet(chainRef.chain);
  if (!walletData || isXrplWallet(walletData)) {
    throw new Error(`No EVM wallet for ${chainRef.chain}. Run: rlusd wallet generate --chain ${chainRef.chain}`);
  }
  const pwd = resolveWalletPassword(password, { walletName: walletData.name });
  const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, pwd);
  const viemChain = getViemChain(chainRef.chain, chainRef.network);
  const rpcUrl = config.chains[chainRef.chain]?.rpc;
  if (!rpcUrl) throw new Error(`RPC not configured for ${chainRef.chain}`);

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) });
  const publicClient = getEvmPublicClient(chainRef.chain, chainRef.network);
  return { walletClient, account, publicClient, walletName: walletData.name };
}

async function executeAdapterSell(
  chain: EvmChainName,
  opts: { venue: string; amount: string; for: string; slippage?: string; feeTier?: string; password?: string; dryRun?: boolean },
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const resolved = resolveVenueChainRef(chain, opts.venue, config);
  const { walletClient, account, publicClient, walletName } = await getWalletContext(
    resolved,
    opts.password,
    config,
  );
  const swapPlan = await getDefiVenueAdapter(opts.venue).buildSwapPlan({
    chain: resolved,
    config,
    walletName,
    walletAddress: account.address,
    fromSymbol: "RLUSD",
    toSymbol: opts.for,
    amount: opts.amount,
    slippageBps: parseSlippageBps(opts.slippage),
    feeTier: opts.feeTier,
  });

  if (opts.dryRun) {
    logger.raw(
      formatOutput(
        {
          venue: opts.venue.toLowerCase(),
          action: "sell_rlusd",
          chain: resolved.label,
          steps: swapPlan.intent.steps,
        },
        outputFormat,
      ),
    );
    return;
  }

  const plan: LoadedPreparedPlan = {
    ok: true,
    command: "eth.swap.sell",
    chain: resolved.label,
    timestamp: new Date().toISOString(),
    data: {
      plan_id: "legacy_eth_swap_sell",
      plan_path: "",
      action: "defi.swap",
      requires_confirmation: false,
      human_summary: swapPlan.human_summary,
      asset: swapPlan.asset,
      params: swapPlan.params,
      intent: swapPlan.intent,
    },
    warnings: swapPlan.warnings,
    next: [],
  };
  const results = await executePreparedDefiPlan({
    callerLabel: "eth.swap.sell",
    expectedAction: "defi.swap",
    plan,
    walletClient,
    publicClient,
  });

  logger.raw(
    formatOutput(
      {
        status: "success",
        action: "sell_rlusd",
        chain: resolved.label,
        venue: opts.venue.toLowerCase(),
        steps: results,
      },
      outputFormat,
    ),
  );
}

async function executeSwapSell(
  chain: EvmChainName,
  opts: { amount: string; slippage?: string; feeTier?: string; password?: string; dryRun?: boolean },
  outToken: { address: string; decimals: number },
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const rlusdAddress = getRlusdContractAddress(chain, config);
  const routerAddress = resolveUniswapRouter(chain, config);
  const amountIn = parseUnits(opts.amount, config.rlusd.eth_decimals);
  const slippageBps = parseSlippageBps(opts.slippage);
  const fee = parseFeeTier(opts.feeTier);

  const { walletClient, account, publicClient } = await getWalletContext(chain, opts.password, config);
  const quoteResult = await publicClient.simulateContract({
    address: resolveUniswapQuoter(chain, config),
    abi: UNISWAP_QUOTER_V2_ABI,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: rlusdAddress,
        tokenOut: outToken.address as `0x${string}`,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const [quotedAmountOut] = quoteResult.result;
  const amountOutMin =
    quotedAmountOut - (quotedAmountOut * BigInt(slippageBps)) / 10_000n;

  if (opts.dryRun) {
    logger.info("Dry run — no transaction will be submitted");
    logger.label("Action", "Sell RLUSD via Uniswap V3");
    logger.label("Amount In", `${opts.amount} RLUSD`);
    logger.label("Token Out", outToken.address);
    logger.label("Fee Tier", `${fee / 10000}%`);
    logger.label("Slippage", `${slippageBps / 100}%`);
    logger.label(
      "Quoted Amount Out",
      `${formatUnits(quotedAmountOut, outToken.decimals)} token units`,
    );
    logger.label(
      "Minimum Amount Out",
      `${formatUnits(amountOutMin, outToken.decimals)} token units`,
    );
    logger.label("Router", routerAddress);
    return;
  }

  // Step 1: Approve router to spend RLUSD
  logger.info("Approving Uniswap Router to spend RLUSD...");
  const approveHash = await walletClient.writeContract({
    address: rlusdAddress,
    abi: RLUSD_ERC20_ABI,
    functionName: "approve",
    args: [routerAddress, amountIn],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  // Step 2: Execute swap
  logger.info("Executing swap on Uniswap V3...");
  const swapHash = await walletClient.writeContract({
    address: routerAddress,
    abi: UNISWAP_V3_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: rlusdAddress,
        tokenOut: outToken.address as `0x${string}`,
        fee,
        recipient: account.address,
        amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });

  const data = {
    status: receipt.status === "success" ? "success" : "failed",
    action: "sell_rlusd",
    chain,
    tx_hash: swapHash,
    amount_in: `${opts.amount} RLUSD`,
    token_out: outToken.address,
    gas_used: receipt.gasUsed.toString(),
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data, outputFormat));
  } else {
    if (receipt.status === "success") {
      logger.success(`Swapped ${opts.amount} RLUSD on Uniswap V3`);
    } else {
      logger.error("Swap transaction reverted");
      process.exitCode = 1;
    }
    logger.label("Tx Hash", swapHash);
    logger.label("Gas Used", receipt.gasUsed.toString());
  }
}

async function executeSwapBuy(
  chain: EvmChainName,
  opts: { amount: string; slippage?: string; feeTier?: string; password?: string; dryRun?: boolean; with: string },
  inToken: { address: string; decimals: number },
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const rlusdAddress = getRlusdContractAddress(chain, config);
  const routerAddress = resolveUniswapRouter(chain, config);
  const fee = parseFeeTier(opts.feeTier);
  const slippageBps = parseSlippageBps(opts.slippage);

  const { walletClient, account, publicClient } = await getWalletContext(chain, opts.password, config);

  const amountOut = parseUnits(opts.amount, config.rlusd.eth_decimals);
  const quoteResult = await publicClient.simulateContract({
    address: resolveUniswapQuoter(chain, config),
    abi: UNISWAP_QUOTER_V2_ABI,
    functionName: "quoteExactOutputSingle",
    args: [
      {
        tokenIn: inToken.address as `0x${string}`,
        tokenOut: rlusdAddress,
        amountOut,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const [quotedAmountIn] = quoteResult.result;
  const amountInMaximum =
    quotedAmountIn + (quotedAmountIn * BigInt(slippageBps)) / 10_000n;

  if (opts.dryRun) {
    logger.info("Dry run — no transaction will be submitted");
    logger.label("Action", "Buy RLUSD via Uniswap V3");
    logger.label("Amount Out", `${opts.amount} RLUSD`);
    logger.label("Token In", `${opts.with.toUpperCase()} (${inToken.address})`);
    logger.label("Fee Tier", `${fee / 10000}%`);
    logger.label("Slippage", `${slippageBps / 100}%`);
    logger.label(
      "Quoted Amount In",
      `${formatUnits(quotedAmountIn, inToken.decimals)} ${opts.with.toUpperCase()}`,
    );
    logger.label(
      "Maximum Amount In",
      `${formatUnits(amountInMaximum, inToken.decimals)} ${opts.with.toUpperCase()}`,
    );
    logger.label("Router", routerAddress);
    return;
  }

  // Step 1: Approve router to spend input token
  logger.info(`Approving Uniswap Router to spend ${opts.with.toUpperCase()}...`);
  const approveHash = await walletClient.writeContract({
    address: inToken.address as `0x${string}`,
    abi: RLUSD_ERC20_ABI, // Standard ERC-20 approve works for any token
    functionName: "approve",
    args: [routerAddress, amountInMaximum],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  // Step 2: Execute swap (exactOutputSingle)
  logger.info("Executing swap on Uniswap V3...");
  const swapHash = await walletClient.writeContract({
    address: routerAddress,
    abi: UNISWAP_V3_ROUTER_ABI,
    functionName: "exactOutputSingle",
    args: [
      {
        tokenIn: inToken.address as `0x${string}`,
        tokenOut: rlusdAddress,
        fee,
        recipient: account.address,
        amountOut,
        amountInMaximum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });

  const data = {
    status: receipt.status === "success" ? "success" : "failed",
    action: "buy_rlusd",
    chain,
    tx_hash: swapHash,
    amount_out: `${opts.amount} RLUSD`,
    token_in: inToken.address,
    gas_used: receipt.gasUsed.toString(),
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data, outputFormat));
  } else {
    if (receipt.status === "success") {
      logger.success(`Bought ${opts.amount} RLUSD via Uniswap V3`);
    } else {
      logger.error("Swap transaction reverted");
      process.exitCode = 1;
    }
    logger.label("Tx Hash", swapHash);
    logger.label("Gas Used", receipt.gasUsed.toString());
  }
}

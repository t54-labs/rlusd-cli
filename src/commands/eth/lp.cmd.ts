import { Command } from "commander";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getEvmPublicClient, getViemChain, resolveEvmChainRef } from "../../clients/evm-client.js";
import { loadConfig, resolveConfigForNetwork } from "../../config/config.js";
import { executePreparedDefiPlan } from "../../defi/executor.js";
import { getDefiVenueAdapter } from "../../defi/venues/index.js";
import { formatOutput } from "../../utils/format.js";
import type {
  DefiLpOperation,
  EvmChainName,
  LoadedPreparedPlan,
  OutputFormat,
  StoredEvmWallet,
} from "../../types/index.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../../utils/secrets.js";
import { assertActiveRlusdEvmChain } from "../../utils/evm-support.js";
import { logger } from "../../utils/logger.js";
import { resolveWalletForChain, isXrplWallet } from "../../wallet/manager.js";
import { decryptEvmPrivateKey } from "../../wallet/evm-wallet.js";

function parseLpOperation(raw: string): DefiLpOperation {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "add" || normalized === "remove") {
    return normalized;
  }
  throw new Error("Invalid --operation. Supported values: add, remove.");
}

function resolveLegacyChain(chain: string | undefined, program: Command): EvmChainName {
  const raw = (chain || program.opts().chain || "ethereum") as string;
  if (raw === "xrpl") {
    throw new Error("LP commands require an EVM chain (use --chain ethereum)");
  }
  const resolved = raw as EvmChainName;
  assertActiveRlusdEvmChain(resolved);
  return resolved;
}

function requireCurveVenue(venue: string): void {
  if (venue.trim().toLowerCase() !== "curve") {
    throw new Error("Only --venue curve is supported for this command today.");
  }
}

function resolveVenueChainRef(chain: EvmChainName) {
  return resolveEvmChainRef(chain, "mainnet");
}

function buildLegacyPlan(input: {
  command: string;
  chain: string;
  action: "defi.lp";
  human_summary: string;
  asset: LoadedPreparedPlan["data"]["asset"];
  params: Record<string, string>;
  intent: Record<string, unknown>;
  warnings: string[];
}): LoadedPreparedPlan {
  return {
    ok: true,
    command: input.command,
    chain: input.chain,
    timestamp: new Date().toISOString(),
    data: {
      plan_id: `legacy_${input.command.replace(/\W+/g, "_")}`,
      plan_path: "",
      action: input.action,
      requires_confirmation: false,
      human_summary: input.human_summary,
      asset: input.asset,
      params: input.params,
      intent: input.intent,
    },
    warnings: input.warnings,
    next: [],
  };
}

async function executeLpPlan(input: {
  chain: EvmChainName;
  chainRef: ReturnType<typeof resolveVenueChainRef>;
  command: string;
  plan: ReturnType<typeof buildLegacyPlan>;
  password?: string;
  config: ReturnType<typeof loadConfig>;
}) {
  const walletName = input.plan.data.params.from;
  const walletData = resolveWalletForChain(input.chain, {
    walletName,
    optionName: "--from-wallet",
  });
  if (isXrplWallet(walletData)) {
    throw new Error(`Selected wallet is not an EVM wallet for ${input.chain}.`);
  }

  const rpcUrl = input.config.chains[input.chain]?.rpc;
  if (!rpcUrl) {
    throw new Error(`RPC not configured for ${input.chain}`);
  }

  const password = resolveWalletPassword(input.password, { walletName });
  const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, password);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: getViemChain(input.chainRef.chain, input.chainRef.network),
    transport: http(rpcUrl),
  });
  const publicClient = getEvmPublicClient(input.chainRef.chain, input.chainRef.network);

  return executePreparedDefiPlan({
    callerLabel: input.command,
    expectedAction: "defi.lp",
    plan: input.plan,
    walletClient,
    publicClient,
  });
}

export function registerLpCommand(parent: Command, program: Command): void {
  const lpCmd = parent.command("lp").description("Curve LP convenience wrappers");

  lpCmd
    .command("quote")
    .description("Quote a Curve LP add/remove flow")
    .requiredOption("--venue <venue>", "venue name")
    .requiredOption("--operation <operation>", "LP operation: add | remove")
    .option("-c, --chain <chain>", "EVM chain (default: ethereum)")
    .option("--rlusd-amount <amount>", "RLUSD amount for add liquidity")
    .option("--usdc-amount <amount>", "USDC amount for add liquidity")
    .option("--lp-amount <amount>", "LP token amount for remove liquidity")
    .option("--receive-token <symbol>", "Token to receive on remove: RLUSD | USDC")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      try {
        requireCurveVenue(opts.venue);
        const chain = resolveLegacyChain(opts.chain, program);
        const chainRef = resolveVenueChainRef(chain);
        const resolvedConfig = resolveConfigForNetwork(chainRef.network);
        const preview = await getDefiVenueAdapter(opts.venue).previewLp({
          chain: chainRef,
          config: resolvedConfig,
          operation: parseLpOperation(opts.operation),
          rlusdAmount: opts.rlusdAmount,
          usdcAmount: opts.usdcAmount,
          lpAmount: opts.lpAmount,
          receiveToken: opts.receiveToken,
        });
        logger.raw(formatOutput(preview as Record<string, unknown>, outputFormat));
      } catch (error) {
        logger.error(`LP quote failed: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  lpCmd
    .command("add")
    .description("Add RLUSD/USDC liquidity on Curve")
    .requiredOption("--venue <venue>", "venue name")
    .option("-c, --chain <chain>", "EVM chain (default: ethereum)")
    .option("--from-wallet <name>", "wallet name to provide liquidity from")
    .requiredOption("--rlusd-amount <amount>", "RLUSD amount for add liquidity")
    .requiredOption("--usdc-amount <amount>", "USDC amount for add liquidity")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .option("--dry-run", "build the plan without submitting")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      try {
        requireCurveVenue(opts.venue);
        const chain = resolveLegacyChain(opts.chain, program);
        const chainRef = resolveVenueChainRef(chain);
        const resolvedConfig = resolveConfigForNetwork(chainRef.network);
        const wallet = resolveWalletForChain(chain, {
          walletName: opts.fromWallet,
          optionName: "--from-wallet",
        });
        if (isXrplWallet(wallet)) {
          throw new Error(`Selected wallet is not an EVM wallet for ${chain}.`);
        }

        const lpPlan = await getDefiVenueAdapter(opts.venue).buildLpPlan({
          chain: chainRef,
          config: resolvedConfig,
          walletName: wallet.name,
          walletAddress: wallet.address as `0x${string}`,
          operation: "add",
          slippageBps: 50,
          rlusdAmount: opts.rlusdAmount,
          usdcAmount: opts.usdcAmount,
        });

        if (opts.dryRun) {
          logger.raw(
            formatOutput(
              {
                venue: opts.venue.toLowerCase(),
                operation: "add",
                steps: lpPlan.intent.steps,
              },
              outputFormat,
            ),
          );
          return;
        }

        const results = await executeLpPlan({
          chain,
          chainRef,
          command: "eth.lp.add",
          plan: buildLegacyPlan({
            command: "eth.lp.add",
            chain: chainRef.label,
            action: "defi.lp",
            human_summary: lpPlan.human_summary,
            asset: lpPlan.asset,
            params: lpPlan.params,
            intent: lpPlan.intent,
            warnings: lpPlan.warnings,
          }),
          password: opts.password,
          config: resolvedConfig,
        });
        logger.raw(formatOutput({ venue: "curve", operation: "add", steps: results }, outputFormat));
      } catch (error) {
        logger.error(`LP add failed: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });

  lpCmd
    .command("remove")
    .description("Remove RLUSD/USDC liquidity on Curve")
    .requiredOption("--venue <venue>", "venue name")
    .option("-c, --chain <chain>", "EVM chain (default: ethereum)")
    .option("--from-wallet <name>", "wallet name to remove liquidity from")
    .requiredOption("--lp-amount <amount>", "LP token amount to burn")
    .requiredOption("--receive-token <symbol>", "Token to receive: RLUSD | USDC")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .option("--dry-run", "build the plan without submitting")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      try {
        requireCurveVenue(opts.venue);
        const chain = resolveLegacyChain(opts.chain, program);
        const chainRef = resolveVenueChainRef(chain);
        const resolvedConfig = resolveConfigForNetwork(chainRef.network);
        const wallet = resolveWalletForChain(chain, {
          walletName: opts.fromWallet,
          optionName: "--from-wallet",
        });
        if (isXrplWallet(wallet)) {
          throw new Error(`Selected wallet is not an EVM wallet for ${chain}.`);
        }

        const lpPlan = await getDefiVenueAdapter(opts.venue).buildLpPlan({
          chain: chainRef,
          config: resolvedConfig,
          walletName: wallet.name,
          walletAddress: wallet.address as `0x${string}`,
          operation: "remove",
          slippageBps: 50,
          lpAmount: opts.lpAmount,
          receiveToken: opts.receiveToken,
        });

        if (opts.dryRun) {
          logger.raw(
            formatOutput(
              {
                venue: opts.venue.toLowerCase(),
                operation: "remove",
                steps: lpPlan.intent.steps,
              },
              outputFormat,
            ),
          );
          return;
        }

        const results = await executeLpPlan({
          chain,
          chainRef,
          command: "eth.lp.remove",
          plan: buildLegacyPlan({
            command: "eth.lp.remove",
            chain: chainRef.label,
            action: "defi.lp",
            human_summary: lpPlan.human_summary,
            asset: lpPlan.asset,
            params: lpPlan.params,
            intent: lpPlan.intent,
            warnings: lpPlan.warnings,
          }),
          password: opts.password,
          config: resolvedConfig,
        });
        logger.raw(formatOutput({ venue: "curve", operation: "remove", steps: results }, outputFormat));
      } catch (error) {
        logger.error(`LP remove failed: ${(error as Error).message}`);
        process.exitCode = 1;
      }
    });
}

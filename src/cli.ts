import { Command } from "commander";
import { registerConfigCommand } from "./commands/config.cmd.js";
import { registerWalletCommand } from "./commands/wallet.cmd.js";
import { registerBalanceCommand } from "./commands/balance.cmd.js";
import { registerSendCommand } from "./commands/send.cmd.js";
import { registerFaucetCommand } from "./commands/faucet.cmd.js";
import { registerTrustlineCommand } from "./commands/xrpl/trustline.cmd.js";
import { registerCompletionCommand } from "./commands/completion.cmd.js";
import { registerDexCommand } from "./commands/xrpl/dex.cmd.js";
import { registerAmmCommand } from "./commands/xrpl/amm.cmd.js";
import { registerPathfindCommand } from "./commands/xrpl/pathfind.cmd.js";
import { registerTxCommand } from "./commands/tx.cmd.js";
import { registerPriceCommand } from "./commands/price.cmd.js";
import { registerApproveCommand } from "./commands/eth/approve.cmd.js";
import { registerDefiCommand } from "./commands/eth/defi.cmd.js";
import { registerSwapCommand } from "./commands/eth/swap.cmd.js";
import { registerBridgeCommand } from "./commands/bridge.cmd.js";
import { beginAgentCapture, endAgentCapture, isAgentCaptureActive } from "./agent/envelope.js";
import { loadConfig } from "./config/config.js";
import { logger } from "./utils/logger.js";
import packageJson from "../package.json";

const VERSION = packageJson.version;

function getCommandPath(actionCommand: Command): string {
  const segments: string[] = [];
  let current: Command | null = actionCommand;

  while (current && current.parent) {
    segments.unshift(current.name());
    current = current.parent;
  }

  return segments.join(" ");
}

function getEnvelopeChainLabel(chain: string, network: string): string {
  if (chain === "xrpl") {
    return `xrpl-${network}`;
  }

  const networkSuffix = network === "mainnet" ? "mainnet" : "sepolia";
  return `${chain}-${networkSuffix}`;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("rlusd")
    .description(
      "Multi-chain CLI for Ripple USD (RLUSD) stablecoin operations across XRPL, Ethereum, and L2 networks",
    )
    .version(VERSION)
    .option(
      "--chain <chain>",
      "target chain: xrpl | ethereum | base | optimism | ink | unichain",
    )
    .option("--output <format>", "output format: table | json | json-compact", "table")
    .option("--json", "emit machine-readable agent envelopes")
    .option("--network <network>", "override network: mainnet | testnet | devnet")
    .option("--verbose", "show detailed output")
    .allowUnknownOption(false);

  program.hook("preAction", (thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals();
    const machineJson = Boolean(opts.json);
    const config = loadConfig();
    const resolvedChain = (opts.chain || config.default_chain) as string;
    const resolvedNetwork =
      opts.network && ["mainnet", "testnet", "devnet"].includes(opts.network)
        ? opts.network
        : config.environment;

    if (machineJson) {
      thisCommand.setOptionValueWithSource("output", "json", "implied");
      actionCommand.setOptionValueWithSource("output", "json", "implied");
      beginAgentCapture(getCommandPath(actionCommand), getEnvelopeChainLabel(resolvedChain, resolvedNetwork));
    }

    if (opts.network && !["mainnet", "testnet", "devnet"].includes(opts.network)) {
      logger.error(`Invalid --network value: ${opts.network}. Use mainnet, testnet, or devnet.`);
      process.exitCode = 1;
      return;
    }

    process.env.RLUSD_RUNTIME_NETWORK = opts.network || "";
    process.env.RLUSD_RUNTIME_OUTPUT = machineJson ? "json" : (opts.output || "");
    process.env.RLUSD_RUNTIME_CHAIN = opts.chain || "";
    logger.setVerbose(Boolean(opts.verbose));

    if (opts.verbose) {
      logger.debug(
        `runtime overrides => chain=${opts.chain || "none"}, output=${opts.output || "none"}, network=${opts.network || "none"}`,
      );
    }
  });

  program.hook("postAction", () => {
    if (isAgentCaptureActive()) {
      endAgentCapture();
    }
    delete process.env.RLUSD_RUNTIME_NETWORK;
    delete process.env.RLUSD_RUNTIME_OUTPUT;
    delete process.env.RLUSD_RUNTIME_CHAIN;
    logger.setVerbose(false);
  });

  registerConfigCommand(program);
  registerWalletCommand(program);
  registerBalanceCommand(program);
  registerSendCommand(program);
  registerFaucetCommand(program);
  registerTxCommand(program);
  registerPriceCommand(program);
  registerBridgeCommand(program);

  const xrplCmd = program.command("xrpl").description("XRPL-specific operations");
  registerTrustlineCommand(xrplCmd, program);
  registerDexCommand(xrplCmd, program);
  registerAmmCommand(xrplCmd, program);
  registerPathfindCommand(xrplCmd, program);

  const ethCmd = program.command("eth").description("Ethereum / EVM RLUSD token and DeFi commands");
  registerApproveCommand(ethCmd, program);
  registerDefiCommand(ethCmd, program);
  registerSwapCommand(ethCmd, program);

  registerCompletionCommand(program);

  return program;
}

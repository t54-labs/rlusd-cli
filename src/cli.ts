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
import { registerBridgeCommand } from "./commands/bridge.cmd.js";

const VERSION = "0.1.0";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("rlusd")
    .description(
      "Multi-chain CLI for Ripple USD (RLUSD) stablecoin operations across XRPL, Ethereum, and L2 networks",
    )
    .version(VERSION)
    .option("--chain <chain>", "target chain: xrpl | ethereum | base | optimism | ink | unichain")
    .option("--output <format>", "output format: table | json | json-compact", "table")
    .option("--network <network>", "override network: mainnet | testnet | devnet")
    .option("--verbose", "show detailed output")
    .allowExcessArguments(true)
    .allowUnknownOption(false);

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

  registerCompletionCommand(program);

  return program;
}

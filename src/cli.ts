import { Command } from "commander";
import { registerConfigCommand } from "./commands/config.cmd.js";
import { registerWalletCommand } from "./commands/wallet.cmd.js";
import { registerBalanceCommand } from "./commands/balance.cmd.js";

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

  return program;
}

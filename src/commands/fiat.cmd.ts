import { Command } from "commander";

import { loadConfig } from "../config/config.js";
import { formatOutput } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { OutputFormat } from "../types/index.js";

function writeData(program: Command, data: Record<string, unknown>): void {
  const config = loadConfig();
  const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
  logger.raw(formatOutput(data, outputFormat));
}

export function registerFiatCommand(program: Command): void {
  const fiatCmd = program.command("fiat").description("Reference guidance for RLUSD fiat on/off ramp flows");

  fiatCmd
    .command("onboarding")
    .description("Fiat onboarding reference flows")
    .command("checklist")
    .description("Show the RLUSD fiat onboarding checklist")
    .action(() => {
      writeData(program, {
        steps: [
          "Install or update rlusd-cli to the latest cutover-ready version.",
          "Set RLUSD_WALLET_PASSWORD and generate or import the wallet for your target chain.",
          "Resolve RLUSD metadata for the destination chain with `rlusd resolve asset`.",
          "For XRPL, prepare and execute a trust line before receiving RLUSD.",
          "Use the fiat buy instructions to choose a provider and confirm supported rails.",
        ],
      });
    });

  fiatCmd
    .command("buy")
    .description("Reference buy-side fiat guidance")
    .command("instructions")
    .description("Show fiat buy instructions for RLUSD")
    .action(() => {
      writeData(program, {
        providers: [
          {
            provider: "MoonPay",
            rails: ["card", "apple_pay", "bank_transfer"],
            notes: ["manual_process", "banking_rail_timing"],
          },
          {
            provider: "Transak",
            rails: ["card", "bank_transfer"],
            notes: ["manual_process", "provider_availability_varies"],
          },
        ],
        reminder:
          "Confirm provider support for your destination chain and make sure the receiving wallet or trust line is ready before purchase.",
      });
    });

  fiatCmd
    .command("redeem")
    .description("Reference redeem-side fiat guidance")
    .command("instructions")
    .description("Show fiat redemption instructions for RLUSD")
    .action(() => {
      writeData(program, {
        providers: [
          {
            provider: "MoonPay",
            rails: ["bank_transfer", "card", "paypal"],
            notes: ["manual_process", "banking_rail_timing"],
          },
          {
            provider: "Institutional desk",
            rails: ["wire", "otc"],
            notes: ["manual_process", "counterparty_checks_required"],
          },
        ],
        reminder:
          "Verify redemption minimums, provider region support, and settlement timing before sending RLUSD to an off-ramp.",
      });
    });
}

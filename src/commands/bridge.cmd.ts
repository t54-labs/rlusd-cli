import { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { logger } from "../utils/logger.js";
import { formatOutput } from "../utils/format.js";
import type { OutputFormat } from "../types/index.js";

const WORMHOLE_SCAN = "https://wormholescan.io/";
const WORMHOLE_DOCS = "https://docs.wormhole.com/";

function resolveOutputFormat(program: Command): OutputFormat {
  const config = loadConfig();
  return (program.opts().output as OutputFormat) || config.output_format;
}

function isXrplChain(name: string | undefined): boolean {
  if (name === undefined || name === "") {
    return false;
  }
  return name.trim().toLowerCase() === "xrpl";
}

function xrplNttErrorLines(): string[] {
  return [
    "XRPL↔EVM bridging is not supported by Wormhole NTT.",
    "Wormhole Native Token Transfer (NTT) supports routes between EVM and SVM environments; XRPL is not a supported NTT endpoint.",
    `For general Wormhole messaging and explorer data, see ${WORMHOLE_DOCS} and ${WORMHOLE_SCAN}`,
  ];
}

function testingPhaseLines(): string[] {
  return [
    "RLUSD bridge via Wormhole NTT is in a testing phase. Public L2 contract addresses for RLUSD NTT are not yet available.",
    "Once deployments are finalized and documented, this CLI will support initiating transfers, estimates, and status tracking for supported EVM/SVM routes.",
    `Track cross-chain activity on Wormholescan: ${WORMHOLE_SCAN}`,
    `Protocol documentation: ${WORMHOLE_DOCS}`,
  ];
}

function emitLines(program: Command, kind: "xrpl_error" | "testing_stub", lines: string[]): void {
  const format = resolveOutputFormat(program);
  if (format === "json" || format === "json-compact") {
    const payload = {
      feature: "bridge",
      state: kind === "xrpl_error" ? "unsupported_route" : "coming_soon",
      messages: lines,
      links: {
        wormholescan: WORMHOLE_SCAN,
        wormhole_docs: WORMHOLE_DOCS,
      },
    };
    logger.raw(formatOutput(payload as Record<string, unknown>, format));
    return;
  }
  for (const line of lines) {
    logger.info(line);
  }
}

function assertBridgeOptions(from: string | undefined, to: string | undefined, amount: string | undefined): void {
  if (from === undefined || from === "" || to === undefined || to === "" || amount === undefined || amount === "") {
    throw new Error("bridge requires --from <chain>, --to <chain>, and --amount <n>");
  }
}

export function registerBridgeCommand(program: Command): void {
  const bridgeCmd = program
    .command("bridge")
    .description(
      "RLUSD cross-chain bridge via Wormhole NTT (stub — production routes and CLI wiring are not available yet)",
    );

  // Options are optional at parse time so subcommands (history, status, estimate) work without --from/--to/--amount.
  bridgeCmd
    .option("--from <chain>", "source chain (e.g. ethereum, base, xrpl)")
    .option("--to <chain>", "destination chain")
    .option("--amount <n>", "amount of RLUSD (informational for future use)")
    .action(async (opts: { from?: string; to?: string; amount?: string }) => {
      try {
        assertBridgeOptions(opts.from, opts.to, opts.amount);
        if (isXrplChain(opts.from) || isXrplChain(opts.to)) {
          emitLines(program, "xrpl_error", xrplNttErrorLines());
          process.exitCode = 1;
          return;
        }
        emitLines(program, "testing_stub", testingPhaseLines());
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  bridgeCmd
    .command("estimate")
    .description("Estimate bridge cost and time (not yet implemented)")
    .requiredOption("--from <chain>", "source chain")
    .requiredOption("--to <chain>", "destination chain")
    .requiredOption("--amount <n>", "amount of RLUSD (informational)")
    .action(async (opts: { from: string; to: string; amount: string }) => {
      try {
        assertBridgeOptions(opts.from, opts.to, opts.amount);
        if (isXrplChain(opts.from) || isXrplChain(opts.to)) {
          emitLines(program, "xrpl_error", xrplNttErrorLines());
          process.exitCode = 1;
          return;
        }
        emitLines(program, "testing_stub", testingPhaseLines());
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  bridgeCmd
    .command("status")
    .description("Look up a bridge transfer by id (use Wormholescan for live status)")
    .argument("<id>", "transfer or VAA reference id")
    .action(async (id: string) => {
      const format = resolveOutputFormat(program);
      const lines = [
        `Bridge status lookup in the CLI is not wired yet. Use Wormholescan for transaction and VAA status: ${WORMHOLE_SCAN}`,
        `Requested id: ${id}`,
      ];
      if (format === "json" || format === "json-compact") {
        logger.raw(
          formatOutput(
            {
              feature: "bridge",
              state: "stub",
              id,
              message: lines.join(" "),
              wormholescan: WORMHOLE_SCAN,
            } as Record<string, unknown>,
            format,
          ),
        );
        return;
      }
      for (const line of lines) {
        logger.info(line);
      }
    });

  bridgeCmd
    .command("history")
    .description("List recent bridge activity for the wallet (not yet implemented)")
    .action(async () => {
      const format = resolveOutputFormat(program);
      const msg =
        "Bridge history is not available in the CLI yet. When NTT support ships, this command will list recent RLUSD transfers. Until then, use Wormholescan for cross-chain activity.";
      if (format === "json" || format === "json-compact") {
        logger.raw(
          formatOutput(
            {
              feature: "bridge",
              state: "stub",
              message: msg,
              wormholescan: WORMHOLE_SCAN,
            } as Record<string, unknown>,
            format,
          ),
        );
        return;
      }
      logger.info(msg);
    });
}

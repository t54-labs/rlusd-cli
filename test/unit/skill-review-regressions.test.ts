import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-skill-review-regressions-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

function captureConsole(): {
  stdout: string[];
  stderr: string[];
  restore: () => void;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  };

  return {
    stdout,
    stderr,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

async function runProgram(args: string[]): Promise<{ stdout: string[]; stderr: string[] }> {
  const capture = captureConsole();

  try {
    const { ensureConfigDir } = await import("../../src/config/config.js");
    ensureConfigDir();

    const { createProgram } = await import("../../src/cli.js");
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(args, { from: "user" });
  } finally {
    capture.restore();
  }

  return { stdout: capture.stdout, stderr: capture.stderr };
}

describe("Skill review regressions", () => {
  beforeEach(() => {
    vi.resetModules();
    mkdirSync(TEST_HOME, { recursive: true });
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(TEST_HOME, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("returns structured trustline status data when no RLUSD trust line exists", async () => {
    const request = vi.fn().mockResolvedValue({ result: { lines: [] } });

    vi.doMock("../../src/clients/xrpl-client.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/clients/xrpl-client.js")>(
        "../../src/clients/xrpl-client.js",
      );

      return {
        ...actual,
        getXrplClient: vi.fn().mockResolvedValue({ request }),
        disconnectXrplClient: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { stdout, stderr } = await runProgram([
      "--json",
      "xrpl",
      "trustline",
      "status",
      "--address",
      "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    ]);

    expect(stderr).toEqual([]);

    const envelope = JSON.parse(stdout.join("\n"));
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("xrpl trustline status");
    expect(envelope.data).toEqual(
      expect.objectContaining({
        address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
        has_trustline: false,
        account_exists: true,
      }),
    );
  });

  it("marks uniswap quote failures as retryable with a fee-tier hint", async () => {
    vi.doMock("../../src/defi/venues/index.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/defi/venues/index.js")>(
        "../../src/defi/venues/index.js",
      );

      return {
        ...actual,
        getDefiVenueAdapter: vi.fn().mockReturnValue({
          venue: "uniswap",
          quoteSwap: vi.fn().mockRejectedValue(new Error("No pool found for fee tier 3000.")),
          buildSwapPlan: vi.fn(),
          previewLp: vi.fn(),
          buildLpPlan: vi.fn(),
        }),
      };
    });

    const { stdout, stderr } = await runProgram([
      "--json",
      "defi",
      "quote",
      "swap",
      "--chain",
      "ethereum-mainnet",
      "--venue",
      "uniswap",
      "--from",
      "RLUSD",
      "--to",
      "USDC",
      "--amount",
      "1000",
    ]);

    expect(stdout).toEqual([]);

    const envelope = JSON.parse(stderr.join("\n"));
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe("defi.quote.swap");
    expect(envelope.error.code).toBe("QUOTE_UNAVAILABLE");
    expect(envelope.error.retryable).toBe(true);
    expect(envelope.error.details).toEqual(
      expect.objectContaining({
        retry_hint: "retry_fee_tiers",
      }),
    );
  });

  it("skips destination trustline checks when preparing an XRPL payment to the issuer", async () => {
    const mockedTrustlineStatus = vi.fn().mockResolvedValue({
      present: false,
      account_exists: true,
    });

    vi.doMock("../../src/clients/xrpl-client.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/clients/xrpl-client.js")>(
        "../../src/clients/xrpl-client.js",
      );

      return {
        ...actual,
        getXrplTrustlineStatus: mockedTrustlineStatus,
        disconnectXrplClient: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { loadConfig } = await import("../../src/config/config.js");
    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateXrplWallet, serializeXrplWallet } = await import("../../src/wallet/xrpl-wallet.js");

    saveWallet(serializeXrplWallet("issuer-target", generateXrplWallet(), "p"));

    const { stdout, stderr } = await runProgram([
      "--json",
      "xrpl",
      "payment",
      "prepare",
      "--chain",
      "xrpl-mainnet",
      "--from-wallet",
      "issuer-target",
      "--to",
      loadConfig().rlusd.xrpl_issuer,
      "--amount",
      "25",
    ]);

    expect(stderr).toEqual([]);

    const envelope = JSON.parse(stdout.join("\n"));
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("xrpl.payment.prepare");
    expect(mockedTrustlineStatus).not.toHaveBeenCalled();
  });

  it("omits chain metadata from fiat guidance envelopes", async () => {
    const { stdout, stderr } = await runProgram([
      "--json",
      "fiat",
      "onboarding",
      "checklist",
    ]);

    expect(stderr).toEqual([]);

    const envelope = JSON.parse(stdout.join("\n"));
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("fiat onboarding checklist");
    expect(envelope).not.toHaveProperty("chain");
  });
});

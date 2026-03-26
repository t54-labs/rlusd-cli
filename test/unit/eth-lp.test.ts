import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-eth-lp-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

vi.mock("../../src/clients/evm-client.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/clients/evm-client.js")>(
    "../../src/clients/evm-client.js",
  );
  return {
    ...actual,
    getEvmPublicClient: vi.fn(),
  };
});

const { createProgram } = await import("../../src/cli.js");
const { ensureConfigDir } = await import("../../src/config/config.js");
const { getEvmPublicClient } = await import("../../src/clients/evm-client.js");
const { saveWallet } = await import("../../src/wallet/manager.js");
const { generateEvmWallet, serializeEvmWallet } = await import("../../src/wallet/evm-wallet.js");

type MockPublicClient = {
  readContract: ReturnType<typeof vi.fn>;
};

function makePublicClient(): MockPublicClient {
  return {
    readContract: vi.fn(),
  };
}

async function runCommand(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...parts: unknown[]) => {
    stdout.push(parts.map(String).join(" "));
  };
  console.error = (...parts: unknown[]) => {
    stderr.push(parts.map(String).join(" "));
  };

  try {
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(args, { from: "user" });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return { stdout, stderr };
}

describe("Legacy eth lp wrappers", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
    process.env.RLUSD_WALLET_PASSWORD = "p";
    saveWallet(serializeEvmWallet("ops", generateEvmWallet(), "p", "ethereum"));
  });

  afterEach(() => {
    delete process.env.RLUSD_WALLET_PASSWORD;
    rmSync(TEST_HOME, { recursive: true, force: true });
    vi.mocked(getEvmPublicClient).mockReset();
    process.exitCode = 0;
  });

  it("should map eth lp quote to the shared curve preview logic", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValue(1998000000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runCommand([
      "--output",
      "json",
      "eth",
      "lp",
      "quote",
      "--venue",
      "curve",
      "--chain",
      "ethereum",
      "--operation",
      "add",
      "--rlusd-amount",
      "1000",
      "--usdc-amount",
      "1000",
    ]);

    expect(result.stderr).toEqual([]);
    const output = JSON.parse(result.stdout.join("\n"));
    expect(output.venue).toBe("curve");
    expect(output.operation).toBe("add");
  });

  it("should map eth lp add to the shared add-liquidity plan logic", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValue(1998000000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runCommand([
      "--output",
      "json",
      "eth",
      "lp",
      "add",
      "--venue",
      "curve",
      "--chain",
      "ethereum",
      "--rlusd-amount",
      "1000",
      "--usdc-amount",
      "1000",
      "--dry-run",
    ]);

    expect(result.stderr).toEqual([]);
    const output = JSON.parse(result.stdout.join("\n"));
    expect(output.steps.map((step: { step: string }) => step.step)).toEqual([
      "approve_rlusd",
      "approve_usdc",
      "add_liquidity",
    ]);
  });

  it("should map eth lp remove to the shared remove-liquidity plan logic", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValue(49750000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runCommand([
      "--output",
      "json",
      "eth",
      "lp",
      "remove",
      "--venue",
      "curve",
      "--chain",
      "ethereum",
      "--lp-amount",
      "50",
      "--receive-token",
      "RLUSD",
      "--dry-run",
    ]);

    expect(result.stderr).toEqual([]);
    const output = JSON.parse(result.stdout.join("\n"));
    expect(output.steps.map((step: { step: string }) => step.step)).toEqual(["remove_liquidity"]);
  });
});

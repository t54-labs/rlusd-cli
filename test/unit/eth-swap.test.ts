import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-eth-swap-test-${Date.now()}`);

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

describe("Legacy eth swap wrappers", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
    vi.mocked(getEvmPublicClient).mockReset();
    process.exitCode = 0;
  });

  it("should support curve quotes for the RLUSD-USDC pair on ethereum", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValue(99950000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runCommand([
      "--output",
      "json",
      "eth",
      "swap",
      "quote",
      "--venue",
      "curve",
      "--chain",
      "ethereum",
      "--amount",
      "100",
      "--for",
      "USDC",
    ]);

    expect(result.stderr).toEqual([]);
    const output = JSON.parse(result.stdout.join("\n"));
    expect(output.venue).toBe("curve");
    expect(output.receive).toContain("USDC");
  });

  it("should reject curve quotes for unsupported pairs", async () => {
    const publicClient = makePublicClient();
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runCommand([
      "--output",
      "json",
      "eth",
      "swap",
      "quote",
      "--venue",
      "curve",
      "--chain",
      "ethereum",
      "--amount",
      "100",
      "--for",
      "WETH",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.stderr.join("\n")).toContain("RLUSD");
    expect(result.stderr.join("\n")).toContain("USDC");
  });
});

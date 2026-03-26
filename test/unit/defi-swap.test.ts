import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-defi-swap-test-${Date.now()}`);

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
const { ensureConfigDir, loadConfig } = await import("../../src/config/config.js");
const { createPreparedPlan, loadPreparedPlan } = await import("../../src/plans/index.js");
const { getEvmPublicClient } = await import("../../src/clients/evm-client.js");
const { saveWallet } = await import("../../src/wallet/manager.js");
const { generateEvmWallet, serializeEvmWallet } = await import("../../src/wallet/evm-wallet.js");
const { CURVE_RLUSD_USDC_POOL_ETHEREUM } = await import("../../src/config/constants.js");

type MockPublicClient = {
  simulateContract: ReturnType<typeof vi.fn>;
  readContract: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
};

function makePublicClient(): MockPublicClient {
  return {
    simulateContract: vi.fn(),
    readContract: vi.fn(),
    waitForTransactionReceipt: vi.fn(),
  };
}

async function runJsonCommand(args: string[]) {
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
    await program.parseAsync(["--json", ...args], { from: "user" });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return {
    stdout,
    stderr,
    output:
      stdout.length > 0
        ? JSON.parse(stdout.join("\n"))
        : stderr.length > 0
          ? JSON.parse(stderr.join("\n"))
          : null,
  };
}

describe("Top-level DeFi swap flows", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
    process.env.RLUSD_WALLET_PASSWORD = "p";
  });

  afterEach(() => {
    delete process.env.RLUSD_WALLET_PASSWORD;
    rmSync(TEST_HOME, { recursive: true, force: true });
    vi.mocked(getEvmPublicClient).mockReset();
  });

  it("should return a live uniswap quote envelope", async () => {
    const publicClient = makePublicClient();
    publicClient.simulateContract.mockResolvedValue({
      result: [1234000n, 0n, 0, 21000n],
    });
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runJsonCommand([
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
      "100",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);
    expect(result.output.data.route.venue).toBe("uniswap");
    expect(result.output.data.route.amount_out).toBe("1.234");
    expect(result.output.data.route.fee_bps).toBe(30);
  });

  it("should return the fixed curve pool metadata for a supported curve quote", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValue(999500000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runJsonCommand([
      "defi",
      "quote",
      "swap",
      "--chain",
      "ethereum-mainnet",
      "--venue",
      "curve",
      "--from",
      "RLUSD",
      "--to",
      "USDC",
      "--amount",
      "1000",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);
    expect(result.output.data.route.venue).toBe("curve");
    expect(result.output.data.route.pool_address).toBe(CURVE_RLUSD_USDC_POOL_ETHEREUM);
    expect(result.output.data.route.pool_name).toBe("Curve RLUSD/USDC");
  });

  it("should reject unsupported curve pairs with a structured error", async () => {
    const publicClient = makePublicClient();
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runJsonCommand([
      "defi",
      "quote",
      "swap",
      "--chain",
      "ethereum-mainnet",
      "--venue",
      "curve",
      "--from",
      "RLUSD",
      "--to",
      "WETH",
      "--amount",
      "100",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.code).toBe("QUOTE_UNAVAILABLE");
    expect(result.output.error.message).toContain("RLUSD");
    expect(result.output.error.message).toContain("USDC");
  });

  it("should reject curve quotes on non-mainnet chains with a structured error", async () => {
    const publicClient = makePublicClient();
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runJsonCommand([
      "defi",
      "quote",
      "swap",
      "--chain",
      "ethereum-sepolia",
      "--venue",
      "curve",
      "--from",
      "RLUSD",
      "--to",
      "USDC",
      "--amount",
      "100",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.code).toBe("QUOTE_UNAVAILABLE");
    expect(result.output.error.message).toContain("ethereum-mainnet");
  });

  it("should write a defi.swap plan with approve and swap steps for curve", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValue(999500000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);
    saveWallet(serializeEvmWallet("ops", generateEvmWallet(), "p", "ethereum"));

    const result = await runJsonCommand([
      "defi",
      "swap",
      "prepare",
      "--chain",
      "ethereum-mainnet",
      "--venue",
      "curve",
      "--from-wallet",
      "ops",
      "--from",
      "RLUSD",
      "--to",
      "USDC",
      "--amount",
      "1000",
      "--slippage",
      "50",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);

    const plan = await loadPreparedPlan(result.output.data.plan_path);
    const steps = (plan.data.intent as { steps: Array<{ step: string }> }).steps;
    expect(plan.data.action).toBe("defi.swap");
    expect(steps.map((step) => step.step)).toEqual(["approve", "swap"]);
  });

  it("should require explicit confirmation for defi swap execute", async () => {
    const envelope = await createPreparedPlan({
      command: "defi.swap.prepare",
      chain: "ethereum-mainnet",
      timestamp: "2026-03-26T00:00:00.000Z",
      action: "defi.swap",
      requires_confirmation: true,
      human_summary: "Swap RLUSD for USDC",
      asset: {
        symbol: "RLUSD",
        name: "Ripple USD",
        chain: "ethereum",
        family: "evm",
        address: loadConfig().rlusd.eth_contract,
        decimals: 18,
      },
      params: {
        venue: "curve",
        from: "ops",
        input_symbol: "RLUSD",
        output_symbol: "USDC",
        amount: "1000",
      },
      intent: {
        venue: "curve",
        steps: [],
      },
      warnings: ["mainnet", "real_funds", "token_allowance"],
    });

    const result = await runJsonCommand(["defi", "swap", "execute", "--plan", envelope.data.plan_path]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.message).toContain("explicit confirmation");
  });

  it("should reject swap execute plans whose action does not match", async () => {
    const envelope = await createPreparedPlan({
      command: "defi.supply.prepare",
      chain: "ethereum-sepolia",
      timestamp: "2026-03-26T00:00:00.000Z",
      action: "defi.supply",
      requires_confirmation: false,
      human_summary: "Supply RLUSD",
      asset: {
        symbol: "RLUSD",
        name: "Ripple USD",
        chain: "ethereum",
        family: "evm",
        address: loadConfig().rlusd.eth_contract,
        decimals: 18,
      },
      params: {
        venue: "aave",
        from: "ops",
        amount: "1000",
      },
      intent: {
        venue: "aave",
        steps: [],
      },
      warnings: [],
    });

    const result = await runJsonCommand(["defi", "swap", "execute", "--plan", envelope.data.plan_path]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.message).toContain("cannot be executed by defi.swap.execute");
  });
});

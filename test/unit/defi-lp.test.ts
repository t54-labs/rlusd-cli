import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-defi-lp-test-${Date.now()}`);

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
  readContract: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
};

function makePublicClient(): MockPublicClient {
  return {
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

describe("Top-level DeFi LP flows", () => {
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

  it("should preview adding liquidity on curve", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValueOnce(1998000000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runJsonCommand([
      "defi",
      "lp",
      "preview",
      "--chain",
      "ethereum-mainnet",
      "--venue",
      "curve",
      "--operation",
      "add",
      "--rlusd-amount",
      "1000",
      "--usdc-amount",
      "1000",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);
    expect(result.output.data.venue).toBe("curve");
    expect(result.output.data.operation).toBe("add");
    expect(result.output.data.pool_address).toBe(CURVE_RLUSD_USDC_POOL_ETHEREUM);
  });

  it("should reject defi lp preview for unsupported venues", async () => {
    const publicClient = makePublicClient();
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runJsonCommand([
      "defi",
      "lp",
      "preview",
      "--chain",
      "ethereum-mainnet",
      "--venue",
      "uniswap",
      "--operation",
      "add",
      "--rlusd-amount",
      "1000",
      "--usdc-amount",
      "1000",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.code).toBe("PREVIEW_UNAVAILABLE");
    expect(result.output.error.message).toContain("curve");
  });

  it("should prepare add-liquidity steps for curve", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValueOnce(1998000000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);
    saveWallet(serializeEvmWallet("ops", generateEvmWallet(), "p", "ethereum"));

    const result = await runJsonCommand([
      "defi",
      "lp",
      "prepare",
      "--chain",
      "ethereum-mainnet",
      "--venue",
      "curve",
      "--operation",
      "add",
      "--from-wallet",
      "ops",
      "--rlusd-amount",
      "1000",
      "--usdc-amount",
      "1000",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);

    const plan = await loadPreparedPlan(result.output.data.plan_path);
    const steps = (plan.data.intent as { steps: Array<{ step: string }> }).steps;
    expect(plan.data.action).toBe("defi.lp");
    expect(steps.map((step) => step.step)).toEqual([
      "approve_rlusd",
      "approve_usdc",
      "add_liquidity",
    ]);
  });

  it("should prepare remove-liquidity steps for curve", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValueOnce(49750000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);
    saveWallet(serializeEvmWallet("ops", generateEvmWallet(), "p", "ethereum"));

    const result = await runJsonCommand([
      "defi",
      "lp",
      "prepare",
      "--chain",
      "ethereum-mainnet",
      "--venue",
      "curve",
      "--operation",
      "remove",
      "--from-wallet",
      "ops",
      "--lp-amount",
      "50",
      "--receive-token",
      "RLUSD",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);

    const plan = await loadPreparedPlan(result.output.data.plan_path);
    const steps = (plan.data.intent as { steps: Array<{ step: string }> }).steps;
    expect(plan.data.action).toBe("defi.lp");
    expect(steps.map((step) => step.step)).toEqual(["remove_liquidity"]);
  });

  it("should require explicit confirmation for defi lp execute", async () => {
    const envelope = await createPreparedPlan({
      command: "defi.lp.prepare",
      chain: "ethereum-mainnet",
      timestamp: "2026-03-26T00:00:00.000Z",
      action: "defi.lp",
      requires_confirmation: true,
      human_summary: "Add Curve liquidity",
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
        operation: "add",
      },
      intent: {
        venue: "curve",
        steps: [],
      },
      warnings: ["mainnet", "real_funds", "token_allowance"],
    });

    const result = await runJsonCommand(["defi", "lp", "execute", "--plan", envelope.data.plan_path]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.message).toContain("explicit confirmation");
  });

  it("should encode non-zero min_lp_amount on add-liquidity prepare", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValueOnce(1998000000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);
    saveWallet(serializeEvmWallet("ops", generateEvmWallet(), "p", "ethereum"));

    const result = await runJsonCommand([
      "defi", "lp", "prepare",
      "--chain", "ethereum-mainnet",
      "--venue", "curve",
      "--operation", "add",
      "--from-wallet", "ops",
      "--rlusd-amount", "1000",
      "--usdc-amount", "1000",
      "--slippage", "50",
    ]);

    expect(result.output.ok).toBe(true);
    const plan = await loadPreparedPlan(result.output.data.plan_path);
    const intent = plan.data.intent as {
      min_lp_amount?: string;
      expected_lp_amount?: string;
    };
    expect(intent.min_lp_amount).toBeDefined();
    expect(Number(intent.min_lp_amount)).toBeGreaterThan(0);
    expect(Number(intent.min_lp_amount)).toBeLessThan(Number(intent.expected_lp_amount));
  });

  it("should encode non-zero min_receive_amount on remove-liquidity prepare", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValueOnce(49750000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);
    saveWallet(serializeEvmWallet("ops", generateEvmWallet(), "p", "ethereum"));

    const result = await runJsonCommand([
      "defi", "lp", "prepare",
      "--chain", "ethereum-mainnet",
      "--venue", "curve",
      "--operation", "remove",
      "--from-wallet", "ops",
      "--lp-amount", "50",
      "--receive-token", "RLUSD",
      "--slippage", "100",
    ]);

    expect(result.output.ok).toBe(true);
    const plan = await loadPreparedPlan(result.output.data.plan_path);
    const intent = plan.data.intent as {
      min_receive_amount?: string;
      expected_receive_amount?: string;
    };
    expect(intent.min_receive_amount).toBeDefined();
    expect(Number(intent.min_receive_amount)).toBeGreaterThan(0);
    expect(Number(intent.min_receive_amount)).toBeLessThan(Number(intent.expected_receive_amount));
  });

  it("should accept lowercase --receive-token for remove-liquidity preview", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValueOnce(49750000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);

    const result = await runJsonCommand([
      "defi", "lp", "preview",
      "--chain", "ethereum-mainnet",
      "--venue", "curve",
      "--operation", "remove",
      "--lp-amount", "50",
      "--receive-token", "usdc",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);
    expect(result.output.data.receive_token).toBe("USDC");
  });

  it("should accept lowercase --receive-token for remove-liquidity prepare", async () => {
    const publicClient = makePublicClient();
    publicClient.readContract.mockResolvedValueOnce(49750000n);
    vi.mocked(getEvmPublicClient).mockReturnValue(publicClient as never);
    saveWallet(serializeEvmWallet("ops", generateEvmWallet(), "p", "ethereum"));

    const result = await runJsonCommand([
      "defi", "lp", "prepare",
      "--chain", "ethereum-mainnet",
      "--venue", "curve",
      "--operation", "remove",
      "--from-wallet", "ops",
      "--lp-amount", "50",
      "--receive-token", "rlusd",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);
    const plan = await loadPreparedPlan(result.output.data.plan_path);
    const intent = plan.data.intent as { receive_token?: string };
    expect(intent.receive_token).toBe("RLUSD");
  });

  it("should reject lp execute plans whose action does not match", async () => {
    const envelope = await createPreparedPlan({
      command: "defi.swap.prepare",
      chain: "ethereum-sepolia",
      timestamp: "2026-03-26T00:00:00.000Z",
      action: "defi.swap",
      requires_confirmation: false,
      human_summary: "Swap RLUSD",
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
        amount: "1000",
      },
      intent: {
        venue: "curve",
        steps: [],
      },
      warnings: [],
    });

    const result = await runJsonCommand(["defi", "lp", "execute", "--plan", envelope.data.plan_path]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.message).toContain("cannot be executed by defi.lp.execute");
  });
});

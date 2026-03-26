import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-defi-venues-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { ensureConfigDir, loadConfig } = await import("../../src/config/config.js");
const { createPreparedPlan, loadPreparedPlan } = await import("../../src/plans/index.js");
const { getDefiVenueAdapter } = await import("../../src/defi/venues/index.js");
const { executePreparedDefiPlan } = await import("../../src/defi/executor.js");

describe("DeFi venues", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should resolve uniswap and curve adapters from the shared registry", () => {
    expect(getDefiVenueAdapter("uniswap").venue).toBe("uniswap");
    expect(getDefiVenueAdapter("curve").venue).toBe("curve");
  });

  it("should expose uniswap quote behavior through the adapter interface", async () => {
    const adapter = getDefiVenueAdapter("uniswap");
    const config = loadConfig();
    const publicClient = {
      simulateContract: vi.fn().mockResolvedValue({
        result: [1234000n, 0n, 0, 21000n],
      }),
    };

    const quote = await adapter.quoteSwap({
      chain: {
        chain: "ethereum",
        network: "mainnet",
        label: "ethereum-mainnet",
        displayName: "Ethereum Mainnet",
      },
      config,
      publicClient,
      fromSymbol: "RLUSD",
      toSymbol: "USDC",
      amount: "100",
      feeTier: "3000",
    });

    expect(quote.request).toEqual({
      from: "RLUSD",
      to: "USDC",
      amount: "100",
    });
    expect(quote.route.venue).toBe("uniswap");
    expect(quote.route.amount_out).toBe("1.234");
    expect(quote.route.fee_bps).toBe(30);
    expect(quote.route.gas_estimate).toBe("21000");
    expect(publicClient.simulateContract).toHaveBeenCalledOnce();
  });

  it("should include freshness metadata on curve LP previews", async () => {
    const adapter = getDefiVenueAdapter("curve");
    const config = loadConfig();
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(1234000000000000000n),
    };

    const preview = await adapter.previewLp({
      chain: {
        chain: "ethereum",
        network: "mainnet",
        label: "ethereum-mainnet",
        displayName: "Ethereum Mainnet",
      },
      config,
      publicClient,
      operation: "add",
      rlusdAmount: "100",
      usdcAmount: "100",
    });

    const metadata = preview as {
      quoted_at?: string;
      ttl_seconds?: number;
      expires_at?: string;
    };

    expect(metadata.quoted_at).toEqual(expect.any(String));
    expect(metadata.ttl_seconds).toBe(30);
    expect(metadata.expires_at).toEqual(expect.any(String));
  });
});

describe("DeFi executor", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should reject a plan whose action does not match the caller", async () => {
    const envelope = await createPreparedPlan({
      command: "evm.transfer.prepare",
      chain: "ethereum-sepolia",
      timestamp: "2026-03-26T00:00:00.000Z",
      action: "evm.transfer",
      requires_confirmation: false,
      human_summary: "Transfer RLUSD",
      asset: {
        symbol: "RLUSD",
        name: "Ripple USD",
        chain: "ethereum",
        family: "evm",
        address: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
        decimals: 18,
      },
      params: {
        from: "ops",
        to: "0x0000000000000000000000000000000000000001",
        amount: "10",
      },
      intent: {
        steps: [],
      },
      warnings: [],
    });

    const plan = await loadPreparedPlan(envelope.data.plan_path);

    await expect(
      executePreparedDefiPlan({
        callerLabel: "defi.supply.execute",
        expectedAction: "defi.supply",
        plan,
        walletClient: {
          sendTransaction: vi.fn(),
        },
        publicClient: {
          waitForTransactionReceipt: vi.fn(),
        },
      }),
    ).rejects.toThrow("cannot be executed by defi.supply.execute");
  });

  it("should enforce confirmation on mainnet plans", async () => {
    const envelope = await createPreparedPlan({
      command: "defi.supply.prepare",
      chain: "ethereum-mainnet",
      timestamp: "2026-03-26T00:00:00.000Z",
      action: "defi.supply",
      requires_confirmation: true,
      human_summary: "Supply RLUSD",
      asset: {
        symbol: "RLUSD",
        name: "Ripple USD",
        chain: "ethereum",
        family: "evm",
        address: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
        decimals: 18,
      },
      params: {
        from: "ops",
        venue: "aave",
        amount: "500",
      },
      intent: {
        steps: [],
      },
      warnings: ["mainnet", "real_funds", "token_allowance"],
    });

    const plan = await loadPreparedPlan(envelope.data.plan_path);

    await expect(
      executePreparedDefiPlan({
        callerLabel: "defi.supply.execute",
        expectedAction: "defi.supply",
        plan,
        walletClient: {
          sendTransaction: vi.fn(),
        },
        publicClient: {
          waitForTransactionReceipt: vi.fn(),
        },
      }),
    ).rejects.toThrow("explicit confirmation");
  });
});

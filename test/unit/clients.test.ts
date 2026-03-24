import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-clients-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { RLUSD_ERC20_ABI } = await import("../../src/abi/rlusd-erc20.js");
const { loadConfig, ensureConfigDir } = await import("../../src/config/config.js");

describe("RLUSD ERC-20 ABI", () => {
  it("should export a non-empty ABI array", () => {
    expect(Array.isArray(RLUSD_ERC20_ABI)).toBe(true);
    expect(RLUSD_ERC20_ABI.length).toBeGreaterThan(0);
  });

  it("should include balanceOf function", () => {
    const balanceOf = RLUSD_ERC20_ABI.find(
      (item) => item.type === "function" && item.name === "balanceOf",
    );
    expect(balanceOf).toBeDefined();
  });

  it("should include transfer function", () => {
    const transfer = RLUSD_ERC20_ABI.find(
      (item) => item.type === "function" && item.name === "transfer",
    );
    expect(transfer).toBeDefined();
  });

  it("should include approve function", () => {
    const approve = RLUSD_ERC20_ABI.find(
      (item) => item.type === "function" && item.name === "approve",
    );
    expect(approve).toBeDefined();
  });

  it("should include allowance function", () => {
    const allowance = RLUSD_ERC20_ABI.find(
      (item) => item.type === "function" && item.name === "allowance",
    );
    expect(allowance).toBeDefined();
  });

  it("should include isFrozen function", () => {
    const isFrozen = RLUSD_ERC20_ABI.find(
      (item) => item.type === "function" && item.name === "isFrozen",
    );
    expect(isFrozen).toBeDefined();
  });

  it("should include Transfer event", () => {
    const transferEvent = RLUSD_ERC20_ABI.find(
      (item) => item.type === "event" && item.name === "Transfer",
    );
    expect(transferEvent).toBeDefined();
  });

  it("should include Approval event", () => {
    const approvalEvent = RLUSD_ERC20_ABI.find(
      (item) => item.type === "event" && item.name === "Approval",
    );
    expect(approvalEvent).toBeDefined();
  });
});

describe("EVM Client Factory", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should create a public client for ethereum", async () => {
    const { getEvmPublicClient } = await import("../../src/clients/evm-client.js");
    loadConfig();
    const client = getEvmPublicClient("ethereum");
    expect(client).toBeDefined();
    expect(client.chain).toBeDefined();
  });

  it("should throw error for unconfigured chain RPC", async () => {
    const { loadConfig: lc, saveConfig } = await import("../../src/config/config.js");
    const config = lc();
    delete config.chains["ink"];
    saveConfig(config);

    const { getEvmPublicClient } = await import("../../src/clients/evm-client.js");
    expect(() => getEvmPublicClient("ink")).toThrow();
  });
});

describe("Balance Command Structure", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register balance and gas-balance commands", async () => {
    const { createProgram } = await import("../../src/cli.js");
    const program = createProgram();
    const balanceCmd = program.commands.find((c) => c.name() === "balance");
    const gasCmd = program.commands.find((c) => c.name() === "gas-balance");
    expect(balanceCmd).toBeDefined();
    expect(gasCmd).toBeDefined();
  });
});

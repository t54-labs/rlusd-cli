import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-commands-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { createProgram } = await import("../../src/cli.js");
const { ensureConfigDir } = await import("../../src/config/config.js");

describe("Command Registration", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register all top-level commands", () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain("config");
    expect(commandNames).toContain("wallet");
    expect(commandNames).toContain("balance");
    expect(commandNames).toContain("gas-balance");
    expect(commandNames).toContain("send");
    expect(commandNames).toContain("faucet");
    expect(commandNames).toContain("xrpl");
  });

  it("should register xrpl trustline subcommands", () => {
    const program = createProgram();
    const xrplCmd = program.commands.find((c) => c.name() === "xrpl");
    expect(xrplCmd).toBeDefined();

    const trustlineCmd = xrplCmd!.commands.find((c) => c.name() === "trustline");
    expect(trustlineCmd).toBeDefined();

    const subcommands = trustlineCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("setup");
    expect(subcommands).toContain("status");
    expect(subcommands).toContain("remove");
  });

  it("should register send command with required options", () => {
    const program = createProgram();
    const sendCmd = program.commands.find((c) => c.name() === "send");
    expect(sendCmd).toBeDefined();

    const optionNames = sendCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--to");
    expect(optionNames).toContain("--amount");
    expect(optionNames).toContain("--tag");
    expect(optionNames).toContain("--memo");
    expect(optionNames).toContain("--dry-run");
  });

  it("should register faucet fund subcommand", () => {
    const program = createProgram();
    const faucetCmd = program.commands.find((c) => c.name() === "faucet");
    expect(faucetCmd).toBeDefined();

    const fundCmd = faucetCmd!.commands.find((c) => c.name() === "fund");
    expect(fundCmd).toBeDefined();
  });

  it("should register wallet subcommands", () => {
    const program = createProgram();
    const walletCmd = program.commands.find((c) => c.name() === "wallet");
    expect(walletCmd).toBeDefined();

    const subcommands = walletCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("generate");
    expect(subcommands).toContain("import");
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("address");
    expect(subcommands).toContain("use");
  });

  it("should register config subcommands", () => {
    const program = createProgram();
    const configCmd = program.commands.find((c) => c.name() === "config");
    expect(configCmd).toBeDefined();

    const subcommands = configCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("get");
    expect(subcommands).toContain("set");
  });

  it("should register balance command with options", () => {
    const program = createProgram();
    const balanceCmd = program.commands.find((c) => c.name() === "balance");
    expect(balanceCmd).toBeDefined();

    const optionNames = balanceCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--chain");
    expect(optionNames).toContain("--all");
    expect(optionNames).toContain("--address");
  });
});

const { detectChainFromAddress } = await import("../../src/utils/address.js");
const { CHAINLINK_AGGREGATOR_ABI } = await import("../../src/abi/chainlink-aggregator.js");

describe("Send Command Address Detection", () => {
  it("should detect XRPL chain from r-address", () => {
    expect(detectChainFromAddress("rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De")).toBe("xrpl");
  });

  it("should detect EVM chain from 0x-address", () => {
    expect(detectChainFromAddress("0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD")).toBe("ethereum");
  });

  it("should return null for invalid addresses", () => {
    expect(detectChainFromAddress("invalid")).toBeNull();
  });
});

describe("Transaction Command Registration", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register tx command with status and history subcommands", () => {
    const program = createProgram();
    const txCmd = program.commands.find((c) => c.name() === "tx");
    expect(txCmd).toBeDefined();

    const subcommands = txCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("status");
    expect(subcommands).toContain("history");
  });

  it("should register tx history with --limit option", () => {
    const program = createProgram();
    const txCmd = program.commands.find((c) => c.name() === "tx");
    const historyCmd = txCmd!.commands.find((c) => c.name() === "history");
    expect(historyCmd).toBeDefined();

    const optionNames = historyCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--limit");
  });
});

describe("Price & Market Command Registration", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register price command with --source option", () => {
    const program = createProgram();
    const priceCmd = program.commands.find((c) => c.name() === "price");
    expect(priceCmd).toBeDefined();

    const optionNames = priceCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--source");
  });

  it("should register market command", () => {
    const program = createProgram();
    const marketCmd = program.commands.find((c) => c.name() === "market");
    expect(marketCmd).toBeDefined();
  });
});

describe("XRPL DEX Command Registration", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register dex subcommands under xrpl", () => {
    const program = createProgram();
    const xrplCmd = program.commands.find((c) => c.name() === "xrpl");
    const dexCmd = xrplCmd!.commands.find((c) => c.name() === "dex");
    expect(dexCmd).toBeDefined();

    const subcommands = dexCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("buy");
    expect(subcommands).toContain("sell");
    expect(subcommands).toContain("cancel");
    expect(subcommands).toContain("orderbook");
  });
});

describe("XRPL AMM Command Registration", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register amm subcommands under xrpl", () => {
    const program = createProgram();
    const xrplCmd = program.commands.find((c) => c.name() === "xrpl");
    const ammCmd = xrplCmd!.commands.find((c) => c.name() === "amm");
    expect(ammCmd).toBeDefined();

    const subcommands = ammCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("info");
    expect(subcommands).toContain("deposit");
    expect(subcommands).toContain("withdraw");
    expect(subcommands).toContain("vote");
    expect(subcommands).toContain("swap");
  });
});

describe("XRPL Pathfind Command Registration", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register pathfind command under xrpl", () => {
    const program = createProgram();
    const xrplCmd = program.commands.find((c) => c.name() === "xrpl");
    const pathfindCmd = xrplCmd!.commands.find((c) => c.name() === "pathfind");
    expect(pathfindCmd).toBeDefined();

    const optionNames = pathfindCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--to");
    expect(optionNames).toContain("--amount");
  });
});

describe("Chainlink Aggregator ABI", () => {
  it("should include latestRoundData function", () => {
    const fn = CHAINLINK_AGGREGATOR_ABI.find(
      (item) => item.type === "function" && item.name === "latestRoundData",
    );
    expect(fn).toBeDefined();
  });

  it("should include decimals function", () => {
    const fn = CHAINLINK_AGGREGATOR_ABI.find(
      (item) => item.type === "function" && item.name === "decimals",
    );
    expect(fn).toBeDefined();
  });

  it("should have correct output types for latestRoundData", () => {
    const fn = CHAINLINK_AGGREGATOR_ABI.find(
      (item) => item.type === "function" && item.name === "latestRoundData",
    );
    expect(fn).toBeDefined();
    if (fn && "outputs" in fn) {
      expect(fn.outputs).toHaveLength(5);
    }
  });
});

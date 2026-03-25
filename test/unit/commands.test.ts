import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-commands-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { createProgram } = await import("../../src/cli.js");
const { ensureConfigDir, getPlansDir } = await import("../../src/config/config.js");
const { createPlanId, createPreparedPlan, loadPreparedPlan } = await import("../../src/plans/index.js");
const { saveWallet } = await import("../../src/wallet/manager.js");
const { generateXrplWallet, serializeXrplWallet } = await import("../../src/wallet/xrpl-wallet.js");
const { generateEvmWallet, serializeEvmWallet } = await import("../../src/wallet/evm-wallet.js");

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

    const setupCmd = trustlineCmd!.commands.find((c) => c.name() === "setup");
    const setupOptionNames = setupCmd!.options.map((o) => o.long);
    expect(setupOptionNames).toContain("--wallet");
  });

  it("should register send command with required options", () => {
    const program = createProgram();
    const sendCmd = program.commands.find((c) => c.name() === "send");
    expect(sendCmd).toBeDefined();

    const optionNames = sendCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--to");
    expect(optionNames).toContain("--amount");
    expect(optionNames).toContain("--from-wallet");
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

describe("Agent JSON Contract", () => {
  let stdout: string[];
  let stderr: string[];
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
    stdout = [];
    stderr = [];
    console.log = (...args: unknown[]) => {
      stdout.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      stderr.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should emit a shared success envelope with --json", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--json", "--chain", "xrpl", "--network", "mainnet", "config", "get"], { from: "user" });

    expect(stderr).toEqual([]);
    const envelope = JSON.parse(stdout.join("\n"));
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("config get");
    expect(envelope.chain).toBe("xrpl-mainnet");
    expect(envelope.timestamp).toEqual(expect.any(String));
    expect(envelope.data.environment).toBe("mainnet");
    expect(envelope.data.rlusd).toBeDefined();
    expect(envelope.warnings).toEqual([]);
    expect(envelope.next).toEqual([]);
  });

  it("should emit structured JSON errors to stderr with --json", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--json", "--chain", "xrpl", "config", "set", "--network", "invalid"], { from: "user" });

    expect(stdout).toEqual([]);
    const envelope = JSON.parse(stderr.join("\n"));
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe("config set");
    expect(envelope.chain).toBe("xrpl-testnet");
    expect(envelope.timestamp).toEqual(expect.any(String));
    expect(envelope.error.code).toEqual(expect.any(String));
    expect(envelope.error.message).toContain("Invalid network");
    expect(envelope.error.retryable).toBe(false);
  });

  it("should emit JSON errors for wrong-chain wallet selections", async () => {
    saveWallet(serializeXrplWallet("xrpl-only", generateXrplWallet(), "p"));

    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(
      [
        "--json",
        "--chain",
        "ethereum",
        "send",
        "--to",
        "0x0000000000000000000000000000000000000001",
        "--amount",
        "1",
        "--from-wallet",
        "xrpl-only",
      ],
      { from: "user" },
    );

    expect(stdout).toEqual([]);
    const envelope = JSON.parse(stderr.join("\n"));
    expect(envelope.ok).toBe(false);
    expect(envelope.error.message).toContain("configured for xrpl, not ethereum");
  });

  it("should emit JSON errors when wallet passwords are missing in machine mode", async () => {
    saveWallet(serializeEvmWallet("eth-ops", generateEvmWallet(), "p", "ethereum"));

    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(
      [
        "--json",
        "--chain",
        "ethereum",
        "send",
        "--to",
        "0x0000000000000000000000000000000000000001",
        "--amount",
        "1",
        "--from-wallet",
        "eth-ops",
      ],
      { from: "user" },
    );

    expect(stdout).toEqual([]);
    const envelope = JSON.parse(stderr.join("\n"));
    expect(envelope.ok).toBe(false);
    expect(envelope.error.message).toContain("Wallet password is required");
  });
});

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

describe("Prepared plan infrastructure", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should create deterministic plan ids for identical inputs", () => {
    const input = {
      command: "rlusd evm transfer prepare",
      chain: "ethereum-mainnet",
      action: "evm.transfer",
      requires_confirmation: true,
      asset: {
        symbol: "RLUSD",
        name: "Ripple USD",
        chain: "ethereum",
        family: "evm" as const,
        address: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
        decimals: 18,
      },
      params: {
        from: "ops",
        to: "0x0000000000000000000000000000000000000001",
        amount: "25.5",
      },
      intent: {
        to: "0x0000000000000000000000000000000000000002",
        data: "0xabc123",
      },
      warnings: ["mainnet", "real_funds"],
    };

    expect(createPlanId(input)).toBe(createPlanId(input));
    expect(createPlanId(input)).toMatch(/^plan_[0-9a-f]{12}$/);
  });

  it("should write prepared plan files to the stable local plan directory", async () => {
    const envelope = await createPreparedPlan({
      command: "rlusd evm transfer prepare",
      chain: "ethereum-mainnet",
      timestamp: "2026-03-25T00:00:00.000Z",
      action: "evm.transfer",
      requires_confirmation: true,
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
        amount: "25.5",
      },
      intent: {
        to: "0x0000000000000000000000000000000000000002",
        data: "0xabc123",
      },
      warnings: ["mainnet", "real_funds"],
    });

    expect(envelope.data.plan_path).toContain(getPlansDir());

    const storedEnvelope = JSON.parse(readFileSync(envelope.data.plan_path, "utf-8"));
    expect(storedEnvelope.data.plan_id).toBe(envelope.data.plan_id);
    expect(storedEnvelope.data.plan_path).toBe(envelope.data.plan_path);
  });

  it("should reject tampered prepared plan files", async () => {
    const envelope = await createPreparedPlan({
      command: "rlusd xrpl payment prepare",
      chain: "xrpl-mainnet",
      timestamp: "2026-03-25T00:00:00.000Z",
      action: "xrpl.payment",
      requires_confirmation: true,
      human_summary: "Send RLUSD",
      asset: {
        symbol: "RLUSD",
        name: "Ripple USD",
        chain: "xrpl",
        family: "xrpl",
        issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
        currency: "524C555344000000000000000000000000000000",
      },
      params: {
        from: "ops",
        destination: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
        amount: "10",
      },
      intent: {
        transaction_type: "Payment",
        amount: "10",
      },
      warnings: ["mainnet", "real_funds"],
    });

    const tampered = JSON.parse(readFileSync(envelope.data.plan_path, "utf-8"));
    tampered.data.params.amount = "999";
    writeFileSync(envelope.data.plan_path, JSON.stringify(tampered, null, 2));

    await expect(loadPreparedPlan(envelope.data.plan_path)).rejects.toThrow(
      "Prepared plan contents do not match the stored deterministic plan id.",
    );
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

describe("Ethereum Command Registration", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register eth command with approve subcommands", () => {
    const program = createProgram();
    const ethCmd = program.commands.find((c) => c.name() === "eth");
    expect(ethCmd).toBeDefined();

    const subcommands = ethCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("approve");
    expect(subcommands).toContain("allowance");
    expect(subcommands).toContain("revoke");

    const approveCmd = ethCmd!.commands.find((c) => c.name() === "approve");
    const approveOptionNames = approveCmd!.options.map((o) => o.long);
    expect(approveOptionNames).toContain("--owner-wallet");
  });

  it("should register eth defi aave subcommands", () => {
    const program = createProgram();
    const ethCmd = program.commands.find((c) => c.name() === "eth");
    const defiCmd = ethCmd!.commands.find((c) => c.name() === "defi");
    expect(defiCmd).toBeDefined();

    const aaveCmd = defiCmd!.commands.find((c) => c.name() === "aave");
    expect(aaveCmd).toBeDefined();

    const subcommands = aaveCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("supply");
    expect(subcommands).toContain("withdraw");
    expect(subcommands).toContain("borrow");
    expect(subcommands).toContain("repay");
    expect(subcommands).toContain("status");
  });
});

describe("Ethereum Swap Command Registration", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register swap subcommands under eth", () => {
    const program = createProgram();
    const ethCmd = program.commands.find((c) => c.name() === "eth");
    const swapCmd = ethCmd!.commands.find((c) => c.name() === "swap");
    expect(swapCmd).toBeDefined();

    const subcommands = swapCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("sell");
    expect(subcommands).toContain("buy");
    expect(subcommands).toContain("quote");
    expect(subcommands).toContain("tokens");
  });

  it("should have required options on swap sell", () => {
    const program = createProgram();
    const ethCmd = program.commands.find((c) => c.name() === "eth");
    const swapCmd = ethCmd!.commands.find((c) => c.name() === "swap");
    const sellCmd = swapCmd!.commands.find((c) => c.name() === "sell");
    expect(sellCmd).toBeDefined();

    const optionNames = sellCmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--amount");
    expect(optionNames).toContain("--for");
    expect(optionNames).toContain("--slippage");
    expect(optionNames).toContain("--fee-tier");
    expect(optionNames).toContain("--dry-run");
  });
});

describe("Uniswap Router ABI", () => {
  it("should include exactInputSingle and exactOutputSingle", async () => {
    const { UNISWAP_V3_ROUTER_ABI } = await import("../../src/abi/uniswap-router.js");
    const fnNames = UNISWAP_V3_ROUTER_ABI.filter((i) => i.type === "function").map((i) => i.name);
    expect(fnNames).toContain("exactInputSingle");
    expect(fnNames).toContain("exactOutputSingle");
  });

  it("should include QuoterV2 ABI with quoteExactInputSingle", async () => {
    const { UNISWAP_QUOTER_V2_ABI } = await import("../../src/abi/uniswap-router.js");
    const fnNames = UNISWAP_QUOTER_V2_ABI.filter((i) => i.type === "function").map((i) => i.name);
    expect(fnNames).toContain("quoteExactInputSingle");
  });
});

describe("Well-Known Tokens", () => {
  it("should include major tokens", async () => {
    const { WELL_KNOWN_TOKENS } = await import("../../src/config/constants.js");
    expect(WELL_KNOWN_TOKENS.WETH).toBeDefined();
    expect(WELL_KNOWN_TOKENS.USDC).toBeDefined();
    expect(WELL_KNOWN_TOKENS.USDT).toBeDefined();
    expect(WELL_KNOWN_TOKENS.DAI).toBeDefined();
    expect(WELL_KNOWN_TOKENS.WBTC).toBeDefined();
    expect(WELL_KNOWN_TOKENS.RLUSD).toBeDefined();
  });

  it("should have correct USDC decimals", async () => {
    const { WELL_KNOWN_TOKENS } = await import("../../src/config/constants.js");
    expect(WELL_KNOWN_TOKENS.USDC.decimals).toBe(6);
    expect(WELL_KNOWN_TOKENS.WETH.decimals).toBe(18);
  });
});

describe("Aave Pool ABI", () => {
  it("should include core pool functions", async () => {
    const { AAVE_POOL_ABI } = await import("../../src/abi/aave-pool.js");
    const fnNames = AAVE_POOL_ABI.filter((i) => i.type === "function").map((i) => i.name);
    expect(fnNames).toContain("supply");
    expect(fnNames).toContain("withdraw");
    expect(fnNames).toContain("borrow");
    expect(fnNames).toContain("repay");
    expect(fnNames).toContain("getUserAccountData");
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

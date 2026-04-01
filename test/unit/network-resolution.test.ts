import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-network-resolution-${Date.now()}`);

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

describe("network-aware command resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    mkdirSync(TEST_HOME, { recursive: true });
    process.exitCode = 0;
  });

  afterEach(() => {
    delete process.env.RLUSD_WALLET_PASSWORD;
    vi.restoreAllMocks();
    rmSync(TEST_HOME, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("prepares ethereum-sepolia transfers with the Sepolia RLUSD contract", async () => {
    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateEvmWallet, serializeEvmWallet } = await import("../../src/wallet/evm-wallet.js");
    const { RLUSD_ETH_CONTRACT_TESTNET } = await import("../../src/config/constants.js");

    ensureConfigDir();
    setNetwork("mainnet");
    saveWallet(serializeEvmWallet("eth-ops", generateEvmWallet(), "p", "ethereum"));

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        [
          "--json",
          "evm",
          "transfer",
          "prepare",
          "--chain",
          "ethereum-sepolia",
          "--from-wallet",
          "eth-ops",
          "--to",
          "0x0000000000000000000000000000000000000001",
          "--amount",
          "25",
        ],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    const envelope = JSON.parse(capture.stdout.join("\n"));
    expect(envelope.ok).toBe(true);
    expect(envelope.chain).toBe("ethereum-sepolia");
    expect(envelope.data.asset.address).toBe(RLUSD_ETH_CONTRACT_TESTNET);
    expect(envelope.data.intent.to).toBe(RLUSD_ETH_CONTRACT_TESTNET);
  });

  it("prepares xrpl-testnet payments with the testnet issuer", async () => {
    vi.doMock("../../src/clients/xrpl-client.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/clients/xrpl-client.js")>(
        "../../src/clients/xrpl-client.js",
      );

      return {
        ...actual,
        getXrplTrustlineStatus: vi.fn().mockResolvedValue({
          present: true,
          account_exists: true,
        }),
        disconnectXrplClient: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateXrplWallet, serializeXrplWallet } = await import("../../src/wallet/xrpl-wallet.js");
    const { RLUSD_XRPL_ISSUER_TESTNET } = await import("../../src/config/constants.js");

    ensureConfigDir();
    setNetwork("mainnet");
    saveWallet(serializeXrplWallet("xrpl-ops", generateXrplWallet(), "p"));

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        [
          "--json",
          "xrpl",
          "payment",
          "prepare",
          "--chain",
          "xrpl-testnet",
          "--from-wallet",
          "xrpl-ops",
          "--to",
          "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
          "--amount",
          "25",
        ],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    const envelope = JSON.parse(capture.stdout.join("\n"));
    expect(envelope.ok).toBe(true);
    expect(envelope.chain).toBe("xrpl-testnet");
    expect(envelope.data.asset.issuer).toBe(RLUSD_XRPL_ISSUER_TESTNET);
    expect(envelope.data.intent.tx_json.Amount.issuer).toBe(RLUSD_XRPL_ISSUER_TESTNET);
  });

  it("executes ethereum-sepolia transfers against the Sepolia RPC", async () => {
    const createWalletClient = vi.fn().mockReturnValue({
      writeContract: vi.fn().mockResolvedValue("0xabc123"),
    });
    const http = vi.fn((url: string) => ({ url }));

    vi.doMock("viem", async () => {
      const actual = await vi.importActual<typeof import("viem")>("viem");
      return {
        ...actual,
        createWalletClient,
        http,
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    const { createPreparedPlan } = await import("../../src/plans/index.js");
    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateEvmWallet, serializeEvmWallet } = await import("../../src/wallet/evm-wallet.js");

    ensureConfigDir();
    setNetwork("mainnet");
    saveWallet(serializeEvmWallet("eth-ops", generateEvmWallet(), "p", "ethereum"));
    process.env.RLUSD_WALLET_PASSWORD = "p";

    const envelope = await createPreparedPlan({
      command: "evm.transfer.prepare",
      chain: "ethereum-sepolia",
      timestamp: "2026-03-29T00:00:00.000Z",
      action: "evm.transfer",
      requires_confirmation: false,
      human_summary: "Transfer 25 RLUSD on Ethereum Sepolia",
      asset: {
        symbol: "RLUSD",
        name: "Ripple USD",
        chain: "ethereum",
        family: "evm",
        address: "0xe101FB315a64cDa9944E570a7bFfaFE60b994b1D",
        decimals: 18,
      },
      params: {
        from: "eth-ops",
        to: "0x0000000000000000000000000000000000000001",
        amount: "25",
      },
      intent: {
        to: "0xe101FB315a64cDa9944E570a7bFfaFE60b994b1D",
        value: "0",
        function_name: "transfer",
        args: {
          to: "0x0000000000000000000000000000000000000001",
          amount_raw: "25000000000000000000",
        },
        data: "0xa9059cbb",
      },
      warnings: [],
    });

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        ["--json", "evm", "transfer", "execute", "--plan", envelope.data.plan_path],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    expect(http).toHaveBeenCalledWith("https://ethereum-sepolia-rpc.publicnode.com");
    expect(createWalletClient).toHaveBeenCalledOnce();
    const output = JSON.parse(capture.stdout.join("\n"));
    expect(output.ok).toBe(true);
    expect(output.chain).toBe("ethereum-sepolia");
  });

  it("prepares ethereum-sepolia defi supply plans with the Sepolia RLUSD contract", async () => {
    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateEvmWallet, serializeEvmWallet } = await import("../../src/wallet/evm-wallet.js");
    const { RLUSD_ETH_CONTRACT_TESTNET } = await import("../../src/config/constants.js");

    ensureConfigDir();
    setNetwork("mainnet");
    saveWallet(serializeEvmWallet("defi-ops", generateEvmWallet(), "p", "ethereum"));

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        [
          "--json",
          "defi",
          "supply",
          "prepare",
          "--chain",
          "ethereum-sepolia",
          "--venue",
          "aave",
          "--from-wallet",
          "defi-ops",
          "--amount",
          "25",
        ],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    const envelope = JSON.parse(capture.stdout.join("\n"));
    expect(envelope.ok).toBe(true);
    expect(envelope.chain).toBe("ethereum-sepolia");
    expect(envelope.data.asset.address).toBe(RLUSD_ETH_CONTRACT_TESTNET);
    expect(envelope.data.intent.steps[0].to).toBe(RLUSD_ETH_CONTRACT_TESTNET);
    expect(envelope.warnings).not.toContain("mainnet");
  });

  it("applies runtime --network overrides to RLUSD asset defaults in config get", async () => {
    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    const {
      RLUSD_ETH_CONTRACT_TESTNET,
      RLUSD_XRPL_ISSUER_TESTNET,
    } = await import("../../src/config/constants.js");

    ensureConfigDir();
    setNetwork("mainnet");

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        ["--json", "--network", "testnet", "config", "get"],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    const envelope = JSON.parse(capture.stdout.join("\n"));
    expect(envelope.ok).toBe(true);
    expect(envelope.data.environment).toBe("testnet");
    expect(envelope.data.rlusd.eth_contract).toBe(RLUSD_ETH_CONTRACT_TESTNET);
    expect(envelope.data.rlusd.xrpl_issuer).toBe(RLUSD_XRPL_ISSUER_TESTNET);
  });

  it("reads price with ethereum-sepolia against the Sepolia RPC", async () => {
    vi.doUnmock("../../src/clients/xrpl-client.js");
    const createPublicClient = vi.fn().mockReturnValue({
      readContract: vi
        .fn()
        .mockResolvedValueOnce([123n, 100000000n, 0n, BigInt(Math.floor(Date.now() / 1000))])
        .mockResolvedValueOnce(8),
    });
    const http = vi.fn((url: string) => ({ url }));

    vi.doMock("viem", async () => {
      const actual = await vi.importActual<typeof import("viem")>("viem");
      return {
        ...actual,
        createPublicClient,
        http,
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    ensureConfigDir();
    setNetwork("mainnet");

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        ["--json", "price", "--chain", "ethereum-sepolia"],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    expect(http).toHaveBeenCalledWith(
      "https://ethereum-sepolia-rpc.publicnode.com",
      expect.any(Object),
    );
    const output = JSON.parse(capture.stdout.join("\n"));
    const payload = output.ok ? output.data : output;
    expect(payload.evm_chain).toBe("ethereum");
    expect(payload.price_usd).toBe("1");
  });

  it("reads top-level tx status with ethereum-sepolia against the Sepolia RPC", async () => {
    vi.doUnmock("../../src/clients/xrpl-client.js");
    const createPublicClient = vi.fn().mockReturnValue({
      getTransactionReceipt: vi.fn().mockResolvedValue({
        transactionHash: "0xabc123",
        status: "success",
        blockNumber: 123n,
        gasUsed: 456n,
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        contractAddress: null,
      }),
    });
    const http = vi.fn((url: string) => ({ url }));

    vi.doMock("viem", async () => {
      const actual = await vi.importActual<typeof import("viem")>("viem");
      return {
        ...actual,
        createPublicClient,
        http,
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    ensureConfigDir();
    setNetwork("mainnet");

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        ["--json", "tx", "status", "0xabc123", "--chain", "ethereum-sepolia"],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    expect(http).toHaveBeenCalledWith(
      "https://ethereum-sepolia-rpc.publicnode.com",
      expect.any(Object),
    );
    const output = JSON.parse(capture.stdout.join("\n"));
    expect(output.chain).toBe("ethereum-sepolia");
    const payload = output.ok ? output.data : output;
    expect(payload.status).toBe("success");
  });

  it("reads top-level tx history with xrpl-testnet against the testnet issuer and websocket", async () => {
    const { RLUSD_XRPL_ISSUER_TESTNET, RLUSD_XRPL_CURRENCY_HEX } = await import("../../src/config/constants.js");
    const request = vi.fn().mockResolvedValue({
      result: {
        transactions: [
          {
            tx: {
              hash: "ABC123",
              TransactionType: "Payment",
              Account: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
              Destination: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
              Amount: {
                currency: RLUSD_XRPL_CURRENCY_HEX,
                issuer: RLUSD_XRPL_ISSUER_TESTNET,
                value: "25",
              },
              ledger_index: 123,
              date: 1,
            },
            meta: {
              TransactionResult: "tesSUCCESS",
            },
          },
        ],
      },
    });
    const getXrplClient = vi.fn().mockResolvedValue({ request });

    vi.doMock("../../src/clients/xrpl-client.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/clients/xrpl-client.js")>(
        "../../src/clients/xrpl-client.js",
      );

      return {
        ...actual,
        getXrplClient,
        disconnectXrplClient: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateXrplWallet, serializeXrplWallet } = await import("../../src/wallet/xrpl-wallet.js");

    ensureConfigDir();
    setNetwork("mainnet");
    saveWallet(serializeXrplWallet("xrpl-reader", generateXrplWallet(), "p"));

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        ["--json", "tx", "history", "--chain", "xrpl-testnet", "--limit", "1"],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    expect(getXrplClient).toHaveBeenCalledWith("testnet");
    const output = JSON.parse(capture.stdout.join("\n"));
    expect(output.chain).toBe("xrpl-testnet");
    const payload = output.ok ? output.data : output;
    expect(payload.transactions).toHaveLength(1);
  });

  it("reads trustline status with xrpl-testnet using the testnet issuer metadata", async () => {
    const { RLUSD_XRPL_ISSUER_TESTNET, RLUSD_XRPL_CURRENCY_HEX } = await import("../../src/config/constants.js");

    vi.doMock("../../src/clients/xrpl-client.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/clients/xrpl-client.js")>(
        "../../src/clients/xrpl-client.js",
      );

      return {
        ...actual,
        getXrplTrustlineStatus: vi.fn().mockResolvedValue({
          present: true,
          account_exists: true,
          balance: "25",
          limit: "1000",
          frozen: false,
        }),
        disconnectXrplClient: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    ensureConfigDir();
    setNetwork("mainnet");

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        [
          "--json",
          "xrpl",
          "trustline",
          "status",
          "--chain",
          "xrpl-testnet",
          "--address",
          "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
        ],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    const output = JSON.parse(capture.stdout.join("\n"));
    const payload = output.ok ? output.data : output;
    expect(payload.issuer).toBe(RLUSD_XRPL_ISSUER_TESTNET);
    expect(payload.currency).toBe(RLUSD_XRPL_CURRENCY_HEX);
    expect(payload.has_trustline).toBe(true);
  });

  it("runs xrpl pathfind with xrpl-testnet using the resolved testnet issuer and websocket", async () => {
    const { RLUSD_XRPL_ISSUER_TESTNET, RLUSD_XRPL_CURRENCY_HEX } = await import("../../src/config/constants.js");
    const request = vi.fn().mockResolvedValue({
      result: {
        source_account: "rSource1111111111111111111111111111111",
        destination_account: "rDest11111111111111111111111111111111",
        destination_amount: {
          currency: RLUSD_XRPL_CURRENCY_HEX,
          issuer: RLUSD_XRPL_ISSUER_TESTNET,
          value: "25",
        },
        alternatives: [],
      },
    });
    const getXrplClient = vi.fn().mockResolvedValue({ request });

    vi.doMock("../../src/clients/xrpl-client.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/clients/xrpl-client.js")>(
        "../../src/clients/xrpl-client.js",
      );

      return {
        ...actual,
        getXrplClient,
        disconnectXrplClient: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateXrplWallet, serializeXrplWallet } = await import("../../src/wallet/xrpl-wallet.js");

    ensureConfigDir();
    setNetwork("mainnet");
    saveWallet(serializeXrplWallet("xrpl-pathfind", generateXrplWallet(), "p"));

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        [
          "--json",
          "--chain",
          "xrpl-testnet",
          "xrpl",
          "pathfind",
          "--to",
          "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
          "--amount",
          "25",
        ],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    expect(getXrplClient).toHaveBeenCalledWith("testnet");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "ripple_path_find",
        destination_amount: expect.objectContaining({
          currency: RLUSD_XRPL_CURRENCY_HEX,
          issuer: RLUSD_XRPL_ISSUER_TESTNET,
          value: "25",
        }),
      }),
    );
  });

  it("reads xrpl dex orderbook with xrpl-testnet using the resolved testnet issuer and websocket", async () => {
    const { RLUSD_XRPL_ISSUER_TESTNET, RLUSD_XRPL_CURRENCY_HEX } = await import("../../src/config/constants.js");
    const request = vi.fn().mockResolvedValue({ result: { offers: [] } });
    const getXrplClient = vi.fn().mockResolvedValue({ request });

    vi.doMock("../../src/clients/xrpl-client.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/clients/xrpl-client.js")>(
        "../../src/clients/xrpl-client.js",
      );

      return {
        ...actual,
        getXrplClient,
        disconnectXrplClient: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    ensureConfigDir();
    setNetwork("mainnet");

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        ["--json", "--chain", "xrpl-testnet", "xrpl", "dex", "orderbook"],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    expect(getXrplClient).toHaveBeenCalledWith("testnet");
    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "book_offers",
        taker_gets: {
          currency: RLUSD_XRPL_CURRENCY_HEX,
          issuer: RLUSD_XRPL_ISSUER_TESTNET,
        },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: "book_offers",
        taker_pays: {
          currency: RLUSD_XRPL_CURRENCY_HEX,
          issuer: RLUSD_XRPL_ISSUER_TESTNET,
        },
      }),
    );
  });

  it("reads balance with ethereum-sepolia using the Sepolia RPC and chain label", async () => {
    vi.doUnmock("../../src/clients/xrpl-client.js");
    const createPublicClient = vi.fn().mockReturnValue({
      readContract: vi.fn().mockResolvedValue(25000000000000000000n),
      getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
    });
    const http = vi.fn((url: string) => ({ url }));

    vi.doMock("viem", async () => {
      const actual = await vi.importActual<typeof import("viem")>("viem");
      return {
        ...actual,
        createPublicClient,
        http,
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateEvmWallet, serializeEvmWallet } = await import("../../src/wallet/evm-wallet.js");

    ensureConfigDir();
    setNetwork("mainnet");
    saveWallet(serializeEvmWallet("eth-balance", generateEvmWallet(), "p", "ethereum"));

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        ["--json", "balance", "--chain", "ethereum-sepolia"],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    expect(http).toHaveBeenCalledWith(
      "https://ethereum-sepolia-rpc.publicnode.com",
      expect.any(Object),
    );
    const output = JSON.parse(capture.stdout.join("\n"));
    expect(output.chain).toBe("ethereum-sepolia");
    const payload = output.ok ? output.data : output;
    expect(payload.rlusd_balance).toBe("25");
  });

  it("reads balance with xrpl-testnet using the resolved testnet issuer and websocket", async () => {
    const getXrplBalance = vi.fn().mockResolvedValue({
      xrp: "1",
      rlusd: "25",
    });

    vi.doMock("../../src/clients/xrpl-client.js", async () => {
      const actual = await vi.importActual<typeof import("../../src/clients/xrpl-client.js")>(
        "../../src/clients/xrpl-client.js",
      );

      return {
        ...actual,
        getXrplBalance,
        disconnectXrplClient: vi.fn().mockResolvedValue(undefined),
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateXrplWallet, serializeXrplWallet } = await import("../../src/wallet/xrpl-wallet.js");

    ensureConfigDir();
    setNetwork("mainnet");
    saveWallet(serializeXrplWallet("xrpl-balance", generateXrplWallet(), "p"));

    const capture = captureConsole();

    try {
      const { createProgram } = await import("../../src/cli.js");
      const program = createProgram();
      program.exitOverride();
      await program.parseAsync(
        ["--json", "balance", "--chain", "xrpl-testnet"],
        { from: "user" },
      );
    } finally {
      capture.restore();
    }

    expect(capture.stderr).toEqual([]);
    expect(getXrplBalance).toHaveBeenCalledWith(expect.any(String), "testnet");
    const output = JSON.parse(capture.stdout.join("\n"));
    expect(output.chain).toBe("xrpl-testnet");
    const payload = output.ok ? output.data : output;
    expect(payload.rlusd_balance).toBe("25");
  });
});

describe("network-aware client resolution", () => {
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

  it("uses the requested testnet RPC when building an ethereum public client", async () => {
    const createPublicClient = vi.fn().mockReturnValue({ chain: { id: 11155111 } });
    const http = vi.fn((url: string) => ({ url }));

    vi.doMock("viem", async () => {
      const actual = await vi.importActual<typeof import("viem")>("viem");
      return {
        ...actual,
        createPublicClient,
        http,
      };
    });

    const { ensureConfigDir, setNetwork } = await import("../../src/config/config.js");
    ensureConfigDir();
    setNetwork("mainnet");

    const { getEvmPublicClient } = await import("../../src/clients/evm-client.js");
    const client = getEvmPublicClient("ethereum", "testnet");

    expect(client).toBeDefined();
    expect(http).toHaveBeenCalledWith(
      "https://ethereum-sepolia-rpc.publicnode.com",
      expect.objectContaining({
        retryCount: 2,
        retryDelay: 1_000,
        timeout: 30_000,
      }),
    );
    expect(createPublicClient).toHaveBeenCalledOnce();
  });

  it("preserves configured XRPL websocket overrides when resolving the active network config", async () => {
    const { ensureConfigDir, loadConfig, saveConfig } = await import("../../src/config/config.js");
    ensureConfigDir();
    const config = loadConfig();
    config.environment = "testnet";
    config.chains.xrpl = {
      ...config.chains.xrpl,
      websocket: "wss://custom.xrpl.test/ws",
    };
    saveConfig(config);

    const { resolveConfigForNetwork } = await import("../../src/config/config.js");
    const resolved = resolveConfigForNetwork("testnet");

    expect(resolved.chains.xrpl?.websocket).toBe("wss://custom.xrpl.test/ws");
  });
});

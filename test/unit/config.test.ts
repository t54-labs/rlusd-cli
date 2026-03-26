import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as yamlParse } from "yaml";
import type { AppConfig } from "../../src/types/index.js";

// We mock os.homedir() to use a temp directory so tests don't touch real config
const TEST_HOME = join(tmpdir(), `rlusd-cli-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

// Import after mocking
const {
  loadConfig,
  saveConfig,
  setNetwork,
  setChainRpc,
  setDefaultChain,
  setOutputFormat,
  getConfigDir,
  getConfigPath,
  getWalletsDir,
  getPlansDir,
  ensureConfigDir,
} = await import("../../src/config/config.js");

const { getNetworkPreset, isValidNetwork } = await import("../../src/config/networks.js");
const { getPreparePolicy } = await import("../../src/policy/index.js");
const { resolveCurvePool } = await import("../../src/defi/curve-pool.js");

const {
  RLUSD_XRPL_ISSUER,
  RLUSD_XRPL_ISSUER_TESTNET,
  RLUSD_ETH_CONTRACT,
  RLUSD_ETH_CONTRACT_TESTNET,
  CURVE_RLUSD_USDC_POOL_ETHEREUM,
} = await import("../../src/config/constants.js");

describe("Config System", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
  });

  afterEach(() => {
    delete process.env.RLUSD_RUNTIME_NETWORK;
    delete process.env.RLUSD_RUNTIME_OUTPUT;
    delete process.env.RLUSD_RUNTIME_CHAIN;
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  describe("getConfigDir / getConfigPath / getWalletsDir", () => {
    it("should return paths under home directory", () => {
      expect(getConfigDir()).toBe(join(TEST_HOME, ".config/rlusd-cli"));
      expect(getConfigPath()).toBe(join(TEST_HOME, ".config/rlusd-cli/config.yml"));
      expect(getWalletsDir()).toBe(join(TEST_HOME, ".config/rlusd-cli/wallets"));
      expect(getPlansDir()).toBe(join(TEST_HOME, ".config/rlusd-cli/plans"));
    });
  });

  describe("ensureConfigDir", () => {
    it("should create config, wallets, and plans directories", () => {
      ensureConfigDir();
      expect(existsSync(getConfigDir())).toBe(true);
      expect(existsSync(getWalletsDir())).toBe(true);
      expect(existsSync(getPlansDir())).toBe(true);
    });

    it("should be idempotent", () => {
      ensureConfigDir();
      ensureConfigDir();
      expect(existsSync(getConfigDir())).toBe(true);
    });
  });

  describe("loadConfig", () => {
    it("should create default config if none exists", () => {
      const config = loadConfig();
      expect(config.environment).toBe("testnet");
      expect(config.default_chain).toBe("xrpl");
      expect(config.output_format).toBe("table");
      expect(config.rlusd.xrpl_issuer).toBe(RLUSD_XRPL_ISSUER_TESTNET);
      expect(config.rlusd.eth_contract).toBe(RLUSD_ETH_CONTRACT_TESTNET);
    });

    it("should persist the default config to disk", () => {
      loadConfig();
      expect(existsSync(getConfigPath())).toBe(true);
    });

    it("should load an existing config from disk", () => {
      const config = loadConfig();
      config.environment = "mainnet";
      saveConfig(config);

      const reloaded = loadConfig();
      expect(reloaded.environment).toBe("mainnet");
    });

    it("should merge partial config with defaults", () => {
      ensureConfigDir();
      const partialYaml = "environment: mainnet\ndefault_chain: ethereum\n";
      fsWriteFileSync(getConfigPath(), partialYaml, "utf-8");

      const config = loadConfig();
      expect(config.environment).toBe("mainnet");
      expect(config.default_chain).toBe("ethereum");
      expect(config.rlusd.xrpl_issuer).toBe(RLUSD_XRPL_ISSUER);
      expect(config.chains.xrpl).toBeDefined();
    });

    it("should deep-merge partial chain config with default RPC values", () => {
      ensureConfigDir();
      const partialYaml =
        "environment: testnet\nchains:\n  ethereum:\n    default_wallet: mywallet\n";
      fsWriteFileSync(getConfigPath(), partialYaml, "utf-8");

      const config = loadConfig();
      expect(config.chains.ethereum.default_wallet).toBe("mywallet");
      expect(config.chains.ethereum.rpc).toBeTruthy();
      expect(config.chains.ethereum.rpc).toContain("sepolia");
    });

    it("should include all chain configs from the preset", () => {
      const config = loadConfig();
      expect(config.chains.xrpl).toBeDefined();
      expect(config.chains.ethereum).toBeDefined();
      expect(config.chains.xrpl.websocket).toContain("rippletest.net");
    });

    it("should fall back to testnet when stored environment is invalid", () => {
      ensureConfigDir();
      fsWriteFileSync(getConfigPath(), "environment: broken\n", "utf-8");
      const config = loadConfig();
      expect(config.environment).toBe("testnet");
    });

    it("should apply runtime network override without persisting it", () => {
      setNetwork("testnet");
      process.env.RLUSD_RUNTIME_NETWORK = "mainnet";
      const runtimeConfig = loadConfig();
      expect(runtimeConfig.environment).toBe("mainnet");
      expect(runtimeConfig.chains.xrpl.websocket).toBe("wss://xrplcluster.com/");

      delete process.env.RLUSD_RUNTIME_NETWORK;
      const persistedConfig = loadConfig();
      expect(persistedConfig.environment).toBe("testnet");
    });

    it("should apply runtime output and chain overrides", () => {
      process.env.RLUSD_RUNTIME_OUTPUT = "json";
      process.env.RLUSD_RUNTIME_CHAIN = "ethereum";
      const config = loadConfig();
      expect(config.output_format).toBe("json");
      expect(config.default_chain).toBe("ethereum");
    });

    it("should include the default Ethereum Curve RLUSD-USDC pool address", () => {
      const config = loadConfig();
      expect(config.contracts?.ethereum?.curve_rlusd_usdc_pool).toBe(CURVE_RLUSD_USDC_POOL_ETHEREUM);
    });
  });

  describe("saveConfig", () => {
    it("should write valid YAML to disk", () => {
      const config = loadConfig();
      config.default_chain = "ethereum";
      saveConfig(config);

      const raw = readFileSync(getConfigPath(), "utf-8");
      const parsed = yamlParse(raw) as AppConfig;
      expect(parsed.default_chain).toBe("ethereum");
    });
  });

  describe("setNetwork", () => {
    it("should switch to mainnet", () => {
      loadConfig(); // ensure initial config
      const config = setNetwork("mainnet");
      expect(config.environment).toBe("mainnet");
      expect(config.chains.xrpl.websocket).toBe("wss://xrplcluster.com/");
      expect(config.rlusd.eth_contract).toBe(RLUSD_ETH_CONTRACT);
    });

    it("should switch to testnet", () => {
      setNetwork("mainnet");
      const config = setNetwork("testnet");
      expect(config.environment).toBe("testnet");
      expect(config.chains.xrpl.websocket).toContain("altnet.rippletest.net");
      expect(config.rlusd.eth_contract).toBe(RLUSD_ETH_CONTRACT_TESTNET);
    });

    it("should switch to devnet", () => {
      const config = setNetwork("devnet");
      expect(config.environment).toBe("devnet");
      expect(config.chains.xrpl.websocket).toContain("devnet.rippletest.net");
    });

    it("should persist the change to disk", () => {
      setNetwork("mainnet");
      const reloaded = loadConfig();
      expect(reloaded.environment).toBe("mainnet");
    });
  });

  describe("setChainRpc", () => {
    it("should set XRPL websocket endpoint", () => {
      loadConfig();
      const config = setChainRpc("xrpl", "wss://custom-xrpl:51233/");
      expect(config.chains.xrpl.websocket).toBe("wss://custom-xrpl:51233/");
    });

    it("should set Ethereum RPC endpoint", () => {
      loadConfig();
      const config = setChainRpc("ethereum", "https://my-alchemy-key.com");
      expect(config.chains.ethereum.rpc).toBe("https://my-alchemy-key.com");
    });

    it("should set Base RPC endpoint", () => {
      loadConfig();
      const config = setChainRpc("base", "https://custom-base-rpc.com");
      expect(config.chains.base.rpc).toBe("https://custom-base-rpc.com");
    });

    it("should persist the change to disk", () => {
      loadConfig();
      setChainRpc("ethereum", "https://persisted-rpc.com");
      const reloaded = loadConfig();
      expect(reloaded.chains.ethereum.rpc).toBe("https://persisted-rpc.com");
    });
  });

  describe("setDefaultChain", () => {
    it("should change the default chain", () => {
      loadConfig();
      const config = setDefaultChain("ethereum");
      expect(config.default_chain).toBe("ethereum");
    });

    it("should persist the change to disk", () => {
      loadConfig();
      setDefaultChain("base");
      const reloaded = loadConfig();
      expect(reloaded.default_chain).toBe("base");
    });
  });

  describe("setOutputFormat", () => {
    it("should change the output format", () => {
      loadConfig();
      const config = setOutputFormat("json");
      expect(config.output_format).toBe("json");
    });

    it("should support json-compact format", () => {
      loadConfig();
      const config = setOutputFormat("json-compact");
      expect(config.output_format).toBe("json-compact");
    });
  });

  describe("prepare policy", () => {
    it("should require confirmation metadata for mainnet actions", () => {
      const transferPolicy = getPreparePolicy("xrpl-mainnet", "xrpl.payment");
      expect(transferPolicy.requires_confirmation).toBe(true);
      expect(transferPolicy.warnings).toContain("mainnet");
    });

    it("should not require confirmation metadata for non-mainnet actions", () => {
      const transferPolicy = getPreparePolicy("ethereum-sepolia", "evm.transfer");
      expect(transferPolicy.requires_confirmation).toBe(false);
      expect(transferPolicy.warnings).toEqual([]);
    });

    it("should require mainnet confirmation metadata for new defi plan actions", () => {
      const swapPolicy = getPreparePolicy("ethereum-mainnet", "defi.swap");
      const lpPolicy = getPreparePolicy("ethereum-mainnet", "defi.lp");

      expect(swapPolicy).toEqual({
        requires_confirmation: true,
        warnings: ["mainnet", "real_funds", "token_allowance"],
      });
      expect(lpPolicy).toEqual({
        requires_confirmation: true,
        warnings: ["mainnet", "real_funds", "token_allowance"],
      });
    });
  });

  describe("curve pool resolver", () => {
    it("should reject non-Ethereum-mainnet labels", () => {
      const config = loadConfig();
      expect(() => resolveCurvePool("ethereum-sepolia", config)).toThrow("ethereum-mainnet");
      expect(() => resolveCurvePool("base-mainnet", config)).toThrow("ethereum-mainnet");
    });

    it("should resolve the fixed pool only for ethereum-mainnet", () => {
      const config = loadConfig();
      const pool = resolveCurvePool("ethereum-mainnet", config);

      expect(pool.chain).toBe("ethereum-mainnet");
      expect(pool.address).toBe(CURVE_RLUSD_USDC_POOL_ETHEREUM);
      expect(pool.lpTokenAddress).toBe(CURVE_RLUSD_USDC_POOL_ETHEREUM);
      expect(pool.coins.map((coin) => coin.symbol)).toEqual(["USDC", "RLUSD"]);
      expect(pool.coinIndexBySymbol).toEqual({
        USDC: 0,
        RLUSD: 1,
      });
    });

    it("should use config override address and warn about metadata assumptions", () => {
      const override = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF";
      const config = loadConfig();
      config.contracts = { ethereum: { curve_rlusd_usdc_pool: override } };
      saveConfig(config);

      const warnSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const reloaded = loadConfig();
        const pool = resolveCurvePool("ethereum-mainnet", reloaded);

        expect(pool.address).toBe(override);
        expect(pool.lpTokenAddress).toBe(override);
        expect(pool.coins.map((c) => c.symbol)).toEqual(["USDC", "RLUSD"]);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("config override"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should not warn when override matches the canonical address", () => {
      const config = loadConfig();
      config.contracts = { ethereum: { curve_rlusd_usdc_pool: CURVE_RLUSD_USDC_POOL_ETHEREUM } };
      saveConfig(config);

      const warnSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const reloaded = loadConfig();
        const pool = resolveCurvePool("ethereum-mainnet", reloaded);

        expect(pool.address).toBe(CURVE_RLUSD_USDC_POOL_ETHEREUM);
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("config override"),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

});

describe("Network Presets", () => {
  it("should return mainnet preset", () => {
    const preset = getNetworkPreset("mainnet");
    expect(preset.chains.xrpl.websocket).toBe("wss://xrplcluster.com/");
    expect(preset.chains.ethereum.rpc).toBeDefined();
  });

  it("should return testnet preset", () => {
    const preset = getNetworkPreset("testnet");
    expect(preset.chains.xrpl.websocket).toContain("altnet.rippletest.net");
  });

  it("should return devnet preset", () => {
    const preset = getNetworkPreset("devnet");
    expect(preset.chains.xrpl.websocket).toContain("devnet.rippletest.net");
  });

  it("should include base and optimism in all presets", () => {
    for (const env of ["mainnet", "testnet", "devnet"] as const) {
      const preset = getNetworkPreset(env);
      expect(preset.chains.base).toBeDefined();
      expect(preset.chains.optimism).toBeDefined();
    }
  });
});

describe("isValidNetwork", () => {
  it("should accept valid network names", () => {
    expect(isValidNetwork("mainnet")).toBe(true);
    expect(isValidNetwork("testnet")).toBe(true);
    expect(isValidNetwork("devnet")).toBe(true);
  });

  it("should reject invalid network names", () => {
    expect(isValidNetwork("invalid")).toBe(false);
    expect(isValidNetwork("")).toBe(false);
    expect(isValidNetwork("Mainnet")).toBe(false);
  });
});

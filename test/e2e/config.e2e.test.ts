import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-e2e-config-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { createProgram } = await import("../../src/cli.js");

describe("Config Command E2E", () => {
  let consoleOutput: string[];
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    consoleOutput = [];
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should display configuration with 'config get'", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["config", "get"], { from: "user" });
    const output = consoleOutput.join("\n");
    expect(output).toContain("testnet");
    expect(output).toContain("xrpl");
  });

  it("should display config as JSON with --output json", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--output", "json", "config", "get"], { from: "user" });
    const output = consoleOutput.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.environment).toBe("testnet");
    expect(parsed.rlusd).toBeDefined();
  });

  it("should switch network with 'config set --network mainnet'", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["config", "set", "--network", "mainnet"], { from: "user" });
    const output = consoleOutput.join("\n");
    expect(output).toContain("mainnet");

    // Verify persisted
    consoleOutput = [];
    const program2 = createProgram();
    program2.exitOverride();
    program2.parse(["--output", "json", "config", "get"], { from: "user" });
    const config = JSON.parse(consoleOutput.join("\n"));
    expect(config.environment).toBe("mainnet");
  });

  it("should reject invalid network", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["config", "set", "-n", "invalid"], { from: "user" });
    const output = consoleOutput.join("\n");
    expect(output).toContain("Invalid network");
  });

  it("should set custom RPC with 'config set --chain ethereum --rpc <url>'", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(
      ["config", "set", "--chain", "ethereum", "--rpc", "https://custom-rpc.com"],
      { from: "user" },
    );
    expect(consoleOutput.join("\n")).toContain("https://custom-rpc.com");

    consoleOutput = [];
    const program2 = createProgram();
    program2.exitOverride();
    program2.parse(["--output", "json", "config", "get"], { from: "user" });
    const config = JSON.parse(consoleOutput.join("\n"));
    expect(config.chains.ethereum.rpc).toBe("https://custom-rpc.com");
  });

  it("should reject --rpc without --chain", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["config", "set", "--rpc", "https://example.com"], { from: "user" });
    expect(consoleOutput.join("\n")).toContain("--chain is required");
  });

  it("should set default chain", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["config", "set", "--default-chain", "ethereum"], { from: "user" });
    expect(consoleOutput.join("\n")).toContain("ethereum");
  });

  it("should set output format", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["config", "set", "--format", "json"], { from: "user" });
    expect(consoleOutput.join("\n")).toContain("json");
  });
});

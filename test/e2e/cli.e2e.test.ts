import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-e2e-cli-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { createProgram } = await import("../../src/cli.js");
const { ensureConfigDir } = await import("../../src/config/config.js");

describe("CLI E2E — Full Command Tree Verification", () => {
  let consoleOutput: string[];
  const origLog = console.log;
  const origError = console.error;
  const origStdout = process.stdout.write;

  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
    consoleOutput = [];
    console.log = (...args: unknown[]) => consoleOutput.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => consoleOutput.push(args.map(String).join(" "));
    process.stdout.write = ((chunk: string | Uint8Array) => {
      consoleOutput.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    console.log = origLog;
    console.error = origError;
    process.stdout.write = origStdout;
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should display version with --version", () => {
    const program = createProgram();
    program.exitOverride();
    try {
      program.parse(["--version"], { from: "user" });
    } catch {
      // Commander throws on --version with exitOverride
    }
    expect(consoleOutput.join("\n")).toContain("0.1.0");
  });

  it("should generate and list XRPL wallet", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["wallet", "generate", "--chain", "xrpl", "--name", "test-xrpl", "--password", "pass"], { from: "user" });

    const output = consoleOutput.join("\n");
    expect(output).toContain("test-xrpl");
    expect(output).toContain("XRPL wallet generated");

    consoleOutput = [];
    const program2 = createProgram();
    program2.exitOverride();
    program2.parse(["--output", "json", "wallet", "list"], { from: "user" });
    const listOutput = consoleOutput.join("\n");
    const parsed = JSON.parse(listOutput);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].name).toBe("test-xrpl");
  });

  it("should generate and list EVM wallet", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--chain", "ethereum", "wallet", "generate", "--name", "test-evm", "--password", "pass"], { from: "user" });

    const output = consoleOutput.join("\n");
    expect(output).toContain("test-evm");
    expect(output).toContain("EVM wallet generated");
  });

  it("should show wallet address", () => {
    const gen = createProgram();
    gen.exitOverride();
    gen.parse(["wallet", "generate", "--chain", "xrpl", "--name", "addr-test", "--password", "p"], { from: "user" });

    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    program.parse(["wallet", "address", "--chain", "xrpl"], { from: "user" });
    const output = consoleOutput.join("\n");
    expect(output).toContain("addr-test");
  });

  it("should switch default wallet with 'wallet use'", () => {
    const gen1 = createProgram();
    gen1.exitOverride();
    gen1.parse(["wallet", "generate", "--chain", "xrpl", "--name", "w1", "--password", "p"], { from: "user" });

    const gen2 = createProgram();
    gen2.exitOverride();
    gen2.parse(["wallet", "generate", "--chain", "xrpl", "--name", "w2", "--password", "p"], { from: "user" });

    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    program.parse(["wallet", "use", "w1", "--chain", "xrpl"], { from: "user" });
    expect(consoleOutput.join("\n")).toContain("w1");
  });

  it("should output bash completion script", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["completion", "--shell", "bash"], { from: "user" });
    const output = consoleOutput.join("\n");
    expect(output).toContain("_rlusd_completion");
    expect(output).toContain("complete -F");
  });

  it("should output zsh completion script", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["completion", "--shell", "zsh"], { from: "user" });
    expect(consoleOutput.join("\n")).toContain("compdef _rlusd rlusd");
  });

  it("should output fish completion script", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["completion", "--shell", "fish"], { from: "user" });
    expect(consoleOutput.join("\n")).toContain("complete -c rlusd");
  });

  it("should reject bridge from XRPL", async () => {
    const program = createProgram();
    program.exitOverride();
    try {
      await program.parseAsync(["bridge", "--from", "xrpl", "--to", "ethereum", "--amount", "100"], { from: "user" });
    } catch {
      // may throw
    }
    expect(consoleOutput.join("\n").toLowerCase()).toContain("xrpl");
  });

  it("should switch network and verify config persisted", () => {
    const p1 = createProgram();
    p1.exitOverride();
    p1.parse(["config", "set", "--network", "mainnet"], { from: "user" });

    consoleOutput = [];
    const p2 = createProgram();
    p2.exitOverride();
    p2.parse(["--output", "json", "config", "get"], { from: "user" });
    const config = JSON.parse(consoleOutput.join("\n"));
    expect(config.environment).toBe("mainnet");
    expect(config.chains.xrpl.websocket).toBe("wss://xrplcluster.com/");
  });
});

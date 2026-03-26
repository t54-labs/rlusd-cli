import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
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
    expect(consoleOutput.join("\n")).toContain("0.2.0");
  });

  it("should generate and list XRPL wallet", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["wallet", "generate", "--chain", "xrpl", "--name", "test-xrpl", "--password", "pass", "--no-store-in-keychain"], { from: "user" });

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
    program.parse(["--chain", "ethereum", "wallet", "generate", "--name", "test-evm", "--password", "pass", "--no-store-in-keychain"], { from: "user" });

    const output = consoleOutput.join("\n");
    expect(output).toContain("test-evm");
    expect(output).toContain("EVM wallet generated");
  });

  it("should show wallet address", () => {
    const gen = createProgram();
    gen.exitOverride();
    gen.parse(["wallet", "generate", "--chain", "xrpl", "--name", "addr-test", "--password", "p", "--no-store-in-keychain"], { from: "user" });

    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    program.parse(["wallet", "address", "--chain", "xrpl"], { from: "user" });
    const output = consoleOutput.join("\n");
    expect(output).toContain("addr-test");
  });

  it("should export XRPL seed for an existing wallet", () => {
    const gen = createProgram();
    gen.exitOverride();
    gen.parse(
      [
        "wallet",
        "generate",
        "--chain",
        "xrpl",
        "--name",
        "seed-test",
        "--password",
        "p",
        "--no-store-in-keychain",
      ],
      { from: "user" },
    );

    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    program.parse(
      ["wallet", "export-seed", "--wallet", "seed-test", "--password", "p"],
      { from: "user" },
    );
    const output = consoleOutput.join("\n");
    expect(output).toContain("Seed");
    expect(output).toContain("seed-test");
    expect(output).toMatch(/sEd|^.*Seed: s/m);
  });

  it("should show a clear error when export-seed password is wrong", () => {
    const gen = createProgram();
    gen.exitOverride();
    gen.parse(
      [
        "wallet",
        "generate",
        "--chain",
        "xrpl",
        "--name",
        "seed-wrong-password",
        "--password",
        "correct-password",
        "--no-store-in-keychain",
      ],
      { from: "user" },
    );

    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    program.parse(
      [
        "wallet",
        "export-seed",
        "--wallet",
        "seed-wrong-password",
        "--password",
        "wrong-password",
      ],
      { from: "user" },
    );
    const output = consoleOutput.join("\n");
    expect(output).toContain("does not decrypt wallet");
  });

  it("should switch default wallet with 'wallet use'", () => {
    const gen1 = createProgram();
    gen1.exitOverride();
    gen1.parse(["wallet", "generate", "--chain", "xrpl", "--name", "w1", "--password", "p", "--no-store-in-keychain"], { from: "user" });

    const gen2 = createProgram();
    gen2.exitOverride();
    gen2.parse(["wallet", "generate", "--chain", "xrpl", "--name", "w2", "--password", "p", "--no-store-in-keychain"], { from: "user" });

    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    program.parse(["wallet", "use", "w1", "--chain", "xrpl"], { from: "user" });
    expect(consoleOutput.join("\n")).toContain("w1");
  });

  it("should create and store an evm transfer plan with --json", async () => {
    const gen = createProgram();
    gen.exitOverride();
    gen.parse(["--chain", "ethereum", "wallet", "generate", "--name", "evm-plan", "--password", "p", "--no-store-in-keychain"], {
      from: "user",
    });

    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(
      [
        "--json",
        "evm",
        "transfer",
        "prepare",
        "--chain",
        "ethereum-mainnet",
        "--from-wallet",
        "evm-plan",
        "--to",
        "0x0000000000000000000000000000000000000001",
        "--amount",
        "25.5",
      ],
      { from: "user" },
    );

    const output = JSON.parse(consoleOutput.join("\n"));
    expect(output.ok).toBe(true);
    expect(output.command).toBe("evm.transfer.prepare");
    expect(output.data.plan_id).toMatch(/^plan_[0-9a-f]{12}$/);
    expect(output.data.action).toBe("evm.transfer");
    expect(output.data.plan_path).toBeTruthy();
    expect(existsSync(output.data.plan_path)).toBe(true);

    const stored = JSON.parse(readFileSync(output.data.plan_path, "utf-8"));
    expect(stored).toEqual(output);
  });

  it("should create and store an xrpl trustline plan with --json", async () => {
    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(
      [
        "--json",
        "xrpl",
        "trustline",
        "prepare",
        "--chain",
        "xrpl-mainnet",
        "--address",
        "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
        "--limit",
        "100000",
      ],
      { from: "user" },
    );

    const output = JSON.parse(consoleOutput.join("\n"));
    expect(output.ok).toBe(true);
    expect(output.command).toBe("xrpl.trustline.prepare");
    expect(output.data.plan_id).toMatch(/^plan_[0-9a-f]{12}$/);
    expect(output.data.action).toBe("xrpl.trustline");
    expect(output.data.plan_path).toBeTruthy();
    expect(existsSync(output.data.plan_path)).toBe(true);

    const stored = JSON.parse(readFileSync(output.data.plan_path, "utf-8"));
    expect(stored).toEqual(output);
  });

  it("should print defi venues as JSON", async () => {
    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(
      ["--json", "defi", "venues", "--chain", "ethereum-mainnet", "--capability", "swap,lend,lp"],
      { from: "user" },
    );

    const output = JSON.parse(consoleOutput.join("\n"));
    expect(output.ok).toBe(true);
    expect(output.command).toBe("defi.venues");
    expect(output.data.capability_filter).toEqual(["swap", "lend", "lp"]);
    expect(Array.isArray(output.data.venues)).toBe(true);
    expect(output.data.venues.length).toBeGreaterThan(0);
  });

  it("should print defi supply preview as JSON", async () => {
    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(
      ["--json", "defi", "supply", "preview", "--chain", "ethereum-mainnet", "--venue", "aave", "--amount", "5000"],
      { from: "user" },
    );

    const output = JSON.parse(consoleOutput.join("\n"));
    expect(output.ok).toBe(true);
    expect(output.command).toBe("defi.supply.preview");
    expect(output.data.venue).toBe("aave");
    expect(output.warnings).toContain("preview_only");
  });

  it("should create and store a defi supply plan with --json", async () => {
    const gen = createProgram();
    gen.exitOverride();
    gen.parse(["--chain", "ethereum", "wallet", "generate", "--name", "defi-plan", "--password", "p", "--no-store-in-keychain"], {
      from: "user",
    });

    consoleOutput = [];
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(
      [
        "--json",
        "defi",
        "supply",
        "prepare",
        "--chain",
        "ethereum-mainnet",
        "--venue",
        "aave",
        "--from-wallet",
        "defi-plan",
        "--amount",
        "5000",
      ],
      { from: "user" },
    );

    const output = JSON.parse(consoleOutput.join("\n"));
    expect(output.ok).toBe(true);
    expect(output.command).toBe("defi.supply.prepare");
    expect(output.data.plan_id).toMatch(/^plan_[0-9a-f]{12}$/);
    expect(output.data.action).toBe("defi.supply");
    expect(output.data.plan_path).toBeTruthy();
    expect(existsSync(output.data.plan_path)).toBe(true);
    expect(output.warnings).toContain("token_allowance");
    expect(output.warnings).not.toContain("preview_only");

    const stored = JSON.parse(readFileSync(output.data.plan_path, "utf-8"));
    expect(stored).toEqual(output);
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

  it("should stop execution on invalid runtime network override", async () => {
    const program = createProgram();
    program.exitOverride();
    try {
      await program.parseAsync(
        ["--network", "bogus", "config", "get"],
        { from: "user" },
      );
    } catch {
      // expected
    }
    const output = consoleOutput.join("\n");
    expect(output).toContain("Invalid --network value");
    expect(output).not.toContain("Environment:");
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

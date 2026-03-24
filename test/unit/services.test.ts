import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-services-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { estimateXrplFee } = await import("../../src/services/gas-estimator.js");
const { ensureConfigDir } = await import("../../src/config/config.js");
const { createProgram } = await import("../../src/cli.js");

describe("Gas Estimator", () => {
  it("should return standard XRPL fee", async () => {
    const fee = await estimateXrplFee();
    expect(fee).toBe("0.000012");
    expect(parseFloat(fee)).toBeGreaterThan(0);
  });
});

describe("Bridge Command Registration", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should register bridge command", () => {
    const program = createProgram();
    const bridgeCmd = program.commands.find((c) => c.name() === "bridge");
    expect(bridgeCmd).toBeDefined();
  });

  it("should have bridge subcommands", () => {
    const program = createProgram();
    const bridgeCmd = program.commands.find((c) => c.name() === "bridge");
    expect(bridgeCmd).toBeDefined();

    const subcommands = bridgeCmd!.commands.map((c) => c.name());
    expect(subcommands).toContain("estimate");
    expect(subcommands).toContain("status");
    expect(subcommands).toContain("history");
  });
});

describe("Bridge XRPL Limitation", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should reject XRPL as bridge source", async () => {
    const consoleOutput: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => consoleOutput.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => consoleOutput.push(args.map(String).join(" "));

    const program = createProgram();
    program.exitOverride();

    try {
      await program.parseAsync(["bridge", "--from", "xrpl", "--to", "ethereum", "--amount", "100"], { from: "user" });
    } catch {
      // may throw due to exitOverride
    }

    console.log = origLog;
    console.error = origError;

    const output = consoleOutput.join("\n");
    expect(output).toContain("XRPL");
  });
});

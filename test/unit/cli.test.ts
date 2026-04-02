import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProgram } from "../../src/cli.js";

const TEST_HOME = join(tmpdir(), `rlusd-cli-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

describe("CLI Program", () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    originalLog = console.log;
    originalError = console.error;
    console.log = () => undefined;
    console.error = () => undefined;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    rmSync(TEST_HOME, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("should create a program with correct name", () => {
    const program = createProgram();
    expect(program.name()).toBe("rlusd");
  });

  it("should have version set", () => {
    const program = createProgram();
    expect(program.version()).toBe("0.2.0");
  });

  it("should accept --output option on a subcommand", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--output", "json", "config", "get"], { from: "user" });
    expect(program.opts().output).toBe("json");
  });

  it("should accept --json as a machine output flag", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--json", "config", "get"], { from: "user" });
    expect(program.opts().json).toBe(true);
  });

  it("should default --output to table", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["config", "get"], { from: "user" });
    expect(program.opts().output).toBe("table");
  });

  it("should accept --chain option on a subcommand", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--chain", "xrpl", "config", "get"], { from: "user" });
    expect(program.opts().chain).toBe("xrpl");
  });

  it("should accept --verbose flag", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--verbose", "config", "get"], { from: "user" });
    expect(program.opts().verbose).toBe(true);
  });

  it("should have config subcommand registered", () => {
    const program = createProgram();
    const configCmd = program.commands.find((c) => c.name() === "config");
    expect(configCmd).toBeDefined();
  });

  it("should have resolve subcommand registered", () => {
    const program = createProgram();
    const resolveCmd = program.commands.find((c) => c.name() === "resolve");
    expect(resolveCmd).toBeDefined();
  });

  it("should have fiat subcommand registered", () => {
    const program = createProgram();
    const fiatCmd = program.commands.find((c) => c.name() === "fiat");
    expect(fiatCmd).toBeDefined();
  });
});

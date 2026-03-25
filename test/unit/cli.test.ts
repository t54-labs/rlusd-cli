import { describe, it, expect } from "vitest";
import { createProgram } from "../../src/cli.js";

describe("CLI Program", () => {
  it("should create a program with correct name", () => {
    const program = createProgram();
    expect(program.name()).toBe("rlusd");
  });

  it("should have version set", () => {
    const program = createProgram();
    expect(program.version()).toBe("0.1.0");
  });

  it("should accept --output option on a subcommand", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--output", "json", "config", "get"], { from: "user" });
    expect(program.opts().output).toBe("json");
  });

  it("should accept --json as a machine output flag", () => {
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => undefined;
    console.error = () => undefined;

    try {
      const program = createProgram();
      program.exitOverride();
      program.parse(["--json", "config", "get"], { from: "user" });
      expect(program.opts().json).toBe(true);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
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
});

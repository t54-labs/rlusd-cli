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

  it("should accept --output option", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--output", "json"], { from: "user" });
    expect(program.opts().output).toBe("json");
  });

  it("should default --output to table", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse([], { from: "user" });
    expect(program.opts().output).toBe("table");
  });

  it("should accept --chain option", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--chain", "xrpl"], { from: "user" });
    expect(program.opts().chain).toBe("xrpl");
  });

  it("should accept --verbose flag", () => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["--verbose"], { from: "user" });
    expect(program.opts().verbose).toBe(true);
  });
});

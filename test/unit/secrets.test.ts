import { afterEach, describe, expect, it } from "vitest";
import {
  getWalletPasswordEnvVarName,
  resolveWalletPassword,
} from "../../src/utils/secrets.js";

describe("Secret Utilities", () => {
  afterEach(() => {
    delete process.env.RLUSD_WALLET_PASSWORD;
  });

  it("should return explicitly provided password", () => {
    expect(resolveWalletPassword("provided")).toBe("provided");
  });

  it("should fall back to environment variable", () => {
    process.env.RLUSD_WALLET_PASSWORD = "from-env";
    expect(resolveWalletPassword()).toBe("from-env");
  });

  it("should throw when no password is available", () => {
    expect(() => resolveWalletPassword()).toThrow(
      /Wallet password is required/i,
    );
  });

  it("should expose the password environment variable name", () => {
    expect(getWalletPasswordEnvVarName()).toBe("RLUSD_WALLET_PASSWORD");
  });
});

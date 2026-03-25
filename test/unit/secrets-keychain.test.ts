import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/utils/keychain.js", () => ({
  getWalletPasswordFromKeychain: vi.fn((walletName: string) =>
    walletName === "stored-wallet" ? "from-keychain" : null,
  ),
}));

const { resolveWalletPassword } = await import("../../src/utils/secrets.js");

describe("Secret Utilities with Keychain Fallback", () => {
  afterEach(() => {
    delete process.env.RLUSD_WALLET_PASSWORD;
  });

  it("should resolve password from keychain when wallet name is provided", () => {
    expect(resolveWalletPassword(undefined, { walletName: "stored-wallet" })).toBe(
      "from-keychain",
    );
  });

  it("should prefer explicit password over keychain", () => {
    expect(
      resolveWalletPassword("explicit", { walletName: "stored-wallet" }),
    ).toBe("explicit");
  });

  it("should prefer environment variable over keychain", () => {
    process.env.RLUSD_WALLET_PASSWORD = "from-env";
    expect(resolveWalletPassword(undefined, { walletName: "stored-wallet" })).toBe(
      "from-env",
    );
  });
});

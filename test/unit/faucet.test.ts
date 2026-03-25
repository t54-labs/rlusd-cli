import { describe, expect, it } from "vitest";
import { decideXrplFundingStrategy } from "../../src/commands/faucet.cmd.js";

describe("XRPL faucet smart routing", () => {
  it("should request XRP when account does not exist", () => {
    expect(
      decideXrplFundingStrategy({
        accountExists: false,
        xrpBalance: "0",
        trustlinePresent: false,
        hasMockRlusdFaucet: false,
      }),
    ).toBe("xrp");
  });

  it("should request XRP when account exists but has zero XRP", () => {
    expect(
      decideXrplFundingStrategy({
        accountExists: true,
        xrpBalance: "0",
      }),
    ).toBe("xrp");
  });

  it("should direct users to the official RLUSD faucet when account has XRP", () => {
    expect(
      decideXrplFundingStrategy({
        accountExists: true,
        xrpBalance: "25",
      }),
    ).toBe("rlusd");
  });
});

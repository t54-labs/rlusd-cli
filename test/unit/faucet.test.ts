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
        trustlinePresent: false,
        hasMockRlusdFaucet: true,
      }),
    ).toBe("xrp");
  });

  it("should request RLUSD when account has XRP and trustline and faucet exist", () => {
    expect(
      decideXrplFundingStrategy({
        accountExists: true,
        xrpBalance: "25",
        trustlinePresent: true,
        hasMockRlusdFaucet: true,
      }),
    ).toBe("rlusd");
  });

  it("should error when account has XRP but no mock faucet is configured", () => {
    expect(
      decideXrplFundingStrategy({
        accountExists: true,
        xrpBalance: "25",
        trustlinePresent: true,
        hasMockRlusdFaucet: false,
      }),
    ).toBe("error");
  });

  it("should error when account has XRP but trustline is missing", () => {
    expect(
      decideXrplFundingStrategy({
        accountExists: true,
        xrpBalance: "25",
        trustlinePresent: false,
        hasMockRlusdFaucet: true,
      }),
    ).toBe("error");
  });
});

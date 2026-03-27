import { describe, expect, it } from "vitest";

import {
  resolveX402NetworkId,
  selectCompatibleX402Requirement,
} from "../../src/services/x402-fetch.js";

describe("x402 XRPL helpers", () => {
  it("maps runtime environments to x402 XRPL network ids", () => {
    expect(resolveX402NetworkId("mainnet")).toBe("xrpl:0");
    expect(resolveX402NetworkId("testnet")).toBe("xrpl:1");
    expect(resolveX402NetworkId("devnet")).toBe("xrpl:2");
  });

  it("selects the first compatible XRPL payment option within the configured cap", () => {
    const selected = selectCompatibleX402Requirement(
      [
        {
          scheme: "exact",
          network: "xrpl:1",
          amount: "1.25",
          asset: "USD",
          payTo: "rIssuerOne",
          maxTimeoutSeconds: 30,
          extra: { issuer: "rIssuerOne" },
        },
        {
          scheme: "exact",
          network: "xrpl:1",
          amount: "0.75",
          asset: "XRP",
          payTo: "rPayee",
          maxTimeoutSeconds: 30,
        },
      ],
      {
        network: "xrpl:1",
        maxValue: "1",
      },
    );

    expect(selected.asset).toBe("XRP");
    expect(selected.amount).toBe("0.75");
    expect(selected.payTo).toBe("rPayee");
  });

  it("honors explicit asset and issuer constraints when selecting a payment option", () => {
    const selected = selectCompatibleX402Requirement(
      [
        {
          scheme: "exact",
          network: "xrpl:1",
          amount: "0.5",
          asset: "XRP",
          payTo: "rPayee",
          maxTimeoutSeconds: 30,
        },
        {
          scheme: "exact",
          network: "xrpl:1",
          amount: "0.8",
          asset: "524C555344000000000000000000000000000000",
          payTo: "rRlusdPayee",
          maxTimeoutSeconds: 30,
          extra: { issuer: "rRlusdIssuer" },
        },
      ],
      {
        network: "xrpl:1",
        maxValue: "1",
        requireAsset: "524C555344000000000000000000000000000000",
        requireIssuer: "rRlusdIssuer",
      },
    );

    expect(selected.asset).toBe("524C555344000000000000000000000000000000");
    expect(selected.extra).toEqual({ issuer: "rRlusdIssuer" });
  });

  it("supports raw payment requirement aliases for currency and issuer", () => {
    const selected = selectCompatibleX402Requirement(
      [
        {
          scheme: "exact",
          network: "xrpl:1",
          amount: "0.8",
          currency: "524C555344000000000000000000000000000000",
          issuer: "rRlusdIssuer",
          payTo: "rRlusdPayee",
          maxTimeoutSeconds: 30,
        } as unknown as {
          scheme: string;
          network: string;
          amount: string;
          currency: string;
          issuer: string;
          payTo: string;
          maxTimeoutSeconds: number;
        },
      ],
      {
        network: "xrpl:1",
        maxValue: "1",
        requireAsset: "524C555344000000000000000000000000000000",
        requireIssuer: "rRlusdIssuer",
      },
    );

    expect(selected).toEqual(
      expect.objectContaining({
        currency: "524C555344000000000000000000000000000000",
        issuer: "rRlusdIssuer",
      }),
    );
  });

  it("throws when no compatible payment option fits the configured constraints", () => {
    expect(() =>
      selectCompatibleX402Requirement(
        [
          {
            scheme: "exact",
            network: "xrpl:1",
            amount: "2.5",
            asset: "XRP",
            payTo: "rTooExpensive",
            maxTimeoutSeconds: 30,
          },
        ],
        {
          network: "xrpl:1",
          maxValue: "1",
        },
      ),
    ).toThrow("No compatible x402 XRPL payment option found.");
  });

  it("selects the first matching option from a multi-option list without asset or issuer constraints", () => {
    const selected = selectCompatibleX402Requirement(
      [
        {
          scheme: "exact",
          network: "xrpl:1",
          amount: "1.25",
          asset: "USD",
          payTo: "rIssuerOne",
          maxTimeoutSeconds: 30,
          extra: { issuer: "rIssuerOne" },
        },
        {
          scheme: "exact",
          network: "xrpl:1",
          amount: "0.5",
          asset: "XRP",
          payTo: "rPayeeXrp",
          maxTimeoutSeconds: 30,
        },
        {
          scheme: "exact",
          network: "xrpl:1",
          amount: "0.8",
          asset: "524C555344000000000000000000000000000000",
          payTo: "rPayeeRlusd",
          maxTimeoutSeconds: 30,
          extra: { issuer: "rRlusdIssuer" },
        },
      ],
      {
        network: "xrpl:1",
        maxValue: "1",
      },
    );

    expect(selected.asset).toBe("XRP");
    expect(selected.amount).toBe("0.5");
  });

  it("rejects zero max value", () => {
    expect(() =>
      selectCompatibleX402Requirement(
        [
          {
            scheme: "exact",
            network: "xrpl:1",
            amount: "0.5",
            asset: "XRP",
            payTo: "rPayee",
            maxTimeoutSeconds: 30,
          },
        ],
        {
          network: "xrpl:1",
          maxValue: "0",
        },
      ),
    ).toThrow("Invalid x402 max value: 0");
  });

  it("rejects negative max value", () => {
    expect(() =>
      selectCompatibleX402Requirement(
        [
          {
            scheme: "exact",
            network: "xrpl:1",
            amount: "0.5",
            asset: "XRP",
            payTo: "rPayee",
            maxTimeoutSeconds: 30,
          },
        ],
        {
          network: "xrpl:1",
          maxValue: "-5",
        },
      ),
    ).toThrow("Invalid x402 max value: -5");
  });

  it("rejects invalid max value inputs", () => {
    expect(() =>
      selectCompatibleX402Requirement(
        [
          {
            scheme: "exact",
            network: "xrpl:1",
            amount: "0.5",
            asset: "XRP",
            payTo: "rPayee",
            maxTimeoutSeconds: 30,
          },
        ],
        {
          network: "xrpl:1",
          maxValue: "not-a-number",
        },
      ),
    ).toThrow("Invalid x402 max value: not-a-number. Must be a positive number.");
  });
});

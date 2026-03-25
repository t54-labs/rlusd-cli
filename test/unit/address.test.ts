import { describe, it, expect } from "vitest";
import {
  detectChainFromAddress,
  isXrplAddress,
  isEvmAddress,
  isXrplTransactionHash,
  normalizeXrplTransactionHash,
  validateAddress,
} from "../../src/utils/address.js";

describe("Address Utilities", () => {
  describe("isXrplAddress", () => {
    it("should accept valid XRPL addresses", () => {
      expect(isXrplAddress("rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De")).toBe(true);
      expect(isXrplAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")).toBe(true);
    });

    it("should reject invalid XRPL addresses", () => {
      expect(isXrplAddress("")).toBe(false);
      expect(isXrplAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe(false);
      expect(isXrplAddress("r")).toBe(false);
      expect(isXrplAddress("xrp123")).toBe(false);
    });
  });

  describe("isEvmAddress", () => {
    it("should accept valid EVM addresses", () => {
      expect(isEvmAddress("0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD")).toBe(true);
      expect(isEvmAddress("0x0000000000000000000000000000000000000000")).toBe(true);
    });

    it("should reject invalid EVM addresses", () => {
      expect(isEvmAddress("")).toBe(false);
      expect(isEvmAddress("0x123")).toBe(false);
      expect(isEvmAddress("rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De")).toBe(false);
      expect(isEvmAddress("8292Bb45bf1Ee4d140127049757C2E0fF06317eD")).toBe(false);
    });
  });

  describe("detectChainFromAddress", () => {
    it("should detect XRPL addresses", () => {
      expect(detectChainFromAddress("rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De")).toBe("xrpl");
    });

    it("should detect EVM addresses", () => {
      expect(detectChainFromAddress("0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD")).toBe(
        "ethereum",
      );
    });

    it("should return null for unrecognized addresses", () => {
      expect(detectChainFromAddress("invalid")).toBeNull();
      expect(detectChainFromAddress("")).toBeNull();
    });
  });

  describe("validateAddress", () => {
    it("should validate XRPL address for XRPL chain", () => {
      expect(validateAddress("rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", "xrpl")).toBe(true);
      expect(validateAddress("0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD", "xrpl")).toBe(false);
    });

    it("should validate EVM address for EVM chains", () => {
      expect(validateAddress("0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD", "ethereum")).toBe(true);
      expect(validateAddress("0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD", "base")).toBe(true);
      expect(validateAddress("rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", "ethereum")).toBe(false);
    });
  });

  describe("XRPL transaction hash helpers", () => {
    it("should accept valid XRPL transaction hashes", () => {
      expect(
        isXrplTransactionHash("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
      ).toBe(true);
      expect(
        isXrplTransactionHash("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      ).toBe(true);
    });

    it("should reject invalid XRPL transaction hashes", () => {
      expect(isXrplTransactionHash("")).toBe(false);
      expect(isXrplTransactionHash("0xabc")).toBe(false);
      expect(isXrplTransactionHash("xyz")).toBe(false);
    });

    it("should normalize XRPL transaction hashes to uppercase", () => {
      expect(
        normalizeXrplTransactionHash("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
      ).toBe("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    });
  });
});

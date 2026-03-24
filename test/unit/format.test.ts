import { describe, it, expect } from "vitest";
import { formatOutput, truncateAddress, formatRlusdAmount } from "../../src/utils/format.js";

describe("Format Utilities", () => {
  describe("formatOutput", () => {
    const sampleObject = { name: "test", value: "123" };
    const sampleArray = [
      { chain: "xrpl", balance: "100.00" },
      { chain: "ethereum", balance: "200.50" },
    ];

    it("should format as JSON with indentation", () => {
      const result = formatOutput(sampleObject, "json");
      expect(JSON.parse(result)).toEqual(sampleObject);
      expect(result).toContain("\n");
    });

    it("should format as compact JSON", () => {
      const result = formatOutput(sampleObject, "json-compact");
      expect(JSON.parse(result)).toEqual(sampleObject);
      expect(result).not.toContain("\n");
    });

    it("should format object as table", () => {
      const result = formatOutput(sampleObject, "table");
      expect(result).toContain("test");
      expect(result).toContain("123");
    });

    it("should format array as table", () => {
      const result = formatOutput(sampleArray, "table", ["chain", "balance"]);
      expect(result).toContain("xrpl");
      expect(result).toContain("ethereum");
      expect(result).toContain("100.00");
    });

    it("should return 'No data' for empty arrays in table mode", () => {
      const result = formatOutput([], "table");
      expect(result).toBe("No data");
    });
  });

  describe("truncateAddress", () => {
    it("should truncate long addresses", () => {
      const addr = "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD";
      const result = truncateAddress(addr);
      expect(result).toMatch(/^0x8292\.\.\..*eD$/);
      expect(result.length).toBeLessThan(addr.length);
    });

    it("should not truncate short addresses", () => {
      expect(truncateAddress("short")).toBe("short");
    });

    it("should support custom char count", () => {
      const addr = "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD";
      const result = truncateAddress(addr, 10);
      expect(result.startsWith("0x8292Bb45")).toBe(true);
      expect(result).toContain("...");
      expect(result.length).toBeLessThan(addr.length);
    });
  });

  describe("formatRlusdAmount", () => {
    it("should format with 2 decimal places by default", () => {
      expect(formatRlusdAmount("1000.5")).toBe("1,000.50");
      expect(formatRlusdAmount("0")).toBe("0.00");
    });

    it("should support custom decimal places", () => {
      expect(formatRlusdAmount("1234.5678", 4)).toBe("1,234.5678");
    });

    it("should return original for non-numeric strings", () => {
      expect(formatRlusdAmount("N/A")).toBe("N/A");
    });
  });
});

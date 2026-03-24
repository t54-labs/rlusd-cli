import { describe, it, expect } from "vitest";
import {
  xrpToDrops,
  dropsToXrp,
  toErc20Units,
  fromErc20Units,
} from "../../src/utils/amounts.js";

describe("Amount Utilities", () => {
  describe("xrpToDrops", () => {
    it("should convert XRP to drops", () => {
      expect(xrpToDrops(1)).toBe("1000000");
      expect(xrpToDrops("100")).toBe("100000000");
      expect(xrpToDrops(0.5)).toBe("500000");
      expect(xrpToDrops("0.000001")).toBe("1");
    });

    it("should handle zero", () => {
      expect(xrpToDrops(0)).toBe("0");
    });
  });

  describe("dropsToXrp", () => {
    it("should convert drops to XRP", () => {
      expect(dropsToXrp("1000000")).toBe("1");
      expect(dropsToXrp("100000000")).toBe("100");
      expect(dropsToXrp("500000")).toBe("0.5");
    });

    it("should handle integer input", () => {
      expect(dropsToXrp(1000000)).toBe("1");
    });
  });

  describe("toErc20Units", () => {
    it("should convert to 18 decimal units", () => {
      expect(toErc20Units("1", 18)).toBe(1000000000000000000n);
      expect(toErc20Units(100, 18)).toBe(100000000000000000000n);
    });

    it("should convert to 6 decimal units", () => {
      expect(toErc20Units("1", 6)).toBe(1000000n);
    });

    it("should handle zero", () => {
      expect(toErc20Units("0", 18)).toBe(0n);
    });
  });

  describe("fromErc20Units", () => {
    it("should convert from 18 decimal units", () => {
      expect(fromErc20Units(1000000000000000000n, 18)).toBe("1");
      expect(fromErc20Units(1500000000000000000n, 18)).toBe("1.5");
    });

    it("should convert from 6 decimal units", () => {
      expect(fromErc20Units(1000000n, 6)).toBe("1");
      expect(fromErc20Units(1500000n, 6)).toBe("1.5");
    });

    it("should handle zero", () => {
      expect(fromErc20Units(0n, 18)).toBe("0");
    });

    it("should handle amounts with trailing zeros trimmed", () => {
      expect(fromErc20Units(1100000000000000000n, 18)).toBe("1.1");
    });
  });
});

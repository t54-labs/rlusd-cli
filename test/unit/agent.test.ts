import { describe, expect, it } from "vitest";

const envelopeModule = (await import("../../src/agent/envelope.js")) as Record<string, unknown>;

describe("Agent envelope compatibility", () => {
  it("should create success envelopes with consumer-compatible next steps and chain", () => {
    expect(typeof envelopeModule.createSuccessEnvelope).toBe("function");

    const createSuccessEnvelope = envelopeModule.createSuccessEnvelope as (input: {
      command: string;
      chain: string;
      timestamp: string;
      data: unknown;
      next: Array<{ command: string }>;
    }) => {
      ok: true;
      command: string;
      chain?: string;
      timestamp: string;
      data: unknown;
      warnings: string[];
      next: Array<{ command: string }>;
    };

    const envelope = createSuccessEnvelope({
      command: "config get",
      chain: "xrpl-mainnet",
      timestamp: "2026-03-25T00:00:00.000Z",
      data: { environment: "mainnet" },
      next: [{ command: "rlusd tx history --chain xrpl --json" }],
    });

    expect(envelope.ok).toBe(true);
    expect(envelope.chain).toBe("xrpl-mainnet");
    expect(envelope.next).toEqual([{ command: "rlusd tx history --chain xrpl --json" }]);
  });

  it("should create error envelopes with retryable and consumer-compatible chain", () => {
    expect(typeof envelopeModule.createErrorEnvelope).toBe("function");

    const createErrorEnvelope = envelopeModule.createErrorEnvelope as (input: {
      command: string;
      chain: string;
      timestamp: string;
      code: string;
      message: string;
      retryable?: boolean;
      next?: Array<{ command: string }>;
    }) => {
      ok: false;
      command: string;
      chain?: string;
      timestamp: string;
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
      warnings: string[];
      next: Array<{ command: string }>;
    };

    const envelope = createErrorEnvelope({
      command: "config set",
      chain: "xrpl-mainnet",
      timestamp: "2026-03-25T00:00:00.000Z",
      code: "INVALID_ARGUMENT",
      message: "Invalid network",
    });

    expect(envelope.ok).toBe(false);
    expect(envelope.chain).toBe("xrpl-mainnet");
    expect(envelope.error.retryable).toBe(false);
    expect(envelope.next).toEqual([]);
  });
});

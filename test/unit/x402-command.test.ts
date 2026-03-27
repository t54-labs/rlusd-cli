import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-x402-command-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const x402FetchMock = vi.fn();
const decodePaymentResponseHeaderMock = vi.fn();
const decodePaymentRequiredHeaderMock = vi.fn();

vi.mock("x402-xrpl", () => ({
  x402Fetch: x402FetchMock,
  XRPLPresignedPaymentPayer: class {
    async preparePayment() {
      return {
        paymentHeader: "payment-header",
        paymentPayload: { accepted: { amount: "1", asset: "XRP" } },
        signedTxBlob: "signed-tx-blob",
        invoiceId: "invoice-id",
      };
    }
  },
  decodePaymentRequiredHeader: decodePaymentRequiredHeaderMock,
  decodePaymentResponseHeader: decodePaymentResponseHeaderMock,
}));

async function runJsonCommand(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...parts: unknown[]) => {
    stdout.push(parts.map(String).join(" "));
  };
  console.error = (...parts: unknown[]) => {
    stderr.push(parts.map(String).join(" "));
  };

  try {
    const { createProgram } = await import("../../src/cli.js");
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(["--json", ...args], { from: "user" });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return {
    stdout,
    stderr,
    output:
      stdout.length > 0
        ? JSON.parse(stdout.join("\n"))
        : stderr.length > 0
          ? JSON.parse(stderr.join("\n"))
          : null,
  };
}

describe("x402 fetch command", () => {
  beforeEach(async () => {
    vi.resetModules();
    mkdirSync(TEST_HOME, { recursive: true });
    process.env.RLUSD_WALLET_PASSWORD = "p";

    const { ensureConfigDir } = await import("../../src/config/config.js");
    ensureConfigDir();

    const { saveWallet } = await import("../../src/wallet/manager.js");
    const { generateXrplWallet, serializeXrplWallet } = await import("../../src/wallet/xrpl-wallet.js");
    saveWallet(serializeXrplWallet("buyer", generateXrplWallet(), "p"));
  });

  afterEach(() => {
    delete process.env.RLUSD_WALLET_PASSWORD;
    rmSync(TEST_HOME, { recursive: true, force: true });
    x402FetchMock.mockReset();
    decodePaymentRequiredHeaderMock.mockReset();
    decodePaymentResponseHeaderMock.mockReset();
    process.exitCode = 0;
  });

  it("returns structured HTTP data for free responses without attempting payment", async () => {
    x402FetchMock.mockReturnValue(async () =>
      new Response(JSON.stringify({ ok: true, resource: "free" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "1",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);
    expect(result.output.command).toBe("x402.fetch");
    expect(result.output.data.request.url).toBe("https://example.com/resource");
    expect(result.output.data.response.status).toBe(200);
    expect(result.output.data.response.body).toEqual({ ok: true, resource: "free" });
    expect(result.output.data.payment).toEqual({
      negotiated: false,
      max_value: "1",
    });
  });

  it("captures the selected payment requirement and settlement metadata for challenged responses", async () => {
    const accepted = {
      scheme: "exact",
      network: "xrpl:0",
      amount: "0.75",
      asset: "XRP",
      payTo: "rPaid",
      maxTimeoutSeconds: 30,
    };
    let capturedOptions: Record<string, unknown> | undefined;

    x402FetchMock.mockImplementation((options: Record<string, unknown>) => {
      capturedOptions = options;
      return async () => {
        const selector = capturedOptions?.paymentRequirementsSelector as
          | ((accepts: Array<Record<string, unknown>>) => Record<string, unknown>)
          | undefined;
        const headerFactory = capturedOptions?.paymentHeaderFactory as
          | ((req: Record<string, unknown>) => Promise<string>)
          | undefined;

        const selected = selector?.([accepted]);
        expect(selected).toEqual(accepted);
        const paymentHeader = await headerFactory?.(accepted);
        expect(paymentHeader).toBe("payment-header");

        return new Response(JSON.stringify({ ok: true, resource: "paid" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": "settlement-header",
          },
        });
      };
    });
    decodePaymentResponseHeaderMock.mockReturnValue({
      success: true,
      transaction: "ABC123",
      network: "xrpl:0",
      payer: "rBuyer",
    });

    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "1",
    ]);

    expect(result.stderr).toEqual([]);
    expect(capturedOptions?.network).toBe("xrpl:0");
    expect(capturedOptions?.maxValue).toBe("1");
    expect(capturedOptions?.paymentRequirementsSelector).toEqual(expect.any(Function));
    expect(capturedOptions?.paymentHeaderFactory).toEqual(expect.any(Function));
    expect(result.output.data.payment).toEqual({
      negotiated: true,
      max_value: "1",
      selected_requirement: accepted,
      settlement: {
        success: true,
        transaction: "ABC123",
        network: "xrpl:0",
        payer: "rBuyer",
      },
    });
  });

  it("honors explicit asset and issuer constraints when negotiating payment options", async () => {
    const xrpOption = {
      scheme: "exact",
      network: "xrpl:0",
      amount: "0.75",
      asset: "XRP",
      payTo: "rPaidXrp",
      maxTimeoutSeconds: 30,
    };
    const rlusdOption = {
      scheme: "exact",
      network: "xrpl:0",
      amount: "0.8",
      asset: "524C555344000000000000000000000000000000",
      payTo: "rPaidRlusd",
      maxTimeoutSeconds: 30,
      extra: { issuer: "rRlusdIssuer" },
    };

    x402FetchMock.mockImplementation((options: Record<string, unknown>) => {
      return async () => {
        const selector = options.paymentRequirementsSelector as
          | ((accepts: Array<Record<string, unknown>>) => Record<string, unknown>)
          | undefined;
        const selected = selector?.([xrpOption, rlusdOption]);
        expect(selected).toEqual(rlusdOption);

        return new Response(JSON.stringify({ ok: true, resource: "paid" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": "settlement-header",
          },
        });
      };
    });
    decodePaymentResponseHeaderMock.mockReturnValue({
      success: true,
      transaction: "DEF456",
      network: "xrpl:0",
    });

    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "1",
      "--require-asset",
      "524C555344000000000000000000000000000000",
      "--require-issuer",
      "rRlusdIssuer",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.data.payment.selected_requirement).toEqual(rlusdOption);
  });

  it("sends POST requests with the JSON body and content type", async () => {
    let capturedInit: RequestInit | undefined;

    x402FetchMock.mockImplementation(() => {
      return async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
    });

    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "1",
      "--method",
      "POST",
      "--json-body",
      '{"prompt":"hello"}',
    ]);

    expect(result.stderr).toEqual([]);
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBe('{"prompt":"hello"}');
    expect(capturedInit?.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
      }),
    );
  });

  it("rejects invalid max-value inputs before attempting a paid fetch", async () => {
    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "not-a-number",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.code).toBe("X402_FETCH_FAILED");
    expect(result.output.error.message).toContain("Invalid x402 max value");
    expect(x402FetchMock).not.toHaveBeenCalled();
  });

  it("rejects zero max-value before attempting a paid fetch", async () => {
    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "0",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.code).toBe("X402_FETCH_FAILED");
    expect(result.output.error.message).toContain("Invalid x402 max value");
    expect(x402FetchMock).not.toHaveBeenCalled();
  });

  it("rejects negative max-value before attempting a paid fetch", async () => {
    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "-5",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.code).toBe("X402_FETCH_FAILED");
    expect(result.output.error.message).toContain("Invalid x402 max value");
    expect(x402FetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported HTTP methods", async () => {
    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "1",
      "--method",
      "PUT",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.code).toBe("X402_FETCH_FAILED");
    expect(result.output.error.message).toContain("Unsupported HTTP method");
    expect(x402FetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON body with a clear error", async () => {
    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "1",
      "--method",
      "POST",
      "--json-body",
      "{not valid json}",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.code).toBe("X402_FETCH_FAILED");
    expect(x402FetchMock).not.toHaveBeenCalled();
  });

  it("sends POST without a body when --json-body is omitted", async () => {
    let capturedInit: RequestInit | undefined;

    x402FetchMock.mockImplementation(() => {
      return async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
    });

    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "1",
      "--method",
      "POST",
    ]);

    expect(result.stderr).toEqual([]);
    expect(result.output.ok).toBe(true);
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.body).toBeUndefined();
  });

  it("emits an error envelope when negotiation falls back to an unresolved 402 response", async () => {
    const accepted = {
      scheme: "exact",
      network: "xrpl:0",
      amount: "2.5",
      asset: "XRP",
      payTo: "rTooExpensive",
      maxTimeoutSeconds: 30,
    };

    x402FetchMock.mockReturnValue(async () =>
      new Response(JSON.stringify({ error: "payment required" }), {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-REQUIRED": "payment-required-header",
        },
      }),
    );
    decodePaymentRequiredHeaderMock.mockReturnValue({
      x402Version: 2,
      resource: {
        url: "https://example.com/resource",
      },
      accepts: [accepted],
    });

    const result = await runJsonCommand([
      "x402",
      "fetch",
      "https://example.com/resource",
      "--wallet",
      "buyer",
      "--max-value",
      "1",
    ]);

    expect(result.stdout).toEqual([]);
    expect(result.output.ok).toBe(false);
    expect(result.output.error.code).toBe("PAYMENT_NEGOTIATION_FAILED");
    expect(result.output.error.details).toEqual(
      expect.objectContaining({
        status: 402,
        accepts: [accepted],
      }),
    );
  });
});

import { Command } from "commander";

import { createErrorEnvelope, createSuccessEnvelope } from "../agent/envelope.js";
import { loadConfig } from "../config/config.js";
import {
  parseAndValidateX402MaxValue,
  resolveX402NetworkId,
  selectCompatibleX402Requirement,
  type X402PaymentRequirement,
} from "../services/x402-fetch.js";
import type { OutputFormat, StoredXrplWallet } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { getWalletPasswordEnvVarName, resolveWalletPassword } from "../utils/secrets.js";
import { isXrplWallet, resolveWalletForChain } from "../wallet/manager.js";
import { restoreXrplWallet } from "../wallet/xrpl-wallet.js";

function emitEnvelope(value: unknown): void {
  if (value && typeof value === "object" && !Array.isArray(value) && (value as { ok?: boolean }).ok === false) {
    console.error(JSON.stringify(value, null, 2));
    return;
  }
  logger.raw(JSON.stringify(value, null, 2));
}

function parseHeaderEntries(entries: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const entry of entries ?? []) {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      throw new Error(`Invalid header '${entry}'. Use 'Name: value'.`);
    }

    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (!name || !value) {
      throw new Error(`Invalid header '${entry}'. Use 'Name: value'.`);
    }
    headers[name] = value;
  }

  return headers;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export function registerX402Command(program: Command): void {
  const x402Cmd = program.command("x402").description("XRPL x402 buyer flows");

  x402Cmd
    .command("fetch")
    .description("Fetch an x402-protected resource")
    .argument("<url>", "resource URL")
    .option("--wallet <name>", "stored XRPL wallet to use for signing")
    .option("--method <method>", "HTTP method (GET or POST)", "GET")
    .option("--header <header...>", "additional request header(s) as 'Name: value'")
    .option("--json-body <json>", "JSON request body for POST requests")
    .option("--require-asset <asset>", "only accept payment options for this XRPL asset")
    .option("--require-issuer <issuer>", "only accept payment options for this XRPL issuer")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .requiredOption("--max-value <amount>", "maximum amount willing to pay per request")
    .action(
      async (
        url: string,
        opts: {
          wallet?: string;
          method?: string;
          header?: string[];
          jsonBody?: string;
          requireAsset?: string;
          requireIssuer?: string;
          password?: string;
          maxValue: string;
        },
      ) => {
        const config = loadConfig();
        const timestamp = new Date().toISOString();
        const chain = `xrpl-${config.environment}`;

        try {
          parseAndValidateX402MaxValue(opts.maxValue);

          const walletData = resolveWalletForChain("xrpl", {
            walletName: opts.wallet,
            optionName: "--wallet",
          });
          if (!isXrplWallet(walletData)) {
            throw new Error("Selected wallet is not an XRPL wallet.");
          }

          const password = resolveWalletPassword(opts.password, {
            machineReadable:
              ((program.opts().output as OutputFormat | undefined) ?? config.output_format) !== "table",
            walletName: walletData.name,
          });
          const wallet = restoreXrplWallet(walletData as StoredXrplWallet, password);
          const method = (opts.method ?? "GET").toUpperCase();
          if (method !== "GET" && method !== "POST") {
            throw new Error(`Unsupported HTTP method '${method}'. Only GET and POST are supported.`);
          }
          const headers = parseHeaderEntries(opts.header);
          let body: string | undefined;

          if (opts.jsonBody) {
            JSON.parse(opts.jsonBody);
            body = opts.jsonBody;
            if (!headers["Content-Type"] && !headers["content-type"]) {
              headers["Content-Type"] = "application/json";
            }
          }

          const wsUrl = config.chains.xrpl?.websocket;
          if (!wsUrl) {
            throw new Error("XRPL WebSocket URL is not configured.");
          }

          const networkId = resolveX402NetworkId(config.environment);
          const {
            decodePaymentRequiredHeader,
            decodePaymentResponseHeader,
            x402Fetch,
            XRPLPresignedPaymentPayer,
          } = await import("x402-xrpl");
          let selectedRequirement: X402PaymentRequirement | undefined;
          const payer = new XRPLPresignedPaymentPayer({
            wallet,
            network: networkId,
            wsUrl,
          });
          const fetchPaid = x402Fetch({
            wallet,
            network: networkId,
            wsUrl,
            maxValue: opts.maxValue,
            paymentRequirementsSelector: (accepts) => {
              selectedRequirement = selectCompatibleX402Requirement(
                accepts as unknown as X402PaymentRequirement[],
                {
                  network: networkId,
                  maxValue: opts.maxValue,
                  requireAsset: opts.requireAsset,
                  requireIssuer: opts.requireIssuer,
                },
              );
              return selectedRequirement as unknown as Record<string, unknown>;
            },
            paymentHeaderFactory: async (reqs) => {
              selectedRequirement = reqs as X402PaymentRequirement;
              const prepared = await payer.preparePayment(reqs);
              return prepared.paymentHeader;
            },
          });

          const response = await fetchPaid(url, {
            method,
            headers,
            body,
          });
          const responseBody = await parseResponseBody(response);

          if (response.status === 402) {
            const paymentRequiredHeader = response.headers.get("PAYMENT-REQUIRED");
            const paymentRequired = paymentRequiredHeader
              ? decodePaymentRequiredHeader(paymentRequiredHeader)
              : undefined;

            emitEnvelope(
              createErrorEnvelope({
                command: "x402.fetch",
                chain,
                timestamp,
                code: "PAYMENT_NEGOTIATION_FAILED",
                message: "x402 payment negotiation failed under current constraints.",
                details: {
                  status: response.status,
                  body: responseBody,
                  accepts: paymentRequired?.accepts ?? [],
                },
              }),
            );
            process.exitCode = 1;
            return;
          }

          const settlementHeader = response.headers.get("PAYMENT-RESPONSE");
          const settlement = settlementHeader
            ? decodePaymentResponseHeader(settlementHeader)
            : undefined;

          emitEnvelope(
            createSuccessEnvelope({
              command: "x402.fetch",
              chain,
              timestamp,
              data: {
                request: {
                  url,
                  method,
                },
                response: {
                  status: response.status,
                  ok: response.ok,
                  content_type: response.headers.get("content-type"),
                  body: responseBody,
                },
                payment: settlement
                  ? {
                      negotiated: true,
                      max_value: opts.maxValue,
                      selected_requirement: selectedRequirement,
                      settlement,
                    }
                  : {
                      negotiated: Boolean(selectedRequirement),
                      max_value: opts.maxValue,
                      selected_requirement: selectedRequirement,
                    },
              },
            }),
          );
        } catch (error) {
          emitEnvelope(
            createErrorEnvelope({
              command: "x402.fetch",
              chain,
              timestamp,
              code: "X402_FETCH_FAILED",
              message: error instanceof Error ? error.message : "Unable to complete x402 fetch.",
            }),
          );
          process.exitCode = 1;
        }
      },
    );
}

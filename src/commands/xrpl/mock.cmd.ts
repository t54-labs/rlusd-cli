import { createServer } from "node:http";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Command } from "commander";
import type { AccountSet, Payment } from "xrpl";
import {
  disconnectXrplClient,
  getXrplClient,
  getXrplTrustlineStatus,
} from "../../clients/xrpl-client.js";
import { loadConfig, setRlusdXrplAsset } from "../../config/config.js";
import {
  XRPL_DEVNET_FAUCET,
  XRPL_TESTNET_FAUCET,
} from "../../config/constants.js";
import { logger } from "../../utils/logger.js";
import { validateAddress } from "../../utils/address.js";
import { formatOutput } from "../../utils/format.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../../utils/secrets.js";
import { generateXrplWallet, restoreXrplWallet, serializeXrplWallet } from "../../wallet/xrpl-wallet.js";
import { loadWallet, saveWallet } from "../../wallet/manager.js";
import type { OutputFormat } from "../../types/index.js";

const DEFAULT_RLUSD_MOCK_CURRENCY = "RLUSD";
const DEFAULT_RLUSD_MOCK_RECORD = ".local/mock-rlusd-testnet.json";
const ASF_DEFAULT_RIPPLE = 8;

interface MockIssuerRecord {
  network: "testnet" | "devnet";
  issuer_wallet_name: string;
  issuer_address: string;
  issuer_secret: string;
  public_key: string;
  currency_code: string;
  currency_hex: string;
  funded_xrp?: number;
  created_at: string;
}

function normalizeCurrencyToHex(currency: string): string {
  const normalized = currency.trim();
  if (/^[A-Fa-f0-9]{40}$/.test(normalized)) {
    return normalized.toUpperCase();
  }
  if (normalized.length < 3 || normalized.length > 20) {
    throw new Error("XRPL currency code must be 3-20 ASCII chars or a 40-char hex code.");
  }
  const hex = Buffer.from(normalized, "utf-8").toString("hex").toUpperCase();
  return hex.padEnd(40, "0");
}

function getMockRecordPath(customPath?: string): string {
  return resolve(customPath || DEFAULT_RLUSD_MOCK_RECORD);
}

function writeMockRecord(recordPath: string, record: MockIssuerRecord): void {
  mkdirSync(dirname(recordPath), { recursive: true, mode: 0o700 });
  writeFileSync(recordPath, JSON.stringify(record, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

function readMockRecord(recordPath: string): MockIssuerRecord | null {
  if (!existsSync(recordPath)) return null;
  return JSON.parse(readFileSync(recordPath, "utf-8")) as MockIssuerRecord;
}

async function requestTestXrp(address: string, network: "testnet" | "devnet"): Promise<number> {
  const faucetUrl = network === "devnet" ? XRPL_DEVNET_FAUCET : XRPL_TESTNET_FAUCET;
  const response = await fetch(faucetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destination: address }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`XRPL faucet returned ${response.status}: ${text}`);
  }

  const data = (await response.json()) as { amount?: number; balance?: number };
  return data.amount || data.balance || 0;
}

async function enableDefaultRipple(wallet: ReturnType<typeof restoreXrplWallet>): Promise<void> {
  const client = await getXrplClient();
  const tx: AccountSet = {
    TransactionType: "AccountSet",
    Account: wallet.address,
    SetFlag: ASF_DEFAULT_RIPPLE,
  };
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  const meta = result.result.meta as { TransactionResult?: string } | undefined;
  const txResult = meta?.TransactionResult || "unknown";
  if (txResult !== "tesSUCCESS") {
    throw new Error(`AccountSet(DefaultRipple) failed: ${txResult}`);
  }
}

async function mintMockRlusd(
  wallet: ReturnType<typeof restoreXrplWallet>,
  to: string,
  amount: string,
  currencyHex: string,
): Promise<string> {
  const client = await getXrplClient();
  const payment: Payment = {
    TransactionType: "Payment",
    Account: wallet.address,
    Destination: to,
    Amount: {
      currency: currencyHex,
      issuer: wallet.address,
      value: amount,
    },
  };
  const prepared = await client.autofill(payment);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  const meta = result.result.meta as { TransactionResult?: string } | undefined;
  const txResult = meta?.TransactionResult || "unknown";
  if (txResult !== "tesSUCCESS") {
    throw new Error(`Mock RLUSD mint failed: ${txResult}`);
  }
  return result.result.hash;
}

export function registerMockCommand(parent: Command, program: Command): void {
  const mockCmd = parent
    .command("mock")
    .description("XRPL testnet/devnet mock RLUSD tooling");

  mockCmd
    .command("bootstrap")
    .description("Create a mock XRPL RLUSD issuer, fund it with test XRP, and activate it in config")
    .option("--issuer-wallet <name>", "issuer wallet name", "mock-rlusd-issuer")
    .option("--currency <code>", "currency code to use", DEFAULT_RLUSD_MOCK_CURRENCY)
    .option("--record <path>", "local secret record path", DEFAULT_RLUSD_MOCK_RECORD)
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      if (config.environment === "mainnet") {
        logger.error("Mock RLUSD bootstrap is only supported on XRPL testnet/devnet.");
        process.exitCode = 1;
        return;
      }

      try {
        if (loadWallet(opts.issuerWallet)) {
          throw new Error(
            `Wallet '${opts.issuerWallet}' already exists. Choose a different issuer wallet name.`,
          );
        }

        const password = resolveWalletPassword(opts.password);
        const wallet = generateXrplWallet("ed25519");
        const stored = serializeXrplWallet(opts.issuerWallet, wallet, password);
        saveWallet(stored);

        const fundedXrp = await requestTestXrp(
          wallet.address,
          config.environment as "testnet" | "devnet",
        );

        const runtimeWallet = restoreXrplWallet(stored, password);
        await enableDefaultRipple(runtimeWallet);

        const currencyHex = normalizeCurrencyToHex(opts.currency);
        setRlusdXrplAsset({
          issuer: wallet.address,
          currency: currencyHex,
        });

        const recordPath = getMockRecordPath(opts.record);
        const record: MockIssuerRecord = {
          network: config.environment as "testnet" | "devnet",
          issuer_wallet_name: opts.issuerWallet,
          issuer_address: wallet.address,
          issuer_secret: wallet.secret,
          public_key: wallet.publicKey,
          currency_code: opts.currency,
          currency_hex: currencyHex,
          funded_xrp: fundedXrp,
          created_at: new Date().toISOString(),
        };
        writeMockRecord(recordPath, record);

        const result = {
          network: record.network,
          issuer_wallet_name: record.issuer_wallet_name,
          issuer_address: record.issuer_address,
          currency_code: record.currency_code,
          currency_hex: record.currency_hex,
          funded_xrp: record.funded_xrp,
          record_path: recordPath,
        };

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput(result, outputFormat));
        } else {
          logger.success("Mock XRPL RLUSD issuer bootstrapped");
          logger.label("Issuer Wallet", record.issuer_wallet_name);
          logger.label("Issuer Address", record.issuer_address);
          logger.label("Currency", `${record.currency_code} (${record.currency_hex})`);
          logger.label("Funded XRP", String(record.funded_xrp));
          logger.label("Local Secret Record", recordPath);
          logger.dim("Current config now points XRPL RLUSD issuer/currency to this mock asset.");
        }
      } catch (err) {
        logger.error(`Mock bootstrap failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  mockCmd
    .command("mint")
    .description("Mint mock RLUSD from the configured or recorded issuer to an XRPL address")
    .requiredOption("--to <address>", "destination XRPL address")
    .requiredOption("--amount <amount>", "amount of mock RLUSD to mint")
    .option("--issuer-wallet <name>", "issuer wallet name from local wallet store")
    .option("--record <path>", "local secret record path", DEFAULT_RLUSD_MOCK_RECORD)
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts) => {
      const config = loadConfig();
      if (!validateAddress(opts.to, "xrpl")) {
        logger.error(`Invalid XRPL address: ${opts.to}`);
        process.exitCode = 1;
        return;
      }

      try {
        const password = resolveWalletPassword(opts.password);
        const record = readMockRecord(getMockRecordPath(opts.record));
        const issuerWalletName = opts.issuerWallet || record?.issuer_wallet_name;
        if (!issuerWalletName) {
          throw new Error(
            "No issuer wallet specified and no mock issuer record found. Run bootstrap first.",
          );
        }

        const walletData = loadWallet(issuerWalletName);
        if (!walletData || walletData.chain !== "xrpl") {
          throw new Error(`XRPL issuer wallet '${issuerWalletName}' was not found.`);
        }

        const trustline = await getXrplTrustlineStatus(
          config.environment as "mainnet" | "testnet" | "devnet",
          opts.to,
        );
        if (!trustline.account_exists) {
          throw new Error("Destination XRPL account does not exist or is not activated.");
        }
        if (!trustline.present) {
          throw new Error(
            "Destination XRPL account does not have the configured mock RLUSD trust line.",
          );
        }

        const issuerWallet = restoreXrplWallet(walletData, password);
        const hash = await mintMockRlusd(
          issuerWallet,
          opts.to,
          opts.amount,
          config.rlusd.xrpl_currency,
        );

        logger.success(`Minted ${opts.amount} mock RLUSD to ${opts.to}`);
        logger.label("Tx Hash", hash);
      } catch (err) {
        logger.error(`Mock mint failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  mockCmd
    .command("faucet-serve")
    .description("Run a small HTTP faucet that mints mock RLUSD on XRPL testnet/devnet")
    .option("--issuer-wallet <name>", "issuer wallet name")
    .option("--record <path>", "local secret record path", DEFAULT_RLUSD_MOCK_RECORD)
    .option("--host <host>", "host to bind", "0.0.0.0")
    .option("--port <port>", "port to bind", "8787")
    .option("--default-amount <amount>", "default RLUSD amount to issue", "1000")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts) => {
      const config = loadConfig();
      try {
        const password = resolveWalletPassword(opts.password);
        const record = readMockRecord(getMockRecordPath(opts.record));
        const issuerWalletName = opts.issuerWallet || record?.issuer_wallet_name;
        if (!issuerWalletName) {
          throw new Error(
            "No issuer wallet specified and no mock issuer record found. Run bootstrap first.",
          );
        }

        const walletData = loadWallet(issuerWalletName);
        if (!walletData || walletData.chain !== "xrpl") {
          throw new Error(`XRPL issuer wallet '${issuerWalletName}' was not found.`);
        }

        const issuerWallet = restoreXrplWallet(walletData, password);
        const defaultAmount = String(opts.defaultAmount);

        const server = createServer(async (req, res) => {
          if (req.method === "GET" && req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (req.method === "GET" && req.url === "/info") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                ok: true,
                network: config.environment,
                issuer: issuerWallet.address,
                currency: config.rlusd.xrpl_currency,
                default_amount: defaultAmount,
              }),
            );
            return;
          }

          if (req.method === "POST" && req.url === "/fund") {
            let body = "";
            req.on("data", (chunk) => {
              body += chunk.toString();
            });
            req.on("end", async () => {
              try {
                const parsed = JSON.parse(body || "{}") as {
                  address?: string;
                  amount?: string;
                };
                if (!parsed.address || !validateAddress(parsed.address, "xrpl")) {
                  throw new Error("A valid XRPL address is required.");
                }
                const trustline = await getXrplTrustlineStatus(
                  config.environment as "mainnet" | "testnet" | "devnet",
                  parsed.address,
                );
                if (!trustline.account_exists) {
                  throw new Error("Destination XRPL account does not exist or is not activated.");
                }
                if (!trustline.present) {
                  throw new Error("Destination account does not have the configured mock RLUSD trust line.");
                }

                const amount = parsed.amount || defaultAmount;
                const hash = await mintMockRlusd(
                  issuerWallet,
                  parsed.address,
                  amount,
                  config.rlusd.xrpl_currency,
                );

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                  JSON.stringify({
                    ok: true,
                    address: parsed.address,
                    amount,
                    tx_hash: hash,
                    issuer: issuerWallet.address,
                  }),
                );
              } catch (err) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(
                  JSON.stringify({
                    ok: false,
                    error: (err as Error).message,
                  }),
                );
              }
            });
            return;
          }

          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Not found" }));
        });

        server.listen(Number(opts.port), opts.host, () => {
          logger.success("Mock RLUSD faucet server is running");
          logger.label("URL", `http://${opts.host}:${opts.port}/fund`);
          logger.label("Health", `http://${opts.host}:${opts.port}/health`);
          logger.label("Info", `http://${opts.host}:${opts.port}/info`);
          logger.label("Issuer", issuerWallet.address);
          logger.label("Currency", config.rlusd.xrpl_currency);
          logger.label("Default Amount", defaultAmount);
          logger.dim("POST /fund with JSON: { \"address\": \"r...\", \"amount\": \"1000\" }");
        });
      } catch (err) {
        logger.error(`Mock faucet server failed to start: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}

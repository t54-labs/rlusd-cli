import { Command } from "commander";
import { createErrorEnvelope, createSuccessEnvelope } from "../agent/envelope.js";
import { loadConfig } from "../config/config.js";
import { getDefaultWallet } from "../wallet/manager.js";
import {
  getXrplClient,
  disconnectXrplClient,
  resolveXrplChainRef,
  waitForXrplTransaction,
} from "../clients/xrpl-client.js";
import { getEvmPublicClient, resolveEvmChainRef } from "../clients/evm-client.js";
import { formatOutput } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import { RLUSD_ERC20_ABI } from "../abi/rlusd-erc20.js";
import { formatUnits, getAbiItem } from "viem";
import type { ChainName, OutputFormat, EvmChainName } from "../types/index.js";
import { assertActiveRlusdEvmChain, getRlusdContractAddress } from "../utils/evm-support.js";

const DEFAULT_HISTORY_LIMIT = 20;
const EVM_LOG_LOOKBACK_BLOCKS = 100_000n;
const EVM_LOG_BATCH_SIZE = 20_000n;

function emitEnvelope(value: unknown): void {
  if (value && typeof value === "object" && !Array.isArray(value) && (value as { ok?: boolean }).ok === false) {
    console.error(JSON.stringify(value, null, 2));
    return;
  }
  logger.raw(JSON.stringify(value, null, 2));
}

export function registerTxCommand(program: Command): void {
  const txCmd = program.command("tx").description("Query RLUSD-related transactions");

  txCmd
    .command("status")
    .description("Check transaction status on a chain")
    .argument("<hash>", "transaction hash")
    .option("-c, --chain <chain>", "chain (defaults to config / global --chain)")
    .action(async (hash: string, opts: { chain?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      const chain = (opts.chain || program.opts().chain || config.default_chain) as ChainName;

      try {
        if (chain === "xrpl") {
          await txStatusXrpl(hash, outputFormat);
        } else {
          await txStatusEvm(chain as EvmChainName, hash, outputFormat);
        }
      } catch (err) {
        logger.error(`Transaction status failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  txCmd
    .command("history")
    .description("Show recent RLUSD transactions for the current wallet")
    .option("-c, --chain <chain>", "chain (defaults to config / global --chain)")
    .option("-l, --limit <n>", "max number of entries", String(DEFAULT_HISTORY_LIMIT))
    .action(async (opts: { chain?: string; limit?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      const chain = (opts.chain || program.opts().chain || config.default_chain) as ChainName;
      const limit = Math.min(Math.max(parseInt(opts.limit || String(DEFAULT_HISTORY_LIMIT), 10) || DEFAULT_HISTORY_LIMIT, 1), 400);

      try {
        if (chain === "xrpl") {
          await txHistoryXrpl(config, outputFormat, limit);
        } else {
          await txHistoryEvm(config, chain as EvmChainName, outputFormat, limit);
        }
      } catch (err) {
        logger.error(`Transaction history failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

export function registerEvmTxCommand(parent: Command): void {
  const txCmd = parent.command("tx").description("EVM transaction monitoring commands");

  txCmd
    .command("wait")
    .description("Wait for an EVM transaction receipt")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--hash <hash>", "transaction hash")
    .action(async (opts: { chain: string; hash: string }) => {
      const config = loadConfig();

      try {
        const chainInput = opts.chain || (parent.opts().chain as string | undefined);
        if (!chainInput) {
          throw new Error("The --chain option is required.");
        }
        const resolved = resolveEvmChainRef(chainInput, config.environment);
        const publicClient = getEvmPublicClient(resolved.chain, resolved.network);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: opts.hash as `0x${string}`,
        });

        emitEnvelope(
          createSuccessEnvelope({
            command: "evm.tx.wait",
            chain: resolved.label,
            timestamp: new Date().toISOString(),
            data: {
              transaction_hash: receipt.transactionHash,
              status: receipt.status,
              block_number: Number(receipt.blockNumber),
              confirmations: 1,
            },
          }),
        );
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "evm.tx.wait",
            timestamp: new Date().toISOString(),
            code: "TX_WAIT_FAILED",
            message:
              error instanceof Error ? error.message : "Unable to wait for EVM transaction.",
          }),
        );
        process.exitCode = 1;
      }
    });

  txCmd
    .command("receipt")
    .description("Read an EVM transaction receipt")
    .option("--chain <chain>", "target chain label, e.g. ethereum-mainnet")
    .requiredOption("--hash <hash>", "transaction hash")
    .action(async (opts: { chain: string; hash: string }) => {
      const config = loadConfig();

      try {
        const chainInput = opts.chain || (parent.opts().chain as string | undefined);
        if (!chainInput) {
          throw new Error("The --chain option is required.");
        }
        const resolved = resolveEvmChainRef(chainInput, config.environment);
        const publicClient = getEvmPublicClient(resolved.chain, resolved.network);
        const receipt = await publicClient.getTransactionReceipt({
          hash: opts.hash as `0x${string}`,
        });

        emitEnvelope(
          createSuccessEnvelope({
            command: "evm.tx.receipt",
            chain: resolved.label,
            timestamp: new Date().toISOString(),
            data: {
              transaction_hash: receipt.transactionHash,
              status: receipt.status,
              block_number: Number(receipt.blockNumber),
            },
          }),
        );
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "evm.tx.receipt",
            timestamp: new Date().toISOString(),
            code: "TX_RECEIPT_FAILED",
            message:
              error instanceof Error ? error.message : "Unable to read EVM transaction receipt.",
          }),
        );
        process.exitCode = 1;
      }
    });
}

export function registerXrplTxCommand(parent: Command, program: Command): void {
  const txCmd = parent.command("tx").description("XRPL transaction monitoring commands");

  txCmd
    .command("wait")
    .description("Wait for an XRPL transaction to validate")
    .option("--chain <chain>", "target XRPL chain label, e.g. xrpl-mainnet")
    .requiredOption("--hash <hash>", "transaction hash")
    .action(async (opts: { chain?: string; hash: string }) => {
      const config = loadConfig();
      try {
        const chainInput = opts.chain || (program.opts().chain as string | undefined) || "xrpl";
        const resolved = resolveXrplChainRef(chainInput, config.environment);
        const status = await waitForXrplTransaction(resolved.network, opts.hash);
        emitEnvelope(
          createSuccessEnvelope({
            command: "xrpl.tx.wait",
            chain: resolved.label,
            timestamp: new Date().toISOString(),
            data: status,
          }),
        );
      } catch (error) {
        emitEnvelope(
          createErrorEnvelope({
            command: "xrpl.tx.wait",
            timestamp: new Date().toISOString(),
            code: "TX_WAIT_FAILED",
            message:
              error instanceof Error ? error.message : "Unable to wait for XRPL transaction.",
          }),
        );
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

async function txStatusXrpl(hash: string, outputFormat: OutputFormat): Promise<void> {
  const client = await getXrplClient();
  const res = await client.request({
    command: "tx",
    transaction: hash,
  });

  const result = res.result as unknown as Record<string, unknown>;
  const meta = result.meta as Record<string, unknown> | undefined;
  const txResult =
    meta && typeof meta.TransactionResult === "string" ? meta.TransactionResult : "unknown";
  const validated = result.validated === true;
  const status: "success" | "failed" | "pending" = !validated
    ? "pending"
    : txResult === "tesSUCCESS"
      ? "success"
      : "failed";

  const data = {
    chain: "xrpl" as const,
    hash: result.hash ?? hash,
    status,
    validated,
    transaction_result: txResult,
    ledger_index: result.ledger_index,
    date: result.date,
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data as unknown as Record<string, unknown>, outputFormat));
  } else {
    logger.label("Chain", "xrpl");
    logger.label("Hash", String(data.hash));
    logger.label("Status", data.status);
    if (data.validated) {
      logger.label("Result", txResult);
    }
    if (data.ledger_index !== undefined) {
      logger.label("Ledger", String(data.ledger_index));
    }
  }
}

async function txStatusEvm(chain: EvmChainName, hash: string, outputFormat: OutputFormat): Promise<void> {
  assertActiveRlusdEvmChain(chain);
  const publicClient = getEvmPublicClient(chain);
  const txHash = hash as `0x${string}`;
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);

  if (!receipt) {
    const tx = await publicClient.getTransaction({ hash: txHash }).catch(() => null);
    const data = {
      chain,
      hash,
      status: tx ? ("pending" as const) : ("unknown" as const),
      block_number: null as string | null,
      gas_used: null as string | null,
      from: tx?.from ?? null,
      to: tx?.to ?? null,
    };
    if (outputFormat === "json" || outputFormat === "json-compact") {
      logger.raw(formatOutput(data as unknown as Record<string, unknown>, outputFormat));
    } else {
      logger.label("Chain", chain);
      logger.label("Hash", hash);
      logger.label("Status", tx ? "pending (no receipt yet)" : "unknown transaction hash");
    }
    return;
  }

  const status: "success" | "failed" = receipt.status === "success" ? "success" : "failed";
  const data = {
    chain,
    hash: receipt.transactionHash,
    status,
    block_number: receipt.blockNumber.toString(),
    gas_used: receipt.gasUsed.toString(),
    from: receipt.from,
    to: receipt.to,
    contract_address: receipt.contractAddress ?? null,
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data as unknown as Record<string, unknown>, outputFormat));
  } else {
    logger.label("Chain", chain);
    logger.label("Hash", receipt.transactionHash);
    logger.label("Status", status);
    logger.label("Block", receipt.blockNumber.toString());
    logger.label("Gas used", receipt.gasUsed.toString());
  }
}

function isRlusdAmount(
  amount: unknown,
  currency: string,
  issuer: string,
): boolean {
  if (!amount || typeof amount !== "object") return false;
  const a = amount as { currency?: string; issuer?: string };
  return a.currency === currency && a.issuer === issuer;
}

function isRlusdPayment(
  tx: Record<string, unknown>,
  currency: string,
  issuer: string,
): boolean {
  if (tx.TransactionType !== "Payment") return false;
  if (isRlusdAmount(tx.Amount, currency, issuer)) return true;
  const deliverMax = tx.DeliverMax;
  if (isRlusdAmount(deliverMax, currency, issuer)) return true;
  return false;
}

async function txHistoryXrpl(
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
  limit: number,
): Promise<void> {
  const wallet = getDefaultWallet("xrpl");
  if (!wallet) {
    logger.error("No XRPL wallet configured. Run: rlusd wallet generate --chain xrpl");
    process.exitCode = 1;
    return;
  }

  const client = await getXrplClient();
  const fetchLimit = Math.min(400, Math.max(limit * 25, limit, 50));
  const res = await client.request({
    command: "account_tx",
    account: wallet.address,
    limit: fetchLimit,
    ledger_index_min: -1,
    ledger_index_max: -1,
  });

  const txs = (res.result.transactions ?? []) as Array<{ tx?: Record<string, unknown>; meta?: unknown }>;
  const currency = config.rlusd.xrpl_currency;
  const issuer = config.rlusd.xrpl_issuer;

  const rows: Array<Record<string, unknown>> = [];
  for (const entry of txs) {
    const tx = entry.tx;
    if (!tx || !isRlusdPayment(tx, currency, issuer)) continue;
    const hash = typeof tx.hash === "string" ? tx.hash : "";
    const meta = entry.meta as Record<string, unknown> | undefined;
    const tr = meta && typeof meta.TransactionResult === "string" ? meta.TransactionResult : "unknown";
    rows.push({
      hash,
      type: tx.TransactionType,
      account: tx.Account,
      destination: tx.Destination ?? "",
      amount: tx.Amount,
      result: tr,
      ledger_index: tx.ledger_index,
      date: tx.date,
    });
    if (rows.length >= limit) break;
  }

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput({ chain: "xrpl", address: wallet.address, transactions: rows } as Record<string, unknown>, outputFormat));
  } else if (rows.length === 0) {
    logger.info("No recent RLUSD transactions found for this wallet.");
  } else {
    logger.raw(formatOutput(rows, outputFormat, ["hash", "type", "destination", "result", "ledger_index"]));
  }
}

const transferEvent = getAbiItem({ abi: RLUSD_ERC20_ABI, name: "Transfer" });

async function txHistoryEvm(
  config: ReturnType<typeof loadConfig>,
  chain: EvmChainName,
  outputFormat: OutputFormat,
  limit: number,
): Promise<void> {
  assertActiveRlusdEvmChain(chain);
  const wallet = getDefaultWallet(chain);
  if (!wallet) {
    logger.error(`No ${chain} wallet configured. Run: rlusd wallet generate --chain ${chain}`);
    process.exitCode = 1;
    return;
  }

  const publicClient = getEvmPublicClient(chain);
  const contractAddress = getRlusdContractAddress(chain, config);
  const account = wallet.address as `0x${string}`;
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > EVM_LOG_LOOKBACK_BLOCKS ? latest - EVM_LOG_LOOKBACK_BLOCKS : 0n;
  const logsOut: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  const logsIn: Awaited<ReturnType<typeof publicClient.getLogs>> = [];

  for (let start = fromBlock; start <= latest; start += EVM_LOG_BATCH_SIZE) {
    const end =
      start + EVM_LOG_BATCH_SIZE - 1n > latest
        ? latest
        : start + EVM_LOG_BATCH_SIZE - 1n;
    const [outBatch, inBatch] = await Promise.all([
      publicClient.getLogs({
        address: contractAddress,
        event: transferEvent,
        args: { from: account },
        fromBlock: start,
        toBlock: end,
      }),
      publicClient.getLogs({
        address: contractAddress,
        event: transferEvent,
        args: { to: account },
        fromBlock: start,
        toBlock: end,
      }),
    ]);
    logsOut.push(...outBatch);
    logsIn.push(...inBatch);
  }

  type LogRow = {
    blockNumber: bigint;
    logIndex: number;
    transactionHash: string;
    from: string;
    to: string;
    value: string;
  };

  const byKey = new Map<string, LogRow>();

  const pushLog = (log: (typeof logsOut)[number]): void => {
    const rawLog = log as {
      blockNumber?: bigint | null;
      logIndex?: number | null;
      transactionHash?: `0x${string}` | null;
      args?: { from?: string; to?: string; value?: bigint };
    };
    const { blockNumber, logIndex, transactionHash, args } = rawLog;
    if (
      !args ||
      args.from === undefined ||
      args.to === undefined ||
      args.value === undefined ||
      blockNumber === undefined ||
      blockNumber === null ||
      logIndex === undefined ||
      logIndex === null ||
      transactionHash === undefined
      || transactionHash === null
    ) {
      return;
    }
    const key = `${transactionHash}:${logIndex}`;
    byKey.set(key, {
      blockNumber,
      logIndex,
      transactionHash,
      from: args.from,
      to: args.to,
      value: formatUnits(args.value, config.rlusd.eth_decimals),
    });
  };

  for (const log of logsOut) pushLog(log);
  for (const log of logsIn) pushLog(log);

  const merged = [...byKey.values()].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber > b.blockNumber ? -1 : 1;
    }
    return b.logIndex - a.logIndex;
  });

  const rows = merged.slice(0, limit).map((r) => ({
    block: r.blockNumber.toString(),
    tx_hash: r.transactionHash,
    from: r.from,
    to: r.to,
    value_rlusd: r.value,
  }));

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(
      formatOutput(
        { chain, address: wallet.address, lookback_blocks: EVM_LOG_LOOKBACK_BLOCKS.toString(), transfers: rows } as Record<string, unknown>,
        outputFormat,
      ),
    );
  } else if (rows.length === 0) {
    logger.info("No RLUSD Transfer events found for this wallet in the recent block window.");
  } else {
    logger.raw(formatOutput(rows, outputFormat, ["block", "tx_hash", "from", "to", "value_rlusd"]));
  }
}

import { Command } from "commander";
import { loadConfig } from "../config/config.js";
import { getXrplClient, disconnectXrplClient } from "../clients/xrpl-client.js";
import { getEvmPublicClient } from "../clients/evm-client.js";
import { formatOutput } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import { CHAINLINK_AGGREGATOR_ABI } from "../abi/chainlink-aggregator.js";
import { formatUnits } from "viem";
import type { ChainName, OutputFormat, EvmChainName } from "../types/index.js";
import { fetchXrpUsdPrice } from "../services/price-feed.js";
import { assertActiveRlusdEvmChain, getChainlinkOracleAddress } from "../utils/evm-support.js";

type PriceSource = "chainlink" | "dex";
const CHAINLINK_WARN_AGE_SECONDS = 60 * 60;
const CHAINLINK_MAX_AGE_SECONDS = 24 * 60 * 60;

export function registerPriceCommand(program: Command): void {
  program
    .command("price")
    .description("Show RLUSD reference price (Chainlink oracle or XRPL DEX)")
    .option("-c, --chain <chain>", "EVM chain for Chainlink reads (defaults when not xrpl)")
    .option("--source <source>", "chainlink | dex (auto-detected from default chain)")
    .action(async (opts: { chain?: string; source?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      const effectiveChain = (opts.chain || program.opts().chain || config.default_chain) as ChainName;
      const source: PriceSource = opts.source
        ? (opts.source as PriceSource)
        : effectiveChain === "xrpl" ? "dex" : "chainlink";

      try {
        if (source === "dex") {
          await showDexPrice(program, config, outputFormat);
        } else {
          await showChainlinkPrice(program, opts, config, outputFormat);
        }
      } catch (err) {
        logger.error(`Price query failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  program
    .command("market")
    .description("Basic RLUSD market overview (Chainlink + XRPL DEX book)")
    .option("-c, --chain <chain>", "EVM chain for Chainlink (defaults when not xrpl)")
    .action(async (opts: { chain?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      try {
        const chainlink = await readChainlinkPrice(program, opts, config);
        const dex = await readDexBookSummary(config);
        const data = {
          chainlink_usd: chainlink,
          dex_xrp_per_rlusd: dex,
        };

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput(data as unknown as Record<string, unknown>, outputFormat));
        } else {
          logger.label("RLUSD / USD (Chainlink)", chainlink.price_usd ?? "n/a");
          if (chainlink.oracle) {
            logger.label("Oracle", chainlink.oracle);
          }
          if (chainlink.round_id != null) {
            logger.label("Round ID", String(chainlink.round_id));
          }
          if (chainlink.updated_at) {
            logger.label("Updated (Chainlink)", chainlink.updated_at);
          }
          logger.raw("");
          logger.label("DEX best bid (XRP / RLUSD)", dex.best_bid_xrp_per_rlusd ?? "n/a");
          logger.label("DEX best ask (XRP / RLUSD)", dex.best_ask_xrp_per_rlusd ?? "n/a");
          logger.label("DEX bid offers", String(dex.bid_offer_count));
          logger.label("DEX ask offers", String(dex.ask_offer_count));
        }
      } catch (err) {
        logger.error(`Market overview failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

function resolveChainlinkEvmChain(program: Command, opts: { chain?: string }, config: ReturnType<typeof loadConfig>): EvmChainName {
  const fromOpts = (opts.chain || program.opts().chain || config.default_chain) as ChainName;
  if (fromOpts === "xrpl") {
    return "ethereum";
  }
  const chain = fromOpts as EvmChainName;
  assertActiveRlusdEvmChain(chain);
  return chain;
}

async function showChainlinkPrice(
  program: Command,
  opts: { chain?: string },
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const row = await readChainlinkPrice(program, opts, config);

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(row as unknown as Record<string, unknown>, outputFormat));
  } else {
    logger.label("Source", "chainlink");
    logger.label("RLUSD / USD", row.price_usd ?? "n/a");
    if (row.oracle) {
      logger.label("Oracle", row.oracle);
    }
    if (row.evm_chain) {
      logger.label("EVM chain", row.evm_chain);
    }
    if (row.round_id != null) {
      logger.label("Round ID", String(row.round_id));
    }
    if (row.updated_at) {
      logger.label("Updated", row.updated_at);
    }
    if (row.stale_warning) {
      logger.warn(row.stale_warning);
    }
  }
}

async function readChainlinkPrice(
  program: Command,
  opts: { chain?: string },
  config: ReturnType<typeof loadConfig>,
): Promise<{
  source: "chainlink";
  evm_chain: EvmChainName;
  oracle: string;
  price_usd: string | null;
  round_id: string | null;
  updated_at: string | null;
  raw_answer: string | null;
  decimals: number | null;
  stale_warning?: string;
}> {
  const evmChain = resolveChainlinkEvmChain(program, opts, config);
  const publicClient = getEvmPublicClient(evmChain);
  const oracle = getChainlinkOracleAddress(evmChain, config);

  const [roundData, dec] = await Promise.all([
    publicClient.readContract({
      address: oracle,
      abi: CHAINLINK_AGGREGATOR_ABI,
      functionName: "latestRoundData",
    }),
    publicClient.readContract({
      address: oracle,
      abi: CHAINLINK_AGGREGATOR_ABI,
      functionName: "decimals",
    }),
  ]);

  const [, answer, , updatedAt] = roundData;
  const decimals = Number(dec);
  const price =
    Number.isFinite(decimals) && decimals >= 0 ? formatUnits(answer, decimals) : null;
  const updatedAtIso =
    typeof updatedAt === "bigint" ? new Date(Number(updatedAt) * 1000).toISOString() : null;
  const ageSeconds =
    typeof updatedAt === "bigint"
      ? Math.floor(Date.now() / 1000) - Number(updatedAt)
      : null;
  if (ageSeconds !== null && ageSeconds > CHAINLINK_MAX_AGE_SECONDS) {
    throw new Error(
      `Chainlink RLUSD/USD price is stale (${ageSeconds}s old, >24h). Refusing to return an outdated quote.`,
    );
  }

  let stale_warning: string | undefined;
  if (ageSeconds !== null && ageSeconds > CHAINLINK_WARN_AGE_SECONDS) {
    stale_warning = `Price was last updated ${Math.round(ageSeconds / 60)}min ago. Chainlink stablecoin feeds update on heartbeat (~24h) or deviation.`;
  }

  return {
    source: "chainlink",
    evm_chain: evmChain,
    oracle,
    price_usd: price,
    round_id: roundData[0]?.toString() ?? null,
    updated_at: updatedAtIso,
    raw_answer: answer.toString(),
    decimals: Number.isFinite(decimals) ? decimals : null,
    stale_warning,
  };
}

function parseXrpAmount(amount: unknown): number | null {
  if (typeof amount === "string") {
    const drops = parseInt(amount, 10);
    if (Number.isNaN(drops)) return null;
    return drops / 1_000_000;
  }
  if (amount && typeof amount === "object") {
    const a = amount as { currency?: string; value?: string };
    if (a.currency === "XRP" && typeof a.value === "string") {
      const xrp = parseFloat(a.value);
      if (Number.isNaN(xrp)) return null;
      return xrp;
    }
  }
  return null;
}

function parseRlusdAmount(
  amount: unknown,
  currency: string,
  issuer: string,
): number | null {
  if (!amount || typeof amount !== "object") return null;
  const a = amount as { currency?: string; issuer?: string; value?: string };
  if (a.currency !== currency || a.issuer !== issuer) return null;
  const v = parseFloat(a.value || "");
  return Number.isFinite(v) ? v : null;
}

/** Implied XRP paid per 1 RLUSD for this resting offer. */
function impliedXrpPerRlusd(
  takerGets: unknown,
  takerPays: unknown,
  currency: string,
  issuer: string,
): number | null {
  const rlusdGets = parseRlusdAmount(takerGets, currency, issuer);
  const rlusdPays = parseRlusdAmount(takerPays, currency, issuer);
  const xrpGets = parseXrpAmount(takerGets);
  const xrpPays = parseXrpAmount(takerPays);

  if (rlusdGets != null && xrpPays != null && rlusdGets > 0) {
    return xrpPays / rlusdGets;
  }
  if (rlusdPays != null && xrpGets != null && rlusdPays > 0) {
    return xrpGets / rlusdPays;
  }
  return null;
}

async function readDexBookSummary(config: ReturnType<typeof loadConfig>): Promise<{
  best_bid_xrp_per_rlusd: string | null;
  best_ask_xrp_per_rlusd: string | null;
  bid_offer_count: number;
  ask_offer_count: number;
}> {
  const client = await getXrplClient();
  const rlusdCur = config.rlusd.xrpl_currency;
  const rlusdIssuer = config.rlusd.xrpl_issuer;

  const [askBook, bidBook] = await Promise.all([
    client.request({
      command: "book_offers",
      taker_gets: { currency: rlusdCur, issuer: rlusdIssuer },
      taker_pays: { currency: "XRP" },
      limit: 50,
      ledger_index: "validated",
    }),
    client.request({
      command: "book_offers",
      taker_gets: { currency: "XRP" },
      taker_pays: { currency: rlusdCur, issuer: rlusdIssuer },
      limit: 50,
      ledger_index: "validated",
    }),
  ]);

  const askOffers = (askBook.result.offers ?? []) as Array<{
    TakerGets?: unknown;
    TakerPays?: unknown;
  }>;
  const bidOffers = (bidBook.result.offers ?? []) as Array<{
    TakerGets?: unknown;
    TakerPays?: unknown;
  }>;

  let bestAsk: number | null = null;
  for (const o of askOffers) {
    const p = impliedXrpPerRlusd(o.TakerGets, o.TakerPays, rlusdCur, rlusdIssuer);
    if (p == null || !Number.isFinite(p)) continue;
    bestAsk = bestAsk == null ? p : Math.min(bestAsk, p);
  }

  let bestBid: number | null = null;
  for (const o of bidOffers) {
    const p = impliedXrpPerRlusd(o.TakerGets, o.TakerPays, rlusdCur, rlusdIssuer);
    if (p == null || !Number.isFinite(p)) continue;
    bestBid = bestBid == null ? p : Math.max(bestBid, p);
  }

  return {
    best_bid_xrp_per_rlusd: bestBid != null ? bestBid.toFixed(8) : null,
    best_ask_xrp_per_rlusd: bestAsk != null ? bestAsk.toFixed(8) : null,
    bid_offer_count: bidOffers.length,
    ask_offer_count: askOffers.length,
  };
}

async function showDexPrice(
  program: Command,
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  void program;

  const [summary, xrpPrice] = await Promise.all([
    readDexBookSummary(config),
    fetchXrpUsdPrice(config.price_api),
  ]);

  const midXrpPerRlusd =
    summary.best_bid_xrp_per_rlusd && summary.best_ask_xrp_per_rlusd
      ? (parseFloat(summary.best_bid_xrp_per_rlusd) + parseFloat(summary.best_ask_xrp_per_rlusd)) / 2
      : null;

  const rlusdUsd =
    midXrpPerRlusd != null && xrpPrice != null
      ? (midXrpPerRlusd * xrpPrice.usd).toFixed(6)
      : null;

  const data = {
    source: "dex" as const,
    pair: "XRP/RLUSD",
    ...summary,
    ...(rlusdUsd != null && {
      rlusd_usd_estimate: rlusdUsd,
      xrp_usd: xrpPrice!.usd,
      xrp_usd_source: xrpPrice!.source,
    }),
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data as unknown as Record<string, unknown>, outputFormat));
  } else {
    logger.label("Source", "dex (XRPL book_offers)");
    if (rlusdUsd != null) {
      logger.label("RLUSD / USD (estimated)", `$${rlusdUsd}`);
      logger.label("XRP / USD", `$${xrpPrice!.usd} (${xrpPrice!.source})`);
    }
    logger.label("Best bid (XRP / RLUSD)", summary.best_bid_xrp_per_rlusd ?? "n/a");
    logger.label("Best ask (XRP / RLUSD)", summary.best_ask_xrp_per_rlusd ?? "n/a");
    logger.label("Bid-side offers", String(summary.bid_offer_count));
    logger.label("Ask-side offers", String(summary.ask_offer_count));
  }
}

import { Command } from "commander";
import type { OfferCreate, OfferCancel } from "xrpl";
import { getXrplClient, disconnectXrplClient } from "../../clients/xrpl-client.js";
import { getDefaultWallet } from "../../wallet/manager.js";
import { restoreXrplWallet } from "../../wallet/xrpl-wallet.js";
import { loadConfig } from "../../config/config.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import type { StoredXrplWallet, OutputFormat } from "../../types/index.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../../utils/secrets.js";
import { parseUnits } from "viem";

function getOutputFormat(program: Command, configOutput: OutputFormat): OutputFormat {
  return (program.opts().output as OutputFormat) || configOutput;
}

function xrpDropsFromAmountTimesPrice(amount: string, price: string): string {
  const scaledAmount = parseUnits(amount, 6);
  const scaledPrice = parseUnits(price, 6);
  if (scaledAmount <= 0n || scaledPrice <= 0n) {
    throw new Error("amount and price must be positive numbers");
  }
  const drops = (scaledAmount * scaledPrice) / 1_000_000n;
  if (drops <= 0n) {
    throw new Error("Computed XRP amount is too small (rounds to 0 drops). Increase amount or price.");
  }
  return drops.toString();
}

function readTxResult(meta: unknown): string {
  return typeof meta === "object" && meta !== null && "TransactionResult" in meta
    ? (meta as { TransactionResult: string }).TransactionResult
    : "unknown";
}

function offerPriceXrpPerRlusd(offer: {
  TakerGets?: unknown;
  TakerPays?: unknown;
}): number | null {
  const xrpAmount =
    typeof offer.TakerGets === "string"
      ? Number(offer.TakerGets) / 1_000_000
      : typeof offer.TakerPays === "string"
        ? Number(offer.TakerPays) / 1_000_000
        : null;
  const rlusdAmount =
    typeof offer.TakerGets === "object" &&
    offer.TakerGets !== null &&
    "value" in offer.TakerGets
      ? Number((offer.TakerGets as { value: string }).value)
      : typeof offer.TakerPays === "object" &&
          offer.TakerPays !== null &&
          "value" in offer.TakerPays
        ? Number((offer.TakerPays as { value: string }).value)
        : null;

  if (!xrpAmount || !rlusdAmount) return null;
  return xrpAmount / rlusdAmount;
}

export function registerDexCommand(parent: Command, program: Command): void {
  const dexCmd = parent.command("dex").description("XRPL DEX operations for XRP / RLUSD");

  dexCmd
    .command("buy")
    .description("Buy RLUSD with XRP (limit order)")
    .requiredOption("--amount <n>", "RLUSD amount to receive")
    .requiredOption("--price <p>", "XRP price per 1 RLUSD (max XRP to pay per RLUSD)")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const walletData = getDefaultWallet("xrpl") as StoredXrplWallet | null;
        if (!walletData) {
          logger.error("No XRPL wallet configured. Run: rlusd wallet generate --chain xrpl");
          process.exitCode = 1;
          return;
        }

        const password = resolveWalletPassword(opts.password);
        const wallet = restoreXrplWallet(walletData, password);
        const client = await getXrplClient();

        const takerGetsXrp = xrpDropsFromAmountTimesPrice(opts.amount, opts.price);
        const offer: OfferCreate = {
          TransactionType: "OfferCreate",
          Account: wallet.address,
          TakerGets: takerGetsXrp,
          TakerPays: {
            currency: config.rlusd.xrpl_currency,
            issuer: config.rlusd.xrpl_issuer,
            value: opts.amount,
          },
        };

        const prepared = await client.autofill(offer);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        const txResult = readTxResult(result.result.meta);

        if (txResult === "tesSUCCESS") {
          logger.success("Buy offer submitted");
          logger.label("Account", wallet.address);
          logger.label("Tx Hash", result.result.hash);
        } else {
          logger.error(`Offer failed: ${txResult}`);
          logger.label("Tx Hash", result.result.hash);
          process.exitCode = 1;
        }
      } catch (err) {
        logger.error(`DEX buy failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  dexCmd
    .command("sell")
    .description("Sell RLUSD for XRP (limit order)")
    .requiredOption("--amount <n>", "RLUSD amount to sell")
    .requiredOption("--price <p>", "XRP to receive per 1 RLUSD")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const walletData = getDefaultWallet("xrpl") as StoredXrplWallet | null;
        if (!walletData) {
          logger.error("No XRPL wallet configured. Run: rlusd wallet generate --chain xrpl");
          process.exitCode = 1;
          return;
        }

        const password = resolveWalletPassword(opts.password);
        const wallet = restoreXrplWallet(walletData, password);
        const client = await getXrplClient();

        const takerPaysXrp = xrpDropsFromAmountTimesPrice(opts.amount, opts.price);
        const offer: OfferCreate = {
          TransactionType: "OfferCreate",
          Account: wallet.address,
          TakerGets: {
            currency: config.rlusd.xrpl_currency,
            issuer: config.rlusd.xrpl_issuer,
            value: opts.amount,
          },
          TakerPays: takerPaysXrp,
        };

        const prepared = await client.autofill(offer);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        const txResult = readTxResult(result.result.meta);

        if (txResult === "tesSUCCESS") {
          logger.success("Sell offer submitted");
          logger.label("Account", wallet.address);
          logger.label("Tx Hash", result.result.hash);
        } else {
          logger.error(`Offer failed: ${txResult}`);
          logger.label("Tx Hash", result.result.hash);
          process.exitCode = 1;
        }
      } catch (err) {
        logger.error(`DEX sell failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  dexCmd
    .command("cancel")
    .description("Cancel an open offer by sequence number")
    .requiredOption("--sequence <seq>", "OfferSequence from the OfferCreate transaction")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts) => {
      try {
        const walletData = getDefaultWallet("xrpl") as StoredXrplWallet | null;
        if (!walletData) {
          logger.error("No XRPL wallet configured.");
          process.exitCode = 1;
          return;
        }

        const seq = Number.parseInt(String(opts.sequence), 10);
        if (!Number.isFinite(seq) || seq <= 0) {
          logger.error("Invalid --sequence");
          process.exitCode = 1;
          return;
        }

        const password = resolveWalletPassword(opts.password);
        const wallet = restoreXrplWallet(walletData, password);
        const client = await getXrplClient();

        const cancel: OfferCancel = {
          TransactionType: "OfferCancel",
          Account: wallet.address,
          OfferSequence: seq,
        };

        const prepared = await client.autofill(cancel);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        const txResult = readTxResult(result.result.meta);

        if (txResult === "tesSUCCESS") {
          logger.success("Offer canceled");
          logger.label("Tx Hash", result.result.hash);
        } else {
          logger.error(`OfferCancel failed: ${txResult}`);
          logger.label("Tx Hash", result.result.hash);
          process.exitCode = 1;
        }
      } catch (err) {
        logger.error(`DEX cancel failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });

  dexCmd
    .command("orderbook")
    .description("Show XRP / RLUSD order book (both sides)")
    .action(async () => {
      try {
        const config = loadConfig();
        const outputFormat = getOutputFormat(program, config.output_format);
        const client = await getXrplClient();

        const rlusdBook: { currency: string; issuer: string } = {
          currency: config.rlusd.xrpl_currency,
          issuer: config.rlusd.xrpl_issuer,
        };

        // Taker pays XRP, receives RLUSD — bids to buy RLUSD with XRP
        const bidsRes = await client.request({
          command: "book_offers",
          taker_gets: rlusdBook,
          taker_pays: { currency: "XRP" },
          limit: 15,
          ledger_index: "validated",
        });

        // Taker pays RLUSD, receives XRP — asks (RLUSD for XRP)
        const asksRes = await client.request({
          command: "book_offers",
          taker_gets: { currency: "XRP" },
          taker_pays: rlusdBook,
          limit: 15,
          ledger_index: "validated",
        });

        const bids = bidsRes.result.offers ?? [];
        const asks = asksRes.result.offers ?? [];

        const bestBid = bids.reduce<(typeof bids)[number] | undefined>((best, offer) => {
          const offerPrice = offerPriceXrpPerRlusd(offer);
          const bestPrice = best ? offerPriceXrpPerRlusd(best) : null;
          if (offerPrice === null) return best;
          if (bestPrice === null || offerPrice > bestPrice) return offer;
          return best;
        }, undefined);
        const bestAsk = asks.reduce<(typeof asks)[number] | undefined>((best, offer) => {
          const offerPrice = offerPriceXrpPerRlusd(offer);
          const bestPrice = best ? offerPriceXrpPerRlusd(best) : null;
          if (offerPrice === null) return best;
          if (bestPrice === null || offerPrice < bestPrice) return offer;
          return best;
        }, undefined);

        const summarizeOffer = (o: (typeof bids)[0]) => ({
          account: o.Account,
          sequence: o.Sequence,
          quality: o.quality ?? "",
          taker_gets: typeof o.TakerGets === "string" ? o.TakerGets : JSON.stringify(o.TakerGets),
          taker_pays: typeof o.TakerPays === "string" ? o.TakerPays : JSON.stringify(o.TakerPays),
        });

        const data: Record<string, unknown> = {
          pair: "XRP / RLUSD",
          best_bid: bestBid
            ? {
                sequence: bestBid.Sequence,
                account: bestBid.Account,
                quality: bestBid.quality,
                taker_gets: bestBid.TakerGets,
                taker_pays: bestBid.TakerPays,
              }
            : null,
          best_ask: bestAsk
            ? {
                sequence: bestAsk.Sequence,
                account: bestAsk.Account,
                quality: bestAsk.quality,
                taker_gets: bestAsk.TakerGets,
                taker_pays: bestAsk.TakerPays,
              }
            : null,
          top_bids: bids.slice(0, 10).map(summarizeOffer),
          top_asks: asks.slice(0, 10).map(summarizeOffer),
        };

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput(data, outputFormat));
        } else {
          logger.success("XRP / RLUSD order book");
          if (bestBid) {
            logger.label(
              "Best bid (pay XRP, get RLUSD)",
              `seq ${bestBid.Sequence} quality ${bestBid.quality ?? "n/a"}`,
            );
          } else {
            logger.dim("No bids in book");
          }
          if (bestAsk) {
            logger.label(
              "Best ask (pay RLUSD, get XRP)",
              `seq ${bestAsk.Sequence} quality ${bestAsk.quality ?? "n/a"}`,
            );
          } else {
            logger.dim("No asks in book");
          }
          logger.dim("Top bids:");
          logger.raw(formatOutput(data.top_bids as Array<Record<string, unknown>>, outputFormat));
          logger.dim("Top asks:");
          logger.raw(formatOutput(data.top_asks as Array<Record<string, unknown>>, outputFormat));
        }
      } catch (err) {
        logger.error(`Order book query failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

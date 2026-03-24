import { Command } from "commander";
import type { OfferCreate, OfferCancel } from "xrpl";
import { xrpToDrops } from "xrpl";
import { getXrplClient, disconnectXrplClient } from "../../clients/xrpl-client.js";
import { getDefaultWallet } from "../../wallet/manager.js";
import { restoreXrplWallet } from "../../wallet/xrpl-wallet.js";
import { loadConfig } from "../../config/config.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import type { StoredXrplWallet, OutputFormat } from "../../types/index.js";

function getOutputFormat(program: Command, configOutput: OutputFormat): OutputFormat {
  return (program.opts().output as OutputFormat) || configOutput;
}

function xrpDropsFromAmountTimesPrice(amount: string, price: string): string {
  const a = Number(amount);
  const p = Number(price);
  if (!Number.isFinite(a) || !Number.isFinite(p) || a <= 0 || p <= 0) {
    throw new Error("amount and price must be positive numbers");
  }
  return xrpToDrops((a * p).toString());
}

function readTxResult(meta: unknown): string {
  return typeof meta === "object" && meta !== null && "TransactionResult" in meta
    ? (meta as { TransactionResult: string }).TransactionResult
    : "unknown";
}

export function registerDexCommand(parent: Command, program: Command): void {
  const dexCmd = parent.command("dex").description("XRPL DEX operations for XRP / RLUSD");

  dexCmd
    .command("buy")
    .description("Buy RLUSD with XRP (limit order)")
    .requiredOption("--amount <n>", "RLUSD amount to receive")
    .requiredOption("--price <p>", "XRP price per 1 RLUSD (max XRP to pay per RLUSD)")
    .option("--password <password>", "wallet password")
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const walletData = getDefaultWallet("xrpl") as StoredXrplWallet | null;
        if (!walletData) {
          logger.error("No XRPL wallet configured. Run: rlusd wallet generate --chain xrpl");
          process.exitCode = 1;
          return;
        }

        const password = opts.password || "default-dev-password";
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
    .option("--password <password>", "wallet password")
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const walletData = getDefaultWallet("xrpl") as StoredXrplWallet | null;
        if (!walletData) {
          logger.error("No XRPL wallet configured. Run: rlusd wallet generate --chain xrpl");
          process.exitCode = 1;
          return;
        }

        const password = opts.password || "default-dev-password";
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
    .option("--password <password>", "wallet password")
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

        const password = opts.password || "default-dev-password";
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

        const bids = bidsRes.result.offers;
        const asks = asksRes.result.offers;

        const bestBid = bids[0];
        const bestAsk = asks[0];

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

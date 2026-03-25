import { Command } from "commander";
import type { Payment } from "xrpl";
import { getXrplClient, disconnectXrplClient } from "../clients/xrpl-client.js";
import { getEvmPublicClient } from "../clients/evm-client.js";
import { getDefaultWallet, isXrplWallet } from "../wallet/manager.js";
import { restoreXrplWallet } from "../wallet/xrpl-wallet.js";
import { decryptEvmPrivateKey } from "../wallet/evm-wallet.js";
import { loadConfig } from "../config/config.js";
import { detectChainFromAddress, validateAddress } from "../utils/address.js";
import { logger } from "../utils/logger.js";
import { formatOutput } from "../utils/format.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../utils/secrets.js";
import { assertActiveRlusdEvmChain, getRlusdContractAddress } from "../utils/evm-support.js";
import { RLUSD_ERC20_ABI } from "../abi/rlusd-erc20.js";
import type { ChainName, OutputFormat, EvmChainName, StoredXrplWallet, StoredEvmWallet } from "../types/index.js";
import { createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, base, optimism, baseSepolia, optimismSepolia } from "viem/chains";
import type { Chain } from "viem";

function getViemChainForSend(chain: EvmChainName, env: string): Chain {
  if (env === "mainnet") {
    switch (chain) {
      case "base": return base;
      case "optimism": return optimism;
      case "ethereum": return mainnet;
      default:
        throw new Error(`Unsupported EVM chain for send: ${chain}`);
    }
  }
  switch (chain) {
    case "base": return baseSepolia;
    case "optimism": return optimismSepolia;
    case "ethereum": return sepolia;
    default:
      throw new Error(`Unsupported EVM chain for send: ${chain}`);
  }
}

export function registerSendCommand(program: Command): void {
  program
    .command("send")
    .description("Send RLUSD to an address")
    .requiredOption("--to <address>", "recipient address")
    .requiredOption("--amount <amount>", "amount of RLUSD to send")
    .option("-c, --chain <chain>", "chain to send on (auto-detected from address if omitted)")
    .option("--tag <tag>", "XRPL destination tag (integer)")
    .option("--memo <memo>", "transaction memo")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .option("--dry-run", "preview transaction without submitting")
    .action(async (opts) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;

      let chain = (opts.chain || program.opts().chain) as ChainName | undefined;
      if (!chain) {
        const detected = detectChainFromAddress(opts.to);
        if (detected === "xrpl") {
          chain = "xrpl";
        } else if (detected === "ethereum") {
          if (config.default_chain === "xrpl") {
            logger.error(
              "EVM recipient detected but default chain is xrpl. Please specify --chain explicitly (e.g. --chain ethereum).",
            );
            process.exitCode = 1;
            return;
          }
          chain = config.default_chain;
        } else {
          chain = config.default_chain;
        }
      }

      if (!validateAddress(opts.to, chain)) {
        logger.error(`Invalid address for ${chain}: ${opts.to}`);
        process.exitCode = 1;
        return;
      }

      try {
        if (chain === "xrpl") {
          await sendXrpl(opts, config, outputFormat);
        } else {
          await sendEvm(chain as EvmChainName, opts, config, outputFormat);
        }
      } catch (err) {
        logger.error(`Send failed: ${(err as Error).message}`);
        process.exitCode = 1;
      } finally {
        await disconnectXrplClient().catch(() => {});
      }
    });
}

async function sendXrpl(
  opts: { to: string; amount: string; tag?: string; memo?: string; password?: string; dryRun?: boolean },
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const walletData = getDefaultWallet("xrpl");
  if (!walletData || !isXrplWallet(walletData)) {
    logger.error("No XRPL wallet configured. Run: rlusd wallet generate --chain xrpl");
    process.exitCode = 1;
    return;
  }

  const password = resolveWalletPassword(opts.password);
  const wallet = restoreXrplWallet(walletData as StoredXrplWallet, password);
  const client = await getXrplClient();

  const paymentTx: Payment = {
    TransactionType: "Payment",
    Account: wallet.address,
    Destination: opts.to,
    Amount: {
      currency: config.rlusd.xrpl_currency,
      issuer: config.rlusd.xrpl_issuer,
      value: opts.amount,
    },
  };

  if (opts.tag) {
    const destinationTag = Number.parseInt(opts.tag, 10);
    if (!Number.isInteger(destinationTag) || destinationTag < 0 || destinationTag > 0xffffffff) {
      throw new Error("Destination tag must be an integer between 0 and 4294967295.");
    }
    paymentTx.DestinationTag = destinationTag;
  }

  if (opts.memo) {
    if (Buffer.byteLength(opts.memo, "utf-8") > 256) {
      throw new Error("Memo is too long. Maximum length is 256 bytes.");
    }
    paymentTx.Memos = [
      {
        Memo: {
          MemoData: Buffer.from(opts.memo, "utf-8").toString("hex").toUpperCase(),
          MemoType: Buffer.from("text/plain", "utf-8").toString("hex").toUpperCase(),
        },
      },
    ];
  }

  const prepared = await client.autofill(paymentTx);

  if (opts.dryRun) {
    logger.info("Dry run — transaction will not be submitted");
    logger.raw(formatOutput(prepared as unknown as Record<string, unknown>, outputFormat));
    return;
  }

  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  const meta = result.result.meta;
  const txResult = typeof meta === "object" && meta !== null && "TransactionResult" in meta
    ? (meta as { TransactionResult: string }).TransactionResult
    : "unknown";

  if (txResult === "tesSUCCESS") {
    const data = {
      status: "success",
      chain: "xrpl",
      hash: result.result.hash,
      from: wallet.address,
      to: opts.to,
      amount: `${opts.amount} RLUSD`,
    };
    if (outputFormat === "json" || outputFormat === "json-compact") {
      logger.raw(formatOutput(data, outputFormat));
    } else {
      logger.success(`Sent ${opts.amount} RLUSD to ${opts.to}`);
      logger.label("Tx Hash", result.result.hash);
    }
  } else {
    logger.error(`Transaction failed: ${txResult}`);
    logger.label("Tx Hash", result.result.hash);
    process.exitCode = 1;
  }
}

async function sendEvm(
  chain: EvmChainName,
  opts: { to: string; amount: string; password?: string; dryRun?: boolean },
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  assertActiveRlusdEvmChain(chain);
  const walletData = getDefaultWallet(chain);
  if (!walletData || isXrplWallet(walletData)) {
    logger.error(`No EVM wallet configured for ${chain}. Run: rlusd wallet generate --chain ${chain}`);
    process.exitCode = 1;
    return;
  }

  const password = resolveWalletPassword(opts.password);
  const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, password);

  const rpcUrl = config.chains[chain]?.rpc;
  if (!rpcUrl) {
    logger.error(`RPC not configured for ${chain}`);
    process.exitCode = 1;
    return;
  }

  const viemChain = getViemChainForSend(chain, config.environment);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(rpcUrl),
  });

  const contractAddress = getRlusdContractAddress(chain, config);
  const toAddress = opts.to as `0x${string}`;
  const amount = parseUnits(opts.amount, config.rlusd.eth_decimals);

  if (opts.dryRun) {
    logger.info("Dry run — transaction will not be submitted");
    logger.label("Chain", chain);
    logger.label("From", account.address);
    logger.label("To", opts.to);
    logger.label("Amount", `${opts.amount} RLUSD`);
    logger.label("Contract", contractAddress);
    return;
  }

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: RLUSD_ERC20_ABI,
    functionName: "transfer",
    args: [toAddress, amount],
  });

  const publicClient = getEvmPublicClient(chain);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const data = {
    status: receipt.status === "success" ? "success" : "failed",
    chain,
    hash,
    from: account.address,
    to: opts.to,
    amount: `${opts.amount} RLUSD`,
    gas_used: receipt.gasUsed.toString(),
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data, outputFormat));
  } else {
    if (receipt.status === "success") {
      logger.success(`Sent ${opts.amount} RLUSD to ${opts.to} on ${chain}`);
    } else {
      logger.error(`Transaction reverted on ${chain}`);
      process.exitCode = 1;
    }
    logger.label("Tx Hash", hash);
  }
}

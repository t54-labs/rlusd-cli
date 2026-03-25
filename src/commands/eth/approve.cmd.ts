import { Command } from "commander";
import { createWalletClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia, base, optimism, baseSepolia, optimismSepolia } from "viem/chains";
import type { Chain } from "viem";
import { loadConfig } from "../../config/config.js";
import { isXrplWallet, resolveWalletForChain } from "../../wallet/manager.js";
import { decryptEvmPrivateKey } from "../../wallet/evm-wallet.js";
import { getEvmPublicClient } from "../../clients/evm-client.js";
import { RLUSD_ERC20_ABI } from "../../abi/rlusd-erc20.js";
import { logger } from "../../utils/logger.js";
import { formatOutput } from "../../utils/format.js";
import type { EvmChainName, NetworkEnvironment, OutputFormat, StoredEvmWallet } from "../../types/index.js";
import { validateAddress } from "../../utils/address.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../../utils/secrets.js";
import { assertActiveRlusdEvmChain, getRlusdContractAddress } from "../../utils/evm-support.js";

function getViemChain(chain: EvmChainName, env: NetworkEnvironment): Chain {
  if (env === "mainnet") {
    switch (chain) {
      case "base":
        return base;
      case "optimism":
        return optimism;
      case "ethereum":
        return mainnet;
      default:
        throw new Error(`Unsupported EVM chain: ${chain}`);
    }
  }
  switch (chain) {
    case "base":
      return baseSepolia;
    case "optimism":
      return optimismSepolia;
    case "ethereum":
      return sepolia;
    default:
      throw new Error(`Unsupported EVM chain: ${chain}`);
  }
}

function resolveEvmChain(opts: { chain?: string }, program: Command, defaultChain: EvmChainName): EvmChainName {
  const raw = (opts.chain || program.opts().chain || defaultChain) as string;
  if (raw === "xrpl") {
    throw new Error("ERC-20 approve requires an EVM chain.");
  }
  const chain = raw as EvmChainName;
  assertActiveRlusdEvmChain(chain);
  return chain;
}

export function registerApproveCommand(parent: Command, program: Command): void {
  parent
    .command("approve")
    .description("Approve RLUSD spending for a spender")
    .requiredOption("--spender <address>", "spender contract or wallet address")
    .requiredOption("--amount <n>", "allowance amount in RLUSD (token units)")
    .option("-c, --chain <chain>", "EVM chain: ethereum")
    .option("--owner-wallet <name>", "wallet name to use as the RLUSD owner")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { spender: string; amount: string; chain?: string; ownerWallet?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveEvmChain(opts, program, "ethereum");
        if (!validateAddress(opts.spender, chain)) {
          logger.error(`Invalid spender address for ${chain}: ${opts.spender}`);
          process.exitCode = 1;
          return;
        }
        await runApprove(chain, opts.spender, opts.amount, opts.ownerWallet, opts.password, config, outputFormat);
      } catch (err) {
        logger.error(`Approve failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  parent
    .command("allowance")
    .description("Check RLUSD allowance for a spender")
    .requiredOption("--spender <address>", "spender address")
    .option("-c, --chain <chain>", "EVM chain: ethereum")
    .option("--owner-wallet <name>", "wallet name to use as the RLUSD owner")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()}; only used to resolve the active wallet)`,
    )
    .action(async (opts: { spender: string; chain?: string; ownerWallet?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveEvmChain(opts, program, "ethereum");
        if (!validateAddress(opts.spender, chain)) {
          logger.error(`Invalid spender address for ${chain}: ${opts.spender}`);
          process.exitCode = 1;
          return;
        }
        await runAllowance(chain, opts.spender, opts.ownerWallet, config, outputFormat);
      } catch (err) {
        logger.error(`Allowance query failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });

  parent
    .command("revoke")
    .description("Revoke RLUSD approval (set allowance to 0)")
    .requiredOption("--spender <address>", "spender address to revoke")
    .option("-c, --chain <chain>", "EVM chain: ethereum")
    .option("--owner-wallet <name>", "wallet name to use as the RLUSD owner")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action(async (opts: { spender: string; chain?: string; ownerWallet?: string; password?: string }) => {
      const config = loadConfig();
      const outputFormat = (program.opts().output as OutputFormat) || config.output_format;
      try {
        const chain = resolveEvmChain(opts, program, "ethereum");
        if (!validateAddress(opts.spender, chain)) {
          logger.error(`Invalid spender address for ${chain}: ${opts.spender}`);
          process.exitCode = 1;
          return;
        }
        await runApprove(chain, opts.spender, "0", opts.ownerWallet, opts.password, config, outputFormat);
      } catch (err) {
        logger.error(`Revoke failed: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}

async function runApprove(
  chain: EvmChainName,
  spender: string,
  amountStr: string,
  ownerWallet: string | undefined,
  password: string | undefined,
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const walletData = resolveWalletForChain(chain, {
    walletName: ownerWallet,
    optionName: "--owner-wallet",
  });
  if (isXrplWallet(walletData)) {
    throw new Error(`Selected wallet is not an EVM wallet for ${chain}.`);
  }

  const pwd = resolveWalletPassword(password, {
    machineReadable: outputFormat === "json" || outputFormat === "json-compact",
  });
  const privateKey = decryptEvmPrivateKey(walletData as StoredEvmWallet, pwd);

  const rpcUrl = config.chains[chain]?.rpc;
  if (!rpcUrl) {
    logger.error(`RPC not configured for ${chain}`);
    process.exitCode = 1;
    return;
  }

  const viemChain = getViemChain(chain, config.environment);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(rpcUrl),
  });

  const contractAddress = getRlusdContractAddress(chain, config);
  const spenderAddr = spender as `0x${string}`;
  const decimals = config.rlusd.eth_decimals;
  const value = parseUnits(amountStr, decimals);

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: RLUSD_ERC20_ABI,
    functionName: "approve",
    args: [spenderAddr, value],
  });

  const publicClient = getEvmPublicClient(chain);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const data = {
    status: receipt.status === "success" ? "success" : "failed",
    chain,
    hash,
    owner: account.address,
    spender,
    amount: amountStr === "0" ? "0" : amountStr,
    action: amountStr === "0" ? "revoke" : "approve",
    gas_used: receipt.gasUsed.toString(),
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data, outputFormat));
  } else {
    if (receipt.status === "success") {
      logger.success(amountStr === "0" ? "Allowance revoked" : "Approval submitted");
    } else {
      logger.error(`Transaction reverted on ${chain}`);
      process.exitCode = 1;
    }
    logger.label("Tx Hash", hash);
  }
}

async function runAllowance(
  chain: EvmChainName,
  spender: string,
  ownerWallet: string | undefined,
  config: ReturnType<typeof loadConfig>,
  outputFormat: OutputFormat,
): Promise<void> {
  const walletData = resolveWalletForChain(chain, {
    walletName: ownerWallet,
    optionName: "--owner-wallet",
  });
  if (isXrplWallet(walletData)) {
    throw new Error(`Selected wallet is not an EVM wallet for ${chain}.`);
  }

  const owner = walletData.address as `0x${string}`;

  const publicClient = getEvmPublicClient(chain);
  const contractAddress = getRlusdContractAddress(chain, config);
  const spenderAddr = spender as `0x${string}`;

  const raw = await publicClient.readContract({
    address: contractAddress,
    abi: RLUSD_ERC20_ABI,
    functionName: "allowance",
    args: [owner, spenderAddr],
  });

  const human = formatUnits(raw, config.rlusd.eth_decimals);
  const data = {
    chain,
    owner,
    spender,
    allowance_raw: raw.toString(),
    allowance: human,
  };

  if (outputFormat === "json" || outputFormat === "json-compact") {
    logger.raw(formatOutput(data, outputFormat));
  } else {
    logger.label("Chain", chain);
    logger.label("Owner", owner);
    logger.label("Spender", spender);
    logger.label("Allowance (RLUSD)", human);
  }
}

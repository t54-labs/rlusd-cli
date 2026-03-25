import { createPublicClient, http, formatUnits, type PublicClient, type Chain } from "viem";
import { mainnet, sepolia, base, optimism, baseSepolia, optimismSepolia } from "viem/chains";
import { loadConfig } from "../config/config.js";
import { RLUSD_ERC20_ABI } from "../abi/rlusd-erc20.js";
import type { EvmChainName, NetworkEnvironment } from "../types/index.js";
import { assertActiveRlusdEvmChain, getRlusdContractAddress } from "../utils/evm-support.js";

const clientCache = new Map<string, PublicClient>();

function getViemChain(chain: EvmChainName, env: NetworkEnvironment): Chain {
  if (env === "mainnet") {
    switch (chain) {
      case "ethereum": return mainnet;
      case "base": return base;
      case "optimism": return optimism;
      default:
        throw new Error(`Unsupported EVM chain: ${chain}`);
    }
  }
  switch (chain) {
    case "ethereum": return sepolia;
    case "base": return baseSepolia;
    case "optimism": return optimismSepolia;
    default:
      throw new Error(`Unsupported EVM chain: ${chain}`);
  }
}

export function getEvmPublicClient(chain: EvmChainName): PublicClient {
  const config = loadConfig();
  const rpcUrl = config.chains[chain]?.rpc;

  if (!rpcUrl) {
    throw new Error(`RPC URL not configured for ${chain}. Run: rlusd config set --chain ${chain} --rpc <url>`);
  }

  const cacheKey = `${chain}:${rpcUrl}`;
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey)!;
  }

  const viemChain = getViemChain(chain, config.environment);
  const client = createPublicClient({
    chain: viemChain,
    transport: http(rpcUrl, {
      timeout: 30_000,
      retryCount: 2,
      retryDelay: 1_000,
    }),
  });

  clientCache.set(cacheKey, client as PublicClient);
  return client as PublicClient;
}

export async function getEvmRlusdBalance(
  chain: EvmChainName,
  address: string,
): Promise<{ rlusd: string; native: string; nativeSymbol: string }> {
  const config = loadConfig();
  assertActiveRlusdEvmChain(chain);
  const client = getEvmPublicClient(chain);
  const contractAddress = getRlusdContractAddress(chain, config);
  const accountAddress = address as `0x${string}`;

  const [rlusdRaw, nativeRaw] = await Promise.all([
    client.readContract({
      address: contractAddress,
      abi: RLUSD_ERC20_ABI,
      functionName: "balanceOf",
      args: [accountAddress],
    }),
    client.getBalance({ address: accountAddress }),
  ]);

  const rlusd = formatUnits(rlusdRaw, config.rlusd.eth_decimals);
  const native = formatUnits(nativeRaw, 18);
  const nativeSymbol = chain === "ethereum" ? "ETH" : "ETH";

  return { rlusd, native, nativeSymbol };
}

export async function getEvmNativeBalance(
  chain: EvmChainName,
  address: string,
): Promise<{ native: string; nativeSymbol: string }> {
  const client = getEvmPublicClient(chain);
  const accountAddress = address as `0x${string}`;
  const nativeRaw = await client.getBalance({ address: accountAddress });
  return {
    native: formatUnits(nativeRaw, 18),
    nativeSymbol: "ETH",
  };
}

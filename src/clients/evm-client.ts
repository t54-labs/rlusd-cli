import { createPublicClient, http, formatUnits, type PublicClient, type Chain } from "viem";
import { mainnet, sepolia, base, optimism, baseSepolia, optimismSepolia } from "viem/chains";
import { loadConfig } from "../config/config.js";
import { RLUSD_ERC20_ABI } from "../abi/rlusd-erc20.js";
import type { EvmChainName, NetworkEnvironment } from "../types/index.js";

const clientCache = new Map<string, PublicClient>();

function getViemChain(chain: EvmChainName, env: NetworkEnvironment): Chain {
  if (env === "mainnet") {
    switch (chain) {
      case "ethereum": return mainnet;
      case "base": return base;
      case "optimism": return optimism;
      default: return mainnet;
    }
  }
  switch (chain) {
    case "ethereum": return sepolia;
    case "base": return baseSepolia;
    case "optimism": return optimismSepolia;
    default: return sepolia;
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
    transport: http(rpcUrl),
  });

  clientCache.set(cacheKey, client as PublicClient);
  return client as PublicClient;
}

export async function getEvmRlusdBalance(
  chain: EvmChainName,
  address: string,
): Promise<{ rlusd: string; native: string; nativeSymbol: string }> {
  const config = loadConfig();
  const client = getEvmPublicClient(chain);
  const contractAddress = config.rlusd.eth_contract as `0x${string}`;
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

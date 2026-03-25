import { createPublicClient, http, formatUnits, type PublicClient, type Chain } from "viem";
import { mainnet, sepolia, base, optimism, baseSepolia, optimismSepolia } from "viem/chains";
import { loadConfig } from "../config/config.js";
import { RLUSD_ERC20_ABI } from "../abi/rlusd-erc20.js";
import type { EvmChainName, NetworkEnvironment } from "../types/index.js";
import { assertActiveRlusdEvmChain, getRlusdContractAddress } from "../utils/evm-support.js";

const clientCache = new Map<string, PublicClient>();

export interface ResolvedEvmChainRef {
  chain: EvmChainName;
  network: NetworkEnvironment;
  label: string;
  displayName: string;
}

const EVM_DISPLAY_NAMES: Record<EvmChainName, string> = {
  ethereum: "Ethereum",
  base: "Base",
  optimism: "Optimism",
  ink: "Ink",
  unichain: "Unichain",
};

export function getViemChain(chain: EvmChainName, network: NetworkEnvironment): Chain {
  if (network === "mainnet") {
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

export function resolveEvmChainRef(
  input: string,
  defaultNetwork: NetworkEnvironment,
): ResolvedEvmChainRef {
  const normalized = input.toLowerCase();

  if (normalized.endsWith("-mainnet")) {
    const chain = normalized.slice(0, -"-mainnet".length) as EvmChainName;
    assertActiveRlusdEvmChain(chain);
    return {
      chain,
      network: "mainnet",
      label: `${chain}-mainnet`,
      displayName: `${EVM_DISPLAY_NAMES[chain]} Mainnet`,
    };
  }

  if (normalized.endsWith("-sepolia")) {
    const chain = normalized.slice(0, -"-sepolia".length) as EvmChainName;
    assertActiveRlusdEvmChain(chain);
    return {
      chain,
      network: "testnet",
      label: `${chain}-sepolia`,
      displayName: `${EVM_DISPLAY_NAMES[chain]} Sepolia`,
    };
  }

  const chain = normalized as EvmChainName;
  assertActiveRlusdEvmChain(chain);
  const network = defaultNetwork === "mainnet" ? "mainnet" : "testnet";
  const suffix = network === "mainnet" ? "mainnet" : "sepolia";
  return {
    chain,
    network,
    label: `${chain}-${suffix}`,
    displayName: `${EVM_DISPLAY_NAMES[chain]} ${suffix === "mainnet" ? "Mainnet" : "Sepolia"}`,
  };
}

export function getEvmPublicClient(
  chain: EvmChainName,
  network?: NetworkEnvironment,
): PublicClient {
  const config = loadConfig();
  const rpcUrl = config.chains[chain]?.rpc;

  if (!rpcUrl) {
    throw new Error(`RPC URL not configured for ${chain}. Run: rlusd config set --chain ${chain} --rpc <url>`);
  }

  const resolvedNetwork = network ?? config.environment;
  const cacheKey = `${chain}:${resolvedNetwork}:${rpcUrl}`;
  if (clientCache.has(cacheKey)) {
    return clientCache.get(cacheKey)!;
  }

  const viemChain = getViemChain(chain, resolvedNetwork);
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
  const nativeSymbol = "ETH";

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

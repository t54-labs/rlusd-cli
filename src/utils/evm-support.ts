import type { AppConfig, EvmChainName } from "../types/index.js";

export const RLUSD_ACTIVE_EVM_CHAINS: readonly EvmChainName[] = ["ethereum"];
export const PLANNED_EVM_CHAINS: readonly EvmChainName[] = [
  "base",
  "optimism",
  "ink",
  "unichain",
];

export function isActiveRlusdEvmChain(chain: EvmChainName): boolean {
  return RLUSD_ACTIVE_EVM_CHAINS.includes(chain);
}

export function assertActiveRlusdEvmChain(chain: EvmChainName): void {
  if (!isActiveRlusdEvmChain(chain)) {
    throw new Error(
      `RLUSD on ${chain} is not enabled in this CLI yet. Supported EVM chain: ethereum. Planned chains: ${PLANNED_EVM_CHAINS.join(
        ", ",
      )}.`,
    );
  }
}

export function getActiveRlusdEvmChains(): EvmChainName[] {
  return [...RLUSD_ACTIVE_EVM_CHAINS];
}

export function getRlusdContractAddress(
  chain: EvmChainName,
  config: AppConfig,
): `0x${string}` {
  assertActiveRlusdEvmChain(chain);
  return config.rlusd.eth_contract as `0x${string}`;
}

export function getChainlinkOracleAddress(
  chain: EvmChainName,
  config: AppConfig,
): `0x${string}` {
  assertActiveRlusdEvmChain(chain);
  return config.rlusd.chainlink_oracle as `0x${string}`;
}

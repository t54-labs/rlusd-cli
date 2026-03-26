import {
  CURVE_RLUSD_USDC_POOL_ETHEREUM,
  RLUSD_ETH_CONTRACT_MAINNET,
  WELL_KNOWN_TOKENS,
} from "../config/constants.js";
import type { AppConfig } from "../types/index.js";

export type CurvePoolCoin = {
  symbol: "USDC" | "RLUSD";
  address: `0x${string}`;
  decimals: number;
  index: 0 | 1;
};

export type CurvePoolMetadata = {
  venue: "curve";
  chain: "ethereum-mainnet";
  name: "Curve RLUSD/USDC";
  address: `0x${string}`;
  lpTokenAddress: `0x${string}`;
  coins: readonly [CurvePoolCoin, CurvePoolCoin];
  coinIndexBySymbol: {
    USDC: 0;
    RLUSD: 1;
  };
};

const CURVE_RLUSD_USDC_COINS: readonly [CurvePoolCoin, CurvePoolCoin] = [
  {
    symbol: "USDC",
    address: WELL_KNOWN_TOKENS.USDC.address as `0x${string}`,
    decimals: WELL_KNOWN_TOKENS.USDC.decimals,
    index: 0,
  },
  {
    symbol: "RLUSD",
    address: RLUSD_ETH_CONTRACT_MAINNET as `0x${string}`,
    decimals: WELL_KNOWN_TOKENS.RLUSD.decimals,
    index: 1,
  },
] as const;

export function resolveCurvePool(chainLabel: string, config: AppConfig): CurvePoolMetadata {
  if (chainLabel !== "ethereum-mainnet") {
    throw new Error("Curve RLUSD-USDC routing is only supported on ethereum-mainnet.");
  }

  const address = (config.contracts?.ethereum?.curve_rlusd_usdc_pool ||
    CURVE_RLUSD_USDC_POOL_ETHEREUM) as `0x${string}`;

  return {
    venue: "curve",
    chain: "ethereum-mainnet",
    name: "Curve RLUSD/USDC",
    address,
    lpTokenAddress: address,
    coins: CURVE_RLUSD_USDC_COINS,
    coinIndexBySymbol: {
      USDC: 0,
      RLUSD: 1,
    },
  };
}

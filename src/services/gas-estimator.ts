import { formatUnits } from "viem";
import { getEvmPublicClient } from "../clients/evm-client.js";
import type { EvmChainName } from "../types/index.js";

/** Typical simple native transfer gas units (reference only; RLUSD ERC-20 transfers use more). */
const SIMPLE_TRANSFER_GAS = 21000n;

/**
 * Standard XRPL transaction fee (typical minimum), in XRP.
 */
export async function estimateXrplFee(): Promise<string> {
  return "0.000012";
}

/**
 * Reads current gas price from the chain RPC and returns formatted values.
 * Estimated cost assumes a minimal 21,000-gas native transfer for illustration.
 */
export async function estimateEvmGas(
  chain: EvmChainName,
): Promise<{ gasPrice: string; estimatedCost: string }> {
  const publicClient = getEvmPublicClient(chain);
  const gasPriceWei = await publicClient.getGasPrice();
  const gasPriceGwei = formatUnits(gasPriceWei, 9);
  const estimatedCostWei = gasPriceWei * SIMPLE_TRANSFER_GAS;
  const estimatedCostEth = formatUnits(estimatedCostWei, 18);
  return {
    gasPrice: `${gasPriceGwei} gwei`,
    estimatedCost: `${estimatedCostEth} ETH`,
  };
}

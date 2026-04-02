import xrpl from "xrpl";
const { Client } = xrpl;
import { resolveConfigForNetwork } from "../config/config.js";
import type { NetworkEnvironment } from "../types/index.js";
import { normalizeXrplTransactionHash } from "../utils/address.js";

type XrplClientInstance = InstanceType<typeof Client>;

export interface ResolvedXrplChainRef {
  network: NetworkEnvironment;
  label: string;
  displayName: string;
}

let clientInstance: XrplClientInstance | null = null;
let currentUrl: string | null = null;

function dropsToXrpString(drops: string): string {
  const value = BigInt(drops);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function resolveXrplChainRef(
  input: string,
  defaultNetwork: NetworkEnvironment,
): ResolvedXrplChainRef {
  const normalized = input.toLowerCase();

  if (normalized === "xrpl-mainnet") {
    return { network: "mainnet", label: "xrpl-mainnet", displayName: "XRPL Mainnet" };
  }
  if (normalized === "xrpl-testnet") {
    return { network: "testnet", label: "xrpl-testnet", displayName: "XRPL Testnet" };
  }
  if (normalized === "xrpl-devnet") {
    return { network: "devnet", label: "xrpl-devnet", displayName: "XRPL Devnet" };
  }
  if (normalized === "xrpl") {
    return {
      network: defaultNetwork,
      label: `xrpl-${defaultNetwork}`,
      displayName:
        defaultNetwork === "mainnet"
          ? "XRPL Mainnet"
          : defaultNetwork === "devnet"
            ? "XRPL Devnet"
            : "XRPL Testnet",
    };
  }

  throw new Error(`Unsupported XRPL chain label: ${input}`);
}

export async function getXrplClient(network?: NetworkEnvironment): Promise<XrplClientInstance> {
  const config = resolveConfigForNetwork(network);
  const url = config.chains.xrpl?.websocket;

  if (!url) {
    throw new Error("XRPL WebSocket URL not configured. Run: rlusd config set --chain xrpl --rpc <url>");
  }

  if (clientInstance && clientInstance.isConnected() && currentUrl === url) {
    return clientInstance;
  }

  if (clientInstance) {
    try { await clientInstance.disconnect(); } catch { /* ignore */ }
  }

  clientInstance = new Client(url);
  currentUrl = url;
  await clientInstance.connect();
  return clientInstance;
}

export async function disconnectXrplClient(): Promise<void> {
  if (clientInstance && clientInstance.isConnected()) {
    await clientInstance.disconnect();
    clientInstance = null;
    currentUrl = null;
  }
}

export async function getXrplBalance(
  address: string,
  network?: NetworkEnvironment,
): Promise<{ xrp: string; rlusd: string }> {
  const client = await getXrplClient(network);
  const config = resolveConfigForNetwork(network);

  let xrpBalance: string;
  let rlusdBalance = "0";

  try {
    const accountInfo = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    const drops = accountInfo.result.account_data.Balance;
    xrpBalance = dropsToXrpString(drops);
  } catch (err: unknown) {
    const error = err as { data?: { error?: string } };
    if (error.data?.error === "actNotFound") {
      xrpBalance = "0";
    } else {
      throw err;
    }
  }

  try {
    const lines = await client.request({
      command: "account_lines",
      account: address,
      peer: config.rlusd.xrpl_issuer,
      ledger_index: "validated",
    });

    const rlusdLine = lines.result.lines.find(
      (line: { currency: string; account: string; balance: string }) =>
        line.currency === config.rlusd.xrpl_currency &&
        line.account === config.rlusd.xrpl_issuer,
    );

    if (rlusdLine) {
      rlusdBalance = rlusdLine.balance;
    }
  } catch (err: unknown) {
    const error = err as { data?: { error?: string } };
    if (error.data?.error === "actNotFound") {
      rlusdBalance = "0";
    } else {
      throw err;
    }
  }

  return { xrp: xrpBalance, rlusd: rlusdBalance };
}

export async function getXrplAccountInfo(
  network: NetworkEnvironment,
  address: string,
): Promise<Record<string, unknown>> {
  const client = await getXrplClient(network);
  try {
    const res = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    return {
      account_exists: true,
      account_data: res.result.account_data,
    };
  } catch (err: unknown) {
    const error = err as { data?: { error?: string } };
    if (error.data?.error === "actNotFound") {
      return { account_exists: false };
    }
    throw err;
  }
}

export async function getXrplTrustlineStatus(
  network: NetworkEnvironment,
  address: string,
): Promise<{
  present: boolean;
  account_exists: boolean;
  balance?: string;
  limit?: string;
  frozen?: boolean;
}> {
  const client = await getXrplClient(network);
  const config = resolveConfigForNetwork(network);

  try {
    const lines = await client.request({
      command: "account_lines",
      account: address,
      peer: config.rlusd.xrpl_issuer,
      ledger_index: "validated",
    });

    const rlusdLine = lines.result.lines.find(
      (line: { currency: string; account: string; balance: string; limit: string; freeze?: boolean }) =>
        line.currency === config.rlusd.xrpl_currency && line.account === config.rlusd.xrpl_issuer,
    );

    if (!rlusdLine) {
      return { present: false, account_exists: true };
    }

    return {
      present: true,
      account_exists: true,
      balance: rlusdLine.balance,
      limit: rlusdLine.limit,
      frozen: rlusdLine.freeze,
    };
  } catch (err: unknown) {
    const error = err as { data?: { error?: string } };
    if (error.data?.error === "actNotFound") {
      return { present: false, account_exists: false };
    }
    throw err;
  }
}

export async function waitForXrplTransaction(
  network: NetworkEnvironment,
  hash: string,
): Promise<Record<string, unknown>> {
  const client = await getXrplClient(network);
  const normalizedHash = normalizeXrplTransactionHash(hash);
  const res = await client.request({
    command: "tx",
    transaction: normalizedHash,
  });

  return {
    transaction_hash: normalizedHash,
    validated: res.result.validated === true,
    result:
      typeof res.result.meta === "object" &&
      res.result.meta !== null &&
      "TransactionResult" in res.result.meta
        ? (res.result.meta as { TransactionResult: string }).TransactionResult
        : "unknown",
    ledger_index: res.result.ledger_index,
  };
}

export async function getXrplPaymentReceipt(
  network: NetworkEnvironment,
  hash: string,
): Promise<Record<string, unknown>> {
  const client = await getXrplClient(network);
  const normalizedHash = normalizeXrplTransactionHash(hash);
  const res = await client.request({
    command: "tx",
    transaction: normalizedHash,
  });
  const tx = ("tx_json" in res.result && res.result.tx_json
    ? res.result.tx_json
    : res.result) as Record<string, unknown>;

  return {
    transaction_hash: normalizedHash,
    validated: res.result.validated === true,
    result:
      typeof res.result.meta === "object" &&
      res.result.meta !== null &&
      "TransactionResult" in res.result.meta
        ? (res.result.meta as { TransactionResult: string }).TransactionResult
        : "unknown",
    ledger_index: res.result.ledger_index,
    destination: tx.Destination,
    amount: tx.Amount,
  };
}

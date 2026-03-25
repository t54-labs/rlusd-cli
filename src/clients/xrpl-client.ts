import { Client } from "xrpl";
import { loadConfig } from "../config/config.js";

let clientInstance: Client | null = null;
let currentUrl: string | null = null;

export async function getXrplClient(): Promise<Client> {
  const config = loadConfig();
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

export async function getXrplBalance(address: string): Promise<{ xrp: string; rlusd: string }> {
  const client = await getXrplClient();
  const config = loadConfig();

  let xrpBalance: string;
  let rlusdBalance = "0";

  try {
    const accountInfo = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    const drops = accountInfo.result.account_data.Balance;
    xrpBalance = (parseInt(drops, 10) / 1_000_000).toString();
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
      (line) =>
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

import Table from "cli-table3";
import type { OutputFormat } from "../types/index.js";

export function formatOutput(
  data: Record<string, unknown> | Array<Record<string, unknown>>,
  format: OutputFormat,
  tableHeaders?: string[],
): string {
  switch (format) {
    case "json":
      return JSON.stringify(data, null, 2);
    case "json-compact":
      return JSON.stringify(data);
    case "table":
    default:
      return formatTable(data, tableHeaders);
  }
}

function formatTable(
  data: Record<string, unknown> | Array<Record<string, unknown>>,
  headers?: string[],
): string {
  if (Array.isArray(data)) {
    return formatArrayAsTable(data, headers);
  }
  return formatObjectAsTable(data);
}

function formatObjectAsTable(data: Record<string, unknown>): string {
  const table = new Table();
  for (const [key, value] of Object.entries(data)) {
    table.push({ [key]: String(value ?? "") });
  }
  return table.toString();
}

function formatArrayAsTable(
  data: Array<Record<string, unknown>>,
  headers?: string[],
): string {
  if (data.length === 0) return "No data";

  const keys = headers || Object.keys(data[0]);
  const table = new Table({ head: keys });

  for (const row of data) {
    table.push(keys.map((k) => String(row[k] ?? "")));
  }

  return table.toString();
}

export function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatRlusdAmount(amount: string, decimals = 2): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

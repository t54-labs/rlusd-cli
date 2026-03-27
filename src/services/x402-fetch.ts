import type { NetworkEnvironment } from "../types/index.js";

export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  amount: string;
  asset?: string;
  currency?: string;
  payTo: string;
  maxTimeoutSeconds: number;
  issuer?: string;
  extra?: Record<string, unknown> | null;
}

export interface SelectX402RequirementOptions {
  network: string;
  maxValue: string;
  requireAsset?: string;
  requireIssuer?: string;
  scheme?: string;
}

export function resolveX402NetworkId(network: NetworkEnvironment): "xrpl:0" | "xrpl:1" | "xrpl:2" {
  switch (network) {
    case "mainnet":
      return "xrpl:1";
    case "devnet":
      return "xrpl:2";
    case "testnet":
    default:
      return "xrpl:0";
  }
}

export function parseAndValidateX402MaxValue(maxValue: string): number {
  const parsed = Number.parseFloat(maxValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid x402 max value: ${maxValue}`);
  }
  return parsed;
}

export function selectCompatibleX402Requirement(
  requirements: X402PaymentRequirement[],
  options: SelectX402RequirementOptions,
): X402PaymentRequirement {
  const scheme = options.scheme ?? "exact";
  const maxValue = parseAndValidateX402MaxValue(options.maxValue);
  const requireAsset = options.requireAsset?.toUpperCase();
  const requireIssuer = options.requireIssuer;

  const selected = requirements.find((requirement) => {
    const amount = Number.parseFloat(requirement.amount);
    const asset = requirement.asset ?? requirement.currency;
    const issuer =
      requirement.extra &&
      typeof requirement.extra === "object" &&
      typeof requirement.extra.issuer === "string"
        ? requirement.extra.issuer
        : requirement.issuer;

    if (requirement.scheme !== scheme) return false;
    if (requirement.network !== options.network) return false;
    if (!Number.isFinite(amount) || amount > maxValue) return false;
    if (requireAsset && asset?.toUpperCase() !== requireAsset) return false;
    if (requireIssuer && issuer !== requireIssuer) return false;

    return true;
  });

  if (!selected) {
    throw new Error("No compatible x402 XRPL payment option found.");
  }

  return selected;
}

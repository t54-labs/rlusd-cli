import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createSuccessEnvelope } from "../agent/envelope.js";
import { getPlansDir } from "../config/config.js";
import type {
  LoadedPreparedPlan,
  PreparedPlanData,
  PreparedPlanIntent,
  PrepareAction,
  ResolvedAsset,
} from "../types/index.js";

type CreatePreparedPlanInput<
  TParams extends Record<string, string>,
  TIntent extends PreparedPlanIntent,
> = {
  command: string;
  chain: string;
  timestamp: string;
  action: PrepareAction;
  requires_confirmation: boolean;
  human_summary: string;
  asset: ResolvedAsset;
  params: TParams;
  intent: TIntent;
  warnings: string[];
  next?: Array<{ command: string }>;
  planDir?: string;
};

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "string");
}

function isIntentRecord(value: unknown): value is PreparedPlanIntent {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const VALID_CHAIN_FAMILIES = new Set(["evm", "xrpl"]);

function isResolvedAsset(value: unknown): value is ResolvedAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.symbol === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.chain === "string" &&
    typeof candidate.family === "string" &&
    VALID_CHAIN_FAMILIES.has(candidate.family)
  );
}

function parseLoadedPreparedPlan(value: unknown): LoadedPreparedPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Prepared plan file must contain a JSON object.");
  }

  const candidate = value as Record<string, unknown>;
  const next = candidate.next;
  const warnings = candidate.warnings;
  const data = candidate.data;

  if (
    candidate.ok !== true ||
    typeof candidate.command !== "string" ||
    typeof candidate.chain !== "string" ||
    typeof candidate.timestamp !== "string" ||
    !Array.isArray(warnings) ||
    warnings.some((warning) => typeof warning !== "string") ||
    !Array.isArray(next) ||
    next.some(
      (step) =>
        !step ||
        typeof step !== "object" ||
        Array.isArray(step) ||
        typeof (step as Record<string, unknown>).command !== "string",
    ) ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new Error("Prepared plan file has an invalid envelope shape.");
  }

  const planData = data as Record<string, unknown>;

  if (
    typeof planData.plan_id !== "string" ||
    typeof planData.plan_path !== "string" ||
    typeof planData.action !== "string" ||
    typeof planData.requires_confirmation !== "boolean" ||
    typeof planData.human_summary !== "string" ||
    !isResolvedAsset(planData.asset) ||
    !isStringRecord(planData.params) ||
    !isIntentRecord(planData.intent)
  ) {
    throw new Error("Prepared plan file has invalid plan data.");
  }

  return {
    ok: true,
    command: candidate.command,
    chain: candidate.chain,
    timestamp: candidate.timestamp,
    data: {
      plan_id: planData.plan_id,
      plan_path: planData.plan_path,
      action: planData.action as PrepareAction,
      requires_confirmation: planData.requires_confirmation,
      human_summary: planData.human_summary,
      asset: planData.asset,
      params: planData.params,
      intent: planData.intent,
    },
    warnings,
    next: next as Array<{ command: string }>,
  };
}

export function createPlanId(value: unknown): string {
  const digest = createHash("sha256").update(stableSerialize(value)).digest("hex");
  return `plan_${digest.slice(0, 12)}`;
}

export async function createPreparedPlan<
  TParams extends Record<string, string>,
  TIntent extends PreparedPlanIntent,
>(input: CreatePreparedPlanInput<TParams, TIntent>) {
  const planId = createPlanId({
    command: input.command,
    chain: input.chain,
    action: input.action,
    requires_confirmation: input.requires_confirmation,
    asset: input.asset,
    params: input.params,
    intent: input.intent,
    warnings: input.warnings,
  });

  const planDir = input.planDir ?? getPlansDir();
  const planPath = path.join(planDir, `${planId}.json`);

  const data: PreparedPlanData<TParams, TIntent> = {
    plan_id: planId,
    plan_path: planPath,
    action: input.action,
    requires_confirmation: input.requires_confirmation,
    human_summary: input.human_summary,
    asset: input.asset,
    params: input.params,
    intent: input.intent,
  };

  const envelope = createSuccessEnvelope({
    command: input.command,
    chain: input.chain,
    timestamp: input.timestamp,
    data,
    warnings: input.warnings,
    next: input.next ?? [],
  });

  await mkdir(planDir, { recursive: true });
  await writeFile(planPath, JSON.stringify(envelope, null, 2));

  return envelope;
}

export async function loadPreparedPlan(planPath: string): Promise<LoadedPreparedPlan> {
  const fileContents = await readFile(planPath, "utf8");
  const parsedPlan = parseLoadedPreparedPlan(JSON.parse(fileContents));

  const expectedPlanId = createPlanId({
    command: parsedPlan.command,
    chain: parsedPlan.chain,
    action: parsedPlan.data.action,
    requires_confirmation: parsedPlan.data.requires_confirmation,
    asset: parsedPlan.data.asset,
    params: parsedPlan.data.params,
    intent: parsedPlan.data.intent,
    warnings: parsedPlan.warnings,
  });

  if (parsedPlan.data.plan_id !== expectedPlanId) {
    throw new Error("Prepared plan contents do not match the stored deterministic plan id.");
  }

  return parsedPlan;
}

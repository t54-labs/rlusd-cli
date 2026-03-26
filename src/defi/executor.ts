import type { LoadedPreparedPlan, PrepareAction } from "../types/index.js";
import type { DefiExecutionResult, DefiIntentStep } from "./types.js";

type ExecutorWalletClient = {
  sendTransaction: (request: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
  }) => Promise<`0x${string}`>;
};

type ExecutorPublicClient = {
  waitForTransactionReceipt: (request: {
    hash: `0x${string}`;
  }) => Promise<{
    status: string;
  }>;
};

function extractIntentSteps(plan: LoadedPreparedPlan): DefiIntentStep[] {
  const rawSteps = ((plan.data.intent as { steps?: Array<Record<string, unknown>> }).steps ?? []).map((step) => ({
    step: String(step.step),
    to: String(step.to) as `0x${string}`,
    data: String(step.data) as `0x${string}`,
    value: String(step.value ?? "0"),
  }));

  return rawSteps;
}

export function assertExecutableDefiPlan(
  plan: LoadedPreparedPlan,
  expectedAction: PrepareAction,
  callerLabel: string,
  confirmPlanId?: string,
): void {
  if (plan.data.action !== expectedAction) {
    throw new Error(`Prepared plan action '${plan.data.action}' cannot be executed by ${callerLabel}.`);
  }

  if (plan.data.requires_confirmation && confirmPlanId !== plan.data.plan_id) {
    throw new Error("Execution requires an explicit confirmation matching the prepared plan id.");
  }
}

export async function executePreparedDefiPlan(input: {
  callerLabel: string;
  expectedAction: PrepareAction;
  plan: LoadedPreparedPlan;
  walletClient: ExecutorWalletClient;
  publicClient: ExecutorPublicClient;
  confirmPlanId?: string;
}): Promise<DefiExecutionResult[]> {
  assertExecutableDefiPlan(input.plan, input.expectedAction, input.callerLabel, input.confirmPlanId);

  const steps = extractIntentSteps(input.plan);
  const results: DefiExecutionResult[] = [];

  for (const step of steps) {
    const txHash = await input.walletClient.sendTransaction({
      to: step.to,
      data: step.data,
      value: BigInt(step.value),
    });
    const receipt = await input.publicClient.waitForTransactionReceipt({ hash: txHash });
    const status = receipt.status === "success" ? "success" : "reverted";
    results.push({ step: step.step, tx_hash: txHash, status });

    if (receipt.status !== "success") {
      throw new Error(`Step "${step.step}" reverted (tx: ${txHash}). Aborting remaining steps.`);
    }
  }

  return results;
}

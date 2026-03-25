import { inferAgentErrorCode } from "./errors.js";
import type { AgentErrorEnvelope, AgentNextStep, AgentSuccessEnvelope } from "./types.js";

type ConsoleLog = typeof console.log;
type ConsoleError = typeof console.error;
type ConsoleTable = typeof console.table;

interface AgentCaptureState {
  command: string;
  chain?: string;
  stdout: string[];
  stderr: string[];
  originalLog: ConsoleLog;
  originalError: ConsoleError;
  originalTable: ConsoleTable;
}

let captureState: AgentCaptureState | null = null;

function stringifyEnvelope(value: AgentSuccessEnvelope | AgentErrorEnvelope): string {
  return JSON.stringify(value, null, 2);
}

function joinArgs(args: unknown[]): string {
  return args.map((arg) => String(arg)).join(" ");
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isEnvelopeLike(value: unknown): value is AgentSuccessEnvelope | AgentErrorEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.command === "string" &&
    typeof candidate.timestamp === "string"
  );
}

function normalizeNextSteps(next: Array<{ command: string }>): AgentNextStep[] {
  return next.map((step) => ({ command: step.command }));
}

export function createSuccessEnvelope<TData>(input: {
  command: string;
  chain?: string;
  timestamp: string;
  data: TData;
  warnings?: string[];
  next?: Array<{ command: string }>;
}): AgentSuccessEnvelope<TData> {
  return {
    ok: true,
    command: input.command,
    chain: input.chain,
    timestamp: input.timestamp,
    data: input.data,
    warnings: input.warnings ?? [],
    next: normalizeNextSteps(input.next ?? []),
  };
}

export function createErrorEnvelope(input: {
  command: string;
  chain?: string;
  timestamp: string;
  code: string;
  message: string;
  retryable?: boolean;
  warnings?: string[];
  next?: Array<{ command: string }>;
  details?: Record<string, unknown>;
}): AgentErrorEnvelope {
  return {
    ok: false,
    command: input.command,
    chain: input.chain,
    timestamp: input.timestamp,
    error: {
      code: input.code,
      message: input.message,
      retryable: input.retryable ?? false,
      details: input.details,
    },
    warnings: input.warnings ?? [],
    next: normalizeNextSteps(input.next ?? []),
  };
}

export function beginAgentCapture(command: string, chain?: string): void {
  if (captureState) return;

  captureState = {
    command,
    chain,
    stdout: [],
    stderr: [],
    originalLog: console.log.bind(console),
    originalError: console.error.bind(console),
    originalTable: console.table.bind(console),
  };

  console.log = (...args: unknown[]) => {
    captureState?.stdout.push(joinArgs(args));
  };

  console.error = (...args: unknown[]) => {
    captureState?.stderr.push(joinArgs(args));
  };

  console.table = (tabularData: unknown) => {
    captureState?.stdout.push(JSON.stringify(tabularData, null, 2));
  };
}

export function endAgentCapture(): void {
  if (!captureState) return;

  const state = captureState;
  captureState = null;

  console.log = state.originalLog;
  console.error = state.originalError;
  console.table = state.originalTable;

  const timestamp = new Date().toISOString();
  const rawOutput = state.stdout.join("\n").trim();
  const parsedStdout = rawOutput ? tryParseJson(rawOutput) : null;

  if (state.stderr.length > 0 || process.exitCode) {
    const message = state.stderr.join("\n").trim() || "Command failed";
    const parsed = tryParseJson(message);
    if (isEnvelopeLike(parsed)) {
      state.originalError(stringifyEnvelope(parsed));
      return;
    }
    if (isEnvelopeLike(parsedStdout) && parsedStdout.ok === false) {
      state.originalError(stringifyEnvelope(parsedStdout));
      return;
    }
    const envelope = createErrorEnvelope({
      command: state.command,
      chain: state.chain,
      timestamp,
      code: inferAgentErrorCode(message),
      message,
    });

    state.originalError(stringifyEnvelope(envelope));
    return;
  }

  if (isEnvelopeLike(parsedStdout)) {
    state.originalLog(stringifyEnvelope(parsedStdout));
    return;
  }
  const envelope = createSuccessEnvelope({
    command: state.command,
    chain: state.chain,
    timestamp,
    data: parsedStdout,
  });

  state.originalLog(stringifyEnvelope(envelope));
}

export function isAgentCaptureActive(): boolean {
  return captureState !== null;
}

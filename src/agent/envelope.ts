import { inferAgentErrorCode } from "./errors.js";
import type { AgentErrorEnvelope, AgentNextStep, AgentSuccessEnvelope } from "./types.js";

type ConsoleLog = typeof console.log;
type ConsoleError = typeof console.error;
type ConsoleTable = typeof console.table;

interface AgentCaptureState {
  command: string;
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

function createNextSteps(): AgentNextStep[] {
  return [];
}

export function beginAgentCapture(command: string): void {
  if (captureState) return;

  captureState = {
    command,
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

  if (state.stderr.length > 0 || process.exitCode) {
    const message = state.stderr.join("\n").trim() || "Command failed";
    const envelope: AgentErrorEnvelope = {
      ok: false,
      command: state.command,
      timestamp,
      error: {
        code: inferAgentErrorCode(message),
        message,
      },
      warnings: [],
      next: createNextSteps(),
    };

    state.originalError(stringifyEnvelope(envelope));
    return;
  }

  const rawOutput = state.stdout.join("\n").trim();
  const envelope: AgentSuccessEnvelope = {
    ok: true,
    command: state.command,
    timestamp,
    data: rawOutput ? tryParseJson(rawOutput) : null,
    warnings: [],
    next: createNextSteps(),
  };

  state.originalLog(stringifyEnvelope(envelope));
}

export function isAgentCaptureActive(): boolean {
  return captureState !== null;
}

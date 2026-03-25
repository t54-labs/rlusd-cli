export interface AgentNextStep {
  command: string;
}

export interface AgentErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface AgentSuccessEnvelope<TData = unknown> {
  ok: true;
  command: string;
  chain?: string;
  timestamp: string;
  data: TData;
  warnings: string[];
  next: AgentNextStep[];
}

export interface AgentErrorEnvelope {
  ok: false;
  command: string;
  chain?: string;
  timestamp: string;
  error: AgentErrorPayload;
  warnings: string[];
  next: AgentNextStep[];
}

export type AgentEnvelope<TData = unknown> = AgentSuccessEnvelope<TData> | AgentErrorEnvelope;

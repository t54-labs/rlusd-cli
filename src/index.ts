export { createProgram } from "./cli.js";
export {
  beginAgentCapture,
  createErrorEnvelope,
  createSuccessEnvelope,
  endAgentCapture,
  isAgentCaptureActive,
} from "./agent/envelope.js";
export { inferAgentErrorCode } from "./agent/errors.js";
export type { AgentEnvelope, AgentErrorEnvelope, AgentErrorPayload, AgentNextStep, AgentSuccessEnvelope } from "./agent/types.js";

export function inferAgentErrorCode(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("explicit confirmation")) {
    return "CONFIRMATION_REQUIRED";
  }

  if (normalized.includes("deterministic plan id")) {
    return "PLAN_INTEGRITY_MISMATCH";
  }

  if (normalized.includes("unknown option")) {
    return "UNKNOWN_OPTION";
  }

  if (normalized.includes("required")) {
    return "MISSING_REQUIRED_ARGUMENT";
  }

  if (normalized.includes("invalid")) {
    return "INVALID_ARGUMENT";
  }

  return "COMMAND_ERROR";
}

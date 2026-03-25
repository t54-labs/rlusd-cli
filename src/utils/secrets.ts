const PASSWORD_ENV_VAR = "RLUSD_WALLET_PASSWORD";

export function resolveWalletPassword(provided?: string): string {
  const password = provided || process.env[PASSWORD_ENV_VAR];
  if (!password) {
    throw new Error(
      `Wallet password is required. Provide --password or set ${PASSWORD_ENV_VAR}.`,
    );
  }
  return password;
}

export function getWalletPasswordEnvVarName(): string {
  return PASSWORD_ENV_VAR;
}

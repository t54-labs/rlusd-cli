import { getWalletPasswordFromKeychain } from "./keychain.js";

const PASSWORD_ENV_VAR = "RLUSD_WALLET_PASSWORD";

export function resolveWalletPassword(
  provided?: string,
  options?: { machineReadable?: boolean; walletName?: string },
): string {
  const password =
    provided ||
    process.env[PASSWORD_ENV_VAR] ||
    (options?.walletName
      ? getWalletPasswordFromKeychain(options.walletName)
      : null);
  if (!password) {
    if (options?.machineReadable) {
      throw new Error(
        `Wallet password is required for machine-readable operations. Provide --password, set ${PASSWORD_ENV_VAR}, or enable Keychain storage for this wallet.`,
      );
    }
    throw new Error(
      `Wallet password is required. Provide --password, set ${PASSWORD_ENV_VAR}, or enable Keychain storage for this wallet.`,
    );
  }
  return password;
}

export function getWalletPasswordEnvVarName(): string {
  return PASSWORD_ENV_VAR;
}

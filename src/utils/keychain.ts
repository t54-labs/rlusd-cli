import { execFileSync } from "node:child_process";

const KEYCHAIN_SERVICE = "com.t54labs.rlusd-cli.wallet-password";

function assertMacOs(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "System Keychain integration is currently supported on macOS only.",
    );
  }
}

export function supportsSystemKeychain(): boolean {
  return process.platform === "darwin";
}

export function getKeychainServiceName(): string {
  return KEYCHAIN_SERVICE;
}

export function storeWalletPasswordInKeychain(
  walletName: string,
  password: string,
): void {
  assertMacOs();
  execFileSync(
    "security",
    [
      "add-generic-password",
      "-a",
      walletName,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
      password,
      "-U",
    ],
    { stdio: "ignore" },
  );
}

export function getWalletPasswordFromKeychain(
  walletName: string,
): string | null {
  if (!supportsSystemKeychain()) return null;

  try {
    return execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        walletName,
        "-s",
        KEYCHAIN_SERVICE,
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null;
  }
}

export function deleteWalletPasswordFromKeychain(walletName: string): boolean {
  if (!supportsSystemKeychain()) return false;

  try {
    execFileSync(
      "security",
      [
        "delete-generic-password",
        "-a",
        walletName,
        "-s",
        KEYCHAIN_SERVICE,
      ],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

export function hasWalletPasswordInKeychain(walletName: string): boolean {
  return getWalletPasswordFromKeychain(walletName) !== null;
}

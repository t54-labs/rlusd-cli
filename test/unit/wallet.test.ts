import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_HOME = join(tmpdir(), `rlusd-wallet-test-${Date.now()}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_HOME };
});

const { encrypt, decrypt } = await import("../../src/wallet/crypto.js");
const {
  generateXrplWallet,
  importXrplWalletFromSecret,
  serializeXrplWallet,
  decryptXrplSecret,
  restoreXrplWallet,
} = await import("../../src/wallet/xrpl-wallet.js");
const {
  generateEvmWallet,
  importEvmWalletFromPrivateKey,
  importEvmWalletFromMnemonic,
  serializeEvmWallet,
  decryptEvmPrivateKey,
} = await import("../../src/wallet/evm-wallet.js");
const {
  saveWallet,
  loadWallet,
  listWallets,
  deleteWallet,
  listWalletsByChain,
  setDefaultWallet,
  getDefaultWallet,
} = await import("../../src/wallet/manager.js");
const { ensureConfigDir } = await import("../../src/config/config.js");

describe("Wallet Crypto", () => {
  const PASSWORD = "test-password-123";

  it("should encrypt and decrypt data", () => {
    const plaintext = "sEdTM1uX8pu5do5XvTnutH6HsouMaM2";
    const encrypted = encrypt(plaintext, PASSWORD);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decrypt(encrypted, PASSWORD);
    expect(decrypted).toBe(plaintext);
  });

  it("should fail decryption with wrong password", () => {
    const encrypted = encrypt("secret", PASSWORD);
    expect(() => decrypt(encrypted, "wrong-password")).toThrow();
  });

  it("should produce different ciphertexts for same input (due to random salt/IV)", () => {
    const e1 = encrypt("same-data", PASSWORD);
    const e2 = encrypt("same-data", PASSWORD);
    expect(e1).not.toBe(e2);
  });
});

describe("XRPL Wallet", () => {
  it("should generate a wallet with ed25519", () => {
    const wallet = generateXrplWallet("ed25519");
    expect(wallet.address).toMatch(/^r[1-9A-HJ-NP-Za-km-z]+$/);
    expect(wallet.secret).toBeTruthy();
    expect(wallet.algorithm).toBe("ed25519");
  });

  it("should generate a wallet with secp256k1", () => {
    const wallet = generateXrplWallet("secp256k1");
    expect(wallet.address).toMatch(/^r/);
    expect(wallet.algorithm).toBe("secp256k1");
  });

  it("should import wallet from secret", () => {
    const generated = generateXrplWallet();
    const imported = importXrplWalletFromSecret(generated.secret);
    expect(imported.address).toBe(generated.address);
  });

  it("should serialize and decrypt XRPL wallet", () => {
    const wallet = generateXrplWallet();
    const stored = serializeXrplWallet("test-xrpl", wallet, "mypass");
    expect(stored.name).toBe("test-xrpl");
    expect(stored.chain).toBe("xrpl");
    expect(stored.encrypted_secret).not.toBe(wallet.secret);

    const decrypted = decryptXrplSecret(stored, "mypass");
    expect(decrypted).toBe(wallet.secret);
  });

  it("should restore XRPL wallet from stored data", () => {
    const wallet = generateXrplWallet();
    const stored = serializeXrplWallet("test", wallet, "pass");
    const restored = restoreXrplWallet(stored, "pass");
    expect(restored.address).toBe(wallet.address);
  });
});

describe("EVM Wallet", () => {
  it("should generate a wallet", () => {
    const wallet = generateEvmWallet();
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("should import wallet from private key", () => {
    const generated = generateEvmWallet();
    const imported = importEvmWalletFromPrivateKey(generated.privateKey);
    expect(imported.address.toLowerCase()).toBe(generated.address.toLowerCase());
  });

  it("should handle private key without 0x prefix", () => {
    const generated = generateEvmWallet();
    const keyWithout0x = generated.privateKey.slice(2);
    const imported = importEvmWalletFromPrivateKey(keyWithout0x);
    expect(imported.address.toLowerCase()).toBe(generated.address.toLowerCase());
  });

  it("should serialize and decrypt EVM wallet", () => {
    const wallet = generateEvmWallet();
    const stored = serializeEvmWallet("test-evm", wallet, "mypass");
    expect(stored.name).toBe("test-evm");
    expect(stored.chain).toBe("ethereum");
    expect(stored.encrypted_private_key).not.toBe(wallet.privateKey);

    const decrypted = decryptEvmPrivateKey(stored, "mypass");
    expect(decrypted).toBe(wallet.privateKey);
  });

  it("should import wallet from mnemonic and derive correct address", () => {
    const mnemonic =
      "test test test test test test test test test test test junk";
    const imported = importEvmWalletFromMnemonic(mnemonic);
    expect(imported.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(imported.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(imported.address.toLowerCase()).toBe(
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".toLowerCase(),
    );
  });

  it("should reject invalid mnemonic", () => {
    expect(() => importEvmWalletFromMnemonic("invalid mnemonic words")).toThrow();
  });
});

describe("Wallet Manager", () => {
  beforeEach(() => {
    mkdirSync(TEST_HOME, { recursive: true });
    ensureConfigDir();
  });

  afterEach(() => {
    rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("should save and load an XRPL wallet", () => {
    const wallet = generateXrplWallet();
    const stored = serializeXrplWallet("my-xrpl", wallet, "pass");
    saveWallet(stored);

    const loaded = loadWallet("my-xrpl");
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe("my-xrpl");
    expect(loaded!.address).toBe(wallet.address);
  });

  it("should save and load an EVM wallet", () => {
    const wallet = generateEvmWallet();
    const stored = serializeEvmWallet("my-evm", wallet, "pass");
    saveWallet(stored);

    const loaded = loadWallet("my-evm");
    expect(loaded).not.toBeNull();
    expect(loaded!.address.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it("should return null for non-existent wallet", () => {
    expect(loadWallet("non-existent")).toBeNull();
  });

  it("should list all wallets", () => {
    saveWallet(serializeXrplWallet("w1", generateXrplWallet(), "p"));
    saveWallet(serializeEvmWallet("w2", generateEvmWallet(), "p"));
    const wallets = listWallets();
    expect(wallets).toHaveLength(2);
  });

  it("should delete a wallet", () => {
    saveWallet(serializeXrplWallet("to-delete", generateXrplWallet(), "p"));
    expect(deleteWallet("to-delete")).toBe(true);
    expect(loadWallet("to-delete")).toBeNull();
  });

  it("should return false when deleting non-existent wallet", () => {
    expect(deleteWallet("nope")).toBe(false);
  });

  it("should filter wallets by chain", () => {
    saveWallet(serializeXrplWallet("x1", generateXrplWallet(), "p"));
    saveWallet(serializeEvmWallet("e1", generateEvmWallet(), "p"));
    saveWallet(serializeEvmWallet("e2", generateEvmWallet(), "p", "base"));

    expect(listWalletsByChain("xrpl")).toHaveLength(1);
    expect(listWalletsByChain("ethereum")).toHaveLength(1);
    expect(listWalletsByChain("base")).toHaveLength(1);
  });

  it("should set and get default wallet", () => {
    const wallet = generateXrplWallet();
    const stored = serializeXrplWallet("default-w", wallet, "p");
    saveWallet(stored);
    setDefaultWallet("xrpl", "default-w");

    const defaultWallet = getDefaultWallet("xrpl");
    expect(defaultWallet).not.toBeNull();
    expect(defaultWallet!.name).toBe("default-w");
  });

  it("should fall back to first wallet if no default set", () => {
    saveWallet(serializeXrplWallet("first", generateXrplWallet(), "p"));
    const defaultWallet = getDefaultWallet("xrpl");
    expect(defaultWallet).not.toBeNull();
    expect(defaultWallet!.name).toBe("first");
  });

  it("should reject setting a missing wallet as default", () => {
    expect(() => setDefaultWallet("xrpl", "missing-wallet")).toThrow("does not exist");
  });

  it("should reject setting an XRPL wallet as default for an EVM chain", () => {
    saveWallet(serializeXrplWallet("xrpl-only", generateXrplWallet(), "p"));
    expect(() => setDefaultWallet("ethereum", "xrpl-only")).toThrow("cannot be used");
  });

  it("should reject setting an EVM wallet as default for XRPL", () => {
    saveWallet(serializeEvmWallet("evm-only", generateEvmWallet(), "p"));
    expect(() => setDefaultWallet("xrpl", "evm-only")).toThrow("cannot be used");
  });
});

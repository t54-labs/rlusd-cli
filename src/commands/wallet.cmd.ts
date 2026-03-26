import { Command } from "commander";
import {
  decryptXrplSecret,
  generateXrplWallet,
  importXrplWalletFromSecret,
  serializeXrplWallet,
} from "../wallet/xrpl-wallet.js";
import { generateEvmWallet, importEvmWalletFromPrivateKey, importEvmWalletFromMnemonic, serializeEvmWallet } from "../wallet/evm-wallet.js";
import { saveWallet, listWallets, getDefaultWallet, setDefaultWallet } from "../wallet/manager.js";
import { loadConfig, getWalletsDir } from "../config/config.js";
import { formatOutput } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import { resolveWalletPassword, getWalletPasswordEnvVarName } from "../utils/secrets.js";
import {
  deleteWalletPasswordFromKeychain,
  hasWalletPasswordInKeychain,
  storeWalletPasswordInKeychain,
  supportsSystemKeychain,
} from "../utils/keychain.js";
import type { ChainName, OutputFormat, EvmChainName } from "../types/index.js";

export function registerWalletCommand(program: Command): void {
  const walletCmd = program.command("wallet").description("Wallet generation, import, and management");

  function persistPasswordToKeychainIfRequested(
    walletName: string,
    password: string,
    requested: boolean,
  ): void {
    if (!requested) return;
    if (!supportsSystemKeychain()) {
      throw new Error(
        "System Keychain integration is currently supported on macOS only.",
      );
    }
    storeWalletPasswordInKeychain(walletName, password);
  }

  walletCmd
    .command("generate")
    .description("Generate a new wallet")
    .option("-c, --chain <chain>", "target chain: xrpl | ethereum")
    .option("--algorithm <algo>", "key algorithm for XRPL: ed25519 | secp256k1", "ed25519")
    .option("--name <name>", "wallet name")
    .option(
      "--password <password>",
      `encryption password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .option("--store-in-keychain", "store this wallet password in macOS Keychain")
    .action((opts) => {
      const chain = (opts.chain || program.opts().chain || "xrpl") as ChainName;
      const outputFormat = (program.opts().output as OutputFormat) || loadConfig().output_format;
      let password: string;
      try {
        password = resolveWalletPassword(opts.password);
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = 1;
        return;
      }

      if (chain === "xrpl") {
        const algo = opts.algorithm === "secp256k1" ? "secp256k1" : "ed25519";
        const wallet = generateXrplWallet(algo);
        const name = opts.name || `xrpl-${Date.now()}`;
        const stored = serializeXrplWallet(name, wallet, password);
        saveWallet(stored);
        setDefaultWallet("xrpl", name);
        persistPasswordToKeychainIfRequested(
          name,
          password,
          Boolean(opts.storeInKeychain),
        );

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput({ name, chain: "xrpl", address: wallet.address, algorithm: algo }, outputFormat));
        } else {
          logger.success("XRPL wallet generated");
          logger.label("Name", name);
          logger.label("Address", wallet.address);
          logger.label("Algorithm", algo);
          logger.label("Stored at", `${getWalletsDir()}/${name}.json`);
          if (opts.storeInKeychain) {
            logger.label("Keychain", "enabled");
          }
          logger.warn("Secret is encrypted and stored locally. Keep your password safe!");
        }
      } else {
        const wallet = generateEvmWallet();
        const name = opts.name || `evm-${Date.now()}`;
        const stored = serializeEvmWallet(name, wallet, password, chain as EvmChainName);
        saveWallet(stored);
        setDefaultWallet(chain, name);
        persistPasswordToKeychainIfRequested(
          name,
          password,
          Boolean(opts.storeInKeychain),
        );

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput({ name, chain, address: wallet.address }, outputFormat));
        } else {
          logger.success("EVM wallet generated");
          logger.label("Name", name);
          logger.label("Address", wallet.address);
          logger.label("Chain", chain);
          logger.label("Stored at", `${getWalletsDir()}/${name}.json`);
          if (opts.storeInKeychain) {
            logger.label("Keychain", "enabled");
          }
          logger.warn("Private key is encrypted and stored locally. Keep your password safe!");
        }
      }
    });

  walletCmd
    .command("import")
    .description("Import an existing wallet")
    .option("-c, --chain <chain>", "target chain: xrpl | ethereum")
    .option("--secret <secret>", "XRPL wallet secret/seed")
    .option("--private-key <key>", "EVM private key")
    .option("--mnemonic <phrase>", "BIP-39 mnemonic phrase")
    .option("--name <name>", "wallet name")
    .option(
      "--password <password>",
      `encryption password (or set ${getWalletPasswordEnvVarName()})`,
    )
    .option("--store-in-keychain", "store this wallet password in macOS Keychain")
    .action((opts) => {
      const chain = (opts.chain || program.opts().chain || "xrpl") as ChainName;
      let password: string;
      try {
        password = resolveWalletPassword(opts.password);
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = 1;
        return;
      }

      if (chain === "xrpl") {
        if (!opts.secret) {
          logger.error("--secret is required for XRPL wallet import");
          process.exitCode = 1;
          return;
        }
        try {
          const wallet = importXrplWalletFromSecret(opts.secret);
          const name = opts.name || `xrpl-imported-${Date.now()}`;
          const stored = serializeXrplWallet(name, wallet, password);
          saveWallet(stored);
          setDefaultWallet("xrpl", name);
          persistPasswordToKeychainIfRequested(
            name,
            password,
            Boolean(opts.storeInKeychain),
          );
          logger.success(`XRPL wallet imported: ${wallet.address}`);
          logger.label("Name", name);
          logger.label("Stored at", `${getWalletsDir()}/${name}.json`);
        } catch (err) {
          logger.error(`Failed to import XRPL wallet: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      } else {
        if (opts.mnemonic) {
          try {
            const wallet = importEvmWalletFromMnemonic(opts.mnemonic);
            const name = opts.name || `evm-imported-${Date.now()}`;
            const stored = serializeEvmWallet(name, wallet, password, chain as EvmChainName);
            saveWallet(stored);
            setDefaultWallet(chain, name);
            persistPasswordToKeychainIfRequested(
              name,
              password,
              Boolean(opts.storeInKeychain),
            );
            logger.success(`EVM wallet imported from mnemonic: ${wallet.address}`);
            logger.label("Name", name);
            logger.label("Stored at", `${getWalletsDir()}/${name}.json`);
          } catch (err) {
            logger.error(`Failed to import from mnemonic: ${(err as Error).message}`);
            process.exitCode = 1;
          }
        } else if (opts.privateKey) {
          try {
            const wallet = importEvmWalletFromPrivateKey(opts.privateKey);
            const name = opts.name || `evm-imported-${Date.now()}`;
            const stored = serializeEvmWallet(name, wallet, password, chain as EvmChainName);
            saveWallet(stored);
            setDefaultWallet(chain, name);
            persistPasswordToKeychainIfRequested(
              name,
              password,
              Boolean(opts.storeInKeychain),
            );
            logger.success(`EVM wallet imported: ${wallet.address}`);
            logger.label("Name", name);
            logger.label("Stored at", `${getWalletsDir()}/${name}.json`);
          } catch (err) {
            logger.error(`Failed to import EVM wallet: ${(err as Error).message}`);
            process.exitCode = 1;
          }
        } else {
          logger.error("--private-key or --mnemonic is required for EVM wallet import");
          process.exitCode = 1;
        }
      }
    });

  walletCmd
    .command("list")
    .description("List all stored wallets")
    .action(() => {
      const wallets = listWallets();
      const outputFormat = (program.opts().output as OutputFormat) || loadConfig().output_format;

      if (wallets.length === 0) {
        logger.info("No wallets found. Use 'rlusd wallet generate' to create one.");
        return;
      }

      const rows = wallets.map((w) => ({
        name: w.name,
        chain: w.chain,
        address: w.address,
        created: w.created_at,
      }));

      logger.raw(formatOutput(rows, outputFormat, ["name", "chain", "address", "created"]));
    });

  walletCmd
    .command("address")
    .description("Show current wallet address")
    .option("-c, --chain <chain>", "chain to show address for")
    .action((opts) => {
      const chain = (opts.chain || program.opts().chain || loadConfig().default_chain) as ChainName;
      const wallet = getDefaultWallet(chain);

      if (!wallet) {
        logger.error(`No wallet configured for ${chain}. Use 'rlusd wallet generate --chain ${chain}'`);
        process.exitCode = 1;
        return;
      }

      const outputFormat = (program.opts().output as OutputFormat) || loadConfig().output_format;
      if (outputFormat === "json" || outputFormat === "json-compact") {
        logger.raw(formatOutput({ chain, name: wallet.name, address: wallet.address }, outputFormat));
      } else {
        logger.label("Chain", chain);
        logger.label("Wallet", wallet.name);
        logger.label("Address", wallet.address);
      }
    });

  walletCmd
    .command("export-seed")
    .description("Export the XRPL wallet seed for importing into third-party wallets")
    .option("--wallet <name>", "wallet name to export (defaults to current XRPL wallet)")
    .option(
      "--password <password>",
      `wallet password (or set ${getWalletPasswordEnvVarName()}, or use Keychain if enabled)`,
    )
    .action((opts) => {
      try {
        const wallet =
          (opts.wallet ? listWallets().find((entry) => entry.name === opts.wallet) : null) ||
          getDefaultWallet("xrpl");

        if (!wallet) {
          logger.error("No XRPL wallet found. Provide --wallet or create one first.");
          process.exitCode = 1;
          return;
        }

        if (wallet.chain !== "xrpl") {
          logger.error(
            `Wallet '${wallet.name}' is configured for ${wallet.chain}, not xrpl.`,
          );
          process.exitCode = 1;
          return;
        }

        const password = resolveWalletPassword(opts.password, {
          walletName: wallet.name,
        });
        const seed = decryptXrplSecret(wallet, password);
        const outputFormat =
          (program.opts().output as OutputFormat) || loadConfig().output_format;

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(
            formatOutput(
              {
                wallet: wallet.name,
                chain: "xrpl",
                address: wallet.address,
                seed,
              },
              outputFormat,
            ),
          );
        } else {
          logger.warn(
            "This seed grants full control of the XRPL wallet. Store it securely and avoid sharing screenshots.",
          );
          logger.label("Wallet", wallet.name);
          logger.label("Address", wallet.address);
          logger.label("Seed", seed);
        }
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  walletCmd
    .command("use <name>")
    .description("Set the default wallet")
    .option("-c, --chain <chain>", "chain to set default for")
    .action((name, opts) => {
      const chain = (opts.chain || program.opts().chain || loadConfig().default_chain) as ChainName;
      try {
        setDefaultWallet(chain, name);
        logger.success(`Default wallet for ${chain} set to ${name}`);
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  const keychainCmd = walletCmd
    .command("keychain")
    .description("Manage wallet password storage in the macOS Keychain");

  keychainCmd
    .command("enable <name>")
    .description("Store an existing wallet password in the system Keychain")
    .option(
      "--password <password>",
      `wallet password to store (or set ${getWalletPasswordEnvVarName()})`,
    )
    .action((name, opts) => {
      if (!supportsSystemKeychain()) {
        logger.error("System Keychain integration is currently supported on macOS only.");
        process.exitCode = 1;
        return;
      }
      try {
        if (!listWallets().some((wallet) => wallet.name === name)) {
          throw new Error(`Wallet '${name}' does not exist.`);
        }
        const password = resolveWalletPassword(opts.password);
        storeWalletPasswordInKeychain(name, password);
        logger.success(`Stored password for wallet '${name}' in macOS Keychain`);
      } catch (err) {
        logger.error((err as Error).message);
        process.exitCode = 1;
      }
    });

  keychainCmd
    .command("disable <name>")
    .description("Remove a wallet password from the system Keychain")
    .action((name) => {
      if (!supportsSystemKeychain()) {
        logger.error("System Keychain integration is currently supported on macOS only.");
        process.exitCode = 1;
        return;
      }
      const removed = deleteWalletPasswordFromKeychain(name);
      if (removed) {
        logger.success(`Removed Keychain entry for wallet '${name}'`);
      } else {
        logger.error(`No Keychain entry found for wallet '${name}'`);
        process.exitCode = 1;
      }
    });

  keychainCmd
    .command("status [name]")
    .description("Check whether a wallet password is stored in the macOS Keychain")
    .option("-c, --chain <chain>", "chain to use when name is omitted")
    .action((name, opts) => {
      if (!supportsSystemKeychain()) {
        logger.error("System Keychain integration is currently supported on macOS only.");
        process.exitCode = 1;
        return;
      }
      const walletName =
        name ||
        getDefaultWallet(
          (opts.chain || program.opts().chain || loadConfig().default_chain) as ChainName,
        )?.name;
      if (!walletName) {
        logger.error("No wallet name provided and no default wallet found.");
        process.exitCode = 1;
        return;
      }
      logger.label(
        "Keychain",
        hasWalletPasswordInKeychain(walletName) ? "enabled" : "disabled",
      );
      logger.label("Wallet", walletName);
    });
}

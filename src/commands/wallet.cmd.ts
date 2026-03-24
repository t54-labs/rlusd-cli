import { Command } from "commander";
import { generateXrplWallet, importXrplWalletFromSecret, serializeXrplWallet } from "../wallet/xrpl-wallet.js";
import { generateEvmWallet, importEvmWalletFromPrivateKey, importEvmWalletFromMnemonic, serializeEvmWallet } from "../wallet/evm-wallet.js";
import { saveWallet, listWallets, getDefaultWallet, setDefaultWallet } from "../wallet/manager.js";
import { loadConfig } from "../config/config.js";
import { formatOutput } from "../utils/format.js";
import { logger } from "../utils/logger.js";
import type { ChainName, OutputFormat, EvmChainName } from "../types/index.js";

export function registerWalletCommand(program: Command): void {
  const walletCmd = program.command("wallet").description("Wallet generation, import, and management");

  walletCmd
    .command("generate")
    .description("Generate a new wallet")
    .option("-c, --chain <chain>", "target chain: xrpl | ethereum")
    .option("--algorithm <algo>", "key algorithm for XRPL: ed25519 | secp256k1", "ed25519")
    .option("--name <name>", "wallet name")
    .option("--password <password>", "encryption password (will prompt if not provided)")
    .action((opts) => {
      const chain = (opts.chain || program.opts().chain || "xrpl") as ChainName;
      const password = opts.password || "default-dev-password";
      const outputFormat = (program.opts().output as OutputFormat) || loadConfig().output_format;

      if (chain === "xrpl") {
        const algo = opts.algorithm === "secp256k1" ? "secp256k1" : "ed25519";
        const wallet = generateXrplWallet(algo);
        const name = opts.name || `xrpl-${Date.now()}`;
        const stored = serializeXrplWallet(name, wallet, password);
        saveWallet(stored);
        setDefaultWallet("xrpl", name);

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput({ name, chain: "xrpl", address: wallet.address, algorithm: algo }, outputFormat));
        } else {
          logger.success("XRPL wallet generated");
          logger.label("Name", name);
          logger.label("Address", wallet.address);
          logger.label("Algorithm", algo);
          logger.warn("Secret is encrypted and stored locally. Keep your password safe!");
        }
      } else {
        const wallet = generateEvmWallet();
        const name = opts.name || `evm-${Date.now()}`;
        const stored = serializeEvmWallet(name, wallet, password, chain as EvmChainName);
        saveWallet(stored);
        setDefaultWallet(chain, name);

        if (outputFormat === "json" || outputFormat === "json-compact") {
          logger.raw(formatOutput({ name, chain, address: wallet.address }, outputFormat));
        } else {
          logger.success("EVM wallet generated");
          logger.label("Name", name);
          logger.label("Address", wallet.address);
          logger.label("Chain", chain);
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
    .option("--password <password>", "encryption password")
    .action((opts) => {
      const chain = (opts.chain || program.opts().chain || "xrpl") as ChainName;
      const password = opts.password || "default-dev-password";

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
          logger.success(`XRPL wallet imported: ${wallet.address}`);
          logger.label("Name", name);
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
            logger.success(`EVM wallet imported from mnemonic: ${wallet.address}`);
            logger.label("Name", name);
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
            logger.success(`EVM wallet imported: ${wallet.address}`);
            logger.label("Name", name);
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
    .command("use <name>")
    .description("Set the default wallet")
    .option("-c, --chain <chain>", "chain to set default for")
    .action((name, opts) => {
      const chain = (opts.chain || program.opts().chain || loadConfig().default_chain) as ChainName;
      setDefaultWallet(chain, name);
      logger.success(`Default wallet for ${chain} set to ${name}`);
    });
}

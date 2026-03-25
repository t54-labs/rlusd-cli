# RLUSD CLI

[![CI](https://github.com/t54-labs/rlusd-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/t54-labs/rlusd-cli/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@rlusd/cli.svg)](https://www.npmjs.com/package/@rlusd/cli)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](docs/CONTRIBUTING.md)

A command-line interface for **Ripple USD (RLUSD)** operations across **XRP Ledger** and **Ethereum**, with planned support for additional Ethereum L2 networks.

## Features

- **Multi-chain balance** — View RLUSD holdings across all supported chains in one command
- **Unified transfers** — Send RLUSD on XRPL or Ethereum with a single `send` command
- **DEX trading on both chains** — XRPL native DEX order book + Uniswap V3 swaps on Ethereum
- **AMM liquidity** — Deposit, withdraw, and vote on XRPL AMM pools
- **Aave lending** — Supply/borrow RLUSD on Aave V3
- **Bridge-ready workflow** — Includes a professional Wormhole NTT bridge stub with clear status and limitations
- **Price oracle** — Real-time RLUSD pricing from Chainlink and XRPL DEX
- **Script-friendly** — JSON output mode for automation and CI/CD pipelines
- **Secure key storage** — AES-256-GCM encrypted wallet files with PBKDF2 key derivation

## Supported Chains

| Chain | Status | Type |
|-------|--------|------|
| XRP Ledger | Live | L1 |
| Ethereum | Live | L1 |
| Base | Planned | L2 |
| Optimism | Planned | L2 |
| Ink | Planned | L2 |
| Unichain | Planned | L2 |

## Installation

### npm (recommended)

```bash
npm install -g @rlusd/cli
```

### One-line installer

```bash
curl -sSfL https://raw.githubusercontent.com/t54-labs/rlusd-cli/main/scripts/install.sh | bash
```

### From source

```bash
git clone https://github.com/t54-labs/rlusd-cli.git
cd rlusd-cli
npm install
npm run build
npm link
```

## Quick Start

```bash
# 1. Switch to testnet
rlusd config set --network testnet

# 2. Generate wallets for both chains
export RLUSD_WALLET_PASSWORD=mypassword
rlusd wallet generate --chain xrpl --name my-xrpl
rlusd wallet generate --chain ethereum --name my-eth

# 3. Fund your XRPL wallet from the testnet faucet
rlusd faucet fund --chain xrpl

# 4. Set up RLUSD trust line on XRPL (required before receiving RLUSD)
rlusd xrpl trustline setup

# 5. Check balances across all chains
rlusd balance --all

# 6. Send RLUSD to someone
rlusd send --to rDestination... --amount 100

# 7. Check RLUSD price
rlusd price
```

---

## Command Reference

### Global Options

Every command supports these flags:

| Flag | Description | Default |
|------|-------------|---------|
| `--chain <chain>` | Target chain: `xrpl`, `ethereum`, `base`, `optimism`, `ink`, `unichain` | Per-command or from config |
| `--output <format>` | Output format: `table`, `json`, `json-compact` | `table` |
| `--network <network>` | Runtime-only network override for the current command (`mainnet`, `testnet`, `devnet`) | From config |
| `--verbose` | Enable debug output for the current command | off |
| `--version` | Print version | — |
| `--help` | Print help | — |

> **Security note**: for commands that require wallet decryption, prefer setting `RLUSD_WALLET_PASSWORD` instead of passing `--password` directly on the command line.

---

### `rlusd config` — Configuration Management

Manages the CLI configuration stored at `~/.config/rlusd-cli/config.yml`.

#### `rlusd config get`

Display all current settings: environment, default chain, RPC endpoints, RLUSD contract addresses.

```bash
rlusd config get                    # human-readable table
rlusd config get --output json      # machine-readable JSON
```

#### `rlusd config set`

Update one or more settings. Changes are persisted immediately.

```bash
# Switch between mainnet / testnet / devnet (updates all chain endpoints)
rlusd config set --network mainnet
rlusd config set --network testnet
rlusd config set --network devnet

# Set a custom RPC endpoint for a specific chain
rlusd config set --chain ethereum --rpc https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
rlusd config set --chain xrpl --rpc wss://xrplcluster.com/

# Change the default chain for commands that don't specify --chain
rlusd config set --default-chain ethereum

# Change default output format
rlusd config set --format json
```

#### `rlusd config set` — Price API

Configure the price feed provider. The default is the free CoinGecko API; paid users can point to CoinGecko Pro or a custom endpoint.

```bash
# Use CoinGecko Pro (paid)
rlusd config set --price-url https://pro-api.coingecko.com/api/v3 --price-api-key YOUR_KEY

# Reset to free CoinGecko
rlusd config set --price-url https://api.coingecko.com/api/v3
```

#### `rlusd config set` — DeFi Contract Addresses

Override Uniswap V3 and Aave V3 contract addresses per chain. Useful for L2 deployments or custom routers.

```bash
# Uniswap V3 SwapRouter (requires --chain)
rlusd config set --chain base --uniswap-router 0x2626664c2603336E57B271c5C0b26F421741e481

# Uniswap V3 QuoterV2 (requires --chain)
rlusd config set --chain base --uniswap-quoter 0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a

# Aave V3 Pool (requires --chain)
rlusd config set --chain ethereum --aave-pool 0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2
```

#### `rlusd config set` — Faucet URL

Point to a custom XRPL faucet (e.g. a self-hosted one for private testnets).

```bash
rlusd config set --network testnet --faucet-url https://my-faucet.example.com/accounts
```

---

### `rlusd wallet` — Wallet Management

Manages encrypted wallet files stored at `~/.config/rlusd-cli/wallets/`.

#### `rlusd wallet generate`

Create a new wallet with a random keypair.

```bash
# Generate an XRPL wallet (ed25519 by default)
rlusd wallet generate --chain xrpl --name my-xrpl --password s3cret

# Generate with secp256k1 algorithm
rlusd wallet generate --chain xrpl --algorithm secp256k1 --name my-xrpl-secp

# Generate an Ethereum wallet (works for all EVM chains)
rlusd wallet generate --chain ethereum --name my-eth --password s3cret
```

#### `rlusd wallet import`

Import an existing wallet from a secret, private key, or mnemonic.

```bash
# Import XRPL wallet from seed/secret
rlusd wallet import --chain xrpl --secret sEdXXXXXXXX --name imported-xrpl --password s3cret

# Import EVM wallet from private key
rlusd wallet import --chain ethereum --private-key 0xabcdef... --name imported-eth --password s3cret

# Import EVM wallet from BIP-39 mnemonic
rlusd wallet import --chain ethereum --mnemonic "word1 word2 word3 ..." --name mnemonic-eth --password s3cret
```

#### `rlusd wallet list`

Show all stored wallets with their chain, address, and creation date.

```bash
rlusd wallet list
rlusd wallet list --output json
```

#### `rlusd wallet address`

Print the address of the currently active wallet for a chain.

```bash
rlusd wallet address                  # default chain
rlusd wallet address --chain ethereum # specific chain
```

#### `rlusd wallet use <name>`

Switch the default wallet for a chain.

```bash
rlusd wallet use my-xrpl --chain xrpl
rlusd wallet use my-eth --chain ethereum
```

---

### `rlusd balance` — Balance Queries

#### `rlusd balance`

Query RLUSD balance for the current wallet on one chain.

```bash
rlusd balance                           # default chain
rlusd balance --chain ethereum          # specific chain
rlusd balance --chain xrpl --output json
rlusd balance --address rSomeAddress... # query any address
```

#### `rlusd balance --all`

Aggregated view across **all** configured chains in a single table.

```bash
rlusd balance --all
# ┌───────────┬────────────────┬──────────────┬────────────────┐
# │ chain     │ address        │ rlusd        │ native         │
# ├───────────┼────────────────┼──────────────┼────────────────┤
# │ xrpl      │ rAbc...xyz     │ 1,500.00     │ 245.3 XRP      │
# │ ethereum  │ 0xAbc...789    │ 3,200.50     │ 0.15 ETH       │
# ├───────────┼────────────────┼──────────────┼────────────────┤
# │ Total RLUSD: 4,700.50                                      │
# └────────────────────────────────────────────────────────────┘
```

#### `rlusd gas-balance`

Show native token balances (XRP, ETH) needed for paying transaction fees.

```bash
rlusd gas-balance
```

---

### `rlusd send` — Transfer RLUSD

Send RLUSD to a recipient on any supported chain. Automatically detects the target chain from the address format (`r...` → XRPL, `0x...` → Ethereum).

```bash
# Send on XRPL (auto-detected from r-address)
rlusd send --to rRecipient... --amount 100 --password s3cret

# Send on XRPL with destination tag and memo
rlusd send --to rRecipient... --amount 50 --tag 12345 --memo "invoice #42" --password s3cret

# Send on Ethereum (auto-detected from 0x-address)
rlusd send --to 0xRecipient... --amount 200 --password s3cret

# Explicit chain selection
rlusd send --chain base --to 0xRecipient... --amount 100 --password s3cret

# Preview without submitting
rlusd send --to rRecipient... --amount 100 --password s3cret --dry-run
```

| Option | Description |
|--------|-------------|
| `--to <address>` | **(required)** Recipient address |
| `--amount <n>` | **(required)** RLUSD amount to send |
| `--chain <chain>` | Override chain auto-detection |
| `--tag <n>` | XRPL destination tag (integer) |
| `--memo <text>` | Transaction memo text |
| `--password <pwd>` | Wallet decryption password |
| `--dry-run` | Preview the transaction without submitting |

---

### `rlusd xrpl trustline` — XRPL Trust Line Management

XRPL requires a trust line to the RLUSD issuer before your account can hold RLUSD.

#### `rlusd xrpl trustline setup`

Create or update the RLUSD trust line. This is a **one-time operation** per account.

```bash
rlusd xrpl trustline setup --password s3cret
rlusd xrpl trustline setup --limit 500000 --password s3cret   # custom limit
```

#### `rlusd xrpl trustline status`

Check if the RLUSD trust line exists and show its current balance, limit, and freeze status.

```bash
rlusd xrpl trustline status
rlusd xrpl trustline status --address rSomeAddress...
```

#### `rlusd xrpl trustline remove`

Remove the trust line (only works if RLUSD balance is zero).

```bash
rlusd xrpl trustline remove --password s3cret
```

---

### `rlusd xrpl dex` — XRPL Native DEX Trading

Trade RLUSD on the XRP Ledger's built-in decentralized exchange (order book model).

#### `rlusd xrpl dex buy`

Place a limit order to **buy RLUSD with XRP**.

```bash
# Buy 100 RLUSD, willing to pay up to 2.5 XRP per RLUSD
rlusd xrpl dex buy --amount 100 --price 2.5 --password s3cret
```

#### `rlusd xrpl dex sell`

Place a limit order to **sell RLUSD for XRP**.

```bash
# Sell 50 RLUSD, asking 2.6 XRP per RLUSD
rlusd xrpl dex sell --amount 50 --price 2.6 --password s3cret
```

#### `rlusd xrpl dex cancel`

Cancel an open order by its sequence number.

```bash
rlusd xrpl dex cancel --sequence 12345 --password s3cret
```

#### `rlusd xrpl dex orderbook`

Display the live XRP/RLUSD order book (both bid and ask sides, top 15 offers each).

```bash
rlusd xrpl dex orderbook
rlusd xrpl dex orderbook --output json
```

---

### `rlusd xrpl amm` — XRPL AMM Liquidity Pool

Interact with the XRP/RLUSD Automated Market Maker pool on XRPL.

#### `rlusd xrpl amm info`

Show pool state: reserves, trading fee, LP token supply, vote slots.

```bash
rlusd xrpl amm info
rlusd xrpl amm info --output json
```

#### `rlusd xrpl amm deposit`

Add two-asset liquidity to the pool. You receive LP tokens in return.

```bash
rlusd xrpl amm deposit --xrp 100 --rlusd 150 --password s3cret
```

#### `rlusd xrpl amm withdraw`

Redeem LP tokens to withdraw assets from the pool.

```bash
rlusd xrpl amm withdraw --lp-tokens 50 --password s3cret
```

#### `rlusd xrpl amm vote`

Vote on the pool's trading fee (in units of 1/100,000; max 1000 = 1%).

```bash
rlusd xrpl amm vote --fee 300 --password s3cret   # vote for 0.3%
```

#### `rlusd xrpl amm swap`

Swap XRP → RLUSD through the AMM (single-asset deposit).

```bash
rlusd xrpl amm swap --sell-xrp 10 --password s3cret
```

---

### `rlusd xrpl pathfind` — Cross-Currency Path Finding

Find the best payment paths to deliver RLUSD to a destination, potentially converting from other currencies.

```bash
rlusd xrpl pathfind --to rDestination... --amount 100 --password s3cret
rlusd xrpl pathfind --to rDestination... --amount 100 --password s3cret --output json
```

---

### `rlusd eth approve` — ERC-20 Approval Management

Manage third-party spending permissions for your RLUSD on Ethereum/EVM chains.

#### `rlusd eth approve`

Grant a contract (e.g., Aave Pool, Uniswap Router) permission to spend your RLUSD.

```bash
rlusd eth approve --spender 0xContractAddr... --amount 1000 --password s3cret
```

#### `rlusd eth allowance`

Check how much RLUSD a spender is currently approved to use.

```bash
rlusd eth allowance --spender 0xContractAddr...
```

#### `rlusd eth revoke`

Revoke a spender's approval (sets allowance to 0).

```bash
rlusd eth revoke --spender 0xContractAddr... --password s3cret
```

---

### `rlusd eth swap` — Uniswap V3 Token Swaps

Swap RLUSD for other tokens (or buy RLUSD with other tokens) via Uniswap V3 on **Ethereum**.

> **Current scope**: RLUSD swap is intentionally limited to `--chain ethereum` until verified RLUSD, oracle, and router addresses are available for additional EVM chains.

**Supported tokens**: `WETH`, `USDC`, `USDT`, `DAI`, `WBTC`, `RLUSD`.

#### `rlusd eth swap sell`

Sell RLUSD for another token.

```bash
# Sell 500 RLUSD for USDC
export RLUSD_WALLET_PASSWORD=s3cret
rlusd eth swap sell --amount 500 --for USDC

# Sell with custom slippage and fee tier
rlusd eth swap sell --amount 100 --for WETH --slippage 100 --fee-tier 3000

# Preview without executing
rlusd eth swap sell --amount 500 --for USDC --dry-run
```

| Option | Description | Default |
|--------|-------------|---------|
| `--amount <n>` | **(required)** RLUSD amount to sell | — |
| `--for <token>` | **(required)** Token to receive (`USDC`, `USDT`, `WETH`, `DAI`, `WBTC`) | — |
| `--slippage <bps>` | Max slippage in basis points | `50` (0.5%) |
| `--fee-tier <fee>` | Uniswap pool fee: `100`, `500`, `3000`, `10000` | `3000` (0.3%) |
| `--password <pwd>` | Wallet decryption password (prefer `RLUSD_WALLET_PASSWORD`) | — |
| `--dry-run` | Preview without submitting | off |

The CLI now applies real quote-based protections:
- `sell` computes `amountOutMinimum` from the Uniswap Quoter and your `--slippage`
- `buy` computes `amountInMaximum` from the Uniswap Quoter and your `--slippage`

#### `rlusd eth swap buy`

Buy RLUSD with another token.

```bash
# Buy 1000 RLUSD, paying with USDC
rlusd eth swap buy --amount 1000 --with USDC

# Buy RLUSD with WETH
rlusd eth swap buy --amount 500 --with WETH
```

#### `rlusd eth swap quote`

Get a price quote without executing a transaction.

```bash
rlusd eth swap quote --amount 500 --for USDC
rlusd eth swap quote --amount 1000 --for WETH --fee-tier 500
```

#### `rlusd eth swap tokens`

List all well-known tokens with their contract addresses.

```bash
rlusd eth swap tokens
```

---

### `rlusd eth defi aave` — Aave V3 Lending & Borrowing

Supply RLUSD to Aave V3 to earn interest, or borrow against your collateral.

#### `rlusd eth defi aave supply`

Deposit RLUSD into Aave to earn supply APR.

```bash
rlusd eth defi aave supply --amount 1000 --password s3cret
```

#### `rlusd eth defi aave withdraw`

Withdraw your supplied RLUSD from Aave.

```bash
rlusd eth defi aave withdraw --amount 500 --password s3cret
rlusd eth defi aave withdraw --max --password s3cret    # withdraw everything
```

#### `rlusd eth defi aave borrow`

Borrow RLUSD against your Aave collateral (variable rate).

```bash
rlusd eth defi aave borrow --amount 200 --password s3cret
```

#### `rlusd eth defi aave repay`

Repay borrowed RLUSD.

```bash
rlusd eth defi aave repay --amount 200 --password s3cret
rlusd eth defi aave repay --max --password s3cret       # repay full debt
```

#### `rlusd eth defi aave status`

Show your Aave position: total collateral, debt, available borrows, health factor.

```bash
rlusd eth defi aave status
rlusd eth defi aave status --output json
```

---

### `rlusd price` — RLUSD Price Oracle

Query RLUSD price from multiple sources. The `--source` is **auto-detected** from your default chain: XRPL defaults to `dex`, EVM chains default to `chainlink`. You can override with `--source`.

```bash
# Auto-detect: uses DEX when default chain is xrpl, Chainlink when ethereum
rlusd price

# Chainlink oracle on Ethereum (RLUSD/USD)
rlusd price --source chainlink

# XRPL DEX order book (shows XRP/RLUSD + estimated RLUSD/USD via CoinGecko)
rlusd price --source dex

# JSON output
rlusd price --output json
```

- `--source chainlink` reads the Chainlink RLUSD/USD oracle on Ethereum. A stale-data warning is shown if the feed hasn't updated in over 1 hour; queries are rejected after 24 hours.
- `--source dex` reads the XRPL order book and fetches XRP/USD from CoinGecko (configurable via `config set --price-url`) to estimate a USD price.
- The price API provider can be customized — see [`rlusd config set` — Price API](#rlusd-config-set--price-api).

---

### `rlusd market` — Market Overview

Aggregated market snapshot combining Chainlink price and XRPL DEX data.

```bash
rlusd market
rlusd market --output json
```

---

### `rlusd tx` — Transaction Queries

#### `rlusd tx status <hash>`

Look up a transaction by hash on any chain.

```bash
rlusd tx status ABC123... --chain xrpl
rlusd tx status 0xabc123... --chain ethereum
```

#### `rlusd tx history`

Show recent RLUSD transactions for the current wallet. For EVM chains, RLUSD history is currently supported on **Ethereum** only.

```bash
rlusd tx history                          # default chain, last 20
rlusd tx history --chain ethereum --limit 50
rlusd tx history --output json
```

---

### `rlusd faucet fund` — Testnet Faucet

Request test tokens (testnet and devnet only).

```bash
# Get test XRP on XRPL testnet
rlusd faucet fund --chain xrpl

# Displays faucet URLs for Ethereum Sepolia
rlusd faucet fund --chain ethereum
```

---

### `rlusd bridge` — Cross-Chain Bridge (Wormhole NTT)

Bridge support is currently a **safe stub** that explains the present state of RLUSD bridging.

> **Current status**:
> - Wormhole NTT for RLUSD is still in testing
> - XRPL ↔ EVM bridging is **not supported** by Wormhole NTT
> - L2 RLUSD contract addresses are not yet wired into this CLI
>
> The command is intentionally non-destructive until production-ready deployments are available.

```bash
rlusd bridge --from ethereum --to base --amount 500
rlusd bridge estimate --from ethereum --to optimism --amount 1000
rlusd bridge status <transfer-id>
rlusd bridge history
```

---

### `rlusd completion` — Shell Auto-Completion

Generate completion scripts for your shell.

```bash
# Bash (add to ~/.bashrc)
rlusd completion --shell bash >> ~/.bashrc

# Zsh (add to ~/.zshrc)
rlusd completion --shell zsh >> ~/.zshrc

# Fish
rlusd completion --shell fish > ~/.config/fish/completions/rlusd.fish
```

---

## Documentation

- [Framework & Architecture](docs/FRAMEWORK.md) — Detailed technical design, third-party integration APIs, contract addresses
- [Contributing](docs/CONTRIBUTING.md) — Development setup, testing guide, commit conventions

## Development

```bash
npm install          # install dependencies
npm run dev -- --help # run in dev mode
npm test             # run all tests (142+)
npm run typecheck    # TypeScript type checking
npm run lint         # ESLint
npm run build        # production build
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js ≥ 20, TypeScript (ESM) |
| XRPL | [xrpl.js](https://github.com/XRPLF/xrpl.js) v4.x |
| Ethereum | [viem](https://viem.sh/) v2.x |
| DEX (EVM) | Uniswap V3 SwapRouter02 |
| Lending | Aave V3 Pool (raw contract calls) |
| Cross-chain | Wormhole NTT bridge workflow (currently documented stub / planned integration) |
| Price | Chainlink AggregatorV3 |
| CLI | [Commander.js](https://github.com/tj/commander.js) v13.x |
| Testing | Vitest |

## License

MIT

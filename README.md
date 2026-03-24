# RLUSD CLI

A multi-chain command-line interface for **Ripple USD (RLUSD)** stablecoin operations across **XRP Ledger**, **Ethereum**, and **Ethereum L2 networks**.

## Features

- **Multi-chain balance** — View RLUSD holdings across all supported chains in one command
- **Unified transfers** — Send RLUSD on XRPL or Ethereum with a single `send` command
- **Cross-chain bridging** — Transfer RLUSD between Ethereum and L2s via Wormhole NTT
- **XRPL DeFi** — Trade on the XRPL DEX, provide AMM liquidity, manage trust lines
- **Ethereum DeFi** — Supply/borrow RLUSD on Aave, manage ERC-20 approvals
- **Price oracle** — Real-time RLUSD pricing from Chainlink
- **Script-friendly** — JSON output mode for automation and CI/CD pipelines
- **Secure key storage** — AES-256-GCM encrypted wallet files

## Supported Chains

| Chain | Status | Type |
|-------|--------|------|
| XRP Ledger | Live | L1 |
| Ethereum | Live | L1 |
| Base | Coming Soon | L2 |
| Optimism | Coming Soon | L2 |
| Ink | Coming Soon | L2 |
| Unichain | Coming Soon | L2 |

## Installation

### npm (recommended)

```bash
npm install -g @rlusd/cli
```

### From source

```bash
git clone https://github.com/xxx/rlusd-cli.git
cd rlusd-cli
npm install
npm run build
npm link
```

## Quick Start

```bash
# Configure the network
rlusd config set --network testnet

# Generate wallets
rlusd wallet generate --chain xrpl
rlusd wallet generate --chain ethereum

# Get test funds
rlusd faucet fund --chain xrpl

# Check balances across all chains
rlusd balance --all

# Send RLUSD
rlusd send --chain xrpl --to rDestination... --amount 100

# View RLUSD price
rlusd price
```

## Command Overview

| Command Group | Description |
|--------------|-------------|
| `rlusd config` | Configuration management |
| `rlusd wallet` | Wallet generation, import, and management |
| `rlusd balance` | Multi-chain RLUSD balance queries |
| `rlusd send` | Send RLUSD on any supported chain |
| `rlusd bridge` | Cross-chain RLUSD transfers (Wormhole NTT) |
| `rlusd price` | RLUSD price from oracles and DEXs |
| `rlusd market` | Aggregated market data |
| `rlusd tx` | Transaction status and history |
| `rlusd faucet` | Testnet faucet operations |
| `rlusd xrpl` | XRPL-specific: trust lines, DEX, AMM |
| `rlusd eth` | Ethereum-specific: approvals, Aave DeFi |

Run `rlusd --help` or `rlusd <command> --help` for detailed usage.

## Documentation

- [Framework & Architecture](docs/FRAMEWORK.md) — Detailed technical design, third-party integrations, and API references
- [Contributing](docs/CONTRIBUTING.md) — How to contribute to the project

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- --help

# Run tests
npm test

# Type checking
npm run typecheck

# Lint
npm run lint

# Build
npm run build
```

## Tech Stack

- **Runtime**: Node.js ≥ 20, TypeScript
- **XRPL SDK**: [xrpl.js](https://github.com/XRPLF/xrpl.js) v4.x
- **EVM SDK**: [viem](https://viem.sh/) v2.x
- **Cross-chain**: [Wormhole SDK](https://github.com/wormhole-foundation/wormhole-sdk-ts)
- **DeFi**: [@aave/client](https://aave.com/docs/developers/aave-v3/getting-started/typescript)
- **CLI Framework**: [Commander.js](https://github.com/tj/commander.js) v13.x

## License

MIT

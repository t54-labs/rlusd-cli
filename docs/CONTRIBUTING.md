# Contributing to RLUSD CLI

Thank you for your interest in contributing to RLUSD CLI! This guide will help you get started.

## Prerequisites

- [Node.js](https://nodejs.org/) v20 or later (v22 recommended)
- [npm](https://www.npmjs.com/) v9 or later
- [Git](https://git-scm.com/)

## Getting Started

1. Fork and clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/rlusd-cli.git
cd rlusd-cli
```

2. Install dependencies:

```bash
npm install
```

3. Run the test suite to verify your setup:

```bash
npm test
```

## Project Structure

```
rlusd-cli/
├── bin/                   # CLI entry point
├── src/
│   ├── config/            # Configuration management and network presets
│   ├── clients/           # Chain client wrappers (XRPL, EVM, Wormhole, Aave)
│   ├── wallet/            # Wallet generation, import, and encrypted storage
│   ├── commands/          # CLI command implementations
│   │   ├── xrpl/          # XRPL-specific commands (trust lines, DEX, AMM)
│   │   └── eth/           # Ethereum-specific commands (approvals, Aave)
│   ├── services/          # Business logic (price oracle, market data)
│   ├── abi/               # Smart contract ABIs
│   ├── utils/             # Shared utilities (formatting, logging, address detection)
│   └── types/             # TypeScript type definitions
├── test/
│   ├── unit/              # Unit tests (no network calls)
│   ├── integration/       # Integration tests (testnet)
│   └── e2e/               # End-to-end CLI tests
├── docs/                  # Documentation
└── scripts/               # Build and install scripts
```

## Development Workflow

### Running in Development Mode

```bash
npm run dev -- <command> [options]

# Examples:
npm run dev -- config get
npm run dev -- balance --chain xrpl
```

### Code Style

- All code and comments must be in **English**
- Follow the existing code patterns and naming conventions
- Use TypeScript strict mode — all types must be explicit
- Run `npm run lint` before committing

### Testing

Every feature must include tests:

- **Unit tests** in `test/unit/` — test individual functions, no network calls
- **Integration tests** in `test/integration/` — test against testnet (when applicable)
- **E2E tests** in `test/e2e/` — test CLI commands end-to-end

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run test/unit/config.test.ts

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage
```

### Commit Messages

Follow the format: `<type>(<scope>): <description>`

Types:
- `feat` — New feature
- `fix` — Bug fix
- `refactor` — Code restructuring without behavior change
- `test` — Adding or updating tests
- `docs` — Documentation changes
- `chore` — Build, tooling, or dependency changes

Examples:
```
feat(wallet): add XRPL wallet generation and encrypted storage
fix(balance): handle connection timeout on XRPL queries
test(config): add unit tests for network preset switching
docs(readme): add quick start guide
```

### Pull Requests

1. Create a feature branch from `main`
2. Make your changes with appropriate tests
3. Ensure all tests pass: `npm test`
4. Ensure no lint errors: `npm run lint`
5. Ensure types are correct: `npm run typecheck`
6. Submit a pull request with a clear description

## Testing Against Testnets

For integration and E2E tests that interact with real networks:

- **XRPL Testnet**: `wss://s.altnet.rippletest.net:51233/`
- **XRPL Faucet**: `https://faucet.altnet.rippletest.net/accounts`
- **Ethereum Sepolia**: Use a public RPC or your own Alchemy/Infura key

Set testnet RPC URLs via environment variables if needed:

```bash
export XRPL_TESTNET_URL="wss://s.altnet.rippletest.net:51233/"
export ETH_SEPOLIA_RPC="https://rpc.sepolia.org"
```

## Architecture Decisions

See [FRAMEWORK.md](./FRAMEWORK.md) for detailed architecture documentation, including:
- Technology stack rationale
- Third-party integration details (Aave, Wormhole, Chainlink)
- Security considerations
- RLUSD-specific constraints

# RLUSD CLI — Multi-Chain Stablecoin Command-Line Interface

## 1. Overview

RLUSD CLI is a developer-oriented command-line tool that provides unified access to **Ripple USD (RLUSD)** operations across multiple blockchains. Unlike single-chain CLI tools, RLUSD CLI treats the stablecoin—not the chain—as the primary object, enabling seamless interaction with RLUSD wherever it lives: **XRP Ledger, Ethereum, and Ethereum L2 networks**.

### 1.1 What is RLUSD?

RLUSD is Ripple's USD-backed stablecoin with the following properties:

- **1:1 USD backing** — cash deposits (≥85%) and short-term U.S. Treasuries (≤15%)
- **Regulatory oversight** — issued under NYDFS Limited Purpose Trust Company Charter
- **Dual-chain native issuance** — lives natively on both XRPL and Ethereum
- **L2 expansion** — expanding to Optimism, Base, Ink, and Unichain via Wormhole NTT (2026)
- **Market cap** — ~$1.33B (end of 2025), ~80% on Ethereum, ~20% on XRPL

### 1.2 Why Build This?

No existing CLI tool focuses on a single stablecoin's multi-chain lifecycle. Existing alternatives:

| Tool | Limitation |
|------|-----------|
| `xrplcli` (Mwni) | Interactive-only, XRPL-only, no config system |
| `xrpl-cli-ng` (9oelM) | Alpha stage, XRPL-only, 16 stars |
| `@hashgraph/stablecoin-cli` | Hedera-only |
| Swytchcode CLI | Generic stablecoin tool, no RLUSD-specific features |

RLUSD CLI fills a gap by providing:
1. **Multi-chain aggregated balance** — one command to see RLUSD across all chains
2. **Cross-chain bridging** — built-in Wormhole NTT for L2 transfers
3. **DeFi operations** — Aave lending/borrowing + XRPL DEX/AMM from the terminal
4. **Script-friendly output** — JSON output mode for automation pipelines

### 1.3 Supported Chains

| Chain | Type | Status | RLUSD Contract / Issuer |
|-------|------|--------|------------------------|
| XRP Ledger | L1 | Live | Issuer: `rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`, Currency: `RLUSD` (hex: `524C555344000000000000000000000000000000`) |
| Ethereum | L1 | Live | Proxy: `0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD`, Implementation: `0x9747a0d261c2d56eb93f542068e5d1e23170fa9e` |
| Optimism | L2 | Testing | TBD — via Wormhole NTT |
| Base | L2 | Testing | TBD — via Wormhole NTT |
| Ink | L2 | Testing | TBD — via Wormhole NTT |
| Unichain | L2 | Testing | TBD — via Wormhole NTT |

---

## 2. Technology Stack

### 2.1 Language & Runtime

| Choice | Rationale |
|--------|-----------|
| **TypeScript** | Type safety, modern async/await, excellent SDK ecosystem |
| **Node.js ≥ 20** (22 recommended) | Required by xrpl.js v4.x; LTS support |
| **ESM modules** | Tree-shaking, modern import/export |

### 2.2 Core Dependencies

| Package | Version | Purpose | Chain Coverage |
|---------|---------|---------|---------------|
| `xrpl` | ^4.6.0 | XRPL SDK — wallet, transactions, WebSocket client | XRPL |
| `viem` | ^2.x | EVM chain interaction — lightweight (35KB), TypeScript-first | Ethereum + all L2s |
| `@wormhole-foundation/sdk` | ^4.12.x | Cross-chain bridging via NTT protocol | Multi-chain |
| `@wormhole-foundation/sdk-evm` | ^4.12.x | EVM platform support for Wormhole | EVM chains |
| `@aave/client` | latest | Aave V3 lending/borrowing SDK (viem-compatible) | Ethereum |
| `commander` | ^13.x | CLI framework — zero deps, 50M/week downloads | — |
| `chalk` | ^5.x | Terminal color output | — |
| `ora` | ^8.x | Loading spinners | — |
| `inquirer` | ^12.x | Interactive prompts (password input, confirmations) | — |
| `yaml` | ^2.x | Config file read/write | — |
| `cli-table3` | ^0.6.x | Table output formatting | — |

### 2.3 Build & Development

| Tool | Purpose |
|------|---------|
| `esbuild` | Bundle CLI into single distributable file |
| `tsx` | Run TypeScript directly during development |
| `vitest` | Unit and integration testing |
| `eslint` + `prettier` | Code quality |

### 2.4 Why These Choices?

**viem over ethers.js**: viem is 35KB vs ethers.js's 200KB. For a CLI tool, startup time and bundle size matter. viem also provides better TypeScript inference and is the recommended choice for new projects in 2026.

**commander over oclif/yargs**: commander has zero dependencies and 50M weekly downloads. It provides clean subcommand composition without the overhead of a plugin system. The RLUSD CLI is a single focused tool, not an extensible platform.

**@aave/client over raw contract calls**: Aave's official SDK (`@aave/client`) provides a high-level, type-safe API with built-in error handling via `ResultAsync`. It natively supports viem wallet clients, making integration seamless.

---

## 3. Third-Party Integration Details

### 3.1 Aave V3 — Lending & Borrowing

RLUSD is live on Aave V3 Ethereum with significant TVL (~$540M supplied, ~$159M borrowed). The CLI integrates with Aave to enable supply/borrow/withdraw/repay operations.

#### 3.1.1 SDK Architecture

The `@aave/client` package follows a functional, viem-inspired modular architecture:

```typescript
import { AaveClient } from "@aave/client";
import { sendWith } from "@aave/client/viem";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const aaveClient = AaveClient.create();
const wallet = createWalletClient({
  account: privateKeyToAccount("0x..."),
  chain: mainnet,
  transport: http("https://eth-mainnet.g.alchemy.com/v2/KEY"),
});
```

#### 3.1.2 Core Operations

**Supply RLUSD to earn yield:**

```typescript
import { supply } from "@aave/client/actions";

const result = await supply(aaveClient, {
  market: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", // Aave V3 Ethereum Pool
  amount: {
    erc20: {
      currency: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD", // RLUSD
      value: bigDecimal(1000), // 1000 RLUSD
    },
  },
  sender: evmAddress(wallet.account.address),
  chainId: 1,
})
  .andThen(sendWith(wallet))
  .andThen(aaveClient.waitForTransaction);
```

**Withdraw RLUSD:**

```typescript
import { withdraw } from "@aave/client/actions";

const result = await withdraw(aaveClient, {
  market: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
  amount: {
    erc20: {
      currency: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD",
      value: bigDecimal(500),
    },
  },
  sender: evmAddress(wallet.account.address),
  chainId: 1,
})
  .andThen(sendWith(wallet))
  .andThen(aaveClient.waitForTransaction);
```

**Borrow & Repay** follow the same pattern with `borrow()` and `repay()` actions.

#### 3.1.3 Error Handling

All Aave SDK actions return `ResultAsync<T, E>` (from NeverThrow), which must be checked:

```typescript
if (result.isErr()) {
  switch (result.error.name) {
    case "SigningError":    // wallet signing failed
    case "TimeoutError":    // transaction confirmation timed out
    case "TransactionError": // on-chain revert
    case "UnexpectedError":  // unknown error
  }
}
```

#### 3.1.4 ERC-20 Permit Support

RLUSD supports EIP-2612 permits, allowing supply operations without a separate `approve` transaction:

```typescript
import { permitTypeData } from "@aave/client/actions";
import { signERC20PermitWith } from "@aave/client/viem";

const permitResult = await permitTypeData(aaveClient, { /* params */ })
  .andThen(signERC20PermitWith(wallet));
```

#### 3.1.5 Key Contract Addresses (Ethereum Mainnet)

| Contract | Address |
|----------|---------|
| Aave V3 Pool | `0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2` |
| RLUSD ERC-20 (Proxy) | `0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD` |
| RLUSD aToken | Dynamically resolved via Aave SDK |
| Chainlink RLUSD/USD Oracle | `0x26C46B7aD0012cA71F2298ada567dC9Af14E7f2A` |

#### 3.1.6 Aave RLUSD Market Data (as of March 2026)

| Metric | Value |
|--------|-------|
| Total Supplied | ~$540M |
| Total Borrowed | ~$159M |
| Supply APR | ~3.89% (including ~3.09% reward APR) |
| Borrow APR | ~3.42% |

---

### 3.2 Wormhole NTT — Cross-Chain Bridging

RLUSD uses Wormhole's Native Token Transfers (NTT) standard to expand from Ethereum mainnet to L2 networks. NTT enables native token transfers without wrapped tokens or liquidity pools.

#### 3.2.1 How NTT Works for RLUSD

```
Source Chain (e.g., Ethereum)          Destination Chain (e.g., Base)
┌──────────────────────┐               ┌──────────────────────┐
│ 1. User calls        │               │                      │
│    NttManager.transfer│               │                      │
│                       │               │                      │
│ 2. Tokens burned/     │   Wormhole    │ 4. NttManager mints  │
│    locked on source   │──────────────▶│    native tokens on  │
│                       │   Guardian    │    destination       │
│ 3. Transceiver sends  │   Network     │                      │
│    message via        │               │ 5. Tokens delivered  │
│    Wormhole           │               │    to recipient      │
└──────────────────────┘               └──────────────────────┘
```

Key properties:
- **No wrapped tokens** — RLUSD is minted natively on each chain
- **No liquidity pools** — no slippage, no MEV risk
- **Rate limiting** — configurable per-chain limits to prevent abuse
- **Global Accountant** — ensures total supply consistency across chains
- **Burn-and-mint model** — tokens are burned on source, minted on destination

#### 3.2.2 SDK Integration

```typescript
import { wormhole } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";

const wh = await wormhole("Mainnet", [evm]);

const sourceChain = wh.getChain("Ethereum");
const destChain = wh.getChain("Base");
```

The Wormhole SDK provides two NTT route modes:

| Route | Description | User Experience |
|-------|-------------|-----------------|
| `nttManual` | User pays gas on both source and destination chains | Two transactions required |
| `nttRelay` | User pays relayer fee on source chain only (in native gas) | Single transaction, relayer handles destination |

#### 3.2.3 NTT Transfer Flow (Programmatic)

The transfer lifecycle consists of three phases:

**Phase 1 — Initiate transfer on source chain:**
```typescript
// Approve NttManager to spend RLUSD
// Call NttManager.transfer(amount, recipientChain, recipientAddress, refundAddress, shouldQueue)
```

**Phase 2 — Wait for Wormhole attestation:**
```typescript
// Wormhole Guardians observe the source chain event
// A VAA (Verified Action Approval) is produced
// Fetch VAA using: wh.getVaa(whm, "Ntt:WormholeTransfer", timeout)
```

**Phase 3 — Redeem on destination chain:**
```typescript
// Submit the VAA to the destination chain NttManager
// NttManager verifies the message and mints tokens
// For nttRelay mode, a relayer handles this automatically
```

#### 3.2.4 NTT Contract Architecture

| Component | Role |
|-----------|------|
| **NttManager** | Core contract: manages token, transceivers, rate-limiting, message attestation. One per token per chain. |
| **Transceiver** | Sends/receives NTT messages through Wormhole. Handles source→destination message delivery. |
| **Global Accountant** | Off-chain verifier ensuring burned amount never exceeds minted amount across all chains. |

#### 3.2.5 Rate Limiting

NTT supports configurable rate limits on both sending and receiving:

```
Rate Limit Config per Chain:
  - Outbound limit: max tokens that can leave per period
  - Inbound limit: max tokens that can arrive per period
  - Queue support: if shouldQueue=true, transfers exceeding limit are queued
  - Cancel-flows: outbound transfers cancel inbound rate-limit consumption
```

#### 3.2.6 Current Deployment Status

| Chain | Status | Notes |
|-------|--------|-------|
| Ethereum ↔ Base | Testing | Wormhole NTT deployment in progress |
| Ethereum ↔ Optimism | Testing | Wormhole NTT deployment in progress |
| Ethereum ↔ Ink | Testing | Wormhole NTT deployment in progress |
| Ethereum ↔ Unichain | Testing | Wormhole NTT deployment in progress |
| XRPL ↔ Ethereum | Not available | XRPL is not an EVM chain; NTT currently supports EVM and SVM only |

**Important limitation**: Wormhole NTT does **not** support XRPL as a source or destination. XRPL↔Ethereum bridging for RLUSD is not currently possible via NTT. The CLI should clearly communicate this to users and monitor for future XRPL support.

#### 3.2.7 Wormhole SDK Dependencies

```json
{
  "@wormhole-foundation/sdk": "^4.12.2",
  "@wormhole-foundation/sdk-evm": "^4.12.2"
}
```

Wormholescan API (for querying bridge status):
- Base URL: `https://api.wormholescan.io/`
- Endpoints: `/api/v1/operations`, `/api/v1/vaas`

---

### 3.3 XRPL — Native RLUSD Operations

On XRPL, RLUSD is a fungible token issued via the native trust line mechanism. All operations use the `xrpl` (xrpl.js) SDK.

#### 3.3.1 XRPL Client Connection

```typescript
import { Client } from "xrpl";

const client = new Client("wss://s.altnet.rippletest.net:51233/"); // testnet
await client.connect();
```

#### 3.3.2 RLUSD Trust Line Setup

Before receiving RLUSD on XRPL, an account must establish a trust line to the issuer:

```typescript
import { TrustSet } from "xrpl";

const trustSetTx: TrustSet = {
  TransactionType: "TrustSet",
  Account: wallet.address,
  LimitAmount: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
    value: "1000000",  // maximum amount willing to hold
  },
};

const prepared = await client.autofill(trustSetTx);
const signed = wallet.sign(prepared);
const result = await client.submitAndWait(signed.tx_blob);
```

Reserve requirement: Each trust line requires ~0.2 XRP reserve.

#### 3.3.3 RLUSD Issuer Account Flags

The RLUSD issuer has specific flags that affect operations:

| Flag | Enabled | Implication |
|------|---------|------------|
| `lsfGlobalFreeze` | Yes | Issuer can freeze all RLUSD trust lines globally |
| `lsfAllowTrustLineClawback` | Yes | Issuer can claw back RLUSD from any account |
| `lsfDepositAuth` | Yes | Issuer requires pre-authorization for deposits |
| `lsfDefaultRipple` | Yes | Enables rippling (pass-through payments) by default |
| `lsfDisallowXRP` | Yes | Issuer account does not accept XRP payments |

#### 3.3.4 XRPL DEX Operations

**Create an offer (sell RLUSD for XRP):**

```typescript
import { OfferCreate } from "xrpl";

const offerTx: OfferCreate = {
  TransactionType: "OfferCreate",
  Account: wallet.address,
  TakerPays: "100000000", // 100 XRP in drops
  TakerGets: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
    value: "50",
  },
};
```

**Query the order book:**

```typescript
const orderBook = await client.request({
  command: "book_offers",
  taker_pays: { currency: "XRP" },
  taker_gets: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
  },
  limit: 20,
});
```

**Cancel an offer:**

```typescript
import { OfferCancel } from "xrpl";

const cancelTx: OfferCancel = {
  TransactionType: "OfferCancel",
  Account: wallet.address,
  OfferSequence: 12345,
};
```

#### 3.3.5 XRPL AMM Operations (XRP/RLUSD Pool)

The XRP/RLUSD AMM pool is one of the top pools on XRPL, with ~$6.8M TVL, 0.223% trading fee, and 1,282 LP token holders.

**Create an AMM pool:**

```typescript
import { AMMCreate } from "xrpl";

const ammCreateTx: AMMCreate = {
  TransactionType: "AMMCreate",
  Account: wallet.address,
  Amount: "1000000000", // 1000 XRP in drops
  Amount2: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
    value: "1500",
  },
  TradingFee: 500, // 0.5% (in units of 1/100,000)
};
```

**Deposit into the AMM:**

```typescript
import { AMMDeposit, AMMDepositFlags } from "xrpl";

const depositTx: AMMDeposit = {
  TransactionType: "AMMDeposit",
  Account: wallet.address,
  Asset: { currency: "XRP" },
  Asset2: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
  },
  Amount: "100000000", // 100 XRP
  Amount2: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
    value: "150",
  },
  Flags: AMMDepositFlags.tfTwoAsset,
};
```

**Withdraw from the AMM:**

```typescript
import { AMMWithdraw, AMMWithdrawFlags } from "xrpl";

const withdrawTx: AMMWithdraw = {
  TransactionType: "AMMWithdraw",
  Account: wallet.address,
  Asset: { currency: "XRP" },
  Asset2: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
  },
  LPTokenIn: {
    currency: "...", // LP token currency
    issuer: "...",   // AMM account
    value: "50",
  },
  Flags: AMMWithdrawFlags.tfLPToken,
};
```

**Vote on AMM trading fee:**

```typescript
import { AMMVote } from "xrpl";

const voteTx: AMMVote = {
  TransactionType: "AMMVote",
  Account: wallet.address,
  Asset: { currency: "XRP" },
  Asset2: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
  },
  TradingFee: 300, // vote for 0.3%
};
```

**Query AMM info:**

```typescript
const ammInfo = await client.request({
  command: "amm_info",
  asset: { currency: "XRP" },
  asset2: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
  },
});
```

#### 3.3.6 XRPL Cross-Currency Payments & Path Finding

XRPL supports cross-currency payments using the built-in DEX for liquidity:

```typescript
const pathResult = await client.request({
  command: "path_find",
  subcommand: "create",
  source_account: wallet.address,
  destination_account: "rDestination...",
  destination_amount: {
    currency: "RLUSD",
    issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
    value: "100",
  },
});
```

#### 3.3.7 XRPL Network Endpoints

| Network | WebSocket | JSON-RPC |
|---------|-----------|----------|
| Mainnet | `wss://xrplcluster.com/` | `https://xrplcluster.com/` |
| Mainnet (Ripple) | `wss://s1.ripple.com/` | `https://s1.ripple.com:51234/` |
| Testnet | `wss://s.altnet.rippletest.net:51233/` | `https://s.altnet.rippletest.net:51234/` |
| Devnet | `wss://s.devnet.rippletest.net:51233/` | `https://s.devnet.rippletest.net:51234/` |

Faucet APIs:
- Testnet: `POST https://faucet.altnet.rippletest.net/accounts`
- Devnet: `POST https://faucet.devnet.rippletest.net/accounts`

---

### 3.4 Ethereum — ERC-20 RLUSD Operations

On Ethereum (and L2s), RLUSD is a standard ERC-20 token with enhanced compliance features. All EVM operations use `viem`.

#### 3.4.1 Client Setup

```typescript
import { createPublicClient, createWalletClient, http } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http("https://eth-mainnet.g.alchemy.com/v2/KEY"),
});

const walletClient = createWalletClient({
  account: privateKeyToAccount("0x..."),
  chain: mainnet,
  transport: http("https://eth-mainnet.g.alchemy.com/v2/KEY"),
});
```

#### 3.4.2 RLUSD ERC-20 ABI (Key Functions)

```typescript
const RLUSD_ABI = [
  // Standard ERC-20
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",

  // RLUSD Enhanced Features (admin-only)
  "function mint(address to, uint256 amount)",
  "function burn(uint256 amount)",
  "function freeze(address account)",
  "function unfreeze(address account)",
  "function clawback(address from, uint256 amount)",
  "function isFrozen(address account) view returns (bool)",

  // Events
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
] as const;

const RLUSD_ADDRESS = "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD";
```

#### 3.4.3 Core ERC-20 Operations

**Read balance:**

```typescript
const balance = await publicClient.readContract({
  address: RLUSD_ADDRESS,
  abi: RLUSD_ABI,
  functionName: "balanceOf",
  args: [walletClient.account.address],
});
// Returns BigInt in 18-decimal format
// Format: balance / 10n ** 18n for human-readable
```

**Transfer RLUSD:**

```typescript
const hash = await walletClient.writeContract({
  address: RLUSD_ADDRESS,
  abi: RLUSD_ABI,
  functionName: "transfer",
  args: ["0xRecipient...", parseUnits("100", 18)], // 100 RLUSD
});

const receipt = await publicClient.waitForTransactionReceipt({ hash });
```

**Approve spender (e.g., Aave Pool):**

```typescript
const hash = await walletClient.writeContract({
  address: RLUSD_ADDRESS,
  abi: RLUSD_ABI,
  functionName: "approve",
  args: ["0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", parseUnits("1000", 18)],
});
```

**Check allowance:**

```typescript
const allowance = await publicClient.readContract({
  address: RLUSD_ADDRESS,
  abi: RLUSD_ABI,
  functionName: "allowance",
  args: [walletClient.account.address, "0xSpender..."],
});
```

**Check if account is frozen:**

```typescript
const frozen = await publicClient.readContract({
  address: RLUSD_ADDRESS,
  abi: RLUSD_ABI,
  functionName: "isFrozen",
  args: ["0xAccount..."],
});
```

#### 3.4.4 L2 Chain Support

The same viem client pattern applies to all L2 chains — only the chain config and RPC differ:

```typescript
import { base, optimism } from "viem/chains";

const baseClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

const optimismClient = createPublicClient({
  chain: optimism,
  transport: http("https://mainnet.optimism.io"),
});
```

L2 RLUSD contract addresses will be populated once NTT deployment is finalized.

#### 3.4.5 Ethereum Network Details

| Network | Chain ID | RPC | RLUSD Contract |
|---------|----------|-----|----------------|
| Mainnet | 1 | User-configured (Alchemy/Infura) | `0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD` |
| Sepolia (testnet) | 11155111 | Public RPCs | Available for testing |
| Base | 8453 | `https://mainnet.base.org` | TBD |
| Optimism | 10 | `https://mainnet.optimism.io` | TBD |

---

### 3.5 Chainlink — Price Oracle

RLUSD has a dedicated Chainlink price feed on Ethereum mainnet.

#### 3.5.1 Oracle Details

| Property | Value |
|----------|-------|
| Feed | RLUSD/USD |
| Contract | `0x26C46B7aD0012cA71F2298ada567dC9Af14E7f2A` |
| ENS | `rlusd-usd.data.eth` |
| Deviation Threshold | 0.3% |
| Tier | Low Market Risk |
| Oracle Operators | 16 (01Node, Blockdaemon, Chainlayer, etc.) |

#### 3.5.2 Reading the Price Feed

```typescript
const CHAINLINK_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
] as const;

const ORACLE_ADDRESS = "0x26C46B7aD0012cA71F2298ada567dC9Af14E7f2A";

const [, answer, , updatedAt] = await publicClient.readContract({
  address: ORACLE_ADDRESS,
  abi: CHAINLINK_ABI,
  functionName: "latestRoundData",
});

const decimals = await publicClient.readContract({
  address: ORACLE_ADDRESS,
  abi: CHAINLINK_ABI,
  functionName: "decimals",
});

const price = Number(answer) / 10 ** Number(decimals);
```

---

### 3.6 Fiat On/Off Ramp Information

RLUSD supports fiat gateways through MoonPay and Transak. The CLI does not directly integrate their APIs but provides reference links and information.

| Provider | Buy (On-Ramp) | Sell (Off-Ramp) | Chains Supported | Min Amount |
|----------|--------------|-----------------|------------------|------------|
| MoonPay | Yes — credit/debit, Apple Pay, bank transfer | Yes — bank, card, PayPal | Ethereum, XRPL | $20 |
| Transak | Yes — bank transfer, credit/debit | TBD | Ethereum, XRPL | Varies |

### 3.6.1 Fiat Guidance Commands

The CLI now exposes reference-only fiat guidance commands for automation and skill routing:

```bash
rlusd fiat onboarding checklist --json
rlusd fiat buy instructions --json
rlusd fiat redeem instructions --json
```

These commands do not initiate third-party API actions. They return stable machine-readable guidance describing recommended onboarding, buy-side, and redemption-side provider workflows.

---

### 3.7 Skill-Facing Contract (2026 Cutover)

The cutover-ready contract for `rlusd-skills` is the explicit machine-oriented surface below.

#### 3.7.1 Shared Envelope

All `--json` responses use one envelope:

```json
{
  "ok": true,
  "command": "evm.transfer.prepare",
  "chain": "ethereum-mainnet",
  "timestamp": "2026-03-25T00:00:00.000Z",
  "data": {},
  "warnings": [],
  "next": []
}
```

Errors use the same top-level shape with:

```json
{
  "ok": false,
  "error": {
    "code": "CONFIRMATION_REQUIRED",
    "message": "Execution requires an explicit confirmation matching the prepared plan id.",
    "retryable": false
  }
}
```

#### 3.7.2 Stable Command Families

```bash
# Metadata
rlusd resolve asset --chain ethereum-mainnet --symbol RLUSD --json

# Fiat guidance
rlusd fiat onboarding checklist --json
rlusd fiat buy instructions --json
rlusd fiat redeem instructions --json

# EVM prepared flows
rlusd evm transfer prepare ...
rlusd evm transfer execute ...
rlusd evm approve prepare ...
rlusd evm approve execute ...
rlusd evm tx wait ...
rlusd evm tx receipt ...

# XRPL prepared flows
rlusd xrpl trustline prepare ...
rlusd xrpl trustline execute ...
rlusd xrpl account info ...
rlusd xrpl payment prepare ...
rlusd xrpl payment execute ...
rlusd xrpl tx wait ...
rlusd xrpl payment receipt ...

# DeFi discovery and planned execution
rlusd defi venues ...
rlusd defi quote swap ...
rlusd defi swap prepare ...
rlusd defi swap execute ...
rlusd defi lp preview ...
rlusd defi lp prepare ...
rlusd defi lp execute ...
rlusd defi supply preview ...
rlusd defi supply prepare ...
rlusd defi supply execute ...
```

#### 3.7.3 Write-Path Rules

- Write commands prefer explicit wallet flags: `--from-wallet`, `--owner-wallet`, and `--wallet`.
- For predictable automation, prefer passing explicit `--chain` on top-level `defi` commands. If omitted, the CLI can also resolve the chain from the global flag or `default_chain` config.
- `defi quote swap`, `defi swap prepare`, `defi lp preview`, and `defi lp prepare` take explicit `--venue`; swap and LP execute commands read the venue from the stored plan instead.
- Prepared plans are stored under `~/.config/rlusd-cli/plans/`.
- Mainnet-gated plans require `--confirm-plan-id` that matches the stored `plan_id`.
- `defi quote swap` is live quote data and returns freshness metadata: `quoted_at`, `ttl_seconds`, and `expires_at`.
- `defi swap prepare|execute` and `defi lp prepare|execute` use the same deterministic `intent.steps[]` plan pattern as other prepared write flows.
- `defi lp preview` is preview-only and returns quote-style data, not `plan_id`, `plan_path`, or `intent.steps`.
- Curve routing in this batch is pinned to `ethereum-mainnet` RLUSD/USDC, and LP semantics are fixed to add with both token amounts or remove with `--lp-amount` plus `--receive-token`.

---

## 4. Project Architecture

```
rlusd-cli/
├── package.json
├── tsconfig.json
├── esbuild.config.ts
├── bin/
│   └── rlusd.ts                          # Entry point: #!/usr/bin/env node
│
├── src/
│   ├── index.ts                          # Commander program setup, register all commands
│   │
│   ├── config/
│   │   ├── config.ts                     # Read/write ~/.config/rlusd-cli/config.yml
│   │   ├── networks.ts                   # Network presets (endpoints, chain IDs)
│   │   └── constants.ts                  # RLUSD addresses, ABIs, issuer info
│   │
│   ├── clients/
│   │   ├── xrpl-client.ts               # XRPL WebSocket client (singleton, auto-reconnect)
│   │   ├── evm-client.ts                # viem public/wallet client factory per chain
│   │   ├── wormhole-client.ts           # Wormhole SDK initialization
│   │   └── aave-client.ts              # AaveClient singleton
│   │
│   ├── wallet/
│   │   ├── xrpl-wallet.ts              # XRPL wallet: generate, import, sign
│   │   ├── evm-wallet.ts               # EVM wallet: generate, import, sign
│   │   ├── manager.ts                   # Unified wallet manager (list, switch, lookup by chain)
│   │   └── crypto.ts                    # AES-256 encryption for stored keys
│   │
│   ├── commands/
│   │   ├── config.cmd.ts                # rlusd config get | set
│   │   ├── wallet.cmd.ts               # rlusd wallet generate | import | list | address | use
│   │   ├── balance.cmd.ts              # rlusd balance [--chain] [--all]
│   │   ├── send.cmd.ts                 # rlusd send --chain --to --amount
│   │   ├── bridge.cmd.ts               # rlusd bridge --from --to --amount | status | history
│   │   ├── price.cmd.ts                # rlusd price [--source chainlink|dex]
│   │   ├── market.cmd.ts               # rlusd market (aggregated market data)
│   │   ├── tx.cmd.ts                   # rlusd tx status | history
│   │   ├── faucet.cmd.ts              # rlusd faucet fund [--chain]
│   │   │
│   │   ├── xrpl/                        # XRPL-specific subcommands
│   │   │   ├── trustline.cmd.ts        # rlusd xrpl trustline setup | status | remove
│   │   │   ├── dex.cmd.ts             # rlusd xrpl dex buy | sell | cancel | orderbook
│   │   │   ├── amm.cmd.ts             # rlusd xrpl amm info | deposit | withdraw | vote
│   │   │   └── pathfind.cmd.ts         # rlusd xrpl pathfind --to --amount
│   │   │
│   │   └── eth/                         # Ethereum-specific subcommands
│   │       ├── approve.cmd.ts          # rlusd eth approve | allowance | revoke
│   │       └── defi.cmd.ts            # rlusd eth defi aave supply | withdraw | borrow | repay | status
│   │
│   ├── services/
│   │   ├── price-oracle.ts             # Chainlink feed reader + multi-source aggregation
│   │   ├── rlusd-info.ts               # Aggregate RLUSD data across chains (supply, TVL, etc.)
│   │   └── gas-estimator.ts            # Estimate gas/fees per chain before tx submission
│   │
│   ├── abi/
│   │   ├── rlusd-erc20.ts             # RLUSD ERC-20 ABI (typed)
│   │   ├── chainlink-aggregator.ts     # Chainlink AggregatorV3 ABI
│   │   └── aave-pool.ts               # Aave V3 Pool ABI (if needed beyond SDK)
│   │
│   ├── utils/
│   │   ├── format.ts                   # Output formatter: table | json | json-compact
│   │   ├── prompts.ts                  # inquirer wrappers: password, confirm, select
│   │   ├── address.ts                  # Detect address type: r... → XRPL, 0x... → EVM
│   │   ├── amounts.ts                  # Conversion helpers: drops, wei, decimals
│   │   └── logger.ts                   # chalk-based colored logging
│   │
│   └── types/
│       └── index.ts                     # Shared TypeScript types and interfaces
│
├── test/
│   ├── unit/
│   │   ├── config.test.ts
│   │   ├── wallet.test.ts
│   │   ├── address.test.ts
│   │   └── amounts.test.ts
│   └── integration/
│       ├── xrpl-testnet.test.ts
│       └── eth-sepolia.test.ts
│
└── scripts/
    └── install.sh                       # curl-based one-line installer
```

---

## 5. Configuration System

### 5.1 Config File

Path: `~/.config/rlusd-cli/config.yml`

```yaml
environment: testnet

default_chain: xrpl
output_format: table

chains:
  xrpl:
    websocket: "wss://s.altnet.rippletest.net:51233/"
    json_rpc: "https://s.altnet.rippletest.net:51234/"
    default_wallet: default-xrpl
  ethereum:
    rpc: "https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY"
    default_wallet: default-eth
  base:
    rpc: "https://sepolia.base.org"
    default_wallet: default-eth
  optimism:
    rpc: "https://sepolia.optimism.io"
    default_wallet: default-eth

rlusd:
  xrpl_issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De"
  xrpl_currency: "RLUSD"
  eth_contract: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD"
  eth_decimals: 18
  chainlink_oracle: "0x26C46B7aD0012cA71F2298ada567dC9Af14E7f2A"
```

### 5.2 Network Presets

```
rlusd config set --network mainnet    →  switches all endpoints to mainnet
rlusd config set --network testnet    →  switches all endpoints to testnet/sepolia
rlusd config set --network devnet     →  switches to devnet
```

### 5.3 Wallet Storage

Path: `~/.config/rlusd-cli/wallets/<name>.json`

```json
{
  "name": "default-xrpl",
  "chain": "xrpl",
  "address": "rAbc123...",
  "encrypted_secret": "<AES-256-GCM encrypted>",
  "algorithm": "ed25519",
  "created_at": "2026-03-24T10:00:00Z"
}
```

```json
{
  "name": "default-eth",
  "chain": "ethereum",
  "address": "0xAbc123...",
  "encrypted_private_key": "<AES-256-GCM encrypted>",
  "created_at": "2026-03-24T10:00:00Z"
}
```

Encryption: AES-256-GCM with password-derived key (PBKDF2, 100,000 iterations).

---

## 6. Command Reference

### 6.1 Global Flags

```
--chain <chain>       Target chain: xrpl | ethereum | base | optimism | ink | unichain
--output <format>     Output format: table | json | json-compact
--network <network>   Override network: mainnet | testnet | devnet
--verbose             Show detailed output
--help                Show help
--version             Show version
```

### 6.2 Command Groups

#### Config

| Command | Description |
|---------|-------------|
| `rlusd config get` | Display current configuration |
| `rlusd config set --network <net>` | Switch network environment |
| `rlusd config set --chain <chain> --rpc <url>` | Set custom RPC for a chain |

#### Wallet

| Command | Description |
|---------|-------------|
| `rlusd wallet generate --chain <chain>` | Generate a new wallet |
| `rlusd wallet import --chain xrpl --secret <secret>` | Import XRPL wallet from secret |
| `rlusd wallet import --chain ethereum --private-key <key>` | Import EVM wallet |
| `rlusd wallet import --chain ethereum --mnemonic "<words>"` | Import from mnemonic |
| `rlusd wallet list` | List all stored wallets |
| `rlusd wallet address [--chain <chain>]` | Show current wallet address |
| `rlusd wallet use <name>` | Switch default wallet |

#### Balance

| Command | Description |
|---------|-------------|
| `rlusd balance` | RLUSD balance on default chain |
| `rlusd balance --chain ethereum` | RLUSD balance on specific chain |
| `rlusd balance --all` | Aggregated balance across all chains |
| `rlusd gas-balance` | Native token balances for gas (XRP, ETH) |

#### Send

| Command | Description |
|---------|-------------|
| `rlusd send --to <addr> --amount <n>` | Send RLUSD (auto-detect chain from address) |
| `rlusd send --chain xrpl --to <addr> --amount <n> --tag <dt>` | XRPL send with destination tag |
| `rlusd send --chain ethereum --to <addr> --amount <n>` | Ethereum send |

#### Bridge (Wormhole NTT)

| Command | Description |
|---------|-------------|
| `rlusd bridge --from ethereum --to base --amount <n>` | Cross-chain RLUSD transfer |
| `rlusd bridge estimate --from ethereum --to base --amount <n>` | Estimate bridge cost |
| `rlusd bridge status <transfer-id>` | Check bridge transfer status |
| `rlusd bridge history` | List recent bridge transfers |

#### Price & Market

| Command | Description |
|---------|-------------|
| `rlusd price` | Current RLUSD price (multi-source) |
| `rlusd price --source chainlink` | Price from Chainlink oracle only |
| `rlusd market` | Aggregated market overview |

#### Transaction

| Command | Description |
|---------|-------------|
| `rlusd tx status <hash> --chain <chain>` | Check transaction status |
| `rlusd tx history [--chain <chain>] [--limit <n>]` | Transaction history |

#### Faucet (Testnet only)

| Command | Description |
|---------|-------------|
| `rlusd faucet fund --chain xrpl` | Get test XRP + auto-setup trust line |
| `rlusd faucet fund --chain ethereum` | Get test ETH (Sepolia) |

#### XRPL-Specific

| Command | Description |
|---------|-------------|
| `rlusd xrpl trustline setup` | Set up RLUSD trust line (one-click) |
| `rlusd xrpl trustline status` | Check trust line status |
| `rlusd xrpl trustline remove` | Remove RLUSD trust line |
| `rlusd xrpl dex buy --amount <n> --price <p>` | Buy RLUSD with XRP |
| `rlusd xrpl dex sell --amount <n> --price <p>` | Sell RLUSD for XRP |
| `rlusd xrpl dex cancel --sequence <seq>` | Cancel an offer |
| `rlusd xrpl dex orderbook` | Show XRP/RLUSD order book |
| `rlusd xrpl amm info` | XRP/RLUSD AMM pool info |
| `rlusd xrpl amm deposit --xrp <n> --rlusd <n>` | Add liquidity |
| `rlusd xrpl amm withdraw --lp-tokens <n>` | Remove liquidity |
| `rlusd xrpl amm swap --sell-xrp <n>` | Swap via AMM |
| `rlusd xrpl amm vote --fee <n>` | Vote on trading fee |
| `rlusd xrpl pathfind --to <addr> --amount <n>` | Find payment path |

#### Ethereum-Specific

| Command | Description |
|---------|-------------|
| `rlusd eth approve --spender <addr> --amount <n>` | Approve ERC-20 spending |
| `rlusd eth allowance --spender <addr>` | Check current allowance |
| `rlusd eth revoke --spender <addr>` | Revoke approval (set to 0) |
| `rlusd eth defi aave supply --amount <n>` | Supply RLUSD to Aave |
| `rlusd eth defi aave withdraw --amount <n>` | Withdraw from Aave |
| `rlusd eth defi aave borrow --amount <n>` | Borrow RLUSD from Aave |
| `rlusd eth defi aave repay --amount <n>` | Repay RLUSD loan |
| `rlusd eth defi aave status` | Show Aave position details |

---

## 7. Installation Methods

### 7.1 npm Global Install (Primary)

```bash
npm install -g @rlusd/cli
rlusd --help
```

### 7.2 One-Line Script Install (Solana-style)

```bash
curl -sSfL https://raw.githubusercontent.com/t54-labs/rlusd-cli/main/scripts/install.sh | bash
```

The script detects the environment, installs Node.js if missing, and runs `npm install -g`.

### 7.3 npx (No Install)

```bash
npx @rlusd/cli balance --all
```

---

## 8. Development Roadmap

### Phase 0 — Foundation (Week 1)

- [ ] Project scaffolding: package.json, tsconfig, eslint, esbuild
- [ ] Configuration system: read/write YAML, network presets, environment switching
- [ ] Dual wallet system: XRPL + EVM wallet generation, import, encrypted storage
- [ ] Multi-chain balance query: XRPL trust line balance + EVM ERC-20 balanceOf + aggregation
- [ ] CLI framework: commander setup, global flags, output formatting

### Phase 1 — Core Operations (Week 2)

- [ ] XRPL trust line auto-setup for RLUSD
- [ ] RLUSD send: XRPL Payment + EVM transfer
- [ ] Faucet: XRPL testnet faucet + trust line + Sepolia ETH
- [ ] Transaction query: status + history on both chains
- [ ] Price query: Chainlink oracle integration

### Phase 2 — XRPL DeFi (Week 3)

- [ ] DEX: create/cancel offers, query order book
- [ ] AMM: info, deposit, withdraw, vote, swap
- [ ] Path finding: cross-currency payment routes

### Phase 3 — Ethereum DeFi (Week 4)

- [ ] ERC-20 approve/revoke/allowance management
- [ ] Aave integration: supply, withdraw, borrow, repay, position status
- [ ] Market data aggregation: TVL, volume, APR across protocols

### Phase 4 — Cross-Chain (Week 5)

- [ ] Wormhole NTT bridge: Ethereum ↔ L2 transfers
- [ ] Bridge status tracking via Wormholescan API
- [ ] Bridge fee estimation

### Phase 5 — Polish (Week 6)

- [ ] Shell auto-completion (bash, zsh, fish)
- [ ] One-line install script
- [ ] Comprehensive error messages and help text
- [ ] Integration tests against testnet/devnet

---

## 9. Security Considerations

### 9.1 Key Storage

- Private keys are **never** stored in plaintext
- AES-256-GCM encryption with PBKDF2 key derivation (100,000 iterations)
- Password prompt via `inquirer` (masked input)
- Keys are decrypted only in memory, for the duration of a single operation

### 9.2 Transaction Safety

- All destructive operations (send, bridge, approve) require explicit `--confirm` or interactive confirmation
- Gas/fee estimation shown before execution
- Dry-run mode (`--dry-run`) to preview transactions without submitting

### 9.3 RPC Security

- Users must provide their own Ethereum RPC endpoints (Alchemy, Infura, etc.)
- The CLI does not bundle any API keys
- XRPL public endpoints are used by default but can be overridden

### 9.4 RLUSD-Specific Risks

- **Freeze risk**: RLUSD issuer can freeze individual accounts (both XRPL and Ethereum)
- **Clawback risk**: RLUSD issuer can claw back tokens from any account
- The CLI should surface freeze/clawback status clearly in account info displays

---

## 10. Key Technical Constraints & Decisions

### 10.1 XRPL ↔ Ethereum Bridging

**Wormhole NTT does not currently support XRPL.** NTT only supports EVM and SVM (Solana) chains. There is no programmatic way to bridge RLUSD between XRPL and Ethereum via the CLI today. The CLI should:
- Clearly state this limitation when users attempt XRPL↔Ethereum bridge
- Direct users to CEX (Binance, Kraken) for cross-chain transfers
- Monitor Wormhole roadmap for future XRPL support

### 10.2 EVM Wallet Sharing

All EVM chains (Ethereum, Base, Optimism, Ink, Unichain) share the same private key / address. The wallet system stores one EVM wallet and uses it across all EVM chains.

### 10.3 RLUSD Decimals

- **XRPL**: 15 significant digits (XRPL precision for issued currencies)
- **Ethereum**: 18 decimal places (standard ERC-20)
- The CLI normalizes all displays to 2 decimal places by default, with `--precise` flag for full precision

### 10.4 Aave SDK vs Raw Contract Calls

We use `@aave/client` SDK rather than raw viem contract calls because:
- The SDK handles the complex multi-step flow (check reserves, approve, supply)
- Built-in permit support for gas-efficient transactions
- The SDK provides market discovery (finding RLUSD reserve addresses dynamically)
- Error handling is more informative than raw revert decoding

For simple read operations (balance, APR), we may fall back to direct viem calls for speed.

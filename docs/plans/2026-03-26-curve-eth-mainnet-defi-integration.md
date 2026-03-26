# Curve Ethereum Mainnet DeFi Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add explicit-venue Curve support for Ethereum mainnet RLUSD-USDC swap and LP flows in `rlusd-cli`, then update `rlusd-skills` so agents can deterministically quote, prepare, and execute those flows.

**Architecture:** Introduce a small shared EVM DeFi venue layer under both top-level `defi` commands and legacy `eth` commands. Keep venue choice explicit everywhere with `--venue`, hardcode one supported Curve pool on Ethereum mainnet (`0xd001ae433f254283fece51d4acce8c53263aa186`), require `--chain` on every top-level `defi` command, and reuse the existing prepared-plan `intent.steps[]` pattern plus a shared multi-step executor for new swap and LP writes.

**Tech Stack:** TypeScript, Commander, viem, Vitest, ESLint, Prettier, existing prepared-plan and agent-envelope helpers

---

## Frozen Decisions

- Curve support in this batch means exactly one pool: `0xd001ae433f254283fece51d4acce8c53263aa186`.
- Curve support in this batch means exactly one pair: `RLUSD <-> USDC`.
- Curve routing is supported only on `ethereum-mainnet`.
- Top-level `defi` commands require `--chain` everywhere for agent determinism.
- Any command that can route to different venues requires explicit `--venue`.
- Top-level swap execution becomes canonical for skills via `defi swap prepare` and `defi swap execute`.
- LP scope is intentionally narrow and deterministic:
  - add liquidity requires both `--rlusd-amount` and `--usdc-amount`
  - remove liquidity uses `--lp-amount` plus `--receive-token RLUSD|USDC`
- `eth swap` and the new `eth lp` commands are convenience wrappers over shared venue helpers; they must not duplicate calldata generation logic.
- Before writing the Curve adapter, verify the exact callable pool ABI for the chosen contract and keep only the minimal required signatures in source.

---

## Branch And Sequencing

**Runtime branch:** `feat/curve-eth-mainnet-defi`

**Consumer follow-up branch:** `rlusd-skills` can land after the runtime branch is testable locally from source.

**Push rule:** Push the `rlusd-cli` branch after each checkpoint commit. Update `rlusd-skills` only after the runtime branch has passing tests and a stable command contract.

---

### Task 1: Freeze the command contract with failing CLI tests

**Files:**
- Modify: `src/commands/eth/defi.cmd.ts`
- Modify: `src/commands/eth/swap.cmd.ts`
- Modify: `src/types/index.ts`
- Test: `test/unit/commands.test.ts`

**Step 1: Write the failing tests**

Add command-level tests that assert:
- `rlusd --json defi venues` fails unless `--chain` is provided
- `rlusd --json defi quote swap` fails unless both `--chain` and `--venue` are provided
- `rlusd --json defi supply preview|prepare` fails unless `--chain` is provided
- `rlusd --json eth swap quote|sell|buy` fails unless `--venue` is provided
- new action names `defi.swap` and `defi.lp` are valid `PrepareAction` values

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/commands.test.ts`

Expected: FAIL because top-level `defi` still accepts omitted `--chain`, legacy `eth swap` does not require `--venue`, and `PrepareAction` does not include the new DeFi plan types.

**Step 3: Implement the minimal contract freeze**

Make `--chain` required on all top-level `defi` entrypoints, make `--venue` required on any swap or LP command, and extend `PrepareAction` with `defi.swap` and `defi.lp`. Do not add Curve logic in this step; only make the public command contract explicit and deterministic.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/commands.test.ts`

Expected: PASS for the new validation and action-type cases.

**Step 5: Commit and push**

```bash
git add src/commands/eth/defi.cmd.ts src/commands/eth/swap.cmd.ts src/types/index.ts test/unit/commands.test.ts
git commit -m "feat: require explicit chain and venue for defi routing"
git push -u origin feat/curve-eth-mainnet-defi
```

---

### Task 2: Add Curve pool metadata, config plumbing, and the minimal ABI

**Files:**
- Create: `src/abi/curve-stableswap-pool.ts`
- Create: `src/defi/curve-pool.ts`
- Modify: `src/config/constants.ts`
- Modify: `src/config/config.ts`
- Modify: `src/commands/config.cmd.ts`
- Modify: `src/types/index.ts`
- Test: `test/unit/config.test.ts`
- Test: `test/unit/commands.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- default config exposes the fixed Ethereum Curve RLUSD-USDC pool address
- `config set --chain ethereum --curve-rlusd-usdc-pool <address>` is accepted
- the Curve pool resolver rejects non-Ethereum-mainnet labels
- the resolver returns the fixed pool only for `ethereum-mainnet`

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/config.test.ts test/unit/commands.test.ts`

Expected: FAIL because config has no Curve pool field, the config command has no Curve option, and there is no Curve pool resolver yet.

**Step 3: Implement the minimal Curve metadata layer**

Add:
- a single constant for pool `0xd001ae433f254283fece51d4acce8c53263aa186`
- a `curve_rlusd_usdc_pool` contract field on Ethereum config
- a resolver that returns pool metadata only for `ethereum-mainnet`
- a minimal ABI file with only the verified functions needed for quote, swap, add liquidity, and remove liquidity

Before finalizing `src/abi/curve-stableswap-pool.ts`, verify the exact function signatures exposed by the target pool and keep the ABI intentionally narrow.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/config.test.ts test/unit/commands.test.ts`

Expected: PASS for config defaults, config overrides, and pool resolution.

**Step 5: Commit and push**

```bash
git add src/abi/curve-stableswap-pool.ts src/defi/curve-pool.ts src/config/constants.ts src/config/config.ts src/commands/config.cmd.ts src/types/index.ts test/unit/config.test.ts test/unit/commands.test.ts
git commit -m "feat: add curve pool metadata for ethereum mainnet"
git push
```

---

### Task 3: Extract shared DeFi venue adapters and a reusable step executor

**Files:**
- Create: `src/defi/types.ts`
- Create: `src/defi/executor.ts`
- Create: `src/defi/venues/index.ts`
- Create: `src/defi/venues/uniswap.ts`
- Modify: `src/commands/eth/defi.cmd.ts`
- Modify: `src/commands/eth/swap.cmd.ts`
- Modify: `src/types/index.ts`
- Test: `test/unit/commands.test.ts`
- Test: `test/unit/defi-venues.test.ts`

**Step 1: Write the failing tests**

Create venue-layer tests that assert:
- a shared adapter registry can resolve `uniswap` and later `curve`
- Uniswap quote behavior is available through the adapter interface
- the shared executor rejects a plan whose `action` does not match the caller
- the shared executor enforces confirmation on mainnet plans

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/commands.test.ts test/unit/defi-venues.test.ts`

Expected: FAIL because no shared venue registry or step executor exists and `defi supply execute` still owns its own loop.

**Step 3: Implement the shared helpers**

Add a `DefiVenueAdapter` interface with the minimum methods needed in this batch:
- `quoteSwap(...)`
- `buildSwapPlan(...)`
- `previewLp(...)`
- `buildLpPlan(...)`

Move the multi-step send/wait loop out of `defi.supply.execute` into `src/defi/executor.ts`, then update supply execution to call the shared helper before layering new swap and LP actions on top.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/commands.test.ts test/unit/defi-venues.test.ts`

Expected: PASS for adapter resolution and shared execution guards.

**Step 5: Commit and push**

```bash
git add src/defi/types.ts src/defi/executor.ts src/defi/venues/index.ts src/defi/venues/uniswap.ts src/commands/eth/defi.cmd.ts src/commands/eth/swap.cmd.ts src/types/index.ts test/unit/commands.test.ts test/unit/defi-venues.test.ts
git commit -m "refactor: share defi venue and execution helpers"
git push
```

---

### Task 4: Implement top-level `defi` swap quote, prepare, and execute

**Files:**
- Create: `src/defi/venues/curve.ts`
- Modify: `src/commands/eth/defi.cmd.ts`
- Modify: `src/defi/venues/index.ts`
- Modify: `src/types/index.ts`
- Test: `test/unit/commands.test.ts`
- Test: `test/unit/defi-swap.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- `defi quote swap --chain ethereum-mainnet --venue uniswap ...` still returns a live quote envelope
- `defi quote swap --chain ethereum-mainnet --venue curve --from RLUSD --to USDC ...` returns route metadata naming the fixed Curve pool
- `defi quote swap --venue curve` rejects unsupported pairs and non-mainnet chains with structured errors
- `defi swap prepare --chain ethereum-mainnet --venue curve --from-wallet ops --from RLUSD --to USDC --amount 1000 --slippage 50 --json` writes a plan with `action: "defi.swap"` and `intent.steps[] = [approve, swap]`
- `defi swap execute` requires `--confirm-plan-id` on mainnet and rejects plans whose action is not `defi.swap`

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/commands.test.ts test/unit/defi-swap.test.ts`

Expected: FAIL because `defi swap prepare` and `defi swap execute` do not exist and the top-level quote path is still hardwired to Uniswap.

**Step 3: Implement the swap flow**

Use the venue adapter registry to drive:
- `defi quote swap`
- `defi swap prepare`
- `defi swap execute`

Keep the existing quote envelope shape stable where possible:
- preserve `quoted_at`, `ttl_seconds`, and `expires_at`
- always return `route.venue`
- include Uniswap fee metadata only for Uniswap
- include fixed Curve pool metadata only for Curve

For the Curve prepare path, store deterministic calldata steps using the verified pool ABI and the fixed pool address.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/commands.test.ts test/unit/defi-swap.test.ts`

Expected: PASS for explicit-venue quotes, Curve pair restrictions, and prepared swap execution guards.

**Step 5: Commit and push**

```bash
git add src/defi/venues/curve.ts src/commands/eth/defi.cmd.ts src/defi/venues/index.ts src/types/index.ts test/unit/commands.test.ts test/unit/defi-swap.test.ts
git commit -m "feat: add top-level defi swap prepare and execute"
git push
```

---

### Task 5: Implement top-level Curve LP preview, prepare, and execute

**Files:**
- Modify: `src/commands/eth/defi.cmd.ts`
- Modify: `src/defi/venues/curve.ts`
- Modify: `src/defi/venues/index.ts`
- Modify: `src/types/index.ts`
- Test: `test/unit/commands.test.ts`
- Test: `test/unit/defi-lp.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- `defi lp` is registered with `preview`, `prepare`, and `execute`
- `defi lp preview` requires `--chain`, `--venue`, and `--operation add|remove`
- `defi lp preview --venue uniswap` fails with a capability/venue unsupported error
- `defi lp prepare --operation add --rlusd-amount 1000 --usdc-amount 1000 --from-wallet ops` writes deterministic approve + add-liquidity steps
- `defi lp prepare --operation remove --lp-amount 50 --receive-token RLUSD --from-wallet ops` writes deterministic remove-liquidity steps
- `defi lp execute` requires `--confirm-plan-id` on mainnet and rejects plans whose action is not `defi.lp`

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/commands.test.ts test/unit/defi-lp.test.ts`

Expected: FAIL because no top-level LP command family exists and the Curve adapter does not implement LP helpers.

**Step 3: Implement the LP flow**

Add:
- `defi lp preview`
- `defi lp prepare`
- `defi lp execute`

Freeze the first-pass semantics in code and docs:
- `--operation add` requires both `--rlusd-amount` and `--usdc-amount`
- `--operation remove` requires `--lp-amount` and `--receive-token RLUSD|USDC`
- only `--venue curve` is accepted in this batch

Use the shared step executor and return the same prepared-plan envelope pattern as other DeFi writes.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/commands.test.ts test/unit/defi-lp.test.ts`

Expected: PASS for registration, deterministic plan generation, and execution guards.

**Step 5: Commit and push**

```bash
git add src/commands/eth/defi.cmd.ts src/defi/venues/curve.ts src/defi/venues/index.ts src/types/index.ts test/unit/commands.test.ts test/unit/defi-lp.test.ts
git commit -m "feat: add curve lp flows to top-level defi"
git push
```

---

### Task 6: Add legacy `eth lp` commands and route legacy `eth swap` through the venue layer

**Files:**
- Create: `src/commands/eth/lp.cmd.ts`
- Modify: `src/cli.ts`
- Modify: `src/commands/eth/swap.cmd.ts`
- Modify: `src/commands/eth/defi.cmd.ts`
- Test: `test/unit/commands.test.ts`
- Test: `test/unit/eth-swap.test.ts`
- Test: `test/unit/eth-lp.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- `eth lp` is registered with `add`, `remove`, and `quote`
- `eth swap quote|sell|buy` all require `--venue`
- `eth swap --venue curve` only accepts the RLUSD-USDC pair on Ethereum mainnet
- `eth lp add` maps to the same add-liquidity preparation logic as top-level `defi lp prepare`
- `eth lp remove` maps to the same remove-liquidity preparation logic as top-level `defi lp prepare`

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/commands.test.ts test/unit/eth-swap.test.ts test/unit/eth-lp.test.ts`

Expected: FAIL because there is no `eth lp` command and legacy `eth swap` still owns its own Uniswap-only logic.

**Step 3: Implement the legacy wrappers**

Add `src/commands/eth/lp.cmd.ts` and register it from `src/cli.ts`. Make the legacy commands thin wrappers around shared venue helpers:
- `eth swap quote|sell|buy` must call the same venue adapter logic used by top-level `defi`
- `eth lp add|remove|quote` must call the same Curve LP helpers used by top-level `defi`

Allow direct execution UX here, but keep a single source of truth for quote math, pair restrictions, slippage handling, and encoded calldata.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/commands.test.ts test/unit/eth-swap.test.ts test/unit/eth-lp.test.ts`

Expected: PASS for registration, explicit venue requirements, and shared helper wiring.

**Step 5: Commit and push**

```bash
git add src/commands/eth/lp.cmd.ts src/cli.ts src/commands/eth/swap.cmd.ts src/commands/eth/defi.cmd.ts test/unit/commands.test.ts test/unit/eth-swap.test.ts test/unit/eth-lp.test.ts
git commit -m "feat: add explicit-venue eth swap and lp commands"
git push
```

---

### Task 7: Update runtime docs and the `rlusd-skills` consumer layer

**Files in `rlusd-cli`:**
- Modify: `README.md`
- Modify: `docs/FRAMEWORK.md`

**Files in `../rlusd-skills`:**
- Modify: `README.md`
- Modify: `docs/command-reference.md`
- Modify: `docs/examples/defi.md`
- Modify: `docs/troubleshooting.md`
- Modify: `skills/use-rlusd-evm-defi/SKILL.md`
- Modify: `skills/use-rlusd-evm-defi/references/routing.md`
- Modify: `skills/use-rlusd-evm-defi/references/venues.md`
- Modify: `skills/rlusd-defi-action/SKILL.md`
- Test: `tests/defi-quote-guidance.test.mjs`

**Step 1: Write the failing tests**

Update `../rlusd-skills/tests/defi-quote-guidance.test.mjs` so it asserts:
- top-level `defi` examples include explicit `--chain` and explicit `--venue`
- the docs no longer describe Curve as discovery-only
- the docs mention `defi swap prepare|execute`
- the docs mention Curve LP preview/prepare/execute on Ethereum mainnet

**Step 2: Run tests to verify failure**

Run: `npm test -- tests/defi-quote-guidance.test.mjs`

Expected: FAIL because the current docs still say the quote path is Uniswap-only and Curve is discovery-only.

**Step 3: Update the docs and skills**

In `rlusd-cli`, document:
- explicit `--chain` on all top-level `defi` commands
- explicit `--venue` on all swap and LP commands
- top-level `defi swap prepare|execute`
- Curve LP add/remove semantics and chain restrictions

In `../rlusd-skills`, replace the old discovery-only caveats with the new runtime contract and show agent-safe examples that use explicit chain, explicit venue, and the new prepared swap/LP flows.

**Step 4: Run tests to verify pass**

Run: `npm test -- tests/defi-quote-guidance.test.mjs`

Expected: PASS for the updated skills/docs wording.

**Step 5: Commit and push**

```bash
# In rlusd-cli
git add README.md docs/FRAMEWORK.md
git commit -m "docs: document curve swap and lp command contract"
git push

# In ../rlusd-skills
git add README.md docs/command-reference.md docs/examples/defi.md docs/troubleshooting.md skills/use-rlusd-evm-defi/SKILL.md skills/use-rlusd-evm-defi/references/routing.md skills/use-rlusd-evm-defi/references/venues.md skills/rlusd-defi-action/SKILL.md tests/defi-quote-guidance.test.mjs
git commit -m "docs: teach skills to use curve swap and lp flows"
git push
```

---

### Task 8: Run the full verification matrix and capture smoke examples

**Files:**
- Modify as needed from previous tasks only
- No new source files expected

**Step 1: Run the runtime unit suite**

Run: `npm test`

Expected: PASS in `rlusd-cli`.

**Step 2: Run static verification for the runtime**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: PASS with no TypeScript, ESLint, or build errors.

**Step 3: Run the consumer docs test suite**

Run: `npm test`

Expected: PASS in `../rlusd-skills`.

**Step 4: Run smoke commands that do not require a funded wallet**

Run these from `rlusd-cli` after `npm run build`:

```bash
node dist/bin/rlusd.js --json defi venues --chain ethereum-mainnet
node dist/bin/rlusd.js --json defi quote swap --chain ethereum-mainnet --venue curve --from RLUSD --to USDC --amount 100
node dist/bin/rlusd.js --json defi quote swap --chain ethereum-mainnet --venue uniswap --from RLUSD --to USDC --amount 100 --fee-tier 100
node dist/bin/rlusd.js --json defi lp preview --chain ethereum-mainnet --venue curve --operation add --rlusd-amount 100 --usdc-amount 100
node dist/bin/rlusd.js --json eth swap quote --venue curve --chain ethereum --amount 100 --for USDC
node dist/bin/rlusd.js --json eth lp quote --venue curve --chain ethereum --operation add --rlusd-amount 100 --usdc-amount 100
```

Expected:
- structured JSON success for supported read-only cases
- structured JSON errors for unsupported pair or unsupported chain combinations
- no silent fallback to Uniswap when `--venue curve` is requested

**Step 5: Final commit**

```bash
git status
git add .
git commit -m "feat: add curve swap and lp flows for ethereum mainnet"
```

---

## Completion Criteria

- Top-level `defi` requires `--chain` on every subcommand.
- Top-level `defi quote swap` requires explicit `--venue`.
- Top-level `defi swap prepare|execute` exists and uses deterministic plans.
- Top-level `defi lp preview|prepare|execute` exists and is Curve-only in this batch.
- Legacy `eth swap` requires explicit `--venue`.
- Legacy `eth lp add|remove|quote` exists and reuses shared helpers.
- Curve support is limited to Ethereum mainnet RLUSD-USDC on pool `0xd001ae433f254283fece51d4acce8c53263aa186`.
- `rlusd-skills` docs and tests are updated to call the new explicit-venue command surface.

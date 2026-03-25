# RLUSD CLI Skills Backend Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `rlusd-cli` the single runtime backend for `rlusd-skills` by adding a stable agent-safe JSON contract, deterministic `prepare -> review -> execute` flows, explicit local-wallet selection, live DeFi quotes, and the remaining skill-facing command families.

**Architecture:** Keep the current human-friendly CLI UX, but add a consistent machine-oriented contract for skill-driven flows. Reuse existing command modules where possible, and centralize agent envelopes, plan hashing, confirmation policy, and wallet selection so every write path behaves the same way.

**Tech Stack:** TypeScript, Commander, viem, xrpl.js, Vitest, ESLint, Prettier

---

## Branch And Sequencing

**Branch:** `feat/skills-backend-migration`

**Merge dependency:** This repo lands first. `rlusd-skills` should not cut over until this branch is merged or otherwise consumable locally.

**Push rule:** Push after every checkpoint commit so `rlusd-skills` can validate against a real branch tip.

---

### Task 1: Add the shared agent JSON contract

**Files:**
- Create: `src/agent/envelope.ts`
- Create: `src/agent/errors.ts`
- Create: `src/agent/types.ts`
- Modify: `src/cli.ts`
- Modify: `src/index.ts`
- Test: `test/unit/cli.test.ts`
- Test: `test/unit/commands.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- `--json` is accepted as a machine-output flag
- success responses include `ok`, `command`, `timestamp`, `data`, `warnings`, `next`
- failures emit structured JSON to stderr with `error.code`

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/cli.test.ts test/unit/commands.test.ts`

Expected: FAIL because the CLI still emits per-command JSON or table output without a shared envelope.

**Step 3: Implement the minimal contract**

Build a shared envelope layer and route `--json` through it in `src/cli.ts`. Do not refactor every command at once; add a central adapter path that command handlers can adopt incrementally.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/cli.test.ts test/unit/commands.test.ts`

Expected: PASS for the new contract cases.

**Step 5: Commit and push**

```bash
git checkout -b feat/skills-backend-migration
git add src/agent/envelope.ts src/agent/errors.ts src/agent/types.ts src/cli.ts src/index.ts test/unit/cli.test.ts test/unit/commands.test.ts
git commit -m "feat: add agent json contract for skills"
git push -u origin feat/skills-backend-migration
```

---

### Task 2: Add deterministic plan infrastructure

**Files:**
- Create: `src/plans/index.ts`
- Create: `src/plans/evm.ts`
- Create: `src/plans/xrpl.ts`
- Create: `src/plans/defi.ts`
- Create: `src/policy/index.ts`
- Modify: `src/types/index.ts`
- Test: `test/unit/commands.test.ts`
- Test: `test/unit/config.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- plan files are written to a stable local directory
- `plan_id` is deterministic for identical inputs
- tampered plan files fail integrity checks
- mainnet actions require confirmation metadata

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/commands.test.ts test/unit/config.test.ts`

Expected: FAIL because there is no reusable plan layer or confirmation policy.

**Step 3: Implement the minimal plan system**

Create stable plan serialization, hashing, persistence, and load-time validation. Keep the plan schema generic enough to support EVM, XRPL, and DeFi multi-step actions.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/commands.test.ts test/unit/config.test.ts`

Expected: PASS for plan creation and validation scenarios.

**Step 5: Commit and push**

```bash
git add src/plans/index.ts src/plans/evm.ts src/plans/xrpl.ts src/plans/defi.ts src/policy/index.ts src/types/index.ts test/unit/commands.test.ts test/unit/config.test.ts
git commit -m "feat: add deterministic transaction plans"
git push
```

---

### Task 3: Add explicit local-wallet selection for skill flows

**Files:**
- Modify: `src/wallet/manager.ts`
- Modify: `src/utils/secrets.ts`
- Modify: `src/types/index.ts`
- Modify: `src/commands/send.cmd.ts`
- Modify: `src/commands/eth/approve.cmd.ts`
- Modify: `src/commands/xrpl/trustline.cmd.ts`
- Test: `test/unit/wallet.test.ts`
- Test: `test/unit/secrets.test.ts`
- Test: `test/unit/commands.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- `--wallet`, `--from-wallet`, and `--owner-wallet`
- wrong-chain wallet selection errors
- missing wallet password errors in machine mode
- JSON error output for wallet resolution failures

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/wallet.test.ts test/unit/secrets.test.ts test/unit/commands.test.ts`

Expected: FAIL because mutating commands still depend on implicit default wallets.

**Step 3: Implement the minimal wallet-selection layer**

Keep the local encrypted-wallet model, but make wallet selection explicit and machine-safe for all skill-facing commands.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/wallet.test.ts test/unit/secrets.test.ts test/unit/commands.test.ts`

Expected: PASS for wallet selection and failure cases.

**Step 5: Commit and push**

```bash
git add src/wallet/manager.ts src/utils/secrets.ts src/types/index.ts src/commands/send.cmd.ts src/commands/eth/approve.cmd.ts src/commands/xrpl/trustline.cmd.ts test/unit/wallet.test.ts test/unit/secrets.test.ts test/unit/commands.test.ts
git commit -m "feat: add explicit wallet selection for agent flows"
git push
```

---

### Task 4: Implement EVM `prepare -> execute -> wait -> receipt`

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/commands/send.cmd.ts`
- Modify: `src/commands/eth/approve.cmd.ts`
- Modify: `src/commands/tx.cmd.ts`
- Modify: `src/clients/evm-client.ts`
- Modify: `src/utils/amounts.ts`
- Test: `test/unit/commands.test.ts`
- Test: `test/e2e/cli.e2e.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- `rlusd evm transfer prepare`
- `rlusd evm transfer execute`
- `rlusd evm approve prepare`
- `rlusd evm approve execute`
- `rlusd evm tx wait`
- `rlusd evm tx receipt`

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/commands.test.ts test/e2e/cli.e2e.test.ts`

Expected: FAIL because the current EVM flow is one-shot send/approve oriented.

**Step 3: Implement the minimal EVM agent flow**

Use the new plan layer instead of immediate submit. Keep existing on-chain logic where possible, but route it through prepared intent objects and confirmation checks.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/commands.test.ts test/e2e/cli.e2e.test.ts`

Expected: PASS for EVM planning, execution, wait, and receipt paths.

**Step 5: Commit and push**

```bash
git add src/cli.ts src/commands/send.cmd.ts src/commands/eth/approve.cmd.ts src/commands/tx.cmd.ts src/clients/evm-client.ts src/utils/amounts.ts test/unit/commands.test.ts test/e2e/cli.e2e.test.ts
git commit -m "feat: add evm prepare execute wait receipt flows"
git push
```

---

### Task 5: Implement XRPL `prepare -> execute -> wait -> receipt`

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/commands/xrpl/trustline.cmd.ts`
- Create: `src/commands/xrpl/payment.cmd.ts`
- Modify: `src/commands/tx.cmd.ts`
- Modify: `src/clients/xrpl-client.ts`
- Modify: `src/utils/address.ts`
- Test: `test/unit/address.test.ts`
- Test: `test/unit/commands.test.ts`
- Test: `test/e2e/cli.e2e.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- `rlusd xrpl trustline prepare`
- `rlusd xrpl trustline execute`
- `rlusd xrpl account info`
- `rlusd xrpl payment prepare`
- `rlusd xrpl payment execute`
- `rlusd xrpl tx wait`
- `rlusd xrpl payment receipt`
- destination trust-line prerequisite failures

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/address.test.ts test/unit/commands.test.ts test/e2e/cli.e2e.test.ts`

Expected: FAIL because trust-line setup is one-shot and there is no payment plan command family.

**Step 3: Implement the minimal XRPL agent flow**

Add a proper payment command module, unify trust-line and payment planning, and normalize XRPL wait/receipt output for machine consumers.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/address.test.ts test/unit/commands.test.ts test/e2e/cli.e2e.test.ts`

Expected: PASS for XRPL planning, execution, wait, receipt, and trust-line prerequisite checks.

**Step 5: Commit and push**

```bash
git add src/cli.ts src/commands/xrpl/trustline.cmd.ts src/commands/xrpl/payment.cmd.ts src/commands/tx.cmd.ts src/clients/xrpl-client.ts src/utils/address.ts test/unit/address.test.ts test/unit/commands.test.ts test/e2e/cli.e2e.test.ts
git commit -m "feat: add xrpl prepare execute wait receipt flows"
git push
```

---

### Task 6: Add live DeFi quote and planned supply flows

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/commands/eth/swap.cmd.ts`
- Modify: `src/commands/eth/defi.cmd.ts`
- Modify: `src/services/gas-estimator.ts`
- Modify: `src/services/price-feed.ts`
- Modify: `src/abi/uniswap-router.ts`
- Modify: `src/abi/aave-pool.ts`
- Test: `test/unit/services.test.ts`
- Test: `test/unit/commands.test.ts`
- Test: `test/e2e/cli.e2e.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- `rlusd defi venues` returns venue metadata in the shared envelope
- `rlusd defi quote swap` returns live quote metadata, TTL, and warnings
- `rlusd defi supply preview` returns preview-only data
- `rlusd defi supply prepare` returns a multi-step plan
- `rlusd defi supply execute` returns per-step hashes

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/services.test.ts test/unit/commands.test.ts test/e2e/cli.e2e.test.ts`

Expected: FAIL because current DeFi logic is human-oriented and not normalized for skills.

**Step 3: Implement the minimal DeFi agent flow**

Make `quote swap` live and read-only. Keep DeFi execution behind prepared plans and confirmation. Return staleness metadata so skills can describe quote freshness honestly.

**Step 4: Run tests to verify pass**

Run: `npm test -- test/unit/services.test.ts test/unit/commands.test.ts test/e2e/cli.e2e.test.ts`

Expected: PASS for venue discovery, live quotes, preview, prepare, and execute.

**Step 5: Commit and push**

```bash
git add src/cli.ts src/commands/eth/swap.cmd.ts src/commands/eth/defi.cmd.ts src/services/gas-estimator.ts src/services/price-feed.ts src/abi/uniswap-router.ts src/abi/aave-pool.ts test/unit/services.test.ts test/unit/commands.test.ts test/e2e/cli.e2e.test.ts
git commit -m "feat: add live defi quotes and planned supply flows"
git push
```

---

### Task 7: Add resolve and fiat guidance commands, then finish docs

**Files:**
- Create: `src/commands/resolve.cmd.ts`
- Create: `src/commands/fiat.cmd.ts`
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `docs/FRAMEWORK.md`
- Test: `test/unit/cli.test.ts`
- Test: `test/unit/commands.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- `rlusd resolve asset`
- `rlusd fiat onboarding checklist`
- `rlusd fiat buy instructions`
- `rlusd fiat redeem instructions`

**Step 2: Run tests to verify failure**

Run: `npm test -- test/unit/cli.test.ts test/unit/commands.test.ts`

Expected: FAIL because these command families do not exist yet.

**Step 3: Implement the minimal command surface and docs**

Add the missing command modules, register them in `src/cli.ts`, and update the README/framework docs so `rlusd-skills` can point at a stable public surface.

**Step 4: Run the full verification**

Run:
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Expected: PASS for all four commands.

**Step 5: Commit and push**

```bash
git add src/commands/resolve.cmd.ts src/commands/fiat.cmd.ts src/cli.ts README.md docs/FRAMEWORK.md test/unit/cli.test.ts test/unit/commands.test.ts
git commit -m "feat: add resolve and fiat commands for skills"
git push
```

---

### Task 8: Publish the cutover-ready CLI contract

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `docs/FRAMEWORK.md`

**Step 1: Verify release notes and migration notes**

Document:
- new skill-facing command families
- explicit local-wallet flags
- live quote semantics
- `prepare -> review -> execute`

**Step 2: Run final verification**

Run:
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

Expected: PASS with no pending contract gaps for `rlusd-skills`.

**Step 3: Commit and push**

```bash
git add README.md package.json docs/FRAMEWORK.md
git commit -m "docs: publish skills backend migration notes"
git push
```

---

## Handoff Checklist For `rlusd-skills`

Before opening the matching `rlusd-skills` branch, confirm:
- the branch `feat/skills-backend-migration` is pushed
- all skill-facing commands are callable locally
- `--json` responses match the shared envelope
- write flows require plan review and confirmation
- live `defi quote swap` returns TTL or expiry metadata

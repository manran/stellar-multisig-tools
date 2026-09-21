---
title: "MultiSig Tools Mainnet Smoke Plan — Draft"
description: "Internal MultiSig Tools engineering documentation."
---

**Status:** Draft only; not approved for execution
**Mainnet managed Classic:** disabled
**Purpose:** Bound the first Mainnet validation after production channel lifecycle, funding, Firewall, DB recovery, and operator policies are complete.

This plan must not be executed merely because the code is deployed. It requires explicit approval at execution time.

## Preconditions

All must be true before any Mainnet mutation:

- canonical/public deployment change explicitly approved;
- PostgreSQL recovery drill completed;
- Mainnet private-context storage verified;
- semantic Firewall limits reviewed and configured if required by launch policy;
- production Managed Classic channel lifecycle designed;
- channel accounts provisioned/funded under that design;
- low-balance and spend-budget policy decided;
- webhook Queue/Cron/signing config verified on the Mainnet project;
- operator emergency-disable procedure available;
- current Testnet release remains rollback-ready.

If any precondition is false, stop before creating a Mainnet Request/Intent.

## Phase 1 — read-only

No signatures, no Request/Intent creation, no transaction submission.

Verify:

1. `/api/runtime-config` reports:
   - `fixedNetwork=public`;
   - managed Classic capability is exactly the intended launch state.
2. `/openapi.json` returns 200.
3. Human entry pages load without cross-network leakage.
4. Operator-only Integration administration remains protected.
5. Managed-channel operator view, if enabled, shows only expected public channel identities and operational facts.
6. Mainnet Queue/Cron/signing environment presence is verified without printing values.
7. Vercel runtime errors are clean for the deployment.

## Phase 2 — one bounded Classic managed transaction

Only after Phase 1 is clean and an explicitly funded Mainnet channel is selected.

Use one dedicated canary Integration and one dedicated low-value Treasury/account chosen for the smoke.

Verify:

1. Integration creates one semantic Classic Request.
2. MST reserves exactly one managed transaction-source channel.
3. Transaction fee bid uses the current Mainnet base fee × 50 policy.
4. Treasury signer authority remains independent from the channel source signature.
5. Required signer contribution(s) complete.
6. MST submits exactly one authorized transaction.
7. Ledger confirmation matches the expected destination/amount.
8. Channel lease releases or reaches the expected terminal state.
9. Integration Activity / webhook evidence records the result.

Do not batch multiple business cases into this first Mainnet smoke.

## Phase 3 — external execution control

Use a separate canary Request only if external execution is part of launch scope.

Verify:

- MST coordinates authorization but does not submit;
- exported/handed-off XDR is exact;
- reconciliation records the eventual ledger result;
- MST never claims execution ownership it did not have.

If external execution is not launch scope, skip this phase.

## Abort conditions

Immediately stop further Mainnet mutation if any of these occur:

- unexpected network/source account;
- channel pool identity mismatch;
- fee policy mismatch;
- signature/authority mismatch;
- duplicate submission;
- webhook payload contains private XDR/AUTH/private-note material;
- PostgreSQL/runtime inconsistency;
- unexplained Vercel/runtime error cluster;
- operator cannot disable the canary Integration.

## Rollback boundary

Application-only regression:

```text
rollback Vercel application deployment
-> keep PostgreSQL authority
-> bounded read-only smoke
```

Data-integrity concern:

```text
freeze coordination writes
-> investigate/restore PostgreSQL from verified recovery point
-> verify canonical facts
-> redeploy if needed
-> unfreeze
```

Never treat historical Blob coordination objects as the normal rollback authority after PostgreSQL has accepted newer facts.

## Evidence to retain

Record only non-secret evidence:

- deployment id / Git SHA;
- network;
- canary Service id;
- public channel account;
- transaction hash and ledger;
- Request/Intent ids;
- relevant status/error codes;
- webhook delivery id/outcome;
- smoke timestamps.

Never record:

- `mia_*`, `msi_*`, webhook secrets;
- Stellar seeds;
- database credentials;
- private notes;
- raw detached AUTH signatures beyond what existing secure test artifacts already require.

## Approval gate

Before Phase 2, review this plan again against the final production channel lifecycle and fee/spend policies. Explicit approval is required at that time.

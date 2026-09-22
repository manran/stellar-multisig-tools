---
title: "MultiSig Tools Mainnet Smoke Plan — Draft"
description: "Internal MultiSig Tools engineering documentation."
---

**Status:** Draft for mutation; isolated read-only/fail-closed skeleton validated 2026-09-22
**Mainnet managed Classic:** explicitly disabled
**Purpose:** Separate safe deployment proof from the first Mainnet mutation after storage, funding, Firewall, recovery, and operator policies are complete.

The existence of Mainnet code deployments is not approval to mutate Mainnet state. Phase 0 below is intentionally state-less/fail-closed. Any later mutation requires the explicit approval gate at the end of this document.

## Phase 0 — isolated prelaunch skeleton — COMPLETE

Completed on 2026-09-22 without binding `stellar.multisig.tools` or `api.multisig.tools`:

- backend project `multisig-tools-mainnet` (`apps/stellar-api`) deployed fixed to `public` with `MULTISIG_COORDINATION_WRITE_FREEZE=1`, `MULTISIG_COORDINATION_STORAGE=blob`, `MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED=false`, no PostgreSQL/Blob/admin/webhook/channel secrets, and no Git auto-deploy connection;
- backend runtime reports `fixedNetwork=public` and `classicManagedExecution.public=false`; public discovery exposes 36 operations and OpenAPI contains no internal `/api/*` paths;
- direct backend-internal `POST /api/request` is rejected before persistence with `503 coordination_write_frozen`;
- gateway project `multisig-tools-api-gateway-mainnet` forwards `/stellar/*` to the isolated backend and preserves the same fixed-public/frozen behavior;
- Web project `multisig-tools-web-mainnet` is fixed to `public`, forwards same-origin `/api/*` through the isolated gateway, returns `409 testnet_integration_self_service_unavailable` for Testnet self-service, and its Vercel deployment is `noindex`;
- the three Mainnet projects are intentionally not Git-connected during prelaunch isolation;
- the legacy `stellar.multisig.tools` deployment remains untouched and `api.multisig.tools` is not DNS-bound.

Phase 0 proves deployment/network boundaries only. It does not prove Mainnet persistence, private storage, operator secrets, managed-channel funding, webhook delivery, Firewall policy, or mutation safety.

## Preconditions

All must be true before any Mainnet mutation:

- canonical/public domain cutover and mutation scope explicitly approved;
- independent Mainnet PostgreSQL is connected, migrated, recovery-drilled, and verified;
- Mainnet private-context Blob storage is connected and write/read verified;
- `MULTISIG_COORDINATION_WRITE_FREEZE` is removed only after the storage checks above pass;
- semantic Firewall limits are reviewed and configured for the launch deployment;
- webhook Queue/Cron/signing config is verified on the Mainnet backend project;
- operator emergency-disable procedure is available;
- current Testnet release remains rollback-ready;
- for managed Classic specifically: production channel lifecycle is designed, creator/channels are explicitly funded, alert destination is configured, spend policy is enforced, and `MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED=true` is set only after those prerequisites and explicit Phase 2 approval.

If any precondition is false, stop before creating a Mainnet Request/Intent.

## Phase 1 — read-only

No signatures, no Request/Intent creation, no transaction submission.

Verify:

1. `GET https://api.multisig.tools/stellar/runtime-config` reports:
   - `fixedNetwork=public`;
   - managed Classic capability is exactly the intended launch state.
2. `GET https://api.multisig.tools/stellar/openapi.json` returns 200 and publishes protocol-relative paths without internal `/api/*` implementation paths.
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

Before Phase 1 against public custom domains, confirm the domain cutover itself is approved. Before Phase 2, review this plan again against the final production channel lifecycle, funding, alerting, Firewall, recovery, and fee/spend policies. Explicit approval is required at that time, followed by the deliberate `MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED=true` transition only if managed Classic is in launch scope.

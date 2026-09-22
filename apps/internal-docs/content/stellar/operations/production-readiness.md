---
title: "MultiSig Tools Production Readiness"
description: "Internal MultiSig Tools engineering documentation."
---

**Status:** Testnet current topology ready; Mainnet prelaunch skeleton ready; Mainnet managed execution not ready
**Current code baseline:** `c6c9e93` (`feat/monorepo-deployment-topology`)
**Testnet topology:** Human Web -> Testnet API Gateway -> fixed-Testnet Stellar API
**Mainnet topology:** isolated fixed-Mainnet Web/Gateway/API skeleton only; no public custom-domain cutover
**Updated:** 2026-09-22

This document is the operational gate after the Hallmark/UI freeze. It does not redefine signer authority, Request/Intent semantics, or execution ownership.

## 1. Current release decision

### Testnet RC — GO

Verified:

- final application gate: **820 / 820 PASS**;
- PostgreSQL integration gate: **29 / 29 PASS**;
- production build PASS;
- `git diff --check` PASS;
- Testnet Human Web, API Gateway, and Stellar API are physically separate READY deployments;
- `stellar-testnet.multisig.tools` serves `apps/web` and keeps browser `/api/*` same-origin while forwarding through `api-testnet.multisig.tools/stellar`;
- `api-testnet.multisig.tools/stellar` exposes 36 public operations with no internal `/api/*` paths in the published contract;
- live runtime is fixed Testnet;
- managed Classic requires both a configured channel master secret and explicit `MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED=true`; Testnet is enabled and public/Mainnet remains disabled;
- 20/20 non-mutating production browser smoke checks PASS at 375 and 1280;
- Soroban Import -> Review -> live RPC simulation PASS without signing or submission;
- public Testnet Integration self-service is live at `/developers/integrations/new` and `POST https://api-testnet.multisig.tools/stellar/integration-testnet`;
- self-service returns a Testnet-only `msi_*` without `mia_*`, signer authority, or Mainnet entitlement.

The 2026-09-20 real-chain Managed Classic E2E remains authoritative for authority/execution behavior because the Hallmark RC did not change Request/Intent authority, managed-channel lease logic, PostgreSQL repositories, webhook delivery, or transaction submission core.

### Mainnet managed Classic — NO-GO

Intentional blockers remain:

- an isolated Mainnet Web/Gateway/API skeleton now exists and is fixed to `public`; it has an independently connected private OIDC Blob store but remains deliberately write-frozen with no Mainnet PostgreSQL/admin/webhook/channel secrets, and is not bound to `stellar.multisig.tools` or `api.multisig.tools`;
- `stellar.multisig.tools` still serves the legacy `feat/stellar-mvp` deployment (`fa14599a...`); no canonical Human cutover has been approved;
- `api.multisig.tools` has no public DNS/domain binding yet;
- Mainnet creator/account activation and the human refill/emergency procedure have not yet been executed/verified;
- creator/channel capacity policy is implemented (about 1000 XLM creator target, 2 XLM/channel, low <50, recover >=60, half-full soft-limit doubling), but the final HTTPS/Telegram alert destination is not configured;
- per-transaction fee bid is fixed at 50x latest network base fee for MST-managed Classic, but cumulative spend-budget policy is not defined;
- semantic Firewall rules `request-create`, `treasury-admin`, and `agent-access-admin` are not yet configured for the Mainnet launch deployment;
- independent Mainnet PostgreSQL has not yet been selected/connected, so provider recovery has not been drill-tested for Mainnet;
- Mainnet managed Classic capability remains explicitly disabled.

Do not enable Mainnet managed Classic until those items are closed.

## 2. Persistence / database

### Verified in code and tests

- PostgreSQL is the current coordination authority.
- Migrations exist through:
  - `0001_coordination`
  - `0002_private_context_flags`
  - `0003_outbox_leases`
  - `0004_webhook_delivery_history`
  - `0005_browser_authorization_capabilities`
  - `0006_classic_managed_channel_leases`
  - `0007_classic_managed_channel_index`
  - `0008_classic_managed_channel_creator_monitor`
- Runtime `DATABASE_URL` is configured in Testnet production.
- Migration `DATABASE_URL_UNPOOLED` is configured in Testnet production.
- `MULTISIG_COORDINATION_STORAGE` is configured.
- Transactional outbox atomicity and repository behavior are covered by PostgreSQL integration tests.
- Private note/private context remains outside relational coordination facts and uses the existing Blob private-store boundary.

### Important rollback rule

Once PostgreSQL has accepted PG-only facts after cutover, Blob is no longer a current rollback authority.

Standard long-running rollback is:

```text
freeze writes if integrity is in doubt
-> redeploy/rollback application while keeping PostgreSQL authority
-> if DB recovery is required, restore PostgreSQL from a verified recovery point
-> verify migrations + canonical facts + key read paths
-> re-enable writes
```

Do not switch `MULTISIG_COORDINATION_STORAGE=blob` after PG-only writes have accumulated.

### Recovery status / operator checks still required

- Current Testnet PostgreSQL provider is **Neon**, verified from redacted Vercel production environment metadata without recording credentials.
- Local PostgreSQL 18 application-layer restore proof is complete: native dump/restore preserved 20 `mst_stellar` tables, migrations `0001` through `0008`, exact per-table row counts/content digests, and the restored database reports no pending migrations.
- A separate fresh-Mainnet provider-agnostic preflight completed on 2026-09-22: zero-state migrations `0001` through `0008`, **29 / 29** PostgreSQL integration tests, native `pg_dump -Fc` -> clean restore, recovery verifier PASS, and 20 / 20 table row counts identical between source and restore.
- `npm run db:verify-recovery` is a read-only recovery verifier and fails closed on migration mismatch.
- The verifier also passed against the live Testnet Neon database without writes: 8 migrations and all 20 `mst_stellar` base tables were readable.
- Canonical operator procedure: `POSTGRES_RECOVERY_RUNBOOK.md`.

Before Mainnet:

- select and provision the actual independent Mainnet PostgreSQL provider/host; no production provider has been chosen yet;
- connect and migrate that database while the Mainnet backend remains write-frozen;
- execute that provider's isolated PITR/snapshot/recovery path and record configured retention/recovery capability and observed recovery time;
- document who can initiate restore and how provider recovery access is controlled;
- after restore, verify migration versions, canonical Request/Intent facts, Inbox/Activity, and bounded read smoke before unfreezing writes.

The local provider-agnostic PostgreSQL 18 proof closes application/schema compatibility only. It does not count as the future production provider's recovery drill.

## 3. Managed Classic channels

### Current implementation

- managed Classic runtime requires both `MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET` and explicit `MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED=true`; a copied/configured master secret alone cannot enable execution;
- channel keypairs are deterministically derived from `MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET`;
- a **separate deterministic creator account** is derived from the same deployment master with a different domain tag; it exists only to create/fund managed channel accounts and is not a Treasury signer or transaction-source channel;
- Testnet production has the master secret configured and the creator account active;
- `MULTISIG_CLASSIC_CHANNEL_POOL_SIZE` is not explicitly set, so the configured **baseline is 4 channels**;
- `MULTISIG_CLASSIC_CHANNEL_SOFT_LIMIT` starts at **64** and is a soft operational threshold, not a derivation cap; deterministic derivation is valid beyond it (tests cover index 64 and index 4096);
- the effective soft limit follows a deterministic half-full doubling policy: 64 -> 128 when 32 slots have been allocated, 128 -> 256 at 64 allocated slots, and so on; no separate capacity state is persisted;
- baseline channels are tried first; expansion slots continue deterministically as 4, 5, 6, ...;
- PostgreSQL migration `0007_classic_managed_channel_index` persists `channel_index` with the lease so replay can recover channels beyond any soft threshold without scanning a fixed address window;
- v1 allows one active Request lease per channel;
- PostgreSQL lease uniqueness arbitrates concurrent expansion without sequence pipelining;
- expired leases are reclaimed lazily and atomically by the next claim; no periodic lease-cleanup job is required because the table is keyed by `(network, channel_account)` and therefore retains at most one current/last lease row per created channel;
- successful managed submission and failed pre-durable creation paths release the Request lease explicitly; an expired row may remain as last-occupancy evidence until the channel is reused;
- sequence pipelining is deliberately not used;
- when a derived channel does not exist on-chain, the creator submits an ordinary Stellar `CreateAccount` transaction; the default new-channel balance is **2 XLM** (`MULTISIG_CLASSIC_CHANNEL_INITIAL_BALANCE` may override it);
- production creator funding target is approximately **1000 XLM** before enabling Mainnet managed execution;
- creator balance policy defaults to **low below 50 XLM** and **recovered at 60 XLM or above**; low balance does not stop work while another channel can still be created;
- true creator capacity exhaustion is calculated from current creator reserve/liabilities + the 2-XLM channel funding amount + transaction fee, not from the 50-XLM warning threshold;
- when capacity is genuinely insufficient, only work that requires creating a new channel fails with `503 managed_execution_capacity_temporarily_unavailable`; existing Requests and already-created free channels are unaffected;
- creator submission reconciles outcome-unknown responses and rebuilds on creator `tx_bad_seq` using bounded retries;
- **managed-channel runtime contains no Friendbot provisioning path**; a one-time Testnet faucet funding of the creator is an operator bootstrap action only;
- creator state transitions are durably de-duplicated in PostgreSQL (`0008_classic_managed_channel_creator_monitor`); alert delivery uses an atomic per-state claim so concurrent serverless invocations do not duplicate low/exhausted alerts, and a failed delivery releases the claim for retry;
- optional generic HTTPS alerts use `MULTISIG_CLASSIC_CHANNEL_ALERT_WEBHOOK_URL`; the body is a simple JSON `{ "text": "..." }`, so a Telegram Bot `sendMessage` URL with `chat_id` in the URL can be used without coupling Telegram into core logic;
- alert events are `creator.low_balance`, `creator.capacity_exhausted`, and `creator.balance_recovered`; alert transport failure is logged but never blocks business execution; when no alert URL is configured, state is recorded but no delivery claim is consumed, so configuring a URL later can still deliver the active low/exhausted alert;
- MST-managed Classic bids 50x the latest network base fee; external/self-submit keeps the ordinary network fee path;
- Mainnet managed Classic remains disabled; before future enablement, the creator account must be explicitly activated/funded under the production policy.

### Testnet horizontal-expansion / creator proof — COMPLETE

Sequence-source expansion was first proven on 2026-09-21 with the 5-Request + 3-concurrent-Request E2E artifacts below: every active Request received a distinct transaction source and PostgreSQL lease arbitration avoided sequence collisions. Those original artifacts predate the creator-account cutover and therefore preserve historical funding evidence only; they remain valid for the **horizontal sequence-source mechanism**, not for the current provisioning method.

Current creator-account evidence on Stellar Testnet:

- creator account: `GD4KEGJWRO7UGRUWP34T3OYKGSCMEGQAFFFCZ3J2OFKE74OKWJZ5X3RD`;
- live post-deploy monitor smoke reports creator balance `979.9999800 XLM`, state `ready`, low threshold `50`, recovery threshold `60`, and `3.0000100 XLM` required to create the next 2-XLM channel at the observed reserve/fee;
- PostgreSQL `0008_classic_managed_channel_creator_monitor` persisted the same `ready` state; `alertedAt` is null as expected because no alert condition is active and no alert URL is configured;
- creator `CreateAccount` tx `6382194a23ccd410d0ebd5c2db05f116173ec09397032e376743ca41cbac0159` created `GBCCQRVVRFWMXC2WZMHFZ2SMQCUAR4TUPMNSIRXE5A72ZXE35QHMY35C` with `10.0000000 XLM` at `2026-09-21T04:37:57Z`;
- creator `CreateAccount` tx `6fb7f7011eb2c267117a8c2933499a34c0766991d938ce13660e53277f035e8b` created `GCDH2XCUU2KT52JSCYOYYAWLCG5SRBQSJ6Y3GQY3YLGTQZF43EYUJEKX` with `10.0000000 XLM` at `2026-09-21T04:38:27Z`;
- PostgreSQL records these as `channel_index=8` and `channel_index=9` respectively, proving durable deterministic-index recovery across the new migration;
- the temporary one-shot bootstrap endpoint used only to inspect/initialize creator state reported `already_active`; it was removed immediately and the clean deployment was force-rebuilt; the endpoint now returns 404;
- no managed-channel runtime code references Friendbot.

Historical sequence-expansion artifacts:

- `/opt/mst-e2e/testnet-selfservice-elastic-result.json`
- `/opt/mst-e2e/testnet-elastic-concurrency-result.json`

### Already protected

- channel lease ownership is persisted in PostgreSQL;
- duplicate reservation for the same Request is idempotent;
- pool exhaustion fails closed with `managed_classic_channel_pool_exhausted`;
- managed source signatures are restricted to the reserved transaction source;
- Treasury signer authority remains independent from the channel key.

### Operator visibility — implemented on Testnet

The operator-only `/admin/integrations` boundary remains separate from public Testnet Integration creation. Operator visibility distinguishes baseline capacity from the configured **soft limit** and can include expansion channels that actually have leases; it does not enumerate the unbounded deterministic derivation space.

The detailed managed-Classic view now exposes only public operational facts:

- configured baseline pool capacity and the current automatically grown soft limit;
- creator public address, current XLM balance/state (`ready` / `low` / `insufficient`), 50/60 thresholds, and the calculated balance required to create one more channel;
- active / expired / free lease state, including actually leased expansion channels;
- per-channel public G-address;
- current native XLM balance, or explicit missing/unavailable state;
- lease expiry time when present.

It deliberately does **not** expose channel seeds, Request ids, Service ids, signer material, or any funding action.

Verification completed:

- pure projection tests cover active/expired/free lease classification, balance ready/missing/unavailable states, creator capacity, 50/60 hysteresis, half-full soft-limit doubling, alert transition de-duplication, and capacity-exhaustion fail-closed behavior;
- full suite: **820 / 820 PASS**;
- PostgreSQL integration suite: **29 / 29 PASS**;
- production build PASS;
- `git diff --check` PASS;
- current Testnet split topology is READY: `stellar-testnet.multisig.tools` -> Web -> `api-testnet.multisig.tools/stellar` -> `multisig-tools-testnet.vercel.app`;
- live OpenAPI has no 64 maximum on `channelCount` and documents the current auto-doubling soft-limit policy;
- live runtime remains fixed Testnet with managed Classic enabled only for Testnet;
- live creator monitor smoke wrote/read the `ready` state through Horizon + PostgreSQL without creating a channel;
- `MULTISIG_CLASSIC_CHANNEL_ALERT_WEBHOOK_URL` is intentionally absent; defaults for 2 XLM / 50 / 60 / base soft-limit 64 are active;
- Vercel reported no runtime error clusters in the checked post-deploy window.

Operator verification completed manually on 2026-09-21: the authenticated deployment view showed live channel balances and lease state, including expired leases. For the current Testnet stage, this is sufficient evidence for the operator visibility slice.

### Remaining operator controls

Before Mainnet managed execution:

1. **Production channel lifecycle design**
   - deterministic derivation + dedicated creator-account provisioning are proven on Testnet;
   - decided policy: approximately 1000 XLM initial creator funding, 2 XLM per new channel, low warning below 50 XLM, recovery at 60 XLM, and automatic soft-limit doubling at half utilization;
   - still to decide before Mainnet: refill operator procedure, final alert destination/credentials, channel refill/drain policy after creation, replacement/rotation, and master-secret recovery;
   - stale/expired lease cleanup is resolved as lazy atomic reclaim rather than a periodic cleanup job;
   - the soft limit is not a derivation cap and must not be treated as production maximum capacity.

2. **Low-funds / capacity policy — implemented, destination pending**
   - low balance warns but continues creating channels while reserve math says another channel can be funded;
   - true insufficient capacity fails only new expansion with stable 503 `managed_execution_capacity_temporarily_unavailable` and a user-facing message that existing Requests are unaffected;
   - generic HTTPS alert transport is implemented; no Testnet/production alert URL is configured in this repository because the operator has not selected the final Telegram/other endpoint yet.

3. **Spend/budget control**
   - the per-transaction fee-bid policy is now fixed: 50x latest network base fee for MST-managed Classic;
   - cumulative spend control is separate: define per-Service / per-period limits only when production abuse policy is discussed;
   - fail closed before accepting new MST-funded work once a future production budget is exhausted.

Do not conflate semantic write-rate limits with spend control. The existing `request-create` semantic rate limit limits durable creation pressure; it is not a financial budget.

## 4. Abuse / quota controls

### Implemented application boundary

Semantic Vercel Firewall rate-limit checks exist for:

- Request/Intent creation;
- Treasury administration;
- Agent access administration.

The code uses verified identities as rate-limit keys and returns stable 429/503 errors.

### Platform status — rules currently missing

The application deliberately treats a missing Vercel rate-limit rule as “not configured” and logs a warning rather than pretending the rule exists.

A read-only Vercel Firewall configuration check on 2026-09-21 confirmed that all three application rule ids are currently missing from **both** the Testnet project and the canonical/public project:

- `request-create` — missing;
- `treasury-admin` — missing;
- `agent-access-admin` — missing.

Therefore the semantic rate-limit hook exists in application code but is **not currently enforcing a platform limit**. This is acceptable as an explicit Testnet limitation, but Mainnet launch requires the rules to be created with reviewed policy values. Do not invent those limits in code; they are an operator/product policy decision.

## 5. Integration credentials / operator admin

### Implemented

- Testnet Integration Profile creation is public/self-service through `/developers/integrations/new` and `POST https://api-testnet.multisig.tools/stellar/integration-testnet`;
- self-service creation forcibly produces an enabled, Testnet-only profile and reuses the existing durable `msi_*` credential model;
- Testnet production has `MULTISIG_INTEGRATION_ADMIN_SECRET_HASH` configured for operator lifecycle actions;
- the operator-only `/admin/integrations` surface remains the current disable/rotate/advanced-management boundary and is not ordinary product navigation.
- Integration `msi_*` credentials can be created, disabled and rotated.
- Durable storage retains verifier hashes rather than plaintext credentials.
- A rotated credential is returned once.
- A durable disabled Integration record suppresses bootstrap credentials with the same Service id.
- Webhook configuration is independently enable/disable-able.

### Emergency disable / credential rotation procedure

For a suspected compromised Service credential (`msi_*`):

1. Open `/admin/integrations` with the deployment `mia_*` operator credential.
2. Select the affected Service, open Advanced configuration, clear `Enabled`, and save. The durable disabled record overrides any bootstrap credential with the same `serviceId`, so Service authentication fails closed immediately after the update is visible.
3. Investigate affected Request/Intent activity. Disabling the Service prevents new authenticated Integration actions; it does not erase already disclosed Stellar signatures/AUTH/XDR or rewrite ledger history.
4. Rotate the MSI credential while the Service remains disabled. Store the newly returned plaintext only in the Service owner's server-side secret store.
5. Notify the Service owner, update their deployment, then re-enable the Service only after the new credential is confirmed.

For a compromised webhook signing secret:

1. Disable webhook delivery for the affected Service if immediate containment is required.
2. Rotate the webhook signing secret from the operator surface; the new secret is returned once.
3. Update the receiver and verify Standard Webhooks signatures with the new secret.
4. Re-enable delivery.

For a compromised operator credential (`mia_*`):

1. Generate a replacement with `npm run integration:admin-secret` in a trusted operator environment.
2. Update only `MULTISIG_INTEGRATION_ADMIN_SECRET_HASH` in the deployment environment; do not store the plaintext in repo or docs.
3. Redeploy so the old `mia_*` no longer verifies.
4. Confirm `/admin/integrations` accepts only the replacement credential.

Credential rotation is event-driven rather than time-based: rotate on suspected disclosure, owner/operator turnover, or secret-store compromise. Periodic rotation may be added by policy later, but no arbitrary schedule is imposed here.

Do not place plaintext `mia_*`, `msi_*`, webhook secrets, Stellar seeds, or database credentials in repo/runbooks.

## 6. Webhook delivery

### Implemented

- PostgreSQL transactional outbox;
- exclusive lease/claim;
- bounded retry/backoff;
- crash/lease-expiry reclaim;
- signed Standard Webhooks payload;
- per-Service signing-secret version;
- operator webhook-secret rotation;
- durable delivery history;
- Vercel Queue wake transport;
- hourly Cron sweep for missed wake recovery.

Testnet real E2E already proved PostgreSQL outbox -> webhook delivery on Managed Classic events.

### Testnet deployment verification

Verified on the current Testnet production deployment:

- `vercel.json` contains the Queue trigger for `api/integration-webhook-dispatch.ts` and hourly Cron for `/api/integration-webhook-sweep`;
- `MULTISIG_WEBHOOK_MASTER_SECRET`, `CRON_SECRET`, `DATABASE_URL`, and `MULTISIG_COORDINATION_STORAGE` are present;
- unauthenticated Cron access returns `401 webhook_sweep_unauthorized`;
- Queue/Cron deployment contract and adapter tests pass;
- real Managed Classic E2E already proved PostgreSQL outbox -> signed webhook delivery.

Before Mainnet launch:

- the isolated `multisig-tools-mainnet` backend skeleton already proves the current code can deploy fixed to `public`, but it intentionally runs with `MULTISIG_COORDINATION_STORAGE=blob`, `MULTISIG_COORDINATION_WRITE_FREEZE=1`, no webhook signing secret, and no Cron secret;
- connect, migrate, and recovery-verify the independent Mainnet PostgreSQL authority before removing the write freeze; the private Blob store is already connected and runtime-verified;
- configure Mainnet webhook master secret and Cron secret only after that storage boundary exists;
- verify the deployed Queue/Cron contract against the Mainnet backend project and prove one signed delivery path without changing the canonical Human domain;
- define alert threshold for prolonged unpublished outbox backlog or repeated retry/permanent-failure outcomes;
- expose or document a support query for delivery history without leaking callback URLs or signing secrets.

## 7. Blob/private storage

Private Request/Intent data still uses `@vercel/blob` in the PostgreSQL coordination model.

Mainnet private Blob is now provisioned independently from Testnet:

- Vercel Blob store `multisig-tools-mainnet` is private, region `iad1`;
- it is connected only to the `multisig-tools-mainnet` backend project for production/preview;
- credential mode is OIDC-only; no long-lived `BLOB_READ_WRITE_TOKEN` is installed;
- an isolated Preview deployment in the same Mainnet backend project exercised the real `@vercel/blob` runtime path with `put -> get -> exact content comparison -> delete -> confirm absent`; all checks passed;
- the temporary smoke route, bearer credential, test object, local smoke directory, and Preview deployment were removed immediately after verification;
- the clean Mainnet backend was then rebuilt as production deployment `dpl_GB7B3janNhyu5Ef7dCJz9jFeLsV1`; runtime remains fixed `public`, managed Classic remains disabled, and coordination writes remain frozen.

This closes the Mainnet private-Blob connectivity/read-write gate. PostgreSQL remains the storage blocker before coordination writes can be unfrozen.

## 8. Observability

### Current evidence

- stable business/API error codes exist across authority, storage, rate-limit and execution failures;
- Integration correlation/external reference is persisted and projected where appropriate;
- Vercel runtime errors can be inspected by project/deployment;
- Testnet RC post-deploy runtime-error query returned no error clusters.

### Remaining operational work

Before Mainnet:

- define the minimum dashboard/alert set for:
  - 5xx API rate;
  - `rate_limit_unavailable`;
  - managed channel pool exhaustion;
  - managed channel funding warnings;
  - unpublished/retrying webhook backlog;
  - PostgreSQL connectivity/migration failures;
  - repeated Stellar/RPC upstream failures.
- standardize a support correlation path from user-visible Request/Intent id to runtime logs without logging private notes, AUTH signatures or secrets.

Do not introduce a second telemetry state machine; logs/metrics should reference canonical ids and stored facts.

## 9. Deployment / rollback

### Testnet

Current split Testnet production topology:

- Human Web: `dpl_9rW1be9vEmKYi3EuQGAAo5c8RCAr` -> `stellar-testnet.multisig.tools`;
- API Gateway: `dpl_3fBm6UXBEdTQ9MyRMKxZbtdqmXk5` -> `api-testnet.multisig.tools`;
- Stellar API backend: `dpl_QmbAobn5LRzv7YrsvrXYiFxUoRrP` -> `multisig-tools-testnet.vercel.app`;
- backend runtime is fixed Testnet and reports `classicManagedExecution.testnet=true`, `public=false`.

Each Vercel project retains prior READY deployments as project-local rollback candidates. Roll back the affected layer rather than treating the three-layer system as one deployment.

For an application-only regression:

```text
rollback/redeploy previous known-good Vercel deployment
-> keep PostgreSQL authority unchanged
-> run bounded read/smoke checks
```

Historical Testnet application rollback drill completed on 2026-09-21 before the final Web/Gateway/API split:

- current deployment before drill: `dpl_FeQWfBamBYM2gHnPxfAhp1h7AoNR`;
- rolled back to previous known-good `dpl_2x9j1fUHpHD1vFFbUYpeWz52rjqF` using `vercel rollback`;
- rollback completed in about 2 seconds;
- post-rollback smoke: runtime-config 200/fixed Testnet, managed Classic Testnet=true, OpenAPI 200, Payment page 200, unauthenticated managed-channel detail remained 401 with zero G-address leakage;
- restored `dpl_FeQWfBamBYM2gHnPxfAhp1h7AoNR` using the same rollback mechanism;
- restored runtime-config and Payment page smoke passed.

That drill remains evidence for Vercel rollback mechanics. The current topology requires layer-specific rollback plus the same bounded end-to-end smoke. PostgreSQL authority and Mainnet remain untouched by application-only rollback.

For suspected data-integrity failure:

```text
freeze coordination writes
-> investigate/restore PostgreSQL
-> verify canonical facts
-> redeploy application if needed
-> re-enable writes
```

Never use stale Blob coordination objects as the normal long-running rollback target.

## 10. Documentation publication

Public Docs are now independently deployed at:

```text
https://docs.multisig.tools/stellar
```

The Human Web no longer owns `/docs` or `/developers` documentation routes. Product navigation links directly to the dedicated Docs origin, while `/developers/integrations/new` remains a Human application route.

Public Docs therefore do not depend on the legacy `stellar.multisig.tools` Mainnet deployment and no longer block Testnet documentation completeness.

The legacy `stellar.multisig.tools` project still serves `feat/stellar-mvp` at `fa14599a...`, but this is now solely a Mainnet Human/canonical cutover concern rather than a Docs publication concern.

## 11. Mainnet enablement gate

All of the following must be true before setting managed Classic public/Mainnet capability on:

- [x] isolated Mainnet Web/Gateway/API skeleton deployed from the current code baseline with fixed `public`, no public custom-domain cutover, writes frozen, and managed Classic disabled;
- [x] explicit managed-Classic enable gate implemented; the Mainnet skeleton sets `MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED=false` and a channel master secret alone cannot enable execution;
- [ ] canonical Human/domain cutover explicitly approved; `stellar.multisig.tools` still serves legacy `fa14599a...` and `api.multisig.tools` is not DNS-bound;
- [ ] independent Mainnet PostgreSQL authority connected, migrated, recovery-drilled, and verified before removing write freeze;
- [x] Mainnet private Blob store connected OIDC-only and runtime put/get/delete verified in an isolated Mainnet backend Preview;
- [ ] semantic Firewall rules created with reviewed limits (`request-create`, `treasury-admin`, `agent-access-admin`);
- [ ] managed channel public accounts explicitly provisioned and funded;
- [x] operator-only channel pool/capacity/balance visibility implemented and Testnet-deployed;
- [x] real operator login verified live lease/balance projection with `mia_*`;
- [ ] production managed-channel lifecycle design completed (activation/funding/expansion/rotation/recovery); Testnet deterministic lazy expansion is proven, but Mainnet policy is intentionally undecided;
- [ ] low-balance threshold + alert destination/credentials defined;
- [ ] spend/budget policy defined and enforced;
- [x] Testnet webhook Queue/Cron/signing config verified; Mainnet must configure and repeat the check after PostgreSQL/Blob are connected;
- [x] credential/admin emergency-disable procedure documented;
- [x] Vercel application rollback procedure tested on Testnet and current deployment restored;
- [ ] one bounded Mainnet mutation smoke explicitly reviewed and approved; the current Mainnet skeleton has completed only read-only/fail-closed prelaunch validation.

Until then:

```text
classicManagedExecution.public = false
```

is the correct production state.

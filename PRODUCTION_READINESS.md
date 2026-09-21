# MultiSig Tools Production Readiness

**Status:** Testnet RC ready; Mainnet managed execution not ready
**RC App SHA:** `6503b5fbb96a23f3e8be150ddf8d1d330ff9c864`
**Current Testnet hardening SHA:** `1b30dd9a659ca7f5562e6af8acb0bf6725746466`
**Testnet production deployment:** `dpl_2x9j1fUHpHD1vFFbUYpeWz52rjqF`
**Updated:** 2026-09-21

This document is the operational gate after the Hallmark/UI freeze. It does not redefine signer authority, Request/Intent semantics, or execution ownership.

## 1. Current release decision

### Testnet RC — GO

Verified:

- final application gate: **799 / 799 PASS**;
- production build PASS;
- `git diff --check` PASS;
- Testnet deployment READY and aliased to `stellar-testnet.multisig.tools`;
- 20/20 non-mutating production browser smoke checks PASS at 375 and 1280;
- checked routes returned 200 with zero horizontal overflow and zero console/page errors;
- Soroban Import -> Review -> live RPC simulation PASS without signing or submission;
- live runtime is fixed Testnet;
- managed Classic capability is enabled only for Testnet and remains disabled for public/Mainnet;
- Vercel reported no runtime error clusters in the checked post-deploy window;
- `/openapi.json` and `/api/operations` return 200.

The 2026-09-20 real-chain Managed Classic E2E remains authoritative for authority/execution behavior because the Hallmark RC did not change Request/Intent authority, managed-channel lease logic, PostgreSQL repositories, webhook delivery, or transaction submission core.

### Mainnet managed Classic — NO-GO

Intentional blockers remain:

- no explicit Mainnet managed-channel provisioning/funding process has been verified;
- operator-only channel visibility is implemented and deployed on Testnet, but the authenticated production projection still needs one operator login verification with the deployment `mia_*` credential;
- no low-funds policy/alert threshold is defined;
- no fee/spend budget policy exists for MST-funded transaction-source channels;
- semantic Firewall rules `request-create`, `treasury-admin`, and `agent-access-admin` are confirmed missing from the canonical/public Vercel project;
- provider database recovery has not been drill-tested for Mainnet;
- Mainnet managed Classic capability remains disabled.

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

### Operator checks still required

Before Mainnet:

- identify and document the actual database provider recovery mechanism;
- prove one restore/PITR/snapshot recovery in a non-production environment;
- record expected recovery-point and recovery-time behavior;
- document who can initiate restore and how credentials are controlled;
- after restore, verify migration versions and canonical Request/Intent reads before unfreezing writes.

A direct production aggregate DB inspection was intentionally not performed from this development session because it required injecting production database credentials into a local process and was blocked by the safety layer.

## 3. Managed Classic channels

### Current implementation

- channel keypairs are deterministically derived from `MULTISIG_CLASSIC_CHANNEL_MASTER_SECRET`;
- Testnet production has the master secret configured;
- `MULTISIG_CLASSIC_CHANNEL_POOL_SIZE` is not explicitly set, so the code default is **4 channels**;
- v1 allows one active Request lease per channel;
- expired leases are reclaimable;
- sequence pipelining is deliberately not used;
- Testnet may auto-provision missing channel accounts with Friendbot;
- Mainnet never auto-provisions/funds channels.

### Already protected

- channel lease ownership is persisted in PostgreSQL;
- duplicate reservation for the same Request is idempotent;
- pool exhaustion fails closed with `managed_classic_channel_pool_exhausted`;
- managed source signatures are restricted to the reserved transaction source;
- Treasury signer authority remains independent from the channel key.

### Operator visibility — implemented on Testnet

Checkpoint `1b30dd9` extends the existing operator-only `/admin/integrations` boundary; it does not create a new public endpoint or authority model.

The detailed managed-Classic view now exposes only public operational facts:

- configured pool capacity;
- active / expired / free lease state;
- per-channel public G-address;
- current native XLM balance, or explicit missing/unavailable state;
- lease expiry time when present.

It deliberately does **not** expose channel seeds, Request ids, Service ids, signer material, or any funding action.

Verification completed:

- pure projection tests cover active/expired/free lease classification and balance ready/missing/unavailable states;
- full suite: **801 / 801 PASS**;
- production build PASS;
- `git diff --check` PASS;
- 375 / 1280 operator-panel browser geometry: zero overflow / zero JS errors;
- Testnet production deployment `dpl_2x9j1fUHpHD1vFFbUYpeWz52rjqF` READY;
- unauthenticated detailed-view smoke returns 401 `integration_admin_credential_required` and leaks zero G-addresses;
- Testnet runtime/OpenAPI/admin shell/payment smoke remain 200;
- Vercel reported no runtime error clusters in the checked post-deploy window.

One operator-only check remains: log in with the real deployment `mia_*` credential and confirm that the live PostgreSQL lease projection and Horizon balances match the expected 4-channel pool. This development session intentionally did not retrieve the plaintext admin credential.

### Remaining operator controls

Before Mainnet managed execution:

1. **Low-funds policy**
   - operator-defined warning threshold;
   - alert destination;
   - explicit action when every usable channel is below threshold.

2. **Spend/budget control**
   - define what is budgeted: base fee only, resource fees if applicable, or other execution cost;
   - define per-Service / per-period limits if MST funds execution;
   - fail closed before accepting new MST-funded work once the budget is exhausted.

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

- Testnet production has `MULTISIG_INTEGRATION_ADMIN_SECRET_HASH` configured.
- The operator-only `/admin/integrations` surface is not ordinary product navigation.
- Integration `msi_*` credentials can be created, disabled and rotated.
- Durable storage retains verifier hashes rather than plaintext credentials.
- A rotated credential is returned once.
- A durable disabled Integration record suppresses bootstrap credentials with the same Service id.
- Webhook configuration is independently enable/disable-able.

### Operator procedure before Mainnet

Document:

- who holds the one-time `mia_*` operator credential;
- where it is stored;
- credential rotation frequency/trigger;
- emergency disable procedure;
- Service owner notification procedure after rotation.

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

### Operator checks before Mainnet

- verify webhook queue/cron deployment exists in the Mainnet project;
- verify webhook master secret is configured;
- verify receiver-side secret rotation procedure;
- define alert threshold for prolonged unpublished outbox backlog or repeated retry/permanent-failure outcomes;
- expose or document a support query for delivery history without leaking callback URLs or signing secrets.

## 7. Blob/private storage

Private Request/Intent data still uses `@vercel/blob` in the PostgreSQL coordination model.

Absence of a pulled `BLOB_READ_WRITE_TOKEN` is not sufficient to mark Blob unavailable: the implementation intentionally permits project-linked Vercel OIDC credentials resolved from request context.

Before Mainnet, verify one production-like private-context write/read in the target project without printing credentials.

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

Current Testnet app:

- RC UI baseline SHA: `6503b5fbb96a23f3e8be150ddf8d1d330ff9c864`
- operational hardening SHA: `1b30dd9a659ca7f5562e6af8acb0bf6725746466`
- deployment: `dpl_2x9j1fUHpHD1vFFbUYpeWz52rjqF`
- previous known-good production deployment `dpl_7r6f9wna3S91iacJeSK1fcnEy4zU` remains a rollback candidate

A prior READY production deployment remains available as a deployment rollback candidate.

For an application-only regression:

```text
rollback/redeploy previous known-good Vercel deployment
-> keep PostgreSQL authority unchanged
-> run bounded read/smoke checks
```

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

The new Developer Hub is present in RC source, but canonical content publication is incomplete.

Current routing contract intentionally sends Testnet:

- `/docs`
- `/docs/*`
- `/developers`
- `/demo`
- legal content

to `stellar.multisig.tools`.

The canonical/public project is still serving the older docs:

- `/developers` -> old Agent API page;
- `/docs/developers/testnet-quickstart` -> Page not found.

This does **not** block the Testnet App runtime, but it blocks declaring the Developer Docs publication complete.

Publishing the new docs changes the canonical/public project and therefore requires a separate explicit Mainnet/canonical deployment decision.

## 11. Mainnet enablement gate

All of the following must be true before setting managed Classic public/Mainnet capability on:

- [ ] canonical/public deployment change explicitly approved;
- [ ] Mainnet DB/persistence recovery drill completed;
- [ ] Mainnet private Blob read/write verified;
- [ ] semantic Firewall rules created with reviewed limits (`request-create`, `treasury-admin`, `agent-access-admin`);
- [ ] managed channel public accounts explicitly provisioned and funded;
- [x] operator-only channel pool/capacity/balance visibility implemented and Testnet-deployed;
- [ ] real operator login verifies live lease/balance projection with `mia_*`;
- [ ] low-balance threshold + alert policy defined;
- [ ] spend/budget policy defined and enforced;
- [ ] webhook Queue/Cron/signing config verified;
- [ ] credential/admin emergency-disable procedure documented;
- [ ] Vercel application rollback procedure tested;
- [ ] one bounded Mainnet smoke plan reviewed before execution.

Until then:

```text
classicManagedExecution.public = false
```

is the correct production state.

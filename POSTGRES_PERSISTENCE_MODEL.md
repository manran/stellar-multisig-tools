# PostgreSQL coordination persistence model

**Status:** frozen for implementation
**Date:** 2026-09-18
**Scope:** Stellar API coordination persistence only

## 1. Decision

PostgreSQL replaces Blob only where MST needs relational query, atomic uniqueness, cross-record transactions, or a transactional webhook outbox.

It does **not** become a universal storage layer, and it does **not** create a persisted universal Work state machine.

The authoritative protocol records remain separate:

- Classic: Request + signature/submission/activity facts.
- Soroban: Intent + AuthorizationPlan/AUTH/execution/cancellation facts.
- Human, Agent Task, and Integration Job remain deterministic projections over those facts.

A future Ripple implementation must earn its own working vertical slice. This design does not create Ripple tables, packages, or shared protocol abstractions in advance.

## 2. Why PostgreSQL now

Current Blob storage has reached three concrete limits:

1. Request discovery/activity requires manually maintained secondary indexes plus backfill/ready markers.
2. Integration needs efficient `serviceId -> work / execution / audit` queries across Classic and Soroban.
3. Reliable webhook delivery requires the business mutation and outbox insertion to commit atomically.

These are relational/transactional requirements, not a reason to migrate every Blob object.

## 3. PostgreSQL-owned facts

### Classic Request

PostgreSQL becomes authoritative for:

- Request core: id, network, XDR/hash, creation/expiry, creator provenance, Integration ownership/correlation, execution policy, capability hash, instruction digest, Soroban origin/effects baseline.
- discovery and Activity subjects;
- Request participants;
- signature contributions;
- submission result;
- durable Activity facts.

Private text/opening material is excluded; see section 4.

### Soroban Intent

PostgreSQL becomes authoritative for:

- Intent core and current AuthorizationPlan/revision/history;
- creator provenance and Integration ownership/correlation;
- discovery signer membership;
- execution policy/bind-once executor binding;
- detached AUTH contributions;
- execution preparations;
- independently observed execution results;
- immutable cancellation fact.

The Job state is **not** stored. It continues to be projected from these facts.

### Coordination uniqueness

PostgreSQL owns Agent idempotency claims because resource reservation and claim uniqueness must eventually share the same transaction as Request/Intent creation.

Integration idempotency continues to use the deterministic resource id plus exact replay validation; no second Integration-idempotency table is needed.

### Transactional outbox

PostgreSQL owns immutable Integration outbox events. The database outbox is an **internal coordination-change signal**, not the public webhook event contract. The mutation commits a deterministic `coordination.changed` event in the same transaction; the future worker reloads the canonical Request/Intent, derives the current Integration Job, and only then emits public `job.ready`, `job.completed`, `job.cancelled`, etc. This avoids persisting Job as a second state machine and avoids guessing business state inside a storage adapter.

Outbox payloads contain only business-safe identifiers and minimal change metadata; never raw signatures, AUTH XDR, private notes, capability tokens, credential secrets, or private-commitment openings.

Webhook endpoint configuration and delivery history are a later webhook slice; do not invent them in the coordination migration. Queue/worker transport is specified separately in `WEBHOOK_DELIVERY_MODEL.md`; the outbox remains the durable authority.

## 4. Blob-owned data that stays out of this migration

The following remain Blob-backed until a concrete requirement says otherwise:

- private note initial value and revisions;
- MEMO_HASH private commitment text + salt/opening;
- Address Book;
- Contract Workspace;
- Treasury Box metadata/audit;
- Auth server key and challenge-redemption store;
- Integration credential registry and secret hashes;
- Agent credential registry and secret hashes.

This is deliberate. None of these is required for Integration Service Activity or the transactional outbox.

At cutover, legacy Request/Intent root Blob objects become read-only migration sources, not a second authority. Runtime private context must be read from dedicated private-context Blob records, not from the legacy whole-resource object.

The relational root carries only a boolean presence flag (`classic_requests.has_private_data`, `soroban_intents.has_private_note`). Normal resources therefore read entirely from PostgreSQL; Blob is touched only when the authoritative SQL row says private context exists. The flag reveals presence only, never private content.

## 5. Schema shape

Use PostgreSQL schema `mst_stellar`.

Do not create a universal `work` table. Keep:

- `classic_requests`
- `soroban_intents`

A read-only SQL view may `UNION ALL` their Integration-owned identity columns for Service Activity. The view is derived query infrastructure, not persisted workflow state.

Structured protocol objects that are not useful relational query keys remain JSONB inside their protocol table. Sensitive private context does not.

## 6. Required query contracts

### Q1 — exact resource

- Request by id.
- Intent by id.
- Child facts by resource id, ordered deterministically.

### Q2 — Classic discovery

Given network + source accounts + direct signer, return candidate Request ids.

This replaces `request-discovery/v1/*` Blob indexes. Authorization is still revalidated live before private Request data is returned.

### Q3 — Classic Activity candidates

Given network + account ids and/or actor address, return candidate Request ids ordered for Activity.

This replaces `request-activity/v1/*` and its rebuild markers. Activity/Treasury access remains separately revalidated.

### Q4 — Soroban signer discovery

Given network + signer address, return candidate Intent ids.

This replaces `intent-discovery/v1/signers/*`. Signer authority remains live-revalidated.

### Q5 — Integration Service Activity

Given `serviceId`, return Classic Requests and Soroban Intents as one cursor-ordered identity stream:

`created_at DESC, kind DESC, id DESC`

The query returns resource identity only. Current Job/result is loaded from protocol facts and projected in TypeScript; SQL does not duplicate Job state.

### Q6 — execution/audit

For one Request/Intent, load contributions, preparations, observations, cancellation, submission, and Activity/evidence facts in deterministic order.

### Q7 — outbox

List due unpublished outbox event ids and claim one event with a short renewable/recoverable lease. The lease is committed before external HTTPS begins; no database row lock is held across network delivery. Migration `0003_outbox_leases` adds lease/attempt metadata to the existing outbox. See `WEBHOOK_DELIVERY_MODEL.md` for the Vercel Queue + Cron dispatcher boundary.

## 7. Transaction boundaries

The following must be single PostgreSQL transactions once the PG repositories are active.

### T1 Classic creation

Request core + discovery subjects + Activity subjects + `request_created` fact + Integration outbox event.

For Agent creation, Agent idempotency reservation must be in the same transaction.

### T2 Classic contribution

Signature contribution + newly proven participant/activity subject + `approval_added` fact + Integration outbox event.

Identical content-addressed replay remains idempotent.

### T3 Classic final result

Submission result + `transaction_confirmed` fact + Integration outbox event.

### T4 Soroban creation

Intent core + discovery signers + Integration outbox event.

For Agent creation, Agent idempotency reservation must be in the same transaction.

### T5 Soroban AUTH contribution

AUTH contribution + Integration outbox event. Plan digest/revision remains part of the unique fact identity.

### T6 Soroban replan

Current plan/history update + Integration outbox event. Cancellation must win over a racing replan.

### T7 Soroban execution facts

Bind-once executor, execution preparation, and execution observation each commit with their corresponding outbox event where Integration-owned.

### T8 Soroban cancellation

Immutable cancellation insert + Integration outbox event in one transaction.

Cancellation is coordination-level only; it does not revoke detached AUTH or prepared XDR already disclosed outside MST.

## 8. Concurrency invariants

- Resource creation: primary key / deterministic id provides exactly-one resource identity.
- Agent idempotency: unique `(credential_id, idempotency_hash)`.
- Request contribution: unique `(request_id, digest)`.
- Request submission: unique `(request_id, transaction_hash)`.
- Intent AUTH: unique `(intent_id, authorization_plan_revision, digest)`.
- Intent cancellation: one row per Intent.
- Executor binding: one row per Intent.
- Execution observation: one row per `(intent_id, transaction_hash)`.
- Outbox event id is unique.

No last-write-wins operation may erase cancellation, contribution evidence, execution observations, or audit facts.

## 9. Driver/runtime decision

Use ordinary PostgreSQL first:

- `pg`
- one module-global `Pool`
- `attachDatabasePool(pool)` from `@vercel/functions` on Vercel Fluid Compute
- `DATABASE_URL` as the deployment contract
- explicit SQL migrations and thin repositories

Do not introduce Prisma/Drizzle/Kysely merely to wrap this first schema. The current domain interfaces are already the abstraction boundary.

Provider provisioning is deliberately separate from code. The current VPS/operator environment has no `DATABASE_URL`; the available Vercel connector does not expose project environment-variable or Marketplace-resource mutation, so Testnet database provisioning remains an explicit deployment operation.

## 10. Cutover plan

1. Build schema + PG repositories behind an explicit persistence selector. Soroban and Classic repository adapters now both preserve the existing Store interfaces; the selector exists but remains intentionally unconnected to routes until real Testnet backfill verification is complete.
2. Validate migrations/repositories against disposable local PostgreSQL. **Implemented and covered by PostgreSQL 18 integration tests.**
3. Add a resumable Testnet backfill command that reads Blob, writes PG with outbox suppressed, extracts private context into dedicated Blob records, drops legacy projection rows, and compares resource/fact counts plus deterministic source/target hashes. **Implemented as `npm run db:backfill` and covered by integration tests.**
4. Stop Testnet Request/Intent writes briefly for final delta/backfill using `MULTISIG_COORDINATION_WRITE_FREEZE=1`; reads remain available. **Gate implemented; real Testnet freeze not yet performed.**
5. After real Testnet backfill/hash verification only, connect the runtime Store selector and switch Testnet API to PostgreSQL.
6. Keep legacy Blob coordination objects read-only for rollback evidence; runtime no longer treats them as authoritative.
7. Run FedNetwork E2E, including cancel, Service Activity and later webhook.
8. Only after the Testnet evidence is clean decide any Mainnet migration. Mainnet remains frozen until explicit approval.

Do not implement live dual-write as a migration strategy. It creates two authorities and doubles the race surface for little benefit on current Testnet traffic.

## 11. Success criteria for the PostgreSQL slice

Before webhook is called reliable:

- existing Human/Agent/Integration API behavior remains compatible;
- all existing regression tests pass;
- PG repository contract tests cover concurrency/idempotency;
- Blob discovery/activity rebuild machinery is no longer used by the PG path;
- Service Activity query is indexed and paginated; the PostgreSQL query is implemented, while public Integration routing remains deferred until Testnet cutover;
- resource mutation + outbox insertion is proven atomic;
- no private context or credential secret appears in SQL/outbox fixtures;
- FedNetwork E2E passes against the Testnet PG path;
- polling remains a supported fallback.

# Integration Webhook Delivery Model

**Status:** delivery foundation frozen; endpoint/signing contract pending
**Date:** 2026-09-18
**Scope:** Stellar Integration webhooks on the PostgreSQL coordination path

## 1. Deployment topology

The intended Testnet/production topology is:

```
Vercel Web/API Functions
        |
        | PostgreSQL transaction
        v
remote PostgreSQL
  coordination facts
  + integration_outbox
        |
        | event id wake-up
        v
Vercel Queue topic
        |
        v
Vercel webhook dispatcher Function
        |
        v
Integration HTTPS callback
```

A small Vercel Cron sweeper periodically scans due unpublished outbox rows and re-enqueues their event ids.

The Cron is a safety net, not the primary business queue. Its purpose is to close the unavoidable gap where PostgreSQL committed successfully but the post-commit Queue wake-up failed or never ran.

## 2. Authority boundary

PostgreSQL is the durable authority for whether Integration work changed.

Vercel Queue is transport/scheduling only. Losing a Queue message must not lose a webhook.

The customer callback is delivery only. Its response never mutates Stellar authority by itself.

Therefore:

- API mutation + `integration_outbox` insert share one PostgreSQL transaction.
- Queue messages carry only an outbox `eventId` or equivalent wake-up hint.
- The dispatcher must re-read PostgreSQL after claiming the event.
- A Queue retry or duplicate message is harmless.
- Polling remains a supported fallback.

## 3. Internal outbox event vs public webhook

`integration_outbox` currently records an internal `coordination.changed` signal.

It is deliberately **not** the public webhook payload.

The dispatcher will:

1. claim one outbox event with a short PostgreSQL lease;
2. load the canonical Request/Intent and current facts;
3. derive the current Integration Job in TypeScript;
4. construct the versioned public webhook payload;
5. sign and POST it;
6. record delivery evidence;
7. mark the outbox event published only after the delivery policy says it is complete.

This preserves the rule that Job is a projection, not another persisted workflow state machine.

If several internal changes happen before delivery, multiple event ids may project the same latest Job state. Public webhook consumers must therefore be idempotent by event/delivery id and treat the payload as the latest authoritative coordination snapshot, not as a guaranteed record of every transient intermediate state.

## 4. Outbox lease contract

Migration `0003_outbox_leases` adds lease metadata to the existing outbox; it does not add another business table.

Dispatcher primitives:

- list due, unpublished, currently unleased event ids;
- claim one event by atomically assigning a short lease token;
- increment `attempt_count` at claim time;
- never hold a PostgreSQL transaction/row lock while doing external HTTPS;
- mark published only with the active lease token;
- on transient failure, release the lease and move `available_at` according to retry policy;
- an expired lease may be reclaimed after a crashed worker.

This gives at-least-once delivery without long database locks.

## 5. Vercel execution plan

Use Vercel Queues for immediate dispatch and retry execution once the public callback contract exists.

Current Vercel Queues supports:

- TypeScript `send(topic, payload)`;
- queue-triggered Functions;
- callback handlers;
- custom retry/backoff;
- bounded delivery attempts.

Use one topic for this product boundary, e.g. `mst-stellar-integration-webhooks`. Do not create one topic per Integration Service.

The Queue callback Function belongs under the backend application boundary, conceptually:

```
apps/api/stellar/workers/integrationWebhookDispatcher.ts
api/integration-webhook-dispatch.ts
```

The root `api/` file remains a Vercel deployment adapter, consistent with the rest of the API architecture.

Use Vercel Cron only for a sweeper Function, conceptually:

```
apps/api/stellar/workers/integrationWebhookSweep.ts
api/integration-webhook-sweep.ts
```

The sweeper reads due outbox event ids and sends Queue wake-up messages. It does not deliver customer webhooks directly.

## 6. What is intentionally not implemented yet

Before enabling Queue triggers or customer delivery, freeze and implement these contracts separately:

- operator-authorized HTTPS callback registration;
- SSRF-safe endpoint validation/delivery;
- public event schema/version;
- signing format, key rotation and timestamp/replay protection;
- durable per-attempt delivery history/status;
- retry classification (2xx success, permanent 4xx policy, transient network/5xx/429);
- redaction tests proving no API credential, capability token, private note, raw signature/AUTH or private-commitment opening can enter a webhook.

Do not add `@vercel/queue` until that consumer can perform a real, safe delivery. A Queue dependency without a valid dispatcher would be a half-built operational path.

## 7. Database table impact

The current coordination model remains 15 business tables:

- 6 Classic;
- 7 Soroban;
- 2 cross-protocol (`agent_idempotency_claims`, `integration_outbox`).

There is additionally one technical `schema_migrations` table and one derived `integration_work` view.

Webhook endpoint configuration and durable delivery-attempt history may add storage later. Do not overload `integration_outbox` with endpoint secrets or raw callback bodies merely to preserve the current table count.

## 8. Success criteria before enabling webhook delivery

- Testnet runs on the PostgreSQL coordination path.
- FedNetwork polling E2E still passes.
- outbox is populated only by live post-cutover mutations, not historical backfill.
- concurrent dispatcher claims are proven exclusive.
- worker crash/lease expiry is proven recoverable.
- public payload/signature contract is frozen and tested.
- callback URL policy is SSRF-safe.
- delivery history is durable.
- Queue failure is recovered by Cron outbox sweep.
- duplicate delivery is safe and documented.

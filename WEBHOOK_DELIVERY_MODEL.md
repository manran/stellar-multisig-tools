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

## 5. Portability boundary

Vercel is a runtime adapter, not part of the webhook business contract.

Portable/core pieces:

- PostgreSQL schema, outbox, lease and delivery-history semantics;
- Standard Webhooks payload signing;
- callback configuration and per-Service secret derivation;
- retry classification/backoff;
- SSRF URL/DNS policy;
- dispatcher lifecycle;
- `IntegrationWebhookWakePublisher` interface.

Vercel-specific pieces must remain thin adapters only:

- publish one outbox `eventId` to a Queue topic;
- invoke the generic dispatcher from a Queue-triggered Function;
- invoke the generic due-event sweeper from Cron;
- ordinary Function deployment/configuration.

A migration to SQS + Lambda, Cloud Tasks, Redis/BullMQ, Fly.io workers, or a long-lived process should replace only the wake publisher/subscriber and scheduler deployment adapter. PostgreSQL `available_at` + lease remains retry authority, so queue-provider retry semantics do not become part of product behavior.

The Node HTTPS transport is also behind `IntegrationWebhookHttpTransport`; a non-Node runtime may replace that adapter without changing dispatcher/signing/persistence contracts.

## 6. Public signing/configuration contract

Webhook callbacks are operator-owned durable Integration configuration, separate from the Integration API credential scope. Stored configuration contains callback URL, enabled flag and `secretVersion`; it never stores the derived `whsec_` secret.

`MULTISIG_WEBHOOK_MASTER_SECRET` is one 32-byte deployment master secret (`mwh_<base64url>`). Per-Service Standard Webhooks secrets are HKDF-SHA256 derived from master + Service id + secret generation. Rotation increments only the Service generation. Moving platforms therefore requires transferring one deployment master secret rather than exporting every callback secret.

Outbound signing uses the maintained `standardwebhooks` TypeScript implementation and the Standard Webhooks headers:

- `webhook-id`
- `webhook-timestamp`
- `webhook-signature`

Registration rejects non-HTTPS/private literal destinations. Delivery resolves DNS again and rejects the whole resolution set if any address is non-public; the Node transport pins the selected public address while preserving TLS SNI/Host, so DNS rebinding cannot redirect the request to a private address after policy validation.

## 7. Public payload v1

The public event envelope is protocol-neutral, while the projection remains protocol-specific:

```json
{
  "schema": "multisigtools-integration-webhook-v1",
  "id": "<outbox event id>",
  "type": "work.changed",
  "createdAt": "<timestamp>",
  "serviceId": "fednetwork",
  "data": {
    "work": {
      "kind": "classic_request | soroban_intent",
      "id": "<resource id>",
      "network": "testnet",
      "externalReference": "<optional service correlation id>"
    },
    "projection": {}
  }
}
```

Do not add a universal `work.state` merely for webhook symmetry.

Classic projection is `type: "classic_request"` and reuses the existing Request business projection: id/network/transaction hash/timestamps, contribution/signature counts, `status`, `statusReason`, execution mode, external reference and confirmed result when present. It deliberately omits base/merged XDR and private context.

Soroban projection is `type: "soroban_job"` and reuses the existing `IntegrationSorobanJobProjection`. It deliberately omits Intent host-function XDR, AuthorizationPlan entries, detached AUTH XDR/signatures and private notes.

The dispatcher always rebuilds this payload from current canonical Request/Intent facts at delivery time. Internal outbox `payload` is never forwarded to the customer as the webhook body.

Redaction is a contract: callback payload tests contain sentinel XDR/AUTH/private-note/capability values and fail if any sentinel or private field name leaks into JSON.

## 8. Vercel execution plan

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

## 9. What is intentionally not implemented yet

Before enabling Queue triggers or customer delivery, freeze and implement these contracts separately:

- Vercel Queue publisher/subscriber adapters;
- Cron sweeper deployment adapter;
- retry classification (2xx success, permanent 4xx policy, transient network/5xx/429);
- redaction tests proving no API credential, capability token, private note, raw signature/AUTH or private-commitment opening can enter a webhook.

Do not add `@vercel/queue` until that consumer can perform a real, safe delivery. A Queue dependency without a valid dispatcher would be a half-built operational path.

## 10. Database table impact

The coordination model now has 16 business tables:

- 6 Classic;
- 7 Soroban;
- 3 cross-protocol (`agent_idempotency_claims`, `integration_outbox`, `integration_webhook_deliveries`).

There is additionally one technical `schema_migrations` table and one derived `integration_work` view.

`integration_webhook_deliveries` exists because per-attempt audit history is a real requirement. It stores only bounded metadata: endpoint hash, attempt, timing, outcome, HTTP status/error code. It does not store callback URL, response body, Standard Webhooks secret, API credential, raw signature/AUTH, or private note.

## 11. Success criteria before enabling webhook delivery

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

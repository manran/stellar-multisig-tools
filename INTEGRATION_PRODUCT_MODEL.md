# MultiSigTools Integration Product Model

Status: product/architecture guidance
Date: 2026-09-17

## 1. Purpose

MultiSigTools may keep a rigorous internal coordination model, but an external business system must not be required to understand that model.

Internal concepts remain precise:

```text
Intent / Request
AuthorizationPlan
Contribution
ExecutionPreparation
ExecutionObservation
Evidence
Executor binding
```

The Integration product surface projects those facts into one business concept:

```text
Job
```

A Job means: "a chain action that needs coordination before it can finish."

The product rule is:

> Keep the security model strict; make the business model simple.
## 2. Boundary rules

1. Job is a projection, not a second persisted workflow.
2. Job reuses the existing Intent/Request id; do not invent another identity.
3. Do not rename or weaken the internal authorization/evidence model.
4. Do not create a universal endpoint that hides materially different operations.
5. Existing `/api/intent` and `/api/request` remain the canonical resources.
6. Integration responses may expose a stable `job` projection over those resources.
7. Integration authentication never becomes signer authority.
8. Disclosure access never becomes signing authority.
9. Execution ownership never becomes authorization ownership.
10. Contract/method/account/executor scope, idempotency, effects enforcement and live chain revalidation remain mandatory.

## 3. Business state

`created` is an event, not a durable state. By the time creation returns, the work normally already knows what it is waiting for.

The stable Soroban Integration Job states are:

```text
waiting_for_authorization
ready
executing
completed
expired
failed
cancelled
```

These states are derived from durable coordination facts; callers never write them directly.
State derivation for Soroban Integration work:

| Internal fact | Job state |
| --- | --- |
| authorization is open | `waiting_for_authorization` |
| authorization ready, no current execution preparation | `ready` |
| authorization ready, but the latest execution package is stale | `ready` |
| current-plan execution package prepared and still valid, no final observation | `executing` |
| successful execution observation | `completed` |
| authorization window expired | `expired` |
| unsupported/blocked authorization or confirmed execution failure | `failed` |
| owning Service records the immutable cancellation fact | `cancelled` |

Only facts for the current AuthorizationPlan revision participate in execution-state projection. Old preparations or observations remain evidence but must not make a replanned Job look `executing` or `completed`.

## 4. Job view

The business projection should answer four questions without exposing state-machine reasoning:

```text
What is this work?
What is its current state?
What, if anything, should my Service do next?
What is the final result?
```

Minimum shape:

```json
{
  "version": 1,
  "id": "...",
  "kind": "soroban_contract",
  "state": "waiting_for_authorization",
  "nextActions": [],
  "reviewUrl": "https://.../a#..."
}
```
Additional fields are projections, not new authority:

```text
waitingFor[]       authorizer addresses whose current requirements are not yet satisfied
expiresAtLedger    earliest current authorization expiry, when available
externalReference  caller correlation value, when supplied
execution          current execution owner/executor/prepared transaction summary
result             confirmed transaction hash/ledger/success summary
```

The full technical Intent/authorization/evidence may continue to be returned for advanced clients and diagnostics. A normal business integration should be able to ignore it and consume only `job`.

## 5. nextActions

`nextActions` is advice derived by MultiSigTools. It is not permission and never bypasses server-side revalidation.

Initial stable action codes:

```text
prepare_execution
submit_execution
reconcile_execution
refresh_execution
replan
cancel
```

Rules:

- `waiting_for_authorization` -> `cancel` is available to the owning Service; otherwise wait for signers.
- `ready` -> `prepare_execution` (or `refresh_execution` when only a stale prior package exists) plus `cancel`.
- externally owned `executing` -> `submit_execution`, `reconcile_execution`, `refresh_execution`, or `cancel`.
- `expired` -> `replan` or `cancel`.
- `failed` -> `cancel` is the only generic close-work action; no automatic recovery is inferred.
- `completed` and `cancelled` -> no action.

Clients must not infer authorization or execution permission solely from this list; the corresponding API operation remains authoritative.
## 6. Webhook contract

Webhook is a notification channel, never the source of truth.

Consumer rule:

```text
receive webhook
-> deduplicate event id
-> GET canonical Job/Intent
-> act from current state
```

Business event names should follow the Job projection rather than leak internal evidence names:

```text
job.created
job.ready
job.executing
job.completed
job.expired
job.failed
job.cancelled
```

`job.created` reports successful creation even though `created` is not a durable Job state.

A reliable webhook implementation requires all of:

- operator-authorized callback registration;
- HTTPS endpoint validation and SSRF-safe delivery rules;
- stable event version and unique delivery/event ids;
- cryptographic signature with timestamp/replay protection;
- durable outbox before delivery;
- bounded retry with backoff;
- durable delivery history/status;
- redaction of credentials, private notes, raw signatures and capability secrets;
- idempotent consumer semantics.
Do not implement webhook as an untracked `fetch()` after an API mutation. That creates a false reliability guarantee: state may commit while delivery is lost, and retries/replay cannot be proven.

The preferred implementation point is the PostgreSQL persistence milestone, where state transition + outbox insertion can share one database transaction. Until then, polling remains a supported fallback and the Job projection removes the need for callers to understand internal states.

## 7. Cancellation, expiry and replan

Cancellation is an authoritative MultiSigTools coordination fact, not Stellar cryptographic revocation. `PUT /api/intent` with `action: "cancel"` is allowed only to the original Human/Agent creator or the Integration Service that owns the Intent. It closes further AUTH contribution, replan and execution-package preparation in MultiSigTools and projects terminal `cancelled`.

Detached AUTH or prepared XDR already disclosed outside MultiSigTools cannot be withdrawn by this operation and can remain usable until its Stellar validity window ends. Existing execution preparation evidence remains visible, and reconciliation remains allowed after cancellation so a transaction that was already handed off can still be reported truthfully if it later lands on-chain.

The cancellation marker is immutable/write-once. While coordination is still on Blob storage, it is stored separately from mutable Intent state so a stale `intent.json` rewrite cannot erase cancellation. PostgreSQL can later make cancellation/outbox ordering transactional without changing this product contract.

### Expiry and replan

Long-lived multisig work makes authorization expiry normal rather than exceptional.

Current explicit behavior remains:

```text
expired
-> Service requests replan
-> signers authorize the fresh plan
```

Future `autoReplan` may be offered only as an opt-in policy. It may automatically refresh an authorization window only when the same semantic Intent and effects are preserved. Any material effects change must stop at review/re-authorization; the Integration may never accept drift for signers.

## 8. Execution policy

Current Integration execution remains `external_required` in product terms: authorization can complete in MultiSigTools while the Service retains the final execution gate.

Possible future policies:

```text
external_required
external_preferred
multisigtools_fallback
```

Fallback may happen only when pre-authorized by Service policy. It must never be invented dynamically because the external Service is unavailable.

Executor pools may later replace repeated per-worker credential edits, but pool membership remains an operator-controlled execution scope, never `any executor`.
## 9. Delivery phases

### Phase 1 — business projection now

- add a pure Soroban Integration Job projector;
- expose `job` on Integration create/inspect/execute/reconcile responses;
- include `reviewUrl`, state, nextActions, waitingFor, expiry, execution/result summary;
- preserve all existing technical response fields for compatibility;
- document and test the mapping against current-plan evidence.

### Phase 2 — reliable events with PostgreSQL

- freeze Integration persistence schema from Testnet/FedNetwork evidence;
- move the coordination records that need relational query/transaction semantics;
- add transactional webhook outbox;
- add signed retries and delivery history;
- add Service Activity queries (`serviceId -> Jobs / executions / audit`).

### Phase 3 — partner ergonomics

- thin TypeScript SDK over the stable API, without duplicating workflow logic;
- operator/partner console for credentials, scopes, webhook configuration and Activity;
- optional auto-replan/execution fallback only after concrete operational evidence.

## 10. Non-goals

This product simplification must not cause:

- a second workflow engine called Job;
- a generic event bus before webhook delivery exists;
- self-service privilege expansion;
- hidden acceptance of effects drift;
- implicit signer authority for `msi_*`;
- implicit executor authority from the planning source;
- claiming that Intent cancellation revokes already disclosed detached AUTH or prepared XDR;
- breaking replacement of existing `/api/intent` or `/api/request` contracts.

This document refines the Integration direction in `PLATFORM_EXTENSION_POINTS.md`; internal architecture remains governed by the existing Workflow, authority, privacy and evidence documents.

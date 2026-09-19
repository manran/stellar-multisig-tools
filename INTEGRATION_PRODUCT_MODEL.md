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
## 9. Progressive Integration Levels

MultiSigTools has one Headless capability surface. Integration levels describe how much interaction and orchestration the integrator chooses to own; they are not separate products or separate workflow engines.

```text
                         integrator ownership ->

Direct MST
  MultiSigTools owns business interaction and authorization UI
        |
Hosted Authorization
  Integrator owns the business; MST renders the signing/review step
        |
Native Authorization
  Integrator owns business UI and wallet UX; Browser talks directly to MST
        |
Full Headless
  Integrator owns Browser / Server / Agent / executor orchestration
```

Each level is a progressive takeover of work MST performed at the previous level. Intent identity, AuthorizationPlan, signature validity, thresholds, expiry, effect drift, execution binding and audit facts remain authoritative in MST at every level.

### Direct MST

The simplest consumer uses MultiSigTools directly. No Integration credential, Browser capability or webhook is required.

### Hosted Authorization

The integrator creates and tracks work but delegates authorization interaction to MST through `reviewUrl`.

Minimum integration:

```text
create Intent
-> show/open hosted review
-> poll Job or receive webhook
-> continue business workflow
```

Redirect, popup, modal window or a future iframe are presentation choices over the same hosted authorization resource. They do not create different backend workflows.

### Native Authorization

A service such as FedNetwork already has its own product UI, wallet connection and backend. It should not need to send users to MST.

Recommended first-party flow:

```text
Service Server --msi_*--> create Intent
Service Server --msi_*--> issue signer-scoped Browser capability

Signer Browser --mic_*--> inspect current challenge
Signer Browser --wallet--> sign locally
Signer Browser --mic_*--> contribute signature

MST -> Job state / webhook -> Service
Service executor -> final execution
```

No SDK is required. An SDK or UI component may later wrap the same Headless operations as a convenience layer only.

The Browser capability is disclosure/transport authority, not signer authority. It allows one browser to inspect the signer-specific challenge and submit a contribution for one current Intent plan. A contribution remains valid only when the Authorization Core independently verifies the Stellar signature, signer membership, weight/threshold, current plan and expiry.

Browser capability v1 is intentionally narrow:

```text
integration service
intent id
authorization plan digest + revision
signer address
exact browser origin
expiry
```

It cannot create arbitrary Intents, replan, cancel, bind an executor, prepare execution, execute, change Integration configuration, or impersonate a Stellar signer.

A replan changes AuthorizationPlan identity and therefore invalidates previously issued Browser capabilities automatically.

### Full Headless

Advanced integrators may own their entire UI, wallet adapters, invitation flow, server orchestration, webhook consumer, executor and Agents. They consume the raw stable operations directly.

The governing rule is:

> Integrators may take over orchestration; they do not duplicate authority.

MST continues to decide whether an Intent, authorization contribution, effects snapshot and execution observation are valid.

### Mixed-mode use is normal

One Integration may combine levels for the same Intent:

```text
default signer -> Native Authorization
unsupported wallet -> Hosted reviewUrl fallback
backend -> msi_* + webhook
automation -> Agent / Headless API
```

The contribution transport does not change Intent identity.

### Product disclosure

The partner/admin product should reveal complexity progressively:

```text
Use MultiSigTools UI
Use hosted authorization
Use your own interface
Advanced / Headless
```

Only advanced surfaces should expose origins, Browser capabilities, executor policy, raw API operations and other implementation details.

### First implementation boundary

The first Browser Integration milestone deliberately does **not** allow anonymous/public Browser Intent creation.

It implements:

1. Integration Service creates the Intent with existing `msi_*`.
2. Owning Service issues a short-lived signer-scoped Browser capability for the existing Intent.
3. Browser inspects only that signer's current authorization challenge.
4. Browser submits the wallet signature directly to the existing Authorization Core.
5. Hosted `reviewUrl` remains a fallback.
6. Execution remains owned by the existing Integration execution policy.

Public Integration Profiles and browser-created Intents are deferred until real market evidence shows they are needed.

## 10. Integration Profile provisioning

An Integration credential is the machine identity of one durable Integration Profile. The product must not begin with a secret or with raw scope fields. It begins with the business boundary the Integration is allowed to operate.

The provisioning sequence is:

```text
Identity + network
        ↓
Classic Treasury scope
        ↓
Soroban Contract scope
        ↓
Integration depth
        ↓
Execution: MultiSigTools managed by default
        ↓
Optional advanced execution routing
        ↓
Optional status delivery
        ↓
Review
        ↓
Create Integration Profile + issue MSI_*
```

The resulting `MSI_*` is only the API credential for that already-defined profile. It is not the profile itself.

### Headless-first invariant

Every wizard step is a client of a stable Headless operation or persisted Integration Profile field. The Web UI must not own policy that cannot be expressed by the underlying Integration administration model.

The same profile must be creatable and inspectable by future CLI/Agent/operator tooling without reproducing UI logic.

An Integration can inspect its effective execution capability through the Headless operation `integration.execution.inspect` (`GET /api/integration-execution?network=...`, authenticated by `msi_*`). The response exposes only public execution facts: whether Classic scope exists, managed/external Treasury counts, and the public identities of the deployment's managed Classic channel pool. It never exposes the channel master secret or derived private seeds.

### Classic Treasury onboarding

The operator/integrator provides a Stellar `G...` Treasury address. MST resolves current Horizon account state and presents:

- current low / medium / high thresholds;
- active signer addresses and weights;
- authorization-policy summaries;
- whether this Integration permits coordination for that Treasury.

Execution ownership is separate from signer authority:

```text
Authorization authority -> current Stellar account signer policy
Execution ownership       -> MultiSigTools or external Integration
```

The Integration Profile never invents or overrides account signers.

For ordinary Integration users, execution is not another setup decision. MultiSigTools manages it by default.

For **semantic Classic payment Requests**, managed execution separates transaction mechanics from business authority:

```text
Treasury G...        -> Payment operation source + live signer authority
MST channel G...     -> transaction source + sequence + fee + submission
```

The channel is pre-signed only for transaction-source authority. Treasury signers still authorize the Payment operation under the Treasury's current Stellar thresholds. MST therefore does not become a Treasury signer and cannot change the business operation after signatures begin.

Managed Classic v1 intentionally uses a simple Channel Account Pool:

- one deployment-level master secret deterministically derives network-scoped channel keypairs; individual channel seeds are never stored as configuration;
- PostgreSQL stores only public channel/request leases;
- one channel carries at most one active Request at a time;
- concurrency scales by adding channels, not by speculative sequence pipelining;
- a lease is released after confirmed submission or may be reclaimed after Request expiry;
- semantic creation can safely reconstruct transaction source; raw XDR is never silently rewritten.

If an Integration explicitly chooses **Manage execution myself**, an allowed Treasury is also listed in `classicExternalExecutionSourceAccounts` and the Integration owns transaction source/sequence/submission for that work.

### Soroban Contract onboarding

The operator/integrator provides a Stellar `C...` contract address. MST resolves the deployed contract interface and presents the actual callable methods.

The user selects the methods this Integration may invoke. The profile stores an explicit allowlist; empty means no access, never wildcard access.

Execution configuration is hidden from the ordinary path. Every new Guided contract defaults to MultiSigTools-managed execution. Only **Manage execution myself** reveals the global Executor Pool and per-contract routing, because execution is a consequence of allowed work rather than the source of contract authority.

For the current runtime model:

- selected methods map to `sorobanContracts`;
- `sorobanExecutionAccounts` is the Integration-wide **Executor Pool**: the set of external `G...` accounts that may execute Soroban work for this Service;
- each contract scope may carry an explicit execution policy: `multisigtools` or one exact executor from that pool;
- a contract-bound external executor cannot be replaced by an Intent-level executor;
- a contract marked `multisigtools` cannot be rebound to a Service executor during preparation;
- legacy contract scopes without an explicit execution policy retain the previous Intent override -> Service default -> managed fallback precedence for compatibility.

This keeps configuration simple without making the association cosmetic: the same contract/executor relation shown by the UI is enforced by the Integration runtime authority model.

### Integration depth

Only after the business scope is defined should the product ask how deeply the Integration wants to consume MST:

```text
MST-hosted authorization
Keep users on my site
Full Headless control
```

These choices are progressive disclosure over the same Headless Core, not different capability implementations.

Suggested product copy:

- **MST-hosted authorization** — MultiSigTools handles signer interaction. Lowest integration effort.
- **Keep users on my site** — use the Integration's own page and wallet UX while MST coordinates and verifies authorization.
- **Full Headless control** — expose the complete supported orchestration, execution and automation surface.

The profile stores this as product preference / disclosure state. It does not weaken the underlying API authority checks.

### Progressive execution disclosure

Authorization experience and execution ownership are orthogonal.

The normal product surface says only:

```text
Execution
Managed by MultiSigTools

[ Manage execution myself ]
```

Leaving the default selected means:

- Classic semantic workflows use MST-managed transaction-source channels;
- Soroban uses MST-managed execution;
- the integrator does not configure source accounts, sequence handling, fee payment, Executor Pool or per-contract execution routing.

Opening **Manage execution myself** reveals the existing advanced capabilities without creating a second execution engine:

- Classic Treasury routing: MST managed / Integration submits;
- Soroban global Executor Pool;
- per-contract executor binding;
- Expert raw fields for legacy/default execution policies.

Turning advanced execution back off clears hidden custom routing before saving, so invisible stale authority cannot survive the disclosure change.

Raw Classic XDR remains an Expert boundary. MST will coordinate exact XDR according to its declared sources but will not silently replace its transaction source with a managed channel. Managed transaction-source execution is guaranteed only for semantic operations MST can safely reconstruct.

### Status delivery

Webhook is orthogonal to authorization experience.

It is therefore configured as an optional **Status updates** step, not as a consequence of choosing Native or Headless integration.

When enabled:

- the Integration provides one HTTPS callback URL;
- MST returns the webhook signing secret once;
- the secret is never part of normal profile display;
- rotation is a profile maintenance action.

### Credential issuance

`MSI_*` is generated only after review succeeds.

The creation result must present it once, separately from normal profile details:

```text
Integration Profile created

API credential
MSI_...

Shown once. Store it in your server-side secret store.
```

The Integration detail page never re-renders the plaintext API credential. It displays that a credential exists and exposes rotation.

### Integration Profile detail

After creation, the default surface is a readable profile, not a raw edit form.

It should answer:

```text
What can this Integration operate?
Is execution managed by MST, or has this Integration explicitly taken it over?
How do users authorize?
How are status updates delivered?
What credential lifecycle actions exist?
```

Suggested information hierarchy:

```text
Integration identity
Networks / enabled state

Classic Treasuries
  G...
  live signer policy summary

Soroban Contracts
  C...
  allowed methods

Execution
  Managed by MultiSigTools              <- default summary
  OR custom routing                     <- expand only when configured
    Classic Treasury routing
    Soroban Executor Pool / contract binding

Authorization experience
  Hosted / Keep users on my site / Full Headless

Status updates
  Webhook on/off + endpoint + last-known config generation

Credential
  Active
  Rotate
```

Edit actions should modify one section at a time. Raw authority fields remain available only in the Expert/Headless disclosure level.

### First implementation boundary

The first production slice keeps existing authority semantics and changes the provisioning/product surface:

1. Create Wizard replaces the raw multiline scope editor for new Integrations.
2. Treasury analysis reuses Horizon account loading + existing authorization analysis.
3. Contract analysis reuses the existing Contract Interface endpoint.
4. MultiSigTools-managed execution is the Guided default and is not presented as a mandatory setup decision.
5. Managed semantic Classic Payment uses an MST Channel Account as transaction source while retaining the Treasury as explicit operation source; channel keypairs are deterministically derived from one deployment master secret and no channel seed enters PostgreSQL.
6. PostgreSQL coordinates one-active-Request-per-channel leases; v1 deliberately avoids sequence pipelining.
7. Classic external execution continues to use the existing per-Treasury external-execution allowlist when advanced execution is enabled.
8. Soroban external execution reuses the Service-wide executor allowlist as a global Executor Pool plus enforced per-contract policy (`multisigtools` or one pool member).
9. Raw Classic XDR stays Expert-managed and is never silently rewritten into the channel model.
10. Legacy records without per-contract execution metadata retain the previous Service-default/Intent-override semantics; new Guided Profiles emit explicit contract policies.
11. Integration depth is persisted as profile metadata for product disclosure; it does not create a second authorization policy engine.
12. Webhook remains optional and orthogonal.
13. Existing `MSI_*` creation/rotation semantics remain unchanged.
14. Existing durable Integration records remain readable; missing profile metadata defaults to the most permissive disclosure view for operators, not to weaker runtime authority.
15. Partner self-service login is a later delivery concern. This first slice validates the provisioning model on the existing protected Integration administration surface.

## 11. Delivery phases

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

- signer-scoped Browser authorization over the stable Intent/Authorization Core;
- optional thin SDK/components over the same API, never as an ability boundary;
- operator/partner console for credentials, scopes, webhook configuration and Activity;
- optional auto-replan/execution fallback only after concrete operational evidence.

## 12. Non-goals

This product simplification must not cause:

- a second workflow engine called Job;
- a generic event bus before webhook delivery exists;
- self-service privilege expansion;
- hidden acceptance of effects drift;
- implicit signer authority for `msi_*`;
- implicit executor authority from the planning source;
- claiming that Intent cancellation revokes already disclosed detached AUTH or prepared XDR;
- breaking replacement of existing `/api/intent` or `/api/request` contracts;
- making Browser capability equivalent to Stellar signer authority;
- requiring an SDK for Native Authorization;
- building public/anonymous Browser Intent creation before real Integration demand exists.

This document refines the Integration direction in `PLATFORM_EXTENSION_POINTS.md`; internal architecture remains governed by the existing Workflow, authority, privacy and evidence documents.

---
title: "MultiSig Tools — Progressive SaaS and Platform Extension Points"
description: "Internal MultiSig Tools engineering documentation."
---

Status: architecture/product guidance; future-facing, not current MVP implementation
Date: 2026-08-30

This document records the minimum extension points needed so the current Stellar multisig product can grow into Team/Workspace and external API use without prematurely building a generic SaaS platform.

It complements `apps/internal-docs/content/stellar/product/workspace-model.md`, `MULTI_AUTHORITY_INTENTS.md`, `apps/internal-docs/content/stellar/product/transaction-context.md`, `PRIVACY_AUDIT_MODEL.md`, and `INTEGRATION_PRODUCT_MODEL.md`. The latter now defines the business-facing Job projection and reliable webhook boundary validated by the first real Integration.

## 1. Product growth rule

The product should grow by **progressive enhancement of capabilities**, not by forcing every user into a Team or organization model.

A useful capability may begin as a personal feature:

```text
Personal
-> useful to one signer/operator now

Team / Workspace
-> same capability becomes shared, persistent, permissioned, and auditable

Enterprise
-> same capability gains organization policy, stronger identity/key management,
   retention/compliance controls, and integration guarantees
```

Examples:

```text
Personal alias
-> shared Workspace address book
-> governed enterprise directory integration

Signer Activity
-> Account Activity projection
-> Workspace Activity
-> enterprise audit/export/retention

Private Note
-> shared Workspace context
-> client-encrypted / customer-key-controlled context

One request link
-> team coordination
-> API-created request + webhook lifecycle
```

This is a normal SaaS evolution pattern, but **pricing tiers must not define the security/domain model**. A feature belongs in Workspace because it requires shared persistent state or shared policy, not merely because it is paid.

Design rule:

> Personal capability first where useful; Workspace only when the capability becomes shared and persistent.

## 2. When Workspace appears

Do not create a Workspace automatically because a Stellar account has multiple signers.

Workspace becomes justified when users deliberately need one or more of:

- shared retained Activity/history;
- shared Private Notes/private context;
- persistent members and roles;
- shared address book;
- votes or non-transaction signed intents;
- shared policies;
- API credentials / Agent integrations owned by a team rather than one person;
- audit/retention/disclosure controls.

Before that point, Signer Activity and authorized Account Activity are enough.

## 3. Minimum domain extension points

Do **not** implement all of the following now. Preserve enough room that current records can evolve into this shape without a migration that changes their meaning.

Conceptually:

```text
Request
  id
  version

  subject
    kind
    payload / payload_ref
    payload_hash

  context_ref?

  workspace_id?                 # absent/null for ordinary personal use

  authorization_requirements[]  # current Stellar case may have exactly one
  evidence[]                    # typed evidence, not assumed to be only XDR sigs

  execution
    mode                         # multisigtools | external
    executor_id?
    state
    artifact_ref?

  integration?
    creator_actor_id
    service_id?
    correlation_id?

  status
  expires_at
  created_at
  updated_at
```

The current implementation does not need to physically match this schema. The stable requirements are the **semantic seams**.

### 3.1 `subject.kind`

Today the important subject is a Stellar transaction/XDR.

Future examples may include:

```text
stellar_transaction
signed_intent
vote
service_action
policy_change
```

Do not generalize until real use cases exist, but do not make every downstream component assume `subject == plaintext XDR forever`.

### 3.2 `workspace_id?` is optional

Ordinary requests remain valid without a Workspace.

A later Team request may attach to one Workspace. Workspace membership controls shared collaboration/read access; it does not replace request-specific or Stellar authorization.

### 3.3 `authorization_requirements[]`

Current common case:

```text
one Stellar account
-> one threshold requirement
```

Future multi-authority case:

```text
Authority A requirement
Authority B requirement
Service/policy requirement
```

Independent requirements must never be flattened into one global `N/M` signer count.

### 3.4 typed `evidence[]`

Do not make the durable model mean `evidence == Stellar transaction signature`.

Potential future evidence includes:

```text
Stellar transaction signature
Stellar signed message
account-authority proof
Workspace approval
Agent/KMS authorization
external policy result
```

The requirement determines which evidence types are valid. A Workspace approval never silently becomes Stellar transaction authority.

### 3.5 `execution`

Authorization and execution are distinct.

The result of a satisfied request may be executed by:

```text
MultiSigTools
external service
human/operator
future Agent
```

This distinction is necessary for integrations such as FedNetwork, where MultiSigTools may coordinate user authorization while FedNetwork keeps the final service-side execution gate.

### 3.6 Activity as append-only events

Do not model history only by snapshots of the current request record.

Conceptually:

```text
ActivityEvent
  id
  request_id
  kind
  actor_id?
  subject_hash / evidence_hash?
  protected_payload_ref?
  timestamp
  previous_event_hash?          # future tamper-evident option

  scope_refs
    signer_ids[]?
    account_ids[]?
    workspace_id?
```

This supports three projections without three incompatible history systems:

```text
Signer Activity
Account Activity
Workspace Activity
```

Private event payloads remain separately protected according to `PRIVACY_AUDIT_MODEL.md`.

## 4. External service integration model

An external project such as FedNetwork should consume the same Request/Authorization core rather than embed a private copy of MultiSigTools logic.

The integration model should be:

```text
External Service
    |
    | authenticated API
    v
Create Request / Intent
    |
    v
MultiSigTools coordination
    |
    +-> Human deep-link / Inbox
    +-> collect valid authorization evidence
    +-> evaluate requirements
    |
    v
Ready
    |
    +-> MultiSigTools executes, or
    +-> external service receives readiness and executes
```

The external service is an independent **workload caller / Integration**. Unlike a Signer Agent, it is not bound to one signer Principal. It is also not a Workspace.

## 5. Current Integration API contract

The first real Integration reuses the existing Headless resources rather than introducing `/v1/service-*` lifecycle routes:

```http
POST /api/request   # scoped Classic multisig coordination
GET  /api/request   # read own Request

POST /api/intent    # scoped semantic Soroban Intent
GET  /api/intent    # read own Intent
PUT  /api/intent    # re-plan or prepare scoped external execution
```

A future versioned public facade may alias these semantics, but the domain lifecycle remains the same Request / Intent core.

Creation conceptually supplies:

```text
subject / exact artifact
network if applicable
context mode
required authority domains
expiry
external correlation id / idempotency key
optional Workspace scope

Execution policy belongs to the created work item; it is not part of Service identity.
```

Creation returns at least:

```text
request_id
status
human_review_url / deep_link
payload_hash / transaction_hash when applicable
```

Sensitive private context must not be placed directly in a deep-link URL.

A request locator/capability may be used where appropriate, but bearer capabilities must remain scoped, non-enumerable, revocable/expiring where practical, and excluded from ordinary logs/webhook payloads.

## 6. Integration authentication and authorization

API authentication must be independent from Stellar transaction authorization.

Possible future service identities:

```text
OAuth client / service account
Workspace-owned service credential
mutual-TLS / enterprise workload identity
```

The first deployment-owned Integration credential uses an `msi_...` namespace and explicit scope:

```text
networks[]
classicSourceAccounts[]
classicExternalExecutionSourceAccounts[]   # optional subset
sorobanContracts[{ contractId, methods[] }]
sorobanExecutionAccounts[]
```

For Classic Requests, every account that actually supplies transaction authorization must be in `classicSourceAccounts`; live signer weights and thresholds remain authoritative. Classic scope defaults to the ordinary MultiSigTools execution path; `classicExternalExecutionSourceAccounts` is an optional subset for treasuries whose Service must retain final execution. A single transaction cannot mix the two policies. For Soroban Intents, the exact contract + method must be scoped, but the Service does not configure the user authorizers: recording simulation discovers the actual `require_auth()` requirements. Any external execution source must be in `sorobanExecutionAccounts`.

It must **not** allow the service to fabricate user signatures, satisfy Stellar thresholds, or satisfy Soroban AUTH merely because it created the resource.

Later identity mechanisms may add OAuth, Workspace ownership, mTLS/workload identity, or webhook scopes only after a real consumer requires them.

`Team`, `Workspace`, and `Enterprise` must remain outside the caller/authority taxonomy. They may later own credentials and shared policy, but they do not sign and do not replace the live Classic source-account or Soroban authorizer checks.

## 7. Webhook/event delivery

External integrations should not need to poll the entire system continuously.

Candidate events:

```text
request.created
authorization.added
requirement.satisfied
request.ready
request.invalidated
request.expired
request.submitted
request.confirmed
execution.completed
execution.failed
```

Requirements before implementation:

- signed webhook delivery;
- replay protection;
- delivery id / idempotency;
- retry policy;
- registered/authorized callback endpoints rather than arbitrary unsafe URLs;
- redaction of private payloads and capability secrets;
- stable event/version semantics.

## 8. FedNetwork as first external test

FedNetwork identity transfer is the first Soroban proof of the Integration model. A typical contract action is semantic and source-free:

```text
FedNetwork Service
  -> creates transfer(record, A, B) Intent

MultiSigTools recording simulation
  -> discovers A require_auth()
  -> discovers B require_auth()
  -> indexes the actual current signers for A and B
  -> A/B review and contribute detached AUTH independently
  -> marks Intent authorization_ready

FedNetwork
  -> prepares execution only with a configured executor G account
  -> requires final effects to remain exactly what A/B authorized
  -> re-checks claim version / owner / nonce / expiry / business policy
  -> adds any retained service-side transaction signature outside MultiSigTools
  -> submits and confirms
  -> applies identity ownership transition idempotently
```

A and B need no prior relationship and are not copied into Integration credential scope. Their authority comes from the simulated contract requirements and live chain policy.

The same FedNetwork `msi_...` identity may also use `/api/request` for a configured Classic multisig treasury. Payment/batch work can be supplied as semantic business input and is prepared into exact unsigned XDR by MultiSigTools before entering that Request; exact XDR remains the advanced escape hatch. This is intentionally the same Integration Actor and the same existing Request lifecycle, not a separate product surface.

For the FedNetwork Soroban transfer:

```text
execution.mode = external
executor = FedNetwork
```

A separate Classic treasury owned by the same Service defaults to ordinary MultiSigTools submission unless that G account is explicitly included in `classicExternalExecutionSourceAccounts`. MultiSigTools coordinates authorization without conflating Service identity, signer authority, and execution ownership. Human deep-links identify the Request/Intent only; Integration secrets and private identity-transfer plaintext do not enter the URL.

## 9. Personal API use vs Workspace API use

API capability should also follow progressive enhancement.

A future developer may create a one-off request without a Team Workspace:

```text
personal/service integration
-> one request
-> scoped callback/result
```

Workspace becomes relevant when the integration itself needs persistent shared ownership:

```text
Workspace API credential
shared webhook configuration
shared Activity
shared policies
team-owned Agent/service identity
```

Therefore do not make `workspace_id` mandatory merely because a request was created through an API.

## 10. Implementation restraint

Current MVP should not build:

- organizations/Workspace tables solely for future compatibility;
- a generic policy DSL;
- generic arbitrary-intent execution;
- unreliable webhook delivery without a durable outbox, signed delivery, retry, and delivery history;
- OAuth/service-account administration without an external consumer;
- a generalized event bus solely because the future API may use events.

Current work should only preserve the semantic extension points and avoid schema/API assumptions that would make them impossible later.

A useful implementation rule:

> Add the field/abstraction when the first real feature needs it; reserve the boundary in documentation before then.

FedNetwork can be the first external API consumer that justifies implementing the integration layer rather than speculating about it in advance.


## SAINT relationship-discovery provider

SAINT may later provide indexed `signer -> controlled accounts` and other address relationships to MultiSigTools. This remains discovery only: live Stellar ledger state is the authorization authority.

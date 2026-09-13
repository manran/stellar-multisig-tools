# MultiSig Tools — Progressive SaaS and Platform Extension Points

Status: architecture/product guidance; future-facing, not current MVP implementation
Date: 2026-08-30

This document records the minimum extension points needed so the current Stellar multisig product can grow into Team/Workspace and external API use without prematurely building a generic SaaS platform.

It complements `WORKSPACE_MODEL.md`, `MULTI_AUTHORITY_INTENTS.md`, `TRANSACTION_CONTEXT.md`, and `PRIVACY_AUDIT_MODEL.md`.

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

The external service is an **Actor/Integration**, not automatically a Stellar signer and not automatically a Workspace.

## 5. Candidate API contract

Exact route names are deferred. The semantics should support a future flow such as:

```http
POST /v1/requests
GET  /v1/requests/{id}
GET  /v1/requests/{id}/activity
POST /v1/requests/{id}/cancel
```

Creation conceptually supplies:

```text
subject / exact artifact
network if applicable
context mode
required authority domains
expiry
execution mode
external correlation id / idempotency key
optional Workspace scope
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
Workspace API credential
Agent credential
mutual-TLS / enterprise workload identity
```

A service credential may permit:

```text
requests:create
requests:read-own
requests:cancel-own
activity:read-own
```

It must **not** allow the service to fabricate user signatures or satisfy Stellar thresholds merely because it created the request.

Later scopes may restrict:

- allowed networks;
- allowed subject types;
- allowed source/controlled accounts;
- allowed Workspace;
- execution rights;
- webhook endpoints.

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

FedNetwork identity transfer is a useful first integration because it exercises several real boundaries at once.

Example:

```text
FedNetwork
  -> creates exact Stellar transaction + private committed transfer intent
  -> POSTs/creates MultiSigTools request
  -> sends or redirects A/B to MultiSigTools review

MultiSigTools
  -> discovers/evaluates Account A authority
  -> discovers/evaluates Account B authority
  -> collects signatures independently
  -> marks request Ready

FedNetwork
  -> receives `request.ready`
  -> re-checks claim_version / nonce / expiry / business policy
  -> adds its retained channel/source signature
  -> submits transaction
  -> waits for confirmation
  -> applies identity ownership transition idempotently
```

For this case:

```text
execution.mode = external
executor = FedNetwork
```

MultiSigTools coordinates authorization but does not need to own FedNetwork's business-state transition.

The deep-link should identify the request, not carry the private identity-transfer plaintext. Authorized users fetch that context from MultiSigTools after access is established.

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
- webhook infrastructure before a real integration needs it;
- OAuth/service-account administration without an external consumer;
- a generalized event bus solely because the future API may use events.

Current work should only preserve the semantic extension points and avoid schema/API assumptions that would make them impossible later.

A useful implementation rule:

> Add the field/abstraction when the first real feature needs it; reserve the boundary in documentation before then.

FedNetwork can be the first external API consumer that justifies implementing the integration layer rather than speculating about it in advance.


## SAINT relationship-discovery provider

SAINT may later provide indexed `signer -> controlled accounts` and other address relationships to MultiSigTools. This remains discovery only: live Stellar ledger state is the authorization authority.

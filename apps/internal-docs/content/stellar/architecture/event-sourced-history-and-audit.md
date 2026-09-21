---
title: "MultiSigTools — Event-Sourced History and Audit"
description: "Internal MultiSig Tools engineering documentation."
---

**Status:** architecture/product decision baseline  
**Date:** 2026-09-03  
**Updated:** 2026-09-08 — durable facts separated from time/ledger state projections
**Scope:** Proposal/Request history, signer participation, Transaction Receipt, Activity, future Audit.
**Related:** `PRODUCT_SEMANTICS.md`, `PRIVACY_AUDIT_MODEL.md`, `PROPOSAL_LIFECYCLE.md`, `WORKSPACE_MODEL.md`.

## 1. Decision

MultiSigTools History will use an **event-sourced domain model**.

The durable explanation of what happened is an append-only set of canonical domain facts. Human History, Activity, Request snapshots, Transaction Receipt and future Audit are projections of those facts.

```text
commands / external facts
        |
        v
canonical domain events + cryptographic evidence
        |
        +--> Request current-state projection
        +--> Human History
        +--> Signer Activity
        +--> Transaction Receipt / evidence
        +--> future Audit API / export / checkpoints
```

Do not make Human History depend on reconstructing facts that the server already knew when the action was accepted.

XDR reconstruction remains valuable for cryptographic verification, legacy recovery and integrity reconciliation. It is not the normal primary source for new History rows.

This pulls the append-only/audit-oriented design from `PRIVACY_AUDIT_MODEL.md` forward into the consumer History foundation instead of postponing it to a future Team/Enterprise release.

## 2. Horizon analogy — useful but not literal

Horizon is useful architectural precedent, but it should be described precisely.

Conceptually:

```text
Stellar ledger / LedgerCloseMeta
        = canonical network facts

Horizon ingestion / historical re-ingestion
        = replay / projection builder

Horizon database + API resources
        = query/read model

cursor + SSE streams
        = ordered consumer delivery
```

Horizon can ingest live ledger data and re-ingest historical ledger ranges to rebuild queryable historical state. Its streaming endpoints expose cursor-ordered transactions, operations, effects and other resources.

Horizon itself is not MultiSigTools' model of an immutable Event Store: its database is a derived service database and may use finite history retention. The stronger analogy is **Stellar ledger as fact source, Horizon as replayable projection/indexer**.

MultiSigTools needs its own event source because important coordination facts — Private Note revisions, signature contributions before submission, declines, sharing, access provenance and workflow decisions — are not Stellar ledger facts.

External references:

- Stellar Horizon Admin Guide — Ingestion: https://developers.stellar.org/docs/data/apis/horizon/admin-guide/ingestion
- Stellar Horizon Admin Guide — Overview: https://developers.stellar.org/docs/data/apis/horizon/admin-guide/overview
- Stellar Horizon API — Streaming: https://developers.stellar.org/docs/data/apis/horizon/api-reference/structure/streaming

## 3. Three layers of truth

Keep these separate.

### 3.1 External cryptographic / ledger facts

Examples:

```text
exact transaction XDR
transaction hash
Stellar signature bytes
signature verification against signer key
ledger inclusion
ledger number
transaction result
```

These are independently verifiable facts.

### 3.2 Canonical MultiSigTools domain events

Examples:

```text
request_created
signature_observed
signature_contributed
signer_declined
submission_started
submission_failed
transaction_submitted
transaction_confirmed
private_note_added
private_note_revised
```

These answer what MultiSigTools accepted or objectively observed, when, with what provenance and evidence.

Do **not** promote reducer output such as `quorum_reached`, `request_expired`, `request_stale`, or `request_blocked` into canonical facts merely because the UI displayed that state. Those labels are derived from durable facts, evaluation time, and where required the relevant Stellar ledger/policy facts.

### 3.3 Projections

Examples:

```text
Request.status
signature count
current quorum state
Human History rows
Activity lists
Transaction Receipt
Audit exports
Inbox/Ready/Waiting lists
```

A projection may be rebuilt. A canonical event is not silently rewritten to make a projection convenient.

## 4. Event envelope

The durable model should converge on an envelope such as:

```text
DomainEvent
  version
  event_id
  request_id
  event_type
  occurred_at

  actor_address?          # only when cryptographically/procedurally proven
  transaction_hash?
  network

  provenance
  evidence_refs[]

  payload_digest
  previous_event_hash?    # reserved / enabled when linear append is guaranteed
  event_hash

  visibility_class
  protected_payload_ref?
```

Important rules:

1. `actor_address` is evidence, not UI decoration. Never guess it from viewer state.
2. Raw evidence may live in an immutable artifact referenced by digest rather than duplicated in every event.
3. Sensitive plaintext remains separate from the minimal event envelope.
4. Corrections create a later event; they do not edit prior security-relevant facts.
5. Event IDs must be stable and de-duplicable.

The current Blob storage backend does not provide a general transactional compare-and-swap primitive for a single per-Request linear hash chain under concurrent signer writes. Therefore do not claim a Level-2 tamper-evident linear chain until append ordering is actually guaranteed. Level-1 append-only domain semantics move forward now; event digests/evidence references should be designed so later checkpointing does not require changing Human History semantics.

## 5. Signature contribution is a canonical fact

The current implementation stores a signature contribution approximately as:

```text
StoredSignatureContribution
  digest
  signedXdr
  receivedAt
```

and later reconstructs signer History by replaying contributions, merging XDR and verifying signatures again.

For new data, the acceptance boundary already knows more than this. After a contribution is merged and validated, persist the accepted delta as the canonical fact.

Target concept:

```text
SignatureContributionAccepted
  event_id
  request_id
  occurred_at
  contribution_digest
  evidence_xdr_ref / signed_xdr_digest

  added_signatures[]
    signer_address
    signature_index / stable evidence locator
    signature_hint
    signature_digest

  provenance
    in_product_contribution
    external_contribution
    legacy_reconciled
```

The exact storage schema may evolve, but the invariant is fixed:

> If MultiSigTools knows which valid signer produced an accepted new signature at write time, that signer identity becomes durable event evidence at that boundary.

Do not require a later SEP-53 session merely to remember who signed this Proposal.

## 6. Base/imported signatures are different provenance

A Request may be created from an XDR that already contains signatures.

Those signatures can be cryptographically attributed, but they do not prove that the signer used MultiSigTools.

Use distinct provenance:

```text
signature_observed
  provenance = imported_at_creation

signature_contributed
  provenance = in_product_contribution | external_contribution
```

A cryptographically valid imported signature proves:

> this signer signed this exact Stellar transaction.

It does not by itself prove:

> this signer visited or used MultiSigTools.

For product/user analytics and personal-user semantics, only evidence that passes through a defined MultiSigTools participation boundary should count as in-product participation.

## 7. History projection

For normal new Requests:

```text
canonical events
   -> replay
   -> Human History
```

Example:

```text
request_created
signature_contributed Alice
signature_contributed Bob
transaction_submitted
transaction_confirmed
```

Human fact history:

```text
Proposal created
Alice signed
Bob signed
Submitted
Confirmed in ledger 123456
```

At a time between Bob's signature and submission, the current Request projection may say `ready`. That is a state computed for that time, not another historical fact row.

History must not recompute `Alice`/`Bob` every time merely because the information was omitted from storage.

### XDR reconstruction remains a recovery tool

Use XDR + signer candidates to:

- recover legacy contributions that predate canonical signer events;
- classify signatures already present in base/imported XDR;
- verify event/evidence integrity;
- reconcile partial writes or migrations;
- independently prove signature counts and signer identity during audit.

A recovered legacy fact should be marked with provenance such as `legacy_reconciled`; it must not masquerade as a fact originally recorded at contribution time.

## 8. Request state is a projection, not the audit log

The Request snapshot remains useful for fast product reads:

```text
status
mergedXdr
signatureCount
contributionCount
submission
```

But it is not the canonical explanation of how the current state was reached.

The model is:

```text
Facts <= t + evaluation time t
          |
          v
     reducer/projector
          |
          v
     Request state at t
```

Or, compactly:

```text
State(t) = Project(Facts <= t, t)
```

Current-state persistence may be cached/materialized for performance. It must be rebuildable or reconcilable from canonical facts plus the relevant external ledger facts. If a historical state claim depends on a signer/threshold/policy change, retain or reference the objective ledger fact (including ledger/time/provenance) needed for replay; do not persist `blocked` or `stale` as a substitute for that evidence.

## 9. History now, Audit later — same source

Do not build a second "audit subsystem" later that invents another history.

Consumer History is the first Audit projection.

```text
same event source
   |
   +--> concise Human History
   +--> detailed Transaction Receipt evidence
   +--> Signer/Account Activity
   +--> machine Audit API
   +--> PDF/export
   +--> tamper-evident checkpointing
```

This means audit-oriented fields that are cheap and durable should be captured when the event occurs, even when the current UI does not display all of them:

```text
actor evidence
transaction hash
network
contribution digest
signature digest/hint
provenance
server receive time
event type/version
visibility class
payload/evidence digest
```

Do not capture speculative enterprise metadata merely because it might someday be useful.

## 10. Audit strength progression

### Now — consumer History foundation

- append-only canonical domain facts;
- stable event IDs and versions;
- actor provenance recorded at acceptance time;
- evidence digests/references;
- deterministic replay into History/Activity;
- XDR/ledger reconciliation as independent verification;
- sensitive payload separation;
- no in-place rewrite of audit-relevant events.

### Later — tamper evidence

When the storage layer can guarantee ordered append semantics:

- per-Request sequence;
- previous-event hash;
- event hash chain;
- checkpoint head.

### Later — externally anchored Audit

- Merkle/checkpoint aggregation;
- externally timestamped/anchored roots;
- selective disclosure and auditor views;
- enterprise KMS/HSM/BYOK and retention policy.

History semantics must remain stable across these strength levels.

## 11. Signature participation and private-session authentication

Two cryptographic facts must not be conflated.

```text
valid Stellar transaction signature
    proves: signer authorized this exact transaction

fresh SEP-53 / SEP-10 challenge signature
    proves: this browser currently controls the signer key for a scoped session
```

They use the same underlying signing authority but have different freshness and scope.

A transaction signature can become public or transferable with the signed XDR. It therefore must not, by itself, mint a general reusable `/me` private session.

At the same time, requiring SEP-53 merely to record participation is redundant. Once MultiSigTools accepts a valid signature contribution and attributes its newly-added signature to a signer, it should durably bind that signer as a verified Request participant.

## 12. Proposed 15-minute contribution grant

A narrowly scoped grant can reduce friction after signing without turning historical transaction signatures into general login credentials.

### Why "signed in this browser" is not itself a cryptographic property

From the signed XDR alone, the server cannot prove whether the wallet produced that signature moments ago in this tab or whether the user pasted/forwarded an older signed XDR. The transaction signature contains no MultiSigTools nonce, domain or session expiry.

Therefore the system must not issue an account-wide private session merely because a browser submits a valid signed XDR.

### Safe bounded form

When an active Request accepts a **new, previously unseen signature contribution**, and the newly-added signature resolves unambiguously to one signer, the response may mint a short-lived grant:

```text
ContributionGrant
  auth_mode = transaction_contribution
  signer_address
  network
  request_id
  contribution_digest
  issued_at
  expires_at = issued_at + 15 minutes
```

The grant is fixed at 15 minutes; it is separate from the user's normal configurable SEP-53 unlock duration.

Recommended properties:

- issued only when `addedSignatureCount > 0`;
- no grant for duplicate/replayed contributions;
- no grant merely for signatures already present at Request creation;
- if one submitted XDR introduces multiple signer identities, do not mint a single-signer grant;
- bind the grant to the exact `request_id`, signer, network and accepted contribution;
- deliver it only to the browser receiving the successful contribution response, preferably through a Secure/HttpOnly/SameSite cookie or equivalently protected token channel;
- non-renewable by replaying the same transaction signature.

### Scope

A Contribution Grant may authorize only the Request that produced it, for example:

```text
current Proposal
its just-completed Transaction Receipt
its retained Request History/private context
```

It must **not** authorize:

```text
/me/activity across other Requests
Inbox across other Requests
personal Address Book / names
other Transaction Receipt
Treasury / Manage administration
API keys / Agent authority
workspace membership
account-wide retained history
```

Those broader private scopes still require a fresh SEP-53/SEP-10 private-session proof.

### Why this bounded grant is materially safer

To submit a contribution today, the caller already needs active Request access via the private capability or an authenticated signer session. A Request-scoped 15-minute continuation therefore does not convert a public transaction signature into a global identity credential. It mainly prevents the signer from hitting an immediate second wallet prompt when moving from Sign/Submit to the just-completed Details page.

A malicious holder of the same active capability who obtains another signer's signed XDR could still race to submit it. That is why the grant must remain Request-scoped: such a holder already has active access to that Request, but must not gain the signer's broader private identity/session.

## 13. UX consequence

The desired Human flow becomes:

```text
open shared Proposal
   -> sign exact transaction
   -> signature accepted
   -> signer participation is durably recorded
   -> 15-minute Request-scoped continuation grant
   -> Done / Transaction Receipt without a second auth prompt
```

If the same signer then chooses global Activity/Inbox:

```text
Contribution Grant identifies the likely signer/request context
   -> MultiSigTools preselects the wallet/address when possible
   -> fresh SEP-53/SEP-10 confirmation
   -> normal private session using the user's configured unlock duration
```

Unlock remains a security primitive, not a workflow step.

## 14. Migration direction from current implementation

Current behavior is hybrid:

```text
StoredSignatureContribution is durable
Activity fact rows are append-only where explicitly stored
History can reconstruct legacy signature facts from XDR + signer candidates
legacy status-projection Activity rows may still exist in storage but are not facts
```

Migration should be incremental:

1. define canonical event version/types and provenance;
2. make accepted signature delta + actor evidence durable at the contribution boundary;
3. project new History from canonical events;
4. retain XDR reconstruction for old Requests and integrity checks;
5. backfill/reconcile legacy events lazily or in a migration job;
6. only after storage ordering is strong enough, enable tamper-evident hash chaining/checkpoints.

Do not break existing Requests merely to obtain a pure event-sourced implementation in one release.

## 15. Invariants

1. History and Audit share one canonical event source.
2. New accepted signer identity is recorded when known, not rediscovered on every read.
3. Raw XDR remains independent cryptographic evidence and recovery input.
4. Request status is a projection, not the canonical history: `State(t) = Project(Facts <= t, t)`.
5. Imported signature provenance must not be misrepresented as MultiSigTools usage.
6. Valid in-product signature contribution creates durable Request participation without SEP-53.
7. Transaction signature alone never creates a general account-wide private session.
8. A 15-minute contribution-derived grant, if implemented, is Request-scoped and non-renewable by signature replay.
9. Broader personal private access requires a fresh private-session challenge.
10. Auditability does not imply public/private-plaintext visibility.
11. `ready`, `blocked`, `stale`, and expiry are never persisted or exported as Activity facts merely because they were observed as Request states.

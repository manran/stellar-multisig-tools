# MultiSig Tools — Privacy and Auditable Activity Model

Status: architecture/product decision baseline
Date: 2026-08-30

This document defines how MultiSig Tools can retain useful transaction context and Activity history without equating auditability with public readability.

It complements `TRANSACTION_CONTEXT.md`.

## 1. Core principle

> Auditability does not imply visibility.

A treasury coordination system needs to answer what happened, in what order, to which exact transaction, and under which authorization state. That does not mean every participant, server operator, database reader, or public observer should be able to read every business detail.

The architecture therefore separates:

```text
integrity / chronology / authorization evidence
from
plaintext visibility
```

The long-term target is an Activity system that can prove that events existed and were not silently rewritten while keeping sensitive event payloads separately protected or encrypted.

## 2. Threat model: “private” must name the adversary

Do not use `private` as an undefined security promise.

At minimum distinguish:

### Public observer

Can see normal Stellar ledger data after broadcast. Must not be able to enumerate private Signing Requests or read private coordination metadata.

### Unauthorized MultiSigTools user

May know an account address or request identifier but lacks an authorized session/capability. Must not receive private request detail.

### Database snapshot attacker

Obtains stored database/blob contents but not necessarily live application/KMS credentials. Encryption at rest plus key separation should make sensitive plaintext materially harder to recover.

### Application/server compromise

Attacker can execute code with the same privileges as the MultiSigTools backend. Server-readable encryption does not protect plaintext from this adversary.

### Service operator

For server-private data, the operator can technically process/decrypt plaintext. The product must not claim otherwise.

### End-to-end confidentiality target

For selected future payloads, plaintext is encrypted before storage and MultiSigTools backend does not possess the content-decryption key. This protects against database/backend disclosure, subject to client trust limitations.

For a web client, a compromised service that can replace the delivered JavaScript may still exfiltrate plaintext after decryption. Therefore future `MultiSigTools cannot read this` claims must define the trusted client distribution model precisely. Enterprise-controlled SDK/native clients provide a stronger client trust boundary than dynamically served web code.

## 3. Data visibility classes

Use explicit data classes instead of one boolean `is_private` flag.

### Public ledger facts

Examples:

```text
network
transaction hash
source account
operation source
asset
amount
recipient
operations
Stellar memo / MEMO_HASH
ledger result
```

These are public when the transaction is broadcast on Classic Stellar.

### Coordination metadata

Examples:

```text
request state
created / shared / signed / declined / submitted timestamps
signature contribution records
current projected quorum / Request state
workflow assignment
Activity fact type
```

These are private product data by default even when some underlying Stellar facts are public.

### Sensitive context payload

Examples:

```text
Private Note text
invoice number
internal PO
payroll description
customer identifier
private address-book labels
organization-specific descriptions
```

These should be stored behind authorization and a replaceable encryption envelope.

### Cryptographic/public commitments

Examples:

```text
transaction hash
Private Commitment MEMO_HASH
Activity payload digest
audit checkpoint root
```

A commitment may be public while the committed plaintext remains private.

## 4. Activity facts are append-only; Request state is a projection

Use two related concepts:

```text
SigningRequestSnapshot
= efficient state projection at evaluation time t

ActivityFact[]
= append-only facts used to explain/rebuild that state
```

The governing rule is:

```text
State(t) = Project(Facts <= t, t)
```

Do not reconstruct important audit facts later from only the current request row, and do not persist a reducer result merely to make it look historical. `ready`, `blocked`, `stale`, and expiry are state labels, not equivalent evidence to a signature contribution or ledger confirmation.

Examples of durable facts:

```text
request_created
private_note_added
private_note_revised
request_shared
approval_added
approval_invalidated
submission_started
submission_failed
transaction_submitted
transaction_confirmed
cancelled
```

If replaying state at an earlier time requires an external signer/threshold/policy change, preserve or reference the objective Stellar ledger fact with its ledger/time/provenance. Do not replace that evidence with a stored `request_blocked` observation.

Private Note edits create new revisions/events. Old note revisions are not silently rewritten.

## 5. ActivityEvent envelope

Exact storage schemas may vary, but preserve this conceptual split:

```text
ActivityEvent
  event_id
  request_id
  sequence
  event_type
  occurred_at

  actor_ref?
  transaction_hash?
  request_revision?

  previous_event_hash?
  payload_digest
  event_hash

  visibility_policy

  protected_payload
    mode: server_private | e2ee
    ciphertext
    encryption_version
    key_reference / grants
```

Not every event needs a protected payload.

For example `transaction_confirmed` may be fully represented by stable identifiers, ledger evidence and hashes, while `private_note_revised` has an encrypted payload.

Server-side indexes may retain the minimal fields required for authorization, querying, lifecycle processing, and delivery. Do not duplicate sensitive plaintext into index fields merely for convenience.

## 6. Three strengths of “immutable”

The product must not overclaim immutability.

### Level 1 — Application append-only

Normal APIs never update/delete existing Activity events. Corrections are represented as later events.

This gives clean application semantics but does not stop a database administrator or attacker from rewriting storage.

### Level 2 — Tamper-evident event chain

Each event can bind the previous event and its protected payload digest:

```text
event_hash = SHA256(
  version ||
  canonical_event_header ||
  payload_digest ||
  previous_event_hash
)
```

This detects missing/reordered/modified events when a previously trusted chain head is available.

A local hash chain alone still cannot prevent an attacker with full storage control from rewriting the entire chain and calculating new hashes.

### Level 3 — External checkpoint / anchor

Periodically commit a chain head or Merkle root outside the mutable Activity store.

Conceptually:

```text
Activity events
   -> Merkle root / chain checkpoint
   -> external timestamped anchor
```

Once a checkpoint is independently anchored, historical events covered by it cannot be retroactively rewritten without creating a mismatch with that external commitment.

A future Stellar-native option is to publish only an audit checkpoint hash from a dedicated MultiSigTools anchor account. A `ManageData` update on that dedicated account is one possible mechanism because the ledger history remains public while the checkpoint reveals no business plaintext. This is a future design option, not an MVP requirement.

Enterprise deployments may alternatively anchor to an organization-controlled transparency/audit system.

## 7. Encryption progression

Privacy should also be progressive.

### Stage A — Server-private

Initial implementation may use:

```text
TLS in transit
authenticated ACL
private storage
encryption at rest
key separation / KMS
strict log redaction
```

This protects against public retrieval and reduces damage from storage-only disclosure.

It does **not** make plaintext unreadable to the MultiSigTools backend/operator.

Product wording must remain truthful:

> Visible only to authorized workspace participants through MultiSigTools.

Do not claim end-to-end encryption.

### Stage B — Client-encrypted / E2EE payload

For higher privacy:

```text
client creates random DEK
payload encrypted locally
server stores ciphertext
DEK granted/wrapped only to authorized readers
```

The request/event model remains the same; only the protected payload mode changes.

Conceptually:

```text
ProtectedPayload
  mode: e2ee
  algorithm_version
  ciphertext
  ciphertext_digest
  key_grants[]
```

The backend may still see minimized routing metadata such as request identity, authorization grants, event timing, and ciphertext sizes. E2EE does not imply metadata invisibility.

### Stage C — Enterprise key control

Enterprise deployments may use organization-controlled KMS/HSM/BYOK-style key adapters.

The important architecture rule is that MultiSigTools business logic consumes an encryption/key-provider interface rather than assuming one global server key forever.

## 8. Key hierarchy

Do not encrypt all private history directly under one long-lived global key.

Prefer envelope encryption:

```text
organization/workspace key?       optional
          |
          v
request DEK / payload DEK
          |
          +-> Private Note revision
          +-> Private Commitment payload
          +-> selected Activity payloads
```

A per-request DEK is a reasonable default design point. Highly sensitive or independently erasable objects may use per-payload DEKs.

Key grants are separate from Stellar signing authorization:

```text
can decrypt request context
!=
can sign the Stellar transaction
```

A removed Stellar signer therefore does not automatically imply either permanent access or immediate key revocation; access policy explicitly decides that lifecycle.

## 9. Human access and capability links

Current capability links can evolve naturally into confidential request sharing.

Server-private mode:

```text
# capability grants request access
```

Future E2EE mode may conceptually use:

```text
URL fragment
  capability authorization material
  + request decryption material or wrapped-key locator
```

Fragments are useful because browsers do not send them in normal HTTP requests, but client-side code can read them. They must still be treated as bearer secrets and must not appear in analytics, screenshots, crash reports, or logs.

For long-lived team membership, explicit participant key grants are preferable to sharing one durable bearer decryption secret indefinitely.

## 10. Integration with the three transaction-context models

### Stellar Memo

Public by definition after broadcast. No private storage promise applies to the on-chain memo.

### Private Note

Private workflow payload. Not part of the Stellar transaction hash.

Activity records revisions append-only, but a Stellar transaction signature does not attest the note text.

Private Note storage should support both:

```text
server_private
future e2ee
```

without changing Note semantics.

### Private Commitment

Private plaintext is stored off chain; `MEMO_HASH` is inside the exact Stellar transaction.

Activity may record:

```text
commitment_created
commitment_hash
payload_digest
commitment_version
transaction_hash
```

The plaintext/salt are protected payload data.

Because the commitment is part of the transaction, Stellar signatures cryptographically bind the signer to the commitment hash, though not to a human-readable plaintext unless that plaintext+salt later verifies against the commitment.

## 11. Approval and context audit semantics

An Activity event such as:

```text
Alice approved transaction X
```

means that valid authorization evidence for transaction X was contributed by Alice/the relevant signer key under the recorded state.

It must not silently mean:

```text
Alice cryptographically approved the current Private Note text
```

For Private Note, the Activity system may record which note revision was displayed in the UI when an approval was made as workflow evidence, but this remains application audit metadata rather than part of the Stellar signature.

If a team requires cryptographic binding between private context and the signed transaction, use Private Commitment.

## 12. Cryptographic erasure and retention

### Current durable-retention baseline

For the public-beta baseline, an accepted Request is an audit-bearing business fact. `expiresAt` closes active coordination/signature collection; it is **not** a physical-deletion deadline. Accepted Request records, signature contributions, submission results, participant evidence, Activity events, private context, and administration audit records are not removed by a scheduled cleanup job.

Abuse is handled before acceptance: authenticated/delegated writer identity, live signer authorization where applicable, strict body/XDR/private-context size limits, edge rate limiting, quotas/anomaly controls, and the ability to reject new writes. Once the service acknowledges a durable write, later anti-abuse cleanup must not silently erase the historical fact.

Future privacy erasure should preserve the durable fact while removing readable sensitive payload through an explicit, audited mechanism such as cryptographic erasure/redaction. That future mechanism must itself produce durable evidence and must not rewrite prior events in place.

Append-only audit history and private-data deletion are not necessarily contradictory.

For encrypted payloads:

```text
immutable event envelope
+ encrypted payload
+ independently destroyable key
```

A retention/deletion action may destroy the content key while retaining a minimal event stating that private context existed at that point in the workflow.

This is cryptographic erasure only if all usable copies of the key are actually removed. Plaintext leaks, logs, caches, exports, replicas, backups, browser storage, and duplicated wrapped keys can defeat the promise.

Therefore cryptographic erasure is a key-management and data-flow property, not merely `DELETE key FROM database`.

## 13. Metadata leakage

Even encrypted Activity can reveal patterns:

```text
which organization/request is active
how often approvals occur
when a transaction reached quorum
ciphertext size
event timing
participant relationships if indexes expose them
```

The security model must not describe encrypted payloads as hiding all metadata.

Enterprise/privacy modes may progressively minimize or encrypt more indexes, suppress public pending counts, and separate auditor/participant views.

## 14. API and webhook rules

Activity API and event delivery should use the same visibility model as the Human UI.

Conceptually:

```text
GET /requests/:id/activity
GET /accounts/:id/activity
GET /me/activity
```

Machine events may include:

```text
request_created
approval_added
signer_declined
transaction_submitted
transaction_confirmed
private_context_changed
```

Rules:

- webhook payloads contain only fields authorized for that subscription;
- private plaintext is never included merely because an event exists;
- ciphertext is not automatically useful/safe to send to every webhook consumer;
- event IDs/hashes allow consumers to de-duplicate and verify ordering;
- API consumers must be able to distinguish public facts, server-private payloads, and E2EE payloads explicitly.

## 15. Implementation order

Do not build full E2EE before the coordination product proves that users need it.

Recommended progression:

### Now / consumer foundation

- preserve Private Note / Private Commitment semantic separation;
- define append-only Activity events;
- prohibit in-place rewriting of audit-relevant events;
- classify sensitive fields;
- keep plaintext out of logs;
- keep storage/encryption behind replaceable interfaces;
- use authorization-scoped reads;
- avoid APIs that assume every event payload is plaintext.

### Team / treasury layer

- Activity timeline;
- Private Note revision history;
- server-side envelope encryption;
- retention policies;
- notification/webhook events;
- tamper-evident event hashing/checkpoints.

### Enterprise / high privacy

- client-side encrypted payloads;
- participant/org key grants;
- KMS/HSM/customer-managed key adapters;
- selective disclosure/auditor views;
- cryptographic erasure policies;
- externally anchored Activity checkpoints.

## 16. Security invariants added by this model

1. Auditability does not require public or operator-readable plaintext.
2. `private server storage` must never be represented as E2EE.
3. Activity facts are append-only at the application/domain level; corrections create new facts/events, while Request state is derived from facts + evaluation time.
4. A local hash chain is tamper-evident only relative to a trusted prior checkpoint; it is not by itself immutable against a full-store attacker.
5. Sensitive Activity payloads are separate from minimal query/index metadata.
6. Private Note content is not cryptographically covered by Stellar transaction signatures.
7. Private Commitment is cryptographically bound through the transaction `MEMO_HASH`.
8. Read/decrypt permission is distinct from Stellar signing authority.
9. Encryption architecture must permit server-private and future E2EE envelopes without changing request semantics.
10. Deletion/retention claims must account for keys, logs, caches, exports, and backups.
11. E2EE protects plaintext, not necessarily traffic/coordination metadata.
12. External audit anchoring, when used, publishes commitments/checkpoints rather than private business content.

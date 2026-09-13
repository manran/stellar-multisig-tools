# MultiSig Tools — Transaction Context and Progressive Product Model

Status: product decision / implementation guidance

This document defines how transaction context should evolve from a simple multisig tool into team treasury coordination and later API infrastructure without changing the underlying transaction model.

## 1. Progressive product layers

MultiSig Tools should grow by progressive enhancement rather than by turning into a different product for each audience.

```text
Ordinary user
MultiSig Tool
-> create / review / sign / submit

Small team / enterprise
Treasury Coordination Layer
-> Inbox / Waiting / Ready / Activity
-> private context
-> address books
-> audit / notifications / policy

Developer / system
API Infrastructure
-> request lifecycle API
-> signing / approval API
-> policy integration
-> webhook / event delivery
-> Agent integration
-> audit API
```

The same Signing Request and Stellar transaction core should survive through all three layers. Higher layers add coordination, context, retention, policy, and automation; they do not replace the basic multisig flow.

Design principle:

> Simple by default, coordinated when needed, programmable when scaled.

The ordinary user should be able to use MultiSig Tools as a focused multisig tool without learning treasury-workflow vocabulary. Team and enterprise capabilities should appear only when the user needs persistence, coordination, private context, audit, or automation.

## 2. Three transaction-information models

Transaction-related information has exactly three primary product models.

| Model | Human meaning | Visibility | Stored on Stellar | Bound by transaction signatures |
| --- | --- | --- | --- | --- |
| **Stellar Memo** | Public information written directly into the Stellar transaction | Public | Yes | Yes |
| **Private Note** | Private context attached to the request/workflow | Authorized viewers only | No | No |
| **Private Commitment** | Private information with a public on-chain cryptographic commitment | Private plaintext; public hash | `MEMO_HASH` only | Yes, to the commitment |

The UI may describe the third model as **Private memo · on-chain proof**. Internally and in security-sensitive documentation, prefer **Private Commitment** because the plaintext itself is not on chain.

### 2.1 Stellar Memo

This is the ordinary native Stellar memo.

Examples:

```text
Invoice 2026-0831
Order 48172
Exchange deposit reference
```

Properties:

- the memo is part of the Stellar transaction payload;
- it is public and should be treated as permanently observable once submitted;
- transaction signatures cover it;
- normal Stellar memo types may be supported where useful;
- the transaction has one Stellar memo field, so choosing a public native memo occupies that field.

Use this when the information is intentionally public and should travel with the transaction itself.

### 2.2 Private Note

A Private Note is private workflow context attached to the transaction/request.

Examples:

```text
August infrastructure invoice
Customer escalation approved by Alice
Payroll batch 2026-08
Internal PO 48271
```

Properties:

- stored off chain;
- visible only through the request capability or an authenticated/authorized private workspace;
- does not modify the Stellar transaction;
- therefore does **not** change the transaction hash;
- Stellar signatures do **not** cryptographically attest the note;
- may be shown in Inbox, Review, Activity, audit views, or API responses according to authorization.

The UI must not imply that a signer cryptographically approved the text of a Private Note merely because they signed the Stellar transaction.

A Private Note answers:

> Why are we doing this transaction?

It is contextual information, not part of Stellar authorization.

### 2.3 Private Commitment

A Private Commitment is private transaction context whose integrity is committed into the Stellar transaction.

Conceptually:

```text
private payload
+ random salt
+ versioned canonical encoding
        |
        v
SHA-256 commitment
        |
        v
Stellar MEMO_HASH
```

Recommended commitment shape:

```text
H = SHA256(
  "multisig.tools/private-memo/v1" ||
  salt ||
  canonical_payload
)
```

The exact binary encoding must be specified before implementation. The important requirements are domain separation, versioning, canonicalization, and a cryptographically random salt.

Off-chain storage keeps at least:

```text
commitment hash
-> encrypted(private payload + salt + metadata)
-> access-control information
-> request / transaction relationship
```

Properties:

- the plaintext remains off chain and private;
- only the hash is public on Stellar;
- the random salt prevents practical guessing attacks against low-entropy notes;
- all transaction signatures cover the `MEMO_HASH`, so signers cryptographically approve the exact commitment as part of the transaction;
- authorized viewers may retrieve the plaintext and salt off chain;
- a future Reveal action may disclose plaintext + salt so anyone can recompute the commitment and verify that it matches the transaction;
- the public hash is a proof/lookup anchor, never an authorization credential.

A Private Commitment answers:

> Keep this information private, but make its relationship to this exact signed transaction publicly verifiable.

## 3. Important boundary: Private Commitment is not a private transaction

Private context does not hide the Stellar transaction itself.

Unless a future privacy protocol changes the underlying transaction model, these remain public:

```text
source account
operation source
recipient / destination
asset
amount
operations
transaction timing / ledger inclusion
```

Only the committed private payload remains hidden.

Do not market this feature as privacy payments or confidential transactions.

## 4. Stellar's single memo slot

A Stellar transaction has one memo field.

Therefore an on-chain public `MEMO_TEXT` / `MEMO_ID` and a Private Commitment using `MEMO_HASH` cannot both occupy the native transaction memo at the same time.

The product must present this as a real choice rather than pretending both can be placed on chain simultaneously.

Possible needs map as follows:

```text
Need readable public information on Stellar
-> Stellar Memo

Need private workflow context only
-> Private Note

Need private context cryptographically bound to the transaction
-> Private Commitment / MEMO_HASH
```

If a team needs public Human-readable request metadata in addition to a Private Commitment, that public description may exist in MultiSig Tools request/activity metadata, but it must not be confused with a native Stellar memo.

## 5. Progressive UI

Do not present users with hash, salt, canonicalization, ACL, or commitment terminology unless they open technical detail.

The ordinary transaction flow should remain minimal.

A compact starting point may be:

```text
Transaction context
[ Add memo or note ]
```

Opening it can expose two understandable choices:

```text
Stellar memo
Public on Stellar

Private note
Only people with access can see it
```

If the user chooses Private Note, offer the stronger third model as a progressive enhancement:

```text
Private note
[ Invoice INV-2026-0831 · PO 48271 ]

[ ] Add on-chain proof
    Store a verification hash in the Stellar transaction.
    The text stays private.
```

When `Add on-chain proof` is enabled, the underlying model becomes Private Commitment and the transaction memo becomes `MEMO_HASH`.

This gives a natural progression:

```text
No context
    |
    +-> Stellar Memo          public + on-chain
    |
    +-> Private Note          private + off-chain
              |
              +-> on-chain proof
                    = Private Commitment
```

The UI may continue to use the friendlier wording `Private memo` for the enhanced state, but technical detail should state clearly that only a hash is on chain.

## 6. Editing, signing, and audit semantics

The three models differ materially once approvals begin.

### Stellar Memo

Editing it changes the Stellar transaction and therefore changes what must be signed.

### Private Note

Editing it does not change the Stellar transaction or invalidate existing Stellar signatures.

Because of this, the product must not silently rewrite shared context after people have acted on it.

Recommended behavior:

- drafts may edit Private Notes freely;
- after a request is shared or approvals begin, edits should be versioned/audited;
- Activity should show that the note changed and when;
- the UI must never claim an old Stellar signature attests the new note text.

For sensitive workflows, teams that require cryptographic binding should use Private Commitment instead of relying on a mutable Private Note.

### Private Commitment

Editing the private payload or salt changes the commitment.

Therefore:

```text
private payload changes
-> MEMO_HASH changes
-> Stellar transaction changes
-> existing transaction signatures are no longer signatures for the new transaction
-> rebuild / re-approve
```

This is the strongest semantic difference between Private Note and Private Commitment.

## 7. Activity and treasury coordination

Private context becomes more valuable when MultiSig Tools evolves from a one-shot tool into a treasury coordination layer.

An authorized Activity view may eventually answer:

```text
What was this payment for?
Who prepared it?
Who approved it?
What private note was attached at the time?
Was that context cryptographically committed on chain?
When did quorum become sufficient?
Who submitted it?
What transaction hash / ledger resulted?
```

Example:

```text
18,000 USDC -> Payroll
"August contractor payroll"
Private commitment verified
4/4 approved
Submitted
TX ...
```

An ordinary user does not need Activity or retained private context to use the basic multisig tool. Teams gain those features progressively when they need coordination and auditability.

## 8. API evolution

The same model should later be expressible through APIs without inventing a second enterprise-only transaction model.

Conceptually a request may contain:

```text
transaction
context:
  kind: none | stellar_memo | private_note | private_commitment
  ...
```

The exact API schema is intentionally deferred until implementation, but the semantic distinctions in this document are stable requirements:

- public native memo;
- private off-chain context;
- private context cryptographically committed into `MEMO_HASH`.

Agents and enterprise systems must be able to inspect these distinctions explicitly rather than infer them from UI copy.

## 9. Security requirements for future implementation

Before implementing Private Note / Private Commitment persistence, define and test:

- authorization scopes for reading private context;
- capability-link access behavior;
- encryption at rest and key-management boundary;
- retention/deletion policy;
- audit/version semantics;
- canonical payload encoding;
- commitment versioning/domain separation;
- cryptographically secure random salt generation;
- behavior when a request expires, is cancelled, or is rebuilt;
- Reveal semantics;
- API/webhook redaction rules;
- logging rules so private plaintext and capability secrets never appear in ordinary logs.

The on-chain commitment must never be treated as sufficient proof that the off-chain plaintext is trustworthy or authorized. It proves only that revealed data matches the committed hash.
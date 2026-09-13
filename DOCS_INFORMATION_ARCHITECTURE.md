# Documentation Information Architecture

Status: product contract

This file defines the public documentation structure for the Stellar product at `stellar.multisig.tools`. It is the documentation counterpart to `PRODUCT_SEMANTICS.md` and `UX_DESIGN_SYSTEM.md`.

## 1. Purpose

Public documentation is a task-oriented product surface, not a mirror of Stellar protocol primitives and not a dump of internal architecture documents.

The documentation must help a reader answer one of four questions:

1. How do I start?
2. How do I perform a transaction task?
3. How does the MultiSigTools model work?
4. How does software automate a Treasury workflow?

Protocol details remain available when they explain a task or security boundary, but they are progressive disclosure rather than the top-level navigation.

## 2. Canonical information architecture

The public documentation has exactly four top-level sections:

```text
Start
Transactions
Concepts
Automation
```

### Start

Short task pages for the highest-value first actions:

- Sign a Proposal
- Create a Treasury

The Docs home also points directly to the current primary transaction task, Payment.

### Transactions

One page per shipped Human transaction template. Pages are named by the user intent, not the underlying Stellar operation type.

Current shipped pages:

- Send a payment
- Send a batch payment
- Send a claimable payment
- Create a multi-party transaction

The three lower-frequency templates remain secondary to ordinary Payment in the product picker. Transaction pages enter this section only after the corresponding Human flow ships; do not create placeholder pages for speculative or planned transaction types.

### Concepts

Pages that explain stable product/security concepts shared by multiple tasks:

- Proposal and Transaction
- Multi-party transactions
- Sign and Unlock
- Activity, History and privacy

Concept pages must explain the Human model first. Exact terms such as Request, XDR, source account, SEP-53 or Contribution Grant belong in clearly secondary technical detail where needed.

### Automation

Machine-facing documentation may use exact API/protocol vocabulary because the reader is building an integration.

Current page:

- Agent API

The existing `/developers` URL remains a compatibility alias for the canonical Automation documentation. New links must use `/docs/automation`.

## 3. Route contract

Canonical public Docs root:

```text
/docs
```

Canonical first-batch pages:

```text
/docs/sign-a-proposal
/docs/create-a-treasury
/docs/transactions/payment
/docs/transactions/batch-payment
/docs/transactions/claimable-payment
/docs/transactions/multi-party
/docs/concepts/proposal-and-transaction
/docs/concepts/multi-party-transactions
/docs/concepts/sign-and-unlock
/docs/concepts/history-and-privacy
/docs/automation
```

Both the Stellar subdomain and `/stellar/...` directory-host form must resolve the same Docs routes.

Unknown `/docs/...` paths render an explicit Docs not-found state. They must not silently become Inbox or another workspace.

## 4. Page types

Every public documentation page is one of three types.

### Task

Explains how to accomplish a concrete product action.

Required order:

1. what the task does;
2. the shortest successful path;
3. important decision or safety boundary;
4. optional technical detail.

### Concept

Explains one stable product model or boundary. It must answer "why does the product behave this way?" without becoming an implementation history.

### Reference

Exact machine/API contract. Reference pages may lead with HTTP, XDR, idempotency and status values because this is the user's task vocabulary in that context.

## 5. Vocabulary contract

Human task and concept pages use the Human vocabulary from `PRODUCT_SEMANTICS.md`:

- Proposal
- Sign / Signed / signature
- Treasury
- Payment
- Activity
- Transaction Receipt
- Unlock

Do not lead Human pages with:

- Request
- XDR
- SetOptions
- CreateClaimableBalance
- source-account authorization internals
- SEP/CAP identifiers

Those terms may appear in a `Technical details` disclosure when they materially explain behavior.

Automation documentation is the explicit exception: exact protocol and API terms are first-class there.

## 6. Progressive-disclosure contract

A non-developer must be able to complete a task without opening `Technical details`.

Technical disclosures may explain:

- the underlying Stellar operation;
- exact XDR/signature semantics;
- source-account authorization;
- Request/capability/session distinctions;
- SEP-53/SEP-10 implementation details;
- machine/API fields.

Security boundaries that affect the user's decision must not be hidden only inside a disclosure. For example, `Sign != Submit` and Private Note privacy characteristics are Human-facing facts.

## 7. Transaction documentation contract

MultiSigTools is not a generic Stellar operation builder. A transaction page is justified when the Human task is common enough that a user or team reasonably wants MultiSigTools to construct the transaction instead of hand-building XDR.

A new transaction type requires all of:

1. a shipped product composer or equivalent Human flow;
2. a stable Human name and Review representation;
3. deterministic validation before XDR construction;
4. a clear signing/authorization model;
5. a public Docs task page.

Do not expose a protocol operation merely to increase feature count.

## 8. Multi-party documentation invariant

Documentation must preserve the v127 model:

> A Proposal belongs to the exact Stellar Transaction, not to one Treasury.

When one transaction contains operations sourced by independent accounts, each source account remains its own cryptographic authorization domain. The same Proposal may therefore be relevant to more than one Treasury/account view.

A future organizational `Party` concept may label or group those domains, but documentation must never imply that business labels replace source-account/signer authorization truth.

## 9. Automation boundary

Automation is a separate documentation lane, not a separate product model.

Automation pages may explain:

- Signer Agent credentials and Treasury Audit credentials;
- prepared XDR;
- idempotency;
- API status values;
- Request identifiers;
- exact HTTP examples.

They must preserve the same authority boundary as the Human product: an API key can propose within its documented scope but is not a Stellar signer and does not gain Human signing custody.

## 10. Navigation and growth rules

- Footer navigation uses `Docs`, not `Developers`, as the public documentation entry.
- Product-context links may deep-link directly to the relevant Docs page.
- Keep the public Docs surface small. Add pages because a repeated user task or stable concept needs one, not because an internal Markdown file exists.
- Do not add search until the public page count makes navigation materially difficult.
- Do not add documentation versioning until a public compatibility contract actually requires multiple simultaneously supported versions.
- Internal architecture/audit/privacy design files remain repository contracts; they are sources for public documentation, not automatically public pages.

## 11. Source-of-truth and freshness

Public documentation must describe shipped product behavior.

Truth order for documentation changes:

```text
runtime/source + executable tests
  -> PRODUCT_SEMANTICS / focused contracts
  -> public Docs copy
```

If public copy and runtime disagree, fix or remove the public claim. Do not preserve stale wording for narrative continuity.

Any product change that modifies a documented task, authority boundary, route, terminology, privacy behavior or public API must update the relevant public Docs page in the same bounded batch.

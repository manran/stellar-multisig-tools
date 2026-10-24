---
title: "Documentation Information Architecture"
description: "Internal contract for the public MultiSig Tools Stellar documentation surface."
---

**Status:** canonical public documentation contract

**Updated:** 2026-09-22

This file defines the public documentation structure for MultiSig Tools on the dedicated Stellar documentation site. It is the documentation counterpart to `apps/internal-docs/content/stellar/architecture/product-semantics.md`, `apps/internal-docs/content/stellar/product/ux-design-system.md`, `apps/internal-docs/content/stellar/architecture/integration-product-model.md`, and the running Headless API.

## 1. Purpose

Public documentation is a task-oriented product surface. It is not a mirror of Stellar protocol primitives and it is not a dump of internal architecture files.

A reader should be able to answer one of four questions immediately:

1. What do I need to do as a signer or Treasury operator?
2. How do I perform a Human transaction task?
3. Why does MultiSig Tools behave this way?
4. How should my software integrate with MultiSig Tools?

The first three lanes use Human product language. The Developer lane may use exact API/protocol vocabulary because those details are the developer's task.

## 2. Canonical information architecture

The public documentation has four top-level sections:

```text
Start
Transactions
Concepts
Developers
```

### Start

Highest-value Human first actions:

- Sign a Proposal
- Create a Treasury

The Docs home begins with three task choices rather than three product categories:

- Review and sign a Proposal
- Create or manage a Treasury
- Integrate MultiSig Tools

### Transactions

One page per shipped Human transaction template, named by user intent rather than Stellar operation type.

Current pages:

- Send a payment
- Send to multiple recipients
- Send a claimable payment
- Create a multi-party transaction

A transaction page exists only after the corresponding Human flow ships.

### Concepts

Stable Human/security concepts shared by multiple tasks:

- Proposal and Transaction
- Multi-party transactions
- Sign and Unlock
- Activity, History and privacy

Concept pages explain the Human model first. Request, XDR, SEP-53, Contribution Grant, source-account mechanics, and other protocol terms are secondary unless the concept specifically depends on them.

### Developers

Developer documentation begins with an ownership decision, not an endpoint catalog.

Canonical order:

1. **Choose your integration**
   - Hosted
   - On my site
   - Full Headless
2. **Testnet quickstart**
   - One runnable Hosted Classic path from self-service Testnet Integration creation -> one-time `msi_*` -> semantic Request -> signer review -> canonical status/webhook.
   - It is the first-success path, not an endpoint catalog; Soroban and Full Headless depth stay on their dedicated pages.
3. **Classic integration**
4. **Soroban integration**
5. **API and webhooks**
6. **Security model**
7. **Agent API**

The integration depth pages describe one Headless authorization core with progressively more orchestration owned by the integrator. They must not imply that Hosted, Native, and Headless are separate workflow engines.

## 3. Developer integration chooser

The first developer question is:

> How much signer interaction and orchestration does my product want to own?

### Hosted

The Integration creates/tracks work. MultiSig Tools renders the signer review/signing experience through the returned review URL.

Use when:

- the integrator wants the shortest path;
- signer wallet UX does not need to be embedded in the integrator's product;
- Hosted can also serve as a fallback for a more native integration.

### On my site

The integrator owns its business UI and signer wallet UX.

Current shipped Native Browser authorization is Soroban Intent scoped:

```text
Service --msi_*--> create Intent
Service --msi_*--> issue signer/origin/current-plan browser capability

Browser --mic_*--> inspect current signer challenge
Browser --wallet--> sign locally
Browser --mic_*--> contribute AUTH
```

The Browser capability is disclosure/transport authority, not signer authority. It cannot create arbitrary Intents, replan, cancel, change execution policy, or impersonate a signer.

Do not imply a Classic `mic_*` flow exists until one actually ships. Hosted is the universal Human fallback.

### Full Headless

The integrator may own Browser, Server, Agent, webhook consumer, wallet adapters, and executor orchestration.

The invariant is:

> Integrators may take over orchestration; they do not duplicate authority.

MultiSig Tools continues to validate signer membership, threshold/plan identity, signatures, effects, expiry, execution binding, and observed ledger evidence.

## 4. Route contract

Canonical Docs root:

```text
https://docs.multisig.tools/stellar
```

Human pages:

```text
/stellar/start/sign-a-proposal
/stellar/start/create-a-treasury
/stellar/transactions/payment
/stellar/transactions/batch-payment
/stellar/transactions/claimable-payment
/stellar/transactions/multi-party
/stellar/concepts/proposal-and-transaction
/stellar/concepts/multi-party-transactions
/stellar/concepts/sign-and-unlock
/stellar/concepts/history-and-privacy
```

Developer pages:

```text
/stellar/developers
/stellar/developers/testnet-quickstart
/stellar/developers/classic
/stellar/developers/soroban
/stellar/developers/api
/stellar/developers/security
/stellar/developers/agent-api
```

The Human Web does not own Docs routes. Product links point directly to the dedicated Docs origin. `/developers/integrations/new` remains a Human product route and must never be captured by documentation routing.

Unknown Docs paths are handled by the Docs application itself.

## 5. Page types

Every public documentation page is one of three types.

### Task

Explains a concrete product action.

Required order:

1. what the task does;
2. shortest successful path;
3. important decision/security boundary;
4. optional technical detail.

### Concept

Explains one stable product model or boundary. It answers “why does the product behave this way?” without becoming implementation history.

### Reference

Exact machine/API contract. Reference pages may lead with HTTP, Request, Intent, XDR, AUTH, idempotency, status, and headers because those are the reader's working vocabulary.

## 6. Vocabulary contract

Human task/concept pages use Human terminology:

- Proposal
- Sign / Signed / signature
- Treasury
- Payment
- Activity
- Transaction Receipt
- Unlock
- Prepare / Review / Sign / Submit / Done

Do not lead Human pages with:

- Request
- Intent
- XDR
- SetOptions
- CreateClaimableBalance
- source-account authorization internals
- SEP/CAP identifiers

Those terms may appear under Technical details when materially useful.

Developer pages are the explicit exception. Exact terms are first-class when required to implement the integration.

Human and Developer vocabulary must still refer to the same underlying objects. Developer exactness must not create a second product model.

## 7. Developer authority contract

Developer pages must preserve these separations:

```text
Integration Service identity != Stellar signer authority
Browser disclosure capability != signer authority
Agent credential            != private key
Execution ownership          != authorization ownership
```

### Integration credential

`msi_*` identifies one scoped Integration Profile. It may create/read/manage work only inside that business scope. It never supplies a Stellar signer signature.

### Browser capability

`mic_*` is short-lived and bound to one Integration, Intent, current AuthorizationPlan, signer, origin, and expiry. It transports one signer's current authorization interaction; the Authorization Core still verifies the wallet signature.

### Agent credential

An Agent credential delegates one signer Principal's Read/Write/Sign API access. Sign scope does not contain a private key; newly contributed cryptographic evidence is independently verified.

### Execution

Managed/external execution determines who prepares/submits/reconciles work. It does not redefine Treasury signer authority or Soroban AUTH authority.

## 8. Classic documentation contract

For semantic Classic payment Requests:

```text
Treasury G...    -> Payment operation source + live signer authority
MST channel G... -> transaction source + sequence + fee + submission
```

when managed execution is configured.

Developer docs must make clear:

- the Integration Profile never invents Treasury signers;
- managed channel authority is transaction-source authority only;
- Treasury signers still authorize the Payment operation;
- raw XDR is not silently rewritten;
- external execution is an explicit advanced configuration;
- managed Classic availability is deployment/network capability, not a universal promise;
- Mainnet channel provisioning/funding remains an explicit operator concern.

## 9. Soroban documentation contract

Soroban Integration is Intent first:

```text
semantic contract Intent
-> AuthorizationPlan
-> detached AUTH collection
-> authorization_ready
-> enforcing preparation
-> execution
-> reconciliation
```

Developer docs must preserve:

- SOURCE_ACCOUNT authorization is not silently converted into detached AUTH;
- replan changes plan identity and invalidates old Browser capabilities;
- structural effects drift requires re-authorization;
- significant numeric drift requires explicit review;
- managed/external execution is bound by Integration configuration;
- a signer cannot replace Integration-owned execution.

## 10. Webhook contract

Webhook is a notification channel, never canonical state.

Consumer rule:

```text
receive signed event
-> deduplicate event id
-> GET canonical Request / Intent / Job
-> act from current state
```

Public docs should describe the shipped durable PostgreSQL outbox/delivery behavior, including bounded retry and signed delivery, without implying that event receipt replaces a canonical read.

Polling remains a compatibility/fallback mechanism where appropriate, not the preferred way to understand internal authorization state.

## 11. Progressive disclosure contract

A non-developer must complete a Human task without opening Technical details.

A developer must be able to choose integration depth before learning:

- Browser capability headers;
- executor pools;
- channel accounts;
- raw XDR;
- internal evidence fields;
- exact webhook delivery machinery.

Security facts that change a user's decision must never be hidden only under a disclosure.

## 12. Navigation and growth rules

- Footer exposes both `Docs` and `Developers`.
- `Docs` leads Human/task discovery.
- `Developers` leads the integration chooser.
- Product-context links may deep-link to the relevant task/reference page.
- Do not add one page per internal Markdown file.
- Do not add search until page count/navigation evidence justifies it.
- Do not add documentation versioning until simultaneous public compatibility versions actually exist.
- Internal architecture files remain source contracts, not public pages by default.

## 13. Source of truth and freshness

Truth order:

```text
running source + executable tests + deployed contract
-> focused product/security contracts
-> public Docs copy
```

If a prose architecture document conflicts with current source/tests, resolve the conflict before publishing a claim.

Any product change that modifies a documented task, authority boundary, route, terminology, privacy behavior, or public API must update the corresponding public Docs in the same bounded batch.

---
title: "Phase 0 Foundation Audit"
description: "Code and persistence survey for Templates, Human notifications, reminders, and webhook productization."
---

**Status:** survey complete; P1/P2 implemented and deployed on Testnet; P3 next  
**Date:** 2026-10-30  
**Scope:** Classic Request, Soroban Intent, Inbox/Activity/Evidence, identity/address book, PostgreSQL, and Integration webhooks

## Decision

The foundation is stronger than the product surface suggests.

Do **not** create a new universal Work state machine, generic event table, or speculative enterprise columns. The current protocol facts, evidence model, PostgreSQL transactions, and Integration webhook outbox should remain.

Phase 0 should add only product concepts with a concrete near-term use:

1. Reusable Template;
2. explicit Human assignment/recipient;
3. Human notification delivery.

Workspace, enterprise roles, policy engines, and a generic notification center remain deferred.

## What is already good

### Coordination and evidence

Classic and Soroban correctly keep different protocol facts:

- Classic: Request, contributions, participants, submission, Activity facts;
- Soroban: Intent, authorization revisions/contributions, execution preparation/observation, cancellation.

Human status, Inbox, Activity, Receipt, and Integration Job are projections. This matches the existing rule that derived states such as quorum/expiry are not separate authorities.

Classic already persists append-only Activity facts. Soroban evidence is reconstructed from durable protocol fact tables. They do not need to be forced into one physical event table.

### Creator provenance

Both Request and Intent already preserve:

- Human creator address when known;
- Agent/service actor provenance;
- Integration ownership/correlation where applicable.

Do not add a redundant generic `created_by` or `source` column merely to prepare for productization. The existing actor model answers *who*. Future Template references answer *which reusable business recipe*. If a later product flow needs to distinguish guided/manual/import, add that concrete provenance then.

### PostgreSQL and webhook reliability

The Integration webhook foundation is already substantial:

- business mutation + transactional outbox;
- leases and at-least-once retry;
- durable per-attempt delivery history;
- Standard Webhooks signing;
- SSRF-safe transport;
- Queue/Cron wake adapters;
- current-state projection at delivery time.

Do not replace this with a new queue or generic message bus.

## Product gaps

### 1. Reusable Template — implemented for Payment / Batch Payment

Current "Payment", "Batch Payment", and account-control templates remain guided transaction primitives. Testnet now also has a user-owned Reusable Template definition and immutable Template version reference for Payment / Batch Payment.

Recommended Phase 1 shape:

- `reusable_templates`: identity, Human owner, network, name, primitive kind, archive/current-version metadata;
- `reusable_template_versions`: immutable version + validated definition JSON;
- Proposal/Request stores an optional immutable `template_id + template_version` reference.

Keep the definition JSON intentionally small and validate it with primitive-specific TypeScript schemas. Do not invent a generic rule/formula language.

Template v1 is signer-owned. Do not add Workspace ownership until shared Templates are a real product requirement.

### 2. "Who should act next?" — explicit Ask implemented

Inbox already has a useful viewer-action projection such as:

- sign;
- waiting for others;
- submit;
- route execution;
- attention.

That is a strong base for Human notification wording, but it answers the question for the **current viewer**. It does not record who a sender actually asked to act.

This distinction is already documented:

```text
On-chain signer eligibility != workflow assignment
```

Do not email every eligible Stellar signer.

When the user explicitly chooses **Ask Bob to sign**, Testnet now persists a lightweight Classic Request assignment. That assignment is coordination metadata only; it never changes Stellar authorization.

This is the smallest durable product object needed for Human notifications and reminders. It is deliberately not a workflow engine. Soroban assignment remains deferred until a concrete Human Soroban notification flow needs the same concept.

### 3. Contacts — notification email metadata added

The private Address Book is the product location and privacy boundary for signer contact details. Entries now support an optional private notification email in addition to the Stellar address and label.

Email remains contact metadata only:

- it never proves identity;
- it never grants Request access;
- it never changes Stellar authorization;
- it stays in the existing private object-storage boundary.

Outbound email delivery is deliberately a separate step. Do not hard-code a provider or make the existing Ask action claim that an email was sent until a real delivery integration is provisioned and verified.

### 4. Human notification delivery is a separate channel

The existing `integration_outbox` is intentionally scoped to Integration-owned work. Do not reuse it for ordinary Human email.

Human notification delivery needs its own small durable delivery/outbox model with:

- semantic notification key for deduplication;
- work reference;
- assignment/recipient reference;
- channel;
- due time (for reminders);
- delivery attempt/outcome metadata.

The canonical Request/Intent facts and explicit assignment remain the source of truth. Notification rows are delivery coordination, not another lifecycle state machine.

### 5. Webhook reliability exists; webhook product UX does not

Current webhook configuration has only URL, enabled state, and secret version. Public delivery uses one broad `work.changed` event and the admin surface does not expose the already-persisted delivery history as a product workflow.

Phase 4 should build on, not replace, the current system:

- event subscriptions;
- delivery history UI/API;
- outcome/error visibility;
- manual redelivery;
- clearer semantic event names while preserving compatibility for existing consumers.

Automatic retry already exists.

## Proposed implementation sequence

### P0.1 — Freeze the boundaries

No schema change.

- Keep Classic/Soroban fact stores separate.
- Keep derived viewer action as a projection.
- Keep Integration webhook delivery separate from Human notification delivery.
- Keep Workspace out of the current product.

### P1 — Reusable Template v1 — Testnet implemented

Template + immutable TemplateVersion persistence and optional Proposal/Request Template reference are live on Testnet.

Current shipped scope is Payment and Batch Payment. Signer/threshold reuse remains a demand-driven follow-up.

Success: the second occurrence of a recurring task requires materially less setup while the exact transaction still receives full Review.

### P2 — Explicit Ask / Assignment — Testnet implemented

A lightweight Classic Request assignment is persisted only when a Human explicitly asks another signer to act.

Reuse the current Inbox viewer-action semantics to determine the CTA at read/delivery time. Do not persist derived quorum/status labels.

Success: the system knows *Bob was asked*, not merely *Bob could sign*.

### P3 — Contact email + Human delivery

Private signer-contact metadata now supports an optional notification email. Next add Human notification outbox/delivery records and one real email adapter after the provider is provisioned.

Notification recipient truth comes from the explicit Request assignment, not from every on-chain eligible signer.

Email CTA links must not embed the private bearer capability. A recipient can open the non-secret Request locator and authenticate with the assigned signer wallet. Therefore Human notification queues, delivery history, and provider payload metadata never need to persist the private capability token.

Initial notifications:

- signature requested;
- assigned work becomes ready for the creator/submitter;
- expiry reminder;
- completion/failure where useful.

Every message must answer: what happened, why it matters to this recipient, and what to do next.

### P4 — Webhook productization

Expose the delivery machinery that already exists before adding more infrastructure.

Add subscriptions and manual redelivery only after the existing delivery history is queryable to the operator.

## Explicit non-goals

Do not add in this foundation pass:

- `workspace_id` placeholders with no Workspace behavior;
- generic `source` / `created_by` duplicates;
- universal Work/Event tables;
- generic BPM/workflow engine;
- SSO/SCIM/RBAC;
- notification center;
- shared organization directory;
- a second queue/message-bus abstraction.

## Next implementation target

Proceed with **P3 Contact email + Human delivery**.

Use the existing private Address Book as contact metadata and the explicit Request assignment as recipient truth. Email must remain a delivery channel, never identity or authorization. Do not notify every eligible Stellar signer and do not build a Notification Center.

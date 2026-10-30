---
title: "Productization Plan"
description: "Near-term plan to turn existing shared-authorization capabilities into a simpler product for individuals and small teams."
---

**Status:** active product plan  
**Audience:** product and development  
**Scope:** current consumer/small-team phase

## Goal

MultiSig Tools already has strong transaction and authorization capabilities. The next phase is not to add more Stellar operations for completeness. It is to make the existing capabilities easier to understand, repeat, coordinate, and finish.

The product goal is:

> Help individuals and small teams safely prepare, review, sign, submit, and repeat shared Stellar work.

DocuSign/DocuSeal are useful as mature product references because they turn technical capabilities into reusable Human workflows. MultiSig Tools should learn from that pattern without importing enterprise complexity before it is needed.

## Reference products

### DocuSign — primary long-term product reference

Use DocuSign as the main product benchmark for turning a technically complex multi-party authorization process into a Human workflow.

Study especially:

- reusable Templates;
- participant/recipient roles;
- clear next-action handoff;
- Inbox and lifecycle presentation;
- reminders and email coordination;
- completion evidence and audit history;
- integrations and webhook productization.

Do not copy its enterprise surface area by default. SSO, complex organization policy, advanced workflow engines, compliance administration, white-label, and similar enterprise features remain demand-driven.

The lesson to preserve is:

> Users should experience the work they need to complete, not the protocol capabilities used to implement it.

### DocuSeal — open-source implementation reference

Use DocuSeal as a practical architecture and implementation reference where source code is useful.

Study especially:

- the Template -> participant -> submission -> completion model;
- keeping Human UI, API, webhooks, and embedded clients around one domain authority;
- simple deployment and mature storage boundaries;
- product features implemented without prematurely decomposing the application into many services.

DocuSeal is not a specification for MultiSig Tools and its signing semantics are different from Stellar authorization.

## Implementation status — 2026-10-30

Testnet now has the first two productization slices:

- **P0 foundation audit:** complete. Existing Request/Intent facts, Evidence, PostgreSQL and Integration webhook infrastructure remain the foundation; no universal Work/Event state machine was introduced.
- **P1 Reusable Template:** Payment and Batch Payment Templates are implemented and deployed on Testnet. Templates save the stable recurring setup (treasury, recipients, assets and signing window), while amount, Memo and Private Note remain proposal-specific. Every Proposal still ends in exact transaction Review and signing.
- **P2 Explicit Ask / Assignment:** implemented and deployed on Testnet. "Ask Bob to sign" now records that Human coordination fact instead of only copying a generic link. Assignment does not grant access or Stellar authority; the private capability link remains the access transport and current on-chain signer policy remains authorization truth.
- **P3 Contact email + Human delivery:** in progress. Private signer notification-email metadata is implemented first; outbound delivery/provider integration remains separate so email never becomes identity or authorization.
- **P4 Webhook productization:** follows after Human notification behavior is proven.

Signer/threshold Reusable Templates remain a candidate, not a completeness requirement. Learn from real Payment/Batch Template use before expanding the Template catalog mechanically.

## Product rule

Build for today's users; keep the foundation compatible with tomorrow's larger teams.

This means:

- expose simple Human workflows now;
- prepare durable domain fields and event history where future growth is predictable;
- do not expose enterprise concepts merely because the database can represent them;
- do not build generic workflow, policy, or RBAC engines without real demand.

Product concepts come before pages. Domain models come before UI components.

## Terminology boundary

The current Human product already has guided transaction templates such as Payment and Account control. These are transaction primitives/composers: they know how to construct a safe Stellar action.

The new **Reusable Template** is a different product object:

> A saved, reusable way for a person or team to perform a recurring task using one of those primitives.

Examples may include "Pay ACME", "Monthly payroll", or "Restore standard signing policy".

The relationship is:

```text
Reusable Template
        |
        v
Guided transaction primitive
        |
        v
Proposal
        |
        v
Review -> Sign -> Submit -> Evidence
```

A Template is never authorization. The exact Proposal/transaction remains the object a signer reviews and signs.

## Phase 0 — Strengthen the invisible foundation

See also: [Phase 0 Foundation Audit](./phase-0-foundation-audit.md) for the code/database survey and proposed implementation slices.

Prepare the domain model before adding product surface area.

The implementation should leave clear homes for:

- Template identity and immutable version reference;
- creator/actor and creation source;
- event/audit history;
- recipient/action context for notifications;
- notification delivery state;
- webhook subscription and delivery attempts;
- optional future workspace ownership without requiring a Workspace UI now.

Do not add Human-facing controls simply because these fields exist.

Review Proposal, Intent, Inbox, Evidence, and webhook state for duplicated or temporary lifecycle concepts. Prefer one durable event/state model over parallel channel-specific state.

**Done when:** the new product features can be added without embedding their lifecycle in UI components or creating a second Proposal/Intent lifecycle.

## Phase 1 — Reusable Template v1

Start with existing, well-understood primitives.

Current Testnet v1 ships:

- Payment;
- Batch Payment.

Signer / threshold changes are the next candidate only if reuse clearly improves that Human task. Do not expand the catalog merely to mirror every guided primitive.

Keep v1 small. A user should be able to save a useful recurring setup and create a new Proposal from it with less repeated input.

Required properties:

- stable Template identity;
- versioned definitions;
- historical Proposals keep the Template version used at creation;
- exact transaction review remains mandatory;
- manual/guided creation remains available without a Template.

Do not build a generic formula, conditional-rule, or workflow designer.

**Done when:** a user can complete a recurring task the second time with materially less setup while still reviewing the exact Stellar action before signing.

## Phase 2 — Action and notification model

**Current status:** the smallest durable Human action primitive is implemented: an explicit Ask / Assignment records who a signer intentionally asked to act. Broader channel delivery remains Phase 3/4.

Treat "what should happen next?" as a product concept, not as email/webhook formatting.

For each meaningful lifecycle event, the system should be able to answer:

1. What happened?
2. Who needs to know?
3. Does someone need to act?
4. What is the correct next action?

Inbox, Email, and Webhook should consume the same underlying event/action model.

Do not create a Notification Center yet. Inbox already represents Human work that needs attention.

**Done when:** Human and machine notifications no longer contain independent lifecycle logic.

## Phase 3 — Human email and reminders

Email should be a Human handoff, not a URL transport.

Initial cases:

- a Proposal needs the recipient's signature;
- authorization is complete / ready for the next step;
- a Proposal is approaching expiry;
- submission completed or failed when the recipient has a reason to care.

Each actionable email must communicate the transaction meaning, why the recipient is involved, and one clear next action.

Add lightweight reminders for genuinely pending Human action. Avoid complex notification preferences until usage demonstrates the need.

**Done when:** a small team can coordinate an ordinary asynchronous signing flow without manually forwarding opaque links or repeatedly asking whether someone has acted.

## Phase 4 — Webhook productization

Keep webhook semantics aligned with the same event model used by Inbox and Email.

Improve the integration experience around:

- event subscriptions;
- signed delivery;
- delivery history;
- success/failure state;
- retry behavior;
- manual redelivery.

The webhook remains a machine channel. Do not distort Human lifecycle concepts merely to match HTTP delivery mechanics.

**Done when:** an integrator can understand what is subscribed, what was sent, whether it arrived, and how to recover a failed delivery without inspecting server internals.

## Phase 5 — Stop and learn

After Templates, Human notifications/reminders, and webhook delivery are usable, stop broad product expansion and observe real usage.

Evaluate:

- which Templates people actually save and repeat;
- where users still abandon or misunderstand the workflow;
- which notifications cause useful action versus noise;
- whether small teams need shared ownership, shared Templates, or richer roles.

Only then decide the next product layer.

## Explicitly deferred

Do not build these in the current phase:

- SSO / SCIM;
- complex RBAC;
- organization hierarchy;
- generic approval-policy engine;
- workflow designer;
- formula/conditional engine;
- white-label;
- custom domains;
- notification center;
- enterprise retention/compliance controls.

Future compatibility is enough; current users should not carry the complexity.

## Product review rule

For every new feature, ask two questions in order:

1. What recurring user problem does this remove?
2. What is the smallest product concept that solves it without hiding Stellar authorization facts?

Prefer improving an existing end-to-end workflow over adding another isolated capability.

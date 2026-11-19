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

Current Testnet productization status:

- **P0 foundation audit:** complete. Existing Request/Intent facts, Evidence, PostgreSQL and Integration webhook infrastructure remain the foundation; no universal Work/Event state machine was introduced.
- **P1 Reusable Template:** Payment and Batch Payment Templates are implemented and deployed on Testnet. Templates save the stable recurring setup (treasury, recipients, assets and signing window), while amount, Memo and Private Note remain proposal-specific. Every Proposal still ends in exact transaction Review and signing.
- **P2 Explicit Ask / Assignment:** implemented and deployed on Testnet. "Ask Bob to sign" now records that Human coordination fact instead of only copying a generic link. Assignment does not grant access or Stellar authority; access still requires an authenticated signer session or an independently issued private capability, and current on-chain signer policy remains authorization truth.
- **P3 Contact email + Human delivery:** live-proven on Testnet. Private signer notification-email metadata, `signature_requested`, explicit `signature_reminder`, durable provider-acceptance/failure status, and verified Resend `email.delivered` / `email.bounced` evidence are implemented. The public Testnet provider webhook was verified end-to-end for both delivered and bounced events. A dedicated Human outbox/delivery history remains the delivery authority. Email remains delivery only, never identity or authorization.
- **P4 Webhook productization:** complete in code. Integration administration exposes delivery history, bounded automatic retry state, and explicit manual redelivery without adding a second event model.
- **P5 Stop and learn:** active. Lifecycle visibility is covered by the Activity coordination timeline, and assigned signers now have a separate authenticated `Viewed` fact distinct from provider-level `Email delivered`. The current small follow-up closes the Manage-surface gap: when the current viewer has already signed and is waiting for others, Inbox reuses those same coordination facts to summarize the signers that viewer explicitly asked, including the latest email/reminder delivery fact and `Viewed` where available. It does not invent signer order or treat Assignment as authority.

Signer/threshold Reusable Templates remain a candidate, not a completeness requirement. Learn from real Payment/Batch Template use before expanding the Template catalog mechanically.

## November 2026 — workflow polish, not feature expansion

**Product reference:** DocuSign's sender-to-recipient task model, adapted to Stellar shared authorization. Reuse existing Proposal, Assignment, Activity, Template, Inbox, and execution evidence. No new generic workflow engine.

**Baseline:** Dashboard and Inbox already prioritize work; Reusable Templates and email delivery/view evidence already exist. The gap is the presentation of a single Proposal to the sender and the signer.

### P0 — Make each Proposal legible

- Show the Template business label, or derive a factual transaction title from the exact XDR, on the Proposal detail page.
- Show Proposal status, network, and non-secret ID without making the ID the primary title.
- State the next task or waiting reason accurately for Review, awaiting signatures, already signed, ready, external execution, submitted, expired, stale, blocked, and ledger-precondition cases.
- Do not claim the current wallet can sign unless authorization has been verified; never treat a notification or a view as authorization.
- Keep full transaction review, signer policy, authorization, and final submission confirmation intact.
- Verify with presentation unit tests, build/typecheck, 320/375/414/768 responsive checks, and a real Testnet signing walk-through. Merge only after verification.

### P1 — Recipient experience

- Follow a real notification from email to wallet confirmation, exact transaction review, signature contribution, and visible acknowledgement.
- Reduce intervening choices; never require account registration to sign with a current authorized wallet.
- Preserve sender-controlled Assignment and the non-secret email locator. Keep private capability links separate from ordinary email.
- Accept when a recipient can answer: which proposal and wallet, what will change, whether I have signed, and what happens next. Show a requester identity only when the API supplies verified provenance.

### P2 — Sender progress

- Show requested, provider-accepted/delivered, authenticated Viewed, signed, and ready-to-submit as distinct facts from the existing coordination and signing evidence.
- Show only sender-owned invitations, respecting current signer authorization.
- Offer reminders only where the existing Assignment rules permit them. Avoid additional polling.
- Accept when the sender can identify the pending person and next available action without opening technical evidence.

### P3 — First-use and Templates

- Prioritize common payment and saved Template tasks. Keep imported XDR, multi-source, and specialized Soroban operations under explicit advanced routes.
- Validate first-use with a person unfamiliar with Stellar transaction internals. Expand Templates only from observed use cases.

### Release and collaboration boundary

Run Testnet before a live release. This work keeps signing authority, execution ownership, API/storage schema, Mainnet deployment, and on-chain semantics intact. PR #19 incorporates the unmerged PR #17 design pilot, fixes its review-state transition, and preserves the A3 brand already on main. Review the combined result once.

### 2026-11-20 — Participant workflow round

**Product decision:** finish the existing participant journey before expanding the feature set. Each screen must answer: what is this proposal, what is my next action, and what happens after it?

| User problem | Implemented change | Acceptance evidence |
| --- | --- | --- |
| An invitation opens an unexplained wallet prompt | Keep the non-secret Proposal ID visible; explain identity verification; show the selected wallet and an explicit change action | No wallet prompt on page mount; correct wallet opens the same proposal |
| The next task is described but hard to find | Add task links that focus Review, signing progress, submission, or the issue without replacing the proposal URL fragment | Keyboard focus reaches the correct section; private locator remains intact |
| Signing has no clear end point | Keep the server-confirmed contribution acknowledgement, separate signature completion from submission, and offer an Inbox exit | Signed wallet and remaining requirements remain visible after refresh |
| A routed Submit button can do nothing | Accept the final explicit Submit action for an already selected MST route; preserve external ownership, Mainnet confirmation and effects review | Routed MST sends one PUT; external route has no signer-side Submit |
| An expired proposal still offers signing | Hide closed-state signature actions and guard handlers; distinguish MST collaboration expiry from Stellar expiry | Expired/stale/blocked views cannot trigger wallet signing; network status can be checked before replacement |
| Sender cannot tell whom to follow up with | Verify invited signers against actual XDR; separate transaction signatures from fee-envelope signatures; put unresolved email failures first | Email/View alone never becomes Signed; no reminder suggested after required authorization is complete |
| Network failure looks like an empty workspace | Keep same-wallet Inbox rows on transient refresh failure; offer retry or explicit wallet confirmation as appropriate | 500 preserves marked stale data; 401/403 and identity mismatch clear it |
| Templates disappear or seem unavailable to new users | Keep Templates discoverable with locked/loading/empty/error/reconfirm states and source-account context | Failed load can recover; responses from another wallet/network never display |
| Changing signer can reuse stale private data | Make the Intent wallet chooser explicit; scope Request/Intent loads and action results to the verified viewer | Late responses from a former wallet cannot restore its private view |

**Reference choices:** [DocuSign's sender status and templates](https://www.docusign.com/blog/how-to-get-started-docusign-esignature) inform the next-action and reuse patterns. [DocuSeal's quick start](https://www.docuseal.com/resources/quick-start) informs pending/completed visibility and completion evidence. MST keeps wallet proof, weighted Stellar authority, and Sign versus Submit as distinct steps.

**Verification:** unit/contract tests and production build, followed by `scripts/qa/productWorkflow.mjs` at 320/375/414/768/1280 px. The browser harness renders real components with isolated API and wallet fixtures; it does not send emails or submit transactions. Record the exact commit and results in PR #19.

**Release check still required:** a real recipient opens a Testnet email, confirms a supported wallet, reviews and signs; the sender observes progress and completes the configured submission route. Verify the hosted API, actual wallet prompts, and receipt in this walk-through. A fixture replay does not replace this check.

**Next product evidence:** observe a first-time sender and recipient using one real Payment proposal. Record where they hesitate or need an explanation. Use that evidence to prioritize the next round; do not add another template category or workflow engine by default.

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
- the user-defined Template name is the recurring business label, such as `Monthly payroll` or `Supplier payment`;
- MultiSig Tools derives and displays the factual system transaction type separately from the exact Proposal;
- Email and Inbox may use `business label + system type` as shared Human presentation;
- Template names are signer-owned in v1; do not add an Admin role for personal Template naming;
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

**Current implementation:** Testnet supports `signature_requested` plus an explicit `signature_reminder`. Both are persisted in the dedicated Human notification outbox with bounded retries and per-attempt history and sent through Resend. The Proposal coordination projection distinguishes `queued`, `provider_accepted`, `delivered`, `bounced`, and `failed`: provider acceptance still means only that Resend accepted the send request, while `delivered` / `bounced` come only from a verified provider webhook matched by the Resend email id. Provider events are timestamp-ordered so stale webhook delivery cannot overwrite newer evidence. The original signer who created an Ask may send a Reminder only while that signer is still needed; a bounce is retryable through the same explicit Human action. The message links only to the non-secret Request locator; it never carries the private bearer capability. Resend send credentials remain mounted only into the notification worker; the API receives a separate webhook-verification secret. Terminal queue records scrub the plaintext destination email while retaining delivery evidence.

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

- whether Activity gives the sender a continuous, Human-readable view from Ask -> delivery/reminder -> signature -> completion without requiring the original Proposal page;
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

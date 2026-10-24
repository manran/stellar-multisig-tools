---
title: "Human Product Contract"
description: "Human-facing product behavior, information architecture, language, and safety boundaries."
---


This document defines the Human-facing product behavior, information architecture, UX language, and safety boundaries for `stellar.multisig.tools`.

It is not a visual style guide. Visual tokens, component styling, spacing, typography, and brand treatment belong in a separate UI/visual specification when that layer stabilizes.

Implementation modules such as Account Inspector, Multisig Designer, Signing Room, or Signing Request must not become the user-facing product model by accident.

## 1. Product identity

The Human product name is **MultiSig Tools**. `Stellar multisig tooling` is a descriptive category/descriptor under consideration, not a replacement product name.

A suitable descriptive subtitle is:

> Shared-authorization workspace

The architectural description is broader:

> A Stellar shared-authorization transaction workspace.

The product is not primarily:

- a multisig setup wizard;
- an XDR inspector;
- a mailbox that only receives requests from other people;
- a general-purpose wallet.

Its Human workflow is:

```text
Create -> Review -> Coordinate approvals -> Sign -> Submit -> Track
```

MultiSig Tools constructs, explains, coordinates, and tracks transactions. Signing keys remain in Fresnica or another compatible wallet/signer.

The shared domain object remains the **Signing Request**. Humans, Agents, wallets, APIs, and future enterprise clients act on the same underlying request model.

## 2. Sign mode mental model: Inbox + New

Use Email as an organization model for **Sign mode**, not as protocol vocabulary for the entire product.

- **New** is the ordinary create/compose action and is available to normal Sign-mode users.
- **Inbox** contains open transactions relevant to the signed-in identity.
- Selecting an Inbox item opens its review/action detail, analogous to opening a message.
- A private link may deep-link directly to the same transaction detail.
- Presence in Inbox does not imply that the origin is trusted.
- **Waiting** and **Ready** are action-state filters, not mailbox folders in the protocol model.

Do not model Read/Unread. Keep **Work/transaction state** separate from **viewer action**. State describes the shared fact; viewer action answers what this person can do next.

Good shared state language:

- `Collecting signatures`
- `Authorization complete`
- `Waiting`
- `Done`
- `Expired`
- `Needs attention`

Good viewer-action language includes `Review & sign`, `Waiting for others`, `Choose execution`, `Review & submit`, and `Waiting for execution`. When the system can prove the signed-in key has already contributed, prefer `You signed · waiting for others`.

Do not claim `Needs your approval` merely because an address is an eligible signer. In weighted M-of-N policies an eligible signer can be optional.

## 3. Workspace modes and first-use onboarding

The authenticated Human workspace has two **intent modes**:

### Sign

> I am here to create, review, approve, or submit normal transactions.

Sign mode is Human-first and Email-like. Its primary navigation is:

```text
New
Inbox
Waiting
Ready
```

Sign mode minimizes protocol vocabulary. It should not proactively inspect whether the signed-in account is single-signer, push multisig setup, or show account-administration onboarding.

A user who only follows a private request link is a zero-initialization use case. They can authenticate, review, sign, and leave without configuring MultiSig Tools.

### Manage

> I am here to inspect or configure account signing.

Manage mode is operator-first. Its primary navigation is:

```text
New
Accounts
```

Manage mode may use Stellar's real account-control vocabulary directly when it improves precision:

- signer;
- signer weight;
- low / medium / high threshold;
- master key;
- active authorization weight;
- signing configuration.

Do not turn Manage into a raw protocol debugger. XDR, sequence internals, signature hints, ledger bounds, and raw SetOptions fields still belong under Advanced unless the exact task requires them.

### Mode is not authorization

Workspace mode is only a UI intent preference. Switching to Manage does not grant any Stellar permission. Every real account-control transaction remains governed by current on-chain signer weights and thresholds.

A user without sufficient account-control authority may prepare a proposed account-control transaction. That ability must never be presented as permission to execute it.

The mode preference is stored locally per `(signed-in G-address, network)` so the same identity may keep different Mainnet/Testnet working contexts.

### First authenticated use

On the first successful login for a G-address in a browser, show one lightweight welcome modal:

```text
What are you here to do?

Sign transactions
Manage accounts

You can switch anytime from the account menu.
```

The onboarding-completed marker is local browser state scoped to the G-address, not to the network. Therefore switching Mainnet/Testnet does not repeat onboarding, while a different address or browser sees it once.

If a user is already on a transaction/request deep link and chooses Sign, keep the transaction context rather than navigating away. Choosing Manage may enter the Accounts workspace.

On desktop the active mode shares a persistent workspace shell. On narrow screens the workspace must collapse naturally to one task at a time without horizontal scrolling.

## 4. Inbox

Inbox should not explain the authorization implementation with phrases such as:

- `Transactions waiting for this signer`
- `Pending requests`
- `Nothing is waiting for this signer`
- `Authorization is checked against the current Stellar signer configuration each time this inbox loads`

After authentication, the page can simply be titled `Inbox`.

An empty Inbox should use Human task language:

> **You're all caught up.**  
> Nothing needs your attention right now.

Do not use the empty Sign-mode Inbox to advertise shared-signing setup. Requests shared with the current signing address may appear there, and private links may open the same transaction detail directly.

Each list item leads with transaction meaning, not protocol metadata:

- `Send 500 XLM`
- `Change account signing`
- `Add a trustline`
- `Review 3 account changes`

Secondary information may include action state, Mainnet/Testnet, source account, and a Human validity time such as `3h left` or `tomorrow`.

Raw timestamps, ledger numbers, sequence numbers, signature hints, and XDR belong under Advanced.

## 5. Accounts, signers, and identity

Accounts is the Manage-mode object-and-relationship layer. It presents two complementary task entries.

### Accounts I can sign for

Given an authenticated signer address, show the Stellar accounts where that key currently has active signing weight.

This relationship may be obtained from Horizon signer lookup and must be revalidated against current account state where security matters.

Treat each result as an **Account object**, not merely a G-address:

- prefer its private account alias as the primary identity;
- when unnamed, offer a naming action at the point of use;
- show the full G-address when layout has enough room and shorten only in genuinely constrained UI;
- summarize signing configuration compactly, including low / medium / high thresholds, active weight, and signer count;
- opening the object leads directly to its signing configuration.

Do not make `Signing as ...` the main content of this view. The authenticated signer identity already belongs in normal account chrome; this view is about the Account objects that identity can act for.

Account alias naming/renaming belongs in **Accounts I can sign for**. Do not put an account-rename action in the selected Account signing-configuration detail.

### Signing configuration

Given a Stellar account, show an **Account detail** with operator-level authorization state:

- Account alias if already known, plus full address;
- raw low / medium / high threshold values;
- Human policy interpretation as secondary context where useful;
- total active authorization weight;
- master-key state and weight;
- active ed25519 signers with individual weights;
- signer aliases as private metadata;
- advanced signer types under Advanced.

Known accounts should be selectable before asking the user to paste an address. Direct entry should resolve the account in this order where possible:

1. an explicitly deep-linked account;
2. the signed-in G-address itself, if it is an active Stellar account on the selected network;
3. the single account from Accounts I can sign for, when there is exactly one;
4. otherwise an account selector populated from known signing relationships.

`Use another account` remains the manual G-address escape hatch for arbitrary inspection.

A single-signer Account is a valid configuration, not a global onboarding failure. In Manage mode it may be stated compactly as a technical fact such as `Single-signer configuration` together with current thresholds. Do not push this state into Sign mode.

Account control is security-sensitive and may use red treatment as an action category. The actual danger level is determined by the proposed transaction: removing keys, disabling the master key, or making thresholds unreachable requires stronger lockout/access-loss warnings.

Any signer/threshold edit creates an explicit Stellar account-change transaction that continues through normal Review / approval / submit.

The two directions remain conceptually:

```text
signing key -> accounts it can sign for
account     -> signing keys that can sign it
```

### 5.1 Personal private address book and semantic identity

The MVP includes a **personal private address book** scoped to the authenticated signer identity.

Its purpose is to turn protocol identifiers into Human-readable context across the workspace without pretending that a local label proves identity.

The address book supports two separate alias contexts for the same Stellar G-address:

```text
account alias -> names the account as a resource
signer alias  -> names the person/key/service as an approver
```

Example:

```text
account: GD... -> Treasury
signer:  GA... -> Alice
signer:  GB... -> Bob
signer:  GC... -> Ledger backup
```

A G-address that is both an account and a signer may therefore have two different labels. Do not collapse Account and Actor identity into one field.

Current persistence rules:

- aliases are private server-side metadata;
- aliases are scoped to the authenticated signer/owner;
- aliases are not stored on Stellar;
- aliases are not shared merely because a Signing Request is shared;
- aliases are not `Verified` identity;
- changing/removing an alias never changes onchain authorization.

Semantic display order is:

```text
private alias (when present)
public identity resolver / reverse federation (future)
raw G-address fallback
```

A future public resolver such as `fed.network` may occupy the middle layer without changing authorization semantics. Private aliases remain personal metadata and public names must not be treated as proof of trust or permission merely because they resolve.

Address rendering rules:

- names are primary when available;
- raw addresses remain available as verification identity;
- on normal desktop Review/configuration surfaces, show the full G-address when space permits;
- shorten addresses only on constrained/mobile surfaces;
- never place several anonymous shortened addresses next to each other when the full identities can fit;
- allow private naming at the point where an unnamed account/signer is causing ambiguity.

Use semantic identity wherever it reduces address reasoning:

- top-right signed-in identity;
- Accounts lists and signing configuration;
- New source-account selectors;
- Change account signing source selector;
- transaction Review summaries, including payment source and destination;
- approval guidance;
- Inbox source-account metadata;
- lightweight handoff copy such as `Ask Bob to approve` when Bob is the single remaining named candidate.

Enterprise evolution may layer organization/shared address books, verified service identities, or domain-backed identity on top of this provider model without replacing the underlying Stellar authorization model.

## 6. New transaction

`New` is a primary action in **both** Sign and Manage modes. Internally it creates or prepares a draft Signing Request; the ordinary Human UI does not need that vocabulary.

The visible templates depend on current intent:

### Sign mode New

1. **Payment** — ordinary guided payment creation; start with XLM.
2. **Advanced** — import an existing transaction/XDR.

Do not expose account-control configuration from Sign mode merely because the route exists.

### Manage mode New

1. **Payment** — the same normal transaction flow.
2. **Account control** — security-sensitive signer / weight / threshold / master-key changes.
3. **Advanced** — import an existing transaction/XDR.

Showing Account control in Manage mode is an affordance, not a permission grant. Current Stellar authorization still decides whether the resulting transaction can be approved and submitted.

### 6.1 Transaction templates are extensible

Possible future guided templates include:

- asset payments;
- create account;
- trustlines;
- offers / trading operations;
- issuer authorization operations;
- account flags;
- sponsorship;
- Soroban contract actions through the Intent-first flow in `apps/internal-docs/content/stellar/development/soroban-authorization.md`: semantic Intent -> detached AUTH -> late execution -> final transaction;
- other frequently used Stellar operation groups.

Do not expose every Stellar operation merely to make the list look complete. A guided template earns its place by making a real task safer or easier than Advanced import.

### 6.2 Source account selection

Authentication identity and transaction source are different concepts.

The signed-in G-address proves control of one key. It may itself be an unfunded/nonexistent Stellar account while still being an active signer for another funded account. Therefore source-account discovery is based on **signer relationship**, not on whether the login address has XLM.

For ordinary creation flows, query the accounts where the signed-in key has active signing weight:

```text
signed-in key -> Accounts I can sign for -> transaction source choice
```

Selection behavior:

- if exactly one Account matches, it may be selected automatically and the UI explains why it is available;
- if several Accounts match, do **not** silently use the first Horizon result; require an explicit choice;
- prefer a private alias where available;
- show the full selected account address on roomy surfaces;
- show policy/balance context where useful;
- preserve `Use another account` for arbitrary transaction preparation.

A transaction creator may prepare a transaction for an account where they are not personally an onchain signer; preparation and authorization remain separate.

### 6.3 Payment preflight

Guided Payment must reject deterministic invalid state before collecting signatures when practical.

For XLM Payment:

- the source account must exist;
- the destination account must already exist;
- if the destination is not an active Stellar account, explain that `Payment` cannot create it and a `Create Account` operation is required;
- do not let users coordinate signatures for a Payment known to fail with `op_no_destination`.

Other operation-specific deterministic preflights may be added as guided templates expand.

## 7. Account control

`Account control` is a Manage-mode transaction template, not a local settings mutation and not an Admin-role permission.

Its UI must use the same MultiSig Tools Manage workspace shell as New and Accounts, then continue into the shared transaction Review / approval flow.

The operator flow is:

1. choose the account;
2. choose who can sign;
3. set signer weights / approval requirements;
4. review thresholds, reserve impact, and lockout risk;
5. create the exact account-change transaction;
6. continue into normal Review / approval / submit.

Manage mode may expose signer weights and low / medium / high thresholds directly. A guided exact-N-of-M helper may still simplify common configuration, but it must not obscure the resulting on-chain values. Raw XDR, sequence data, and SetOptions encoding remain under Advanced.

Danger treatment is dynamic. The Account control entry may be visibly security-sensitive, while stronger danger/critical treatment is reserved for proposed changes that can reduce or lose account access.

## 8. Transaction detail and shared transaction state

`Review & sign` is a state/action surface, not a permanent global navigation destination.

Opening a transaction should answer, in this order:

1. What will this transaction do?
2. Which account and network are involved?
3. What value / destination / account-control change is involved?
4. Who can satisfy the remaining approval requirement?
5. Can the current wallet approve it now?
6. Is it ready to submit?
7. What happens next?

Review must be semantic before it is technical.

For a Payment, prefer:

```text
Send 100 XLM

From
Treasury
G...

To
Alice
G...
```

Do not use `100 XLM -> G...` as the primary Human explanation when the same destination can be represented as an Account identity.

For approver lists, use signer names where known and full addresses on roomy surfaces. Do not reduce several different unnamed signers to visually similar shortened strings if the layout can display the full keys.

Protocol and XDR detail remain available under Advanced.

A **Shared Request is not a second product page**. Once a transaction is shared, its request id/capability/status are coordination state around the same transaction detail. The Human surface should remain inside the same MultiSig Tools workspace shell.

When Share/Ask is explicitly chosen from Review, the exact current transaction may be promoted into a private Signing Request automatically; the user should not be asked to paste the same XDR again.

When creation of that private request finishes, immediately show a prominent `Private link ready` handoff with the Copy action. Do not make the user hunt for a small Copy button after watching a loading state.

## 9. Authentication, wallet state, mode, and account chrome

Authentication is signer-centric: the signed-in identity is one Stellar G-address proven through a wallet challenge. It is not necessarily the source account of a transaction.

Wallet connection, sign-in, workspace intent, and transaction approval are distinct states:

- **Connect wallet** — choose a wallet/key for a wallet action.
- **Sign in** — prove control of a G-address with a short-lived sequence-zero SEP-10 challenge.
- **Sign / Manage mode** — choose what kind of work the UI should emphasize; this is not authorization.
- **Approve** — sign the actual transaction being reviewed.

A SEP-10 challenge is transaction-shaped but is an authentication challenge and is never submitted by MultiSig Tools. External wallets may mechanically display its operations/fee fields; MultiSig Tools cannot change another wallet's confirmation UI, so its own pre-wallet copy must make the authentication-only nature clear.

After sign-in, authentication explanation disappears into normal account chrome.

The top-right account menu owns the persistent mode switch:

```text
I'm here to
✓ Sign transactions
  Manage accounts

Switch wallet
Sign out
```

Do not put product navigation such as `Accounts you can approve for` inside the account menu. Use `Switch wallet`, not `Choose signer`, because signer is already a precise Stellar/on-chain concept.

Do not keep a permanent `Signer verified` success banner or an always-visible `Sign out` button.

## 10. Approval routing and lightweight workflow

Identity/address-book data enables multisig collaboration to become more than anonymous signature collection.

After a participant approves a transaction, the workspace may answer:

> Who should act next?

For the common 2–3 person case:

- show remaining eligible approvers by Human-readable name where known;
- show full signer addresses when there is room and shorten only in constrained layouts;
- if more authorization is needed, offer `Ask Bob to approve` or `Ask someone to approve`;
- if quorum is already satisfied, make `Submit` the next action instead;
- if several signers could satisfy quorum, let the user choose rather than inventing a protocol-defined order.

Current MVP routing is deliberately lightweight:

- remaining candidates are derived from current Stellar signer state and the exact transaction's current approvals;
- personal aliases make those candidates understandable;
- `Ask Bob to approve` may create/copy the same private capability link used by the normal shared transaction flow;
- the recipient choice is not yet persisted as a durable workflow assignment.

Preserve this architecture distinction:

```text
Onchain signer eligibility != workflow assignment
```

A 2-of-3 account may have three eligible signers while only Alice and Bob are expected to handle one particular transaction.

A future `ApprovalAssignment` may record who is expected to act next for a specific request without changing Stellar's authorization semantics.

Enterprise evolution may add sequential/parallel approval stages, roles, shared address books, escalation, delegation, Agent approval, and audit trails. Do not build a generic BPM engine for the consumer MVP.

## 11. Request, origin, and trust semantics

A Signing Request represents an exact transaction or authorization intent bound to an immutable payload/hash.

Human wording should generally say `transaction`, `approval`, or the specific transaction meaning in Sign mode. Manage mode may use precise account-control terminology where appropriate.

Seeing a transaction in Inbox means the signed-in identity is currently allowed to inspect or participate in it. It does **not** mean:

- the transaction is safe;
- the creator is trusted;
- the user is required to sign;
- the transaction can currently be submitted.

The Email analogy also applies to trust: receiving something does not authenticate its sender.

Future origin hardening may distinguish authenticated Human creator, registered Agent/service identity, verified organization/domain, or enterprise policy identity.

Even a verified creator never replaces independent transaction review.

## 12. Transaction lifetime and execution failure

Transaction validity is a product decision, not a raw protocol field.

- SEP-10 authentication challenges are short-lived (five minutes) and not user-configurable.
- Guided transaction creation uses a **24-hour signing window by default**.
- Guided creation may offer **1 hour**, **24 hours (recommended)**, and **7 days**.
- Imported XDR keeps its original time bounds exactly.
- An expired transaction is `Expired`, never `Not ready yet`.
- Recovery from expiry is to create/rebuild a fresh transaction.
- Raw `minTime`, `maxTime`, ledger bounds, sequence preconditions, and Unix timestamps belong under Advanced.

Longer windows make asynchronous coordination easier but give a fixed transaction sequence more time to become stale if another transaction consumes that sequence first.

When Horizon/Core rejects a submission, do not collapse the response to generic `tx_failed`. Present a Human explanation for known `transaction` / `operation` result codes and retain the raw Stellar codes as secondary technical detail.

Examples:

- `op_no_destination` -> destination account does not exist; Payment cannot create it;
- `op_underfunded` -> insufficient spendable balance;
- `op_low_reserve` -> minimum reserve violation;
- `tx_bad_seq` -> source sequence changed; rebuild the transaction;
- `tx_too_late` -> transaction expired.

## 13. Mainnet and Testnet

Network is a deployment-owned safety boundary, not a Human preference:

- **Mainnet and Testnet use separate production deployments and domains.** `stellar.multisig.tools` is Mainnet; `stellar-testnet.multisig.tools` is Testnet.
- Every production deployment sets `VITE_STELLAR_DEPLOYMENT_NETWORK` to exactly `public` or `testnet`. `dual` exists only for local compatibility and is not a production mode.
- The deployment network outranks URL parameters, stored browser state, wallet/application defaults, and incoming work-object claims. A mismatched Headless request or stored object fails with `deployment_network_mismatch`; it is never silently retargeted.
- Each deployment owns independent private storage and authentication state, so Testnet experiments cannot enter the Mainnet workspace.
- XDR does not encode a network passphrase. Import validates the XDR under the current deployment network and never probes both ledgers to guess ownership.
- Network-aware wallets must match the deployment before signing. Ledger/Trezor remain networkless signer transports and inherit the deployment network; fixed deployments do not show a hardware-network selector.
- Once a work object has a network, that fact remains explicit evidence. Review, Submit, Receipt, and portable evidence may name either network.
- Mainnet stays implicit in ordinary product chrome; Testnet is visibly identified. Mainnet submission keeps its explicit confirmation step.

This separation removes network selection from ordinary Human flows and makes the same boundary available to Web, CLI, Agent, bot, script, MCP, and plugin consumers through `GET /api/runtime-config`.

## 14. Capability links and sharing

Private share links are the current lightweight collaboration transport.

Request identifiers and bearer capabilities are separate:

- `requestId` identifies a request and is not secret;
- `capabilityToken` grants scoped bearer access and is secret.

Current locator format uses:

- new Request IDs: 80 random bits encoded as 16 Crockford Base32 characters for a compact, Human-clean locator;
- bearer capability: 128 random bits encoded as 22 base64url characters;
- legacy 32-character Request IDs remain accepted so existing links continue to work.

Human behavior:

- explicit `Share` / `Ask ... to approve` may promote the exact reviewed transaction into a private Signing Request;
- immediately after creation, surface `Private link ready` and a prominent Copy action;
- the capability link is copyable only when the current browser actually possesses the private capability;
- authenticated Inbox/session access must never synthesize a transferable capability;
- a recipient opening a capability link reviews the same transaction-detail surface, not a separate protocol tool;
- a personal/public name helps choose/understand a recipient but does not grant access and is not embedded into authorization.

Do not expose capability tokens in logs, public lookup, or ordinary Inbox metadata.

## 15. Copy and information-density rules

**Sign mode** prefers the shortest Human wording that preserves safety. Do not replace technical copy with a longer explanation when the whole explanation can disappear.

Examples:

- `Signing inbox` -> `Inbox`
- `Transactions waiting for this signer` -> remove
- `Pending requests` -> remove
- `Nothing is waiting for this signer` -> `You're all caught up.`
- `Verify this signer` -> `Sign in`
- `Signing Room` -> transaction detail / `Review` action
- `Transaction Inspector` -> `Advanced transaction details`
- `Collect signatures with one shared link` -> normal transaction detail + contextual Share/Ask action

**Manage mode** is operator-first and may use compact Stellar terminology directly:

- signer;
- weight;
- low / medium / high threshold;
- master key;
- active weight;
- SetOptions as an operation name when relevant to an advanced/configuration context.

Even in Manage mode, do not surface raw protocol detail merely because it exists. XDR, signature hints, sequence internals, ledger bounds, and serialization details remain Advanced unless needed for the task.

Errors appear at the smallest useful scope. If the UI can deterministically prevent an invalid transaction without changing user intent, do that before signatures are collected.

Empty coordination states may remain visually quiet. Do not fill Inbox merely to occupy space; increase information density on task surfaces through relevant actions and state, not decorative explanation.

## 16. Product review checklist

Before shipping a Human UI batch, verify:

- On first authenticated use of a G-address in a browser, is the Sign / Manage choice explicit and shown only once locally?
- Can the user switch modes later from the top-right account menu?
- Is workspace mode treated only as UI intent, never authorization?
- Does Sign mode contain New / Inbox / Waiting / Ready without setup pressure?
- Does Sign-mode New expose normal Payment + Advanced rather than Account control?
- Does Manage mode contain New / Accounts and expose security-sensitive Account control?
- Can a private-link signer complete their task without initialization?
- Does Manage show signer weights, threshold values, and master-key state without forcing them into Sign mode?
- Are XDR, sequence internals, and other protocol-debug detail still kept under Advanced?
- Does Accounts treat known Accounts as named objects rather than repeatedly asking for pasted addresses?
- Is account alias editing kept in Accounts I can sign for rather than the selected signing-configuration detail?
- Does signing configuration default/select a known Account before exposing manual address lookup?
- If a signed-in key controls multiple Accounts, does New require an explicit source choice rather than silently using the first result?
- Does the UI make clear that signer identity and transaction source Account are different concepts?
- Are private aliases reused across Accounts, New, Inbox, Review, and approval guidance?
- On roomy Review surfaces, are unnamed addresses shown in full rather than as ambiguous similar abbreviations?
- Can the user name an ambiguous signer/account at the point where the ambiguity matters?
- Is a local/public name clearly separate from verified identity and authorization?
- Does guided Payment reject a nonexistent destination before signatures are collected?
- After `Ask ... to approve`, is the private-link handoff immediately obvious?
- Are new private links compact while legacy request links remain compatible?
- When Stellar rejects submission, are result codes translated into an actionable explanation without hiding the technical code?
- Is Account control presented as a transaction flow rather than a local settings mutation or Admin permission?
- Is Shared Request presented as transaction coordination state rather than a legacy tool page?
- Is `Review & sign` transaction detail/action rather than permanent navigation?
- Does authentication disappear into normal account state after sign-in?
- Does every Sign-mode transaction row lead with Human transaction meaning?
- Are Sign-mode states action-oriented rather than protocol-oriented?
- Is Mainnet/Testnet visible before approval/submission?
- Are deadlines Human-readable?
- Can an Inbox item be treated as untrusted until its actual transaction is reviewed?
- Are ActorIdentity, OnchainSigner, Account, and future ApprovalAssignment kept distinct?
- Does MultiSig Tools avoid requesting or custodying signing secrets?
- Can Human and Agent clients continue to act on the same Signing Request core without duplicated business logic?

When implementation and this document disagree on user-facing behavior, treat the disagreement as a product-design issue to resolve explicitly rather than copying the current implementation by default.

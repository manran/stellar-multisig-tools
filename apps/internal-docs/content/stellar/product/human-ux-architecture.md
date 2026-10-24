---
title: "Human UX Architecture"
description: "Canonical Human-layer product and navigation contract."
---


**Status:** canonical Human-layer product contract for the Stellar surface

This document records the Human UX boundary after the September 2026 external review. It complements `apps/internal-docs/content/stellar/architecture/product-semantics.md`, `apps/internal-docs/content/stellar/product/ux-design-system.md`, and the protocol/security documents. When an internal route, authentication mechanism, or Stellar primitive conflicts with a simpler Human mental model, keep the technical mechanism underneath and translate it at the Human boundary rather than exposing it directly.

## 1. Core product rule

MultiSigTools is one shared-authorization product, not two products called **Sign** and **Manage**.

A person may create a Proposal, approve another person's Proposal, administer a Treasury, inspect Activity, and maintain Contacts in the same session. `Inbox`, `Treasury`, and the underlying route families may remain separate implementation surfaces, but **workspace mode is not a Human identity or onboarding choice**.

Canonical Human entry after wallet connection:

`Dashboard -> actionable work -> Proposal/Treasury detail`

The UI should prioritize what needs attention rather than asking the user to classify themselves first.

## 2. Wallet connection and private-session proof

Wallet connection and identity proof are different security facts.

- Connecting a wallet reveals/selects an address; it does not by itself prove current control of that address.
- Access to private Inbox, Activity, names, notes, and other private collaboration state may still require SEP-53 message signing, with the existing SEP-10 compatibility fallback where required.
- The proof should occur **inside the user action that needs it**: for example `Open Inbox -> confirm in wallet -> Inbox`.
- Human UI must not turn this mechanism into a recurring product concept. Avoid persistent `Private data locked`, `Unlock saved names`, and default-unlock-duration controls in ordinary navigation.
- Rejection must remain a rejection. Do not silently convert a user-rejected SEP-53 prompt into a transaction-signing fallback.
- Explicit `Lock private workspace` remains acceptable as a security escape hatch; session-duration tuning belongs in advanced settings, not the primary account menu.
- `Choose another wallet` is a signer-transport change, not Sign out + Sign in. It must preserve the current work surface; changing identity invalidates any private-session proof that belonged to the prior wallet. Sign out clears identity but must not silently throw away an in-progress local Review by navigating to Dashboard.

Security stays strict; ceremony becomes quiet.

## 3. Stellar semantics: translate, do not invent

Protocol vocabulary is not automatically Human vocabulary, but translations must remain true.

Do not present `lowThreshold`, `medThreshold`, or `highThreshold` as amount-based limits such as “small payment / large payment”. Stellar threshold level is determined by operation semantics, not transaction amount.

Human presentation should instead explain the authorization consequence:

- **Limited account actions** — the specific Stellar operations governed by the account's low authorization level.
- **Standard transactions** — payments and most ordinary Stellar account operations governed by the medium authorization level.
- **Core account control** — high-authorization actions such as signer/threshold changes and account merge.

Where signer weights are unequal, do not collapse the rule into a false `2 of 3` statement. Prefer:

`Required approval power: 3`  
`Alice 1 · Bob 1 · Treasury Admin 2`  
`Current approval power: 2 / 3`

When weights are equal, a Human shorthand such as `2 of 3 approvals` is valid and encouraged.

Raw `SetOptions`, threshold fields, weights, XDR, operation codes, and protocol details belong in **Advanced / Technical details** after the Human-readable intent.

## 4. One Proposal entry, several technical transaction types

Human navigation has one primary action: **New proposal**.

The existing transaction builders remain distinct because their Stellar semantics are genuinely distinct:

- ordinary payment;
- batch payment;
- claimable payment;
- multi-source / multi-party transaction;
- account-control change;
- imported XDR.

Do not expose all of them as equal top-level choices.

### Phase A — entry unification

`New proposal` starts with the common payment path. Less common account/protocol actions live under **More Stellar actions**, while Import XDR remains a direct technical entry for an already-built transaction. All transaction paths continue through the canonical Human flow:

`1 Prepare -> 2 Review -> 3 Sign -> 4 Submit -> 5 Done`

### Phase B — composer convergence

Where semantics genuinely overlap, converge the composer rather than only the menu:

- one recipient -> ordinary payment;
- adding recipients -> batch payment;
- unsupported/unfunded destination -> offer, never silently force, an appropriate alternative such as claimable payment;
- raw XDR remains a direct technical import path for an already-built transaction;
- multi-source remains explicit because it creates multiple independent authorization domains.

The implementation must never “simplify” by changing the ledger meaning without the user choosing it.

### Account Signing: one flow, multiple entry faces

Account signer/threshold configuration is a Stellar account capability, not a Treasury role. MultiSigTools therefore owns one shared **Account Signing Policy Flow** that can be entered from several contexts:

- standalone `Set up multisig`;
- `Set up multisig offline`;
- Treasury create/change signing;
- future authority/resource contexts that need to configure a controlling G-account.

Entry context may supply the account, network, return destination, preferred signing transport, and Human copy. It must not duplicate the policy editor, signer/threshold rules, reserve checks, or SetOptions builder.

Review separates **who built the transaction** from **who may authorize it**. If the current wallet is a live signer for the target account, the flow may create a Proposal and continue to Sign. If it is not, Review ends safely in an XDR handoff; the same Review accepts a signed copy back and merges only signatures for the exact transaction, so a round trip never requires restarting from Import XDR. If a reviewed Classic XDR already satisfies current on-chain authorization and execution preconditions, Sign is already complete and Review may advance directly to an explicit Submit confirmation without creating a Proposal or authenticating another wallet. Building an account-signing transaction never grants Proposal authority. Offline entry uses the same rule but prefers XDR handoff by default.

## 5. Dashboard and actionable work

After wallet connection, `/` becomes the Human Dashboard rather than reopening marketing/onboarding choices.

Priority order:

1. Proposals that need this signer now.
2. Proposals already ready to submit.
3. Treasuries the signer can authorize/manage.
4. Create a new Proposal.
5. Activity and Contacts.

If the current private session is already verified, the Dashboard may fetch private Inbox counts and highlight them. If proof is needed, the Dashboard should still show the action and perform proof only when the user opens the private surface. Never open a wallet signature prompt automatically on page mount.

### Activity scope after workspace unification

One Human workspace does **not** mean one undifferentiated history scope.

- `/activity` is **Personal Activity**: retained Proposal/transaction history the current wallet saved, signed, declined, or otherwise participated in. It follows the Signer Principal across Treasuries and source accounts.
- `/treasury/activity?account=...` is **Treasury Activity**: history for that Treasury resource. A current authorized Treasury signer may inspect the Treasury's retained history even when they did not personally participate in every Proposal; private participant-only context remains participant-only.
- The two surfaces may share the same Activity cards, status language, transaction details, and visual system. They must not share authorization scope merely because Sign and Manage workspaces were merged.
- A legacy saved `sign/setup` workspace preference must never choose which Activity dataset is loaded. Activity scope comes from the explicit route/resource context.
- Navigation origin owns post-Review return context. If no explicit origin survives, the unified Dashboard is the safe fallback; hidden legacy workspace mode must not choose Inbox versus Treasury.

## 6. Visual trust is semantic first

Financial trust does not come from decorative “banking” styling. It comes from obvious state, consequence, and authority.

Every Review / Sign surface should make these facts visually dominant before technical detail:

- what will happen;
- which Treasury/source account is affected;
- who/what receives value or authority;
- how much approval power is present and still required;
- whether submission is possible now;
- what changed on Stellar after Done.

Shared state colors:

- neutral — prepared / informational;
- amber — waiting / attention required;
- green — authorized / ready / successful;
- red — rejected / failed / dangerous account-control consequence;
- blue — Testnet context, not success.

Network ownership follows the work, not a page-local toggle. Mainnet is implicit in ordinary Human chrome; Testnet is exceptional and visible. A Proposal/transaction network is authoritative once known. Only unresolved import/offline boundaries may offer a Human fallback choice, with the connected wallet network as the default when available.

Content ownership is deliberately different from runtime ownership. Mainnet and Testnet keep separate fixed-network App runtimes, but product content is canonical on the Mainnet site. Testnet does not duplicate Docs, Developers, Privacy, Terms, the interactive demo, or the full marketing landing; those content routes resolve to the canonical Mainnet origin while Testnet `/` remains a compact entry into the Testnet workspace. This separation must not be implemented as an in-app network switch.

Color is supplemental; state text and icons remain required.

## 7. Mobile is approval-first

Responsive design is task prioritization, not desktop shrinkage.

Mobile primary navigation prioritizes:

`Dashboard · Inbox · New · Treasuries`

The dominant mobile use case is:

`notification/link -> understand intent -> approve -> done`

Activity, Contacts, policy design, cold/offline bootstrap, raw XDR, and complex Treasury construction remain available but visually subordinate. Desktop remains the preferred environment for complex setup and policy editing.

## 8. Implementation rules

- Do not render a first-use `Sign transactions / Manage treasury` modal.
- Do not display `Sign mode` / `Manage mode` as a persistent product state.
- Do not place default private-session duration controls in the ordinary wallet menu.
- Do not auto-trigger identity signatures on mount.
- Do not rename Stellar semantics inaccurately for the sake of friendliness.
- Keep advanced routes and APIs stable while Human navigation is simplified.
- Prefer one Human noun for the durable collaboration object: **Proposal**. `Signing Request` / `Request` remains acceptable in API and protocol surfaces.
- Continue using the shared `1 Prepare -> 2 Review -> 3 Sign -> 4 Submit -> 5 Done` workflow.

## 9. v137 first implementation slice

This contract is implemented first through a bounded structural slice:

1. remove the workspace-choice onboarding from the rendered shell;
2. use one unified workspace navigation instead of Sign/Manage navigation modes;
3. switch connected `/` users directly to a Dashboard;
4. remove workspace-mode and private-unlock-duration controls from the primary account menu;
5. rename and restructure `/new` around one `New proposal` primary path, with specialist builders under Advanced;
6. make mobile navigation approval-first while retaining desktop access to Activity and Contacts.

### v138 authorization-language slice

The next bounded slice removes protocol-first authorization language from the normal Treasury and signing surfaces without changing Stellar semantics:

1. low / medium / high are presented as `Limited account actions`, `Standard transactions`, and `Core account control`;
2. exact equal-weight policies may say `2 of 3 approvals`; weighted policies show required and available `approval power`;
3. the account's own signing key is presented as `Account key`; `master key`, raw threshold fields, signer weight, SetOptions, and XDR remain technical vocabulary under Advanced;
4. Review and signing guidance explain the current policy consequence before technical fields.

### v139 Activity-scope / legacy-mode retirement slice

The next bounded slice closes the remaining Human behavior leak from the retired Sign/Manage workspace model:

1. global `/activity` is always Personal Activity;
2. `/treasury/activity` is always Treasury resource Activity;
3. active Landing, Activity, and Review surfaces no longer read the saved legacy workspace mode;
4. Landing opens the unified workspace/Dashboard rather than selecting Inbox or Treasury from an old preference;
5. account-control flows pass their Treasury return target explicitly into Review/Proposal navigation, while neutral Review falls back to Home.


### v140 viewer-action / mobile Inbox slice

The next bounded slice makes mobile approval work action-first without changing the Request lifecycle:

1. canonical Request status remains transaction-wide fact (`Collecting signatures`, `Authorization complete`, `Waiting`, `Needs attention`); Human Inbox separately projects what the **current signer** can do now, such as `Review & sign`, `Choose execution`, or `Review & submit`;
2. Human viewer actions are `Sign`, `Submit`, `Waiting for others`, `Waiting for ledger`, `Needs attention`, or `Declined`; a signer who already signed must never be counted again as needing a signature;
3. Dashboard counts only actionable Human work instead of treating every visible active Request as "waiting for your approval";
4. Agent Inbox remains canonical Request data. Human-only viewer actions must not imply that Read/Write/Sign Agent credentials can perform Human network submission;
5. on narrow screens, each Inbox card exposes its next action and opens the Proposal directly. The desktop split preview remains, but the full detail pane is not duplicated underneath the mobile list;
6. `Review & sign` and `Review & submit` still enter the existing Proposal flow. They do not bypass Review, wallet signing, Mainnet confirmation, or the reversible Submit confirmation.

### v141 semantic progress reinforcement slice

The next bounded slice makes the shared five-stage progress control carry state meaning without inventing new lifecycle states:

1. a Proposal opened from Inbox remains on **Review** until the Human crosses the Review boundary; it must not highlight Sign merely because the stored Request is already awaiting signatures;
2. once Review is complete, the active Sign / Submit / Done stage reuses the same semantic tone as canonical Request status: warning for work/waiting, success for ready/done, danger for blocked/stale, neutral for expiry;
3. Dashboard summarizes current-signer action counts with the same warning / success / danger / neutral vocabulary used by Inbox badges;
4. Demo uses the same progress-tone contract so its workflow does not teach a visually different state model.

### v142 single-to-multiple recipient convergence slice

The next bounded slice removes `Batch` as a Human product choice while preserving its distinct internal route/domain representation:

1. **New proposal** exposes one primary `Send payment` entry. Multiple recipients are reached from inside that composer with `Add another recipient`;
2. the promotion carries the selected Treasury, first recipient, amount, exact asset identity, public memo, Private Note, and transaction lifetime into the multiple-recipient editor;
3. the internal `/new/batch` route and `batch` domain key remain supported for compatibility, tests, deep links, and transaction classification, but ordinary Human surfaces call the result `Payment · N recipients` or `Send to multiple recipients`;
4. promotion must not silently change ledger semantics. `Payment` always remains Payment and requires an active destination. Account creation is an explicit sibling action; only a single-recipient native-XLM draft can switch to `CreateAccount` without losing compatible source/destination/amount/context fields, and destination state never performs that switch automatically;
5. on-chain Private Note proof is not silently converted because the current multiple-recipient editor supports a public text memo rather than the single-payment hash-memo proof contract. The Human must turn off proof before adding recipients;
6. claimable payment, multi-source transactions, Contract Call, and Account Signing remain explicit low-frequency actions because their ledger/authorization semantics are genuinely different; they do not compete visually with the common Payment path.

Not claimed complete in this slice: a graphical row editor for multiple-recipient payment, automatic Treasury relationship counts on Dashboard, complete protocol-jargon removal from every advanced screen, or final visual polish. Those are follow-on implementation work under this same contract.

### v143 multiple-recipient Human row editor slice

The next bounded slice removes the spreadsheet/paste-first interaction from ordinary same-source multi-recipient Payment while preserving the validated batch domain model:

1. `Send to multiple recipients` opens with explicit editable Recipient / Amount / Asset rows and an `Add recipient` action; a Human does not need to know CSV syntax to complete the common path;
2. the editor serializes those rows back into the existing structured-transfer input contract, so validation, asset resolution, duplicate detection, funding checks, transaction construction, saved drafts, deep links, and the internal `batch` domain key remain unchanged;
3. saved Address Book account names are suggested in recipient fields but are still resolved by the existing deterministic parser; the row UI does not invent a second identity-resolution path;
4. paste/import remains available only as an optional shortcut. Imported CSV/tabular rows become the same visible editable rows before Review rather than remaining an opaque text blob;
5. malformed legacy draft lines remain visible for repair instead of being silently discarded, and the editor keeps at least one editable row when the list is empty;
6. multi-source/multi-party composition remains a separate Advanced surface and keeps its structured text workflow in this slice because source-per-row semantics genuinely differ.

### v144 ordinary Human protocol-language boundary slice

The next bounded slice removes protocol/mechanism leakage from ordinary Treasury and completed-transaction surfaces without changing any security or Stellar behavior:

1. Treasury discovery explains public account relationships and signing authority instead of exposing `ed25519 signer`, `signer relationship`, lock state, or an `Unlock private data` product action; private names remain protected by the same action-bound wallet proof underneath, and Address Book / signer pickers ask to `Show saved names` / `Show saved signers` rather than advertising lock state;
2. Treasury cards project Standard transactions and Core account control through the same Human authorization requirement helper used elsewhere, rather than exposing raw threshold/total-weight ratios;
3. ordinary signer lists may say `Signer`, `signing key`, `Account key`, and `approval power`; raw signer type identifiers and raw `weight` remain confined to Advanced signer details;
4. Transaction receipt presents signing history, accounts involved, Human authorization requirements, and `approval power`; raw medium/high threshold numbers and `weight` no longer appear in the default evidence cards;
5. Submit confirmation uses the canonical Human verb `Submit` rather than `Broadcast`; the completed card says `Transaction confirmed`; the implementation may still use Horizon internally, but the ordinary link is described by its Human purpose (`View network record`);
6. `signature` / `signer` remain valid Human vocabulary where they describe the actual signing action or actor. This slice does not hide cryptographic evidence or weaken the distinction between signing and submission.

Not changed in this slice: Advanced XDR/import surfaces, raw protocol audit fields under Advanced, Agent/API terminology, Stellar operation semantics, wallet-proof mechanisms, or final visual hierarchy/polish.

### v145 final visual hierarchy slice

The final bounded Human UX polish pass aligns the four primary workspace surfaces without changing their information architecture, workflow, or permissions:

1. Dashboard, Inbox, Proposal, and Treasury share one page-header grammar for page identity, optional context, description, metadata, and page-level actions;
2. page identity appears before local workflow/state detail. In particular, Proposal names itself before the canonical 1–5 progress control so status never replaces page identity;
3. Dashboard and Inbox share the same wide workspace content frame. Narrower task/detail surfaces may remain intentionally constrained where the work benefits from a shorter reading measure;
4. one dominant working surface may use stronger shape/elevation (`rounded-3xl` plus subtle shadow), while secondary list/history cards remain flatter. Elevation communicates working focus rather than inventing a new status meaning;
5. existing network and status colors keep their settled semantics. This slice does not add a decorative palette, recolor lifecycle meaning, or use elevation as authorization evidence;
6. visual reuse stops at shared Human concepts. `PageHeader` is shared because page identity repeats across primary surfaces; local card layout remains local rather than being abstracted into generic wrappers.

Not changed in this slice: Dashboard/Inbox/Treasury information architecture, Proposal lifecycle, viewer-action semantics, Activity scopes, wallet-proof behavior, transaction builders, authorization rules, Request/API contracts, or Public Beta abuse controls.

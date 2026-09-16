# MultiSigTools Human UX Design System

**Status:** canonical Human experience contract
**Scope:** Stellar Human UI; Demo and Production share the same presentation language.

This document freezes the small design system required to keep MultiSigTools coherent. It is not a generic component library and it does not replace the product, authorization, privacy, or protocol contracts.

## 1. Canonical Human transaction journey

Every Human transaction flow projects onto the same five stages:

```text
1 Prepare -> 2 Review -> 3 Sign -> 4 Submit -> 5 Done
```

| Stage | Domain meaning | Owning surface |
| --- | --- | --- |
| **1 Prepare** | Mutable Draft / transaction intent | Payment composer, account-control designer, external composer |
| **2 Review** | Inspect exact XDR and private context before freeze | Signing Room / Review |
| **3 Sign** | Frozen Proposal is collecting Stellar signatures | Proposal |
| **4 Submit** | Authorization is sufficient; choose/prepare the allowed execution route, satisfy final envelope authorization, and submit | Proposal / Intent execution |
| **5 Done** | Ledger submission is complete; retained history/evidence | Transaction Receipt / Activity |

Important distinctions:

- **Proposal is an object, not a workflow step.** It spans Sign and Submit.
- **Transaction Receipt and Activity are views, not steps.** They project Done/history.
- Imported XDR may enter directly at Review; Prepare is shown as completed because composition happened elsewhere.
- Activity lists do not show a global five-step bar because a list contains many independent transactions. Opening one transaction may show its lifecycle.
- Expired/stale/blocked transactions stop at the last meaningful Sign/Submit stage and overlay their status; errors do not invent a sixth lifecycle stage.
- The canonical 1-5 bar is the only numbered transaction progress system. Local editor/signing substeps may use unnumbered labels, but must not introduce a second 1/2/3 sequence beside it.
- Local preparation checks must not reuse a canonical stage name in a way that implies the transaction has advanced. For example, policy setup uses `Check policy`, while the exact-XDR freeze screen remains `Review`.

## 2. Human language

Use **Sign / Signed / signature(s)** for signer actions and cryptographic evidence.

Use **approval(s)** for policy or quorum meaning, for example:

- `2 approvals required` describes a Treasury rule;
- `Alice signed` describes what Alice did;
- `2 signatures collected` describes transaction evidence.

Do not use `Approve` as a second Human verb for the same signing action. Protocol/audit internals may retain `approval_added`, `approval_declined`, and related field names.

Demo follows the same Human vocabulary. When it simulates a signature, the UI must also state that the Demo did not create a wallet signature.

## 3. Color semantics

Color communicates one meaning at a time. Network, lifecycle, and outcome colors must not be conflated.

### Lifecycle

| Meaning | Color role |
| --- | --- |
| Completed stage | Success green |
| Current stage | Strong neutral (black/white) |
| Future stage | Neutral gray |
| Lifecycle failure/attention | Separate status badge; do not recolor the whole progress bar |

### Request / outcome status

| Status | Color role |
| --- | --- |
| Collecting signatures / authorization complete but waiting | Warning amber |
| Authorization complete / Done | Success green |
| Stale / blocked / deterministic failure | Danger red |
| Expired / historical neutral terminal | Neutral gray |

### Network

| Network | Color role |
| --- | --- |
| Stellar Mainnet | Brand emerald when an explicit transaction fact/action needs network color |
| Stellar Testnet | Information sky |

Network color says **where an action happens**, not whether it succeeded. Success green remains success green on Testnet. Testnet sky must not replace warning amber or danger red.

Visibility is deliberately asymmetric:

- **Mainnet implicit** — the Mainnet deployment keeps ordinary workspace chrome, wallet identity, lists, Treasury management, and guided composers free of a permanent Mainnet badge.
- **Testnet explicit** — the Testnet deployment and transaction facts visibly say Testnet; this is environment identity, not a switch.
- **Network fact explicit** — Review, Submit, Receipt, portable evidence, mismatch warnings, and other safety/evidence boundaries may name either Mainnet or Testnet.
- **No production network chooser** — each production domain fixes one network. URL parameters, browser state, wallet defaults, and work-object input cannot switch it. The old dual-network fallback is local compatibility only.
- **Hardware inherits deployment** — Ledger/Trezor are networkless signer transports. Fixed deployments hide the hardware-network selector and never present Wallets Kit application state as device-reported network evidence.

Imported XDR is validated only under the deployment network because an envelope does not encode its passphrase. The UI does not query both ledgers or inspect signatures to guess a network. A network mismatch is a boundary error handled by choosing the correct domain, not by mutating the transaction context in place.

### Demo

Demo safety/teaching notices may use amber when they communicate caution such as "simulated, not broadcast". Demo must not invent a separate palette. Its workflow, status, and network indicators use the same components as Production.

## 4. MultiSigTools UI primitives

Human workflow semantics must be rendered through `src/MultiSigUi.tsx` where practical.

Current primitives:

- `WorkflowProgress` — the canonical 1–5 transaction lifecycle;
- `StatusBadge` — semantic outcome badge with neutral/success/warning/danger tones;
- `RequestStatusBadge` — one mapping from Request status to Human label + status color;
- `NetworkBadge` — exceptional-environment indicator; renders Testnet and intentionally renders nothing for ordinary Mainnet chrome.
- `NetworkFact` — explicit Mainnet/Testnet fact for Review, Submit, Receipt, evidence, and equivalent safety boundaries.
- `NetworkFallbackChoice` — asymmetric unresolved-network fallback; shows one current default plus `Use <other network> instead`, never a permanent two-way segmented switch.
- `ActionButton` — semantic Human action ownership for primary, secondary, and destructive CTAs; pages supply action meaning/behavior, while the primitive owns shared focus, disabled, sizing, and base visual treatment.
- `TransactionLifetimePicker` — canonical 1 hour / 24 hours / 7 days button group for transaction lifetime. Human composers must reuse this primitive rather than introducing a page-local select/dropdown or alternate lifetime grammar.

Action controls are not status indicators. Brand emerald on a primary action means **do this**, not **this succeeded**. Warning/success/danger state remains owned by status components. Do not introduce page-local primary-button palettes when an existing Action variant expresses the same Human action role; equally, do not wrap every tiny technical control merely to deduplicate Tailwind classes.

Pure lifecycle/status mapping lives in `src/stellar/humanWorkflow.ts` so controllers and tests do not depend on React.

### Boundary rule

Shared presentation components receive facts as props. They do **not** load Horizon, call `/api`, inspect wallet identity, unlock private state, or own business transitions.

```text
Production controller        Demo controller
wallet / API / Horizon       in-memory simulated facts
          \                    /
           \                  /
           shared MultiSig UI
```

This preserves the v123 Demo security boundary while eliminating a second visual language.

## 5. Component policy

Extract a shared MultiSigTools component when all are true:

1. the same Human concept appears on two or more product surfaces;
2. differences are facts/props, not different authorization behavior;
3. centralization prevents terminology, state-color, or accessibility drift.

Do not abstract local layout merely because two cards share Tailwind classes. Domain presentation primitives are valuable; generic wrappers without semantic ownership are not.

## 6. Adoption contract

- Payment and account-control composition show **Prepare**.
- Signing Room shows **Review**.
- Proposal shows **Sign** while signatures are missing.
- Ready/waiting-precondition Proposal shows **Submit**.
- Soroban `authorization_ready` also shows **Submit**. Execution routing is an unnumbered choice inside Submit, never a sixth workflow stage.
- Submitted Proposal and Transaction Receipt show **Done**.
- Demo uses the exact same five-step component and terminology.
- Inbox uses the shared Request status badge and network badge, but not a five-step bar for the whole list.
- The active step in the shared five-stage progress control may carry the same semantic tone as the current Request state: warning for action/waiting, success for ready/done, danger for blocked/stale, neutral when no stronger state applies. The tone reinforces state; it never creates an additional lifecycle stage.
- A Proposal opened from Inbox remains visually on **Review** until Review is completed. Stored Request status must not skip the visible Human review boundary.
- Dashboard action-count badges reuse the same warning / success / danger / neutral system as Inbox viewer actions; do not introduce a second dashboard-only palette.
- Protected destinations remain visible while locked. Clicking **Inbox**, **Activity**, or **Transaction receipt** performs wallet confirmation as part of that same action and continues when authorized; ordinary workflow copy does not make “Unlock” a separate prerequisite task.
- On Transaction Receipt, the five-stage workflow comes before page-level actions. **Export evidence PDF** belongs on the Receipt heading row. The PDF renders from a separate portable-evidence projection; there are no private-data print toggles on the default evidence export.
- Global **Activity** means Personal Activity for the current wallet: history it saved or participated in across resource contexts. **Treasury Activity** is entered from a Treasury and remains scoped to that Treasury resource. Shared cards/layout do not imply shared authorization scope.
- After Review freezes into a Proposal, return navigation is owned by the originating action/resource. Neutral flows fall back to Home; account-signing flows return to the entry context that created them (standalone account signing or Treasury). A hidden legacy Sign/Manage preference must not choose the return destination.
- **Required actions never live only under Advanced.** Advanced may expose XDR, RPC/provider facts, Core authorization details, and other evidence, but a Human action required to progress from Review to Sign must appear in the main Review flow.
- Guided Contract Call treats a complete valid `C...` address as sufficient intent to load its on-chain interface automatically; the explicit Load / Reload / Retry control remains available as a manual escape hatch.
- Guided Contract Call creates a source-free Soroban Intent directly from contract + method + arguments; transaction source/lifetime are not Prepare inputs. Recording simulation is planning evidence, not the durable workflow object. Raw/unprepared imported Soroban XDR keeps the recording RPC check explicit. A supported imported prepared XDR is converted into the same Intent model: preserve valid detached AUTH evidence, discard the transaction shell, and reject SOURCE_ACCOUNT rather than silently binding authorization to the imported source.
- **Status badges describe canonical Work facts, never viewer permissions.** `awaiting_signatures` is `Collecting signatures`; `ready` is `Authorization complete`. Whether the current Human must sign, may submit, must choose execution, or is waiting belongs only to viewer-action presentation.
- Inbox keeps **Request status** and **viewer action** separate. Request status describes the Proposal/transaction as a whole; viewer action describes what the current Human signer can do now. A signer who already signed is `Waiting for others`, not `Signature needed` as a personal task.
- Human Inbox viewer actions are presentation facts derived server-side from current Request state + current signer evidence. They are not added to Agent Inbox responses and never expand Agent permissions.
- Inbox and Dashboard project `authorization_ready` as **Choose execution** only when the current Human is allowed to select an execution route. Fixed external execution projects as **Waiting for execution** and is not counted as a submit task.
- Mobile Inbox cards expose `Review & sign`, `Review & submit`, `Review issue`, or `View status` directly. Those CTAs open the canonical Proposal flow; they never skip Review or submit confirmation. Desktop may retain the split preview.
- Ordinary Human navigation does not expose `Batch payment` as a separate product type. Start with `Send payment`; `Add another recipient` promotes the draft while preserving compatible context. Internal `batch` routes/domain keys may remain technical compatibility details.
- Single-to-multiple recipient promotion must stop rather than silently change ledger meaning when the current single payment would create an inactive Stellar account, or when on-chain Private Note proof cannot be represented equivalently by the multiple-recipient editor.
- Human history and Inbox label same-source multi-operation payments as `Payment · N recipients`; `batch_payment` remains a domain classification, not required user vocabulary.


### Multiple-recipient Payment editor

For same-source Payment, the Human control is a row editor, not a parser textbox:

- one visible row owns Recipient, Amount, and Asset;
- `Add recipient` creates another visible payment row;
- Address Book names may be suggested, but deterministic resolution remains owned by the existing transfer parser;
- paste/import is an optional accelerator under a subordinate disclosure and must materialize into the same editable rows before Review;
- the row editor serializes to the existing structured-transfer domain input instead of creating a parallel transaction builder.

Multi-source transactions are exempt from this component in the current slice because each row also owns an independent source account and authorization domain.

## 7. Regression questions

Before shipping Human UI, check:

1. Did a screen introduce a sixth transaction stage or rename one of the five?
2. Did `Approve` reappear as a signer action where `Sign` is intended?
3. Did Mainnet/Testnet color replace a success/warning/danger meaning?
4. Is status mapping duplicated outside the shared primitive without a real semantic reason?
5. Does a shared presentation component acquire wallet/API/Horizon authority?
6. Does Demo render a different workflow or vocabulary from Production?
7. Did a global Activity view accidentally acquire Treasury-wide history, or did Treasury Activity get reduced to only the current signer's participation?
8. Did a composer replace the shared Transaction lifetime buttons with a select/dropdown or another local control?
9. Is any action required to advance Review hidden only under Advanced?
8. Did any active Human surface reintroduce `getWorkspaceMode` as a behavior switch after workspace unification?
9. Did an Inbox card confuse transaction-wide Request status with the current signer's next action?
10. Did Human action projection leak into Agent capability semantics or imply Agent submission authority?
11. Did `Batch` reappear as a required Human product choice instead of an implementation/domain term?
12. Did single-to-multiple recipient promotion change CreateAccount, memo-proof, asset, or source semantics silently?
13. Did a normal multiple-recipient Payment fall back to a paste-first spreadsheet UI instead of explicit Recipient / Amount / Asset rows?

## 8. Trust closure and wallet confirmation

The footer closes the Human trust story; it is not a duplicate navigation bar.

- Landing uses a richer footer with brand, product/resources/trust groups, the monitored Support contact, Beta status, and a short non-custodial reminder.
- Workspace uses a compact footer because Dashboard/Inbox/Treasuries/New already live in workspace navigation. It retains Docs, Privacy, Terms, Support, brand, and Beta status without competing with the task surface.
- **Set up multisig** is a low-frequency Account Signing action, not a Treasury-only operation. It stays subordinate to common transaction actions while remaining directly discoverable in `More Stellar actions`.
- **Set up multisig offline** is another entry face of the same Account Signing flow. The legacy internal `/treasury/bootstrap` route may remain only as compatibility vocabulary.
- Account Signing entry context may change initial copy and the preferred Review outcome, but never creates a second policy editor or transaction lifecycle. The shared flow remains account state -> signers -> approval rules -> Review.
- At Account Signing Review, current on-chain signer authority decides the safe continuation. A current signer may continue to Proposal/Sign; a builder who is not a current signer receives the exact XDR for handoff instead of creating a Proposal under an unrelated identity. Offline entry prefers this XDR handoff even when a signer wallet is connected.
- XDR QR is a **transport projection of the exact reviewed/frozen transaction**, not another workflow. It contains transaction XDR only, never a secret key. XDR-first Account Signing keeps an explicit `Add signed XDR` return path in the same Review and merges only signatures for the exact transaction; Import XDR remains available when the original Review is no longer open. If an imported/reviewed Classic XDR already satisfies live authorization and execution preconditions, the Sign step happened elsewhere, so Review offers an explicit direct Submit confirmation without forcing Proposal creation or wallet authentication. Submission remains optional.
- Soroban detached G-account authorization is coordinated through the Intent id, not by passing a mutable prepared transaction between signers. Each signer opens the same Intent, authenticates as its own Stellar identity, and contributes only its detached AUTH evidence. After `authorization_ready`, the UI enters execution routing within **Submit**: ordinary work may use the current wallet as proposed executor, prepare an exact XDR handoff, or ask MultiSigTools to coordinate final envelope signing/submission. A fixed external-Service policy instead shows waiting for that Service and must not expose signer takeover controls. Every route materializes late with fresh transaction facts and enforcing effects comparison; if the chosen source is multisig, the final transaction still enters the ordinary Proposal/Sign flow.
- Use a single static QR only when the current XDR fits reliably. Oversized transactions fall back explicitly to `Copy XDR`; do not invent a dynamic/multipart QR protocol until a real signer interoperability requirement justifies one.
- `support@multisig.tools` is the Human Support/security contact for the current Beta surface.
- Direct protected-route fallback screens may show one explicit confirmation button, but they must not ask the user to choose session duration again. Session duration remains an implementation/security preference and is not a primary wallet-menu concept.
- Choosing another wallet changes the active signer transport without navigating away from the current work object and without forcing a private-workspace proof. Any previous private session is invalidated when the selected identity changes. Product Sign out clears wallet/session identity but does not discard or navigate away from an in-progress local Review.
- Wallet identity is event-driven through the wallet Kit. Focus/visibility reconciliation is a bounded compatibility check, not a permanent polling loop.

## 9. Human semantic boundary

### Authorization vocabulary

Default Human UI uses `Limited account actions`, `Standard transactions`, and `Core account control` for Stellar low/medium/high authorization levels. Raw `lowThreshold`, `medThreshold`, `highThreshold`, signer `weight`, `SetOptions`, and XDR belong under Advanced/Technical details.

When signer weights are equal and analysis proves an exact N-of-M policy, show `2 of 3 approvals`. Otherwise show the actual weighted requirement as approval power, for example `3 approval power required · 5 available`. Never translate medium/high thresholds into transaction amount bands.


`HUMAN_UX_ARCHITECTURE.md` is the canonical contract for Dashboard-first navigation, quiet action-bound wallet proof, one `New proposal` entry, protocol-language translation, and mobile approval priority. Internal route families may remain separate, but Human UI must not expose `Sign mode` / `Manage mode` as a required identity choice.

## 10. Ordinary Human protocol-language boundary

Normal Treasury, Proposal, and completed-transaction screens describe user intent and evidence before implementation mechanics.

- Do not expose `ed25519`, raw threshold/weight ratios, `Unlock private data`, `Unlock saved names`, or a `signer relationship` as ordinary product vocabulary.
- Use `signing authority`, `signing key`, `Account key`, Human authorization requirement labels, and `approval power` where those facts matter. When private names are useful, phrase the action by intent (`Show saved names`, `Show saved signers`) and perform wallet proof only after that action.
- Use **Submit** for the Human network action. `Broadcast` is an implementation/protocol verb and belongs in technical documentation, not the confirmation CTA.
- A completed Proposal says **Transaction confirmed** and may show the ledger number as evidence. An implementation endpoint such as Horizon should be named by purpose (`View network record`) unless the user opens Advanced/technical details.
- `Sign`, `Signed`, `signature`, and `Signer` are not banned protocol jargon; they are the canonical Human vocabulary for the actual cryptographic action and evidence.

Regression check: ordinary Human surfaces must not drift back to raw Stellar type names or authorization fields merely because the underlying APIs still use them.

## 11. Primary workspace visual hierarchy

Dashboard, Inbox, Proposal, Contract Authorization, and Treasury use the shared `PageHeader` as the primary page-identity primitive. It may carry an eyebrow/status context, icon, title, description, metadata, and page-level actions, but it owns presentation only and must never acquire wallet, Request, Horizon, or authorization behavior.

Visual order for a primary task page is:

`Page identity -> workflow/status context -> dominant working surface -> secondary evidence/history`

For Proposal and Contract Authorization, the stable page title must appear before `WorkflowProgress`; the progress bar explains where the Work is in the canonical journey and does not substitute for page identity.

Layout/elevation rules:

- Dashboard and Inbox use the same wide workspace frame so switching between overview and actionable work does not cause unnecessary horizontal drift;
- a dominant working card may use `rounded-3xl` with a subtle `shadow-sm` to establish focus;
- secondary list/history cards normally remain `rounded-2xl` and flatter, unless their own task semantics require focus;
- elevation, border radius, and spacing never encode success, danger, network, or authorization state. Existing semantic badges/colors remain authoritative;
- do not create generic shared card wrappers merely to deduplicate Tailwind classes. Extract a shared component only when it owns a repeated Human concept.

Regression checks:

1. Do Dashboard, Inbox, Proposal, Contract Authorization, and Treasury still share the same page-identity grammar?
2. Do Proposal and Contract Authorization show Work identity before the 1–5 progress control?
3. Did visual polish accidentally add a second status color model or change an existing semantic tone?
4. Did a generic layout abstraction gain domain/security behavior or erase a meaningful surface distinction?

## 12. Instrumental density and signer progress

The visual direction is a precise digital-asset control surface, not a collection of unrelated floating cards. Apply this selectively where it improves scanning and decision speed.

- Peer actions at the same hierarchy level may share one bounded panel with 1px hairline separators instead of repeating independent elevated cards. Dashboard quick actions are the reference pattern.
- Dense panels must preserve the existing page hierarchy; they do not flatten the dominant working surface or turn every section into a Bento grid.
- Exact N-of-M signing policies may show discrete signer cells so Humans can see who has signed and which remaining keys can satisfy quorum. Show this only when the authorization analysis proves an exact N-of-M policy; weighted or advanced policies retain the truthful Human authorization explanation instead of being forced into fake equal slots.
- Signature counts and other compact numerical evidence use tabular/monospaced treatment where it materially improves comparison. Addresses retain the existing Human label + monospaced exact-key hierarchy.
- Amber may mark a signer who can act now or a Request that still needs signatures, but the canonical 1–5 workflow current stage remains strong neutral. Status color never recolors the lifecycle bar.
- Existing graphite dark surfaces, subtle 1px light borders, and restrained elevation already satisfy the dark-mode base. Do not introduce neon gradients, Neumorphism, or body-level glass panels.


### Receipt / evidence projection boundary

- The screen **Transaction Receipt** is Human-first and may show authorized Shared Name, Personal note, Address Book identity, and Private Note context.
- Private Note must be labeled as private off-chain context and visually separate from canonical ledger/audit evidence.
- The printable **Portable Evidence** document is a separate renderer and projection, not print CSS applied to the Human Receipt.
- The Human Receipt DOM is excluded wholesale from print. Portable Evidence receives only exact Stellar identities and canonical/audit facts; it has no Human-name or private-context fields.
- `/receipt` is canonical pre-beta. The old `/transaction-details` route is retired rather than retained as an alias.

# Workspace UX, Language, and Discovery

**Status:** implemented product contract for the Stellar web app

For navigation, current product naming, language hierarchy, Treasury information architecture, footer/header behavior, Inbox discovery, and machine-access ownership, this document supersedes older wording in `PRODUCT.md` until that larger historical contract is consolidated.

## Navigation contract

The public landing page is `/`. It explains the product; it is not a workspace home.

- **Sign workspace home:** `/inbox`
- **Manage workspace home:** `/treasury`
- **Contract workspace collection:** `/contracts`

Choosing or switching to Sign routes to Inbox. Choosing or switching to Manage routes to Treasury. Neutral transaction routes such as `/s` and `/signing-room` keep their own context instead of being redirected merely because a workspace preference exists.

The site header and footer are shared components. The landing header may use a larger brand state at the top of the page and collapses to the same compact sticky header used by workspaces after scrolling. Footer navigation is global; Treasury-specific administration remains inside Treasury.

## Treasury information architecture

User-facing Treasury navigation is deliberately limited to three concepts:

1. **Overview** — shared Treasury name, balance, current signing policy, and signers.
2. **Activity** — transaction/request history associated with that Treasury.
3. **Settings** — signing-policy changes, Audit access, and administration history.

`Box` remains an internal architecture term. Product UI should not ask Treasury administrators to learn `Treasury Box`, `Box Activity`, or `Shared settings` merely to operate a Treasury.

A Treasury name is shared metadata. Treasury Overview displays that identity, while editing the shared name lives under Treasury Settings and remains audited.

The primary actions on a Treasury are ordered **Activity** then **Settings**. Current signer/threshold state remains visible on Overview; the action that changes signer policy belongs under Settings.

Settings pages entered for a specific Treasury retain a clear path back to that Treasury Overview.

## Shared Human presentation

The canonical transaction lifecycle, status colors, network colors, and shared Human UI primitives are defined in `UX_DESIGN_SYSTEM.md`. Demo and Production must use that same presentation contract.

Signer actions use **Sign / Signed / signature(s)**. **Approval(s)** remains valid for quorum/policy language such as payment approvals or account-control approvals; it is not a second signer action verb.

## Product copy discipline

Primary screens describe the task, current state, and next useful action. They do not narrate the data model or explain invariants that are already obvious from the interaction.

- Architecture and protocol rationale belongs in Advanced surfaces and documentation.
- Security copy stays at the decision boundary where it can change a user action.
- Empty states say what is happening or what can be done next; they do not teach the product architecture.
- Do not use explanatory prose merely to justify why a control is absent.

## Language layers

### Signers

Lead with task language:

- Inbox
- transaction
- signature
- sign
- Choose execution / Review & submit — only when the current viewer actually owns that next action
- wallet

Identity proof may be explained as a signed message, but protocol/authentication terminology should not be the primary call to action.

### Treasury administrators

Lead with operational meaning while retaining Stellar terminology as supporting detail:

- Payment approvals — Stellar medium threshold
- Account-control approvals — Stellar high threshold
- Signers and weights
- Master key
- Treasury settings
- Audit access
- Activity
- Administration history

A personal single-signature account is presented as: **Turn this account into a shared-control treasury.**

### Developers

Use exact integration vocabulary:

- XDR
- signer Principal
- Agent actor / Agent credential
- Treasury resource / internal Box boundary where relevant
- Idempotency-Key
- Request status / `statusReason`
- HTTP errors

The public developer entry point is `/developers`; `AGENT_API.md` is the detailed repository contract. Ordinary Agent access is signer-owned and uses the same Request resource as the Human product.

## Signer Agent access UX

Ordinary machine authority belongs to a **Signer Principal** (`network + G-address`), not to a Treasury. A Human who controls that signer may create independently named Agent credentials and choose one cumulative capability level:

- **Read** — signer Inbox, Activity, Request details/status, saved contracts, personal contacts, and Treasury resources that Principal may read.
- **Write** — Read plus Request creation, saved-contract and personal-contact writes, and non-cryptographic Request collaboration such as decline.
- **Sign** — Write plus signed-XDR/signature contribution attributable to that Principal.

The complete `msa_...` secret is shown only once. Server storage keeps a verifier hash plus non-secret metadata. Copy confirmation is temporary; revocation applies to the individual Agent actor without changing the Stellar signer itself.

A Sign Agent credential contains no Stellar private key and does not itself satisfy a threshold. MultiSigTools separately verifies the transaction, current Stellar signer relationship, and every newly contributed signature.

Agent access should link to `/developers` for protocol details. Human-facing controls should say **Agent access**, not force users to learn MCP, Skill, Box, or Automation terminology.

## Treasury Audit access UX

Treasury Settings may create a fixed-scope `mta_...` **Treasury Audit credential** for machine observation of that one Treasury's Activity.

Audit access is intentionally not a weaker spelling of Agent access. It cannot create Requests, read a signer's Inbox/personal Address Book, contribute signatures, submit transactions, rename/administer the Treasury, or gain participant-only Private Note context merely because it audits that Treasury.

Administration/audit events remain append-only internally, but the user-facing Settings section is named **Administration history**, not `Box Activity`.

## Inbox discovery model

Inbox browsing is signer-first and owned by MultiSig Tools rather than by a Horizon reverse lookup on every page open.

1. Request creation already refreshes every source-account signer policy to validate the XDR.
2. The active ed25519 signer addresses from that fresh policy, plus direct `G...` extra signers, are persisted as private `signer -> Request` discovery pointers.
3. Inbox opens by reading the current wallet's signer index directly. It does not first call Horizon `/accounts?signer=...`.
4. Before any private Request data is returned, `signerCanAccessTransaction()` revalidates the selected candidate against live source-account state.
5. Opening/signing/submitting a Request continues to use live Stellar state; the discovery index never grants authorization.

The v2 index backfills older active Requests once by reading their known source G-addresses directly and deriving current signer keys. This avoids the expensive reverse-signer scan even during migration. If index access or migration fails, the service may fall back to the legacy Request scan while retaining live authorization checks.

## Address Book and identity mapping

Address Book is the user's private address-to-name layer. One Stellar `G...` address has one personal display name wherever that address appears as a payment recipient, account, or signer. `account` and `signer` remain useful storage/context roles, but they must not create competing names for the same address in the product UI.

Address Book may also show useful public relationships already discoverable from Stellar: shared-control Treasury accounts reachable by the connected signer and the active ed25519 signers on those Treasuries. This relationship view is a convenience for finding addresses to name; it does not copy them into private Address Book storage and it is never authorization evidence.

A Treasury is the exception to ordinary personal naming at the resource level:

- its **shared Treasury name** remains the primary resource identity and is edited only in Treasury Settings;
- Address Book may show the Treasury and allow a private **Personal note** for the user;
- the Treasury's active signer addresses may be given ordinary private personal names directly from Address Book.

Address Book supports explicit manual `Add address` for contacts that have no discoverable Treasury relationship.

Cached private names and cached public relationship data should render immediately when available, then refresh in the background. Name writes use optimistic UI: the new display name appears immediately while persistence happens asynchronously, with rollback/error feedback if the write fails. These caches and optimistic states are display behavior only; live authorization continues to come from current private-session and Stellar checks.

The connected wallet itself is not automatically persisted as a contact, and a personal single-signature account is not promoted into a Treasury merely because it is the current wallet.

## Treasury metadata discovery

Treasury account relationships are public Stellar data and should render independently from private shared names. After private unlock, shared Treasury metadata is fetched in bounded batches rather than one private HTTP request per Treasury. Batch discovery is only a latency optimization; every requested Treasury is still revalidated as a current signer relationship before private metadata is returned.

Opening `/treasury/settings?account=<G...>` should not repeat the full signer-to-account discovery merely to identify the already-selected Treasury. The server validates the selected Treasury against current Stellar state. Full discovery remains available when Settings is opened without a Treasury context.

Browsing uses a short-lived display/navigation cache for signer discovery and Treasury metadata, including negative metadata results. Concurrent identical metadata reads are coalesced. Opening exact Treasury Activity uses the locally adopted Treasury list for selector presentation rather than another client-side Horizon lookup. These caches are never authorization evidence: request access, settings writes, signing-policy changes, and submission continue to use live server/ledger validation.

## Deliberate boundaries

- Global wallet Connect does not automatically unlock private data; Manage can inspect public Stellar signer relationships without an identity-signature prompt.
- The Inbox entry action combines wallet selection and identity verification when starting from a disconnected state.
- Personal address names and shared Treasury metadata remain separate namespaces: a personal name never renames a Treasury; a Treasury shared name never publishes or overwrites the user's private mapping.
- A Treasury has no shared name until a current signer names it in Manage workspace. That shared name is the only Treasury resource name and is edited in Treasury Settings.
- Ordinary Agent credential administration is signer-owned, not Treasury-owned. Treasury Settings may manage only the Treasury's observer-only Audit credentials.
- Agent Actor identity, Stellar signer Principal identity, Request participation, and Treasury membership remain separate permission/evidence concepts.

## Future relationship discovery: SAINT

Treasury account discovery still uses Horizon signer relationships today. Inbox no longer does: it uses the persisted signer-first Request index described above. A future SAINT adapter may replace Treasury reverse-index lookup and provide broader signer/address relationship discovery. SAINT supplies candidates; MultiSigTools must still revalidate current signer weights, thresholds, and authorization from live Stellar ledger state.

## Shared and personal contact names

Shared Box contact labels, when implemented, may be offered as one-way suggestions into a user's personal Address Book. Personal aliases must never automatically sync, publish, or flow back into shared Treasury metadata or Box Contacts. Copying a shared label into a personal Address Book requires explicit user action; after copying, the two labels are independent.

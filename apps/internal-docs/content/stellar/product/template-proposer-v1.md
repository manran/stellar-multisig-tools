---
title: "Template Proposer v1 — delegated payment requests"
description: "Testnet product contract for payment-request initiators without Treasury signing rights."
---

## Product outcome

A user with a verified Stellar G wallet, but no signing authority over the Treasury,
can request a payment using a pre-approved **single-recipient Payment Template**.
The Treasury's current signers retain all on-chain authorization and submission control.
This does **not** require a funded wallet, Team Workspace, or email login.

## Current Testnet UI

- The signer saves a payment Template in **New proposal → Create payment → Save as template**.
- The owner grants or revokes proposer G-wallet permissions in **Templates** (`/templates`), not in New proposal. Revocation requires explicit confirmation.
- A delegated wallet selects **Request payment**, enters amount and memo, reviews, and creates a Proposal. It does not acquire Treasury signing or submission authority.
- **Connect wallet** selects the wallet; **Confirm wallet** opens wallet-scoped private Templates data. No MST account registration or Passkey is required.
- After a confirmed submission, the Proposal offers one **View receipt** action. The Receipt's **Print or save PDF** action invokes browser printing.

## Permission model

| Action | Template owner (current Treasury signer) | Delegated proposer wallet | Treasury signer |
| --- | --- | --- | --- |
| Create single-recipient Template | Yes | No | Yes, on their own account |
| Grant/revoke proposer wallet | For own Template; must remain current Treasury signer | No | Only for Templates they own |
| Choose source, recipient, asset, signing window | When defining Template | Never | When defining their own Template |
| Fill amount and memo | Yes | Yes | Yes |
| Create a durable Request | Yes, existing signer flow | Only from a currently granted Template | Yes, existing signer flow |
| Ask/remind an eligible signer | Yes | For their own Request, only while grant remains valid | Yes, existing signer flow |
| Supply a valid Stellar signature | Only under live Stellar policy | No, unless wallet later becomes a real signer | Only under live Stellar policy |
| Submit from the MultiSigTools UI/API | Under ordinary Request execution rules | Not by proposer permission | Under ordinary Request execution rules |
| View active own Request and retained Activity/receipt | Yes | Yes | Yes, under existing participant rules |

**Grant is off-chain Request creation authority, never a Stellar signature or a
Treasury-wide approval.** A single current signer who owns a Template may grant
that Template's proposer permission; other Treasury signers still approve every
actual transaction on-chain. The UI must not call this person a Treasury administrator.

## State and immutable inputs

- `reusable_template_proposer_grants`: append-only grant history, with revocation timestamp and revoker.
- `classic_requests.proposer_address`: wallet that created a delegated Request; distinct from
  `creator_address`, which retains its signer meaning.
- `templateRef`: immutable Template/version reference attached to each delegated Request.
- Delegated `POST /api/request`: only `{ network, templatePayment: {
  template: { id, version }, amount, memo? } }` is accepted. **No arbitrary XDR.**
- Server re-verifies grant, owner signer status, version and fixed Template values, then calls
  the shared Classic payment preparation core to compute fresh fee/sequence/expiration and
  an unsigned exact XDR. The database transaction rechecks the grant under row lock.
- An expired, revoked, or superseded grant cannot create further Requests. Existing Requests
  and their receipts remain available to the original proposer wallet.
- Proposer's own Request is visible in their personal Inbox and Activity. It never appears
  as a requirement for their wallet to sign. If the wallet later becomes a real Stellar signer,
  **live Stellar policy** takes precedence for actual signer actions.
- Public/bearer private links are not minted for delegated creations. The copied signer link
  contains only a Request ID; only a current signer with a verified wallet can open it.
- A finished transaction can be broadcast outside the product if someone independently obtains
  the fully signed XDR; platform submission restrictions are not a network broadcast barrier.

## Acceptance — Testnet

1. Template owner creates a payment Template from a Treasury they can currently sign for,
   adds a non-signer G wallet, and can revoke that wallet.
2. The proposer logs in without XLM, enters amount/memo, reviews fixed source/recipient/asset,
   creates an active Request, invites eligible signers, and monitors it from Inbox.
3. Two authorized signers satisfy the live Stellar policy. The proposer cannot contribute
   a signature or use the product Submit operation, but can view confirmation and Activity.
4. A changed recipient, asset, source, Template version, network, unauthorized wallet,
   revoked grant, or removed Template-owner signer must fail closed.
5. Creation concurrent with revocation cannot persist a new Request after revocation commits.
   The original Request and audit facts are never deleted by revocation.

## Release order

1. Test and apply migration `0016_template_proposers.sql` to **Testnet** PostgreSQL while
   the previous backend is running; the schema change is backward-compatible.
2. Deploy Testnet backend and Testnet Web together with feature regression and wallet tests.
3. Run isolated Chromium QA, PostgreSQL grant/Request tests, and **real Testnet** signer and
   delegated-proposer end-to-end. Test no-contact-email and Resend delivery independently.
4. UI polish: non-signer journey, signer invite visibility, 320px/375px/1280px, contrast,
   transaction facts, empty/error states, privacy during wallet switches.
5. Public Testnet beta only after deployment health, real-wallet/real-email checks, and
   abuse/revocation assertions pass. Do **not** expose Mainnet.

## Out of scope — v1

Email/Passkey-only identity, Team Workspace, batch delegated payments, arbitrary XDR grants,
amount limits, template change editing, automatic submission, or changes to Stellar signer
weights and thresholds. Revisit these after observed real Testnet use.

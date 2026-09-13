# MultiSigTools Product Semantics

This file is the compact Human/AI product-language contract. It does not replace protocol, security, or API documentation. When product wording or display behavior conflicts with older narrative docs, use this file for the Human product model and then reconcile the older document.

## 1. Canonical objects and words

| Human product term | Internal / protocol term | Meaning |
| --- | --- | --- |
| Draft | local composer state | Mutable transaction intent before Review. Browser-local only. |
| Review | Review Handoff / Signing Room | Pre-freeze inspection of the exact Stellar transaction and private context. |
| Proposal | Signing Request | Durable collaboration object created at the freeze point for one exact Stellar transaction. Humans sign/share/submit the Proposal; APIs may continue to call it a Signing Request / Request. |
| Transaction | Stellar transaction / XDR | Exact Stellar payload. Submission/confirmation are ledger facts, not Proposal identity. |
| Treasury | Stellar account with shared signing control | Shared-signing resource. Its shared Treasury name is resource identity. |

A personal/single-signature source account in **Create treasury** does not become a Treasury resource until shared signing control is actually established on Stellar. Exiting that Prepare flow returns to the Treasury collection; it must not manufacture a Treasury resource-detail URL for the still-personal source account.
| Signer | current Stellar signer relationship | Address/key that currently participates in Treasury authorization. Signer is a role, not a separate personal identity namespace. |
| Contact | personally named Stellar address | Private address-book identity with no special authorization meaning. Recipient/destination is a transaction role and may be saved as a Contact. |
| Private Note | off-chain private Request context | Private plaintext associated with a Proposal. It is not part of Stellar XDR. |
| Private memo | Private Commitment plaintext | Private plaintext whose salted hash is committed in Stellar MEMO_HASH. |
| On-chain proof | Stellar MEMO_HASH | Public commitment to a Private memo. It is not the private plaintext itself. |
| Personal note | private Treasury label | User-private note for a Treasury. It never changes the shared Treasury name. |

Avoid exposing storage/implementation vocabulary such as `Box`, `Request store`, `private content`, `activityBound`, or lifecycle persistence mechanics in ordinary Human UI.

## 2. Human workflow and controller ownership

The canonical Human journey is:

```text
1 Prepare -> 2 Review -> 3 Sign -> 4 Submit -> 5 Done
```

Its domain projection is:

```text
Draft / Prepare
  mutable intent
    |
    v
Review
  inspect / edit-before-freeze
    |
    | Continue to signatures = freeze
    v
Proposal
  Sign: collect signatures
  Submit: quorum/execution/submission
    |
    v
Done
  Transaction Receipt + Activity = retained history / evidence
```

`Proposal` is an object spanning Sign and Submit, not a sixth step. `Transaction Receipt` and `Activity` are history/evidence views of Done, not workflow steps. See `UX_DESIGN_SYSTEM.md` for the shared progress and color presentation contract.

### Soroban authorization boundary

Soroban does not create a second Human workflow. `Prepare -> Review -> Sign -> Submit -> Done` remains canonical, but `InvokeHostFunction` introduces an authorization domain that is distinct from transaction-envelope signatures.

- transaction-envelope authorization remains source-account / extra-signer / fee-bump evidence;
- a Soroban authorization entry authorizes an invocation tree and may carry its own address-specific signature evidence;
- auth-entry signatures change the transaction body, so envelope signatures must be collected only after those entries are finalized;
- the current exact-XDR Proposal / Request must not treat a Soroban auth-entry signature as another decorated envelope signature.

During S2, supported G-account Soroban authorization is still owned by **Review**, before the durable Proposal exists. After an explicit configured RPC simulation, Review assembles execution resources, collects and cryptographically verifies any detached G-account auth-entry signatures against the current medium-threshold policy, then freezes one exact final XDR. Only that final XDR may enter the ordinary Proposal, where the existing Sign step collects transaction-envelope signatures. The Request service independently revalidates Soroban authorization and never trusts browser readiness. Proposal creation also performs a server-side `authMode=enforce` simulation of the exact frozen XDR; Submit repeats that enforce check before broadcasting. These two RPC calls belong to the Human's explicit Continue/Submit actions and must be disclosed because the RPC provider receives the exact XDR. S3A may inspect C-account/delegated authorization as contract/network-enforced evidence. S3B adds a pre-freeze core transport for adapter-supplied contract-defined `ScVal` credentials: Review owns an exact network/authorizer/invocation/expiration challenge, staging never implies local validity, and a custom credential must pass `authMode=enforce` **and be re-prepared from that enforcing simulation's resource output** before it can become a freeze candidate. S3C exposes that path only for one explicitly configured Simple Ed25519 contract-account adapter: Review discloses the exact C-address, configured owner G-address, and project-configured adapter provenance; the selected owner wallet signs the Review challenge; then enforce-and-reprepare must succeed before the ordinary Proposal boundary can receive the exact XDR. The Request service independently re-identifies the configured C-account and runs its own enforce verification before freeze. Unknown C-accounts, multiple detached contract authorizers, and delegated authorization remain inspect-only/fail-closed. A custom payload being present is not local proof of `__check_auth` validity. Simulation output is execution evidence, never a signature. See `SOROBAN_AUTHORIZATION.md`.

`Proposal` scope follows the exact Stellar transaction, not a single Treasury. One atomic transaction may contain operations from multiple source accounts controlled by independent entities, and each source account must satisfy its own authorization policy. The same Proposal may therefore appear in more than one Treasury/account projection. A future business `Party`/entity concept, if added, is a Human/organizational projection and must not replace source-account or signer evidence as the authorization truth.

Controller invariant:

- Composer owns Draft.
- Signing Room owns Review only.
- Proposal / Request owns every business transition after freeze until terminal state.
- Transaction Receipt and Activity are history/evidence projections; they do not resume signing workflow. Activity history rows are durable facts. `ready`, `blocked`, `stale`, and expiry remain Request-state projections derived from facts + evaluation time (and relevant ledger state), not audit events.
- Browser navigation/cache may preserve presentation, never create a second business-state owner.

Guided transaction templates may have different Prepare-time validation, but parsing/validation is an internal Prepare operation, not a Human workflow step. A valid guided draft goes directly to Review, where the user can return to Edit. All templates converge on the same Review/Proposal controller boundary. Batch payment, Claimable payment, and Multi-party transaction are Human task names; they do not create separate signing lifecycles. Batch parsing and Address Book/asset-name resolution are only input conveniences and must be deterministically resolved before XDR. Claimable payment leads with the recipient/recovery outcome rather than predicate vocabulary. Multi-party authorization remains source-account authorization, not a MultiSigTools-specific approval domain.

## 3. Personal workspace object model

The Sign workspace is signer-centric:

```text
Treasuries   resources this signer is related to
Signers      people/addresses participating in those Treasuries
Proposals    active collaboration
Activity     retained participation/history
Contacts     private address reuse utility
```

Contacts are useful but are not a fourth authorization domain. A destination can be named/saved as a Contact; if that address later becomes a signer, the same personal name follows the address.

From a Treasury relationship surface, the primary workflow action is **New proposal**, not “Open Treasury”. Resource administration remains in Manage / Treasury.

### Product user, participation, and Unlock

Ordinary signing has no registration or Treasury-creation prerequisite. A signer who verifiably participates in a Proposal is already a MultiSigTools user for the personal Sign layer.

- A cryptographically verified Proposal signature is a **participation fact** for that signer address. It should remain discoverable as that signer's participation/history even when the signer did not have a private workspace session at the moment the signature was added.
- Participation is not an authenticated private session. A signed XDR may be forwarded or become public, so a transaction signature must never be accepted as an Unlock/session credential by itself.
- **Unlock is short-lived proof for private surfaces, not onboarding, membership, or a transaction-workflow step.** It remains challenge-bound identity proof through the private-session protocol (SEP-53, with the defined fallback where needed).
- A user may sign first and Unlock later. When that signer later proves the same wallet identity, MultiSigTools can project the retained history that address is authorized to see.
- The product should minimize Unlock friction by performing necessary wallet confirmation inside the user's requested protected action and continuing that action after authorization. It should not weaken the private-history authorization boundary merely to remove a prompt.

## 4. Identity projection

### Treasury

```text
shared Treasury name + optional Personal note
  -> "Acme Treasury (Payroll)"
shared Treasury name only
  -> "Acme Treasury"
Personal note only
  -> "Payroll"
otherwise
  -> full/short G-address according to surface
```

The shared Treasury name always wins over a Personal note as resource identity.

### Signer / Contact

- Personal name is the reusable private identity.
- When an account's own G-address appears as signer evidence, render its role as **Account key**. A Treasury name may label that account, but it must not turn the signer into a synthetic `Treasury master key` identity. Reserve **Master key** for technical account-control surfaces that explicitly edit Stellar `masterWeight`. A Treasury Personal note is a resource annotation, not a signer name.
- A current-viewer action may render `You` instead of repeating the viewer address.
- Do not persist `You`; durable facts keep the verified G-address.

### Human Receipt versus portable evidence

The authorized **Transaction Receipt** page is a Human projection. It may enrich canonical Stellar identities with workspace/private metadata that the current viewer is authorized to see:

- shared Treasury name;
- Personal note using the normal `SharedName (Personal note)` resource convention;
- Address Book / signer names where appropriate;
- Private Note plaintext as clearly separated **private off-chain context**.

The default PDF is **Portable Evidence**, not a screenshot of the Human Receipt. Its input model is a separate projection containing only canonical/provable transaction and audit facts.

Portable evidence never contains Shared Name, Personal note, Address Book names, Private Note plaintext, or private memo opening data. Signer/account identity is the exact Stellar address plus factual role such as `Account key`. History uses the recorded exact `actorAddress`; only a genuinely missing actor may render `signer not recorded`.

A future export that deliberately includes private Human context must be a separately named explicit private-data artifact. It must not be implemented as a checkbox that feeds private metadata into the default evidence PDF.

## 5. Privacy and export vocabulary

| Data | Public on Stellar | Human Receipt | Portable evidence PDF |
| --- | ---: | ---: | ---: |
| Transaction facts / XDR facts | Yes / derivable | Yes | Yes |
| Exact account / signer addresses | Yes / derivable | Yes | Yes |
| Recorded audit actor address | No / retained audit fact | Yes | Yes |
| Shared Treasury name | No | Yes when authorized | No |
| Personal note / Address Book name | No | Yes for current viewer | No |
| Private Note plaintext | No | Yes when authorized | No |
| MEMO_HASH / on-chain proof | Yes | Yes | Yes |
| Private memo salt/opening details | No | Yes only in its authorized private disclosure | No |

`Private Note` is intentionally special: it belongs to the Human Receipt as private off-chain transaction context, must be visually separated from canonical evidence, and must never flow into the default portable-evidence projection.

## 6. Navigation, session preference, and history access

- Creating a Proposal with a verified private session may bind the creator to retained Activity immediately. That known access fact should survive the Review -> Proposal transition without waiting for a redundant reload.
- Active capability access and retained historical access are different. A private link alone must not silently become permanent historical authorization. `RequestParticipant` is retained relationship evidence, never a substitute for current Stellar signer authority or another active collaboration credential.
- **Save to Activity** is an explicit retained-history action while a Proposal is active. It requires a verified current signer, records the retained participant relationship, and grants no additional signing/submission authority. Merely opening an active Proposal with a current signer session does not create this relationship.
- An accepted signature contribution binds retained participation to the cryptographically attributed signer address(es), not to an unrelated browser session that happened to submit the signed XDR. Its short-lived contribution grant is a request-scoped fallback: it may add another cryptographically valid signed XDR and may broadcast the already-authorized ready transaction, but it does not authorize metadata changes, decline, or retained-history enrollment and never overrides a stronger live signer session. Historical signature evidence may later recover the same relationship without requiring that signer to still be current.
- Transaction Receipt is available after submission to viewers who already have retained history access. Terminal navigation must not point “Back to signing”.
- A finished Proposal must keep the **Transaction receipt** destination visible while private data is locked. Opening it is one Human action: MultiSigTools performs any required wallet confirmation, then continues to the Receipt. The confirmation never grants history by itself; the server still enforces retained-history eligibility.
- Inbox, Activity, and other private-history entry actions should follow the same rule: the user asks to open the destination, not to perform an implementation step called “Unlock”. Manual **Lock now** and a manual Unlock action remain explicit security/fallback controls in the wallet menu, not normal navigation prerequisites.
- The wallet/account menu is an identity/session surface. Its global preference is **Default unlock duration**, using the currently supported `15 min / 1 hour / 8 hours` choices; the initial default remains `1 hour`. The preference affects future Unlock requests, while the current session continues to show its exact expiry and **Lock now** remains immediate.
- **Default transaction lifetime** is transaction-composition policy, not identity/session policy. Its default control lives with **Prepare / New transaction**, where an individual transaction can still override it and optionally save the selected lifetime as the future default.
- Signature History is reconstructed from the signed XDR plus retained signer candidates captured with the Request. A verified private-session identity is useful provenance but is not required to identify an Ed25519 signature when the retained signer set can cryptographically verify it.

## 7. Regression questions

Before shipping a Human-facing change, check:

1. Did a canonical object get a second user-facing name?
2. Did a transaction role (recipient/source) accidentally become a permanent identity type?
3. Is Treasury identity shown as shared name first, Personal note second?
4. Did Review or History expose storage/lifecycle implementation language?
5. Did any portable-evidence projection accept Human/private metadata, or did Private Note stop being clearly separated as off-chain context?
6. Did navigation create a second workflow controller or lose a known access fact?
7. Does evidence keep raw/provable identities instead of guessing?
8. Did the UI turn Unlock into a prerequisite task instead of performing identity proof inside the protected action?
9. Did a transaction signature accidentally become a reusable private-session credential?
10. Did account/session UI absorb a transaction-composition preference, or vice versa?
11. Did a Proposal get incorrectly treated as belonging to one Treasury when its transaction has multiple independent source-account authorization domains?
12. Did a transient Request projection (`ready`, `blocked`, `stale`, expiry) get persisted or exported as if it were a durable Activity fact?
13. Did retained `RequestParticipant` evidence accidentally become active Request authority, or did active signer access silently manufacture retained history?

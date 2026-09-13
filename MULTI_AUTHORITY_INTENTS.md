# MultiSig Tools — Multi-Authority Intents and Advanced Team Evolution

Status: advanced product/architecture discussion; not current MVP scope
Date: 2026-08-30

This document records the product direction that emerged while discussing Private Memo, Activity, team coordination, and FedNetwork identity transfer.

The central conclusion is that MultiSig Tools may eventually coordinate more than payments or even more than Stellar transaction signatures. However, this should remain a progressive enhancement of the current product rather than a reason to build a generic workflow platform prematurely.

## 1. Progressive product shape

The current product remains useful at the simplest layer:

```text
Ordinary user
MultiSig Tool
-> create / review / sign / submit
```

A team layer can add durable coordination:

```text
Small team / treasury
-> Inbox / Waiting / Ready / Activity
-> Private Notes / Private Commitments
-> account-level views
-> shared context / audit / notifications
```

The advanced team layer is not limited to payments. Once the system can coordinate authenticated actors, immutable intent, authorization evidence, and Activity, the same machinery can support business decisions that are not ordinary payment transactions:

```text
Payment
Vote / governance decision
Identity transfer
Policy change
Whitelist / trusted-address change
Administrative change
Service authorization
Delegated action
```

The enterprise/API layer can later expose the same concepts through APIs, Agent integrations, KMS/HSM, organization policy, and audit interfaces.

Design rule:

> Keep the consumer surface narrow. Preserve the extension points underneath.

## 2. Threshold authorization is broader than transaction signing

Existing systems already demonstrate that multiple authorized actors may approve an artifact that is not itself a blockchain transaction.

Useful reference categories include:

- Safe off-chain messages: a Safe's owners can satisfy the Safe threshold over an arbitrary signed message rather than an Ethereum transaction.
- Snapshot / governance systems: participants sign votes or decisions off chain and a later process evaluates or executes the outcome.
- Fireblocks Admin Quorum: multiple administrators approve configuration/policy actions such as whitelisting, user changes, authorization-policy changes, or other administrative operations. The approvers need not be transaction-signing MPC key holders.
- TUF-style threshold signatures: multiple trusted keys authorize software metadata/releases rather than financial transactions.

These examples establish an important principle:

> Threshold authorization is a general security primitive. A transaction is one possible artifact being authorized.

MultiSig Tools should therefore keep approval/authorization evidence conceptually separate from the narrower concept of a Stellar transaction signature.

## 3. Advanced Team is more than Payment

A future Team/Workspace should not be defined as a shared payment inbox.

The more durable product concept is:

```text
Team
= a group of actors coordinating protected intents and their authorization evidence
```

Possible future intent classes include:

### Payment

```text
Send 18,000 USDC
Treasury authorization required
```

### Vote

```text
Proposal:
Adopt Vendor X for 2027 audit

Required authority:
2 of 3 treasury principals
```

This may produce a signed message / off-chain result rather than a Stellar transaction.

### Administrative policy change

```text
Add G... as approved vendor destination
Change spending policy
Add/remove workspace member
Change automation policy
```

The business action is not necessarily a Stellar transaction even though the actors may be identified or authenticated through Stellar identities.

### Identity transfer

```text
eno*fed.network
A -> B
```

This may require authorization from both the current controller and the receiving controller, plus FedNetwork policy checks.

The Team model should therefore not hard-code `team action == payment`.

## 4. Multi-authority request topology

Current Stellar multisig is usually:

```text
one subject
one authority domain
many signers
```

For example:

```text
Treasury Account A
Alice / Bob / Carol
2-of-3
```

A more general request may require multiple independent authority domains:

```text
Intent / Subject
      |
Authorization Plan
   /      |      \
Authority A Authority B Policy C
   |          |        |
Evidence   Evidence  Evidence
   \          |       /
       all satisfied
            |
         Execute
            |
         Activity
```

Do not flatten independent authority domains into one global signer count.

Example:

```text
Authority A
Alice weight 1
Bob   weight 1
threshold 2

Authority B
Carol weight 2
Dave  weight 1
threshold 2
```

The correct state is two independently evaluated requirements, not `3/4 signers`.

## 5. Candidate core vocabulary

Do not rename the Human product around this future abstraction yet.

The core should merely preserve room for a model such as:

```text
Request
  subject
  context
  authorization_requirements[]
  evidence[]
  execution
  activity[]
```

Meaning:

```text
subject
= what exact artifact or business intent is being authorized

authorization_requirements
= which independent authorities/policies must be satisfied

evidence
= signatures, signed messages, policy decisions, or other valid proofs collected so far

execution
= what happens after the required authorization is satisfied

activity
= append-only lifecycle/audit history
```

`AuthorizationEvidence` may eventually include different evidence types:

```text
Stellar transaction signature
Stellar signed message
SEP-10 / account-authority proof
workspace approval
Agent authorization
external policy result
```

These evidence types do not have equal authority. In particular:

```text
workspace approval != Stellar transaction authority
```

The authorization requirement decides which evidence type is valid for a particular action.

## 6. FedNetwork identity transfer as a future real-world test

FedNetwork is a strong candidate for the first external multi-authority use case.

Example:

```text
Identity: eno*fed.network
Current controller: Account A
New controller: Account B
```

### 6.1 Stellar-native version

One possible implementation is a FedNetwork-created Stellar transaction whose purpose is to gather consent from both accounts.

Conceptually:

```text
Transaction source:
  FedNetwork channel account C

Memo:
  MEMO_HASH = commitment to private transfer intent

Operations:
  source=A -> small consent/service-fee payment to FedNetwork
  source=B -> small consent/service-fee payment to FedNetwork
```

The private intent can contain a canonical payload such as:

```text
service: fed.network
action: identity_transfer
identity: eno*fed.network
from: Account A
to: Account B
claim_version: ...
transfer_nonce: ...
expires_at: ...
```

The private payload plus random salt is committed into `MEMO_HASH`.

MultiSig Tools can then deep-link the request and coordinate all signers required by Account A and Account B independently.

FedNetwork should normally keep its channel/source signature until the end so it remains a final execution gate:

```text
A authority satisfied
B authority satisfied
    -> FedNetwork final state/policy re-check
    -> FedNetwork signs
    -> submit
    -> wait for confirmation
    -> apply FedNetwork identity ownership transition
```

The post-confirmation FedNetwork update must be idempotent because Stellar confirmation and the service database update are not one atomic database transaction.

### 6.2 Authorization-level caveat

A small Payment operation normally exercises the source account's medium threshold, not necessarily high threshold.

Therefore a FedNetwork protocol using this transaction as proof must define explicitly what account authority level controls identity transfer.

Possible future policies:

```text
ordinary identity -> medium authority
high-security identity -> additional high-threshold proof
```

Do not imply that a medium-threshold consent operation proves high-threshold account authority.

### 6.3 Non-XDR alternative

Not every future business action should be forced onto Stellar merely to reuse transaction signing.

If an intent cannot be expressed safely and naturally as Stellar transaction semantics, MultiSig Tools may instead coordinate a canonical signed intent/message.

Decision guideline:

```text
Can the required authorization be represented safely as meaningful Stellar semantics?
  yes -> Stellar Transaction Request
  no  -> Signed Intent Request
```

Do not manufacture meaningless/no-op on-chain operations solely to force every business workflow into XDR.

## 7. Private context connects naturally to advanced intents

The three transaction-information models remain useful here:

```text
Stellar Memo
= public and on chain

Private Note
= private workflow context, not covered by Stellar transaction signatures

Private Commitment
= private context whose commitment is part of the signed Stellar transaction
```

For FedNetwork identity transfer, Private Commitment is especially natural because the public ledger need only carry a commitment while authorized participants see the actual identity-transfer intent.

This gives the Private Memo design a concrete business use case beyond ordinary payment notes:

> Private business intent committed into public authorization.

## 8. Activity generalizes with the same model

Activity should not be designed as a historical payment list.

It is the lifecycle history of a protected request/intent:

```text
created
context added/changed
authority requirement discovered
approval/signature added
requirement satisfied
all requirements satisfied
submitted / executed
confirmed
business action completed
failed / expired / invalidated
```

For a vote, Activity can record who contributed valid authorization and when the threshold result became final.

For an identity transfer, Activity can record both controller authorities, the private commitment, FedNetwork's final policy decision, the Stellar transaction, and the resulting identity-state transition.

For a policy change, Activity can record the old/new policy commitments and the administrative approvals that authorized the change.

This is why Activity belongs beneath the product-specific surface rather than being implemented as an Inbox archive.

## 9. Important identity/permission boundaries

Advanced Team must continue to distinguish:

```text
Actor
= who is currently using the system

Stellar Account
= on-chain resource / authority domain

On-chain signer
= key that may satisfy Stellar account authorization

Request participant
= actor allowed to inspect/act on one request

Workspace member
= actor allowed to access persistent team/workspace resources/history
```

Do not infer Workspace membership from the current Stellar signer list.

A newly added signer must not automatically gain all historical private business data merely because the key can now sign for the account.

Likewise, removing a signer from the Stellar account does not itself define the organization's historical retention/access policy.

## 10. Product restraint

This direction should not turn the current project into a generic BPM/workflow engine.

Current priority remains the useful Stellar multisig product.

The architecture should preserve multi-authority and non-transaction extension points, but the generalized abstraction should be promoted only after multiple real use cases prove it.

A practical rule:

> One real case may be a special case. Two materially different real cases justify a reusable abstraction.

FedNetwork identity transfer can be the first serious external test. A later, genuinely different case such as governance voting, administrative policy authorization, or another product integration can validate whether the abstraction should become a first-class platform API.

## 11. Product-level conclusion

The long-term Team direction is broader than a payment workspace:

```text
Team
  -> coordinate payments
  -> coordinate votes
  -> coordinate identity/control changes
  -> coordinate administrative decisions
  -> coordinate API/Agent actions
```

But the ordinary user should still experience a simple multisig tool.

The progression remains:

```text
simple multisig
    -> durable coordination / Activity / private context
    -> advanced Team intents
    -> programmable multi-authority API
```

Possible internal architectural description:

> MultiSigTools may evolve from a transaction multisig tool into a multi-authority coordination system, while keeping transaction signing as its simplest and most important entry point.

Do not use this broader architecture language as ordinary-user marketing until the product has real use cases that justify it.
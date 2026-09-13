# MultiSigTools Proposal Lifecycle

**Status:** product and authorization contract  
**Date:** 2026-09-01

A Signing Request is a proposal presented to one or more Stellar signers. The proposal has one freeze boundary: entering the signing stage.

## Lifecycle

```text
Compose / Review
  private context may be edited
        |
        | Continue to signatures
        v
Proposal frozen / Signing Request created
        |
        +-- signer approves -> Stellar signature
        |
        +-- signer declines -> off-chain collaboration event
        |
        v
Ready / Submitted / Expired
```

### Before the freeze boundary

The person preparing a proposal may edit its Private Note while composing and reviewing it. If the proposal uses Private Commitment, the transaction must be rebuilt when the committed context changes because the commitment is part of the XDR.

### After the freeze boundary

Private proposal context is immutable. Private Note and Private Commitment therefore have the same product lifecycle even though only Private Commitment is cryptographically bound to the Stellar transaction.

A typo or changed business reason is corrected by creating a replacement proposal. MultiSigTools must not rewrite the context that signers were originally asked to review.

## Signer decisions

A current verified signer may either approve or decline an awaiting-signatures proposal.

**Approve** contributes a Stellar transaction signature and may satisfy Stellar authorization.

**Decline** records an append-only `approval_declined` collaboration event. It does not:

- add Stellar authorization;
- cancel or mutate the transaction;
- reduce the Stellar approval threshold;
- make the Request expire early;
- become a vote toward a rejection quorum.

Other signers may continue to approve the same Request after a decline. A signer who declined may later approve; both historical facts remain visible. Once a signer has approved, that signer cannot subsequently record a decline for the same proposal.

The Request remains open until it is replaced, submitted, becomes otherwise invalid, or reaches normal expiry.

### Human Treasury UI

Human signer action language is **Sign / Signed**. `Approve` remains a protocol/domain verb for the collaboration record and approval policy, but it must not become a second Human action label for the same signature.

The decline event remains a protocol and audit capability, but the v1 Human Treasury signing flow does **not** show a Decline action. Until a decline has terminal or policy semantics, exposing a button that does not change the Request lifecycle adds signer decision complexity without changing execution. Human signing therefore stays centered on **Sign** and **Ask someone to sign**.

## Not VoteBox

Treasury Request decisions are transaction-coordination signals, not governance votes. MultiSigTools must not infer rules such as "2 of 3 declines rejects the proposal" from Treasury signer thresholds.

If a future product needs ballots, rejection quorum, proposals that pass/fail by vote, delegation, or governance policy, that belongs in a separate VoteBox/GovernanceBox model rather than overloading Stellar transaction authorization.

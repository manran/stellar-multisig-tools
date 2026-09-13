# MultiSig Tools — Workspace Emergence and Activity Scopes

Status: product/architecture decision baseline
Date: 2026-08-30

This document defines when a Team Workspace should appear and how Activity evolves without forcing team concepts into the ordinary multisig product.

## 1. Progressive rule

Workspace is a Team-layer concept, not a prerequisite for ordinary multisig use.

The product should evolve progressively:

```text
Ordinary user
-> signer-centric work
-> My / Signer Activity

Account operator
-> account-centric inspection
-> Account Activity visible to the current actor

Team
-> explicit Workspace
-> shared Workspace Activity
-> shared private context / members / roles / retention

Enterprise
-> policy / auditor / API / KMS / SSO / retention extensions
```

Do not auto-create or expose a Workspace merely because a Stellar account has multiple signers.

A Stellar multisig account is not automatically a Team.

## 2. Three Activity scopes

### 2.1 Signer Activity

Actor-centric.

Answers:

> What requests, approvals, signatures, submissions, and related events have I participated in or been authorized to view?

The actor is the currently authenticated identity.

This scope can exist in the ordinary Sign product without any Team object.

### 2.2 Account Activity

Resource-centric projection.

Answers:

> What activity involving this Stellar Account can the current actor already see?

Account Activity does not itself grant additional read access.

It is a projection of requests/events already visible to the current actor and associated with the selected account.

Therefore:

```text
being a current Stellar signer
!= automatic right to all historical private Account Activity
```

Adding a new signer must not silently reveal old payroll notes, invoices, private request history, or other retained private context.

Removing a signer does not by itself define historical retention/access semantics either. Those remain product access-policy decisions.

### 2.3 Workspace Activity

Team-centric and persistent.

Workspace Activity appears only when the user deliberately adopts Team capabilities.

It may combine:

```text
Stellar transaction activity
non-Stellar signed intents
private notes / private commitments
approvals / signatures / policy decisions
votes
identity transfers
administrative actions
API / Agent actions
execution outcomes
```

Workspace Activity answers:

> What has this team coordinated, authorized, decided, and executed over time?

This is the first level where shared retained history is itself a first-class product resource rather than a projection of one actor's existing access.

## 3. Workspace is not a Stellar Account

Preserve these distinctions:

```text
Actor
= a Human / Agent / service identity acting now

Stellar Account
= an on-chain resource with signers, weights, thresholds, balances, and operations

Workspace
= an off-chain collaboration/access/retention domain
```

A Workspace may coordinate one or multiple Stellar accounts and may also contain non-Stellar intents.

Stellar signer authority and Workspace membership remain separate:

```text
On-chain signer
= can satisfy Stellar authorization requirements

Request participant
= retained evidence of one Request relationship/history association; active actions still require the Request's current access policy

Workspace member
= can access persistent Team resources according to Workspace policy
```

Never derive Workspace membership automatically from the current Stellar signer list.

## 4. Why Workspace begins with Team

Before Team, the product can remain simple:

```text
Sign
-> New / Inbox / Waiting / Ready / Activity

Manage
-> Accounts
   -> Account overview / signing configuration / Activity
```

The ordinary user does not need to understand organizations, memberships, roles, retention, or shared audit history.

A Workspace becomes justified only when the product needs persistent shared capabilities such as:

```text
shared Activity
shared Private Notes / private context
persistent team history
members / roles
auditor access
shared address book
votes / signed intents
policies
API credentials / Agent integrations
retention / disclosure controls
```

This is a product boundary, not merely a pricing boundary.

## 5. Team Activity is broader than transaction history

Team must not be defined as "multiple people making payments".

A Team may coordinate:

```text
Payment
Account-control transaction
Batch transaction
Vote
Identity transfer
Policy change
Whitelist / admin action
Signed business intent
Agent/API action
```

Some actions produce Stellar XDR and on-chain execution.

Others may produce signed messages, threshold attestations, policy decisions, or service-side execution.

Workspace Activity must therefore be based on shared Activity/Event semantics rather than only Horizon transaction history.

## 6. Relationship to multi-authority intents

A Workspace is not itself the authorization rule.

A request may still require one or multiple independent authority domains:

```text
Intent
  -> Authorization Requirement A
  -> Authorization Requirement B
  -> Policy Requirement C
```

Workspace membership determines collaboration/read capabilities. The Authorization Plan determines what evidence is required to satisfy the specific intent.

This separation matters for cases such as:

- FedNetwork identity transfer between two independently controlled accounts;
- a vote by Workspace members that does not alter Stellar state;
- a Stellar transaction requiring multiple operation-source authorities;
- an enterprise policy action requiring administrators but no Stellar signer.

## 7. Current implementation rule

Do not implement Workspace merely to prepare for future Team functionality.

For the current product:

- retain signer-centric Activity as the natural personal layer;
- allow account-centric Activity as an authorized projection;
- keep private-history access independent from live Stellar signer membership;
- keep the domain/event model capable of later adding `workspace_id` / Workspace access policy without requiring every current request to belong to a Workspace.

The Team release is the appropriate point to introduce Workspace explicitly.

Design principle:

> Personal first, account projection second, shared Workspace only when collaboration becomes persistent.

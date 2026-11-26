---
title: Testnet round two feedback
description: Repair evidence and outstanding acceptance for the independent review of 2026-11-26.
---

Base: 418c81e (local deployed-line ancestry; origin/main was behind). Work only in a separate branch. No Mainnet changes or migrations.

## Repaired in code

- A2: cancellation requires resolution of every released execution hash, checked inside the Postgres parent lock; Agent/Integration actions and Human UI no longer offer cancel while unresolved. Historical import preserves legacy facts. Historical cancelled-then-completed signer access is not yet repaired.
- A7: invalid Activity cursor or view returns 400.
- A13: the SDK's missing live contract-instance result maps to contract_not_found (404); other RPC failures remain 502.
- A14/U8: stale Classic Requests no longer fill signer Inbox; external execution with unresolved evidence remains visible.
- U1/D6: Testnet legal content stays on the accessible Testnet origin; remove inaccessible Mainnet landing link and document Mainnet availability.
- U3/U10: display full review addresses and wrap long Soroban invocation/event values. Real mobile acceptance pending.
- U4: emit the canonical hash locator and accept valid legacy public request IDs from query strings; never read a capability from the query.
- U11: describe shared account coordination instead of deployment architecture.
- U12: preselect self-managed execution when the selected scope requires unavailable managed resources.
- D3/D4/D8: native Testnet SAC example uses 10000000 stroops for 1 XLM; explain unique service ID.
- S5: stable short transport operationIds; logical operationIds unchanged. Generated clients must regenerate when adopting the new transport names.

## Partial or design decision

- A1: closed OpenAPI schemas reject unknown input fields in payment, account creation and Intent creation (including nested payment fields); other body operations still need coverage.
- A3: current unsigned declines are visible in GET Request coordination; weighted quorum projection, Agent provenance and UI follow-up remain.
- A4: existing deliberate Human preparation policy documented; Agent creation is signer-scoped. Creation does not grant authorization.
- A5: execution task requiredInputs identifies executor; other names and errors remain.
- A11/U2: exact XDR-derived invocation summary on inspect and Human review; native XLM amounts formatted exactly. Generic ABI labels, token precision and Activity/Inbox summaries remain.
- S1: add Human bearer/session security alternatives to shared Principal operations; MSA-only Treasuries unchanged. Capability-specific logical coverage remains.
- D1: document detached AUTH hash/signature construction; runnable JS/Python examples and preimage API field remain.
- D12: unify quickstart credential variable; other points remain.
- U5: explain prepared but possibly unsigned transaction, show validity deadline; same-hash review resumption remains.

## Outstanding

A6, A8, A9, A10, A12, A15; S2, S3, S4, S6, S7; D2, D5, D7, D9, D10, D11, D13; U6, U7, U9, U13, U14, plus the partial items above. Do not call the review closed or claim independent acceptance.

## Verification

995 regular automated tests and 41 disposable Postgres tests passed. Historical import, unresolved cancellation, nested input typo rejection, missing contract vs RPC failure and native XLM amount projection covered. Database tests use isolated disposable storage only. Actual Testnet transaction replay, desktop/mobile browser acceptance and deployment remain open.



## Second repair batch

Base: GitHub 1878bb83c200348718836b12c5b6aaaaf30f302e (tree identical to local ce2c9f9).

- A1: extended the shared closed-schema field check to all documented request-body routes. Resolve referenced oneOf branches and validate nested objects; preserve existing authorization and action-specific value checks. Include actual Human template and assignment/reminder request fields. Generic ABI arguments and explicitly open private context remain subject to their service validators.
- A5/A6: executor, amount type, lifetime, serviceId, invalid decision and contract query errors now identify the requested input. Existing codes retained except the new invalid_proposal_decision. Network-specific and structured field diagnostics remain open.
- S3: registry and OpenAPI now describe session status and cookie logout, including optional Human authentication; document that logout does not revoke bearer tokens. S4: logical operation summaries added; comprehensive examples and field descriptions remain open.
- U9: pairing approval uses the existing permission descriptions, flags Sign scope, displays expiry, explains the two distinct signatures, and no longer claims a pending request when preview fails. Browser acceptance pending.

Verification: 997/997 regular tests passed, including the referenced-union, nested input and HTTP-boundary regressions. API and Web builds passed. Remaining review items are still open, including weighted refusal handling, historical receipt snapshots and resumable Soroban signing.


## Third repair batch: shared lifecycle and exact recovery

Base: 9a3012ca60375ea79e00ea05ee97d5da4017e0dd (previous reviewed GitHub repair branch).

- A2: historical confirmed Intent read access includes recorded AUTH contributors, even when cancellation or a later signer-policy change would prevent live signing access. Receipt-only access exposes no reusable AUTH entries and does not grant write access. Actual route regression covers a cancelled-then-confirmed record and an unrelated caller.
- A3: Request snapshot is the single source of current unsigned refusal decisions. Remaining signer weight is evaluated against each current authorization check and mandatory extra signers, using a conservative upper bound for other signer mechanisms. An unreachable quorum is reversible: `awaiting_signatures` / `quorum_unreachable`, not a terminal cancellation. Human Inbox, Agent tasks and Integration Request reads share the same result. Agent decline provenance is recorded.
- U5: the exact released Soroban execution package is persisted atomically with its preparation. The original preparing signer or owning Integration can resume that same unresolved unexpired package with unchanged ready authorization. No new hash, simulation, sequence or submission occurs. Human review, Agent task and Integration job expose the recovery action. Old packages without stored XDR, expired packages and unresolved multiple hashes still require reconciliation.
- U6: persist the source-account signing policy at proposal creation, not at receipt viewing. New receipts distinguish the creation snapshot from live execution authorization. Old submitted records without a snapshot explicitly report unavailable policy and render encoded transaction evidence rather than today's weights.
- U14 (partial): avoid requesting a private transaction receipt before wallet authentication.
- Additive PostgreSQL migration 0023 adds nullable policy snapshots and released execution packages. No fabricated historical backfill. Apply only during a coordinated Testnet deployment before running the new API.

Verification: 999/999 regular tests, 42/42 disposable PostgreSQL tests, API and Web builds passed. The regression exercises unequal signer weights, reversible refusal, immutable policy snapshots, exact execution replay, rejection of unrelated/expired/resolved recovery and historical contributor receipt access. Database tests verify stored package recovery without listing raw XDR. Real Testnet replay, mobile/browser review and deployment remain open. The original outstanding review items not addressed above remain open; do not claim independent acceptance.

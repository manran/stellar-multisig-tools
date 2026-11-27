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

## Fourth repair batch: Integration job contract and public discovery

Base: b3e3912204b1845f2c85658f907f865ac2c54281.

- A8: authenticated owning Integration configuration is available through integration-execution. Reuse the redacted profile projection; no secret recovery, self-rotation or privilege expansion.
- A9: Classic Integration creation/inspection/submission exposes a job with review URL, exact transaction identity, state and next actions. Unknown external outcomes retain reconciliation; waiting preconditions remain distinct from authorization.
- A10: optional first-page live pending totals across Request and Intent; bounded to 500, with a lower bound rather than an invented exact count above the cap.
- A12/S7: public discovery revision 1.1.0, registry and OpenAPI self-discovery, ETag/conditional GET, HEAD, gzip in Node and request identifiers. No public caching of private state; no HEAD fallback to private reconciliation handlers. Rate-limit headers and deployed edge verification remain open.
- A15: explicit web stellar.toml rewrite, favicon alias, robots and missing-static-resource handling; verify on deployed origins.
- S1: logical Request capability alternatives for actual inspect/contribute/submit operations. S4/S7: shared revision, tags and operation descriptions; comprehensive examples and naming cleanup remain open.
- D1: Principal-scoped pending preimage challenges and Node/Python signing examples. D9/D10/D11 partly improved through execution-profile and job inspection docs.
- U13/U14 partial: contrast adjustments, skip link, empty contacts wording, route reset, unknown workspace route, metadata and static asset caching. Browser/axe/mobile acceptance remains open.

Remaining work: comprehensive structured input diagnostics, error-code catalogue, ABI-aware summaries/precision, webhook and end-to-end integration docs, accessibility/browser and full independent Testnet acceptance. This is not a closure of all 49 feedback items. No new migrations or deployment in this batch.


## Fifth repair batch: error contracts, integration documentation and wallet interaction

Base: 63eafb238c359de65cfb06c56728205d4ceeec51.

- A6/S2: shared structured field diagnostics for common validation errors and a generated OpenAPI error catalogue of 349 statically identified and explicitly enumerated codes, including HTTP status and caller action. A regression checks catalogue drift. Dynamically produced provider errors are not claimed to be exhaustive.
- D2/D5/D7/D9/D10/D11/D12/D13: publish Soroban execution and reconciliation, browser capabilities, Classic creation, Webhook registration and signature verification, retry schedules, integration modes, operation terminology, state and error reference, and version history. Add links to the root Directory and both llms.txt files. Webhook payload schemas are included in OpenAPI.
- A11/U2: derive compact Inbox, Dashboard and Activity titles from the stored invocation; display exact native XLM amounts and use a generic method title for other contracts. Do not infer non-native asset decimals or symbols.
- U7/U14: keep Wallet Kit inside a native focus-contained dialog with accessible selection, Escape handling and focus return. Preserve existing wallet icon CSP rather than expand its trusted origins. Add header theme toggle, require a successful contract load before save/new call, sort contract workspace methods, and normalize payment amount whitespace with explicit decimal separator guidance.

Verification: 1008/1008 regular tests passed, API/Core/Web/Directory builds passed, and the independent documentation build passed. No new database migrations. No deployment, external transaction replay, real-wallet/browser/mobile or axe acceptance claimed.

Outstanding: comprehensive per-operation OpenAPI examples, generic ABI-aware summaries and non-native token precision, deployed edge/rate-limit behavior, remaining form/accessibility details and full independent Testnet acceptance. Existing wire names remain compatible rather than being silently renamed. This batch does not close all 49 original findings.

## Hosted acceptance and receipt correction

- Deployed Testnet Web and the public Directory from `4b5b7ecaaa1a03de35bc8e7c1fbe9b55967a433c`. The API was upgraded after backup and additive migration 0023. The latest API and public developer documentation use `37b20ad7c69d64c2c9f63b73821b025727b87e6a` (local tree `c98e11c545d29149ef0d89f84e5de6d5489c683e`); Web and Directory source did not change in that correction. Fixed a stale docs alias and the Directory deployment's build/output configuration. Mainnet remained unchanged.
- Hosted OpenAPI 1.1.0 exposes 62 logical operations and 349 error codes. Discovery supports gzip, ETag, HEAD and conditional GET (304). Missing contract returns JSON 404. Testnet legal pages, stellar.toml, robots.txt, missing sitemap and the Directory's Testnet link verified at public origins.
- Classic: 40 live checks passed, including scoped MSI/MSA discovery, two independent signer contributions, external submission, response-loss recovery, durable non-inclusion and credential revocation. Request ETMS5AXKYZJRDWKY, ledger 5937273, transaction 724647aa8101d95761a7cd59bcf31f571487e933280cdfbec664c99734f7db8f. Never-submitted Request FHE3VHMVS9CEEEJE has a verified non-inclusion proof.
- Soroban: 20 live checks passed using the reusable `--live --soroban` QA path. Two Agents found their AUTH in Inbox, signed the documented preimage, resumed the same XDR/sequence/hash, verified unresolved cancellation guard, submitted 0.5 XLM between disposable Testnet accounts, reconciled, replayed the canonical receipt, and read historical contributor evidence without reusable AUTH. Intent J8KWM8S6NQYEP6YA, ledger 5937360, transaction 9ad9e9eb293dd21b6125f23d8151a39bbd6845ba35eb79a764caa8842319f5fa. Test signer credentials revoked.
- Live acceptance identified two defects not caught by fixture tests: SDK Uint8Array signatures and hashes need Buffer.from before base64/hex conversion (developer examples corrected), and first Soroban observation returned Horizon's timestamp formatting while replay returned PostgreSQL's normalized timestamp. The service now returns the persisted observation; regression and live replay both pass.
- Final regular tests 1009/1009 and disposable PostgreSQL tests 42/42 passed; full builds passed. Browser fixture regression 104/104 passed on the unchanged Web source. Logs and screenshots are retained under /opt/MST/release/round2-acceptance-20261126/evidence.

Remaining: independent black-box reviewer acceptance, real wallet extension/accessibility audit (including axe), complete per-operation examples, non-native token metadata against a deployed token, and remaining minor UX/formatting suggestions. Rate-limit header logic is tested locally but the public ingress was not deliberately exhausted. The independent JSON Schema Python harness could not be rerun on this host because jsonschema is absent. Do not represent this as independent closure of all 49 items. No Mainnet release or merge into main.

## November 27 acceptance extension

- API revision 1.1.1: added illustrative requests, success responses and parameters for all 62 logical operations, including the browser Origin requirement. Ajv validates 174 examples against the exported JSON Schema; all passed. Illustrative values are not executable credentials or ledger evidence.
- Non-native Soroban: 22 live checks passed. Issued QATEST on Testnet, verified contract-reported 7 decimals, raw 5000000 = 0.5 QATEST and current ABI names, completed two-Agent 2-of-3 authorization and exact-package execution, replayed receipt, revoked test credentials. Intent 01CAPAKBEX8Q763W, ledger 5944663, transaction 36fdcb0369ab1d3f0b96b5ba8a751167d8024a0ab2f6547d09717d8b2159057a.
- Added repeatable axe/viewport/theme filters and non-native Soroban review/cancel scenarios. Light browser regression 35/35, dark 78/78; additional Intent scenarios 6/6. Across 123 audited fixture snapshots, zero axe violations. This is automated coverage, not a full manual WCAG audit.
- Public wallet chooser probe exposed hashed Twind classes that bypassed the prior keyboard enhancement. Match the pinned Kit's clickable wallet/account rows structurally, preserve valid semantics, and restore focus after the busy state clears. Production-built local browser: 4/4 viewport/theme combinations, 15/15 wallet choices reachable, Escape and focus restoration passed; zero axe violations, two color-contrast checks incomplete in each desktop theme. This checks the real chooser, not wallet-extension signing.
- 1010/1010 regular tests and full builds passed; no additional migration required. Artifacts in /opt/MST/release/round2-acceptance-20261126/evidence.
- Outstanding: independent third-party black-box acceptance, current-version real wallet-extension signing (official extension absent on SAINT), incomplete manual accessibility checks, prior standalone Python evidence harness and residual minor UI wording/performance suggestions. No Mainnet changes or merge. Do not mark the independent report fully closed on self-tested evidence.

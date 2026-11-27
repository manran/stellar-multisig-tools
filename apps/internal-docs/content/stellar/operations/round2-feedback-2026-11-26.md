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

## November 27 final hosted verification

Deployed source revision `5680d2148f01c61b02635d376dc7932bf74af29f` (tree `146e395c7d72e677d670c7cef9f6240f8b54d853`) on Testnet API, Web and public Docs. Public OpenAPI 1.1.1 exposes 62 logical operations, with 174 validated examples. No product code or database changes in this verification commit.

- Official Varial Wallet 5.53.1, Manifest V3, Chrome Web Store ID `bcacfldlkkdogcmkkibnjlakofdplcbk`. Retrieved the CRX via the official Google update service; verified the CRX3 developer signature and matching extension ID before unpacking. Package SHA-256: `a676c4e52e49fc50eebfb7ca16d7be5ce9a757327b31d292d03d1c0dd89a5447`.
- **Real browser extension Classic E2E passed.** Two separate disposable wallets connected and authenticated, first signer rejected a real transaction prompt (same hash, zero signatures, no raw rejection message), retried successfully, second signer reviewed and approved, the Request reached ready with two signatures, and MST submitted the same transaction. Request `K330HGDVDY84R0XB`, Testnet ledger 5947147, transaction `2c11b309559ecc79d2b0cefce0d69ba47645ca6026677492187436a42dae480e`. Independently queried Horizon: successful, exactly one native payment, amount 0.0500000 XLM. Temporary profiles were removed. Earlier attempts exposed outdated automation assumptions (mandatory reconfirmation, obsolete Signed button, fixed-delay recipient review); those were corrected in the QA script, not by changing signing rules or production code.
- Public wallet chooser: four viewport/theme combinations, all 15 options keyboard-reachable, focus restoration and Escape passed, zero axe violations. Reviewed the two incomplete desktop contrast findings in both themes using real screenshots and computed styles: Wallets Kit attribution and link are visible, foreground RGB(22,22,25) over RGB(252,252,252), calculated contrast 17.60:1. Axe could not determine the background because of the overlaid footer; this is not a claim of a complete screen-reader audit.
- Standalone Python JSON Schema evidence validator: **113/113 positive/negative cases passed**, using isolated Python and jsonschema 4.25.1 against the deployed 1.1.1 document. Read-only public Integration discovery also passed.
- Evidence on SAINT: `/opt/MST/release/round2-acceptance-20261126/evidence/varial-5.53.1-live.log`, `python-evidence-schema-1.1.1.log`, `contrast-incomplete-details.json`, `contrast-light.png`, `contrast-dark.png`, and `hosted-discovery-1.1.1.log`.

### Scope remaining for independent review

The original review's concrete high-priority findings have repair and internal regression evidence. The current independent reviewer has not yet rerun its own 49-item suite. Do not substitute this maintainer-run evidence for independent acceptance. Preserved compatibility choices include existing wire field names and the operator-managed Integration Profile lifecycle; optional improvements such as rendered API reference, more uniform UI date/amount terminology, and initial-load bundle optimization are not claimed complete. Real hardware wallets and screen readers remain outside this automated acceptance. Real-extension Soroban AUTH signing is now verified separately below. No Mainnet changes or merge into main.

### Real-extension Soroban verification (November 27)

- Reused the previously verified official Varial Wallet 5.53.1 package and isolated Chromium profiles, with two disposable Testnet signers and a 2-of-2 Treasury. Created a Human Intent for a native SAC transfer of 0.5 XLM. Both review pages showed the actual transfer summary. Rejected the first real AUTH prompt: contribution count remained zero and the authorization plan digest did not change. Retried, then approved independently from the second wallet; the required weight reached two only after both signatures.
- Prepared execution with the second wallet as executor, left before signing, reopened the Intent, and resumed. XDR, transaction hash, sequence and expiry were identical. Created a Proposal for that same envelope; the real extension provided the final envelope signature and MST submitted it. Independently verified the successful Soroban RPC result, exact 0.5 XLM recipient balance increase, matching MST reconciliation and both contributors' confirmed historical UI without reusable AUTH. Horizon independently confirmed success at ledger 5947299.
- Intent `8WS581CQS669HXAQ`, final Request `5M30YRJX7X2Z2PMY`, transaction `0513eb9f0ec7b05e91aadfe88c5f352b9f9fb5989e26cdf034dcfd1238823b5d`. Evidence: `/opt/MST/release/round2-acceptance-20261126/evidence/varial-5.53.1-soroban-live.log`. First run was a QA-only title mismatch (`Transfer` vs `Send`); no product change was required. Temporary wallet profiles removed. No Mainnet interaction.

### UI polish and cold-load optimization (November 27)

- Split private/workspace routes and the connected dashboard into on-demand chunks. Keep the public landing eager. Restore remembered wallet selections on startup, but do not initialize Wallet Kit or the Stellar SDK for a new disconnected visitor. Preserve the existing session, signature, and deployment-network checks. Failed chunk loads expose an explicit reload action rather than automatically restarting a signing workflow.
- Standardize amounts (group integer digits, remove redundant fractional zeros without floating-point conversion), display timestamps in UTC, distinguish required approval power from signer weight, and use Contacts as the page title. Display changes do not alter XDR, raw receipt data, or wire names.
- Link back to the saved payment/create-account draft from the Review step only, before Request creation. Integration setup uses the existing header, inline identity/Webhook validation, readable method documentation, and unavailable-executor controls. The one-time credential display remains separate.
- Baseline: three cold mobile Chromium visits to hosted Testnet, 4x CPU slowdown, cache disabled: 1,558,395 decoded JS bytes, 422,779 encoded JS bytes, eight JS requests. Local production build: 280,281 decoded JS bytes, 86,487 encoded JS bytes, one JS request, no page errors or horizontal overflow. Local and hosted paint timing are not directly comparable. The repeatable cold-load guard budgets 350,000 decoded JS bytes and at most two JS requests.
- 1,013/1,013 regular tests passed with the normal test environment. Testnet Web production build passed. Local production wallet chooser passed four viewport/theme combinations, 15/15 keyboard-reachable choices with Escape and focus restoration. Final hosted measurements are recorded separately from local build results.
- No API, database, or Mainnet change. Independent reviewer, physical Ledger/Trezor, and full screen-reader acceptance remain separate.

- Hosted Web revision f4235a63369faac4dcccb3a84ee20e7b06761793 is READY on Testnet. Three equivalent cold mobile visits: 280,330 decoded bytes, 88,956 encoded bytes, one JavaScript request; median FCP 216 ms (previous 336 ms, three samples, not a latency guarantee). Hashed asset cache remains immutable. Final browser fixtures 109/109; hosted chooser four viewport/theme combinations, 15/15 choices reachable and zero axe violations (two desktop attribution contrast checks incomplete, as previously documented). Hosted Integration identity-validation checks passed at 375 and 1280 px.
- Real Varial 5.53.1 Soroban regression on the new Web passed, including two fresh wallet sessions, rejected AUTH, two AUTH signatures, exact-envelope resume and execution. Intent CCPJTKMW6ECDY9QE, Request 0RW88TZE989BDMB2, transaction 64717dd40c846e0b38586ba5778481aff97f3fa48906120dbceb94f4d1616817, ledger 5948190, 0.5 XLM. Evidence: perf-hosted-before.json, perf-hosted-after.json, perf-final-fixtures/report.json, perf-hosted-chooser/wallet-chooser.json, perf-wizard-hosted.log and varial-perf-soroban.log under the round-two SAINT evidence directory.

### Human time display (November 27)

- Working views default to browser-local time with the offset at each timestamp (including daylight-saving transitions). Clicking a timezone label switches the working views between local time and UTC; the browser remembers the preference and synchronizes it across tabs. Hover or keyboard focus exposes both complete timestamps. Recent personal Activity and Inbox events use relative labels in local mode; UTC mode shows absolute time.
- Overview, Inbox and Proposal show the service-provided signing deadline, not merely the XDR envelope maximum time. Transaction review displays the envelope validity separately. Remaining time is an estimate from the device clock, updated through one shared local timer; a passed estimate says to check current status, never changes the authoritative server/ledger status. Soroban AUTH expiration remains a ledger number.
- Receipt/PDF, Treasury audit, security audit and operator delivery logs retain UTC. All protocol timestamps, expiry logic, API schemas and webhook payloads are unchanged.
- 1015/1015 unit tests, full build and 111/111 browser fixture regressions passed. Targeted light and dark audits at 375/1280 px cover Tokyo and Kolkata timezones, refresh persistence, keyboard focus, unchanged UTC audit evidence, skewed clock, no additional requests on timezone toggle, and the existing proposal submission/receipt flow. No axe violations in the targeted screenshots. Unit coverage includes DST and date rollover. No fresh on-chain payment was required for this display-only change.

## Horizontal review follow-up — 2026-11-27

- S1: logical contracts preserve the selected-wallet header for Human access; Agent/Integration creation still requires idempotency keys. Checked all applicable logical contracts.
- A3: refusal and unreachable quorum expose optional reviewed reconsideration without a mandatory signature demand or Inbox action count. Shared projection preserves credential scope.
- A14/U8: expired, stale or blocked external Classic work with unknown execution remains discoverable to authorized signers. No signing action or replacement is offered; owning Integration reconciles the original hash. Proven terminal evidence removes it from pending work.
- A5: reconcile actions supply the unique unresolved Soroban hash or explicitly require a hash selection; signature contribution actions identify missing inputs. Contract tests compare Agent action defaults and required fields with logical schemas.
- A7: unsupported Request view and account/view combinations reject with structured 400.
- A11/U2: optional observed token precision and symbol are stored once for new non-native transfer Intents (migration 0024). All summaries derive raw data from the exact invocation and label the observation ledger. Older Intents without observations stay generic; no fabricated historical backfill. Metadata is advisory and never changes authorization.
- Legacy cancellation with unresolved Soroban execution preserves reconciliation rather than presenting it as a completed cancellation.

Verification: 1022 regular automated tests, 42 disposable PostgreSQL tests, 111 browser fixture checks, 186 OpenAPI example/parameter checks, and application builds passed. Independent black-box acceptance, real wallet/accessibility review and previously outstanding minor documentation/UX suggestions are not thereby closed. Only Testnet is in release scope.

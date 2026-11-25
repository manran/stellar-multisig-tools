---
title: "Horizontal Review — 2026-11-25"
description: "Counterexample-driven review of Agent First discovery, history and Soroban recovery."
---

**Reviewed revision:** `cd34ac5c625d4620f7a7d271960cd4a60f939045` (PR #45).
**Scope:** Classic and Soroban signer discovery, Inbox completeness, Human/Agent next actions, durable replay, and historical activity. Reviewed existing execution recovery and actual public Testnet RPC response shape.
**Evidence:** developer self-review with a fresh cross-surface checklist; five isolated counterexamples executed using the real service functions in Node 24.19.0, in a read-only checkout with networking disabled. Fixtures supplied only synthetic public addresses, unsigned XDR, in-memory storage and deterministic dependency results. This is not a second independent Agent's acceptance, a real wallet test, or a real Soroban execution.

## Findings

| ID | Priority | Finding | Status |
| --- | --- | --- | --- |
| HR-01 | P0 | New eligible signer can be missing from Inbox after signer rotation | Regression verified; live acceptance pending |
| HR-02 | P1 | Classic Inbox silently truncates; no complete enumeration contract | Regression verified; live acceptance pending |
| HR-03 | P1 | Human and Agent disagree about recovery action for one unresolved Intent | Regression verified; live acceptance pending |
| HR-04 | P1 | An already-created semantic Intent cannot be replayed when ABI lookup fails | Regression verified; live acceptance pending |
| HR-05 | P1 | Replanning can remove a proven historical participant from Soroban Activity discovery | Regression verified; live acceptance pending |

### HR-01 — live authority vs discovery membership

**Invariant:** discovery candidates must cover current eligible signers; the live authority check remains the final gate.

**Source:** `requestDiscovery.ts` snapshots signer keys when creating a Classic Request; `postgresSigningRequestStore.ts` stores those discovery subjects; `requestInbox.ts` supplies an empty source-account list to signer-first discovery. `requestAccess.ts` independently checks current account signer weights. Soroban also indexes the signer set during planning, so include it in the fix's coverage.

**Executed counterexample:** a synthetic Request indexed under the previous signer. The injected current source-account policy recognizes the replacement signer. `signerCanAccessTransaction` returns true, while `listSignerInbox` returns zero because that signer does not appear in the index. No live HTTP request was made.

**Acceptance:** current replacement signer discovers existing actionable work without its private ID. Removed signers cannot obtain current private work through stale index membership. Handle reverse lookup unavailability honestly. Reuse existing subject/authority indexing; do not weaken live validation or introduce continuous global scans.

### HR-02 — silent truncation and reminder loss

**Source:** `requestInbox.ts` defaults to 50, caps at 100; `routes/inbox.ts` returns only that page with counts; `SignerInboxResult` has no cursor/completeness field. Proposer lookup additionally limits 100 candidates before filtering. The Agent quickstart tells agents to stop reminders when a task leaves Inbox.

**Executed counterexample:** 51 eligible live Classic Requests, each with a valid locator and unsigned payment XDR. Default `listSignerInbox` returns 50, explicit limit 100 returns 51. The public route offers no limit/cursor. A missing oldest item cannot be treated as cleared.

**Acceptance:** enumerate all authorized pending work with stable ordering and a documented continuation/completeness contract for both Classic and Soroban. Counts must clearly describe scope. Test 0/50/51/100/101, multiple pages, duplicates, updates, and failure midway. Human and Agent cannot silently lose tasks; monitoring docs distinguish a complete scan from a partial page.

### HR-03 — recovery action mismatch

**Source:** `sorobanIntentInbox.ts` passes authorization and an execution-failed Boolean to the Human projection. `agentTaskProjection.ts` considers all unresolved preparation hashes. The recovery guards already refuse replacement packages until resolved.

**Executed counterexample:** same authorized non-Integration Intent with a persisted expired-but-unresolved execution preparation. Human projection returns `route_execution`; Agent projection returns `reconcile_execution`. Existing execution guard would reject a fresh package.

**Acceptance:** derive Human Inbox, detail view, Agent tasks and Integration jobs from the same execution evidence. Reconcile before refresh/replan, and show unknown outcome distinctly from failure. Check cancelled-but-released execution, prior revisions, failure and confirmed non-inclusion. Preserve role-specific permissions.

### HR-04 — durable replay depends on live ABI

**Source:** `integrationSorobanIntentService.ts` calls `buildContractIntent` before computing/reading the deterministic stored Intent ID. `agentSorobanIntentService.ts` likewise loads the interface before claiming/looking up idempotency. `contractIntentService.ts` returns 502 when interface loading fails.

**Executed counterexample:** an Integration creation replay fixture whose store would return an existing Intent. Injected ABI outage returns `502 contract_interface_unavailable` with zero durable Intent reads. The previous terminal receipt-only projection cannot help because creation never reaches it.

**Acceptance:** exact same accepted idempotent submission recovers its canonical stored result without live contract-interface or planning dependencies. Preserve strict request-content, ownership, network and scope matching; changed payload still conflicts. Use a durable normalized request identity or equivalent accepted-input evidence. Test old ABI unavailable, ABI changes, mismatched arguments, and concurrent creation. Do not silently reinterpret arguments under a new ABI.

### HR-05 — historical participant vs live signer index

**Source:** `postgresSorobanIntentStore.ts` replaces `soroban_intent_signers` rows when replanning; `sorobanIntentActivity.ts` enumerates history from that same live index before filtering by creator or proven contributor. Existing PostgreSQL test explicitly verifies replacement of discovery signer keys but does not check historical Activity after replacement.

**Executed counterexample:** an in-memory store models the actual post-replan index containing the new signer only, while retaining a valid earlier contribution record for the previous signer. Activity returns zero. Returning the Intent as a history candidate yields one retained Activity item. This demonstrates the projection/index mismatch, not actual loss of stored evidence or a live database mutation.

**Acceptance:** history discovery retains the creator and proven historical contributors independently from live discovery membership; old contributions remain visible within authorized historical evidence, but confer no signing authority. Verify with isolated PostgreSQL replan and Activity tests as well as Human and MSA reads.

## Other checks and limits

- Public Testnet RPC read-only probes returned `getHealth` fields `oldestLedger`, `latestLedger`, `latestLedgerCloseTime` and `getTransaction` NOT_FOUND coverage fields. This checks the previous recovery implementation's real response shape; it does not establish full history coverage, fee-bump behavior, or a live recovery result.
- Reviewed source, fixture behavior, docs and persistence boundaries. No business code, database, runtime deployment or Mainnet was changed during this review.
- Real Soroban full-lifecycle acceptance and independent black-box retest remain open. Complete the five fixes and repeat the review. Do not infer that all possible defects have been found.

## Follow-up: repairs and verification

- HR-01: discover current authorizer accounts with fresh reverse lookup, then apply live signer checks. PostgreSQL migration 0021 adds and backfills the Soroban authorizer index.
- HR-02: combined Classic/Soroban keyset pagination, explicit completeness and page counts; Human Inbox and Dashboard collect all pages or report an error. Enumeration is live, not an atomic snapshot.
- HR-03: Human Inbox, Agent and detail view prioritize unresolved execution reconciliation. Preparation and contribution guards reject unresolved or stale work.
- HR-04: persist normalized accepted-input fingerprints and check durable replay before ABI lookup. Legacy records without fingerprints retain typed-digest verification and may still require ABI. Pending authorization still requires live state.
- HR-05: PostgreSQL history candidates include the creator and proven contributors independently of current signer discovery. Historical visibility does not grant signing authority.
- Verification on the repaired working tree: 971 unit/service tests, 39 isolated PostgreSQL tests, 104 browser scenarios; API, web and public documentation builds passed. The 101-request pagination fixture returned 50 + 50 + 1. Browser report recorded zero failed scenarios, unexpected requests or page errors.
- Scope: Testnet PostgreSQL. Legacy Blob records have no offline authorizer-index backfill. Mainnet is unchanged. Independent black-box acceptance and real Soroban lifecycle remain open.

## Public Agent contract review — 2026-11-25

Independent reviewer reported three public-contract findings on revision 7806445: ambiguous operation-body branches, missing successful poll credential requirements and lost-response recovery, and an overbroad creation-idempotency rule. This was a contract review, not another transaction acceptance.

- The Operations Registry now resolves every logical operation in OpenAPI via schema.pointer. The operation-specific contract defines security, parameters, request/response schemas, dispatch defaults, and retry rules. Human denial has its own logical operation ID. Agent task actions and Integration job actions identify the call directly; external Stellar submission is distinguished.
- One-time grant issuance reserves a credential ID before approval. Poll success requires apiKey and credential. Lost-response recovery identifies the reservation for Human inspection and revocation without disclosing the secret again. A missing credential is not proof of failed issuance; older grants have no reserved ID.
- Testnet Profile creation is atomic create-only, including the shared administrator creation path. Repeating an occupied ID cannot replace its credential. Idempotency-Key is supported only for machine Request/Intent creation; the Profile route rejects it. No public recovery or rotation of an existing Profile secret is introduced.
- Verification: 977 regular tests passed, including simulated response loss after successful commit, concurrent polls, actual isolated filesystem concurrent Profile creation, and resolution of all logical operation pointers. Root and public documentation builds passed. Final targeted checks and Testnet release are separate from independent acceptance.
- No Mainnet, credential policies, or database migrations are part of this repair. Real network disconnection and independent black-box retest remain open.

- Testnet release 47277af: public API and website OpenAPI responses are byte-identical; all 55 logical operation contracts resolve. Hosted MSI/MSA acceptance passed all 36 checks, including duplicate profile protection, idempotency boundary, consumed grant recovery, signer task discovery, external submission and revocation. Request HKHJN7KH37P4R7H3 confirmed in Testnet ledger 5911823 (transaction f36250c16208e25a1e901a89bcf0747952b13ee09a127fd9b4157d1d2ec56f6b). The acceptance runner initially compared a URL object with a string; this was corrected before the successful run. This automated acceptance does not constitute independent review or actual network-disconnection testing.


## Classic/Soroban execution receipt contract review — 2026-11-25

Independent contract feedback: terminal Soroban results did not require evidence in OpenAPI; an externally submitted Classic Request lacked explicit response-loss reconciliation. The reported earlier successful payment remains successful.

- Both reconciliation schemas now discriminate unknown, successful, failed and not_included; mutually exclusive matching evidence is required. The successful Classic submission schema is explicit.
- The owning MSI discovers integration.request.execution.reconcile (GET Request with view=reconciliation). Lookup uses the stored exact hash, never a caller-supplied alternative. Existing success stays canonical; failed and verified absence are durable in migration 0022 and private-object fallback. Request, Activity and webhook projections carry executionOutcome. Negative observations enqueue an Integration change once. No second transaction is generated by reconciliation.
- Non-inclusion requires a finite signed lower and upper time bound and healthy RPC coverage before and during the NOT_FOUND lookup, with the oldest ledger strictly before the lower bound and the latest strictly after the upper bound. New payment and CreateAccount preparations include a lower bound; older imported XDR without one, or pruned history, remains unknown. Local Request expiry is not proof. Unknown has bounded backoff and escalation; failed/not_included require separately authorized Human review before replacement.
- Fee-bump handling verifies the inner and outer envelope hashes. Actual Testnet fee bump at ledger 5912343: inner cf96c62962885672deb333b9d160bfe2c1dd9d64fa0da11d557f76240bb33fb6, outer 082ad37cb69bb2c54e2de956230d2bb0778a4473c35724c371d36f4633b34f93. RPC lookup by inner hash returned SUCCESS with the exact outer XDR; Horizon returned 200 with the inner hash and same outer XDR.
- Verification before deployment: 986 regular tests, 40 isolated PostgreSQL tests, 104 browser scenarios (zero failed, unexpected requests or page errors), root and docs builds passed. Draft 2020-12 validator ran 72 positive/negative cases on the exact generated execution schemas using jsonschema 4.26.0 in an isolated QA environment. The test script is retained. This is not independent black-box acceptance; actual failed ledger receipt and physical transport disconnect are not yet covered by hosted end-to-end acceptance.

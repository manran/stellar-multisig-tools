---
title: "Near-Term Development Guide"
description: "Frozen engineering priorities for the current productization phase."
---


**Frozen:** 2026-09-20
**Status:** current product engineering baseline
**Applies to:** the next productization phase after Managed Classic Integration Testnet E2E closure.

## 1. Phase change

The technical product core is feature-frozen for near-term work.

Verified and considered closed at this phase:

- Classic Request authorization and submission.
- Soroban Intent / AUTH / execution separation.
- Human / Agent / Bot / Integration authority boundaries.
- Hosted / Native / Full Headless integration model.
- Managed and external Classic execution.
- PostgreSQL coordination authority and webhook outbox.
- Real Testnet Reference Integration E2E.
- Real Hosted + two-Freighter 2-of-2 E2E.
- Testnet fixed-network deployment boundary.

This does **not** mean there is no future engineering work. It means new product capability is no longer the default priority.

Near-term work order:

1. product language and visual hierarchy;
2. whole-app design system;
3. Human surface redesign;
4. developer documentation reorganization;
5. mobile / accessibility / real-browser regression;
6. only then Mainnet operational hardening.

Mainnet managed Classic remains disabled.

## 2. Freeze boundary

Do not add new workflow engines, authority models, credential classes, persistence models, or parallel state machines unless a concrete regression or external integration proves the existing model insufficient.

Do not reopen casually:

- Request vs Intent separation.
- Classic Treasury signer authority vs transaction-source execution authority.
- Soroban AUTH authority vs executor authority.
- Integration scope is not signer authority.
- Headless core first; UI is a projection/consumer.
- Managed execution is the ordinary default; external execution is progressive disclosure.
- Human workflow: Prepare -> Review -> Sign -> Submit -> Done.
- Proposal spans Sign and Submit; it is not a sixth lifecycle.
- Testnet and Mainnet are separate deployment/runtime boundaries.
- Mainnet managed execution remains off until operational controls are ready.

## 3. Main contradiction for the current phase

The system is technically mature but presents too much of its engineering structure directly to Humans and developers.

The main contradiction is now:

> powerful authority/execution machinery vs a product surface that still exposes too much machinery at once.

Therefore:

- simplify business presentation without weakening authority;
- progressively disclose execution mechanics;
- let page hierarchy answer "what should I do now?" before "how is this implemented?";
- keep exact technical evidence available under Advanced / evidence / developer surfaces.

## 4. Product surface hierarchy

### Human workspace

Primary Human concepts:

- Treasury
- New transaction
- Inbox
- Proposal
- Activity
- Contract
- Receipt

Human pages should prioritize:

1. what is happening;
2. what changes on chain;
3. who must act;
4. what happens next;
5. technical evidence only after the action model is clear.

Do not lead Human pages with:

- Request/Intent storage mechanics;
- channel/executor internals;
- API terminology;
- source-account mechanics unless it is a safety fact the Human must understand.

### Integration / Automation

Progressive integration choices:

- Hosted
- On my site / Native Authorization
- Full Headless

The developer-facing product should make ownership explicit:

- who owns business UI;
- who owns signer interaction;
- who owns execution;
- what MST still verifies regardless of presentation.

### Advanced / Operator

Keep advanced surfaces available but subordinate:

- raw XDR;
- execution/channel inspection;
- Integration administration;
- contract/executor binding;
- persistence/runtime/operator facts.

These are real capabilities, not primary navigation concepts for ordinary users.

## 5. Hallmark redesign contract

The project is a multi-page app. One locked design system applies across all pages.

Source of truth:

- `design.md`
- `apps/web/tokens.css`
- `apps/internal-docs/content/stellar/product/ux-design-system.md` for Human workflow semantics

Do not give each page an independent theme.

Preserve:

- MultiSig Tools brand and linked-authority mark;
- emerald brand anchor;
- Testnet sky environment identity;
- Inter body/control typography;
- Bitstream Charter display typography;
- Human workflow semantics and shared UI primitives;
- route tree, component ownership, business logic, auth, persistence and API behavior.

Redesign:

- page macrostructure;
- hierarchy;
- spacing rhythm;
- CTA priority;
- navigation/footer voice;
- progressive disclosure;
- dense engineering-card layouts that obscure the primary task.

No production route/component deletion without explicit approval.

## 6. Initial Hallmark audit — ranked findings

### Critical

1. **Structural fingerprint / equal-card workflow**
   - `apps/web/src/StellarLandingApp.tsx`: the four-step section is a uniform four-column card strip.
   - Effect: reads as a generic SaaS feature grid rather than one continuous authorization story.
   - Direction: convert to one narrative sequence with shared structure, not four isolated tiles.

2. **Footer fingerprint**
   - `apps/web/src/StellarFooter.tsx`: marketing footer is brand column + three link columns.
   - Effect: generic Product / Resources / Trust SaaS footer.
   - Direction: compact product statement plus a single directory/link field with less categorical chrome.

### Major

3. **Competing primary actions**
   - `apps/web/src/StellarLandingApp.tsx`: Open workspace / Try live demo / Create a treasury share near-equal CTA weight.
   - Direction: one primary action, one clear secondary; other entry points move into the next decision surface.

4. **Role cards repeat card grammar**
   - `apps/web/src/StellarLandingApp.tsx`: signer vs treasury-manager is another equal-card grid.
   - Direction: use a task index/list with explicit entry paths.

5. **Testnet hero + two cards**
   - `apps/web/src/StellarTestnetLandingApp.tsx`: generic hero followed by two equal informational cards.
   - Direction: treat Testnet as an environment notice/workbench entrance, with one compact boundary-facts list.

6. **Token drift**
   - changed page files still use many raw hex / Tailwind color literals despite an existing semantic `apps/web/tokens.css`.
   - Direction: new/redesigned surfaces consume semantic tokens; migrate only touched files, do not churn unrelated components.

### Minor

7. Header's landing height animation adds chrome movement without adding product information.
8. Historical tiger-tally story is useful brand context but currently interrupts the product proof rhythm.
9. Marketing copy and docs vocabulary need one final pass so Human pages say Proposal while API docs retain Request/Intent where technically required.

## 7. Design rollout order

### Phase A — system + entry surfaces

- lock `design.md`;
- normalize `apps/web/tokens.css`;
- redesign Mainnet landing;
- redesign Testnet landing;
- simplify shared marketing Header/Footer.

### Phase B — core Human loop

Order:

1. Home/Dashboard
2. Inbox
3. New transaction
4. Review / Signing Room
5. Proposal
6. Receipt
7. Treasury
8. Activity
9. Contracts / Contract Workspace

Acceptance is real task clarity, not visual novelty.

### Phase C — Integration / operator surfaces

- Integration Profile / Admin
- Agent access
- Advanced execution/runtime facts

Preserve progressive disclosure: Managed by default, self-managed execution advanced.

### Phase D — developer docs

Rebuild docs around tasks, not internal modules.

Canonical structure:

- Start
  - What is MultiSig Tools
  - Choose your integration
  - Testnet quickstart
- Core concepts
  - Request vs Intent
  - Authorization
  - Execution
  - Classic vs Soroban
  - Treasury / signer / executor
  - Managed vs external execution
- Classic
- Soroban
- Integration
- Human signing
- API reference
- Recipes
- Security model

The first developer decision page is **Choose your integration**:

- Hosted — MST owns authorization UI.
- On my site — integrator owns UI/wallet UX; MST remains authority verifier.
- Full Headless — Browser/Server/Agent/executor orchestration is integrator-owned.

## 8. Verification contract

Every redesigned page must pass:

- current targeted tests;
- production build;
- `git diff --check`;
- real browser render;
- 320 / 375 / 414 / 768 px mobile/tablet;
- 1280x800 desktop fold for marketing pages;
- no horizontal overflow;
- no two-line primary clickable labels;
- visible focus states;
- reduced-motion behavior;
- dark mode;
- Mainnet/Testnet semantic color separation.

Authority/persistence behavior is not allowed to change as collateral UI work.

## 9. E2E policy after freeze

Do not rerun expensive real-chain E2E merely because a page changed.

Rerun Reference Integration E2E only when changes touch:

- Request/Intent authority;
- signer contribution;
- managed channel execution;
- Hosted signing;
- webhook delivery;
- network/runtime boundary.

Pure visual/layout changes use browser/task regression, not fresh chain transactions.

### Varial real-extension E2E — reuse upstream, stop retry loops (2026-11-21)

**Single test route:** use [Varial's upstream Playwright fixtures](https://github.com/stellar/freighter/tree/master/extension/e2e-tests), not a new wallet initialization script or a simulated extension.

- [`helpers/login.ts`](https://github.com/stellar/freighter/blob/master/extension/e2e-tests/helpers/login.ts): `login` creates and imports a temporary mnemonic and selects Testnet; `loginAndFund` also funds with Friendbot; `loginToTestAccount` is a deterministic/stub-friendly helper, **not** proof of a live signing flow.
- [`test-fixtures.ts`](https://github.com/stellar/freighter/blob/master/extension/e2e-tests/test-fixtures.ts) loads the real extension in Chromium. [`integration-tests/freighterApiIntegration.test.ts`](https://github.com/stellar/freighter/blob/master/extension/e2e-tests/integration-tests/freighterApiIntegration.test.ts) shows the extension's real connection and sign-transaction prompts.
- Create two **separate, isolated browser profiles** with distinct **Testnet-only** wallets. Initialize once; reuse only within the authorized isolated test environment. Keep passwords, recovery phrases, private keys, and profile contents out of Git, PRs, chat, screenshots, and logs. Never use a user's real wallet.
- Fund test accounts with Friendbot, configure the Testnet signer threshold, then test MST: A connects/reviews/invites, B confirms the actual Varial wallet prompt and signs, the sender sees the verified contribution, and the designated executor submits and receives a ledger receipt. Assert wallet identity, network, signatures, and on-chain result—not just buttons or API mock calls.
- **Stop rule:** if the environment's tool safety gate blocks wallet initialization or credential input, stop immediately. Do **not** keep retrying variants of the command, change execution channels, or write another importer to bypass the gate. Record the exact blocked step once; have an authorized tester initialize an isolated test profile through Varial, then resume from that prepared profile. Do not treat the block as a product defect.
- Keep evidence levels distinct: fixture browser regression, live Testnet SDK/HTTP signing, and **real Varial extension** signing are three separate checks. A pass at one level does not close another. Record commit, wallet extension version, Testnet transaction hash, and the remaining gap in the PR/test report.

### Reuse existing FedNetwork / MST real-wallet harness (2026-11-21)

**Do not rediscover wallet setup.** There is already working local code on the authorized E2E host:

- `/opt/FED/fed.network/test/e2e/freighter-transfer.mjs`: `createWallet()` starts two separate Chromium persistent profiles with the real extension, captures public Testnet addresses, funds with Friendbot, selects Testnet, and configures auto-lock. `approvePrompt()` accepts explicit connection, message-signing, transaction-signing, and Soroban authorization prompts. It also checks the prompt network.
- `/opt/FED/fed.network/scripts/run-real-freighter-transfer-e2e.sh` and `docs/testnet-real-wallet-e2e.md`: launch requirements and end-to-end FedNetwork -> MST -> ledger flow. Harness dependencies are at `/opt/browser-e2e`; the installed historical extension is `/opt/mst-e2e/freighter/unpacked`.
- `/opt/browser-e2e/mst-classic-hosted-freighter-e2e.mjs` and `/opt/mst-e2e/classic-hosted-freighter-e2e-result.json`: MST-specific precedent with real extension connection, wallet challenge, two independent signatures, managed submission and ledger verification. Prior run 2026-09-20: **PASS**, Testnet ledger `4778856`, transaction `b33d9f430b8627fbe1e853b0f6ed10b73ab44d4800b161da3aba41b24e095509`.
- The FedNetwork 2026-11-19 run (`/opt/FED/retirement-evidence/transfer-e2e-20261119.log`) **did not pass**: it initialized two wallets but later timed out waiting for the hidden `#manage-sign-button`. Keep this as a failure record, not authorization evidence.

**Version / migration check:** existing Fed/MST harness and unpacked extension were written for Freighter `5.48.0`; current official Varial release is `5.53.0`. Confirm selectors, flow states and popup labels against the installed release. Update wallet chooser matching from only `Freighter` to `Varial` when needed, while keeping the underlying `freighter` wallet-module identifier unchanged. Preserve the existing authority, network and transaction checks.

**Execution contract:** start with a read-only preflight of both versions, profiles, network and Testnet readiness. Use only isolated, disposable profiles or a deliberately prepared copy of a historical profile; do not overwrite archived profiles or expose secrets. If initialized profiles are absent or locked and an automated credential/onboarding operation is blocked by the tool's safety gate, **stop at that step**, do not rewrite or reroute credential automation, and ask an authorized tester to prepare the isolated profile once. Resume real Varial -> MST signing only when the test wallet can be unlocked legitimately. Distinguish that run from the already proven SDK/HTTP 2-of-3 and mock-browser regressions.

**2026-11-21 preflight outcome:** read-only Chromium inspection of *copies* of four existing profiles (`/opt/FED/fed-real-transfer-{owner,recipient}` and `/opt/mst-e2e/classic-hosted-20260920143527-218592-{owner,signer-b}`) loaded the real historical Freighter 5.48.0 extension. **All four showed an Unlock/password prompt; none exposed an unlocked account view.** No credential input or wallet signing occurred. Historical profiles remain untouched. At that preflight stage, the next E2E gate was legitimate unlock or authorized one-time initialization of disposable profiles; do not report the four locked profiles as ready, and do not retry blocked credential automation.

### Live Varial 5.53.0 E2E acceptance — 2026-11-21

The authorized E2E host `DeepSeekHarnessPlugins` successfully ran the existing FedNetwork test and a separate **real MST** Testnet 2-of-2 signing flow. Both used the official unpacked Varial 5.53.0 extension (release zip SHA-256 `44e8aab2e68ca4b2c4f4af56a81e1e37632b06e2ee115962dc61f931e71bb71a`), isolated Chromium profiles, real extension prompts and Friendbot-funded disposable accounts.

- FedNetwork real-wallet transfer + cleanup: **PASS**. Testnet ledger `5841276`, transaction `1e93b27a5eb60ed4e32c73074b4f3eb36cec40825bfc35319f694f7d80e8a4ee`. The older 5.48.0 extension also passed its original unmodified FedNetwork runner (ledger `5841233`).
- **MST real Varial 2-of-2: PASS**. Built a Testnet Treasury with two distinct extension-wallet signers (threshold 2); imported an unsigned 0.05 XLM payment; created a Proposal; both wallets signed through real Varial confirmation popups; selected `MultiSigTools submits`; and confirmed the payment via Horizon. Ledger `5841391`, transaction `4f7f68b428f3c438f57e9a2b19cb708e26745dc2604768728d979574a74e8702`. The reusable regression script itself was then run independently with **Exit 0 / PASS**: ledger `5841421`, transaction `359a6401fc54e9b7307503570fbc0e30ca31fd3d4224972531984cb778c7344c`.
- An initial script falsely failed when querying the hash of the **original unsigned** XDR after MST finalized the transaction. The correct post-submit check queries Treasury history and verifies a successful payment operation with the exact amount, source and destination, then retrieves the receipt. Do not equate the pre-submission hash with the final transaction hash.
- A fresh route load may require confirming the wallet-signed login message again. Recipient follows the Proposal's **Review -> Continue to signatures -> Sign** path. Both are expected state transitions, not failures.

**Reusable regression script:** `scripts/qa/realVarialMultisig.mjs`. It is an explicit opt-in live Testnet test (not CI), creates and tears down unique temporary wallet profiles, does not export keys or mnemonic phrases, and does not modify Mainnet. Example on an authorized host with matching Playwright/Chromium:

```sh
MST_VARIAL_LIVE_E2E=1 \
MST_VARIAL_EXTENSION_DIR=/path/to/unpacked-varial \
MST_VARIAL_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
xvfb-run -a node scripts/qa/realVarialMultisig.mjs
```

Use a Playwright version that matches the installed Chromium revision. The first attempt on this host failed because Playwright 1.63 expected Chromium 1243 while only 1228 was installed; Playwright 1.61.1 matched Chromium 1228. That is a tooling dependency mismatch, **not** a wallet defect or credential-policy failure.

This evidence closes the real **Varial wallet + MST signing + Testnet submission** check. It does not verify email invitation delivery/reminder workflows or Mainnet.

### Real email invitation and reminder E2E — 2026-11-21 (synthetic delivery verified)

A real Varial 5.53.0 Testnet run covered **Human coordination, signing, submission and a synthetic Resend recipient**:

- A new 2-of-2 Proposal was created and signed by the owner. The `assignSigner` and `remindSigner` APIs saved the Assignment and queued independent `signature_requested` / `signature_reminder` events to Resend's controlled `delivered@resend.dev` test recipient.
- The second, independently authenticated Varial wallet opened the non-secret `/s#<proposal-id>` locator, confirmed identity, triggered an authenticated `Viewed` fact, reviewed and signed. MST submitted; Horizon confirmed payment in ledger `5841807` (transaction `3cc62810f8440c38e27af36af17e32a0616dc079c174ca8ebdd93633ba610a06`). The temporary Contact was removed.
- At first, both emails remained `queued`. **Root cause found on SAINT Testnet backend:** Docker Secret files `/opt/MST/runtime/mst-testnet-api/resend-api-key.secret` and `resend-webhook.secret` were owned by `root:root` with mode `600`, while the notification worker and API containers run as UID/GID `1000:1000`. The notification delivery history showed six consecutive `resend_api_key_unavailable` retries, with no provider HTTP status or message ID.
- **Operational fix applied on SAINT:** change owner of only those two Secret files to `1000:1000`, retain `600`; verify the worker can read the Resend API Key and the API can read the Webhook Secret. Neither secret content nor value was changed; no containers were restarted.
- The two existing **synthetic-test** events (`request_id=1RB7NYF82YTTZ649`) were selectively made due immediately, rather than wait for their six-hour backoff. The seventh attempt for each succeeded with Resend HTTP `200`, a provider message ID, and a verified provider webhook event. PostgreSQL `mst_stellar.human_notification_outbox` now records **`outcome=sent, provider_delivery_state=delivered`** for both invitation and reminder, each with provider event ID and event timestamp.
- **Boundary:** `delivered@resend.dev` verifies the provider's synthetic delivery flow, not a human opening an email in a real inbox. The recipient's wallet-open-and-sign flow was exercised separately through the exact non-secret locator used in the email. Do not claim a human inbox-opening walkthrough has been observed.

**Reproduction:** run `scripts/qa/realVarialMultisig.mjs` with the normal Varial/Playwright environment and `MST_VARIAL_EMAIL_E2E=1`. This explicit opt-in verifies Assignment, Reminder, recipient `Viewed`, real signing and chain receipt. Email provider evidence is checked independently of the on-chain result; no synthetic test is part of routine CI.

**Operations check for future `queued` stalls:** on the SAINT Testnet backend, inspect `mst-testnet-api-human-notification-worker-1`, the `human_notification_deliveries.error_code` and `human_notification_outbox.available_at` columns, then the secret's read permission from the container's runtime UID. Do not rotate the API key or recreate the webhook when the error is file access. Apply any retry acceleration only to clearly isolated, controlled test events.

### SAINT private Testnet signer discovery — first consumer (2026-11-21)

**Boundary:** SAINT -> MultiSigTools only. MST sends only a verified signer's public G address to SAINT; never a private Workspace, Contact, XDR, transaction signature, request capability, Agent credential, or bearer cookie. SAINT discovers and explains publicly observed relationships, not authorizations, transaction construction, signer threshold sufficiency, policy, or execution decisions. MST's existing Horizon/RPC checks stay authoritative.

**Live SAINT read-only contract (not the older Permission Graph API V1):**
- Testnet private Mesh consumer: `http://100.96.0.4:18510`; Mainnet private Mesh `http://100.96.0.4:18500`. Both are read-only network-isolated ingress; neither is a browser endpoint.
- `GET /healthz` returns `network`, `network_fingerprint` and `registry_set_id`.
- `GET /v1/signer-resources?subject=<G>&kind=ed25519_key` returns `saint.signer-resources.v1`. `publication.network` is the **network fingerprint**, not the string `testnet`; `publication.registry` is the generation. The response has status, explicit completion indicators, target current configuration, relation proof, observed Ledger, frontiers and bounded continuations.
- Tested inside the actual MST Testnet API container network: SAINT `/healthz` and `/v1/address-current` return HTTP 200. A real `/v1/signer-resources` lookup for signer `GC6QGJOJOMK7KUVGMFTJSQRNMD6O6VV6U2BMTE5STDEN22WWH3KS5RCZ` found the previously tested 2-of-2 Treasury `GBSRIGOOKQMM33DT7VEK5L3WCKA6323PYYMEPNZ6O2ME22QJVYLMCW3U`, weight 1, thresholds 2, and current RPC proof. SAINT returned `partial` with `role_catalog_page_limit`; no global completeness claim.

**MST first slice:** backend-only configuration `SAINT_TESTNET_CONSUMER_URL` (Testnet Compose), `GET /api/saint-signer-resources` proxied through the existing MST API route, and a Testnet-only authenticated relationship lookup. The **Explore signer relationships** UI was retired because Horizon already answers the ordinary current-signer lookup. Human sessions or signer-owned Read-capable Agent credentials select the signer; the requester cannot submit an arbitrary address. The backend performs only two SAINT GET calls, binds Testnet network fingerprint + Registry generation, and reduces the response to current configured relations with fresh RPC proof. It forwards no authorization headers. Results are never imported as wallet authority or automatically adopted as Treasuries. The interface preserves explicit partial/incomplete flags and checks any linked account independently.

**Verification:** targeted SAINT contract tests, TypeScript API + Web checks, Vite production build, and a genuine private-network read of the current SAINT Testnet API from an isolated instance of the MST backend runtime. Mainnet remains disabled. Do not expose any new port or modify SAINT's resident, sync, Registry, or data files.

**Release gates:** the original signer-discovery UI was removed in favor of the optional Security Timeline below. The authenticated SAINT relationship backend remains read-only and is not part of transaction execution. Verify wallet-session authentication, server-side origin/Registry matching, the partial result on the real account, network failure without impacting signing, and the Testnet reset case (new Registry generation means no stale suggestions). No automatic Mainnet rollout.

### SAINT Security Timeline and fail-open contract — 2026-11-21

The product value is **observed historical signer/threshold changes**, not a second Horizon current-signer lookup. The optional Testnet route `GET /api/saint-account-security?address=<G>` requires an active MST Human wallet session. It passes only the public account address to the SAINT consumer, never credentials, wallet secrets, private Workspace content, XDR or Proposal capabilities.

- SAINT native history source: `GET /v1/account-security-history?address=<G>&from=<ledger>&through=<ledger>`. The backend reads `/healthz` first, limits the query to the most recent **64,000 published ledgers**, and checks the Testnet fingerprint, exact account and coverage window, fact-family availability and transaction-hash evidence. It returns only normalized control/lifecycle events. Partial/degraded history or a truncated result is explicitly marked incomplete.
- Real Testnet proof: the known 2-of-2 MST Treasury `GBSRIGOOKQMM33DT7VEK5L3WCKA6323PYYMEPNZ6O2ME22QJVYLMCW3U` returned **seven events** (creation, two signer additions, master-weight removal, low/medium/high threshold changes) from ledgers `5841385–5841386`. The exact MST client parser was run against SAINT's real local service with `complete=true` and preserved transaction references.
- **No critical-path dependency:** neither Treasury account loading, Request creation, Review, wallet signature, nor transaction submission invokes or awaits SAINT. The optional read has a single **5-second backend deadline** and a separate **6-second browser deadline**. SAINT down, slow, partial, mismatched, or HTTP 404 results in an independent informational state, not an authorization failure.
- Treasury detail has a manual **View history** control. Proposal loads a separate advisory asynchronously and warns only when SAINT identifies signer/threshold events whose observed timestamps are after the Proposal creation time. It never claims that no events exist outside the sampled window; it never blocks signing or changes the existing Horizon/RPC verification. A failed optional lookup does not block the user.
- Testnet UI is **off by default**, gated by `VITE_SAINT_SECURITY_TIMELINE_ENABLED=true`. Mainnet is excluded by the UI network check and backend network policy. No automatic SAINT polling and no new public endpoint/port were introduced.
- Checks: five focused tests cover historical evidence, degraded family, bad network/account/ledger, malformed event, outage/404, and missing login; API/Web TypeScript checks and Vite build with the flag enabled passed.

**Remaining private ingress activation gate:** SAINT loopback `127.0.0.1:18410` serves historical queries with HTTP 200; the existing private Mesh read-only Caddy ingress `100.96.0.4:18510` currently returns HTTP **404** for `/v1/account-security-history` because its explicit GET allowlist has not been extended. The MST code fails open now; do not change SAINT ingress policy, open a port or bypass it without the authorized narrow allowlist review.

**Enablement order:** approve the one-path historical **GET-only** addition to SAINT's existing private ingress; deploy the MST Testnet API handler and verify authenticated 200 / SAINT-down 503; then enable `VITE_SAINT_SECURITY_TIMELINE_ENABLED=true` only on the Testnet Web deployment and exercise a real Varial Proposal while SAINT is healthy and unavailable. Keep the Mainnet flag off. These are deployment gates, not further MST transaction-engine work.

## 10. Mainnet operational hardening — later gate

Before enabling Mainnet managed Classic:

- explicit channel provisioning/funding;
- channel balance visibility;
- low-funds alerting;
- active lease/pool-capacity visibility;
- spend/quota controls;
- operator runbook and recovery evidence.

These controls protect MST-funded transaction-source mechanics. They must never redefine Treasury signer authority.

## 11. Definition of near-term done

This phase is complete when:

- core Human journeys share one coherent product language;
- visual hierarchy hides implementation detail until needed;
- all primary pages follow `design.md`;
- developer docs lead from integration choice to working recipes;
- docs and UI use consistent Human terminology;
- mobile/browser regressions are clean;
- no technical capability was weakened to obtain a simpler UI.

# Product workflow browser checks

`productWorkflow.mjs` renders the real Stellar Web components at 320, 375, 414,
768, and 1280 pixels. It checks template discovery/recovery, Inbox sender
progress and refresh errors, and Proposal review/sign/submit/closed states.

The script starts Vite on `127.0.0.1:4177`. A Vite plugin replaces the wallet
context **only in this test process**. Browser routes intercept API and Horizon
requests. Fixture keys sign real transaction XDR locally; no transaction is
broadcast, no email is sent, and no production credentials are needed. Other
external requests are blocked. This validates the UI, not hosted API persistence
or an actual wallet extension.

Use a disposable checkout. Install the repository dependencies with `npm ci`.
Playwright is a QA-only dependency; do not add it to the production package:

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix /tmp/mst-qa-tools --no-audit --no-fund playwright@1.58.2
MST_QA_PLAYWRIGHT_MODULE=/tmp/mst-qa-tools/node_modules/playwright/index.mjs MST_QA_OUTPUT=/artifacts MST_QA_COMMIT=<checked-commit-sha> node scripts/qa/productWorkflow.mjs
```

The matching image `mcr.microsoft.com/playwright:v1.58.2-noble` contains the
browser and system dependencies. Run Vite and Chromium in the same disposable
container. No published host ports are required. Mount only the disposable
checkout and an artifact output directory; do not mount runtime secrets.
Pass `MST_QA_COMMIT` when mounting a Git worktree whose parent `.git` directory
is outside the container. Missing Git metadata never discards the test report.

Each scenario prints PASS or FAIL. The output directory receives screenshots
and `report.json`, including the checked commit, viewport, failures, and
unexpected API calls. A failed check or unexpected API call returns exit code 1.

## Passkey and walletless payment QA

`productWorkflow.mjs` also checks the invitation → Passkey user → fixed
Template payment → own Inbox → Activity flow without any wallet calls at 375px
and 1280px. These use an intercepted API/identity fixture; they do **not**
validate the real WebAuthn, JWT cookie, or live database.

`passkeyVirtualAuthenticator.mjs` uses Chromium's **virtual CTAP2 authenticator**
and real SimpleWebAuthn verification. It checks a user-verified discoverable
credential, Passkey sign-in, and rejection of a wrong/replayed challenge:

```sh
MST_QA_PLAYWRIGHT_MODULE=/tmp/mst-qa-tools/node_modules/playwright/index.mjs \
  node scripts/qa/passkeyVirtualAuthenticator.mjs
```

`passkeyIdentityHttps.mjs` also runs the **real MST identity API route** over
loopback HTTPS with an ephemeral TLS certificate, Chromium virtual Passkey,
actual PostgreSQL challenges, identity cookies, and DB-backed request limits.
It checks first registration, logout, returning login, replay denial, and 429
with `Retry-After`. It uses an in-memory auth signing key and never contacts
deployed services. Apply all migrations to a disposable database first:

```sh
MST_POSTGRES_TEST_URL=postgresql://.../postgres MST_POSTGRES_TEST_ALLOW_RESET=1 \
  MST_QA_PLAYWRIGHT_MODULE=/tmp/mst-qa-tools/node_modules/playwright/index.mjs \
  ./node_modules/.bin/tsx scripts/qa/passkeyIdentityHttps.mjs
```

Backend `postgresIdentityStore.test.ts` requires **only a disposable Postgres
database** with `MST_POSTGRES_TEST_URL` and explicit
`MST_POSTGRES_TEST_ALLOW_RESET=1`; the test drops/recreates `mst_stellar`.
Never run it on the deployed Testnet or Mainnet database. It verifies all
migrations, wallet identity uniqueness, the one-use invitation/grant flow,
credential counter protection, wallet linking, revocation and Request history.

Before any public beta, separately verify an **actual HTTPS WebAuthn flow**
against the updated Testnet API and real Postgres, browser wallet handoff,
email invitation delivery if configured, and abuse/rate-limit protections.
A passing fixture is not that acceptance.

## Hosted Testnet transaction smoke

The browser fixture above cannot prove the live API, durable PostgreSQL,
Stellar authorization or on-chain execution. Use the complementary
`hostedTestnetLifecycle.mjs` smoke from a disposable checkout:

```sh
npm ci --no-audit --no-fund
node scripts/qa/hostedTestnetLifecycle.mjs         # read-only Testnet runtime check
node scripts/qa/hostedTestnetLifecycle.mjs --live          # 2-of-3 Human lifecycle
node scripts/qa/hostedTestnetLifecycle.mjs --live --coordination # ID-only Ask/remind, no emails
node scripts/qa/hostedTestnetLifecycle.mjs --live --proposer    # Delegated payment, revocation, signer E2E
MST_QA_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/qa/hostedTestnetLifecycle.mjs --live --proposer --passkey  # Virtual WebAuthn invitation -> payment -> signed ledger -> private Activity
node scripts/qa/hostedTestnetLifecycle.mjs --live --agent  # scoped Agent signer lifecycle
```

The explicit `--passkey` option adds a Testnet-only browser-driven WebAuthn invitation and walletless Template proposer after the ordinary proposer flow. It requires an installed Playwright Chromium with a virtual authenticator. It verifies one-use invitation, user-scoped Request/Inbox/Activity, two Treasury signatures, ledger confirmation, and grant revocation. It never logs credential material or sends an email.\n\nThe live mode always uses `api-testnet.multisig.tools/stellar`, the Testnet
Horizon and Friendbot. It creates one **ephemeral** Stellar account and applies
2-of-3 thresholds. An actual wallet-key signature unlocks the hosted API.
The hosted PostgreSQL Request then receives two separate signer contributions,
a duplicate (which must not count), an Inbox check, and final submission.
The smoke checks the confirmed ledger and resulting manage-data value, closed
share-link privacy, verified signer history and retained Activity. Optional
`--agent` uses an API credential for one signer: the signing key remains in
the Testnet client; the credential can contribute but not broadcast, its
real Agent actor must appear in Activity, and revocation must block reuse.

Only public transaction hashes, Testnet accounts, request IDs, and step
timestamps appear in its output. It never saves private keys, JWT tokens or
capability links. With `--coordination`, the smoke also checks verified-session ID-only access,
self-Ask denial, durable assignment, duplicate Ask, creator reminder ownership,
and missing-email behavior using new empty address books. No email is sent.
The funded
ephemeral Testnet account remains on Testnet; this test does not delete it.
Run it intentionally, not automatically on PR builds. It tests generated
software keypairs, **not** the Freighter browser extension.

Verified hosted execution on 2026-11-20:
Request `XKEKKYGX6FQR0TVX`, ledger `5831805`,
transaction `9d6da0e76a3fb59862d0fdbb951e1479216254fe2cf2f2f537e180abf222f03e`.
Agent + audit variant: Request `FPXTJ1MBT6BJ2ARQ`, ledger `5831867`,
transaction `789803d2aa6eaf2b6a6f984079dae53199a690dcbb464507773e856b793a1bf3`.
This run also verified the real Agent actor ID in retained approval history.
This is proof for the deployed Testnet API, not evidence that unmerged
product UI commits have been deployed.

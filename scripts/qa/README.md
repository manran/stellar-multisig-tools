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

## Protocol 30 compatibility smoke

Run `npm test` for captured Protocol 29/30 ledger header decoding, W-address
composition/review, and recipient ID change detection. For a live RPC check:

```sh
npx tsx scripts/qa/protocol30Compatibility.ts --live
```

This creates a disposable funded Testnet account and simulates a native asset
contract transfer to a W address with the maximum uint64 ID. It verifies the
full reviewed destination and the emitted `to_muxed_id`, without submitting
the payment or saving private keys.

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
node scripts/qa/hostedTestnetLifecycle.mjs --live --agent  # scoped Agent signer lifecycle
node scripts/qa/hostedTestnetLifecycle.mjs --integration https://stellar-testnet.multisig.tools/ # strict read-only discovery
node scripts/qa/hostedTestnetLifecycle.mjs --live --integration https://stellar-testnet.multisig.tools/ # MSI + two MSA signers
node scripts/qa/hostedTestnetLifecycle.mjs --live --integration --external https://stellar-testnet.multisig.tools/ # external Classic receipt and non-inclusion
node scripts/qa/hostedTestnetLifecycle.mjs --live --soroban https://stellar-testnet.multisig.tools/ # detached AUTH, exact resume, cancellation guard and ledger receipt
```

The Integration variant discovers its business operation paths and access levels
from the public site's API catalog, registry and OpenAPI. It creates a scoped
MSI, chooses the runtime-supported payment path, and pairs two separate signer
MSAs. Each signer discovers its task in Inbox, reviews exact payment XDR, and
contributes its own signature. It verifies idempotency, source restrictions,
permission isolation, quorum submission, canonical ledger evidence, and MSA
revocation. It uses only a new self-paying Testnet Treasury; MSI secrets and
wallet keys are never persisted. The test is deterministic contract-driven
integration QA, not a standalone language-model evaluation.

Verified strict hosted MSI + MSA execution on 2026-11-24: Request
`1NF9H1P88F9M8HTF`, ledger `5893921`, transaction
`b86cf1ca0fbb348fcf0f30b3e6f8f939bca004f6a7afaff4de8745e0f8382776`. Both MSA
credentials were revoked after automatic quorum submission.

The live mode always uses `api-testnet.multisig.tools/stellar`, the Testnet
Horizon and Friendbot. It creates one **ephemeral** Stellar account and applies
2-of-3 thresholds. An actual wallet-key signature unlocks the hosted API.
The hosted PostgreSQL Request then receives two separate signer contributions,
a duplicate (which must not count), an Inbox check, and final submission.
The smoke checks the confirmed ledger and resulting manage-data value, closed
share-link privacy, verified signer history and retained Activity. Optional
`--agent` requests a device grant without credentials, checks pending status and
rejects session-only approval, then uses a fresh signer wallet signature to approve.
Only the Agent can exchange its private device code, exactly once, for an `msa_*`
credential. The signing key remains in the Testnet client; the credential can
contribute but not broadcast, its real Agent actor must appear in Activity, and
revocation must block reuse.

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


### Execution evidence contract

Export the current OpenAPI document to a local JSON file, then run `python3 scripts/qa/validateExecutionEvidence.py < openapi.json` with the Python `jsonschema` package installed in an isolated QA environment. The test rejects missing or contradictory terminal evidence for both protocols. The hosted Testnet external lifecycle also checks response-loss recovery by original Request, and never submits its short-validity non-inclusion fixture. It requires no production keys.

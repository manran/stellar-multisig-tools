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
MST_QA_PLAYWRIGHT_MODULE=/tmp/mst-qa-tools/node_modules/playwright/index.mjs MST_QA_OUTPUT=/artifacts node scripts/qa/productWorkflow.mjs
```

The matching image `mcr.microsoft.com/playwright:v1.58.2-noble` contains the
browser and system dependencies. Run Vite and Chromium in the same disposable
container. No published host ports are required. Mount only the disposable
checkout and an artifact output directory; do not mount runtime secrets.

Each scenario prints PASS or FAIL. The output directory receives screenshots
and `report.json`, including the checked commit, viewport, failures, and
unexpected API calls. A failed check or unexpected API call returns exit code 1.

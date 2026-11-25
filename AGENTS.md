# MultiSigTools engineering instructions

## Scope and authority

Read the current task, branch status and affected product/architecture documents before editing. Respect the user's requested scope. Keep Classic Request, Soroban Intent, signer authority and executor authority distinct. Use the existing canonical implementation, not parallel state machines.

Do not expand the feature scope during correctness hardening. Use only authorized access and disposable Testnet fixtures. Never modify Mainnet, security policy, credentials or public network exposure without separate authorization. Stop at blocked safety steps; report the blocker rather than reroute around it.

## Mandatory work cycle

Follow the current [Near-Term Development Guide](apps/internal-docs/content/stellar/operations/near-term-development-guide.md), especially **8a. Mandatory horizontal review and independent acceptance**.

- Design invariants, implement, verify vertically, review horizontally, obtain independent black-box acceptance for the affected milestone, then remediate and close.
- Review the affected end-to-end lifecycle, not just the diff. Compare Human/MSA/MSI/MTA/browser roles, create/replay/detail/Inbox/Activity/Webhook/UI/API docs, signer changes, failure recovery, concurrency, limits and pagination.
- Actively try to disprove the intended design. A green test suite is not a substitute for cross-surface invariants or independent usage.
- A separate reviewer receives public entry URL + task + safety boundary, not the developer's assumptions or private task identifiers. If no independent reviewer is available, record that acceptance as pending; do not describe self-review as independent.
- Record reproducible findings and evidence level. Fix the shared root cause; add negative and regression coverage. Recheck every affected consumer.
- Do not claim milestone readiness with open P0/release-blocking P1 findings or incomplete required acceptance. Bounded Testnet repair deployments are permitted with clearly recorded gaps.

Review evidence belongs in the internal operations documentation and the relevant PR. Keep reports concise; include the checked revision, findings, actual test results, and remaining limitations.

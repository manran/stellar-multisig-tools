# PostgreSQL Recovery Runbook

**Scope:** MST coordination PostgreSQL recovery. Testnet is the only environment approved for recovery drills. Mainnet managed Classic remains disabled.

## 1. Recovery authority

After PostgreSQL has accepted PG-only coordination facts, PostgreSQL is the recovery authority.

Do not recover by switching `MULTISIG_COORDINATION_STORAGE` back to Blob. Blob is historical evidence after cutover, not a current authority.

If integrity is in doubt:

```text
freeze coordination writes
-> identify a verified PostgreSQL recovery point
-> restore into an isolated database/branch first
-> verify schema + canonical coordination facts
-> only then consider an application/database cutover
-> unfreeze after bounded read/write smoke passes
```

A recovery drill must not switch the active production branch or connection string.

## 2. Current provider

The current Testnet Vercel PostgreSQL URLs resolve to Neon-hosted PostgreSQL. Provider identity was verified from redacted production environment metadata; credentials and connection strings are not recorded here.

Vercel production environment currently exposes `NEON_PROJECT_ID`, but no `NEON_API_KEY`. Therefore automated Neon branch creation is not assumed to be available from the MST runtime.

Provider-level recovery requires operator access to Neon Console or an explicitly supplied Neon API credential.

## 3. Application-level recovery verifier

Use the read-only verifier against any recovered PostgreSQL database:

```bash
DATABASE_URL_UNPOOLED='<recovered database url>' npm run db:verify-recovery
```

The verifier:

- performs no writes;
- requires the applied migration list to match the repository migration files exactly;
- enumerates all `mst_stellar` base tables;
- proves every table is readable;
- reports row counts for recovery comparison.

A migration mismatch fails closed.

Do not run `test:postgres` against a recovered provider branch. That suite is destructive when `MST_POSTGRES_TEST_ALLOW_RESET=1` and is only for disposable test databases.

## 4. Provider-level Testnet drill

Use an isolated Neon recovery branch or restored snapshot. Do not restore/switch the active Testnet branch during the drill.

1. Briefly freeze Testnet coordination writes with `MULTISIG_COORDINATION_WRITE_FREEZE=1` so the comparison point is stable.
2. Record UTC timestamp and run `db:verify-recovery` against the current Testnet PostgreSQL database. Retain only the verifier output; do not retain credentials.
3. In Neon, create an isolated branch from that timestamp/LSN (or restore a snapshot into a new branch) within the configured recovery window.
4. Obtain a connection string for the isolated recovered branch and keep it server-side.
5. Run `db:verify-recovery` against the recovered branch.
6. Compare:
   - migration list;
   - `mst_stellar` table set;
   - table row counts;
   - selected canonical Request/Intent ids and their read projections if the baseline contains them.
7. Run bounded read-only application smoke against the recovered branch:
   - Request/Intent direct reads;
   - Inbox/Activity projections;
   - Integration Service Activity when facts exist.
8. Record provider restore start/end timestamps to establish observed recovery time.
9. Delete the temporary recovery branch after evidence is retained.
10. Re-enable Testnet writes only after the active Testnet database was never switched and the original runtime remains healthy.

If the drill intentionally tests an actual branch switch, treat that as a separate change with explicit approval and a rollback plan.

## 5. Local application-layer proof

A disposable PostgreSQL 18 recovery drill was completed on 2026-09-21 using `mst-pg-foundation`:

- source schema: `mst_stellar`;
- native `pg_dump -Fc` + `pg_restore`;
- 20 base tables restored;
- migrations `0001` through `0008` preserved;
- every table row count matched;
- every table content digest matched between source and restored database;
- `npm run db:migrate` on the restored database returned `No pending migrations.`;
- `npm run db:verify-recovery` passed;
- a deliberately missing `0008` migration was rejected.

This proves the MST application/schema recovery path on a disposable PostgreSQL database. It does **not** prove Neon PITR/snapshot recovery, configured retention, or provider RPO/RTO.

## 6. Mainnet gate

Before Mainnet PostgreSQL recovery readiness can be marked complete:

- complete the isolated Neon Testnet recovery drill;
- record the configured Neon recovery/retention capability as observed in the provider account;
- record observed drill recovery time and the chosen operational RPO/RTO;
- identify who can initiate provider recovery and how that access is controlled;
- verify migration list and canonical Request/Intent/Activity reads after restore;
- keep Mainnet managed Classic disabled until the remaining production-readiness blockers are also closed.

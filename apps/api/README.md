# API application boundary

MultiSigTools keeps deployable API code separate from the web application while remaining in one repository.

- `stellar/routes/` owns Stellar HTTP route handlers.
- `stellar/server/` owns Stellar application services, persistence adapters, projections, and API-side policy.
- `/api/*.ts` at the repository root are Vercel compatibility shims only. They must not contain business logic.
- `src/stellar/` remains the shared Stellar domain/protocol layer for now. It should move to a package only when a concrete second in-repo consumer makes that useful.

A second chain must earn its own subtree with a working vertical slice. Do not create empty Ripple or other protocol scaffolding in advance.

Public URLs are intentionally unchanged by this refactor. A future dedicated API deployment can map its external `/stellar/...` namespace to this application boundary without moving domain logic again.

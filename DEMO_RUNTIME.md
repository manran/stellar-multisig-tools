# Demo Runtime Contract

**Status:** v123 product/architecture contract

## Purpose

The interactive Demo lets a visitor experience the complete human multisig workflow without connecting a wallet, unlocking private data, creating a real Signing Request, or submitting a transaction to Stellar.

The Demo has two jobs:

1. teach the product through a real interactive flow rather than only an animation;
2. provide a deterministic browser-acceptance path for the Human workflow that does not depend on wallet login.

It is not an authentication shortcut and it is not a special kind of production account. Demo follows the same five-step Human presentation and color system as Production; see `UX_DESIGN_SYSTEM.md`.

## Naming

Use **Demo Treasury** / **Interactive demo** in Human UI.

Do not call it a Demo account. `Account` already means a Stellar account and should keep that meaning.

## Composition boundary

`/demo` is a separate application composition root.

```text
normal Stellar route
  -> StellarWalletProvider
  -> AddressBookProvider
  -> authenticated/live page
  -> real APIs / Horizon as required

/demo
  -> DemoTreasuryApp
  -> in-memory Demo state
  -> pure XDR / semantic helpers
  -> no wallet provider
  -> no private-workspace provider
  -> no real Request / Activity / Treasury API
  -> no Horizon submission
```

Do **not** add a global `demo=true` authorization branch to production APIs or wallet/session code. The absence of production providers and API clients is the primary safety boundary.

## Data boundary

Demo state is ephemeral React memory only.

It must not be written to:

- Signing Request storage;
- Activity storage or indexes;
- Treasury metadata/Box storage;
- Address Book storage;
- private-workspace sessions;
- `localStorage` or `sessionStorage` as durable Demo state.

Reloading `/demo` intentionally resets the Demo.

Demo uses fixed public Stellar addresses only. No private key, seed, mnemonic, API credential, bearer capability, or wallet signature is stored or generated for the Demo.

## Transaction boundary

The Demo constructs a syntactically real Testnet payment XDR with the project Stellar SDK so transaction review is based on actual Stellar semantics.

The Demo does **not** cryptographically sign that XDR. `Alice signed` / `Bob signed` are simulated collaboration events inside the Demo state machine.

The final Submit step is explicitly a **simulated submission**:

- no call to Horizon submit;
- no fake Stellar transaction hash;
- no claim that a ledger accepted the transaction.

The UI must say that no transaction was sent to Stellar.

## Demo Treasury policy

The first Demo scenario is deliberately stable:

- Treasury: `Acme Demo Treasury`;
- network: Testnet;
- signers: Alice, Bob, Carol;
- each reusable signer weight: 1;
- Medium/High threshold: 2;
- proposal: XLM payment to `Vendor settlement`;
- quorum: any two of Alice/Bob/Carol.

Alice/Bob/Carol are Demo personas, not authenticated identities. Switching persona is a teaching control and must never be interpreted as proof of a real actor.

## State machine

```text
1 Prepare
  -> 2 Review
  -> 3 Sign      (Proposal / awaiting signatures)
  -> 4 Submit    (Proposal / ready)
  -> 5 Done      (simulated submission / Details / Activity)
```

Rules:

- Review freezes the exact XDR when the visitor starts the Proposal.
- A persona can add at most one simulated Demo signature.
- Two unique Demo signatures make the Proposal Ready.
- Ready never auto-submits.
- Submit remains a separate reversible confirmation step.
- Activity and Transaction Receipt are Done/history projections of the same in-memory Demo facts.
- Reset clears all Demo state and returns to Prepare.

## Reuse boundary

Reuse production code when it is pure and does not imply authorization:

- Stellar SDK transaction construction;
- XDR inspection;
- transaction semantic projection;
- common visual tokens/header/footer where they do not require wallet context.

Do not force reuse of production page components that own authentication, durable Request state, API access, or Horizon execution merely to make the Demo look structurally identical.

If Demo/product presentation duplication later becomes material, extract a pure presenter shared by both. Do not introduce an adapter framework preemptively in v123.

## Browser acceptance contract

The Demo is the default deterministic Human-flow browser path for changes that can be represented without real wallet/network authority.

Playwright acceptance should prove:

```text
home -> Try live demo
Prepare -> Review
Review -> Proposal
Alice signs
switch persona
Bob signs
Ready -> arm Submit -> Not now
Ready -> arm Submit -> simulated Submit
Transaction Receipt -> Activity
Reset -> Prepare
```

During that run assert that `/demo` does not request:

- `/api/*`;
- Horizon endpoints;
- wallet-selection/auth endpoints.

This Demo browser gate does **not** replace separate real-wallet / SEP-53 / SEP-10 / multi-user / on-chain Testnet E2E validation.

## Security invariants

1. Demo state can never grant access to a real Request or private workspace.
2. Production authorization code never accepts Demo persona or Demo state as evidence.
3. Demo never submits to Stellar.
4. Demo never creates a fake on-chain receipt/hash.
5. Demo records never appear in production Activity/Treasury/Request APIs.
6. Demo UI is visibly identified as a simulation at all workflow stages.

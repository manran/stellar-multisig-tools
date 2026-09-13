# Asset Presentation

MultiSig Tools must not decide which Stellar assets a Treasury is allowed to see by maintaining a product allowlist.

## Canonical identity

For Classic Stellar balances, identity comes from the ledger:

- native XLM: `XLM:native`;
- issued asset: exact `CODE:ISSUER`.

The asset code by itself is a display label, not a trust root. Two issuers can publish the same code, so `USDC`, `USD`, or any other familiar code must never cause two different issuers to be merged or silently treated as the same asset.

## Discovery

Treasury and payment surfaces discover assets from the account data returned by Horizon. Every `credit_alphanum4` and `credit_alphanum12` balance with a code and issuer is eligible for presentation, including assets MultiSig Tools has never seen before.

Liquidity-pool-share balances are not Classic payment assets and remain outside this presentation model rather than being mislabeled as an unknown token. Soroban contract tokens also use a different identity model; if MultiSig Tools supports them later, their contract address must be the identity root rather than pretending they are `CODE:ISSUER` assets.

## Human presentation

The guaranteed fallback presentation requires no external registry:

- asset code;
- exact issuer for issued assets;
- account balance.

Treasury detail may add optional human metadata later, but the canonical identity remains visible and unchanged.

## Metadata is enrichment, not authority

Names, organizations, domains, icons, and asset-domain association can improve presentation. They must never decide whether an on-chain asset is visible or usable.

A future metadata resolver should follow the same boundary used by FEX:

1. keep `CODE:ISSUER` as the canonical asset key;
2. treat issuer `home_domain` plus an exact `stellar.toml` currency entry as an identity association only;
3. never translate that association into an endorsement, safety rating, or implicit approval;
4. fail open for presentation: unavailable metadata leaves the raw code + issuer asset fully usable.

This keeps unknown assets first-class and prevents familiar asset codes from spoofing a known issuer's identity.

# MultiSig Tools Internal Docs

Private Fumadocs application for canonical Stellar engineering and operations documentation.

## Authority

The Markdown under `content/stellar/` is authoritative and edited directly.

The content is grouped into:

- `architecture/`
- `operations/`
- `development/`

There is no generated mirror and no second copy at repository root.

## Access

This application is not an access-control boundary by itself.

The Vercel project must keep Deployment Protection / authenticated access enabled before assigning `internal.multisig.tools`.

Defense in depth:

- page metadata disables indexing;
- `robots.txt` disallows all crawlers.

Do not rely on indexing controls for confidentiality.

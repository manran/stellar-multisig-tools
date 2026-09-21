# MultiSig Tools Internal Docs

Private Fumadocs projection of canonical repository engineering Markdown.

## Authority

Do not edit generated pages under:

- `content/stellar/architecture/`
- `content/stellar/operations/`
- `content/stellar/development/`

Edit the source Markdown at repository root and rebuild.

## Access

This application is not an access-control boundary by itself.

Before assigning `internal.multisig.tools`, the Vercel project must have deployment protection / authenticated access enabled.

Defense in depth:

- all routes emit `X-Robots-Tag: noindex, nofollow, noarchive`;
- metadata disables indexing;
- `robots.txt` disallows all crawlers.

Do not rely on these indexing controls for confidentiality.

# Design — MultiSig Tools

A locked design system for the MultiSig Tools app. Every page redesign reads this file before emitting code. Extend this file when the system needs to grow; do not invent per-page themes.

## Genre

Modern-minimal with editorial authority. Functional pages are restrained workbenches; marketing/content surfaces may use stronger typography but not decorative SaaS chrome.

## Product position

Shared authorization without shared custody.

The visual system should communicate:

- independent authority;
- precise review;
- calm operational control;
- evidence over spectacle.

## Macrostructure family

- Marketing pages: **Asymmetric Product Proof** — thesis and primary action paired with one real product/workflow artifact; subsequent sections form a narrative, not equal feature-card grids.
- App pages: **Workbench** — persistent workspace navigation, one dominant task region, secondary evidence/details progressively disclosed.
- Content/docs pages: **Long Document** — task-oriented navigation, readable content column, examples and evidence adjacent to the concept they support.

## Theme

Light:

- `--color-paper` oklch(0.975 0.007 150)
- `--color-paper-2` oklch(0.955 0.010 150)
- `--color-paper-3` oklch(0.925 0.014 150)
- `--color-ink` oklch(0.225 0.012 155)
- `--color-ink-2` oklch(0.42 0.014 155)
- `--color-muted` oklch(0.45 0.012 155)
- `--color-rule` oklch(0.84 0.015 155)
- `--color-accent` oklch(0.51 0.118 166)
- `--color-accent-hover` oklch(0.45 0.105 166)
- `--color-accent-ink` oklch(0.99 0.004 150)
- `--color-focus` oklch(0.61 0.145 166)
- `--color-success` oklch(0.51 0.118 166)
- `--color-code-bg` oklch(0.18 0.008 155)
- `--color-code-ink` oklch(0.94 0.008 150)

Dark:

- `--color-paper` oklch(0.17 0.007 155)
- `--color-paper-2` oklch(0.205 0.009 155)
- `--color-paper-3` oklch(0.25 0.012 155)
- `--color-ink` oklch(0.94 0.008 150)
- `--color-ink-2` oklch(0.76 0.010 150)
- `--color-muted` oklch(0.72 0.010 150)
- `--color-rule` oklch(0.34 0.014 155)
- `--color-accent` oklch(0.69 0.17 162)
- `--color-accent-hover` oklch(0.75 0.15 162)
- `--color-accent-ink` oklch(0.17 0.007 155)
- `--color-focus` oklch(0.75 0.17 162)
- `--color-success` oklch(0.69 0.17 162)
- `--color-code-bg` oklch(0.12 0.006 155)
- `--color-code-ink` oklch(0.92 0.008 150)

Network semantics:

- Mainnet interaction identity: brand emerald.
- Testnet environment identity: information sky.
- Success/warning/danger never inherit Testnet sky.

Accent footprint should remain restrained. Emerald is an action/identity anchor, not a decorative wash.

## Typography

- Display: Bitstream Charter / Iowan Old Style / Georgia fallback, weight 600–700, style normal.
- Body/controls: Inter, weight 400–700.
- Mono/evidence: ui-monospace / SFMono-Regular / Menlo / Monaco / Consolas.
- Headings are roman; never italic.
- Display tracking: slightly tight, approximately -0.025em to -0.04em depending on size.
- Display line-height: 1.02–1.08.
- `--text-display`: clamp(3rem, 6vw, 5.75rem).
- Body copy usually max 62ch.

## Spacing

4-point named scale. Consume named tokens; do not introduce one-off spacing values in redesigned surfaces unless the layout cannot be expressed with the existing scale.

- 3xs: 0.25rem
- 2xs: 0.5rem
- xs: 0.75rem
- sm: 1rem
- md: 1.5rem
- lg: 2rem
- xl: 3rem
- 2xl: 4.5rem
- 3xl: 7rem

## Shape

- Inputs: 0.625rem radius.
- Operational panels: 0.875rem radius.
- Pills only for status/environment chips.
- Avoid turning every content group into a floating rounded card.
- Prefer rules, rows, shared surfaces, and whitespace before adding another card.

## Motion

- Motion is informational, not decorative.
- Transform and opacity only.
- Easings: `--ease-out`, `--ease-in`, `--ease-in-out`.
- Typical duration: 140–220ms.
- Landing workflow demo may animate state progression because the animation explains the product.
- Layout chrome should not grow/shrink merely for polish.
- Reduced motion: opacity-only and <= 150ms; workflow state remains understandable without animation.

## Microinteractions stance

- Silent success over celebratory toast.
- Immediate visible focus ring.
- Disabled controls retain native disabled semantics, not opacity alone.
- Hover communicates affordance; no decorative lift unless it also clarifies clickability.
- Copy/saved state is concise and local.
- Required actions are never hidden under Advanced.

## CTA voice

- Primary CTA: one filled action per decision surface.
- Secondary CTA: quiet text or rule/border treatment.
- Tertiary entry paths belong in the next decision surface, not beside two other primary-looking CTAs.
- Button labels stay one line at every supported width.

## Navigation

Marketing/header chrome is compact and product-led.

- Brand + environment/account control is sufficient.
- Do not add a five-link marketing nav merely to fill space.
- Workspace navigation is task-oriented: Home, Inbox, New, Contracts, Treasuries, Activity, Contacts.
- Advanced/operator routes are not promoted into ordinary Human navigation.

## Footer

Marketing footer is a compact product/trust directory, not a four-column SaaS sitemap.

Workspace footer stays quiet and operational.

## Per-page allowances

- Marketing pages may use one real product proof/demo artifact.
- App pages must not add decorative enrichment; function carries the page.
- Content/docs pages are typography-first.
- Historical tiger-tally context may appear as brand/concepts material, never interrupting a critical task flow.

## Human workflow language

Canonical lifecycle:

Prepare -> Review -> Sign -> Submit -> Done.

Use:

- Proposal for the Human collaboration object.
- Request / Intent where technically necessary in API/developer material.
- Sign / Signed / signature for signer actions.
- Approval for policy/quorum meaning.
- Managed execution for the default MST-owned execution path.
- Manage execution myself / external execution only as progressive disclosure.

## What pages MUST share

- wordmark / linked-authority mark;
- emerald brand anchor;
- Inter + Charter pairing;
- CTA shape and focus language;
- paper/ink/rule surfaces;
- Human workflow semantics;
- Testnet sky environment identity;
- evidence and error tones.

## What pages MAY differ on

- macrostructure within the page-type family;
- density appropriate to task;
- presence of a real product proof on marketing pages;
- local component archetype when the domain task requires it.

## Responsive contract

Verify 320 / 375 / 414 / 768 and 1280x800 where relevant.

- `html` and `body`: `overflow-x: clip`.
- display headings: `overflow-wrap: anywhere; min-width: 0`.
- clickable labels never wrap.
- image-bearing grid tracks use `minmax(0, 1fr)`.
- section heading + eyebrow stacks vertically.
- secondary sticky regions offset below top nav.

## Exports

### tokens.css

The canonical Human Web runtime values live in `apps/web/tokens.css`. It must include all semantic color, font, spacing, type, easing, duration, rule and radius tokens used by redesigned Human surfaces.

### Tailwind v4 @theme

Tailwind consumes semantic tokens through `apps/web/src/index.css`. New Hallmark surfaces prefer CSS variables or semantic utilities over raw one-off values.

### DTCG tokens.json

No separate DTCG file is emitted in this phase. If MultiSig Tools begins sharing tokens with another product/runtime, export directly from the canonical `apps/web/tokens.css` values rather than manually maintaining a divergent palette.

### shadcn/ui variables

Not currently applicable; the app does not use shadcn/ui. Do not introduce a second token system solely to satisfy a format.

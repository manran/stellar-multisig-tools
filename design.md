# Design — MultiSig Tools

A locked design system for the MultiSig Tools app. Every page redesign reads this file before emitting code. Extend this file when the system needs to grow; do not invent per-page themes.

## Genre

Modern-minimal with editorial authority. Functional pages are restrained workbenches; marketing/content surfaces may use stronger typography but not decorative SaaS chrome.

## Product position

Shared authorization without shared custody.

## Product writing

- Name the user's next action. Use the same meaning on desktop and mobile.
- One screen, one job. Do not explain login credentials and chain signing policy together.
- Use short labels for normal states; explain only when an action is blocked.
- Show security consequences where the action occurs: share-link visibility before sharing, and irreversible ledger submission at confirmation.
- Keep technical evidence in Advanced details and documentation. Do not paste architecture rules into account or landing screens.
- Keep the words Passkey, wallet, Proposal, Sign, Inbox, and Activity consistent.
- The four Tools share one access entry: show `Sign in / Sign up` when signed out; request a verified Stellar wallet only after sign-in, and return users to the tool they opened.
- Contacts and saved Contracts belong to the stable MST User ID, separately by Stellar network; Passkey sign-in can use them without a wallet.
- A linked, verified wallet may copy older signer-scoped contacts and contracts into this user workspace once. Preserve originals and never merge an unlinked wallet.
- Treasury authority and signer-Agent credentials remain wallet/chain scoped. An MST account login does not imply signing rights.

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
- Primary workspace navigation is **Overview · Inbox · New proposal · Activity**.
  - Inbox is the operational default for work that needs a signature, review or submission.
  - New proposal is the only create affordance in the rail; creation leads with payments and saved templates.
  - Overview is a summary and shortcut, not a second Inbox.
  - Activity preserves completed evidence and receipt discovery.
- Contracts, Treasuries and Contacts are **Tools**, visually subordinate in the desktop rail and accessible from the mobile More menu.
- Advanced/operator routes are not promoted into ordinary Human navigation.

## Task-first workbench (November 2026)

A mature product does not expose its domain model as a page outline.
The task and the exact action always dominate supporting technical evidence.

- **Inbox:** compact list with one viewer-action label, title, deadline and summary.
  Select a proposal on desktop to see the **next action first**. Mobile opens
  the proposal directly. Show the exact transaction review in its supporting
  region, and place signer notification history behind a labelled disclosure.
  Do not repeat all signer details in both list and preview.
- **New proposal:** one prominent Payment creation surface, saved Templates
  alongside it when space allows, a quiet XDR import row, then specialized
  Stellar transaction types in an explicit disclosure.
- **Proposal:** business title → current action → workflow context → exact
  review/sign/submission/evidence. Keep the validated safety transitions and
  explicit wallet approval: visual hierarchy must never skip them.
- **Role projection:** the same Request remains authoritative. Human signers
  see their own task, operators see progress and controlled reminders, and
  Agent credentials receive scoped typed tasks. No fabricated signer order or
  inferred approval quorum.

**Component discipline**

- Do not nest decorative cards. Selected work and primary actions may use
  one paper-tinted bounded surface; all other groups use spacing and rules.
- Never pair an unrelated primary CTA with a technical CTA in the same row.
- Icons describe a real navigation destination or action; do not decorate every
  heading. Use the shared Lucide icon set and shared action primitives.
- Treat state labels, sent emails, viewed events, valid signatures, and
  submitted transactions as distinct facts.
- Preserve body readability at 320/375/414/768/1280 widths, one-line action
  controls, and keyboard focus visibility. All data remains live; no mock
  product facts in production UI.

## Operational companion workbenches (November 2026)

Treasury, Contacts and Agent access extend the same task-first workspace.
They do not create a parallel information architecture.

- **Treasuries:** confirmed shared-control accounts are the primary list;
  available accounts remain a distinct opt-in area. Account views lead with
  the on-chain balance, **New proposal**, Activity, and Settings. Exact assets,
  signing thresholds, key powers and signer identities remain on the same page.
  A Treasury name is private metadata, never an on-chain label.
- **Contacts:** signer names and notification email management lead. Other
  saved addresses follow; linked Treasury accounts are references last.
  Search matches full Stellar addresses and names without loading new private
  data. A new contact closes only after the API confirms its save.
- **Agent access:** surface who currently has access before issuing more
  credentials. Treat Read/Write/Sign as cumulative API scopes, not custodial
  authority. Revoke requires a second explicit control. Newly issued secrets
  stay visible immediately after creation until dismissed; revoked credentials
  are opt-in history.
- **Private identity:** names, email addresses, and agent secrets are displayed
  only for the verified wallet/network session. Network and Stellar signer
  authorization remain authoritative across all operational views.

**Interaction rule:** one primary action per resource, secondary actions
beside or below it, and irreversible/revocation operations require explicit
confirmation. Reuse StellarWorkspaceShell, PageHeader, shared action
classes, design tokens and workflow routes. Do not invent new CSS palettes.

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

## Implementation guardrails

- `apps/stellar-web` is the active Stellar Human UI. Use its `tokens.css`, `src/index.css`, and `src/MultiSigUi.tsx` as the runtime design authority; do not copy styles from the older combined `apps/web` tree.
- New primary, secondary, and destructive actions reuse `ActionButton`. Page-level buttons can own behavior and placement, but must not invent their own brand-colored CTA styling.
- Use semantic CSS variables for colors and fonts. Add or revise tokens in `apps/stellar-web/tokens.css`; do not introduce raw hex, RGB, OKLCH, or new Tailwind palette utilities in page/component source.
- `--color-action` is the primary interaction color. Its Mainnet/Testnet value is set at the network boundary. `--color-success`, `--color-warning`, and `--color-danger` retain outcome meaning independently of the network.
- In pull requests, `scripts/check-ui-design.mjs` rejects **new** hard-coded color/font declarations and branded palette utilities in either web source tree. Existing legacy usage is a cleanup backlog, not a reason to disable the rule.
- Proposal signer, wallet-connection, notification, and share-link CTAs in `SigningGuidance.tsx` reuse `ActionButton`; state copy and confirmation remain owned by the business controller.
- Focus outlines must meet 3:1 contrast with the work surface. Action labels must meet 4.5:1 against their fill in both light and dark themes. `apps/stellar-web/src/stellar/designContrast.test.ts` guards these conditions.
- Validate the Proposal workbench on Mainnet and Testnet at 320, 375, 414, 768, and desktop widths before merging. Color changes must never alter wallet, authorization, submission, or routing behavior.

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

The canonical Stellar Human Web runtime values live in `apps/stellar-web/tokens.css`. It must include all semantic color, font, spacing, type, easing, duration, rule and radius tokens used by redesigned Human surfaces.

### Tailwind v4 @theme

Tailwind consumes semantic tokens through `apps/stellar-web/src/index.css`. New Hallmark surfaces prefer CSS variables or semantic utilities over raw one-off values.

### DTCG tokens.json

No separate DTCG file is emitted in this phase. If MultiSig Tools begins sharing tokens with another product/runtime, export directly from the canonical `apps/web/tokens.css` values rather than manually maintaining a divergent palette.

### shadcn/ui variables

Not currently applicable; the app does not use shadcn/ui. Do not introduce a second token system solely to satisfy a format.

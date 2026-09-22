---
title: "Near-Term Development Guide"
description: "Frozen engineering priorities for the current productization phase."
---


**Frozen:** 2026-09-20
**Status:** current product engineering baseline
**Applies to:** the next productization phase after Managed Classic Integration Testnet E2E closure.

## 1. Phase change

The technical product core is feature-frozen for near-term work.

Verified and considered closed at this phase:

- Classic Request authorization and submission.
- Soroban Intent / AUTH / execution separation.
- Human / Agent / Bot / Integration authority boundaries.
- Hosted / Native / Full Headless integration model.
- Managed and external Classic execution.
- PostgreSQL coordination authority and webhook outbox.
- Real Testnet Reference Integration E2E.
- Real Hosted + two-Freighter 2-of-2 E2E.
- Testnet fixed-network deployment boundary.

This does **not** mean there is no future engineering work. It means new product capability is no longer the default priority.

Near-term work order:

1. product language and visual hierarchy;
2. whole-app design system;
3. Human surface redesign;
4. developer documentation reorganization;
5. mobile / accessibility / real-browser regression;
6. only then Mainnet operational hardening.

Mainnet managed Classic remains disabled.

## 2. Freeze boundary

Do not add new workflow engines, authority models, credential classes, persistence models, or parallel state machines unless a concrete regression or external integration proves the existing model insufficient.

Do not reopen casually:

- Request vs Intent separation.
- Classic Treasury signer authority vs transaction-source execution authority.
- Soroban AUTH authority vs executor authority.
- Integration scope is not signer authority.
- Headless core first; UI is a projection/consumer.
- Managed execution is the ordinary default; external execution is progressive disclosure.
- Human workflow: Prepare -> Review -> Sign -> Submit -> Done.
- Proposal spans Sign and Submit; it is not a sixth lifecycle.
- Testnet and Mainnet are separate deployment/runtime boundaries.
- Mainnet managed execution remains off until operational controls are ready.

## 3. Main contradiction for the current phase

The system is technically mature but presents too much of its engineering structure directly to Humans and developers.

The main contradiction is now:

> powerful authority/execution machinery vs a product surface that still exposes too much machinery at once.

Therefore:

- simplify business presentation without weakening authority;
- progressively disclose execution mechanics;
- let page hierarchy answer "what should I do now?" before "how is this implemented?";
- keep exact technical evidence available under Advanced / evidence / developer surfaces.

## 4. Product surface hierarchy

### Human workspace

Primary Human concepts:

- Treasury
- New transaction
- Inbox
- Proposal
- Activity
- Contract
- Receipt

Human pages should prioritize:

1. what is happening;
2. what changes on chain;
3. who must act;
4. what happens next;
5. technical evidence only after the action model is clear.

Do not lead Human pages with:

- Request/Intent storage mechanics;
- channel/executor internals;
- API terminology;
- source-account mechanics unless it is a safety fact the Human must understand.

### Integration / Automation

Progressive integration choices:

- Hosted
- On my site / Native Authorization
- Full Headless

The developer-facing product should make ownership explicit:

- who owns business UI;
- who owns signer interaction;
- who owns execution;
- what MST still verifies regardless of presentation.

### Advanced / Operator

Keep advanced surfaces available but subordinate:

- raw XDR;
- execution/channel inspection;
- Integration administration;
- contract/executor binding;
- persistence/runtime/operator facts.

These are real capabilities, not primary navigation concepts for ordinary users.

## 5. Hallmark redesign contract

The project is a multi-page app. One locked design system applies across all pages.

Source of truth:

- `design.md`
- `tokens.css`
- `apps/internal-docs/content/stellar/product/ux-design-system.md` for Human workflow semantics

Do not give each page an independent theme.

Preserve:

- MultiSig Tools brand and linked-authority mark;
- emerald brand anchor;
- Testnet sky environment identity;
- Inter body/control typography;
- Bitstream Charter display typography;
- Human workflow semantics and shared UI primitives;
- route tree, component ownership, business logic, auth, persistence and API behavior.

Redesign:

- page macrostructure;
- hierarchy;
- spacing rhythm;
- CTA priority;
- navigation/footer voice;
- progressive disclosure;
- dense engineering-card layouts that obscure the primary task.

No production route/component deletion without explicit approval.

## 6. Initial Hallmark audit — ranked findings

### Critical

1. **Structural fingerprint / equal-card workflow**
   - `src/StellarLandingApp.tsx`: the four-step section is a uniform four-column card strip.
   - Effect: reads as a generic SaaS feature grid rather than one continuous authorization story.
   - Direction: convert to one narrative sequence with shared structure, not four isolated tiles.

2. **Footer fingerprint**
   - `src/StellarFooter.tsx`: marketing footer is brand column + three link columns.
   - Effect: generic Product / Resources / Trust SaaS footer.
   - Direction: compact product statement plus a single directory/link field with less categorical chrome.

### Major

3. **Competing primary actions**
   - `src/StellarLandingApp.tsx`: Open workspace / Try live demo / Create a treasury share near-equal CTA weight.
   - Direction: one primary action, one clear secondary; other entry points move into the next decision surface.

4. **Role cards repeat card grammar**
   - `src/StellarLandingApp.tsx`: signer vs treasury-manager is another equal-card grid.
   - Direction: use a task index/list with explicit entry paths.

5. **Testnet hero + two cards**
   - `src/StellarTestnetLandingApp.tsx`: generic hero followed by two equal informational cards.
   - Direction: treat Testnet as an environment notice/workbench entrance, with one compact boundary-facts list.

6. **Token drift**
   - changed page files still use many raw hex / Tailwind color literals despite an existing semantic `tokens.css`.
   - Direction: new/redesigned surfaces consume semantic tokens; migrate only touched files, do not churn unrelated components.

### Minor

7. Header's landing height animation adds chrome movement without adding product information.
8. Historical tiger-tally story is useful brand context but currently interrupts the product proof rhythm.
9. Marketing copy and docs vocabulary need one final pass so Human pages say Proposal while API docs retain Request/Intent where technically required.

## 7. Design rollout order

### Phase A — system + entry surfaces

- lock `design.md`;
- normalize `tokens.css`;
- redesign Mainnet landing;
- redesign Testnet landing;
- simplify shared marketing Header/Footer.

### Phase B — core Human loop

Order:

1. Home/Dashboard
2. Inbox
3. New transaction
4. Review / Signing Room
5. Proposal
6. Receipt
7. Treasury
8. Activity
9. Contracts / Contract Workspace

Acceptance is real task clarity, not visual novelty.

### Phase C — Integration / operator surfaces

- Integration Profile / Admin
- Agent access
- Advanced execution/runtime facts

Preserve progressive disclosure: Managed by default, self-managed execution advanced.

### Phase D — developer docs

Rebuild docs around tasks, not internal modules.

Canonical structure:

- Start
  - What is MultiSig Tools
  - Choose your integration
  - Testnet quickstart
- Core concepts
  - Request vs Intent
  - Authorization
  - Execution
  - Classic vs Soroban
  - Treasury / signer / executor
  - Managed vs external execution
- Classic
- Soroban
- Integration
- Human signing
- API reference
- Recipes
- Security model

The first developer decision page is **Choose your integration**:

- Hosted — MST owns authorization UI.
- On my site — integrator owns UI/wallet UX; MST remains authority verifier.
- Full Headless — Browser/Server/Agent/executor orchestration is integrator-owned.

## 8. Verification contract

Every redesigned page must pass:

- current targeted tests;
- production build;
- `git diff --check`;
- real browser render;
- 320 / 375 / 414 / 768 px mobile/tablet;
- 1280x800 desktop fold for marketing pages;
- no horizontal overflow;
- no two-line primary clickable labels;
- visible focus states;
- reduced-motion behavior;
- dark mode;
- Mainnet/Testnet semantic color separation.

Authority/persistence behavior is not allowed to change as collateral UI work.

## 9. E2E policy after freeze

Do not rerun expensive real-chain E2E merely because a page changed.

Rerun Reference Integration E2E only when changes touch:

- Request/Intent authority;
- signer contribution;
- managed channel execution;
- Hosted signing;
- webhook delivery;
- network/runtime boundary.

Pure visual/layout changes use browser/task regression, not fresh chain transactions.

## 10. Mainnet operational hardening — later gate

Before enabling Mainnet managed Classic:

- explicit channel provisioning/funding;
- channel balance visibility;
- low-funds alerting;
- active lease/pool-capacity visibility;
- spend/quota controls;
- operator runbook and recovery evidence.

These controls protect MST-funded transaction-source mechanics. They must never redefine Treasury signer authority.

## 11. Definition of near-term done

This phase is complete when:

- core Human journeys share one coherent product language;
- visual hierarchy hides implementation detail until needed;
- all primary pages follow `design.md`;
- developer docs lead from integration choice to working recipes;
- docs and UI use consistent Human terminology;
- mobile/browser regressions are clean;
- no technical capability was weakened to obtain a simpler UI.

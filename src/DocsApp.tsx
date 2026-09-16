import { useEffect, type ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  Braces,
  History,
  KeyRound,
  Landmark,
  LockKeyhole,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';
import StellarFooter from './StellarFooter';
import StellarHeader from './StellarHeader';
import { MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS } from './stellar/agentAccessTypes';
import { MAX_ACTIVE_TREASURY_AUDIT_KEYS } from './stellar/boxTypes';
import { STELLAR_MAINNET_ORIGIN, STELLAR_TESTNET_ORIGIN } from './stellar/deploymentOrigins';
import {
  DOCS_AUTOMATION_PATH,
  DOCS_HOME_PATH,
  DOCS_SECTIONS,
  docsPageForPath,
  normalizedDocsPath,
} from './stellar/docsModel';
import { stellarHref } from './workspaceNavigation';

const createRequestExample = `curl -X POST ${STELLAR_MAINNET_ORIGIN}/api/request \\
  -H "Authorization: Bearer $MULTISIG_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: payment-run-20260901-42" \\
  -d '{
    "network": "public",
    "xdr": "AAAA...",
    "externalReference": "payment-run-20260901-42",
    "privateNote": "Prepared by the payment service."
  }'`;

const servicePaymentRequestExample = `curl -X POST ${STELLAR_MAINNET_ORIGIN}/api/request \
  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: payroll-20260915-42" \
  -d '{
    "network": "public",
    "payment": {
      "sourceAccount": "G...TREASURY",
      "payments": [
        {"destination":"G...ALICE","amount":"1000","asset":{"type":"credit","code":"USDC","issuer":"G...ISSUER"}},
        {"destination":"G...BOB","amount":"1500","asset":{"type":"credit","code":"USDC","issuer":"G...ISSUER"}}
      ],
      "memo": "Payroll 2026-09"
    },
    "externalReference": "payroll-20260915-42"
  }'`;

const statusExample = `curl "${STELLAR_MAINNET_ORIGIN}/api/request" \\
  -H "Authorization: Bearer $MULTISIG_AGENT_KEY" \\
  -H "x-multisig-request-id: 0123456789ABCDEF"`;

const contractInterfaceExample = `curl "${STELLAR_TESTNET_ORIGIN}/api/contract-interface?network=testnet&contract=C..."`;

const contractCallExample = `curl -X POST ${STELLAR_TESTNET_ORIGIN}/api/contract-call \\
  -H "Content-Type: application/json" \\
  -d '{
    "network": "testnet",
    "transactionSource": "G...",
    "contractId": "C...",
    "method": "reserve",
    "arguments": {"wallet": "fresnica"},
    "lifetimeSeconds": 3600
  }'`;

const contractPrepareExample = `curl -X POST ${STELLAR_TESTNET_ORIGIN}/api/contract-prepare \\
  -H "Content-Type: application/json" \\
  -d '{"network":"testnet","xdr":"AAAA..."}'`;

const intentCreateExample = `curl -X POST ${STELLAR_TESTNET_ORIGIN}/api/intent \\
  -H "Authorization: Bearer $MULTISIG_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: fresnica-intent-42" \\
  -d '{"network":"testnet","contractId":"C...","method":"reserve","arguments":{"wallet":"G..."}}'`;


const serviceIntentCreateExample = `curl -X POST ${STELLAR_TESTNET_ORIGIN}/api/intent \
  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: fed-intent-42" \
  -d '{"network":"testnet","contractId":"C...","method":"reserve","arguments":{"wallet":"G..."},"executor":"G...EXECUTOR"}'`;

const serviceIntentPrepareExample = `curl -X PUT ${STELLAR_TESTNET_ORIGIN}/api/intent \
  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \
  -H "Content-Type: application/json" \
  -H "X-MultiSig-Intent-Id: 0123456789ABCDEF" \
  -d '{"action":"prepare_execution"}'`;

const serviceIntentRefreshExample = `curl -X PUT ${STELLAR_TESTNET_ORIGIN}/api/intent \
  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \
  -H "Content-Type: application/json" \
  -H "X-MultiSig-Intent-Id: 0123456789ABCDEF" \
  -d '{"action":"refresh_execution"}'`;

function CodeBlock({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-2xl bg-[#111] p-4 text-xs leading-6 text-neutral-100"><code>{children}</code></pre>;
}

function TechnicalDetails({ children }: { children: ReactNode }) {
  return (
    <details className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
      <summary className="cursor-pointer text-sm font-bold">Technical details</summary>
      <div className="mt-3 space-y-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{children}</div>
    </details>
  );
}

function Callout({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex items-center gap-2 font-bold">{icon}{title}</div>
      <div className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{children}</div>
    </div>
  );
}

function StepList({ steps }: { steps: readonly [string, string][] }) {
  return (
    <ol className="space-y-4">
      {steps.map(([title, detail], index) => (
        <li key={title} className="flex gap-4 rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">{index + 1}</div>
          <div>
            <div className="font-bold">{title}</div>
            <p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function PageHeader({ eyebrow, title, summary }: { eyebrow: string; title: string; summary: string }) {
  return (
    <header className="max-w-3xl">
      <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300">{eyebrow}</div>
      <h1 className="mt-3 text-4xl font-bold tracking-[-0.035em] sm:text-5xl">{title}</h1>
      <p className="mt-5 text-lg leading-8 text-neutral-600 dark:text-neutral-300">{summary}</p>
    </header>
  );
}

function DocsNavigation({ currentPath }: { currentPath: string }) {
  return (
    <nav aria-label="Documentation" className="space-y-6">
      <a
        href={stellarHref(DOCS_HOME_PATH)}
        className={`block text-sm font-bold ${currentPath === DOCS_HOME_PATH ? 'text-emerald-700 dark:text-emerald-300' : 'text-neutral-700 hover:text-emerald-700 dark:text-neutral-200 dark:hover:text-emerald-300'}`}
      >
        Docs home
      </a>
      {DOCS_SECTIONS.map((section) => (
        <section key={section.id}>
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-400">{section.label}</div>
          <div className="mt-2 space-y-1">
            {section.pages.map((page) => (
              <a
                key={page.path}
                href={stellarHref(page.path)}
                className={`block rounded-lg px-2 py-1.5 text-sm leading-5 ${currentPath === page.path ? 'bg-emerald-700/10 font-bold text-emerald-800 dark:text-emerald-200' : 'text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-white/5 dark:hover:text-white'}`}
              >
                {page.title}
              </a>
            ))}
          </div>
        </section>
      ))}
    </nav>
  );
}

function DocsHome() {
  const entryCards = [
    {
      icon: <Send className="h-5 w-5" />,
      title: 'I need to sign',
      detail: 'Open a Proposal, verify the exact transaction, and add your signature.',
      path: '/docs/sign-a-proposal',
    },
    {
      icon: <Landmark className="h-5 w-5" />,
      title: 'I manage a Treasury',
      detail: 'Create shared authorization and understand how payment and account-control rules differ.',
      path: '/docs/create-a-treasury',
    },
    {
      icon: <Braces className="h-5 w-5" />,
      title: 'I build automations',
      detail: 'Let software propose prepared transactions without giving it Stellar signing custody.',
      path: DOCS_AUTOMATION_PATH,
    },
  ] as const;

  return (
    <div className="space-y-14">
      <PageHeader
        eyebrow="Documentation"
        title="Do the transaction. Understand the model when you need it."
        summary="MultiSigTools helps people prepare, review, sign, and submit Stellar transactions without passing XDR files around. Start from the task you are trying to complete."
      />

      <section className="grid gap-4 md:grid-cols-3">
        {entryCards.map((card) => (
          <a key={card.path} href={stellarHref(card.path)} className="group rounded-2xl border border-black/10 bg-white p-5 transition hover:-translate-y-0.5 hover:border-emerald-700/30 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="text-emerald-700 dark:text-emerald-300">{card.icon}</div>
            <h2 className="mt-5 text-lg font-bold">{card.title}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{card.detail}</p>
            <div className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-emerald-700 dark:text-emerald-300">Open guide<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></div>
          </a>
        ))}
      </section>

      <section>
        <div className="flex items-center gap-2 text-sm font-bold text-neutral-500 dark:text-neutral-400"><BookOpen className="h-4 w-4" />Transactions</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {DOCS_SECTIONS.find((section) => section.id === 'transactions')?.pages.map((page) => (
            <a key={page.path} href={stellarHref(page.path)} className="flex items-start justify-between gap-5 rounded-2xl border border-black/10 bg-white p-5 hover:border-emerald-700/30 dark:border-white/10 dark:bg-white/[0.03]">
              <div><h2 className="font-bold">{page.title}</h2><p className="mt-1 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{page.summary}</p></div>
              <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-neutral-400" />
            </a>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 text-sm font-bold text-neutral-500 dark:text-neutral-400"><Users className="h-4 w-4" />Understand MultiSigTools</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {DOCS_SECTIONS.find((section) => section.id === 'concepts')?.pages.map((page) => (
            <a key={page.path} href={stellarHref(page.path)} className="rounded-2xl border border-black/10 bg-white p-5 hover:border-emerald-700/30 dark:border-white/10 dark:bg-white/[0.03]">
              <h2 className="font-bold">{page.title}</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{page.summary}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function SignProposalPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Start" title="Sign a Proposal" summary="A Proposal is the shared view around one exact Stellar transaction. Review what it does, then add your signature from your own wallet." />
      <StepList steps={[
        ['Open the Proposal', 'Use the link you received or open it from Inbox. You do not need to create a Treasury before you can participate as a signer.'],
        ['Review the transaction', 'Check the source account, operations, amounts, assets, destinations, memo and any visible signing-policy changes.'],
        ['Sign', 'Your wallet signs the exact transaction. MultiSigTools accepts the signature only if it belongs to the transaction and current signing policy.'],
        ['Submit when appropriate', 'Signing and submitting are separate actions. A transaction may still need other signatures or execution conditions before it can be submitted.'],
      ]} />
      <Callout icon={<ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="Sign is not Submit">
        Your signature authorizes the exact transaction. It does not by itself send the transaction to Stellar, and it does not give MultiSigTools custody of your signing key.
      </Callout>
      <TechnicalDetails>
        <p>MultiSigTools stores a technical Request around the Proposal so signatures and retained History can be coordinated. The transaction body is XDR; wallet signatures remain Stellar transaction signatures over that exact body.</p>
        <p>If the same transaction is changed, its existing signatures do not authorize the changed transaction.</p>
      </TechnicalDetails>
    </div>
  );
}

function CreateTreasuryPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Start" title="Create a Treasury" summary="A Treasury is a Stellar account controlled by a shared signing policy. MultiSigTools helps you design the policy, review the exact account-control transaction, and collect the required signatures." />
      <StepList steps={[
        ['Choose the account', 'Start from the Stellar account whose signing policy you want to change. Keep the account funded for its reserve and transaction fee requirements.'],
        ['Choose the signers', 'Add the people or signer addresses that should participate in payment and account-control decisions.'],
        ['Set payment and control rules', 'Payment authorization can be easier than changing the signing policy itself. MultiSigTools keeps account-control authorization at least as strong as payment authorization in the guided flow.'],
        ['Review and sign the change', 'The policy does not change just because you filled in a form. Review the generated account-control transaction, collect the required signatures, then submit it.'],
      ]} />
      <Callout icon={<KeyRound className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="Keep recovery in mind">
        A signing policy can lock an account if its thresholds become unreachable. Treat signer removal and threshold changes as account-control operations, not ordinary payments.
      </Callout>
      <TechnicalDetails>
        <p>Classic Stellar multisig is implemented with account signers and threshold values. The guided flow builds the necessary <code>SetOptions</code> operations and shows the before → after signing-policy effect during Review.</p>
        <p>The Treasury label in MultiSigTools is a Human workspace around that Stellar account; Stellar account authorization remains the cryptographic source of truth.</p>
      </TechnicalDetails>
    </div>
  );
}

function PaymentPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Transactions" title="Send a payment" summary="Payment is the primary transaction flow: choose who pays, who receives, what asset moves, and how much. MultiSigTools builds the transaction and sends it through Review before anyone signs." />
      <StepList steps={[
        ['Open New → Payment', 'Choose the source account. In Treasury work, the Treasury account can be preselected for you.'],
        ['Enter recipient, asset and amount', 'Use a Stellar address or a saved identity. For credit assets, the destination still needs the required Stellar trustline and receiving capacity.'],
        ['Add context if needed', 'A Stellar memo is public transaction data. Private Note is separate off-chain workflow context and is not written into the transaction memo.'],
        ['Choose transaction lifetime', 'The current transaction can override your saved lifetime. This controls how long the prepared transaction remains valid for signing and submission.'],
        ['Review, then create the Proposal', 'Review is the freeze point. After that, signers coordinate around the exact transaction rather than an editable payment form.'],
      ]} />
      <Callout icon={<Send className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="Review is the boundary">
        Before Review you are editing a payment draft. After the handoff, the Proposal is about one exact Stellar transaction. Changing the payment means creating a different transaction.
      </Callout>
      <TechnicalDetails>
        <p>The current composer uses Stellar Payment operations. MultiSigTools validates the selected asset, destination requirements, source spendability and fee/reserve constraints before handing the transaction to Review.</p>
      </TechnicalDetails>
    </div>
  );
}

function BatchPaymentPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Transactions" title="Send to multiple recipients" summary="Start from Send payment, add another recipient, and MultiSigTools keeps the same Treasury and transaction context while moving to a multiple-recipient transaction. Every row is validated before Review." />
      <StepList steps={[
        ['Open New → Send payment', 'Enter the first recipient, then choose Add another recipient. MultiSigTools carries the source, first transfer, memo, Private Note, and transaction lifetime into the multiple-recipient editor.'],
        ['Validate the structured draft', 'Saved Address Book names must resolve to exactly one address. Asset codes must resolve to exactly one held issuer, or you must enter CODE:ISSUER. Amount precision, duplicates, balances, recipient trustlines and operation count are checked deterministically.'],
        ['Check every row and total', 'The validated table is the point where a parsing mistake should be obvious. Verify recipient, amount, asset and the aggregate totals before moving on.'],
        ['Review the exact transaction', 'Review shows the full payment list again. The batch then follows the normal Sign, Submit and Done flow.'],
      ]} />
      <Callout icon={<ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="Parsing is not transaction authority">
        Input helpers may make data entry easier, but the transaction facts come from deterministic address, asset, precision, balance and destination validation. The first shipped version does not need an LLM to parse ordinary CSV or spreadsheet input.
      </Callout>
      <TechnicalDetails>
        <p>Each row becomes a Stellar <code>Payment</code> operation. Classic Stellar transactions are limited to 100 operations, so one MultiSigTools batch cannot exceed 100 recipients/operations.</p>
        <p>The transaction is atomic: it is not a queue of independent payments. If one operation cannot execute, the transaction does not partially apply the other operations.</p>
      </TechnicalDetails>
    </div>
  );
}

function ClaimablePaymentPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Transactions" title="Send a claimable payment" summary="Send value now without forcing the recipient to receive it immediately. The default MultiSigTools flow also gives the sending Treasury a recovery path if the recipient never claims." />
      <StepList steps={[
        ['Open New → Claimable payment', 'Choose the sending Treasury, recipient, asset and amount. The recipient may be a Stellar address or a unique saved Address Book name.'],
        ['Choose the claim window', 'The Human choice is a simple time window such as 7, 30 or 90 days. The recipient may claim during that window.'],
        ['Keep the recovery path', 'MultiSigTools also makes the sending Treasury a claimant after the same window. If the recipient never claims, the balance is not left permanently without an owner who can recover it.'],
        ['Review, sign and submit', 'Review shows the recipient, amount, asset, claim window and recovery account. The claim window begins when the submitted transaction actually creates the claimable balance.'],
      ]} />
      <Callout icon={<ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="Recovery is the default">
        A recoverable claimable payment reserves one unit for the balance entry plus one for each of its two claimants. MultiSigTools includes all three reserve units in source spendability checks before the transaction reaches signers.
      </Callout>
      <TechnicalDetails>
        <p>The underlying operation is <code>CreateClaimableBalance</code>. The recipient uses a relative-before predicate; the sending Treasury uses the inverse predicate for recovery after the same interval.</p>
        <p>For issued assets, the recipient does not receive the asset at creation time. They must satisfy the asset's trustline and authorization requirements when they later claim it.</p>
      </TechnicalDetails>
    </div>
  );
}

function MultiPartyTransactionPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Transactions" title="Create a multi-party transaction" summary="A multi-party transaction combines payments controlled by different Stellar source accounts into one atomic transaction while preserving each account's independent authorization." />
      <StepList steps={[
        ['Open New → Multi-party transaction', 'Paste rows containing source, destination, amount and asset. At least two independent source accounts are required.'],
        ['Continue to Review', 'MultiSigTools resolves names, assets, balances and destination requirements before opening Review. The first source account is used as the transaction account and pays the transaction fee.'],
        ['Review the whole atomic action', 'Review shows From, To, Amount, Asset and any public Stellar memo for every operation. Use Edit to return to the prepared input. This is one transaction, not several loosely coordinated payment requests.'],
        ['Collect the required signatures', 'Stellar authorization is evaluated separately for the transaction account and every operation source. MultiSigTools reuses the same Proposal signing flow to show what each account still needs.'],
      ]} />
      <Callout icon={<Users className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="One transaction, several authorities">
        Multi-party does not create a new MultiSigTools approval system. It uses Stellar's operation-source model and the existing authorization analysis for every participating account.
      </Callout>
      <TechnicalDetails>
        <p>Each payment operation carries its own Stellar <code>source</code>. The transaction source still supplies the sequence number and must satisfy the transaction-level low-threshold authorization in addition to the operation-source requirements.</p>
        <p>All operations are atomic: either the transaction succeeds as a whole or none of its operations are applied.</p>
      </TechnicalDetails>
    </div>
  );
}

function ProposalConceptPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Concepts" title="Proposal and Transaction" summary="A Transaction is the thing Stellar can execute. A Proposal is the shared MultiSigTools view that lets people understand, sign, submit, and later inspect that exact transaction." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Callout icon={<Landmark className="h-4 w-4 text-neutral-400" />} title="Transaction">
          The exact Stellar operations, source accounts, preconditions, memo, fee and signatures that can be submitted to the network.
        </Callout>
        <Callout icon={<Users className="h-4 w-4 text-neutral-400" />} title="Proposal">
          The Human collaboration surface around that transaction: Review, signatures, status, History and retained evidence.
        </Callout>
      </div>
      <p className="text-base leading-7 text-neutral-700 dark:text-neutral-200">The Proposal follows the transaction rather than one person's browser or one Treasury. That is what allows independent signers to coordinate around the same transaction without sharing custody.</p>
      <TechnicalDetails>
        <p>The server-side coordination record is called a Request. It retains the exact transaction and coordination evidence. Request is an API/storage term; Proposal is the Human product term.</p>
      </TechnicalDetails>
    </div>
  );
}

function MultiPartyConceptPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Concepts" title="Multi-party transactions" summary="One Stellar transaction can contain operations controlled by different source accounts. MultiSigTools keeps those authorization domains independent while coordinating one shared Proposal." />
      <div className="rounded-3xl border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-white/[0.03] sm:p-7">
        <div className="grid gap-3 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="rounded-2xl bg-black/[0.035] p-4 dark:bg-white/[0.05]"><div className="font-bold">Account A</div><div className="mt-1 text-neutral-500 dark:text-neutral-400">its own signers + thresholds</div></div>
          <div className="text-center font-bold text-emerald-700 dark:text-emerald-300">one Proposal</div>
          <div className="rounded-2xl bg-black/[0.035] p-4 dark:bg-white/[0.05]"><div className="font-bold">Account B</div><div className="mt-1 text-neutral-500 dark:text-neutral-400">its own signers + thresholds</div></div>
        </div>
      </div>
      <div className="space-y-3 text-base leading-7 text-neutral-700 dark:text-neutral-200">
        <p>For example, one transaction could move an asset from Account A while another operation moves a different asset from Account B. Both sides may need to authorize the same atomic transaction.</p>
        <p>The Proposal does not become "A's Proposal" or "B's Proposal". It belongs to the transaction and may legitimately appear in more than one account or Treasury view.</p>
      </div>
      <Callout icon={<ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="Authorization stays account-specific">
        A signer who can authorize Account A does not automatically authorize Account B. MultiSigTools evaluates each source account against its own current Stellar signing policy.
      </Callout>
      <TechnicalDetails>
        <p>Stellar operations may specify their own source account. MultiSigTools derives a separate authorization requirement for each transaction/operation source and evaluates signatures against the relevant signer policy.</p>
        <p>Business labels such as company, counterparty or future Party metadata never replace source-account and signer cryptographic truth.</p>
      </TechnicalDetails>
    </div>
  );
}

function SignUnlockConceptPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Concepts" title="Sign and Unlock" summary="Signing proves participation in one exact transaction. Unlock proves that the current browser user controls a signer identity for broader private workspace access. They are intentionally different." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Callout icon={<Send className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="Sign">
          Adds a Stellar signature to one exact transaction. A verified signer is already a MultiSigTools participant; no separate registration or Treasury creation is required.
        </Callout>
        <Callout icon={<LockKeyhole className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="Unlock">
          Uses a fresh wallet identity proof to open broader private views such as Inbox or account-wide Activity for a limited session.
        </Callout>
      </div>
      <p className="text-base leading-7 text-neutral-700 dark:text-neutral-200">This separation matters because a signed transaction can be forwarded. Possessing signed XDR is evidence that an address signed that transaction, but it is not proof that the current browser is that signer for every private resource.</p>
      <TechnicalDetails>
        <p>Normal private sessions use the configured Unlock duration. MultiSigTools prefers SEP-53 message signing with its defined SEP-10 fallback.</p>
        <p>After a newly accepted, attributable signature, the same Request may receive a fixed 15-minute Request-scoped Contribution Grant so the signer can continue into that Proposal's retained details without a second prompt. It does not unlock global Activity, Inbox, Treasury administration or other Requests.</p>
      </TechnicalDetails>
    </div>
  );
}

function HistoryPrivacyConceptPage() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Concepts" title="Activity, History and privacy" summary="Ledger facts, MultiSigTools coordination history, and private workflow context are related but not the same thing. The product keeps those visibility boundaries explicit." />
      <div className="space-y-4">
        <Callout icon={<History className="h-4 w-4 text-neutral-400" />} title="Activity">
          Your signer-oriented work view: Proposals you actually participated in, plus retained events that are authorized for your current private session.
        </Callout>
        <Callout icon={<BookOpen className="h-4 w-4 text-neutral-400" />} title="Transaction Receipt and History">
          The retained evidence around one finished or historical transaction, including canonical in-product signer facts when MultiSigTools observed them.
        </Callout>
        <Callout icon={<LockKeyhole className="h-4 w-4 text-neutral-400" />} title="Private Note">
          Off-chain workflow context stored by MultiSigTools. It is not written into the Stellar transaction and it is not end-to-end encrypted in the current product.
        </Callout>
      </div>
      <p className="text-base leading-7 text-neutral-700 dark:text-neutral-200">A public Stellar transaction can be independently verified on the network. Private coordination context needs separate access control; auditability does not mean every participant should see every private field.</p>
      <div className="flex flex-wrap gap-3">
        <a href={stellarHref('/privacy')} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">Privacy notice</a>
        <a href={stellarHref('/activity')} className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">Open Activity</a>
      </div>
      <TechnicalDetails>
        <p>MultiSigTools treats Request state and Human History as projections over canonical transaction/evidence facts. New accepted signatures persist attributable signer evidence when the signer can be resolved at acceptance time; legacy facts may still be reconstructed from XDR.</p>
      </TechnicalDetails>
    </div>
  );
}

function AutomationPage() {
  return (
    <div className="space-y-12">
      <div>
        <PageHeader eyebrow="Agents" title="Agent API" summary="Give an Agent delegated access to the same signer-oriented workspace you use: names, Inbox, Activity, Requests, and—only with explicit Sign access—signature contribution." />
        <div className="mt-7 flex flex-wrap gap-3">
          <a href={stellarHref('/agent-access')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">Open Agent access<ArrowRight className="h-4 w-4" /></a>
          <a href="#permissions" className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10">Permissions</a>
        </div>
      </div>

      <section id="permissions" className="grid gap-4 md:grid-cols-3">
        {[
          ['Read', 'Read saved contracts, personal contacts, accessible Treasury metadata, Inbox, Activity, Request details and status.'],
          ['Write', 'Includes Read. Keep or forget contracts, update personal contacts, create Signing Requests and shared contract authorization, refresh/freeze preparation, and decline.'],
          ['Sign', 'Includes Write. Submit signed XDR and contribute valid Stellar transaction or detached Soroban authorization signatures attributable to the credential Principal.'],
        ].map(([title, detail]) => (
          <article key={title} className="rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
            <h2 className="font-bold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{detail}</p>
          </article>
        ))}
      </section>

      <section className="space-y-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Principal and Actor</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">The Principal is the Stellar signer that granted access. Each credential is a separate Agent actor. Multiple Agents can share one Principal while remaining independently named, scoped, audited and revocable.</p>
        </div>
        <Callout icon={<ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />} title="Sign does not contain a private key">
          A Sign credential is permission to perform API actions carrying cryptographic authorization. MultiSig Tools independently verifies newly contributed signatures against the Principal. When an Agent uploads already-signed XDR, Activity can prove which signer signed and which Agent credential submitted it; it does not claim the Agent generated that signature.
        </Callout>
      </section>

      <section className="space-y-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Compose Headless operations</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Start from the deployment origin: its standard <code>service-desc</code> link resolves to <code>/openapi.json</code>, while <code>GET /api/operations</code> lists the stable business operations and their OpenAPI path/method pointers. The Web UI, CLI, Agent, bot, and script clients consume the same versioned contract operations; transport adapters do not own separate transaction semantics.</p>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">The runtime origin is network-bound: <code>{STELLAR_MAINNET_ORIGIN}</code> is Mainnet and <code>{STELLAR_TESTNET_ORIGIN}</code> is Testnet. Documentation is shared, but API calls must use the origin that owns the selected network.</p>
        </div>
        <CodeBlock>{contractInterfaceExample}</CodeBlock>
        <CodeBlock>{contractCallExample}</CodeBlock>
        <CodeBlock>{contractPrepareExample}</CodeBlock>
        <CodeBlock>{intentCreateExample}</CodeBlock>
        <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300"><code>contract.intent.create</code> starts from semantic contract intent without constructing a final transaction. Detached AUTH is contributed with <code>PATCH /api/intent</code>; only after authorization is ready does <code>PUT /api/intent</code> load fresh source state, enforce the reviewed effects, and return the final unsigned execution package. <code>SOURCE_ACCOUNT</code> authorization is rejected because it would bind AUTH back to the transaction source. The lower-level <code>contract.call.build</code> and <code>contract.call.prepare</code> operations remain available for diagnostics and external tooling.</p>
        <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">Guided contract input supports optional Stellar addresses directly: for <code>Option&lt;Address&gt;</code> or <code>Option&lt;MuxedAddress&gt;</code>, omit the argument for <code>None</code>, or send a normal address string for <code>Some(address)</code>. This remains a semantic Intent; Integration Services do not need prepared XDR for these inputs.</p>
        <TechnicalDetails>
          <h3 className="font-bold text-neutral-900 dark:text-white">Integration Service executor shortcut</h3>
          <p>A Service may include <code>executor</code> when creating the Intent. That Intent-level value wins over the Service default; otherwise the configured default is snapshotted into the Intent. If neither exists, recording simulation still works with the deployment planning source, but that planning account never becomes the executor.</p>
          <CodeBlock>{serviceIntentCreateExample}</CodeBlock>
          <p>After AUTH is ready, <code>prepare_execution</code> uses the already-bound executor. If the Intent is still unresolved, the Service may include <code>executor</code> on this PUT; if it omits one and managed execution is configured, MultiSig Tools takes the managed execution route.</p>
          <CodeBlock>{serviceIntentPrepareExample}</CodeBlock>
          <p>If the package was lost, expired, or failed to submit, <code>refresh_execution</code> rebuilds a fresh package with the same bound executor and all enforcing checks repeated. Refresh cannot replace the executor.</p>
          <CodeBlock>{serviceIntentRefreshExample}</CodeBlock>
          <p>The response includes the unsigned XDR plus transaction hash, sequence, validity, latest ledger, AuthorizationPlan digest/revision, executor provenance, effects, effects diff, and preparation time. Preparation evidence is durable; returning XDR does not by itself mean handoff, submission, or confirmation.</p>
        </TechnicalDetails>
      </section>

      <section id="quick-start" className="space-y-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Create a Signing Request</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300"><code>POST /api/request</code> is the same Request endpoint used by the Human product. Signer Agents may create from exact unsigned XDR. Integration Services can instead send semantic <code>payment</code> business input for a configured Classic source account; MultiSig Tools loads fresh sequence/fee/state, builds the exact unsigned transaction, freezes it into the ordinary Request lifecycle, and keeps exact XDR as an advanced escape hatch. Agent and Integration creation require <code>Idempotency-Key</code>.</p>
        </div>
        <CodeBlock>{createRequestExample}</CodeBlock>
        <CodeBlock>{servicePaymentRequestExample}</CodeBlock>
        <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">A signer Agent credential is bound to one signer Principal and network. An Integration Service is instead bounded by configured business scope such as Classic source accounts; that scope never supplies a Stellar signature.</p>
        <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">Integration credentials are provisioned by a MultiSig Tools operator, not by the Service itself. The operator sets exact network/account/contract/executor scope and gives the Service its one-time <code>msi_...</code> credential; later scope changes, disable, and key rotation remain operator-controlled.</p>
      </section>

      <section className="space-y-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Signer workspace endpoints</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Use the same Bearer credential across <code>/api/contracts</code>, <code>/api/treasuries</code>, <code>/api/address-book</code>, <code>/api/inbox</code>, <code>/api/activity</code>, and the unified <code>/api/request</code> create/read/contribute surface.</p>
        </div>
        <CodeBlock>{statusExample}</CodeBlock>
        <div className="grid gap-3 sm:grid-cols-2">
          <Callout icon={<History className="h-4 w-4 text-neutral-400" />} title="Inbox is signer-owned">Inbox answers what this Principal needs to review or sign. It does not belong to a Treasury or to the Agent itself.</Callout>
          <Callout icon={<ShieldCheck className="h-4 w-4 text-neutral-400" />} title="Final submission stays separate">Sign access contributes Stellar authorization. Agent credentials do not submit a Ready transaction to Stellar in the current API.</Callout>
        </div>
      </section>

      <section id="audit-access" className="rounded-3xl border border-black/10 bg-white p-6 dark:border-white/10 dark:bg-white/[0.03] sm:p-7">
        <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-neutral-400" /><h2 className="text-xl font-bold">Treasury Audit access</h2></div>
        <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">Treasury Settings has a separate resource-owned Audit credential. It is fixed read-only and can view that Treasury's Activity only. It has no Inbox, personal contacts, Request creation, signing, submission, or Treasury administration authority.</p>
        <p className="mt-3 text-xs text-neutral-500">Up to {MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS} active Agent credentials per signer/network and {MAX_ACTIVE_TREASURY_AUDIT_KEYS} active Audit credentials per Treasury.</p>
      </section>
    </div>
  );
}

function DocsNotFound() {
  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Documentation" title="Page not found" summary="This documentation path does not exist. Use the task-oriented Docs navigation to continue." />
      <a href={stellarHref(DOCS_HOME_PATH)} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">Back to Docs<ArrowRight className="h-4 w-4" /></a>
    </div>
  );
}

function pageContent(path: string) {
  switch (path) {
    case DOCS_HOME_PATH: return <DocsHome />;
    case '/docs/sign-a-proposal': return <SignProposalPage />;
    case '/docs/create-a-treasury': return <CreateTreasuryPage />;
    case '/docs/transactions/payment': return <PaymentPage />;
    case '/docs/transactions/batch-payment': return <BatchPaymentPage />;
    case '/docs/transactions/claimable-payment': return <ClaimablePaymentPage />;
    case '/docs/transactions/multi-party': return <MultiPartyTransactionPage />;
    case '/docs/concepts/proposal-and-transaction': return <ProposalConceptPage />;
    case '/docs/concepts/multi-party-transactions': return <MultiPartyConceptPage />;
    case '/docs/concepts/sign-and-unlock': return <SignUnlockConceptPage />;
    case '/docs/concepts/history-and-privacy': return <HistoryPrivacyConceptPage />;
    case DOCS_AUTOMATION_PATH: return <AutomationPage />;
    default: return <DocsNotFound />;
  }
}

export default function DocsApp() {
  const currentPath = normalizedDocsPath(window.location.pathname);
  const currentPage = docsPageForPath(window.location.pathname);
  const title = currentPath === DOCS_HOME_PATH ? 'Docs' : currentPage?.title;

  useEffect(() => {
    document.title = `${title ?? 'Page not found'} | MultiSig Tools`;
  }, [title]);

  return (
    <div className="min-h-screen bg-[#f6f6f2] text-[#171717] dark:bg-[#090909] dark:text-[#f5f5f0]">
      <StellarHeader />
      <div className="mx-auto w-full max-w-[1320px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="mb-8 space-y-4 lg:hidden">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-500">
            <BookOpen className="h-4 w-4" />
            <a href={stellarHref(DOCS_HOME_PATH)} className="hover:text-emerald-700 dark:hover:text-emerald-300">Docs</a>
            {title && title !== 'Docs' && <><span>/</span><span className="truncate text-neutral-800 dark:text-neutral-200">{title}</span></>}
          </div>
          <details className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <summary className="cursor-pointer text-sm font-bold">Browse Docs</summary>
            <div className="mt-5"><DocsNavigation currentPath={currentPath} /></div>
          </details>
        </div>
        <div className="grid gap-10 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-14">
          <aside className="hidden lg:block">
            <div className="sticky top-24"><DocsNavigation currentPath={currentPath} /></div>
          </aside>
          <main className="min-w-0 max-w-4xl">{pageContent(currentPath)}</main>
        </div>
      </div>
      <StellarFooter />
    </div>
  );
}

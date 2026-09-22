import StellarWorkspaceShell from './StellarWorkspaceShell';

function Privacy() {
  return <>
    <h1 className="text-4xl font-bold tracking-tight">Privacy Notice</h1>
    <p className="mt-3 text-sm text-neutral-500">Effective September 1, 2026 · Beta</p>
    <div className="mt-8 space-y-7 text-sm leading-7 text-neutral-700 dark:text-neutral-200">
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Non-custodial service</h2><p className="mt-2">MultiSig Tools coordinates Stellar transactions and authorization. It does not ask for or store Stellar seed phrases or private signing keys.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Data we process</h2><p className="mt-2">Depending on the feature, the service may process public Stellar addresses and signer state; transaction XDR, hashes, signatures and submission results; Request lifecycle and participant records; personal Address Book aliases; shared Treasury Box names; Agent/Audit credential metadata and verifier hashes; optional Private Note plaintext; and operational/security logs.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Private Note</h2><p className="mt-2">Private Note is off-chain private service data, not end-to-end encrypted data. MultiSig Tools infrastructure can process the plaintext. Stellar transaction signatures do not attest the text of an off-chain Private Note. Private Note plaintext is not intentionally copied into Box audit events or ordinary application logs.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Agent and Audit credentials</h2><p className="mt-2">Signer-owned Agent credentials and Treasury Audit credentials are displayed only at creation. MultiSig Tools stores one-way verifier hashes plus non-secret management metadata. A credential secret is not a Stellar private key and does not itself satisfy a Stellar signing threshold.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Blockchain publication</h2><p className="mt-2">Stellar ledger data is public. Once a transaction is accepted by Stellar, public transaction data is outside MultiSig Tools' deletion or reversal control.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Retention and audit</h2><p className="mt-2">Request expiry closes active collaboration; it does not trigger scheduled physical deletion of accepted Request, signature, submission, participant, Activity, or administration records. Private payload is also retained with the accepted Request in the current beta. Current audit storage is application append-only storage, not a representation of regulatory WORM or tamper-proof infrastructure.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Infrastructure</h2><p className="mt-2">The service depends on hosting/storage providers and Stellar network services such as Horizon/RPC. Those providers may process ordinary network metadata under their own policies.</p></section>
      <p className="rounded-xl bg-black/[0.035] p-4 text-xs text-neutral-500 dark:bg-white/[0.04] dark:text-neutral-400">This beta notice is an operational disclosure, not a substitute for legal review required by a regulated or commercial deployment.</p>
    </div>
  </>;
}

function Terms() {
  return <>
    <h1 className="text-4xl font-bold tracking-tight">Beta Terms of Service</h1>
    <p className="mt-3 text-sm text-neutral-500">Effective September 1, 2026 · Beta</p>
    <div className="mt-8 space-y-7 text-sm leading-7 text-neutral-700 dark:text-neutral-200">
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Service role</h2><p className="mt-2">MultiSig Tools provides non-custodial tools for preparing, reviewing, coordinating signatures for and submitting Stellar transactions. It is not a bank, exchange, broker, custodian, fiduciary or financial adviser.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Transaction responsibility</h2><p className="mt-2">You are responsible for reviewing the exact network, source, operations, amounts, assets, counterparties, signer policy and transaction conditions before authorizing or submitting. A Request, Inbox item, Box name, Private Note or API-origin label does not itself prove legitimacy. Accepted blockchain transactions may be irreversible.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Agent access</h2><p className="mt-2">A Stellar signer may delegate a named Agent credential with Read, Write, or Sign access. The credential identifies a distinct Agent actor operating for that signer Principal; it is not a Stellar private key. Treasury Audit credentials are separate observer-only credentials and cannot create Requests or contribute signatures.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Private data</h2><p className="mt-2">Private service storage is not represented as end-to-end encryption. Accepted Proposal/private context may be retained after signing closes as described in the Privacy Notice. Do not place seed phrases, private signing keys, API secrets or unnecessary regulated personal data in Private Note.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Availability and execution</h2><p className="mt-2">The beta service depends on Stellar, wallets, Horizon/RPC and hosting/storage providers and has no guaranteed SLA. A Request marked Ready is not necessarily submitted or accepted; sequence, ledger state, fees, time bounds, signer changes and other conditions can still cause failure.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Service protection</h2><p className="mt-2">Do not bypass authorization, access another user's private data, overload endpoints or distribute malicious payloads. MultiSig Tools may rate-limit, block, revoke credentials or suspend features to protect users and infrastructure.</p></section>
      <section><h2 className="text-lg font-bold text-neutral-950 dark:text-white">Beta changes</h2><p className="mt-2">Features, APIs, limits, storage and retention behavior may change during beta. Maintain independent backups, signer recovery, reconciliation and operational controls appropriate to the value you manage.</p></section>
      <p className="rounded-xl bg-black/[0.035] p-4 text-xs text-neutral-500 dark:bg-white/[0.04] dark:text-neutral-400">Operator identity, legal contact, governing law and dispute/jurisdiction terms still require completion before a public commercial launch. These beta terms intentionally do not invent those facts.</p>
    </div>
  </>;
}

export default function LegalApp() {
  const terms = window.location.pathname.endsWith('/terms');
  return <StellarWorkspaceShell active="detail"><main className="px-4 py-8 sm:px-6 lg:px-8 lg:py-10"><article className="mx-auto max-w-3xl">{terms ? <Terms /> : <Privacy />}</article></main></StellarWorkspaceShell>;
}

import type { ReactNode } from 'react';
import {
  ArrowRight,
  Bot,
  Braces,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Server,
  ShieldCheck,
  WalletCards,
  Webhook,
} from 'lucide-react';
import { MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS } from './stellar/agentAccessTypes';
import { MAX_ACTIVE_TREASURY_AUDIT_KEYS } from './stellar/boxTypes';
import {
  STELLAR_MAINNET_ORIGIN,
  STELLAR_TESTNET_ORIGIN,
} from './stellar/deploymentOrigins';
import {
  DOCS_AUTOMATION_PATH,
  DOCS_DEVELOPER_API_PATH,
  DOCS_DEVELOPER_CLASSIC_PATH,
  DOCS_DEVELOPER_QUICKSTART_PATH,
  DOCS_DEVELOPER_SECURITY_PATH,
  DOCS_DEVELOPER_SOROBAN_PATH,
} from './stellar/docsModel';
import { stellarHref } from './workspaceNavigation';

function DevCode({ children }: { children: string }) {
  return <pre className="mst-doc-code"><code>{children}</code></pre>;
}

function DevCallout({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <aside className="mst-doc-callout">
      <div className="mst-doc-callout__title">{icon}<span>{title}</span></div>
      <div className="mst-doc-callout__body">{children}</div>
    </aside>
  );
}

function DevHeader({
  eyebrow,
  title,
  summary,
}: {
  eyebrow: string;
  title: string;
  summary: string;
}) {
  return (
    <header className="mst-doc-header">
      <div className="mst-doc-eyebrow">{eyebrow}</div>
      <h1 className="mst-doc-title">{title}</h1>
      <p className="mst-doc-lede">{summary}</p>
    </header>
  );
}

function DevSteps({ steps }: { steps: readonly [string, ReactNode][] }) {
  return (
    <ol className="mst-doc-steps">
      {steps.map(([title, detail], index) => (
        <li key={title} className="mst-doc-step">
          <span className="mst-doc-step__number">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <h2 className="mst-doc-step__title">{title}</h2>
            <div className="mst-doc-step__body">{detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function DevLink({
  href,
  title,
  detail,
  icon,
}: {
  href: string;
  title: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <a href={href} className="mst-doc-link-row">
      <span className="mst-doc-link-row__icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <span className="mst-doc-link-row__detail">{detail}</span>
      </span>
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}

const runtimeConfigExample = [
  'curl ' + STELLAR_TESTNET_ORIGIN + '/api/runtime-config',
].join('\n');

const classicRequestExample = [
  'curl -X POST ' + STELLAR_TESTNET_ORIGIN + '/api/request \\',
  '  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Idempotency-Key: payroll-test-001" \\',
  "  -d '{",
  '    "network": "testnet",',
  '    "payment": {',
  '      "sourceAccount": "G...TREASURY",',
  '      "payments": [',
  '        {"destination":"G...RECIPIENT","amount":"1","asset":{"type":"native"}}',
  '      ],',
  '      "memo": "Test payment"',
  '    },',
  '    "externalReference": "payroll-test-001"',
  "  }'",
].join('\n');

const sorobanIntentExample = [
  'curl -X POST ' + STELLAR_TESTNET_ORIGIN + '/api/intent \\',
  '  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Idempotency-Key: contract-test-001" \\',
  "  -d '{",
  '    "network": "testnet",',
  '    "contractId": "C...CONTRACT",',
  '    "method": "transfer",',
  '    "arguments": {"from":"G...","to":"G...","amount":"1"}',
  "  }'",
].join('\n');

const issueBrowserCapabilityExample = [
  'curl -X PUT ' + STELLAR_TESTNET_ORIGIN + '/api/intent \\',
  '  -H "Authorization: Bearer $MULTISIG_INTEGRATION_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "X-MultiSig-Intent-Id: 0123456789ABCDEF" \\',
  "  -d '{",
  '    "action": "issue_browser_authorization",',
  '    "signerAddress": "G...SIGNER",',
  '    "origin": "https://app.example"',
  "  }'",
].join('\n');

const browserInspectExample = [
  'curl ' + STELLAR_TESTNET_ORIGIN + '/api/intent \\',
  '  -H "X-MultiSig-Intent-Id: 0123456789ABCDEF" \\',
  '  -H "X-MultiSig-Intent-Capability: $MULTISIG_BROWSER_CAPABILITY" \\',
  '  -H "Origin: https://app.example"',
].join('\n');

const apiDiscoveryExample = [
  'curl ' + STELLAR_TESTNET_ORIGIN + '/api/operations',
  'curl ' + STELLAR_TESTNET_ORIGIN + '/openapi.json',
].join('\n');

const agentRequestExample = [
  'curl -X POST ' + STELLAR_TESTNET_ORIGIN + '/api/request \\',
  '  -H "Authorization: Bearer $MULTISIG_AGENT_KEY" \\',
  '  -H "Content-Type: application/json" \\',
  '  -H "Idempotency-Key: agent-request-001" \\',
  "  -d '{",
  '    "network": "testnet",',
  '    "xdr": "AAAA...",',
  '    "externalReference": "agent-request-001"',
  "  }'",
].join('\n');

const agentStatusExample = [
  'curl ' + STELLAR_TESTNET_ORIGIN + '/api/request \\',
  '  -H "Authorization: Bearer $MULTISIG_AGENT_KEY" \\',
  '  -H "X-MultiSig-Request-Id: 0123456789ABCDEF"',
].join('\n');

export function DeveloperHubPage() {
  return (
    <div className="mst-doc-page">
      <DevHeader
        eyebrow="Developers"
        title="Choose your integration"
        summary="MultiSig Tools has one authorization core. Choose how much presentation and orchestration your product owns; the underlying Request, Intent, signer checks, effects checks, and execution policy stay authoritative in MultiSig Tools."
      />

      <section>
        <div className="mst-doc-section-heading">
          <div className="mst-doc-eyebrow">Integration depth</div>
          <h2>Take over only the layers you actually need.</h2>
        </div>

        <div className="mst-doc-choice-list">
          <div className="mst-doc-choice">
            <div className="mst-doc-choice__icon"><WalletCards className="h-5 w-5" /></div>
            <div>
              <h3>Hosted</h3>
              <p>Your service creates and tracks work. MultiSig Tools renders the signer review/signing surface through the returned review URL. This is the shortest integration path.</p>
              <div className="mst-doc-choice__meta">You own: business flow · MultiSig Tools owns: signer UI</div>
            </div>
          </div>

          <div className="mst-doc-choice">
            <div className="mst-doc-choice__icon"><Braces className="h-5 w-5" /></div>
            <div>
              <h3>On my site</h3>
              <p>Your product owns the signer UI and wallet UX. For Soroban Intents today, the owning Service can issue a short-lived signer/origin/current-plan browser capability and let the browser inspect and contribute AUTH directly.</p>
              <div className="mst-doc-choice__meta">Native Browser authorization is currently Intent/Soroban-scoped; Hosted remains the universal Human fallback.</div>
            </div>
          </div>

          <div className="mst-doc-choice">
            <div className="mst-doc-choice__icon"><Server className="h-5 w-5" /></div>
            <div>
              <h3>Full Headless</h3>
              <p>Your UI, server, wallet adapters, Agents, webhook consumer, and executor orchestrate the stable API operations directly. MultiSig Tools still verifies authority, plan identity, signatures, effects, expiry, and execution evidence.</p>
              <div className="mst-doc-choice__meta">You take over orchestration, not authority.</div>
            </div>
          </div>
        </div>
      </section>

      <DevCallout icon={<ShieldCheck className="h-4 w-4" />} title="One Integration can mix modes">
        <p>Use Native authorization for your default Soroban wallet flow, keep Hosted as a fallback for unsupported wallets, and use the same <code>msi_*</code> credential plus webhook on your backend. Transport does not change Intent identity.</p>
      </DevCallout>

      <section>
        <div className="mst-doc-section-heading">
          <div className="mst-doc-eyebrow">Next</div>
          <h2>Start with the workload you need to authorize.</h2>
        </div>
        <div className="mst-doc-link-list">
          <DevLink href={stellarHref(DOCS_DEVELOPER_QUICKSTART_PATH)} title="Testnet quickstart" detail="Prove the integration boundary before touching Mainnet assets." icon={<FlaskConical className="h-5 w-5" />} />
          <DevLink href={stellarHref(DOCS_DEVELOPER_CLASSIC_PATH)} title="Classic integration" detail="Semantic payments, Treasury signer authority, and managed/external execution." icon={<WalletCards className="h-5 w-5" />} />
          <DevLink href={stellarHref(DOCS_DEVELOPER_SOROBAN_PATH)} title="Soroban integration" detail="Intent, AUTH collection, browser authorization, effects, and execution binding." icon={<Braces className="h-5 w-5" />} />
          <DevLink href={stellarHref(DOCS_DEVELOPER_API_PATH)} title="API and webhooks" detail="Operation discovery, OpenAPI, idempotency, Job state, and delivery." icon={<Webhook className="h-5 w-5" />} />
          <DevLink href={stellarHref(DOCS_DEVELOPER_SECURITY_PATH)} title="Security model" detail="Service identity is not signer authority; execution is not authorization." icon={<ShieldCheck className="h-5 w-5" />} />
          <DevLink href={stellarHref(DOCS_AUTOMATION_PATH)} title="Agent API" detail="Delegate signer-scoped Read, Write, or Sign access to an Agent actor." icon={<Bot className="h-5 w-5" />} />
        </div>
      </section>
    </div>
  );
}

export function DeveloperQuickstartPage() {
  return (
    <div className="mst-doc-page">
      <DevHeader
        eyebrow="Developers · Start"
        title="Testnet quickstart"
        summary="Use the Testnet deployment to prove scope, authorization, execution, and status delivery before any Mainnet rollout. The Testnet and Mainnet runtimes are separate and cannot be switched inside one deployment."
      />

      <DevSteps steps={[
        ['Get a scoped Integration Profile', <p key="profile">An operator provisions one Testnet Integration Profile with the exact Classic Treasuries and/or Soroban contract methods your service may use. The resulting <code>msi_*</code> value is the API credential for that profile; it is not Stellar signer authority.</p>],
        ['Inspect deployment capability', <div key="runtime"><p>Check what this deployment can actually execute before promising a managed route.</p><DevCode>{runtimeConfigExample}</DevCode></div>],
        ['Create one real Testnet work item', <p key="create">Use a semantic Classic payment Request or a Soroban Intent. Always send an <code>Idempotency-Key</code> from machine callers so retries cannot create duplicate work.</p>],
        ['Give the signer the appropriate surface', <p key="review">Hosted: open the returned review URL. Native Soroban: issue a signer/origin/current-plan browser capability. Full Headless: use the stable operations directly.</p>],
        ['Observe completion from canonical state', <p key="observe">Webhook is a notification, not the source of truth. Deduplicate the event, then GET the current Request/Intent/Job before acting.</p>],
      ]} />

      <div className="mst-doc-two-up">
        <DevLink href={stellarHref(DOCS_DEVELOPER_CLASSIC_PATH)} title="Try Classic" detail="Create a semantic Testnet payment Request." icon={<WalletCards className="h-5 w-5" />} />
        <DevLink href={stellarHref(DOCS_DEVELOPER_SOROBAN_PATH)} title="Try Soroban" detail="Create a semantic Testnet contract Intent." icon={<Braces className="h-5 w-5" />} />
      </div>

      <DevCallout icon={<FlaskConical className="h-4 w-4" />} title="Do not infer Mainnet readiness from Testnet managed execution">
        <p>Managed Classic is capability-gated per deployment/network. Query runtime capability and Integration execution scope. Mainnet channel provisioning/funding is an explicit operator responsibility; Testnet Friendbot behavior is not a Mainnet contract.</p>
      </DevCallout>
    </div>
  );
}

export function ClassicIntegrationPage() {
  return (
    <div className="mst-doc-page">
      <DevHeader
        eyebrow="Developers · Classic"
        title="Create Classic work from business intent"
        summary="For scoped Integration Services, semantic payment creation lets MultiSig Tools construct the exact transaction from current Stellar state instead of making your service own sequence, fee, and XDR mechanics by default."
      />

      <DevCallout icon={<KeyRound className="h-4 w-4" />} title="Treasury signer authority stays on Stellar">
        <p>The Treasury remains the Payment operation source and its current Stellar signers/thresholds remain the authorization authority. An <code>msi_*</code> credential can create work only inside its configured Treasury scope; it does not supply a Treasury signature.</p>
      </DevCallout>

      <section>
        <div className="mst-doc-section-heading">
          <div className="mst-doc-eyebrow">Create</div>
          <h2>Send semantic payment input.</h2>
        </div>
        <DevCode>{classicRequestExample}</DevCode>
        <p className="mst-doc-body">The response is the ordinary Request/Proposal lifecycle used by Human flows. It includes the current execution projection and a signer review URL where applicable. Exact unsigned XDR remains an advanced escape hatch; semantic creation is the path that can safely reconstruct transaction-source mechanics.</p>
      </section>

      <section>
        <div className="mst-doc-section-heading">
          <div className="mst-doc-eyebrow">Execution</div>
          <h2>Managed by default when the deployment can support it.</h2>
        </div>
        <div className="mst-doc-fact-list">
          <div><strong>Managed Classic</strong><span>MultiSig Tools supplies a channel account as transaction source, sequence, fee, and submission path. The Treasury still owns the Payment operation and authorization.</span></div>
          <div><strong>Manage execution myself</strong><span>Your service owns transaction source/sequence/submission for Treasuries explicitly configured for external execution.</span></div>
          <div><strong>No silent rewrite</strong><span>Raw XDR is never silently rewritten into a managed-channel transaction. Managed reconstruction is available for semantic creation because the business intent is explicit.</span></div>
        </div>
      </section>

      <DevCallout icon={<CheckCircle2 className="h-4 w-4" />} title="Why the channel account does not become a Treasury signer">
        <p>The managed channel is pre-authorized only for transaction-source authority. Treasury signatures still authorize the Payment operation under the Treasury account's live signer policy. MultiSig Tools cannot replace those signatures with the channel key.</p>
      </DevCallout>
    </div>
  );
}

export function SorobanIntegrationPage() {
  return (
    <div className="mst-doc-page">
      <DevHeader
        eyebrow="Developers · Soroban"
        title="Create an Intent, then collect AUTH"
        summary="Soroban Integration starts from contract + method + arguments. MultiSig Tools plans the current authorization requirements, keeps detached AUTH separate from the transaction shell, and prepares execution only after authorization is ready."
      />

      <DevCode>{sorobanIntentExample}</DevCode>

      <DevSteps steps={[
        ['Create the Intent', <p key="intent">The Integration Profile must allow the contract and method. Empty method scope means no access, never wildcard access.</p>],
        ['Collect authorization', <p key="auth">Hosted review can collect AUTH in MultiSig Tools. Native authorization can keep the signer on your site by issuing a plan-scoped browser capability.</p>],
        ['Prepare execution', <p key="prepare">When AUTH is ready, the owning Integration Service controls execution preparation. The configured execution policy determines whether MultiSig Tools or your service owns the final route.</p>],
        ['Compare effects again', <p key="effects">The final enforcing simulation is compared with the reviewed effects. Structural drift requires re-authorization; significant numeric drift requires explicit review.</p>],
        ['Reconcile the ledger result', <p key="reconcile">External execution is not complete merely because XDR was handed off. Reconcile the actual transaction hash/result back into the Intent.</p>],
      ]} />

      <section>
        <div className="mst-doc-section-heading">
          <div className="mst-doc-eyebrow">On my site</div>
          <h2>Issue a narrow browser authorization capability.</h2>
        </div>
        <p className="mst-doc-body">Only the owning Integration Service may issue this capability. It binds one service, Intent, AuthorizationPlan revision/digest, signer, exact browser origin, and expiry. A replan invalidates the old capability automatically.</p>
        <DevCode>{issueBrowserCapabilityExample}</DevCode>
        <DevCode>{browserInspectExample}</DevCode>
        <p className="mst-doc-body">The browser can inspect its signer-specific challenge and contribute authorization with GET/PATCH <code>/api/intent</code>. It cannot create arbitrary Intents, cancel/replan, change execution, or act as a Stellar signer without a valid wallet signature.</p>
      </section>
    </div>
  );
}

export function ApiWebhooksPage() {
  return (
    <div className="mst-doc-page">
      <DevHeader
        eyebrow="Developers · Reference"
        title="API and webhooks"
        summary="Discover the contract from the running deployment, use idempotent machine writes, and treat webhook delivery as a prompt to read canonical state rather than as state itself."
      />

      <section>
        <div className="mst-doc-section-heading">
          <div className="mst-doc-eyebrow">Discovery</div>
          <h2>Start from operations and OpenAPI.</h2>
        </div>
        <DevCode>{apiDiscoveryExample}</DevCode>
        <div className="mst-doc-inline-links">
          <a href={STELLAR_TESTNET_ORIGIN + '/openapi.json'}>Testnet OpenAPI<ExternalLink className="h-3.5 w-3.5" /></a>
          <a href={STELLAR_TESTNET_ORIGIN + '/api/operations'}>Testnet operations<ExternalLink className="h-3.5 w-3.5" /></a>
          <a href={STELLAR_MAINNET_ORIGIN + '/openapi.json'}>Mainnet OpenAPI<ExternalLink className="h-3.5 w-3.5" /></a>
        </div>
      </section>

      <div className="mst-doc-fact-list">
        <div><strong>Network-bound origin</strong><span>Use the deployment that owns the selected network. A Request/Intent cannot be switched to another network by URL or wallet default.</span></div>
        <div><strong>Idempotency</strong><span>Agent and Integration creation requires a stable <code>Idempotency-Key</code>. A replay returns the same work; changing the payload under the same key is a conflict.</span></div>
        <div><strong>Job projection</strong><span>Integration callers may follow compact business state/next actions without interpreting every authorization/preparation/evidence record.</span></div>
        <div><strong>Webhook</strong><span>Receive → deduplicate event id → GET canonical Request/Intent/Job → act from current state. Delivery is durable and signed, but it is never the source of truth.</span></div>
      </div>

      <DevCallout icon={<Webhook className="h-4 w-4" />} title="Webhook configuration is part of the Integration Profile">
        <p>The callback URL is operator-controlled and HTTPS-only. MultiSig Tools stores durable delivery state, retries with bounds/backoff, and redacts credentials/private signing material. Consumers must still implement idempotent event handling.</p>
      </DevCallout>
    </div>
  );
}

export function DeveloperSecurityPage() {
  return (
    <div className="mst-doc-page">
      <DevHeader
        eyebrow="Developers · Security"
        title="Authority is separated on purpose"
        summary="The most important integration rule is that coordination identity, signer authority, disclosure access, and execution ownership are different capabilities. MultiSig Tools verifies each at the boundary where it matters."
      />

      <div className="mst-doc-authority-table" role="table" aria-label="MultiSig Tools authority boundaries">
        <div className="mst-doc-authority-row mst-doc-authority-row--head" role="row">
          <span role="columnheader">Capability</span><span role="columnheader">What it can do</span><span role="columnheader">What it cannot replace</span>
        </div>
        <div className="mst-doc-authority-row" role="row">
          <strong role="cell">Integration <code>msi_*</code></strong><span role="cell">Create/read/manage work inside configured business scope.</span><span role="cell">Stellar signer signature.</span>
        </div>
        <div className="mst-doc-authority-row" role="row">
          <strong role="cell">Browser <code>mic_*</code></strong><span role="cell">Inspect/contribute for one signer, origin, Intent plan and expiry.</span><span role="cell">Lifecycle/execution control or signer proof.</span>
        </div>
        <div className="mst-doc-authority-row" role="row">
          <strong role="cell">Agent credential</strong><span role="cell">Act for one delegated signer Principal at Read/Write/Sign scope.</span><span role="cell">A private key; Sign still requires valid cryptographic evidence.</span>
        </div>
        <div className="mst-doc-authority-row" role="row">
          <strong role="cell">Execution owner</strong><span role="cell">Prepare/submit/reconcile according to configured route.</span><span role="cell">Treasury signer or Soroban AUTH authority.</span>
        </div>
      </div>

      <DevCallout icon={<ShieldCheck className="h-4 w-4" />} title="Orchestration may move; authority does not">
        <p>Hosted, Native, and Full Headless can all reach the same authorization core. Moving UI or transport into your product does not move threshold checks, plan identity, effects validation, expiry, or signature validity out of MultiSig Tools.</p>
      </DevCallout>
    </div>
  );
}

export function AgentApiPage() {
  return (
    <div className="mst-doc-page">
      <DevHeader
        eyebrow="Developers · Agents"
        title="Agent API"
        summary="Delegate signer-scoped API access to a named Agent actor. The credential is bound to one Stellar signer Principal and network; it does not contain or become the Principal's private key."
      />

      <section>
        <div className="mst-doc-section-heading">
          <div className="mst-doc-eyebrow">Access</div>
          <h2>Read, Write, and Sign are cumulative scopes.</h2>
        </div>
        <div className="mst-doc-fact-list">
          <div><strong>Read</strong><span>Read saved contracts, personal contacts, accessible Treasury metadata, Inbox, Activity, Request details, and status.</span></div>
          <div><strong>Write</strong><span>Includes Read. Manage saved context, create Requests/Intents within signer scope, refresh/freeze preparation, and decline.</span></div>
          <div><strong>Sign</strong><span>Includes Write. Contribute valid Stellar transaction signatures or detached Soroban authorization attributable to the credential Principal.</span></div>
        </div>
      </section>

      <DevCallout icon={<KeyRound className="h-4 w-4" />} title="Sign access still does not contain a private key">
        <p>MultiSig Tools independently validates newly contributed signatures against the Principal. If an Agent uploads already-signed XDR, audit evidence can show which signer signed and which Agent credential transported it; it does not claim the Agent generated that signature.</p>
      </DevCallout>

      <section>
        <div className="mst-doc-section-heading">
          <div className="mst-doc-eyebrow">Classic Request</div>
          <h2>Create and inspect signer-owned work.</h2>
        </div>
        <DevCode>{agentRequestExample}</DevCode>
        <DevCode>{agentStatusExample}</DevCode>
      </section>

      <div className="mst-doc-fact-list">
        <div><strong>Principal</strong><span>The Stellar signer that delegated access.</span></div>
        <div><strong>Actor</strong><span>The individual credential. Multiple Agents can share one Principal while staying independently named, scoped, audited, and revocable.</span></div>
        <div><strong>Limits</strong><span>Up to {MAX_ACTIVE_SIGNER_AGENT_CREDENTIALS} active Agent credentials per signer/network. Treasury Audit credentials are separate, read-only resource credentials, with up to {MAX_ACTIVE_TREASURY_AUDIT_KEYS} active per Treasury.</span></div>
      </div>
    </div>
  );
}

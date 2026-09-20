import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const ui = source('../MultiSigUi.tsx');
const dashboard = source('../StellarDashboardApp.tsx');
const inbox = source('../InboxApp.tsx');
const request = source('../RequestApp.tsx');
const intent = source('../SorobanIntentApp.tsx');
const treasury = source('../TreasuryApp.tsx');
const treasurySettings = source('../TreasuryBoxSettingsApp.tsx');
const addressBook = source('../AddressBookApp.tsx');
const agentAccess = source('../AgentAccessApp.tsx');
const payment = source('../PaymentComposer.tsx');
const transfer = source('../TransferComposer.tsx');
const claimablePayment = source('../ClaimablePaymentComposer.tsx');
const designer = source('../MultisigDesignerApp.tsx');
const existingDesigner = source('../ExistingMultisigPolicyEditor.tsx');
const newTransaction = source('../NewTransactionApp.tsx');
const signingRoom = source('../SigningRoomApp.tsx');
const activity = source('../ActivityApp.tsx');
const sorobanActivity = source('../SorobanIntentActivityCard.tsx');
const review = source('../ReviewTransactionSummary.tsx');
const accountSigningEntry = source('../AccountSigningEntryApp.tsx');
const xdrQr = source('../XdrQrCode.tsx');

test('primary Human surfaces share one page-header grammar', () => {
  assert.match(ui, /export function PageHeader/);
  assert.match(ui, /className="mst-page-header"/);
  assert.match(ui, /className="mst-page-title"/);
  assert.match(dashboard, /<PageHeader/);
  assert.match(inbox, /<PageHeader/);
  assert.match(request, /<PageHeader/);
  assert.match(intent, /<PageHeader/);
  assert.match(treasury, /<PageHeader/);
  assert.match(treasurySettings, /<PageHeader/);
  assert.match(addressBook, /<PageHeader/);
  assert.match(agentAccess, /<PageHeader/);
});


test('terminal workflow marks Done itself as completed', () => {
  assert.match(ui, /current === 'done' && index === currentIndex/);
  assert.match(ui, /data-complete=\{complete \? 'true' : 'false'\}/);
  assert.match(ui, /data-active=\{active \? 'true' : 'false'\}/);
  assert.match(ui, /complete \? <CheckCircle2/);
});

test('page identity precedes Proposal workflow progress', () => {
  const headerIndex = request.indexOf('<PageHeader');
  const progressIndex = request.indexOf('<WorkflowProgress current={workflowStage}');
  assert.ok(headerIndex >= 0);
  assert.ok(progressIndex > headerIndex);
  assert.match(request, /title="Proposal"/);
});


test('Proposal Request keeps neutral scaffolding on the shared work surface while status states stay explicit', () => {
  assert.match(request, /mst-request-lookup-form/);
  assert.match(request, /mst-request-control/);
  assert.match(request, /mst-request-context-row/);
  assert.match(request, /mst-request-toast/);
  assert.match(request, /mst-request-advanced-facts/);
  assert.doesNotMatch(request, /dark:bg-\[#151515\]/);
  assert.match(request, /border-amber-500\/30 bg-amber-500/);
  assert.match(request, /border-red-500\/25 bg-red-500/);
  assert.match(request, /border-emerald-500\/25 bg-emerald-500/);
});

test('page identity precedes Soroban Intent workflow progress', () => {
  const headerIndex = intent.indexOf('<PageHeader');
  const progressIndex = intent.indexOf('<WorkflowProgress current={workflowStage}');
  assert.ok(headerIndex >= 0);
  assert.ok(progressIndex > headerIndex);
  assert.match(intent, /title="Contract authorization"/);
});

test('Soroban Intent uses a continuous evidence ledger while execution states remain explicit', () => {
  assert.match(intent, /mst-intent-summary/);
  assert.match(intent, /mst-intent-evidence-section/);
  assert.match(intent, /mst-intent-authorization-section/);
  assert.match(intent, /mst-intent-authorizer-list/);
  assert.match(intent, /mst-intent-authorizer-row/);
  assert.match(intent, /mst-intent-action-context/);
  assert.match(intent, /Execution failed on Stellar/);
  assert.match(intent, /Execution effects comparison/);
  assert.match(intent, /Authorization expired/);
  assert.match(intent, /This Intent cannot continue/);
  assert.doesNotMatch(intent, /Simulation effects at authorization<\/h2><p[^\n]*rounded-2xl/);
});

test('Dashboard and Inbox use the same wide Human content frame', () => {
  assert.match(dashboard, /mx-auto max-w-6xl/);
  assert.match(inbox, /mx-auto max-w-6xl/);
});

test('Dashboard quick actions stay compact instead of becoming another card grid', () => {
  assert.match(dashboard, /mst-dashboard-shortcuts/);
  assert.doesNotMatch(dashboard, /md:grid-cols-3/);
  assert.ok(dashboard.indexOf('New proposal') < dashboard.indexOf('Treasuries'));
});

test('Human work queues use shared rows and master-detail without repeating floating cards', () => {
  assert.match(dashboard, /mst-work-list/);
  assert.match(dashboard, /mst-work-row/);
  assert.match(inbox, /mst-inbox-list/);
  assert.match(inbox, /mst-inbox-item/);
  assert.match(inbox, /mst-inbox-detail/);
  assert.match(review, /mode === 'history'[\s\S]*'mst-evidence-surface'/);
});

test('Treasury uses one continuous workbench instead of nested policy and account cards', () => {
  assert.match(treasury, /mst-treasury-row/);
  assert.match(treasury, /mst-treasury-collection/);
  assert.match(treasury, /mst-treasury-policy-grid/);
  assert.match(treasury, /mst-treasury-policy-cell/);
  assert.match(treasury, /mst-treasury-list/);
  assert.match(treasury, /mst-treasury-detail/);
  assert.doesNotMatch(treasury, /lg:grid-cols-4/);
  assert.doesNotMatch(treasury, /rounded-3xl border border-black\/10 bg-white/);
});

test('Treasury settings separates public facts from private disclosures without card grids', () => {
  assert.match(treasurySettings, /mst-settings-picker/);
  assert.match(treasurySettings, /mst-settings-section/);
  assert.match(treasurySettings, /mst-settings-fact-grid/);
  assert.match(treasurySettings, /mst-settings-fact-cell/);
  assert.match(treasurySettings, /mst-settings-private/);
  assert.match(treasurySettings, /mst-settings-disclosure/);
  assert.match(treasurySettings, /mst-settings-control/);
  assert.doesNotMatch(treasurySettings, /rounded-2xl border border-black\/10 bg-white/);
  assert.doesNotMatch(treasurySettings, /sm:grid-cols-3/);
});

test('Address Book uses shared relationship rows instead of repeated list cards', () => {
  assert.match(addressBook, /mst-address-action-row/);
  assert.match(addressBook, /mst-address-add-form/);
  assert.match(addressBook, /mst-address-control/);
  assert.match(addressBook, /mst-address-list/);
  assert.match(addressBook, /mst-address-row/);
  assert.doesNotMatch(addressBook, /rounded-2xl border border-black\/10 bg-white/);
  assert.equal((addressBook.match(/mst-address-list/g) ?? []).length, 3);
});

test('Agent access uses one credential workspace while retaining permission and secret warnings', () => {
  assert.match(agentAccess, /mst-agent-stack/);
  assert.match(agentAccess, /mst-agent-principal/);
  assert.match(agentAccess, /mst-agent-section/);
  assert.match(agentAccess, /mst-agent-access-grid/);
  assert.match(agentAccess, /mst-agent-access-option/);
  assert.match(agentAccess, /mst-agent-control/);
  assert.match(agentAccess, /Sign is an API permission, not key custody/);
  assert.match(agentAccess, /Copy this credential now/);
  assert.doesNotMatch(agentAccess, /rounded-2xl border border-black\/10 bg-white/);
  assert.doesNotMatch(agentAccess, /md:grid-cols-3/);
});

test('Classic transaction composers share one continuous preparation workbench', () => {
  for (const composer of [payment, transfer, claimablePayment]) {
    assert.match(composer, /mst-transaction-composer/);
    assert.match(composer, /mst-testnet-page/);
    assert.match(composer, /mst-transaction-form/);
    assert.match(composer, /mst-transaction-control/);
    assert.match(composer, /mst-transaction-actions/);
    assert.doesNotMatch(composer, /rounded-2xl border border-black\/10 bg-white/);
    assert.doesNotMatch(composer, /focusClass|primaryClass/);
  }
  assert.match(payment, /mst-transaction-recipient-list/);
  assert.match(payment, /mst-transaction-context-list/);
  assert.match(transfer, /mst-transaction-disclosure/);
  assert.match(claimablePayment, /mst-claim-window-facts/);
});

test('multisig designer uses one continuous policy editor instead of step cards', () => {
  assert.match(designer, /mst-designer-account-summary/);
  assert.match(designer, /mst-designer-account-picker/);
  assert.match(designer, /mst-designer-step/);
  assert.match(designer, /mst-designer-current-key/);
  assert.match(designer, /mst-designer-approval-grid/);
  assert.match(designer, /mst-designer-approval-cell/);
  assert.match(designer, /mst-designer-review-grid/);
  assert.match(designer, /mst-designer-review-cell/);
  assert.match(designer, /mst-designer-control/);
  assert.doesNotMatch(designer, /step === 'signers' && <section className="rounded-2xl/);
  assert.doesNotMatch(designer, /step === 'approvals' && <section className="rounded-2xl/);
  assert.doesNotMatch(designer, /step === 'review' && <section className="rounded-2xl/);
  assert.doesNotMatch(designer, /sm:grid-cols-3/);
});

test('existing multisig editor reuses the policy editor grammar while retaining explicit risk states', () => {
  assert.match(existingDesigner, /mst-designer-step/);
  assert.match(existingDesigner, /mst-designer-current-key/);
  assert.match(existingDesigner, /mst-designer-approval-grid/);
  assert.match(existingDesigner, /mst-designer-approval-cell/);
  assert.match(existingDesigner, /mst-designer-control/);
  assert.match(existingDesigner, /mst-designer-step-actions/);
  assert.match(existingDesigner, /Change an existing multisig configuration\?/);
  assert.match(existingDesigner, /border-red-500\/30 bg-red-500\/10/);
  assert.match(existingDesigner, /border-amber-500\/25 bg-amber-500/);
  assert.doesNotMatch(existingDesigner, /step === 'signers' && <section className="rounded-2xl/);
  assert.doesNotMatch(existingDesigner, /step === 'approvals' && <section className="rounded-2xl/);
  assert.doesNotMatch(existingDesigner, /step === 'review' && <section className="rounded-2xl/);
});

test('XDR import entry points share one continuous preparation form', () => {
  for (const entry of [newTransaction, signingRoom]) {
    assert.match(entry, /mst-import-form/);
    assert.match(entry, /mst-import-control/);
    assert.match(entry, /mst-testnet-page/);
    assert.doesNotMatch(entry, /rounded-2xl border border-black\/10 bg-white p-5 shadow-sm/);
  }
  assert.doesNotMatch(newTransaction, /focusClass|primaryClass/);
  assert.match(newTransaction, /mst-import-control--error/);
});

test('Activity uses one continuous timeline grammar for Classic and Soroban work', () => {
  assert.match(activity, /mst-activity-list/);
  assert.match(activity, /mst-activity-item/);
  assert.match(activity, /mst-activity-summary/);
  assert.match(activity, /mst-activity-timeline/);
  assert.match(activity, /mst-activity-actions/);
  assert.match(activity, /mst-activity-filter/);
  assert.match(sorobanActivity, /mst-activity-item/);
  assert.match(sorobanActivity, /mst-activity-summary/);
  assert.match(sorobanActivity, /mst-activity-timeline/);
  assert.match(sorobanActivity, /mst-activity-actions/);
  assert.doesNotMatch(activity, /rounded-3xl border border-black\/10 bg-white shadow-sm/);
  assert.doesNotMatch(sorobanActivity, /rounded-3xl border border-black\/10 bg-white shadow-sm/);
});

test('shared visual hierarchy does not introduce a new workflow or status vocabulary', () => {
  assert.doesNotMatch(ui, /Step 6|Stage 6/);
  assert.doesNotMatch(dashboard, /Sign mode|Manage mode/);
  assert.doesNotMatch(inbox, /Sign mode|Manage mode/);
  assert.doesNotMatch(request, /Sign mode|Manage mode/);
  assert.doesNotMatch(treasury, /Sign mode|Manage mode/);
});

test('signer guidance uses a continuous ledger without a bespoke dark surface color', () => {
  const signing = source('../SigningGuidance.tsx');
  assert.match(signing, /mst-signing-guidance/);
  assert.match(signing, /mst-signing-requirements/);
  assert.match(signing, /mst-signing-requirement/);
  assert.match(signing, /mst-signer-ledger/);
  assert.match(signing, /mst-signer-ledger__row/);
  assert.match(signing, /mst-signer-candidates/);
  assert.match(signing, /mst-signing-action-strip/);
  assert.match(signing, /mst-share-dialog/);
  assert.doesNotMatch(signing, /sm:grid-cols-2 xl:grid-cols-3/);
  assert.doesNotMatch(signing, /dark:bg-\[#/);
  assert.match(treasury, /border-neutral-200\/80/);
});

test('Human CTAs have semantic Action ownership without turning actions into statuses', () => {
  assert.match(ui, /export function ActionButton/);
  assert.match(ui, /primary: 'bg-emerald-700 text-white hover:bg-emerald-800'/);
  assert.match(ui, /secondary: 'border border-black\/10 bg-white/);
  assert.match(ui, /danger: 'bg-red-600 text-white hover:bg-red-700'/);
  assert.match(accountSigningEntry, /<ActionButton type="submit"/);
  assert.match(request, /<ActionButton variant="secondary" size="sm" onClick=\{\(\) => void copyXdr\(\)\}/);
});

test('account signing entry uses one sequence and continuous form instead of stacked cards', () => {
  assert.match(accountSigningEntry, /mst-signing-entry-icon/);
  assert.match(accountSigningEntry, /mst-signing-path/);
  assert.match(accountSigningEntry, /mst-signing-path__step/);
  assert.match(accountSigningEntry, /mst-signing-route-list/);
  assert.match(accountSigningEntry, /mst-signing-route-row/);
  assert.match(accountSigningEntry, /mst-signing-entry-form/);
  assert.match(accountSigningEntry, /mst-signing-entry-control/);
  assert.doesNotMatch(accountSigningEntry, /rounded-2xl border border-black\/10 bg-white/);
  assert.doesNotMatch(accountSigningEntry, /sm:grid-cols-5/);
});

test('offline multisig setup keeps one workflow and supports XDR transport', () => {
  assert.match(accountSigningEntry, /Set up multisig offline/);
  assert.match(accountSigningEntry, /Offline signing path/);
  assert.match(accountSigningEntry, /Public address/);
  assert.match(accountSigningEntry, /Signing policy/);
  assert.match(accountSigningEntry, /Sign elsewhere/);
  assert.doesNotMatch(accountSigningEntry, /list-decimal|Bootstrap a cold treasury|Offline treasury setup/);
  assert.match(request, /Show QR/);
  assert.match(request, /<XdrQrCode xdr=\{snapshot\.mergedXdr\}/);
  assert.match(xdrQr, /MAX_SINGLE_QR_BYTES = 2_850/);
  assert.match(xdrQr, /The QR contains transaction data only; it never contains a secret key/);
  assert.match(xdrQr, /Use Copy XDR instead/);
});

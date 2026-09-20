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


test('page identity precedes Soroban Intent workflow progress', () => {
  const headerIndex = intent.indexOf('<PageHeader');
  const progressIndex = intent.indexOf('<WorkflowProgress current={workflowStage}');
  assert.ok(headerIndex >= 0);
  assert.ok(progressIndex > headerIndex);
  assert.match(intent, /title="Contract authorization"/);
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

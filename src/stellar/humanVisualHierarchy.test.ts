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

test('shared visual hierarchy does not introduce a new workflow or status vocabulary', () => {
  assert.doesNotMatch(ui, /Step 6|Stage 6/);
  assert.doesNotMatch(dashboard, /Sign mode|Manage mode/);
  assert.doesNotMatch(inbox, /Sign mode|Manage mode/);
  assert.doesNotMatch(request, /Sign mode|Manage mode/);
  assert.doesNotMatch(treasury, /Sign mode|Manage mode/);
});

test('new precision grids use neutral light hairlines without adding a bespoke dark surface color', () => {
  const signing = source('../SigningGuidance.tsx');
  assert.match(signing, /bg-neutral-200\/80 dark:bg-white\/\[0\.08\]/);
  assert.doesNotMatch(signing, /dark:bg-\[#111215\]/);
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

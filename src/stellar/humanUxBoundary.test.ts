import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

test('workspace shell exposes one Human workspace instead of Sign/Manage mode', () => {
  const shell = source('../StellarWorkspaceShell.tsx');
  assert.doesNotMatch(shell, /WorkspaceModeOnboarding/);
  assert.doesNotMatch(shell, /getWorkspaceMode|resolveWorkspaceMode/);
  assert.match(shell, />Home</);
  assert.match(shell, />Inbox</);
  assert.match(shell, /New<span/);
  assert.match(shell, />Treasuries</);
  assert.match(shell, /grid-cols-4/);
  assert.match(shell, />More</);
  assert.match(shell, /aria-expanded={mobileMoreOpen}[\s\S]*w-full/);
  assert.match(shell, /pointerdown/);
  assert.match(shell, /event.key === 'Escape'/);
  assert.match(shell, />Activity</);
  assert.match(shell, />Contacts</);
  assert.doesNotMatch(shell, /grid-cols-5/);
  assert.match(shell, /className="flex min-h-screen[^"]*flex-col/);
  assert.match(shell, /flex w-full max-w-\[1480px\] flex-1 flex-col lg:grid/);
  assert.match(shell, /<div className="min-w-0 flex-1">\{children\}<\/div>/);
  assert.doesNotMatch(shell, /lg:min-h-\[calc\(100vh-4rem\)\]/);
});

test('primary wallet menu does not expose workspace philosophy or unlock duration controls', () => {
  const account = source('../StellarAccountControl.tsx');
  assert.doesNotMatch(account, /I'm here to/);
  assert.doesNotMatch(account, /Default unlock duration/);
  assert.doesNotMatch(account, /Private data/);
  assert.doesNotMatch(account, />Manage</);
  assert.match(account, /Sign in to workspace/);
  assert.match(account, /onClick=\{\(\) => void signIn\(\)\}/);
  assert.match(account, /Lock private workspace/);
});

test('new transaction entry keeps primary actions separate from low-frequency Stellar actions', () => {
  const app = source('../NewTransactionApp.tsx');
  const contractComposer = source('../ContractCallComposer.tsx');
  assert.match(app, /New proposal/);
  assert.match(app, /Send payment/);
  assert.match(app, /Import transaction \(XDR\)/);
  assert.match(app, /More Stellar actions/);
  assert.match(app, /Set up multisig/);
  assert.match(app, /stellarHref\('\/account\/signing'\)/);
  assert.match(app, /Call a contract/);
  assert.match(app, /stellarHrefWithSearch\('\/new\/contract'/);
  assert.match(contractComposer, /inspectContractOperation\(contractId, network\)/);
  assert.match(contractComposer, /fetch\('\/api\/intent'/);
  assert.doesNotMatch(contractComposer, /contractArgumentsToScVals/);
  assert.match(contractComposer, /source-free Soroban Intent/);
  assert.match(contractComposer, /Transaction construction happens only after the required Soroban authorization is complete/);
  assert.ok(app.indexOf('Import transaction (XDR)') < app.indexOf('More Stellar actions'));
  assert.match(app, /stellarHref\('\/new\/import'\)/);
  assert.doesNotMatch(app, /stellarHrefWithSearch\('\/new\/import'/);
  assert.doesNotMatch(app, /resolveImportedTransactionNetwork/);
  assert.match(app, /inspectTransactionXdr\(value, network\)/);
  assert.match(app, /selected deployment network is authoritative/);
  assert.match(app, /This is not a valid Stellar transaction XDR/);
  assert.match(app, /aria-invalid={Boolean\(xdrError\)}/);
  assert.doesNotMatch(app, /title="Import XDR"/);
  assert.doesNotMatch(app, /Change account control|treasurySigningHref/);
  assert.doesNotMatch(app, /Sign mode|Manage mode/);
});

test('transaction lifetime uses one shared button-group primitive across Human composers', () => {
  const ui = source('../MultiSigUi.tsx');
  const payment = source('../PaymentComposer.tsx');
  const transfer = source('../TransferComposer.tsx');
  const claimable = source('../ClaimablePaymentComposer.tsx');
  const contractCall = source('../ContractCallComposer.tsx');

  assert.match(ui, /export function TransactionLifetimePicker/);
  for (const composer of [payment, transfer, claimable]) {
    assert.match(composer, /TransactionLifetimePicker/);
  }
  assert.doesNotMatch(contractCall, /TransactionLifetimePicker/);
  assert.match(contractCall, /No transaction source, sequence, fee, lifetime or envelope signature is chosen/);
});

test('connected home switches to an actionable Dashboard without a first-use choice modal', () => {
  const home = source('../StellarHomeApp.tsx');
  const main = source('../main.tsx');
  const dashboard = source('../StellarDashboardApp.tsx');
  assert.match(home, /sessionAddress \? <StellarDashboardApp \/> : <StellarLandingApp \/>/);
  assert.match(main, /case 'home': Component = StellarHomeApp/);
  assert.match(dashboard, /requests\?: InboxRequestSnapshot\[\]/);
  assert.match(dashboard, /inboxViewerActionNeedsAction/);
  assert.match(dashboard, /slice\(0, 3\)/);
  assert.match(dashboard, /navigateWorkspace\('\/request'/);
  assert.match(dashboard, /action\.cta/);
  assert.match(dashboard, /You're all caught up\./);
  assert.match(dashboard, /actionCounts\.waiting > 0/);
  assert.match(dashboard, /View waiting/);
  assert.ok(dashboard.indexOf('New proposal') < dashboard.indexOf('Treasuries'));
  assert.doesNotMatch(dashboard, /meta=\{sessionAddress/);
});

test('Inbox and Dashboard surface source-free Soroban Intents in the same work queue', () => {
  const inbox = source('../InboxApp.tsx');
  const dashboard = source('../StellarDashboardApp.tsx');
  const intent = source('../SorobanIntentApp.tsx');
  const routes = source('../workspaceRoutes.ts');

  assert.match(inbox, /intents: InboxSorobanIntentSnapshot\[\]/);
  assert.match(inbox, /openIntentDetails/);
  assert.match(inbox, /navigateWorkspace\('\/a'/);
  assert.match(inbox, /Soroban Intent/);
  assert.doesNotMatch(inbox, /transactionSourceAccount|openPreparationDetails/);
  assert.match(dashboard, /intentAttention/);
  assert.match(dashboard, /intentViewerActionPresentation/);
  assert.match(intent, /Contract authorization complete/);
  assert.match(intent, /Choose how the final transaction should be executed/);
  assert.match(intent, /Handle outside MultiSigTools/);
  assert.match(intent, /MultiSigTools coordinates/);
  assert.match(routes, /path: '\/a', kind: 'authorization'/);
});

test('Activity retention explains that the share link ends without implying the confirmed transaction disappears', () => {
  const notice = source('../ActivityRetentionNotice.tsx');
  const request = source('../RequestApp.tsx');
  assert.match(notice, /confirmed transaction remains recorded on Stellar/);
  assert.match(notice, /private share link stops showing proposal details/);
  assert.doesNotMatch(notice, /will close as soon as|Submission will close this private link/);
  assert.match(request, /Transaction confirmed/);
  assert.match(request, /Confirmed on Stellar/);
  assert.match(request, /private share link no longer exposes proposal details/);
  assert.doesNotMatch(request, /This private link has finished/);
});

test('external-service work keeps final execution out of signer UI', () => {
  const request = source('../RequestApp.tsx');
  const intent = source('../SorobanIntentApp.tsx');
  const requestApi = source('../../api/request.ts');
  const intentApi = source('../../api/intent.ts');

  assert.match(request, /snapshot\.execution\?\.mode === 'external'/);
  assert.match(request, /Waiting for external execution/);
  assert.match(request, /MultiSigTools will not broadcast this transaction/);
  assert.match(requestApi, /external_executor_required/);
  assert.match(requestApi, /integration_submit_denied/);
  assert.match(intent, /intent\.executionPolicy\?\.mode === 'external'/);
  assert.match(intent, /is the external executor for this Intent/);
  assert.match(intentApi, /external_executor_required/);
  assert.match(intentApi, /assertIntegrationSorobanExecutionAccount/);
});

test('active Human surfaces do not let legacy workspace mode choose navigation or Activity scope', () => {
  const activity = source('../ActivityApp.tsx');
  const landing = source('../StellarLandingApp.tsx');
  const review = source('../SigningRoomApp.tsx');
  for (const item of [activity, landing, review]) assert.doesNotMatch(item, /getWorkspaceMode/);

  assert.match(activity, /stellarActivityScopeForPath\(window\.location\.pathname\)/);
  assert.match(activity, /const isTreasuryActivity = activityScope === 'treasury'/);
  assert.match(activity, /if \(isTreasuryActivity && targetAccount\) url\.searchParams\.set\('account', targetAccount\)/);
  assert.match(landing, /const workspaceHref = stellarHref\(''\)/);
  assert.match(landing, /Open workspace/);
  assert.match(review, /postFreezeReturnTarget = requestReturnTarget\(\) \?\? \{ href: stellarHref\(''\), label: 'Back to Home' \}/);
});

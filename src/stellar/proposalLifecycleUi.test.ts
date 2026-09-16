import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const requestApi = readFileSync(new URL('../../api/request.ts', import.meta.url), 'utf8');
const requestService = readFileSync(new URL('../../server/requestService.ts', import.meta.url), 'utf8');
const signingRoom = readFileSync(new URL('../SigningRoomApp.tsx', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../TreasuryBoxSettingsApp.tsx', import.meta.url), 'utf8');
const requestUi = readFileSync(new URL('../RequestApp.tsx', import.meta.url), 'utf8');
const activityRetention = readFileSync(new URL('../ActivityRetentionNotice.tsx', import.meta.url), 'utf8');
const signingGuidance = readFileSync(new URL('../SigningGuidance.tsx', import.meta.url), 'utf8');
const addressIdentity = readFileSync(new URL('../AddressIdentity.tsx', import.meta.url), 'utf8');
const privateNoteCard = readFileSync(new URL('../PrivateNoteCard.tsx', import.meta.url), 'utf8');
const privateCommitmentDisclosure = readFileSync(new URL('../PrivateCommitmentDisclosure.tsx', import.meta.url), 'utf8');
const reviewSummary = readFileSync(new URL('../ReviewTransactionSummary.tsx', import.meta.url), 'utf8');
const privateWorkspaceUnlock = readFileSync(new URL('../PrivateWorkspaceUnlock.tsx', import.meta.url), 'utf8');
const unlockPreferences = readFileSync(new URL('./unlockPreferences.ts', import.meta.url), 'utf8');
const addressBook = readFileSync(new URL('../AddressBookApp.tsx', import.meta.url), 'utf8');
const signerIdentityList = readFileSync(new URL('../SignerIdentityList.tsx', import.meta.url), 'utf8');
const inbox = readFileSync(new URL('../InboxApp.tsx', import.meta.url), 'utf8');
const inboxApi = readFileSync(new URL('../../api/inbox.ts', import.meta.url), 'utf8');
const requestInbox = readFileSync(new URL('../../server/requestInbox.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../StellarDashboardApp.tsx', import.meta.url), 'utf8');
const inboxPresentation = readFileSync(new URL('./inboxPresentation.ts', import.meta.url), 'utf8');
const workspaceOnboarding = readFileSync(new URL('../WorkspaceModeOnboarding.tsx', import.meta.url), 'utf8');
const landing = readFileSync(new URL('../StellarLandingApp.tsx', import.meta.url), 'utf8');
const demoApp = readFileSync(new URL('../DemoTreasuryApp.tsx', import.meta.url), 'utf8');
const multisigDesigner = readFileSync(new URL('../MultisigDesignerApp.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
const demoContract = readFileSync(new URL('../../DEMO_RUNTIME.md', import.meta.url), 'utf8');
const payment = readFileSync(new URL('../PaymentComposer.tsx', import.meta.url), 'utf8');
const paymentAssetPicker = readFileSync(new URL('../PaymentAssetPicker.tsx', import.meta.url), 'utf8');
const transferComposer = readFileSync(new URL('../TransferComposer.tsx', import.meta.url), 'utf8');
const batchRecipientEditor = readFileSync(new URL('./batchRecipientEditor.ts', import.meta.url), 'utf8');
const newTransaction = readFileSync(new URL('../NewTransactionApp.tsx', import.meta.url), 'utf8');
const existingMultisigPolicyEditor = readFileSync(new URL('../ExistingMultisigPolicyEditor.tsx', import.meta.url), 'utf8');
const transactionReceipt = readFileSync(new URL('../TransactionReceiptApp.tsx', import.meta.url), 'utf8');
const portableEvidenceDocument = readFileSync(new URL('../PortableEvidenceDocument.tsx', import.meta.url), 'utf8');
const portableEvidenceProjection = readFileSync(new URL('./portableEvidence.ts', import.meta.url), 'utf8');
const authorizationResults = readFileSync(new URL('../TransactionAuthorizationResults.tsx', import.meta.url), 'utf8');
const accountControl = readFileSync(new URL('../StellarAccountControl.tsx', import.meta.url), 'utf8');
const treasury = readFileSync(new URL('../TreasuryApp.tsx', import.meta.url), 'utf8');
const treasuryPreferences = readFileSync(new URL('./treasuryPreferences.ts', import.meta.url), 'utf8');
const walletContext = readFileSync(new URL('../StellarWalletContext.tsx', import.meta.url), 'utf8');
const stellarCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const stellarTsconfig = readFileSync(new URL('../../tsconfig.stellar.json', import.meta.url), 'utf8');
const productSemantics = readFileSync(new URL('../../PRODUCT_SEMANTICS.md', import.meta.url), 'utf8');
const activityUi = readFileSync(new URL('../ActivityApp.tsx', import.meta.url), 'utf8');
const workspaceShell = readFileSync(new URL('../StellarWorkspaceShell.tsx', import.meta.url), 'utf8');
const multiSigUi = readFileSync(new URL('../MultiSigUi.tsx', import.meta.url), 'utf8');
const humanWorkflow = readFileSync(new URL('./humanWorkflow.ts', import.meta.url), 'utf8');
const uxDesignSystem = readFileSync(new URL('../../UX_DESIGN_SYSTEM.md', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const vercelConfig = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');



test('interactive Demo is a separate non-authorizing composition root', () => {
  assert.match(landing, /Try live demo/);
  assert.match(landing, /Try this flow yourself/);
  assert.match(main, /route\.kind === 'demo'\) return <DemoTreasuryApp \/>/);
  assert.ok(main.indexOf("route.kind === 'demo'") < main.indexOf('<StellarWalletProvider>'));
  assert.doesNotMatch(demoApp, /useStellarWallet|\/api\/|fetch\(|sessionStorage|localStorage/);
  assert.match(demoApp, /No wallet is connected/);
  assert.match(demoApp, /Nothing will be broadcast to Stellar/);
  assert.match(demoContract, /Do \*\*not\*\* add a global `demo=true` authorization branch/);
  assert.match(demoContract, /no fake Stellar transaction hash/i);
});

test('Demo and Production share one Human workflow and semantic status presentation', () => {
  assert.match(humanWorkflow, /label: 'Prepare'[\s\S]*label: 'Review'[\s\S]*label: 'Sign'[\s\S]*label: 'Submit'[\s\S]*label: 'Done'/);
  assert.match(payment, /WorkflowProgress current="prepare"/);
  assert.match(newTransaction, /WorkflowProgress current="review"/);
  assert.match(signingRoom, /WorkflowProgress current=\{directSubmission \? 'done' : 'review'\}/);
  assert.match(signingRoom, /Transaction confirmed/);
  assert.match(signingRoom, /Stellar confirmed the exact reviewed transaction/);
  assert.match(requestUi, /proposalWorkflowStage\(snapshot\.status, \{ reviewComplete, signaturesComplete \}\)/);
  assert.match(requestUi, /<WorkflowProgress current=\{workflowStage\} \/>/);
  assert.match(transactionReceipt, /WorkflowProgress current="done"/);
  assert.match(demoApp, /<WorkflowProgress current=\{workflowStage\} label="Demo transaction progress" \/>/);
  assert.doesNotMatch(demoApp, /DemoProgress|Approve as|already approved|>Approved<|Collect 2 approvals/);
  assert.match(demoApp, /Sign as \$\{selectedSigner\}/);
  assert.match(demoApp, /Signed · Demo/);
  assert.match(demoApp, /Frozen transaction/);
  assert.doesNotMatch(requestUi, />Signatures<\/span>/);
  assert.doesNotMatch(multisigDesigner, /\{index \+ 1\}\. \{item\.label\}/);
  assert.doesNotMatch(existingMultisigPolicyEditor, /\{index \+ 1\}\. \{item\.label\}/);
  assert.match(multisigDesigner, /Check policy/);
  assert.match(existingMultisigPolicyEditor, /Check changes/);
  assert.match(uxDesignSystem, /only numbered transaction progress system/);
  assert.match(inbox, /RequestStatusBadge/);
  assert.match(requestUi, /RequestStatusBadge/);
  assert.match(multiSigUi, /function RequestStatusBadge/);
  assert.match(multiSigUi, /function NetworkBadge/);
  assert.doesNotMatch(multiSigUi, /activeTone/);
  assert.match(multiSigUi, /bg-black text-white dark:bg-white dark:text-black/);
  assert.doesNotMatch(multiSigUi, /useStellarWallet|fetch\(|\/api\/|loadAccount|Horizon/);
  assert.match(uxDesignSystem, /1 Prepare -> 2 Review -> 3 Sign -> 4 Submit -> 5 Done/);
  assert.match(uxDesignSystem, /Stellar Mainnet \| Brand emerald/);
  assert.match(uxDesignSystem, /Stellar Testnet \| Information sky/);
  assert.match(uxDesignSystem, /Collecting signatures \/ authorization complete but waiting \| Warning amber/);
  assert.match(uxDesignSystem, /Status badges describe canonical Work facts, never viewer permissions/);
});
test('durable Proposal creation requires a verified current signer and has no scheduled Request deletion', () => {
  assert.match(requestApi, /request_creator_identity_required/);
  assert.match(requestApi, /request_creator_not_signer/);
  assert.match(requestApi, /signerCanAccessTransaction\(/);
  assert.match(signingRoom, /await wallet\.unlock\(undefined, network\)/);
  assert.match(readme, /Request expiry closes collaboration; it does not trigger scheduled physical deletion/);
  assert.doesNotMatch(vercelConfig, /request-cleanup|"crons"/);
});

test('private Proposal context states the server-private and bearer-link boundaries at the action surface', () => {
  assert.match(signingRoom, /not end-to-end encrypted/);
  assert.match(payment, /not end-to-end encrypted/);
  assert.match(requestUi, /Anyone with this private link can view the active Proposal/);
  assert.match(requestUi, /never grants Stellar signing authority/);
});

test('private proposal context freezes when the Signing Request is created', () => {
  assert.match(requestApi, /private_note_immutable/);
  assert.match(signingRoom, /await createStoredRequest\(effectiveXdr\)/);
  assert.match(signingRoom, /navigateWorkspace\('\/s'/);
  assert.doesNotMatch(requestUi, /takeReviewHandoff|createSharedRequest/);
});

test('decline is a signer collaboration event, not request expiry', () => {
  const declineHandler = requestApi.match(/if \(body\.decision === 'decline'\) \{([\s\S]*?)\n    \}\n\n    const signedXdr/)?.[1] ?? '';
  assert.ok(declineHandler);
  assert.match(requestApi, /approval_declined/);
  assert.match(requestApi, /request remains open for other signers/i);
  assert.doesNotMatch(declineHandler, /expired|expiresAt\s*=/);
  assert.doesNotMatch(requestUi, /Decline proposal/);
});

test('opening Administration History does not implicitly load API-key metadata', () => {
  const loadAudit = settings.match(/async function loadAudit\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.ok(loadAudit);
  assert.doesNotMatch(loadAudit, /loadKeys\(/);
});


test('exact N-of-M signing uses one discrete signer presentation without repeating the legacy signer list', () => {
  assert.match(signingGuidance, /Signing progress/);
  assert.match(signingGuidance, /matchedSignerKeys\.length/);
  assert.match(signingGuidance, /policy\.exactNOfM\.required/);
  assert.match(signingGuidance, /Signed/);
  assert.match(signingGuidance, /You can sign/);
  assert.match(signingGuidance, /Can sign/);
  assert.match(signingGuidance, /policy\?\.exactNOfM && !currentAccountKeyOnly/);
  assert.match(signingGuidance, /policy\?\.exactNOfM \? null : signaturesRemaining !== null/);
});

test('human signing turns a connected wrong wallet into an actionable identity choice', () => {
  assert.doesNotMatch(signingGuidance, />Change<\/button>/);
  assert.match(signingGuidance, /Ask someone to sign/);
  assert.match(signingGuidance, /Sign proposal/);
  assert.doesNotMatch(signingGuidance, /Signing as/);
  assert.match(signingGuidance, /Choose an authorized signer/);
  assert.match(signingGuidance, /This wallet is not an authorized signer for this Proposal/);
  assert.match(signingGuidance, /onClick=\{onConnectWallet\}/);
});

test('frozen Private Note is visibly read-only without exposing lifecycle mechanics', () => {
  assert.match(privateNoteCard, />Read-only</);
  assert.doesNotMatch(privateNoteCard, /Create a replacement proposal|cannot be revised in this signing request/);
});

test('default evidence export structurally excludes private plaintext', () => {
  assert.match(privateNoteCard, /Hide Private Note on screen/);
  assert.match(privateNoteCard, /allowConceal/);
  assert.match(transactionReceipt, /Private off-chain context/);
  assert.match(transactionReceipt, /never included in the evidence PDF/);
  assert.match(transactionReceipt, /Export evidence PDF/);
  assert.doesNotMatch(transactionReceipt, /Include Private Note|Include Private memo|Print options/);
  assert.match(transactionReceipt, /allowConceal=\{false\}/);
  assert.match(stellarCss, /transaction-evidence-human-document/);
  assert.match(stellarCss, /transaction-evidence-portable-document/);
  assert.match(stellarCss, /size: A4 portrait/);
  assert.doesNotMatch(portableEvidenceDocument, /PrivateNoteCard|PrivateCommitmentDisclosure|useAddressBook|treasuryDisplayLabel/);
});

test('Address Book presents signer workspace relationships plus secondary Contacts', () => {
  assert.match(addressBook, />Treasuries</);
  assert.match(addressBook, />Signers</);
  assert.match(addressBook, />Contacts</);
  assert.match(addressBook, /loadAccountsForSigner/);
  assert.match(addressBook, /loadSharedTreasuryNames/);
  assert.match(addressBook, /Add contact/);
  assert.match(addressBook, /New proposal/);
  assert.match(addressBook, /treasuryDisplayLabel/);
  assert.doesNotMatch(addressBook, /entry\.subjectType === 'account'/);
  assert.match(addressBook, /stellarHrefWithSearch\('\/new'/);
  assert.match(addressBook, /semantics="note"/);
  assert.match(addressBook, /treasuryMaster \? `\$\{treasuryLabel \|\| 'Treasury'\} · account key`/);
  assert.match(addressBook, /!treasuryMaster && <AddressAliasEditor/);
  assert.doesNotMatch(addressBook, /Saved addresses|Open Treasury|treasur(?:y|ies)\.length/);
  assert.match(addressBook, /Saved names are private/);
  assert.match(addressBook, /Show saved names/);
  assert.doesNotMatch(addressBook, /Unlock saved names|Unlock names|stay locked/);
  assert.match(signerIdentityList, /Show saved signers/);
  assert.match(signerIdentityList, /onClick=\{\(\) => void unlock\(\)\}/);
  assert.doesNotMatch(signerIdentityList, /Unlock private data to reuse saved signers/);
});

test('Inbox does not perform client-side signer relationship discovery', () => {
  assert.doesNotMatch(inbox, /loadAccountsForSigner|Checking your signing access/);
});


test('Human Inbox separates Request status from the current signer next action', () => {
  assert.match(requestInbox, /projectHumanInboxRequests/);
  assert.match(requestInbox, /signerHasSignedTransaction/);
  assert.match(requestInbox, /approval_declined/);
  assert.match(inboxApi, /context\.actor === 'human'/);
  assert.match(inboxApi, /summarizeInboxActions\(humanRequests, intents\)/);
  assert.match(inboxApi, /actor: context\.actor,[\s\S]*pending_count: requests\.length,[\s\S]*requests,/);
  assert.match(inboxPresentation, /'sign'[\s\S]*'submit'[\s\S]*'waiting_for_others'[\s\S]*'waiting_preconditions'[\s\S]*'attention'[\s\S]*'declined'/);
  assert.match(inbox, /Needs me/);
  assert.match(inbox, /viewerAction/);
  assert.match(inbox, /Review & sign|inboxViewerActionPresentation/);
  assert.match(inbox, /window\.matchMedia\('\(min-width: 1280px\)'\)/);
  assert.doesNotMatch(inbox, /xl:hidden sm:p-6[\s\S]{0,200}<DetailPane/);
  assert.match(dashboard, /action_counts/);
  assert.match(dashboard, /inboxActionCountPresentations/);
  assert.match(dashboard, /Inbox action summary/);
  assert.match(dashboard, /need\$\{actionCounts\.signatureNeeded === 1 \? 's' : ''\} your signature/);
  assert.doesNotMatch(dashboard, /waiting for your approval|need your approval/);
});

test('Payment grows from one recipient to many inside one composer', () => {
  assert.doesNotMatch(newTransaction, /title="Batch payment"/);
  assert.match(newTransaction, /isPayment \|\| isBatch[\s\S]*<PaymentComposer/);
  assert.match(payment, /const \[recipients, setRecipients\]/);
  assert.match(payment, /Add recipient/);
  assert.match(payment, /Add another recipient to include multiple payments in the same proposal/);
  assert.match(payment, /PaymentAssetPicker/);
  assert.match(payment, /Choose saved recipient/);
  assert.match(payment, /AddressAliasEditor/);
  assert.match(payment, /Paste a recipient list/);
  assert.match(payment, /buildTransferTransaction/);
  assert.match(payment, /transferDestinationIssues/);
  assert.doesNotMatch(payment, /navigateWorkspace\('\/new\/batch'/);
  assert.doesNotMatch(payment, /batchPromotionDraft|saveTransactionTemplateDraft\(sessionStorage, sessionAddress, network, 'batch'/);
});

test('Payment asset picker is one shared presentation for every recipient row', () => {
  assert.match(payment, /import PaymentAssetPicker from '\.\/PaymentAssetPicker'/);
  assert.match(payment, /ariaLabel=\{`Recipient \$\{index \+ 1\} asset`\}/);
  assert.match(paymentAssetPicker, /data-payment-asset-picker/);
  assert.match(paymentAssetPicker, /role="listbox"/);
  assert.match(paymentAssetPicker, /role="option"/);
  assert.match(paymentAssetPicker, /assetBalanceParts/);
  assert.match(paymentAssetPicker, /compactAssetIssuer/);
  assert.doesNotMatch(payment, /function PaymentAssetPicker/);
});

test('New Payment explicitly clears stale form state while Edit payment can restore the draft', () => {
  assert.match(newTransaction, /\/new\/payment[^\n]*fresh/);
  assert.match(payment, /freshStart/);
  assert.match(payment, /clearPaymentDraft/);
  assert.match(payment, /url\.searchParams\.delete\('fresh'\)/);
  assert.match(signingRoom, /retirePaymentDraft/);
});

test('Treasury New proposal context reaches New and preselects Payment source', () => {
  assert.match(newTransaction, /parseTreasuryRoute\(window\.location\.search\)/);
  assert.match(newTransaction, /New proposal for/);
  assert.match(newTransaction, /account: proposalAccount/);
  assert.match(payment, /url\.searchParams\.get\('account'\)/);
  assert.match(payment, /isValidStellarAccountId\(requestedSource\)/);
});

test('Payment treats public Stellar memo and Private Note as orthogonal full-width context', () => {
  assert.match(payment, /Stellar memo/);
  assert.match(payment, /Private Note/);
  assert.match(payment, /memoProofConflict/);
  assert.doesNotMatch(payment, /contextMode/);
  assert.match(payment, /privateNote: requestPrivateNote \|\| null/);
  assert.match(payment, /rows=\{7\}/);
  assert.doesNotMatch(payment, /Transaction context[\s\S]{0,500}lg:grid-cols-2/);
  assert.match(payment, /Remove public memo/);
  assert.match(payment, /Confirm remove memo/);
  assert.ok(payment.indexOf('Keep memo') < payment.indexOf('Confirm remove memo'));
  assert.match(payment, /Turn off on-chain proof/);
  assert.doesNotMatch(payment, /This draft is kept while you review or edit it/);
});

test('guided transfer Prepare goes directly to Review with bilateral multi-party semantics and public memo', () => {
  assert.match(transferComposer, /Alice, Bob, 100, XLM\\nBob, Alice, 50, USDC/);
  assert.match(transferComposer, /Stellar memo/);
  assert.match(transferComposer, /Optional · public on-chain/);
  assert.match(transferComposer, /memo: memoTrimmed \|\| undefined/);
  assert.match(transferComposer, /writeReviewHandoff\(sessionStorage/);
  assert.match(transferComposer, /navigateWorkspace\('\/signing-room'/);
  assert.match(transferComposer, /returnLabel: `Edit \$\{mode === 'batch' \? 'multiple recipients' : 'multi-party transaction'\}`/);
  assert.doesNotMatch(transferComposer, /Validate draft|Validated draft|PreparedDraft|setPrepared/);
});

test('Review Private Note uses signer-facing privacy language, not lifecycle mechanics', () => {
  assert.match(signingRoom, /Private Note/);
  assert.match(signingRoom, /not end-to-end encrypted/);
  assert.doesNotMatch(signingRoom, /Optional off-chain proposal context/);
  assert.doesNotMatch(signingRoom, /becomes immutable when the Signing Request is created/);
});

test('freeze point hands every post-review action to Request', () => {
  const continueBody = signingRoom.match(/async function continueToSignatures\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.ok(continueBody);
  assert.match(continueBody, /await createStoredRequest\(effectiveXdr\)/);
  assert.match(continueBody, /navigateWorkspace\('\/s'/);
  assert.match(continueBody, /replace: true/);
  assert.doesNotMatch(signingRoom, /SIGNING_ROOM_HISTORY_STATE_KEY|persistSigningRoomState|signWithConnectedWallet|submitCurrentTransaction|addSignatureToStoredRequest|mergeSignedCopy/);
  assert.doesNotMatch(requestUi, /takeReviewHandoff|createSharedRequest/);
  assert.match(requestUi, /signRequestWithWallet/);
  assert.match(requestUi, /async function submitRequest/);
  assert.match(requestUi, /requestPreview/);
  assert.match(requestUi, /navigation\.justCreated \|\| \(initialPreview/);
});

test('known creator Activity access survives Review to Proposal navigation', () => {
  assert.match(signingRoom, /activityBound: body\.access\?\.activityBound \?\? false/);
  assert.match(signingRoom, /requestActivityBound: request\.activityBound/);
  assert.match(requestUi, /requestActivityBound\?: boolean/);
  assert.match(requestUi, /useState\(navigation\.activityBound\)/);
});


test('retained Activity access never substitutes for active Request authority', () => {
  const getBody = requestApi.match(/export async function GET\(request: Request\): Promise<Response> \{([\s\S]*?)\n\}\n\nexport async function POST/)?.[1] ?? '';
  assert.ok(getBody);
  assert.match(requestApi, /type RequestAuthorizationPurpose = 'active' \| 'history'/);
  assert.match(requestApi, /session && purpose === 'history'/);
  assert.match(requestApi, /purpose === 'active'[\s\S]*signerCanAccessTransaction/);
  assert.doesNotMatch(getBody, /bindRequestParticipantBestEffort/);
  assert.match(requestApi, /body\.retainActivity === true/);
  assert.match(requestApi, /Only a current signer can save this active proposal to retained Activity/);
  assert.match(requestUi, /JSON\.stringify\(\{ retainActivity: true \}\)/);
  assert.match(requestApi, /for \(const signerAddress of result\.acceptedSignerAddresses\)/);
  assert.match(requestApi, /if \(capabilityMatched\)[\s\S]*getRequestParticipant\?\.\(id, session\.address\)[\s\S]*activityBound: Boolean\(participant\)/);
  assert.match(requestUi, /activeCapabilityNeedsActivity[\s\S]*!walletAlreadySigned/);
});

test('a successful signature continuation stays collaborative without overriding stronger signer authority', () => {
  const activeSession = requestApi.indexOf("if (session && purpose === 'active')");
  const contributionFallback = requestApi.indexOf('contributionGrant\n    && contributionGrant.requestId === id'.replace('\\n', '\n'));
  assert.ok(activeSession >= 0 && contributionFallback > activeSession);
  assert.match(requestApi, /const isSignatureContribution = typeof body\.signedXdr === 'string'/);
  assert.match(requestApi, /access\.mode === 'contribution'[\s\S]*!isSignatureContribution/);
  const putBody = requestApi.match(/export async function PUT\(request: Request\): Promise<Response> \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(putBody);
  assert.doesNotMatch(putBody, /request_write_denied|short-lived signing continuation is read-only/);
  assert.match(putBody, /submitSigningRequest/);
});

test('Personal Activity uses shared Treasury identity before Personal note', () => {
  assert.match(activityUi, /treasuryDisplayLabel\(treasuryNames\[id\], labelFor\(id, 'account'\)\)/);
});

test('Personal and Treasury Activity share presentation without sharing data scope', () => {
  assert.match(activityUi, /stellarActivityScopeForPath\(window\.location\.pathname\)/);
  assert.match(activityUi, /activityScope === 'treasury'/);
  assert.match(activityUi, /Proposal and transaction history this wallet saved, signed, declined, or otherwise participated in/);
  assert.match(activityUi, /Retained MultiSig Tools proposal and transaction history for this Treasury/);
  assert.match(activityUi, />View network record<\/a>/);
  assert.doesNotMatch(activityUi, />View on Horizon<\/a>/);
  assert.doesNotMatch(activityUi, /getWorkspaceMode/);
});

test('account-control review owns its post-freeze Treasury return target explicitly', () => {
  assert.match(multisigDesigner, /requestReturnTo: backHref/);
  assert.match(multisigDesigner, /const requestReturnLabel = accountSigningIntent === 'treasury'/);
  assert.match(multisigDesigner, /createTreasuryIntent \? 'Back to Treasuries' : 'Back to Treasury'/);
  assert.match(multisigDesigner, /'Back to Account signing'/);
  assert.match(existingMultisigPolicyEditor, /requestReturnTo: requestReturnTo \?\? treasuryOverviewHref\(account\.accountId, network\)/);
  assert.match(signingRoom, /returnTo: postFreezeReturnTarget\.href/);
  assert.match(signingRoom, /returnLabel: postFreezeReturnTarget\.label/);
});

test('Transaction Receipt uses one server history projection instead of serial Activity and Horizon reads', () => {
  assert.match(transactionReceipt, /searchParams\.set\('view', 'history'\)/);
  assert.match(transactionReceipt, /requestBody\.history\.activity/);
  assert.match(transactionReceipt, /requestBody\.history\.sourceAnalyses/);
  assert.doesNotMatch(transactionReceipt, /fetch\(activityUrl/);
  assert.doesNotMatch(transactionReceipt, /loadTransactionSourceAnalyses\(/);
  assert.match(requestApi, /loadTransactionSourceAnalyses\([\s\S]*access\.stored\.baseXdr[\s\S]*accountLoader/);
  assert.match(requestApi, /getSigningRequestForStoredRequest\([\s\S]*access\.stored/);
  assert.match(requestApi, /loadSigningRequestReadFacts\(blobSigningRequestStore, access\.stored\)/);
  assert.match(requestApi, /privateNoteRevisionsPromise/);
});

test('Activity keeps only an in-memory same-unlock projection while refreshing', () => {
  assert.match(activityUi, /const activityProjectionCache = new Map/);
  assert.match(activityUi, /unlockExpiresAt/);
  assert.match(activityUi, /cachedActivityProjection\(projectionKey\)/);
  assert.match(activityUi, /cacheActivityProjection\(targetProjectionKey, next\)/);
  assert.doesNotMatch(activityUi, /sessionStorage\.setItem\([^\n]*activity/i);
});

test('finished transaction receipt is a history resource with an explicit return target', () => {
  assert.doesNotMatch(transactionReceipt, /origin.*signing|Back to signing/);
  assert.doesNotMatch(requestUi, /origin: 'signing'/);
  assert.match(requestUi, /returnLabel: 'Back to transaction'/);
  assert.match(transactionReceipt, /Human-readable receipt with your authorized workspace context/);
  assert.match(transactionReceipt, /Proposal ID/);
  assert.match(transactionReceipt, /transaction-evidence-record/);
  assert.doesNotMatch(transactionReceipt, /transaction-evidence-status|transaction-evidence-metadata/);
  assert.match(stellarCss, /transaction-evidence-record-grid/);
  assert.match(transactionReceipt, /Signatures collected/);
  assert.match(transactionReceipt, /sourceAuthorization = analyzeAccountAuthorization\(sourceAccount\)/);
  assert.match(transactionReceipt, /humanAuthorizationRequirement\(sourceAuthorization\.thresholds\.medium\)/);
  assert.match(transactionReceipt, /humanAuthorizationRequirement\(sourceAuthorization\.thresholds\.high\)/);
  assert.match(transactionReceipt, /approval power \$\{signer\.weight\}/);
  assert.doesNotMatch(transactionReceipt, /Authorization collected/);
  assert.doesNotMatch(transactionReceipt, /sourceAccount\.thresholds\.medium\} payment/);
  assert.doesNotMatch(transactionReceipt, / · weight \$\{signer\.weight\}/);
  assert.ok(transactionReceipt.indexOf('WorkflowProgress current="done"') < transactionReceipt.indexOf('Export evidence PDF'));
  assert.ok(transactionReceipt.indexOf('Transaction receipt</h1>') < transactionReceipt.indexOf('Export evidence PDF'));
  assert.match(transactionReceipt, /snapshot\.signatureCount\} signature/);
  assert.doesNotMatch(transactionReceipt, /approvalActors\.size\} signature/);
  assert.match(transactionReceipt, /snapshot\.submission\.submittedAt/);
  assert.match(transactionReceipt, /Open transaction/);
  assert.doesNotMatch(transactionReceipt, /Unlock transaction history|Unlock history/);
  assert.match(stellarCss, /transaction-evidence-human-label/);
  assert.match(stellarCss, /transaction-evidence-signature-grid/);
  assert.match(transactionReceipt, /value === address/);
  assert.match(transactionReceipt, /sourceAccounts\.map/);
  assert.match(transactionReceipt, /isAccountKey \? 'Account key · '/);
  assert.match(transactionReceipt, /sourceAccount\.accountId/);
  assert.doesNotMatch(transactionReceipt, /Treasury.*master key/i);
  assert.match(transactionReceipt, /Submitted to Stellar'/);
  assert.doesNotMatch(stellarCss, /transaction-evidence-print-authorization[\s\S]{0,200}display: block/);
});

test('transaction evidence keeps Treasury resource notes on screen but out of signer and PDF identity', () => {
  assert.match(transactionReceipt, /const sharedNameAccountIds = \[\.\.\.new Set\(\[accountId, \.\.\.sourceAccountIds\]\.filter\(Boolean\)\)\]/);
  assert.match(transactionReceipt, /const accountResourceLabel = \(value: string\) => treasuryDisplayLabel\([\s\S]*treasuryNames\[value\] \|\| ''[\s\S]*labelFor\(value, 'account'\)/);
  assert.match(transactionReceipt, /const sourceSharedLabel = sharedAccountLabel\(sourceAccount\.accountId\)/);
  assert.match(transactionReceipt, /sourceLabel && <div className="mt-1 font-semibold">\{sourceLabel\}<\/div>/);
  assert.match(transactionReceipt, /transaction-evidence-human-document/);
  assert.match(transactionReceipt, /PortableEvidenceDocument record=\{portableEvidence\}/);
  assert.match(transactionReceipt, /const alias = isAccountKey \? sourceSharedLabel : labelFor\(signer\.key, 'signer'\)/);
  assert.doesNotMatch(transactionReceipt, /const alias = isAccountKey \? sourceLabel/);
  assert.doesNotMatch(portableEvidenceDocument, /sourceTreasuryName|sourceAlias|labelFor|treasuryDisplayLabel/);
  assert.match(productSemantics, /Treasury Personal note is a resource annotation, not a signer name/);
  assert.match(productSemantics, /Signer\/account identity is the exact Stellar address/);
});

test('PDF History preserves recorded exact actors without a Human name resolver', () => {
  assert.match(portableEvidenceProjection, /actorAddress: event\.actorAddress/);
  assert.match(portableEvidenceDocument, /const actor = event\.actorAddress/);
  assert.match(portableEvidenceDocument, /\$\{actor\} signed/);
  assert.match(portableEvidenceDocument, /Signature added · signer not recorded/);
  assert.doesNotMatch(portableEvidenceDocument, /labelFor|treasuryDisplayLabel|shortAddress/);
});

test('Request mutations keep a valid signer projection visible while refreshing derived policy', () => {
  const applySnapshotBody = requestUi.match(/async function applySnapshot\(next: SigningRequestSnapshot\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';
  assert.ok(applySnapshotBody);
  assert.match(applySnapshotBody, /if \(!sameRequest\) setSourceAnalyses\(\[\]\)/);
  assert.doesNotMatch(applySnapshotBody, /setInspection\(parsed\);\n    setSourceAnalyses\(\[\]\)/);
});

test('Request owns an explicit reversible submit confirmation', () => {
  assert.match(requestUi, /submitArmed/);
  assert.match(requestUi, /Submit this transaction to Stellar/);
  assert.doesNotMatch(requestUi, /Broadcast this transaction to Stellar/);
  assert.match(requestUi, /Transaction confirmed/);
  assert.match(requestUi, />View network record<\/a>/);
  assert.doesNotMatch(requestUi, />View on Horizon<\/a>/);
  assert.match(requestUi, />Choose another route<\/button>/);
  assert.match(requestUi, /!executionAlreadyRoutedToMst/);
  assert.match(requestUi, /snapshot\.status !== 'ready' \|\| !submitArmed/);
});

test('generic operation Review keeps exact fields but folds long operation sets on screen', () => {
  assert.match(reviewSummary, /Ledger operations/);
  assert.match(reviewSummary, /operations\.length <= 3/);
  assert.match(reviewSummary, /<details className=\"group\">/);
  assert.match(reviewSummary, /OperationFieldGrid/);
  assert.match(reviewSummary, /operation\.sourceAccount/);
  assert.match(reviewSummary, /No additional structured fields are available here/);
  assert.match(reviewSummary, /data-operation-screen-fields/);
  assert.match(reviewSummary, /data-operation-print-fields/);
  assert.match(stellarCss, /\[data-operation-details\] \[data-operation-screen-fields\]/);
  assert.match(stellarCss, /\[data-operation-details\] \[data-operation-print-fields\]/);
  assert.match(stellarCss, /display: block !important/);
  assert.match(stellarCss, /#root > div \{[\s\S]{0,120}overflow: visible !important/);
  assert.match(stellarCss, /\[data-operation-details\] > div:not\(:first-child\) \{[\s\S]{0,100}break-inside: avoid/);
});

test('Review/history copy does not leak approval language into public memo evidence', () => {
  assert.doesNotMatch(reviewSummary, /This memo is part of the transaction you are approving|What you are approving|before approving/);
  assert.match(reviewSummary, /What you are reviewing/);
  assert.match(reviewSummary, /mode === 'history' \? 'Transaction'/);
});

test('account-control review exposes Human core-control authorization and blocks guided critical target risk', () => {
  assert.match(reviewSummary, /Current account-control authorization/);
  assert.match(reviewSummary, /accountControlReview\.currentHighRequirement/);
  assert.match(reviewSummary, /accountControlReview\?\.risks/);
  assert.match(signingGuidance, /Current account-control authorization/);
  assert.match(signingGuidance, /Core account control · \{humanAuthorizationRequirement\(policy\)\}/);
  assert.doesNotMatch(signingGuidance, /High threshold \{policy\.threshold\}/);
  assert.match(existingMultisigPolicyEditor, /assessAccountControlPolicyTransition/);
  assert.match(existingMultisigPolicyEditor, /hasCriticalPolicyRisk/);
  assert.match(existingMultisigPolicyEditor, /!hasCriticalPolicyRisk/);
});

test('wallet menu has durable product sign out distinct from locking private data', () => {
  assert.match(accountControl, /Sign out/);
  assert.match(accountControl, /signOutWorkspace/);
  assert.match(walletContext, /AUTO_CONNECT_SUPPRESSED_KEY/);
  assert.match(walletContext, /storedAutoConnectSuppression/);
  assert.match(walletContext, /rememberAutoConnectSuppression/);
  assert.match(walletContext, /const signOut = useCallback/);
  assert.doesNotMatch(walletContext, /signOut: lock/);
});

test('primary wallet menu hides private-session duration while Prepare owns transaction lifetime', () => {
  assert.doesNotMatch(accountControl, /Default unlock duration/);
  assert.doesNotMatch(accountControl, /UNLOCK_DURATION_OPTIONS/);
  assert.doesNotMatch(accountControl, /unlock\(defaultUnlockDuration\)/);
  assert.doesNotMatch(accountControl, /Default transaction lifetime/);
  assert.match(unlockPreferences, /15 \* 60/);
  assert.match(unlockPreferences, /60 \* 60/);
  assert.match(unlockPreferences, /8 \* 60 \* 60/);
  assert.match(walletContext, /durationSeconds \?\? getDefaultUnlockDuration\(localStorage\)/);
  assert.match(privateWorkspaceUnlock, /getDefaultUnlockDuration\(localStorage\)/);
  assert.match(payment, /Default for new transactions/);
  assert.match(payment, /setDefaultTransactionLifetime\(localStorage, signingWindowSeconds\)/);
  assert.match(payment, /This transaction can override it/);
  assert.doesNotMatch(payment, /Defaults from your account menu/);
});

test('private destinations confirm the wallet inside the user action instead of requiring a separate Unlock step', () => {
  assert.match(requestUi, /Confirm your wallet/);
  assert.match(requestUi, /buttonLabel="Open transaction"/);
  assert.match(requestUi, /contributionGrantActive/);
  assert.match(requestUi, /if \(!privateReadyForRequest && !contributionGrantActive\) await unlock\(undefined, snapshot\.network\)/);
  assert.match(transactionReceipt, /history_access_denied/);
  assert.match(transactionReceipt, /!privateReady && !networkMismatch && !snapshot && !loading/);
  assert.match(requestUi, />Transaction receipt<\/button>/);
  assert.doesNotMatch(requestUi, /privateReadyForRequest && \(!capability \|\| activityBound\).*Transaction receipt/);
  assert.match(requestUi, /Finished proposals use retained wallet history instead of the old share link/);
  assert.doesNotMatch(requestUi, /not saved to Activity before the link closed/);
  assert.match(activityUi, /buttonLabel="Open Activity"/);
  assert.doesNotMatch(activityUi, /Unlock Activity/);
  assert.match(inbox, /buttonLabel="Open Inbox"/);
  assert.doesNotMatch(inbox, /Unlock Inbox/);
  assert.match(workspaceShell, /openPrivateWorkspace/);
  assert.match(workspaceShell, /await unlock\(\)/);
  assert.match(activityRetention, /Save to Activity/);
  assert.match(activityRetention, /Confirm a current signer wallet/);
  assert.doesNotMatch(activityRetention, /Unlock for Activity|Unlock once|Unlocking/);
});

test('Treasury onboarding can be dismissed while keeping Create and generic offline multisig secondary', () => {
  assert.match(treasury, /Dismiss guide/);
  assert.match(treasury, /Setup guide dismissed/);
  assert.match(treasury, /Set up multisig offline/);
  assert.doesNotMatch(treasury, /Advanced: bootstrap a cold\/offline treasury/);
  assert.match(treasuryPreferences, /TREASURY_ONBOARDING_DISMISSED_PREFIX/);
});

test('known Request creator and submitter actors are persisted only when provenance is available', () => {
  assert.match(requestApi, /creatorAddress: creatorSession\.address/);
  assert.match(signingRoom, /privateSessionAddressHeaders\(wallet\.address\)/);
  assert.match(requestApi, /submittedByAddress: access\.actorAddress/);
  assert.match(requestService, /recordSubmittedActivity\(store, snapshot, options\.submittedByAddress\)/);
});

test('authorization evidence keeps raw signer identities instead of shortening them', () => {
  assert.match(authorizationResults, /break-all font-mono/);
  assert.match(authorizationResults, /EvidenceIdentity/);
  assert.doesNotMatch(authorizationResults, /shortKey/);
  assert.match(transactionReceipt, /event\.actorAddress/);
});

test('PDF History keeps timestamps in a dedicated right column', () => {
  assert.match(transactionReceipt, /transaction-evidence-history-line/);
  assert.match(stellarCss, /grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(stellarCss, /transaction-evidence-history-line time/);
});

test('Human collaboration surfaces use Proposal while Request stays technical', () => {
  assert.match(signingGuidance, /Sign proposal/);
  assert.match(signingRoom, /Starting proposal/);
  assert.match(requestUi, /proposal ID/);
  assert.match(requestUi, /Anyone with this private link can view the active Proposal/);
  assert.match(inbox, /buttonLabel="Open Inbox"/);
  assert.doesNotMatch(inbox, /Unlock Inbox|Unlock to view proposals/);
  assert.match(workspaceOnboarding, /review proposals waiting for you/);
  assert.match(landing, /Payment proposal/);
  assert.doesNotMatch(requestUi, /This wallet cannot open this request|Wallet and request are on different networks/);
  assert.doesNotMatch(inbox, /Unlock to view requests/);
});

test('compact product semantics fixes Human vocabulary and identity hierarchy', () => {
  assert.match(productSemantics, /\| Proposal \| Signing Request \|/);
  assert.match(productSemantics, /\| Contact \| personally named Stellar address \|/);
  assert.match(productSemantics, /Recipient\/destination is a transaction role/);
  assert.match(productSemantics, /shared Treasury name \+ optional Personal note/);
  assert.match(productSemantics, /Treasury Personal note is a resource annotation, not a signer name/);
  assert.match(productSemantics, /Portable evidence never contains Shared Name, Personal note, Address Book names, Private Note plaintext, or private memo opening data/);
  assert.match(productSemantics, /Active capability access and retained historical access are different/);
  assert.match(productSemantics, /finished Proposal must keep the \*\*Transaction receipt\*\* destination visible while private data is locked/);
  assert.match(productSemantics, /retained signer candidates captured with the Request/);
  assert.match(productSemantics, /Proposal` scope follows the exact Stellar transaction, not a single Treasury/);
  assert.match(productSemantics, /multiple source accounts controlled by independent entities/);
});

test('verified Soroban Proposal origin stays Human audit context rather than portable evidence identity', () => {
  assert.match(requestUi, /snapshot\.sorobanOrigin/);
  assert.match(requestUi, /Soroban origin:/);
  assert.match(transactionReceipt, /snapshot\.sorobanOrigin/);
  assert.match(transactionReceipt, /plan revision/);
  assert.doesNotMatch(portableEvidenceProjection, /sorobanOrigin/);
});

test('portable evidence is a separate projection that cannot consume Human metadata', () => {
  assert.match(transactionReceipt, /buildPortableEvidenceRecord\(\{ snapshot, activity, inspection, sourceAnalyses \}\)/);
  assert.match(stellarCss, /transaction-evidence-human-document/);
  assert.match(stellarCss, /transaction-evidence-portable-document/);
  assert.match(portableEvidenceProjection, /export interface PortableEvidenceRecord/);
  assert.doesNotMatch(portableEvidenceProjection, /sharedName|personalNote|addressBook|privateNote|privateMemo/i);
  assert.doesNotMatch(portableEvidenceDocument, /useAddressBook|treasuryDisplayLabel|PrivateNoteCard|PrivateCommitmentDisclosure|labelFor/);
  assert.match(portableEvidenceDocument, /Canonical ledger and audit facts only/);
  assert.match(transactionReceipt, /never included in the evidence PDF/);
  assert.doesNotMatch(transactionReceipt, /Include Private Note|Include Private memo|Print options/);
});

test('production CSP permits only the configured default Stellar RPC origins needed by Soroban Review', () => {
  assert.match(vercelConfig, /connect-src[^"]*https:\/\/rpc\.lightsail\.network[^"]*https:\/\/soroban-testnet\.stellar\.org/);
  assert.doesNotMatch(vercelConfig, /connect-src[^"]*\*/);
});

test('Stellar TypeScript gate starts from the real route entrypoint', () => {
  assert.match(stellarTsconfig, /src\/main\.tsx/);
});


test('payment review keeps issued asset identity visible for single and multiple recipients', () => {
  assert.match(reviewSummary, /PaymentAssetIdentity/);
  assert.match(reviewSummary, /compactAssetIssuer/);
  assert.match(reviewSummary, /Issuer \{compactAssetIssuer\(identity\.issuer\)\}/);
  assert.match(reviewSummary, /asset=\{payment\.asset\}/);
  assert.match(reviewSummary, /asset=\{item\.asset\}/);
  assert.doesNotMatch(reviewSummary, /item\.asset\.split\(' · '\)\[1\]/);
});

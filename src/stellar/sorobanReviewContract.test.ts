import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const signingRoom = source('../SigningRoomApp.tsx');
const inspector = source('../TransactionInspectorSummary.tsx');
const authorization = source('../TransactionAuthorizationResults.tsx');
const sorobanAuthorization = source('../SorobanAuthorizationResults.tsx');
const sorobanPreparation = source('../SorobanAuthorizationPreparation.tsx');
const sorobanIntentApp = source('../SorobanIntentApp.tsx');
const requestApp = source('../RequestApp.tsx');
const reviewHandoff = source('./reviewHandoff.ts');
const effectsDiffView = source('../SorobanEffectsDiffView.tsx');
const sorobanAuthCore = source('./sorobanAuthorization.ts');
const sorobanCustomAuthCore = source('./sorobanCustomAuthorization.ts');
const sorobanContractAdapter = source('./sorobanContractAdapter.ts');
const walletKit = source('./walletKit.ts');
const sorobanRpc = source('./sorobanRpc.ts');
const contractOperationsClient = source('../contractOperationsClient.ts');
const contractPrepareApi = source('../../apps/api/stellar/routes/contract-prepare.ts');
const intentApi = source('../../apps/api/stellar/routes/intent.ts');
const importedIntentService = source('../../apps/api/stellar/server/importedSorobanIntentService.ts');
const intentAuthorizationService = source('../../apps/api/stellar/server/sorobanIntentAuthorizationService.ts');
const intentExecutionService = source('../../apps/api/stellar/server/sorobanIntentExecutionService.ts');
const intentReconciliationService = source('../../apps/api/stellar/server/sorobanIntentExecutionReconciliationService.ts');
const intentEvidence = source('../../apps/api/stellar/server/sorobanIntentEvidence.ts');
const intentPlanningService = source('../../apps/api/stellar/server/sorobanIntentPlanningService.ts');
const viteConfig = source('../../vite.config.ts');
const envExample = source('../../.env.example');
const requestService = source('../../apps/api/stellar/server/requestService.ts');
const requestOriginService = source('../../apps/api/stellar/server/sorobanRequestOrigin.ts');
const requestApi = source('../../apps/api/stellar/routes/request.ts');
const productSemantics = source('../../PRODUCT_SEMANTICS.md');
const sorobanContract = source('../../SOROBAN_AUTHORIZATION.md');

test('Soroban Review separates envelope authorization from contract authorization', () => {
  assert.match(inspector, /Envelope signatures/);
  assert.match(inspector, /Envelope auth checks/);
  assert.match(inspector, /Soroban auth entries/);
  assert.match(authorization, /Transaction envelope authorization/);
  assert.match(sorobanAuthorization, /Soroban authorization entries approve contract invocation trees/);
  assert.match(sorobanAuthorization, /Authorized invocation tree/);
});

test('Soroban Review routes detached authorization into Intent before envelope signing', () => {
  assert.match(sorobanAuthorization, /Contract authorization/);
  assert.ok(signingRoom.indexOf('<SorobanAuthorizationResults') < signingRoom.indexOf('<details className=\"group mst-advanced-panel'));
  assert.match(signingRoom, /sorobanAuthorizationReady/);
  assert.doesNotMatch(signingRoom, /Complete Soroban authorization in Advanced/);
  assert.match(signingRoom, /autoSorobanSimulation/);
  assert.match(sorobanAuthorization, /autoRun/);
  assert.match(sorobanAuthorization, /Checking contract requirements/);
  assert.match(signingRoom, /createStoredRequest\(effectiveXdr\)/);
  assert.match(signingRoom, /selectedWalletCanStartProposal/);
  assert.match(signingRoom, /Choose transaction signer/);
  assert.match(sorobanPreparation, /Continue as Soroban Intent/);
  assert.match(sorobanPreparation, /Prepared transaction fields are discarded here/);
  assert.match(sorobanPreparation, /fetch\('\/api\/intent'/);
  assert.doesNotMatch(sorobanPreparation, /fetch\('\/api\/preparation'/);
  assert.match(walletKit, /signAuthEntry/);
  assert.match(sorobanIntentApp, /signAuthEntry/);
  assert.match(sorobanIntentApp, /authorization_ready/);
  assert.match(sorobanAuthCore, /buildAuthorizationEntryPreimage/);
  assert.match(sorobanAuthCore, /thresholds\.medium/);
  assert.match(requestService, /soroban_authorization_incomplete/);
  assert.match(requestService, /assertSorobanTransactionPreparedForFreeze/);
  assert.match(requestService, /verifySorobanExecutionForBoundary/);
  assert.match(requestApi, /enforcePreparedSorobanTransaction/);
  assert.match(requestApi, /status: 'verified'/);
  assert.match(sorobanIntentApp, /prepareExecution/);
  assert.match(sorobanIntentApp, /executionSource/);
  assert.match(sorobanIntentApp, /action: 'replan'/);
  assert.match(sorobanIntentApp, /action: 'cancel'/);
  assert.match(sorobanIntentApp, /Cancel Intent/);
  assert.match(sorobanIntentApp, /cannot revoke detached AUTH/);
  assert.match(sorobanIntentApp, /Refresh authorization/);
  assert.match(sorobanIntentApp, /Simulation effects at authorization/);
  assert.match(sorobanIntentApp, /Execution effects comparison/);
  assert.match(sorobanIntentApp, /I reviewed this numeric change/);
  assert.match(intentApi, /acceptedEffectsDigest: body\.acceptedEffectsDigest/);
  assert.match(intentApi, /body\.action === 'cancel'/);
  assert.match(intentApi, /assertSorobanIntentCancellationOwner/);
  assert.match(intentApi, /cancelSorobanIntent/);
  assert.match(intentExecutionService, /putExecutionPreparation/);
  assert.match(sorobanIntentApp, /Review changed effects and re-authorize/);
  assert.match(sorobanIntentApp, /requiresReauthorization/);
});

test('final Soroban broadcast remains bound to reviewed effects in both direct and Proposal submission', () => {
  assert.match(sorobanIntentApp, /sorobanEffectsBaseline: body\.execution\.effects/);
  assert.match(sorobanIntentApp, /sorobanTransactionHash: body\.execution\.transactionHash/);
  assert.match(sorobanIntentApp, /sorobanIntentId: intent\.id/);
  assert.match(signingRoom, /sorobanIntentId: handoff\.sorobanIntentId/);
  assert.match(requestApi, /verifySorobanRequestOrigin/);
  assert.match(requestApi, /sorobanOrigin \? \{ sorobanOrigin, executionPolicy: \{ mode: 'multisigtools' as const \} \} : \{\}/);
  assert.match(requestOriginService, /item\.transactionHash === input\.transactionHash/);
  assert.match(requestService, /soroban_origin_effects_changed/);
  assert.match(reviewHandoff, /SOROBAN_EFFECTS_HANDOFF_KEY/);
  assert.match(reviewHandoff, /SOROBAN_TRANSACTION_HASH_HANDOFF_KEY/);
  assert.match(signingRoom, /directSorobanBaselineBound/);
  assert.match(signingRoom, /transactionHashHex\(effectiveXdr, network\) === handoff\.sorobanTransactionHash/);
  assert.match(signingRoom, /verifyPreparedContractCallOperation/);
  assert.match(contractOperationsClient, /mode: 'enforce'/);
  assert.match(contractPrepareApi, /enforcePreparedSorobanTransaction/);
  assert.match(signingRoom, /compareSorobanEffects/);
  assert.match(signingRoom, /diff\.currentDigest !== reviewedDigest/);
  assert.match(signingRoom, /acceptedDirectEffectsDigest/);
  assert.match(signingRoom, /effects change again, this confirmation stops/);
  assert.match(requestApp, /soroban_effects_review_required/);
  assert.match(requestApp, /soroban_effects_reauthorization_required/);
  assert.match(requestApp, /acceptedEffectsDigest/);
  assert.match(requestService, /soroban_effects_review_required/);
  assert.match(requestService, /soroban_effects_reauthorization_required/);
  assert.match(effectsDiffView, /Maximum difference/);
  assert.match(effectsDiffView, /Structural change/);
});

test('external Soroban execution result is independently reconciled from persisted preparation evidence', () => {
  const reconcileBranch = intentApi.indexOf("body.action === 'reconcile_execution'");
  const integrationExecutionGuard = intentApi.indexOf('integrationOwnedExecution && !access.integrationCredential');
  assert.ok(reconcileBranch >= 0 && integrationExecutionGuard > reconcileBranch);
  assert.match(intentReconciliationService, /listExecutionPreparations/);
  assert.match(intentReconciliationService, /loadTransactionByHash/);
  assert.match(intentReconciliationService, /putExecutionObservation/);
  assert.match(intentReconciliationService, /intent_execution_preparation_not_found/);
  assert.doesNotMatch(intentReconciliationService, /submittedBy|submitter/);
  assert.match(intentApi, /listExecutionObservations/);
  assert.match(intentEvidence, /execution_confirmed/);
  assert.match(intentEvidence, /execution_failed/);
});

test('imported prepared Soroban XDR crosses into the source-free Intent workflow', () => {
  assert.match(sorobanPreparation, /Continue as Soroban Intent/);
  assert.match(sorobanPreparation, /preparedXdr: state\.xdr/);
  assert.match(sorobanPreparation, /navigateWorkspace\('\/a'/);
  assert.match(importedIntentService, /createImportedSorobanIntent/);
  assert.match(importedIntentService, /prepared_xdr_already_signed/);
  assert.match(importedIntentService, /source_account_auth_unsupported/);
  assert.match(importedIntentService, /createSorobanAuthorizationPlan/);
  assert.match(sorobanAuthorization, /Prepared Soroban XDR/);
  assert.match(sorobanAuthorization, /assertSorobanTransactionPreparedForFreeze/);
});

test('Soroban architecture is Intent-first while preserving the one Human transaction workflow', () => {
  assert.match(productSemantics, /1 Prepare -> 2 Review -> 3 Sign -> 4 Submit -> 5 Done/);
  assert.match(productSemantics, /durable \*\*Intent\*\*/);
  assert.match(productSemantics, /authorization_ready/);
  assert.match(productSemantics, /SOURCE_ACCOUNT.*rejected/);
  assert.match(sorobanContract, /Status: Current architecture/);
  assert.match(sorobanContract, /semantic Soroban Intent/);
  assert.match(sorobanContract, /late-bound execution source/);
  assert.match(sorobanContract, /discards transaction source, sequence, fee, timebounds, resource shell/);
  assert.match(sorobanContract, /auth-entry signatures are never treated as transaction-envelope signatures/);
});


test('recording simulation and shared authorization are Headless Intent operations', () => {
  assert.match(sorobanAuthorization, /prepareContractCallOperation/);
  assert.doesNotMatch(sorobanAuthorization, /simulateSorobanTransaction/);
  assert.match(contractOperationsClient, /fetch\('\/api\/contract-prepare'/);
  assert.match(contractPrepareApi, /simulateSorobanTransaction/);
  assert.match(intentApi, /createImportedSorobanIntent/);
  assert.match(intentApi, /contributeSorobanIntentAuthorization/);
  assert.match(intentApi, /prepareSorobanIntentExecution/);
  assert.match(intentApi, /acceptedEffectsDigest/);
  assert.match(intentApi, /replanExpiredSorobanIntent/);
  assert.match(intentApi, /source_account_auth_unsupported'[\s\S]*contract_account_auth_unsupported'[\s\S]*\? 409 : 503/);
  assert.doesNotMatch(intentApi, /SorobanPreparation/);
});

test('Soroban RPC supports recording and enforcing simulation around Intent planning/execution', () => {
  assert.match(envExample, /STELLAR_RPC_PUBLIC_URL="https:\/\/rpc\.lightsail\.network\/"/);
  assert.match(envExample, /STELLAR_RPC_TESTNET_URL="https:\/\/soroban-testnet\.stellar\.org\/"/);
  assert.match(viteConfig, /process\.env\.STELLAR_RPC_PUBLIC_URL/);
  assert.match(viteConfig, /process\.env\.STELLAR_RPC_TESTNET_URL/);
  assert.match(sorobanRpc, /authMode: 'record'/);
  assert.match(sorobanRpc, /authMode: 'enforce'/);
  assert.match(sorobanAuthorization, /Run RPC simulation/);
  assert.match(sorobanAuthorization, /sends the exact pre-submission XDR/);
  assert.match(sorobanContract, /recording simulation/);
  assert.match(sorobanContract, /immutable detached AuthorizationPlan/);
  assert.match(sorobanContract, /enforcing simulation/);
  assert.match(sorobanContract, /effects diff \/ explicit review/);
  assert.match(sorobanContract, /final unsigned transaction/);
});

test('unknown C-account authorization remains fail-closed outside configured Intent adapters', () => {
  assert.match(sorobanAuthorization, /Contract account \(__check_auth\)/);
  assert.match(sorobanAuthorization, /Contract\/network-enforced authorization/);
  assert.match(sorobanAuthorization, /does not locally prove custom account policy or credential validity/);
  assert.match(sorobanAuthorization, /unknown C-accounts and delegated credentials remain inspect-only/i);
  assert.match(sorobanAuthCore, /not handled by the G-account analyzer/);
  assert.match(sorobanAuthCore, /Explicitly configured C-account adapters are coordinated through Soroban Intent/);
  assert.match(sorobanContract, /signature `ScVal` is contract-defined evidence/);
  assert.match(sorobanContract, /Unknown C-accounts, multiple detached C-account authorizers, and delegated authorization remain fail-closed/);
  assert.match(productSemantics, /Configured C-account authorization uses the same durable Intent lifecycle/);
});

test('S3B keeps contract-defined credentials challenge-bound inside Intent authorization', () => {
  assert.match(sorobanCustomAuthCore, /SorobanContractAuthorizationChallenge/);
  assert.match(sorobanCustomAuthCore, /createSorobanContractAuthorizationChallengeForEntry/);
  assert.match(sorobanCustomAuthCore, /initializeSorobanContractAccountAuthorizationWindow/);
  assert.match(sorobanCustomAuthCore, /payloadHashHex/);
  assert.match(sorobanCustomAuthCore, /requires-rpc-enforce/);
  assert.match(sorobanCustomAuthCore, /stale or belongs to a different authorization state/);
  assert.match(intentAuthorizationService, /stageSorobanContractCredentialContributionEntry/);
  assert.match(sorobanRpc, /prepareEnforcedSorobanTransaction/);
  assert.match(sorobanRpc, /authMode: 'enforce'/);
  assert.match(sorobanRpc, /changed finalized authorization entries/);
  assert.match(productSemantics, /configured adapter may derive and stage its contract-defined `ScVal` evidence[\s\S]*late Execution must still pass enforcing simulation/);
});

test('S3C routes the configured contract-account adapter through Intent-first coordination', () => {
  assert.match(envExample, /STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT/);
  assert.match(envExample, /STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER/);
  assert.match(viteConfig, /process\.env\.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT/);
  assert.match(sorobanPreparation, /Configured contract-account authorization/);
  assert.match(sorobanPreparation, /Intent-first · detached custom credential/);
  assert.match(sorobanPreparation, /Continue as Soroban Intent/);
  assert.doesNotMatch(sorobanPreparation, /prepareEnforcedSorobanTransaction/);
  assert.match(sorobanContractAdapter, /project-configured/);
  assert.match(sorobanContractAdapter, /exactly one detached contract authorizer/);
  assert.match(sorobanContractAdapter, /exact 64-byte signature/);
  assert.match(intentPlanningService, /initializeSorobanContractAccountAuthorizationWindow/);
  assert.match(intentPlanningService, /adapter\.ownerAddress/);
  assert.match(intentAuthorizationService, /resolveSimpleEd25519ContractAccountAdapter/);
  assert.match(importedIntentService, /contract_account_auth_import_unsupported/);
  assert.match(productSemantics, /Configured C-account authorization uses the same durable Intent lifecycle/);
});

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
const sorobanAuthCore = source('./sorobanAuthorization.ts');
const sorobanCustomAuthCore = source('./sorobanCustomAuthorization.ts');
const sorobanContractAdapter = source('./sorobanContractAdapter.ts');
const walletKit = source('./walletKit.ts');
const sorobanRpc = source('./sorobanRpc.ts');
const contractOperationsClient = source('../contractOperationsClient.ts');
const contractPrepareApi = source('../../api/contract-prepare.ts');
const intentApi = source('../../api/intent.ts');
const importedIntentService = source('../../server/importedSorobanIntentService.ts');
const viteConfig = source('../../vite.config.ts');
const envExample = source('../../.env.example');
const requestService = source('../../server/requestService.ts');
const requestApi = source('../../api/request.ts');
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

test('Soroban G-account authorization completes before the exact-XDR Proposal freeze', () => {
  assert.match(sorobanAuthorization, /Contract authorization/);
  assert.ok(signingRoom.indexOf('<SorobanAuthorizationResults') < signingRoom.indexOf('<details className=\"group rounded-2xl'));
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
  assert.match(sorobanContract, /Current architecture — Intent-first/);
  assert.match(sorobanContract, /semantic Soroban Intent/);
  assert.match(sorobanContract, /late-bound Execution source/);
  assert.match(sorobanContract, /imported transaction shell is discarded/);
  assert.match(sorobanContract, /auth-entry signatures change the transaction body/);
});


test('recording simulation and shared authorization are Headless Intent operations', () => {
  assert.match(sorobanAuthorization, /prepareContractCallOperation/);
  assert.doesNotMatch(sorobanAuthorization, /simulateSorobanTransaction/);
  assert.match(contractOperationsClient, /fetch\('\/api\/contract-prepare'/);
  assert.match(contractPrepareApi, /simulateSorobanTransaction/);
  assert.match(intentApi, /createImportedSorobanIntent/);
  assert.match(intentApi, /contributeSorobanIntentAuthorization/);
  assert.match(intentApi, /prepareSorobanIntentExecution/);
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
  assert.match(sorobanContract, /simulation unavailable/);
  assert.match(sorobanContract, /execution\/review evidence only/);
  assert.match(sorobanContract, /recording simulation \/ immutable detached AuthorizationPlan/);
  assert.match(sorobanContract, /enforcing simulation \/ final unsigned transaction/);
});

test('S3A presents contract-account authorization as read-only contract/network evidence', () => {
  assert.match(sorobanAuthorization, /Contract account \(__check_auth\)/);
  assert.match(sorobanAuthorization, /Contract\/network-enforced authorization/);
  assert.match(sorobanAuthorization, /does not locally prove custom account policy or credential validity/);
  assert.match(sorobanAuthorization, /unknown C-accounts and delegated credentials remain inspect-only/i);
  assert.match(sorobanAuthCore, /Contract-account authorization is read-only in this milestone/);
  assert.match(sorobanAuthCore, /custom credential creation and local policy verification are not enabled/);
  assert.match(sorobanContract, /S3A — read-only contract-account authorization foundation/);
  assert.match(sorobanContract, /signature `ScVal` is contract-defined evidence/);
  assert.match(sorobanContract, /Authorization preparation remains blocked for those shapes/);
  assert.match(productSemantics, /contract-account work remains a separate contract\/network-enforced credential path/);
});

test('S3B keeps contract-defined credentials challenge-bound and network-enforced before freeze', () => {
  assert.match(sorobanCustomAuthCore, /SorobanContractAuthorizationChallenge/);
  assert.match(sorobanCustomAuthCore, /preimageXdr/);
  assert.match(sorobanCustomAuthCore, /payloadHashHex/);
  assert.match(sorobanCustomAuthCore, /challenge: SorobanContractAuthorizationChallenge/);
  assert.match(sorobanCustomAuthCore, /requires-rpc-enforce/);
  assert.match(sorobanCustomAuthCore, /stale or belongs to a different transaction state/);
  assert.match(sorobanRpc, /prepareEnforcedSorobanTransaction/);
  assert.match(sorobanRpc, /authMode: 'enforce'/);
  assert.match(sorobanRpc, /changed finalized authorization entries/);
  assert.match(sorobanContract, /S3B — contract-defined credential transport and enforced preparation/);
  assert.match(sorobanContract, /resource re-preparation/);
  assert.match(sorobanContract, /S3B checkpoint.*Request creation still failed closed/);
  assert.match(productSemantics, /configured C-account adapter may stage contract-defined `ScVal` evidence[\s\S]*must pass enforcing simulation/);
});

test('S3C exposes one configured contract-account adapter with explicit provenance and server revalidation', () => {
  assert.match(envExample, /STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT/);
  assert.match(envExample, /STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER/);
  assert.match(viteConfig, /process\.env\.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT/);
  assert.match(sorobanPreparation, /Known contract-account adapter/);
  assert.match(sorobanPreparation, /Adapter provenance/);
  assert.match(sorobanPreparation, /Authorize contract account/);
  assert.match(sorobanPreparation, /prepareEnforcedSorobanTransaction/);
  assert.match(sorobanContractAdapter, /project-configured/);
  assert.match(sorobanContractAdapter, /exactly one detached contract authorizer/);
  assert.match(sorobanContractAdapter, /exact 64-byte signature/);
  assert.match(requestService, /analyzeKnownSorobanContractAuthorization/);
  assert.match(requestService, /verifySorobanExecutionForBoundary/);
  assert.match(sorobanContract, /S3C — one explicit Human contract-account adapter/);
  assert.match(sorobanContract, /unknown C-accounts remain inspect-only\/fail-closed/);
  assert.match(productSemantics, /configured C-account adapter[\s\S]*explicit provenance/);
});

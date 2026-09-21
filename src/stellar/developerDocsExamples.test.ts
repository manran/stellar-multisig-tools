import assert from 'node:assert/strict';
import test from 'node:test';
import { StrKey } from '@stellar/stellar-sdk';
import { createOpenApiDocument } from '../../apps/api/stellar/server/openApiDocument.js';
import { normalizeClassicPaymentInstruction } from './classicPaymentPrepare.js';
import {
  CLASSIC_PAYMENT_EXAMPLE,
  COMMON_API_ERRORS,
  DOCS_SAMPLE_CONTRACT,
  DOCS_SAMPLE_RECIPIENT,
  DOCS_SAMPLE_REQUEST_ID,
  DOCS_SAMPLE_TREASURY,
  SOROBAN_INTENT_EXAMPLE,
  apiDiscoveryExample,
  classicHostedReviewExample,
  classicRequestExample,
  classicStatusExample,
  issueBrowserCapabilityExample,
  webhookVerifyExample,
} from './developerDocsExamples.js';

test('Classic developer example is accepted by the shipped semantic payment normalizer', () => {
  const normalized = normalizeClassicPaymentInstruction({
    network: CLASSIC_PAYMENT_EXAMPLE.network,
    ...CLASSIC_PAYMENT_EXAMPLE.payment,
  });
  assert.equal(normalized.network, 'testnet');
  assert.equal(normalized.sourceAccount, DOCS_SAMPLE_TREASURY);
  assert.equal(normalized.payments[0]?.destination, DOCS_SAMPLE_RECIPIENT);
  assert.equal(normalized.payments[0]?.amount, '1');
  assert.equal(normalized.payments[0]?.asset.type, 'native');
  assert.equal(StrKey.isValidEd25519PublicKey(DOCS_SAMPLE_TREASURY), true);
  assert.equal(StrKey.isValidEd25519PublicKey(DOCS_SAMPLE_RECIPIENT), true);
  assert.match(classicRequestExample, /Idempotency-Key: payroll-test-001/);
  assert.match(classicHostedReviewExample, new RegExp('/s\\?request=' + DOCS_SAMPLE_REQUEST_ID + '&network=testnet$'));
  assert.match(classicStatusExample, new RegExp('X-MultiSig-Request-Id: ' + DOCS_SAMPLE_REQUEST_ID));
});

test('Soroban developer example uses valid Stellar identities and the shipped browser capability transport', () => {
  assert.equal(StrKey.isValidContract(DOCS_SAMPLE_CONTRACT), true);
  assert.equal(SOROBAN_INTENT_EXAMPLE.network, 'testnet');
  assert.equal(SOROBAN_INTENT_EXAMPLE.contractId, DOCS_SAMPLE_CONTRACT);
  assert.match(issueBrowserCapabilityExample, /issue_browser_authorization/);
  assert.match(issueBrowserCapabilityExample, /X-MultiSig-Intent-Id/);
});

test('developer transport examples remain aligned with OpenAPI discovery', () => {
  const document = createOpenApiDocument('https://stellar-testnet.multisig.tools', 'testnet') as any;
  const requestPost = document.paths['/api/request'].post;
  const requestGet = document.paths['/api/request'].get;
  const intentPost = document.paths['/api/intent'].post;
  const intentPut = document.paths['/api/intent'].put;

  assert.equal(requestPost.requestBody.content['application/json'].schema.$ref, '#/components/schemas/ProposalCreateInput');
  assert.equal(intentPost.requestBody.content['application/json'].schema.$ref, '#/components/schemas/ContractIntentCreateInput');
  assert.equal(
    requestPost.parameters.some((item: any) => item.name === 'Idempotency-Key'),
    true,
  );
  assert.equal(
    requestGet.parameters.some((item: any) => item.name === 'x-multisig-request-id' && item.required === true),
    true,
  );
  assert.equal(
    intentPut.parameters.some((item: any) => item.name === 'X-MultiSig-Intent-Id' && item.required === true),
    true,
  );
  assert.match(apiDiscoveryExample, /\/api\/operations/);
  assert.match(apiDiscoveryExample, /\/openapi\.json/);

  for (const status of COMMON_API_ERRORS.map(([status]) => status)) {
    assert.ok(requestPost.responses[status], 'OpenAPI must document HTTP ' + status);
  }
});

test('webhook verification example uses the same Standard Webhooks headers as the server signer', () => {
  assert.match(webhookVerifyExample, /standardwebhooks/);
  assert.match(webhookVerifyExample, /webhook-id/);
  assert.match(webhookVerifyExample, /webhook-timestamp/);
  assert.match(webhookVerifyExample, /webhook-signature/);
  assert.match(webhookVerifyExample, /MULTISIG_WEBHOOK_SECRET/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalPowerLabel, humanAuthorizationLevelLabel, humanAuthorizationRequirement } from './authorizationPresentation.js';
import type { ThresholdAuthorizationSummary } from './types.js';

function summary(overrides: Partial<ThresholdAuthorizationSummary> = {}): ThresholdAuthorizationSummary {
  return {
    level: 'medium',
    threshold: 2,
    reachable: true,
    totalActiveWeight: 3,
    minimumSignerCount: 2,
    singleSignerKeys: [],
    exampleMinimumSets: [],
    policyLabel: '2-of-3',
    exactNOfM: { required: 2, total: 3 },
    guaranteedSignerFailuresTolerated: 1,
    ...overrides,
  };
}

test('uses Human operation labels without pretending thresholds are amount bands', () => {
  assert.equal(humanAuthorizationLevelLabel('low'), 'Limited account actions');
  assert.equal(humanAuthorizationLevelLabel('medium'), 'Standard transactions');
  assert.equal(humanAuthorizationLevelLabel('high'), 'Core account control');
});

test('shows N-of-M only when the authorization analysis proves an exact N-of-M policy', () => {
  assert.equal(humanAuthorizationRequirement(summary()), '2 of 3 approvals');
  assert.equal(humanAuthorizationRequirement(summary({
    threshold: 3,
    totalActiveWeight: 5,
    minimumSignerCount: 2,
    exactNOfM: null,
    policyLabel: 'Weighted · min 2 signers',
  })), '3 approval power required · 5 available');
});

test('keeps unreachable and signer contribution language explicit', () => {
  assert.equal(humanAuthorizationRequirement(summary({ reachable: false, exactNOfM: null })), 'Authorization unreachable');
  assert.equal(approvalPowerLabel(2), 'Approval power 2');
  assert.equal(approvalPowerLabel(0), 'No approval power');
});

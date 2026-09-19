import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_INTEGRATION_PROFILE,
  integrationProfileFromInput,
} from './integrationProfile.js';

test('Integration profile defaults legacy records to full Headless disclosure without changing runtime authority', () => {
  assert.deepEqual(integrationProfileFromInput(undefined), DEFAULT_INTEGRATION_PROFILE);
  assert.equal(DEFAULT_INTEGRATION_PROFILE.authorizationExperience, 'headless');
});

test('Integration profile accepts the three progressive disclosure experiences', () => {
  for (const authorizationExperience of ['hosted', 'native', 'headless'] as const) {
    assert.deepEqual(integrationProfileFromInput({ authorizationExperience }), {
      version: 1,
      authorizationExperience,
    });
  }
});

test('Integration profile rejects unknown product modes instead of silently widening disclosure', () => {
  assert.throws(() => integrationProfileFromInput({ authorizationExperience: 'magic' }));
  assert.throws(() => integrationProfileFromInput(null));
});

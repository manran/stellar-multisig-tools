import assert from 'node:assert/strict';
import test from 'node:test';
import {
  integrationWebhookConfigFromInput,
  IntegrationWebhookConfigError,
  normalizeIntegrationWebhookUrl,
} from './integrationWebhookConfig.js';

test('webhook registration accepts canonical public HTTPS endpoints', () => {
  assert.equal(
    normalizeIntegrationWebhookUrl(' HTTPS://Hooks.Example.com/events?tenant=fed '),
    'https://hooks.example.com/events?tenant=fed',
  );
  assert.deepEqual(integrationWebhookConfigFromInput({
    url: 'https://hooks.example.com/events',
  }), {
    version: 1,
    url: 'https://hooks.example.com/events',
    enabled: true,
    secretVersion: 1,
  });
});

test('webhook update preserves signing generation unless explicitly rotated elsewhere', () => {
  assert.deepEqual(integrationWebhookConfigFromInput({
    url: 'https://next.example.com/hook',
    enabled: false,
  }, {
    version: 1,
    url: 'https://old.example.com/hook',
    enabled: true,
    secretVersion: 7,
  }), {
    version: 1,
    url: 'https://next.example.com/hook',
    enabled: false,
    secretVersion: 7,
  });
  assert.equal(integrationWebhookConfigFromInput(null, {
    version: 1,
    url: 'https://old.example.com/hook',
    enabled: true,
    secretVersion: 7,
  }), undefined);
});

test('webhook registration rejects insecure and non-public literal destinations', () => {
  const rejected = [
    'http://hooks.example.com/events',
    'https://localhost/events',
    'https://service.local/events',
    'https://127.0.0.1/events',
    'https://10.1.2.3/events',
    'https://169.254.1.1/events',
    'https://100.64.1.1/events',
    'https://192.168.1.1/events',
    'https://[::1]/events',
    'https://[fd00::1]/events',
    'https://user:pass@hooks.example.com/events',
    'https://hooks.example.com/events#secret',
  ];
  for (const value of rejected) {
    assert.throws(() => normalizeIntegrationWebhookUrl(value), IntegrationWebhookConfigError, value);
  }
});

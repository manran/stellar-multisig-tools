import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOCS_AUTOMATION_PATH,
  DOCS_PAGES,
  DOCS_SECTIONS,
  docsPageForPath,
  isDocsPath,
  normalizedDocsPath,
} from './docsModel.js';

test('public Docs keeps the four task-oriented top-level sections', () => {
  assert.deepEqual(DOCS_SECTIONS.map((section) => section.id), ['start', 'transactions', 'concepts', 'automation']);
  assert.deepEqual(DOCS_SECTIONS.map((section) => section.label), ['Start', 'Transactions', 'Concepts', 'Agents']);
  assert.ok(DOCS_PAGES.every((page) => page.path.startsWith('/docs/')));
  assert.equal(new Set(DOCS_PAGES.map((page) => page.path)).size, DOCS_PAGES.length);
  assert.deepEqual(
    DOCS_SECTIONS.find((section) => section.id === 'transactions')?.pages.map((page) => page.path),
    [
      '/docs/transactions/payment',
      '/docs/transactions/batch-payment',
      '/docs/transactions/claimable-payment',
      '/docs/transactions/multi-party',
    ],
  );
});

test('legacy developer documentation resolves to the canonical Automation page', () => {
  assert.equal(normalizedDocsPath('/developers'), DOCS_AUTOMATION_PATH);
  assert.equal(normalizedDocsPath('/stellar/developers'), DOCS_AUTOMATION_PATH);
  assert.equal(docsPageForPath('/developers')?.title, 'Agent API');
});

test('Docs recognizes nested subdomain and directory-host paths without accepting unrelated routes', () => {
  assert.equal(isDocsPath('/docs'), true);
  assert.equal(isDocsPath('/docs/concepts/sign-and-unlock'), true);
  assert.equal(isDocsPath('/stellar/docs/concepts/sign-and-unlock'), true);
  assert.equal(isDocsPath('/developers'), true);
  assert.equal(isDocsPath('/treasury/docs'), false);

  assert.equal(docsPageForPath('/docs'), null);
  assert.equal(docsPageForPath('/docs/transactions/payment')?.title, 'Send a payment');
  assert.equal(docsPageForPath('/docs/transactions/batch-payment')?.title, 'Send to multiple recipients');
  assert.equal(docsPageForPath('/docs/transactions/claimable-payment')?.title, 'Send a claimable payment');
  assert.equal(docsPageForPath('/docs/transactions/multi-party')?.title, 'Create a multi-party transaction');
  assert.equal(docsPageForPath('/stellar/docs/concepts/multi-party-transactions')?.title, 'Multi-party transactions');
  assert.equal(docsPageForPath('/docs/not-a-page'), undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOCS_AUTOMATION_PATH,
  DOCS_DEVELOPERS_PATH,
  DOCS_DEVELOPER_API_PATH,
  DOCS_DEVELOPER_CLASSIC_PATH,
  DOCS_DEVELOPER_QUICKSTART_PATH,
  DOCS_DEVELOPER_SECURITY_PATH,
  DOCS_DEVELOPER_SOROBAN_PATH,
  DOCS_PAGES,
  DOCS_SECTIONS,
  docsPageForPath,
  isDocsPath,
  normalizedDocsPath,
} from './docsModel.js';

test('public Docs separates Human tasks from one Developer lane', () => {
  assert.deepEqual(DOCS_SECTIONS.map((section) => section.id), ['start', 'transactions', 'concepts', 'developers']);
  assert.deepEqual(DOCS_SECTIONS.map((section) => section.label), ['Start', 'Transactions', 'Concepts', 'Developers']);
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
  assert.deepEqual(
    DOCS_SECTIONS.find((section) => section.id === 'developers')?.pages.map((page) => page.path),
    [
      DOCS_DEVELOPERS_PATH,
      DOCS_DEVELOPER_QUICKSTART_PATH,
      DOCS_DEVELOPER_CLASSIC_PATH,
      DOCS_DEVELOPER_SOROBAN_PATH,
      DOCS_DEVELOPER_API_PATH,
      DOCS_DEVELOPER_SECURITY_PATH,
      DOCS_AUTOMATION_PATH,
    ],
  );
});

test('legacy /developers resolves to the Developer integration chooser', () => {
  assert.equal(normalizedDocsPath('/developers'), DOCS_DEVELOPERS_PATH);
  assert.equal(normalizedDocsPath('/stellar/developers'), DOCS_DEVELOPERS_PATH);
  assert.equal(docsPageForPath('/developers')?.title, 'Choose your integration');
  assert.equal(docsPageForPath(DOCS_AUTOMATION_PATH)?.title, 'Agent API');
});

test('Docs recognizes Human and Developer routes without accepting unrelated paths', () => {
  assert.equal(isDocsPath('/docs'), true);
  assert.equal(isDocsPath('/docs/concepts/sign-and-unlock'), true);
  assert.equal(isDocsPath('/stellar/docs/concepts/sign-and-unlock'), true);
  assert.equal(isDocsPath('/docs/developers/classic'), true);
  assert.equal(isDocsPath('/developers'), true);
  assert.equal(isDocsPath('/treasury/docs'), false);

  assert.equal(docsPageForPath('/docs'), null);
  assert.equal(docsPageForPath('/docs/transactions/payment')?.title, 'Send a payment');
  assert.equal(docsPageForPath('/docs/transactions/batch-payment')?.title, 'Send to multiple recipients');
  assert.equal(docsPageForPath('/docs/transactions/claimable-payment')?.title, 'Send a claimable payment');
  assert.equal(docsPageForPath('/docs/transactions/multi-party')?.title, 'Multi-party transaction');
  assert.equal(docsPageForPath('/stellar/docs/concepts/multi-party-transactions')?.title, 'Multi-party transactions');
  assert.equal(docsPageForPath('/docs/developers/security')?.title, 'Security model');
  assert.equal(docsPageForPath('/docs/not-a-page'), undefined);
});

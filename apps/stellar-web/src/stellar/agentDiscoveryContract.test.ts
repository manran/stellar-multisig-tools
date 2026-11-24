import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { HEADLESS_OPERATION_CATALOG } from '../../../../packages/stellar-core/src/headlessOperations';

const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const generator = join(root, 'apps/stellar-web/scripts/generateAgentDiscovery.mjs');
const html = readFileSync(join(root, 'apps/stellar-web/index.html'), 'utf8');
const directoryHtml = readFileSync(join(root, 'apps/directory/index.html'), 'utf8');
const directoryRoutes = JSON.parse(readFileSync(join(root, 'apps/directory/vercel.json'), 'utf8'));
const docsNav = readFileSync(join(root, 'apps/docs/content/stellar/developers/meta.json'), 'utf8');
const docsGuide = readFileSync(join(root, 'apps/docs/content/stellar/developers/agent-quickstart.mdx'), 'utf8');

function generated(network: 'testnet' | 'public') {
  const output = mkdtempSync(join(tmpdir(), 'mst-agent-discovery-'));
  try {
    execFileSync(process.execPath, [generator, output], {
      env: { ...process.env, VITE_STELLAR_DEPLOYMENT_NETWORK: network },
      stdio: 'pipe',
    });
    const catalog = JSON.parse(readFileSync(join(output, '.well-known/api-catalog'), 'utf8')) as {
      linkset: Array<Record<string, unknown>>;
    };
    const llms = readFileSync(join(output, 'llms.txt'), 'utf8');
    return { catalog, llms };
  } finally {
    rmSync(output, { force: true, recursive: true });
  }
}

for (const network of ['testnet', 'public'] as const) {
  test(`Agent catalog for ${network} matches the authoritative operation registry`, () => {
    const { catalog, llms } = generated(network);
    assert.equal(catalog.linkset.length, 1);
    const link = catalog.linkset[0] as {
      anchor: string; item: Array<{ href: string }>;
      'service-desc': Array<{ href: string }>;
      'service-meta': Array<{ href: string }>;
      'service-doc': Array<{ href: string }>;
    };
    const api = network === 'testnet'
      ? 'https://api-testnet.multisig.tools/stellar'
      : 'https://api.multisig.tools/stellar';
    const expectedPaths = new Set(HEADLESS_OPERATION_CATALOG
      .filter((operation) => network === 'testnet' || operation.id !== 'integration.testnet.create')
      .map((operation) => api + operation.path));
    assert.equal(link.anchor, api);
    assert.deepEqual(new Set(link.item.map((item) => item.href)), expectedPaths);
    assert.equal(link['service-desc'][0].href, api + '/openapi.json');
    assert.equal(link['service-meta'][0].href, api + '/operations');
    assert.match(link['service-doc'][0].href, /\/developers\/agent-quickstart$/);
    assert.ok(llms.startsWith('# MultiSig Tools: Stellar'));
    assert.ok(llms.includes(api + '/runtime-config'));
    assert.ok(llms.includes('msa_*'));
    assert.ok(llms.includes('msi_*'));
    assert.ok(llms.includes('mta_*'));
    assert.ok(llms.includes('explicit authorization'));
    if (network === 'public') assert.ok(!link.item.some((item) => item.href.endsWith('/integration-testnet')));
  });
}

test('Agent generation fails closed without network configuration in a Vercel deployment', () => {
  const output = mkdtempSync(join(tmpdir(), 'mst-agent-no-network-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, VERCEL: '1' };
    delete env.VITE_STELLAR_DEPLOYMENT_NETWORK;
    const result = spawnSync(process.execPath, [generator, output], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /VITE_STELLAR_DEPLOYMENT_NETWORK/);
  } finally {
    rmSync(output, { force: true, recursive: true });
  }
});

test('Both entry sites surface discovery without handing out API credentials', () => {
  assert.match(html, /rel="api-catalog"/);
  assert.match(html, /rel="service-desc"/);
  assert.match(html, /rel="describedby"/);
  assert.match(directoryHtml, /rel="api-catalog"/);
  assert.match(directoryHtml, /rel="service-desc"/);
  assert.match(directoryHtml, /rel="describedby"/);
  assert.match(directoryRoutes.routes.find((route: { src: string }) => route.src === '/').headers.Link, /rel="api-catalog"/);
  assert.ok(docsNav.includes('agent-quickstart'));
  assert.ok(docsGuide.includes('fixedNetwork'));
  assert.ok(docsGuide.includes('permission'));
  assert.ok(docsGuide.includes('Sign'));
  assert.ok(docsGuide.includes('msi_*'));
  assert.ok(docsGuide.includes('msa_*'));
});

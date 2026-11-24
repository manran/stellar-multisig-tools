// Read-only black-box discovery checks. Input is only the public site URL.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const site = new URL(process.argv[2] || 'https://stellar-testnet.multisig.tools/');

function request(url, head = false) {
  assert.equal(url.protocol, 'https:', 'Discover only HTTPS resources');
  return execFileSync('curl', ['-fsSL', '--max-time', '20', ...(head ? ['-I'] : []), url.href], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
}

function absolute(href, base = site) {
  const url = new URL(href, base);
  assert.equal(url.protocol, 'https:');
  return url;
}

function catalogAt(href) {
  const catalog = JSON.parse(request(absolute(href)));
  assert.ok(Array.isArray(catalog.linkset) && catalog.linkset.length > 0);
  const entry = catalog.linkset.find((link) => link['service-meta']?.length && link['service-desc']?.length);
  assert.ok(entry, 'Catalog must link to operation registry and OpenAPI');
  return entry;
}

function verifyOperations(entry) {
  const operationsUrl = absolute(entry['service-meta'][0].href);
  const body = JSON.parse(request(operationsUrl));
  assert.ok(Array.isArray(body.operations) && body.operations.length >= 30);
  assert.ok(body.operations.every((op) => op.id && op.path && op.method && op.access && op.effect));
  return body;
}

// Path 1: an Agent discovers structured links by reading only the HTML head.
const html = request(site);
const link = html.match(/<link\s+rel="api-catalog"\s+href="([^"]+)"/);
assert.ok(link, 'No HTML API catalog link');
const htmlCatalog = catalogAt(link[1]);
const htmlOps = verifyOperations(htmlCatalog);
console.log('PASS HTML discovery -> catalog -> ' + htmlOps.operations.length + ' operations');

// Path 2: an API client uses only HTTP HEAD and RFC 9727 Link metadata.
const catalogUrl = absolute(link[1]);
const head = request(catalogUrl, true);
assert.match(head, /content-type:\s*application\/linkset\+json/i);
assert.match(head, /link:.*rel="api-catalog"/i);
const headCatalog = catalogAt(catalogUrl.href);
const openapi = JSON.parse(request(absolute(headCatalog['service-desc'][0].href)));
assert.ok(openapi.openapi.startsWith('3.'));
assert.ok(openapi.paths['/runtime-config']);
console.log('PASS HEAD discovery -> Linkset -> OpenAPI ' + openapi.openapi);

// Path 3: an Agent reads only the llms.txt guide and follows its links.
const llms = request(absolute('/llms.txt'));
assert.ok(llms.startsWith('# MultiSig Tools:'));
const operationMatch = llms.match(/\[Operation registry\]\((https:\/\/[^)]+)\)/);
const runtimeMatch = llms.match(/\[Runtime network configuration\]\((https:\/\/[^)]+)\)/);
const guideMatch = llms.match(/\[Agent quickstart\]\((https:\/\/[^)]+)\)/);
assert.ok(operationMatch && runtimeMatch && guideMatch, 'Missing actionable machine guide links');
const llmsOps = JSON.parse(request(absolute(operationMatch[1])));
const runtime = JSON.parse(request(absolute(runtimeMatch[1])));
assert.ok(llmsOps.operations.length >= 30);
assert.equal(runtime.fixedNetwork, openapi['x-multisig-deployment-network']);
const guide = request(absolute(guideMatch[1]));
assert.ok(guide.includes('Agent quickstart'));
assert.ok(llms.includes('msa_*') && llms.includes('msi_*'));
console.log('PASS llms.txt discovery -> Agent quickstart -> runtime ' + runtime.fixedNetwork);
console.log('PASS 3/3 discovery paths; no credentials, state changes, or signatures');

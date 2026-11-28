import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createOpenApiDocument } from '../apps/stellar-api/stellar/server/openApiDocument.js';

const doc = createOpenApiDocument('https://api-testnet.multisig.tools/stellar', 'testnet') as Record<string, any>;
const operations = doc['x-multisig-operations'] as Record<string, any>;
const fence = String.fromCharCode(96).repeat(3);
const code = (value: unknown) => String.fromCharCode(96) + String(value).replaceAll(String.fromCharCode(96), '') + String.fromCharCode(96);
const plain = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('{', '&#123;').replaceAll('}', '&#125;').replaceAll('|', '&#124;').replaceAll('\n', ' ');
const block = (value: unknown) => [fence + 'json', JSON.stringify(value, null, 2), fence, ''];
const intro = [
  'Contract revision: **' + doc.info.version + '**. Generated from the same source as the [machine-readable OpenAPI](https://api-testnet.multisig.tools/stellar/openapi.json).',
  '', 'Base URL: https://api-testnet.multisig.tools/stellar. Examples illustrate structure; replace all example credentials, identifiers, XDR and signatures with actual values. For conditional permissions, see [API and webhooks](/stellar/developers/api).', '',
  'Security alternatives: humanBearer = verified Human bearer token; humanSession = verified browser session; agentBearer = scoped MSA; integrationBearer = scoped MSI; treasuryAuditBearer = scoped MTA; requestCapability = private Request link; intentCapability = origin-bound browser capability.', '',
];
const titles: Record<string, string> = {
  discovery: 'Discovery', runtime: 'Runtime configuration', signer: 'Signer workspace', agent: 'Agent pairing and access',
  classic: 'Classic transaction preparation', proposal: 'Classic Proposals', contract: 'Soroban contracts and Intents',
  integration: 'Service Integration', treasury: 'Treasury audit',
};
const groups = new Map<string, string[]>();
for (const id of Object.keys(operations)) {
  const group = id.split('.')[0];
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group)!.push(id);
}
const files = new Map<string, string>();
const index = ['---', 'title: API reference', 'description: Logical operation contracts generated from the Testnet OpenAPI document.', '---', '', ...intro,
  '## Operations', '', Object.keys(operations).length + ' logical operations, grouped by purpose.', ''];
for (const [group, ids] of groups) {
  index.push('- [' + (titles[group] ?? group) + '](/stellar/developers/api-reference/' + group + ') — ' + ids.length + ' operations');
}
files.set('index.mdx', index.join('\n') + '\n');
for (const [group, ids] of groups) {
  const title = titles[group] ?? group;
  const lines = ['---', 'title: ' + title, 'description: Generated logical operation contracts for ' + group + '.', '---', '', '[All operations](/stellar/developers/api-reference)', '', ...intro];
  for (const id of ids) {
    const op = operations[id];

  lines.push('## ' + id, '', plain(op.summary), '', '**HTTP:** ' + code(op.method + ' ' + op.path) + '  ', '**Access:** ' + code(op.access) + ' · **Effect:** ' + code(op.effect), '',
    '**Authentication:** ' + (op.security.length ? op.security.map((s: Record<string, unknown>) => Object.keys(s).map(code).join(' + ') || 'public').join(' or ') : 'public'), '');
  if (op.parameters?.length) {
    lines.push('| Parameter | Location | Required | Description | Example |', '| --- | --- | --- | --- | --- |');
    for (const param of op.parameters) lines.push('| ' + code(param.name) + ' | ' + plain(param.in) + ' | ' + (param.required ? 'Yes' : 'Conditional / optional') + ' | ' + plain(param.description) + ' | ' + (param.example === undefined ? '—' : code(plain(typeof param.example === 'object' ? JSON.stringify(param.example) : param.example))) + ' |');
    lines.push('');
  }
  const body = op.requestBody?.content?.['application/json'];
  if (body?.example !== undefined) lines.push('**Request example**', '', ...block(body.example));
  for (const [status, response] of Object.entries(op.responses) as [string, any][]) {
    if (!status.startsWith('2')) continue;
    lines.push('**Response ' + status + '** — ' + plain(response.description), '');
    const example = response.content?.['application/json']?.example;
    if (example !== undefined) lines.push(...block(example));
  }
  lines.push('**Retry rules**', '', ...block(op.retry));
}
  files.set(group + '.mdx', lines.join('\n').trimEnd() + '\n');
}
files.set('meta.json', JSON.stringify({ title: 'API reference', pages: ['index', ...groups.keys()] }, null, 2) + '\n');
const directory = new URL('../apps/docs/content/stellar/developers/api-reference/', import.meta.url);
const check = process.argv.includes('--check');
if (!check) mkdirSync(directory, { recursive: true });
for (const [name, content] of files) {
  const file = new URL(name, directory);
  if (check) {
    if (readFileSync(file, 'utf8') !== content) throw new Error('API reference is stale; run npm run docs:api-reference: ' + name);
  } else writeFileSync(file, content);
}
for (const name of readdirSync(directory)) {
  if (!files.has(name)) throw new Error('Remove obsolete generated API reference file: ' + name);
}
if (!check) console.log('Generated ' + Object.keys(operations).length + ' operations in ' + groups.size + ' groups for ' + doc.info.version);

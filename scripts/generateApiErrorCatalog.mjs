// Generate the published code reference from statically declared API errors.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots = ['apps/stellar-api/stellar', 'packages/stellar-core/src'];
const entries = new Map();
const literal = node => node && ts.isStringLiteralLike(node) ? node.text : undefined;
const number = node => node && ts.isNumericLiteral(node) ? Number(node.text) : undefined;
const property = (node, name) => node.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText().replace(/^['"]|['"]$/g, '') === name)?.initializer;
function add(code, status) {
  if (!code || !/^[a-z][a-z0-9_]+$/.test(code) || !status || status < 400 || status >= 600) return;
  if (!entries.has(code)) entries.set(code, new Set());
  entries.get(code).add(status);
}
function scan(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isNewExpression(node) && /Error$/.test(node.expression.getText()) && node.arguments?.length >= 3) {
      add(literal(node.arguments[2]), number(node.arguments[1]));
    }
    if (ts.isCallExpression(node) && node.arguments.length >= 2 && ts.isObjectLiteralExpression(node.arguments[0])) {
      const body = node.arguments[0];
      const code = literal(property(body, 'code'));
      if (property(body, 'error')) add(code, number(node.arguments[1]) ?? number(node.arguments[2]));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) walk(file);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) scan(file);
  }
}
roots.forEach(walk);
// Dynamic family members and codes defined as class properties or passed to a checker.
for (const [code, statuses] of Object.entries({
  invalid_inbox_page: [400],
  authorization_plan_changed: [409],
  intent_execution_outcome_unknown: [409],
  soroban_simulation_configuration: [503],
  treasury_admin_rate_limited: [429],
  agent_access_rate_limited: [429],
  soroban_simulation_invalid: [400],
  soroban_simulation_unsupported: [400],
  soroban_simulation_unavailable: [503],
  request_create_rate_limited: [429],
  agent_pairing_rate_limited: [429],
  invalid_json: [400],
  unknown_request_field: [400],
})) for (const status of statuses) add(code, status);

const overrides = {
  idempotency_conflict: ['The same key was used with different accepted input.', 'Stop. Inspect the original operation; do not switch keys to bypass uncertainty.'],
  intent_authorization_not_ready: ['The Intent does not yet have sufficient valid authorization.', 'Inspect the Intent and wait for the required authorization.'],
  managed_executor_not_configured: ['The requested managed executor is unavailable on this deployment.', 'Select a permitted external executor or ask the operator to configure managed execution.'],
  intent_execution_outcome_unknown: ['At least one released transaction hash has no verified terminal outcome.', 'Reconcile every original hash before preparing, cancelling or replanning.'],
  intent_execution_resume_unavailable: ['The original execution package cannot be resumed safely.', 'Reconcile the original hash before any replacement.'],
  intent_already_executed: ['The Intent has a verified successful result.', 'Inspect and keep the receipt. Do not repeat the business payment.'],
  integration_service_exists: ['The serviceId already exists.', 'Use the existing credential or request operator recovery; do not recreate a payment.'],
  already_exchanged: ['The one-time pairing exchange was already consumed.', 'Use the recovery details; revoke an uncertain credential before pairing again.'],
  exchange_outcome_unknown: ['The credential issuance outcome is uncertain.', 'Inspect the reserved credential and follow the operation-specific recovery instructions.'],
  unknown_request_field: ['A field is not allowed by the request contract.', 'Correct details.field; do not silently discard it.'],
  deployment_network_mismatch: ['The selected network does not match the deployment.', 'Use the matching deployment; never replay a transaction on a different network.'],
  contract_not_found: ['No live contract instance was found on the selected network.', 'Check the contract address and network.'],
};
function handling(statuses) {
  if (statuses.includes(409)) return 'Inspect current state or correct configuration. Do not blindly repeat a mutation.';
  if (statuses.includes(429)) return 'Back off and follow the operation-specific retry policy.';
  if (statuses.some(status => status >= 500)) return 'Follow the operation-specific recovery policy; a lost response is not proof of failure.';
  if (statuses.includes(401)) return 'Authenticate with a valid credential of the documented type.';
  if (statuses.includes(403)) return 'Stop and check credential scope or signer authority.';
  if (statuses.includes(404)) return 'Check the resource identifier, network and access.';
  if (statuses.includes(410)) return 'Inspect expiry; obtain a new grant or resource when authorized.';
  return 'Correct the input according to the operation schema and error details.';
}
const catalogue = Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)).map(([code, values]) => {
  const statuses = [...values].sort((a,b) => a-b);
  const [meaning, callerAction] = overrides[code] ?? [code.replaceAll('_', ' '), handling(statuses)];
  return [code, { statuses, meaning, callerAction }];
}));
const output = '// Generated by scripts/generateApiErrorCatalog.mjs; do not edit.\nexport const API_ERROR_CATALOG = {\n'
  + Object.entries(catalogue).map(([code, value]) => '  ' + JSON.stringify(code) + ': ' + JSON.stringify(value) + ',').join('\n') + '\n} as const;\n';
const target = 'apps/stellar-api/stellar/server/apiErrorCatalog.generated.ts';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) throw new Error('API error catalog is stale. Run node scripts/generateApiErrorCatalog.mjs');
} else fs.writeFileSync(target, output);
console.log(Object.keys(catalogue).length + ' error codes');

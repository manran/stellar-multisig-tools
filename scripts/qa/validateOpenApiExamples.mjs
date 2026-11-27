import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// QA-only Ajv installation (see README). Validate examples against the exact
// published Draft 2020-12 schema, including component references.
const require = createRequire(process.env.MST_QA_AJV_DIR + '/package.json');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const document = JSON.parse(readFileSync(0, 'utf8'));
let checked = 0;
const failures = [];
function check(name, shape, example) {
  try {
    assert.ok(shape, 'missing schema');
    assert.notEqual(example, undefined, 'missing example');
    const validate = ajv.compile({ ...shape, components: document.components });
    assert.ok(validate(example), JSON.stringify(validate.errors));
    checked++;
  } catch (error) {
    failures.push(name + ': ' + error.message);
  }
}
for (const [id, operation] of Object.entries(document['x-multisig-operations'])) {
  const input = operation.requestBody?.content?.['application/json'];
  if (input) check(id + ' request', input.schema, input.example);
  for (const parameter of operation.parameters ?? []) {
    if (parameter.required || parameter.example !== undefined)
      check(id + ' parameter ' + parameter.name, parameter.schema, parameter.example);
  }
  for (const [status, response] of Object.entries(operation.responses)) {
    if (!status.startsWith('2')) continue;
    const output = response.content?.['application/json'];
    check(id + ' response ' + status, output?.schema, output?.example);
  }
}
if (failures.length) console.error(failures.join('\n'));
console.log(JSON.stringify({ operations: Object.keys(document['x-multisig-operations']).length, checked, failures: failures.length }));
process.exitCode = failures.length ? 1 : 0;

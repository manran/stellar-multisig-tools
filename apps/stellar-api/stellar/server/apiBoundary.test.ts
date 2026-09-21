import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';

const HTTP_EXPORTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

test('root Vercel API shims preserve the Stellar route HTTP contract', async () => {
  const routesDir = new URL('../routes/', import.meta.url);
  const routeFiles = (await readdir(routesDir))
    .filter((name) => name.endsWith('.ts'))
    .sort();

  assert.ok(routeFiles.length > 0);
  for (const file of routeFiles) {
    const stem = file.slice(0, -3);
    const route = await import(`../routes/${stem}.js`);
    const shim = await import(`../../../../api/${stem}.js`);
    const routeMethods = Object.keys(route).filter((name) => HTTP_EXPORTS.has(name)).sort();
    const shimMethods = Object.keys(shim).filter((name) => HTTP_EXPORTS.has(name)).sort();
    assert.deepEqual(shimMethods, routeMethods, `${stem} shim HTTP exports`);
    for (const method of routeMethods) {
      assert.equal(shim[method], route[method], `${stem} ${method} should be a direct re-export`);
    }
  }
});

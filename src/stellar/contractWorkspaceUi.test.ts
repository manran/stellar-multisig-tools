import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  loadContractWorkspaces,
  removeContractWorkspace,
  saveContractWorkspace,
} from '../contractWorkspace.js';
import { CANONICAL_STELLAR_ROUTES } from '../workspaceRoutes.js';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const CONTRACT_A = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const CONTRACT_B = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

test('legacy browser references remain readable for one-time server migration', () => {
  const storage = memoryStorage();
  saveContractWorkspace({ contractId: CONTRACT_A, network: 'testnet', importedAt: 10 }, storage);
  saveContractWorkspace({ contractId: CONTRACT_B, network: 'public', importedAt: 20 }, storage);
  saveContractWorkspace({ contractId: CONTRACT_A, network: 'testnet', importedAt: 30 }, storage);

  assert.deepEqual(loadContractWorkspaces(storage), [
    { contractId: CONTRACT_A, network: 'testnet', importedAt: 30 },
    { contractId: CONTRACT_B, network: 'public', importedAt: 20 },
  ]);

  removeContractWorkspace(CONTRACT_A, 'testnet', storage);
  assert.deepEqual(loadContractWorkspaces(storage), [
    { contractId: CONTRACT_B, network: 'public', importedAt: 20 },
  ]);
});

test('Contracts is a first-class workspace route and navigation destination', () => {
  const shell = source('../StellarWorkspaceShell.tsx');
  const contracts = source('../ContractsApp.tsx');
  const routes = CANONICAL_STELLAR_ROUTES.map((route) => route.path);

  assert.ok(routes.includes('/contracts'));
  assert.match(shell, />Contracts</);
  assert.match(contracts, /Contract workspace/);
  assert.match(contracts, /Add or call contract/);
  assert.match(contracts, /PrivateWorkspaceUnlock/);
});

test('Contract Workspace methods deep-link into the exact call', () => {
  const workspace = source('../ContractWorkspaceApp.tsx');
  const composer = source('../ContractCallComposer.tsx');

  assert.match(workspace, /callHref\(method\.name\)/);
  assert.match(workspace, /method \? \{ method \}/);
  assert.match(composer, /params\.get\('method'\)/);
  assert.match(composer, /params\.get\('from'\) === 'workspace'/);
  assert.match(composer, /Back to Contract Workspace/);
  assert.doesNotMatch(composer, /Keep this contract for later\?/);
});

test('Web contract flows consume headless operations instead of rebuilding business logic', () => {
  const workspace = source('../ContractWorkspaceApp.tsx');
  const composer = source('../ContractCallComposer.tsx');

  assert.match(workspace, /inspectContractOperation/);
  assert.match(composer, /inspectContractOperation/);
  assert.match(composer, /buildContractCallOperation/);
  assert.doesNotMatch(composer, /new TransactionBuilder/);
  assert.doesNotMatch(composer, /loadNetworkParameters/);
  assert.doesNotMatch(composer, /contractArgumentsToScVals/);
});

test('Contract Call keeps transaction source neutral and input-first', () => {
  const composer = source('../ContractCallComposer.tsx');

  assert.doesNotMatch(composer, /SigningAccountPicker/);
  assert.doesNotMatch(composer, /Choose a treasury/);
  assert.match(composer, /sessionAddress/);
  assert.match(composer, /Use my account/);
  assert.match(composer, /Usually this is your signed-in account/);
  assert.match(composer, /Contract authorization is resolved separately/);
  assert.match(composer, /explicitSource \|\|/);
  assert.match(composer, /TransactionLifetimePicker/);
  assert.match(composer, /Auto-load the interface once a complete C-address is valid/);
  assert.match(composer, /autoSorobanSimulation: true/);
});

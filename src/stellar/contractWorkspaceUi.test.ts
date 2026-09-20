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

test('Contracts and Contract Workspace use one continuous workbench instead of card grids', () => {
  const contracts = source('../ContractsApp.tsx');
  const workspace = source('../ContractWorkspaceApp.tsx');

  assert.match(contracts, /mst-contract-list/);
  assert.match(contracts, /mst-contract-row/);
  assert.match(contracts, /mst-contract-toolbar/);
  assert.doesNotMatch(contracts, /md:grid-cols-2/);
  assert.doesNotMatch(contracts, /bg-violet|text-violet/);

  assert.match(workspace, /mst-contract-workspace/);
  assert.match(workspace, /mst-contract-method-list/);
  assert.match(workspace, /mst-contract-method-row/);
  assert.match(workspace, /mst-contract-facts/);
  assert.match(workspace, /mst-contract-fact/);
  assert.doesNotMatch(workspace, /rounded-2xl border border-black\/10 bg-white/);
  assert.doesNotMatch(workspace, /bg-violet|text-violet/);
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

test('Web contract flows consume headless Intent operations instead of rebuilding business logic', () => {
  const workspace = source('../ContractWorkspaceApp.tsx');
  const composer = source('../ContractCallComposer.tsx');

  assert.match(workspace, /inspectContractOperation/);
  assert.match(composer, /inspectContractOperation/);
  assert.match(composer, /fetch\('\/api\/intent'/);
  assert.match(composer, /privateSessionAddressHeaders\(verifiedAddress\)/);
  assert.doesNotMatch(composer, /buildContractCallOperation/);
  assert.doesNotMatch(composer, /new TransactionBuilder/);
  assert.doesNotMatch(composer, /loadNetworkParameters/);
  assert.doesNotMatch(composer, /contractArgumentsToScVals/);
});

test('Guided Contract Call is Intent-first and defers transaction execution choices', () => {
  const composer = source('../ContractCallComposer.tsx');

  assert.doesNotMatch(composer, /SigningAccountPicker/);
  assert.doesNotMatch(composer, /Choose a treasury/);
  assert.doesNotMatch(composer, /contract-source/);
  assert.doesNotMatch(composer, /transactionSource/);
  assert.doesNotMatch(composer, /TransactionLifetimePicker/);
  assert.match(composer, /source-free Soroban Intent/);
  assert.match(composer, /No transaction source, sequence, fee, lifetime or envelope signature is chosen/);
  assert.match(composer, /Continue to authorization/);
  assert.match(composer, /navigateWorkspace\('\/a'/);
  assert.match(composer, /Auto-load the interface once a complete C-address is valid/);
});

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HEADLESS_OPERATION_CATALOG } from '../../../packages/stellar-core/src/headlessOperations.ts';
import {
  STELLAR_MAINNET_API_BASE,
  STELLAR_TESTNET_API_BASE,
  STELLAR_PUBLIC_DOCS_BASE,
} from '../../../packages/stellar-core/src/apiOrigins.ts';

const network = process.env.VITE_STELLAR_DEPLOYMENT_NETWORK
  || (process.env.VERCEL ? '' : 'testnet');
// Directory builds run the root workspace build but do not deploy Stellar Web.
if (!network && process.env.VERCEL) {
  console.log('Agent discovery omitted: this project has no Stellar deployment network.');
  process.exit(0);
}
if (!['testnet', 'public'].includes(network)) {
  throw new Error('Set VITE_STELLAR_DEPLOYMENT_NETWORK to testnet or public.');
}

const origin = network === 'testnet'
  ? 'https://stellar-testnet.multisig.tools'
  : 'https://stellar.multisig.tools';
const api = network === 'testnet' ? STELLAR_TESTNET_API_BASE : STELLAR_MAINNET_API_BASE;
const docs = STELLAR_PUBLIC_DOCS_BASE;
const paths = [...new Set(HEADLESS_OPERATION_CATALOG
  .filter((operation) => network === 'testnet' || operation.id !== 'integration.testnet.create')
  .map((operation) => operation.path))];

const catalog = {
  linkset: [{
    anchor: api,
    item: paths.map((path) => ({ href: api + path })),
    'service-desc': [{
      href: api + '/openapi.json',
      type: 'application/vnd.oai.openapi+json',
    }],
    'service-meta': [{
      href: api + '/operations',
      type: 'application/json',
    }],
    'service-doc': [{
      href: docs + '/developers/agent-quickstart',
      type: 'text/html',
    }],
  }],
};

const llms = `# MultiSig Tools: Stellar ${network === 'testnet' ? 'Testnet' : 'Mainnet'}

> Human and Agent participants coordinate Stellar Classic and Soroban authorization. The Stellar network is fixed by this deployment.

An Agent can inspect operations and OpenAPI without credentials. Request access through the appropriate Human signer or create an Integration Profile on Testnet. Agent credentials do not contain signing keys.

Always inspect runtime network configuration before acting. Read-only calls can be made without approval where documented. Obtain the user's explicit authorization before credential creation, any private-state or coordination-state mutation, signature contribution, or ledger submission.

Permission types are distinct: \`msa_*\` grants signer-principal Agent access; \`msi_*\` is an Integration/service credential; \`mta_*\` is read-only Treasury Audit access. Never expose, forward, or log these secrets. Signature verification and execution authorization remain authoritative on Stellar.

## Machine discovery

- [API catalog](${origin}/.well-known/api-catalog): RFC 9727 Linkset for this deployment.
- [Operation registry](${api}/operations): Current operations, access requirements, effects, and OpenAPI references.
- [OpenAPI specification](${api}/openapi.json): Exact request schemas, responses, and security schemes.
- [Runtime network configuration](${api}/runtime-config): Verify this deployment's network before any action.

## Start here

- [Agent quickstart](${docs}/developers/agent-quickstart): Discovery, read-only probe, permissions, and safe Testnet workflow.
- [Agent API](${docs}/developers/agent-api): Read, Write, Sign credential boundaries.
- [Testnet integration quickstart](${docs}/developers/testnet-quickstart): Service-owned Hosted Classic workflow.
- [Developer modes](${docs}/developers): Hosted, On my site, and Full Headless.

## Optional

- [Human Testnet workspace](https://stellar-testnet.multisig.tools): Human review and signing surface.
- [Proposal signing guide](${docs}/start/sign-a-proposal): Human approval and receipt.
`;

const output = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
await mkdir(join(output, '.well-known'), { recursive: true });
await writeFile(join(output, '.well-known', 'api-catalog'), JSON.stringify(catalog, null, 2) + '\n');
await writeFile(join(output, 'llms.txt'), llms);
console.log(`Agent discovery generated for ${network}: ${paths.length} API route links`);

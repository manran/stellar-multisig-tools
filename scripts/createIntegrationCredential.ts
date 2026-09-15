import {
  configuredIntegrationCredentials,
  createIntegrationApiKey,
} from '../server/integrationCredentialService.js';

type Parsed = {
  serviceId: string;
  label: string;
  networks: string[];
  classicAccounts: string[];
  externalClassicAccounts: string[];
  contracts: Array<{ contractId: string; methods: string[] }>;
  executors: string[];
};

function usage(): never {
  console.error(`Usage:
  npm run integration:credential -- \\
    --service-id fednetwork \\
    --label FedNetwork \\
    --network testnet \\
    [--classic-account G...] \\
    [--external-classic-account G...] \\
    [--contract C...:transfer,other_method] \\
    [--executor G...]

Repeat --network, --classic-account, --external-classic-account, --contract, or --executor as needed.`);
  process.exit(2);
}

function nextValue(args: string[], index: number): string {
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith('--')) usage();
  return value;
}

function parseArgs(args: string[]): Parsed {
  const parsed: Parsed = {
    serviceId: '', label: '', networks: [], classicAccounts: [], externalClassicAccounts: [], contracts: [], executors: [],
  };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = nextValue(args, index);
    if (flag === '--service-id') parsed.serviceId = value;
    else if (flag === '--label') parsed.label = value;
    else if (flag === '--network') parsed.networks.push(value);
    else if (flag === '--classic-account') parsed.classicAccounts.push(value);
    else if (flag === '--external-classic-account') {
      parsed.classicAccounts.push(value);
      parsed.externalClassicAccounts.push(value);
    }
    else if (flag === '--executor') parsed.executors.push(value);
    else if (flag === '--contract') {
      const separator = value.indexOf(':');
      if (separator < 1) usage();
      parsed.contracts.push({
        contractId: value.slice(0, separator),
        methods: value.slice(separator + 1).split(',').map((item) => item.trim()).filter(Boolean),
      });
    } else usage();
  }
  if (!parsed.serviceId || !parsed.label) usage();
  return parsed;
}

const input = parseArgs(process.argv.slice(2));
const generated = createIntegrationApiKey(input.serviceId);
const entry = {
  serviceId: input.serviceId,
  label: input.label,
  secretHash: generated.secretHash,
  networks: input.networks,
  classicAccounts: input.classicAccounts,
  classicExternalExecutionAccounts: input.externalClassicAccounts,
  sorobanContracts: input.contracts,
  sorobanExecutionAccounts: input.executors,
};
const [normalized] = configuredIntegrationCredentials(JSON.stringify([entry]));

console.log('Integration API key (shown once; do not put this value in MULTISIG_INTEGRATION_CREDENTIALS_JSON):');
console.log(generated.apiKey);
console.log('\nDeployment configuration entry:');
console.log(JSON.stringify(normalized, null, 2));

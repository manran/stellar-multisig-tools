import {
  configuredIntegrationCredentials,
  createIntegrationApiKey,
} from '../apps/api/stellar/server/integrationCredentialService.js';

type Parsed = {
  serviceId: string;
  label: string;
  networks: string[];
  classicSourceAccounts: string[];
  externalClassicSourceAccounts: string[];
  contracts: Array<{ contractId: string; methods: string[] }>;
  executors: string[];
  defaultExecutor: string;
};

function usage(): never {
  console.error(`Usage:
  npm run integration:credential -- \\
    --service-id fednetwork \\
    --label FedNetwork \\
    --network testnet \\
    [--classic-source-account G...] \\
    [--classic-external-source-account G...] \\
    [--contract C...:transfer,other_method] \\
    [--executor G...] \
    [--default-executor G...]

Repeat --network, --classic-source-account, --classic-external-source-account, --contract, or --executor as needed. --default-executor may be supplied once and is automatically included in the executor allowlist.`);
  process.exit(2);
}

function nextValue(args: string[], index: number): string {
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith('--')) usage();
  return value;
}

function parseArgs(args: string[]): Parsed {
  const parsed: Parsed = {
    serviceId: '', label: '', networks: [], classicSourceAccounts: [], externalClassicSourceAccounts: [], contracts: [], executors: [], defaultExecutor: '',
  };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = nextValue(args, index);
    if (flag === '--service-id') parsed.serviceId = value;
    else if (flag === '--label') parsed.label = value;
    else if (flag === '--network') parsed.networks.push(value);
    else if (flag === '--classic-source-account') parsed.classicSourceAccounts.push(value);
    else if (flag === '--classic-external-source-account') {
      parsed.classicSourceAccounts.push(value);
      parsed.externalClassicSourceAccounts.push(value);
    }
    else if (flag === '--executor') parsed.executors.push(value);
    else if (flag === '--default-executor') { parsed.defaultExecutor = value; parsed.executors.push(value); }
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
  classicSourceAccounts: input.classicSourceAccounts,
  classicExternalExecutionSourceAccounts: input.externalClassicSourceAccounts,
  sorobanContracts: input.contracts,
  sorobanExecutionAccounts: input.executors,
  ...(input.defaultExecutor ? { sorobanDefaultExecutor: input.defaultExecutor } : {}),
};
const [normalized] = configuredIntegrationCredentials(JSON.stringify([entry]));

console.log('Integration API key (shown once; do not put this value in MULTISIG_INTEGRATION_CREDENTIALS_JSON):');
console.log(generated.apiKey);
console.log('\nDeployment configuration entry:');
console.log(JSON.stringify(normalized, null, 2));

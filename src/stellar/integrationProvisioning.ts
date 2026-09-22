import type { StellarNetwork } from '../../packages/stellar-core/src/types.js';

export type IntegrationAuthorizationExperience = 'hosted' | 'native' | 'headless';
export type IntegrationExecutionOwner = 'multisigtools' | 'integration';

export interface IntegrationProvisioningTreasury {
  accountId: string;
  executionOwner: IntegrationExecutionOwner;
}

export interface IntegrationProvisioningContract {
  contractId: string;
  methods: string[];
  executionOwner: IntegrationExecutionOwner;
  executor?: string;
}

export interface IntegrationProvisioningInput {
  serviceId: string;
  label: string;
  network: StellarNetwork;
  treasuries: IntegrationProvisioningTreasury[];
  contracts: IntegrationProvisioningContract[];
  executorPool: string[];
  authorizationExperience: IntegrationAuthorizationExperience;
  webhook?: { url: string; enabled: boolean };
}

export interface IntegrationAdminConfiguration {
  serviceId: string;
  label: string;
  enabled: true;
  networks: StellarNetwork[];
  classicSourceAccounts: string[];
  classicExternalExecutionSourceAccounts: string[];
  sorobanContracts: Array<{
    contractId: string;
    methods: string[];
    execution: { mode: 'multisigtools' } | { mode: 'external'; executor: string };
  }>;
  sorobanExecutionAccounts: string[];
  sorobanDefaultExecutor?: string;
  profile: { authorizationExperience: IntegrationAuthorizationExperience };
  webhook?: { url: string; enabled: boolean };
}

export function buildIntegrationAdminConfiguration(
  input: IntegrationProvisioningInput,
): IntegrationAdminConfiguration {
  const serviceId = input.serviceId.trim().toLowerCase();
  const label = input.label.trim();
  const classicSourceAccounts = [...new Set(input.treasuries.map((item) => item.accountId.trim()).filter(Boolean))];
  const classicExternalExecutionSourceAccounts = [...new Set(input.treasuries
    .filter((item) => item.executionOwner === 'integration')
    .map((item) => item.accountId.trim())
    .filter(Boolean))];
  const sorobanContracts = input.contracts
    .map((item) => {
      const executor = item.executor?.trim() ?? '';
      return {
        contractId: item.contractId.trim(),
        methods: [...new Set(item.methods.map((method) => method.trim()).filter(Boolean))],
        execution: item.executionOwner === 'integration'
          ? { mode: 'external' as const, executor }
          : { mode: 'multisigtools' as const },
      };
    })
    .filter((item) => item.contractId && item.methods.length > 0);
  const sorobanExecutionAccounts = [...new Set(input.executorPool.map((item) => item.trim()).filter(Boolean))];
  const webhook = input.webhook?.url.trim()
    ? { url: input.webhook.url.trim(), enabled: input.webhook.enabled }
    : undefined;

  return {
    serviceId,
    label,
    enabled: true,
    networks: [input.network],
    classicSourceAccounts,
    classicExternalExecutionSourceAccounts,
    sorobanContracts,
    sorobanExecutionAccounts,
    profile: { authorizationExperience: input.authorizationExperience },
    ...(webhook ? { webhook } : {}),
  };
}

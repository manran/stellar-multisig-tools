import type { StellarNetwork } from './types.js';

export type IntegrationAuthorizationExperience = 'hosted' | 'native' | 'headless';
export type IntegrationExecutionOwner = 'multisigtools' | 'integration';

export interface IntegrationProvisioningTreasury {
  accountId: string;
  executionOwner: IntegrationExecutionOwner;
}

export interface IntegrationProvisioningContract {
  contractId: string;
  methods: string[];
}

export interface IntegrationProvisioningInput {
  serviceId: string;
  label: string;
  network: StellarNetwork;
  treasuries: IntegrationProvisioningTreasury[];
  contracts: IntegrationProvisioningContract[];
  sorobanExecutionOwner: IntegrationExecutionOwner;
  sorobanExecutor?: string;
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
  sorobanContracts: IntegrationProvisioningContract[];
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
    .map((item) => ({
      contractId: item.contractId.trim(),
      methods: [...new Set(item.methods.map((method) => method.trim()).filter(Boolean))],
    }))
    .filter((item) => item.contractId && item.methods.length > 0);
  const executor = input.sorobanExecutor?.trim() ?? '';
  const externalSorobanExecution = input.sorobanExecutionOwner === 'integration' && sorobanContracts.length > 0;
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
    sorobanExecutionAccounts: externalSorobanExecution && executor ? [executor] : [],
    ...(externalSorobanExecution && executor ? { sorobanDefaultExecutor: executor } : {}),
    profile: { authorizationExperience: input.authorizationExperience },
    ...(webhook ? { webhook } : {}),
  };
}

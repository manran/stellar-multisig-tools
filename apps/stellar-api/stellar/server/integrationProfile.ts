export type IntegrationAuthorizationExperience = 'hosted' | 'native' | 'headless';

export interface IntegrationProfilePreferences {
  version: 1;
  authorizationExperience: IntegrationAuthorizationExperience;
}

export const DEFAULT_INTEGRATION_PROFILE: IntegrationProfilePreferences = {
  version: 1,
  authorizationExperience: 'headless',
};

export class IntegrationProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrationProfileError';
  }
}

export function integrationProfileFromInput(
  value: unknown,
  fallback: IntegrationProfilePreferences = DEFAULT_INTEGRATION_PROFILE,
): IntegrationProfilePreferences {
  if (value === undefined) return fallback;
  if (!value || typeof value !== 'object') {
    throw new IntegrationProfileError('Integration profile is invalid.');
  }
  const record = value as Record<string, unknown>;
  const authorizationExperience = record.authorizationExperience;
  if (
    authorizationExperience !== 'hosted'
    && authorizationExperience !== 'native'
    && authorizationExperience !== 'headless'
  ) {
    throw new IntegrationProfileError('Integration authorization experience must be hosted, native, or headless.');
  }
  return { version: 1, authorizationExperience };
}

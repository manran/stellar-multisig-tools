import { checkRateLimit } from '@vercel/firewall';

export const SEMANTIC_RATE_LIMIT_IDS = {
  requestCreate: 'request-create',
  treasuryAdmin: 'treasury-admin',
  agentAccessAdmin: 'agent-access-admin',
} as const;

export type SemanticRateLimitId = typeof SEMANTIC_RATE_LIMIT_IDS[keyof typeof SEMANTIC_RATE_LIMIT_IDS];

type RateLimitCheckResult = {
  rateLimited: boolean;
  error?: 'not-found' | 'blocked';
};

type RateLimitCheck = (
  rateLimitId: string,
  options: { request: Request; rateLimitKey: string },
) => Promise<RateLimitCheckResult>;

export class SemanticRateLimitError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SemanticRateLimitError';
  }
}

export function semanticRateLimitKey(network: 'public' | 'testnet', identity: string): string {
  return `${network}:${identity}`;
}

export async function enforceSemanticRateLimit(
  request: Request,
  options: {
    rateLimitId: SemanticRateLimitId;
    rateLimitKey: string;
    errorCode: string;
    errorMessage: string;
    check?: RateLimitCheck;
  },
): Promise<{ configured: boolean }> {
  const checker = options.check ?? checkRateLimit;
  let result: RateLimitCheckResult;
  try {
    result = await checker(options.rateLimitId, {
      request,
      rateLimitKey: options.rateLimitKey,
    });
  } catch (cause) {
    console.error('Semantic rate-limit check failed', {
      rateLimitId: options.rateLimitId,
      cause,
    });
    throw new SemanticRateLimitError(
      'Abuse-control verification is temporarily unavailable.',
      503,
      'rate_limit_unavailable',
    );
  }

  if (result.error === 'not-found') {
    console.warn('Semantic rate-limit rule is not configured', {
      rateLimitId: options.rateLimitId,
    });
    return { configured: false };
  }

  if (result.error === 'blocked') {
    console.error('Semantic rate-limit checker was blocked', {
      rateLimitId: options.rateLimitId,
    });
    throw new SemanticRateLimitError(
      'Abuse-control verification is temporarily unavailable.',
      503,
      'rate_limit_unavailable',
    );
  }

  if (result.rateLimited) {
    throw new SemanticRateLimitError(options.errorMessage, 429, options.errorCode);
  }

  return { configured: true };
}

export function beforeFirstDurableWrite(effect: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null;
  return () => {
    pending ??= effect();
    return pending;
  };
}

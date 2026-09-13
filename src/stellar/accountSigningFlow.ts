export type AccountSigningIntent = 'standalone' | 'offline' | 'treasury';

export type AccountSigningReviewOutcome = 'sign' | 'export';

export function accountSigningIntentForRoute(
  pathname: string,
  requestedIntent?: string | null,
  mode?: string | null,
): AccountSigningIntent {
  if (requestedIntent === 'offline' || mode === 'offline') return 'offline';
  if (requestedIntent === 'standalone') return 'standalone';
  if (pathname.endsWith('/treasury/bootstrap')) return 'offline';
  if (pathname.endsWith('/account/signing') || pathname.endsWith('/account/signing/edit')) return 'standalone';
  return 'treasury';
}

export function accountSigningReviewOutcome(
  intent: AccountSigningIntent,
  currentWalletCanAuthorize: boolean,
): AccountSigningReviewOutcome {
  if (intent === 'offline') return 'export';
  return currentWalletCanAuthorize ? 'sign' : 'export';
}

export interface RequestAuthConfig {
  homeDomain: string;
  webAuthDomain: string;
  issuer: string;
}

export function authConfigForRequest(request: Request): RequestAuthConfig {
  const url = new URL(request.url);
  const homeDomain = (process.env.STELLAR_HOME_DOMAIN ?? 'stellar.multisig.tools').trim().toLowerCase();
  return {
    homeDomain,
    webAuthDomain: url.host.toLowerCase(),
    issuer: `${url.origin}/api/auth`,
  };
}

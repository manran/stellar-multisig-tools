export const PRIVATE_SESSION_ADDRESS_HEADER = 'x-multisig-session-address';

export function privateSessionAddressHeaders(address: string): Record<string, string> {
  const selected = address.trim();
  return selected ? { [PRIVATE_SESSION_ADDRESS_HEADER]: selected } : {};
}

export function privateSessionAddressFromRequest(request: Request): string {
  return request.headers.get(PRIVATE_SESSION_ADDRESS_HEADER)?.trim() ?? '';
}

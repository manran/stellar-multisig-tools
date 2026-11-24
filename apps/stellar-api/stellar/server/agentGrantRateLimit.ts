import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { get, put } from './privateObjectStorage.js';
import { withBlobStorage } from './blobRequestStore.js';
import { AgentGrantError } from './agentGrantService.js';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 20;

export function grantRequestSource(request: Request): string {
  // Public ingress runs behind the established Cloudflare tunnel.
  // Ignore client-controlled x-real-ip and x-forwarded-for headers.
  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim() ?? '';
  return isIP(cloudflareIp) ? 'ip:' + cloudflareIp : 'unknown';
}

export async function limitAgentGrant(
  actor: string, now = new Date(), maxAttempts = MAX_ATTEMPTS,
): Promise<void> {
  const slotKey = createHash('sha256').update(actor).digest('hex').slice(0, 32);
  const period = Math.floor(now.getTime() / WINDOW_MS);
  for (let slot = 0; slot < maxAttempts; slot++) {
    const pathname = 'agent-grant-limits/' + period + '/' + slotKey + '/' + slot + '.json';
    try {
      await withBlobStorage(() => put(pathname, '{"used":true}', {
        access: 'private', addRandomSuffix: false, allowOverwrite: false,
        contentType: 'application/json', cacheControlMaxAge: 60,
      }));
      return;
    } catch (cause) {
      // A duplicate slot means an earlier attempt claimed it; any other storage
      // failure must stop issuance rather than silently bypassing the limit.
      const existing = await withBlobStorage(() => get(pathname, { access: 'private', useCache: false }));
      if (existing) continue;
      throw cause;
    }
  }
  throw new AgentGrantError('Too many Agent pairing attempts. Try again later.', 429, 'agent_pairing_rate_limited');
}

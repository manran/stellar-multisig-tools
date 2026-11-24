import { get, put } from './privateObjectStorage.js';
import { withBlobStorage } from './blobRequestStore.js';
import type { AgentGrantStore, AgentGrantRequest, AgentGrantDecision } from './agentGrantService.js';

function path(id: string, name: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid Agent grant storage id.');
  return 'agent-grants/' + id + '/' + name + '.json';
}

async function read<T>(pathname: string): Promise<T | null> {
  return withBlobStorage(async () => {
    const value = await get(pathname, { access: 'private', useCache: false });
    if (!value || value.statusCode !== 200 || !value.stream) return null;
    return JSON.parse(await new Response(value.stream).text()) as T;
  });
}

async function once(pathname: string, value: unknown): Promise<boolean> {
  if (await read(pathname)) return false;
  try {
    await withBlobStorage(() => put(pathname, JSON.stringify(value), {
      access: 'private', addRandomSuffix: false, allowOverwrite: false,
      contentType: 'application/json', cacheControlMaxAge: 60,
    }));
    return true;
  } catch (cause) {
    if (await read(pathname)) return false;
    throw cause;
  }
}

export const blobAgentGrantStore: AgentGrantStore = {
  async create(record) {
    if (!await once(path(record.id, 'request'), record)) throw new Error('Agent request ID collision.');
  },
  get(id) { return read<AgentGrantRequest>(path(id, 'request')); },
  decision(id) { return read<AgentGrantDecision>(path(id, 'decision')); },
  decide(id, result) { return once(path(id, 'decision'), result); },
  claim(id) { return once(path(id, 'claimed'), { claimedAt: new Date().toISOString() }); },
};

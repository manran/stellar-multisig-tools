import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

import * as accountCreatePrepare from '../../routes/account-create-prepare.js';
import * as activity from '../../routes/activity.js';
import * as addressBook from '../../routes/address-book.js';
import * as agentAccess from '../../routes/agent-access.js';
import * as auth from '../../routes/auth.js';
import * as contractCall from '../../routes/contract-call.js';
import * as contractInterface from '../../routes/contract-interface.js';
import * as contractPrepare from '../../routes/contract-prepare.js';
import * as contracts from '../../routes/contracts.js';
import * as inbox from '../../routes/inbox.js';
import * as integrationAdmin from '../../routes/integration-admin.js';
import * as integrationExecution from '../../routes/integration-execution.js';
import * as integrationTestnet from '../../routes/integration-testnet.js';
import * as intent from '../../routes/intent.js';
import * as openapi from '../../routes/openapi.js';
import * as operations from '../../routes/operations.js';
import * as paymentPrepare from '../../routes/payment-prepare.js';
import * as requestRoute from '../../routes/request.js';
import * as runtimeConfig from '../../routes/runtime-config.js';
import * as stellarToml from '../../routes/stellar-toml.js';
import * as treasuries from '../../routes/treasuries.js';
import * as treasuryBox from '../../routes/treasury-box.js';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
type RouteHandler = (request: Request) => Response | Promise<Response>;
type RouteModule = Partial<Record<HttpMethod, RouteHandler>>;

const routes: Record<string, RouteModule> = {
  'account-create-prepare': accountCreatePrepare,
  activity,
  'address-book': addressBook,
  'agent-access': agentAccess,
  auth,
  'contract-call': contractCall,
  'contract-interface': contractInterface,
  'contract-prepare': contractPrepare,
  contracts,
  inbox,
  'integration-admin': integrationAdmin,
  'integration-execution': integrationExecution,
  'integration-testnet': integrationTestnet,
  intent,
  openapi,
  operations,
  'payment-prepare': paymentPrepare,
  request: requestRoute,
  'runtime-config': runtimeConfig,
  'stellar-toml': stellarToml,
  treasuries,
  'treasury-box': treasuryBox,
};

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

function discovery(): Response {
  return json({
    service: 'MultiSig Tools API',
    protocols: {
      stellar: {
        base: '/stellar',
        openapi: '/stellar/openapi.json',
      },
    },
  });
}

function routeKey(pathname: string): string | undefined {
  if (pathname === '/stellar/openapi.json') return 'openapi';
  if (pathname === '/stellar/.well-known/stellar.toml') return 'stellar-toml';
  if (!pathname.startsWith('/stellar/')) return undefined;

  const key = pathname.slice('/stellar/'.length);
  return key && !key.includes('/') ? key : undefined;
}

export async function dispatchStellarHttpRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === '/healthz') return json({ status: 'ok' });
  if (pathname === '/' || pathname === '/stellar' || pathname === '/stellar/') {
    return discovery();
  }

  const key = routeKey(pathname);
  const route = key ? routes[key] : undefined;
  if (!route) {
    return json({ error: 'Not found.', code: 'not_found' }, 404);
  }

  const method = request.method.toUpperCase() as HttpMethod;
  const handler = route[method];
  if (!handler) {
    const allow = (Object.keys(route) as HttpMethod[]).sort().join(', ');
    return json(
      { error: 'Method not allowed.', code: 'method_not_allowed' },
      405,
      allow ? { allow } : {},
    );
  }

  return handler(request);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value?.split(',')[0]?.trim();
}

function webRequestFromNode(request: IncomingMessage): Request {
  const forwardedHost = firstHeaderValue(request.headers['x-forwarded-host']);
  const forwardedProto = firstHeaderValue(request.headers['x-forwarded-proto']);
  const host = forwardedHost || request.headers.host || 'localhost';
  const protocol = forwardedProto || 'http';
  const url = `${protocol}://${host}${request.url || '/'}`;

  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method || 'GET',
    headers,
  };
  if (init.method !== 'GET' && init.method !== 'HEAD') {
    init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function sendWebResponse(response: Response, reply: ServerResponse): Promise<void> {
  reply.statusCode = response.status;

  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const setCookies = getSetCookie?.call(response.headers) ?? [];
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'set-cookie') reply.setHeader(name, value);
  });
  if (setCookies.length > 0) reply.setHeader('set-cookie', setCookies);

  if (!response.body) {
    reply.end();
    return;
  }
  reply.end(Buffer.from(await response.arrayBuffer()));
}

export async function handleNodeHttpRequest(
  request: IncomingMessage,
  reply: ServerResponse,
): Promise<void> {
  try {
    await sendWebResponse(await dispatchStellarHttpRequest(webRequestFromNode(request)), reply);
  } catch (cause) {
    console.error('Node HTTP adapter error', cause);
    await sendWebResponse(
      json({ error: 'Service temporarily unavailable.', code: 'internal_error' }, 500),
      reply,
    );
  }
}

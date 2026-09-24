import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  BlobError,
  del as vercelDel,
  get as vercelGet,
  list as vercelList,
  put as vercelPut,
} from '@vercel/blob';

export { BlobError };

type StorageMode = 'vercel' | 'filesystem';

interface ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

interface ListResult {
  blobs: Array<{ pathname: string }>;
  cursor?: string;
}

interface GetResult {
  statusCode: number;
  stream: ReadableStream<Uint8Array>;
}

function storageMode(): StorageMode {
  const value = process.env.MULTISIG_PRIVATE_OBJECT_STORAGE?.trim().toLowerCase();
  if (!value || value === 'vercel' || value === 'vercel-blob') return 'vercel';
  if (value === 'filesystem') return 'filesystem';
  throw new Error(`Unsupported private object storage mode: ${value}`);
}

function storageRoot(): string {
  const value = process.env.MULTISIG_PRIVATE_OBJECT_ROOT?.trim();
  if (!value) throw new Error('MULTISIG_PRIVATE_OBJECT_ROOT is required for filesystem private object storage.');
  return path.resolve(value);
}

function safeSegments(pathname: string): string[] {
  if (!pathname || pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0')) {
    throw new Error('Invalid private object pathname.');
  }
  const segments = pathname.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid private object pathname.');
  }
  return segments;
}

function filePath(pathname: string): string {
  return path.join(storageRoot(), ...safeSegments(pathname));
}

async function bodyBytes(body: string | Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(await body.arrayBuffer());
}

async function walkFiles(directory: string, relative = ''): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const childAbsolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(childAbsolute, childRelative));
    else if (entry.isFile()) files.push(childRelative);
  }
  return files;
}

async function filesystemPut(
  pathname: string,
  body: string | Uint8Array | ArrayBuffer | Blob,
): Promise<{ pathname: string; url: string; downloadUrl: string }> {
  const target = filePath(pathname);
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, await bodyBytes(body), { mode: 0o600 });
  await fs.rename(temporary, target);
  return { pathname, url: `file://${target}`, downloadUrl: `file://${target}` };
}

async function filesystemGet(pathname: string): Promise<GetResult | null> {
  try {
    const data = await fs.readFile(filePath(pathname));
    return {
      statusCode: 200,
      stream: new Blob([data]).stream(),
    };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw cause;
  }
}

async function filesystemList(options: ListOptions = {}): Promise<ListResult> {
  const prefix = options.prefix ?? '';
  if (prefix && (prefix.startsWith('/') || prefix.includes('\\') || prefix.split('/').includes('..'))) {
    throw new Error('Invalid private object prefix.');
  }

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
  const offset = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
  if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid private object cursor.');

  const files = (await walkFiles(storageRoot())).filter((pathname) => pathname.startsWith(prefix)).sort();
  const page = files.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    blobs: page.map((pathname) => ({ pathname })),
    ...(nextOffset < files.length ? { cursor: String(nextOffset) } : {}),
  };
}

async function filesystemDel(pathname: string | string[]): Promise<void> {
  for (const item of Array.isArray(pathname) ? pathname : [pathname]) {
    await fs.rm(filePath(item), { force: true });
  }
}

export async function put(
  pathname: string,
  body: string | Uint8Array | ArrayBuffer | Blob,
  options?: Parameters<typeof vercelPut>[2],
) {
  if (storageMode() === 'filesystem') return filesystemPut(pathname, body);
  return vercelPut(pathname, body, options);
}

export async function get(
  pathname: string,
  options?: Parameters<typeof vercelGet>[1],
) {
  if (storageMode() === 'filesystem') return filesystemGet(pathname);
  return vercelGet(pathname, options);
}

export async function list(options?: ListOptions) {
  if (storageMode() === 'filesystem') return filesystemList(options);
  return vercelList(options);
}

export async function del(pathname: string | string[]) {
  if (storageMode() === 'filesystem') return filesystemDel(pathname);
  return vercelDel(pathname);
}

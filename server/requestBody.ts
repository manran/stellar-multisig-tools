export class RequestBodyError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'RequestBodyError';
    this.status = status;
    this.code = code;
  }
}

async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError('Request body is too large.', 413, 'request_too_large');
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof RequestBodyError) throw cause;
    throw new RequestBodyError('Request body must be valid JSON.', 400, 'invalid_json');
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonObjectBody(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new RequestBodyError('Content-Type must be application/json.', 415, 'unsupported_media_type');
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const contentLength = Number(declaredLength);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new RequestBodyError('Request body is too large.', 413, 'request_too_large');
    }
  }

  const bytes = await readBodyBytes(request, maxBytes);
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return body as Record<string, unknown>;
  } catch {
    throw new RequestBodyError('Request body must be valid JSON.', 400, 'invalid_json');
  }
}

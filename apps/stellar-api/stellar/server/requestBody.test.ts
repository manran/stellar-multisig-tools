import assert from 'node:assert/strict';
import test from 'node:test';
import { readJsonObjectBody, RequestBodyError } from './requestBody.js';

function jsonRequest(body: string, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

test('reads a JSON object within the byte limit', async () => {
  const result = await readJsonObjectBody(jsonRequest('{"network":"testnet"}'), 1024);
  assert.equal(result.network, 'testnet');
});

test('rejects an oversized body even when Content-Length is absent', async () => {
  const request = jsonRequest(JSON.stringify({ xdr: 'A'.repeat(2048) }));
  assert.equal(request.headers.get('content-length'), null);

  await assert.rejects(
    () => readJsonObjectBody(request, 1024),
    (cause: unknown) => {
      assert.ok(cause instanceof RequestBodyError);
      assert.equal(cause.status, 413);
      assert.equal(cause.code, 'request_too_large');
      return true;
    },
  );
});

test('rejects an oversized declared Content-Length before parsing the body', async () => {
  const request = jsonRequest('{}', { 'content-length': '2048' });
  await assert.rejects(
    () => readJsonObjectBody(request, 1024),
    (cause: unknown) => {
      assert.ok(cause instanceof RequestBodyError);
      assert.equal(cause.code, 'request_too_large');
      return true;
    },
  );
});

test('rejects arrays and malformed JSON as invalid_json', async () => {
  for (const body of ['[]', '{']) {
    await assert.rejects(
      () => readJsonObjectBody(jsonRequest(body), 1024),
      (cause: unknown) => {
        assert.ok(cause instanceof RequestBodyError);
        assert.equal(cause.code, 'invalid_json');
        return true;
      },
    );
  }
});

test('JSON media type matching is exact but accepts charset parameters', async () => {
  assert.deepEqual(await readJsonObjectBody(jsonRequest('{}', { 'content-type': 'application/json; charset=utf-8' }), 1024), {});
  await assert.rejects(() => readJsonObjectBody(jsonRequest('{}', { 'content-type': 'application/jsoninvalid' }), 1024), (error: unknown) => error instanceof RequestBodyError && error.status === 415);
});

test('rejects non-JSON media types', async () => {
  const request = new Request('https://example.test/api/request', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  await assert.rejects(
    () => readJsonObjectBody(request, 1024),
    (cause: unknown) => {
      assert.ok(cause instanceof RequestBodyError);
      assert.equal(cause.status, 415);
      assert.equal(cause.code, 'unsupported_media_type');
      return true;
    },
  );
});

test('closed payment and Intent input schemas reject misspelled fields', async () => {
  for (const [schema, body, field] of [
    ['ClassicPaymentPrepareInput', '{"memoo":"lost"}', 'memoo'],
    ['ClassicPaymentPrepareInput', '{"payments":[{"asset":{"type":"native","issuer":"unexpected"}}]}', 'payments[0].asset.issuer'],
    ['ClassicPaymentPrepareInput', '{"payments":[{"amunt":"1"}]}', 'payments[0].amunt'],
    ['ContractIntentCreateInput', '{"privateNot":"lost"}', 'privateNot'],
    ['ClassicCreateAccountPrepareInput', '{"memoo":"lost"}', 'memoo'],
  ]) {
    await assert.rejects(() => readJsonObjectBody(jsonRequest(body), 1024, schema),
      (cause: unknown) => cause instanceof RequestBodyError && cause.status === 400
        && cause.code === 'unknown_request_field' && cause.message.includes(field));
  }
  assert.deepEqual(await readJsonObjectBody(jsonRequest('{"arguments":{"custom_field":"x"}}'), 1024, 'ContractIntentCreateInput'), {arguments:{custom_field:'x'}});
});

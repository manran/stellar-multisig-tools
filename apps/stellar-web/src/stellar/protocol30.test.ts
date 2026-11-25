import assert from 'node:assert/strict';
import test from 'node:test';
import { xdr } from '@stellar/stellar-sdk/base';

// Public Horizon Testnet header fixtures, recorded on 2026-11-24.
// https://horizon-testnet.stellar.org/ledgers/5500000
// https://horizon-testnet.stellar.org/ledgers/5902606
const headers = [
  {
    "ledger": 5500000,
    "protocol": 29,
    "closedAt": "2026-11-01T09:00:40Z",
    "headerXdr": "AAAAHY8DI83T74xDKA7CFDu1eua0s5S+QRWRVQMHKnkd1NkwxPRhmbYu+605X2Ce3xRSy76oFFi0psF7WrjE/r8GV1EAAAAAaub/uAAAAAAAAAABAAAAALVdELK7fShO1cA6R6XhtZDJD1eDVUccxFB7voIE0jyLAAAAQIAhGs2D3Lgcv4pJ72xQtEDOqFZ6FqGIBmSgdJQOk1tDsyEwldaGwC/G+gvWhUcsN+qtKJcC6ELesUQYUovN9ARFwUH08xKRczMoPfhQxeWL5hns3Eat8eiT2dYMLr5K70TAaAz0AcKXg+0YuEt37ZCofX9OhI4/zMdPViWaDD1oAFPsYA3gtrOnZAAAAAAsp7pvZkgAAAAAAAAAAAAOS2QAAABkAExLQAAAAMhEwGgM9AHCl4PtGLhLd+2QqH1/ToSOP8zHT1Ylmgw9aLLCEtfUOuGMC7IYJdqmun/91Pisa8y1UJHPtjfpja9V+aWa1MSh/NcZCNuzRYWYjr8W7oE9ponBJshs5HBHr9O2cm6r8ecN/675yBcoOos0c4aKRh6aDbiou7DptxnL1QAAAAA="
  },
  {
    "ledger": 5902606,
    "protocol": 30,
    "closedAt": "2026-11-24T16:11:12Z",
    "headerXdr": "AAAAHjIvcShL4YIY3NrTxQU0NT9dpNTHJ5jGlBq5Rdmk85SGBsdbdmUm9GoItI9E2ui79ZTAMOYqIFu/8avgzYzuw1cAAAAAawW3IAAAAAAAAAADAAABog5TV/MAAAAAqCTNGLyddQZNKZpbW6ykO8OqLzJpOBU9jC+btctt8DMAAABAwNeH8fuCjOI6x0ns4HggAQhB053Ak0vV7gJBtKHm8rgZWe1SxRhgwCskQ8GXVjErKLU5pemkFN4QWDG+WdLBAPJoQKONvQs8+CBGpDK+bXmXtwi5AMJBfBmRGYGm1PBsq/hJP/OHlWuytJ914Eg7DOitoT5/1vTV2xsGC0bWm0YAWhEODeC2s6dkAAAAAC1/Q+rsvwAAAAAAAAAAAA9TAAAAAGQATEtAAAAAyJ1GrmG4iaROShv9/KdCo5VQeXPHKy4l+B7u02jAW0eZ+9cCxOtxg+d4xfPZXmonA0u+JdJ1kxviVtE0v7gTW3Wtur6+F7j9L/Hk5bBZpYxj3/soIND1+4ycG2AjiHErfUTAaAz0AcKXg+0YuEt37ZCofX9OhI4/zMdPViWaDD1oAAAAAA=="
  }
] as const;

test('Protocol 30 SDK decodes both old and millisecond ledger headers without changing whole-second semantics', () => {
  for (const fixture of headers) {
    const header = xdr.LedgerHeader.fromXdr(fixture.headerXdr, 'base64');
    assert.equal(header.ledgerVersion, fixture.protocol);
    assert.equal(header.ledgerSeq, fixture.ledger);
    assert.equal(header.toXdr('base64'), fixture.headerXdr);
    assert.equal(header.scpValue.closeTime, BigInt(Date.parse(fixture.closedAt) / 1000));
    if (fixture.protocol === 30) {
      const ext = header.scpValue.ext;
      assert.equal(ext.type, 'stellarValueSignedMs');
      if (ext.type !== 'stellarValueSignedMs') throw new Error('Expected CAP-88 milliseconds');
      assert.equal(ext.value.closeTimeMs, 1795536672755n);
      assert.equal(ext.value.closeTimeMs / 1000n, header.scpValue.closeTime);
    } else {
      assert.equal(header.scpValue.ext.type, 'stellarValueSigned');
    }
  }
});

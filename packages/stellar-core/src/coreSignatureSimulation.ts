export type CoreSignerKind = 'preauth' | 'hashx' | 'ed25519' | 'signed_payload';

export interface CoreSignerMatch {
  signerKey: string;
  signerType: string;
  weight: number;
  kind: CoreSignerKind;
  automaticMatch?: boolean;
  matchingSignatureIndexes?: number[];
}

export interface CoreConsumedSigner {
  signerKey: string;
  signerType: string;
  weight: number;
  automatic: boolean;
  signatureIndex?: number;
}

export interface CoreSignatureCheckResult {
  satisfied: boolean;
  matchedWeight: number;
  matchedSigners: CoreConsumedSigner[];
  usedSignatureIndexes: number[];
}

const GROUP_ORDER: CoreSignerKind[] = ['hashx', 'ed25519', 'signed_payload'];

function effectiveWeight(weight: number): number {
  return Math.min(weight, 255);
}

export function simulateCoreSignatureCheck(
  signers: CoreSignerMatch[],
  signatureCount: number,
  neededWeight: number,
): CoreSignatureCheckResult {
  let matchedWeight = 0;
  const matchedSigners: CoreConsumedSigner[] = [];
  const used = new Set<number>();

  for (const signer of signers.filter((item) => item.kind === 'preauth')) {
    if (!signer.automaticMatch) continue;
    const weight = effectiveWeight(signer.weight);
    matchedWeight += weight;
    matchedSigners.push({
      signerKey: signer.signerKey,
      signerType: signer.signerType,
      weight,
      automatic: true,
    });
    if (matchedWeight >= neededWeight) {
      return result(true, matchedWeight, matchedSigners, used);
    }
  }

  for (const kind of GROUP_ORDER) {
    const remaining = signers.filter((item) => item.kind === kind);
    for (let signatureIndex = 0; signatureIndex < signatureCount; signatureIndex += 1) {
      const signerIndex = remaining.findIndex((signer) =>
        signer.matchingSignatureIndexes?.includes(signatureIndex),
      );
      if (signerIndex < 0) continue;

      const signer = remaining[signerIndex];
      remaining.splice(signerIndex, 1);
      used.add(signatureIndex);
      const weight = effectiveWeight(signer.weight);
      matchedWeight += weight;
      matchedSigners.push({
        signerKey: signer.signerKey,
        signerType: signer.signerType,
        weight,
        automatic: false,
        signatureIndex,
      });
      if (matchedWeight >= neededWeight) {
        return result(true, matchedWeight, matchedSigners, used);
      }
    }
  }

  return result(false, matchedWeight, matchedSigners, used);
}

function result(
  satisfied: boolean,
  matchedWeight: number,
  matchedSigners: CoreConsumedSigner[],
  used: Set<number>,
): CoreSignatureCheckResult {
  return {
    satisfied,
    matchedWeight,
    matchedSigners,
    usedSignatureIndexes: [...used].sort((a, b) => a - b),
  };
}

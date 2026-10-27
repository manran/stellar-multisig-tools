export interface DesignerQuorums {
  payment: number;
  admin: number;
}

function integerOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

export function normalizeDesignerQuorums(
  participantCount: number,
  paymentQuorum: number,
  adminQuorum: number,
): DesignerQuorums {
  const maximum = Math.max(1, Math.trunc(participantCount));
  const payment = Math.min(maximum, Math.max(1, integerOr(paymentQuorum, 1)));
  const admin = Math.min(maximum, Math.max(payment, integerOr(adminQuorum, payment)));
  return { payment, admin };
}

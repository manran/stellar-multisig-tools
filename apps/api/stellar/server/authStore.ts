export interface StoredAuthServerKey {
  version: 1;
  secret: string;
  createdAt: string;
}

export interface StoredRedeemedChallenge {
  version: 1;
  transactionHash: string;
  redeemedAt: string;
}

export interface AuthStore {
  getServerKey(): Promise<StoredAuthServerKey | null>;
  createServerKey(key: StoredAuthServerKey): Promise<void>;
  claimChallengeRedemption(redemption: StoredRedeemedChallenge): Promise<boolean>;
}

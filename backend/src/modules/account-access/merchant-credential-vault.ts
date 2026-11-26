import { resolve } from 'node:path';

type CredentialIdentity = { shopId: string; userId: string; passwordHash: string };
type StoredCredential = { password: string; updatedAt: string; operationId: string | null };
type CredentialReceipt = { operationId: string; shopId: string; userId: string; version: string };

// src/modules/account-access and dist/modules/account-access have the same
// depth below backend. The shared CJS stays outside transpiled build output.
export const merchantCredentialVault = require(resolve(__dirname, '../../../scripts/lib/merchant-credential-vault.cjs')) as {
  randomMerchantPassword(): string;
  readMerchantCredential(input: CredentialIdentity): StoredCredential | null;
  writeMerchantCredential(input: CredentialIdentity & { password: string; operationId?: string }): { updatedAt: string };
  writeMerchantCredentialReceipt(input: CredentialReceipt): void;
  readMerchantCredentialReceipt(operationId: string): Omit<CredentialReceipt, 'operationId'> | null;
};

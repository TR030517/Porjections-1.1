/** Opt in explicitly. Legacy shops retain their prepayment contract. */
export function shopPaymentPolicy(profile: unknown): { payAtStoreEnabled: boolean } {
  if (typeof profile === 'string') { try { profile = JSON.parse(profile); } catch { profile = null; } }
  const value = profile && typeof profile === 'object' && !Array.isArray(profile) ? (profile as any).paymentPolicy : null;
  return { payAtStoreEnabled: value?.payAtStoreEnabled === true };
}

export function shopFeatures(profile: unknown): { onlineBooking: boolean; reviews: boolean } {
  if (typeof profile === 'string') { try { profile = JSON.parse(profile); } catch { profile = null; } }
  const features = profile && typeof profile === 'object' ? (profile as any).features : undefined;
  // Legacy shops did not have this profile. Only an explicit false disables a feature.
  return { onlineBooking: features?.onlineBooking !== false, reviews: features?.reviews !== false };
}

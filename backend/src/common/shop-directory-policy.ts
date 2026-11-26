/** Address completeness is a directory warning, never business verification.
 * Keep known import placeholders here so an operator can correct the source.
 * Do not infer or repair an address, geocode, timezone, or shop ownership. */
const PLACEHOLDERS = new Set(['address pending update', 'address pending verification', 'pending update', 'pending verification', 'unknown', 'n/a', 'tbd']);

export function listingDetailsIncomplete(shop: { address?: unknown; city?: unknown; state?: unknown } | null | undefined): boolean {
  return ['address', 'city', 'state'].some(key => {
    const value = shop?.[key as 'address' | 'city' | 'state'];
    return typeof value !== 'string' || !value.trim() || PLACEHOLDERS.has(value.trim().toLowerCase());
  });
}

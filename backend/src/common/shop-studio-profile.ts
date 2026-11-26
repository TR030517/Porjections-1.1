/** JSON profile updates must preserve server-owned provenance and unknown private fields. */
export function storedStudioProfile(value: unknown): Record<string, any> {
  if (value === undefined || value === null) return {};
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('Stored shop profile is malformed; repair it before editing'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Stored shop profile is malformed; repair it before editing');
  return value as Record<string, any>;
}

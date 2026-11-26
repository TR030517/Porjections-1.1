import { usStateCode } from './store-timezone';

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

/** Format only; never rewrite imported street/unit data or infer missing locations. */
export function formatPublicShopAddress(address: unknown, city?: unknown, state?: unknown, zipCode?: unknown): string {
  const street = typeof address === 'string' ? address.trim() : '';
  const fields = [city, state, zipCode].map((value, index) => ({
    index, value: typeof value === 'string' ? value.trim() : '',
  })).filter(field => field.value);
  const embedded = new Set<number>();
  if (street) {
    // Match a location suffix, not words anywhere in the street name. In
    // particular, "Washington Ave" is not the state Washington.
    outer: for (let length = fields.length; length > 0; length--) {
      for (let start = 0; start + length <= fields.length; start++) {
        const candidate = fields.slice(start, start + length);
        const pattern = candidate.map((field, index) => {
          let part = escape(field.value);
          if (field.index === 1) {
            const code = usStateCode(field.value);
            if (code && code.toLowerCase() !== field.value.toLowerCase()) part = '(?:' + part + '|' + code + ')';
          }
          if (field.index === 2 && /^\d{5}$/.test(field.value)) part += '(?:-\\d{4})?';
          const separator = index === 0 ? '' : candidate[index - 1].index === 1 && field.index === 2 ? '[\\s,.]*' : '[\\s,.]+';
          return separator + part;
        }).join('');
        if (new RegExp('(?:^|[\\s,.])' + pattern + '(?:[\\s,.]+(?:USA|US|United States(?: of America)?|Canada))?\\s*$', 'i').test(street)) {
          candidate.forEach(field => embedded.add(field.index));
          break outer;
        }
      }
    }
  }
  return [street, ...fields.filter(field => !embedded.has(field.index)).map(field => field.value)].filter(Boolean).join(', ');
}

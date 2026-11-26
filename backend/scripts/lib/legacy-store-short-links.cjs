'use strict';

const { existsSync } = require('node:fs');
const { join } = require('node:path');

function selectLegacyStoreShortLinks(rows) {
  // A checkout has the TypeScript module. The API image ships its compiled form.
  const sourceModule = join(__dirname, '../../src/common/shop-alias.ts');
  const { normalizeShopShortName } = existsSync(sourceModule)
    ? require(sourceModule)
    : require('../../dist/common/shop-alias.js');
  const byLink = new Map();
  const skipped = [];
  for (const row of rows) {
    const legacyId = String(row.id);
    if (!row.redirect?.trim()) {
      skipped.push({ reason: 'missing', legacyIds: [legacyId] });
      continue;
    }
    let value;
    try {
      value = normalizeShopShortName(row.redirect);
    } catch {
      skipped.push({ reason: 'unsupported', legacyIds: [legacyId] });
      continue;
    }
    // The customer router reserves both names for old numeric shop-detail URLs.
    if (value === 'storedetails' || value === 'shopdetails') {
      skipped.push({ reason: 'unsupported', legacyIds: [legacyId] });
      continue;
    }
    const matches = byLink.get(value) ?? [];
    matches.push(row);
    byLink.set(value, matches);
  }

  const links = [];
  for (const [value, matches] of byLink) {
    // The 1.0 storefront queried the merchant model with its SQL soft-delete filter.
    const live = matches.filter(row => row.delete_time === null);
    if (live.length === 1) {
      links.push({ value, legacyId: String(live[0].id), original: live[0].redirect });
      continue;
    }
    skipped.push({ value, reason: live.length ? 'ambiguous' : 'deleted', legacyIds: matches.map(row => String(row.id)) });
  }
  return { links, skipped };
}

module.exports = { selectLegacyStoreShortLinks };

// Only the parent-owned fresh mj2_legacy_staging_<8hex> runner may invoke this.
// No URL/env lookup, database creation, network access or real legacy data is used.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

async function runLegacyStaging(db, { check }) {
  const root = resolve(__dirname, '../..');
  const { planLegacyStaging, canonicalJson } = await import(pathToFileURL(resolve(root, 'scripts/legacy-staging-plan.mjs')).href);
  const { importLegacyStaging, reconcileStaging, guardStagingDatabase } = await import(pathToFileURL(resolve(root, 'scripts/legacy-staging.mjs')).href);
  const input = JSON.parse(readFileSync(resolve(root, 'scripts/fixtures/legacy-staging-synthetic.json'), 'utf8'));
  const { plan, report } = planLegacyStaging(input);
  assert.equal(report.stagingEligible, true);
  const options = { acknowledgeStagingOnly: true, expectedDigest: plan.packageDigest };
  const count = async table => {
    assert.ok(['legacy_staging_batches', 'legacy_staging_entities'].includes(table));
    const rows = await db.$queryRawUnsafe(`SELECT COUNT(*) AS row_count FROM ${table}`);
    return Number(rows[0].row_count);
  };

  await check('B09 disposable target has migration017 and no live business data except exact canonical display defaults', async () => {
    assert.match(await guardStagingDatabase(db), /^mj2_legacy_staging_[a-f0-9]{8}$/);
    assert.equal(await count('legacy_staging_batches'), 0);
    assert.equal(await count('legacy_staging_entities'), 0);
  });
  await check('B09 altered display defaults are rejected without exposing or accepting configuration contents', async () => {
    const rows = await db.$queryRawUnsafe('SELECT COUNT(*) AS row_count FROM platform_configs');
    assert.equal(Number(rows[0].row_count), 3); // The fresh parent runner applies migration018.
    for (const change of [
      ['UPDATE platform_configs SET `value` = ? WHERE `key` = ?', 'synthetic-operator-contact', 'support_email'],
      ['UPDATE platform_configs SET `isPublic` = ? WHERE `key` = ?', 0, 'site_name'],
      ['UPDATE platform_configs SET `type` = ? WHERE `key` = ?', 'JSON', 'site_name'],
      ['UPDATE platform_configs SET `description` = ? WHERE `key` = ?', 'Changed description', 'site_name'],
    ]) await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe(...change);
      await assert.rejects(guardStagingDatabase(tx), /DISPLAY_DEFAULTS_NOT_CANONICAL/);
      throw new Error('SYNTHETIC_DEFAULT_ROLLBACK');
    }), /SYNTHETIC_DEFAULT_ROLLBACK/);
    await guardStagingDatabase(db);
  });
  await check('B09 failed transaction preserves neither batch nor partial source entities', async () => {
    let inserts = 0;
    const failing = {
      $queryRawUnsafe: db.$queryRawUnsafe.bind(db),
      $transaction: (work, settings) => db.$transaction(tx => work({
        $queryRawUnsafe: tx.$queryRawUnsafe.bind(tx),
        $executeRawUnsafe: async (...args) => {
          if (++inserts === 4) throw new Error('SYNTHETIC_INSERT_FAILURE');
          return tx.$executeRawUnsafe(...args);
        },
      }), settings),
    };
    await assert.rejects(importLegacyStaging(failing, input, options), /SYNTHETIC_INSERT_FAILURE/);
    assert.equal(await count('legacy_staging_batches'), 0);
    assert.equal(await count('legacy_staging_entities'), 0);
  });
  await check('B09 concurrent identical package imports once and replay independently verifies every preserved row', async () => {
    const results = await Promise.all([importLegacyStaging(db, input, options), importLegacyStaging(db, input, options)]);
    assert.equal(results.filter(result => !result.replayed).length, 1);
    assert.ok(results.every(result => result.verified && result.liveImported === false));
    assert.equal(await count('legacy_staging_batches'), 1);
    assert.equal(await count('legacy_staging_entities'), 13);
    const replay = await importLegacyStaging(db, input, options);
    assert.equal(replay.replayed, true);
    assert.equal(replay.verified, true);
  });
  await check('B09 source-system/table/id namespace retains leading zeros and values above JS safe integer', async () => {
    const rows = await db.$queryRawUnsafe('SELECT source_table,source_id,COLLATION(source_id) AS id_collation FROM legacy_staging_entities WHERE kind = ? ORDER BY source_table,source_id', 'identities');
    assert.equal(rows.length, 3);
    assert.equal(rows.filter(row => row.source_id === '0007').length, 2);
    assert.ok(rows.some(row => row.source_id === '9007199254740993'));
    assert.ok(rows.every(row => row.id_collation === 'ascii_bin'));
    const lower = await db.$queryRawUnsafe('SELECT id FROM legacy_staging_entities WHERE source_system = ? AND source_table = ? AND source_id = ?', 'Massajoy1.0', 'users', '0007');
    const changedCase = await db.$queryRawUnsafe('SELECT id FROM legacy_staging_entities WHERE source_system = ? AND source_table = ? AND source_id = ?', 'Massajoy1.0', 'USERS', '0007');
    assert.equal(lower.length, 1);
    assert.equal(changedCase.length, 0);
  });
  await check('B09 preserved history reconciles integer amounts including original cents/tips/refunds and unused rights', async () => {
    const result = await reconcileStaging(db, plan);
    assert.equal(result.entities, 13);
    const usd = result.reconciliation.byShopCurrency.find(row => row.currency === 'usd');
    assert.equal(usd.historicalTotalCents, '5735');
    assert.equal(usd.historicalTipCents, '185');
    assert.equal(usd.paymentCents, '5735');
    assert.equal(usd.refundCents, '1000');
    assert.equal(usd.unusedUses, '5');
    const rows = await db.$queryRawUnsafe('SELECT payload FROM legacy_staging_entities WHERE kind = ?', 'historicalBookings');
    const fact = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
    assert.equal(fact.amounts.total.original, '57.35');
    assert.equal(fact.amounts.total.unit, 'major');
    assert.equal(fact.startAt, '2031-05-01T10:00:00-04:00');
  });
  await check('B09 changed package and unknown receipt/unfinished booking are rejected without overwriting the first package', async () => {
    const changed = structuredClone(input);
    changed.services[0].displayLabel = 'Changed synthetic fact';
    const alternate = planLegacyStaging(changed).plan;
    assert.ok(alternate);
    await assert.rejects(importLegacyStaging(db, changed, { ...options, expectedDigest: alternate.packageDigest }), /ANOTHER_STAGING_PACKAGE/);
    for (const change of [x => { x.historicalPayments[0].ownership = 'PLATFORM_SHARED'; }, x => { x.historicalBookings[0].status = 'CONFIRMED'; }]) {
      const blocked = structuredClone(input); change(blocked);
      assert.equal(planLegacyStaging(blocked).plan, null);
      await assert.rejects(importLegacyStaging(db, blocked, options), /PACKAGE_BLOCKED/);
    }
    assert.equal((await reconcileStaging(db, plan)).matched, true);
  });
  await check('B09 stored payload and summary corruption are detected before replay acceptance', async () => {
    const entity = plan.entities.find(row => row.kind === 'services');
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('UPDATE legacy_staging_entities SET payload = ? WHERE id = ?', canonicalJson({ corrupt: true }), entity.id);
      await assert.rejects(reconcileStaging(tx, plan), /CONTENT_MISMATCH/);
      throw new Error('SYNTHETIC_TAMPER_ROLLBACK');
    }), /SYNTHETIC_TAMPER_ROLLBACK/);
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('UPDATE legacy_staging_batches SET summary = ? WHERE id = ?', '{}', plan.packageDigest);
      await assert.rejects(reconcileStaging(tx, plan), /BATCH_MISMATCH/);
      throw new Error('SYNTHETIC_TAMPER_ROLLBACK');
    }), /SYNTHETIC_TAMPER_ROLLBACK/);
    assert.equal((await reconcileStaging(db, plan)).matched, true);
  });
  await check('B09 preservation never creates live accounts, shops, bookings, payments or usable rights', async () => {
    // Re-enumerate every non-tool table; only migration018's exact defaults are exempt from zero.
    await guardStagingDatabase(db);
    assert.equal(await count('legacy_staging_batches'), 1);
    assert.equal(await count('legacy_staging_entities'), 13);
  });
}

module.exports = { runLegacyStaging };

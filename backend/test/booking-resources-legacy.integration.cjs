/* Existing security/payment assertions, executed unchanged in a child against a
 * brand-new migrated database. Never migrates or resets .env.test.local's database.
 * node --env-file=.env.test.local --test test/booking-resources-legacy.integration.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { installTestEnvironment, withFreshDatabase } = require('./booking-resources.support.cjs');
installTestEnvironment();

test('existing security and financial HTTP suite remains compatible in a fresh resource-schema database', { timeout: 240000 }, async t => {
  await withFreshDatabase(async ({ databaseUrl, migrationCount }) => {
    const childEnvironment = { ...process.env, TEST_DATABASE_URL: databaseUrl, DATABASE_URL: databaseUrl };
    // A node:test worker inherits this marker. Leaving it set causes a nested
    // --test CLI to skip all files with a warning yet exit zero: a false pass.
    delete childEnvironment.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', path.resolve(__dirname, 'integration.cjs')], {
      cwd: path.resolve(__dirname, '..'), timeout: 180000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
      env: childEnvironment,
    });
    // The established harness uses synthetic accounts and never prints credentials.
    // Keep its individual assertion results in the caller's separate local log.
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    assert.equal(result.status, 0, 'LEGACY_SECURITY_FINANCIAL_HTTP_SUITE_FAILED');
    assert.match(result.stdout, /isolated HTTP and MySQL security integration/, 'The child must actually execute the established test file');
    assert.doesNotMatch(result.stderr || '', /skipping running files/, 'A recursive node:test skip is not verification');
    const executed = /(?:^|\n)(?:#|ℹ)\s*tests (\d+)/.exec(result.stdout);
    assert.ok(executed && Number(executed[1]) >= 40, 'All established child tests must execute, including their assertions');
    t.diagnostic(`LEGACY_HTTP_CHILD_PASS migrations=${migrationCount}; exact disposable database cleanup follows`);
  });
});

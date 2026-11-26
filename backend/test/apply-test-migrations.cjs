/* Explicit migration deploy for the existing isolated integration database only. */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const raw = process.env.TEST_DATABASE_URL;
const target = new URL(raw || 'invalid:');
if (target.protocol !== 'mysql:' || !['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '3310' || !/^\/mj2_test_[a-zA-Z0-9_]+$/.test(target.pathname)) throw new Error('Explicit isolated loopback:3310 mj2_test_* database required');
const result = spawnSync(process.execPath, [path.resolve(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: raw, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  encoding: 'utf8', timeout: 60000,
});
// Prisma diagnostic output can contain connection credentials; expose only a fixed result here.
if (result.status !== 0) { console.error('TEST_MIGRATION_DEPLOY_FAILED'); process.exit(1); }
console.log('TEST_MIGRATION_DEPLOY_PASS');

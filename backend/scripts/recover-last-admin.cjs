/* Offline custodian procedure, never imported by the HTTP application.
 * Default is read-only. Explicit environment/identity confirmation and stdin
 * password are required for --execute; this never creates or activates users.
 */
const { PrismaClient, Prisma } = require('@prisma/client');
const { hash, compare } = require('bcryptjs');
const { createHash } = require('node:crypto');
const { createInterface } = require('node:readline');
const { Writable } = require('node:stream');
const { validRolePassword } = require('./lib/password-policy.cjs');

class RecoveryError extends Error {}
const fail = code => { throw new RecoveryError(code); };
const digest = (domain, value) => createHash('sha256').update(domain + '\0' + value).digest('hex');

function options(env = process.env, args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length && !['--dry-run', '--execute'].includes(args[0]))) fail('RECOVERY_MODE_INVALID');
  const execute = args[0] === '--execute';
  let target;
  try { target = new URL(env.DATABASE_URL || 'invalid:'); } catch { fail('RECOVERY_DATABASE_IDENTITY_REQUIRED'); }
  const database = decodeURIComponent(target.pathname.slice(1));
  if (target.protocol !== 'mysql:' || !['127.0.0.1', 'localhost'].includes(target.hostname) ||
      !target.port || !/^[a-zA-Z0-9_]{1,64}$/.test(database) ||
      ['mysql', 'sys', 'information_schema', 'performance_schema'].includes(database.toLowerCase()) ||
      target.hostname !== env.RECOVERY_EXPECTED_DATABASE_HOST || target.port !== env.RECOVERY_EXPECTED_DATABASE_PORT ||
      database !== env.RECOVERY_EXPECTED_DATABASE_NAME ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(env.RECOVERY_EXPECTED_SERVER_UUID || '')) fail('RECOVERY_DATABASE_IDENTITY_REQUIRED');
  if (!/^[1-9]\d{0,18}$/.test(env.RECOVERY_TARGET_USER_ID || '') || BigInt(env.RECOVERY_TARGET_USER_ID) > 9223372036854775807n ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.RECOVERY_TARGET_EMAIL || '')) fail('RECOVERY_TARGET_IDENTITY_REQUIRED');
  const reference = /^[A-Za-z][A-Za-z0-9._:-]{5,79}$/;
  if (!reference.test(env.RECOVERY_INCIDENT_REFERENCE || '') || !reference.test(env.RECOVERY_OPERATOR_REFERENCE || '')) fail('RECOVERY_CUSTODY_REFERENCES_REQUIRED');
  if (execute && (env.RECOVERY_CONFIRMATION !== 'RECOVER_LAST_ACTIVE_ADMIN_ONLY' || env.RECOVERY_MAINTENANCE_CONFIRMED !== 'YES')) fail('RECOVERY_EXPLICIT_CONFIRMATION_REQUIRED');
  return { execute, database, serverUuid: env.RECOVERY_EXPECTED_SERVER_UUID.toLowerCase(),
    userId: BigInt(env.RECOVERY_TARGET_USER_ID), email: env.RECOVERY_TARGET_EMAIL.toLowerCase(),
    incidentHash: digest('massajoy:emergency-incident:v1', env.RECOVERY_INCIDENT_REFERENCE),
    operatorHash: digest('massajoy:emergency-custodian:v1', env.RECOVERY_OPERATOR_REFERENCE) };
}

async function readPassword() {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) { value += chunk; if (Buffer.byteLength(value, 'utf8') > 200) fail('RECOVERY_PASSWORD_INVALID'); }
    return value.replace(/\r?\n$/, '');
  }
  process.stdout.write('New administrator password (hidden): ');
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: muted, terminal: true });
  let answered = false;
  input.once('SIGINT', () => input.close());
  try {
    return await new Promise((resolve, reject) => {
      input.once('close', () => { if (!answered) reject(new RecoveryError('RECOVERY_CANCELLED')); });
      input.question('', value => { answered = true; resolve(value); });
    });
  } finally { input.close(); process.stdout.write('\n'); }
}

async function verifyDatabase(db, config) {
  const rows = await db.$queryRaw`SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid`;
  if (rows.length !== 1 || rows[0].databaseName !== config.database || String(rows[0].serverUuid).toLowerCase() !== config.serverUuid) fail('RECOVERY_DATABASE_IDENTITY_MISMATCH');
}

async function recover(prisma, config, password) {
  await verifyDatabase(prisma, config);
  if (config.execute && !validRolePassword(password, 'ADMIN')) fail('RECOVERY_PASSWORD_INVALID');
  const passwordHash = config.execute ? await hash(password, 12) : undefined;
  return prisma.$transaction(async tx => {
    await verifyDatabase(tx, config);
    // An offline maintenance window is mandatory. Lock all administrator rows
    // and the ADMIN index range before rechecking uniqueness and identity.
    await tx.$queryRaw`SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: config.userId } });
    if (!target || target.role !== 'ADMIN' || target.status !== 'ACTIVE' || target.deletedAt ||
        !target.passwordHash || (target.email || '').toLowerCase() !== config.email) fail('RECOVERY_TARGET_NOT_EXISTING_ACTIVE_ADMIN');
    if (await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE', deletedAt: null } }) !== 1) fail('RECOVERY_NOT_LAST_ACTIVE_ADMIN_USE_NORMAL_RECOVERY');
    if (!config.execute) return { dryRun: true, eligible: true, targetUserId: String(target.id), writes: 0,
      note: 'Custodian approval, identity verification and maintenance must be completed separately before execution.' };
    if (await compare(password, target.passwordHash)) fail('RECOVERY_PASSWORD_UNCHANGED');
    await tx.user.update({ where: { id: target.id }, data: { passwordHash }, select: { id: true } });
    const revoked = await tx.authSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.pushDevice.deleteMany({ where: { userId: target.id } });
    await tx.auditLog.create({ data: { action: 'CLI_LAST_ADMIN_PASSWORD_RECOVERED', targetType: 'USER', targetId: target.id, operatorId: target.id,
      detail: { method: 'offline-custodian-emergency', fields: ['passwordReset'], revokedSessions: revoked.count,
        custodianReferenceHash: config.operatorHash, incidentReferenceHash: config.incidentHash,
        externalVerificationRecordRequired: true, databaseIdentityVerified: true, secretsLogged: false } } });
    return { recovered: true, targetUserId: String(target.id), revokedSessions: revoked.count, reauthenticationRequired: true,
      roleAndStatusUnchanged: true, secretsLogged: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 15000 });
}

async function main() {
  const config = options();
  let password = '';
  const prisma = new PrismaClient();
  try {
    // Verify the expected instance before asking the custodian for a secret.
    await verifyDatabase(prisma, config);
    if (config.execute) password = await readPassword();
    process.stdout.write(JSON.stringify(await recover(prisma, config, password)) + '\n');
  } finally { password = ''; await prisma.$disconnect(); }
}

if (require.main === module) main().catch(error => {
  const code = error instanceof RecoveryError ? error.message : 'RECOVERY_DATABASE_OPERATION_FAILED';
  console.error('Last-admin recovery failed: ' + code);
  process.exitCode = 1;
});
module.exports = { options, recover, main };

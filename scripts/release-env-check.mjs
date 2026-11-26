import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline only: never source an env file, execute its contents, call Docker, or contact a provider.
export function parseEnvironment(text) {
  if (Buffer.byteLength(text, 'utf8') > 65536) throw new Error('ENV_FILE_TOO_LARGE');
  const values = Object.create(null);
  for (const [index, raw] of text.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) throw new Error(`ENV_SYNTAX_LINE_${index + 1}`);
    let value = match[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      if (value.length < 2 || !value.endsWith(quote) || value.slice(1, -1).includes(quote)) throw new Error(`ENV_SYNTAX_LINE_${index + 1}`);
      value = value.slice(1, -1);
      if (quote === '"' && value.includes('\\')) throw new Error(`ENV_UNSUPPORTED_VALUE_LINE_${index + 1}`);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
      if (/['"]/.test(value)) throw new Error(`ENV_SYNTAX_LINE_${index + 1}`);
    }
    // Compose interpolation and shell expressions are deliberately outside this literal-file contract.
    if (/[\x00-\x1f\x7f$`]/.test(value)) throw new Error(`ENV_UNSUPPORTED_VALUE_LINE_${index + 1}`);
    values[match[1]] = value;
  }
  return values;
}

const placeholder = value => !value || /REPLACE|CHANGEME|CHANGE_ME|YOUR[_-]|example\.(com|org|net|invalid)|\.test(?:[/:]|$)/i.test(value);
const integer = (value, min, max) => /^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
const secret = value => /^[a-f0-9]{64,}$/i.test(value ?? '') && new Set(value.toLowerCase()).size >= 8;
function credentialVaultKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value) || placeholder(value)) return false;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value;
}
function url(value) { try { return new URL(value); } catch { return null; } }
function cleanUrl(value, { local = false, originOnly = false } = {}) {
  const u = url(value);
  if (!u || u.username || u.password || u.search || u.hash) return false;
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  return (u.protocol === 'https:' || (local && loopback && u.protocol === 'http:')) && (!originOnly || (u.pathname === '/' && value === u.origin));
}

// Keep the sender format aligned with the order-email transport. Checking a
// literal address cannot establish provider domain verification or delivery.
function orderEmailAddress(value) {
  if (typeof value !== 'string' || value.length > 255 || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  const parts = value.split('@'); if (parts.length !== 2) return false;
  const [name, domain] = parts;
  return !!name && name.length <= 64 && /^[A-Za-z0-9._+-]+$/.test(name) && !name.startsWith('.') && !name.endsWith('.') && !name.includes('..')
    && domain.split('.').length >= 2 && domain.split('.').every(part => part.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(part));
}

export function validateReleaseEnvironment(env, { local = false } = {}) {
  const checks = [];
  const check = (id, fields, valid) => checks.push({ id, fields, status: valid ? 'pass' : 'fail' });
  check('release.explicit_version', ['RELEASE_TAG'], /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(env.RELEASE_TAG ?? ''));
  check('database.safe_name', ['MYSQL_DATABASE'], /^[a-z][a-z0-9_]{0,47}$/.test(env.MYSQL_DATABASE ?? '') && !['mysql', 'sys', 'information_schema', 'performance_schema'].includes(env.MYSQL_DATABASE));
  // Production jwtSecret() also requires 12 distinct characters; database rules stay unchanged.
  for (const field of ['MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'JWT_SECRET']) check('secret.strong_hex.' + field, [field], secret(env[field]) && (field !== 'JWT_SECRET' || new Set(env[field]).size >= 12));
  check('secret.distinct', ['MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'JWT_SECRET'], new Set([env.MYSQL_ROOT_PASSWORD, env.MYSQL_PASSWORD, env.JWT_SECRET]).size === 3);
  // The local Compose overlay explicitly uses its persistent key.bin. Production
  // must inject a stable key; this offline check cannot compare it with old ciphertext.
  const vaultKey = env.MERCHANT_CREDENTIAL_VAULT_KEY;
  check('credential_vault.key_base64_32_bytes', ['MERCHANT_CREDENTIAL_VAULT_KEY'], local && !vaultKey || credentialVaultKey(vaultKey));
  if (credentialVaultKey(vaultKey)) {
    const decodedKey = Buffer.from(vaultKey, 'base64');
    check('credential_vault.key_independent', ['MERCHANT_CREDENTIAL_VAULT_KEY', 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'JWT_SECRET'],
      ['MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'JWT_SECRET'].every(field => !secret(env[field]) || !decodedKey.equals(Buffer.from(env[field], 'hex'))));
  }
  check('site.valid_origin', ['PUBLIC_ORIGIN'], cleanUrl(env.PUBLIC_ORIGIN, { local, originOnly: true }) && (local || !placeholder(env.PUBLIC_ORIGIN)));
  const origin = url(env.PUBLIC_ORIGIN);
  const productionHost = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
  const siteMatches = local ? env.SITE_ADDRESS === ':80' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin?.hostname) : productionHost.test(env.SITE_ADDRESS ?? '') && !/\.(?:localhost|local|internal|invalid|test)$/i.test(env.SITE_ADDRESS) && env.SITE_ADDRESS === origin?.host && !placeholder(env.SITE_ADDRESS);
  check('site.address_matches_origin', ['SITE_ADDRESS', 'PUBLIC_ORIGIN'], siteMatches);
  check('site.certificate_email', ['TLS_EMAIL'], /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.TLS_EMAIL ?? '') && (local || !placeholder(env.TLS_EMAIL)));
  for (const field of ['HTTP_PORT', 'HTTPS_PORT']) if (env[field]) check('site.port.' + field, [field], integer(env[field], 1, 65535));
  check('payment.provider', ['PAYMENT_PROVIDER'], ['disabled', 'square'].includes(env.PAYMENT_PROVIDER));
  const enabled = env.PAYMENT_EXTERNAL_ENABLED || 'false';
  check('payment.enabled_boolean', ['PAYMENT_EXTERNAL_ENABLED'], ['true', 'false'].includes(enabled));
  check('payment.disabled_consistent', ['PAYMENT_PROVIDER', 'PAYMENT_EXTERNAL_ENABLED'], env.PAYMENT_PROVIDER !== 'disabled' || enabled === 'false');
  const bookingOnline = env.BOOKING_ONLINE_PAYMENT_ENABLED ?? 'false';
  check('booking.online_payment_boolean', ['BOOKING_ONLINE_PAYMENT_ENABLED'], ['true', 'false'].includes(bookingOnline));
  check('booking.online_payment_channel', ['BOOKING_ONLINE_PAYMENT_ENABLED', 'PAYMENT_PROVIDER', 'PAYMENT_EXTERNAL_ENABLED'], bookingOnline !== 'true' || env.PAYMENT_PROVIDER === 'square' && enabled === 'true');
  const orderEmail = env.ORDER_EMAIL_ENABLED ?? 'false', worker = env.NOTIFICATION_WORKER_ENABLED ?? 'true';
  check('order_email.enabled_boolean', ['ORDER_EMAIL_ENABLED'], ['true', 'false'].includes(orderEmail));
  check('notifications.worker_boolean', ['NOTIFICATION_WORKER_ENABLED'], ['true', 'false'].includes(worker));
  check('notifications.worker_explicit', ['NOTIFICATION_WORKER_ENABLED'], env.NOTIFICATION_WORKER_ENABLED === 'true' || env.NOTIFICATION_WORKER_ENABLED === 'false');
  if (orderEmail === 'true') {
    const sender = typeof env.ORDER_EMAIL_FROM === 'string' ? env.ORDER_EMAIL_FROM.trim() : '';
    const credential = typeof env.ORDER_EMAIL_API_KEY === 'string' ? env.ORDER_EMAIL_API_KEY.trim() : '';
    check('order_email.provider', ['ORDER_EMAIL_PROVIDER'], env.ORDER_EMAIL_PROVIDER === 'resend');
    check('order_email.sender', ['ORDER_EMAIL_FROM'], orderEmailAddress(sender) && (local || !placeholder(sender)));
    check('order_email.credential', ['ORDER_EMAIL_API_KEY'], !placeholder(credential) && !/[\s\x00-\x1f\x7f]/.test(credential) && credential.length <= 2048);
    check('order_email.worker_running_configuration', ['ORDER_EMAIL_ENABLED', 'NOTIFICATION_WORKER_ENABLED'], worker === 'true');
  }
  check('payment.platform_fee', ['PLATFORM_FEE_BPS'], integer(env.PLATFORM_FEE_BPS || '0', 0, 10000));
  check('booking.prepayment_hold', ['BOOKING_HOLD_MINUTES'], integer(env.BOOKING_HOLD_MINUTES ?? '15', 5, 60));
  check('auth.no_local_otp', ['AUTH_LOCAL_OTP'], !env.AUTH_LOCAL_OTP || env.AUTH_LOCAL_OTP === 'false');
  check('auth.no_local_email_otp', ['AUTH_EMAIL_LOCAL_OTP'], !env.AUTH_EMAIL_LOCAL_OTP || env.AUTH_EMAIL_LOCAL_OTP === 'false');
  if (env.PAYMENT_PROVIDER === 'square' && enabled === 'true') {
    check('square.environment', ['SQUARE_ENVIRONMENT'], ['sandbox', 'production'].includes(env.SQUARE_ENVIRONMENT));
    for (const field of ['SQUARE_ACCESS_TOKEN', 'SQUARE_LOCATION_ID', 'SQUARE_MERCHANT_ID', 'SQUARE_WEBHOOK_SIGNATURE_KEY']) check('square.required.' + field, [field], !placeholder(env[field]) && !/\s/.test(env[field]) && env[field].length <= 2048);
    check('square.shop_binding', ['SQUARE_SHOP_ID'], /^[1-9]\d{0,18}$/.test(env.SQUARE_SHOP_ID ?? '') && BigInt(env.SQUARE_SHOP_ID) <= 9223372036854775807n);
    check('square.currency', ['SQUARE_CURRENCY'], /^[A-Z]{3}$/.test(env.SQUARE_CURRENCY ?? ''));
    const webhook = url(env.SQUARE_WEBHOOK_NOTIFICATION_URL);
    check('square.webhook_origin_and_path', ['SQUARE_WEBHOOK_NOTIFICATION_URL', 'PUBLIC_ORIGIN'], cleanUrl(env.SQUARE_WEBHOOK_NOTIFICATION_URL, { local }) && webhook?.origin === origin?.origin && webhook?.pathname === '/api/v1/payments/square/webhook');
    check('square.redirect_origin', ['SQUARE_CHECKOUT_REDIRECT_URL', 'PUBLIC_ORIGIN'], cleanUrl(env.SQUARE_CHECKOUT_REDIRECT_URL, { local }) && url(env.SQUARE_CHECKOUT_REDIRECT_URL)?.origin === origin?.origin);
    check('square.refund_policy', ['REFUND_POLICY_FULL_HOURS', 'REFUND_POLICY_PARTIAL_PERCENT'], integer(env.REFUND_POLICY_FULL_HOURS, 0, 8760) && integer(env.REFUND_POLICY_PARTIAL_PERCENT, 0, 100));
  }
  const storageFields = ['S3_BUCKET', 'S3_PUBLIC_URL', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const storageDriver = env.MEDIA_STORAGE_DRIVER ?? 'disabled';
  check('storage.explicit_supported_driver', ['MEDIA_STORAGE_DRIVER'], ['disabled', 'local', 's3'].includes(storageDriver));
  if (storageDriver === 's3' || storageFields.some(field => env[field]) || env.S3_ENDPOINT) {
    for (const field of storageFields) check('storage.required.' + field, [field], !placeholder(env[field]));
    check('storage.public_url', ['S3_PUBLIC_URL'], cleanUrl(env.S3_PUBLIC_URL, { local }));
    if (env.S3_ENDPOINT) check('storage.endpoint', ['S3_ENDPOINT'], cleanUrl(env.S3_ENDPOINT, { local }));
  }
  const configurationValid = checks.every(item => item.status === 'pass');
  return {
    schemaVersion: 1, checkedAt: new Date().toISOString(), mode: local ? 'local' : 'production',
    status: configurationValid ? 'pass_for_literal_configuration_only' : 'blocked', configurationValid,
    deploymentReady: false, checks,
    counts: { pass: checks.filter(c => c.status === 'pass').length, fail: checks.filter(c => c.status === 'fail').length },
    orderEmail: { enabled: orderEmail === 'true', workerEnabled: worker === 'true', domainVerified: false, realDeliveryVerified: false },
    unverified: ['DNS and TLS', 'Image identity and migrations', 'Account ownership and provider credentials', 'Credential vault key continuity and existing-envelope decryption', 'Real payment/refund/webhook', 'Order email sender-domain verification and real delivery', 'Backups and restore', 'Production business acceptance'],
    scope: 'Offline literal env checks only. No Docker, database, network or provider call. Values and secrets are omitted. A pass does not authorize or establish production readiness.',
  };
}

export function main(args) {
  const options = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--env-file', '--report', '--local'].includes(key) || Object.hasOwn(options, key)) throw new Error('INVALID_ARGUMENTS');
    if (key === '--local') options[key] = true;
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('INVALID_ARGUMENTS'); options[key] = args[++i]; }
  }
  if (!options['--env-file']) throw new Error('ENV_FILE_ARGUMENT_REQUIRED');
  let input;
  try {
    const info = statSync(options['--env-file']);
    if (!info.isFile() || info.size > 65536) throw new Error('ENV_FILE_TOO_LARGE');
    input = readFileSync(options['--env-file'], 'utf8');
  } catch (error) { throw new Error(error.message === 'ENV_FILE_TOO_LARGE' ? error.message : 'ENV_FILE_UNREADABLE'); }
  const report = validateReleaseEnvironment(parseEnvironment(input), { local: !!options['--local'] });
  if (options['--report']) {
    if (resolve(options['--report']) === resolve(options['--env-file'])) throw new Error('REPORT_MUST_NOT_REPLACE_INPUT');
    try { writeFileSync(options['--report'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); } catch { throw new Error('REPORT_NOT_WRITTEN'); }
  }
  console.log(JSON.stringify(report, null, 2));
  return report.configurationValid ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) {
    const code = /^[A-Z_]+(?:_\d+)?$/.test(error.message) ? error.message : 'ENV_CHECK_FAILED';
    console.error(JSON.stringify({ status: 'error', code })); process.exitCode = 1;
  }
}

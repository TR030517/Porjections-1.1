/** Real HTTP checks for a root-created, disposable phase5 deployment. No database access. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const MARKER = 'PHASE5_SYNTHETIC_ONLY';
const ROLES = { admin: 'ADMIN', merchant: 'MERCHANT', customer: 'CUSTOMER', outsider: 'MERCHANT', staff: 'STAFF' };
export class CheckFailure extends Error {
  constructor(code, httpStatus) { super(code); this.code = code; this.httpStatus = httpStatus; }
}
function requireCondition(value, code) { if (!value) throw new CheckFailure(code); }
export function disposableOrigin(value) {
  let url; try { url = new URL(value); } catch { throw new CheckFailure('TARGET_REJECTED'); }
  requireCondition(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port
    && !['8088', '3000', '3001', '8002', '3310', '3306'].includes(url.port)
    && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'TARGET_REJECTED');
  return url.origin;
}
export function validateSecrets(data, target) {
  requireCondition(data && data.schemaVersion === 1 && data.environmentMarker === MARKER
    && disposableOrigin(data.target) === disposableOrigin(target)
    && /^[0-9a-f-]{36}$/i.test(data.runId || ''), 'SYNTHETIC_FIXTURE_REQUIRED');
  for (const role of Object.keys(ROLES)) requireCondition(typeof data[role]?.email === 'string'
    && /^p5-[a-z]+-[0-9a-f]{8}@example\.invalid$/.test(data[role].email)
    && typeof data[role].password === 'string' && data[role].password.length >= 12, 'SYNTHETIC_ACCOUNT_REQUIRED');
  const f = data.fixture;
  requireCondition(data.attemptKey === undefined || /^[A-Za-z0-9_][A-Za-z0-9_-]{0,15}$/.test(data.attemptKey), 'INVALID_ATTEMPT_KEY');
  for (const key of ['shopId', 'serviceId', 'secondServiceId', 'variantId', 'giftProductId', 'couponWalletId', 'pastBookingId', 'customerId'])
    requireCondition(/^[1-9]\d*$/.test(f?.[key] || ''), 'FIXTURE_ID_REQUIRED');
  requireCondition(Array.isArray(f.therapistIds) && f.therapistIds.length === 2 && new Set(f.therapistIds).size === 2
    && f.therapistIds.every(id => /^[1-9]\d*$/.test(id)) && /^\d{4}-\d{2}-\d{2}$/.test(f.date)
    && f.unitPriceCents === 3500 && f.secondPriceCents === 2000 && f.giftPriceCents === 4000, 'FIXTURE_CONTRACT_MISMATCH');
  return data;
}
export function syntheticPng() {
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (name, data) => { const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data]))); return Buffer.concat([length, type, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 6;
  const pixels = Buffer.alloc(4 * (1 + 4 * 4)); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) pixels.set([72, 161, 161, 255], y * 17 + 1 + x * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
function expected(result, code) { if (result.response.status !== code) throw new CheckFailure('UNEXPECTED_HTTP_STATUS', result.response.status); }
function denied(result, codes = [403, 404]) { requireCondition(codes.includes(result.response.status), 'EXPECTED_PERMISSION_DENIAL'); }
function json(result, code = 200) {
  expected(result, code); requireCondition(/application\/json/i.test(result.response.headers.get('content-type') || ''), 'EXPECTED_JSON');
  try { return JSON.parse(result.bytes.toString('utf8')); } catch { throw new CheckFailure('INVALID_JSON'); }
}
function page(data) { requireCondition(Array.isArray(data?.items) && Number.isInteger(data.total) && data.total >= data.items.length && data.page >= 1 && data.pageSize >= 1, 'INVALID_SERVER_PAGE'); return data; }
function cookie(result) {
  const values = result.response.headers.getSetCookie?.() || [result.response.headers.get('set-cookie') || ''];
  const matches = values.filter(value => value.startsWith('massajoy_refresh='));
  requireCondition(matches.length === 1 && /;\s*HttpOnly(?:;|$)/i.test(matches[0])
    && /;\s*SameSite=Strict(?:;|$)/i.test(matches[0]) && /;\s*Path=\/api\/v1\/auth(?:;|$)/i.test(matches[0]), 'UNSAFE_REFRESH_COOKIE');
  return matches[0].split(';', 1)[0];
}
function safeTask(task) { return task && !['payload', 'data', 'phone', 'email', 'token', 'user', 'recipient', 'userId', 'user_id'].some(key => Object.hasOwn(task, key)); }

export async function runPhase5Http({ target, secrets, reportFile, acknowledge, intervalMs = 1000, attemptKey = secrets?.attemptKey }) {
  requireCondition(acknowledge === MARKER, 'DISPOSABLE_TARGET_ACK_REQUIRED');
  target = disposableOrigin(target); validateSecrets(secrets, target);
  requireCondition(attemptKey === undefined || /^[A-Za-z0-9_][A-Za-z0-9_-]{0,15}$/.test(attemptKey) && secrets.attemptKey === attemptKey, 'ATTEMPT_SECRET_MISMATCH');
  requireCondition(Number.isInteger(intervalMs) && intervalMs >= 650 && intervalMs <= 3000, 'INVALID_REQUEST_INTERVAL');
  const report = { schemaVersion: 1, environmentMarker: MARKER, target, attemptKey: attemptKey ?? 'first', startedAt: new Date().toISOString(), status: 'running',
    verification: 'REAL_HTTP_AGAINST_DISPOSABLE_DEPLOYMENT', checks: [],
    boundaries: ['Synthetic data only; no production or existing preview access.', 'No browser interaction; this runner verifies HTTP contracts.',
      'No real online payment, bank transfer, SMS, FCM or S3 requests; offline entries record synthetic already-completed physical events.',
      'Future creation and past-service completion use separate fixtures; no clock bypass or premature fulfillment.',
      'Notification processing uses the separately started, bounded real durable worker in the disposable API container.',
      'Does not replace comprehensive concurrency, provider, migration, backup, browser or accessibility testing.'] };
  let lastRequest = 0, requestCount = 0;
  const sessions = {}, f = secrets.fixture, prefix = 'p5-' + secrets.runId.slice(0, 8) + (attemptKey ? '-' + attemptKey : ''), key = name => `${prefix}-${name}`;
  async function request(route, { method = 'GET', body, account, cookie: rawCookie, browser = false, form } = {}) {
    requireCondition(typeof route === 'string' && route.startsWith('/api/v1/') && !route.includes('\\'), 'API_PATH_REJECTED');
    const url = new URL(route, target); requireCondition(url.origin === target && !url.hash && !url.username && !url.password, 'API_PATH_REJECTED');
    const wait = intervalMs - (Date.now() - lastRequest); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequest = Date.now(); requestCount++;
    const token = account ? sessions[account]?.token : undefined;
    if (account) requireCondition(token, 'SESSION_NOT_AVAILABLE');
    let response; try { response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(rawCookie ? { Cookie: rawCookie } : {}), ...(browser ? { Origin: target, 'Sec-Fetch-Site': 'same-origin' } : {}) },
      body: form || (body === undefined ? undefined : JSON.stringify(body)) }); } catch { throw new CheckFailure('HTTP_UNREACHABLE_OR_TIMED_OUT'); }
    const bytes = Buffer.from(await response.arrayBuffer()); requireCondition(bytes.length <= 2_000_000, 'RESPONSE_TOO_LARGE');
    return { response, bytes };
  }
  const api = async (route, options, code = 200) => json(await request('/api/v1' + route, options), code);
  const get = (route, account) => api(route, { account });
  const post = (route, account, body = {}) => api(route, { method: 'POST', account, body }, 201);
  const patch = (route, account, body = {}) => api(route, { method: 'PATCH', account, body });
  async function check(id, action, dependency = true) {
    if (!dependency) { report.checks.push({ id, status: 'blocked', code: 'DEPENDENCY_NOT_PASSED' }); return false; }
    try { const evidence = await action(); report.checks.push({ id, status: 'pass', ...(evidence ? { evidence } : {}) }); return true; }
    catch (error) { report.checks.push({ id, status: 'fail', code: error instanceof CheckFailure ? error.code : 'CHECK_FAILED',
      ...(error instanceof CheckFailure && Number.isInteger(error.httpStatus) ? { httpStatus: error.httpStatus } : {}) }); return false; }
  }
  let booking, plan, zero, gift, gift2, media, gallery, avatar, announced;
  const health = await check('deployment.health_and_online_payment_disabled', async () => {
    const h = await get('/health'); requireCondition(h.status === 'ok' || h.status === 'healthy', 'HEALTH_NOT_READY');
    requireCondition((await get('/payments/config')).enabled === false, 'EXTERNAL_PAYMENT_MUST_BE_DISABLED');
  });
  const auth = await check('authentication.five_synthetic_roles_and_http_only_refresh', async () => {
    for (const [name, role] of Object.entries(ROLES)) {
      const result = await request('/api/v1/auth/password/login', { method: 'POST', body: secrets[name], browser: true });
      const data = json(result); requireCondition(data.user?.role === role && typeof data.accessToken === 'string' && !Object.hasOwn(data, 'refreshToken'), 'LOGIN_CONTRACT_MISMATCH');
      sessions[name] = { token: data.accessToken, cookie: cookie(result), id: data.user.id };
    }
    const refreshed = await request('/api/v1/auth/refresh', { method: 'POST', body: {}, cookie: sessions.customer.cookie, browser: true });
    const data = json(refreshed); requireCondition(data.user?.role === 'CUSTOMER' && data.user.id === sessions.customer.id && typeof data.accessToken === 'string', 'REFRESH_OWNER_MISMATCH');
    sessions.customer = { token: data.accessToken, cookie: cookie(refreshed), id: data.user.id };
  }, health);
  const policy = await check('reservation.real_owner_configuration_and_cross_shop_denial', async () => {
    const base = `/reservation-admin/shops/${f.shopId}`;
    const initial = await get(base + '/config', 'merchant'); requireCondition(initial.paymentPolicy?.payAtStoreEnabled === false
      || !!attemptKey && initial.paymentPolicy?.payAtStoreEnabled === true, 'FIXTURE_POLICY_NOT_DISABLED');
    await patch(base + '/payment-policy', 'merchant', { payAtStoreEnabled: true });
    requireCondition((await get(base + '/config', 'merchant')).paymentPolicy?.payAtStoreEnabled === true, 'PAYMENT_POLICY_NOT_PERSISTED');
    denied(await request('/api/v1' + base + '/config', { account: 'outsider' }));
    denied(await request('/api/v1' + base + '/payment-policy', { method: 'PATCH', account: 'customer', body: { payAtStoreEnabled: true } }));
    const config = await get('/upload/config', 'merchant'); requireCondition(config.enabled === true && config.driver === 'local', 'REAL_LOCAL_MEDIA_REQUIRED');
  }, auth);
  const created = await check('booking.fixed_variant_tip_create_and_request_key_replay', async () => {
    const query = new URLSearchParams({ shopId: f.shopId, serviceId: f.serviceId, variantId: f.variantId, therapistId: f.therapistIds[0], date: f.date });
    const slots = await get('/bookings/slots?' + query, 'customer');
    requireCondition(slots.priceCents === 3500 && slots.durationMin === 30 && slots.slots.some(s => s.time === '10:00' && s.available), 'FIXED_SKU_SLOT_MISMATCH');
    const body = { shopId: f.shopId, serviceId: f.serviceId, variantId: f.variantId, therapistId: f.therapistIds[0], date: f.date,
      startTime: '10:00', paymentMode: 'PAY_AT_STORE', tipCents: 123, requestKey: key('booking') };
    booking = await post('/bookings', 'customer', body);
    requireCondition(booking.status === 'PENDING' && booking.paymentStatus === 'UNPAID' && booking.totalCents === 3623 && booking.tipCents === 123 && booking.items?.length === 1, 'NEW_BOOKING_SNAPSHOT_MISMATCH');
    requireCondition((await post('/bookings', 'customer', body)).id === booking.id, 'BOOKING_REPLAY_CREATED_DUPLICATE');
    expected(await request('/api/v1/bookings', { method: 'POST', account: 'customer', body: { ...body, tipCents: 124 } }), 409);
  }, policy);
  const confirmed = await check('booking.confirm_and_read_only_staff_permissions', async () => {
    const b = await patch(`/bookings/${booking.id}/status?status=CONFIRMED`, 'merchant');
    requireCondition(b.status === 'CONFIRMED' && b.paymentStatus === 'UNPAID', 'PAY_AT_STORE_CONFIRM_MISMATCH');
    requireCondition((await get(`/bookings/${booking.id}`, 'staff')).id === booking.id, 'GRANTED_STAFF_CANNOT_READ');
    denied(await request(`/api/v1/bookings/${booking.id}/status?status=COMPLETED`, { method: 'PATCH', account: 'staff', body: {} }));
    denied(await request(`/api/v1/bookings/${booking.id}`, { account: 'outsider' }));
    const body = { requestKey: key('unauthorized'), amountCents: 3623, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic unauthorized record attempt' };
    denied(await request(`/api/v1/bookings/${booking.id}/offline-receipts`, { method: 'POST', account: 'customer', body }));
    denied(await request(`/api/v1/bookings/${booking.id}/offline-receipts`, { method: 'POST', account: 'outsider', body }));
  }, created);
  await check('booking.offline_receipt_replay_conflict_and_no_premature_completion', async () => {
    const route = `/bookings/${booking.id}/offline-receipts`, body = { requestKey: key('receipt'), amountCents: 3623, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic cash already collected; no bank transfer' };
    let summary = await post(route, 'merchant', body);
    requireCondition(summary.paidCents === 3623 && summary.amountDueCents === 0 && summary.paymentStatus === 'PAID', 'OFFLINE_RECEIPT_NOT_SETTLED');
    summary = await post(route, 'merchant', body); requireCondition(summary.entries.filter(e => e.kind === 'RECEIPT').length === 1, 'RECEIPT_REPLAY_DUPLICATED');
    expected(await request('/api/v1' + route, { method: 'POST', account: 'merchant', body: { ...body, amountCents: 3622 } }), 409);
    denied(await request(`/api/v1/bookings/${booking.id}/status?status=COMPLETED`, { method: 'PATCH', account: 'merchant', body: {} }), [400, 409]);
    denied(await request('/api/v1/payments/create-intent', { method: 'POST', account: 'customer', body: { bookingId: booking.id } }), [400, 503]);
  }, confirmed);
  await check('booking.past_fixture_fulfillment_and_full_physical_refund_record', async () => {
    const route = `/bookings/${f.pastBookingId}`, body = { requestKey: key('past-receipt'), amountCents: 3500, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic already collected past service cash' };
    await post(route + '/offline-receipts', 'merchant', body);
    const complete = await patch(route + '/status?status=COMPLETED', 'merchant'); requireCondition(complete.status === 'COMPLETED', 'PAST_SERVICE_NOT_COMPLETED');
    const refund = { ...body, requestKey: key('past-refund'), reason: 'Synthetic cash already returned; this is not a transfer' };
    let summary = await post(route + '/offline-refunds', 'merchant', refund);
    requireCondition(summary.status === 'COMPLETED' && summary.paymentStatus === 'REFUNDED' && summary.netPaidCents === 0 && summary.amountDueCents === 0, 'REFUND_CHANGED_FULFILLMENT_OR_AMOUNT_DUE');
    summary = await post(route + '/offline-refunds', 'merchant', refund); requireCondition(summary.entries.filter(e => e.kind === 'REFUND').length === 1, 'REFUND_REPLAY_DUPLICATED');
  }, policy);
  await check('booking.zero_coupon_auto_confirmation_and_zero_evidence', async () => {
    const body = { shopId: f.shopId, serviceId: f.serviceId, variantId: f.variantId, date: f.date, startTime: '12:00',
      paymentMode: 'ONLINE', couponId: f.couponWalletId, requestKey: key('zero') };
    zero = await post('/bookings', 'customer', body);
    requireCondition(zero.paymentMode === 'ZERO' && zero.totalCents === 0 && zero.paidCents === 0 && zero.status === 'CONFIRMED' && zero.paymentStatus === 'PAID', 'ZERO_NOT_AUTO_CONFIRMED');
    requireCondition((await post('/bookings', 'customer', body)).id === zero.id, 'ZERO_REPLAY_DUPLICATED');
    const summary = await get(`/bookings/${zero.id}/settlements`, 'merchant'); requireCondition(summary.entries.filter(e => e.kind === 'ZERO').length === 1, 'ZERO_EVIDENCE_MISSING');
    requireCondition((await post(`/bookings/${zero.id}/cancel`, 'customer')).status === 'CANCELLED', 'ZERO_CANCEL_FAILED');
  }, policy);
  const planReady = await check('plan.multiple_participants_sequenced_segments_and_fixed_snapshot_prices', async () => {
    const body = { shopId: f.shopId, date: f.date, items: [
      { participantIndex: 1, sequence: 1, serviceId: f.serviceId, variantId: f.variantId },
      { participantIndex: 1, sequence: 2, serviceId: f.secondServiceId }, { participantIndex: 2, sequence: 1, serviceId: f.secondServiceId }] };
    const preview = await post('/bookings/plan-slots', 'customer', body);
    requireCondition(preview.priceCents === 7500 && preview.participantCount === 2 && preview.durationMin === 65
      && preview.items?.length === 3 && preview.slots.some(s => s.time === '14:00' && s.available), 'PLAN_PREVIEW_MISMATCH');
    const create = { ...body, startTime: '14:00', paymentMode: 'PAY_AT_STORE', tipCents: 500, requestKey: key('plan') };
    plan = await post('/bookings/plan', 'customer', create);
    requireCondition(plan.totalCents === 8000 && plan.tipCents === 500 && plan.items?.length === 3
      && plan.items.reduce((sum, item) => sum + item.priceCentsSnapshot, 0) === 7500, 'PLAN_SEGMENT_SNAPSHOT_MISMATCH');
    requireCondition((await post('/bookings/plan', 'customer', create)).id === plan.id, 'PLAN_REPLAY_DUPLICATED');
  }, policy);
  await check('plan.snapshot_reschedule_cancel_release_and_true_server_pages', async () => {
    const listed = page(await get('/bookings?' + new URLSearchParams({ page: '1', pageSize: '1', search: 'Synthetic second segment' }), 'customer'));
    requireCondition(listed.items.length === 1 && listed.items[0].id === plan.id, 'SECOND_SEGMENT_SEARCH_MISSING');
    const merchantPage = page(await get(`/merchant/shops/${f.shopId}/bookings?page=1&pageSize=1`, 'merchant')); requireCondition(merchantPage.items.length === 1, 'MERCHANT_PAGE_MISMATCH');
    const slots = await get(`/bookings/${plan.id}/reschedule-slots?date=${f.date}`, 'customer'); requireCondition(slots.priceCents === 7500 && slots.slots.some(s => s.time === '15:00' && s.available), 'SNAPSHOT_RESCHEDULE_SLOTS_MISMATCH');
    const moved = await post(`/bookings/${plan.id}/reschedule`, 'customer', { date: f.date, startTime: '15:00' });
    requireCondition(moved.id === plan.id && moved.totalCents === 8000 && moved.items.length === 3, 'RESCHEDULE_REQUOTED_OR_LOST_ITEMS');
    requireCondition((await post(`/bookings/${plan.id}/cancel`, 'customer')).status === 'CANCELLED', 'PLAN_CANCEL_FAILED');
    const released = await post('/bookings/plan-slots', 'customer', { shopId: f.shopId, date: f.date, items: [
      { participantIndex: 1, sequence: 1, serviceId: f.serviceId, variantId: f.variantId },
      { participantIndex: 1, sequence: 2, serviceId: f.secondServiceId }, { participantIndex: 2, sequence: 1, serviceId: f.secondServiceId }] });
    requireCondition(released.slots.some(s => s.time === '15:00' && s.available), 'CANCELLED_PLAN_STILL_BLOCKS_RESOURCES');
  }, planReady);
  const giftReady = await check('gift.pay_at_store_policy_order_receipt_and_single_entitlement', async () => {
    const base = `/gift-cards/admin/shops/${f.shopId}`;
    await post(base + '/sales-policy', 'merchant', { payAtStoreEnabled: true });
    const config = await get('/gift-cards/config'); requireCondition(config.onlinePaymentEnabled === false, 'GIFT_ONLINE_PAYMENT_MUST_BE_DISABLED');
    gift = (await post('/gift-cards/orders', 'customer', { productId: f.giftProductId, paymentMethod: 'PAY_AT_STORE', requestKey: key('gift') })).item;
    requireCondition(gift.status === 'PENDING' && gift.paidCents === 0, 'GIFT_GRANTED_BEFORE_RECEIPT');
    const checkout = await post(`/gift-cards/orders/${gift.id}/checkout`, 'customer');
    requireCondition(checkout.onlinePaymentEnabled === false && checkout.paymentRequiredAtStore === true
      && checkout.item.status === 'PENDING' && !checkout.item.entitlementId && !checkout.checkoutUrl, 'GIFT_CHECKOUT_MUST_REQUIRE_PHYSICAL_PAYMENT');
    const receipt = { amountCents: 4000, method: 'CASH', reason: 'Synthetic gift cash already collected', requestKey: key('gift-receipt') };
    denied(await request('/api/v1' + base + `/orders/${gift.id}/receipts`, { method: 'POST', account: 'outsider', body: receipt }));
    gift = (await post(base + `/orders/${gift.id}/receipts`, 'merchant', receipt)).item;
    requireCondition(gift.status === 'PAID' && gift.paidCents === 4000 && gift.entitlementId, 'GIFT_RECEIPT_DID_NOT_GRANT');
    const replay = await post(base + `/orders/${gift.id}/receipts`, 'merchant', receipt);
    requireCondition(replay.replayed === true && replay.item.entitlementId === gift.entitlementId && replay.item.receipts.length === 1, 'GIFT_RECEIPT_REPLAY_DUPLICATED');
  }, policy);
  await check('gift.customer_exact_use_credential_redemption_replay_and_used_refund_denial', async () => {
    const entitlement = (await get(`/gift-cards/entitlements/${gift.entitlementId}`, 'customer')).item;
    requireCondition(entitlement.source === 'PURCHASE' && entitlement.totalUses === 3 && entitlement.remainingUses === 3, 'PURCHASED_RIGHTS_MISMATCH');
    const credential = await post(`/gift-cards/entitlements/${gift.entitlementId}/credential`, 'customer', { usedUses: 1 });
    requireCondition(typeof credential.token === 'string' && credential.token.startsWith('gc1_'), 'EXACT_USE_CREDENTIAL_MISSING');
    const base = `/gift-cards/admin/shops/${f.shopId}`, body = { token: credential.token, usedUses: 1, requestKey: key('redeem') };
    const redeemed = await post(base + '/redeem', 'merchant', body); requireCondition(redeemed.remainingUses === 2 && redeemed.replayed === false, 'REDEMPTION_NOT_DEDUCTED');
    requireCondition((await post(base + '/redeem', 'merchant', body)).replayed === true, 'REDEMPTION_REPLAY_NOT_RECOGNIZED');
    expected(await request('/api/v1' + base + `/orders/${gift.id}/refunds`, { method: 'POST', account: 'merchant', body: { amountCents: 4000, method: 'CASH', reason: 'Synthetic already returned gift cash', requestKey: key('gift-used-refund') } }), 409);
  }, giftReady);
  await check('gift.unused_full_physical_refund_voids_rights_and_replays', async () => {
    const base = `/gift-cards/admin/shops/${f.shopId}`;
    gift2 = (await post('/gift-cards/orders', 'customer', { productId: f.giftProductId, paymentMethod: 'PAY_AT_STORE', requestKey: key('gift-unused') })).item;
    const receipt = { amountCents: 4000, method: 'CASH', reason: 'Synthetic second gift cash already collected', requestKey: key('gift-unused-receipt') };
    gift2 = (await post(base + `/orders/${gift2.id}/receipts`, 'merchant', receipt)).item;
    const body = { ...receipt, reason: 'Synthetic unused gift cash already returned', requestKey: key('gift-unused-refund') };
    let refunded = await post(base + `/orders/${gift2.id}/refunds`, 'merchant', body);
    requireCondition(refunded.item.status === 'REFUNDED' && refunded.item.refundedCents === 4000, 'UNUSED_GIFT_NOT_REFUNDED');
    refunded = await post(base + `/orders/${gift2.id}/refunds`, 'merchant', body); requireCondition(refunded.replayed === true && refunded.item.refunds.length === 1, 'GIFT_REFUND_DUPLICATED');
    requireCondition((await get(`/gift-cards/entitlements/${gift2.entitlementId}`, 'customer')).item.status === 'VOIDED', 'REFUNDED_RIGHTS_STILL_ACTIVE');
  }, giftReady);
  async function upload(account, purpose, name, mime = 'image/png', bytes = syntheticPng()) {
    const form = new FormData(); form.set('scope', purpose === 'avatar' ? 'AVATAR' : 'SHOP');
    if (purpose !== 'avatar') form.set('shopId', f.shopId); form.set('purpose', purpose); form.set('requestKey', key(name));
    form.set('file', new Blob([bytes], { type: mime }), 'synthetic.exe');
    return request('/api/v1/upload/media', { method: 'POST', account, form });
  }
  const uploaded = await check('media.real_multipart_authorization_decode_reencode_and_replay', async () => {
    denied(await upload('customer', 'logo', 'unauthorized-media'));
    expected(await upload('merchant', 'logo', 'svg-media', 'image/svg+xml', Buffer.from('<svg/>')), 400);
    const result = json(await upload('merchant', 'logo', 'logo'), 201); media = result.item;
    requireCondition(media.status === 'STAGED' && media.mimeType === 'image/webp' && /^\/api\/v1\/upload\/media\/[a-f0-9-]{36}\/file$/.test(media.fileUrl), 'MANAGED_MEDIA_NOT_STAGED');
    const replay = json(await upload('merchant', 'logo', 'logo'), 201); requireCondition(replay.replayed === true && replay.item.id === media.id, 'MULTIPART_REPLAY_DUPLICATED');
    const image = await request(media.fileUrl); expected(image, 200);
    requireCondition(image.response.headers.get('content-type')?.startsWith('image/webp') && image.response.headers.get('x-content-type-options') === 'nosniff'
      && image.bytes.subarray(0, 4).toString() === 'RIFF' && image.bytes.subarray(8, 12).toString() === 'WEBP', 'FILE_NOT_REENCODED_WEBP');
    requireCondition((await post(`/upload/media/${media.id}/confirm`, 'merchant')).item.status === 'STAGED', 'CONFIRM_BOUND_WITHOUT_SAVE');
  }, policy);
  await check('media.actual_studio_save_merchant_save_and_bound_delete_protection', async () => {
    // A staged object may only be committed by its uploader; this exercises the real owner Studio route.
    await patch(`/studio/stores/${f.shopId}`, 'merchant', { logoUrl: media.fileUrl });
    expected(await request(`/api/v1/upload/media/${media.id}`, { method: 'DELETE', account: 'merchant' }), 409);
    gallery = json(await upload('merchant', 'gallery', 'gallery'), 201).item;
    await patch(`/merchant/shops/${f.shopId}`, 'merchant', { gallery: [gallery.fileUrl] });
    const shops = await get('/merchant/shops', 'merchant'), own = (Array.isArray(shops) ? shops : shops.items).find(s => s.id === f.shopId);
    requireCondition(own?.media?.logoUrl === media.fileUrl && own.media.galleryUrls[0] === gallery.fileUrl, 'SAVED_MEDIA_PROJECTION_MISMATCH');
    const abandoned = json(await upload('merchant', 'gallery', 'abandon'), 201).item;
    expected(await request(`/api/v1/upload/media/${abandoned.id}`, { method: 'DELETE', account: 'merchant' }), 200);
    expected(await request(abandoned.fileUrl), 404);
  }, uploaded);
  await check('media.avatar_commit_and_profile_bypass_denial', async () => {
    avatar = json(await upload('customer', 'avatar', 'avatar'), 201).item;
    await post(`/upload/media/${avatar.id}/commit-avatar`, 'customer');
    requireCondition((await get(`/users/${sessions.customer.id}`, 'customer')).avatarUrl === avatar.fileUrl, 'AVATAR_NOT_COMMITTED');
    expected(await request(`/api/v1/users/${sessions.customer.id}`, { method: 'PATCH', account: 'customer', body: { avatarUrl: media.fileUrl } }), 400);
  }, uploaded);
  await check('content.admin_publication_role_scope_banner_and_support_clear', async () => {
    const body = { title: 'Synthetic phase5 announcement ' + (attemptKey ?? 'first'), body: 'Synthetic authenticated customer content', scope: 'USERS', startAt: new Date(Date.now() - 60000).toISOString(), isPublished: true };
    announced = (await post('/studio/content', 'admin', body)).item;
    const list = await get('/announcements', 'customer'); requireCondition(Array.isArray(list) && list.some(item => item.id === announced.id), 'PUBLISHED_CUSTOMER_ANNOUNCEMENT_MISSING');
    expected(await request('/api/v1/announcements'), 401);
    denied(await request('/api/v1/studio/content', { method: 'POST', account: 'merchant', body }), [403]);
    const banner = (await post('/studio/banners', 'admin', { title: 'Synthetic phase5 banner ' + (attemptKey ?? 'first'), imageUrl: 'https://images.example.invalid/synthetic.png', targetType: 'NONE', startAt: new Date(Date.now() - 60000).toISOString(), isActive: true })).item;
    const banners = await get('/banners'); requireCondition(Array.isArray(banners) && banners.some(item => item.id === banner.id), 'ACTIVE_BANNER_MISSING');
    const support = await get('/public/support'); requireCondition(support.email === 'help@example.invalid' && Object.keys(support).every(key => ['siteName', 'email', 'phone'].includes(key)), 'PUBLIC_SUPPORT_CONTRACT_MISMATCH');
    const settings = page(await get('/studio/settings?page=1&pageSize=100', 'admin')), email = settings.items.find(item => item.key === 'support_email'); requireCondition(email, 'PUBLIC_SUPPORT_SETTING_MISSING');
    await patch(`/studio/settings/${email.id}`, 'admin', { value: '' }); requireCondition((await get('/public/support')).email === null, 'CONTACT_CLEAR_NOT_REFLECTED');
    await patch(`/studio/settings/${email.id}`, 'admin', { value: 'help@example.invalid' });
  }, auth);
  await check('notifications.real_durable_worker_inbox_owner_isolation_and_disabled_external_tasks', async () => {
    let inbox;
    for (let attempt = 0; attempt < 25; attempt++) {
      inbox = page(await get('/notifications/inbox?page=1&pageSize=100', 'customer'));
      if (['BOOKING_CREATED', 'GIFT_PURCHASED', 'PAYMENT_RECEIVED'].every(topic => inbox.items.some(item => item.topic === topic))) break;
      if (attempt < 24) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    requireCondition(['BOOKING_CREATED', 'GIFT_PURCHASED', 'PAYMENT_RECEIVED'].every(topic => inbox.items.some(item => item.topic === topic)), 'DURABLE_WORKER_REQUIRED_TOPICS_NOT_PUBLISHED');
    const first = inbox.items[0]; expected(await request(`/api/v1/notifications/inbox/${first.id}/read`, { method: 'POST', account: 'merchant', body: {} }), 404);
    await post(`/notifications/inbox/${first.id}/read`, 'customer');
    requireCondition((await get('/notifications/inbox?page=1&pageSize=100', 'customer')).items.find(item => item.id === first.id)?.readAt, 'NOTIFICATION_READ_NOT_PERSISTED');
    await post('/notifications/inbox/read-all', 'customer'); requireCondition((await get('/notifications/inbox?page=1&pageSize=100&unreadOnly=true', 'customer')).unreadCount === 0, 'READ_ALL_NOT_APPLIED');
    const tasks = page(await get('/notifications/admin/tasks?page=1&pageSize=100&status=SKIPPED&channel=SMS', 'admin'));
    requireCondition(tasks.total > 0 && tasks.items.every(safeTask) && tasks.items.every(task => task.status === 'SKIPPED'), 'EXTERNAL_DISABLED_TASKS_NOT_SAFE_SKIPPED');
    denied(await request('/api/v1/notifications/admin/tasks?page=1&pageSize=25', { account: 'merchant' }), [403]);
    return { publishedRequiredTopics: 3, externalSmsState: 'SKIPPED' };
  }, auth && created && giftReady);
  report.finishedAt = new Date().toISOString(); report.requestCount = requestCount;
  report.summary = { pass: report.checks.filter(c => c.status === 'pass').length, fail: report.checks.filter(c => c.status === 'fail').length, blocked: report.checks.filter(c => c.status === 'blocked').length, total: report.checks.length };
  report.status = report.summary.fail || report.summary.blocked ? 'fail_or_incomplete' : 'pass_for_synthetic_http_scope';
  if (reportFile) { await mkdir(dirname(resolve(reportFile)), { recursive: true }); await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
  return report;
}

async function cli() {
  const args = process.argv.slice(2), parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--acknowledge-disposable-target') parsed.acknowledge = MARKER;
    else if (['--target', '--secrets-file', '--report', '--interval-ms', '--attempt-key'].includes(args[i]) && args[i + 1]) parsed[args[i].slice(2)] = args[++i];
    else throw new CheckFailure('UNKNOWN_OR_INCOMPLETE_ARGUMENT');
  }
  requireCondition(parsed.target && parsed['secrets-file'] && parsed.report && parsed.acknowledge, 'REQUIRED_ARGUMENT_MISSING');
  disposableOrigin(parsed.target); // Reject existing preview before reading any secret file.
  const secrets = JSON.parse(await readFile(resolve(parsed['secrets-file']), 'utf8'));
  const report = await runPhase5Http({ target: parsed.target, secrets, reportFile: parsed.report, acknowledge: parsed.acknowledge,
    intervalMs: parsed['interval-ms'] === undefined ? 1000 : Number(parsed['interval-ms']), attemptKey: parsed['attempt-key'] ?? secrets.attemptKey });
  for (const check of report.checks) console.log(JSON.stringify({ id: check.id, status: check.status, ...(check.code ? { code: check.code } : {}), ...(check.httpStatus ? { httpStatus: check.httpStatus } : {}) }));
  console.log(JSON.stringify({ status: report.status, ...report.summary, requestCount: report.requestCount }));
  if (report.status !== 'pass_for_synthetic_http_scope') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) cli().catch(error => {
  console.error(JSON.stringify({ status: 'blocked', code: error instanceof CheckFailure ? error.code : 'RUNNER_INITIALIZATION_FAILED' })); process.exitCode = 1;
});

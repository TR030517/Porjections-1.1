/** Real fetch/JWT/cookie acceptance against the NEW root-owned synthetic stack only. */
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disposableOrigin } from './phase5-http-integration.mjs';
const MARKER = 'THREE_END_SYNTHETIC_ONLY';
const ROLES = { admin: 'ADMIN', merchant: 'MERCHANT', linkedMerchant: 'MERCHANT', customer: 'CUSTOMER', otherCustomer: 'CUSTOMER', staff: 'STAFF' };
export class ThreeEndFailure extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
const need = (value, code) => { if (!value) throw new ThreeEndFailure(code); };
export function validateThreeEndSecrets(value, target) {
  need(value?.schemaVersion === 1 && value.environmentMarker === MARKER && disposableOrigin(value.target) === disposableOrigin(target) && /^[a-f0-9-]{36}$/.test(value.runId ?? ''), 'SYNTHETIC_TARGET_REQUIRED');
  for (const [key, role] of Object.entries(ROLES)) {
    const account = value[key]; need(account?.role === role && /^three-[a-z]+-[a-f0-9]{8}(?:@example\.invalid)?$/.test(account.identifier ?? '') && typeof account.password === 'string' && account.password.startsWith('Synthetic-') && account.password.length >= 20, 'SYNTHETIC_ACCOUNT_REQUIRED');
  }
  for (const key of ['shopId', 'otherShopId', 'serviceId', 'secondServiceId', 'variantId', 'variant60Id', 'productId', 'couponId', 'pastBookingId', 'customerId', 'otherCustomerId']) need(/^[1-9]\d*$/.test(value.fixture?.[key] ?? ''), 'FIXTURE_ID_REQUIRED');
  need(value.fixture.shopId !== value.fixture.otherShopId && /^three-end-[a-f0-9]{8}-a$/.test(value.fixture.shortName ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(value.fixture.date ?? ''), 'FIXTURE_CONTRACT_INVALID');
  return value;
}
function cookie(response) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''], found = values.filter(value => value.startsWith('massajoy_refresh='));
  need(found.length === 1 && /;\s*HttpOnly(?:;|$)/i.test(found[0]) && /;\s*SameSite=Strict(?:;|$)/i.test(found[0]) && /;\s*Path=\/api\/v1\/auth(?:;|$)/i.test(found[0]), 'REFRESH_COOKIE_NOT_SAFE');
  return found[0].split(';')[0];
}
function page(value) { need(Array.isArray(value?.items) && Number.isInteger(value.total) && value.total >= value.items.length && value.page >= 1, 'PAGE_CONTRACT_INVALID'); return value; }
const cleanProjection = (value, forbidden = ['passwordHash', 'refreshToken', 'accessToken', 'tokenHash', 'password', 'owner', 'ownerId', 'loginBinding']) => {
  if (Array.isArray(value)) return value.every(item => cleanProjection(item, forbidden));
  return !value || typeof value !== 'object' || Object.entries(value).every(([key, child]) => !forbidden.includes(key) && cleanProjection(child, forbidden));
};

export async function runThreeEndHttp({ target, secrets, reportFile, intervalMs = 750, acknowledge, attemptKey = 'first', dayOffset = 4, scope = 'all' }) {
  need(acknowledge === MARKER, 'EXPLICIT_DISPOSABLE_ACK_REQUIRED'); target = disposableOrigin(target); validateThreeEndSecrets(secrets, target);
  need(Number.isInteger(intervalMs) && intervalMs >= 650 && intervalMs <= 3000, 'INTERVAL_INVALID');
  need(['all', 'plan-recheck'].includes(scope), 'CHECK_SCOPE_INVALID');
  try { await lstat(reportFile); throw new ThreeEndFailure('REPORT_ALREADY_EXISTS'); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const report = { schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(), environmentMarker: MARKER, target, checks: [],
    verification: 'REAL_HTTP_REAL_JWT_ON_FRESH_SYNTHETIC_STACK', identityOverrides: false, externalProviderCalls: 0,
    boundaries: ['Only a new labelled root-owned disposable deployment, never the existing 8088 stack or production.',
      'Synthetic fixtures and real HTTP/cookie/session/role guards; not browser interaction.',
      'Future create/confirm/reschedule/receipt and actual-ended fixture completion are separate cases; no clock change or premature completion.',
      'Offline receipts/refunds attest synthetic already-completed physical events; they do not transfer money.',
      'Square/Stripe, email OTP, social identity, SMS and FCM remain disabled; no real provider integration claimed.',
      'Does not replace exhaustive provider, concurrency, native-device or accessibility testing.'] };
  need(/^[A-Za-z0-9_-]{1,12}$/.test(attemptKey) && Number.isInteger(dayOffset) && dayOffset >= 4 && dayOffset <= 20, 'ATTEMPT_SCOPE_INVALID');
  const f = secrets.fixture, flowDate = new Date(Date.parse(f.date + 'T12:00:00Z') + dayOffset * 86400000).toISOString().slice(0, 10), sessions = {}, prefix = 'three-' + secrets.runId.slice(0, 8) + '-' + attemptKey, key = suffix => prefix + '-' + suffix;
  report.attemptKey = attemptKey; report.futureDateOffsetFromBrowserFixture = dayOffset; report.scope = scope;
  const planChecks = new Set(['deployment.health_and_external_providers_closed', 'guest.real_slots_and_plan_quote_without_private_booking_access',
    'authentication.real_independent_logins_and_customer_refresh_cookie', 'plan.anonymous_multi_item_quote_and_real_customer_atomic_create_move_cancel',
    'session.logout_revokes_customer_access_and_old_refresh']);
  let lastRequest = 0, requestCount = 0, booking, planBooking, grant, gift, giftUnused, ticket, zero;
  const successful = new Set();
  async function raw(route, { method = 'GET', body, account, cookie: rawCookie, browser = false } = {}) {
    need(typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') && !route.includes('\\'), 'API_ROUTE_REJECTED');
    const url = new URL('/api/v1' + route, target); need(url.origin === target && !url.hash && !url.username && !url.password, 'API_ROUTE_REJECTED');
    const wait = intervalMs - (Date.now() - lastRequest); if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequest = Date.now(); requestCount++;
    const token = account ? sessions[account]?.token : null; if (account) need(token, 'ROLE_SESSION_MISSING');
    let response; try { response = await fetch(url, { method, redirect: 'manual', signal: AbortSignal.timeout(20000), headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(rawCookie ? { Cookie: rawCookie } : {}), ...(browser ? { Origin: target, 'Sec-Fetch-Site': 'same-origin' } : {}),
    }, body: body === undefined ? undefined : JSON.stringify(body) }); } catch { throw new ThreeEndFailure('HTTP_UNREACHABLE_OR_TIMEOUT'); }
    const bytes = Buffer.from(await response.arrayBuffer()); need(bytes.length < 2_000_000, 'RESPONSE_TOO_LARGE');
    let data; try { data = JSON.parse(bytes.toString('utf8')); } catch { data = null; }
    return { response, data };
  }
  function expect(result, status) { if (result.response.status !== status) throw new ThreeEndFailure('UNEXPECTED_HTTP_STATUS', result.response.status); return result.data; }
  const deny = (result, statuses = [403, 404]) => need(statuses.includes(result.response.status), 'EXPECTED_PERMISSION_DENIAL');
  const get = async (route, account) => expect(await raw(route, { account }), 200);
  const post = async (route, account, body = {}, status = 201) => expect(await raw(route, { method: 'POST', account, body }), status);
  const patch = async (route, account, body = {}) => expect(await raw(route, { method: 'PATCH', account, body }), 200);
  const remove = async (route, account, body = {}) => expect(await raw(route, { method: 'DELETE', account, body }), 200);
  async function check(name, work, dependencies = []) {
    if (scope === 'plan-recheck' && !planChecks.has(name)) return;
    if (dependencies.some(name => !successful.has(name))) { report.checks.push({ name, status: 'blocked', code: 'DEPENDENCY_FAILED' }); return; }
    try { const evidence = await work(); successful.add(name); report.checks.push({ name, status: 'pass', ...(evidence ? { evidence } : {}) }); }
    catch (error) { report.checks.push({ name, status: 'fail', code: error instanceof ThreeEndFailure ? error.code : 'ASSERTION_FAILED', ...(error instanceof ThreeEndFailure && error.status ? { httpStatus: error.status } : {}) }); }
  }

  await check('deployment.health_and_external_providers_closed', async () => {
    need(['ok', 'healthy'].includes((await get('/health')).status), 'HEALTH_FAILED'); need((await get('/payments/config')).enabled === false, 'ONLINE_PAYMENTS_ENABLED');
    const config = await get('/auth/customer/config'); for (const provider of ['google', 'apple', 'emailOtp']) need(config[provider]?.enabled === false, 'EXTERNAL_AUTH_ENABLED');
    need(config.nativeSocialEnabled === false, 'NATIVE_SOCIAL_NOT_DISABLED'); need((await get('/gift-cards/config')).onlinePaymentEnabled === false, 'GIFT_ONLINE_ENABLED');
  });
  await check('guest.list_detail_short_link_and_legacy_mapping_are_safe', async () => {
    const listed = page(await get('/shops?page=1&limit=20')); need(listed.items.some(item => item.id === f.shopId), 'BOUND_SHOP_NOT_PUBLIC');
    const detail = await get('/shops/' + f.shopId); need(detail.id === f.shopId && detail.features.onlineBooking === true && detail.canonicalPath === '/s/' + f.shortName, 'PUBLIC_DETAIL_INCOMPLETE');
    need((await get('/shops/resolve?shortName=' + f.shortName)).id === f.shopId, 'SHORT_NAME_NOT_RESOLVED');
    need((await get('/shops/resolve?legacyId=' + f.legacyId)).id === f.shopId, 'EXPLICIT_LEGACY_MAPPING_FAILED');
    expect(await raw('/shops/resolve?legacyId=' + f.shopId), 404);
    need(cleanProjection(detail) && cleanProjection(listed), 'PUBLIC_SHOP_PRIVATE_FIELDS');
    const services = await get('/shops/' + f.shopId + '/services'); need(services.some(item => item.id === f.serviceId && item.hasVariants && item.variants.some(variant => variant.id === f.variant60Id && variant.priceCents === 6000)), 'PUBLIC_FIXED_SKU_MISSING');
    return { publishedDespiteSuspendedHistoricalOwner: true, oldIdsRequireExplicitMapping: true };
  });
  await check('guest.real_slots_and_plan_quote_without_private_booking_access', async () => {
    const query = new URLSearchParams({ shopId: f.shopId, serviceId: f.serviceId, variantId: f.variantId, date: flowDate });
    const preview = await get('/bookings/slots?' + query); need(preview.priceCents === 3500 && preview.durationMin === 30 && preview.slots.some(slot => slot.time === '10:00' && slot.available), 'ANONYMOUS_SLOTS_FAILED');
    const plan = await post('/bookings/plan-slots', null, { shopId: f.shopId, date: flowDate, items: [{ participantIndex: 1, sequence: 1, serviceId: f.serviceId, variantId: f.variantId }] });
    need(plan.priceCents === 3500 && plan.slots.some(slot => slot.available), 'ANONYMOUS_PLAN_QUOTE_FAILED');
    need(cleanProjection(preview, ['bookingId', 'userId', 'resourceLocks', 'locks', 'passwordHash', 'token']) && cleanProjection(plan, ['bookingId', 'userId', 'resourceLocks', 'locks', 'passwordHash', 'token']), 'PREVIEW_PRIVATE_DATA');
    for (const route of ['/bookings', `/bookings/${f.pastBookingId}`, `/bookings/${f.pastBookingId}/reschedule-slots?date=${flowDate}`, '/merchant/shops', '/studio/stores']) expect(await raw(route), 401);
    expect(await raw('/bookings', { method: 'POST', body: { shopId: f.shopId, serviceId: f.serviceId, date: flowDate, startTime: '10:00' } }), 401);
  });
  await check('authentication.real_independent_logins_and_customer_refresh_cookie', async () => {
    for (const [name, role] of Object.entries(ROLES)) {
      const response = await raw('/auth/login', { method: 'POST', browser: true, body: { identifier: secrets[name].identifier, password: secrets[name].password } });
      const data = expect(response, 200); need(data.user?.role === role && typeof data.accessToken === 'string' && !Object.hasOwn(data, 'refreshToken'), 'LOGIN_ROLE_OR_SECRET_MISMATCH');
      sessions[name] = { token: data.accessToken, cookie: cookie(response.response), id: data.user.id };
    }
    const old = sessions.customer;
    expect(await raw('/auth/refresh', { method: 'POST', body: {}, cookie: old.cookie }), 403);
    const response = await raw('/auth/refresh', { method: 'POST', body: {}, cookie: old.cookie, browser: true }), data = expect(response, 200);
    need(data.user.id === old.id && data.user.role === 'CUSTOMER' && !Object.hasOwn(data, 'refreshToken'), 'REFRESH_IDENTITY_CHANGED');
    sessions.customer = { token: data.accessToken, cookie: cookie(response.response), id: data.user.id };
    expect(await raw('/auth/refresh', { method: 'POST', body: {}, cookie: old.cookie, browser: true }), 401);
    sessions.expiredCustomer = old; expect(await raw('/auth/me', { account: 'expiredCustomer' }), 401);
  }, ['deployment.health_and_external_providers_closed']);
  await check('account.independent_home_shop_admin_scope_and_cross_shop_denial', async () => {
    const home = await get('/merchant/shops', 'merchant'), second = await get('/merchant/shops', 'linkedMerchant');
    need(home.length === 1 && home[0].id === f.shopId && home[0].accessType === 'OWN' && home[0].homeShopId === f.shopId, 'INDEPENDENT_BINDING_SCOPE_FAILED');
    need(second.length === 1 && second[0].id === f.otherShopId, 'SECOND_HOME_SCOPE_FAILED');
    need((await get('/merchant/shops', 'admin')).length === 2, 'COMPANY_ADMIN_NOT_ALL_SHOPS');
    deny(await raw(`/merchant/shops/${f.shopId}/bookings`, { account: 'linkedMerchant' }));
    for (const account of ['customer', 'otherCustomer']) deny(await raw('/merchant/shops', { account }));
    deny(await raw('/account-access/admin/overview', { account: 'merchant' }));
  }, ['authentication.real_independent_logins_and_customer_refresh_cookie']);
  await check('customer.profile_and_favorites_are_owned_and_reversible', async () => {
    const me = await get('/auth/me', 'customer'); need(me.id === f.customerId, 'AUTH_ME_WRONG_ACCOUNT');
    await patch('/users/' + f.customerId, 'customer', { name: 'Synthetic updated customer' });
    need((await get('/auth/me', 'customer')).name === 'Synthetic updated customer', 'PROFILE_SAVE_NOT_PERSISTED');
    deny(await raw('/users/' + f.customerId, { account: 'otherCustomer' }));
    need((await post(`/favorites/${f.shopId}/toggle`, 'customer')).favorited === true, 'FAVORITE_NOT_ADDED');
    need((await get('/favorites', 'customer')).ids.includes(f.shopId), 'FAVORITE_NOT_LISTED');
    need(!(await get('/favorites', 'otherCustomer')).ids.includes(f.shopId), 'FAVORITE_ACCOUNT_LEAK');
    need((await post(`/favorites/${f.shopId}/toggle`, 'customer')).favorited === false, 'FAVORITE_NOT_REMOVED');
  }, ['authentication.real_independent_logins_and_customer_refresh_cookie']);
  await check('booking.create_fixed_variant_tip_and_idempotency', async () => {
    const body = { shopId: f.shopId, serviceId: f.serviceId, variantId: f.variantId, preferredTherapistIds: [f.therapistIds[0]], date: flowDate, startTime: '10:00', paymentMode: 'PAY_AT_STORE', tipCents: 123, requestKey: key('single') };
    booking = await post('/bookings', 'customer', body); need(booking.status === 'PENDING' && booking.paymentStatus === 'UNPAID' && booking.totalCents === 3623 && booking.currency === 'usd' && booking.items.length === 1, 'NEW_BOOKING_SNAPSHOT_WRONG');
    need((await post('/bookings', 'customer', body)).id === booking.id, 'CREATE_REPLAY_DUPLICATED');
    expect(await raw('/bookings', { method: 'POST', account: 'customer', body: { ...body, tipCents: 124 } }), 409);
    deny(await raw('/bookings', { method: 'POST', account: 'merchant', body: { ...body, requestKey: key('merchant-must-not-create-customer-booking') } }));
    deny(await raw('/bookings', { method: 'POST', account: 'staff', body: { ...body, requestKey: key('staff-must-not-create-customer-booking') } }));
    need(booking.timezone === f.timezone && booking.localStartTime === '10:00' && booking.localEndTime === '10:30', 'LOCAL_TIME_NOT_SNAPSHOTTED');
  }, ['authentication.real_independent_logins_and_customer_refresh_cookie', 'guest.real_slots_and_plan_quote_without_private_booking_access']);
  await check('booking.merchant_confirm_staff_read_and_cross_account_denials', async () => {
    const confirmed = await patch(`/bookings/${booking.id}/status?status=CONFIRMED`, 'merchant'); need(confirmed.status === 'CONFIRMED' && confirmed.paymentStatus === 'UNPAID', 'MERCHANT_CONFIRM_FAILED');
    need((await get(`/bookings/${booking.id}`, 'staff')).id === booking.id, 'STAFF_READ_NOT_GRANTED');
    for (const account of ['otherCustomer', 'linkedMerchant']) deny(await raw(`/bookings/${booking.id}`, { account }));
    deny(await raw(`/bookings/${booking.id}/status?status=CANCELLED`, { method: 'PATCH', account: 'staff', body: {} }));
    deny(await raw(`/bookings/${booking.id}/status?status=COMPLETED`, { method: 'PATCH', account: 'customer', body: {} }));
  }, ['booking.create_fixed_variant_tip_and_idempotency']);
  await check('booking.reschedule_is_atomic_and_quote_does_not_drift', async () => {
    const slots = await get(`/bookings/${booking.id}/reschedule-slots?date=${flowDate}`, 'merchant'); need(slots.slots.some(slot => slot.time === '11:00' && slot.available), 'RESCHEDULE_SLOTS_MISSING');
    expect(await raw(`/bookings/${booking.id}/reschedule`, { method: 'POST', account: 'merchant', body: { date: flowDate, startTime: '22:00' } }), 400);
    need((await get(`/bookings/${booking.id}`, 'customer')).localStartTime === '10:00', 'FAILED_RESCHEDULE_MUTATED_ORIGINAL');
    const moved = await post(`/bookings/${booking.id}/reschedule`, 'merchant', { date: flowDate, startTime: '11:00' }); need(moved.localStartTime === '11:00' && moved.totalCents === 3623 && moved.tipCents === 123 && moved.items.length === 1, 'RESCHEDULE_CHANGED_PRICE_OR_ITEMS');
    need((await get(`/bookings/${booking.id}`, 'customer')).localStartTime === '11:00', 'RESCHEDULE_NOT_PERSISTED');
  }, ['booking.merchant_confirm_staff_read_and_cross_account_denials']);
  await check('booking.actual_offline_receipt_replays_and_future_completion_is_rejected', async () => {
    const body = { amountCents: 3623, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic already collected cash; no bank transfer', requestKey: key('receipt') };
    for (const account of ['customer', 'staff', 'linkedMerchant']) deny(await raw(`/bookings/${booking.id}/offline-receipts`, { method: 'POST', account, body }));
    let summary = await post(`/bookings/${booking.id}/offline-receipts`, 'merchant', body); need(summary.paymentStatus === 'PAID' && summary.paidCents === 3623 && summary.amountDueCents === 0, 'RECEIPT_NOT_SETTLED');
    summary = await post(`/bookings/${booking.id}/offline-receipts`, 'merchant', body); need(summary.entries.filter(entry => entry.kind === 'RECEIPT').length === 1, 'RECEIPT_REPLAY_DUPLICATED');
    expect(await raw(`/bookings/${booking.id}/offline-receipts`, { method: 'POST', account: 'merchant', body: { ...body, amountCents: 3622 } }), 409);
    deny(await raw(`/bookings/${booking.id}/status?status=COMPLETED`, { method: 'PATCH', account: 'merchant', body: {} }), [400, 409]);
    deny(await raw('/payments/create-intent', { method: 'POST', account: 'customer', body: { bookingId: booking.id } }), [400, 503]);
  }, ['booking.reschedule_is_atomic_and_quote_does_not_drift']);
  await check('booking.ended_fixture_paid_then_completed_and_owned_review', async () => {
    const body = { amountCents: 3500, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic already collected cash for ended service', requestKey: key('past-receipt') };
    await post(`/bookings/${f.pastBookingId}/offline-receipts`, 'merchant', body);
    const completed = await patch(`/bookings/${f.pastBookingId}/status?status=COMPLETED`, 'merchant'); need(completed.status === 'COMPLETED' && completed.paymentStatus === 'PAID', 'ENDED_SERVICE_NOT_COMPLETED');
    const review = await post('/reviews', 'customer', { bookingId: f.pastBookingId, rating: 5, content: 'Synthetic HTTP review only' }); need(review.rating === 5, 'REVIEW_NOT_CREATED');
    deny(await raw('/reviews', { method: 'POST', account: 'otherCustomer', body: { bookingId: f.pastBookingId, rating: 1, content: 'Must reject other account' } }));
    need((await get('/reviews/shop/' + f.shopId)).items.some(item => item.id === review.id), 'PUBLIC_REVIEW_NOT_VISIBLE');
    await remove('/reviews/' + review.id, 'customer');
  }, ['authentication.real_independent_logins_and_customer_refresh_cookie']);
  await check('booking.ended_fixture_full_refund_keeps_fulfillment_and_replays', async () => {
    const body = { amountCents: 3500, method: 'CASH', occurredAt: new Date().toISOString(), reason: 'Synthetic physical refund already returned; no transfer', requestKey: key('past-refund') };
    let result = await post(`/bookings/${f.pastBookingId}/offline-refunds`, 'merchant', body); need(result.status === 'COMPLETED' && result.paymentStatus === 'REFUNDED' && result.netPaidCents === 0, 'REFUND_CHANGED_FULFILLMENT');
    result = await post(`/bookings/${f.pastBookingId}/offline-refunds`, 'merchant', body); need(result.entries.filter(entry => entry.kind === 'REFUND').length === 1, 'REFUND_REPLAY_DUPLICATED');
  }, ['booking.ended_fixture_paid_then_completed_and_owned_review']);
  await check('account.explicit_associated_read_grant_and_owner_only_denials', async () => {
    grant = (await post('/account-access/admin/grants', 'admin', { sourceShopId: f.otherShopId, targetShopId: f.shopId, permissions: ['BOOKINGS_READ'], reason: 'Synthetic temporary read-only related-store grant' })).grant;
    const shops = await get('/merchant/shops', 'linkedMerchant'), associated = shops.find(item => item.id === f.shopId); need(associated?.accessType === 'ASSOCIATED' && associated.homeShopId === f.otherShopId, 'ASSOCIATED_SHOP_NOT_EXPLICIT');
    need((await get(`/bookings/${booking.id}`, 'linkedMerchant')).id === booking.id, 'ASSOCIATED_BOOKING_READ_DENIED');
    deny(await raw(`/bookings/${booking.id}/status?status=CANCELLED`, { method: 'PATCH', account: 'linkedMerchant', body: {} }));
    deny(await raw(`/reservation-admin/shops/${f.shopId}/payment-policy`, { method: 'PATCH', account: 'linkedMerchant', body: { payAtStoreEnabled: false } }));
    deny(await raw(`/merchant/transactions?shopId=${f.shopId}`, { account: 'linkedMerchant' }));
  }, ['booking.create_fixed_variant_tip_and_idempotency', 'account.independent_home_shop_admin_scope_and_cross_shop_denial']);
  await check('account.grant_revocation_is_effective_for_existing_jwt', async () => {
    const result = await remove('/account-access/admin/grants/' + grant.id, 'admin', { reason: 'Synthetic remove temporary association after acceptance' }); need(result.grant.status === 'REVOKED', 'GRANT_NOT_REVOKED');
    deny(await raw(`/bookings/${booking.id}`, { account: 'linkedMerchant' })); need((await get('/merchant/shops', 'linkedMerchant')).every(item => item.id !== f.shopId), 'REVOKED_SHOP_STILL_VISIBLE');
  }, ['account.explicit_associated_read_grant_and_owner_only_denials']);
  await check('plan.anonymous_multi_item_quote_and_real_customer_atomic_create_move_cancel', async () => {
    const body = { shopId: f.shopId, date: flowDate, items: [{ participantIndex: 1, sequence: 1, serviceId: f.serviceId, variantId: f.variantId }, { participantIndex: 1, sequence: 2, serviceId: f.secondServiceId }, { participantIndex: 2, sequence: 1, serviceId: f.secondServiceId }] };
    // Sequential starts include the larger staff/room preparation buffer:
    // 30 + max(5, 10) + 30 = 70 minutes, rather than staff-only 65.
    const preview = await post('/bookings/plan-slots', null, body); need(preview.priceCents === 7500 && preview.durationMin === 70 && preview.participantCount === 2 && preview.slots.some(slot => slot.time === '14:00' && slot.available), 'MULTI_ITEM_QUOTE_WRONG');
    const create = { ...body, startTime: '14:00', paymentMode: 'PAY_AT_STORE', tipCents: 500, requestKey: key('plan') };
    deny(await raw('/bookings/plan', { method: 'POST', body: create }), [401]); deny(await raw('/bookings/plan', { method: 'POST', account: 'merchant', body: create }));
    planBooking = await post('/bookings/plan', 'customer', create); need(planBooking.totalCents === 8000 && planBooking.items.length === 3, 'PLAN_SNAPSHOTS_WRONG');
    need((await post('/bookings/plan', 'customer', create)).id === planBooking.id, 'PLAN_CREATE_REPLAY_DUPLICATED');
    const moved = await post(`/bookings/${planBooking.id}/reschedule`, 'customer', { date: flowDate, startTime: '15:00' }); need(moved.totalCents === 8000 && moved.items.length === 3, 'PLAN_RESCHEDULE_REQUOTED');
    need((await post(`/bookings/${planBooking.id}/cancel`, 'customer')).status === 'CANCELLED', 'PLAN_CANCEL_FAILED');
    need((await post('/bookings/plan-slots', null, body)).slots.some(slot => slot.time === '15:00' && slot.available), 'CANCELLED_PLAN_RESOURCES_NOT_RELEASED');
  }, ['authentication.real_independent_logins_and_customer_refresh_cookie', 'guest.real_slots_and_plan_quote_without_private_booking_access']);
  await check('coupon.real_claim_zero_settlement_no_external_charge_and_cancel', async () => {
    const available = await get('/coupons?shopId=' + f.shopId, 'customer'); need(available.some(item => item.id === f.couponId), 'COUPON_NOT_CLAIMABLE');
    const claimed = await post('/coupons/' + f.couponId + '/claim', 'customer');
    const wallet = await get('/users/me/coupons', 'customer'), walletItem = wallet.find(item => item.coupon?.id === f.couponId); need(walletItem, 'CLAIMED_COUPON_MISSING');
    const body = { shopId: f.shopId, serviceId: f.serviceId, variantId: f.variantId, date: flowDate, startTime: '12:00', couponId: walletItem.id, paymentMode: 'ONLINE', requestKey: key('zero') };
    zero = await post('/bookings', 'customer', body); need(zero.totalCents === 0 && zero.paymentMode === 'ZERO' && zero.paymentStatus === 'PAID' && zero.paidCents === 0 && zero.status === 'CONFIRMED', 'ZERO_NOT_SETTLED_WITHOUT_CHARGE');
    need((await get(`/bookings/${zero.id}/settlements`, 'merchant')).entries.filter(entry => entry.kind === 'ZERO').length === 1, 'ZERO_EVIDENCE_MISSING');
    need((await post(`/bookings/${zero.id}/cancel`, 'customer')).status === 'CANCELLED', 'ZERO_CANCEL_FAILED');
  }, ['authentication.real_independent_logins_and_customer_refresh_cookie']);
  await check('orders.customer_merchant_and_company_pages_show_consistent_amounts_and_times', async () => {
    const customer = page(await get('/bookings?page=1&pageSize=50', 'customer')); need(customer.items.some(item => item.id === booking.id && item.totalCents === 3623 && item.localStartTime === '11:00'), 'CUSTOMER_PAGE_STALE');
    need(page(await get('/bookings?page=1&pageSize=50', 'otherCustomer')).total === 0, 'OTHER_CUSTOMER_ORDERS_LEAK');
    const merchant = page(await get(`/merchant/shops/${f.shopId}/bookings?page=1&pageSize=50`, 'merchant')); need(merchant.items.some(item => item.id === booking.id && item.paidCents === 3623), 'MERCHANT_PAGE_STALE');
    const admin = page(await get(`/studio/service-orders?shopId=${f.shopId}&page=1&pageSize=50`, 'admin')); need(admin.items.some(item => item.id === booking.id && item.amountCents === 3623 && item.localStartTime === '11:00'), 'ADMIN_PAGE_WRONG_AMOUNT_OR_ZONE');
    deny(await raw('/studio/service-orders', { account: 'merchant' }));
    const transactions = page(await get(`/merchant/transactions?shopId=${f.shopId}&page=1&pageSize=100`, 'merchant')); need(transactions.total === 0 && transactions.shopId === f.shopId, 'PHYSICAL_RECEIPT_MUST_NOT_FABRICATE_ONLINE_LEDGER');
    need((await get('/studio/summary', 'admin')).counts.serviceOrders >= 2, 'ADMIN_REAL_SUMMARY_MISSING');
  }, ['booking.actual_offline_receipt_replays_and_future_completion_is_rejected']);
  await check('gift.public_product_real_pending_order_no_right_before_physical_receipt', async () => {
    need((await get('/gift-cards/products?shopId=' + f.shopId)).items.some(item => item.id === f.productId), 'PUBLIC_GIFT_PRODUCT_MISSING');
    const body = { productId: f.productId, paymentMethod: 'PAY_AT_STORE', requestKey: key('gift') };
    gift = (await post('/gift-cards/orders', 'customer', body)).item; need(gift.status === 'PENDING' && gift.paidCents === 0 && !gift.entitlementId, 'GIFT_RIGHT_GRANTED_BEFORE_PAY');
    need((await post('/gift-cards/orders', 'customer', body)).item.id === gift.id, 'GIFT_CREATE_REPLAY_DUPLICATED');
    const checkout = await post(`/gift-cards/orders/${gift.id}/checkout`, 'customer'); need(checkout.onlinePaymentEnabled === false && checkout.paymentRequiredAtStore && !checkout.checkoutUrl, 'GIFT_UNTRUSTED_PAYMENT_ENABLED');
    deny(await raw('/gift-cards/orders/' + gift.id, { account: 'otherCustomer' }));
    const receipt = { amountCents: 4000, method: 'CASH', reason: 'Synthetic gift cash already collected', requestKey: key('gift-receipt') }, base = `/gift-cards/admin/shops/${f.shopId}`;
    deny(await raw(base + `/orders/${gift.id}/receipts`, { method: 'POST', account: 'linkedMerchant', body: receipt }));
    gift = (await post(base + `/orders/${gift.id}/receipts`, 'merchant', receipt)).item; need(gift.status === 'PAID' && gift.entitlementId && gift.paidCents === 4000, 'GIFT_RECEIPT_DID_NOT_GRANT');
    need((await post(base + `/orders/${gift.id}/receipts`, 'merchant', receipt)).replayed === true, 'GIFT_RECEIPT_REPLAY_NOT_SAFE');
  }, ['authentication.real_independent_logins_and_customer_refresh_cookie']);
  await check('gift.owned_exact_use_credential_cross_shop_denial_and_redemption_replay', async () => {
    const entitlement = (await get('/gift-cards/entitlements/' + gift.entitlementId, 'customer')).item; need(entitlement.totalUses === 3 && entitlement.remainingUses === 3 && entitlement.source === 'PURCHASE', 'GIFT_RIGHT_SNAPSHOT_WRONG');
    deny(await raw('/gift-cards/entitlements/' + gift.entitlementId, { account: 'otherCustomer' }));
    const credential = await post(`/gift-cards/entitlements/${gift.entitlementId}/credential`, 'customer', { usedUses: 1 }); need(typeof credential.token === 'string' && credential.token.startsWith('gc1_'), 'CREDENTIAL_MISSING');
    const body = { token: credential.token, usedUses: 1, requestKey: key('redeem') };
    deny(await raw(`/gift-cards/admin/shops/${f.otherShopId}/redeem`, { method: 'POST', account: 'linkedMerchant', body }), [400, 403, 404]);
    const redeemed = await post(`/gift-cards/admin/shops/${f.shopId}/redeem`, 'merchant', body); need(redeemed.remainingUses === 2 && redeemed.replayed === false, 'WRONG_USES_DEDUCTED');
    need((await post(`/gift-cards/admin/shops/${f.shopId}/redeem`, 'merchant', body)).replayed === true, 'REDEEM_REPLAY_NOT_SAFE');
    const history = page(await get(`/gift-cards/entitlements/${gift.entitlementId}/redemptions`, 'customer')); need(history.total === 1 && cleanProjection(history, ['token', 'tokenHash', 'credentialToken']), 'HISTORY_TOKEN_LEAK_OR_DUPLICATE');
    expect(await raw(`/gift-cards/admin/shops/${f.shopId}/orders/${gift.id}/refunds`, { method: 'POST', account: 'merchant', body: { amountCents: 4000, method: 'CASH', reason: 'Synthetic used rights must not refund', requestKey: key('used-gift-refund') } }), 409);
  }, ['gift.public_product_real_pending_order_no_right_before_physical_receipt']);
  await check('gift.unused_full_physical_refund_voids_rights_without_double_refund', async () => {
    const base = `/gift-cards/admin/shops/${f.shopId}`;
    giftUnused = (await post('/gift-cards/orders', 'customer', { productId: f.productId, paymentMethod: 'PAY_AT_STORE', requestKey: key('gift-unused') })).item;
    giftUnused = (await post(base + `/orders/${giftUnused.id}/receipts`, 'merchant', { amountCents: 4000, method: 'CASH', reason: 'Synthetic unused gift cash received', requestKey: key('gift-unused-receipt') })).item;
    const body = { amountCents: 4000, method: 'CASH', reason: 'Synthetic unused gift cash already returned', requestKey: key('gift-unused-refund') };
    const result = await post(base + `/orders/${giftUnused.id}/refunds`, 'merchant', body); need(result.item.status === 'REFUNDED' && result.item.refundedCents === 4000, 'UNUSED_GIFT_REFUND_FAILED');
    need((await post(base + `/orders/${giftUnused.id}/refunds`, 'merchant', body)).replayed === true, 'UNUSED_REFUND_REPLAY_DUPLICATED');
    need((await get('/gift-cards/entitlements/' + giftUnused.entitlementId, 'customer')).item.status === 'VOIDED', 'REFUNDED_RIGHT_STILL_ACTIVE');
  }, ['gift.public_product_real_pending_order_no_right_before_physical_receipt']);
  await check('after_sales.customer_case_merchant_handling_internal_privacy_and_version_conflicts', async () => {
    ticket = await post('/after-sales', 'customer', { bookingId: booking.id, type: 'COMPLAINT', reason: 'Synthetic service coordination request' }); need(ticket.status === 'OPEN' && ticket.version >= 1, 'AFTER_SALES_NOT_OPEN');
    deny(await raw('/after-sales/' + ticket.id, { account: 'otherCustomer' })); deny(await raw('/after-sales/' + ticket.id, { account: 'linkedMerchant' }));
    const claimed = await post(`/after-sales/${ticket.id}/claim`, 'merchant', { version: ticket.version }); need(claimed.version > ticket.version, 'CLAIM_VERSION_NOT_INCREMENTED');
    expect(await raw(`/after-sales/${ticket.id}/notes`, { method: 'POST', account: 'merchant', body: { version: ticket.version, content: 'Stale synthetic note', visibility: 'PUBLIC' } }), 409);
    const internal = 'Synthetic internal merchant note must stay private';
    const noted = await post(`/after-sales/${ticket.id}/notes`, 'merchant', { version: claimed.version, content: internal, visibility: 'INTERNAL' });
    need(!JSON.stringify(await get(`/after-sales/${ticket.id}/events`, 'customer')).includes(internal), 'INTERNAL_NOTE_EXPOSED_TO_CUSTOMER');
    const accepted = await post(`/after-sales/${ticket.id}/transition`, 'merchant', { version: noted.version, action: 'ACCEPT', reason: 'Synthetic handled by bound store login' }); need(accepted.status === 'IN_PROGRESS', 'CASE_NOT_ACCEPTED');
    ticket = await post(`/after-sales/${ticket.id}/transition`, 'merchant', { version: accepted.version, action: 'RESOLVE', reason: 'Synthetic coordination complete; no money was transferred' }); need(ticket.status === 'RESOLVED', 'CASE_NOT_RESOLVED');
    need((await get('/after-sales/' + ticket.id, 'customer')).status === 'RESOLVED', 'CUSTOMER_CASE_STALE');
  }, ['booking.actual_offline_receipt_replays_and_future_completion_is_rejected']);
  await check('admin.safe_audit_filters_and_role_boundaries', async () => {
    const audit = await get(`/admin/audit-logs?targetType=BOOKING&targetId=${booking.id}&page=1&limit=100`, 'admin');
    need(Array.isArray(audit.items) && audit.items.some(item => item.action === 'BOOKING_CONFIRMED') && audit.items.some(item => item.action === 'BOOKING_RESCHEDULE'), 'BOOKING_AUDIT_TRAIL_MISSING');
    need(cleanProjection(audit, ['passwordHash', 'token', 'refreshToken', 'accessToken', 'reason', 'customer', 'email', 'phone', 'before', 'after']), 'AUDIT_UNSAFE_DETAIL');
    for (const account of ['merchant', 'customer', 'staff']) deny(await raw('/admin/audit-logs', { account }));
  }, ['booking.reschedule_is_atomic_and_quote_does_not_drift']);
  await check('session.logout_revokes_customer_access_and_old_refresh', async () => {
    const old = sessions.otherCustomer;
    expect(await raw('/auth/logout', { method: 'POST', cookie: old.cookie, browser: true, body: {} }), 200);
    expect(await raw('/auth/me', { account: 'otherCustomer' }), 401);
    expect(await raw('/auth/refresh', { method: 'POST', cookie: old.cookie, browser: true, body: {} }), 401);
  }, ['authentication.real_independent_logins_and_customer_refresh_cookie']);
  report.finishedAt = new Date().toISOString(); report.requestCount = requestCount;
  report.counts = Object.fromEntries(['pass', 'fail', 'blocked'].map(status => [status, report.checks.filter(check => check.status === status).length]));
  report.passed = report.counts.fail === 0 && report.counts.blocked === 0; report.status = report.passed ? 'pass_for_stated_disposable_http_scope' : 'fail'; report.deploymentReady = false;
  if (reportFile) await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}

async function main(args) {
  try {
    const options = {};
    for (let index = 0; index < args.length; index++) {
      const key = args[index]; need(!Object.hasOwn(options, key), 'ARGUMENTS_INVALID');
      if (key === '--acknowledge-disposable-target') options[key] = true;
      else if (['--target', '--secrets-file', '--report', '--attempt-key', '--day-offset', '--scope'].includes(key) && args[index + 1]) options[key] = args[++index]; else throw new ThreeEndFailure('ARGUMENTS_INVALID');
    }
    need(options['--acknowledge-disposable-target'] === true, 'EXPLICIT_DISPOSABLE_ACK_REQUIRED');
    const root = resolve(fileURLToPath(new URL('../', import.meta.url))), privatePath = resolve(options['--secrets-file'] ?? ''), location = relative(resolve(root, '.local'), privatePath);
    need(location && !location.startsWith('..' + sep) && location !== '..' && /^three-end-secrets(?:-[a-f0-9]{8})?\.json$/.test(basename(privatePath)), 'PRIVATE_SYNTHETIC_SECRET_FILE_REQUIRED');
    const reportPath = resolve(options['--report'] ?? ''), reportLocation = relative(resolve(root, 'docs/verification'), reportPath);
    need(reportLocation && !reportLocation.includes(sep) && /^three-end-[a-zA-Z0-9_.-]+\.json$/.test(reportLocation), 'NEW_THREE_END_REPORT_REQUIRED');
    const bytes = await readFile(privatePath); need(bytes.length < 262144, 'SECRETS_FILE_TOO_LARGE');
    const report = await runThreeEndHttp({ target: options['--target'], secrets: JSON.parse(bytes), reportFile: reportPath, acknowledge: MARKER, attemptKey: options['--attempt-key'] ?? 'first', dayOffset: options['--day-offset'] === undefined ? 4 : Number(options['--day-offset']), scope: options['--scope'] ?? 'all' });
    console.log(JSON.stringify({ status: report.status, passed: report.passed, counts: report.counts, requestCount: report.requestCount, report: 'docs/verification/' + basename(reportPath) })); process.exitCode = report.passed ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ passed: false, code: error instanceof ThreeEndFailure ? error.code : 'THREE_END_RUN_FAILED_WITHOUT_SENSITIVE_OUTPUT' })); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));

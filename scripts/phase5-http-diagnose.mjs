/** Narrow four-path diagnostic; never prints credentials, data rows or raw response messages. */
import { readFile } from 'node:fs/promises';
import { disposableOrigin, validateSecrets, syntheticPng } from './phase5-http-integration.mjs';
const state = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (disposableOrigin(state.origin) !== 'http://127.0.0.1:53284' || state.database !== 'massajoy2_phase5_http') throw Error('PHASE5_TARGET_GUARD');
const secrets = validateSecrets(JSON.parse(await readFile(state.secretsFile, 'utf8')), state.origin), f = secrets.fixture, tokens = {};
async function request(path, method = 'GET', account, body, form) {
  const response = await fetch(state.origin + '/api/v1' + path, { method, redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(tokens[account] ? { Authorization: 'Bearer ' + tokens[account] } : {}), Origin: state.origin, 'Sec-Fetch-Site': 'same-origin' },
    body: form || (body ? JSON.stringify(body) : undefined) });
  let data; try { data = await response.json(); } catch {}
  return { status: response.status, data };
}
function diagnostic(name, result) {
  const messages = Array.isArray(result.data?.message) ? result.data.message : [result.data?.message];
  const code = messages.some(v => v === 'Opening hours require valid increasing HH:MM times') ? 'INVALID_FIXTURE_BUSINESS_HOURS'
    : messages.some(v => typeof v === 'string' && v.startsWith('发布前请补充：') && v.includes('至少一天有效营业时间')) ? 'INVALID_FIXTURE_PUBLICATION_HOURS'
    : 'UNCLASSIFIED_RESPONSE';
  console.log(JSON.stringify({ check: name, httpStatus: result.status, code }));
}
for (const name of ['customer', 'merchant']) {
  const result = await request('/auth/password/login', 'POST', undefined, secrets[name]);
  if (result.status !== 200 || typeof result.data?.accessToken !== 'string') throw Error('SYNTHETIC_LOGIN_FAILED');
  tokens[name] = result.data.accessToken;
}
diagnostic('fixed_variant_slots', await request('/bookings/slots?' + new URLSearchParams({ shopId: f.shopId, serviceId: f.serviceId, variantId: f.variantId, date: f.date }), 'GET', 'customer'));
diagnostic('zero_booking', await request('/bookings', 'POST', 'customer', { shopId: f.shopId, serviceId: f.serviceId, variantId: f.variantId, date: f.date, startTime: '12:00', paymentMode: 'ONLINE', couponId: f.couponWalletId, requestKey: 'p5-diagnose-zero' }));
diagnostic('plan_preview', await request('/bookings/plan-slots', 'POST', 'customer', { shopId: f.shopId, date: f.date, items: [{ participantIndex: 1, sequence: 1, serviceId: f.serviceId, variantId: f.variantId }] }));
const form = new FormData(); for (const [key, value] of Object.entries({ scope: 'SHOP', shopId: f.shopId, purpose: 'logo', requestKey: 'p5-' + secrets.runId.slice(0, 8) + '-logo' })) form.set(key, value);
form.set('file', new Blob([syntheticPng()], { type: 'image/png' }), 'synthetic.exe');
const media = await request('/upload/media', 'POST', 'merchant', undefined, form);
if (media.status !== 201 || !media.data?.item?.fileUrl) throw Error('SYNTHETIC_MEDIA_REPLAY_FAILED');
diagnostic('studio_bound_media_save', await request('/studio/stores/' + f.shopId, 'PATCH', 'merchant', { logoUrl: media.data.item.fileUrl }));

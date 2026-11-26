import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditActionLabel, auditQuery, auditTargetLabel, listAuditLogs, safeAuditSummary } from './auditLogs';
import { canAccessView } from '../permission';
import { Role } from '../utils/roleEnum';

test('audit API uses the actual admin URL, exact IDs and submitted UTC filters', async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let requested: URL | undefined;
  let credentials: RequestCredentials | undefined;
  globalThis.fetch = async (input, init) => {
    requested = new URL(String(input), 'http://127.0.0.1'); credentials = init?.credentials;
    return new Response(JSON.stringify({ items: [], meta: { total: 0, page: 2, limit: 50, totalPages: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await listAuditLogs({ targetType: 'service-orders', action: 'STUDIO_UPDATE', targetId: '9007199254740993', operatorId: '3', startDate: '2026-10-27', endDate: '2026-10-27' }, 2, 50, controller.signal);
    assert.equal(requested?.pathname, '/api/v1/admin/audit-logs');
    assert.deepEqual(Object.fromEntries(requested!.searchParams), { page: '2', limit: '50', targetType: 'service-orders', action: 'STUDIO_UPDATE', targetId: '9007199254740993', operatorId: '3', startDate: '2026-10-27', endDate: '2026-10-27' });
    assert.equal(credentials, 'include');
  } finally { globalThis.fetch = original; }
});
test('invalid dates and overflow IDs cannot be submitted as apparently valid filters', () => {
  assert.throws(() => auditQuery({ targetId: '9223372036854775808' }, 1, 20));
  assert.throws(() => auditQuery({ startDate: '2026-02-30' }, 1, 20));
  assert.throws(() => auditQuery({ startDate: '2026-10-28', endDate: '2026-10-27' }, 1, 20));
  assert.throws(() => auditQuery({ action: '<script>' }, 1, 20));
  assert.throws(() => auditQuery({}, 1, 101));
});
test('summaries never expose raw values even if a response contains unexpected sensitive JSON', () => {
  const summary = safeAuditSummary({
    fields: ['status', 'password', 'phone-secret-marker', 'email', 'status', 'constructor', '__proto__'],
    previousStatus: 'PENDING', newStatus: 'APPROVED', reasonRecorded: true,
    reason: 'private-reason-marker', phone: 'private-contact-marker', before: { password: 'private-password-marker' },
  }).join('；');
  assert.match(summary, /状态：待处理 → 已通过/);
  assert.match(summary, /变更字段：状态/);
  assert.match(summary, /已记录处理原因/);
  for (const forbidden of ['private-', 'secret-', 'password', 'email', 'constructor', '__proto__']) assert.ok(!summary.includes(forbidden));
  assert.deepEqual(safeAuditSummary(['arbitrary']), []);
  assert.deepEqual(safeAuditSummary({ newStatus: 'private-value', reason: 'private-reason' }), []);
});
test('audit navigation is only granted to the backend ADMIN role mapping', () => {
  assert.equal(canAccessView(Role.SUPER_ADMIN, 'audit-logs'), true);
  assert.equal(canAccessView(Role.STORE_MANAGER, 'audit-logs'), false);
  assert.equal(canAccessView(Role.USER, 'audit-logs'), false);
  assert.equal(canAccessView(Role.PLATFORM_ADMIN, 'audit-logs'), false);
});

test('independent-account and copy audits have explicit labels while password and raw reason stay outside summaries', () => {
  assert.equal(auditActionLabel('SHOP_LOGIN_CREATED_AND_BOUND'), '创建并绑定门店账号');
  assert.equal(auditActionLabel('SHOP_CONFIG_COPIED'), '复制门店配置');
  assert.equal(auditTargetLabel('SHOP_ACCOUNT'), '门店独立账号与授权');
  const summary = safeAuditSummary({ fields: ['loginName', 'loginBinding', 'passwordReset'], reasonRecorded: true, password: 'never-render-password', reason: 'never-render-raw-reason' }).join('；');
  assert.match(summary, /门店登录绑定/);
  assert.ok(!summary.includes('never-render'));
});

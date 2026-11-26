import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, apiRequest, clearSession, loginWithPassword, restoreSession, subscribeSession } from './session';

const admin = { id: '901', role: 'ADMIN', name: 'Synthetic administrator' };
const credentialsMessage = '账号或密码错误。';
const expiredMessage = '登录已失效，请重新登录。';

for (const [label, body] of [
  ['actual invalid-credentials envelope', { error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } }],
  ['generic Unauthorized response', { message: 'Unauthorized' }],
  ['server-provided text', { error: { message: '身份验证错误 <script>synthetic-secret</script>' } }],
] as const) {
  test(`login 401 uses the credential message for ${label}, without restoring a rejected identity`, async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    const accepted: string[] = [];
    const unsubscribe = subscribeSession(user => { if (user) accepted.push(String(user.id)); });
    clearSession();
    globalThis.fetch = async url => {
      calls.push(String(url));
      return Response.json(body, { status: 401 });
    };
    try {
      await assert.rejects(loginWithPassword('admin@example.invalid', 'synthetic-password'), error => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 401);
        assert.equal(error.message, credentialsMessage);
        return true;
      });
      assert.deepEqual(calls, ['/api/v1/auth/login']);
      assert.deepEqual(accepted, []);
    } finally { unsubscribe(); clearSession(); globalThis.fetch = original; }
  });
}

test('an authenticated request with rejected refresh reports session expiry and never replays the command', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const reasons: Array<string | undefined> = [];
  const unsubscribe = subscribeSession((_user, reason) => reasons.push(reason));
  clearSession();
  globalThis.fetch = async url => {
    const path = String(url); calls.push(path);
    if (path.endsWith('/auth/login')) return Response.json({ accessToken: 'synthetic-token', user: admin });
    if (path.endsWith('/auth/me')) return Response.json(admin);
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  };
  try {
    await loginWithPassword('admin@example.invalid', 'synthetic-password');
    await assert.rejects(apiRequest('/studio/stores/1', { method: 'PATCH', body: JSON.stringify({ name: 'Synthetic store' }) }), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.message, expiredMessage);
      return true;
    });
    assert.equal(calls.filter(path => path === '/api/v1/studio/stores/1').length, 1);
    assert.equal(calls.filter(path => path === '/api/v1/auth/refresh').length, 1);
    assert.equal(reasons.at(-1), expiredMessage);
  } finally { unsubscribe(); clearSession(); globalThis.fetch = original; }
});

test('a business denial after refreshing a valid administrator session keeps it active', async () => {
  const original = globalThis.fetch;
  const accepted: Array<string | null> = [];
  const unsubscribe = subscribeSession(user => accepted.push(user ? String(user.id) : null));
  let writes = 0;
  globalThis.fetch = async url => {
    const path = String(url);
    if (path.endsWith('/auth/login') || path.endsWith('/auth/refresh')) {
      return Response.json({ accessToken: 'synthetic-token', user: admin });
    }
    if (path.endsWith('/auth/me')) return Response.json(admin);
    writes++;
    return Response.json({ message: writes === 1 ? 'Unauthorized' : 'Forbidden' }, {
      status: writes === 1 ? 401 : 403,
    });
  };
  try {
    await loginWithPassword('admin@example.invalid', 'synthetic-password');
    await assert.rejects(apiRequest('/studio/stores/1', { method: 'PATCH' }), { status: 403 });
    assert.equal(writes, 2);
    assert.equal(accepted.at(-1), admin.id);
  } finally { unsubscribe(); clearSession(); globalThis.fetch = original; }
});

test('profile rejection after accepted credentials remains a session error, not a password error', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  clearSession();
  globalThis.fetch = async url => {
    const path = String(url); calls.push(path);
    return path.endsWith('/auth/login')
      ? Response.json({ accessToken: 'synthetic-token', user: admin })
      : Response.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  };
  try {
    await assert.rejects(loginWithPassword('admin@example.invalid', 'synthetic-password'), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, expiredMessage);
      return true;
    });
    assert.deepEqual(calls, ['/api/v1/auth/login', '/api/v1/auth/me', '/api/v1/auth/refresh']);
  } finally { clearSession(); globalThis.fetch = original; }
});

test('login network failures retain the connection message', async () => {
  const original = globalThis.fetch;
  clearSession();
  globalThis.fetch = async () => { throw new TypeError('Synthetic network failure'); };
  try {
    await assert.rejects(loginWithPassword('admin@example.invalid', 'synthetic-password'), {
      name: 'ApiError', status: 0, message: '无法连接管理服务，请稍后重试。',
    });
  } finally { clearSession(); globalThis.fetch = original; }
});

test('login service-unavailable failures retain the service message', async () => {
  const original = globalThis.fetch;
  clearSession();
  globalThis.fetch = async () => Response.json({ error: { message: 'Service Unavailable' } }, { status: 503 });
  try {
    await assert.rejects(loginWithPassword('admin@example.invalid', 'synthetic-password'), {
      name: 'ApiError', status: 503, message: '管理服务暂不可用，请稍后重试。',
    });
  } finally { clearSession(); globalThis.fetch = original; }
});

test('platform login uses its role-specific endpoint and keeps the credential error for denied roles', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  clearSession();
  globalThis.fetch = async url => {
    calls.push(String(url));
    return Response.json({ message: 'Invalid credentials' }, { status: 401 });
  };
  try {
    const { loginWithAdminPassword } = await import('./session');
    await assert.rejects(loginWithAdminPassword('merchant@example.invalid', 'synthetic-password'), {
      name: 'ApiError', status: 401, message: credentialsMessage,
    });
    assert.deepEqual(calls, ['/api/v1/auth/admin/password/login']);
  } finally { clearSession(); globalThis.fetch = original; }
});

test('login timeout, forbidden and rate-limit responses keep their distinct messages', async () => {
  const original = globalThis.fetch;
  clearSession();
  try {
    for (const [status, message, expected] of [
      [408, 'Request Timeout', '请求超时，请重试。'],
      [403, 'Forbidden', '无权执行此操作。'],
      [429, 'Too Many Requests', '操作过于频繁，请稍后重试。'],
    ] as const) {
      globalThis.fetch = async () => Response.json({ message }, { status });
      await assert.rejects(loginWithPassword('admin@example.invalid', 'synthetic-password'), { name: 'ApiError', status, message: expected });
    }
  } finally { clearSession(); globalThis.fetch = original; }
});

test('a late failed login cannot clear a newer successful administrator session', async () => {
  const original = globalThis.fetch;
  let finishOld!: (response: Response) => void;
  const laterAdmin = { ...admin, id: '902' };
  clearSession();
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    if (path.endsWith('/auth/login')) {
      const identifier = JSON.parse(String(options?.body)).identifier;
      if (identifier === 'old@example.invalid') return new Promise<Response>(resolve => { finishOld = resolve; });
      return Response.json({ accessToken: 'later-synthetic-token', user: laterAdmin });
    }
    assert.equal(path, '/api/v1/auth/me');
    return Response.json(laterAdmin);
  };
  try {
    const oldRequest = loginWithPassword('old@example.invalid', 'synthetic-password');
    const oldFailure = assert.rejects(oldRequest, error => error instanceof ApiError && error.message === credentialsMessage);
    assert.deepEqual(await loginWithPassword('later@example.invalid', 'synthetic-password'), laterAdmin);
    finishOld(Response.json({ message: 'Invalid credentials' }, { status: 401 }));
    await oldFailure;
    assert.deepEqual(await restoreSession(), laterAdmin);
  } finally { clearSession(); globalThis.fetch = original; }
});

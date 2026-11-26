import { settingErrorFields } from '../utils/platformSettings';
import { validOwnPasswordResult, type OwnPasswordInput } from '../utils/accountSecurity';
import { logoutIntent, markExplicitLogout, acceptExplicitLogin } from './logoutIntent';
export interface SessionUser { id: string | number; role: string; name?: string; email?: string; }
interface LoginResponse { accessToken: string; user?: SessionUser; }
export class ApiError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;
  constructor(message: string, status = 0, code?: string, fields?: Record<string, string>) {
    super(message); this.status = status; this.code = code; this.fields = fields; this.name = 'ApiError';
  }
}
let accessToken: string | null = null;
let profile: SessionUser | null = null;
let requiredSessionRole: 'ADMIN' | null = null;
let sessionVersion = 0;
let refreshPromise: Promise<void> | null = null;
let refreshVersion: number | null = null;
let refreshRole: 'ADMIN' | null = null;
let restorePromise: Promise<SessionUser | null> | null = null;
let restoreVersion: number | null = null;
let restoreRole: 'ADMIN' | null = null;
const pendingRequests = new Set<AbortController>();
const listeners = new Set<(user: SessionUser | null, reason?: string) => void>();
function announce(reason?: string) { listeners.forEach(listener => listener(profile, reason)); }
export function subscribeSession(listener: (user: SessionUser | null, reason?: string) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function clearSession(reason?: string) {
  accessToken = null; profile = null; requiredSessionRole = null; sessionVersion += 1;
  refreshRole = null; restoreRole = null;
  pendingRequests.forEach(controller => controller.abort()); pendingRequests.clear(); announce(reason);
}
export function currentManagementSessionKey(): string | null {
  return profile && accessToken ? `${sessionVersion}:${profile.role}:${profile.id}` : null;
}
export function discardManagementSession(expectedKey: string): boolean {
  if (currentManagementSessionKey() !== expectedKey) return false;
  clearSession('请重新登录核对密码修改结果。'); return true;
}
function errorMessage(body: any, fallback: string) {
  const message = body?.error?.message ?? body?.message ?? (typeof body?.error === 'string' ? body.error : undefined);
  const labels: Record<string, string> = {
    Unauthorized: '身份验证未通过，请核对账号或重新登录。',
    Forbidden: '无权执行此操作。', 'Forbidden resource': '无权访问此内容。',
    'Not Found': '请求的记录或页面不存在，请刷新核对。',
    'Bad Request': '提交内容不符合要求，请检查表单。',
    'Too Many Requests': '操作过于频繁，请稍后重试。',
    'ThrottlerException: Too Many Requests': '操作过于频繁，请稍后重试。',
    'Internal Server Error': '管理服务暂时异常，请稍后重试。',
    'Internal server error': '管理服务暂时异常，请稍后重试。',
    'Service Unavailable': '管理服务暂不可用，请稍后重试。',
    'Request Timeout': '请求超时，请重试。',
    Conflict: '记录已发生变化或存在冲突，请刷新核对。',
    'A record with that unique value already exists': '具有相同唯一值的记录已存在。',
  };
  const localize = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    const trimmed = value.trim();
    if (/[\u3400-\u9fff]/.test(trimmed)) return trimmed;
    if (Object.hasOwn(labels, trimmed)) return labels[trimmed];
    if (/^Cannot (?:GET|POST|PUT|PATCH|DELETE) /i.test(trimmed)) return labels['Not Found'];
    if (/\b(?:must|should|each value|is not allowed|is invalid)\b/i.test(trimmed)) return labels['Bad Request'];
    return fallback;
  };
  return Array.isArray(message) && message.length ? [...new Set(message.map(localize))].join('；') : localize(message);
}
type ReadSuccess<T> = (response: Response) => Promise<T>;

async function send<T>(path: string, options: RequestInit = {}, authenticated = true, readSuccess?: ReadSuccess<T>): Promise<T> {
  const controller = new AbortController(); pendingRequests.add(controller);
  const headers = new Headers(options.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (authenticated && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  try {
    const signals = [controller.signal, AbortSignal.timeout(15000)]; if (options.signal) signals.push(options.signal);
    const response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: 'include', signal: AbortSignal.any(signals) });
    if (response.ok && readSuccess) return await readSuccess(response);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const settingFields = settingErrorFields(body?.error) ?? settingErrorFields(body);
      const message = response.status === 401 && path === '/auth/password/change' && (body?.error?.code ?? body?.code) === 'CURRENT_PASSWORD_INVALID'
        ? '当前密码不正确，请重新输入。' : response.status === 401
        ? path === '/auth/login' || path === '/auth/admin/password/login' ? '账号或密码错误。' : '登录已失效，请重新登录。'
        : settingFields?.value ?? errorMessage(body, `请求失败（${response.status}）`);
      throw new ApiError(message, response.status, body?.error?.code ?? body?.code, settingFields ?? body?.error?.fields ?? body?.fields);
    }
    if (body === null && response.status !== 204) throw new ApiError('服务返回的数据格式无效。');
    return body as T;
  } catch (error) {
    if (controller.signal.aborted || options.signal?.aborted || error instanceof ApiError) throw error;
    throw new ApiError(error instanceof DOMException && error.name === 'TimeoutError' ? '请求超时，请重试。' : '无法连接管理服务，请稍后重试。');
  } finally { pendingRequests.delete(controller); }
}
async function refreshAccess(role = requiredSessionRole) {
  if (logoutIntent()) throw new ApiError('已主动退出，请重新登录。', 401);
  if (!refreshPromise || refreshVersion !== sessionVersion || refreshRole !== role) {
    const version = sessionVersion;
    const identity = profile;
    const path = role === 'ADMIN' ? '/auth/admin/refresh' : '/auth/refresh';
    const request = send<LoginResponse>(path, { method: 'POST' }, false).then(result => {
      if (version !== sessionVersion || role !== requiredSessionRole) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
      if (logoutIntent()) throw new ApiError('已主动退出，请重新登录。', 401);
      if (!result?.accessToken) throw new ApiError('会话恢复结果无效，请重新登录。', 401);
      if (role && result.user?.role !== role) throw new ApiError('会话恢复结果无效，请重新登录。', 401);
      if (identity && (String(result.user?.id) !== String(identity.id) || result.user?.role !== identity.role)) throw new ApiError('其他管理页面已切换账号，请明确重新登录后再操作。', 401);
      accessToken = result.accessToken;
    }).finally(() => { if (refreshPromise === request) { refreshPromise = null; refreshVersion = null; refreshRole = null; } });
    refreshPromise = request;
    refreshVersion = version;
    refreshRole = role;
  }
  return refreshPromise;
}
export async function apiRequest<T>(path: string, options: RequestInit = {}, readSuccess?: ReadSuccess<T>): Promise<T> {
  const version = sessionVersion;
  const originalToken = accessToken;
  try {
    const result = await send<T>(path, options, true, readSuccess);
    if (version !== sessionVersion) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
    return result;
  }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || options.signal?.aborted || version !== sessionVersion) throw error;
    if (accessToken === originalToken) {
      try {
        await refreshAccess();
      } catch (refreshError) {
        if (version === sessionVersion && refreshError instanceof ApiError && (refreshError.status === 401 || refreshError.status === 403)) clearSession('登录已失效，请重新登录。');
        throw refreshError;
      }
    }
    try {
      if (version !== sessionVersion) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
      const result = await send<T>(path, options, true, readSuccess);
      if (version !== sessionVersion) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
      return result;
    } catch (retryError) {
      if (version === sessionVersion && retryError instanceof ApiError && retryError.status === 401) clearSession('登录已失效，请重新登录。');
      throw retryError;
    }
  }
}
async function loadProfile() {
  const result = await apiRequest<SessionUser | { user: SessionUser }>('/auth/me');
  const user = 'user' in result ? result.user : result;
  if (!user || user.id == null || typeof user.role !== 'string') throw new ApiError('账户资料无效，请重新登录。');
  return user;
}
async function loginAt(path: string, identifier: string, password: string) {
  clearSession(); requiredSessionRole = path === '/auth/admin/password/login' ? 'ADMIN' : null;
  const version = sessionVersion, intent = logoutIntent();
  try {
    const result = await send<LoginResponse>(path, { method: 'POST', body: JSON.stringify({ identifier: identifier.trim(), password }) }, false);
    if (version !== sessionVersion) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
    if (!result?.accessToken) throw new ApiError('登录结果无效，请重试。');
    accessToken = result.accessToken;
    const user = await loadProfile();
    if (version !== sessionVersion) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
    if (!acceptExplicitLogin(intent)) throw new DOMException('登录期间已退出，请重新登录。', 'AbortError');
    profile = user; announce(); return user;
  } catch (error) { if (version === sessionVersion) clearSession(); throw error; }
}
export function loginWithPassword(identifier: string, password: string) { return loginAt('/auth/login', identifier, password); }
export function loginWithAdminPassword(identifier: string, password: string) { return loginAt('/auth/admin/password/login', identifier, password); }
export function restoreSession(requiredRole: 'ADMIN' | null = null): Promise<SessionUser | null> {
  requiredSessionRole = requiredRole;
  if (logoutIntent()) { clearSession(); return Promise.resolve(null); }
  if (profile && accessToken) {
    if (requiredRole && profile.role !== requiredRole) { clearSession(); return Promise.resolve(null); }
    return Promise.resolve(profile);
  }
  if (!restorePromise || restoreVersion !== sessionVersion || restoreRole !== requiredRole) {
    const version = sessionVersion;
    const role = requiredRole;
    const request = (async () => {
      try {
        await refreshAccess(role);
        if (version !== sessionVersion || role !== requiredSessionRole) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
        const user = await loadProfile();
        if (version !== sessionVersion || role !== requiredSessionRole) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
        if (role && user.role !== role) throw new ApiError('会话恢复结果无效，请重新登录。', 401);
        profile = user; announce(); return user;
      } catch (error) {
        // A retired failure is cancellation, never evidence that the current
        // session is unauthenticated or that its restore should show an error.
        if (version !== sessionVersion || role !== requiredSessionRole) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
        clearSession();
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
        throw error;
      }
    })().finally(() => { if (restorePromise === request) { restorePromise = null; restoreVersion = null; restoreRole = null; } });
    restorePromise = request;
    restoreVersion = version;
    restoreRole = role;
  }
  return restorePromise;
}
export async function logoutSession() { markExplicitLogout(); clearSession(); await send('/auth/logout', { method: 'POST' }, false); }

export async function changeOwnPassword(input: OwnPasswordInput): Promise<void> {
  const owner = currentManagementSessionKey();
  if (!owner || !['ADMIN', 'MERCHANT', 'STAFF'].includes(profile?.role ?? '')) throw new ApiError('请先登录管理账号。', 401);
  // Never auto-refresh/replay a password change: a rejected old password is
  // distinct from session expiration and a lost reply may already have applied.
  const result = await send('/auth/password/change', { method: 'POST', body: JSON.stringify(input) });
  if (currentManagementSessionKey() !== owner) throw new DOMException('登录身份已变更，请重新操作。', 'AbortError');
  if (!validOwnPasswordResult(result)) throw new ApiError('密码修改结果尚未确认，请重新登录核对。');
  clearSession('密码已修改，请使用新密码重新登录。');
}

import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import { errorMessage, localizedErrorText } from '../utils/feedback';
import { logoutIntent, markExplicitLogout } from '../../../src/api/logoutIntent';

const options = {
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 15000, withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
};
const sessionClient = axios.create(options);
const client = axios.create(options);
let refreshPromise: Promise<boolean> | null = null;
let refreshGeneration: number | null = null;
let sessionGeneration = 0;
type RetryConfig = InternalAxiosRequestConfig & { sessionRetried?: boolean; sessionGeneration?: number };
const changedSession = () => new axios.CanceledError('登录身份已变更，请在当前账号下重新操作。');
export function beginSession(): number { return ++sessionGeneration; }
export function isCurrentSession(generation: number): boolean { return generation === sessionGeneration; }
export function currentSessionGeneration(): number { return sessionGeneration; }
function invalidateSession(generation: number, preservePendingRecovery = false): void {
  if (!isCurrentSession(generation)) return;
  beginSession();
  useAuthStore.getState().logout({ preservePendingRecovery });
}
export function restoreSession(): Promise<boolean> {
  if (logoutIntent()) { invalidateSession(sessionGeneration); return Promise.resolve(false); }
  if (!refreshPromise || refreshGeneration !== sessionGeneration) {
    const generation = sessionGeneration;
    const identity = useAuthStore.getState().merchant;
    let receivedRefreshResponse = false;
    const request = sessionClient.post('/auth/refresh').then(({ data }) => {
      receivedRefreshResponse = true;
      if (generation !== sessionGeneration) return false;
      if (logoutIntent()) { invalidateSession(generation); return false; }
      // Another management tab may have replaced the shared refresh cookie.
      // Never replay this account's command using that tab's different identity.
      if (identity && (String(data.user?.id) !== String(identity.id) || data.user?.role !== identity.role)) throw changedSession();
      useAuthStore.getState().setAuth(data.accessToken, data.user);
      return true;
    }).catch((error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      // A transport/server failure cannot settle a pending business request.
      // Retain only its opaque recovery marker; all auth state still clears.
      const transient = !receivedRefreshResponse && (status === undefined || status === 408 || (typeof status === 'number' && status >= 500));
      invalidateSession(generation, transient);
      return false;
    }).finally(() => { if (refreshPromise === request) { refreshPromise = null; refreshGeneration = null; } });
    refreshPromise = request;
    refreshGeneration = generation;
  }
  return refreshPromise;
}
export async function endSession(): Promise<void> {
  markExplicitLogout();
  const generation = beginSession();
  useAuthStore.getState().logout();
  try { await sessionClient.post('/auth/logout'); }
  finally { if (isCurrentSession(generation)) useAuthStore.getState().logout(); }
}
client.interceptors.request.use((config) => {
  const request = config as RetryConfig;
  if (request.sessionGeneration === undefined) request.sessionGeneration = sessionGeneration;
  if (!isCurrentSession(request.sessionGeneration)) throw changedSession();
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = 'Bearer ' + token;
  return config;
});
client.interceptors.response.use((res) => {
  const config = res.config as RetryConfig;
  if (config.sessionGeneration !== undefined && !isCurrentSession(config.sessionGeneration)) throw changedSession();
  return res;
}, async (error) => {
  const config = error.config as RetryConfig | undefined;
  if (config?.sessionGeneration !== undefined && !isCurrentSession(config.sessionGeneration)) return Promise.reject(changedSession());
  if (error.response?.status === 401 && config && !config.sessionRetried && !config.url?.startsWith('/auth/')) {
    config.sessionRetried = true;
    const restored = await restoreSession();
    if (config.sessionGeneration !== undefined && !isCurrentSession(config.sessionGeneration)) return Promise.reject(changedSession());
    if (restored) return client.request(config);
  }
  if (error.response?.status === 401 && config?.sessionRetried) invalidateSession(config.sessionGeneration ?? sessionGeneration);
  const message = errorMessage(error);
  error.message = message;
  const data = error.response?.data;
  if (data && typeof data === 'object' && !(data instanceof Blob)) {
    if (Array.isArray(data.message)) data.message = data.message.map((item: unknown) => localizedErrorText(item, message, error.response?.status));
    else if (typeof data.message === 'string') data.message = message;
    if (data.error && typeof data.error === 'object' && typeof data.error.message === 'string') data.error.message = message;
  }
  return Promise.reject(error);
});
export default client;

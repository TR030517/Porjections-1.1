import axios from 'axios';
import client, { beginSession, currentSessionGeneration, isCurrentSession } from './client';
import { useAuthStore } from '../stores/authStore';
import { validOwnPasswordResult, type OwnPasswordInput } from '../../../src/utils/accountSecurity';

export function currentManagementSessionKey(): string | null {
  const { merchant, token } = useAuthStore.getState();
  return merchant && token ? `${currentSessionGeneration()}:${merchant.role}:${merchant.id}` : null;
}
export function discardManagementSession(expectedKey: string): boolean {
  if (currentManagementSessionKey() !== expectedKey) return false;
  beginSession(); useAuthStore.getState().logout(); return true;
}
export async function changeOwnPassword(input: OwnPasswordInput): Promise<void> {
  const owner = currentManagementSessionKey(), generation = currentSessionGeneration();
  if (!owner) throw new Error('请先登录管理账号。');
  const { data } = await client.post('/auth/password/change', input);
  if (!isCurrentSession(generation) || currentManagementSessionKey() !== owner) throw new axios.CanceledError('登录身份已变更，请在当前账号下重新操作。');
  if (!validOwnPasswordResult(data)) throw new Error('密码修改结果尚未确认，请重新登录核对。');
  discardManagementSession(owner);
}

import axios from 'axios';
import client, { beginSession, endSession, isCurrentSession } from './client';
import { logoutIntent, acceptExplicitLogin } from '../../../src/api/logoutIntent';
import { useAuthStore, type MerchantUser } from '../stores/authStore';

export async function merchantLogin(identifier: string, password: string): Promise<void> {
  const generation = beginSession(), intent = logoutIntent();
  const { data } = await client.post<{ accessToken: string; user: MerchantUser }>('/auth/login', { identifier, password });
  if (!isCurrentSession(generation)) throw new axios.CanceledError('登录身份已变更，请重新登录。');
  if (!acceptExplicitLogin(intent)) throw new axios.CanceledError('登录期间已退出，请重新登录。');
  try { useAuthStore.getState().setAuth(data.accessToken, data.user); }
  catch (error) { if (isCurrentSession(generation)) await endSession().catch(() => undefined); throw error; }
}

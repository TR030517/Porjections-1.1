import React, { useState } from 'react';
import { LockKeyhole, Store } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { merchantWorkspaceUrl } from '../utils/merchantWorkspaceUrl';
export default function LoginPage() {
  const { login, error: sessionError, restore } = useAuthStore();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError('');
    try { await login(identifier.trim(), password); }
    catch (err) { setError(err instanceof Error ? err.message : '登录失败，请重试。'); }
    finally { setPassword(''); setPending(false); }
  };
  return <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-5 py-12">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 sm:p-9">
      <div className="mb-7 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><Store className="h-6 w-6" /></span><div><p className="text-xl font-semibold text-slate-900">Massajoy2.0</p><p className="mt-1 text-sm text-slate-500">运营管理平台</p></div></div>
      <h1 className="text-xl font-semibold text-slate-900">登录管理账户</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">仅限公司管理员登录；每店独立的商家账号请使用商家工作区。</p>
      {(error || sessionError) && <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">{error || sessionError}</div>}
      <form onSubmit={submit} className="mt-6 space-y-5">
        <label className="block space-y-2 text-sm text-slate-600"><span>账号或邮箱</span><input type="text" name="identifier" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={255} required value={identifier} disabled={pending} onChange={event => setIdentifier(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10" /></label>
        <label className="block space-y-2 text-sm text-slate-600"><span>密码</span><input type="password" name="password" autoComplete="current-password" required value={password} disabled={pending} onChange={event => setPassword(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10" /></label>
        <button type="submit" disabled={pending} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"><LockKeyhole className="h-4 w-4" />{pending ? '正在登录…' : '登录'}</button>
      </form>
      {sessionError && <button type="button" disabled={pending} onClick={() => void restore()} className="mt-4 text-sm text-teal-700">重试会话恢复</button>}
      <a href={merchantWorkspaceUrl('/')} className="mt-5 inline-block text-sm font-medium text-teal-700">前往商家工作区 →</a>
      <p className="mt-7 text-xs leading-5 text-slate-400">账号权限由服务器确认。密码或账户异常请联系平台管理员。</p>
    </section>
  </main>;
}

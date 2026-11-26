import { useEffect, useId, useRef, useState } from 'react';
import { ownPasswordError, ownPasswordFailure, type OwnPasswordInput } from '../utils/accountSecurity';
import { passwordPolicy } from '../../backend/src/common/password-policy';

export default function AccountSecurityDialog({ account, sessionKey, changePassword, onClose, onReauthenticate }: {
  account: { id: string | number; role: string; email?: string; name?: string };
  sessionKey: string;
  changePassword: (input: OwnPasswordInput) => Promise<void>;
  onClose: () => void;
  onReauthenticate: () => void;
}) {
  const id = useId(), currentInput = useRef<HTMLInputElement>(null), mounted = useRef(true), inFlight = useRef(false);
  const liveSession = useRef(sessionKey); liveSession.current = sessionKey;
  const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    mounted.current = true; const previous = document.activeElement as HTMLElement | null; currentInput.current?.focus();
    return () => { mounted.current = false; previous?.focus?.(); };
  }, []);
  useEffect(() => { setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setError(''); setUncertain(false); }, [sessionKey]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current || uncertain) return;
    const invalid = ownPasswordError(account.role, currentPassword, newPassword, confirmation);
    if (invalid) { setError(invalid); return; }
    const owner = sessionKey; inFlight.current = true; setSaving(true); setError('');
    try {
      await changePassword({ currentPassword, newPassword });
      if (mounted.current && liveSession.current === owner) { setCurrentPassword(''); setNewPassword(''); setConfirmation(''); onClose(); }
    } catch (failure) {
      if (mounted.current && liveSession.current === owner) {
        const outcome = ownPasswordFailure(failure); setError(outcome.message); setUncertain(outcome.uncertain); setCurrentPassword('');
      }
    } finally { inFlight.current = false; if (mounted.current && liveSession.current === owner) setSaving(false); }
  };
  const minimum = passwordPolicy(account.role)?.minimumUtf8Bytes ?? 12;
  return <div className="account-security-backdrop"><section role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} className="account-security-dialog" onKeyDown={event => {
    if (event.key === 'Escape' && !saving) { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') { const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')); const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}>
    <div className="account-security-heading"><h2 id={`${id}-title`}>账号与安全 · 修改密码</h2><button type="button" aria-label="关闭账号与安全" disabled={saving} onClick={onClose}>×</button></div>
    <p id={`${id}-description`}>仅修改当前登录账号的密码：<strong>{account.email || account.name || `#${account.id}`}</strong>。门店绑定、角色和账号启用状态保持不变。</p>
    <p>成功后所有设备上的旧登录会话均失效，请使用新密码重新登录。</p>
    <form onSubmit={submit}>
      <input type="text" name="username" value={account.email || String(account.id)} autoComplete="username" readOnly hidden />
      <label htmlFor={`${id}-current`}>当前密码</label><input ref={currentInput} id={`${id}-current`} name="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required maxLength={200} disabled={saving || uncertain} />
      <label htmlFor={`${id}-new`}>新密码</label><input id={`${id}-new`} name="newPassword" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required maxLength={72} disabled={saving || uncertain} aria-describedby={`${id}-policy`} />
      <p id={`${id}-policy`}>{minimum}–72 个 UTF-8 字节（英文和数字每个计 1 字节；一个常见汉字计 3 字节），不可包含换行。</p>
      <label htmlFor={`${id}-confirmation`}>确认新密码</label><input id={`${id}-confirmation`} name="confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required maxLength={72} disabled={saving || uncertain} />
      {error && <p role="alert" className="account-security-error">{error}</p>}
      <div className="account-security-actions"><button type="button" disabled={saving} onClick={onClose}>关闭</button>{uncertain ? <button type="button" className="account-security-primary" onClick={onReauthenticate}>重新登录核对</button> : <button type="submit" className="account-security-primary" disabled={saving}>{saving ? '正在修改…' : '修改密码并重新登录'}</button>}</div>
    </form>
    <p className="account-security-help">忘记当前密码请联系平台对接人核验身份；员工可请门店负责人协助联系。本窗口不提供跨账号重置。</p>
  </section></div>;
}

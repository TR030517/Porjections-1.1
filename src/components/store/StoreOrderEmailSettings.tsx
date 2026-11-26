import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { publicEmail } from '../../utils/publicContacts';
import { orderEmailOperationMatches, orderEmailRecovery, orderEmailSettingsSummary, readOrderEmailSettings, uncertainOrderEmailWrite,
  type OrderEmailSettingsApi, type OrderEmailSettingsView, type PendingOrderEmailOperation } from '../../utils/orderEmailSettings';
import type { BusinessLifecycleListener } from '../../utils/businessLifecycle';
import './StoreOrderEmailSettings.css';

export interface StoreOrderEmailSettingsProps {
  shopId: string; scopeKey: string; api: OrderEmailSettingsApi; isCurrent: () => boolean; disabled?: boolean;
  onLifecycleChange?: BusinessLifecycleListener; onSaved?: () => void;
  confirmEndReview?: () => Promise<boolean>;
}
const neutralError = (error: unknown) => error instanceof Error && /[\u3400-\u9fff]/u.test(error.message) ? error.message : '通知邮箱操作未完成，请核对当前设置。';
const accessDenied = (error: unknown) => { const row = error as { status?: number; response?: { status?: number } } | null; return [401, 403].includes(row?.status ?? row?.response?.status ?? 0); };

/** Shared by both management surfaces. Its draft and write fence do not belong
 * to the public profile form, and no notification address is made public. */
export default function StoreOrderEmailSettings({ shopId, scopeKey, api, isCurrent, disabled = false, onLifecycleChange, onSaved, confirmEndReview }: StoreOrderEmailSettingsProps) {
  const [view, setView] = useState<OrderEmailSettingsView | null>(null), [loadedKey, setLoadedKey] = useState('');
  const [email, setEmail] = useState(''), [initialEmail, setInitialEmail] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<PendingOrderEmailOperation | null>(null), [review, setReview] = useState<OrderEmailSettingsView | null>(null);
  const live = useRef({ scopeKey, shopId, isCurrent, api, disabled, generation: 0 });
  const mounted = useRef(false), locked = useRef(false), pendingRef = useRef(pending), readVersion = useRef(0);
  if (live.current.scopeKey !== scopeKey || live.current.shopId !== shopId) live.current = { scopeKey, shopId, isCurrent, api, disabled, generation: live.current.generation + 1 };
  else Object.assign(live.current, { isCurrent, api, disabled });
  pendingRef.current = pending;
  const renderedGeneration = live.current.generation;
  const current = () => mounted.current && renderedGeneration === live.current.generation && live.current.scopeKey === scopeKey && live.current.shopId === shopId && live.current.isCurrent();
  const capture = () => { const generation = live.current.generation; return () => generation === live.current.generation && current(); };
  const loaded = loadedKey === scopeKey && !!view;
  const dirty = loaded && (email.trim().toLowerCase() !== initialEmail || !!code);
  const blocked = !loaded || busy || !!pending || disabled;
  const accept = (value: OrderEmailSettingsView, resetDraft: boolean) => {
    setView(value); setLoadedKey(scopeKey);
    const initial = value.pending?.email ?? value.recipient ?? value.legacyCandidate ?? '';
    setInitialEmail(initial); if (resetDraft) { setEmail(initial); setCode(''); }
  };
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; readVersion.current++; }; }, []);
  useLayoutEffect(() => { onLifecycleChange?.({ dirty, busy, unknown: !!pending }); }, [dirty, busy, pending, onLifecycleChange]);
  useLayoutEffect(() => () => onLifecycleChange?.({ dirty: false, busy: false, unknown: false }), [onLifecycleChange]);
  useEffect(() => {
    const abort = new AbortController(), own = capture(), version = ++readVersion.current;
    locked.current = false; pendingRef.current = null; setPending(null); setReview(null); setView(null); setLoadedKey('');
    setEmail(''); setInitialEmail(''); setCode(''); setError(''); setNotice(''); setBusy(true);
    void api.read(abort.signal).then(value => { if (own() && !abort.signal.aborted && version === readVersion.current) accept(readOrderEmailSettings(value, shopId), true); })
      .catch(cause => { if (own() && !abort.signal.aborted && version === readVersion.current) setError(neutralError(cause)); })
      .finally(() => { if (own() && version === readVersion.current) setBusy(false); });
    return () => abort.abort();
  }, [scopeKey, shopId]);
  async function refresh() {
    if (locked.current || !current()) return;
    locked.current = true; const own = capture(), version = ++readVersion.current; setBusy(true); setError(''); setNotice(''); setReview(null);
    try {
      const value = readOrderEmailSettings(await live.current.api.read(), shopId); if (!own() || version !== readVersion.current) return;
      const operation = pendingRef.current;
      if (!operation) { accept(value, !dirty); setNotice('已重新读取当前通知邮箱设置，未发送新邮件。'); return; }
      const result = orderEmailRecovery(value, operation);
      if (result === 'UNRESOLVED') { setReview(value); setNotice('当前读回版本尚不能确认原请求的最终结果。原请求仍可能稍后生效，继续保留提交锁。'); return; }
      accept(value, result === 'MATCHED'); pendingRef.current = null; setPending(null);
      setNotice(result === 'MATCHED' ? '已读回与本次操作一致的当前配置，未重复提交或发送邮件。' : '设置已被后续操作更新；原版本已失效，未重复提交。请核对当前配置及保留的草稿。'); onSaved?.();
    } catch (cause) { if (own()) { if (accessDenied(cause)) { setView(null); setLoadedKey(''); setCode(''); } setError(neutralError(cause)); } }
    finally { if (own()) { locked.current = false; setBusy(false); } }
  }
  async function write(operation: PendingOrderEmailOperation, send: () => Promise<OrderEmailSettingsView>) {
    if (locked.current || pendingRef.current || !current() || live.current.disabled || !loaded) return;
    locked.current = true; const own = capture(); setBusy(true); setError(''); setNotice(''); setReview(null);
    let received = false;
    try {
      const value = readOrderEmailSettings(await send(), shopId); received = true; if (!own()) return;
      if (!orderEmailOperationMatches(value, operation)) throw new Error('操作回执与提交目标或版本不一致，请只读核对。');
      accept(value, true); setNotice(operation.kind === 'request' ? '验证码请求已处理。请在目标邮箱读取验证码；新地址完成验证后才会用于新事件。'
        : operation.kind === 'verify' ? '收件地址已验证并用于后续新事件；旧通知不会转寄，实际订单邮件结果请查看订单详情。' : '预约通知收件地址已停用，预约订单继续保存在后台。'); onSaved?.();
    } catch (cause) {
      if (!own()) return;
      if (received || uncertainOrderEmailWrite(cause)) { pendingRef.current = operation; setPending(operation); }
      else if (accessDenied(cause)) { setView(null); setLoadedKey(''); setCode(''); }
      else {
        // Failed code attempts and version conflicts can change server state.
        // Refresh it without resubmitting the code or discarding the draft.
        try { const latest = readOrderEmailSettings(await live.current.api.read(), shopId); if (own()) accept(latest, false); } catch (readError) { if (own() && accessDenied(readError)) { setView(null); setLoadedKey(''); setCode(''); } }
      }
      setError(neutralError(cause));
    } finally { if (own()) { locked.current = false; setBusy(false); } }
  }
  const request = () => {
    if (blocked || !view) return; const address = email.trim().toLowerCase();
    if (!publicEmail(address)) { setError('请填写一个有效的预约通知收件邮箱。'); return; }
    const requestId = crypto.randomUUID(), operation: PendingOrderEmailOperation = { kind: 'request', revision: view.revision, email: address, requestId };
    void write(operation, () => live.current.api.request({ email: address, expectedRevision: operation.revision, requestId }));
  };
  const verify = () => {
    if (blocked || !view?.pending || !['SENDING', 'SENT', 'UNKNOWN'].includes(view.pending.deliveryState)) return;
    if (!/^\d{6}$/.test(code)) { setError('请输入目标邮箱收到的6位验证码。'); return; }
    const operation: PendingOrderEmailOperation = { kind: 'verify', revision: view.revision, email: view.pending.email, challengeId: view.pending.challengeId };
    void write(operation, () => live.current.api.verify({ challengeId: operation.challengeId, code, expectedRevision: operation.revision }));
  };
  const disable = () => { if (!blocked && view) void write({ kind: 'disable', revision: view.revision }, () => live.current.api.disable({ expectedRevision: view.revision })); };
  const endReview = async () => {
    if (!review || !pendingRef.current || locked.current || !current() || !confirmEndReview) return;
    const own = capture(); locked.current = true; setBusy(true);
    try { if (await confirmEndReview() && own()) { accept(review, false); pendingRef.current = null; setPending(null); setReview(null); setNotice('已结束本次核对并保留草稿，未重复提交。原请求仍可能稍后生效，请先重新读取最新设置。'); } }
    finally { if (own()) { locked.current = false; setBusy(false); } }
  };
  const summary = orderEmailSettingsSummary(loaded ? view : null), titleId = `order-email-heading-${shopId}`;
  const pendingChallenge = loaded ? view?.pending : null;
  return <section id="store-order-email-settings" aria-labelledby={titleId} className="order-email-settings">
    <div className="order-email-settings__heading"><div><h3 id={titleId} tabIndex={-1}>预约通知收件邮箱</h3><p>私密收单地址，独立于公开联系邮箱和账号登录邮箱。首期只通知一个主收件人。</p></div><button type="button" onClick={() => void refresh()} disabled={busy} className="store-secondary-button">重新读取通知设置</button></div>
    {error && <p role="alert" className="order-email-settings__error">{error}</p>}
    {notice && <p role="status" className="order-email-settings__notice">{notice}</p>}
    <div role="status" className={`order-email-settings__summary is-${summary.level}`}><strong>{busy && !loaded ? '正在读取预约通知设置…' : summary.title}</strong><p>{summary.detail}</p></div>
    {loaded && <>
      <dl className="order-email-settings__facts"><div><dt>当前新事件收件人</dt><dd>{view?.recipient ?? '尚无已验证的有效收件人'}</dd></div>{view?.verifiedAt && <div><dt>收件地址验证时间</dt><dd>{new Date(view.verifiedAt).toLocaleString('zh-CN', { hour12: false })}（本机时间）</dd></div>}</dl>
      {view?.legacyCandidate && <p className="order-email-settings__legacy">历史公开邮箱候选：<strong>{view.legacyCandidate}</strong>。这是旧资料中的首个有效邮箱，仅格式有效，不能据此认定收件权已验证；请先核对，再发送验证码确认。</p>}
      <div className="order-email-settings__field"><label htmlFor={`order-email-recipient-${shopId}`}>新收件邮箱</label><input id={`order-email-recipient-${shopId}`} type="email" maxLength={255} value={email} disabled={blocked} autoComplete="off" onChange={event => { if (!locked.current && !pendingRef.current && current()) { setEmail(event.target.value); setNotice(''); } }} /><button type="button" onClick={request} disabled={blocked || !view?.delivery.configured}>向此地址发送验证码</button></div>
      {view?.recipient && <p className="order-email-settings__hint">修改过程中，当前已验证地址继续用于新事件。输入或发送验证码不会立即替换它，也不会公开新地址。</p>}
      {!view?.delivery.configured && <p className="order-email-settings__hint">验证邮件发送服务尚不可用，请先由平台配置。不能仅填写邮箱就视为验证通过。</p>}
      {pendingChallenge && <div className="order-email-settings__challenge"><p>待验证地址：<strong>{pendingChallenge.email}</strong>；剩余尝试 {pendingChallenge.attemptsRemaining} 次；有效期至 {new Date(pendingChallenge.expiresAt).toLocaleString('zh-CN', { hour12: false })}（本机时间）。</p><p>{pendingChallenge.deliveryState === 'SENT' ? '验证码发送请求已被接受；请以实际收到的验证码为准。' : pendingChallenge.deliveryState === 'UNKNOWN' ? '验证码邮件发送结果未确定，不会自动重发。如果目标邮箱已实际收到验证码，可在这里验证。' : pendingChallenge.deliveryState === 'FAILED' ? '验证码邮件未成功发送，请核对服务后重新发起。' : '验证码发送正在处理。若目标邮箱已收到验证码，可以直接验证；不会自动重发，请勿重复发送。'}</p><div className="order-email-settings__field"><label htmlFor={`order-email-code-${shopId}`}>邮箱验证码</label><input id={`order-email-code-${shopId}`} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={blocked || !['SENDING', 'SENT', 'UNKNOWN'].includes(pendingChallenge.deliveryState)} onChange={event => { if (!locked.current && !pendingRef.current && current()) setCode(event.target.value); }} /><button type="button" onClick={verify} disabled={blocked || !['SENDING', 'SENT', 'UNKNOWN'].includes(pendingChallenge.deliveryState)}>验证并启用新收件地址</button></div></div>}
      <p className="order-email-settings__hint">验证成功后只影响新产生的通知。既有通知保留原目的地指纹；修改地址不会把旧任务改投或补发到新地址。预约成功页也不代表商家已经收到邮件。</p>
      <div className="order-email-settings__field"><button type="button" onClick={disable} disabled={blocked || view?.state === 'DISABLED'}>停用预约通知收件地址</button><button type="button" disabled={blocked || !dirty} onClick={() => { if (!locked.current && !pendingRef.current && current() && view) { accept(view, true); setError(''); setNotice('已放弃尚未提交的通知邮箱草稿，已保存的收件设置保持。'); } }}>放弃通知邮箱草稿</button></div>
    </>}
    {pending && <div role="status" className="order-email-settings__unknown"><strong>操作结果尚未确认，当前草稿已保留。</strong><p>请点击“重新读取通知设置”核对。只读查询不会再次发送验证码、验证或停用；在结果确认前不能重复提交。</p>{review && confirmEndReview && <button type="button" disabled={busy} onClick={() => void endReview()}>结束核对并保留草稿</button>}</div>}
  </section>;
}

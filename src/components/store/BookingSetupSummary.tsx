import { useEffect, useState } from 'react';
import { bookingSetupIssues, type BookingSetupConfig, type BookingSetupIssue } from '../../utils/bookingSetup';
import './BookingSetupSummary.css';

export function BookingSetupFindings({ issues, onConfigure }: { issues: BookingSetupIssue[]; onConfigure: (issue: BookingSetupIssue) => void }) {
  if (!issues.length) return <p className="booking-setup-summary__ready">这些已保存主项目的每周基础配置已齐备；具体日期仍须查询可用时段。</p>;
  return <><ul className="booking-setup-summary__rows">{issues.slice(0, 6).map(issue => <li key={issue.key} className="booking-setup-summary__row"><span><strong>{issue.serviceName}</strong>{issue.message}</span><button type="button" onClick={() => onConfigure(issue)}>{issue.action}</button></li>)}</ul>{issues.length > 6 && <p className="booking-setup-summary__message">共 {issues.length} 项待完善，先显示前 6 项；补齐后可刷新继续查看。</p>}</>;
}

export default function BookingSetupSummary({ shopId, scopeKey, revision, serviceIds, load, onConfigure }: {
  shopId: string; scopeKey: string; revision: string | number; serviceIds: string[];
  load: (signal: AbortSignal) => Promise<BookingSetupConfig>; onConfigure: (issue: BookingSetupIssue) => void;
}) {
  const [reload, setReload] = useState(0);
  const key = JSON.stringify([scopeKey, shopId, revision, serviceIds, reload]);
  const [result, setResult] = useState<{ key: string; config?: BookingSetupConfig; error?: string }>();
  useEffect(() => {
    if (!serviceIds.length) return;
    let current = true; const controller = new AbortController();
    void load(controller.signal).then(config => {
      if (String(config.shopId) !== shopId) throw Error('Wrong shop');
      if (current) setResult({ key, config });
    }).catch(() => { if (current) setResult({ key, error: '暂时无法读取本店预约配置。请重试，或由具备预约配置权限的账号完善；当前价目草稿保留。' }); });
    return () => { current = false; controller.abort(); };
  }, [key, load]);
  if (!serviceIds.length) return null;
  const snapshot = result?.key === key ? result : undefined;
  const issues = snapshot?.config ? bookingSetupIssues(snapshot.config, serviceIds) : [];
  return <section aria-label="已保存项目的预约配置" className="booking-setup-summary">
    <div className="booking-setup-summary__header"><h4>已保存项目 · 预约配置</h4><button type="button" onClick={() => setReload(value => value + 1)}>刷新配置摘要</button></div>
    <p className="booking-setup-summary__help">保存价目不等于已有空位。此处核对每周营业时间、本店技师共同班次、项目时长和空间配置；具体日期仍会扣除休假、维护和已有预约。</p>
    {!snapshot && <p role="status" className="booking-setup-summary__message">正在读取本店配置…</p>}
    {snapshot?.error && <p role="alert" className="booking-setup-summary__error">{snapshot.error}</p>}
    {snapshot?.config && <BookingSetupFindings issues={issues} onConfigure={onConfigure} />}
  </section>;
}

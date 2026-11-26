import React, { useState } from 'react';
import { Copy, Plus, X } from 'lucide-react';
import { copyStoreHours, WEEKDAYS } from './storeModel';
import type { StoreDraft } from './types';
import './StoreHoursEditor.css';

export default function StoreHoursEditor({ value, onChange }: { value: StoreDraft['businessHours']; onChange: (value: StoreDraft['businessHours']) => void }) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const change = (next: StoreDraft['businessHours']) => {
    setNotice(''); setError(''); onChange(next);
  };
  const copyMonday = () => {
    setNotice(''); setError('');
    try {
      onChange(copyStoreHours(value, WEEKDAYS[0], WEEKDAYS.slice(1)));
      setNotice('已将周一的营业状态和全部时段复制到周二至周日，保存修改后生效。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请检查周一的营业时段。');
    }
  };
  return <div className="store-hours-editor sm:col-span-2">
    <div className="store-hours-week" aria-label="每周营业时间">
    {WEEKDAYS.map((day, dayIndex) => {
      const hours = value[day];
      const periods = hours.periods ?? [{ start: hours.start, end: hours.end }];
      const update = (next: typeof periods) => change({ ...value, [day]: { ...hours, start: next[0].start, end: next[0].end, periods: next.length > 1 ? next : undefined } });
      return <div key={day} className="store-hours-day">
        <div className="store-hours-day-label">
          <button type="button" role="switch" aria-checked={hours.open} aria-label={day + '营业'} className="store-hours-toggle" onClick={() => change({ ...value, [day]: { ...hours, open: !hours.open } })}><span /></button>
          <span>{day}</span>
        </div>
        <div className="store-hours-periods">{periods.map((period, index) => <div key={index} className="store-hours-period">
          <input aria-label={day + '第' + (index + 1) + '段开始时间'} type="time" disabled={!hours.open} value={period.start} onChange={event => update(periods.map((p, i) => i === index ? { ...p, start: event.target.value } : p))} className="store-hours-time" />
          <span className="store-hours-separator">–</span>
          <input aria-label={day + '第' + (index + 1) + '段结束时间'} type="time" disabled={!hours.open} value={period.end} onChange={event => update(periods.map((p, i) => i === index ? { ...p, end: event.target.value } : p))} className="store-hours-time" />
          {periods.length > 1 ? <button type="button" disabled={!hours.open} aria-label={day + '删除第' + (index + 1) + '段'} title="删除时段" onClick={() => update(periods.filter((_, i) => i !== index))} className="store-hours-icon store-hours-remove"><X size={14} /></button> : <span />}
        </div>)}</div>
        <div className="store-hours-actions">
          <button type="button" disabled={!hours.open || periods.length >= 4} onClick={() => update([...periods, { start: '', end: '' }])} aria-label={day + '增加时段'} title="增加营业时段（最多4段）" className="store-hours-icon"><Plus size={14} /></button>
          {dayIndex === 0 ? <button type="button" onClick={copyMonday} aria-label="将周一营业时间复制到周二至周日" title="将周一的营业状态和全部时段复制到周二至周日" className="store-hours-icon store-hours-copy"><Copy size={15} /></button> : <span className="store-hours-copy-spacer" />}
        </div>
      </div>;
    })}
    </div>
    {error && <p role="alert" className="store-hours-error">{error}</p>}
    {notice && <p role="status" className="store-hours-notice">{notice}</p>}
    <p className="store-hours-help">周一右侧可一键复制到其余六天。每天最多4段，午休不开放预约；启用技师默认跟随门店营业时间，特殊安排可单独设置。</p>
  </div>;
}

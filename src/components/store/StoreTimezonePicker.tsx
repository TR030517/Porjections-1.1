import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { timezoneChoices, timezoneLabel } from '../../utils/storeTimezones';
import './StoreTimezonePicker.css';

export default function StoreTimezonePicker({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0), [now, setNow] = useState(Date.now);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 440, maxHeight: 360 });
  const choices = timezoneChoices(value, query, now), selected = timezoneChoices(value, '', now).find(item => item.value === value);
  const focused = Math.min(active, Math.max(0, choices.length - 1));
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  const choose = (next: string) => { if (disabled) return; onChange(next); close(true); };
  const show = () => { if (disabled) return; setQuery(''); setActive(Math.max(0, timezoneChoices(value, '', Date.now()).findIndex(item => item.value === value))); setNow(Date.now()); setOpen(true); };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>, stopped = false;
    const refresh = () => { if (stopped) return; setNow(Date.now()); clearTimeout(timer); timer = setTimeout(refresh, 60_000 - Date.now() % 60_000 + 20); };
    const visible = () => { if (!document.hidden) refresh(); };
    refresh(); document.addEventListener('visibilitychange', visible); window.addEventListener('focus', refresh);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.min(Math.max(rect.width, 440), window.innerWidth - 24), below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      const upwards = below < 220 && above > below, maxHeight = Math.max(120, Math.min(360, upwards ? above : below));
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: upwards ? rect.top - maxHeight - 6 : rect.bottom + 6, width, maxHeight });
    };
    place(); search.current?.focus();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${focused}`)?.scrollIntoView({ block: 'nearest' }); }, [focused, open, id, query]);

  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation();
      const dialog = trigger.current?.closest('[role="dialog"]');
      const controls = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(node => node.getClientRects().length > 0 && node.tabIndex >= 0) : [];
      const index = controls.indexOf(trigger.current!);
      close();
      if (index >= 0) controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      else trigger.current?.focus();
    }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
    else if (event.key === 'Enter' && choices[focused]) { event.preventDefault(); choose(choices[focused].value); }
  };
  return <>
    <button id="store-timezone" ref={trigger} type="button" role="combobox" aria-label="门店时区" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-haspopup="listbox" disabled={disabled} className="store-control store-timezone-trigger" onClick={() => open ? close() : show()} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); show(); } else if (event.key === 'Escape') close(); }}>
      <span className={value ? '' : 'store-timezone-placeholder'}>{selected ? timezoneLabel(selected) : value || '请选择实际门店时区'}</span>
      {selected && <time className="store-timezone-clock">{selected.time}</time>}<ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popup} className="store-timezone-popup" style={position} onKeyDown={keyDown}>
      <div className="store-timezone-search"><Search size={15} aria-hidden="true" /><input ref={search} type="search" aria-label="搜索城市或 IANA 时区" aria-controls={`${id}-list`} aria-activedescendant={choices.length ? `${id}-option-${focused}` : undefined} value={query} placeholder="搜索城市或 IANA 时区" onChange={event => { setQuery(event.target.value); setActive(0); }} /></div>
      <div id={`${id}-list`} role="listbox" aria-label="门店时区与当地实时时间" className="store-timezone-options">
        {choices.map((item, index) => <button key={item.value} id={`${id}-option-${index}`} type="button" role="option" aria-selected={value === item.value} tabIndex={-1} title={item.value} className={'store-timezone-option' + (index === focused ? ' is-focused' : '') + (value === item.value ? ' is-selected' : '')} onPointerMove={() => setActive(index)} onClick={() => choose(item.value)}>
          <span className="store-timezone-name">{item.country && <><strong>{item.country}</strong> – </>}{item.city} ({item.abbreviation})</span><time className="store-timezone-clock">{item.time}</time><span className="store-timezone-check">{value === item.value && <Check size={13} aria-hidden="true" />}</span>
        </button>)}
        {!choices.length && <p className="store-timezone-empty">没有匹配项；也可输入完整 IANA 时区查找。</p>}
      </div>
    </div>, document.body)}
  </>;
}

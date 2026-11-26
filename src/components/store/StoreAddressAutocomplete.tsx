import { useEffect, useRef, useState } from 'react';

interface AddressParts { address: string; city: string; state: string; zipCode: string; }
interface PlaceSuggestion extends AddressParts { label: string; country: string; }
function place(value: any): PlaceSuggestion | null {
  const p = value?.properties;
  if (!p || typeof p !== 'object') return null;
  const street = typeof p.street === 'string' ? p.street.trim() : '';
  const number = typeof p.housenumber === 'string' ? p.housenumber.trim() : '';
  const name = typeof p.name === 'string' ? p.name.trim() : '';
  const address = [number, street || name].filter(Boolean).join(' ');
  const city = [p.city, p.town, p.village, p.municipality, p.locality].find(item => typeof item === 'string' && item.trim())?.trim() ?? '';
  const state = typeof p.state === 'string' ? p.state.trim() : '';
  const zipCode = typeof p.postcode === 'string' ? p.postcode.trim() : '';
  const country = typeof p.country === 'string' ? p.country.trim() : '';
  if (!address || !city || !state || !zipCode) return null;
  return { address, city, state, zipCode, country, label: [address, city, state, zipCode, country].filter(Boolean).join(', ') };
}

export default function StoreAddressAutocomplete({ value, city, state, zipCode, onChange, disabled = false }: {
  value: string; city: string; state: string; zipCode: string; onChange: (value: AddressParts) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState(''), [result, setResult] = useState<{ key: string; rows: PlaceSuggestion[] } | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const host = useRef<HTMLDivElement>(null), sequence = useRef(0), activeRequest = useRef<AbortController | null>(null);
  const draftKey = JSON.stringify([value, city, state, zipCode]), live = useRef({ draftKey, query, disabled });
  live.current = { draftKey, query, disabled };
  const rows = result?.key === draftKey && query === value ? result.rows : [];
  const clearSuggestions = () => { sequence.current++; activeRequest.current?.abort(); activeRequest.current = null; setResult(null); setLoading(false); setError(''); setOpen(false); };
  useEffect(() => {
    const revision = ++sequence.current;
    const text = query.trim();
    setResult(null); setError('');
    if (text.length < 4 || disabled || query !== value) { setLoading(false); return; }
    const abort = new AbortController(); activeRequest.current = abort; setLoading(true);
    const current = () => !abort.signal.aborted && sequence.current === revision && live.current.draftKey === draftKey && live.current.query === query && !live.current.disabled;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: text, limit: '8', lang: 'en' });
      void fetch(`https://photon.komoot.io/api/?${params}`, { signal: abort.signal, headers: { Accept: 'application/json' } })
        .then(response => { if (!response.ok) throw Error('ADDRESS_LOOKUP_FAILED'); return response.json(); })
        .then(data => {
          if (!current()) return;
          const features = Array.isArray(data?.features) ? data.features : [];
          setResult({ key: draftKey, rows: features.map(place).filter((row: PlaceSuggestion | null): row is PlaceSuggestion => !!row).slice(0, 8) });
          setActive(0); setOpen(true);
        }).catch(() => { if (current()) { setResult(null); setError('地址建议暂不可用，请稍后重试。'); setOpen(true); } })
        .finally(() => { if (current()) setLoading(false); });
    }, 300);
    return () => { window.clearTimeout(timer); abort.abort(); if (activeRequest.current === abort) activeRequest.current = null; };
  }, [query, disabled, draftKey, value]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  const choose = (row: PlaceSuggestion) => { if (live.current.disabled || result?.key !== live.current.draftKey || live.current.query !== query || !rows.includes(row)) return; clearSuggestions(); setQuery(''); onChange({ address: row.address, city: row.city, state: row.state, zipCode: row.zipCode }); };
  const updatePart = (part: 'city' | 'state' | 'zipCode', next: string) => { clearSuggestions(); setQuery(''); onChange({ address: value, city: part === 'city' ? next : city, state: part === 'state' ? next : state, zipCode: part === 'zipCode' ? next : zipCode }); };
  return <div ref={host} className="relative min-w-0 sm:col-span-2">
    <label htmlFor="store-address-search" className="mb-2 block space-y-2 text-sm text-slate-600"><span className="font-medium">门店地址</span>
      <input id="store-address-search" type="search" autoComplete="street-address" maxLength={500} value={value} disabled={disabled} onFocus={() => { if (query === value && query.trim().length >= 4) setOpen(true); }}
        onChange={event => { clearSuggestions(); setQuery(event.target.value); onChange({ address: event.target.value, city, state, zipCode }); setOpen(true); }} placeholder="输入街道地址，可选用完整地址建议" className="store-control" aria-expanded={open && rows.length > 0} aria-controls="store-address-suggestions" />
    </label>
    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
      {([['城市', 'city', city], ['州 / 省', 'state', state], ['邮政编码', 'zipCode', zipCode]] as const).map(([label, part, text]) => <label key={part} className="block space-y-2 text-sm text-slate-600"><span className="font-medium">{label}</span><input value={text} onChange={event => updatePart(part, event.target.value)} disabled={disabled} className="store-control" placeholder="可手动填写，也可选建议自动填入" /></label>)}
    </div>
    <p className="mt-2 text-xs leading-5 text-slate-400">完整地址建议可一键填入以上字段；建议仅作辅助，也可手动填写或修正。地址建议由 OpenStreetMap 地名服务提供。</p>
    {open && (loading || error || rows.length > 0) && <div id="store-address-suggestions" role="listbox" aria-label="地址建议" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
      {loading && <p role="status" className="p-3 text-sm text-slate-500">正在查找地址…</p>}
      {error && <p role="alert" className="p-3 text-sm text-amber-700">{error}</p>}
      {rows.map((row, index) => <button key={`${row.label}:${index}`} type="button" role="option" aria-selected={active === index} disabled={disabled} onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(row)} className="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-teal-50 aria-selected:bg-teal-50">
        <span className="block font-medium">{row.address}</span><span className="block text-xs text-slate-500">{[row.city, row.state, row.zipCode, row.country].filter(Boolean).join(', ')}</span>
      </button>)}
      {!loading && !error && !rows.length && <p className="p-3 text-sm text-slate-500">没有找到可补全的地址，请添加门牌号和街道后重试。</p>}
    </div>}
  </div>;
}

import { useId, useRef, useState, type Ref } from 'react';

export interface PriceMenuSuggestion { value: string; label: string; keywords?: readonly string[]; }
/** Editable text with bounded suggestions. Choosing a label writes only its value. */
export default function PriceMenuSuggestionInput({ value, onChange, suggestions, label, placeholder, maxLength, disabled, inputRef, openOnFocus = true }: {
  value: string; onChange: (value: string) => void; suggestions: readonly PriceMenuSuggestion[];
  label: string; placeholder: string; maxLength: number; disabled?: boolean; inputRef?: Ref<HTMLInputElement>; openOnFocus?: boolean;
}) {
  const id = useId(), host = useRef<HTMLDivElement>(null), localInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(-1);
  const term = query.trim().toLocaleLowerCase();
  const options = suggestions.filter(option => !term || [option.value, option.label, ...(option.keywords ?? [])].some(text => text.toLocaleLowerCase().includes(term))).slice(0, 30);
  const choose = (next: string) => { if (disabled) return; onChange(next); localInput.current?.focus(); setOpen(false); setActive(-1); };
  return <div className="price-menu-suggest" ref={host} onBlur={event => { if (!host.current?.contains(event.relatedTarget as Node | null)) { setOpen(false); setActive(-1); } }}>
    <div className="price-menu-suggest-control"><input ref={node => { localInput.current = node; if (typeof inputRef === 'function') inputRef(node); else if (inputRef) inputRef.current = node; }}
      role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={!disabled && open} aria-controls={`${id}-options`} aria-activedescendant={open && active >= 0 && active < options.length ? `${id}-option-${active}` : undefined}
      value={value} maxLength={maxLength} disabled={disabled} placeholder={placeholder}
      onFocus={() => { if (!disabled) { setQuery(''); setOpen(openOnFocus); setActive(-1); } }}
      onChange={event => { if (disabled) return; onChange(event.target.value); setQuery(event.target.value); setOpen(true); setActive(-1); }}
      onKeyDown={event => {
        if (disabled) return;
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(index => options.length ? index < 0 ? event.key === 'ArrowDown' ? 0 : options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : -1); }
        else if (event.key === 'Enter' && open && active >= 0 && active < options.length) { event.preventDefault(); choose(options[active].value); }
        else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1); }
      }} />
      <button type="button" disabled={disabled} aria-label={`选择${label}常用建议`} aria-expanded={open} onMouseDown={event => event.preventDefault()} onClick={() => { if (disabled) return; localInput.current?.focus(); setQuery(''); setActive(-1); setOpen(!open); }}>⌄</button>
    </div>
    {!disabled && open && <div className="price-menu-suggest-popup"><div role="listbox" id={`${id}-options`} aria-label={`${label}常用建议`}>
      {options.map((option, index) => <button type="button" role="option" id={`${id}-option-${index}`} aria-selected={active === index} key={option.value} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.value)}><strong>{option.value}</strong><span>{option.label}</span></button>)}
      {!options.length && <p>没有匹配建议，保留你输入的自定义名称。</p>}
    </div><small>可直接选取，也可自由输入。</small></div>}
  </div>;
}

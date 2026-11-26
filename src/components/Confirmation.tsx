import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { subscribeSession } from '../api/session';

interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  reason?: {
    label: string;
    description: string;
    initialValue: string;
    maxLength: number;
    onConfirm: (reason: string) => void;
  };
}
const ConfirmationContext = createContext<(options: ConfirmationOptions) => Promise<boolean>>(() => Promise.resolve(false));

export function ConfirmationProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const requestRef = useRef<{ options: ConfirmationOptions; resolve: (value: boolean) => void } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const finish = (value: boolean) => {
    requestRef.current?.resolve(value);
    requestRef.current = null;
    setOptions(null);
    setReasonDraft('');
    previousFocus.current?.focus();
  };
  useEffect(() => {
    if (!options) return;
    cancelRef.current?.focus();
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) finish(false); };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [options]);
  useEffect(() => () => { requestRef.current?.resolve(false); }, []);
  useEffect(() => subscribeSession(user => { if (!user) finish(false); }), []);
  const confirm = (next: ConfirmationOptions) => {
    requestRef.current?.resolve(false);
    previousFocus.current = document.activeElement as HTMLElement | null;
    setReasonDraft(next.reason?.initialValue ?? '');
    setOptions(next);
    return new Promise<boolean>(resolve => { requestRef.current = { options: next, resolve }; });
  };
  const reason = options?.reason;
  const trimmedReason = reasonDraft.trim();
  const reasonValid = !reason || (trimmedReason.length > 0 && trimmedReason.length <= reason.maxLength);
  function close(accepted: boolean) {
    if (requestRef.current?.options !== options || (accepted && !reasonValid)) return;
    if (accepted) reason?.onConfirm(trimmedReason);
    finish(accepted);
  }
  function keepFocusInside(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last && first) {
      event.preventDefault();
      first.focus();
    }
  }
  return <ConfirmationContext.Provider value={confirm}>
    {children}
    {options && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4">
      <section role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message" className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl" onKeyDown={keepFocusInside}>
        <h2 id="confirmation-title" className="text-lg font-semibold text-slate-900">{options.title}</h2>
        <p id="confirmation-message" className="mt-3 text-sm leading-6 text-slate-600">{options.message}</p>
        {reason && <div className="mt-4 space-y-2">
          <label htmlFor="confirmation-reason" className="block text-sm font-medium text-slate-800">{reason.label}</label>
          <textarea id="confirmation-reason" aria-describedby="confirmation-reason-description" required maxLength={reason.maxLength} rows={3} value={reasonDraft} onChange={event => setReasonDraft(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800" />
          <p id="confirmation-reason-description" className="text-xs leading-5 text-slate-600">{reason.description}</p>
        </div>}
        <div className="mt-6 flex justify-end gap-3">
          <button ref={cancelRef} type="button" onClick={() => close(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm">取消</button>
          <button type="button" disabled={!reasonValid} onClick={() => close(true)} className={'rounded-lg px-4 py-2.5 text-sm text-white disabled:opacity-40 ' + (options.tone === 'primary' ? 'bg-brand' : 'bg-red-600')}>{options.confirmLabel ?? '确认'}</button>
        </div>
      </section>
    </div>}
  </ConfirmationContext.Provider>;
}

export function useConfirmation() { return useContext(ConfirmationContext); }

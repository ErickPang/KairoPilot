import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';

interface Props {
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  kind?: string;
  busy?: boolean;
  closeOnBackdrop?: boolean;
  returnFocus?: HTMLElement | null;
  onClose: () => void;
}

export function WorkbenchDialog({ title, children, actions, className = '', kind, busy = false, closeOnBackdrop = true, returnFocus, onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, busy }); latest.current = { onClose, busy };
  const root = document.querySelector('.workbench-app');
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const previous = returnFocus || document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(overlay.querySelectorAll<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    const first = () => overlay.querySelector<HTMLElement>('[data-autofocus]') || focusable()[0] || overlay;
    first().focus({ preventScroll: true });
    const isTop = () => { const dialogs = document.querySelectorAll('.modal-overlay'); return dialogs[dialogs.length - 1] === overlay; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!latest.current.busy) latest.current.onClose(); }
      if (event.key === 'Tab') {
        const items = focusable(); const start = items[0], end = items[items.length - 1];
        if (!start) { event.preventDefault(); overlay.focus(); }
        else if (event.shiftKey && document.activeElement === start) { event.preventDefault(); end.focus(); }
        else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); start.focus(); }
      }
      if ((event.metaKey || event.ctrlKey) && /^[1-6nkl]$/i.test(event.key)) event.stopPropagation();
    };
    const onFocus = (event: FocusEvent) => { if (isTop() && !overlay.contains(event.target as Node)) first().focus({ preventScroll: true }); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKeyDown); document.removeEventListener('focusin', onFocus);
      queueMicrotask(() => { if (previous?.isConnected && !previous.hasAttribute('disabled')) previous.focus({ preventScroll: true }); });
    };
  }, [returnFocus]);
  if (!root) return null;
  return createPortal(<div ref={overlayRef} className="modal-overlay" data-dialog-kind={kind} tabIndex={-1} onClick={event => { if (event.target === event.currentTarget && closeOnBackdrop && !busy) onClose(); }}>
    <div className={`modal-content workbench-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
      <div className="modal-header"><h3 id={titleId}>{title}</h3><button type="button" className="close-btn" disabled={busy} aria-label={t('common.close')} onClick={onClose}><X size={18}/></button></div>
      <div className="modal-body">{children}</div>
      {actions && <div className="modal-actions">{actions}</div>}
    </div>
  </div>, root);
}

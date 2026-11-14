// Themed replacement for window.confirm(). Renders inline (position: fixed), so it inherits the
// page's CSS variables. Escape / backdrop click cancels; focus starts on the safe button.

import { useEffect, useRef, useState } from 'react';
import './confirmDialog.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button + exit animation for destructive actions. */
  danger?: boolean;
  /** Optional visual shown above the title (e.g. the tape being deleted). */
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

const EXIT_MS = 380;

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  const confirmTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);

  useEffect(() => {
    if (!open) {
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = undefined;
      setLeaving(false);
      return;
    }
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const confirm = () => {
    if (!danger) return onConfirm();
    if (confirmTimer.current !== undefined) return;
    // Let the "toss it" animation play before the item disappears.
    setLeaving(true);
    confirmTimer.current = window.setTimeout(() => { confirmTimer.current = undefined; onConfirm(); }, EXIT_MS);
  };

  return (
    <div className={`cd-backdrop${leaving ? ' leaving' : ''}`} onClick={leaving ? undefined : onCancel}>
      <div
        className={`cd${danger ? ' cd-danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cd-title"
        aria-describedby="cd-message"
        onClick={(e) => e.stopPropagation()}
      >
        {children && <div className="cd-visual">{children}</div>}
        <h2 id="cd-title">{title}</h2>
        <p id="cd-message">{message}</p>
        <div className="cd-actions">
          <button ref={cancelRef} type="button" className="cd-btn" onClick={onCancel} disabled={leaving}>
            {cancelLabel}
          </button>
          <button type="button" className="cd-btn cd-confirm" onClick={confirm} disabled={leaving}>
            {danger && (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

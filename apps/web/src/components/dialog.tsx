'use client';

import { createContext, useContext, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Set by a page or tab that hosts a dialog's content in place (e.g. Workflows
 * inside the Automations view, User groups inside Workspace settings). The
 * hosted Dialog then renders as an ordinary section instead of a modal. `label`
 * is what the host already shows as a heading, so a matching title isn't repeated.
 */
const InlineDialogContext = createContext<{ label?: string } | null>(null);

export function InlineDialogHost({ label, children }: { label?: string; children: React.ReactNode }) {
  return <InlineDialogContext.Provider value={{ label }}>{children}</InlineDialogContext.Provider>;
}

export function Dialog(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const inline = useContext(InlineDialogContext);
  if (inline) {
    return (
      <section aria-label={props.title}>
        {props.title !== inline.label && (
          <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-ink">{props.title}</h2>
        )}
        {/* Anything the content opens itself (confirmations, editors) is a real modal again. */}
        <InlineDialogContext.Provider value={null}>{props.children}</InlineDialogContext.Provider>
      </section>
    );
  }
  return <ModalDialog {...props} />;
}

function ModalDialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Move focus into the dialog on open and restore it to the previously focused
  // element on close, so keyboard users aren't dumped back at the top of the page.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      // Trap Tab focus within the dialog.
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !panel.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-gray-950/40 px-4 pt-[8vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} animate-pop-in overflow-hidden rounded-xl border border-line bg-overlay text-ink shadow-pop outline-none`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id={titleId} className="text-[14px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="icon-btn -mr-1.5"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="thin-scrollbar max-h-[74vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

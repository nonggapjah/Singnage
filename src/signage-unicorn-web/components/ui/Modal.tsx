'use client';

import React, { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Accessible modal shell shared by every dialog in the admin console.
 *
 * - role="dialog" + aria-modal + aria-labelledby (pass `title`, or put the id
 *   from `labelledBy` on your own heading)
 * - Escape closes (unless `closeDisabled`, e.g. while a request is running)
 * - focus moves into the dialog on open, is trapped inside it, and returns to
 *   the element that opened it on close
 * - backdrop click closes (unless `closeOnBackdrop={false}` or `closeDisabled`)
 * - body scroll is locked while open
 *
 * Stacking: dialogs open on top of each other (a confirmation over an editor,
 * an error notice over a form). A module-level stack of open instances makes
 * ONLY the topmost dialog react to Escape and own the Tab focus trap, and the
 * body scroll lock is released only when the last dialog closes. Without this,
 * every open dialog's capture-phase keydown listener fired for one Escape, so
 * closing an error notice also closed the editor underneath and discarded its
 * unsaved input.
 *
 * The visual chrome is deliberately minimal (card surface, border, radius) so
 * each dialog keeps its own header and layout.
 */
export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Accessible name. Rendered visually hidden unless `showTitle` is set. */
    title?: string;
    /** Render the title as a visible heading above the content. */
    showTitle?: boolean;
    /** Id of a heading inside `children` that names the dialog (alternative to `title`). */
    labelledBy?: string;
    /** Id of an element inside `children` that describes the dialog. */
    describedBy?: string;
    /** Width preset. `none` leaves the width entirely to `className`. */
    size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' | 'none';
    /** Extra classes for the dialog panel. */
    className?: string;
    /** Extra classes for the outer positioning wrapper (e.g. items-start). */
    wrapperClassName?: string;
    /**
     * When true (default) the panel itself scrolls (max-h 90vh). Set false for
     * dialogs that manage their own flex layout and inner scroll region.
     */
    scroll?: boolean;
    /** Disable every close affordance while work is in progress. */
    closeDisabled?: boolean;
    closeOnBackdrop?: boolean;
    /** Show the built-in top-right close button. */
    showClose?: boolean;
    /** Element to focus when the dialog opens (defaults to the first focusable). */
    initialFocusRef?: React.RefObject<HTMLElement | null>;
    zIndexClass?: string;
    children: React.ReactNode;
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    full: 'max-w-5xl',
    none: '',
};

const FOCUSABLE =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Portals need a DOM; this is false during SSR/hydration and true afterwards, without a
// setState-in-effect round trip.
const subscribeNoop = () => () => {};
const useIsClient = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

// ---------------------------------------------------------------------------
// Open-dialog stack (module-level, one per window). Topmost = last element.
// ---------------------------------------------------------------------------
const openStack: string[] = [];
let savedBodyOverflow: string | null = null;

function stackPush(id: string) {
    if (openStack.includes(id)) return;
    if (openStack.length === 0) {
        // First dialog: remember the page's own overflow so it can be restored exactly.
        savedBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
    openStack.push(id);
}

function stackRemove(id: string) {
    const i = openStack.lastIndexOf(id);
    if (i === -1) return;
    openStack.splice(i, 1);
    if (openStack.length === 0) {
        document.body.style.overflow = savedBodyOverflow ?? '';
        savedBodyOverflow = null;
    }
}

function isTopmost(id: string) {
    return openStack.length > 0 && openStack[openStack.length - 1] === id;
}

/** Test/diagnostic hook: how many dialogs are open right now. */
export function getOpenModalCount() {
    return openStack.length;
}

function getFocusable(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
    );
}

export const Modal: React.FC<ModalProps> = ({
    isOpen,
    onClose,
    title,
    showTitle = false,
    labelledBy,
    describedBy,
    size = 'md',
    className = '',
    wrapperClassName = '',
    scroll = true,
    closeDisabled = false,
    closeOnBackdrop = true,
    showClose = false,
    initialFocusRef,
    zIndexClass = 'z-[1000]',
    children,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const instanceId = useId();
    const generatedTitleId = useId();
    const titleId = labelledBy ?? (title ? generatedTitleId : undefined);
    const mounted = useIsClient();

    const requestClose = useCallback(() => {
        if (closeDisabled) return;
        onClose();
    }, [closeDisabled, onClose]);

    // Register in the stack, remember the opener, move focus in; undo all of it on close.
    useEffect(() => {
        if (!isOpen) return;

        stackPush(instanceId);
        openerRef.current = (document.activeElement as HTMLElement | null) ?? null;

        const focusTimer = window.setTimeout(() => {
            const panel = panelRef.current;
            if (!panel) return;
            const target =
                initialFocusRef?.current ??
                getFocusable(panel)[0] ??
                panel;
            target.focus({ preventScroll: true });
        }, 10);

        return () => {
            window.clearTimeout(focusTimer);
            stackRemove(instanceId);
            // Return focus to whatever opened this dialog. For a stacked dialog that is an
            // element inside the dialog underneath, which is exactly where focus belongs.
            const opener = openerRef.current;
            if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
                opener.focus({ preventScroll: true });
            }
        };
    }, [isOpen, initialFocusRef, instanceId]);

    // Escape closes, Tab stays inside the dialog -- for the TOPMOST dialog only.
    useEffect(() => {
        if (!isOpen) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (!isTopmost(instanceId)) return;
            if (e.key === 'Escape') {
                e.stopPropagation();
                requestClose();
                return;
            }
            if (e.key !== 'Tab') return;
            const panel = panelRef.current;
            if (!panel) return;
            const focusable = getFocusable(panel);
            if (focusable.length === 0) {
                e.preventDefault();
                panel.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement as HTMLElement | null;
            if (e.shiftKey && (active === first || !panel.contains(active))) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [isOpen, requestClose, instanceId]);

    if (!isOpen || !mounted) return null;

    const scrollClass = scroll ? 'max-h-[90vh] overflow-y-auto custom-scrollbar' : 'max-h-[90vh]';

    const dialog = (
        <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4 ${wrapperClassName}`}>
            <div
                className="absolute inset-0 bg-black/70 glass-blur"
                aria-hidden="true"
                onClick={closeOnBackdrop ? requestClose : undefined}
            />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={describedBy}
                tabIndex={-1}
                className={`relative w-full ${SIZE_CLASS[size]} ${scrollClass} bg-card text-card-foreground border border-border rounded-3xl shadow-2xl outline-none animate-in ${className}`}
            >
                {title && (
                    <h2 id={titleId} className={showTitle ? 'text-xl font-black uppercase tracking-tight px-6 pt-6' : 'sr-only'}>
                        {title}
                    </h2>
                )}
                {showClose && (
                    <button
                        type="button"
                        onClick={requestClose}
                        disabled={closeDisabled}
                        aria-label="Close dialog"
                        className="absolute top-4 right-4 z-10 p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                )}
                {children}
            </div>
        </div>
    );

    return createPortal(dialog, document.body);
};

export default Modal;

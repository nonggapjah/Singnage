'use client';

import React, { createContext, useContext, useState, useEffect, useSyncExternalStore } from 'react';
import { Modal } from '@/components/ui/Modal';

type Theme = 'dark' | 'light';
type FontSize = 'small' | 'medium' | 'large';

const THEMES: readonly Theme[] = ['dark', 'light'];
const FONT_SIZES: readonly FontSize[] = ['small', 'medium', 'large'];

interface ModalOptions {
    title: string;
    message: string;
    type?: 'INFO' | 'SUCCESS' | 'ERROR' | 'DANGER';
    onConfirm?: () => void;
    confirmText?: string;
    cancelText?: string;
}

interface UIContextType {
    theme: Theme;
    fontSize: FontSize;
    toggleTheme: () => void;
    toggleFontSize: () => void;
    showModal: (options: ModalOptions) => void;
    showNotify: (title: string, message: string, type?: ModalOptions['type']) => void;
    showConfirm: (title: string, message: string, onConfirm: () => void, type?: ModalOptions['type']) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Theme / font-size preferences live in localStorage and are read through
// useSyncExternalStore: the server snapshot is the default (dark / small), the
// client snapshot is whatever the user saved. React swaps them after hydration,
// so there is no setState-in-effect and no hydration mismatch.
// ---------------------------------------------------------------------------
const prefListeners = new Set<() => void>();

const subscribePrefs = (callback: () => void) => {
    prefListeners.add(callback);
    window.addEventListener('storage', callback);
    return () => {
        prefListeners.delete(callback);
        window.removeEventListener('storage', callback);
    };
};

const notifyPrefs = () => prefListeners.forEach((listener) => listener());

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    try {
        const value = localStorage.getItem(key);
        return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
    } catch {
        return fallback;
    }
}

function writePref(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Private mode / blocked storage: the in-memory value still updates via notify.
    }
    notifyPrefs();
}

const getTheme = () => readPref<Theme>('theme', THEMES, 'dark');
const getFontSize = () => readPref<FontSize>('fontSize', FONT_SIZES, 'small');
const getServerTheme = (): Theme => 'dark';
const getServerFontSize = (): FontSize => 'small';

export function UIProvider({ children }: { children: React.ReactNode }) {
    const theme = useSyncExternalStore(subscribePrefs, getTheme, getServerTheme);
    const fontSize = useSyncExternalStore(subscribePrefs, getFontSize, getServerFontSize);

    // Modal State
    const [modal, setModal] = useState<(ModalOptions & { isOpen: boolean })>({
        isOpen: false,
        title: '',
        message: '',
        type: 'INFO'
    });

    // The theme is driven entirely by the data-theme attribute; globals.css
    // defines every token for both values. (Inline --background/--foreground
    // overrides on <html> used to shadow the stylesheet and are gone.)
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.style.removeProperty('--background');
        document.documentElement.style.removeProperty('--foreground');
    }, [theme]);

    useEffect(() => {
        document.documentElement.setAttribute('data-font-size', fontSize);
    }, [fontSize]);

    const toggleTheme = () => {
        writePref('theme', theme === 'dark' ? 'light' : 'dark');
    };

    const toggleFontSize = () => {
        let newSize: FontSize = 'small';
        if (fontSize === 'small') newSize = 'medium';
        else if (fontSize === 'medium') newSize = 'large';
        else newSize = 'small';
        writePref('fontSize', newSize);
    };

    const showModal = (options: ModalOptions) => {
        setModal({ ...options, isOpen: true });
    };

    const closeModal = () => {
        setModal(prev => ({ ...prev, isOpen: false }));
    };

    const showNotify = (title: string, message: string, type: ModalOptions['type'] = 'INFO') => {
        showModal({ title, message, type });
    };

    const showConfirm = (title: string, message: string, onConfirm: () => void, type: ModalOptions['type'] = 'INFO') => {
        showModal({ title, message, type, onConfirm });
    };

    const tone = modal.type === 'SUCCESS'
        ? { icon: '✓', ring: 'bg-green-500/10 border-green-500/50 text-green-600 dark:text-green-400', title: 'text-green-600 dark:text-green-400', button: 'bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/50' }
        : modal.type === 'ERROR'
            ? { icon: '✕', ring: 'bg-red-500/10 border-red-500/50 text-red-600 dark:text-red-400', title: 'text-red-600 dark:text-red-400', button: 'bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/50' }
            : modal.type === 'DANGER'
                ? { icon: '⚠️', ring: 'bg-orange-500/10 border-orange-500/50 text-orange-600 dark:text-orange-400', title: 'text-orange-600 dark:text-orange-400', button: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border border-orange-500/50' }
                : { icon: 'ℹ️', ring: 'bg-accent-cyan/10 border-accent-cyan/50 text-accent-cyan', title: 'text-accent-cyan', button: 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/50' };

    return (
        <UIContext.Provider value={{ theme, fontSize, toggleTheme, toggleFontSize, showModal, showNotify, showConfirm }}>
            {children}

            {/* Global notification / confirmation dialog */}
            <Modal
                isOpen={modal.isOpen}
                onClose={closeModal}
                size="sm"
                labelledBy="ui-modal-title"
                describedBy="ui-modal-message"
                zIndexClass="z-[9999]"
                className="p-8 rounded-[2rem]"
            >
                <div className="mb-6 flex flex-col items-center text-center">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4 border-2 ${tone.ring}`} aria-hidden="true">
                        {tone.icon}
                    </div>
                    <h3 id="ui-modal-title" className={`text-xl font-black uppercase tracking-tighter ${tone.title}`}>
                        {modal.title}
                    </h3>
                    <p id="ui-modal-message" className="text-sm text-muted-foreground mt-3 leading-relaxed">
                        {modal.message}
                    </p>
                </div>

                <div className="flex gap-3 mt-4">
                    {modal.onConfirm ? (
                        <>
                            <button
                                type="button"
                                onClick={closeModal}
                                className="flex-1 py-3 rounded-xl bg-muted/30 text-muted-foreground font-bold hover:bg-muted/50 hover:text-foreground transition-colors uppercase tracking-widest text-xs"
                            >
                                {modal.cancelText || 'Cancel'}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    modal.onConfirm?.();
                                    closeModal();
                                }}
                                className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-colors ${modal.type === 'DANGER'
                                    ? 'bg-red-600 text-white hover:bg-red-500'
                                    : 'bg-accent-cyan text-black hover:bg-cyan-300'
                                    }`}
                            >
                                {modal.confirmText || (modal.type === 'DANGER' ? 'Confirm' : 'Continue')}
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={closeModal}
                            className={`w-full py-4 rounded-xl font-black uppercase tracking-widest text-xs transition-colors ${tone.button}`}
                        >
                            OK
                        </button>
                    )}
                </div>
            </Modal>
        </UIContext.Provider>
    );
}

export function useUI() {
    const context = useContext(UIContext);
    if (context === undefined) {
        throw new Error('useUI must be used within a UIProvider');
    }
    return context;
}

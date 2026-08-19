'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'dark' | 'light';
type FontSize = 'small' | 'medium' | 'large';

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

export function UIProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>('dark');
    const [fontSize, setFontSize] = useState<FontSize>('small');

    // Modal State
    const [modal, setModal] = useState<(ModalOptions & { isOpen: boolean })>({
        isOpen: false,
        title: '',
        message: '',
        type: 'INFO'
    });

    useEffect(() => {
        const savedTheme = localStorage.getItem('theme') as Theme || 'dark';
        const savedFontSize = localStorage.getItem('fontSize') as FontSize || 'small';
        setTheme(savedTheme);
        setFontSize(savedFontSize);
        applyTheme(savedTheme);
        applyFontSize(savedFontSize);
    }, []);

    const applyTheme = (t: Theme) => {
        document.documentElement.setAttribute('data-theme', t);
        if (t === 'light') {
            document.documentElement.style.setProperty('--background', '#ffffff');
            document.documentElement.style.setProperty('--foreground', '#171717');
        } else {
            document.documentElement.style.setProperty('--background', '#050507');
            document.documentElement.style.setProperty('--foreground', '#ffffff');
        }
    };

    const applyFontSize = (size: FontSize) => {
        document.documentElement.setAttribute('data-font-size', size);
    };

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    };

    const toggleFontSize = () => {
        let newSize: FontSize = 'small';
        if (fontSize === 'small') newSize = 'medium';
        else if (fontSize === 'medium') newSize = 'large';
        else newSize = 'small';

        setFontSize(newSize);
        localStorage.setItem('fontSize', newSize);
        applyFontSize(newSize);
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

    return (
        <UIContext.Provider value={{ theme, fontSize, toggleTheme, toggleFontSize, showModal, showNotify, showConfirm }}>
            {children}

            {/* Global Neon Modal */}
            {modal.isOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="w-full max-w-sm p-8 rounded-[2rem] border border-white/10 shadow-[0_0_80px_rgba(0,0,0,0.8)] relative overflow-hidden bg-[#0a0a0c]">
                        <div className="mb-6 flex flex-col items-center text-center">
                            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-4 border-2 ${modal.type === 'SUCCESS' ? 'bg-green-500/10 border-green-500/50 text-green-500 shadow-[0_0_30px_rgba(34,197,94,0.2)]' :
                                modal.type === 'ERROR' ? 'bg-red-500/10 border-red-500/50 text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.2)]' :
                                    modal.type === 'DANGER' ? 'bg-orange-500/10 border-orange-500/50 text-orange-500 shadow-[0_0_30px_rgba(249,115,22,0.2)]' :
                                        'bg-cyan-500/10 border-cyan-500/50 text-cyan-500 shadow-[0_0_30_rgba(0,242,255,0.2)]'
                                }`}>
                                {modal.type === 'SUCCESS' ? '✓' : modal.type === 'ERROR' ? '✕' : modal.type === 'DANGER' ? '⚠️' : 'ℹ️'}
                            </div>
                            <h3 className={`text-xl font-black uppercase tracking-tighter ${modal.type === 'SUCCESS' ? 'text-green-500' :
                                modal.type === 'ERROR' ? 'text-red-500' :
                                    modal.type === 'DANGER' ? 'text-orange-500' :
                                        'text-cyan-400'
                                }`}>
                                {modal.title}
                            </h3>
                            <p className="text-xs text-slate-400 font-mono mt-3 leading-relaxed">
                                {modal.message}
                            </p>
                        </div>

                        <div className="flex gap-3 mt-4">
                            {modal.onConfirm ? (
                                <>
                                    <button
                                        onClick={closeModal}
                                        className="flex-1 py-3 rounded-xl bg-white/5 text-slate-400 font-bold hover:bg-white/10 transition-all uppercase tracking-widest text-[10px]"
                                    >
                                        {modal.cancelText || 'ABORT'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            modal.onConfirm?.();
                                            closeModal();
                                        }}
                                        className={`flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all transform hover:-translate-y-0.5 ${modal.type === 'DANGER'
                                            ? 'bg-red-600 text-white shadow-[0_0_20px_rgba(239,68,68,0.3)]'
                                            : 'bg-cyan-500 text-black shadow-[0_0_20px_rgba(0,242,255,0.3)]'
                                            }`}
                                    >
                                        {modal.confirmText || (modal.type === 'DANGER' ? 'EXECUTE' : 'PROCEED')}
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={closeModal}
                                    className={`w-full py-4 rounded-xl font-black uppercase tracking-widest text-xs transition-all ${modal.type === 'SUCCESS' ? 'bg-green-500/20 text-green-500 border border-green-500/50' :
                                        modal.type === 'ERROR' ? 'bg-red-500/20 text-red-500 border border-red-500/50' :
                                            'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                                        }`}
                                >
                                    ACKNOWLEDGE
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
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

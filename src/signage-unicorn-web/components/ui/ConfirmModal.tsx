'use client';

import React from 'react';
import { AlertTriangle, Info, CheckCircle, X, Loader2 } from 'lucide-react';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string | null;
    variant?: 'danger' | 'warning' | 'info' | 'success';
    isLoading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'warning',
    isLoading = false,
    onConfirm,
    onCancel
}) => {
    if (!isOpen) return null;

    const getIcon = () => {
        switch (variant) {
            case 'danger': return <AlertTriangle className="text-red-500" size={32} />;
            case 'warning': return <AlertTriangle className="text-yellow-500" size={32} />;
            case 'success': return <CheckCircle className="text-green-500" size={32} />;
            default: return <Info className="text-accent-cyan" size={32} />;
        }
    };

    const getColors = () => {
        switch (variant) {
            case 'danger': return 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20';
            case 'warning': return 'bg-yellow-500 hover:bg-yellow-600 text-black shadow-yellow-500/20';
            case 'success': return 'bg-green-500 hover:bg-green-600 text-white shadow-green-500/20';
            default: return 'bg-accent-cyan hover:bg-cyan-400 text-black shadow-cyan-500/20'; // Info
        }
    };

    const getBorderColor = () => {
        switch (variant) {
            case 'danger': return 'border-red-500/20 bg-red-500/5';
            case 'warning': return 'border-yellow-500/20 bg-yellow-500/5';
            case 'success': return 'border-green-500/20 bg-green-500/5';
            default: return 'border-accent-cyan/20 bg-accent-cyan/5';
        }
    }

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
                onClick={!isLoading ? onCancel : undefined}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300">

                {/* Header Strip */}
                <div className={`h-1 w-full ${variant === 'danger' ? 'bg-red-500' : variant === 'warning' ? 'bg-yellow-500' : variant === 'success' ? 'bg-green-500' : 'bg-accent-cyan'}`} />

                <div className="p-6 sm:p-8 flex flex-col items-center text-center space-y-6">

                    {/* Icon Circle */}
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center border-2 shadow-[0_0_30px_rgba(0,0,0,0.2)] ${getBorderColor()}`}>
                        {getIcon()}
                    </div>

                    <div className="space-y-2 w-full">
                        <h3 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tight">
                            {title}
                        </h3>
                        <p className="text-sm text-gray-400 leading-relaxed font-medium">
                            {message}
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 w-full pt-2">
                        {cancelText && (
                            <button
                                onClick={onCancel}
                                disabled={isLoading}
                                className="flex-1 py-3 px-4 rounded-xl text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:bg-white/5 transition-all disabled:opacity-50"
                            >
                                {cancelText}
                            </button>
                        )}

                        <button
                            onClick={onConfirm}
                            disabled={isLoading}
                            className={`${cancelText ? 'flex-[1.5]' : 'flex-1'} py-3 px-6 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg flex items-center justify-center gap-2 ${getColors()} disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="animate-spin" size={16} />
                                    Processing...
                                </>
                            ) : (
                                confirmText
                            )}
                        </button>
                    </div>
                </div>

                {/* Close Button Top Right */}
                {!isLoading && (
                    <button
                        onClick={onCancel}
                        className="absolute top-4 right-4 p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-full transition-colors"
                    >
                        <X size={20} />
                    </button>
                )}
            </div>
        </div>
    );
};

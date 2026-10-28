'use client';

import React from 'react';
import { AlertTriangle, Info, CheckCircle, Loader2 } from 'lucide-react';
import { Modal } from './Modal';

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
    const getIcon = () => {
        switch (variant) {
            case 'danger': return <AlertTriangle className="text-red-500" size={32} aria-hidden="true" />;
            case 'warning': return <AlertTriangle className="text-yellow-500" size={32} aria-hidden="true" />;
            case 'success': return <CheckCircle className="text-green-500" size={32} aria-hidden="true" />;
            default: return <Info className="text-accent-cyan" size={32} aria-hidden="true" />;
        }
    };

    const getColors = () => {
        switch (variant) {
            case 'danger': return 'bg-red-500 hover:bg-red-600 text-white';
            case 'warning': return 'bg-yellow-500 hover:bg-yellow-600 text-black';
            case 'success': return 'bg-green-500 hover:bg-green-600 text-white';
            default: return 'bg-primary hover:bg-cyan-400 text-primary-foreground'; // Info
        }
    };

    const getBorderColor = () => {
        switch (variant) {
            case 'danger': return 'border-red-500/30 bg-red-500/5';
            case 'warning': return 'border-yellow-500/30 bg-yellow-500/5';
            case 'success': return 'border-green-500/30 bg-green-500/5';
            default: return 'border-accent-cyan/30 bg-accent-cyan/5';
        }
    };

    const stripColor = variant === 'danger' ? 'bg-red-500' : variant === 'warning' ? 'bg-yellow-500' : variant === 'success' ? 'bg-green-500' : 'bg-accent-cyan';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            size="md"
            closeDisabled={isLoading}
            showClose={!isLoading}
            labelledBy="confirm-modal-title"
            describedBy="confirm-modal-message"
            zIndexClass="z-[1100]"
            className="overflow-hidden"
        >
            {/* Header Strip */}
            <div className={`h-1 w-full ${stripColor}`} aria-hidden="true" />

            <div className="p-6 sm:p-8 flex flex-col items-center text-center space-y-6">

                {/* Icon Circle */}
                <div className={`w-16 h-16 rounded-full flex items-center justify-center border-2 ${getBorderColor()}`}>
                    {getIcon()}
                </div>

                <div className="space-y-2 w-full">
                    <h3 id="confirm-modal-title" className="text-xl sm:text-2xl font-black text-foreground uppercase tracking-tight">
                        {title}
                    </h3>
                    <p id="confirm-modal-message" className="text-sm text-muted-foreground leading-relaxed font-medium">
                        {message}
                    </p>
                </div>

                {/* Actions */}
                <div className="flex gap-3 w-full pt-2">
                    {cancelText && (
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={isLoading}
                            className="flex-1 py-3 px-4 rounded-xl text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
                        >
                            {cancelText}
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={isLoading}
                        className={`${cancelText ? 'flex-[1.5]' : 'flex-1'} py-3 px-6 rounded-xl text-xs font-black uppercase tracking-wider transition-colors shadow-lg flex items-center justify-center gap-2 ${getColors()} disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="animate-spin" size={16} aria-hidden="true" />
                                Processing…
                            </>
                        ) : (
                            confirmText
                        )}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

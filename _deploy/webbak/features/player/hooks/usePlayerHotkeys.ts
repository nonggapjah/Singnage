import { useEffect } from 'react';

type HotkeyHandlers = {
    onHelp?: () => void;      // F1
    onVolumeDown?: () => void; // F2
    onVolumeUp?: () => void;   // F3
    onExit?: () => void;       // F4
    onRefresh?: () => void;    // F5
    onSync?: () => void;       // F6
    onAdmin?: () => void;      // F7
    onReset?: () => void;      // F8
};

export const usePlayerHotkeys = (handlers: HotkeyHandlers) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // F5 is Refresh. We might want to allow default browser refresh OR handle custom logic.
            // For Kiosk mode, usually we intercept all F-keys.

            // Map keys
            switch (e.key) {
                case 'F1':
                    e.preventDefault();
                    handlers.onHelp?.();
                    break;
                case 'F2':
                    e.preventDefault();
                    handlers.onVolumeDown?.();
                    break;
                case 'F3':
                    e.preventDefault();
                    handlers.onVolumeUp?.();
                    break;
                case 'F4':
                    e.preventDefault();
                    handlers.onExit?.();
                    break;
                case 'F5':
                    // e.preventDefault(); // Let F5 refresh normally? Or custom refresh? Architecture says "Restart app logic".
                    // Usually F5 reload is fine. But if we want custom "Resume", we intercept.
                    e.preventDefault();
                    handlers.onRefresh?.();
                    break;
                case 'F6':
                    e.preventDefault();
                    handlers.onSync?.();
                    break;
                case 'F7':
                    e.preventDefault();
                    handlers.onAdmin?.();
                    break;
                case 'F8':
                    e.preventDefault();
                    handlers.onReset?.();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handlers]);
};

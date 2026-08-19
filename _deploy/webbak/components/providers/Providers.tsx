'use client';

import { AuthProvider } from '@/features/auth/context/AuthContext';
import { UIProvider } from '@/features/ui/context/UIContext';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <UIProvider>
            <AuthProvider>
                {children}
            </AuthProvider>
        </UIProvider>
    );
}

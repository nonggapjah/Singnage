'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/features/auth/api/auth-api';
import { clearLegacyCredentials, setLegacySessionToken, LEGACY_LOCAL_TOKEN_KEY } from '@/lib/api-fetch';
import type { LoginResponse, User } from '@/features/auth/types';

/**
 * Admin session state for the console.
 *
 * The credential itself is the httpOnly `su_session` cookie the API sets at login; this context
 * only keeps the non-sensitive user profile (name/role) so the shell can render it. The profile
 * lives in localStorage under `user` and is read through useSyncExternalStore so SSR, hydration
 * and cross-tab logout all agree without a setState-in-effect round trip.
 *
 * `su_auth_hint` is a plain (non-httpOnly, non-secret) cookie that mirrors "a login happened in
 * this browser". proxy.ts uses it, together with `su_session`, to send anonymous visitors of
 * /admin/* to /login; the API still validates every request.
 */
const USER_KEY = 'user';
const AUTH_HINT_COOKIE = 'su_auth_hint';

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedUser: User | null = null;

function readStoredUser(): User | null {
    if (typeof window === 'undefined') return null;
    let raw: string | null = null;
    try { raw = localStorage.getItem(USER_KEY); } catch { raw = null; }
    if (raw === cachedRaw) return cachedUser;
    cachedRaw = raw;
    if (!raw) {
        cachedUser = null;
    } else {
        try {
            const parsed = JSON.parse(raw);
            cachedUser = parsed && typeof parsed.username === 'string'
                ? { username: parsed.username, fullName: parsed.fullName ?? '', role: parsed.role ?? 'viewer' }
                : null;
        } catch {
            cachedUser = null;
        }
    }
    return cachedUser;
}

function writeStoredUser(user: User | null): void {
    try {
        if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
        else localStorage.removeItem(USER_KEY);
    } catch { /* storage unavailable */ }
    listeners.forEach((l) => l());
}

function subscribeUser(callback: () => void): () => void {
    listeners.add(callback);
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === USER_KEY) callback(); };
    window.addEventListener('storage', onStorage);
    return () => {
        listeners.delete(callback);
        window.removeEventListener('storage', onStorage);
    };
}

function setAuthHintCookie(present: boolean): void {
    if (typeof document === 'undefined') return;
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = present
        ? `${AUTH_HINT_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`
        : `${AUTH_HINT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

const getServerUser = () => null;
const subscribeNoop = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

interface AuthContextType {
    user: User | null;
    /** Pass the login response (`res.data`). Only the profile is kept; the session is the cookie. */
    login: (userData: LoginResponse | User) => void;
    logout: () => Promise<void>;
    isAuthenticated: boolean;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const user = useSyncExternalStore(subscribeUser, readStoredUser, getServerUser);
    const hydrated = useHydrated();

    // One-time migration (Codex round-3 #14): browsers upgraded from the pre-2.4 console may still hold
    // the old localStorage JWT; it must not outlive the move to the httpOnly session cookie.
    useEffect(() => {
        try { localStorage.removeItem(LEGACY_LOCAL_TOKEN_KEY); } catch { /* storage unavailable */ }
    }, []);

    const login = useCallback((userData: LoginResponse | User) => {
        clearLegacyCredentials();
        writeStoredUser({ username: userData.username, fullName: userData.fullName, role: userData.role });
        setAuthHintCookie(true);
        // Transitional: an API older than 2.8 returns a bearer token and sets no cookie. Keep it for
        // this tab only. A cookie-mode API omits `token` or says so, and nothing is stored.
        const legacy = 'token' in userData && userData.token && userData.authMode !== 'cookie' ? userData.token : null;
        setLegacySessionToken(legacy);
    }, []);

    const logout = useCallback(async () => {
        try { await authApi.logout(); } catch { /* best effort */ }
        clearLegacyCredentials();
        writeStoredUser(null);
        setAuthHintCookie(false);

        // The service worker no longer caches API responses, but drop the app-shell caches of
        // this worker anyway so nothing rendered for this session outlives it, and let the SW
        // pick up a newer version if one was deployed. Both are best-effort.
        if (typeof window !== 'undefined') {
            if ('caches' in window) {
                caches.keys()
                    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('unicorn-player-')).map((k) => caches.delete(k))))
                    .catch(() => undefined);
            }
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistration()
                    .then((reg) => reg?.update())
                    .catch(() => undefined);
            }
        }

        router.push('/login');
    }, [router]);

    const value = useMemo<AuthContextType>(() => ({
        user,
        login,
        logout,
        isAuthenticated: !!user,
        loading: !hydrated,
    }), [user, login, logout, hydrated]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

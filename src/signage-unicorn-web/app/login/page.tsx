'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/features/auth/api/auth-api';
import { useUI } from '@/features/ui/context/UIContext';
import { useAuth } from '@/features/auth/context/AuthContext';
import Link from 'next/link';

export default function LoginPage() {
    const { theme, fontSize, toggleTheme, toggleFontSize } = useUI();
    const { login } = useAuth();
    const [loginMethod, setLoginMethod] = useState<'email' | 'phone'>('email');
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            // Identifier can be username, email, or phone depending on the backend logic
            // Assuming the backend accepts any of these as the first argument
            const res = await authApi.login(identifier, password, loginMethod);
            if (res.success && res.data) {
                // The session now lives in an httpOnly cookie set by the API (contract T12); the
                // browser never sees the JWT. The context keeps only display fields (name, role).
                login(res.data);
                router.push('/admin/dashboard');
            } else {
                setError(res.message || 'Login failed');
            }
        } catch {
            setError('An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    const inputClass = 'w-full bg-muted/20 border border-border rounded-xl pl-12 pr-4 py-3 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-muted-foreground/70 font-medium';

    return (
        <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden bg-background text-foreground font-sans transition-colors duration-300">
            {/* Top Toolbar */}
            <div className="absolute top-8 right-8 flex items-center gap-4">
                <button
                    type="button"
                    onClick={toggleFontSize}
                    aria-label={`Change text size (current: ${fontSize})`}
                    title={`Text size: ${fontSize}`}
                    className="w-10 h-10 rounded-xl bg-muted/20 border border-border flex items-center justify-center hover:bg-muted/40 transition-colors"
                >
                    <div className="flex items-end gap-0.5" aria-hidden="true">
                        <span className={`font-bold ${fontSize === 'small' ? 'text-primary text-sm' : 'text-muted-foreground text-xs'}`}>A</span>
                        <span className={`font-bold ${fontSize === 'medium' ? 'text-primary text-base' : 'text-muted-foreground text-xs'}`}>A</span>
                        <span className={`font-bold ${fontSize === 'large' ? 'text-primary text-xl' : 'text-muted-foreground text-xs'}`}>A</span>
                    </div>
                </button>

                <button
                    type="button"
                    onClick={toggleTheme}
                    aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                    title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                    className="w-10 h-10 rounded-xl bg-muted/20 border border-border flex items-center justify-center text-lg hover:bg-muted/40 transition-colors"
                >
                    <span aria-hidden="true">{theme === 'dark' ? '🌙' : '☀️'}</span>
                </button>
            </div>

            {/* Main Card */}
            <div className="w-full max-w-md animate-in">
                <div className="text-center mb-10">
                    <h1 className="text-5xl font-black uppercase tracking-tighter mb-2 neon-text">
                        Signage Unicorn
                    </h1>
                    <p className="text-sm font-bold text-muted-foreground uppercase tracking-[0.2em]">Admin console</p>
                </div>

                <div className="bg-card/80 glass-blur border border-border p-10 rounded-3xl shadow-2xl relative overflow-hidden">
                    {/* Top accent */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-60" aria-hidden="true"></div>

                    {/* Login Method Toggle */}
                    <div className="flex p-1 bg-muted/30 border border-border rounded-xl mb-8 relative" role="group" aria-label="Sign-in method">
                        <button
                            type="button"
                            onClick={() => setLoginMethod('email')}
                            aria-pressed={loginMethod === 'email'}
                            className={`flex-1 py-3 px-4 rounded-lg text-sm font-bold transition-colors duration-200 relative z-10 ${loginMethod === 'email'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            Email account
                        </button>
                        <button
                            type="button"
                            onClick={() => setLoginMethod('phone')}
                            aria-pressed={loginMethod === 'phone'}
                            className={`flex-1 py-3 px-4 rounded-lg text-sm font-bold transition-colors duration-200 relative z-10 ${loginMethod === 'phone'
                                ? 'bg-primary text-primary-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            Phone / SMS
                        </button>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-1">
                            <label htmlFor="login-identifier" className="block text-xs font-black text-muted-foreground uppercase tracking-widest ml-1">
                                {loginMethod === 'email' ? 'Email address' : 'Phone number'}
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-muted-foreground" aria-hidden="true">
                                    {loginMethod === 'email' ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path></svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                    )}
                                </div>
                                <input
                                    id="login-identifier"
                                    name="username"
                                    type={loginMethod === 'email' ? 'email' : 'tel'}
                                    autoComplete="username"
                                    value={identifier}
                                    onChange={(e) => setIdentifier(e.target.value)}
                                    placeholder={loginMethod === 'email' ? 'name@example.com' : '0812345678'}
                                    className={inputClass}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label htmlFor="login-password" className="block text-xs font-black text-muted-foreground uppercase tracking-widest ml-1">Password</label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-muted-foreground" aria-hidden="true">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                </div>
                                <input
                                    id="login-password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className={inputClass}
                                    required
                                />
                            </div>
                        </div>

                        {error && (
                            <div role="alert" className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs py-3 px-4 rounded-xl text-center font-bold">
                                ⚠ {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className={`w-full py-4 rounded-xl font-black uppercase tracking-[0.2em] transition-colors shadow-xl text-sm relative overflow-hidden ${loading
                                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                : 'bg-primary text-primary-foreground border-2 border-primary hover:brightness-110'
                                }`}
                        >
                            <span className="relative z-10">{loading ? 'Signing in…' : 'Sign in'}</span>
                        </button>
                    </form>

                    <div className="mt-8 pt-8 border-t border-border text-center">
                        <Link href="/register" className="text-xs font-black text-muted-foreground uppercase tracking-widest hover:text-primary transition-colors">
                            Need access? Request an account
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

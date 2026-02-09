'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/features/auth/api/auth-api';
import { useUI } from '@/features/ui/context/UIContext';
import Link from 'next/link';

export default function LoginPage() {
    const { theme, fontSize, toggleTheme, toggleFontSize } = useUI();
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
                localStorage.setItem('accessToken', res.data.token);
                localStorage.setItem('user', JSON.stringify({
                    username: res.data.username,
                    fullName: res.data.fullName,
                    role: res.data.role
                }));
                router.push('/admin/dashboard');
            } else {
                setError(res.message || 'Login failed');
            }
        } catch (err) {
            setError('An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleAutoAdmin = async () => {
        setLoading(true);
        try {
            const res = await authApi.autoAdminLogin();
            if (res.success && res.data) {
                localStorage.setItem('accessToken', res.data.token);
                localStorage.setItem('user', JSON.stringify({
                    username: res.data.username,
                    fullName: res.data.fullName,
                    role: res.data.role
                }));
                router.push('/admin/dashboard');
            }
        } catch (err) {
            setError('Auto-login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden bg-[#050507] text-white font-sans transition-colors duration-300">
            {/* Background Gradients (Inline) */}
            <div className="absolute top-[-20%] left-[50%] -translate-x-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(157,0,255,0.15)_0%,transparent_70%)] pointer-events-none blur-3xl"></div>
            <div className="absolute bottom-[-20%] left-[0%] w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(0,242,255,0.08)_0%,transparent_70%)] pointer-events-none blur-3xl"></div>

            {/* Top Toolbar */}
            <div className="absolute top-8 right-8 flex items-center gap-4 animate-[fadeIn_1s_ease-out]">
                <button
                    onClick={toggleFontSize}
                    className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors relative group backdrop-blur-md"
                    title={`Font Size: ${fontSize.toUpperCase()}`}
                >
                    <div className="flex items-end gap-0.5">
                        <span className={`font-bold transition-all ${fontSize === 'small' ? 'text-[#00f2ff] text-sm' : 'text-gray-500 text-xs'}`}>A</span>
                        <span className={`font-bold transition-all ${fontSize === 'medium' ? 'text-[#00f2ff] text-base' : 'text-gray-500 text-xs'}`}>A</span>
                        <span className={`font-bold transition-all ${fontSize === 'large' ? 'text-[#00f2ff] text-xl' : 'text-gray-500 text-xs'}`}>A</span>
                    </div>
                </button>

                <button
                    onClick={toggleTheme}
                    className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg hover:bg-white/10 transition-colors shadow-lg backdrop-blur-md"
                >
                    {theme === 'dark' ? '🌙' : '☀️'}
                </button>
            </div>

            {/* Main Card */}
            <div className="w-full max-w-md animate-[zoomIn_0.7s_ease-out]">
                <div className="text-center mb-10">
                    <h1 className="text-5xl font-black uppercase tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400 drop-shadow-[0_0_15px_rgba(0,242,255,0.5)]">
                        UNICORN
                    </h1>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-[0.3em]">Signage OS Access Point</p>
                </div>

                <div className="bg-white/5 backdrop-blur-2xl border border-white/10 p-10 rounded-3xl shadow-2xl relative overflow-hidden group hover:border-[#00f2ff]/30 transition-colors duration-500">
                    {/* Top Lighting Accent */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#00f2ff] to-transparent animate-pulse opacity-50"></div>

                    {/* Login Method Toggle */}
                    <div className="flex p-1 bg-black/20 border border-white/10 rounded-xl mb-8 relative">
                        <button
                            type="button"
                            onClick={() => setLoginMethod('email')}
                            className={`flex-1 py-3 px-4 rounded-lg text-sm font-bold transition-all duration-300 relative z-10 ${loginMethod === 'email'
                                ? 'bg-[#00f2ff] text-black shadow-[0_0_15px_rgba(0,242,255,0.4)] transform scale-[1.02]'
                                : 'text-gray-500 hover:text-white'
                                }`}
                        >
                            Email Account
                        </button>
                        <button
                            type="button"
                            onClick={() => setLoginMethod('phone')}
                            className={`flex-1 py-3 px-4 rounded-lg text-sm font-bold transition-all duration-300 relative z-10 ${loginMethod === 'phone'
                                ? 'bg-[#00f2ff] text-black shadow-[0_0_15px_rgba(0,242,255,0.4)] transform scale-[1.02]'
                                : 'text-gray-500 hover:text-white'
                                }`}
                        >
                            Phone / SMS
                        </button>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-1">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">
                                {loginMethod === 'email' ? 'Email Address' : 'Phone Number'}
                            </label>
                            <div className="relative group/input">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within/input:text-[#00f2ff] transition-colors">
                                    {loginMethod === 'email' ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path></svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                    )}
                                </div>
                                <input
                                    type={loginMethod === 'email' ? 'email' : 'tel'}
                                    value={identifier}
                                    onChange={(e) => setIdentifier(e.target.value)}
                                    placeholder={loginMethod === 'email' ? 'alex@domain.com' : '0812345678'}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Password</label>
                            <div className="relative group/input">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 group-focus-within/input:text-[#00f2ff] transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                </div>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium"
                                    required
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs py-3 px-4 rounded-xl text-center font-bold animate-pulse">
                                ⚠ {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className={`w-full py-4 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-xl text-sm relative overflow-hidden group/btn ${loading
                                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                : 'bg-[#00f2ff] text-black border-2 border-cyan-400 hover:bg-cyan-300 hover:shadow-[0_0_30px_rgba(34,211,238,0.6)] hover:-translate-y-0.5 transform'
                                }`}
                        >
                            <span className="relative z-10">{loading ? 'VERIFYING...' : 'LOGIN ACCESS'}</span>
                        </button>
                    </form>

                    <div className="mt-8 pt-8 border-t border-white/5 space-y-4">
                        {process.env.NEXT_PUBLIC_DEBUG !== '0' && (
                            <button
                                onClick={handleAutoAdmin}
                                className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-xs font-black text-gray-400 uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all flex items-center justify-center gap-2 group/dev"
                            >
                                <span className="w-2 h-2 rounded-full bg-green-500/50 group-hover/dev:bg-green-400 transition-colors"></span>
                                Local Developer Auto-Admin
                            </button>
                        )}

                        <div className="text-center">
                            <Link href="/register" className="text-xs font-black text-gray-600 uppercase tracking-widest hover:text-[#00f2ff] transition-colors">
                                Need Authorization? Request Access
                            </Link>
                        </div>
                    </div>
                </div>

                <div className="mt-10 text-center text-xs font-mono text-gray-600 uppercase tracking-widest flex items-center justify-center gap-2">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00f2ff] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00f2ff]"></span>
                    </span>
                    Terminal Node Connection: v2.0.0-Auth
                </div>
            </div>
        </div>
    );
}

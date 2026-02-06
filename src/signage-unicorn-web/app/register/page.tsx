'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '@/features/auth/api/auth-api';
import { useUI } from '@/features/ui/context/UIContext';
import Link from 'next/link';

export default function RegisterPage() {
    const { theme, fontSize, toggleTheme, toggleFontSize } = useUI();
    const [regMethod, setRegMethod] = useState<'email' | 'phone'>('email');
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        primaryContact: '', // Email or Phone based on method
        secondaryContact: '', // Optional Phone or Email
        password: '',
        confirmPassword: ''
    });
    const [agreed, setAgreed] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!agreed) {
            setError('You must agree to the Terms and Privacy Policy');
            return;
        }
        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Mapping fields to backend expected format
            // Assuming username = primaryContact for now, and fullName is combined
            const regPayload = {
                username: formData.primaryContact,
                password: formData.password,
                fullName: `${formData.firstName} ${formData.lastName}`.trim(),
                identifierType: regMethod, // 'email' or 'phone'
                role: 'viewer' // Default role
            };

            const res = await authApi.register(regPayload);
            if (res.success) {
                // In real flow, this might redirect to OTP verification
                alert(`Account created! Please login. (OTP sent to ${formData.primaryContact})`);
                router.push('/login');
            } else {
                setError(res.message || 'Registration failed');
            }
        } catch (err) {
            setError('An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden bg-[#050507] text-white font-sans transition-colors duration-300">
            {/* Background Gradients */}
            <div className="absolute top-[-20%] left-[50%] -translate-x-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(157,0,255,0.15)_0%,transparent_70%)] pointer-events-none blur-3xl"></div>
            <div className="absolute bottom-[-20%] left-[0%] w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(0,242,255,0.08)_0%,transparent_70%)] pointer-events-none blur-3xl"></div>

            {/* Top Toolbar */}
            <div className="absolute top-8 right-8 flex items-center gap-4 animate-[fadeIn_1s_ease-out]">
                <button onClick={toggleFontSize} className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors relative group backdrop-blur-md">
                    <div className="flex items-end gap-0.5">
                        <span className={`font-bold transition-all ${fontSize === 'small' ? 'text-[#00f2ff] text-sm' : 'text-gray-500 text-xs'}`}>A</span>
                        <span className={`font-bold transition-all ${fontSize === 'medium' ? 'text-[#00f2ff] text-base' : 'text-gray-500 text-xs'}`}>A</span>
                        <span className={`font-bold transition-all ${fontSize === 'large' ? 'text-[#00f2ff] text-xl' : 'text-gray-500 text-xs'}`}>A</span>
                    </div>
                </button>
                <button onClick={toggleTheme} className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg hover:bg-white/10 transition-colors shadow-lg backdrop-blur-md">
                    {theme === 'dark' ? '🌙' : '☀️'}
                </button>
            </div>

            {/* Main Card */}
            <div className="w-full max-w-lg animate-[zoomIn_0.7s_ease-out]">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400 drop-shadow-[0_0_15px_rgba(0,242,255,0.5)]">
                        CREATE ACCOUNT
                    </h1>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">Join our next-generation enterprise ecosystem</p>
                </div>

                <div className="bg-white/5 backdrop-blur-2xl border border-white/10 p-8 rounded-3xl shadow-2xl relative overflow-hidden group hover:border-[#00f2ff]/30 transition-colors duration-500">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#00f2ff] to-transparent animate-pulse opacity-50"></div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-5">

                        {/* First/Last Name Row */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">First Name</label>
                                <div className="relative group/input">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 transition-colors">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                    </div>
                                    <input
                                        type="text"
                                        value={formData.firstName}
                                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                        placeholder="John"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium text-sm"
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Last Name</label>
                                <div className="relative group/input">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 transition-colors">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                                    </div>
                                    <input
                                        type="text"
                                        value={formData.lastName}
                                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                        placeholder="Doe"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium text-sm"
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Toggle Switch */}
                        <div className="flex p-1 bg-black/20 border border-white/10 rounded-xl relative">
                            <button
                                type="button"
                                onClick={() => setRegMethod('email')}
                                className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-all duration-300 relative z-10 flex items-center justify-center gap-2 ${regMethod === 'email'
                                    ? 'bg-[#00f2ff] text-black shadow-[0_0_15px_rgba(0,242,255,0.4)] transform scale-[1.02]'
                                    : 'text-gray-500 hover:text-white'
                                    }`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path></svg>
                                Email Account
                            </button>
                            <button
                                type="button"
                                onClick={() => setRegMethod('phone')}
                                className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-all duration-300 relative z-10 flex items-center justify-center gap-2 ${regMethod === 'phone'
                                    ? 'bg-[#00f2ff] text-black shadow-[0_0_15px_rgba(0,242,255,0.4)] transform scale-[1.02]'
                                    : 'text-gray-500 hover:text-white'
                                    }`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                Phone / SMS
                            </button>
                        </div>

                        {/* Dynamic Primary Field */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 transition-all animate-in fade-in slide-in-from-top-1">
                            <div className="space-y-1">
                                <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">
                                    Primary {regMethod === 'email' ? 'Email' : 'Phone'}
                                </label>
                                <input
                                    type={regMethod === 'email' ? 'email' : 'tel'}
                                    value={formData.primaryContact}
                                    onChange={(e) => setFormData({ ...formData, primaryContact: e.target.value })}
                                    placeholder={regMethod === 'email' ? 'name@example.com' : '081 234 5678'}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium"
                                    required
                                />
                            </div>
                        </div>

                        {/* Optional Secondary Field */}
                        <div className="space-y-1">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">
                                Secondary {regMethod === 'email' ? 'Phone' : 'Email'} (Optional)
                            </label>
                            <div className="relative group/input">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-500 transition-colors">
                                    {regMethod === 'email'
                                        ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                        : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path></svg>
                                    }
                                </div>
                                <input
                                    type={regMethod === 'email' ? 'tel' : 'email'}
                                    value={formData.secondaryContact}
                                    onChange={(e) => setFormData({ ...formData, secondaryContact: e.target.value })}
                                    placeholder={regMethod === 'email' ? '081 234 5678' : 'name@example.com'}
                                    className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium text-sm"
                                />
                            </div>
                        </div>

                        {/* Password Fields */}
                        <div className="space-y-1">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Password</label>
                            <input
                                type="password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                placeholder="Min. 8 characters"
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium text-sm"
                                required
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-black text-gray-500 uppercase tracking-widest ml-1">Confirm Password</label>
                            <input
                                type="password"
                                value={formData.confirmPassword}
                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                placeholder="Repeat password"
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-[#00f2ff] focus:ring-1 focus:ring-[#00f2ff]/20 focus:bg-white/10 transition-all placeholder:text-gray-600 font-medium text-sm"
                                required
                            />
                        </div>

                        {/* Terms */}
                        <div className="flex items-start gap-3 mt-2">
                            <div className="relative flex items-center">
                                <input
                                    type="checkbox"
                                    checked={agreed}
                                    onChange={(e) => setAgreed(e.target.checked)}
                                    className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-white/20 bg-white/5 transition-all checked:bg-[#00f2ff] checked:border-[#00f2ff]"
                                />
                                <svg className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-black opacity-0 peer-checked:opacity-100 transition-opacity" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </div>
                            <label className="text-xs text-gray-400 font-medium cursor-pointer select-none" onClick={() => setAgreed(!agreed)}>
                                I agree to the <span className="text-[#00f2ff] hover:underline">Terms</span> and <span className="text-[#00f2ff] hover:underline">Privacy Policy</span>
                            </label>
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs py-3 px-4 rounded-xl text-center font-bold animate-pulse">
                                ⚠ {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className={`w-full py-4 rounded-xl font-black uppercase tracking-[0.2em] transition-all shadow-xl text-sm relative overflow-hidden group/btn mt-2 ${loading
                                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                : 'bg-[#00f2ff] text-black border-2 border-cyan-400 hover:bg-cyan-300 hover:shadow-[0_0_30px_rgba(34,211,238,0.6)] hover:-translate-y-0.5 transform'
                                }`}
                        >
                            <span className="relative z-10">{loading ? 'PROCESSING...' : `Register by ${regMethod === 'email' ? 'EMAIL' : 'SMS'} Access`}</span>
                        </button>
                    </form>

                    <div className="mt-8 pt-6 border-t border-white/5 text-center">
                        <span className="text-gray-500 text-xs font-medium mr-2">Already have an account?</span>
                        <Link href="/login" className="text-xs font-black text-[#00f2ff] uppercase tracking-widest hover:text-white transition-colors">
                            Sign In to Portal
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

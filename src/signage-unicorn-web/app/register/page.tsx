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
        } catch {
            setError('An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    const inputClass = 'w-full bg-muted/20 border border-border rounded-xl px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-muted-foreground/70 font-medium text-sm';
    const labelClass = 'block text-xs font-black text-muted-foreground uppercase tracking-widest ml-1';

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
            <div className="w-full max-w-lg animate-in">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-black uppercase tracking-tighter mb-2 neon-text">
                        Create account
                    </h1>
                    <p className="text-sm font-bold text-muted-foreground">Request access to the Signage Unicorn admin console</p>
                </div>

                <div className="bg-card/80 glass-blur border border-border p-8 rounded-3xl shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-60" aria-hidden="true"></div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-5" noValidate={false}>

                        {/* First/Last Name Row */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label htmlFor="reg-first-name" className={labelClass}>First name</label>
                                <input
                                    id="reg-first-name"
                                    name="firstName"
                                    type="text"
                                    autoComplete="given-name"
                                    value={formData.firstName}
                                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                    placeholder="John"
                                    className={inputClass}
                                    required
                                />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="reg-last-name" className={labelClass}>Last name</label>
                                <input
                                    id="reg-last-name"
                                    name="lastName"
                                    type="text"
                                    autoComplete="family-name"
                                    value={formData.lastName}
                                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                    placeholder="Doe"
                                    className={inputClass}
                                    required
                                />
                            </div>
                        </div>

                        {/* Contact method */}
                        <div className="flex p-1 bg-muted/30 border border-border rounded-xl relative" role="group" aria-label="Registration method">
                            <button
                                type="button"
                                onClick={() => setRegMethod('email')}
                                aria-pressed={regMethod === 'email'}
                                className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-colors duration-200 relative z-10 flex items-center justify-center gap-2 ${regMethod === 'email'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"></path></svg>
                                Email account
                            </button>
                            <button
                                type="button"
                                onClick={() => setRegMethod('phone')}
                                aria-pressed={regMethod === 'phone'}
                                className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-colors duration-200 relative z-10 flex items-center justify-center gap-2 ${regMethod === 'phone'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                Phone / SMS
                            </button>
                        </div>

                        {/* Dynamic Primary Field */}
                        <div className="bg-muted/20 border border-border rounded-2xl p-4">
                            <div className="space-y-1">
                                <label htmlFor="reg-primary-contact" className={labelClass}>
                                    Primary {regMethod === 'email' ? 'email' : 'phone'}
                                </label>
                                <input
                                    id="reg-primary-contact"
                                    name="primaryContact"
                                    type={regMethod === 'email' ? 'email' : 'tel'}
                                    autoComplete={regMethod === 'email' ? 'email' : 'tel'}
                                    value={formData.primaryContact}
                                    onChange={(e) => setFormData({ ...formData, primaryContact: e.target.value })}
                                    placeholder={regMethod === 'email' ? 'name@example.com' : '081 234 5678'}
                                    className={inputClass}
                                    required
                                />
                            </div>
                        </div>

                        {/* Optional Secondary Field */}
                        <div className="space-y-1">
                            <label htmlFor="reg-secondary-contact" className={labelClass}>
                                Secondary {regMethod === 'email' ? 'phone' : 'email'} (optional)
                            </label>
                            <input
                                id="reg-secondary-contact"
                                name="secondaryContact"
                                type={regMethod === 'email' ? 'tel' : 'email'}
                                autoComplete={regMethod === 'email' ? 'tel' : 'email'}
                                value={formData.secondaryContact}
                                onChange={(e) => setFormData({ ...formData, secondaryContact: e.target.value })}
                                placeholder={regMethod === 'email' ? '081 234 5678' : 'name@example.com'}
                                className={inputClass}
                            />
                        </div>

                        {/* Password Fields */}
                        <div className="space-y-1">
                            <label htmlFor="reg-password" className={labelClass}>Password</label>
                            <input
                                id="reg-password"
                                name="password"
                                type="password"
                                autoComplete="new-password"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                placeholder="Min. 8 characters"
                                className={inputClass}
                                required
                                minLength={8}
                            />
                        </div>

                        <div className="space-y-1">
                            <label htmlFor="reg-confirm-password" className={labelClass}>Confirm password</label>
                            <input
                                id="reg-confirm-password"
                                name="confirmPassword"
                                type="password"
                                autoComplete="new-password"
                                value={formData.confirmPassword}
                                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                placeholder="Repeat password"
                                className={inputClass}
                                required
                            />
                        </div>

                        {/* Terms */}
                        <div className="flex items-start gap-3 mt-2">
                            <input
                                id="reg-agree"
                                name="agree"
                                type="checkbox"
                                checked={agreed}
                                onChange={(e) => setAgreed(e.target.checked)}
                                className="mt-0.5 h-5 w-5 cursor-pointer rounded-md border border-border bg-muted/20 accent-[var(--primary)]"
                            />
                            <label htmlFor="reg-agree" className="text-xs text-muted-foreground font-medium cursor-pointer select-none">
                                I agree to the <span className="text-primary font-bold">Terms</span> and <span className="text-primary font-bold">Privacy Policy</span>
                            </label>
                        </div>

                        {error && (
                            <div role="alert" className="bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs py-3 px-4 rounded-xl text-center font-bold">
                                ⚠ {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className={`w-full py-4 rounded-xl font-black uppercase tracking-[0.2em] transition-colors shadow-xl text-sm relative overflow-hidden mt-2 ${loading
                                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                                : 'bg-primary text-primary-foreground border-2 border-primary hover:brightness-110'
                                }`}
                        >
                            <span className="relative z-10">{loading ? 'Processing…' : `Register by ${regMethod === 'email' ? 'email' : 'SMS'}`}</span>
                        </button>
                    </form>

                    <div className="mt-8 pt-6 border-t border-border text-center">
                        <span className="text-muted-foreground text-xs font-medium mr-2">Already have an account?</span>
                        <Link href="/login" className="text-xs font-black text-primary uppercase tracking-widest hover:underline transition-colors">
                            Sign in
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

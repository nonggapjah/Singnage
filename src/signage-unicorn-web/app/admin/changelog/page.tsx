'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export default function ChangelogPage() {
    const [content, setContent] = useState<string>('Loading...');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/changelog')
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    setContent(data.content);
                } else {
                    setError(data.message || 'Failed to load changelog');
                }
            })
            .catch(err => {
                console.error('Error fetching changelog:', err);
                setError('Error connecting to system');
            });
    }, []);

    return (
        <div className="p-8 space-y-8 max-w-4xl mx-auto">
            <header className="flex justify-between items-center">
                <div>
                    <div className="inline-block px-3 py-1 rounded-full bg-accent-purple/10 border border-accent-purple/20 text-accent-purple text-xs font-bold tracking-widest uppercase mb-4">
                        Software Evolution
                    </div>
                    <h1 className="text-4xl font-black neon-text-purple uppercase tracking-tighter">Patch History</h1>
                </div>
                <Link
                    href="/admin/guide"
                    className="px-6 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-sm font-bold flex items-center gap-2"
                >
                    <span>←</span> BACK TO GUIDE
                </Link>
            </header>

            <div className="glass-panel p-8 rounded-3xl border-white/5 relative overflow-hidden min-h-[500px]">
                {error ? (
                    <div className="flex flex-col items-center justify-center p-20 text-center">
                        <div className="text-4xl mb-4">⚠️</div>
                        <h3 className="text-xl font-bold text-red-500 mb-2">Could Not Load History</h3>
                        <p className="text-[var(--foreground)]/50">{error}</p>
                    </div>
                ) : (
                    <div className="prose prose-invert max-w-none">
                        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-[var(--foreground)]/70 bg-black/20 p-6 rounded-2xl border border-white/5">
                            {content}
                        </pre>
                    </div>
                )}
            </div>

            <footer className="text-center py-10 opacity-30">
                <p className="text-xs font-mono tracking-[0.3em] uppercase">Signage Unicorn Evolution Tracking System</p>
            </footer>
        </div>
    );
}

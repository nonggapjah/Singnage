'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export default function ChangelogPage() {
    const [content, setContent] = useState<string>('Loading…');
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
            <header className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                    <div className="inline-block px-3 py-1 rounded-full bg-accent-purple/10 border border-accent-purple/20 text-accent-purple text-xs font-bold tracking-widest uppercase mb-4">
                        Release notes
                    </div>
                    <h1 className="text-4xl font-black neon-text uppercase tracking-tighter">Changelog</h1>
                </div>
                <Link
                    href="/admin/guide"
                    className="px-6 py-2 rounded-xl bg-muted/20 hover:bg-muted/40 border border-border transition-colors text-sm font-bold flex items-center gap-2 text-foreground"
                >
                    <span aria-hidden="true">←</span> Back to guide
                </Link>
            </header>

            <div className="glass-panel p-8 rounded-3xl relative overflow-hidden min-h-[500px]">
                {error ? (
                    <div className="flex flex-col items-center justify-center p-20 text-center" role="alert">
                        <div className="text-4xl mb-4" aria-hidden="true">⚠️</div>
                        <h3 className="text-xl font-bold text-red-500 mb-2">Could not load history</h3>
                        <p className="text-muted-foreground">{error}</p>
                    </div>
                ) : (
                    <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground/80 bg-muted/20 p-6 rounded-2xl border border-border/50">
                        {content}
                    </pre>
                )}
            </div>
        </div>
    );
}

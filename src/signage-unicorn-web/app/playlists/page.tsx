'use client';

import React, { useState } from 'react';
import { PlaylistProvider, usePlaylists } from '@/features/playlists/context/PlaylistContext';
import { PlaylistCard } from '@/features/playlists/components/PlaylistCard';
import { PlaylistEditor } from '@/features/playlists/components/PlaylistEditor';

const PlaylistsContent = () => {
    const { playlists, activePlaylist, selectPlaylist, loading } = usePlaylists();
    const [editorOpen, setEditorOpen] = useState(false);

    const handleSelect = async (id: string) => {
        await selectPlaylist(id);
        setEditorOpen(true);
    };

    return (
        <div className="min-h-screen p-8 lg:p-12 bg-background text-foreground">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-12">
                <div>
                    <h1 className="text-4xl font-bold tracking-tight mb-2">Playlist <span className="text-accent-cyan">management</span></h1>
                    <p className="text-muted-foreground">Create and organize media delivery for your signage network.</p>
                </div>
                <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setEditorOpen(true)}>
                    <span aria-hidden="true">+</span> Create new playlist
                </button>
            </header>

            {loading ? (
                <div className="flex items-center justify-center py-20" role="status" aria-label="Loading playlists">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-accent-cyan"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {playlists.map(p => (
                        <PlaylistCard
                            key={p.playlistId}
                            playlist={p}
                            onClick={handleSelect}
                        />
                    ))}
                </div>
            )}

            {editorOpen && (
                <PlaylistEditor
                    initialData={activePlaylist || undefined}
                    onSave={(data) => { console.log('Save:', data); setEditorOpen(false); }}
                />
            )}

            {editorOpen && (
                <div
                    className="fixed inset-0 bg-black/40 z-40"
                    aria-hidden="true"
                    onClick={() => setEditorOpen(false)}
                />
            )}
        </div>
    );
};

export default function PlaylistsPage() {
    return (
        <PlaylistProvider>
            <PlaylistsContent />
        </PlaylistProvider>
    );
}

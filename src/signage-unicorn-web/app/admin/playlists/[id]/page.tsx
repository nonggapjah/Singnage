'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Playlist } from '@/features/playlists/types/playlist';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { PlaylistEditor } from '@/features/playlists/components/PlaylistEditor';
import Link from 'next/link';

export default function PlaylistDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;
    const isNew = id === 'new';

    const [playlist, setPlaylist] = useState<Playlist | undefined>(undefined);
    const [loading, setLoading] = useState(!isNew);

    useEffect(() => {
        if (!isNew) {
            loadPlaylist();
        }
    }, [id]);

    const loadPlaylist = async () => {
        setLoading(true);
        const res = await playlistApi.getById(id);
        if (res.success && res.data) {
            setPlaylist(res.data);
        }
        setLoading(false);
    };

    const handleSave = async (data: Partial<Playlist>) => {
        let res;
        if (isNew) {
            res = await playlistApi.create(data);
        } else {
            res = await playlistApi.update(id, data);
        }

        if (res.success) {
            router.push('/admin/playlists');
            router.refresh(); // invalidate the App Router cache so the list reflects the change immediately
        } else {
            alert(res.message || 'Operation failed with unknown error');
        }
    };

    return (
        <div className="p-8 space-y-8 max-w-5xl mx-auto">
            <nav className="text-sm text-gray-500 flex items-center gap-2">
                <Link href="/admin/playlists" className="hover:text-accent-cyan transition-colors">Playlists</Link>
                <span>/</span>
                <span className="text-gray-300 font-medium">{isNew ? 'Create New' : 'Edit Playlist'}</span>
            </nav>



            {loading ? (
                <div className="h-64 flex items-center justify-center">
                    <div className="text-accent-purple text-xl font-mono tracking-widest animate-pulse">DECRYPTING PLAYLIST DATA...</div>
                </div>
            ) : (
                <PlaylistEditor initialData={playlist} onSave={handleSave} />
            )}
        </div>
    );
}

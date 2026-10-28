'use client';

import React, { useState, useEffect } from 'react';
import { Playlist } from '@/features/playlists/types/playlist';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { PlaylistTable } from '@/features/playlists/components/PlaylistTable';
import { BatchAssignModal } from '@/features/playlists/components/BatchAssignModal';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function PlaylistsPage() {
    const router = useRouter();
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter/Sort State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
    const [sortBy, setBy] = useState<'name' | 'date' | 'items' | 'duration'>('date');

    // Modal State
    const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);

    // Duplicate State
    const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

    // Initial Load & Search/Filter Debounce
    // This single effect handles both mount (initial load) and subsequent updates
    useEffect(() => {
        const timer = setTimeout(() => {
            loadPlaylists();
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery, filterStatus, sortBy]);

    const loadPlaylists = async () => {
        setLoading(true);
        try {
            const res = await playlistApi.getAll(false, searchQuery);
            if (res.success && res.data) {
                setPlaylists(res.data);
            }
        } catch (error) {
            console.error("Failed to load playlists", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this playlist?')) {
            const res = await playlistApi.delete(id);
            if (res.success) {
                await loadPlaylists();
                router.refresh(); // keep cached views elsewhere (counts, dashboard) in sync
            } else {
                alert(res.message);
            }
        }
    };

    const handleDeploySuccess = () => {
        alert('Playlist deployment initiated for selected devices.');
        setSelectedPlaylist(null);
    };

    const handleDuplicate = async (playlist: Playlist) => {
        if (duplicatingId) return; // guard against double-clicks
        setDuplicatingId(playlist.playlistId);
        try {
            // Load the full source playlist (incl. its items) then create a fresh copy.
            const res = await playlistApi.getById(playlist.playlistId);
            if (!res.success || !res.data) {
                alert(res.message || 'Could not load the playlist to duplicate.');
                return;
            }
            const src = res.data;
            const copy: Partial<Playlist> = {
                playlistName: `${src.playlistName} (Copy)`,
                description: src.description,
                active: 'N', // start as an inactive draft so it is reviewed before going live
                items: (src.items || []).map((it, index) => ({
                    playlistItemId: '',
                    playlistId: '',
                    mediaId: it.mediaId,
                    positionOrder: index + 1,
                    durationOverride: it.durationOverride ?? null,
                    active: 'Y',
                })),
            };
            const createRes = await playlistApi.create(copy);
            if (createRes.success) {
                await loadPlaylists();
                router.refresh();
            } else {
                alert(createRes.message || 'Could not duplicate the playlist.');
            }
        } catch (error) {
            console.error('Failed to duplicate playlist', error);
            alert('Failed to duplicate the playlist.');
        } finally {
            setDuplicatingId(null);
        }
    };

    const filteredPlaylists = React.useMemo(() => {
        return playlists
            .filter(p => {
                const matchesStatus =
                    filterStatus === 'ALL' ||
                    (filterStatus === 'ACTIVE' && p.active === 'Y') ||
                    (filterStatus === 'INACTIVE' && p.active === 'N');

                return matchesStatus;
            })
            .sort((a, b) => {
                if (sortBy === 'name') return a.playlistName.localeCompare(b.playlistName);
                if (sortBy === 'items') return (b.itemCount || 0) - (a.itemCount || 0);
                if (sortBy === 'duration') return (b.totalDuration || 0) - (a.totalDuration || 0);
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
    }, [playlists, filterStatus, sortBy]);

    const controlClass = 'bg-muted/20 border border-border rounded-xl px-4 py-2 text-sm text-foreground outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors';

    return (
        <div className="p-8 space-y-8 max-w-7xl mx-auto">
            <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
                <div>
                    <h1 className="text-4xl font-black neon-text mb-2 uppercase tracking-tighter">Playlist management</h1>
                    <p className="text-muted-foreground">{playlists.length} playlists in the system</p>
                </div>
                <Link href="/admin/playlists/new" className="btn-primary">
                    + Create new playlist
                </Link>
            </header>

            {/* --- Controls --- */}
            <div className="glass-panel p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center justify-between sticky top-0 z-20 bg-background/95">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full md:w-auto">
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" aria-hidden="true">
                            <span className="opacity-50 text-xs">🔍</span>
                        </div>
                        <input
                            type="search"
                            aria-label="Search playlists"
                            placeholder="Search playlists…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className={`pl-10 pr-4 w-full md:w-64 ${controlClass}`}
                        />
                    </div>

                    <select
                        aria-label="Filter by status"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
                        className={controlClass}
                    >
                        <option value="ALL">All statuses</option>
                        <option value="ACTIVE">Active only</option>
                        <option value="INACTIVE">Inactive only</option>
                    </select>

                    <select
                        aria-label="Sort playlists"
                        value={sortBy}
                        onChange={(e) => setBy(e.target.value as 'name' | 'date' | 'items' | 'duration')}
                        className={controlClass}
                    >
                        <option value="date">Sort by date</option>
                        <option value="name">Sort by name</option>
                        <option value="items">Sort by item count</option>
                        <option value="duration">Sort by duration</option>
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="h-64 flex items-center justify-center" role="status">
                    <div className="text-accent-cyan text-xl font-mono tracking-widest">Loading playlists…</div>
                </div>
            ) : (
                <PlaylistTable
                    playlists={filteredPlaylists}
                    onDelete={handleDelete}
                    onDeploy={(p) => setSelectedPlaylist(p)}
                    onDuplicate={handleDuplicate}
                    duplicatingId={duplicatingId}
                />
            )}

            {selectedPlaylist && (
                <BatchAssignModal
                    playlistId={selectedPlaylist.playlistId}
                    playlistName={selectedPlaylist.playlistName}
                    onClose={() => setSelectedPlaylist(null)}
                    onSuccess={handleDeploySuccess}
                />
            )}
        </div>
    );
}

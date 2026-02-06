'use client';

import React, { useState, useEffect } from 'react';
import { Playlist } from '@/features/playlists/types/playlist';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { PlaylistTable } from '@/features/playlists/components/PlaylistTable';
import { BatchAssignModal } from '@/features/playlists/components/BatchAssignModal';
import Link from 'next/link';

export default function PlaylistsPage() {
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(true);

    // Filter/Sort State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
    const [sortBy, setBy] = useState<'name' | 'date' | 'items' | 'duration'>('date');

    // Modal State
    const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);

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
                loadPlaylists();
            } else {
                alert(res.message);
            }
        }
    };

    const handleDeploySuccess = () => {
        alert('Playlist deployment initiated for selected devices.');
        setSelectedPlaylist(null);
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

    return (
        <div className="p-8 space-y-8 max-w-7xl mx-auto">
            <header className="flex justify-between items-end">
                <div>
                    <h1 className="text-4xl font-black neon-text mb-2 uppercase tracking-tighter">Playlist Management</h1>
                    <p className="text-gray-400">Total {playlists.length} active playlists in the system</p>
                </div>
                <Link href="/admin/playlists/new" className="btn-primary shadow-[0_0_20px_rgba(0,242,255,0.3)] hover:scale-105 transform transition-all">
                    + Create New Playlist
                </Link>
            </header>

            {/* --- Controls --- */}
            <div className="glass-panel p-4 rounded-2xl border-white/5 flex flex-col md:flex-row gap-4 items-center justify-between sticky top-0 z-20 backdrop-blur-xl">
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="opacity-50 text-xs">🔍</span>
                        </div>
                        <input
                            type="text"
                            placeholder="Search Sequences..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-black/20 border border-white/10 rounded-xl text-sm w-full md:w-64 focus:border-accent-cyan outline-none transition-all"
                        />
                    </div>

                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as any)}
                        className="bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm text-gray-400 outline-none focus:border-accent-cyan"
                    >
                        <option value="ALL">All Status</option>
                        <option value="ACTIVE">Active Only</option>
                        <option value="INACTIVE">Inactive Only</option>
                    </select>

                    <select
                        value={sortBy}
                        onChange={(e) => setBy(e.target.value as any)}
                        className="bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm text-gray-400 outline-none focus:border-accent-cyan"
                    >
                        <option value="date">Sort by Date</option>
                        <option value="name">Sort by Name</option>
                        <option value="items">Sort by Item Count</option>
                        <option value="duration">Sort by Duration</option>
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="h-64 flex items-center justify-center">
                    <div className="text-accent-cyan text-xl font-mono tracking-widest animate-pulse">SYNCHRONIZING DATASPACE...</div>
                </div>
            ) : (
                <PlaylistTable
                    playlists={filteredPlaylists}
                    onDelete={handleDelete}
                    onDeploy={(p) => setSelectedPlaylist(p)}
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

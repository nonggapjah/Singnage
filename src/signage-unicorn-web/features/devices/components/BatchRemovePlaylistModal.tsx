'use client';

import React, { useState, useEffect } from 'react';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { deviceApi } from '../api/device-api';
import { Playlist } from '@/features/playlists/types/playlist';
import { useUI } from '@/features/ui/context/UIContext';

interface BatchRemovePlaylistModalProps {
    isOpen: boolean;
    onClose: () => void;
    deviceIds: string[];
    onSuccess: () => void;
}

export const BatchRemovePlaylistModal: React.FC<BatchRemovePlaylistModalProps> = ({ isOpen, onClose, deviceIds, onSuccess }) => {
    const { showModal } = useUI();
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchPlaylists();
        }
    }, [isOpen]);

    const fetchPlaylists = async () => {
        setLoading(true);
        try {
            const res = await playlistApi.getAll();
            if (res.success && res.data) {
                setPlaylists(res.data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleRemove = async () => {
        if (selectedPlaylistIds.length === 0) return;
        setSubmitting(true);
        try {
            const res = await deviceApi.batchClearSchedule(deviceIds, selectedPlaylistIds);
            if (res.success) {
                showModal({ title: 'SUCCESS', message: `Successfully removed ${selectedPlaylistIds.length} playlists from ${deviceIds.length} devices.`, type: 'SUCCESS' });
                onSuccess();
                onClose();
            } else {
                showModal({ title: 'ERROR', message: res.message || 'Failed to remove playlists', type: 'ERROR' });
            }
        } catch (e) {
            showModal({ title: 'ERROR', message: 'Critical error while removing playlists', type: 'ERROR' });
        } finally {
            setSubmitting(false);
        }
    };

    const togglePlaylist = (id: string) => {
        setSelectedPlaylistIds(prev => 
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-2xl p-8 rounded-3xl border border-border shadow-[0_0_50px_rgba(0,0,0,0.5)] relative flex flex-col max-h-[80vh] bg-card-solid">
                <div className="mb-6 shrink-0">
                    <div className="text-4xl mb-2">🗑️</div>
                    <h3 className="text-2xl font-black text-foreground uppercase tracking-tighter">Batch Remove Playlists</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-1">Select playlists to remove from {deviceIds.length} selected devices</p>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-[200px] bg-muted/10 rounded-xl border border-border/50 p-4">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-accent-cyan tracking-widest font-mono text-sm uppercase animate-pulse">Loading Playlists...</div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {playlists.map(p => (
                                <div 
                                    key={p.playlistId}
                                    onClick={() => togglePlaylist(p.playlistId)}
                                    className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                                        selectedPlaylistIds.includes(p.playlistId)
                                        ? 'bg-red-500/10 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
                                        : 'bg-white/5 border-white/5 hover:border-white/10'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${p.active === 'Y' ? 'bg-green-500' : 'bg-gray-500'}`} />
                                        <span className="font-bold text-sm">{p.playlistName}</span>
                                    </div>
                                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                                        selectedPlaylistIds.includes(p.playlistId)
                                        ? 'bg-red-500 border-red-500 text-white'
                                        : 'border-white/20'
                                    }`}>
                                        {selectedPlaylistIds.includes(p.playlistId) && '✓'}
                                    </div>
                                </div>
                            ))}
                            {playlists.length === 0 && (
                                <div className="text-center py-10 text-muted-foreground font-mono text-xs uppercase">No playlists found in system</div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex gap-4 mt-8 pt-4 border-t border-border/50">
                    <button onClick={onClose} disabled={submitting} className="flex-1 py-4 rounded-xl bg-muted/20 text-muted-foreground font-bold hover:bg-muted/40 hover:text-foreground transition-all uppercase tracking-widest text-xs">Cancel</button>
                    <button 
                        onClick={handleRemove} 
                        disabled={submitting || loading || selectedPlaylistIds.length === 0} 
                        className="flex-[2] py-4 rounded-xl bg-red-600 text-white font-black uppercase tracking-[0.2em] hover:bg-red-500 disabled:opacity-20 disabled:cursor-not-allowed transition-all shadow-[0_0_30px_rgba(220,38,38,0.3)] hover:shadow-[0_0_50px_rgba(220,38,38,0.5)] transform hover:-translate-y-1 text-xs"
                    >
                        {submitting ? 'REMOVING...' : `REMOVE ${selectedPlaylistIds.length} PLAYLISTS`}
                    </button>
                </div>
            </div>
        </div>
    );
};

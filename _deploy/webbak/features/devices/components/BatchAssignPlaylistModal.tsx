'use client';

import React, { useState, useEffect } from 'react';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { deviceApi } from '../api/device-api';
import { Playlist } from '@/features/playlists/types/playlist';
import { useUI } from '@/features/ui/context/UIContext';
import { DateTimePicker24h } from '@/components/ui/DateTimePicker24h';

interface BatchAssignPlaylistModalProps {
    isOpen: boolean;
    onClose: () => void;
    deviceIds: string[];
    onSuccess: () => void;
}

export const BatchAssignPlaylistModal: React.FC<BatchAssignPlaylistModalProps> = ({ isOpen, onClose, deviceIds, onSuccess }) => {
    const { showModal } = useUI();
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>('');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
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
                const activeOnes = res.data.filter(p => p.active === 'Y');
                setPlaylists(activeOnes);
                if (activeOnes.length > 0) {
                    setSelectedPlaylistId(activeOnes[0].playlistId);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const parseLocalInputToUtc = (localStr?: string) => {
        if (!localStr) return undefined;
        return new Date(localStr).toISOString();
    };

    const handleAssign = async () => {
        if (!selectedPlaylistId) return;
        setSubmitting(true);
        try {
            const res = await deviceApi.batchAddSchedule(
                deviceIds,
                selectedPlaylistId,
                parseLocalInputToUtc(startDate),
                parseLocalInputToUtc(endDate)
            );
            if (res.success) {
                showModal({ title: 'SUCCESS', message: `Successfully assigned playlist to ${deviceIds.length} devices.`, type: 'SUCCESS' });
                onSuccess();
                onClose();
            } else {
                showModal({ title: 'ERROR', message: res.message || 'Failed to assign playlist', type: 'ERROR' });
            }
        } catch (e) {
            showModal({ title: 'ERROR', message: 'Critical error while assigning playlist', type: 'ERROR' });
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-2xl p-8 rounded-3xl border border-border shadow-[0_0_50px_rgba(0,0,0,0.5)] relative flex flex-col max-h-[80vh] bg-card-solid">
                <div className="mb-6 shrink-0">
                    <div className="text-4xl mb-2">🗓️</div>
                    <h3 className="text-2xl font-black text-foreground uppercase tracking-tighter">Batch Assign Playlist</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-1">Select a playlist and optional validity dates for {deviceIds.length} selected devices</p>
                </div>

                <div className="flex-1 space-y-6 overflow-y-auto pr-2 custom-scrollbar min-h-[200px] p-4">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-accent-cyan tracking-widest font-mono text-sm uppercase animate-pulse">Loading Playlists...</div>
                    ) : (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Select Playlist</label>
                                <select
                                    value={selectedPlaylistId}
                                    onChange={e => setSelectedPlaylistId(e.target.value)}
                                    className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-accent-cyan"
                                >
                                    {playlists.map(p => (
                                        <option key={p.playlistId} value={p.playlistId}>{p.playlistName}</option>
                                    ))}
                                    {playlists.length === 0 && (
                                        <option value="">No active playlists available</option>
                                    )}
                                </select>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Start Date & Time (Optional)</label>
                                    <DateTimePicker24h
                                        value={startDate}
                                        onChange={setStartDate}
                                        isLarge={true}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">End Date & Time (Optional)</label>
                                    <DateTimePicker24h
                                        value={endDate}
                                        onChange={setEndDate}
                                        isLarge={true}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex gap-4 mt-8 pt-4 border-t border-border/50">
                    <button onClick={onClose} disabled={submitting} className="flex-1 py-4 rounded-xl bg-muted/20 text-muted-foreground font-bold hover:bg-muted/40 hover:text-foreground transition-all uppercase tracking-widest text-xs">Cancel</button>
                    <button 
                        onClick={handleAssign} 
                        disabled={submitting || loading || !selectedPlaylistId} 
                        className="flex-[2] py-4 rounded-xl bg-accent-cyan text-black font-black uppercase tracking-[0.2em] hover:bg-cyan-300 disabled:opacity-20 disabled:cursor-not-allowed transition-all shadow-[0_0_30px_rgba(34,211,238,0.3)] hover:shadow-[0_0_50px_rgba(34,211,238,0.5)] transform hover:-translate-y-1 text-xs"
                    >
                        {submitting ? 'ASSIGNING...' : `ASSIGN TO ${deviceIds.length} DEVICES`}
                    </button>
                </div>
            </div>
        </div>
    );
};

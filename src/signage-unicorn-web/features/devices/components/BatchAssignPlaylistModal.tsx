'use client';

import React, { useState, useEffect } from 'react';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { deviceApi } from '../api/device-api';
import { Playlist } from '@/features/playlists/types/playlist';
import { useUI } from '@/features/ui/context/UIContext';
import { DateTimePicker24h } from '@/components/ui/DateTimePicker24h';

/**
 * BatchAssignPlaylistModal
 * ------------------------
 * Assigns ONE playlist (with an optional validity window) to a batch of
 * selected devices. It is the counterpart to BatchRemovePlaylistModal:
 * the device set is fixed (passed in via `deviceIds`) and the operator picks
 * the playlist to push out.
 *
 * Props match the call site in app/admin/devices/page.tsx exactly.
 */
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
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchPlaylists();
            // Reset selection each time the modal opens so stale state never leaks in.
            setSelectedPlaylistId('');
            setStartDate('');
            setEndDate('');
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

    const handleAssign = async () => {
        if (!selectedPlaylistId) return;

        // Validate the optional schedule window before hitting the API.
        const st = startDate ? new Date(startDate).toISOString() : undefined;
        const ed = endDate ? new Date(endDate).toISOString() : undefined;
        if (st && ed && new Date(st) >= new Date(ed)) {
            showModal({ title: 'INVALID SCHEDULE', message: 'End date must be later than the start date.', type: 'ERROR' });
            return;
        }

        setSubmitting(true);
        try {
            const res = await deviceApi.batchAddSchedule(deviceIds, selectedPlaylistId, st, ed);
            if (res.success) {
                showModal({ title: 'SUCCESS', message: `Playlist assigned to ${deviceIds.length} devices. Sync command sent.`, type: 'SUCCESS' });
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
            <div className="w-full max-w-2xl p-8 rounded-3xl border border-border shadow-[0_0_50px_rgba(0,0,0,0.5)] relative flex flex-col max-h-[85vh] bg-card-solid">
                <div className="mb-6 shrink-0">
                    <div className="text-4xl mb-2">📡</div>
                    <h3 className="text-2xl font-black text-foreground uppercase tracking-tighter">Batch Assign Playlist</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-1">Select a playlist to deploy to {deviceIds.length} selected devices</p>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-[200px] bg-muted/10 rounded-xl border border-border/50 p-4">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-accent-cyan tracking-widest font-mono text-sm uppercase animate-pulse">Loading Playlists...</div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2">
                            {playlists.filter(p => p.active === 'Y').map(p => (
                                <div
                                    key={p.playlistId}
                                    onClick={() => setSelectedPlaylistId(p.playlistId)}
                                    className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                                        selectedPlaylistId === p.playlistId
                                            ? 'bg-accent-cyan/10 border-accent-cyan shadow-[0_0_15px_rgba(34,211,238,0.1)]'
                                            : 'bg-white/5 border-white/5 hover:border-white/10'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-green-500" />
                                        <span className="font-bold text-sm">{p.playlistName}</span>
                                    </div>
                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                                        selectedPlaylistId === p.playlistId
                                            ? 'bg-accent-cyan border-accent-cyan text-black'
                                            : 'border-white/20'
                                    }`}>
                                        {selectedPlaylistId === p.playlistId && '✓'}
                                    </div>
                                </div>
                            ))}
                            {playlists.filter(p => p.active === 'Y').length === 0 && (
                                <div className="text-center py-10 text-muted-foreground font-mono text-xs uppercase">No active playlists found in system</div>
                            )}
                        </div>
                    )}
                </div>

                {/* Optional schedule window */}
                <div className="grid grid-cols-2 gap-4 mt-4 shrink-0">
                    <div>
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Start Date (Optional)</label>
                        <DateTimePicker24h value={startDate} onChange={setStartDate} placeholderDate="Start Date" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">End Date (Optional)</label>
                        <DateTimePicker24h value={endDate} onChange={setEndDate} placeholderDate="End Date" />
                    </div>
                </div>

                <div className="flex gap-4 mt-8 pt-4 border-t border-border/50 shrink-0">
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

export default BatchAssignPlaylistModal;

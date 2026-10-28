'use client';

import React, { useState, useEffect } from 'react';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { deviceApi } from '../api/device-api';
import { Playlist } from '@/features/playlists/types/playlist';
import { useUI } from '@/features/ui/context/UIContext';
import { DateTimePicker24h } from '@/components/ui/DateTimePicker24h';
import { Modal } from '@/components/ui/Modal';

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
        } catch {
            showModal({ title: 'ERROR', message: 'Critical error while assigning playlist', type: 'ERROR' });
        } finally {
            setSubmitting(false);
        }
    };

    const activePlaylists = playlists.filter(p => p.active === 'Y');

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="2xl"
            scroll={false}
            closeDisabled={submitting}
            labelledBy="batch-assign-title"
            zIndexClass="z-[1000]"
            className="p-6 sm:p-8 flex flex-col max-h-[85vh] bg-card-solid"
        >
            <div className="mb-6 shrink-0">
                <div className="text-4xl mb-2" aria-hidden="true">📡</div>
                <h3 id="batch-assign-title" className="text-2xl font-black text-foreground uppercase tracking-tighter">Batch assign playlist</h3>
                <p className="text-sm text-muted-foreground mt-1">Select a playlist to deploy to {deviceIds.length} selected devices</p>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-[200px] bg-muted/10 rounded-xl border border-border/50 p-4" role="group" aria-label="Playlists">
                {loading ? (
                    <div className="flex items-center justify-center h-full text-accent-cyan tracking-widest font-mono text-sm uppercase" role="status">Loading playlists…</div>
                ) : (
                    <div className="grid grid-cols-1 gap-2">
                        {activePlaylists.map(p => {
                            const selected = selectedPlaylistId === p.playlistId;
                            return (
                                <button
                                    type="button"
                                    key={p.playlistId}
                                    onClick={() => setSelectedPlaylistId(p.playlistId)}
                                    aria-pressed={selected}
                                    className={`w-full text-left flex items-center justify-between p-4 rounded-xl border transition-colors ${selected
                                        ? 'bg-accent-cyan/10 border-accent-cyan'
                                        : 'bg-muted/20 border-border/50 hover:border-border'
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-green-500" aria-hidden="true" />
                                        <span className="font-bold text-sm text-foreground">{p.playlistName}</span>
                                    </div>
                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${selected
                                        ? 'bg-accent-cyan border-accent-cyan text-black'
                                        : 'border-border'
                                        }`} aria-hidden="true">
                                        {selected && '✓'}
                                    </div>
                                </button>
                            );
                        })}
                        {activePlaylists.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground font-mono text-xs uppercase">No active playlists found in system</div>
                        )}
                    </div>
                )}
            </div>

            {/* Optional schedule window */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 shrink-0">
                <div>
                    <label htmlFor="batch-assign-start" className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Start date (optional)</label>
                    <DateTimePicker24h id="batch-assign-start" value={startDate} onChange={setStartDate} placeholderDate="Start date" />
                </div>
                <div>
                    <label htmlFor="batch-assign-end" className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">End date (optional)</label>
                    <DateTimePicker24h id="batch-assign-end" value={endDate} onChange={setEndDate} placeholderDate="End date" />
                </div>
            </div>

            <div className="flex gap-4 mt-8 pt-4 border-t border-border/50 shrink-0">
                <button type="button" onClick={onClose} disabled={submitting} className="flex-1 py-4 rounded-xl bg-muted/20 text-muted-foreground font-bold hover:bg-muted/40 hover:text-foreground transition-colors uppercase tracking-widest text-xs disabled:opacity-50">Cancel</button>
                <button
                    type="button"
                    onClick={handleAssign}
                    disabled={submitting || loading || !selectedPlaylistId}
                    className="flex-[2] py-4 rounded-xl bg-accent-cyan text-black font-black uppercase tracking-[0.2em] hover:bg-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs"
                >
                    {submitting ? 'Assigning…' : `Assign to ${deviceIds.length} devices`}
                </button>
            </div>
        </Modal>
    );
};

export default BatchAssignPlaylistModal;

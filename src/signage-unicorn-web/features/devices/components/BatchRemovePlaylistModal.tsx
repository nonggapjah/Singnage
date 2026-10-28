'use client';

import React, { useState, useEffect } from 'react';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { deviceApi } from '../api/device-api';
import { Playlist } from '@/features/playlists/types/playlist';
import { useUI } from '@/features/ui/context/UIContext';
import { Modal } from '@/components/ui/Modal';

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
        } catch {
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

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="2xl"
            scroll={false}
            closeDisabled={submitting}
            labelledBy="batch-remove-title"
            zIndexClass="z-[1000]"
            className="p-6 sm:p-8 flex flex-col max-h-[80vh] bg-card-solid"
        >
            <div className="mb-6 shrink-0">
                <div className="text-4xl mb-2" aria-hidden="true">🗑️</div>
                <h3 id="batch-remove-title" className="text-2xl font-black text-foreground uppercase tracking-tighter">Batch remove playlists</h3>
                <p className="text-sm text-muted-foreground mt-1">Select playlists to remove from {deviceIds.length} selected devices</p>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-[200px] bg-muted/10 rounded-xl border border-border/50 p-4" role="group" aria-label="Playlists">
                {loading ? (
                    <div className="flex items-center justify-center h-full text-accent-cyan tracking-widest font-mono text-sm uppercase" role="status">Loading playlists…</div>
                ) : (
                    <div className="grid grid-cols-1 gap-2">
                        {playlists.map(p => {
                            const selected = selectedPlaylistIds.includes(p.playlistId);
                            return (
                                <button
                                    type="button"
                                    key={p.playlistId}
                                    onClick={() => togglePlaylist(p.playlistId)}
                                    aria-pressed={selected}
                                    className={`w-full text-left flex items-center justify-between p-4 rounded-xl border transition-colors ${selected
                                        ? 'bg-red-500/10 border-red-500/50'
                                        : 'bg-muted/20 border-border/50 hover:border-border'
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${p.active === 'Y' ? 'bg-green-500' : 'bg-muted-foreground'}`} aria-hidden="true" />
                                        <span className="font-bold text-sm text-foreground">{p.playlistName}</span>
                                    </div>
                                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${selected
                                        ? 'bg-red-500 border-red-500 text-white'
                                        : 'border-border'
                                        }`} aria-hidden="true">
                                        {selected && '✓'}
                                    </div>
                                </button>
                            );
                        })}
                        {playlists.length === 0 && (
                            <div className="text-center py-10 text-muted-foreground font-mono text-xs uppercase">No playlists found in system</div>
                        )}
                    </div>
                )}
            </div>

            <div className="flex gap-4 mt-8 pt-4 border-t border-border/50 shrink-0">
                <button type="button" onClick={onClose} disabled={submitting} className="flex-1 py-4 rounded-xl bg-muted/20 text-muted-foreground font-bold hover:bg-muted/40 hover:text-foreground transition-colors uppercase tracking-widest text-xs disabled:opacity-50">Cancel</button>
                <button
                    type="button"
                    onClick={handleRemove}
                    disabled={submitting || loading || selectedPlaylistIds.length === 0}
                    className="flex-[2] py-4 rounded-xl bg-red-600 text-white font-black uppercase tracking-[0.2em] hover:bg-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs"
                >
                    {submitting ? 'Removing…' : `Remove ${selectedPlaylistIds.length} playlists`}
                </button>
            </div>
        </Modal>
    );
};

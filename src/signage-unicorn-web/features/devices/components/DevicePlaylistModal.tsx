'use client';

import React, { useState, useEffect } from 'react';
import { deviceApi } from '../api/device-api';
import { useUI } from '@/features/ui/context/UIContext';
import { Playlist } from '@/features/playlists/types/playlist';

interface DevicePlaylistModalProps {
    isOpen: boolean;
    onClose: () => void;
    deviceId: string;
    deviceName: string;
    availablePlaylists: Playlist[];
}

export const DevicePlaylistModal: React.FC<DevicePlaylistModalProps> = ({ isOpen, onClose, deviceId, deviceName, availablePlaylists }) => {
    const { showModal } = useUI();
    const [assignments, setAssignments] = useState<{ id?: number, playlistId: string, startDate?: string, endDate?: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen && deviceId) {
            fetchAssignments();
        }
    }, [isOpen, deviceId]);

    const parseUtcToLocalInput = (utcStr?: string) => {
        if (!utcStr) return undefined;
        // Force treat as UTC by appending 'Z' if missing
        const d = new Date(utcStr + (utcStr.endsWith('Z') ? '' : 'Z'));
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const parseLocalInputToUtc = (localStr?: string) => {
        if (!localStr) return undefined;
        return new Date(localStr).toISOString();
    };

    const fetchAssignments = async () => {
        setLoading(true);
        try {
            const res = await deviceApi.getAssignedPlaylists(deviceId);
            if (res.success && res.data) {
                const formatted = res.data.map(a => ({
                    id: a.id,
                    playlistId: a.playlistId,
                    startDate: parseUtcToLocalInput(a.startDate),
                    endDate: parseUtcToLocalInput(a.endDate),
                }));
                setAssignments(formatted);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload = assignments.map(a => ({
                playlistId: a.playlistId,
                startDate: parseLocalInputToUtc(a.startDate),
                endDate: parseLocalInputToUtc(a.endDate),
            }));

            const res = await deviceApi.updateAssignedPlaylists(deviceId, payload);
            if (res.success) {
                showModal({ title: 'SUCCESS', message: 'Assigned Playlists and Schedule Updated! Sync command sent.', type: 'SUCCESS' });
                onClose();
            } else {
                showModal({ title: 'ERROR', message: res.message || 'Failed to update schedule', type: 'ERROR' });
            }
        } catch (e) {
            showModal({ title: 'ERROR', message: 'Critical error while saving schedule', type: 'ERROR' });
        } finally {
            setSaving(false);
        }
    };

    const addRow = () => {
        setAssignments([...assignments, { playlistId: availablePlaylists.find(p => p.active === 'Y')?.playlistId || '' }]);
    };

    const removeRow = (index: number) => {
        setAssignments(assignments.filter((_, i) => i !== index));
    };

    const updateRow = (index: number, field: string, value: any) => {
        const updated = [...assignments];
        updated[index] = { ...updated[index], [field]: value };
        setAssignments(updated);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="w-full max-w-4xl p-8 rounded-3xl border border-border shadow-[0_0_50px_rgba(0,0,0,0.5)] relative flex flex-col max-h-[90vh] bg-card-solid">
                <div className="mb-6 shrink-0 relative z-10">
                    <div className="text-4xl mb-2">🗓️</div>
                    <h3 className="text-2xl font-black text-foreground uppercase tracking-tighter">Device Schedule</h3>
                    <p className="text-xs text-muted-foreground font-mono mt-1">Assign Playlists and validity periods for [{deviceName}]</p>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar relative z-10 min-h-[300px]">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-accent-cyan tracking-widest font-mono text-sm uppercase animate-pulse">Loading Schedule...</div>
                    ) : (
                        <div className="space-y-4">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-white/10 text-xs text-muted-foreground uppercase tracking-wider bg-white/5">
                                        <th className="p-3 font-bold w-1/3">Playlist</th>
                                        <th className="p-3 font-bold">Start Date (Optional)</th>
                                        <th className="p-3 font-bold">End Date (Optional)</th>
                                        <th className="p-3 font-bold text-center">Status</th>
                                        <th className="p-3 font-bold w-16"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {assignments.map((assignment, idx) => {
                                        const now = new Date();
                                        const st = assignment.startDate ? new Date(assignment.startDate) : null;
                                        const nd = assignment.endDate ? new Date(assignment.endDate) : null;

                                        let statusStr = "ACTIVE";
                                        let statusColor = "text-green-500 bg-green-500/10 border-green-500/30";

                                        if (st && st > now) {
                                            statusStr = "WAITING";
                                            statusColor = "text-amber-500 bg-amber-500/10 border-amber-500/30";
                                        } else if (nd && nd < now) {
                                            statusStr = "EXPIRED";
                                            statusColor = "text-red-500 bg-red-500/10 border-red-500/30";
                                        }

                                        return (
                                            <tr key={idx} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                                <td className="p-2">
                                                    <select
                                                        value={assignment.playlistId}
                                                        onChange={e => updateRow(idx, 'playlistId', e.target.value)}
                                                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-accent-cyan"
                                                    >
                                                        {availablePlaylists.filter(p => p.active === 'Y').map(p => (
                                                            <option key={p.playlistId} value={p.playlistId}>{p.playlistName}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="p-2">
                                                    <input
                                                        type="datetime-local"
                                                        value={assignment.startDate || ''}
                                                        onChange={e => updateRow(idx, 'startDate', e.target.value)}
                                                        className="w-full bg-muted/20 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-accent-cyan"
                                                    />
                                                </td>
                                                <td className="p-2">
                                                    <input
                                                        type="datetime-local"
                                                        value={assignment.endDate || ''}
                                                        onChange={e => updateRow(idx, 'endDate', e.target.value)}
                                                        className="w-full bg-muted/20 border border-border/50 rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-red-500/50"
                                                    />
                                                </td>
                                                <td className="p-2 text-center">
                                                    <span className={`text-[10px] font-bold px-2 py-1 rounded border ${statusColor} uppercase tracking-widest`}>
                                                        {statusStr}
                                                    </span>
                                                </td>
                                                <td className="p-2 text-center">
                                                    <button onClick={() => removeRow(idx)} className="text-red-500 hover:bg-red-500/10 p-2 rounded transition-colors text-xl">✕</button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {assignments.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="p-8 text-center text-muted-foreground font-mono text-sm uppercase tracking-widest border-b border-white/5">No Playlists Assigned To Schedule</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            <button onClick={addRow} className="w-full py-3 mt-4 border border-dashed border-border hover:border-accent-cyan/50 rounded-xl text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-accent-cyan transition-all bg-white/5 hover:bg-white/10">
                                + Add Playlist To Schedule
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex gap-4 mt-8 shrink-0 relative z-10 pt-4 border-t border-border/50">
                    <button onClick={onClose} disabled={saving} className="flex-1 py-4 rounded-xl bg-muted/20 text-muted-foreground font-bold hover:bg-muted/40 hover:text-foreground transition-all uppercase tracking-widest text-xs">Abort</button>
                    <button onClick={handleSave} disabled={saving || loading} className="flex-[2] py-4 rounded-xl bg-accent-cyan text-black font-black uppercase tracking-[0.2em] hover:bg-cyan-300 disabled:opacity-20 disabled:cursor-not-allowed transition-all shadow-[0_0_30px_rgba(34,211,238,0.3)] hover:shadow-[0_0_50px_rgba(34,211,238,0.5)] transform hover:-translate-y-1 text-xs">
                        {saving ? 'Syncing Schedule...' : 'Save & Sync Hierarchy'}
                    </button>
                </div>
            </div>
        </div>
    );
};

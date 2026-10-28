'use client';

import React, { useState, useEffect } from 'react';
import { deviceApi } from '../api/device-api';
import type { ApiResponse } from '@/lib/api-fetch';
import { useUI } from '@/features/ui/context/UIContext';
import { Playlist } from '@/features/playlists/types/playlist';
import { DateTimePicker24h } from '@/components/ui/DateTimePicker24h';
import { Modal } from '@/components/ui/Modal';

interface DevicePlaylistModalProps {
    isOpen: boolean;
    onClose: () => void;
    deviceId: string;
    deviceName: string;
    availablePlaylists: Playlist[];
    /** Current schedule mode of the device, when the caller knows it. */
    scheduleMode?: 'inherit' | 'explicit';
    /** Called after the schedule mode was reset to inherit, so the caller can refresh. */
    onScheduleModeChanged?: () => void;
}

type Assignment = { id?: number, playlistId: string, startDate?: string, endDate?: string };

function assignmentStatus(assignment: Assignment) {
    const now = new Date();
    const st = assignment.startDate ? new Date(assignment.startDate) : null;
    const nd = assignment.endDate ? new Date(assignment.endDate) : null;

    if (st && st > now) {
        return { label: 'WAITING', className: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30' };
    }
    if (nd && nd < now) {
        return { label: 'EXPIRED', className: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30' };
    }
    return { label: 'ACTIVE', className: 'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/30' };
}

export const DevicePlaylistModal: React.FC<DevicePlaylistModalProps> = ({ isOpen, onClose, deviceId, deviceName, availablePlaylists, scheduleMode, onScheduleModeChanged }) => {
    const { showModal } = useUI();
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [resettingToken, setResettingToken] = useState(false);

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
        setLoadFailed(false);
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
            } else {
                // Load failed (not a device with an empty schedule). Leaving assignments as [] and
                // allowing a save would overwrite the real schedule with nothing -- block it.
                setLoadFailed(true);
            }
        } catch (e) {
            console.error(e);
            setLoadFailed(true);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (loadFailed) {
            showModal({ title: 'ERROR', message: 'The current schedule could not be loaded, so it cannot be saved (that would erase it). Close and reopen to retry.', type: 'ERROR' });
            return;
        }
        setSaving(true);
        try {
            const payload = assignments.map(a => ({
                playlistId: a.playlistId,
                startDate: parseLocalInputToUtc(a.startDate),
                endDate: parseLocalInputToUtc(a.endDate),
            }));

            const res = await deviceApi.updateAssignedPlaylists(deviceId, payload);
            if (res.success) {
                showModal({ title: 'SUCCESS', message: 'Assigned playlists and schedule updated. Sync command sent.', type: 'SUCCESS' });
                onClose();
            } else {
                showModal({ title: 'ERROR', message: res.message || 'Failed to update schedule', type: 'ERROR' });
            }
        } catch {
            showModal({ title: 'ERROR', message: 'Critical error while saving schedule', type: 'ERROR' });
        } finally {
            setSaving(false);
        }
    };

    const handleResetToInherit = () => {
        showModal({
            title: 'Reset to inherited schedule?',
            message: `${deviceName} will drop its own assignments and follow a sibling screen (same branch and name) again.`,
            type: 'DANGER',
            confirmText: 'Reset',
            onConfirm: async () => {
                setResetting(true);
                try {
                    const res = await deviceApi.resetScheduleToInherit(deviceId);
                    if (res.success) {
                        showModal({ title: 'SUCCESS', message: 'Schedule mode reset to inherit.', type: 'SUCCESS' });
                        onScheduleModeChanged?.();
                        onClose();
                    } else {
                        showModal({ title: 'ERROR', message: res.message || 'Failed to reset schedule mode', type: 'ERROR' });
                    }
                } catch {
                    showModal({ title: 'ERROR', message: 'Critical error while resetting schedule mode', type: 'ERROR' });
                } finally {
                    setResetting(false);
                }
            }
        });
    };

    // Contract T11: clears the device's token hash on the server so the screen can claim a new one
    // (used after a reinstall or when a token was lost). The API method is provided by the device
    // API module; it is read through an optional accessor so this file compiles with either build.
    const resetDeviceTokenApi = (deviceApi as { resetDeviceToken?: (id: string) => Promise<ApiResponse<unknown>> }).resetDeviceToken;

    const handleResetDeviceToken = () => {
        if (!resetDeviceTokenApi) {
            showModal({ title: 'Unavailable', message: 'Device token reset is not available in this build.', type: 'ERROR' });
            return;
        }
        showModal({
            title: 'Reset device token?',
            message: `${deviceName} will be able to claim a NEW token on its next check-in. Until it does, its requests are accepted only while Security:DeviceAuth is not Required. Use this after a reinstall or when the screen reports DEVICE TOKEN REJECTED.`,
            type: 'DANGER',
            confirmText: 'Reset token',
            onConfirm: async () => {
                setResettingToken(true);
                try {
                    const res = await resetDeviceTokenApi(deviceId);
                    if (res.success) {
                        showModal({ title: 'SUCCESS', message: 'Device token cleared. The screen will claim a new one on its next check-in.', type: 'SUCCESS' });
                        onScheduleModeChanged?.();
                    } else {
                        showModal({ title: 'ERROR', message: res.message || 'Failed to reset the device token', type: 'ERROR' });
                    }
                } catch {
                    showModal({ title: 'ERROR', message: 'Critical error while resetting the device token', type: 'ERROR' });
                } finally {
                    setResettingToken(false);
                }
            }
        });
    };

    const addRow = () => {
        setAssignments([...assignments, { playlistId: availablePlaylists.find(p => p.active === 'Y')?.playlistId || '' }]);
    };

    const removeRow = (index: number) => {
        setAssignments(assignments.filter((_, i) => i !== index));
    };

    const updateRow = (index: number, field: 'playlistId' | 'startDate' | 'endDate', value: string | undefined) => {
        const updated = [...assignments];
        updated[index] = { ...updated[index], [field]: value };
        setAssignments(updated);
    };

    const activePlaylists = availablePlaylists.filter(p => p.active === 'Y');
    const playlistName = (id: string) => availablePlaylists.find(p => p.playlistId === id)?.playlistName || '';
    const selectClass = 'w-full bg-muted/20 border border-border rounded-xl px-3 h-[46px] text-sm font-mono text-foreground outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 cursor-pointer transition-colors';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="none"
            scroll={false}
            closeDisabled={saving || resetting || resettingToken}
            labelledBy="device-schedule-title"
            describedBy="device-schedule-desc"
            zIndexClass="z-[1000]"
            className="max-w-[95vw] xl:max-w-7xl p-6 sm:p-10 flex flex-col bg-card-solid"
        >
            <div className="mb-6 shrink-0">
                <div className="text-4xl mb-2" aria-hidden="true">🗓️</div>
                <h3 id="device-schedule-title" className="text-2xl sm:text-3xl font-black text-foreground uppercase tracking-tighter">Device schedule</h3>
                <p id="device-schedule-desc" className="text-sm text-muted-foreground mt-1">
                    Assign playlists and validity periods for <span className="font-bold text-foreground">{deviceName}</span>.
                    Clearing every playlist leaves this screen idle; it no longer inherits a sibling&apos;s schedule automatically.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border bg-muted/20 font-bold uppercase tracking-wider text-muted-foreground">
                        Mode: <span className="text-foreground">{scheduleMode === 'inherit' ? 'Inherit from sibling' : scheduleMode === 'explicit' ? 'Explicit' : 'Unknown'}</span>
                    </span>
                    {scheduleMode !== 'inherit' && (
                        <button
                            type="button"
                            onClick={handleResetToInherit}
                            disabled={resetting || saving}
                            className="px-3 py-1 rounded-lg border border-border text-muted-foreground font-bold uppercase tracking-wider hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
                        >
                            {resetting ? 'Resetting…' : 'Reset to inherit sibling schedule'}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleResetDeviceToken}
                        disabled={resettingToken || saving || resetting}
                        title="Clear this screen's device token so it can claim a new one (after a reinstall or a DEVICE TOKEN REJECTED notice)"
                        className="px-3 py-1 rounded-lg border border-amber-500/40 text-amber-700 dark:text-amber-400 font-bold uppercase tracking-wider hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                    >
                        {resettingToken ? 'Resetting token…' : 'Reset device token'}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-[300px]">
                {loading ? (
                    <div className="flex items-center justify-center h-full text-accent-cyan tracking-widest font-mono text-sm uppercase" role="status">Loading schedule…</div>
                ) : (
                    <div className="space-y-4">
                        {/* Wide layout: table */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider bg-muted/20">
                                        <th scope="col" className="p-3 font-bold min-w-[200px]">Playlist</th>
                                        <th scope="col" className="p-3 font-bold min-w-[220px]">Start date (optional)</th>
                                        <th scope="col" className="p-3 font-bold min-w-[220px]">End date (optional)</th>
                                        <th scope="col" className="p-3 font-bold text-center w-[110px]">Status</th>
                                        <th scope="col" className="p-3 font-bold w-12"><span className="sr-only">Remove</span></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {assignments.map((assignment, idx) => {
                                        const status = assignmentStatus(assignment);
                                        return (
                                            <tr key={idx} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
                                                <td className="p-2">
                                                    <select
                                                        value={assignment.playlistId}
                                                        onChange={e => updateRow(idx, 'playlistId', e.target.value)}
                                                        title={playlistName(assignment.playlistId)}
                                                        aria-label={`Playlist for row ${idx + 1}`}
                                                        className={selectClass}
                                                    >
                                                        {activePlaylists.map(p => (
                                                            <option key={p.playlistId} value={p.playlistId}>{p.playlistName}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="p-2">
                                                    <DateTimePicker24h
                                                        value={assignment.startDate || ''}
                                                        onChange={val => updateRow(idx, 'startDate', val)}
                                                        isLarge={true}
                                                        ariaLabel={`Start date for row ${idx + 1}`}
                                                    />
                                                </td>
                                                <td className="p-2">
                                                    <DateTimePicker24h
                                                        value={assignment.endDate || ''}
                                                        onChange={val => updateRow(idx, 'endDate', val)}
                                                        isLarge={true}
                                                        ariaLabel={`End date for row ${idx + 1}`}
                                                    />
                                                </td>
                                                <td className="p-2 text-center">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded border ${status.className} uppercase tracking-widest`}>
                                                        {status.label}
                                                    </span>
                                                </td>
                                                <td className="p-2 text-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => removeRow(idx)}
                                                        aria-label={`Remove row ${idx + 1}`}
                                                        className="text-red-500 hover:bg-red-500/10 p-2 rounded transition-colors text-xl leading-none"
                                                    >
                                                        ✕
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {assignments.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="p-8 text-center text-muted-foreground font-mono text-sm uppercase tracking-widest border-b border-border/50">No playlists assigned to schedule</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Narrow layout: stacked cards */}
                        <ul className="md:hidden space-y-3">
                            {assignments.map((assignment, idx) => {
                                const status = assignmentStatus(assignment);
                                return (
                                    <li key={idx} className="rounded-2xl border border-border bg-muted/10 p-4 space-y-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className={`text-xs font-bold px-2 py-1 rounded border ${status.className} uppercase tracking-widest`}>{status.label}</span>
                                            <button
                                                type="button"
                                                onClick={() => removeRow(idx)}
                                                aria-label={`Remove row ${idx + 1}`}
                                                className="text-red-500 hover:bg-red-500/10 p-2 rounded transition-colors text-xl leading-none"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                        <div>
                                            <label htmlFor={`sched-playlist-${idx}`} className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Playlist</label>
                                            <select
                                                id={`sched-playlist-${idx}`}
                                                value={assignment.playlistId}
                                                onChange={e => updateRow(idx, 'playlistId', e.target.value)}
                                                className={selectClass}
                                            >
                                                {activePlaylists.map(p => (
                                                    <option key={p.playlistId} value={p.playlistId}>{p.playlistName}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor={`sched-start-${idx}`} className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">Start date (optional)</label>
                                            <DateTimePicker24h id={`sched-start-${idx}`} value={assignment.startDate || ''} onChange={val => updateRow(idx, 'startDate', val)} isLarge={true} />
                                        </div>
                                        <div>
                                            <label htmlFor={`sched-end-${idx}`} className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">End date (optional)</label>
                                            <DateTimePicker24h id={`sched-end-${idx}`} value={assignment.endDate || ''} onChange={val => updateRow(idx, 'endDate', val)} isLarge={true} />
                                        </div>
                                    </li>
                                );
                            })}
                            {assignments.length === 0 && (
                                <li className="p-8 text-center text-muted-foreground font-mono text-sm uppercase tracking-widest rounded-2xl border border-dashed border-border">No playlists assigned to schedule</li>
                            )}
                        </ul>

                        <button
                            type="button"
                            onClick={addRow}
                            disabled={activePlaylists.length === 0}
                            className="w-full py-4 mt-4 border border-dashed border-border hover:border-accent-cyan/50 rounded-xl text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-accent-cyan transition-colors bg-muted/10 hover:bg-muted/20 disabled:opacity-50"
                        >
                            + Add playlist to schedule
                        </button>
                    </div>
                )}
            </div>

            <div className="flex gap-4 mt-8 shrink-0 pt-4 border-t border-border/50">
                <button type="button" onClick={onClose} disabled={saving} className="flex-1 py-4 rounded-xl bg-muted/20 text-muted-foreground font-bold hover:bg-muted/40 hover:text-foreground transition-colors uppercase tracking-widest text-xs disabled:opacity-50">Cancel</button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || loading || loadFailed}
                    title={loadFailed ? 'The schedule could not be loaded; saving is blocked to avoid erasing it.' : undefined}
                    className="flex-[2] py-4 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-[0.2em] hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs"
                >
                    {saving ? 'Saving schedule…' : 'Save & sync'}
                </button>
            </div>
        </Modal>
    );
};

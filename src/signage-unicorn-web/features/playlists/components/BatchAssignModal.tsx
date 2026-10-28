'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { deviceApi } from '@/features/devices/api/device-api';
import { Device } from '@/features/devices/types';
import { DateTimePicker24h } from '@/components/ui/DateTimePicker24h';
import { Modal } from '@/components/ui/Modal';

interface BatchAssignModalProps {
    playlistId: string;
    playlistName: string;
    onClose: () => void;
    onSuccess: () => void;
}

export const BatchAssignModal: React.FC<BatchAssignModalProps> = ({ playlistId, playlistName, onClose, onSuccess }) => {
    const [devices, setDevices] = useState<Device[]>([]);
    const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [filterBranch, setFilterBranch] = useState('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    useEffect(() => {
        fetchDevices();
    }, []);

    const fetchDevices = async () => {
        try {
            const res = await deviceApi.getAll();
            if (res.success && res.data) {
                setDevices(res.data);
            }
        } catch (error) {
            console.error('Failed to fetch devices', error);
        } finally {
            setLoading(false);
        }
    };

    const branches = useMemo(() => {
        const b = new Set(devices.map(d => d.branchCode));
        return ['ALL', ...Array.from(b)];
    }, [devices]);

    const filteredDevices = useMemo(() => {
        let result = devices;

        if (filterBranch !== 'ALL') {
            result = result.filter(d => d.branchCode === filterBranch);
        }

        if (searchTerm.trim()) {
            const lowerSearch = searchTerm.toLowerCase();
            result = result.filter(d =>
                (d.deviceName?.toLowerCase() || '').includes(lowerSearch) ||
                (d.branchCode?.toLowerCase() || '').includes(lowerSearch) ||
                (d.ipAddress?.toLowerCase() || '').includes(lowerSearch)
            );
        }

        return result;
    }, [devices, filterBranch, searchTerm]);

    const handleToggleDevice = (id: string) => {
        setSelectedDeviceIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const handleSelectAllFiltered = () => {
        const filteredIds = filteredDevices.map(d => d.deviceId);
        const allSelected = filteredIds.every(id => selectedDeviceIds.includes(id));

        if (allSelected) {
            setSelectedDeviceIds(prev => prev.filter(id => !filteredIds.includes(id)));
        } else {
            setSelectedDeviceIds(prev => Array.from(new Set([...prev, ...filteredIds])));
        }
    };

    const handleAssign = async () => {
        if (selectedDeviceIds.length === 0) return;
        setSubmitting(true);
        try {
            const st = startDate ? new Date(startDate).toISOString() : undefined;
            const ed = endDate ? new Date(endDate).toISOString() : undefined;
            const res = await deviceApi.batchAddSchedule(selectedDeviceIds, playlistId, st, ed);
            if (res.success) {
                onSuccess();
            } else {
                alert('Failed to batch assign schedule.');
            }
        } catch {
            alert('Failed to batch assign schedule.');
        } finally {
            setSubmitting(false);
        }
    };

    const isOnline = (device: Device) => ['ONLINE', 'PLAYING', 'IDLE'].includes(device.status?.toUpperCase() || '');

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="none"
            scroll={false}
            closeDisabled={submitting}
            labelledBy="batch-deploy-title"
            zIndexClass="z-[1000]"
            className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        >
            {/* Modal Header */}
            <div className="p-6 sm:p-8 border-b border-border bg-muted/10">
                <div className="flex justify-between items-start gap-4">
                    <div>
                        <h3 id="batch-deploy-title" className="text-2xl sm:text-3xl font-black neon-text uppercase tracking-tighter">Batch deployment schedule</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                            Playlist: <span className="text-accent-cyan font-bold">{playlistName}</span>
                        </p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close dialog" className="text-muted-foreground hover:text-foreground text-2xl leading-none p-1 rounded-lg hover:bg-muted/30 transition-colors">✕</button>
                </div>

                <div className="flex gap-4 mt-6 flex-wrap items-center">
                    <div className="relative flex-1 min-w-[200px]">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true">🔍</span>
                        <input
                            type="search"
                            aria-label="Search devices by name, branch or IP"
                            placeholder="Search devices / IP…"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-muted/20 border border-border rounded-xl py-2 pl-12 pr-4 text-xs font-mono text-foreground focus:border-accent-cyan outline-none transition-colors placeholder:text-muted-foreground/70"
                        />
                    </div>
                    <div className="flex bg-muted/20 rounded-xl p-1 border border-border h-max flex-wrap" role="group" aria-label="Filter by branch">
                        {branches.map(b => (
                            <button
                                type="button"
                                key={b}
                                onClick={() => setFilterBranch(b)}
                                aria-pressed={filterBranch === b}
                                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${filterBranch === b ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                {b}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={handleSelectAllFiltered}
                        className="px-6 py-2 rounded-xl bg-muted/20 border border-border text-xs font-bold hover:bg-muted/40 transition-colors uppercase tracking-widest h-[42px] text-foreground"
                    >
                        Toggle select visible
                    </button>
                </div>
            </div>

            {/* Device List & Schedule Option */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar bg-background/40 flex flex-col md:flex-row gap-6">
                <div className="flex-1">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Select devices</h4>
                    {loading ? (
                        <div className="text-center py-20 text-muted-foreground font-mono uppercase tracking-[0.3em]" role="status">Loading devices…</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="group" aria-label="Devices">
                            {filteredDevices.map(device => {
                                const selected = selectedDeviceIds.includes(device.deviceId);
                                return (
                                    <button
                                        type="button"
                                        key={device.deviceId}
                                        onClick={() => handleToggleDevice(device.deviceId)}
                                        aria-pressed={selected}
                                        className={`w-full text-left p-4 rounded-2xl border transition-colors flex items-center justify-between ${selected
                                            ? 'bg-accent-cyan/10 border-accent-cyan'
                                            : 'bg-muted/20 border-border/50 hover:border-border'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`w-3 h-3 rounded-full shrink-0 ${isOnline(device) ? 'bg-green-500' : 'bg-red-700'}`} aria-hidden="true" />
                                            <div className="min-w-0">
                                                <div className="text-sm font-bold truncate text-foreground">{device.deviceName}</div>
                                                <div className="text-xs text-muted-foreground font-mono">{device.branchCode} • {device.ipAddress} • {isOnline(device) ? 'online' : 'offline'}</div>
                                            </div>
                                        </div>
                                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors shrink-0 ${selected
                                            ? 'bg-primary border-accent-cyan text-primary-foreground'
                                            : 'border-border'
                                            }`} aria-hidden="true">
                                            {selected && '✓'}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Schedule Column */}
                <div className="w-full md:w-64 space-y-4">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Schedule window</h4>
                    <div className="glass-panel p-4 rounded-xl space-y-4">
                        <div>
                            <span className="block text-xs font-bold text-muted-foreground uppercase mb-1">Status</span>
                            <span className="bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30 text-xs px-2 py-1 rounded">ACTIVE</span>
                        </div>
                        <div>
                            <label htmlFor="batch-deploy-start" className="block text-xs font-bold text-muted-foreground uppercase mb-1">Start date (optional)</label>
                            <DateTimePicker24h
                                id="batch-deploy-start"
                                value={startDate}
                                onChange={setStartDate}
                                placeholderDate="Start date"
                            />
                        </div>
                        <div>
                            <label htmlFor="batch-deploy-end" className="block text-xs font-bold text-muted-foreground uppercase mb-1">End date (optional)</label>
                            <DateTimePicker24h
                                id="batch-deploy-end"
                                value={endDate}
                                onChange={setEndDate}
                                placeholderDate="End date"
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="p-6 sm:p-8 border-t border-border bg-muted/10 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-sm font-mono text-muted-foreground uppercase" aria-live="polite">
                    Selected: <span className="text-accent-cyan font-bold">{selectedDeviceIds.length}</span> / {devices.length} devices
                </div>
                <div className="flex gap-4">
                    <button type="button" onClick={onClose} disabled={submitting} className="px-8 py-3 rounded-xl hover:bg-muted/30 font-bold transition-colors text-xs uppercase tracking-widest text-foreground disabled:opacity-50">Cancel</button>
                    <button
                        type="button"
                        disabled={selectedDeviceIds.length === 0 || submitting}
                        onClick={handleAssign}
                        className="px-10 py-3 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-[0.2em] disabled:opacity-30 transition-colors text-xs hover:brightness-110"
                    >
                        {submitting ? 'Assigning…' : 'Assign schedule'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

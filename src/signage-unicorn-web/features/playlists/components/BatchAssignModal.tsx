'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { deviceApi } from '@/features/devices/api/device-api';
import { Device } from '@/features/devices/types';

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
            const command = `PLAY_PLAYLIST:${playlistId}`;
            await deviceApi.batchSendCommand(selectedDeviceIds, command);
            onSuccess();
        } catch (error) {
            alert('Failed to batch assign playlist.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="glass-panel w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-white/10 shadow-[0_0_50px_rgba(34,211,238,0.2)] overflow-hidden">

                {/* Modal Header */}
                <div className="p-8 border-b border-white/5 bg-white-[0.02]">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-3xl font-black neon-text uppercase tracking-tighter">Batch Deployment</h3>
                            <p className="text-sm text-gray-400 font-mono mt-1">
                                TARGETING: <span className="text-accent-cyan font-bold">{playlistName}</span>
                            </p>
                        </div>
                        <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl">✕</button>
                    </div>

                    <div className="flex gap-4 mt-8 flex-wrap items-center">
                        <div className="relative flex-1 min-w-[200px]">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
                            <input
                                type="text"
                                placeholder="SEARCH DEVICES / IP..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-black/40 border border-white/10 rounded-xl py-2 pl-12 pr-4 text-xs font-mono focus:border-accent-cyan outline-none transition-all"
                            />
                        </div>
                        <div className="flex bg-black/40 rounded-xl p-1 border border-white/10 h-max">
                            {branches.map(b => (
                                <button
                                    key={b}
                                    onClick={() => setFilterBranch(b)}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${filterBranch === b ? 'bg-accent-cyan text-black' : 'text-gray-500 hover:text-white'}`}
                                >
                                    {b}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={handleSelectAllFiltered}
                            className="px-6 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold hover:bg-white/10 transition-all uppercase tracking-widest h-[42px]"
                        >
                            Toggle Select Visible
                        </button>
                    </div>
                </div>

                {/* Device List */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-black/20">
                    {loading ? (
                        <div className="text-center py-20 animate-pulse text-gray-500 font-mono uppercase tracking-[0.3em]">Scanning Network...</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredDevices.map(device => (
                                <div
                                    key={device.deviceId}
                                    onClick={() => handleToggleDevice(device.deviceId)}
                                    className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between group ${selectedDeviceIds.includes(device.deviceId)
                                        ? 'bg-accent-cyan/10 border-accent-cyan shadow-[0_0_15px_rgba(34,211,238,0.1)]'
                                        : 'bg-white/5 border-white/5 hover:border-white/10'
                                        }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-3 h-3 rounded-full ${['ONLINE', 'PLAYING', 'IDLE'].includes(device.status?.toUpperCase() || '') ? 'bg-green-500' : 'bg-red-900'}`} />
                                        <div>
                                            <div className="text-sm font-bold truncate max-w-[150px]">{device.deviceName}</div>
                                            <div className="text-[0.625rem] text-gray-500 font-mono">{device.branchCode} • {device.ipAddress}</div>
                                        </div>
                                    </div>
                                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${selectedDeviceIds.includes(device.deviceId)
                                        ? 'bg-accent-cyan border-accent-cyan text-black'
                                        : 'border-white/20'
                                        }`}>
                                        {selectedDeviceIds.includes(device.deviceId) && '✓'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-8 border-t border-white/10 bg-black/40 flex justify-between items-center">
                    <div className="text-sm font-mono text-gray-500 uppercase">
                        Selected: <span className="text-accent-cyan font-bold">{selectedDeviceIds.length}</span> / {devices.length} Nodes
                    </div>
                    <div className="flex gap-4">
                        <button onClick={onClose} className="px-8 py-3 rounded-xl hover:bg-white/5 font-bold transition-all text-xs uppercase tracking-widest">Cancel</button>
                        <button
                            disabled={selectedDeviceIds.length === 0 || submitting}
                            onClick={handleAssign}
                            className="px-10 py-3 rounded-xl bg-accent-cyan text-black font-black uppercase tracking-[0.2em] shadow-[0_0_30px_rgba(34,211,238,0.3)] hover:scale-105 disabled:opacity-20 disabled:scale-100 transition-all text-xs"
                        >
                            {submitting ? 'EXECUTING...' : 'INITIATE BROADCAST'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

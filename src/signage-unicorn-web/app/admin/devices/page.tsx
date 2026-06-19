'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { deviceApi } from '@/features/devices/api/device-api';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { Device } from '@/features/devices/types';
import { Playlist, PlaylistItem } from '@/features/playlists/types/playlist';
import { useUI } from '@/features/ui/context/UIContext';
import { DevicePlaylistModal } from '@/features/devices/components/DevicePlaylistModal';
import { BatchRemovePlaylistModal } from '@/features/devices/components/BatchRemovePlaylistModal';
import { BatchAssignPlaylistModal } from '@/features/devices/components/BatchAssignPlaylistModal';

const formatDuration = (seconds?: number) => {
    if (!seconds) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [hrs, mins, secs].map(v => v.toString().padStart(2, '0')).join(':');
};

const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
    if (isNaN(d.getTime())) return '-';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};


export default function DevicesPage() {
    // --- API Handlers (Defined before usage) ---
    const { theme, showModal } = useUI();
    const [devices, setDevices] = useState<Device[]>([]);
    const [playlists, setPlaylists] = useState<Playlist[]>([]);

    // UI State
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [initDbLoading, setInitDbLoading] = useState(false);

    // Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'ONLINE' | 'OFFLINE'>('ALL');
    const [sortBy, setSortBy] = useState<'NAME' | 'STATUS' | 'CHECKIN' | 'BRANCH' | 'VERSION'>('NAME');
    const [viewMode, setViewMode] = useState<'GRID' | 'LIST'>('GRID');

    // Branch Collapsing State
    const [collapsedBranches, setCollapsedBranches] = useState<Record<string, boolean>>({});

    // Modal State
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [isBatchRemoveModalOpen, setIsBatchRemoveModalOpen] = useState(false);
    const [isBatchAssignModalOpen, setIsBatchAssignModalOpen] = useState(false);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
    const [activeScreenshotDeviceId, setActiveScreenshotDeviceId] = useState<string | null>(null);
    const [screenshotUrl, setScreenshotUrl] = useState<string>('');

    const [mediaMap, setMediaMap] = useState<Record<string, string>>({});
    const [playlistItemsMap, setPlaylistItemsMap] = useState<Record<string, PlaylistItem[]>>({});

    // Selection State
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    // Refs to prevent duplicate requests
    const fetchingIdsRef = useRef<Set<string>>(new Set());

    // Local progress tracking for smooth real-time bar animation
    const [localProgressOffsets, setLocalProgressOffsets] = useState<Record<string, number>>({});

    const showNotify = (title: string, message: string, type: 'INFO' | 'SUCCESS' | 'ERROR' = 'INFO') => {
        showModal({ title, message, type });
    };

    const showConfirm = (title: string, message: string, onConfirm: () => void, type: 'DANGER' | 'INFO' = 'INFO') => {
        showModal({ title, message, type, onConfirm });
    };

    async function fetchMediaNames() {
        try {
            const { mediaApi } = await import('@/features/media/api/media-api');
            const res = await mediaApi.getAll();
            if (res.success && res.data) {
                const map: Record<string, string> = {};
                res.data.forEach(m => {
                    map[m.mediaId] = m.displayName || m.fileName;
                });
                setMediaMap(map);
            }
        } catch (e) {
            console.error('Failed to fetch media names', e);
        }
    }

    async function fetchDevices() {
        try {
            const res = await deviceApi.getAll();
            if (res.success && res.data) {
                setDevices(res.data);
            }
        } catch (error) {
            console.error('Failed to fetch devices', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }

    async function fetchPlaylists() {
        try {
            const res = await playlistApi.getAll();
            if (res.success && res.data) setPlaylists(res.data);
        } catch (error) {
            console.error('Failed to fetch playlists', error);
        }
    }

    function handleRefresh() {
        setRefreshing(true);
        fetchDevices();
        fetchPlaylists();
        fetchMediaNames();
    }

    async function handleCommand(deviceId: string, command: string) {
        showConfirm(
            'SYSTEM COMMAND',
            `Are you sure you want to send ${command} to this device?`,
            async () => {
                try {
                    const res = await deviceApi.sendCommand(deviceId, command);
                    if (res.success) {
                        showNotify('SUCCESS', `Command ${command} queued successfully.`, 'SUCCESS');
                    } else {
                        showNotify('FAILED', res.message || 'Unknown protocol error', 'ERROR');
                    }
                } catch (error) {
                    showNotify('CRITICAL ERROR', 'A critical error occurred while sending the command.', 'ERROR');
                }
            }
        );
    }

    async function handleBatchCommand(command: string) {
        if (selectedIds.length === 0) return;
        showConfirm(
            'BATCH SYSTEM COMMAND',
            `Are you sure you want to send ${command} to ${selectedIds.length} selected devices?`,
            async () => {
                try {
                    const res = await deviceApi.batchSendCommand(selectedIds, command);
                    if (res.success) {
                        showNotify('BATCH SUCCESS', `Command ${command} sent to ${selectedIds.length} devices!`, 'SUCCESS');
                        setSelectedIds([]);
                    } else {
                        showNotify('BATCH FAILED', res.message || 'Unknown error', 'ERROR');
                    }
                } catch (error) {
                    showNotify('CRITICAL ERROR', 'A critical error occurred while sending batch command.', 'ERROR');
                }
            }
        );
    }

    async function handleClearSchedule(deviceIds: string[]) {
        showConfirm(
            'CLEAR PLAYLIST',
            `Are you sure you want to remove the playlist from ${deviceIds.length === 1 ? 'this device' : `${deviceIds.length} devices`}?`,
            async () => {
                try {
                    const res = await deviceApi.batchClearSchedule(deviceIds);
                    if (res.success) {
                        showNotify('CLEARED', `Playlist removed successfully.`, 'SUCCESS');
                        if (deviceIds.length > 1) setSelectedIds([]);
                        fetchDevices();
                    } else {
                        showNotify('FAILED', res.message || 'Unknown error', 'ERROR');
                    }
                } catch (error) {
                    showNotify('CRITICAL ERROR', 'A critical error occurred while clearing schedule.', 'ERROR');
                }
            },
            'DANGER'
        );
    }

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === filteredDevices.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(filteredDevices.map(d => d.deviceId));
        }
    };

    async function handleDeleteDevice(deviceId: string) {
        showConfirm(
            'DEACTIVATE NODE',
            'Are you sure you want to deactivate/remove this device from the grid?',
            async () => {
                try {
                    const res = await deviceApi.deleteDevice(deviceId);
                    if (res.success) {
                        fetchDevices();
                        showNotify('DEACTIVATED', 'Device removed successfully.', 'SUCCESS');
                    } else {
                        showNotify('ACCESS DENIED', res.message || 'Deactivation failed', 'ERROR');
                    }
                } catch (error) {
                    showNotify('CRITICAL ERROR', 'A critical error occurred while deactivating the device.', 'ERROR');
                }
            },
            'DANGER'
        );
    }

    async function handleCleanupZombies() {
        showConfirm(
            'ZOMBIE CLEANUP',
            'This will deactivate all devices that have been offline for more than 14 days. Proceed?',
            async () => {
                try {
                    const res = await deviceApi.cleanupOffline();
                    if (res.success) {
                        fetchDevices();
                        showNotify('CLEANUP COMPLETE', 'Zombie cleanup successful.', 'SUCCESS');
                    } else {
                        showNotify('FAILED', res.message || 'Unknown error', 'ERROR');
                    }
                } catch (error) {
                    showNotify('CRITICAL ERROR', 'A critical error occurred during cleanup.', 'ERROR');
                }
            },
            'DANGER'
        );
    }

    async function handleInitDb() {
        showConfirm(
            'DATABASE INITIALIZATION',
            'This will update/initialize the database schema (Tables & Stored Procedures). Proceed?',
            async () => {
                setInitDbLoading(true);
                try {
                    const res = await deviceApi.fixDb();
                    if (res.success) {
                        showNotify('SYSTEM INITIALIZED', 'Database Initialized Successfully!', 'SUCCESS');
                    } else {
                        showNotify('FAILED', res.message || 'Unknown error', 'ERROR');
                    }
                } catch (error) {
                    showNotify('CRITICAL ERROR', 'A critical error occurred while initializing the database.', 'ERROR');
                } finally {
                    setInitDbLoading(false);
                    fetchDevices();
                }
            }
        );
    }

    const toggleBranchCollapse = (branch: string) => {
        setCollapsedBranches(prev => ({
            ...prev,
            [branch]: !prev[branch]
        }));
    };

    function openAssignModal(deviceId: string) {
        setSelectedDeviceId(deviceId);
        setIsAssignModalOpen(true);
    }

    const viewScreenshot = (deviceId: string) => {
        setActiveScreenshotDeviceId(deviceId);
        const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
        const serverUrl = apiBase.replace('/api/v1', '');
        setScreenshotUrl(`${serverUrl}/screenshots/${deviceId}.jpg?t=${Date.now()}`);
        deviceApi.sendCommand(deviceId, 'CAPTURE_SCREEN').catch(console.error);

        // Poll for the new screenshot every 2 seconds for the first 10 seconds
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            setScreenshotUrl(`${serverUrl}/screenshots/${deviceId}.jpg?t=${Date.now()}`);
            if (attempts >= 5) {
                clearInterval(interval);
            }
        }, 2000);
    };

    const refreshScreenshot = async (deviceId: string) => {
        try {
            await deviceApi.sendCommand(deviceId, 'CAPTURE_SCREEN');
            showNotify('COMMAND SENT', 'Requested screen capture. The image will update in a few seconds.', 'INFO');
            
            const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
            const serverUrl = apiBase.replace('/api/v1', '');
            
            // Poll for the new screenshot every 2 seconds for the next 10 seconds
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                setScreenshotUrl(`${serverUrl}/screenshots/${deviceId}.jpg?t=${Date.now()}`);
                if (attempts >= 5) {
                    clearInterval(interval);
                }
            }, 2000);
        } catch (e) {
            showNotify('FAILED', 'Failed to request screenshot capture', 'ERROR');
        }
    };

    // --- Effects ---
    useEffect(() => {
        fetchDevices();
        fetchPlaylists();
        fetchMediaNames();
        const interval = setInterval(fetchDevices, 10000); // Poll every 10 seconds to improve performance
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const fetchMissingPlaylists = async () => {
            const neededIds = new Set(devices.map(d => d.currentPlaylistId).filter(Boolean) as string[]);
            const missingIds = [...neededIds].filter(id => !playlistItemsMap[id] && !fetchingIdsRef.current.has(id));

            if (missingIds.length > 0) {
                missingIds.forEach(id => fetchingIdsRef.current.add(id));

                for (const id of missingIds) {
                    try {
                        const res = await playlistApi.getById(id);
                        if (res.success && res.data && res.data.items) {
                            setPlaylistItemsMap(prev => ({
                                ...prev,
                                [id]: res.data?.items?.sort((a, b) => a.positionOrder - b.positionOrder) || []
                            }));
                        } else {
                            fetchingIdsRef.current.delete(id);
                        }
                    } catch (e) {
                        fetchingIdsRef.current.delete(id);
                    }
                }
            }
        };
        fetchMissingPlaylists();
    }, [devices]); // Fixed infinite loop by depending only on devices!

    // Timer to smoothly increment active clip progress locally
    useEffect(() => {
        const timer = setInterval(() => {
            setLocalProgressOffsets(prev => {
                const next = { ...prev };
                devices.forEach(d => {
                    const statusUpper = (d.status || '').toUpperCase();
                    const isOnline = ['ONLINE', 'PLAYING', 'IDLE'].includes(statusUpper);
                    if (isOnline && d.currentMediaId) {
                        next[d.deviceId] = (next[d.deviceId] || 0) + 1;
                    }
                });
                return next;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [devices]);

    // Reset local progress offset whenever devices list refreshes from server
    useEffect(() => {
        setLocalProgressOffsets({});
    }, [devices]);

    // --- Stats & Filter ---
    const stats = useMemo(() => {
        return {
            total: devices.length,
            online: devices.filter(d => ['ONLINE', 'PLAYING', 'IDLE'].includes(d.status?.toUpperCase() || '')).length,
            offline: devices.filter(d => !['ONLINE', 'PLAYING', 'IDLE'].includes(d.status?.toUpperCase() || '')).length,
            branches: new Set(devices.map(d => d.branchCode)).size
        };
    }, [devices]);

    const filteredDevices = useMemo(() => {
        let result = devices.filter(d => {
            const matchesSearch =
                d.deviceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                d.branchCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (d.deviceId || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                (d.status || '').toLowerCase().includes(searchQuery.toLowerCase());

            const matchesStatus =
                filterStatus === 'ALL' ||
                (filterStatus === 'ONLINE' && ['ONLINE', 'PLAYING', 'IDLE'].includes(d.status?.toUpperCase() || '')) ||
                (filterStatus === 'OFFLINE' && !['ONLINE', 'PLAYING', 'IDLE'].includes(d.status?.toUpperCase() || ''));

            return matchesSearch && matchesStatus;
        });

        // Sorting
        result.sort((a, b) => {
            if (sortBy === 'NAME') return a.deviceName.localeCompare(b.deviceName);
            if (sortBy === 'BRANCH') return a.branchCode.localeCompare(b.branchCode);
            if (sortBy === 'STATUS') {
                const aOnline = ['ONLINE', 'PLAYING', 'IDLE'].includes(a.status?.toUpperCase() || '');
                const bOnline = ['ONLINE', 'PLAYING', 'IDLE'].includes(b.status?.toUpperCase() || '');
                if (aOnline === bOnline) return a.deviceName.localeCompare(b.deviceName);
                return aOnline ? -1 : 1;
            }
            if (sortBy === 'CHECKIN') {
                return new Date(b.lastCheckIn || 0).getTime() - new Date(a.lastCheckIn || 0).getTime();
            }
            if (sortBy === 'VERSION') {
                return (b.appVersion || '').localeCompare(a.appVersion || '');
            }
            return 0;
        });

        return result;
    }, [devices, searchQuery, filterStatus, sortBy]);

    // Group devices by Branch
    const devicesByBranch = useMemo(() => {
        const groups: Record<string, Device[]> = {};
        filteredDevices.forEach(d => {
            const branch = d.branchCode || 'UNASSIGNED';
            if (!groups[branch]) groups[branch] = [];
            groups[branch].push(d);
        });
        return groups;
    }, [filteredDevices]);

    if (loading) {
        return <div className="p-10 text-center animate-pulse text-accent-cyan tracking-widest font-mono">CONNECTING TO NETWORK GRID...</div>;
    }

    return (
        <div className="p-8 space-y-8 min-h-screen">
            {/* Header & Stats */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter neon-text mb-2">Devices</h1>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-[0.3em]">
                        Terminal Node Status Monitor
                    </p>
                </div>
                <div className="flex gap-4">
                    <div className="glass-panel px-6 py-3 rounded-xl border border-white/10 flex flex-col items-center min-w-[100px]">
                        <span className="text-2xl font-black text-foreground">{stats.total}</span>
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Nodes</span>
                    </div>
                    <div className="glass-panel px-6 py-3 rounded-xl border border-white/10 flex flex-col items-center min-w-[100px] border-b-2 border-b-green-500/50 shadow-[0_4px_20px_rgba(34,197,94,0.15)]">
                        <span className="text-2xl font-black text-green-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.5)]">{stats.online}</span>
                        <span className="text-xs font-bold text-green-500/70 uppercase tracking-widest">Online</span>
                    </div>
                    <div className="glass-panel px-6 py-3 rounded-xl border border-white/10 flex flex-col items-center min-w-[100px] border-b-2 border-b-red-500/50 shadow-[0_4px_20px_rgba(239,68,68,0.15)]">
                        <span className="text-2xl font-black text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]">{stats.offline}</span>
                        <span className="text-xs font-bold text-red-500/70 uppercase tracking-widest">Offline</span>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="glass-panel p-4 rounded-2xl border border-white/10 flex flex-col md:flex-row gap-4 items-center justify-between sticky top-0 z-20 backdrop-blur-xl bg-black/40">
                <div className="flex items-center gap-4 w-full md:w-auto flex-wrap">
                    {/* Search */}
                    <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <span className="opacity-50">🔍</span>
                        </div>
                        <input
                            type="text"
                            placeholder="SEARCH..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs w-48 focus:border-accent-cyan outline-none transition-all placeholder:text-muted-foreground uppercase font-mono tracking-wide text-foreground hover:bg-white/10"
                        />
                    </div>

                    {/* Filter Dropdown */}
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as any)}
                        className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold uppercase outline-none focus:border-accent-cyan text-foreground hover:bg-white/10 cursor-pointer"
                    >
                        <option value="ALL">Show All Status</option>
                        <option value="ONLINE">Online Only</option>
                        <option value="OFFLINE">Offline Only</option>
                    </select>

                    {/* Sort Dropdown */}
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-xs font-bold uppercase outline-none focus:border-accent-cyan text-foreground hover:bg-white/10 cursor-pointer"
                    >
                        <option value="NAME">Sort by Name</option>
                        <option value="STATUS">Sort by Status</option>
                        <option value="CHECKIN">Sort by Recent</option>
                        <option value="BRANCH">Sort by Branch</option>
                        <option value="VERSION">Sort by Version</option>
                    </select>

                    {/* View Mode Toggle */}
                    <div className="flex bg-white/5 rounded-lg p-1 border border-white/10">
                        <button
                            onClick={() => setViewMode('GRID')}
                            className={`px-3 py-1 rounded text-xs transition-all ${viewMode === 'GRID' ? 'bg-accent-cyan text-black font-bold shadow' : 'text-muted-foreground hover:text-white'}`}
                        >
                            GRID
                        </button>
                        <button
                            onClick={() => setViewMode('LIST')}
                            className={`px-3 py-1 rounded text-xs transition-all ${viewMode === 'LIST' ? 'bg-accent-cyan text-black font-bold shadow' : 'text-muted-foreground hover:text-white'}`}
                        >
                            LIST
                        </button>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={toggleSelectAll} className={`px-3 py-2 rounded-lg border border-white/10 text-xs font-bold uppercase transition-all ${selectedIds.length > 0 ? 'bg-accent-cyan text-black border-accent-cyan' : 'text-muted-foreground hover:bg-white/10'}`}>
                        {selectedIds.length === filteredDevices.length && filteredDevices.length > 0 ? 'Deselect All' : 'Select All'}
                    </button>
                    <button onClick={handleRefresh} className={`text-xl p-2 rounded-lg border border-white/10 hover:bg-white/10 transition-all ${refreshing ? 'animate-spin text-accent-cyan' : 'text-muted-foreground'}`}>↻</button>
                    <button onClick={handleInitDb} disabled={initDbLoading} className="p-2 rounded-lg border border-white/10 hover:bg-white/10 text-xs font-bold uppercase text-muted-foreground">{initDbLoading ? 'Wait...' : 'Init DB'}</button>
                    <button onClick={handleCleanupZombies} className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-bold uppercase text-red-500 hover:bg-red-500 hover:text-white transition-all">Cleanup Zombies</button>
                </div>
            </div>

            {/* Grid View with Branch Accordion Grouping */}
            {viewMode === 'GRID' && (
                <div className="space-y-8">
                    {Object.entries(devicesByBranch).map(([branch, branchDevices]) => {
                        const isCollapsed = collapsedBranches[branch];
                        return (
                            <div key={`grid-branch-${branch}`} className="space-y-4">
                                <button
                                    onClick={() => toggleBranchCollapse(branch)}
                                    className="flex items-center gap-3 w-full text-left py-3 border-b border-white/10 hover:border-accent-cyan/30 transition-all group outline-none"
                                >
                                    <span className="text-xl font-bold uppercase tracking-widest text-white/80 group-hover:text-accent-cyan transition-colors flex items-center gap-2">
                                        🏢 Branch: {branch}
                                        <span className="text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10 text-muted-foreground group-hover:text-accent-cyan group-hover:border-accent-cyan/30">
                                            {branchDevices.length} {branchDevices.length === 1 ? 'Screen' : 'Screens'}
                                        </span>
                                    </span>
                                    <span className="text-[10px] font-mono text-muted-foreground ml-auto bg-white/5 px-2 py-1 rounded border border-white/5 group-hover:border-accent-cyan/20 group-hover:text-accent-cyan transition-all">
                                        {isCollapsed ? '▼ EXPAND' : '▲ COLLAPSE'}
                                    </span>
                                </button>

                                {!isCollapsed && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in fade-in duration-300">
                                        {branchDevices.map((device, index) => {
                                            const statusUpper = (device.status || '').toUpperCase();
                                            const isOnline = ['ONLINE', 'PLAYING', 'IDLE'].includes(statusUpper);
                                            const currentPlaylist = playlists.find(p => p.playlistId === device.currentPlaylistId);
                                            const mediaName = device.currentMediaId ? mediaMap[device.currentMediaId] || device.currentMediaId : 'Buffering...';

                                            const displayId = device.deviceUuid ? device.deviceUuid : device.deviceId;
                                            const isSelected = selectedIds.includes(device.deviceId);

                                            return (
                                                <div 
                                                    key={`grid-dev-${device.deviceId}-${index}`} 
                                                    className={`backdrop-blur-md bg-white/[0.02] p-6 rounded-2xl border transition-all duration-300 hover:-translate-y-1 flex flex-col relative overflow-hidden group ${
                                                        isSelected 
                                                            ? 'border-accent-cyan bg-accent-cyan/[0.03] shadow-[0_0_25px_rgba(34,211,238,0.15)]' 
                                                            : 'border-white/10 hover:border-white/20 hover:bg-white/[0.05]'
                                                    }`}
                                                >
                                                    {/* Selection Checkbox */}
                                                    <div className="absolute top-4 right-4 z-20">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleSelection(device.deviceId)}
                                                            className="w-5 h-5 rounded border-white/20 bg-black/40 checked:bg-accent-cyan transition-all cursor-pointer accent-cyan-500"
                                                        />
                                                    </div>

                                                    {/* Glow Status Top Bar */}
                                                    <div className={`absolute top-0 left-0 w-full h-1 ${
                                                        isOnline
                                                            ? 'bg-gradient-to-r from-transparent via-green-400 to-transparent shadow-[0_0_12px_#4ade80]'
                                                            : 'bg-gradient-to-r from-transparent via-red-500/40 to-transparent'
                                                    }`} />

                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className="overflow-hidden pr-6">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className={`w-2 h-2 rounded-full ${
                                                                    isOnline 
                                                                        ? 'bg-green-400 shadow-[0_0_8px_#4ade80] animate-pulse' 
                                                                        : 'bg-red-500 shadow-[0_0_8px_#ef4444]'
                                                                }`} />
                                                                <span className={`text-[10px] font-black uppercase tracking-widest ${
                                                                    isOnline ? 'text-green-400 drop-shadow-[0_0_6px_rgba(74,222,128,0.3)]' : 'text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.3)]'
                                                                }`}>
                                                                    {device.status}
                                                                </span>
                                                            </div>
                                                            <h3 className="text-md font-bold text-foreground truncate w-full" title={device.deviceName}>{device.deviceName}</h3>
                                                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5 flex items-center gap-2 truncate">
                                                                #{displayId.substring(0, 12)}...
                                                                {device.appVersion && <span className="text-white/40">[{device.appVersion}]</span>}
                                                                {device.currentPlaylistId && <span className="text-accent-cyan font-bold">: ACTIVE</span>}
                                                            </p>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="text-[9px] font-bold text-accent-purple bg-accent-purple/10 px-2 py-1 rounded border border-accent-purple/20 whitespace-nowrap uppercase tracking-wider">{device.branchCode}</span>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-3 mb-6 bg-white/[0.02] rounded-xl p-3 border border-white/5">
                                                        <div className="flex justify-between items-center text-xs">
                                                            <span className="text-muted-foreground uppercase tracking-wider font-bold text-[10px]">Check-In</span>
                                                            <span className="text-foreground font-mono text-[10px]">
                                                                {formatDateTime(device.lastCheckIn)}
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between items-center text-xs">
                                                            <span className="text-muted-foreground uppercase tracking-wider font-bold text-[10px]">Playlist</span>
                                                            <span className="text-accent-cyan font-bold truncate max-w-[120px] text-[11px]" title={currentPlaylist?.playlistName || 'None'}>
                                                                {currentPlaylist?.playlistName || 'IDLE'}
                                                            </span>
                                                        </div>
                                                        {(device.currentPlaylistId || device.currentMediaId) && (
                                                            <>
                                                                <div className="flex justify-between items-center text-xs pt-2 mt-2 border-t border-white/5">
                                                                    <span className="text-muted-foreground uppercase tracking-wider font-bold text-[9px]">Current Clip</span>
                                                                    <span className="text-foreground font-mono text-[10px] truncate max-w-[130px] text-right" title={mediaName}>{mediaName}</span>
                                                                </div>
                                                                
                                                                {/* Segmented Playlist Progress */}
                                                                <div className="mt-3 flex gap-1 w-full relative h-1.5">
                                                                    {(() => {
                                                                        const items = device.currentPlaylistId ? (playlistItemsMap[device.currentPlaylistId] || []) : [];

                                                                        if (items.length === 0 && device.currentMediaId) {
                                                                            return (
                                                                                <div className="w-full h-full bg-white/5 rounded-full overflow-hidden relative" title={mediaName}>
                                                                                    <div className="absolute inset-0 bg-accent-cyan shadow-[0_0_8px_#22d3ee] animate-pulse w-full"></div>
                                                                                </div>
                                                                            );
                                                                        }

                                                                        if (items.length === 0) {
                                                                            return (
                                                                                <div className="w-full h-full bg-white/5 rounded-full overflow-hidden relative">
                                                                                    <div className="absolute inset-0 bg-accent-cyan/10 w-full"></div>
                                                                                </div>
                                                                            );
                                                                        }

                                                                        let currentIndex = -1;
                                                                        if (device.currentPlaylistItemId) {
                                                                            currentIndex = items.findIndex(item => item.playlistItemId === device.currentPlaylistItemId);
                                                                        } else if (device.currentMediaId) {
                                                                            currentIndex = items.findIndex(item => item.mediaId === device.currentMediaId);
                                                                        }

                                                                        const maxSegments = 20;
                                                                        const displayItems = items.length > maxSegments ? items.slice(0, maxSegments) : items;

                                                                        // Real-time animation calculation
                                                                        const currentItem = items[currentIndex];
                                                                        const duration = currentItem?.media?.durationSec || currentItem?.durationOverride || 30;
                                                                        const progressRaw = device.currentPositionSec || 0;
                                                                        const offset = localProgressOffsets[device.deviceId] || 0;
                                                                        const liveProgress = Math.min(progressRaw + offset, duration);
                                                                        const progressPercent = (liveProgress / duration) * 100;

                                                                        return displayItems.map((item, idx) => {
                                                                            const isPast = idx < currentIndex;
                                                                            const isCurrent = idx === currentIndex;

                                                                            return (
                                                                                <div
                                                                                    key={`seg-${item.playlistItemId || idx}`}
                                                                                    className="h-full flex-1 rounded-full relative overflow-hidden bg-white/10"
                                                                                    title={`${idx + 1}. ${item.media?.displayName || 'Media'}`}
                                                                                >
                                                                                    {isPast && <div className="absolute inset-0 bg-accent-cyan" />}
                                                                                    {isCurrent && (
                                                                                        <div 
                                                                                            className="absolute inset-y-0 left-0 bg-accent-cyan shadow-[0_0_8px_#22d3ee] transition-all duration-1000 ease-linear"
                                                                                            style={{ width: `${progressPercent}%` }}
                                                                                        />
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        });
                                                                    })()}
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>

                                                    <div className="grid grid-cols-3 gap-2 mt-auto">
                                                        <div className="col-span-3 mb-1">
                                                            <button 
                                                                onClick={() => viewScreenshot(device.deviceId)} 
                                                                className="w-full py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-[10px] font-black text-emerald-400 uppercase tracking-wider transition-all flex items-center justify-center gap-1.5"
                                                            >
                                                                📺 View Live Screen
                                                            </button>
                                                        </div>
                                                        <div className="col-span-3 flex gap-2 mb-1">
                                                            <button onClick={() => openAssignModal(device.deviceId)} className="flex-[2] py-2 rounded-lg bg-accent-cyan/10 hover:bg-accent-cyan/20 border border-accent-cyan/20 text-[10px] font-black text-accent-cyan uppercase tracking-wider transition-all">Assign Protocol</button>
                                                            <button onClick={() => handleClearSchedule([device.deviceId])} className="flex-1 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-[10px] font-black text-red-500 uppercase tracking-wider transition-all" title="Clear Playlist">Clear</button>
                                                        </div>
                                                        <button onClick={() => handleCommand(device.deviceId, 'RELOAD')} className="py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-[9px] font-bold text-amber-500 uppercase tracking-wider">Reset</button>
                                                        <button onClick={() => handleCommand(device.deviceId, 'REFRESH')} className="py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[9px] font-bold text-muted-foreground hover:text-white uppercase tracking-wider">Refresh</button>
                                                        {isOnline ? (
                                                            <button onClick={() => handleCommand(device.deviceId, 'RESTART')} className="py-1.5 rounded-lg bg-white/5 hover:bg-red-500/10 border border-white/10 text-[9px] font-bold text-muted-foreground hover:text-red-500 uppercase tracking-wider">Reboot</button>
                                                        ) : (
                                                            <button onClick={() => handleDeleteDevice(device.deviceId)} className="py-1.5 rounded-lg bg-white/5 hover:bg-red-500/10 border border-white/10 text-[9px] font-bold text-muted-foreground hover:text-red-500 uppercase tracking-wider">Remove</button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {filteredDevices.length === 0 && (
                        <div className="py-20 text-center opacity-50">
                            <h3 className="text-xl font-bold uppercase tracking-widest text-muted-foreground">No Signal</h3>
                        </div>
                    )}
                </div>
            )}

            {/* List View grouped by Branch */}
            {viewMode === 'LIST' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                    {Object.entries(devicesByBranch).map(([branch, branchDevices]) => {
                        const isCollapsed = collapsedBranches[branch];
                        return (
                            <div key={`list-branch-${branch}`} className="space-y-3">
                                <button
                                    onClick={() => toggleBranchCollapse(branch)}
                                    className="flex items-center gap-3 w-full text-left py-2 border-b border-white/10 hover:border-accent-cyan/30 transition-all group outline-none"
                                >
                                    <span className="text-lg font-bold uppercase tracking-widest text-white/80 group-hover:text-accent-cyan transition-colors">
                                        🏢 Branch: {branch} ({branchDevices.length})
                                    </span>
                                    <span className="text-[9px] font-mono text-muted-foreground ml-auto bg-white/5 px-2 py-0.5 rounded border border-white/5 group-hover:border-accent-cyan/20 group-hover:text-accent-cyan transition-all">
                                        {isCollapsed ? '▼ EXPAND' : '▲ COLLAPSE'}
                                    </span>
                                </button>

                                {!isCollapsed && (
                                    <div className="glass-panel overflow-hidden">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="border-b border-white/10 text-xs text-muted-foreground uppercase tracking-wider bg-white/5">
                                                        <th className="p-4 font-bold w-12 text-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={branchDevices.every(d => selectedIds.includes(d.deviceId))}
                                                                onChange={() => {
                                                                    const allInBranchSelected = branchDevices.every(d => selectedIds.includes(d.deviceId));
                                                                    if (allInBranchSelected) {
                                                                        // Deselect branch devices
                                                                        setSelectedIds(prev => prev.filter(id => !branchDevices.some(bd => bd.deviceId === id)));
                                                                    } else {
                                                                        // Select branch devices
                                                                        setSelectedIds(prev => [...new Set([...prev, ...branchDevices.map(bd => bd.deviceId)])]);
                                                                    }
                                                                }}
                                                                className="w-4 h-4 rounded border-white/20 bg-black/40 checked:bg-accent-cyan transition-all cursor-pointer accent-cyan-500"
                                                            />
                                                        </th>
                                                        <th className="p-4 font-bold w-12 text-center">Status</th>
                                                        <th className="p-4 font-bold">Device Name</th>
                                                        <th className="p-4 font-bold">Device ID / UUID</th>
                                                        <th className="p-4 font-bold">Playlist</th>
                                                        <th className="p-4 font-bold">Current Clip</th>
                                                        <th className="p-4 font-bold">Last Check-In</th>
                                                        <th className="p-4 font-bold text-right">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-white/5">
                                                    {branchDevices.map((device, index) => {
                                                        const statusUpper = (device.status || '').toUpperCase();
                                                        const isOnline = ['ONLINE', 'PLAYING', 'IDLE'].includes(statusUpper);
                                                        const currentPlaylist = playlists.find(p => p.playlistId === device.currentPlaylistId);
                                                        const displayId = device.deviceUuid ? device.deviceUuid : device.deviceId;
                                                        const isSelected = selectedIds.includes(device.deviceId);

                                                        return (
                                                            <tr key={`list-dev-${device.deviceId}-${index}`} className={`hover:bg-white/[0.03] transition-colors group ${isSelected ? 'bg-accent-cyan/5' : ''}`}>
                                                                <td className="p-4 text-center">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isSelected}
                                                                        onChange={() => toggleSelection(device.deviceId)}
                                                                        className="w-4 h-4 rounded border-white/20 bg-black/40 checked:bg-accent-cyan transition-all cursor-pointer accent-cyan-500"
                                                                    />
                                                                </td>
                                                                <td className="p-4 text-center">
                                                                    <div className={`w-3 h-3 rounded flex items-center justify-center mx-auto ${
                                                                        isOnline 
                                                                            ? 'bg-green-500/20 border border-green-500 shadow-[0_0_8px_rgba(74,222,128,0.4)]' 
                                                                            : 'bg-red-500/10 border border-red-900/50'
                                                                    }`}>
                                                                        <div className={`w-1.5 h-1.5 rounded-full ${
                                                                            isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-900'
                                                                        }`}></div>
                                                                    </div>
                                                                </td>
                                                                <td className="p-4">
                                                                    <div className="font-bold text-foreground text-sm">{device.deviceName}</div>
                                                                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{device.appVersion || 'v2.3.x'}</div>
                                                                </td>
                                                                <td className="p-4">
                                                                    <span className="font-mono text-xs text-muted-foreground group-hover:text-white transition-colors" title={displayId}>
                                                                        #{displayId.substring(0, 16)}...
                                                                    </span>
                                                                </td>
                                                                <td className="p-4">
                                                                    {device.currentPlaylistId ? (
                                                                        <span className="text-accent-cyan font-bold text-xs truncate max-w-[150px] inline-block" title={currentPlaylist?.playlistName}>
                                                                            {currentPlaylist?.playlistName || device.currentPlaylistId}
                                                                        </span>
                                                                    ) : <span className="text-muted-foreground text-[10px]">-</span>}
                                                                </td>
                                                                <td className="p-4">
                                                                    {device.currentMediaId ? (() => {
                                                                        const items = playlistItemsMap[device.currentPlaylistId!] || [];
                                                                        const currentItem = items.find(i => i.mediaId === device.currentMediaId);

                                                                        const duration = currentItem?.media?.durationSec || currentItem?.durationOverride || 30;
                                                                        const progressRaw = device.currentPositionSec || 0;
                                                                        const offset = localProgressOffsets[device.deviceId] || 0;
                                                                        const liveProgress = Math.min(progressRaw + offset, duration);
                                                                        const percent = Math.min((liveProgress / duration) * 100, 100);

                                                                        const mediaName = currentItem?.media?.displayName || mediaMap[device.currentMediaId] || device.currentMediaId;

                                                                        return (
                                                                            <div className="w-48">
                                                                                <div className="text-[10px] font-bold truncate mb-1 text-accent-cyan" title={mediaName}>
                                                                                    {mediaName}
                                                                                </div>
                                                                                <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden relative">
                                                                                    <div
                                                                                        className="h-full bg-accent-cyan transition-all duration-1000 ease-linear shadow-[0_0_4px_#22d3ee]"
                                                                                        style={{ width: `${percent}%` }}
                                                                                    />
                                                                                </div>
                                                                                <div className="text-[9px] text-muted-foreground mt-0.5 font-mono text-right">
                                                                                    {liveProgress}s / {duration}s
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })() : <span className="text-muted-foreground text-[10px]">-</span>}
                                                                </td>
                                                                <td className="p-4">
                                                                    <span className="font-mono text-xs text-muted-foreground">
                                                                        {formatDateTime(device.lastCheckIn)}
                                                                    </span>
                                                                </td>
                                                                <td className="p-4 text-right space-x-2">
                                                                    <button
                                                                        onClick={() => openAssignModal(device.deviceId)}
                                                                        className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded transition-all uppercase font-bold tracking-wider"
                                                                    >
                                                                        Assign
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleClearSchedule([device.deviceId])}
                                                                        className="text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 px-3 py-1.5 rounded transition-all uppercase font-bold tracking-wider"
                                                                    >
                                                                        Clear
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleCommand(device.deviceId, 'RELOAD')}
                                                                        className="text-[10px] text-amber-500 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 px-3 py-1.5 rounded transition-all uppercase font-bold tracking-wider"
                                                                    >
                                                                        Reset
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleCommand(device.deviceId, 'REFRESH')}
                                                                        className="text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded transition-all uppercase font-bold tracking-wider text-muted-foreground hover:text-white"
                                                                    >
                                                                        Refresh
                                                                    </button>
                                                                    {isOnline ? (
                                                                        <button
                                                                            onClick={() => handleCommand(device.deviceId, 'RESTART')}
                                                                            className="text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 px-3 py-1.5 rounded transition-all uppercase font-bold tracking-wider"
                                                                        >
                                                                            Reboot
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => handleDeleteDevice(device.deviceId)}
                                                                            className="text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 px-3 py-1.5 rounded transition-all uppercase font-bold tracking-wider"
                                                                        >
                                                                            Remove
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {filteredDevices.length === 0 && (
                        <div className="py-20 text-center opacity-50">
                            <h3 className="text-xl font-bold uppercase tracking-widest text-muted-foreground">No Signal</h3>
                        </div>
                    )}
                </div>
            )}

            {/* Assign Modal - Replaced with the Multi-Playlist Scheduling Component */}
            {isAssignModalOpen && selectedDeviceId && (
                <DevicePlaylistModal
                    isOpen={isAssignModalOpen}
                    onClose={() => setIsAssignModalOpen(false)}
                    deviceId={selectedDeviceId}
                    deviceName={devices.find(d => d.deviceId === selectedDeviceId)?.deviceName || 'Unknown Device'}
                    availablePlaylists={playlists}
                />
            )}

            {isBatchRemoveModalOpen && (
                <BatchRemovePlaylistModal
                    isOpen={isBatchRemoveModalOpen}
                    onClose={() => setIsBatchRemoveModalOpen(false)}
                    deviceIds={selectedIds}
                    onSuccess={() => {
                        setSelectedIds([]);
                        fetchDevices();
                    }}
                />
            )}

            {isBatchAssignModalOpen && (
                <BatchAssignPlaylistModal
                    isOpen={isBatchAssignModalOpen}
                    onClose={() => setIsBatchAssignModalOpen(false)}
                    deviceIds={selectedIds}
                    onSuccess={() => {
                        setSelectedIds([]);
                        fetchDevices();
                    }}
                />
            )}

            {/* Batch Action Bar */}
            {selectedIds.length > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-black/85 backdrop-blur-xl border border-accent-cyan/30 px-8 py-4 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] flex items-center gap-8 animate-in slide-in-from-bottom duration-300">
                    <div className="border-r border-white/10 pr-8">
                        <span className="text-xl font-black text-accent-cyan">{selectedIds.length}</span>
                        <span className="ml-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">Selected</span>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => setIsBatchAssignModalOpen(true)}
                            className="px-6 py-2 rounded-xl bg-green-600 text-white font-black uppercase tracking-widest text-[10px] hover:bg-green-500 transition-all hover:scale-105 shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                        >
                            Batch Assign Playlist
                        </button>
                        <button
                            onClick={() => setIsBatchRemoveModalOpen(true)}
                            className="px-6 py-2 rounded-xl bg-red-600/20 text-red-500 border border-red-500/50 font-black uppercase tracking-widest text-[10px] hover:bg-red-500 hover:text-white transition-all hover:scale-105"
                        >
                            Batch Select Remove
                        </button>
                        <button
                            onClick={() => handleClearSchedule(selectedIds)}
                            className="px-6 py-2 rounded-xl bg-red-900/40 text-red-400 border border-red-900/50 font-bold uppercase tracking-widest text-[10px] hover:bg-red-900 hover:text-white transition-all hover:scale-105"
                        >
                            Batch Clear All
                        </button>
                        <button
                            onClick={() => handleBatchCommand('SYNC_SCHEDULE')}
                            className="px-6 py-2 rounded-xl bg-accent-cyan text-black font-black uppercase tracking-widest text-[10px] hover:bg-cyan-300 transition-all hover:scale-105 shadow-[0_0_20px_rgba(34,211,238,0.3)]"
                        >
                            Batch Sync
                        </button>
                        <button
                            onClick={() => handleBatchCommand('RELOAD')}
                            className="px-6 py-2 rounded-xl bg-amber-500 text-black font-black uppercase tracking-widest text-[10px] hover:bg-amber-400 transition-all hover:scale-105 shadow-[0_0_20px_rgba(245,158,11,0.3)]"
                        >
                            Batch Reset
                        </button>
                        <button
                            onClick={() => handleBatchCommand('REFRESH')}
                            className="px-6 py-2 rounded-xl bg-white/10 text-white font-bold uppercase tracking-widest text-[10px] hover:bg-white/20 transition-all"
                        >
                            Batch Refresh
                        </button>
                        <button
                            onClick={() => handleBatchCommand('RESTART')}
                            className="px-6 py-2 rounded-xl bg-red-600 text-white font-black uppercase tracking-widest text-[10px] hover:bg-red-500 transition-all"
                        >
                            Batch Reboot
                        </button>
                        <button
                            onClick={() => handleBatchCommand('UPDATE_CLIENT')}
                            className="px-6 py-2 rounded-xl bg-blue-600 text-white font-black uppercase tracking-widest text-[10px] hover:bg-blue-500 transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)]"
                        >
                            Batch Update
                        </button>
                    </div>

                    <div className="border-l border-white/10 pl-8">
                        <button onClick={() => setSelectedIds([])} className="text-[10px] font-bold text-muted-foreground hover:text-white uppercase tracking-widest underline underline-offset-4">Cancel</button>
                    </div>
                </div>
            )}

            {activeScreenshotDeviceId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="glass-panel p-6 rounded-3xl border border-white/10 max-w-2xl w-full mx-4 space-y-4 bg-black/80">
                        <div className="flex justify-between items-center">
                            <h3 className="text-xl font-bold uppercase tracking-wider text-accent-cyan">📺 Live Screen Capture</h3>
                            <button 
                                onClick={() => setActiveScreenshotDeviceId(null)}
                                className="text-muted-foreground hover:text-white text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="border border-white/10 rounded-2xl overflow-hidden aspect-video bg-black/40 flex items-center justify-center relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img 
                                src={screenshotUrl} 
                                alt="Device screen capture"
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23111"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-family="sans-serif" font-size="6">No screen captured yet (or offline)</text></svg>';
                                }}
                            />
                        </div>
                        <div className="flex justify-between items-center text-xs text-muted-foreground font-mono">
                            <span>Device ID: {activeScreenshotDeviceId}</span>
                            <button 
                                onClick={() => refreshScreenshot(activeScreenshotDeviceId)}
                                className="px-4 py-2 bg-accent-cyan hover:bg-cyan-300 text-black font-black uppercase rounded-lg transition-all"
                            >
                                Capture Screen
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { deviceApi } from '@/features/devices/api/device-api';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { Device } from '@/features/devices/types';
import { Playlist, PlaylistItem } from '@/features/playlists/types/playlist';
import { useUI } from '@/features/ui/context/UIContext';
import { DevicePlaylistModal } from '@/features/devices/components/DevicePlaylistModal';

const formatDuration = (seconds?: number) => {
    if (!seconds) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [hrs, mins, secs].map(v => v.toString().padStart(2, '0')).join(':');
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

    // Modal State
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
    const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>('');

    const [mediaMap, setMediaMap] = useState<Record<string, string>>({});
    const [playlistItemsMap, setPlaylistItemsMap] = useState<Record<string, PlaylistItem[]>>({});

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

    function openAssignModal(deviceId: string) {
        setSelectedDeviceId(deviceId);
        setSelectedPlaylistId('');
        setIsAssignModalOpen(true);
    }

    async function handleAssignPlaylist() {
        if (!selectedDeviceId || !selectedPlaylistId) return;
        const command = `PLAY_PLAYLIST:${selectedPlaylistId}`;
        try {
            const res = await deviceApi.sendCommand(selectedDeviceId, command);
            if (res.success) {
                showNotify('PROTOCOL ASSIGNED', 'Playlist assignment command queued successfully.', 'SUCCESS');
                setIsAssignModalOpen(false);
            } else {
                showNotify('ASSIGNMENT FAILED', res.message || 'Unknown error', 'ERROR');
            }
        } catch (error) {
            showNotify('CRITICAL ERROR', 'A critical error occurred while assigning the playlist.', 'ERROR');
        }
    }

    // --- Effects ---
    useEffect(() => {
        fetchDevices();
        fetchPlaylists();
        fetchMediaNames();
        const interval = setInterval(fetchDevices, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const fetchMissingPlaylists = async () => {
            const neededIds = new Set(devices.map(d => d.currentPlaylistId).filter(Boolean) as string[]);
            const missingIds = [...neededIds].filter(id => !playlistItemsMap[id]);

            if (missingIds.length > 0) {
                missingIds.forEach(async (id) => {
                    try {
                        const res = await playlistApi.getById(id);
                        if (res.success && res.data && res.data.items) {
                            setPlaylistItemsMap(prev => ({
                                ...prev,
                                [id]: res.data?.items?.sort((a, b) => a.positionOrder - b.positionOrder) || []
                            }));
                        }
                    } catch (e) { }
                });
            }
        };
        fetchMissingPlaylists();
    }, [devices, playlistItemsMap]);

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


    if (loading) {
        return <div className="p-10 text-center animate-pulse text-accent-cyan tracking-widest">CONNECTING TO NETWORK GRID...</div>;
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
                    <div className="glass-panel px-6 py-3 rounded-xl border border-border/50 flex flex-col items-center min-w-[100px]">
                        <span className="text-2xl font-black text-foreground">{stats.total}</span>
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Nodes</span>
                    </div>
                    <div className="glass-panel px-6 py-3 rounded-xl border border-border/50 flex flex-col items-center min-w-[100px] border-b-2 border-b-green-500/50">
                        <span className="text-2xl font-black text-green-500">{stats.online}</span>
                        <span className="text-xs font-bold text-green-500/70 uppercase tracking-widest">Online</span>
                    </div>
                    <div className="glass-panel px-6 py-3 rounded-xl border border-border/50 flex flex-col items-center min-w-[100px] border-b-2 border-b-red-500/50">
                        <span className="text-2xl font-black text-red-500">{stats.offline}</span>
                        <span className="text-xs font-bold text-red-500/70 uppercase tracking-widest">Offline</span>
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="glass-panel p-4 rounded-2xl border border-border/50 flex flex-col md:flex-row gap-4 items-center justify-between sticky top-0 z-20 backdrop-blur-xl">
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
                            className="pl-10 pr-4 py-2 bg-muted/20 border border-border rounded-lg text-xs w-48 focus:border-accent-cyan outline-none transition-all placeholder:text-muted-foreground uppercase font-mono tracking-wide text-foreground"
                        />
                    </div>

                    {/* Filter Dropdown */}
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as any)}
                        className="bg-muted/20 border border-border rounded-lg px-4 py-2 text-xs font-bold uppercase outline-none focus:border-accent-cyan text-foreground"
                    >
                        <option value="ALL">Show All Status</option>
                        <option value="ONLINE">Online Only</option>
                        <option value="OFFLINE">Offline Only</option>
                    </select>

                    {/* Sort Dropdown */}
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="bg-muted/20 border border-border rounded-lg px-4 py-2 text-xs font-bold uppercase outline-none focus:border-accent-cyan text-foreground"
                    >
                        <option value="NAME">Sort by Name</option>
                        <option value="STATUS">Sort by Status</option>
                        <option value="CHECKIN">Sort by Recent</option>
                        <option value="BRANCH">Sort by Branch</option>
                        <option value="VERSION">Sort by Version</option>
                    </select>

                    {/* View Mode Toggle */}
                    <div className="flex bg-muted/20 rounded-lg p-1 border border-border">
                        <button
                            onClick={() => setViewMode('GRID')}
                            className={`px-3 py-1 rounded text-xs transition-all ${viewMode === 'GRID' ? 'bg-accent-cyan text-black shadow' : 'text-muted-foreground hover:text-white'}`}
                        >
                            GRID
                        </button>
                        <button
                            onClick={() => setViewMode('LIST')}
                            className={`px-3 py-1 rounded text-xs transition-all ${viewMode === 'LIST' ? 'bg-accent-cyan text-black shadow' : 'text-muted-foreground hover:text-white'}`}
                        >
                            LIST
                        </button>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={handleRefresh} className={`text-xl p-2 rounded-lg border border-border hover:bg-muted/10 transition-all ${refreshing ? 'animate-spin text-accent-cyan' : 'text-muted-foreground'}`}>↻</button>
                    <button onClick={handleInitDb} disabled={initDbLoading} className="p-2 rounded-lg border border-border hover:bg-muted/10 text-xs font-bold uppercase text-muted-foreground">{initDbLoading ? 'Wait...' : 'Init DB'}</button>
                    <button onClick={handleCleanupZombies} className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-bold uppercase text-red-500 hover:bg-red-500 hover:text-white transition-all">Cleanup Zombies</button>
                </div>
            </div>



            {/* Grid View */}
            {viewMode === 'GRID' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredDevices.map((device, index) => {
                        const statusUpper = (device.status || '').toUpperCase();
                        const isOnline = ['ONLINE', 'PLAYING', 'IDLE'].includes(statusUpper);
                        const currentPlaylist = playlists.find(p => p.playlistId === device.currentPlaylistId);
                        const mediaName = device.currentMediaId ? mediaMap[device.currentMediaId] || device.currentMediaId : 'Buffering...';

                        // Display ID logic: Show full UUID or numeric fallback
                        const displayId = device.deviceUuid
                            ? device.deviceUuid
                            : device.deviceId;

                        return (
                            <div key={`grid-dev-${device.deviceId || 'unknown'}-${index}`} className="glass-card p-6 rounded-2xl border border-border group relative overflow-hidden transition-all hover:-translate-y-1 flex flex-col bg-card/50">
                                {/* Status Line */}
                                <div className={`absolute top-0 left-0 w-full h-1 ${isOnline
                                    ? 'bg-gradient-to-r from-transparent via-green-500 to-transparent shadow-[0_0_10px_#22c55e]'
                                    : 'bg-red-900/30'
                                    }`} />

                                <div className="flex justify-between items-start mb-4">
                                    <div className="overflow-hidden">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-900'}`} />
                                            <span className={`text-xs font-black uppercase tracking-widest ${isOnline ? 'text-green-500' : 'text-red-900'}`}>{device.status}</span>
                                        </div>
                                        <h3 className="text-lg font-black text-foreground truncate w-full" title={device.deviceName}>{device.deviceName}</h3>
                                        <p className="text-xs text-muted-foreground font-mono mt-0.5 flex items-center gap-2 truncate">
                                            #{displayId}
                                            {device.appVersion && <span className="text-white/40 ml-1">[{device.appVersion}]</span>}
                                            {device.currentPlaylistId && <span className="text-accent-cyan font-bold">: ACTIVE</span>}
                                        </p>
                                    </div>
                                    <div className="text-right pl-2">
                                        <span className="text-xs font-bold text-accent-purple bg-accent-purple/10 px-2 py-1 rounded border border-accent-purple/20 whitespace-nowrap">{device.branchCode}</span>
                                    </div>
                                </div>

                                <div className="space-y-3 mb-6 bg-muted/20 rounded-xl p-3 border border-border/50">
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground uppercase tracking-wider font-bold text-xs">Check-In</span>
                                        <span className="text-foreground font-mono">
                                            {device.lastCheckIn ? new Date(device.lastCheckIn.endsWith('Z') ? device.lastCheckIn : device.lastCheckIn + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-muted-foreground uppercase tracking-wider font-bold text-xs">Playlist</span>
                                        <span className="text-accent-cyan font-bold truncate max-w-[100px]" title={currentPlaylist?.playlistName || 'None'}>{currentPlaylist?.playlistName || 'IDLE'}</span>
                                    </div>
                                    {(device.currentPlaylistId || device.currentMediaId) && (
                                        <>
                                            <div className="flex justify-between items-center text-xs pt-2 mt-2 border-t border-white/10">
                                                <span className="text-muted-foreground uppercase tracking-wider font-bold text-[10px]">Current Clip</span>
                                                <span className="text-foreground font-mono text-xs truncate max-w-[120px]" title={mediaName}>{mediaName}</span>
                                            </div>
                                            {/* Segmented Playlist Progress */}
                                            <div className="mt-3 flex gap-1 w-full relative h-1.5">
                                                {(() => {
                                                    let items = device.currentPlaylistId ? (playlistItemsMap[device.currentPlaylistId] || []) : [];

                                                    // Virtual Item for single media playback (Manual/Orphaned) so we see a bar
                                                    if (items.length === 0 && device.currentMediaId) {
                                                        // Fallback pulse if we don't know structure, but let's try to show 1 segment
                                                        return (
                                                            <div className="w-full h-full bg-muted/20 rounded-full overflow-hidden relative" title={mediaName}>
                                                                <div className="absolute inset-0 bg-accent-cyan shadow-[0_0_8px_#22d3ee] animate-pulse w-full"></div>
                                                            </div>
                                                        );
                                                    }

                                                    // Fallback: If absolutely no content info
                                                    if (items.length === 0) {
                                                        return (
                                                            <div className="w-full h-full bg-muted/20 rounded-full overflow-hidden relative">
                                                                <div className="absolute inset-0 bg-accent-cyan/20 w-full"></div>
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

                                                    return displayItems.map((item, idx) => {
                                                        const isPast = idx < currentIndex;
                                                        const isCurrent = idx === currentIndex;

                                                        return (
                                                            <div
                                                                key={`seg-${item.playlistItemId || idx}`}
                                                                className={`h-full flex-1 rounded-full transition-all duration-500 
                                                                    ${isCurrent
                                                                        ? 'bg-accent-cyan shadow-[0_0_8px_#22d3ee] animate-pulse'
                                                                        : (isPast ? 'bg-accent-cyan' : 'bg-white/10')
                                                                    }`}
                                                                title={`${idx + 1}. ${item.media?.displayName || 'Media'}`}
                                                            />
                                                        );
                                                    });
                                                })()}
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-2 mt-auto">
                                    <button onClick={() => openAssignModal(device.deviceId)} className="col-span-2 py-3 mb-1 rounded-lg bg-accent-cyan/10 hover:bg-accent-cyan/20 border border-accent-cyan/20 text-xs font-black text-accent-cyan uppercase tracking-wider transition-all">Assign Protocol</button>
                                    <button onClick={() => handleCommand(device.deviceId, 'REFRESH')} className="py-2 rounded-lg bg-muted/20 hover:bg-muted/40 border border-border text-xs font-bold text-muted-foreground hover:text-foreground uppercase tracking-wider">Refresh</button>
                                    {isOnline ? (
                                        <button onClick={() => handleCommand(device.deviceId, 'RESTART')} className="py-2 rounded-lg bg-muted/20 hover:bg-red-900/20 border border-border text-xs font-bold text-muted-foreground hover:text-red-500 uppercase tracking-wider">Reboot</button>
                                    ) : (
                                        <button onClick={() => handleDeleteDevice(device.deviceId)} className="py-2 rounded-lg bg-muted/20 hover:bg-red-500/20 border border-border text-xs font-bold text-muted-foreground hover:text-red-500 uppercase tracking-wider">Remove</button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {filteredDevices.length === 0 && (
                        <div className="col-span-full py-20 text-center opacity-50">
                            <h3 className="text-xl font-bold uppercase tracking-widest text-muted-foreground">No Signal</h3>
                        </div>
                    )}
                </div>
            )}

            {/* List View */}
            {viewMode === 'LIST' && (
                <div className="glass-panel overflow-hidden mt-6">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-white/10 text-xs text-muted-foreground uppercase tracking-wider bg-white/5">
                                    <th className="p-4 font-bold w-12 text-center">Status</th>
                                    <th className="p-4 font-bold">Device Name</th>
                                    <th className="p-4 font-bold">Branch</th>
                                    <th className="p-4 font-bold">Device ID / UUID</th>
                                    <th className="p-4 font-bold">Playlist</th>
                                    <th className="p-4 font-bold">Current Clip</th>
                                    <th className="p-4 font-bold">Last Check-In</th>
                                    <th className="p-4 font-bold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filteredDevices.map((device, index) => {
                                    const statusUpper = (device.status || '').toUpperCase();
                                    const isOnline = ['ONLINE', 'PLAYING', 'IDLE'].includes(statusUpper);
                                    const currentPlaylist = playlists.find(p => p.playlistId === device.currentPlaylistId);

                                    const displayId = device.deviceUuid
                                        ? device.deviceUuid
                                        : device.deviceId;

                                    return (
                                        <tr key={`list-dev-${device.deviceId || 'unknown'}-${index}`} className="hover:bg-white/5 transition-colors group">
                                            <td className="p-4 text-center">
                                                <div className={`w-3 h-3 rounded flex items-center justify-center mx-auto ${isOnline ? 'bg-green-500/20 border border-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500/10 border border-red-900/50'}`}>
                                                    <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-900'}`}></div>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="font-bold text-foreground text-sm">{device.deviceName}</div>
                                                <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{device.appVersion || 'v2.3.x'}</div>
                                            </td>
                                            <td className="p-4">
                                                <span className="font-mono text-xs text-accent-cyan bg-accent-cyan/10 px-2 py-1 rounded border border-accent-cyan/20">
                                                    {device.branchCode}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <span className="font-mono text-xs text-muted-foreground group-hover:text-white transition-colors">
                                                    #{displayId}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                {device.currentPlaylistId ? (
                                                    <span className="text-accent-cyan font-bold text-xs truncate max-w-[150px] inline-block" title={playlists.find(p => p.playlistId === device.currentPlaylistId)?.playlistName}>
                                                        {playlists.find(p => p.playlistId === device.currentPlaylistId)?.playlistName || device.currentPlaylistId}
                                                    </span>
                                                ) : <span className="text-muted-foreground text-[10px]">-</span>}
                                            </td>
                                            <td className="p-4">
                                                {device.currentMediaId ? (() => {
                                                    const items = playlistItemsMap[device.currentPlaylistId!] || [];
                                                    const currentItem = items.find(i => i.mediaId === device.currentMediaId);

                                                    // Calculate duration: valid item ? default 30s
                                                    const duration = currentItem?.media?.durationSec || currentItem?.durationOverride || 30;
                                                    const progress = device.currentPositionSec || 0;

                                                    // Cap at 100%
                                                    const percent = Math.min((progress / duration) * 100, 100);

                                                    // Name: From Item OR Map OR ID
                                                    const mediaName = currentItem?.media?.displayName || mediaMap[device.currentMediaId] || device.currentMediaId;

                                                    return (
                                                        <div className="w-48">
                                                            <div className="text-[10px] font-bold truncate mb-1 text-accent-cyan" title={mediaName}>
                                                                {items.length === 0 && !currentItem && <span className="opacity-50 mr-1">▶</span>}
                                                                {mediaName}
                                                            </div>
                                                            <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden relative">
                                                                {/* If we have no duration context (orphan media), pulse the bar */}
                                                                <div
                                                                    className={`h-full bg-accent-cyan transition-all duration-1000 ease-linear ${(!currentItem && items.length === 0) ? 'animate-pulse w-full opacity-50' : ''}`}
                                                                    style={{ width: (!currentItem && items.length === 0) ? '100%' : `${percent}%` }}
                                                                />
                                                            </div>
                                                            <div className="text-[9px] text-muted-foreground mt-0.5 font-mono text-right">
                                                                {progress}s / {(!currentItem && items.length === 0) ? '?' : duration + 's'}
                                                            </div>
                                                        </div>
                                                    );
                                                })() : <span className="text-muted-foreground text-[10px]">-</span>}
                                            </td>
                                            <td className="p-4">
                                                <span className="font-mono text-xs text-muted-foreground">
                                                    {device.lastCheckIn ? new Date(device.lastCheckIn.endsWith('Z') ? device.lastCheckIn : device.lastCheckIn + 'Z').toLocaleString() : '-'}
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
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
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
        </div>
    );
}

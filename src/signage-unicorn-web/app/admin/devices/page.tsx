'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { deviceApi } from '@/features/devices/api/device-api';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { Device } from '@/features/devices/types';
import { Playlist, PlaylistItem } from '@/features/playlists/types/playlist';
import { useUI } from '@/features/ui/context/UIContext';
import { useVisibleInterval } from '@/features/ui/hooks/useVisibleInterval';
import { DevicePlaylistModal } from '@/features/devices/components/DevicePlaylistModal';
import { BatchRemovePlaylistModal } from '@/features/devices/components/BatchRemovePlaylistModal';
import { BatchAssignPlaylistModal } from '@/features/devices/components/BatchAssignPlaylistModal';
import { Modal } from '@/components/ui/Modal';

const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
    if (isNaN(d.getTime())) return '-';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const ONLINE_STATES = ['ONLINE', 'PLAYING', 'IDLE'];

// Device-token rollout fields (contract T11). Declared here as an intersection so this page compiles
// whether or not the shared Device type already carries them; identical optional members merge.
type DeviceEx = Device & {
    hasDeviceToken?: boolean;
    clientProtocol?: number;
    deviceTokenIssuedAt?: string | null;
    tokenResetPending?: boolean;
};
const hasToken = (d: Device) => (d as DeviceEx).hasDeviceToken === true;
const protocolOf = (d: Device) => (d as DeviceEx).clientProtocol ?? 1;

/** Small inline badges: TOKEN / NO TOKEN and the client protocol level (P2 = token-capable client). */
const TokenBadges: React.FC<{ device: Device; compact?: boolean }> = ({ device, compact }) => {
    const tokenised = hasToken(device);
    const issuedAt = (device as DeviceEx).deviceTokenIssuedAt;
    const proto = protocolOf(device);
    const base = `inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider border ${compact ? '' : 'ml-1'}`;
    return (
        <>
            <span
                className={`${base} ${tokenised
                    ? 'text-green-700 dark:text-green-400 bg-green-500/10 border-green-500/30'
                    : 'text-muted-foreground bg-muted/20 border-border'}`}
                title={tokenised
                    ? `Device token issued${issuedAt ? ` ${new Date(issuedAt).toLocaleString()}` : ''}. Requests from this screen are authenticated.`
                    : 'No device token yet: this screen still talks to the API unauthenticated (legacy client, or token not claimed). Do not switch Security:DeviceAuth to Required until every screen shows TOKEN.'}
            >
                {tokenised ? 'Token' : 'No token'}
            </span>
            {proto >= 2 && (
                <span className={`${base} text-accent-cyan bg-accent-cyan/10 border-accent-cyan/30`} title={`Client protocol ${proto}: token, leased commands and per-event playback logs`}>
                    P{proto}
                </span>
            )}
            {(device as DeviceEx).tokenResetPending && (
                <span className={`${base} text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/30`} title="Token reset on the server; the screen claims a new one on its next heartbeat (RECLAIM_TOKEN).">
                    Reclaim pending
                </span>
            )}
        </>
    );
};
const isDeviceOnline = (d: Device) => ONLINE_STATES.includes((d.status || '').toUpperCase());

export default function DevicesPage() {
    const { showModal } = useUI();
    const [devices, setDevices] = useState<Device[]>([]);
    const [playlists, setPlaylists] = useState<Playlist[]>([]);

    // UI State
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [initDbLoading, setInitDbLoading] = useState(false);

    // Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'ALL' | 'ONLINE' | 'OFFLINE' | 'NO_TOKEN'>('ALL');
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
    const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
    const [screenshotLoading, setScreenshotLoading] = useState(false);
    const screenshotUrlRef = useRef<string | null>(null);
    // The device the screenshot viewer is currently showing. A ref (not just the state) so an
    // in-flight loadScreenshot can tell, at commit time, whether the viewer has since switched.
    const activeScreenshotDeviceIdRef = useRef<string | null>(null);
    const screenshotPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [mediaMap, setMediaMap] = useState<Record<string, string>>({});
    const [playlistItemsMap, setPlaylistItemsMap] = useState<Record<string, PlaylistItem[]>>({});
    // Playlist name per currentPlaylistId, learned from the same /playlists/{id} fetch that feeds the
    // progress bar. The deployed API reports the NUMERIC playlist id on devices and (before 2.8) does
    // not expose that key on the playlist list, so matching by list alone showed 'Idle' while playing.
    // null = the server answered 404 for that id: the screen keeps playing a playlist that no longer
    // exists (deleted or replaced); it is remembered so the id is not re-fetched every 10 s.
    const [playlistNameMap, setPlaylistNameMap] = useState<Record<string, string | null>>({});

    // Selection State
    const [selectedIds, setSelectedIds] = useState<string[]>([]);

    // Refs to prevent duplicate requests
    const fetchingIdsRef = useRef<Set<string>>(new Set());

    // Local progress tracking for smooth real-time bar animation

    const showNotify = (title: string, message: string, type: 'INFO' | 'SUCCESS' | 'ERROR' = 'INFO') => {
        showModal({ title, message, type });
    };

    const showConfirm = (title: string, message: string, onConfirm: () => void, type: 'DANGER' | 'INFO' = 'INFO') => {
        showModal({ title, message, type, onConfirm });
    };

    const copyDeviceId = async (deviceId: string) => {
        try {
            await navigator.clipboard.writeText(deviceId);
            showNotify('Copied', `Device ID copied to clipboard.`, 'SUCCESS');
        } catch {
            showNotify('Copy failed', 'Clipboard access was blocked by the browser.', 'ERROR');
        }
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

    const fetchDevices = useCallback(async () => {
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
    }, []);

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
        // Retry playlists the server previously reported as missing (they may have been recreated).
        Object.entries(playlistNameMap).forEach(([id, name]) => { if (name === null) fetchingIdsRef.current.delete(id); });
        fetchDevices();
        fetchPlaylists();
        fetchMediaNames();
    }

    async function handleCommand(deviceId: string, command: string) {
        showConfirm(
            'Send command',
            `Send ${command} to this device?`,
            async () => {
                try {
                    const res = await deviceApi.sendCommand(deviceId, command);
                    if (res.success) {
                        showNotify('Queued', `Command ${command} queued successfully.`, 'SUCCESS');
                    } else {
                        showNotify('Failed', res.message || 'Unknown error', 'ERROR');
                    }
                } catch {
                    showNotify('Error', 'A critical error occurred while sending the command.', 'ERROR');
                }
            }
        );
    }

    async function handleBatchCommand(command: string) {
        if (selectedIds.length === 0) return;
        showConfirm(
            'Send batch command',
            `Send ${command} to ${selectedIds.length} selected devices?`,
            async () => {
                try {
                    const res = await deviceApi.batchSendCommand(selectedIds, command);
                    if (res.success) {
                        showNotify('Batch queued', `Command ${command} sent to ${selectedIds.length} devices.`, 'SUCCESS');
                        setSelectedIds([]);
                    } else {
                        showNotify('Batch failed', res.message || 'Unknown error', 'ERROR');
                    }
                } catch {
                    showNotify('Error', 'A critical error occurred while sending the batch command.', 'ERROR');
                }
            }
        );
    }

    async function handleClearSchedule(deviceIds: string[]) {
        showConfirm(
            'Clear playlists',
            `Remove every playlist from ${deviceIds.length === 1 ? 'this device' : `${deviceIds.length} devices`}? The screen(s) will go idle and will not inherit a sibling schedule.`,
            async () => {
                try {
                    const res = await deviceApi.batchClearSchedule(deviceIds);
                    if (res.success) {
                        showNotify('Cleared', `Playlists removed successfully.`, 'SUCCESS');
                        if (deviceIds.length > 1) setSelectedIds([]);
                        fetchDevices();
                    } else {
                        showNotify('Failed', res.message || 'Unknown error', 'ERROR');
                    }
                } catch {
                    showNotify('Error', 'A critical error occurred while clearing the schedule.', 'ERROR');
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
            'Remove device',
            'Deactivate and remove this device from the list?',
            async () => {
                try {
                    const res = await deviceApi.deleteDevice(deviceId);
                    if (res.success) {
                        fetchDevices();
                        showNotify('Removed', 'Device removed successfully.', 'SUCCESS');
                    } else {
                        showNotify('Failed', res.message || 'Deactivation failed', 'ERROR');
                    }
                } catch {
                    showNotify('Error', 'A critical error occurred while deactivating the device.', 'ERROR');
                }
            },
            'DANGER'
        );
    }

    async function handleCleanupZombies() {
        showConfirm(
            'Clean up offline devices',
            'This will deactivate all devices that have been offline for more than 14 days. Proceed?',
            async () => {
                try {
                    const res = await deviceApi.cleanupOffline();
                    if (res.success) {
                        fetchDevices();
                        showNotify('Cleanup complete', 'Offline devices were deactivated.', 'SUCCESS');
                    } else {
                        showNotify('Failed', res.message || 'Unknown error', 'ERROR');
                    }
                } catch {
                    showNotify('Error', 'A critical error occurred during cleanup.', 'ERROR');
                }
            },
            'DANGER'
        );
    }

    // Re-applies every .sql file in docs/db_template ON THE SERVER, overwriting the stored
    // procedures currently in the database whether or not they are newer. On 20-08-2026 one click
    // silently reverted a fix that had already been deployed and verified in production, and the
    // old wording ("initialize", "Database Initialized Successfully!") gave no hint that anything
    // had been overwritten -- it reported success even when nothing applied.
    async function handleInitDb() {
        showConfirm(
            'Re-apply schema from disk',
            'This OVERWRITES every stored procedure in the database with the .sql files on the server, '
            + 'even if the database currently holds a newer version. Any fix applied directly to the '
            + 'database since those files were last updated will be lost. Proceed?',
            async () => {
                setInitDbLoading(true);
                try {
                    const res = await deviceApi.fixDb();
                    if (res.success) {
                        showNotify('Schema re-applied', res.message || 'Schema re-applied from disk.', 'SUCCESS');
                    } else if (res.code === 409) {
                        // API 2.8 serialises schema runs (round-4 #2): another apply is still running.
                        showNotify('Schema apply already running', res.message || 'SCHEMA_APPLY_IN_PROGRESS: wait for the current run to finish, then retry.', 'INFO');
                    } else {
                        showNotify('Failed', res.message || 'Unknown error', 'ERROR');
                    }
                } catch {
                    showNotify('Error', 'A critical error occurred while re-applying the schema.', 'ERROR');
                } finally {
                    setInitDbLoading(false);
                    fetchDevices();
                }
            },
            'DANGER'
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

    // --- Screenshots (loaded through the authenticated API, shown as object URLs) ---
    const replaceScreenshotUrl = (url: string | null) => {
        if (screenshotUrlRef.current) URL.revokeObjectURL(screenshotUrlRef.current);
        screenshotUrlRef.current = url;
        setScreenshotUrl(url);
    };

    const stopScreenshotPolling = () => {
        if (screenshotPollRef.current) {
            clearInterval(screenshotPollRef.current);
            screenshotPollRef.current = null;
        }
    };

    const loadScreenshot = async (deviceId: string) => {
        setScreenshotLoading(true);
        const url = await deviceApi.fetchScreenshot(deviceId);
        // The viewer may have closed or switched to another device while this was in flight; a stale
        // response must not paint over the current device, and its object URL must be released.
        if (activeScreenshotDeviceIdRef.current !== deviceId) {
            if (url) URL.revokeObjectURL(url);
            return;
        }
        replaceScreenshotUrl(url);
        setScreenshotLoading(false);
    };

    // Ask the device for a fresh capture, then poll every 2s for the next 10s.
    const startScreenshotPolling = (deviceId: string) => {
        stopScreenshotPolling();
        let attempts = 0;
        screenshotPollRef.current = setInterval(async () => {
            attempts++;
            await loadScreenshot(deviceId);
            if (attempts >= 5) stopScreenshotPolling();
        }, 2000);
    };

    const viewScreenshot = (deviceId: string) => {
        activeScreenshotDeviceIdRef.current = deviceId;
        setActiveScreenshotDeviceId(deviceId);
        loadScreenshot(deviceId);
        deviceApi.sendCommand(deviceId, 'CAPTURE_SCREEN').catch(console.error);
        startScreenshotPolling(deviceId);
    };

    const refreshScreenshot = async (deviceId: string) => {
        try {
            await deviceApi.sendCommand(deviceId, 'CAPTURE_SCREEN');
            showNotify('Command sent', 'Requested a screen capture. The image updates in a few seconds.', 'INFO');
            startScreenshotPolling(deviceId);
        } catch {
            showNotify('Failed', 'Failed to request a screenshot capture', 'ERROR');
        }
    };

    const closeScreenshot = () => {
        stopScreenshotPolling();
        activeScreenshotDeviceIdRef.current = null;
        replaceScreenshotUrl(null);
        setActiveScreenshotDeviceId(null);
    };

    useEffect(() => () => {
        stopScreenshotPolling();
        if (screenshotUrlRef.current) URL.revokeObjectURL(screenshotUrlRef.current);
    }, []);

    // --- Effects ---
    useEffect(() => {
        // Deep links from the dashboard tiles: /admin/devices?status=ONLINE|OFFLINE
        try {
            const status = new URLSearchParams(window.location.search).get('status')?.toUpperCase();
            if (status === 'ONLINE' || status === 'OFFLINE') setFilterStatus(status);
        } catch { /* ignore */ }

        fetchDevices();
        fetchPlaylists();
        fetchMediaNames();
    }, [fetchDevices]);

    // Poll every 10 seconds while the tab is visible.
    useVisibleInterval(fetchDevices, 10000);

    useEffect(() => {
        const fetchMissingPlaylists = async () => {
            const neededIds = new Set(devices.map(d => d.currentPlaylistId).filter(Boolean) as string[]);
            const missingIds = [...neededIds].filter(id => !playlistItemsMap[id] && !fetchingIdsRef.current.has(id));

            if (missingIds.length > 0) {
                missingIds.forEach(id => fetchingIdsRef.current.add(id));

                for (const id of missingIds) {
                    try {
                        const res = await playlistApi.getById(id);
                        if (res.success && res.data) {
                            const name = res.data.playlistName;
                            if (name) setPlaylistNameMap(prev => (prev[id] === name ? prev : { ...prev, [id]: name }));
                            setPlaylistItemsMap(prev => ({
                                ...prev,
                                [id]: res.data?.items?.slice().sort((a, b) => a.positionOrder - b.positionOrder) || []
                            }));
                        } else if (res.code === 404) {
                            // Known-missing: keep the id in fetchingIdsRef so it is not asked again on every
                            // 10 s refresh; the manual Refresh button clears these for a retry.
                            setPlaylistNameMap(prev => (prev[id] === null ? prev : { ...prev, [id]: null }));
                        } else {
                            fetchingIdsRef.current.delete(id);
                        }
                    } catch {
                        fetchingIdsRef.current.delete(id);
                    }
                }
            }
        };
        fetchMissingPlaylists();
    }, [devices]); // Fixed infinite loop by depending only on devices!

    // Clip progress is animated by CSS (see .progress-live in globals.css) from the position the
    // server reported, so the page is NOT re-rendered every second. A per-second setState here used
    // to re-render all ~300 cards (16k DOM nodes) once a second and froze the tab on big fleets.
    // The version key below restarts the animation each time the device list is refreshed.
    const devicesVersion = useMemo(() => Date.now(), [devices]);

    // --- Stats & Filter ---
    const stats = useMemo(() => {
        return {
            total: devices.length,
            online: devices.filter(isDeviceOnline).length,
            offline: devices.filter(d => !isDeviceOnline(d)).length,
            tokenised: devices.filter(hasToken).length,
            branches: new Set(devices.map(d => d.branchCode)).size
        };
    }, [devices]);

    const filteredDevices = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const result = devices.filter(d => {
            const matchesSearch =
                d.deviceName.toLowerCase().includes(q) ||
                d.branchCode.toLowerCase().includes(q) ||
                (d.deviceId || '').toLowerCase().includes(q) ||
                (d.status || '').toLowerCase().includes(q);

            const matchesStatus =
                filterStatus === 'ALL' ||
                (filterStatus === 'ONLINE' && isDeviceOnline(d)) ||
                (filterStatus === 'OFFLINE' && !isDeviceOnline(d)) ||
                (filterStatus === 'NO_TOKEN' && !hasToken(d));

            return matchesSearch && matchesStatus;
        });

        // Sorting
        result.sort((a, b) => {
            if (sortBy === 'NAME') return a.deviceName.localeCompare(b.deviceName);
            if (sortBy === 'BRANCH') return a.branchCode.localeCompare(b.branchCode);
            if (sortBy === 'STATUS') {
                const aOnline = isDeviceOnline(a);
                const bOnline = isDeviceOnline(b);
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

    // Name to show on a card: the list match first, then the name learned from /playlists/{id},
    // then the raw id (better than a misleading 'Idle' while the screen is clearly playing).
    const currentPlaylistLabel = (device: Device, matched?: { playlistName?: string }) => {
        if (matched?.playlistName) return matched.playlistName;
        const id = device.currentPlaylistId;
        if (!id) return 'Idle';
        const learned = playlistNameMap[id];
        if (learned) return learned;
        if (learned === null) return `Playlist #${id} (not on server)`;
        return `Playlist #${id}`;
    };

    const findCurrentPlaylist = (device: Device) =>
        // Device records identify their current playlist by NUMERIC id while Playlist.playlistId is
        // the uuid, so match the numeric key first and keep the uuid compare as a fallback.
        playlists.find(p =>
            (p.playlistRefId && p.playlistRefId === device.currentPlaylistId) ||
            p.playlistId === device.currentPlaylistId
        );

    const selectedDevice = selectedDeviceId ? devices.find(d => d.deviceId === selectedDeviceId) : undefined;
    const activeScreenshotDevice = activeScreenshotDeviceId ? devices.find(d => d.deviceId === activeScreenshotDeviceId) : undefined;

    const controlClass = 'bg-muted/20 border border-border rounded-lg px-4 py-2 text-xs font-bold uppercase outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 text-foreground hover:bg-muted/40 cursor-pointer transition-colors';
    const smallActionClass = 'py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors border';

    if (loading) {
        return <div className="p-10 text-center text-accent-cyan tracking-widest font-mono" role="status">Loading devices…</div>;
    }

    return (
        <div className="p-8 space-y-8 min-h-screen">
            {/* Header & Stats */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter neon-text mb-2">Devices</h1>
                    <p className="text-sm font-bold text-muted-foreground">
                        Screens, schedules and remote commands
                    </p>
                </div>
                <dl className="flex gap-4">
                    <div className="glass-panel px-6 py-3 rounded-xl flex flex-col items-center min-w-[100px]">
                        <dd className="text-2xl font-black text-foreground">{stats.total}</dd>
                        <dt className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Screens</dt>
                    </div>
                    <div className="glass-panel px-6 py-3 rounded-xl flex flex-col items-center min-w-[100px] bg-green-500/5">
                        <dd className="text-2xl font-black text-green-600 dark:text-green-400">{stats.online}</dd>
                        <dt className="text-xs font-bold text-green-700/80 dark:text-green-500/80 uppercase tracking-widest">Online</dt>
                    </div>
                    <div className="glass-panel px-6 py-3 rounded-xl flex flex-col items-center min-w-[100px] bg-red-500/5">
                        <dd className="text-2xl font-black text-red-600 dark:text-red-400">{stats.offline}</dd>
                        <dt className="text-xs font-bold text-red-700/80 dark:text-red-500/80 uppercase tracking-widest">Offline</dt>
                    </div>
                    <div
                        className={`glass-panel px-6 py-3 rounded-xl flex flex-col items-center min-w-[100px] ${stats.total > 0 && stats.tokenised === stats.total ? 'bg-green-500/5' : 'bg-amber-500/5'}`}
                        title="Screens that hold a device token. Security:DeviceAuth may be switched to Required only when this equals the screen count."
                    >
                        <dd className={`text-2xl font-black ${stats.total > 0 && stats.tokenised === stats.total ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {stats.tokenised}<span className="text-sm font-bold text-muted-foreground">/{stats.total}</span>
                        </dd>
                        <dt className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Tokenised</dt>
                    </div>
                </dl>
            </div>

            {/* Controls */}
            <div className="glass-panel p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center justify-between sticky top-0 z-30 bg-card-solid">
                <div className="flex items-center gap-4 w-full md:w-auto flex-wrap">
                    {/* Search */}
                    <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" aria-hidden="true">
                            <span className="opacity-50">🔍</span>
                        </div>
                        <input
                            type="search"
                            aria-label="Search devices by name, branch, ID or status"
                            placeholder="Search…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 pr-4 py-2 bg-muted/20 border border-border rounded-lg text-xs w-48 focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 outline-none transition-colors placeholder:text-muted-foreground font-mono tracking-wide text-foreground hover:bg-muted/40"
                        />
                    </div>

                    {/* Filter Dropdown */}
                    <select
                        aria-label="Filter by status"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value as 'ALL' | 'ONLINE' | 'OFFLINE' | 'NO_TOKEN')}
                        className={controlClass}
                    >
                        <option value="ALL">All statuses</option>
                        <option value="ONLINE">Online only</option>
                        <option value="OFFLINE">Offline only</option>
                        <option value="NO_TOKEN">No device token</option>
                    </select>

                    {/* Sort Dropdown */}
                    <select
                        aria-label="Sort devices"
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as 'NAME' | 'STATUS' | 'CHECKIN' | 'BRANCH' | 'VERSION')}
                        className={controlClass}
                    >
                        <option value="NAME">Sort by name</option>
                        <option value="STATUS">Sort by status</option>
                        <option value="CHECKIN">Sort by last check-in</option>
                        <option value="BRANCH">Sort by branch</option>
                        <option value="VERSION">Sort by version</option>
                    </select>

                    {/* View Mode Toggle */}
                    <div className="flex bg-muted/20 rounded-lg p-1 border border-border" role="group" aria-label="View mode">
                        <button
                            type="button"
                            onClick={() => setViewMode('GRID')}
                            aria-pressed={viewMode === 'GRID'}
                            className={`px-3 py-1 rounded text-xs transition-colors ${viewMode === 'GRID' ? 'bg-primary text-primary-foreground font-bold' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Grid
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('LIST')}
                            aria-pressed={viewMode === 'LIST'}
                            className={`px-3 py-1 rounded text-xs transition-colors ${viewMode === 'LIST' ? 'bg-primary text-primary-foreground font-bold' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            List
                        </button>
                    </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                    <button type="button" onClick={toggleSelectAll} className={`px-3 py-2 rounded-lg border text-xs font-bold uppercase transition-colors ${selectedIds.length > 0 ? 'bg-primary text-primary-foreground border-accent-cyan' : 'text-muted-foreground border-border hover:bg-muted/40'}`}>
                        {selectedIds.length === filteredDevices.length && filteredDevices.length > 0 ? 'Deselect all' : 'Select all'}
                    </button>
                    <button type="button" onClick={handleRefresh} aria-label="Refresh device list" title="Refresh" className={`text-xl px-3 py-1 rounded-lg border border-border hover:bg-muted/40 transition-colors ${refreshing ? 'animate-spin text-accent-cyan' : 'text-muted-foreground'}`}>↻</button>
                    <button type="button" onClick={handleInitDb} disabled={initDbLoading} className="px-3 py-2 rounded-lg border border-border hover:bg-muted/40 text-xs font-bold uppercase text-muted-foreground transition-colors disabled:opacity-50">{initDbLoading ? 'Wait…' : 'Re-apply schema'}</button>
                    <button type="button" onClick={handleCleanupZombies} className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs font-bold uppercase text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white transition-colors">Clean up offline</button>
                </div>
            </div>

            {/* Grid View with Branch Accordion Grouping */}
            {viewMode === 'GRID' && (
                <div className="space-y-8">
                    {Object.entries(devicesByBranch).map(([branch, branchDevices]) => {
                        const isCollapsed = collapsedBranches[branch];
                        const panelId = `grid-branch-panel-${branch}`;
                        return (
                            <section key={`grid-branch-${branch}`} className="space-y-4">
                                <button
                                    type="button"
                                    onClick={() => toggleBranchCollapse(branch)}
                                    aria-expanded={!isCollapsed}
                                    aria-controls={panelId}
                                    className="flex items-center gap-3 w-full text-left py-3 border-b border-border hover:border-accent-cyan/30 transition-colors group rounded-lg"
                                >
                                    <span className="text-xl font-bold uppercase tracking-widest text-foreground/90 group-hover:text-accent-cyan transition-colors flex items-center gap-2">
                                        <span aria-hidden="true">🏢</span> Branch: {branch}
                                        <span className="text-xs px-2 py-0.5 rounded bg-muted/20 border border-border text-muted-foreground group-hover:text-accent-cyan group-hover:border-accent-cyan/30">
                                            {branchDevices.length} {branchDevices.length === 1 ? 'screen' : 'screens'}
                                        </span>
                                    </span>
                                    <span className="text-xs font-mono text-muted-foreground ml-auto bg-muted/20 px-2 py-1 rounded border border-border/50 group-hover:border-accent-cyan/20 group-hover:text-accent-cyan transition-colors">
                                        {isCollapsed ? '▼ Expand' : '▲ Collapse'}
                                    </span>
                                </button>

                                {!isCollapsed && (
                                    <div id={panelId} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                        {branchDevices.map((device, index) => {
                                            const isOnline = isDeviceOnline(device);
                                            const currentPlaylist = findCurrentPlaylist(device);
                                            const mediaName = device.currentMediaId ? mediaMap[device.currentMediaId] || device.currentMediaId : 'Buffering…';

                                            const displayId = device.deviceUuid ? device.deviceUuid : device.deviceId;
                                            const isSelected = selectedIds.includes(device.deviceId);

                                            return (
                                                <article
                                                    key={`grid-dev-${device.deviceId}-${index}`}
                                                    aria-label={`${device.deviceName}, ${isOnline ? 'online' : 'offline'}`}
                                                    className={`bg-card card-elevated p-6 rounded-2xl border flex flex-col relative overflow-hidden group ${
                                                        isSelected
                                                            ? 'border-accent-cyan bg-accent-cyan/5'
                                                            : 'border-border hover:border-accent-cyan/40'
                                                    }`}
                                                >
                                                    {/* Selection Checkbox */}
                                                    <div className="absolute top-4 right-4 z-20">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleSelection(device.deviceId)}
                                                            aria-label={`Select ${device.deviceName}`}
                                                            className="w-5 h-5 rounded border-border bg-muted/20 cursor-pointer accent-[var(--primary)]"
                                                        />
                                                    </div>

                                                    {/* Status Top Bar */}
                                                    <div className={`absolute top-0 left-0 w-full h-1 ${
                                                        isOnline ? 'bg-green-500' : 'bg-red-500/50'
                                                    }`} aria-hidden="true" />

                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className="overflow-hidden pr-6">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} aria-hidden="true" />
                                                                <span className={`text-xs font-black uppercase tracking-widest ${isOnline ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                                    {device.status}
                                                                </span>
                                                            </div>
                                                            <h3 className="text-base font-bold text-foreground truncate w-full" title={device.deviceName}>{device.deviceName}</h3>
                                                            <p className="text-xs text-muted-foreground font-mono mt-0.5 flex items-center gap-2 truncate">
                                                                #{displayId.substring(0, 12)}…
                                                                {device.appVersion && <span className="text-muted-foreground/70">[{device.appVersion}]</span>}
                                                                {device.currentPlaylistId && <span className="text-accent-cyan font-bold">: Active</span>}
                                                                <TokenBadges device={device} />
                                                            </p>
                                                        </div>
                                                        <div className="text-right">
                                                            <span className="text-xs font-bold text-accent-purple bg-accent-purple/10 px-2 py-1 rounded border border-accent-purple/20 whitespace-nowrap uppercase tracking-wider">{device.branchCode}</span>
                                                        </div>
                                                    </div>

                                                    <dl className="space-y-3 mb-6 bg-muted/10 rounded-xl p-3 border border-border/50">
                                                        <div className="flex justify-between items-center gap-2 text-xs">
                                                            <dt className="text-muted-foreground uppercase tracking-wider font-bold text-xs shrink-0">Device ID</dt>
                                                            <dd className="min-w-0">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => copyDeviceId(device.deviceId)}
                                                                    title={`${device.deviceId} (click to copy)`}
                                                                    aria-label={`Copy device ID ${device.deviceId}`}
                                                                    className="text-foreground font-mono text-xs truncate max-w-full hover:text-accent-cyan transition-colors flex items-center gap-1 rounded"
                                                                >
                                                                    <span className="truncate">{device.deviceId}</span>
                                                                    <span className="opacity-40 shrink-0" aria-hidden="true">⧉</span>
                                                                </button>
                                                            </dd>
                                                        </div>
                                                        <div className="flex justify-between items-center text-xs">
                                                            <dt className="text-muted-foreground uppercase tracking-wider font-bold">Check-in</dt>
                                                            <dd className="text-foreground font-mono text-xs">
                                                                {formatDateTime(device.lastCheckIn)}
                                                            </dd>
                                                        </div>
                                                        <div className="flex justify-between items-center text-xs gap-2">
                                                            <dt className="text-muted-foreground uppercase tracking-wider font-bold shrink-0">Playlist</dt>
                                                            <dd className="text-accent-cyan font-bold truncate min-w-0 text-sm" title={currentPlaylistLabel(device, currentPlaylist)}>
                                                                {currentPlaylistLabel(device, currentPlaylist)}
                                                            </dd>
                                                        </div>
                                                        {device.scheduleMode && (
                                                            <div className="flex justify-between items-center text-xs gap-2">
                                                                <dt className="text-muted-foreground uppercase tracking-wider font-bold shrink-0">Schedule</dt>
                                                                <dd
                                                                    className={`text-xs uppercase ${device.scheduleMode === 'explicit' && !device.currentPlaylistId ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                                                                    title={device.scheduleMode === 'explicit' && !device.currentPlaylistId
                                                                        ? 'An admin cleared the playlists of this screen, so it stays idle on purpose instead of inheriting a sibling. Assign a playlist or reset it to inherit.'
                                                                        : undefined}
                                                                >
                                                                    {device.scheduleMode === 'inherit'
                                                                        ? 'Inherits sibling'
                                                                        : (!device.currentPlaylistId ? 'Idle by design (cleared)' : 'Explicit')}
                                                                </dd>
                                                            </div>
                                                        )}
                                                        {(device.currentPlaylistId || device.currentMediaId) && (
                                                            <>
                                                                <div className="flex justify-between items-center text-xs pt-2 mt-2 border-t border-border/50 gap-2">
                                                                    <dt className="text-muted-foreground uppercase tracking-wider font-bold shrink-0">Current clip</dt>
                                                                    <dd className="text-foreground font-mono text-xs truncate min-w-0 text-right" title={mediaName}>{mediaName}</dd>
                                                                </div>

                                                                {/* Segmented Playlist Progress */}
                                                                <div className="mt-3 flex gap-1 w-full relative h-1.5" aria-hidden="true">
                                                                    {(() => {
                                                                        const items = device.currentPlaylistId ? (playlistItemsMap[device.currentPlaylistId] || []) : [];

                                                                        if (items.length === 0 && device.currentMediaId) {
                                                                            return (
                                                                                <div className="w-full h-full bg-muted/30 rounded-full overflow-hidden relative" title={mediaName}>
                                                                                    <div className="absolute inset-0 bg-accent-cyan w-full"></div>
                                                                                </div>
                                                                            );
                                                                        }

                                                                        if (items.length === 0) {
                                                                            return (
                                                                                <div className="w-full h-full bg-muted/30 rounded-full overflow-hidden relative">
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
                                                                        const startPercent = Math.min(100, (Math.min(progressRaw, duration) / duration) * 100);
                                                                        const remainingSec = Math.max(0, duration - progressRaw);

                                                                        return displayItems.map((item, idx) => {
                                                                            const isPast = idx < currentIndex;
                                                                            const isCurrent = idx === currentIndex;

                                                                            return (
                                                                                <div
                                                                                    key={`seg-${item.playlistItemId || idx}`}
                                                                                    className="h-full flex-1 rounded-full relative overflow-hidden bg-muted/40"
                                                                                    title={`${idx + 1}. ${item.media?.displayName || 'Media'}`}
                                                                                >
                                                                                    {isPast && <div className="absolute inset-0 bg-accent-cyan" />}
                                                                                    {isCurrent && (
                                                                                        <div
                                                                                            key={`live-${devicesVersion}`}
                                                                                            className="absolute inset-y-0 left-0 bg-accent-cyan progress-live"
                                                                                            style={{ '--p0': `${startPercent}%`, animationDuration: `${remainingSec}s` } as React.CSSProperties}
                                                                                        />
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        });
                                                                    })()}
                                                                </div>
                                                            </>
                                                        )}
                                                    </dl>

                                                    <div className="grid grid-cols-3 gap-2 mt-auto">
                                                        <div className="col-span-3 mb-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => viewScreenshot(device.deviceId)}
                                                                className="w-full py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-xs font-black text-emerald-700 dark:text-emerald-400 uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5"
                                                            >
                                                                <span aria-hidden="true">📺</span> View screen
                                                            </button>
                                                        </div>
                                                        <div className="col-span-3 flex gap-2 mb-1">
                                                            <button type="button" onClick={() => openAssignModal(device.deviceId)} className="flex-[2] py-2 rounded-lg bg-accent-cyan/10 hover:bg-accent-cyan/20 border border-accent-cyan/20 text-xs font-black text-accent-cyan uppercase tracking-wider transition-colors">Assign playlist</button>
                                                            <button type="button" onClick={() => handleClearSchedule([device.deviceId])} className="flex-1 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs font-black text-red-600 dark:text-red-400 uppercase tracking-wider transition-colors" title="Clear playlists">Clear</button>
                                                        </div>
                                                        <button type="button" onClick={() => handleCommand(device.deviceId, 'RELOAD')} className={`${smallActionClass} bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/20 text-amber-700 dark:text-amber-400`}>Reset</button>
                                                        <button type="button" onClick={() => handleCommand(device.deviceId, 'REFRESH')} className={`${smallActionClass} bg-muted/20 hover:bg-muted/40 border-border text-muted-foreground hover:text-foreground`}>Refresh</button>
                                                        {isOnline ? (
                                                            <button type="button" onClick={() => handleCommand(device.deviceId, 'RESTART')} className={`${smallActionClass} bg-muted/20 hover:bg-red-500/10 border-border text-muted-foreground hover:text-red-500`}>Reboot</button>
                                                        ) : (
                                                            <button type="button" onClick={() => handleDeleteDevice(device.deviceId)} className={`${smallActionClass} bg-muted/20 hover:bg-red-500/10 border-border text-muted-foreground hover:text-red-500`}>Remove</button>
                                                        )}
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        );
                    })}
                    {filteredDevices.length === 0 && (
                        <div className="py-20 text-center">
                            <h3 className="text-xl font-bold uppercase tracking-widest text-muted-foreground">No screens match the current filters</h3>
                        </div>
                    )}
                </div>
            )}

            {/* List View grouped by Branch */}
            {viewMode === 'LIST' && (
                <div className="space-y-8">
                    {Object.entries(devicesByBranch).map(([branch, branchDevices]) => {
                        const isCollapsed = collapsedBranches[branch];
                        const panelId = `list-branch-panel-${branch}`;
                        const allInBranchSelected = branchDevices.every(d => selectedIds.includes(d.deviceId));
                        return (
                            <section key={`list-branch-${branch}`} className="space-y-3">
                                <button
                                    type="button"
                                    onClick={() => toggleBranchCollapse(branch)}
                                    aria-expanded={!isCollapsed}
                                    aria-controls={panelId}
                                    className="flex items-center gap-3 w-full text-left py-2 border-b border-border hover:border-accent-cyan/30 transition-colors group rounded-lg"
                                >
                                    <span className="text-lg font-bold uppercase tracking-widest text-foreground/90 group-hover:text-accent-cyan transition-colors">
                                        <span aria-hidden="true">🏢</span> Branch: {branch} ({branchDevices.length})
                                    </span>
                                    <span className="text-xs font-mono text-muted-foreground ml-auto bg-muted/20 px-2 py-0.5 rounded border border-border/50 group-hover:border-accent-cyan/20 group-hover:text-accent-cyan transition-colors">
                                        {isCollapsed ? '▼ Expand' : '▲ Collapse'}
                                    </span>
                                </button>

                                {!isCollapsed && (
                                    <div id={panelId} className="glass-panel overflow-hidden rounded-2xl">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider bg-muted/20">
                                                        <th scope="col" className="p-4 font-bold w-12 text-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={allInBranchSelected}
                                                                aria-label={`Select all screens in branch ${branch}`}
                                                                onChange={() => {
                                                                    if (allInBranchSelected) {
                                                                        // Deselect branch devices
                                                                        setSelectedIds(prev => prev.filter(id => !branchDevices.some(bd => bd.deviceId === id)));
                                                                    } else {
                                                                        // Select branch devices
                                                                        setSelectedIds(prev => [...new Set([...prev, ...branchDevices.map(bd => bd.deviceId)])]);
                                                                    }
                                                                }}
                                                                className="w-4 h-4 rounded border-border bg-muted/20 cursor-pointer accent-[var(--primary)]"
                                                            />
                                                        </th>
                                                        <th scope="col" className="p-4 font-bold w-12 text-center">Status</th>
                                                        <th scope="col" className="p-4 font-bold">Device name</th>
                                                        <th scope="col" className="p-4 font-bold">Device ID / UUID</th>
                                                        <th scope="col" className="p-4 font-bold">Playlist</th>
                                                        <th scope="col" className="p-4 font-bold">Current clip</th>
                                                        <th scope="col" className="p-4 font-bold">Last check-in</th>
                                                        <th scope="col" className="p-4 font-bold text-right">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-border/50">
                                                    {branchDevices.map((device, index) => {
                                                        const isOnline = isDeviceOnline(device);
                                                        const currentPlaylist = findCurrentPlaylist(device);
                                                        const displayId = device.deviceUuid ? device.deviceUuid : device.deviceId;
                                                        const isSelected = selectedIds.includes(device.deviceId);

                                                        return (
                                                            <tr key={`list-dev-${device.deviceId}-${index}`} className={`hover:bg-muted/10 transition-colors group ${isSelected ? 'bg-accent-cyan/5' : ''}`}>
                                                                <td className="p-4 text-center">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isSelected}
                                                                        onChange={() => toggleSelection(device.deviceId)}
                                                                        aria-label={`Select ${device.deviceName}`}
                                                                        className="w-4 h-4 rounded border-border bg-muted/20 cursor-pointer accent-[var(--primary)]"
                                                                    />
                                                                </td>
                                                                <td className="p-4 text-center">
                                                                    <div className={`w-3 h-3 rounded flex items-center justify-center mx-auto ${
                                                                        isOnline
                                                                            ? 'bg-green-500/20 border border-green-500'
                                                                            : 'bg-red-500/10 border border-red-700/60'
                                                                    }`} title={isOnline ? 'Online' : 'Offline'}>
                                                                        <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-700'}`}></div>
                                                                    </div>
                                                                    <span className="sr-only">{isOnline ? 'Online' : 'Offline'}</span>
                                                                </td>
                                                                <td className="p-4">
                                                                    <div className="font-bold text-foreground text-sm">{device.deviceName}</div>
                                                                    <div className="text-xs text-muted-foreground font-mono mt-0.5 flex items-center gap-1 flex-wrap">
                                                                        <span>{device.appVersion || 'version unknown'}</span>
                                                                        <TokenBadges device={device} compact />
                                                                    </div>
                                                                </td>
                                                                <td className="p-4">
                                                                    <span className="font-mono text-xs text-muted-foreground group-hover:text-foreground transition-colors" title={displayId}>
                                                                        #{displayId.substring(0, 16)}…
                                                                    </span>
                                                                </td>
                                                                <td className="p-4 min-w-[160px]">
                                                                    {device.currentPlaylistId ? (
                                                                        <span className="text-accent-cyan font-bold text-sm block truncate" title={currentPlaylistLabel(device, currentPlaylist)}>
                                                                            {currentPlaylistLabel(device, currentPlaylist)}
                                                                        </span>
                                                                    ) : <span className="text-muted-foreground text-xs">-</span>}
                                                                </td>
                                                                <td className="p-4">
                                                                    {device.currentMediaId ? (() => {
                                                                        const items = playlistItemsMap[device.currentPlaylistId!] || [];
                                                                        const currentItem = items.find(i => i.mediaId === device.currentMediaId);

                                                                        const duration = currentItem?.media?.durationSec || currentItem?.durationOverride || 30;
                                                                        const progressRaw = device.currentPositionSec || 0;
                                                                        const liveProgress = Math.min(progressRaw, duration);
                                                                        const percent = Math.min((liveProgress / duration) * 100, 100);
                                                                        const remainingSec = Math.max(0, duration - liveProgress);

                                                                        const mediaName = currentItem?.media?.displayName || mediaMap[device.currentMediaId] || device.currentMediaId;

                                                                        return (
                                                                            <div className="w-48">
                                                                                <div className="text-sm font-bold truncate mb-1 text-accent-cyan" title={mediaName}>
                                                                                    {mediaName}
                                                                                </div>
                                                                                <div className="h-1 w-full bg-muted/40 rounded-full overflow-hidden relative" role="progressbar" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={liveProgress} aria-label="Clip progress">
                                                                                    <div
                                                                                        key={`live-${devicesVersion}`}
                                                                                        className="h-full bg-accent-cyan progress-live"
                                                                                        style={{ '--p0': `${percent}%`, animationDuration: `${remainingSec}s` } as React.CSSProperties}
                                                                                    />
                                                                                </div>
                                                                                <div className="text-xs text-muted-foreground mt-0.5 font-mono text-right">
                                                                                    {liveProgress}s / {duration}s
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })() : <span className="text-muted-foreground text-xs">-</span>}
                                                                </td>
                                                                <td className="p-4">
                                                                    <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                                                                        {formatDateTime(device.lastCheckIn)}
                                                                    </span>
                                                                </td>
                                                                <td className="p-4 text-right whitespace-nowrap space-x-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => openAssignModal(device.deviceId)}
                                                                        aria-label={`Assign playlist to ${device.deviceName}`}
                                                                        className="text-xs bg-muted/20 hover:bg-muted/40 border border-border px-3 py-1.5 rounded transition-colors uppercase font-bold tracking-wider text-foreground"
                                                                    >
                                                                        Assign
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleClearSchedule([device.deviceId])}
                                                                        aria-label={`Clear playlists on ${device.deviceName}`}
                                                                        className="text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 px-3 py-1.5 rounded transition-colors uppercase font-bold tracking-wider"
                                                                    >
                                                                        Clear
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleCommand(device.deviceId, 'RELOAD')}
                                                                        aria-label={`Reset ${device.deviceName}`}
                                                                        className="text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 px-3 py-1.5 rounded transition-colors uppercase font-bold tracking-wider"
                                                                    >
                                                                        Reset
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleCommand(device.deviceId, 'REFRESH')}
                                                                        aria-label={`Refresh ${device.deviceName}`}
                                                                        className="text-xs bg-muted/20 hover:bg-muted/40 border border-border px-3 py-1.5 rounded transition-colors uppercase font-bold tracking-wider text-muted-foreground hover:text-foreground"
                                                                    >
                                                                        Refresh
                                                                    </button>
                                                                    {isOnline ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleCommand(device.deviceId, 'RESTART')}
                                                                            aria-label={`Reboot ${device.deviceName}`}
                                                                            className="text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 px-3 py-1.5 rounded transition-colors uppercase font-bold tracking-wider"
                                                                        >
                                                                            Reboot
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleDeleteDevice(device.deviceId)}
                                                                            aria-label={`Remove ${device.deviceName}`}
                                                                            className="text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded transition-colors uppercase font-bold tracking-wider"
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
                            </section>
                        );
                    })}
                    {filteredDevices.length === 0 && (
                        <div className="py-20 text-center">
                            <h3 className="text-xl font-bold uppercase tracking-widest text-muted-foreground">No screens match the current filters</h3>
                        </div>
                    )}
                </div>
            )}

            {/* Assign Modal - Multi-Playlist Scheduling */}
            {isAssignModalOpen && selectedDeviceId && (
                <DevicePlaylistModal
                    isOpen={isAssignModalOpen}
                    onClose={() => setIsAssignModalOpen(false)}
                    deviceId={selectedDeviceId}
                    deviceName={selectedDevice?.deviceName || 'Unknown device'}
                    availablePlaylists={playlists}
                    scheduleMode={selectedDevice?.scheduleMode}
                    onScheduleModeChanged={fetchDevices}
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
                <div
                    role="toolbar"
                    aria-label={`Actions for ${selectedIds.length} selected devices`}
                    className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-card-solid border border-accent-cyan/30 px-6 py-4 rounded-2xl shadow-2xl flex flex-wrap items-center gap-4 sm:gap-6 max-w-[95vw] animate-in"
                >
                    <div className="border-r border-border pr-6">
                        <span className="text-xl font-black text-accent-cyan">{selectedIds.length}</span>
                        <span className="ml-2 text-xs font-bold text-muted-foreground uppercase tracking-widest">selected</span>
                    </div>

                    <div className="flex gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={() => setIsBatchAssignModalOpen(true)}
                            className="px-5 py-2 rounded-xl bg-green-600 text-white font-black uppercase tracking-widest text-xs hover:bg-green-500 transition-colors"
                        >
                            Assign playlist
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsBatchRemoveModalOpen(true)}
                            className="px-5 py-2 rounded-xl bg-red-600/20 text-red-600 dark:text-red-400 border border-red-500/50 font-black uppercase tracking-widest text-xs hover:bg-red-500 hover:text-white transition-colors"
                        >
                            Remove playlists
                        </button>
                        <button
                            type="button"
                            onClick={() => handleClearSchedule(selectedIds)}
                            className="px-5 py-2 rounded-xl bg-red-900/30 text-red-600 dark:text-red-400 border border-red-900/50 font-bold uppercase tracking-widest text-xs hover:bg-red-900 hover:text-white transition-colors"
                        >
                            Clear all
                        </button>
                        <button
                            type="button"
                            onClick={() => handleBatchCommand('SYNC_SCHEDULE')}
                            className="px-5 py-2 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-xs hover:brightness-110 transition-colors"
                        >
                            Sync
                        </button>
                        <button
                            type="button"
                            onClick={() => handleBatchCommand('RELOAD')}
                            className="px-5 py-2 rounded-xl bg-amber-500 text-black font-black uppercase tracking-widest text-xs hover:bg-amber-400 transition-colors"
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            onClick={() => handleBatchCommand('REFRESH')}
                            className="px-5 py-2 rounded-xl bg-muted/30 text-foreground font-bold uppercase tracking-widest text-xs hover:bg-muted/50 transition-colors"
                        >
                            Refresh
                        </button>
                        <button
                            type="button"
                            onClick={() => handleBatchCommand('RESTART')}
                            className="px-5 py-2 rounded-xl bg-red-600 text-white font-black uppercase tracking-widest text-xs hover:bg-red-500 transition-colors"
                        >
                            Reboot
                        </button>
                        <button
                            type="button"
                            onClick={() => handleBatchCommand('UPDATE_CLIENT')}
                            className="px-5 py-2 rounded-xl bg-blue-600 text-white font-black uppercase tracking-widest text-xs hover:bg-blue-500 transition-colors"
                        >
                            Update client
                        </button>
                    </div>

                    <div className="border-l border-border pl-6">
                        <button type="button" onClick={() => setSelectedIds([])} className="text-xs font-bold text-muted-foreground hover:text-foreground uppercase tracking-widest underline underline-offset-4">Cancel</button>
                    </div>
                </div>
            )}

            {/* Screenshot dialog */}
            <Modal
                isOpen={!!activeScreenshotDeviceId}
                onClose={closeScreenshot}
                size="2xl"
                labelledBy="screenshot-title"
                showClose
                className="p-6 space-y-4 bg-card-solid"
            >
                <div className="pr-10">
                    <h3 id="screenshot-title" className="text-xl font-bold uppercase tracking-wider text-accent-cyan">
                        <span aria-hidden="true">📺</span> Screen capture
                    </h3>
                    <p className="text-xs text-muted-foreground font-mono mt-1">{activeScreenshotDevice?.deviceName || activeScreenshotDeviceId} · ID {activeScreenshotDeviceId}</p>
                </div>
                <div className="border border-border rounded-2xl overflow-hidden aspect-video bg-black flex items-center justify-center relative" aria-busy={screenshotLoading}>
                    {screenshotUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={screenshotUrl}
                            alt={`Latest screen capture from ${activeScreenshotDevice?.deviceName || 'the device'}`}
                            className="w-full h-full object-contain"
                        />
                    ) : (
                        <div className="text-center text-muted-foreground text-sm px-6" role="status">
                            {screenshotLoading ? 'Loading…' : 'No screenshot yet. The device will upload one in a few seconds if it is online.'}
                        </div>
                    )}
                </div>
                <div className="flex justify-between items-center text-xs text-muted-foreground font-mono gap-4">
                    <span>{screenshotLoading ? 'Checking for a new capture…' : screenshotUrl ? 'Latest capture shown' : ''}</span>
                    <button
                        type="button"
                        onClick={() => activeScreenshotDeviceId && refreshScreenshot(activeScreenshotDeviceId)}
                        className="px-4 py-2 bg-primary hover:brightness-110 text-primary-foreground font-black uppercase rounded-lg transition-colors"
                    >
                        Capture again
                    </button>
                </div>
            </Modal>
        </div>
    );
}

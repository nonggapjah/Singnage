'use client';

import { apiFetch } from '@/lib/api-fetch';
import React, { useState, useEffect, useRef } from 'react';
import { usePlayerHotkeys } from '@/features/player/hooks/usePlayerHotkeys';
import { PlayerOverlay } from '@/features/player/components/PlayerOverlay';
import { DeviceRegistration } from '@/features/player/components/DeviceRegistration';
import { deviceApi } from '@/features/devices/api/device-api';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { PlaylistItem } from '@/features/playlists/types/playlist';

import { systemApi } from '@/features/system/api/system-api';

export default function PlayerPage() {
    const [isRegistered, setIsRegistered] = useState(false);
    const [deviceId, setDeviceId] = useState<string | null>(null);
    const [deviceName, setDeviceName] = useState<string>('');
    const [branchCode, setBranchCode] = useState<string>('');
    const [location, setLocation] = useState<string>('');
    const [cacheProgress, setCacheProgress] = useState(0);
    const [cachedCount, setCachedCount] = useState(0);

    // Player State
    const [status, setStatus] = useState('Checking Registration...');
    const [playlistId, setPlaylistId] = useState<string | null>(null);
    const [playlistName, setPlaylistName] = useState<string>('');
    const [items, setItems] = useState<PlaylistItem[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [currentItem, setCurrentItem] = useState<PlaylistItem | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [itemStartedAt, setItemStartedAt] = useState<number>(Date.now());
    const [loopTick, setLoopTick] = useState(0);

    // Heartbeat Sync Ref
    const heartbeatRef = useRef({
        isRegistered, deviceId, deviceName, branchCode, location, status, playlistId, currentItem, cacheProgress, itemStartedAt
    });

    useEffect(() => {
        heartbeatRef.current = {
            isRegistered, deviceId, deviceName, branchCode, location, status: (status === 'PLAYING_LOCAL' || status === 'PLAYING_NEW') ? 'PLAYING' : status,
            playlistId, currentItem, cacheProgress, itemStartedAt
        };
    }, [isRegistered, deviceId, deviceName, branchCode, location, status, playlistId, currentItem, cacheProgress, itemStartedAt]);

    // Smooth Update State
    const [pendingPlaylist, setPendingPlaylist] = useState<{ id: string, name: string, items: PlaylistItem[] } | null>(null);
    const pendingPlaylistRef = useRef<{ id: string, name: string, items: PlaylistItem[] } | null>(null);
    const cachedUrlsRef = useRef<Record<string, string>>({});

    // UX State
    const [showAdmin, setShowAdmin] = useState(false);
    const [volume, setVolume] = useState(50);
    const [safetyJingleUrl, setSafetyJingleUrl] = useState<string>('');
    const [debugMsg, setDebugMsg] = useState('');
    const [isLoadingContent, setIsLoadingContent] = useState(false);
    const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
    const [isOnline, setIsOnline] = useState(true);
    const [showVolumeOSD, setShowVolumeOSD] = useState(false);
    const [screenTestColor, setScreenTestColor] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    // Explicit Play Trigger for Video
    useEffect(() => {
        if (videoRef.current && currentItem && isVideo(currentItem.media?.fileName)) {
            // Reset to beginning just in case
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(e => {
                console.warn("Video play() failed (often due to autoplay policy):", e);
            });
        }
    }, [currentItem, loopTick]);

    const osdTimerRef = useRef<NodeJS.Timeout | null>(null);
    const [dashboardTick, setDashboardTick] = useState(0);
    const [cachedMediaUrls, setCachedMediaUrls] = useState<Record<string, string>>({});


    // Boot Report: send full device info on first heartbeat only
    const isBootReportSent = useRef(false);
    const APP_VERSION = '2.2.1'; // Sync with package.json version

    const MEDIA_CACHE_NAME = 'signage-media-v1';


    const screenTestPatterns = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000'];

    const handleScreenTest = () => {
        if (screenTestColor === null) {
            setScreenTestColor(screenTestPatterns[0]);
            setShowAdmin(false); // Close dashboard during test
        } else {
            const currentIndex = screenTestPatterns.indexOf(screenTestColor);
            if (currentIndex < screenTestPatterns.length - 1) {
                setScreenTestColor(screenTestPatterns[currentIndex + 1]);
            } else {
                setScreenTestColor(null);
            }
        }
    };

    const fetchMediaUrl = async (id: string) => {
        try {
            const res = await apiFetch(`/media/${id}`);
            if (res.success && res.data && res.data.blobUrl) {
                setSafetyJingleUrl(res.data.blobUrl);
            }
        } catch (e) {
            console.error('Failed to load safety jingle', e);
        }
    };

    // Check Registration Only Once and Load Persistent Playlist
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const savedId = localStorage.getItem('signage_device_id');
            const savedName = localStorage.getItem('signage_device_name');
            const savedBranch = localStorage.getItem('signage_device_branch');
            const savedLocation = localStorage.getItem('signage_device_location');
            const savedPlaylistId = localStorage.getItem('signage_playlist_id');
            const savedPlaylistName = localStorage.getItem('signage_playlist_name');
            const savedPlaylistItems = localStorage.getItem('signage_playlist_items');

            // Sync Safety Jingle
            const syncJingle = async () => {
                const savedJingleId = localStorage.getItem('signage_safety_jingle_id');
                const savedJingleData = localStorage.getItem('signage_safety_jingle_data');

                // 1. Load from Cache immediately if available
                if (savedJingleData) {
                    setSafetyJingleUrl(savedJingleData);
                } else if (savedJingleId && savedJingleId.startsWith('http')) {
                    setSafetyJingleUrl(savedJingleId);
                }

                // 2. Check for Updates from Server (Only if online)
                if (typeof navigator !== 'undefined' && !navigator.onLine) {
                    console.log("Device is offline. Skipping jingle sync update.");
                    return;
                }

                try {
                    const res = await systemApi.getSetting('safety_jingle_id');
                    const serverJingleId = res.data;

                    if (res.success && serverJingleId) {
                        // If ID changed or we don't have data yet
                        if (serverJingleId !== savedJingleId || !savedJingleData) {
                            console.log("Global Jingle Update Detected:", serverJingleId);
                            localStorage.setItem('signage_safety_jingle_id', serverJingleId);

                            // Fetch Metadata to get URL
                            try {
                                const mediaRes = await apiFetch(`/media/${serverJingleId}`);
                                if (mediaRes.success && mediaRes.data?.blobUrl) {
                                    const url = mediaRes.data.blobUrl;

                                    // Download and Cache as Base64 (Wrapped in safety block for offline robustness)
                                    try {
                                        const response = await fetch(url);
                                        const blob = await response.blob();
                                        const reader = new FileReader();
                                        reader.onloadend = () => {
                                            const base64data = reader.result as string;
                                            localStorage.setItem('signage_safety_jingle_data', base64data);
                                            setSafetyJingleUrl(base64data);
                                            console.log("Jingle cached locally (" + Math.round(base64data.length / 1024) + "KB)");
                                        };
                                        reader.readAsDataURL(blob);
                                    } catch (fetchErr) {
                                        console.warn("Failed to fetch jingle blob (Network error)", fetchErr);
                                    }
                                }
                            } catch (err) {
                                console.error("Failed to get jingle metadata", err);
                            }
                        }
                    }
                } catch (e) {
                    // Offline or Server Error - Keep using cached version if any
                    console.warn("Failed to sync global settings (offline?)", e);
                }
            };
            syncJingle();

            if (savedId) {
                setDeviceId(savedId);
                setDeviceName(savedName || 'Unknown Device');
                setBranchCode(savedBranch || 'N/A');
                setLocation(savedLocation || '');
                setIsRegistered(true);
                setStatus('IDLE');

                // Restore Playlist if exists
                if (savedPlaylistId && savedPlaylistItems) {
                    try {
                        const parsedItems = JSON.parse(savedPlaylistItems);
                        if (Array.isArray(parsedItems) && parsedItems.length > 0) {
                            setPlaylistId(savedPlaylistId);
                            setPlaylistName(savedPlaylistName || 'Cached Playlist');
                            setItems(parsedItems);
                            setStatus('PLAYING_LOCAL');
                            showToast('RESUMING CACHED PLAYLIST...');

                            // Restore Index
                            const savedIndex = localStorage.getItem('signage_playlist_index');
                            if (savedIndex) {
                                const idx = parseInt(savedIndex);
                                if (idx < parsedItems.length) setCurrentIndex(idx);
                            }

                            syncMediaAssets(parsedItems);
                        }
                    } catch (e) {
                        console.error('Failed to parse saved playlist', e);
                    }
                }
            } else {
                setIsRegistered(false);
                setStatus('WAITING_FOR_SETUP');
            }
        }
    }, []);

    // --- Playback Log Sync (Offline Queue) ---
    const isSyncingLogs = useRef(false);

    const syncPlaybackLogs = async () => {
        if (isSyncingLogs.current) return;
        isSyncingLogs.current = true;

        try {
            const rawQueue = localStorage.getItem('signage_pending_playback_logs');
            if (!rawQueue) return;

            let queue: any[] = [];
            try {
                queue = JSON.parse(rawQueue);
            } catch (e) {
                localStorage.removeItem('signage_pending_playback_logs');
                return;
            }

            if (queue.length === 0) return;

            console.log(`Syncing ${queue.length} pending playback logs...`);
            const successIds: string[] = [];

            for (const log of queue) {
                try {
                    const res = await apiFetch('/logs/playback', {
                        method: 'POST',
                        body: JSON.stringify(log)
                    });

                    // 200-299 = Success, 400-499 = Client Error (Bad Data, shouldn't retry)
                    if (res.success || (res.code >= 400 && res.code < 500)) {
                        successIds.push(log.tempId);
                    } else {
                        // 500 or Network Error: Stop and retry later
                        break;
                    }
                } catch (e) {
                    break; // Stop on network error
                }
            }

            if (successIds.length > 0) {
                // Re-read queue to ensure we don't overwrite new logs added during sync
                const currentRaw = localStorage.getItem('signage_pending_playback_logs');
                const currentQueue = currentRaw ? JSON.parse(currentRaw) : [];

                const updatedQueue = currentQueue.filter((item: any) => !successIds.includes(item.tempId));

                if (updatedQueue.length > 0) {
                    localStorage.setItem('signage_pending_playback_logs', JSON.stringify(updatedQueue));
                } else {
                    localStorage.removeItem('signage_pending_playback_logs');
                }
                console.log(`Synced ${successIds.length} logs. Remaining: ${updatedQueue.length}`);
            }
        } finally {
            isSyncingLogs.current = false;

            // If there are still logs and we stopped early (e.g. partial success), 
            // the next heartbeat or trigger will pick them up.
        }
    };

    const queuePlaybackLog = (mediaId: string, duration: number) => {
        const log = {
            tempId: Math.random().toString(36).substring(2, 15),
            deviceId,
            mediaId,
            playlistId,
            duration,
            result: 'success',
            playedAt: new Date().toISOString()
        };

        const rawQueue = localStorage.getItem('signage_pending_playback_logs');
        const queue = rawQueue ? JSON.parse(rawQueue) : [];
        queue.push(log);
        localStorage.setItem('signage_pending_playback_logs', JSON.stringify(queue));

        // Try sync immediately
        syncPlaybackLogs();
    };

    // --- Heartbeat & Command Processing ---
    useEffect(() => {
        if (!isRegistered || !deviceId) return;

        const sendHeartbeat = async (isManual = false) => {
            const { deviceId, deviceName, branchCode, location, status, playlistId, currentItem, cacheProgress, itemStartedAt } = heartbeatRef.current;
            if (!deviceId) return;

            // Sync all logs during heartbeat
            syncPlaybackLogs();
            syncSystemLogs();

            try {
                const elapsed = Math.round((Date.now() - itemStartedAt) / 1000);

                // Build heartbeat payload
                const heartbeatData: Parameters<typeof deviceApi.heartbeat>[0] = {
                    deviceId,
                    deviceName: deviceName || undefined,
                    branchCode: branchCode || undefined,
                    location: location || undefined,
                    status: status,
                    currentPlaylistId: playlistId || undefined,
                    currentMediaId: currentItem ? currentItem.mediaId : undefined,
                    currentPlaylistItemId: currentItem ? currentItem.playlistItemId : undefined,
                    currentPositionSec: elapsed,
                    cacheProgress: cacheProgress,
                };

                // Boot Report: enrich first heartbeat with device metadata
                if (!isBootReportSent.current) {
                    const screenRatio = `${window.screen.width}x${window.screen.height}`;
                    heartbeatData.appVersion = `Web ${APP_VERSION}`;
                    heartbeatData.ratio = screenRatio;
                    console.log(`[Boot Report] Sending device metadata: v${APP_VERSION}, ${screenRatio}`);
                }

                const res = await deviceApi.heartbeat(heartbeatData);

                if (res.success && res.data) {
                    setIsOnline(true);
                    setLastHeartbeat(new Date());
                    if (!isBootReportSent.current) {
                        isBootReportSent.current = true;
                        console.log('[Boot Report] Device metadata sent successfully.');
                        addLog('SYS: Registered with server');
                    }
                    if (isManual) addLog('SYS: Heartbeat sent (Sync OK)');

                    const commands = res.data;
                    commands.forEach(cmd => {
                        console.log("RECEIVED COMMAND:", cmd);
                        const rawCmd = (cmd.commandType || '') as string;

                        if (rawCmd.startsWith('REBOOT') || rawCmd.startsWith('RESTART') || rawCmd === 'REFRESH') {
                            window.location.reload();
                        }
                        if (rawCmd.startsWith('PLAY_PLAYLIST:')) {
                            const newPlaylistId = rawCmd.split(':')[1];
                            if (newPlaylistId) {
                                loadPlaylist(newPlaylistId);
                            }
                        }
                    });
                } else {
                    setIsOnline(false);
                    if (isManual) addLog('WARN: Heartbeat failed (Server Reject)', 'WARN');
                }
            } catch (e) {
                console.error("Heartbeat failed", e);
                setIsOnline(false);
                if (isManual) addLog('ERR: Heartbeat failed (Network Error)', 'ERROR');
            }
        };

        // Initial call
        sendHeartbeat();

        // Stable Interval
        const intId = setInterval(() => sendHeartbeat(false), 20000); // 20s stable interval

        // Manual instantaneous update trigger on major state changes
        const eventTrigger = () => {
            // We don't want to spam, but major changes should be sent
            sendHeartbeat(false);
        };
        // Note: we could listen to status/currentItem changes here, but the interval is safe.
        // Let's add an immediate one for registration
        if (isRegistered) sendHeartbeat(true);

        return () => clearInterval(intId);
    }, [isRegistered, deviceId]); // Only depends on identification. Logic uses Ref.

    // --- Playlist Loader ---
    const loadPlaylist = async (pId: string) => {
        // Only show full-screen loader if we have nothing playing
        if (items.length === 0) setIsLoadingContent(true);

        try {
            const res = await playlistApi.getById(pId);
            if (res.success && res.data && res.data.items) {
                const validItems = res.data.items.filter(i => i.media);
                // Ensure items are sorted by positionOrder
                const sortedItems = validItems.sort((a, b) => a.positionOrder - b.positionOrder);

                // --- SMART SYNC: Change Detection ---
                const contentHash = pId + '|' + sortedItems.map(i => `${i.mediaId}-${i.durationOverride || 0}`).join(',');
                const currentHash = localStorage.getItem('signage_playlist_hash');

                if (contentHash === currentHash && items.length > 0) {
                    console.log("SMART SYNC: Content hash matches. Skipping reload to maintain local playback continuity.");
                    setPlaylistId(pId);
                    return;
                }

                // --- IMMEDIATE SWAP IF IDLE ---
                if (items.length === 0) {
                    console.log("SMART SYNC: IDLE -> Loading first playlist immediately.");
                    setItems(sortedItems);
                    setPlaylistId(pId);
                    setPlaylistName(res.data.playlistName);
                    setCurrentIndex(0);
                    setStatus('PLAYING');

                    localStorage.setItem('signage_playlist_id', pId);
                    localStorage.setItem('signage_playlist_name', res.data.playlistName);
                    localStorage.setItem('signage_playlist_items', JSON.stringify(sortedItems));
                    localStorage.setItem('signage_playlist_hash', contentHash);

                    addLog(`SYS: Loaded playlist '${res.data.playlistName}' (${sortedItems.length} items)`);
                    syncMediaAssets(sortedItems);
                } else {
                    // --- SMOOTH BACKGROUND SWAP ---
                    console.log("SMART SYNC: Change detected. Queuing background update...");
                    const pending = { id: pId, name: res.data.playlistName, items: sortedItems };
                    setPendingPlaylist(pending);
                    pendingPlaylistRef.current = pending;

                    localStorage.setItem('signage_pending_playlist_id', pId);
                    localStorage.setItem('signage_pending_playlist_items', JSON.stringify(sortedItems));
                    localStorage.setItem('signage_playlist_hash_pending', contentHash);

                    showToast(`PLAYLIST UPDATED: SYNCING IN BACKGROUND...`);
                    addLog(`SYS: New playlist '${res.data.playlistName}' queued for smooth swap`);

                    syncMediaAssets(sortedItems);
                }
            } else {
                showToast('FAILED TO LOAD PLAYLIST');
                addLog('ERR: Failed to load playlist content');
            }
        } catch (err) {
            console.error(err);
            showToast('ERROR LOADING CONTENT');
            addLog('ERR: API Error loading content');
        } finally {
            setIsLoadingContent(false);
        }
    };

    // --- Media Cache Sync (Offline Hub) ---
    const syncMediaAssets = async (playlistItems: PlaylistItem[]) => {
        if (typeof window === 'undefined') return;

        try {
            if (!('caches' in window)) {
                console.warn("CACHE_SYNC_SKIP: Cache API not supported (Insecure Context)");
                addLog("WARN: Offline Sync Unavailable (Insecure Context)");
                return;
            }

            console.log("CACHE_SYNC: Starting background assets download...");
            addLog("SYS: Starting Media Cache Sync...");

            let loaded = 0;
            const total = playlistItems.length;
            if (total === 0) return;

            const cache = await caches.open(MEDIA_CACHE_NAME);
            const newCacheUrls: Record<string, string> = { ...cachedMediaUrls };

            for (const item of playlistItems) {
                const media = item.media;
                if (!media || !media.blobUrl) {
                    loaded++;
                    continue;
                }

                const url = media.blobUrl;

                try {
                    // 1. Check if already in cache
                    const cachedRes = await cache.match(url);
                    let finalUrl = '';
                    if (cachedRes) {
                        const blob = await cachedRes.blob();
                        finalUrl = URL.createObjectURL(blob);
                    } else {
                        // 2. Download with CORS mode
                        const response = await fetch(url, { mode: 'cors' });
                        if (response.ok) {
                            await cache.put(url, response.clone());
                            const blob = await response.blob();
                            finalUrl = URL.createObjectURL(blob);
                        } else {
                            throw new Error(`Server status ${response.status}`);
                        }
                    }

                    if (finalUrl) {
                        setCachedMediaUrls(prev => {
                            const updated = { ...prev, [item.mediaId]: finalUrl };
                            cachedUrlsRef.current = updated;
                            return updated;
                        });
                    }
                } catch (err) {
                    console.warn(`CACHE_SYNC: Failed to cache ${media.fileName}`, err);
                    addLog(`ERR: Cache failed for ${media.displayName || media.fileName}`);
                }

                loaded++;
                setCachedCount(loaded);
                setCacheProgress(Math.round((loaded / total) * 100));
            }

            setCacheProgress(100);
            setCachedCount(total);
            addLog(`SYS: Cache Sync Complete (${loaded}/${total} items)`);
        } catch (globalErr: any) {
            console.error("CACHE_SYNC_CRITICAL:", globalErr);
            const errorMsg = globalErr.message?.includes("Context")
                ? "Offline Sync REJECTED by Browser (Needs Localhost/HTTPS)"
                : "Offline Sync Initialization Failed";
            addLog(`ERR: ${errorMsg}`);
            setCacheProgress(0);
            setCachedCount(0);
        } finally {
            setIsLoadingContent(false);
        }
    };

    const syncSystemLogs = async () => {
        try {
            const rawQueue = localStorage.getItem('signage_pending_system_logs');
            if (!rawQueue) return;
            const queue = JSON.parse(rawQueue);
            if (queue.length === 0) return;

            const successIds: string[] = [];
            for (const log of queue) {
                try {
                    const res = await apiFetch('/logs', {
                        method: 'POST',
                        body: JSON.stringify(log)
                    });
                    if (res.success) successIds.push(log.tempId);
                    else break;
                } catch (e) { break; }
            }

            if (successIds.length > 0) {
                const currentRaw = localStorage.getItem('signage_pending_system_logs');
                const currentQueue = currentRaw ? JSON.parse(currentRaw) : [];
                const updatedQueue = currentQueue.filter((item: any) => !successIds.includes(item.tempId));
                if (updatedQueue.length > 0) localStorage.setItem('signage_pending_system_logs', JSON.stringify(updatedQueue));
                else localStorage.removeItem('signage_pending_system_logs');
            }
        } catch (e) {
            console.error("System log sync failed", e);
        }
    };

    const addLog = (msg: string, type: 'INFO' | 'WARN' | 'ERROR' = 'INFO') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10));

        // Persistence for Audit Tracking
        const log = {
            tempId: Math.random().toString(36).substring(2, 15),
            deviceId,
            logType: type,
            message: msg,
            source: 'WebPlayer',
            createdAt: new Date().toISOString()
        };

        const rawQueue = localStorage.getItem('signage_pending_system_logs');
        const queue = rawQueue ? JSON.parse(rawQueue) : [];
        queue.push(log);
        localStorage.setItem('signage_pending_system_logs', JSON.stringify(queue));
        syncSystemLogs();
    };

    // --- Volume Control Persistence & OSD ---
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = volume / 100;
        }
    }, [volume, currentItem]); // Re-apply when item changes or volume changes

    const handleVolumeChange = (newVol: number) => {
        setVolume(newVol);
        setShowVolumeOSD(true);
        if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
        osdTimerRef.current = setTimeout(() => setShowVolumeOSD(false), 2000);
    };

    // --- Playback Loop ---
    useEffect(() => {
        if (items.length === 0) {
            setCurrentItem(null);
            return;
        }

        const item = items[currentIndex];
        setCurrentItem(item);
        setItemStartedAt(Date.now());

        // Log Playback Start
        if (item.media) {
            console.log(`Playing Item ${currentIndex}:`, item.media.fileName);
            // Verify if we should log every clip or just major events? User asked for "Show recent clips played".
            // So logging every clip start is appropriate for the dashboard.
            // Avoid double logging if strict mode double-invokes.
            // For now, strict mode is dev only.
            addLog(`PLAY: ${item.media.displayName || item.media.fileName}`);
        }

        // Calculate Duration (Override > Media Duration > Default 10s)
        const duration = (item.durationOverride || item.media?.durationSec || 10) * 1000;
        // Min 1 second safety
        const safeDuration = Math.max(1000, duration);

        const timer = setTimeout(() => {
            // Queue playback log for persistent sync (Proof of Play)
            if (item.mediaId) {
                queuePlaybackLog(item.mediaId, item.durationOverride || item.media?.durationSec || 10);
            }

            // --- SMOOTH SWAP LOGIC (Using Ref for latest value) ---
            const currentPending = pendingPlaylistRef.current;
            if (currentPending && currentPending.items.length > 0) {
                const firstMediaId = currentPending.items[0].mediaId;
                if (cachedUrlsRef.current[firstMediaId]) {
                    console.log("SMOOTH SWAP: Next playlist ready. Switching now.");
                    setItems(currentPending.items);
                    setPlaylistId(currentPending.id);
                    setPlaylistName(currentPending.name);
                    setCurrentIndex(0);
                    setStatus('PLAYING');

                    // Cleanup pending
                    setPendingPlaylist(null);
                    pendingPlaylistRef.current = null;

                    // Finalize persistence
                    localStorage.setItem('signage_playlist_id', currentPending.id);
                    localStorage.setItem('signage_playlist_items', JSON.stringify(currentPending.items));
                    const hash = localStorage.getItem('signage_playlist_hash_pending');
                    if (hash) localStorage.setItem('signage_playlist_hash', hash);

                    localStorage.removeItem('signage_pending_playlist_id');
                    localStorage.removeItem('signage_pending_playlist_items');

                    showToast('PLAYLIST SWAPPED SUCCESSFULLY');
                    addLog(`SYS: Swapped to new playlist '${currentPending.name}'`);
                    return; // Stop current timer loop and let next useEffect trigger with new items
                } else {
                    console.log("SMOOTH SWAP: Pending playlist not ready (Clip 1 not cached: " + firstMediaId + "). Staying on current.");
                }
            }

            const nextIndex = (currentIndex + 1) % items.length;
            if (nextIndex === currentIndex) {
                // Same index (1-item playlist), just tick to restart effect
                setLoopTick(t => t + 1);
            } else {
                setCurrentIndex(nextIndex);
            }
            localStorage.setItem('signage_playlist_index', nextIndex.toString());
        }, safeDuration);

        return () => clearTimeout(timer);
    }, [currentIndex, items, loopTick]);

    // --- Dashboard Ticker (Ensures timer counts up while open) ---
    useEffect(() => {
        if (!showAdmin) return;
        const interval = setInterval(() => {
            setDashboardTick(t => t + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [showAdmin]);

    // --- Helpers ---
    const isVideo = (filename?: string) => {
        if (!filename) return false;
        return filename.toLowerCase().match(/\.(mp4|webm|ogg|mov)$/);
    };

    const handleRegistrationSuccess = (data: { deviceId: string, deviceName: string, branchCode: string, location?: string }) => {
        localStorage.setItem('signage_device_id', data.deviceId);
        localStorage.setItem('signage_device_name', data.deviceName);
        localStorage.setItem('signage_device_branch', data.branchCode);
        if (data.location) localStorage.setItem('signage_device_location', data.location);

        setDeviceId(data.deviceId);
        setDeviceName(data.deviceName);
        setBranchCode(data.branchCode);
        setLocation(data.location || '');
        setIsRegistered(true);
        setStatus('IDLE');
        showToast(`DEVICE REGISTERED: ${data.deviceId}`);
    };

    const handleUpdateConfig = (data: { deviceName: string, branchCode: string, location: string }) => {
        localStorage.setItem('signage_device_name', data.deviceName);
        localStorage.setItem('signage_device_branch', data.branchCode);
        localStorage.setItem('signage_device_location', data.location);

        setDeviceName(data.deviceName);
        setBranchCode(data.branchCode);
        setLocation(data.location);

        addLog('SYS: Configuration Updated locally');
        showToast('SETTINGS UPDATED');

        // Reset boot report flag so it sends updated info next heartbeat
        isBootReportSent.current = false;
    };

    const showToast = (msg: string) => {
        setDebugMsg(msg);
        setTimeout(() => setDebugMsg(''), 3000);
    };

    // --- Hotkeys ---
    usePlayerHotkeys({
        onHelp: () => showToast('F1: HELP | F2/F3: VOL | F7: ADMIN'),
        onVolumeDown: () => handleVolumeChange(Math.max(0, volume - 5)),
        onVolumeUp: () => handleVolumeChange(Math.min(100, volume + 5)),
        onExit: () => showToast('EXIT COMMAND RECEIVED'),
        onRefresh: () => window.location.reload(),
        onSync: () => showToast('SYNC REQUESTED...'),
        onAdmin: () => setShowAdmin(prev => !prev),
        onReset: () => setStatus('RESETTING_LOOP')
    });

    // Cursor Hiding
    useEffect(() => {
        document.body.style.cursor = showAdmin ? 'default' : 'none';
        return () => { document.body.style.cursor = 'default'; };
    }, [showAdmin]);

    // Renders
    if (status === 'Checking Registration...') {
        return <div className="w-screen h-screen bg-black flex items-center justify-center text-accent-cyan font-mono animate-pulse tracking-widest">SYSTEM INITIALIZING...</div>;
    }

    if (!isRegistered) {
        return <DeviceRegistration onRegisterSuccess={handleRegistrationSuccess} />;
    }

    return (
        <div className="relative w-screen h-screen bg-black overflow-hidden font-sans">

            {/* 1. Playback Layer */}
            <div className="absolute inset-0 flex items-center justify-center bg-black">
                {/* Safety Jingle Layer - Show when IDLE or LOADING if available */}
                {safetyJingleUrl && (!currentItem || isLoadingContent) && (
                    <img
                        src={safetyJingleUrl}
                        className="absolute inset-0 w-full h-full object-cover z-20 animate-in fade-in duration-1000"
                        alt="Safety Jingle"
                    />
                )}

                {currentItem && currentItem.media && !isLoadingContent ? (
                    (() => {
                        const mediaUrl = cachedMediaUrls[currentItem.mediaId] || currentItem.media.blobUrl;
                        const itemKey = `${currentItem.playlistItemId}-${loopTick}`;

                        return isVideo(currentItem.media.fileName) ? (
                            <video
                                key={itemKey} // Force remount on item change or loop tick
                                ref={videoRef}
                                src={mediaUrl}
                                autoPlay
                                muted={volume === 0}
                                loop={false}
                                playsInline
                                className="w-full h-full object-contain relative z-30"
                            />
                        ) : (
                            <img
                                key={itemKey}
                                src={mediaUrl}
                                alt={currentItem.media.displayName}
                                className="w-full h-full object-contain animate-in fade-in duration-500 relative z-30"
                            />
                        );
                    })()
                ) : (
                    // IDLE SCREEN (Fallback beneath Jingle)
                    <div className="text-center space-y-4 opacity-50 relative z-10">
                        <div className="text-6xl animate-bounce">🦄</div>
                        <h1 className="text-4xl text-white font-bold tracking-widest opacity-80">SIGNAGE UNICORN</h1>

                        {playlistId && items.length === 0 ? (
                            <div className="text-yellow-500 font-mono animate-pulse">
                                <p className="text-xl">PLAYLIST EMPTY</p>
                                <p className="text-xs mt-2">Add content to playlist to begin playback.</p>
                            </div>
                        ) : (
                            <p className="text-accent-cyan font-mono animate-pulse text-sm">Waiting for Content...</p>
                        )}

                        <p className="text-xs text-gray-600">{deviceName} • {status}</p>
                        {isLoadingContent && <p className="text-yellow-400 text-xs text-shadow-glow bg-black/50 px-4 py-2 rounded">DOWNLOADING ASSETS...</p>}

                        {/* Status Dots */}
                        <div className="flex flex-col items-center gap-2 mt-4">
                            <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full shadow-[0_0_10px_currentColor] transition-colors duration-500 ${status === 'PLAYING' ? 'bg-green-500 animate-pulse text-green-500' :
                                    status === 'IDLE' ? 'bg-yellow-500 text-yellow-500' :
                                        'bg-red-500 text-red-500'
                                    }`} />
                                <span className="text-xs font-mono text-gray-400">{status}</span>
                            </div>
                            {lastHeartbeat && (
                                <p className="text-xs text-gray-600 font-mono">
                                    LAST SYNC: {lastHeartbeat.toLocaleTimeString()}
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 2. Debug Toast (HUD) */}
            {debugMsg && (
                <div className="absolute top-8 right-8 px-6 py-3 bg-black/80 text-white font-mono text-xl border-l-4 border-accent-cyan z-50 animate-in slide-in-from-right fade-in shadow-[0_0_20px_rgba(0,0,0,0.5)]">
                    {debugMsg}
                </div>
            )}

            {/* 2.1 Volume OSD */}
            {showVolumeOSD && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] animate-in zoom-in fade-in duration-300">
                    <div className="glass-panel p-8 rounded-3xl border border-white/20 flex flex-col items-center gap-4 bg-black/40 backdrop-blur-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                        <div className="text-4xl">{volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'}</div>
                        <div className="w-48 h-2 bg-white/10 rounded-full overflow-hidden border border-white/5">
                            <div
                                className="h-full bg-gradient-to-r from-accent-purple to-accent-cyan transition-all duration-300 shadow-[0_0_10px_rgba(0,242,255,0.5)]"
                                style={{ width: `${volume}%` }}
                            />
                        </div>
                        <div className="text-2xl font-black font-mono text-white drop-shadow-lg">{volume}%</div>
                    </div>
                </div>
            )}

            {/* 3. Info Corner */}
            {!showAdmin && (
                <div className="absolute bottom-4 right-4 text-white/20 text-xs font-mono z-40 mix-blend-difference pointer-events-none">
                    ID: {deviceName} • <span className="font-bold">F7</span> Admin
                </div>
            )}

            {/* 4. Overlays */}
            <PlayerOverlay
                isOpen={showAdmin}
                onClose={() => setShowAdmin(false)}
                isOnline={isOnline}
                deviceId={deviceId}
                deviceName={deviceName}
                branchCode={branchCode}
                location={location}
                ipAddress="CONNECTED"
                lastHeartbeat={lastHeartbeat}
                onUpdateConfig={handleUpdateConfig}
                currentPlaylistId={playlistId}
                currentPlaylistName={playlistName}
                limitLogs={logs}
                currentMediaName={currentItem?.media?.displayName || currentItem?.media?.fileName}
                currentPositionSec={Math.floor((Date.now() - itemStartedAt) / 1000)}
                currentDurationSec={currentItem?.durationOverride || currentItem?.media?.durationSec || 10}
                playlistTotalDurationSec={items.reduce((acc, item) => acc + (item.durationOverride || item.media?.durationSec || 10), 0)}
                currentItemIndex={currentIndex}
                totalItems={items.length}
                cacheProgress={cacheProgress}
                cachedCount={cachedCount}
                onPlayPlaylist={loadPlaylist}
                onForceSync={() => {
                    showToast('SYNCING...');
                    if (playlistId) loadPlaylist(playlistId);
                }}
                onClearCache={() => {
                    if (confirm('CLEAR MEDIA CACHE: This will remove all downloaded content and playlists. Device registration will remain. Continue?')) {
                        // Preserve Identity
                        const did = localStorage.getItem('signage_device_id');
                        const dname = localStorage.getItem('signage_device_name');
                        const dbranch = localStorage.getItem('signage_device_branch');
                        const jingleId = localStorage.getItem('signage_safety_jingle_id'); // Optional: keep jingle config
                        const jingleData = localStorage.getItem('signage_safety_jingle_data');

                        // Wipe
                        localStorage.clear();

                        // Restore Identity
                        if (did) localStorage.setItem('signage_device_id', did);
                        if (dname) localStorage.setItem('signage_device_name', dname);
                        if (dbranch) localStorage.setItem('signage_device_branch', dbranch);
                        if (jingleId) localStorage.setItem('signage_safety_jingle_id', jingleId);
                        if (jingleData) localStorage.setItem('signage_safety_jingle_data', jingleData);

                        // Clear Service Worker Cache too
                        if (window.caches) {
                            window.caches.delete('signage-media-v1').then(() => {
                                console.log('Media Cache Cleared');
                                window.location.reload();
                            });
                        } else {
                            window.location.reload();
                        }
                    }
                }}
                onVolumeDown={() => handleVolumeChange(Math.max(0, volume - 5))}
                onVolumeUp={() => handleVolumeChange(Math.min(100, volume + 5))}
                onRefresh={() => window.location.reload()}
                onReset={() => setStatus('RESETTING_LOOP')}
                onHelp={() => showToast('F1: HELP | F2/F3: VOL | F7: ADMIN')}
                onScreenTest={handleScreenTest}
            />

            {/* 5. Screen Test Layer */}
            {screenTestColor && (
                <div
                    className="fixed inset-0 z-[10000] cursor-pointer flex flex-col items-center justify-end pb-20 animate-in fade-in duration-500"
                    style={{ backgroundColor: screenTestColor }}
                    onClick={handleScreenTest}
                >
                    <div className="bg-black/50 backdrop-blur-md px-6 py-3 rounded-full border border-white/20 text-white font-mono text-xs uppercase tracking-[0.2em] shadow-2xl animate-pulse">
                        Pattern: {screenTestColor} • Click to Cycle / Exit
                    </div>
                </div>
            )}
        </div>
    );
}

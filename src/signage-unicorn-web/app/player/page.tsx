'use client';

import { apiFetch } from '@/lib/api-fetch';
import React, { useState, useEffect, useRef } from 'react';
import { usePlayerHotkeys } from '@/features/player/hooks/usePlayerHotkeys';
import { PlayerOverlay } from '@/features/player/components/PlayerOverlay';
import { DeviceRegistration } from '@/features/player/components/DeviceRegistration';
import { deviceApi } from '@/features/devices/api/device-api';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { PlaylistItem } from '@/features/playlists/types/playlist';
import type { DeviceCommand, PlaybackBatchResult, SystemLogBatchResult } from '@/features/devices/types';
import { generateId } from '@/lib/utils';
import { getDeviceToken, setDeviceToken, DEVICE_TOKEN_INVALID } from '@/lib/device-token';
import {
    blobBasename, mediaCacheKey, cacheRequestUrl, applyPlaybackBatchResult, nextBackoffMs, shouldAttemptClaim, playbackPlaylistId,
    nextClaimRetryMs, isRetryableClaimFailure, isTokenRace,
    emptyOwnership, ownerOf, beginActiveLoad, beginPendingLoad, promotePending, dropAllOwnership, type UrlMapOwnership,
    isLatestLoad, cancelPendingLoad,
} from '@/lib/player-sync';
import { getCapabilities } from '@/lib/api-capabilities';
import pkg from '../../package.json';

import { systemApi } from '@/features/system/api/system-api';

// The device schedule is addressed by this pseudo playlist id (same convention as the Electron client).
const SCHEDULE_PLAYLIST_ID = 'SCHEDULE';
const SCHEDULE_REFRESH_MS = 15 * 60 * 1000;
const MAX_PLAYBACK_QUEUE = 500;
const MAX_SYSTEM_LOG_QUEUE = 200;
const ACK_TIMEOUT_MS = 10000;
const PLAYBACK_QUEUE_KEY = 'signage_pending_playback_logs';
const SYSTEM_LOG_QUEUE_KEY = 'signage_pending_system_logs';

const isSchedulePlaylist = (id: string | null | undefined) => !!id && id.toUpperCase().startsWith(SCHEDULE_PLAYLIST_ID);

// Round-4 #9: every request the player makes is DEVICE-scoped (device base URL, X-Client-Protocol,
// device token when known, no admin redirect) - playlist, schedule, media, settings and the
// capabilities probe alike. Mixing scopes could send registration to one API and playlist loads to another.
const deviceInit = () => ({ scope: 'device' as const, deviceToken: getDeviceToken() });

interface QueuedPlaybackLog {
    eventId?: string;
    tempId?: string;
    deviceId: string | null;
    mediaId: string;
    playlistId: string | null;
    duration: number;
    result: string;
    playedAt: string;
}

interface QueuedSystemLog {
    tempId: string;
    deviceId: string | null;
    logType: 'WARN' | 'ERROR';
    message: string;
    source: string;
    createdAt: string;
}

/**
 * Change-detection hash. A replaced file carries a new stored name and hash even when the media id
 * is unchanged, so both are part of the key; otherwise a swapped clip was never re-downloaded.
 */
const computeContentHash = (pId: string, sortedItems: PlaylistItem[]) =>
    pId + '|' + sortedItems
        // Round-3 #16: the source playlist/item ids are part of the key, so two campaigns with the same
        // clips still swap and proof-of-play is attributed to the current one.
        .map(i => `${i.playlistId || ''}:${i.playlistItemId || ''}:${i.mediaId}-${blobBasename(i.media?.blobUrl)}-${i.media?.fileHash || ''}-${i.durationOverride || 0}`)
        .join(',');

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
    // Object URLs of the playlist ON SCREEN (mediaId -> {key, url}) and of the playlist being
    // prepared in the background. Keeping them apart is what lets a replacement for a clip that is
    // playing right now download without yanking the URL the <video> is using (Codex round-2 #14).
    const activeUrlsRef = useRef<Record<string, { key: string; url: string }>>({});
    const pendingUrlsRef = useRef<Record<string, { key: string; url: string }>>({});

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

    // Device-token state: NONE until the API issues one, OK once a token-bearing call succeeded,
    // REJECTED when the API answered 401 DEVICE_TOKEN_INVALID (an operator must reset it server-side).
    const [deviceTokenStatus, setDeviceTokenStatus] = useState<'NONE' | 'OK' | 'REJECTED' | 'CLAIM_DENIED'>('NONE');
    const [deviceTokenMessage, setDeviceTokenMessage] = useState('');
    const tokenRejectionLoggedRef = useRef(false);
    // Contract T3: a rejected token triggers a re-claim at most once per 10 minutes.
    const lastClaimAttemptRef = useRef<number | null>(null);
    // Round-3 #8 / R3: transient claim failures retry on their own backoff; a lost claim race retries once.
    const claimBackoffMsRef = useRef(0);
    const claimRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const claimRaceRetriedRef = useRef(false);
    useEffect(() => () => { if (claimRetryTimerRef.current) clearTimeout(claimRetryTimerRef.current); }, []);
    // Round-3 #9: which playlist load owns the active / pending object-URL maps right now.
    const loadGenerationRef = useRef(0);
    const urlOwnershipRef = useRef<UrlMapOwnership>(emptyOwnership());
    // Contract T6: retryable upload failures back off (30 s .. 10 min) instead of hammering the API.
    const playbackBackoffMsRef = useRef(0);
    const playbackRetryNotBeforeRef = useRef(0);
    // Command ids currently executing: the server re-delivers un-acked commands every 120 s.
    const executingCommandsRef = useRef<Set<string>>(new Set());
    // Latest items without the stale-closure problem of callbacks captured by long-lived effects.
    const itemsRef = useRef<PlaylistItem[]>([]);
    useEffect(() => { itemsRef.current = items; }, [items]);

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
    const APP_VERSION = (pkg as { version: string }).version; // package.json is the single source

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
            const res = await apiFetch(`/media/${id}`, deviceInit());
            if (res.success && res.data && res.data.blobUrl) {
                setSafetyJingleUrl(res.data.blobUrl);
            }
        } catch (e) {
            console.error('Failed to load safety jingle', e);
        }
    };

    // Round-3 #8: a boot claim that failed for a transient reason (429, 503, network) is retried on its
    // own schedule, independently of heartbeats (which succeed without a token under IfIssued).
    const scheduleClaimRetry = (why: string) => {
        if (claimRetryTimerRef.current) clearTimeout(claimRetryTimerRef.current);
        const delay = nextClaimRetryMs(claimBackoffMsRef.current);
        claimBackoffMsRef.current = delay;
        addLog(`WARN: Token claim ${why}; retrying in ${Math.round(delay / 1000)}s`, 'WARN');
        claimRetryTimerRef.current = setTimeout(() => { claimRetryTimerRef.current = null; void claimDeviceToken('retry'); }, delay);
    };

    // Contract T2/T3: a screen registered before tokens existed asks the server for one through the
    // claim endpoint, which resolves the STORED device id and never creates a row (re-registering a
    // drifted identity created a duplicate device and stranded the screen). Old API -> 404 -> carry on.
    const claimDeviceToken = async (reason: 'boot' | 'rejected' | 'retry' | 'forced') => {
        const storedId = localStorage.getItem('signage_device_id');
        const deviceKey = localStorage.getItem('signage_device_key');
        if (!storedId || !deviceKey) return;
        if (reason === 'rejected' && !shouldAttemptClaim(Date.now(), lastClaimAttemptRef.current)) return;
        if (reason === 'forced' && claimRetryTimerRef.current) { clearTimeout(claimRetryTimerRef.current); claimRetryTimerRef.current = null; }
        lastClaimAttemptRef.current = Date.now();
        try {
            const res = await deviceApi.claimToken(storedId, deviceKey, `Web ${APP_VERSION}`);
            if (res.success && res.data?.deviceToken) {
                const returned = [res.data.deviceId, res.data.deviceUuid].filter((v) => v !== undefined && v !== null).map(String);
                if (returned.length > 0 && !returned.includes(storedId)) {
                    setDeviceTokenStatus('CLAIM_DENIED');
                    setDeviceTokenMessage(`server resolved another device (${returned.join('/')})`);
                    addLog(`ERR: Token claim resolved a different device identity (${returned.join('/')}); token discarded`, 'ERROR');
                    return;
                }
                setDeviceToken(res.data.deviceToken);
                tokenRejectionLoggedRef.current = false;
                setDeviceTokenStatus('OK');
                setDeviceTokenMessage('');
                addLog(reason === 'boot' ? 'SYS: Device token issued by server' : 'SYS: Device token re-issued after reset');
                claimBackoffMsRef.current = 0;
                claimRaceRetriedRef.current = false;
                return;
            }
            if (res.code === 404) {
                // Older API without the claim endpoint: nothing to do until it is upgraded.
                claimBackoffMsRef.current = 0;
                return;
            }
            const upper = (res.message || '').toUpperCase();
            if (isTokenRace(res.code, res.message)) {
                // Contract R3: two claims collided server-side; the loser retries exactly once.
                if (!claimRaceRetriedRef.current) {
                    claimRaceRetriedRef.current = true;
                    const jitter = 500 + Math.floor(Math.random() * 1000);
                    addLog(`WARN: Token claim raced another claim; retrying once in ${jitter} ms`, 'WARN');
                    setTimeout(() => { void claimDeviceToken('forced'); }, jitter);
                    return;
                }
                claimRaceRetriedRef.current = false;
                setDeviceTokenStatus('CLAIM_DENIED');
                setDeviceTokenMessage('token claim lost a race twice; reset it on the server');
                addLog('ERR: Token claim denied: TOKEN_RACE (twice)', 'ERROR');
                return;
            }
            if (res.code === 403 || upper.includes('CLAIM_EVIDENCE_MISMATCH')) {
                setDeviceTokenStatus('CLAIM_DENIED');
                setDeviceTokenMessage('evidence mismatch (device key differs from the server record)');
                addLog('ERR: Token claim denied: CLAIM_EVIDENCE_MISMATCH', 'ERROR');
            } else if (res.code === 409 || upper.includes('TOKEN_ALREADY_ISSUED')) {
                setDeviceTokenStatus('CLAIM_DENIED');
                setDeviceTokenMessage('a token was already issued to this device; reset it on the server');
                addLog('ERR: Token claim denied: TOKEN_ALREADY_ISSUED', 'ERROR');
            } else if (!res.success && isRetryableClaimFailure(res.code)) {
                scheduleClaimRetry(`failed (${res.code}${res.message ? ': ' + res.message : ''})`);
            } else if (!res.success) {
                console.warn('Device token claim failed', res.code, res.message);
            }
        } catch (e) {
            console.warn('Device token claim failed (will retry later)', e);
            scheduleClaimRetry('threw');
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
                    const res = await systemApi.getSetting('safety_jingle_id', deviceInit());
                    const serverJingleId = res.data;

                    if (res.success && serverJingleId) {
                        // If ID changed or we don't have data yet
                        if (serverJingleId !== savedJingleId || !savedJingleData) {
                            console.log("Global Jingle Update Detected:", serverJingleId);
                            localStorage.setItem('signage_safety_jingle_id', serverJingleId);

                            // Fetch Metadata to get URL
                            try {
                                const mediaRes = await apiFetch(`/media/${serverJingleId}`, deviceInit());
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
                if (!getDeviceToken()) claimDeviceToken('boot');

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

                            const gen = ++loadGenerationRef.current;
                            urlOwnershipRef.current = beginActiveLoad(urlOwnershipRef.current, gen);
                            syncMediaAssets(parsedItems, gen);
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

    const isSyncingSystemLogs = useRef(false);

    const readQueue = <T,>(key: string): T[] => {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as T[]) : [];
        } catch {
            localStorage.removeItem(key);
            return [];
        }
    };

    // Bounded persistence: an unattended screen must never grow a queue until localStorage
    // quota kills every write on the page.
    const writeQueue = <T,>(key: string, queue: T[], cap: number) => {
        let next = queue;
        if (next.length > cap) {
            console.warn(`[QUEUE] ${key} exceeded ${cap} entries; dropping the ${next.length - cap} oldest`);
            next = next.slice(next.length - cap);
        }
        try {
            if (next.length > 0) localStorage.setItem(key, JSON.stringify(next));
            else localStorage.removeItem(key);
        } catch (e) {
            console.warn('[QUEUE] localStorage quota hit; keeping the newest half', e);
            try { localStorage.setItem(key, JSON.stringify(next.slice(Math.floor(next.length / 2)))); } catch { /* storage unusable */ }
        }
    };

    const noteTokenRejection = (message?: string) => {
        if (!message || !message.toUpperCase().includes(DEVICE_TOKEN_INVALID)) return;
        setDeviceTokenStatus('REJECTED');
        if (!tokenRejectionLoggedRef.current) {
            tokenRejectionLoggedRef.current = true;
            addLog('ERR: Device token rejected by server. Reset it under Devices > Reset token', 'ERROR');
        }
        // After an operator reset the server holds no token: one bounded claim brings this screen
        // back without anyone touching it. The stored token is never cleared here.
        claimDeviceToken('rejected');
    };

    // --- Playback Log Sync (Offline Queue) ---
    // Proof-of-play upload: one batch in flight at a time; every event carries an eventId so the
    // server deduplicates idempotently and tells us exactly which events it kept.
    const syncPlaybackLogs = async () => {
        if (isSyncingLogs.current) return;
        isSyncingLogs.current = true;

        try {
            let queue = readQueue<QueuedPlaybackLog>(PLAYBACK_QUEUE_KEY);
            if (queue.length === 0) return;

            // Events queued by an older build carry only tempId: give them a stable eventId once and
            // persist it, so a retry never re-sends the same play under a new id.
            if (queue.some((l) => !l.eventId)) {
                queue = queue.map((l) => (l.eventId ? l : { ...l, eventId: generateId() }));
                writeQueue(PLAYBACK_QUEUE_KEY, queue, MAX_PLAYBACK_QUEUE);
            }

            if (Date.now() < playbackRetryNotBeforeRef.current) return; // backing off after a retryable failure

            const batch = queue.slice(0, 100);
            const batchIds = batch.map((l) => l.eventId as string);

            const res = await apiFetch<PlaybackBatchResult>('/logs/playback/batch', {
                method: 'POST',
                body: JSON.stringify(batch),
                deviceToken: getDeviceToken(),
            });

            // Contract T6: 503 RETRY_LATER / 5xx / 429 / network keep everything (with backoff);
            // per-event rejections are permanent; an old API's success takes the whole batch.
            const outcome = applyPlaybackBatchResult(batchIds, res);
            if (outcome.retry) {
                if (res.code === 401) noteTokenRejection(res.message);
                playbackBackoffMsRef.current = nextBackoffMs(playbackBackoffMsRef.current);
                playbackRetryNotBeforeRef.current = Date.now() + playbackBackoffMsRef.current;
                console.warn(`[POP] upload failed (${res.code} ${res.message}); retrying in ${Math.round(playbackBackoffMsRef.current / 1000)}s`);
                return;
            }
            playbackBackoffMsRef.current = 0;
            playbackRetryNotBeforeRef.current = 0;
            const doneIds = outcome.done;
            const rejectedCount = res.data?.rejected?.length || 0;
            if (rejectedCount > 0) console.warn(`[POP] server rejected ${rejectedCount} playback events`, res.data?.rejected);
            if (!res.success) console.warn('[POP] playback batch rejected by server, dropping it:', res.message);

            if (res.success && getDeviceToken()) setDeviceTokenStatus('OK');

            // Re-read: new events may have been queued while the request was in flight.
            const current = readQueue<QueuedPlaybackLog>(PLAYBACK_QUEUE_KEY);
            const remaining = current.filter((item) => !item.eventId || !doneIds.has(item.eventId));
            writeQueue(PLAYBACK_QUEUE_KEY, remaining, MAX_PLAYBACK_QUEUE);
            console.log(`[POP] synced ${doneIds.size} events, remaining ${remaining.length}`);
        } catch (e) {
            console.warn('[POP] playback sync failed', e);
        } finally {
            isSyncingLogs.current = false;
        }
    };

    const queuePlaybackLog = (mediaId: string, duration: number, itemPlaylistId?: string | null) => {
        const eventId = generateId();
        const log: QueuedPlaybackLog = {
            eventId,
            tempId: eventId,
            deviceId,
            mediaId,
            // Contract T15: items of the device schedule carry their real playlist; the page-level
            // `SCHEDULE` pseudo id would be stored as NULL by the server (Codex round-2 #24).
            playlistId: playbackPlaylistId(playlistId, itemPlaylistId, isSchedulePlaylist),
            duration,
            result: 'success',
            playedAt: new Date().toISOString() // UTC, with Z; the server stores it as given
        };

        const queue = readQueue<QueuedPlaybackLog>(PLAYBACK_QUEUE_KEY);
        queue.push(log);
        writeQueue(PLAYBACK_QUEUE_KEY, queue, MAX_PLAYBACK_QUEUE);

        // Try sync immediately
        syncPlaybackLogs();
    };

    // Clears downloaded media and playlist state but keeps the device identity
    // (id, key, token, name, branch, location) and the cached safety jingle.
    const wipeLocalContent = async () => {
        const keep: Record<string, string | null> = {};
        for (const k of ['signage_device_id', 'signage_device_key', 'signage_device_token', 'signage_device_name',
            'signage_device_branch', 'signage_device_location', 'signage_safety_jingle_id', 'signage_safety_jingle_data']) {
            keep[k] = localStorage.getItem(k);
        }
        localStorage.clear();
        for (const [k, v] of Object.entries(keep)) if (v !== null) localStorage.setItem(k, v);
        for (const map of [activeUrlsRef.current, pendingUrlsRef.current]) {
            Object.values(map).forEach((e) => { try { URL.revokeObjectURL(e.url); } catch { /* noop */ } });
        }
        activeUrlsRef.current = {};
        pendingUrlsRef.current = {};
        urlOwnershipRef.current = dropAllOwnership();
        setCachedMediaUrls({});
        if ('caches' in window) {
            try { await caches.delete(MEDIA_CACHE_NAME); console.log('Media Cache Cleared'); } catch { /* noop */ }
        }
    };

    // --- Command protocol ---
    // The server marks a delivered command POLLING and re-delivers it every 120 s until acked.
    const ackCommand = async (cmd: DeviceCommand, status: 'EXECUTED' | 'FAILED', message?: string) => {
        const id = cmd.deviceCommandId ?? cmd.commandId;
        const devId = heartbeatRef.current.deviceId;
        if (!id || !devId || String(id) === '0') return; // id 0 = synthetic server-side command, nothing to ack
        try {
            const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ACK_TIMEOUT_MS));
            const res = await Promise.race([deviceApi.ackCommand(devId, String(id), status, message), timeout]);
            if (res && !res.success && res.code === 401) noteTokenRejection(res.message);
        } catch (e) {
            console.warn('[CMD] ack failed', e);
        }
    };

    const processCommand = async (cmd: DeviceCommand) => {
        const rawCmd = String(cmd.commandType || '').trim();
        const idKey = String(cmd.deviceCommandId ?? cmd.commandId ?? rawCmd);
        if (executingCommandsRef.current.has(idKey)) return; // re-delivered while still running
        executingCommandsRef.current.add(idKey);
        console.log('RECEIVED COMMAND:', cmd);
        addLog(`CMD: ${rawCmd}`);
        const upper = rawCmd.toUpperCase();

        try {
            // Contract R2: the server reset this screen's token and asks for an immediate re-claim.
            // Synthetic command (not a table row): nothing to acknowledge.
            if (upper === 'RECLAIM_TOKEN') {
                addLog('SYS: Server asked this screen to re-claim its device token');
                await claimDeviceToken('forced');
                return;
            }
            // Restart-type commands: acknowledge first (nothing can report after a reload), then act.
            if (upper.startsWith('REBOOT') || upper.startsWith('RESTART') || upper === 'REFRESH' || upper === 'RELOAD') {
                await ackCommand(cmd, 'EXECUTED');
                window.location.reload();
                return;
            }
            if (upper === 'WIPE_CACHE') {
                await ackCommand(cmd, 'EXECUTED');
                await wipeLocalContent();
                window.location.reload();
                return;
            }
            if (upper.startsWith('UPDATE_DEVICE_ID:')) {
                const newId = rawCmd.substring('UPDATE_DEVICE_ID:'.length).trim();
                await ackCommand(cmd, 'EXECUTED');
                if (newId && newId !== heartbeatRef.current.deviceId) {
                    localStorage.setItem('signage_device_id', newId);
                    addLog(`SYS: Device id corrected by server -> ${newId}`, 'WARN');
                    window.location.reload();
                }
                return;
            }
            if (upper === 'SYNC_SCHEDULE' || upper === 'FORCE_SYNC') {
                showToast(upper === 'SYNC_SCHEDULE' ? 'REMOTE SCHEDULE' : 'REMOTE SYNC');
                const target = upper === 'SYNC_SCHEDULE'
                    ? SCHEDULE_PLAYLIST_ID
                    : (heartbeatRef.current.playlistId || SCHEDULE_PLAYLIST_ID);
                const ok = await loadPlaylistRef.current(target);
                await ackCommand(cmd, ok ? 'EXECUTED' : 'FAILED', ok ? undefined : 'LOAD_FAILED');
                return;
            }
            if (upper.startsWith('PLAY_PLAYLIST:')) {
                const pid = rawCmd.substring('PLAY_PLAYLIST:'.length).trim();
                if (!pid) { await ackCommand(cmd, 'FAILED', 'MISSING_PLAYLIST_ID'); return; }
                showToast('REMOTE PLAYLIST');
                const ok = await loadPlaylistRef.current(pid);
                await ackCommand(cmd, ok ? 'EXECUTED' : 'FAILED', ok ? undefined : 'LOAD_FAILED');
                return;
            }
            // CAPTURE_SCREEN, UPDATE_CLIENT, ...: not possible from a browser tab. Say so instead of
            // letting the server re-deliver it forever.
            await ackCommand(cmd, 'FAILED', 'UNSUPPORTED');
        } catch (e) {
            console.error('[CMD] failed', rawCmd, e);
            const reason = e instanceof Error ? e.message : String(e);
            await ackCommand(cmd, 'FAILED', (reason || 'ERROR').substring(0, 200));
        } finally {
            executingCommandsRef.current.delete(idKey);
        }
    };

    // The heartbeat effect is long-lived; it must call the latest render's handler, not the one
    // captured when the effect was created.
    const processCommandRef = useRef(processCommand);
    useEffect(() => { processCommandRef.current = processCommand; });

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
                    if (getDeviceToken()) setDeviceTokenStatus('OK');
                    if (!isBootReportSent.current) {
                        isBootReportSent.current = true;
                        console.log('[Boot Report] Device metadata sent successfully.');
                        addLog('SYS: Registered with server');
                    }
                    if (isManual) addLog('SYS: Heartbeat sent (Sync OK)');

                    // Commands run one at a time and each one is acknowledged.
                    for (const cmd of res.data) {
                        await processCommandRef.current(cmd);
                    }
                } else {
                    setIsOnline(false);
                    if (res.code === 401) noteTokenRejection(res.message);
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

    const publishActiveUrls = () => {
        const flat: Record<string, string> = {};
        for (const [mediaId, entry] of Object.entries(activeUrlsRef.current)) flat[mediaId] = entry.url;
        setCachedMediaUrls(flat);
    };

    // Swap boundary: the prepared (pending) object URLs become the active set; active URLs that the
    // new playlist does not reuse are released only now, after the player stopped using them.
    const promotePendingToActive = (newItems: PlaylistItem[]) => {
        const next: Record<string, { key: string; url: string }> = {};
        for (const item of newItems) {
            if (!item.media) continue;
            const key = mediaCacheKey({ mediaId: item.mediaId, blobUrl: item.media.blobUrl, fileHash: item.media.fileHash });
            const candidate = pendingUrlsRef.current[item.mediaId]?.key === key
                ? pendingUrlsRef.current[item.mediaId]
                : (activeUrlsRef.current[item.mediaId]?.key === key ? activeUrlsRef.current[item.mediaId] : undefined);
            if (candidate) next[item.mediaId] = candidate;
        }
        const stillUsed = new Set(Object.values(next).map((e) => e.url));
        for (const map of [activeUrlsRef.current, pendingUrlsRef.current]) {
            for (const entry of Object.values(map)) {
                if (!stillUsed.has(entry.url)) { try { URL.revokeObjectURL(entry.url); } catch { /* noop */ } }
            }
        }
        activeUrlsRef.current = next;
        pendingUrlsRef.current = {};
        publishActiveUrls();
    };

    // Everything goes: used when a playlist/schedule came back empty.
    const releaseAllObjectUrls = () => {
        for (const map of [activeUrlsRef.current, pendingUrlsRef.current]) {
            Object.values(map).forEach((e) => { try { URL.revokeObjectURL(e.url); } catch { /* noop */ } });
        }
        activeUrlsRef.current = {};
        pendingUrlsRef.current = {};
        urlOwnershipRef.current = dropAllOwnership();
        setCachedMediaUrls({});
    };

    // Round-4 #8: the newest authoritative answer IS the active content, so a smooth-swap candidate
    // queued earlier is obsolete. Disarm it (state, storage, download ownership) before it can replace
    // what is playing at the next clip boundary; its still-running downloads see 'dropped' and stop.
    const cancelPendingPlaylist = (why: string) => {
        const hadPending = !!pendingPlaylistRef.current || urlOwnershipRef.current.pending !== null || Object.keys(pendingUrlsRef.current).length > 0;
        if (!hadPending) return;
        const activeUrls = new Set(Object.values(activeUrlsRef.current).map((e) => e.url));
        for (const entry of Object.values(pendingUrlsRef.current)) {
            if (!activeUrls.has(entry.url)) { try { URL.revokeObjectURL(entry.url); } catch { /* noop */ } }
        }
        pendingUrlsRef.current = {};
        urlOwnershipRef.current = cancelPendingLoad(urlOwnershipRef.current);
        setPendingPlaylist(null);
        pendingPlaylistRef.current = null;
        localStorage.removeItem('signage_pending_playlist_id');
        localStorage.removeItem('signage_pending_playlist_items');
        localStorage.removeItem('signage_playlist_hash_pending');
        addLog(`SYS: Pending playlist cancelled (${why})`);
    };

    // --- Playlist Loader ---
    // Returns true when the requested content is loaded or queued, false when the server could not
    // provide it (used for command acknowledgements). `SCHEDULE` resolves the device schedule.
    const loadPlaylist = async (pId: string): Promise<boolean> => {
        const wantsSchedule = isSchedulePlaylist(pId);
        const devId = heartbeatRef.current.deviceId;
        if (wantsSchedule && !devId) {
            addLog('ERR: Cannot load the device schedule without a device id', 'ERROR');
            return false;
        }
        const effectiveId = wantsSchedule ? SCHEDULE_PLAYLIST_ID : pId;

        // Round-4 #7: the generation is taken BEFORE the first await. When the answer arrives, a newer
        // request may have started; then this (older) response is discarded before it can touch state,
        // storage, caches or the pending map. The same number owns this load's object-URL map.
        const gen = ++loadGenerationRef.current;

        // Only show full-screen loader if we have nothing playing
        if (itemsRef.current.length === 0) setIsLoadingContent(true);

        try {
            const res = wantsSchedule
                ? await deviceApi.getSchedule(devId as string)
                : await playlistApi.getById(pId, deviceInit());
            if (!isLatestLoad(loadGenerationRef.current, gen)) {
                console.log(`SMART SYNC: load #${gen} superseded by #${loadGenerationRef.current}; response ignored`);
                return true;
            }
            if (res.success && res.data && res.data.items) {
                const validItems = res.data.items.filter(i => i.media);
                // Ensure items are sorted by positionOrder
                const sortedItems = validItems.sort((a, b) => a.positionOrder - b.positionOrder);
                const playlistLabel = wantsSchedule ? (res.data.playlistName || 'Device Schedule') : res.data.playlistName;

                // --- SMART SYNC: Change Detection (media id + stored file + hash + duration) ---
                const contentHash = computeContentHash(effectiveId, sortedItems);
                const currentHash = localStorage.getItem('signage_playlist_hash');

                if (contentHash === currentHash && itemsRef.current.length > 0) {
                    console.log("SMART SYNC: Content hash matches. Skipping reload to maintain local playback continuity.");
                    cancelPendingPlaylist('server confirmed the active content');
                    setPlaylistId(effectiveId);
                    return true;
                }

                if (sortedItems.length === 0) {
                    // An empty schedule/playlist is a valid answer (nothing assigned any more): stop.
                    releaseAllObjectUrls();
                    setItems([]);
                    setPlaylistId(effectiveId);
                    setPlaylistName(playlistLabel);
                    setCurrentIndex(0);
                    setStatus('IDLE');
                    setPendingPlaylist(null);
                    pendingPlaylistRef.current = null;
                    localStorage.setItem('signage_playlist_id', effectiveId);
                    localStorage.setItem('signage_playlist_name', playlistLabel);
                    localStorage.removeItem('signage_playlist_items');
                    localStorage.setItem('signage_playlist_hash', contentHash);
                    localStorage.removeItem('signage_pending_playlist_id');
                    localStorage.removeItem('signage_pending_playlist_items');
                    addLog(`SYS: '${playlistLabel}' has no items; screen is idle`, 'WARN');
                    return true;
                }

                // --- IMMEDIATE SWAP IF IDLE ---
                if (itemsRef.current.length === 0) {
                    console.log("SMART SYNC: IDLE -> Loading first playlist immediately.");
                    setItems(sortedItems);
                    setPlaylistId(effectiveId);
                    setPlaylistName(playlistLabel);
                    setCurrentIndex(0);
                    setStatus('PLAYING');

                    localStorage.setItem('signage_playlist_id', effectiveId);
                    localStorage.setItem('signage_playlist_name', playlistLabel);
                    localStorage.setItem('signage_playlist_items', JSON.stringify(sortedItems));
                    localStorage.setItem('signage_playlist_hash', contentHash);

                    addLog(`SYS: Loaded playlist '${playlistLabel}' (${sortedItems.length} items)`);
                    urlOwnershipRef.current = beginActiveLoad(urlOwnershipRef.current, gen);
                    syncMediaAssets(sortedItems, gen);
                } else {
                    // --- SMOOTH BACKGROUND SWAP ---
                    console.log("SMART SYNC: Change detected. Queuing background update...");
                    const pending = { id: effectiveId, name: playlistLabel, items: sortedItems };
                    setPendingPlaylist(pending);
                    pendingPlaylistRef.current = pending;

                    localStorage.setItem('signage_pending_playlist_id', effectiveId);
                    localStorage.setItem('signage_pending_playlist_items', JSON.stringify(sortedItems));
                    localStorage.setItem('signage_playlist_hash_pending', contentHash);

                    showToast(`PLAYLIST UPDATED: SYNCING IN BACKGROUND...`);
                    addLog(`SYS: New playlist '${playlistLabel}' queued for smooth swap`);

                    urlOwnershipRef.current = beginPendingLoad(urlOwnershipRef.current, gen);
                    syncMediaAssets(sortedItems, gen);
                }
                return true;
            }

            showToast('FAILED TO LOAD PLAYLIST');
            addLog(`ERR: Failed to load playlist content (${res.message || 'no data'})`, 'ERROR');
            if (res.code === 401) noteTokenRejection(res.message);
            return false;
        } catch (err) {
            console.error(err);
            showToast('ERROR LOADING CONTENT');
            addLog('ERR: API Error loading content', 'ERROR');
            return false;
        } finally {
            setIsLoadingContent(false);
        }
    };

    const loadPlaylistRef = useRef(loadPlaylist);
    useEffect(() => { loadPlaylistRef.current = loadPlaylist; });

    // Round-4 #9: the player's capabilities probe uses the DEVICE scope like every other player call
    // (display only; the player keeps "send if available" semantics regardless of the answer).
    useEffect(() => {
        if (!isRegistered) return;
        let cancelled = false;
        getCapabilities('device')
            .then((caps) => { if (!cancelled) addLog(caps.legacy ? 'SYS: API without capabilities endpoint (pre-2.8)' : `SYS: API ${caps.apiVersion} (protocol ${caps.protocol})`); })
            .catch(() => { /* informational only */ });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isRegistered]);

    // While on the device schedule, re-resolve it periodically so a start/end date that passes
    // while the screen is unattended takes effect without waiting for a command.
    useEffect(() => {
        if (!isRegistered || !isSchedulePlaylist(playlistId)) return;
        const timer = setInterval(() => {
            loadPlaylistRef.current(SCHEDULE_PLAYLIST_ID);
        }, SCHEDULE_REFRESH_MS);
        return () => clearInterval(timer);
    }, [isRegistered, playlistId]);

    // --- Media Cache Sync (Offline Hub) ---
    // Materialises every clip of `playlistItems` as an object URL in the ACTIVE map (the playlist on
    // screen / about to start) or the PENDING map (a smooth-swap candidate). Entries are identified
    // by media id + stored file name + content hash, so a re-encoded file under the same URL is
    // fetched again and a clip that is playing keeps its URL until the swap (Codex round-2 #14, #15).
    const syncMediaAssets = async (playlistItems: PlaylistItem[], generation: number) => {
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

            for (const item of playlistItems) {
                // Who owns this load NOW (promoted meanwhile, or abandoned by a newer load)? Round-3 #9.
                const owner = ownerOf(urlOwnershipRef.current, generation);
                if (owner === 'dropped') {
                    console.log(`CACHE_SYNC: load #${generation} superseded, stopping`);
                    return;
                }
                const targetRef = owner === 'active' ? activeUrlsRef : pendingUrlsRef;
                const otherRef = owner === 'active' ? pendingUrlsRef : activeUrlsRef;
                const media = item.media;
                if (!media || !media.blobUrl) {
                    loaded++;
                    continue;
                }

                const url = media.blobUrl;
                const key = mediaCacheKey({ mediaId: item.mediaId, blobUrl: url, fileHash: media.fileHash });
                const cacheKeyUrl = cacheRequestUrl(url, media.fileHash, window.location.href);

                // Same stored file version already materialised (in either map): share its URL.
                const existing = [targetRef.current[item.mediaId], otherRef.current[item.mediaId]].find((e) => e && e.key === key);
                if (existing) {
                    if (targetRef.current[item.mediaId]?.url !== existing.url) {
                        targetRef.current = { ...targetRef.current, [item.mediaId]: existing };
                        if (owner === 'active') publishActiveUrls();
                    }
                    loaded++;
                    setCachedCount(loaded);
                    setCacheProgress(Math.round((loaded / total) * 100));
                    continue;
                }

                try {
                    // 1. Cache API, keyed by URL + content hash
                    const cachedRes = await cache.match(cacheKeyUrl);
                    let finalUrl = '';
                    if (cachedRes) {
                        const blob = await cachedRes.blob();
                        finalUrl = URL.createObjectURL(blob);
                    } else {
                        // 2. Download with CORS mode
                        const response = await fetch(url, { mode: 'cors' });
                        if (response.ok) {
                            await cache.put(cacheKeyUrl, response.clone());
                            const blob = await response.blob();
                            finalUrl = URL.createObjectURL(blob);
                        } else {
                            throw new Error(`Server status ${response.status}`);
                        }
                    }

                    if (finalUrl) {
                        // Ownership may have moved while this clip downloaded: write to the map that
                        // owns the generation NOW, or release the URL if the load was abandoned.
                        const ownerNow = ownerOf(urlOwnershipRef.current, generation);
                        if (ownerNow === 'dropped') {
                            try { URL.revokeObjectURL(finalUrl); } catch { /* noop */ }
                            return;
                        }
                        const writeRef = ownerNow === 'active' ? activeUrlsRef : pendingUrlsRef;
                        const otherNow = ownerNow === 'active' ? pendingUrlsRef : activeUrlsRef;
                        // A superseded entry in the SAME map is released unless the other map (the
                        // clip on screen, when preparing a pending list) still points at it.
                        const previous = writeRef.current[item.mediaId];
                        if (previous && previous.url !== finalUrl && previous.url !== otherNow.current[item.mediaId]?.url) {
                            try { URL.revokeObjectURL(previous.url); } catch { /* noop */ }
                        }
                        writeRef.current = { ...writeRef.current, [item.mediaId]: { key, url: finalUrl } };
                        if (ownerNow === 'active') publishActiveUrls();
                    }
                } catch (err) {
                    console.warn(`CACHE_SYNC: Failed to cache ${media.fileName}`, err);
                    addLog(`ERR: Cache failed for ${media.displayName || media.fileName}`);
                }

                loaded++;
                setCachedCount(loaded);
                setCacheProgress(Math.round((loaded / total) * 100));
            }

            // Drop cached media that no current or pending playlist references any more (removed
            // clips, superseded file versions). Without this the cache only ever grew.
            try {
                const keepUrls = new Set<string>();
                const referenced = [...playlistItems, ...itemsRef.current, ...(pendingPlaylistRef.current?.items || [])];
                for (const i of referenced) {
                    if (i.media?.blobUrl) keepUrls.add(cacheRequestUrl(i.media.blobUrl, i.media.fileHash, window.location.href));
                }
                const keys = await cache.keys();
                let pruned = 0;
                for (const req of keys) {
                    if (!keepUrls.has(req.url)) {
                        await cache.delete(req);
                        pruned++;
                    }
                }
                if (pruned > 0) console.log(`CACHE_SYNC: pruned ${pruned} unreferenced media entries`);
            } catch (pruneErr) {
                console.warn('CACHE_SYNC: prune failed', pruneErr);
            }

            setCacheProgress(100);
            setCachedCount(total);
            addLog(`SYS: Cache Sync Complete (${loaded}/${total} items)`);
        } catch (globalErr: unknown) {
            console.error("CACHE_SYNC_CRITICAL:", globalErr);
            const errorMsg = globalErr instanceof Error && globalErr.message.includes("Context")
                ? "Offline Sync REJECTED by Browser (Needs Localhost/HTTPS)"
                : "Offline Sync Initialization Failed";
            addLog(`ERR: ${errorMsg}`);
            setCacheProgress(0);
            setCachedCount(0);
        } finally {
            setIsLoadingContent(false);
        }
    };

    // Diagnostic log upload. The server persists WARN/ERROR only, so INFO stays on-screen and is
    // never queued: it used to be the bulk of the traffic (one upload per clip played).
    const syncSystemLogs = async () => {
        if (isSyncingSystemLogs.current) return;
        isSyncingSystemLogs.current = true;
        try {
            const queue = readQueue<QueuedSystemLog>(SYSTEM_LOG_QUEUE_KEY);
            if (queue.length === 0) return;
            const batch = queue.slice(0, 50);
            const batchIds = new Set<string>(batch.map((l) => l.tempId));

            const res = await apiFetch<SystemLogBatchResult>('/logs/batch', {
                method: 'POST',
                body: JSON.stringify(batch),
                deviceToken: getDeviceToken(),
            });

            if (res.success || (res.code >= 400 && res.code < 500 && res.code !== 401 && res.code !== 429)) {
                const current = readQueue<QueuedSystemLog>(SYSTEM_LOG_QUEUE_KEY);
                writeQueue(SYSTEM_LOG_QUEUE_KEY, current.filter((item) => !batchIds.has(item.tempId)), MAX_SYSTEM_LOG_QUEUE);
            } else if (res.code === 401) {
                noteTokenRejection(res.message);
            }
        } catch (e) {
            console.error("System log sync failed", e);
        } finally {
            isSyncingSystemLogs.current = false;
        }
    };

    const addLog = (msg: string, type: 'INFO' | 'WARN' | 'ERROR' = 'INFO') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10));

        if (type === 'INFO') return; // on-screen only; the server does not store INFO

        const log: QueuedSystemLog = {
            tempId: generateId(),
            deviceId: heartbeatRef.current.deviceId,
            logType: type,
            message: msg,
            source: 'WebPlayer',
            createdAt: new Date().toISOString()
        };

        const queue = readQueue<QueuedSystemLog>(SYSTEM_LOG_QUEUE_KEY);
        queue.push(log);
        writeQueue(SYSTEM_LOG_QUEUE_KEY, queue, MAX_SYSTEM_LOG_QUEUE);
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
                queuePlaybackLog(item.mediaId, item.durationOverride || item.media?.durationSec || 10, item.playlistId);
            }

            // --- SMOOTH SWAP LOGIC (Using Ref for latest value) ---
            const currentPending = pendingPlaylistRef.current;
            if (currentPending && currentPending.items.length > 0) {
                const firstItem = currentPending.items[0];
                const firstMediaId = firstItem.mediaId;
                const firstKey = firstItem.media ? mediaCacheKey({ mediaId: firstMediaId, blobUrl: firstItem.media.blobUrl, fileHash: firstItem.media.fileHash }) : '';
                const firstReady = pendingUrlsRef.current[firstMediaId]?.key === firstKey || activeUrlsRef.current[firstMediaId]?.key === firstKey;
                if (firstReady) {
                    console.log("SMOOTH SWAP: Next playlist ready. Switching now.");
                    urlOwnershipRef.current = promotePending(urlOwnershipRef.current);
                    promotePendingToActive(currentPending.items);
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
                        <div className="text-6xl animate-[fadeIn_1.5s_ease-out]">🦄</div>
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
                                className="h-full bg-gradient-to-r from-accent-purple to-accent-cyan transition-all duration-300"
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
                deviceTokenStatus={deviceTokenStatus}
                deviceTokenMessage={deviceTokenMessage}
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
                        wipeLocalContent().then(() => window.location.reload());
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

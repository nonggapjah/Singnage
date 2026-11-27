/**
 * Pure helpers shared by the web player (app/player/page.tsx) and its unit tests.
 *
 * Nothing here touches React, the DOM or storage, so every rule that decides what the kiosk keeps,
 * drops, retries or re-downloads can be tested without a browser.
 */
import type { PlaybackBatchResult } from '@/features/devices/types';

/** Minimal media identity the cache keys are derived from. */
export interface MediaIdentity {
    mediaId: string;
    blobUrl?: string;
    fileHash?: string;
}

/** Last path segment of a media URL (the API stores every file version under a unique GUID name). */
export function blobBasename(url?: string): string {
    if (!url) return '';
    try {
        const pathname = new URL(url, 'http://local').pathname;
        return pathname.substring(pathname.lastIndexOf('/') + 1);
    } catch {
        return url;
    }
}

/**
 * Identity of one stored file version: media id + stored file name + content hash.
 * Two playlist items that resolve to the same key can share one object URL; a replaced file (new
 * name) or a re-encoded file under the same name (new hash) gets a new key and is fetched again.
 */
export function mediaCacheKey(media: MediaIdentity): string {
    return `${media.mediaId}|${blobBasename(media.blobUrl)}|${media.fileHash || ''}`;
}

/**
 * URL used as the Cache API key for a media file. The real download still goes to `blobUrl`; the
 * key carries the content hash as a query parameter so a transcode that keeps the URL but changes
 * the bytes cannot be served from the stale entry (Cache API ignores fragments, hence a query).
 */
export function cacheRequestUrl(blobUrl: string, fileHash?: string, base?: string): string {
    const absolute = new URL(blobUrl, base || 'http://local').href;
    if (!fileHash) return absolute;
    return absolute + (absolute.includes('?') ? '&' : '?') + 'h=' + encodeURIComponent(fileHash);
}

/**
 * The page-relative form of a media URL. The API publishes media under its own BaseUrl -- the LAN
 * http address the kiosks download from -- which on the web player is cross-origin and, on an https
 * page, mixed content the browser blocks (the video element then stays black and the clip never
 * caches). Next rewrites /media/* to the API, so the same file is always reachable same-origin over
 * the page's own scheme. Data URLs, blob URLs and paths outside /media/ are returned unchanged.
 */
export function pageMediaUrl(blobUrl: string | null | undefined): string {
    if (!blobUrl) return '';
    if (/^(data|blob):/i.test(blobUrl)) return blobUrl;
    try {
        const u = new URL(blobUrl, 'http://local');
        if (u.pathname.startsWith('/media/')) return u.pathname + u.search;
        return blobUrl;
    } catch {
        return blobUrl;
    }
}

/** Playlist items with every media URL in its page-relative form (see pageMediaUrl). The cache
 *  identity (stored file name + hash) is unchanged, so this never looks like a content change. */
export function withPageMediaUrls<T extends { media?: { blobUrl?: string } | null }>(items: T[]): T[] {
    return items.map(i => (i.media && i.media.blobUrl)
        ? ({ ...i, media: { ...i.media, blobUrl: pageMediaUrl(i.media.blobUrl) } } as T)
        : i);
}

/** The part of HTMLMediaElement the autoplay fallback needs (kept minimal so tests can fake it). */
export interface PlayableMedia {
    muted: boolean;
    play(): Promise<void>;
}

/** True for the rejection browsers raise when autoplay policy refuses to start a clip with sound. */
export function isAutoplayBlocked(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'NotAllowedError';
}

/**
 * Starts a clip, falling back to muted playback when the browser refuses unmuted autoplay.
 * Chrome (and Safari) reject play() with NotAllowedError until the viewer has interacted with the
 * page -- the normal state of an unattended screen that boots straight into /player -- and without
 * the fallback the clip sits on its first frame for the whole slot. Anything other than an autoplay
 * block (source cannot be decoded, element went away) is reported as 'failed' unchanged, and a clip
 * that is already muted when it is refused is not retried.
 */
export async function playWithMutedFallback(media: PlayableMedia): Promise<'playing' | 'muted' | 'failed'> {
    try {
        await media.play();
        return 'playing';
    } catch (err) {
        if (media.muted || !isAutoplayBlocked(err)) return 'failed';
        media.muted = true;
        try {
            await media.play();
            return 'muted';
        } catch {
            return 'failed';
        }
    }
}

export interface BatchResponseLike {
    success: boolean;
    code: number;
    message?: string;
    data?: PlaybackBatchResult | null;
}

export interface BatchOutcome {
    /** Event ids that must be removed from the local queue (stored, deduplicated, or unfixable). */
    done: Set<string>;
    /** True when nothing may be removed and the batch must be sent again later. */
    retry: boolean;
    /** True when the server rejected the device token (401 DEVICE_TOKEN_INVALID). */
    tokenRejected: boolean;
}

/**
 * Decides what happens to a submitted playback batch (contract T6):
 * - new API, `data.accepted` present → remove accepted AND rejected ids (rejections are permanent:
 *   unknown media/device/validation), keep everything else;
 * - old API (no `data.accepted`) → success removes the whole batch, as before;
 * - 503 RETRY_LATER, other 5xx, 429, 401 and network failures (code -1) → keep everything;
 * - any other 4xx → the batch itself is malformed; retrying cannot help, drop it.
 */
export function applyPlaybackBatchResult(batchIds: string[], res: BatchResponseLike): BatchOutcome {
    const tokenRejected = res.code === 401 && !!res.message && res.message.toUpperCase().includes('DEVICE_TOKEN_INVALID');

    if (res.success) {
        const accepted = res.data?.accepted;
        if (Array.isArray(accepted)) {
            const rejected = (res.data?.rejected || []).map((r) => r.eventId).filter((x): x is string => !!x);
            return { done: new Set<string>([...accepted, ...rejected]), retry: false, tokenRejected: false };
        }
        return { done: new Set<string>(batchIds), retry: false, tokenRejected: false };
    }

    const retryable = res.code === -1 || res.code === 401 || res.code === 429 || res.code >= 500 || res.code === 0;
    if (retryable) return { done: new Set<string>(), retry: true, tokenRejected };
    return { done: new Set<string>(batchIds), retry: false, tokenRejected: false };
}

export const PLAYBACK_BACKOFF_BASE_MS = 30_000;
export const PLAYBACK_BACKOFF_MAX_MS = 10 * 60_000;

/** Exponential backoff for the playback uploader: 30 s, 60 s, 120 s, ... capped at 10 min. */
export function nextBackoffMs(previousMs: number, baseMs = PLAYBACK_BACKOFF_BASE_MS, maxMs = PLAYBACK_BACKOFF_MAX_MS): number {
    if (!previousMs || previousMs <= 0) return baseMs;
    return Math.min(previousMs * 2, maxMs);
}

export const DEVICE_CLAIM_MIN_INTERVAL_MS = 10 * 60_000;

/** Contract T3: after a token rejection the player may try to claim again at most once per 10 min. */
export function shouldAttemptClaim(now: number, lastAttemptAt: number | null | undefined, minIntervalMs = DEVICE_CLAIM_MIN_INTERVAL_MS): boolean {
    if (lastAttemptAt === null || lastAttemptAt === undefined) return true;
    return now - lastAttemptAt >= minIntervalMs;
}

/**
 * Playlist id to record on a proof-of-play event. Items of the device schedule carry the real
 * playlist they came from; the page-level `SCHEDULE` pseudo id must never reach the server.
 */
export function playbackPlaylistId(pageLevelId: string | null | undefined, itemPlaylistId: string | null | undefined, isPseudo: (id: string | null | undefined) => boolean): string | null {
    if (itemPlaylistId && !isPseudo(itemPlaylistId)) return itemPlaylistId;
    if (pageLevelId && !isPseudo(pageLevelId)) return pageLevelId;
    return null;
}

// --- Boot-claim retry (Codex round-3 #8) and claim race (contract R3) ---
export const CLAIM_RETRY_BASE_MS = 60_000;
export const CLAIM_RETRY_MAX_MS = 30 * 60_000;

/** 1 min, 2, 4 ... capped at 30 min. */
export function nextClaimRetryMs(previousMs: number): number {
    if (!previousMs || previousMs <= 0) return CLAIM_RETRY_BASE_MS;
    return Math.min(previousMs * 2, CLAIM_RETRY_MAX_MS);
}

/** Transient answers worth another attempt; 4xx verdicts (403/404/409) are final. */
export function isRetryableClaimFailure(code: number): boolean {
    return code === -1 || code === 0 || code === 408 || code === 429 || code >= 500;
}

export function isTokenRace(code: number, message?: string | null): boolean {
    return code === 409 && !!message && message.toUpperCase().includes('TOKEN_RACE');
}

// --- Object-URL map ownership (Codex round-3 #9) ---
// Each playlist load has a generation. A download that finishes late asks who owns its generation
// NOW, so clips of a playlist promoted mid-download land in the active map, not a cleared pending one.
export type UrlMapOwner = 'active' | 'pending' | 'dropped';
export interface UrlMapOwnership { active: number | null; pending: number | null }

export const emptyOwnership = (): UrlMapOwnership => ({ active: null, pending: null });

export function ownerOf(o: UrlMapOwnership, generation: number): UrlMapOwner {
    if (o.active === generation) return 'active';
    if (o.pending === generation) return 'pending';
    return 'dropped';
}

/** Idle screen: the load goes straight on screen; any pending candidate is abandoned. */
export function beginActiveLoad(_o: UrlMapOwnership, generation: number): UrlMapOwnership {
    return { active: generation, pending: null };
}

/** Smooth swap candidate; an older never-promoted pending load is abandoned. */
export function beginPendingLoad(o: UrlMapOwnership, generation: number): UrlMapOwnership {
    return { active: o.active, pending: generation };
}

/** Swap boundary: pending becomes active, the old active generation is dropped. */
export function promotePending(o: UrlMapOwnership): UrlMapOwnership {
    return o.pending === null ? o : { active: o.pending, pending: null };
}

export const dropAllOwnership = (): UrlMapOwnership => ({ active: null, pending: null });

// --- Load ordering (Codex round-4 #7) and obsolete pending swaps (round-4 #8) ---
/**
 * A playlist/schedule request takes its generation BEFORE its first await; when the answer arrives
 * it may only be applied if no newer request has started since. Otherwise a slow older response
 * would replace the newer selection (state, storage, caches, pending map).
 */
export function isLatestLoad(latestGeneration: number, requestGeneration: number): boolean {
    return requestGeneration === latestGeneration;
}

/**
 * The newest authoritative answer equals what is already playing: a smooth-swap candidate queued
 * earlier is obsolete and must be disarmed, together with its download ownership, or it would
 * replace the active content at the next clip boundary.
 */
export function cancelPendingLoad(o: UrlMapOwnership): UrlMapOwnership {
    return o.pending === null ? o : { active: o.active, pending: null };
}

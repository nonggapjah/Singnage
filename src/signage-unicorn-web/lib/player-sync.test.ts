import { describe, it, expect } from 'vitest';
import {
    blobBasename,
    mediaCacheKey,
    pageMediaUrl, withPageMediaUrls,
    playWithMutedFallback, isAutoplayBlocked,
    cacheRequestUrl,
    applyPlaybackBatchResult,
    nextBackoffMs,
    shouldAttemptClaim,
    playbackPlaylistId,
    PLAYBACK_BACKOFF_BASE_MS,
    PLAYBACK_BACKOFF_MAX_MS,
    nextClaimRetryMs, isRetryableClaimFailure, isTokenRace,
    isLatestLoad, cancelPendingLoad,
    emptyOwnership, ownerOf, beginActiveLoad, beginPendingLoad, promotePending, dropAllOwnership,
    CLAIM_RETRY_BASE_MS, CLAIM_RETRY_MAX_MS,
} from './player-sync';

describe('media identity', () => {
    it('blobBasename returns the stored file name', () => {
        expect(blobBasename('http://api/media/abc-123.mp4')).toBe('abc-123.mp4');
        expect(blobBasename('/media/x.png?v=2')).toBe('x.png');
        expect(blobBasename(undefined)).toBe('');
    });

    it('mediaCacheKey changes when the stored name OR the hash changes', () => {
        const a = mediaCacheKey({ mediaId: '1', blobUrl: 'http://api/media/a.mp4', fileHash: 'h1' });
        const sameUrlNewBytes = mediaCacheKey({ mediaId: '1', blobUrl: 'http://api/media/a.mp4', fileHash: 'h2' });
        const newFile = mediaCacheKey({ mediaId: '1', blobUrl: 'http://api/media/b.mp4', fileHash: 'h1' });
        expect(a).not.toBe(sameUrlNewBytes);
        expect(a).not.toBe(newFile);
        expect(mediaCacheKey({ mediaId: '1', blobUrl: 'http://api/media/a.mp4', fileHash: 'h1' })).toBe(a);
    });

    it('cacheRequestUrl appends the hash as a query parameter (fragments are ignored by the Cache API)', () => {
        expect(cacheRequestUrl('http://api/media/a.mp4', 'h1')).toBe('http://api/media/a.mp4?h=h1');
        expect(cacheRequestUrl('http://api/media/a.mp4?v=1', 'h1')).toBe('http://api/media/a.mp4?v=1&h=h1');
        expect(cacheRequestUrl('http://api/media/a.mp4')).toBe('http://api/media/a.mp4');
        expect(cacheRequestUrl('/media/a.mp4', 'h1', 'http://web.local/player')).toBe('http://web.local/media/a.mp4?h=h1');
    });
});

describe('applyPlaybackBatchResult (contract T6)', () => {
    const ids = ['e1', 'e2', 'e3'];

    it('new API: removes accepted and permanently rejected events, keeps the rest', () => {
        const out = applyPlaybackBatchResult(ids, {
            success: true, code: 0,
            data: { accepted: ['e1'], rejected: [{ eventId: 'e2', reason: 'unknown media' }], acceptedCount: 1, rejectedCount: 1 },
        });
        expect(out.retry).toBe(false);
        expect([...out.done].sort()).toEqual(['e1', 'e2']);
        expect(out.tokenRejected).toBe(false);
    });

    it('old API: success without data.accepted takes the whole batch', () => {
        const out = applyPlaybackBatchResult(ids, { success: true, code: 0, data: null });
        expect(out.retry).toBe(false);
        expect([...out.done].sort()).toEqual(ids);
    });

    it('503 RETRY_LATER, other 5xx, 429 and network failures keep everything', () => {
        for (const code of [503, 500, 502, 429, -1, 0]) {
            const out = applyPlaybackBatchResult(ids, { success: false, code, message: 'RETRY_LATER' });
            expect(out.retry, `code ${code}`).toBe(true);
            expect(out.done.size).toBe(0);
        }
    });

    it('401 DEVICE_TOKEN_INVALID keeps the batch and flags the token', () => {
        const out = applyPlaybackBatchResult(ids, { success: false, code: 401, message: 'DEVICE_TOKEN_INVALID' });
        expect(out.retry).toBe(true);
        expect(out.tokenRejected).toBe(true);
    });

    it('any other 4xx means the batch itself is unacceptable and is dropped', () => {
        const out = applyPlaybackBatchResult(ids, { success: false, code: 400, message: 'Batch too large' });
        expect(out.retry).toBe(false);
        expect([...out.done].sort()).toEqual(ids);
    });
});

describe('backoff and claim throttle', () => {
    it('nextBackoffMs doubles from 30 s and caps at 10 min', () => {
        const steps: number[] = [];
        let prev = 0;
        for (let i = 0; i < 8; i++) { prev = nextBackoffMs(prev); steps.push(prev); }
        expect(steps[0]).toBe(PLAYBACK_BACKOFF_BASE_MS);
        expect(steps[1]).toBe(PLAYBACK_BACKOFF_BASE_MS * 2);
        expect(steps[steps.length - 1]).toBe(PLAYBACK_BACKOFF_MAX_MS);
        expect(Math.max(...steps)).toBe(PLAYBACK_BACKOFF_MAX_MS);
    });

    it('shouldAttemptClaim allows the first attempt and then one per 10 minutes', () => {
        const t0 = 1_000_000;
        expect(shouldAttemptClaim(t0, null)).toBe(true);
        expect(shouldAttemptClaim(t0 + 60_000, t0)).toBe(false);
        expect(shouldAttemptClaim(t0 + 10 * 60_000, t0)).toBe(true);
    });
});

describe('playbackPlaylistId (contract T15)', () => {
    const isPseudo = (id: string | null | undefined) => !!id && id.toUpperCase().startsWith('SCHEDULE');

    it('prefers the item playlist and never records the SCHEDULE pseudo id', () => {
        expect(playbackPlaylistId('SCHEDULE', 'uuid-7', isPseudo)).toBe('uuid-7');
        expect(playbackPlaylistId('SCHEDULE', null, isPseudo)).toBeNull();
        expect(playbackPlaylistId('uuid-1', undefined, isPseudo)).toBe('uuid-1');
        expect(playbackPlaylistId('uuid-1', 'uuid-2', isPseudo)).toBe('uuid-2');
    });
});

describe('boot-claim retry and race (round-3 #8, contract R3)', () => {
    it('backoff starts at 1 min, doubles, caps at 30 min', () => {
        expect(nextClaimRetryMs(0)).toBe(CLAIM_RETRY_BASE_MS);
        expect(nextClaimRetryMs(CLAIM_RETRY_BASE_MS)).toBe(2 * CLAIM_RETRY_BASE_MS);
        expect(nextClaimRetryMs(CLAIM_RETRY_MAX_MS)).toBe(CLAIM_RETRY_MAX_MS);
    });
    it('transient answers retry, verdicts do not', () => {
        for (const c of [-1, 0, 408, 429, 500, 503]) expect(isRetryableClaimFailure(c)).toBe(true);
        for (const c of [400, 403, 404, 409]) expect(isRetryableClaimFailure(c)).toBe(false);
        expect(isTokenRace(409, 'TOKEN_RACE')).toBe(true);
        expect(isTokenRace(409, 'TOKEN_ALREADY_ISSUED')).toBe(false);
    });
});

describe('object-URL map ownership (round-3 #9)', () => {
    it('a download finishing after promotion targets the ACTIVE map', () => {
        let o = beginActiveLoad(emptyOwnership(), 1);
        o = beginPendingLoad(o, 2);
        expect(ownerOf(o, 2)).toBe('pending');
        o = promotePending(o);
        expect(ownerOf(o, 2)).toBe('active');
        expect(ownerOf(o, 1)).toBe('dropped');
    });
    it('newer loads abandon older ones; dropAll disowns everything', () => {
        let o = beginPendingLoad(beginActiveLoad(emptyOwnership(), 1), 2);
        o = beginPendingLoad(o, 3);
        expect(ownerOf(o, 2)).toBe('dropped');
        o = beginActiveLoad(o, 4);
        expect(ownerOf(o, 1)).toBe('dropped');
        expect(ownerOf(o, 3)).toBe('dropped');
        expect(promotePending(o)).toBe(o);
        expect(ownerOf(dropAllOwnership(), 4)).toBe('dropped');
    });
});

describe('load ordering and obsolete pending swaps (round-4 #7, #8)', () => {
    it('only the newest request may apply its response, however the answers arrive', () => {
        let latest = 0;
        const a = ++latest;           // request A starts first
        const b = ++latest;           // request B starts while A is in flight
        expect(isLatestLoad(latest, b)).toBe(true);
        expect(isLatestLoad(latest, a)).toBe(false); // A's late answer must be discarded
        const c = ++latest;
        expect(isLatestLoad(latest, b)).toBe(false);
        expect(isLatestLoad(latest, c)).toBe(true);
    });

    it('cancelling the pending load keeps the active owner and disowns the pending generation', () => {
        let o = beginActiveLoad(emptyOwnership(), 1);
        o = beginPendingLoad(o, 2);
        expect(ownerOf(o, 2)).toBe('pending');
        o = cancelPendingLoad(o);
        expect(o).toEqual({ active: 1, pending: null });
        expect(ownerOf(o, 2)).toBe('dropped');   // B's still-running downloads stop and release
        expect(ownerOf(o, 1)).toBe('active');    // A keeps playing untouched
        expect(cancelPendingLoad(o)).toBe(o);    // nothing pending = no-op
    });

    it('a promotion after cancellation does nothing (no obsolete swap can fire)', () => {
        const o = cancelPendingLoad(beginPendingLoad(beginActiveLoad(emptyOwnership(), 1), 2));
        expect(promotePending(o)).toBe(o);
    });
});

describe('pageMediaUrl (web player media must be same-origin)', () => {
    it('maps the API BaseUrl form of a media URL to the page-relative /media path', () => {
        expect(pageMediaUrl('http://192.1.200.185:8862/media/5fe41232.mp4')).toBe('/media/5fe41232.mp4');
        expect(pageMediaUrl('https://signage.example.com/media/a.png?v=2')).toBe('/media/a.png?v=2');
        expect(pageMediaUrl('/media/x.mp4')).toBe('/media/x.mp4');
    });

    it('leaves data, blob and non-media URLs alone', () => {
        expect(pageMediaUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(pageMediaUrl('blob:https://x/123')).toBe('blob:https://x/123');
        expect(pageMediaUrl('http://cdn.example.com/other/file.mp4')).toBe('http://cdn.example.com/other/file.mp4');
        expect(pageMediaUrl('')).toBe('');
        expect(pageMediaUrl(undefined)).toBe('');
    });

    it('withPageMediaUrls rewrites every item and keeps the cache identity (file name + hash)', () => {
        const items = [
            { mediaId: '120', media: { blobUrl: 'http://192.1.200.185:8862/media/5fe.mp4', fileHash: 'h1' } },
            { mediaId: '121', media: undefined },
        ];
        const out = withPageMediaUrls(items);
        expect(out[0].media!.blobUrl).toBe('/media/5fe.mp4');
        expect(mediaCacheKey({ mediaId: '120', blobUrl: out[0].media!.blobUrl, fileHash: 'h1' }))
            .toBe(mediaCacheKey({ mediaId: '120', blobUrl: items[0].media!.blobUrl, fileHash: 'h1' }));
        expect(out[1]).toBe(items[1]);
    });
});

describe('playWithMutedFallback (an unattended screen must not freeze on the first frame)', () => {
    const notAllowed = () => Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' });
    const fake = (outcomes: Array<Error | null>) => {
        const calls: boolean[] = [];
        const m = {
            muted: false,
            play: () => {
                calls.push(m.muted);
                const o = outcomes.shift();
                return o ? Promise.reject(o) : Promise.resolve();
            },
        };
        return { m, calls };
    };

    it('plays with sound when the browser allows it', async () => {
        const { m, calls } = fake([null]);
        expect(await playWithMutedFallback(m)).toBe('playing');
        expect(m.muted).toBe(false);
        expect(calls).toEqual([false]);
    });

    it('retries muted when autoplay with sound is refused', async () => {
        const { m, calls } = fake([notAllowed(), null]);
        expect(await playWithMutedFallback(m)).toBe('muted');
        expect(m.muted).toBe(true);
        expect(calls).toEqual([false, true]);
    });

    it('does not retry for other errors or when already muted', async () => {
        const broken = fake([Object.assign(new Error('no supported source'), { name: 'NotSupportedError' })]);
        expect(await playWithMutedFallback(broken.m)).toBe('failed');
        expect(broken.m.muted).toBe(false);
        expect(broken.calls).toEqual([false]);

        const muted = fake([notAllowed()]);
        muted.m.muted = true;
        expect(await playWithMutedFallback(muted.m)).toBe('failed');
        expect(muted.calls).toEqual([true]);
    });

    it('isAutoplayBlocked recognises only NotAllowedError', () => {
        expect(isAutoplayBlocked(notAllowed())).toBe(true);
        expect(isAutoplayBlocked(new Error('x'))).toBe(false);
        expect(isAutoplayBlocked(undefined)).toBe(false);
        expect(isAutoplayBlocked('NotAllowedError')).toBe(false);
    });
});

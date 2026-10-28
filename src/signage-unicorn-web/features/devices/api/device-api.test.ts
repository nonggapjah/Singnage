import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deviceApi } from './device-api';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { mediaApi } from '@/features/media/api/media-api';
import { systemApi } from '@/features/system/api/system-api';
import { resetCapabilitiesCache } from '@/lib/api-capabilities';

const envelope = (data: unknown, status = 200, message?: string) =>
    new Response(JSON.stringify({ success: status < 400, code: status < 400 ? 0 : status, message: message ?? (status < 400 ? 'OK' : 'ERR'), data, errors: null }), {
        status, headers: { 'Content-Type': 'application/json' },
    });
const NEW_API = { apiVersion: '2.8.0', protocol: 2, deviceToken: true, utcFilters: true, screenshotRoute: true, cookieSession: true, playbackBatchV2: true };

describe('deviceApi.fixDb verb selection (round-4 #6)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        sessionStorage.clear();
        localStorage.clear();
        resetCapabilitiesCache();
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    const route = (capsStatus: number, fixVerbs: Record<string, Response>) =>
        fetchMock.mockImplementation((url: string, init?: RequestInit) => {
            const u = String(url);
            if (u.endsWith('/system/capabilities')) return Promise.resolve(envelope(capsStatus === 200 ? NEW_API : null, capsStatus));
            if (u.endsWith('/devices/fix-devices-db')) return Promise.resolve(fixVerbs[(init?.method || 'GET').toUpperCase()] ?? envelope(null, 405, 'use the other verb'));
            return Promise.resolve(envelope(null, 404));
        });
    const verbsUsed = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/devices/fix-devices-db')).map((c) => ((c[1] as RequestInit)?.method || 'GET').toUpperCase());

    it('API 2.8 (capabilities present): POST, no fallback needed', async () => {
        route(200, { POST: envelope({ applied: [] }) });
        const res = await deviceApi.fixDb();
        expect(res.success).toBe(true);
        expect(verbsUsed()).toEqual(['POST']);
    });

    it('deployed 2.7.x API (capabilities 404): GET, no fallback needed', async () => {
        route(404, { GET: envelope({ applied: [] }) });
        const res = await deviceApi.fixDb();
        expect(res.success).toBe(true);
        expect(verbsUsed()).toEqual(['GET']);
    });

    it('a wrong guess (probe failed transiently, API is new) is repaired by one 405 fallback', async () => {
        route(503, { POST: envelope({ applied: [] }) }); // probe failure -> assumed legacy -> GET -> 405 -> POST
        const res = await deviceApi.fixDb();
        expect(res.success).toBe(true);
        expect(verbsUsed()).toEqual(['GET', 'POST']);
    });

    it('409 SCHEMA_APPLY_IN_PROGRESS is returned to the caller unchanged (no verb fallback)', async () => {
        route(200, { POST: envelope(null, 409, 'SCHEMA_APPLY_IN_PROGRESS') });
        const res = await deviceApi.fixDb();
        expect(res.success).toBe(false);
        expect(res.code).toBe(409);
        expect(res.message).toContain('SCHEMA_APPLY_IN_PROGRESS');
        expect(verbsUsed()).toEqual(['POST']);
    });
});

describe('player read clients honour the device scope (round-4 #9)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api-host:8862/api/v1');
        fetchMock.mockImplementation(() => Promise.resolve(envelope({ items: [] }))); // a fresh Response per call
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

    it('playlist, media and settings reads go to the device origin when asked, and to the proxy for the console', async () => {
        const init = { scope: 'device' as const, deviceToken: null };
        await playlistApi.getById('p1', init);
        await mediaApi.getById('m1', init);
        await systemApi.getSetting('safety_jingle_id', init);
        await playlistApi.getById('p1');            // console usage, unchanged
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls[0]).toBe('http://api-host:8862/api/v1/playlists/p1');
        expect(urls[1]).toBe('http://api-host:8862/api/v1/media/m1');
        expect(urls[2]).toBe('http://api-host:8862/api/v1/system/settings/safety_jingle_id');
        expect(urls[3]).toBe('/api/v1/playlists/p1');
    });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCapabilities, peekCapabilities, resetCapabilitiesCache, parseCapabilities, LEGACY_CAPABILITIES, CAPABILITIES_STORAGE_KEY } from './api-capabilities';

const envelope = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: status < 400, code: status < 400 ? 0 : status, message: status < 400 ? 'OK' : 'Not Found', data, errors: null }), { status, headers: { 'Content-Type': 'application/json' } });
const NEW_API = { apiVersion: '2.8.0', protocol: 2, deviceToken: true, utcFilters: true, screenshotRoute: true, cookieSession: true, playbackBatchV2: true };

describe('api capabilities (mixed-version rollout)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        sessionStorage.clear();
        localStorage.clear();
        resetCapabilitiesCache();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('probes once and serves the cached answer within the TTL', async () => {
        fetchMock.mockResolvedValue(envelope(NEW_API));
        const first = await getCapabilities();
        const second = await getCapabilities();
        expect(first.legacy).toBe(false);
        expect(first.utcFilters).toBe(true);
        expect(second).toEqual(first);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain('/system/capabilities');
        expect(peekCapabilities()?.apiVersion).toBe('2.8.0');
    });

    it('404 = the deployed 2.7.x API: legacy defaults, cached like a real answer', async () => {
        fetchMock.mockResolvedValue(envelope(null, 404));
        expect(await getCapabilities()).toEqual(LEGACY_CAPABILITIES);
        expect(await getCapabilities()).toEqual(LEGACY_CAPABILITIES);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem(CAPABILITIES_STORAGE_KEY)).not.toBeNull();
    });

    it('a network failure is not a verdict: legacy now, probed again after the short failure TTL', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
        fetchMock.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(envelope(NEW_API));
        expect((await getCapabilities()).legacy).toBe(true);
        expect(sessionStorage.getItem(CAPABILITIES_STORAGE_KEY)).toBeNull();
        vi.setSystemTime(new Date('2026-10-27T10:00:11Z'));
        expect((await getCapabilities()).legacy).toBe(false);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('reuses a fresh sessionStorage entry without probing, and shares one in-flight probe', async () => {
        sessionStorage.setItem(CAPABILITIES_STORAGE_KEY, JSON.stringify({ at: Date.now(), value: NEW_API }));
        expect((await getCapabilities()).screenshotRoute).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
        resetCapabilitiesCache();
        fetchMock.mockResolvedValue(envelope(NEW_API));
        await Promise.all([getCapabilities(), getCapabilities(), getCapabilities()]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('parseCapabilities rejects malformed payloads and defaults missing flags to false', () => {
        expect(parseCapabilities(null)).toBeNull();
        expect(parseCapabilities({ protocol: 'two' })).toBeNull();
        expect(parseCapabilities({ protocol: 2 })?.utcFilters).toBe(false);
        expect(parseCapabilities({ legacy: true })).toEqual(LEGACY_CAPABILITIES);
    });
});

describe('scoped probes (round-4 #9)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        sessionStorage.clear();
        resetCapabilitiesCache();
        vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api-host:8862/api/v1');
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('the player probes through the device origin, the console through the same-origin proxy, cached separately', async () => {
        fetchMock.mockImplementation((url: string) =>
            Promise.resolve(envelope(String(url).startsWith('http://api-host:8862/') ? NEW_API : null, String(url).startsWith('http://api-host:8862/') ? 200 : 404)));
        const device = await getCapabilities('device');
        const admin = await getCapabilities();
        expect(String(fetchMock.mock.calls[0][0])).toBe('http://api-host:8862/api/v1/system/capabilities');
        expect(String(fetchMock.mock.calls[1][0])).toBe('/api/v1/system/capabilities');
        expect(device.legacy).toBe(false);
        expect(admin.legacy).toBe(true);
        // second asks hit the caches, one per scope
        expect(await getCapabilities('device')).toEqual(device);
        expect(await getCapabilities('admin')).toEqual(admin);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(peekCapabilities(Date.now(), 'device')?.apiVersion).toBe('2.8.0');
        expect(peekCapabilities(Date.now(), 'admin')).toEqual(LEGACY_CAPABILITIES);
    });
});

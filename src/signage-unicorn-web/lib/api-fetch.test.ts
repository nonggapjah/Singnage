import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    apiFetch,
    authNavigation,
    getApiBaseUrl,
    LEGACY_LOCAL_TOKEN_KEY,
    setLegacySessionToken,
    getLegacySessionToken,
    REQUESTED_WITH_HEADER,
    REQUESTED_WITH_VALUE,
    CLIENT_PROTOCOL_HEADER,
    CLIENT_PROTOCOL_VERSION,
} from './api-fetch';
import { DEVICE_TOKEN_HEADER } from './device-token';

const ok = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ success: status < 400, code: status < 400 ? 0 : status, message: status < 400 ? 'OK' : 'ERR', data, errors: null }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

const headersOf = (call: unknown[]) => new Headers((call[1] as RequestInit).headers);

describe('apiFetch', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let redirectSpy: ReturnType<typeof vi.fn>;
    const originalRedirect = authNavigation.redirectToLogin;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        redirectSpy = vi.fn();
        authNavigation.redirectToLogin = redirectSpy;
        localStorage.clear();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        authNavigation.redirectToLogin = originalRedirect;
    });

    it('admin calls stay on the page origin, device calls may use the configured URL (round-3 #17)', async () => {
        vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api-host:8862/api/v1');
        expect(getApiBaseUrl('admin')).toBe('/api/v1');
        expect(getApiBaseUrl('device')).toBe('http://api-host:8862/api/v1');
        fetchMock.mockResolvedValue(ok({}));
        await apiFetch('/devices');
        expect(String(fetchMock.mock.calls[0][0])).toBe('/api/v1/devices');
        await apiFetch('/devices/heartbeat', { method: 'POST', deviceToken: null });
        expect(String(fetchMock.mock.calls[1][0])).toBe('http://api-host:8862/api/v1/devices/heartbeat');
    });

    it('a same-origin absolute URL is honoured for admin calls', () => {
        vi.stubEnv('NEXT_PUBLIC_API_URL', window.location.origin + '/api/v1');
        expect(getApiBaseUrl('admin')).toBe(window.location.origin + '/api/v1');
    });

    it('an admin 401 also removes the pre-2.4 localStorage JWT (round-3 #14)', async () => {
        localStorage.setItem(LEGACY_LOCAL_TOKEN_KEY, 'old.jwt');
        fetchMock.mockResolvedValue(ok(null, 401));
        await apiFetch('/devices');
        expect(localStorage.getItem(LEGACY_LOCAL_TOKEN_KEY)).toBeNull();
        expect(redirectSpy).toHaveBeenCalled();
    });

    it('sends X-Requested-With on every call, same-origin credentials, and no bearer by default', async () => {
        fetchMock.mockResolvedValue(ok({ v: 1 }));
        const res = await apiFetch('/system/settings/x');
        expect(res.success).toBe(true);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/api/v1/system/settings/x');
        const h = headersOf(fetchMock.mock.calls[0]);
        expect(h.get(REQUESTED_WITH_HEADER)).toBe(REQUESTED_WITH_VALUE);
        expect(h.get('Authorization')).toBeNull();
        expect(h.get(CLIENT_PROTOCOL_HEADER)).toBeNull();
        expect(init.credentials).toBe('same-origin');
    });

    it('device calls carry X-Device-Token (when known) and X-Client-Protocol: 2', async () => {
        fetchMock.mockResolvedValue(ok([]));
        await apiFetch('/devices/heartbeat', { method: 'POST', body: '{}', deviceToken: 'tok_1' });
        let h = headersOf(fetchMock.mock.calls[0]);
        expect(h.get(DEVICE_TOKEN_HEADER)).toBe('tok_1');
        expect(h.get(CLIENT_PROTOCOL_HEADER)).toBe(CLIENT_PROTOCOL_VERSION);

        await apiFetch('/devices/heartbeat', { method: 'POST', body: '{}', deviceToken: null });
        h = headersOf(fetchMock.mock.calls[1]);
        expect(h.get(DEVICE_TOKEN_HEADER)).toBeNull();
        expect(h.get(CLIENT_PROTOCOL_HEADER)).toBe(CLIENT_PROTOCOL_VERSION);
    });

    it('only the transitional legacy bearer (sessionStorage) is ever sent, never a localStorage token', async () => {
        fetchMock.mockResolvedValue(ok(null));
        localStorage.setItem('accessToken', 'stale-local');
        await apiFetch('/devices');
        expect(headersOf(fetchMock.mock.calls[0]).get('Authorization')).toBeNull();

        setLegacySessionToken('legacy-jwt');
        await apiFetch('/devices');
        expect(headersOf(fetchMock.mock.calls[1]).get('Authorization')).toBe('Bearer legacy-jwt');
    });

    it('admin 401 clears the session hints and redirects; device 401 and skipAuthRedirect do not', async () => {
        fetchMock.mockResolvedValue(ok(null, 401));
        setLegacySessionToken('legacy-jwt');
        localStorage.setItem('user', '{"username":"a"}');

        const admin = await apiFetch('/devices');
        expect(admin.success).toBe(false);
        expect(admin.code).toBe(401);
        expect(redirectSpy).toHaveBeenCalledTimes(1);
        expect(getLegacySessionToken()).toBeNull();
        expect(localStorage.getItem('user')).toBeNull();

        await apiFetch('/devices/heartbeat', { method: 'POST', body: '{}', deviceToken: 'tok' });
        await apiFetch('/auth/login', { method: 'POST', body: '{}', skipAuthRedirect: true });
        expect(redirectSpy).toHaveBeenCalledTimes(1);
    });

    it('non-2xx JSON bodies never read as success and keep the HTTP status', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, code: 0, message: 'lying', data: null, errors: null }), { status: 503 }));
        const res = await apiFetch('/logs/playback/batch', { method: 'POST', body: '[]', deviceToken: 'tok' });
        expect(res.success).toBe(false);
        expect(res.code).toBe(503);
    });

    it('the deadline covers the body read: a stalled body times out instead of hanging', async () => {
        fetchMock.mockImplementation((_url: string, init: RequestInit) => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    // Headers arrive, the body never does; only the abort signal can end it.
                    init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
                },
            });
            return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } }));
        });
        const res = await apiFetch('/devices/heartbeat', { method: 'POST', body: '{}', deviceToken: 'tok', timeoutMs: 50 });
        expect(res.success).toBe(false);
        expect(res.code).toBe(-1);
        expect(res.message).toMatch(/timed out/i);
    });

    it('network failures are reported as code -1', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        const res = await apiFetch('/devices');
        expect(res.success).toBe(false);
        expect(res.code).toBe(-1);
    });
});

describe('request scopes with a cross-origin API (round-4 #9)', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let redirectSpy: ReturnType<typeof vi.fn>;
    const originalRedirect = authNavigation.redirectToLogin;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        redirectSpy = vi.fn();
        authNavigation.redirectToLogin = redirectSpy;
        localStorage.clear();
        sessionStorage.clear();
        vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api-host:8862/api/v1');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        authNavigation.redirectToLogin = originalRedirect;
    });

    it('every player call (scope device, with or without a token) goes to the device origin; admin calls stay on /api/v1', async () => {
        fetchMock.mockImplementation(() => Promise.resolve(ok({}))); // a fresh Response per call
        await apiFetch('/playlists/abc', { scope: 'device' });                      // no token yet
        await apiFetch('/media/7', { scope: 'device', deviceToken: 'tok' });       // token known
        await apiFetch('/system/settings/safety_jingle_id', { scope: 'device', deviceToken: null });
        await apiFetch('/devices/heartbeat', { method: 'POST', deviceToken: 'tok' }); // legacy marker still works
        await apiFetch('/devices');                                                 // admin
        await apiFetch('/dashboard/stats', { scope: 'admin' });                     // explicit admin
        const urls = fetchMock.mock.calls.map((c) => String(c[0]));
        expect(urls.slice(0, 4).every((u) => u.startsWith('http://api-host:8862/api/v1/'))).toBe(true);
        expect(urls[4]).toBe('/api/v1/devices');
        expect(urls[5]).toBe('/api/v1/dashboard/stats');
        // device-scoped calls carry the protocol header; a token only when one is known
        expect(headersOf(fetchMock.mock.calls[0]).get(CLIENT_PROTOCOL_HEADER)).toBe(CLIENT_PROTOCOL_VERSION);
        expect(headersOf(fetchMock.mock.calls[0]).get(DEVICE_TOKEN_HEADER)).toBeNull();
        expect(headersOf(fetchMock.mock.calls[1]).get(DEVICE_TOKEN_HEADER)).toBe('tok');
        expect(headersOf(fetchMock.mock.calls[4]).get(CLIENT_PROTOCOL_HEADER)).toBeNull();
    });

    it('a 401 on a device-scoped read never redirects the kiosk to /login', async () => {
        fetchMock.mockResolvedValue(ok(null, 401));
        const res = await apiFetch('/playlists/abc', { scope: 'device' });
        expect(res.success).toBe(false);
        expect(res.code).toBe(401);
        expect(redirectSpy).not.toHaveBeenCalled();
    });
});

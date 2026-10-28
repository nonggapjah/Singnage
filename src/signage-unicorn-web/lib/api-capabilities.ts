import { apiFetch, type ApiScope } from './api-fetch';

/**
 * What the API this console / web player talks to can do (GET /api/v1/system/capabilities, API 2.8+).
 *
 * The deployed 2.7.x API has no such route and answers 404; it then gets the LEGACY defaults, which
 * drive every mixed-version behaviour (Codex round-3 #17/#18/#19): local-time report filters,
 * screenshots as static files, bearer sessions. Probed once per page load and cached for a minute
 * (memory + sessionStorage) so pages do not pay a round trip on every fetch.
 */
export interface ApiCapabilities {
    apiVersion: string;
    /** Device protocol the API speaks (2 = token claim, leased commands, per-event playback logs). */
    protocol: number;
    deviceToken: boolean;
    /** Date filters are compared as UTC; send ISO "Z" values. False = the API subtracts 7 h itself. */
    utcFilters: boolean;
    /** GET /devices/{id}/screenshot exists (authenticated); false = static /screenshots/<id>.jpg. */
    screenshotRoute: boolean;
    cookieSession: boolean;
    playbackBatchV2: boolean;
    /** True when the probe found no capabilities endpoint (API < 2.8) and these are the defaults. */
    legacy: boolean;
}

export const LEGACY_CAPABILITIES: Readonly<ApiCapabilities> = Object.freeze({
    apiVersion: 'legacy',
    protocol: 1,
    deviceToken: false,
    utcFilters: false,
    screenshotRoute: false,
    cookieSession: false,
    playbackBatchV2: false,
    legacy: true,
});

export const CAPABILITIES_ENDPOINT = '/system/capabilities';
export const CAPABILITIES_STORAGE_KEY = 'su_api_capabilities';
/** Round-4 #9: the web player probes through its DEVICE base URL, which may be another origin than
 *  the admin proxy, so the two answers are cached separately. */
const storageKeyFor = (scope: ApiScope) => scope === 'device' ? `${CAPABILITIES_STORAGE_KEY}:device` : CAPABILITIES_STORAGE_KEY;
export const CAPABILITIES_TTL_MS = 60_000;
/** A failed probe (network, timeout, 5xx) is not a verdict: assume legacy briefly and ask again soon. */
export const CAPABILITIES_FAILURE_TTL_MS = 10_000;

type Cached = { value: ApiCapabilities; at: number; ttl: number };
const memory: Record<ApiScope, Cached | null> = { admin: null, device: null };
const inflight: Record<ApiScope, Promise<ApiCapabilities> | null> = { admin: null, device: null };

/** Validates the payload of /system/capabilities; null when it is not a capabilities object. */
export function parseCapabilities(data: unknown): ApiCapabilities | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (d.legacy === true) return LEGACY_CAPABILITIES;
    const protocol = typeof d.protocol === 'number' ? d.protocol : Number(d.protocol);
    if (!Number.isFinite(protocol)) return null;
    const flag = (key: string) => d[key] === true;
    return {
        apiVersion: typeof d.apiVersion === 'string' && d.apiVersion.trim() ? d.apiVersion : 'unknown',
        protocol,
        deviceToken: flag('deviceToken'),
        utcFilters: flag('utcFilters'),
        screenshotRoute: flag('screenshotRoute'),
        cookieSession: flag('cookieSession'),
        playbackBatchV2: flag('playbackBatchV2'),
        legacy: false,
    };
}

function readStorage(now: number, scope: ApiScope): ApiCapabilities | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(storageKeyFor(scope));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { at?: unknown; value?: unknown };
        if (typeof parsed.at !== 'number' || now - parsed.at >= CAPABILITIES_TTL_MS) return null;
        return parseCapabilities(parsed.value);
    } catch {
        return null;
    }
}

function writeStorage(value: ApiCapabilities, now: number, scope: ApiScope): void {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(storageKeyFor(scope), JSON.stringify({ at: now, value }));
    } catch {
        /* storage unavailable */
    }
}

/** The cached answer if one is fresh, without probing. Null = nobody asked yet (or it expired). */
export function peekCapabilities(now: number = Date.now(), scope: ApiScope = 'admin'): ApiCapabilities | null {
    const m = memory[scope];
    if (m && now - m.at < m.ttl) return m.value;
    const stored = readStorage(now, scope);
    if (stored) {
        memory[scope] = { value: stored, at: now, ttl: CAPABILITIES_TTL_MS };
        return stored;
    }
    return null;
}

async function probe(scope: ApiScope): Promise<ApiCapabilities> {
    const now = Date.now();
    // Anonymous route; never let a 401 here bounce the page to /login. A device-scoped probe goes
    // through the device base URL (the same one registration/heartbeat use), an admin one through
    // the same-origin proxy.
    const res = await apiFetch<unknown>(CAPABILITIES_ENDPOINT, { skipAuthRedirect: true, timeoutMs: 8000, scope });
    if (res.success) {
        const parsed = parseCapabilities(res.data);
        if (parsed) {
            memory[scope] = { value: parsed, at: now, ttl: CAPABILITIES_TTL_MS };
            writeStorage(parsed, now, scope);
            return parsed;
        }
    }
    if (res.code === 404) {
        // The deployed 2.7.x API: a definite answer, cache it like a real one.
        memory[scope] = { value: LEGACY_CAPABILITIES, at: now, ttl: CAPABILITIES_TTL_MS };
        writeStorage(LEGACY_CAPABILITIES, now, scope);
        return LEGACY_CAPABILITIES;
    }
    memory[scope] = { value: LEGACY_CAPABILITIES, at: now, ttl: CAPABILITIES_FAILURE_TTL_MS };
    return LEGACY_CAPABILITIES;
}

/**
 * Capabilities of the API a call of this scope would reach; probes at most once per minute per tab
 * and scope. Admin pages use the default; the web player passes 'device' (round-4 #9).
 */
export async function getCapabilities(scope: ApiScope = 'admin'): Promise<ApiCapabilities> {
    if (typeof window === 'undefined') return LEGACY_CAPABILITIES;
    const cached = peekCapabilities(Date.now(), scope);
    if (cached) return cached;
    const running = inflight[scope];
    if (running) return running;
    const p = probe(scope).finally(() => { inflight[scope] = null; });
    inflight[scope] = p;
    return p;
}

/** Tests and "the API just got upgraded" flows: forget everything and probe again next time. */
export function resetCapabilitiesCache(): void {
    memory.admin = null;
    memory.device = null;
    inflight.admin = null;
    inflight.device = null;
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.removeItem(storageKeyFor('admin'));
        sessionStorage.removeItem(storageKeyFor('device'));
    } catch { /* noop */ }
}

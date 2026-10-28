import { getDeviceId, getConversationId } from './utils';
import { DEVICE_TOKEN_HEADER } from './device-token';

export interface ApiResponse<T = any> {
    success: boolean;
    code: number;
    message: string;
    data: T | null;
    errors: any[] | null;
}

/** Sent on every request; the API requires it on cookie-authenticated non-GET calls (CSRF guard). */
export const REQUESTED_WITH_HEADER = 'X-Requested-With';
export const REQUESTED_WITH_VALUE = 'SignageUnicorn';
/** Device-protocol version this player speaks (token claim endpoint, POLLING acks, eventId batches). */
export const CLIENT_PROTOCOL_HEADER = 'X-Client-Protocol';
export const CLIENT_PROTOCOL_VERSION = '2';
/**
 * Transitional only: an API older than 2.8 still answers login with a bearer token and sets no
 * session cookie. That token lives in sessionStorage (gone when the tab closes, never shared across
 * tabs) and is sent only while no cookie-capable API has replaced it. Remove once every API runs 2.8+.
 */
export const LEGACY_SESSION_KEY = 'su_legacy_token';

export interface ApiFetchInit extends RequestInit {
    /**
     * Marks a DEVICE-scoped call (web player). When present (even as null = "no token issued
     * yet"), the value is sent as X-Device-Token and a 401 never redirects the page to /login:
     * a kiosk must keep running and surface the rejection in its overlay instead.
     */
    deviceToken?: string | null;
    /** Skip the admin 401 -> /login redirect for this call. */
    skipAuthRedirect?: boolean;
    /**
     * Round-4 #9: a DEVICE-scoped call that carries no token yet (playlist/schedule/media/settings
     * reads from the web player). Same routing and 401 handling as `deviceToken`; the player must
     * never mix the admin (same-origin cookie) base URL with the device base URL.
     */
    scope?: ApiScope;
    /** Overall deadline covering connection, headers AND body; defaults to 30 s (10 min for uploads). */
    timeoutMs?: number;
}

/** Indirection so tests can observe the admin 401 redirect without jsdom navigation. */
export const authNavigation = {
    redirectToLogin(): void {
        if (typeof window === 'undefined') return;
        if (window.location.pathname !== '/login') {
            window.location.href = '/login';
        }
    },
};

export function getLegacySessionToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const value = sessionStorage.getItem(LEGACY_SESSION_KEY);
        return value && value.trim().length > 0 ? value : null;
    } catch {
        return null;
    }
}

export function setLegacySessionToken(token: string | null | undefined): void {
    if (typeof window === 'undefined') return;
    try {
        if (token && token.trim().length > 0) sessionStorage.setItem(LEGACY_SESSION_KEY, token);
        else sessionStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
        /* storage unavailable */
    }
}

/** localStorage key the pre-2.4 console used for its JWT; removed whenever a session starts or ends. */
export const LEGACY_LOCAL_TOKEN_KEY = 'accessToken';

/** Forget every transitional credential (tab-scoped bearer + the old localStorage JWT). */
export function clearLegacyCredentials(): void {
    setLegacySessionToken(null);
    if (typeof window === 'undefined') return;
    try { localStorage.removeItem(LEGACY_LOCAL_TOKEN_KEY); } catch { /* storage unavailable */ }
}

export type ApiScope = 'admin' | 'device';

let crossOriginWarned = false;

/**
 * Admin calls ride on the httpOnly session cookie, which only travels on the page's own origin. A
 * configured absolute API URL on another origin (API :8862 while the console is on :8865) would
 * silently lose the cookie, and with cookie-mode login there is no bearer fallback (Codex round-3
 * #17). So for admin calls such a value is ignored (one warning) and the same-origin proxy is
 * used; the proxy target is the server-side API_UPSTREAM. Device calls may still use it.
 */
export function getApiBaseUrl(scope: ApiScope = 'admin'): string {
    const configured = getConfiguredApiBaseUrl();
    if (scope === 'device' || typeof window === 'undefined') return configured;
    if (!/^https?:/i.test(configured)) return configured;
    let sameOrigin = false;
    try { sameOrigin = new URL(configured).origin === window.location.origin; } catch { sameOrigin = false; }
    if (sameOrigin) return configured;
    if (!crossOriginWarned) {
        crossOriginWarned = true;
        console.warn('[api] NEXT_PUBLIC_API_URL points at another origin; admin calls use the same-origin proxy /api/v1 so the session cookie works. Keep it at /api/v1 and set API_UPSTREAM server-side.');
    }
    return '/api/v1';
}

/** Raw configured base: NEXT_PUBLIC_API_URL > NEXT_PUBLIC_API_BASE_URL > the same-origin proxy path. */
export function getConfiguredApiBaseUrl(): string {
    // 1. Priority: Environment Variable from .env (as per docs/guides/installation-and-run.md)
    if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;

    // 2. Legacy/Fallback Variable
    if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL;

    // 3. Auto-detect Backend (Use Relative Path to leverage Next.js Proxy)
    if (typeof window !== 'undefined') {
        return '/api/v1';
    }

    // 4. Server-side / Default Fallback
    return 'http://localhost:8862/api/v1';
}

export async function apiFetch<T = any>(
    endpoint: string,
    options: ApiFetchInit = {},
    isUpload: boolean = false
): Promise<ApiResponse<T>> {
    const { deviceToken, skipAuthRedirect, timeoutMs, scope, ...init } = options;
    const isDeviceCall = deviceToken !== undefined || scope === 'device';

    const baseUrl = getApiBaseUrl(isDeviceCall ? 'device' : 'admin');
    // Ensure URL doesn't end with slash and endpoint doesn't allow double slash
    const cleanBase = baseUrl.replace(/\/$/, '');
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${cleanBase}${cleanEndpoint}`;

    const headers = new Headers(init.headers);

    // Only set application/json if we are not sending FormData
    // When sending FormData, the browser must set the Content-Type with boundary
    if (!(init.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
    }

    headers.set('x-conversation-id', getConversationId());
    headers.set('x-device-id', getDeviceId());
    headers.set(REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE);

    if (isDeviceCall) {
        headers.set(CLIENT_PROTOCOL_HEADER, CLIENT_PROTOCOL_VERSION);
        if (deviceToken) headers.set(DEVICE_TOKEN_HEADER, deviceToken);
    } else {
        // Admin session: the httpOnly `su_session` cookie travels by itself (credentials below).
        // Only an old API that handed us a bearer token at login gets it back, from sessionStorage.
        const legacy = getLegacySessionToken();
        if (legacy) headers.set('Authorization', `Bearer ${legacy}`);
    }

    const controller = new AbortController();
    const deadline = timeoutMs ?? (isUpload ? 10 * 60 * 1000 : 30000); // 10 min for uploads, 30 s otherwise
    const timeoutId = setTimeout(() => controller.abort(), deadline);
    let timedOut = false;
    controller.signal.addEventListener('abort', () => { timedOut = true; });

    try {
        let response: Response;
        let text: string;
        try {
            response = await fetch(url, {
                ...init,
                headers,
                cache: 'no-store',
                credentials: init.credentials ?? 'same-origin',
                signal: controller.signal,
            });
            // The deadline stays armed until the body has been read: a server that sends headers and
            // then stalls the body used to hold heartbeats and uploads forever (Codex round-2 #20).
            text = await response.text();
        } finally {
            clearTimeout(timeoutId);
        }

        let result: ApiResponse<T>;
        try {
            result = JSON.parse(text);
        } catch {
            console.error('API_PARSE_ERROR', text);
            return {
                success: false,
                code: response.status,
                message: `Server Error (${response.status}): ${text.substring(0, 200)}`,
                data: null,
                errors: null
            };
        }

        // A non-2xx body that still parsed as JSON must never look like success, and callers need
        // the real HTTP status to choose between "drop" (4xx) and "retry later" (5xx).
        if (!response.ok) {
            result = {
                ...result,
                success: false,
                code: result && typeof result.code === 'number' && result.code !== 0 ? result.code : response.status,
            };
        }

        if (response.status === 401 && !isDeviceCall && !skipAuthRedirect) {
            // The session is gone (expired cookie, revoked token version, logged out elsewhere).
            clearLegacyCredentials();
            if (typeof window !== 'undefined') {
                try { localStorage.removeItem('user'); } catch { /* noop */ }
            }
            authNavigation.redirectToLogin();
        }

        return result;
    } catch (error) {
        if (timedOut) {
            console.error('API_TIMEOUT:', url);
            return {
                success: false,
                code: -1,
                message: `Request timed out after ${Math.round(deadline / 1000)}s.`,
                data: null,
                errors: null,
            };
        }
        console.error('API_FETCH_ERROR:', error);
        return {
            success: false,
            code: -1,
            message: 'Network Error or Server Unreachable.',
            data: null,
            errors: null,
        };
    }
}

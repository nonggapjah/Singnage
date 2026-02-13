import { getDeviceId, getConversationId } from './utils';

export interface ApiResponse<T = any> {
    success: boolean;
    code: number;
    message: string;
    data: T | null;
    errors: any[] | null;
}

export async function apiFetch<T = any>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    const getBaseUrl = () => {
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
    };

    const baseUrl = getBaseUrl();
    // Ensure URL doesn't end with slash and endpoint doesn't allow double slash
    const cleanBase = baseUrl.replace(/\/$/, '');
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${cleanBase}${cleanEndpoint}`;

    const headers = new Headers(options.headers);

    // Only set application/json if we are not sending FormData
    // When sending FormData, the browser must set the Content-Type with boundary
    if (!(options.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
    }

    headers.set('x-conversation-id', getConversationId());
    headers.set('x-device-id', getDeviceId());

    // Get token from localStorage (simplified for now)
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers,
            cache: 'no-store',
        });

        const text = await response.text();
        let result: ApiResponse<T>;

        try {
            result = JSON.parse(text);
        } catch (e) {
            console.error('API_PARSE_ERROR', text);
            return {
                success: false,
                code: response.status,
                message: `Server Error (${response.status}): ${text.substring(0, 200)}`,
                data: null,
                errors: null
            };
        }

        if (response.status === 401) {
            if (typeof window !== 'undefined') {
                localStorage.removeItem('accessToken');
                if (window.location.pathname !== '/login') {
                    window.location.href = '/login';
                }
            }
        }

        return result;
    } catch (error) {
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

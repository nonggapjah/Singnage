import { apiFetch, ApiResponse } from '@/lib/api-fetch';
import { LoginResponse } from '../types';

export const authApi = {
    /**
     * Returns the API response unchanged. On an API of 2.8+ the session is established by the
     * httpOnly `su_session` cookie set on this response; pass `res.data` to `AuthContext.login`.
     */
    login: async (username: string, password: string, identifierType?: string): Promise<ApiResponse<LoginResponse>> => {
        return apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password, identifierType }),
            skipAuthRedirect: true,
        });
    },

    /** Clears the server-side session cookie. Best effort: an old API answers 404 and that is fine. */
    logout: async (): Promise<ApiResponse<unknown>> => {
        return apiFetch('/auth/logout', {
            method: 'POST',
            skipAuthRedirect: true,
            timeoutMs: 5000,
        });
    },

    register: async (data: Record<string, unknown>): Promise<ApiResponse<unknown>> => {
        return apiFetch('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    // `autoAdminLogin` (POST /auth/local-auto-admin) was removed: the endpoint handed out an
    // administrator JWT to anyone who could reach the API (Codex F01).
};

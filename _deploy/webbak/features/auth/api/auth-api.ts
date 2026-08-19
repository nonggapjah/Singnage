import { apiFetch, ApiResponse } from '@/lib/api-fetch';
import { LoginResponse } from '../types';

export const authApi = {
    login: async (username: string, password: string, identifierType?: string): Promise<ApiResponse<LoginResponse>> => {
        return apiFetch('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password, identifierType }),
        });
    },

    register: async (data: any): Promise<ApiResponse<any>> => {
        return apiFetch('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    // Shortcut for auto-admin login on local
    autoAdminLogin: async (): Promise<ApiResponse<LoginResponse>> => {
        return apiFetch('/auth/local-auto-admin', {
            method: 'POST',
            body: JSON.stringify({}),
        });
    }
};

import { apiFetch, ApiResponse } from '@/lib/api-fetch';

export interface User {
    userId: string;
    username: string;
    fullName: string;
    role: string;
    active: string;
}

export interface UserUpdateData {
    fullName?: string;
    role?: string;
    active?: string;
}

export interface CreateUserData {
    username: string;
    password?: string;
    fullName: string;
    role: string;
}

export const userApi = {
    getAll: async (): Promise<ApiResponse<User[]>> => {
        return apiFetch('/users');
    },

    create: async (data: CreateUserData): Promise<ApiResponse<boolean>> => {
        return apiFetch('/users', {
            method: 'POST',
            body: JSON.stringify({
                ...data,
                password: data.password || '123456' // Default password if not provided
            }),
        });
    },

    update: async (id: string, data: UserUpdateData): Promise<ApiResponse<boolean>> => {
        return apiFetch(`/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    delete: async (id: string): Promise<ApiResponse<boolean>> => {
        return apiFetch(`/users/${id}`, {
            method: 'DELETE',
        });
    },

    changePassword: async (oldPassword: string, newPassword: string): Promise<ApiResponse<boolean>> => {
        return apiFetch('/users/change-password', {
            method: 'POST',
            body: JSON.stringify({ oldPassword, newPassword }),
        });
    }
};

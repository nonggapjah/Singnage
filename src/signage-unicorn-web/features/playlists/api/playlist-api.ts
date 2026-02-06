import { apiFetch, ApiResponse } from '@/lib/api-fetch';
import { Playlist } from '../types/playlist';

export const playlistApi = {
    getAll: async (onlyActive: boolean = false, searchTerm?: string): Promise<ApiResponse<Playlist[]>> => {
        const params = new URLSearchParams();
        if (onlyActive) params.append('onlyActive', 'true');
        if (searchTerm) params.append('searchTerm', searchTerm);
        const qs = params.toString();
        return apiFetch(`/playlists${qs ? `?${qs}` : ''}`);
    },

    getActive: async (): Promise<ApiResponse<Playlist[]>> => {
        return apiFetch('/playlists/active');
    },

    getById: async (id: string): Promise<ApiResponse<Playlist>> => {
        const res = await apiFetch<Playlist>(`/playlists/${id}`);
        if (res.success && res.data) {
            const apiItems = res.data.items || [];
            const mappedItems = apiItems.map((item: any) => ({
                ...item,
                media: {
                    mediaId: item.mediaId,
                    fileName: item.fileName,
                    displayName: item.displayName || item.fileName,
                    blobUrl: item.blobUrl,
                    durationSec: item.originalDuration || 0,
                    ratio: item.ratio,
                    fileSizeKb: item.fileSizeKB || 0,
                    uploadedAt: '',
                    active: 'Y'
                }
            }));

            return {
                ...res,
                data: {
                    ...res.data,
                    items: mappedItems
                }
            };
        }
        return res;
    },

    create: async (data: Partial<Playlist>): Promise<ApiResponse<Playlist>> => {
        return apiFetch('/playlists', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    update: async (id: string, data: Partial<Playlist>): Promise<ApiResponse<Playlist>> => {
        return apiFetch(`/playlists/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    delete: async (id: string): Promise<ApiResponse<any>> => {
        return apiFetch(`/playlists/${id}`, {
            method: 'DELETE',
        });
    }
};

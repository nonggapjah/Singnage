import { apiFetch, ApiResponse, type ApiFetchInit } from '@/lib/api-fetch';
import { Playlist, PlaylistItem } from '../types/playlist';

/**
 * The API returns playlist items flat (fileName/blobUrl/originalDuration on the item). The player
 * and editor expect a nested `media` object. Shared by getById and the device schedule endpoint.
 */
export function mapPlaylistItems(apiItems: any[]): PlaylistItem[] {
    return (apiItems || []).map((item: any) => ({
        ...item,
        media: {
            mediaId: item.mediaId,
            fileName: item.fileName,
            displayName: item.displayName || item.fileName,
            blobUrl: item.blobUrl,
            durationSec: item.originalDuration || 0,
            ratio: item.ratio,
            fileSizeKb: item.fileSizeKB || 0,
            fileHash: item.fileHash || item.file_hash || undefined,
            uploadedAt: '',
            active: 'Y'
        }
    }));
}

export const playlistApi = {
    getAll: async (onlyActive: boolean = false, searchTerm?: string): Promise<ApiResponse<Playlist[]>> => {
        const params = new URLSearchParams();
        if (onlyActive) params.append('onlyActive', 'true');
        if (searchTerm) params.append('searchTerm', searchTerm);
        const qs = params.toString();
        return apiFetch(`/playlists${qs ? `?${qs}` : ''}`);
    },

    getActive: async (init?: ApiFetchInit): Promise<ApiResponse<Playlist[]>> => {
        // init lets the web player pass { scope: 'device' } (and a token) so the list loads from the
        // DEVICE API base URL, not the same-origin admin API, when the two are configured separately.
        return apiFetch('/playlists/active', init);
    },

    /** `init` lets the web player pass `{ scope: 'device', deviceToken }` so the call uses the device base URL (round-4 #9). */
    getById: async (id: string, init?: ApiFetchInit): Promise<ApiResponse<Playlist>> => {
        const res = await apiFetch<Playlist>(`/playlists/${id}`, init);
        if (res.success && res.data) {
            return {
                ...res,
                data: {
                    ...res.data,
                    items: mapPlaylistItems(res.data.items || [])
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

import { apiFetch } from '@/lib/api-fetch';
import { MediaFile as Media, Playlist, PlaylistItem } from '../types/playlist';

export const mediaService = {
    getAll: () => apiFetch<Media[]>('/media'),
    getById: (id: string) => apiFetch<Media>(`/media/${id}`),
    create: (data: Partial<Media>) => apiFetch<Media>('/media', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    delete: (id: string) => apiFetch<boolean>(`/media/${id}`, { method: 'DELETE' }),
};

export const playlistService = {
    getAll: () => apiFetch<Playlist[]>('/playlists'),
    getById: (id: string) => apiFetch<Playlist>(`/playlists/${id}`),
    create: (data: Partial<Playlist>) => apiFetch<Playlist>('/playlists', {
        method: 'POST',
        body: JSON.stringify(data),
    }),
    update: (id: string, data: Partial<Playlist>) => apiFetch<boolean>(`/playlists/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
    }),
    addItem: (playlistId: string, item: Partial<PlaylistItem>) => apiFetch<boolean>(`/playlists/${playlistId}/items`, {
        method: 'POST',
        body: JSON.stringify(item),
    }),
    removeItem: (itemId: string) => apiFetch<boolean>(`/playlists/items/${itemId}`, { method: 'DELETE' }),
    reorderItem: (itemId: string, newPosition: number) => apiFetch<boolean>(`/playlists/items/${itemId}/reorder`, {
        method: 'PATCH',
        body: JSON.stringify(newPosition),
    }),
};

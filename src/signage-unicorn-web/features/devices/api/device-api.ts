import { apiFetch } from '@/lib/api-fetch';
import { Device, DeviceCommand } from '../types';

export const deviceApi = {
    getAll: async () => {
        return await apiFetch<Device[]>('/devices');
    },

    register: async (data: { deviceKey: string; deviceName: string; branchCode: string; location?: string; ipAddress?: string }) => {
        return await apiFetch<Device>('/devices/register', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    sendCommand: async (deviceId: string, command: string) => {
        return await apiFetch<{ success: boolean }>(`/devices/${deviceId}/command`, {
            method: 'POST',
            body: JSON.stringify({ command }),
        });
    },

    batchSendCommand: async (deviceIds: string[], command: string) => {
        return await apiFetch<{ success: boolean }>(`/devices/batch-command`, {
            method: 'POST',
            body: JSON.stringify({ deviceIds, command }),
        });
    },

    deleteDevice: async (id: string) => {
        return await apiFetch<{ success: boolean }>(`/devices/${id}`, {
            method: 'DELETE',
        });
    },

    cleanupOffline: async () => {
        return await apiFetch<{ success: boolean }>('/devices/cleanup-offline', {
            method: 'POST',
        });
    },

    heartbeat: async (data: {
        deviceId: string;
        deviceName?: string;
        branchCode?: string;
        location?: string;
        status: string;
        currentPlaylistId?: string;
        currentPlaylistItemId?: string;
        currentMediaId?: string;
        currentPositionSec?: number;
        cacheProgress?: number;
        // Boot Report fields (sent once on startup)
        appVersion?: string;
        ratio?: string;
    }) => {
        return await apiFetch<DeviceCommand[]>('/devices/heartbeat', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    fixDb: async () => {
        return await apiFetch('/devices/fix-devices-db');
    },

    getAssignedPlaylists: async (deviceId: string) => {
        return await apiFetch<any[]>(`/devices/${deviceId}/playlists`, { method: 'GET' });
    },

    updateAssignedPlaylists: async (deviceId: string, playlists: { playlistId: string; startDate?: string; endDate?: string }[]) => {
        return await apiFetch<{ success: boolean }>(`/devices/${deviceId}/playlists`, {
            method: 'POST',
            body: JSON.stringify(playlists),
        });
    },

    batchAddSchedule: async (deviceIds: string[], playlistId: string, startDate?: string, endDate?: string) => {
        return await apiFetch<{ success: boolean }>('/devices/batch-add-playlist', {
            method: 'POST',
            body: JSON.stringify({ deviceIds, playlistId, startDate, endDate }),
        });
    }
};

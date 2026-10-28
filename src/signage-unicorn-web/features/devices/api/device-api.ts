import { apiFetch, getApiBaseUrl, getLegacySessionToken, REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '@/lib/api-fetch';
import { getDeviceToken } from '@/lib/device-token';
import { getCapabilities } from '@/lib/api-capabilities';
import { mapPlaylistItems } from '@/features/playlists/api/playlist-api';
import { Playlist } from '@/features/playlists/types/playlist';
import { Device, DeviceCommand, DeviceRegisterResponse, DeviceTokenClaimResponse, CommandAckStatus } from '../types';

export const deviceApi = {
    getAll: async () => {
        return await apiFetch<Device[]>('/devices');
    },

    /**
     * Idempotent for a known deviceKey (REGISTER_OR_LOGIN). The response carries `deviceToken`
     * only when the request declared `tokenCapable: true` (contract T1) and the server issued or
     * rotated one. Only the registration screen sets that flag; the boot-time claim never
     * registers (it would create a duplicate row for a drifted identity).
     */
    register: async (data: { deviceKey: string; deviceName: string; branchCode: string; location?: string; ipAddress?: string; appVersion?: string; tokenCapable?: boolean }) => {
        return await apiFetch<DeviceRegisterResponse>('/devices/register', {
            method: 'POST',
            body: JSON.stringify(data),
            deviceToken: getDeviceToken(),
        });
    },

    /**
     * Contract T2: a screen registered before tokens existed asks for one WITHOUT re-registering.
     * The server resolves the stored device id and checks the evidence (device key); it never
     * creates a row. 404 = old API (no such endpoint), 403 CLAIM_EVIDENCE_MISMATCH, 409
     * TOKEN_ALREADY_ISSUED are reported to the caller, which keeps running either way.
     */
    claimToken: async (deviceId: string, deviceKey: string, appVersion: string) => {
        return await apiFetch<DeviceTokenClaimResponse>(`/devices/${encodeURIComponent(deviceId)}/token/claim`, {
            method: 'POST',
            body: JSON.stringify({ deviceKey, appVersion }),
            deviceToken: getDeviceToken(),
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
            body: JSON.stringify(data),
            deviceToken: getDeviceToken(),
        });
    },

    /** Player: report the outcome of a delivered command (ack-before-execute for restart-type commands). */
    ackCommand: async (deviceId: string, commandId: string, status: CommandAckStatus, message?: string) => {
        return await apiFetch<unknown>(`/devices/${encodeURIComponent(deviceId)}/command/ack`, {
            method: 'POST',
            body: JSON.stringify({ commandId, status, message }),
            deviceToken: getDeviceToken(),
        });
    },

    /** Player: the schedule resolved server-side for this device, in the same shape as a playlist. */
    getSchedule: async (deviceId: string) => {
        const res = await apiFetch<Playlist>(`/devices/${encodeURIComponent(deviceId)}/schedule`, {
            deviceToken: getDeviceToken(),
        });
        if (res.success && res.data) {
            return { ...res, data: { ...res.data, items: mapPlaylistItems(res.data.items || []) } };
        }
        return res;
    },

    /** Admin: mutating, so POST (cookie sessions need the CSRF header on unsafe methods), contract R5. */
    /**
     * Re-apply schema. API 2.8 exposes it as POST (a mutating call must not be a GET: CSRF, round-3
     * #13) and answers 405 to the old GET; the deployed 2.7.x API only knows the GET. Pick by
     * capabilities and, should the probe have guessed wrong (transient failure = assumed legacy),
     * retry once with the other verb on a 405 (round-4 #6).
     */
    fixDb: async () => {
        const caps = await getCapabilities();
        const first: 'GET' | 'POST' = caps.legacy ? 'GET' : 'POST';
        const res = await apiFetch('/devices/fix-devices-db', { method: first });
        if (res.code !== 405) return res;
        const other: 'GET' | 'POST' = first === 'GET' ? 'POST' : 'GET';
        return await apiFetch('/devices/fix-devices-db', { method: other });
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
    },

    batchClearSchedule: async (deviceIds: string[], playlistIds?: string[]) => {
        return await apiFetch<{ success: boolean }>('/devices/batch-clear-schedule', {
            method: 'POST',
            body: JSON.stringify({ deviceIds, playlistIds }),
        });
    },

    /**
     * Admin: load the latest screenshot of a device through the authenticated API
     * (GET /api/v1/devices/{id}/screenshot). Screenshots are no longer served as public static
     * files. Returns an object URL the caller must revoke with URL.revokeObjectURL, or null when
     * the device has no screenshot yet. The session cookie authenticates the request; an old API
     * gets the transitional bearer token instead.
     */
    fetchScreenshot: async (deviceId: string): Promise<string | null> => {
        if (typeof window === 'undefined') return null;
        const base = getApiBaseUrl('admin').replace(/\/$/, '');
        const load = async (url: string, authenticated: boolean): Promise<string | null> => {
            const headers = new Headers();
            headers.set(REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE);
            if (authenticated) {
                const legacy = getLegacySessionToken();
                if (legacy) headers.set('Authorization', `Bearer ${legacy}`);
            }
            const res = await fetch(url, { headers, cache: 'no-store', credentials: 'same-origin' });
            if (!res.ok) return null;
            const blob = await res.blob();
            return blob.size > 0 ? URL.createObjectURL(blob) : null;
        };
        try {
            // Mixed-version rollout (Codex round-3 #19): the 2.7.x API has no screenshot route and
            // still serves /screenshots/<id>.jpg as a static file at the API root (proxied by Next).
            const caps = await getCapabilities();
            if (caps.screenshotRoute) {
                return await load(`${base}/devices/${encodeURIComponent(deviceId)}/screenshot`, true);
            }
            const root = base.replace(/\/api\/v1$/, '');
            return await load(`${root}/screenshots/${encodeURIComponent(deviceId)}.jpg?t=${Date.now()}`, false);
        } catch {
            return null;
        }
    },

    /** Admin: reset a device's schedule mode to 'inherit' so it may follow a sibling screen again. */
    resetScheduleToInherit: async (deviceId: string) => {
        return await apiFetch<{ success: boolean }>(`/devices/${encodeURIComponent(deviceId)}/schedule/inherit`, {
            method: 'POST',
        });
    },

    /**
     * Admin: clear the device token on the server so the screen can claim a new one (its next
     * token-rejected heartbeat triggers a claim, at most once per 10 minutes). Use after a
     * reinstall or when a screen shows "DEVICE TOKEN REJECTED".
     */
    resetDeviceToken: async (deviceId: string) => {
        return await apiFetch<{ success: boolean }>(`/devices/${encodeURIComponent(deviceId)}/reset-token`, {
            method: 'POST',
        });
    }
};

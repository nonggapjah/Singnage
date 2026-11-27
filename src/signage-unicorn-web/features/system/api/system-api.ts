import { apiFetch, type ApiFetchInit, type ApiResponse } from '@/lib/api-fetch';

/** One media row as the integrity checker sees it (GET /system/media-integrity). */
export interface MediaIntegrityItem {
    mediaId: number;
    mediaUuid: string;
    displayName?: string | null;
    storedName?: string | null;
    status: 'ok' | 'unknown' | 'mismatch' | 'missing' | 'loop-suspect' | string;
    note?: string | null;
    checkedUtc?: string | null;
    downloadsLastHour: number;
}

export interface MediaIntegrityReport {
    lastRunUtc?: string | null;
    lastRunSummary?: string | null;
    quarantined: number;
    items: MediaIntegrityItem[];
}

export const systemApi = {
    /** `init` lets the web player pass `{ scope: 'device', deviceToken }` (round-4 #9). */
    getSetting: async (key: string, init?: ApiFetchInit) => {
        return apiFetch(`/system/settings/${key}`, init);
    },
    setSetting: async (key: string, value: string) => {
        return apiFetch('/system/settings', {
            method: 'POST',
            body: JSON.stringify({ key, value })
        });
    },
    syncMedia: async () => {
        return apiFetch('/server/sync-media', {
            method: 'POST'
        });
    },

    /** Media integrity (API 2.8.15): files held back from the screens; `all` lists every row. */
    mediaIntegrity: async (all = false): Promise<ApiResponse<MediaIntegrityReport>> => {
        return apiFetch(`/system/media-integrity${all ? '?all=true' : ''}`);
    },
    mediaIntegrityRun: async (): Promise<ApiResponse<{ ok: number; quarantined: number }>> => {
        return apiFetch('/system/media-integrity/run', { method: 'POST' });
    },
    mediaIntegrityAcceptDisk: async (mediaId: string): Promise<ApiResponse<null>> => {
        return apiFetch(`/system/media-integrity/${encodeURIComponent(mediaId)}/accept-disk`, { method: 'POST' });
    },
};

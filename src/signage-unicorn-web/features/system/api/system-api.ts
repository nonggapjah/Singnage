import { apiFetch, type ApiFetchInit } from '@/lib/api-fetch';

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
    }
};

import { apiFetch } from '@/lib/api-fetch';

export const systemApi = {
    getSetting: async (key: string) => {
        return apiFetch(`/system/settings/${key}`);
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

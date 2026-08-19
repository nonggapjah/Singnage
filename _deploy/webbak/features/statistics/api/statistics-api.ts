import { apiFetch } from '@/lib/api-fetch';
import { PlaybackSummary, BranchSummary, PlaybackLogExport } from '../types';

export const statisticsApi = {
    getMediaSummary: async (start?: string, end?: string) => {
        const query = new URLSearchParams();
        if (start) query.append('start', start);
        if (end) query.append('end', end);
        return await apiFetch<PlaybackSummary[]>(`/logs/playback/summary?${query.toString()}`);
    },
    getBranchSummary: async (start?: string, end?: string) => {
        const query = new URLSearchParams();
        if (start) query.append('start', start);
        if (end) query.append('end', end);
        return await apiFetch<BranchSummary[]>(`/logs/playback/summary/branch?${query.toString()}`);
    },
    getExportData: async (start?: string, end?: string) => {
        const query = new URLSearchParams();
        if (start) query.append('start', start);
        if (end) query.append('end', end);
        return await apiFetch<PlaybackLogExport[]>(`/logs/playback/export?${query.toString()}`);
    }
};

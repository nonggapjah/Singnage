import { apiFetch, ApiResponse } from '@/lib/api-fetch';

/** One branch of a rollout (GET /rollouts). */
export interface RolloutWave {
    waveNo: number;
    branchCode: string;
    devices: number;
    applied: number;
    failed: number;
    notBeforeUtc: string;
    started: boolean;
    done: boolean;
}

/** A branch-by-branch playlist rollout (API 2.8.14). */
export interface Rollout {
    rolloutId: number;
    playlistId: string;
    playlistName?: string | null;
    status: 'active' | 'paused' | 'done' | 'cancelled';
    waveMinutes: number;
    holdNote?: string | null;
    createdUtc: string;
    updatedUtc: string;
    totalDevices: number;
    appliedDevices: number;
    failedDevices: number;
    waveCount: number;
    wavesDone: number;
    nextWaveUtc?: string | null;
    nextBranch?: string | null;
    waves: RolloutWave[];
}

/** What POST /devices/batch-add-playlist answers when it started a rollout instead of assigning everything. */
export interface RolloutStartResult {
    rolloutId: number;
    waves: number;
    totalDevices: number;
    waveMinutes: number;
    firstBranch: string;
    firstWaveDevices: number;
    firstWaveApplied: number;
    firstWaveFailed: number;
    lastWaveUtc: string;
    /** Selected ids that matched no live screen (deleted meanwhile); they are not part of the rollout. */
    unknownDevices: string[];
}

export const rolloutApi = {
    /** Active and paused rollouts plus those finished in the last 24 h; optionally for one playlist. */
    list: async (playlistId?: string): Promise<ApiResponse<Rollout[]>> => {
        const qs = playlistId ? `?playlistId=${encodeURIComponent(playlistId)}` : '';
        return apiFetch(`/rollouts${qs}`);
    },
    pause: async (id: number): Promise<ApiResponse<null>> => apiFetch(`/rollouts/${id}/pause`, { method: 'POST' }),
    resume: async (id: number): Promise<ApiResponse<null>> => apiFetch(`/rollouts/${id}/resume`, { method: 'POST' }),
    cancel: async (id: number): Promise<ApiResponse<null>> => apiFetch(`/rollouts/${id}/cancel`, { method: 'POST' }),
};

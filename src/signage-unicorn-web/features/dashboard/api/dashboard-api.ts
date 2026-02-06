import { apiFetch } from "@/lib/api-fetch";

export interface DashboardStats {
    totalDevices: number;
    onlineDevices: number;
    offlineDevices: number;
    totalMedia: number;
    totalPlaylists: number;
    averageLatencyMs: number;
    dynamicTxSpeedMbps: number;
    systemVersion: string;
    topMedia: any[];
    recentAlerts: any[];
}

export const dashboardApi = {
    getStats: () => apiFetch<DashboardStats>('/dashboard/stats')
};

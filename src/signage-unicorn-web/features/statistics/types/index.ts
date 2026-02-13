export interface PlaybackSummary {
    displayName: string;
    fileName: string;
    playCount: number;
    totalDurationSec: number;
    lastPlayed: string;
}

export interface BranchSummary {
    branchCode: string;
    playCount: number;
    deviceCount: number;
}

export interface PlaybackLogExport {
    playedAt: string;
    deviceId?: string;
    deviceName?: string;
    branchCode?: string;
    supplierCode?: string;
    mediaName?: string;
    fileName?: string;
    playlistId?: string;
    mediaId?: string;
    durationSec: number;
    result: string;
}

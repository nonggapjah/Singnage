export interface MediaFile {
    mediaId: string;
    fileName: string;
    displayName: string;
    blobUrl: string;
    durationSec: number;
    ratio: string;
    fileSizeKb: number;
    supplier_Code?: string;
    remark1?: string;
    remark2?: string;
    uploadedBy: string;
    uploadedAt?: string;
    endDate?: string;
    /** MD5 of the stored bytes, set by the API on upload/transcode. Part of the player's change detection. */
    fileHash?: string;
    active: 'Y' | 'N';
}

export interface MediaUploadRequest {
    fileName: string;
    displayName?: string;
    blobUrl: string;
    durationSec: number;
    ratio: string;
    fileSizeKb: number;
    supplier_Code?: string;
    remark1?: string;
    remark2?: string;
    endDate?: string;
}

export interface MediaUsage {
    playlistId: string;
    playlistName: string;
    active: string;
    usageCount: number;
    durationSec?: number;
    deviceCount?: number;
}

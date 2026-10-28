export interface Device {
    deviceId: string;
    deviceUuid?: string;
    deviceName: string;
    deviceKey: string;
    branchCode: string;
    ipAddress: string;
    status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'PLAYING' | 'IDLE' | 'ANOMALY';
    currentPlaylistId?: string;
    currentPlaylistItemId?: string;
    currentMediaId?: string;
    currentPositionSec?: number;
    appVersion?: string;
    lastCheckIn?: string;
    active: string;
    /** 'inherit' = no explicit assignment, may inherit a sibling's schedule; 'explicit' = admin assigned or cleared. */
    scheduleMode?: 'inherit' | 'explicit';
    /** True once the server holds a device token for this screen (never the token itself). */
    hasDeviceToken?: boolean;
    /** When the current token was issued (UTC ISO), if any. */
    deviceTokenIssuedAt?: string;
    /** Device-protocol version the screen last reported (X-Client-Protocol); undefined/1 = legacy client. */
    clientProtocol?: number;
    /** Set by an admin token reset; cleared once the screen claims a new token (server sends RECLAIM_TOKEN). */
    tokenResetPending?: boolean;
}

/** Register response: the device plus, when the server issued or rotated one, its secret token. */
export interface DeviceRegisterResponse extends Device {
    deviceToken?: string;
}

/** Result of POST /devices/{id}/token/claim (new API only). */
export interface DeviceTokenClaimResponse {
    deviceId: string;
    deviceUuid?: string;
    deviceToken?: string;
}

export type CommandAckStatus = 'EXECUTED' | 'FAILED';

/** Result of POST /logs/playback/batch on the new API; `accepted` is absent on the old one. */
export interface PlaybackBatchResult {
    accepted?: string[];
    rejected?: { eventId?: string; reason?: string }[];
    acceptedCount?: number;
    rejectedCount?: number;
}

/** Result of POST /logs/batch on the new API (INFO entries are acknowledged but not stored). */
export interface SystemLogBatchResult {
    stored?: number;
    dropped?: number;
}

export interface DeviceCommand {
    commandId: string;
    /** Command UUID the player must send back when acknowledging. */
    deviceCommandId?: string;
    deviceId: string;
    /** Raw command string from the server, e.g. 'SYNC_SCHEDULE', 'PLAY_PLAYLIST:<id>', 'RESTART:<mediaId>:<sec>'. */
    commandType: string;
    payload?: string;
    status: 'PENDING' | 'POLLING' | 'EXECUTED' | 'FAILED' | 'EXPIRED';
    createdAt: string;
}

export interface DeviceStats {
    total: number;
    online: number;
    offline: number;
    playing: number;
}

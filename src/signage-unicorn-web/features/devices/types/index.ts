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
}

export interface DeviceCommand {
    commandId: string;
    deviceId: string;
    commandType: 'RESTART' | 'REFRESH' | 'UPDATE_PLAYLIST' | 'SCREENSHOT';
    status: 'PENDING' | 'EXECUTED';
    createdAt: string;
}

export interface DeviceStats {
    total: number;
    online: number;
    offline: number;
    playing: number;
}

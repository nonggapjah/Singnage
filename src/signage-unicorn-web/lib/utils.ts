// Fallback for non-secure contexts where crypto.randomUUID is not available
export function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function getDeviceId(): string {
    if (typeof window === 'undefined') return '';
    let deviceId = localStorage.getItem('x-device-id');
    if (!deviceId) {
        deviceId = generateId();
        localStorage.setItem('x-device-id', deviceId);
    }
    return deviceId || '';
}

export function getConversationId(): string {
    return generateId();
}

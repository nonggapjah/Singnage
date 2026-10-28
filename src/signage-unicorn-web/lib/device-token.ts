/**
 * Device token storage for the web player.
 *
 * The API issues a per-device secret on registration (`deviceToken` in the register response).
 * The player stores it here and sends it as the `X-Device-Token` header on every device-scoped
 * call (heartbeat, command ack, log uploads). The server validates it when the device has one
 * issued (Security:DeviceAuth = IfIssued) or always (Required). The token is never cleared
 * automatically: a rejected token is an operator problem (reset it on the server), not something
 * the kiosk should silently paper over by re-registering as a new identity.
 */
export const DEVICE_TOKEN_KEY = 'signage_device_token';
export const DEVICE_TOKEN_HEADER = 'X-Device-Token';
export const DEVICE_TOKEN_INVALID = 'DEVICE_TOKEN_INVALID';

export function getDeviceToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const value = localStorage.getItem(DEVICE_TOKEN_KEY);
        return value && value.trim().length > 0 ? value : null;
    } catch {
        return null;
    }
}

export function setDeviceToken(token: string | null | undefined): void {
    if (typeof window === 'undefined') return;
    try {
        if (token && token.trim().length > 0) localStorage.setItem(DEVICE_TOKEN_KEY, token);
        else localStorage.removeItem(DEVICE_TOKEN_KEY);
    } catch {
        /* storage unavailable (private mode / quota): the next register will try again */
    }
}

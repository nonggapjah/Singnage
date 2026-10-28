import { describe, it, expect, beforeEach } from 'vitest';
import { getDeviceToken, setDeviceToken, DEVICE_TOKEN_KEY } from './device-token';

describe('device token storage', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips a token through localStorage', () => {
        expect(getDeviceToken()).toBeNull();
        setDeviceToken('tok_123');
        expect(getDeviceToken()).toBe('tok_123');
        expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBe('tok_123');
    });

    it('treats blank values as "no token" and removes the key', () => {
        setDeviceToken('tok_123');
        setDeviceToken('   ');
        expect(getDeviceToken()).toBeNull();
        expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();
        setDeviceToken('tok_456');
        setDeviceToken(null);
        expect(getDeviceToken()).toBeNull();
    });
});

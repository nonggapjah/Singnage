import { describe, it, expect } from 'vitest';
import { localInputToApiFilter, expiryDateForApi, localDateEndToUtcIso, parseApiDate } from './datetime';

describe('date filters across API versions (Codex round-3 #18)', () => {
    it('2.8+ API: local input becomes an ISO "Z" instant', () => {
        const sent = localInputToApiFilter('2026-10-27T08:30:00', true);
        expect(sent.endsWith('Z')).toBe(true);
        expect(sent).toBe(new Date('2026-10-27T08:30:00').toISOString());
    });

    it('2.7.x API: the bare local string is sent unchanged', () => {
        expect(localInputToApiFilter('2026-10-27T08:30:00', false)).toBe('2026-10-27T08:30:00');
    });

    it('empty input yields an empty filter', () => {
        expect(localInputToApiFilter('', true)).toBe('');
        expect(localInputToApiFilter(undefined, false)).toBe('');
    });

    it('media expiry: end of local day on 2.8+, UTC midnight of the date on 2.7.x', () => {
        expect(expiryDateForApi('2026-10-27', true)).toBe(localDateEndToUtcIso('2026-10-27'));
        expect(expiryDateForApi('2026-10-27', false)).toBe('2026-10-27T00:00:00.000Z');
        expect(expiryDateForApi('', true)).toBeUndefined();
        expect(expiryDateForApi('nope', false)).toBeUndefined();
    });

    it('parseApiDate treats offset-less API values as UTC', () => {
        expect(parseApiDate('2026-01-01T00:00:00')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(parseApiDate('')).toBeNull();
    });
});

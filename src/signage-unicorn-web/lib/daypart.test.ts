import { describe, it, expect } from 'vitest';
import { parseDays, formatDays, toggleDay, isWithinDaypart, describeDaypart, hasDaypart, storeNow } from './daypart';

const at = (iso: string) => new Date(iso); // local time of the test machine, like the console

describe('days of week', () => {
    it('parses and canonicalises', () => {
        expect(Array.from(parseDays('3;1, 2')).sort()).toEqual([1, 2, 3]);
        expect(formatDays([3, 1, 2])).toBe('1,2,3');
        expect(formatDays([1, 2, 3, 4, 5, 6, 7])).toBeUndefined();
        expect(formatDays([])).toBeUndefined();
        expect(parseDays('8,0,x').size).toBe(0);
    });
    it('toggles', () => {
        expect(toggleDay(undefined, 5)).toBe('5');
        expect(toggleDay('5', 5)).toBeUndefined();
        expect(toggleDay('1,2,3,4,5,6', 7)).toBeUndefined(); // all seven = no restriction
    });
});

describe('isWithinDaypart', () => {
    it('all day without times', () => {
        expect(isWithinDaypart(at('2026-11-20T03:00:00'), {})).toBe(true);
        expect(isWithinDaypart(at('2026-11-20T03:00:00'), undefined)).toBe(true);
    });
    it('same-day window is start-inclusive, end-exclusive', () => {
        const dp = { startTime: '09:00', endTime: '18:00' };
        expect(isWithinDaypart(at('2026-11-20T08:59:00'), dp)).toBe(false);
        expect(isWithinDaypart(at('2026-11-20T09:00:00'), dp)).toBe(true);
        expect(isWithinDaypart(at('2026-11-20T17:59:00'), dp)).toBe(true);
        expect(isWithinDaypart(at('2026-11-20T18:00:00'), dp)).toBe(false);
    });
    it('overnight window wraps midnight', () => {
        const dp = { startTime: '22:00', endTime: '02:00' };
        expect(isWithinDaypart(at('2026-11-20T23:30:00'), dp)).toBe(true);
        expect(isWithinDaypart(at('2026-11-21T01:30:00'), dp)).toBe(true);
        expect(isWithinDaypart(at('2026-11-21T12:00:00'), dp)).toBe(false);
    });
    it('days of week', () => {
        expect(isWithinDaypart(at('2026-11-20T12:00:00'), { daysOfWeek: '1,2,3,4,5' })).toBe(true);  // Friday
        expect(isWithinDaypart(at('2026-11-22T12:00:00'), { daysOfWeek: '1,2,3,4,5' })).toBe(false); // Sunday
    });
    it('overnight window belongs to the day it started on', () => {
        const fri = { startTime: '22:00', endTime: '02:00', daysOfWeek: '5' };
        expect(isWithinDaypart(at('2026-11-20T23:30:00'), fri)).toBe(true);   // Friday night
        expect(isWithinDaypart(at('2026-11-21T01:30:00'), fri)).toBe(true);   // Saturday 01:30 is still Friday's night
        expect(isWithinDaypart(at('2026-11-21T02:00:00'), fri)).toBe(false);
        expect(isWithinDaypart(at('2026-11-21T23:30:00'), fri)).toBe(false);  // Saturday night not allowed
        expect(isWithinDaypart(at('2026-11-21T01:30:00'), { ...fri, daysOfWeek: '6' })).toBe(false);
    });
});

describe('storeNow', () => {
    it('returns Bangkok wall-clock fields for a UTC instant', () => {
        const d = storeNow('Asia/Bangkok', new Date(Date.UTC(2026, 10, 20, 17, 30, 0))); // 17:30 UTC = 00:30 next day in Bangkok
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(30);
        expect(d.getDate()).toBe(21);
    });
    it('falls back to the given date on an unknown zone', () => {
        const now = new Date();
        expect(storeNow('Not/AZone', now)).toBe(now);
    });
});

describe('describeDaypart / hasDaypart', () => {
    it('summarises', () => {
        expect(describeDaypart({ startTime: '09:00', endTime: '18:00', daysOfWeek: '1,2,3,4,5' })).toBe('09:00–18:00 · Mo–Fr');
        expect(describeDaypart({ daysOfWeek: '6,7' })).toBe('Sa Su');
        expect(describeDaypart({ repeatEveryMinutes: 30 })).toBe('every 30 min');
        expect(describeDaypart({})).toBe('');
    });
    it('knows when something is set', () => {
        expect(hasDaypart({})).toBe(false);
        expect(hasDaypart({ repeatEveryMinutes: 0 })).toBe(false);
        expect(hasDaypart({ endTime: '20:00' })).toBe(true);
    });
});

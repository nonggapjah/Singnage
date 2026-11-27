import { describe, it, expect } from 'vitest';
import {
    HOURS, MINUTES,
    splitLocalDateTime, splitTime, joinLocalDateTime, withPickedDate, withPickedTime,
} from './datetime-local';

describe('datetime-local helpers (24-hour schedule pickers)', () => {
    it('splits and rejoins the datetime-local value without loss', () => {
        expect(splitLocalDateTime('2026-11-15T23:59')).toEqual({ date: '2026-11-15', hh: '23', mm: '59' });
        expect(joinLocalDateTime('2026-11-15', '23', '59')).toBe('2026-11-15T23:59');
        expect(splitLocalDateTime('2026-11-15T07:05:00')).toEqual({ date: '2026-11-15', hh: '07', mm: '05' });
        expect(splitLocalDateTime('2026-11-15')).toEqual({ date: '2026-11-15', hh: '', mm: '' });
        expect(splitLocalDateTime('')).toEqual({ date: '', hh: '', mm: '' });
        expect(splitLocalDateTime(undefined)).toEqual({ date: '', hh: '', mm: '' });
        expect(splitLocalDateTime('garbage')).toEqual({ date: '', hh: '', mm: '' });
    });

    it('an empty date means no date, and single-digit parts are padded', () => {
        expect(joinLocalDateTime('', '23', '59')).toBe('');
        expect(joinLocalDateTime('2026-11-15', '9', '5')).toBe('2026-11-15T09:05');
        expect(joinLocalDateTime('2026-11-15', '', '')).toBe('2026-11-15T00:00');
    });

    it('picking a date keeps a time already set, otherwise applies the default (23:59 for an end)', () => {
        expect(withPickedDate('', '2026-11-15', '23:59')).toBe('2026-11-15T23:59');
        expect(withPickedDate('', '2026-11-15', '00:00')).toBe('2026-11-15T00:00');
        expect(withPickedDate('2026-11-01T08:30', '2026-11-15', '23:59')).toBe('2026-11-15T08:30');
        expect(withPickedDate('2026-11-01T08:30', '', '23:59')).toBe('');
    });

    it('picking an hour or a minute needs a date and changes only that part', () => {
        expect(withPickedTime('2026-11-15T08:30', '17', undefined)).toBe('2026-11-15T17:30');
        expect(withPickedTime('2026-11-15T08:30', undefined, '00')).toBe('2026-11-15T08:00');
        expect(withPickedTime('2026-11-15', '17', undefined)).toBe('2026-11-15T17:00');
        expect(withPickedTime('', '17', undefined)).toBe('');
    });

    it('splitTime clamps malformed input to a valid 24-hour time', () => {
        expect(splitTime('23:59')).toEqual({ hh: '23', mm: '59' });
        expect(splitTime('7:5')).toEqual({ hh: '07', mm: '05' });
        expect(splitTime('25:99')).toEqual({ hh: '23', mm: '59' });
        expect(splitTime('nope')).toEqual({ hh: '00', mm: '00' });
        expect(splitTime(undefined)).toEqual({ hh: '00', mm: '00' });
    });

    it('offers every hour and minute of a 24-hour clock', () => {
        expect(HOURS).toHaveLength(24);
        expect(HOURS[0]).toBe('00');
        expect(HOURS[23]).toBe('23');
        expect(MINUTES).toHaveLength(60);
        expect(MINUTES[59]).toBe('59');
    });
});

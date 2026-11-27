/**
 * Helpers for the `YYYY-MM-DDTHH:mm` local date-time strings the schedule pickers exchange with
 * their callers: the value format of a native datetime-local input, 24-hour, locale-independent.
 *
 * The native picker's UI, however, follows the browser locale and shows a 12-hour clock with
 * AM/PM on English-locale machines ("02 PM" for 14:00), which operators objected to.
 * DateTimePicker24h therefore composes the value from a date input and two 24-hour selects;
 * these are its framework-free parts so the rules can be tested without a browser.
 */

export const HOURS: readonly string[] = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
export const MINUTES: readonly string[] = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export interface LocalDateTimeParts {
    date: string;
    hh: string;
    mm: string;
}

/** Splits a local date-time string; tolerates a trailing seconds part and a bare date. Anything else is empty. */
export function splitLocalDateTime(value: string | null | undefined): LocalDateTimeParts {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value || '');
    if (!m) return { date: '', hh: '', mm: '' };
    return { date: m[1], hh: m[2] ?? '', mm: m[3] ?? '' };
}

/** `HH:mm` to parts, clamped to a valid 24-hour time; anything malformed is midnight. */
export function splitTime(time: string | undefined): { hh: string; mm: string } {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(time || '');
    if (!m) return { hh: '00', mm: '00' };
    const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return { hh: String(h).padStart(2, '0'), mm: String(min).padStart(2, '0') };
}

const pad2 = (s: string) => (s || '0').padStart(2, '0').slice(-2);

/** Builds the `YYYY-MM-DDTHH:mm` value; an empty date is "no date" (''). */
export function joinLocalDateTime(date: string, hh: string, mm: string): string {
    if (!date) return '';
    return `${date}T${pad2(hh)}:${pad2(mm)}`;
}

/**
 * The value after the operator picked a date: keeps a time that is already set, otherwise applies
 * `defaultTime` (00:00 for a start, 23:59 for an end). To an operator "ends 15 Nov" means the whole
 * of 15 Nov; an end at midnight would stop the content before that day even began.
 */
export function withPickedDate(current: string, newDate: string, defaultTime: string): string {
    if (!newDate) return '';
    const cur = splitLocalDateTime(current);
    const def = splitTime(defaultTime);
    return joinLocalDateTime(newDate, cur.hh || def.hh, cur.mm || def.mm);
}

/** The value after the operator picked an hour or a minute; without a date there is nothing to set. */
export function withPickedTime(current: string, hh?: string, mm?: string): string {
    const cur = splitLocalDateTime(current);
    if (!cur.date) return '';
    return joinLocalDateTime(cur.date, hh ?? cur.hh, mm ?? cur.mm);
}

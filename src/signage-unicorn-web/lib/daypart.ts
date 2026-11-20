// Dayparts (API 2.8.7 / web 2.4.15): an assignment's daily time window, days of the week and, for
// audio players, a repeat interval. Mirrors ScheduleWindow.cs on the API; times are 'HH:mm' in the
// store's local time, days are ISO numbers (Monday = 1 ... Sunday = 7) in a comma-separated string.

export interface Daypart {
    startTime?: string;
    endTime?: string;
    daysOfWeek?: string;
    repeatEveryMinutes?: number | null;
}

export const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;
export const DAY_SHORT: Record<number, string> = { 1: 'Mo', 2: 'Tu', 3: 'We', 4: 'Th', 5: 'Fr', 6: 'Sa', 7: 'Su' };

export const parseDays = (raw?: string | null): Set<number> => {
    const set = new Set<number>();
    if (!raw) return set;
    for (const part of raw.split(/[,; ]+/)) {
        const n = Number(part);
        if (Number.isInteger(n) && n >= 1 && n <= 7) set.add(n);
    }
    return set;
};

/** Canonical "1,2,3"; undefined when nothing is selected or all seven days are (no restriction). */
export const formatDays = (days: Iterable<number>): string | undefined => {
    const list = Array.from(new Set(days)).filter(d => d >= 1 && d <= 7).sort((a, b) => a - b);
    if (list.length === 0 || list.length === 7) return undefined;
    return list.join(',');
};

export const toggleDay = (raw: string | undefined, day: number): string | undefined => {
    const set = parseDays(raw);
    if (set.has(day)) set.delete(day); else set.add(day);
    return formatDays(set);
};

export const isoDay = (d: Date): number => (d.getDay() === 0 ? 7 : d.getDay());

const toMinutes = (hhmm?: string): number | null => {
    if (!hhmm) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
};

/** The store's clock (the API evaluates windows in Schedule:TimeZoneId, Thailand): a Date whose local
 *  fields equal the wall-clock time in that zone, so getHours()/getDay() read store time anywhere. */
export const STORE_TIME_ZONE = 'Asia/Bangkok';
export const storeNow = (timeZone: string = STORE_TIME_ZONE, now: Date = new Date()): Date => {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
        const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
        return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    } catch {
        return now;
    }
};

/** Same rule as the API: no times = all day; start > end = overnight; days apply to the day the window
 *  STARTED on (after midnight inside an overnight window the previous day is checked). */
export const isWithinDaypart = (now: Date, dp: Daypart | undefined): boolean => {
    if (!dp) return true;
    const s = toMinutes(dp.startTime);
    const e = toMinutes(dp.endTime);
    const t = now.getHours() * 60 + now.getMinutes();
    const overnight = s !== null && e !== null && s > e;
    const dayOf = overnight && t < (e as number) ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;
    const days = parseDays(dp.daysOfWeek);
    if (days.size > 0 && !days.has(isoDay(dayOf))) return false;
    if (s === null && e === null) return true;
    if (s !== null && e === null) return t >= s;
    if (s === null) return t < (e as number);
    if (s === e) return true;
    return s < (e as number) ? (t >= s && t < (e as number)) : (t >= s || t < (e as number));
};

export const hasDaypart = (dp: Daypart | undefined): boolean =>
    !!dp && (!!dp.startTime || !!dp.endTime || parseDays(dp.daysOfWeek).size > 0 || (!!dp.repeatEveryMinutes && dp.repeatEveryMinutes > 0));

/** "09:00–18:00 · Mo–Fr · every 30 min" for badges and summaries; '' when nothing is set. */
export const describeDaypart = (dp: Daypart | undefined): string => {
    if (!dp) return '';
    const parts: string[] = [];
    if (dp.startTime || dp.endTime) parts.push(`${dp.startTime || '00:00'}–${dp.endTime || '24:00'}`);
    const days = Array.from(parseDays(dp.daysOfWeek)).sort((a, b) => a - b);
    if (days.length > 0 && days.length < 7) {
        const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
        parts.push(contiguous && days.length > 2 ? `${DAY_SHORT[days[0]]}–${DAY_SHORT[days[days.length - 1]]}` : days.map(d => DAY_SHORT[d]).join(' '));
    }
    if (dp.repeatEveryMinutes && dp.repeatEveryMinutes > 0) parts.push(`every ${dp.repeatEveryMinutes} min`);
    return parts.join(' · ');
};

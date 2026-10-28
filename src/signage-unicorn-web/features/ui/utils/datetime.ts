/**
 * Date helpers for the admin console.
 *
 * The API stores and compares every timestamp in UTC and, since the 27-10-2026 hardening, reads an
 * offset-less value as UTC (it no longer subtracts seven hours for Bangkok). Every filter or
 * schedule value the UI sends must therefore be an ISO-8601 string with a trailing "Z"; every
 * value received ends with "Z" and is rendered in the browser's local time.
 *
 * Inputs stay local: <input type="date"> yields "YYYY-MM-DD", <input type="datetime-local">
 * yields "YYYY-MM-DDTHH:mm". A string without an offset is parsed by `new Date()` as LOCAL time,
 * which is exactly the conversion these helpers rely on.
 */

const pad = (n: number) => n.toString().padStart(2, '0');

/** "YYYY-MM-DDTHH:mm[:ss]" in local time -> UTC ISO with "Z". Empty input -> undefined. */
export function localInputToUtcIso(local?: string | null): string | undefined {
    if (!local) return undefined;
    const d = new Date(local);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** "YYYY-MM-DD" -> UTC ISO of 00:00:00.000 local on that day. */
export function localDateStartToUtcIso(date?: string | null): string | undefined {
    if (!date) return undefined;
    return localInputToUtcIso(`${date}T00:00:00`);
}

/** "YYYY-MM-DD" -> UTC ISO of 23:59:59.999 local on that day (an "expires on" or "until" date). */
export function localDateEndToUtcIso(date?: string | null): string | undefined {
    if (!date) return undefined;
    return localInputToUtcIso(`${date}T23:59:59.999`);
}

/** Parses an API timestamp; an offset-less value is treated as UTC (the API's convention). */
export function parseApiDate(value?: string | null): Date | null {
    if (!value) return null;
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const d = new Date(hasOffset ? value : `${value}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** API timestamp -> "YYYY-MM-DD" in local time, for <input type="date">. */
export function utcIsoToLocalDateInput(value?: string | null): string {
    const d = parseApiDate(value);
    if (!d) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** API timestamp -> "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
export function utcIsoToLocalDateTimeInput(value?: string | null): string {
    const d = parseApiDate(value);
    if (!d) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Filter value for the API (Codex round-3 #18). API 2.8+ (`utcFilters`) compares UTC, so the local
 * input becomes an ISO "Z" instant; the 2.7.x procedures subtract 7 h themselves, so they get the
 * bare local string "YYYY-MM-DDTHH:mm:ss" exactly as the old console sent it.
 */
export function localInputToApiFilter(local: string | null | undefined, utcFilters: boolean): string {
    if (!local) return '';
    return utcFilters ? (localInputToUtcIso(local) ?? '') : local;
}

/** Media expiry: end of the local day as UTC on 2.8+; the old console's UTC-midnight value on 2.7.x. */
export function expiryDateForApi(date: string | null | undefined, utcFilters: boolean): string | undefined {
    if (!date) return undefined;
    if (utcFilters) return localDateEndToUtcIso(date);
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

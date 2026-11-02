'use client';

import React from 'react';
import { HOURS, MINUTES, splitLocalDateTime, splitTime, withPickedDate, withPickedTime } from '@/lib/datetime-local';

/**
 * DateTimePicker24h
 * ------------------
 * A themed date + time picker that shows and edits time on a 24-hour clock, whatever the
 * browser locale.
 *
 * It used to wrap a single native `<input type="datetime-local">`. That input's VALUE is 24-hour
 * and locale-independent, but its picker UI follows the browser locale, so operators on
 * English-locale machines got a 12-hour clock with AM/PM ("02 PM" for 14:00). The control is now
 * a native date input (calendar) plus two selects for hour (00-23) and minute (00-59), and it
 * still exchanges the same `YYYY-MM-DDTHH:mm` string with every caller:
 *   - DevicePlaylistModal / the batch-assign modals feed the value straight into
 *     `new Date(value).toISOString()` to convert local time -> UTC.
 *   - An empty value ('') maps cleanly to "no date" (callers guard with `value ? ... : undefined`).
 *
 * Props (compatible with all existing call sites):
 *   value           - current 24h local datetime string ('' when unset)
 *   onChange        - called with the new 24h local datetime string ('' when cleared)
 *   isLarge         - taller / roomier variant used inside the schedule cards
 *   placeholderDate - hint label shown while no date is set
 *   id / ariaLabel  - accessible name: pair `id` with a <label htmlFor>, or pass
 *                     `ariaLabel` when there is no visible label (table cells)
 *   defaultTime     - time applied when a date is picked and no time is set yet ('00:00');
 *                     end-date pickers pass '23:59' so "ends 15 Nov" covers the whole of 15 Nov
 */
interface DateTimePicker24hProps {
    value: string;
    onChange: (val: string) => void;
    isLarge?: boolean;
    placeholderDate?: string;
    id?: string;
    ariaLabel?: string;
    defaultTime?: string;
}

export const DateTimePicker24h: React.FC<DateTimePicker24hProps> = ({
    value,
    onChange,
    isLarge = false,
    placeholderDate = '- Select date -',
    id,
    ariaLabel,
    defaultTime = '00:00',
}) => {
    // Operators read these across a room on a 1080p console; the first cut (text-xs, 38 px) was
    // reported as "tiny", so both variants are a step up and the selects get real padding.
    const sizeClass = isLarge ? 'h-[52px] text-base' : 'h-[44px] text-sm';
    const selectWidth = isLarge ? 'min-w-[4.25rem]' : 'min-w-[3.75rem]';
    const { date, hh, mm } = splitLocalDateTime(value);
    const isEmpty = !date;
    // Without a date the selects preview the time a pick would get; with one they show the value.
    const shown = isEmpty ? splitTime(defaultTime) : { hh: hh || '00', mm: mm || '00' };
    const name = ariaLabel || 'Date';
    const field = `bg-muted/20 border border-border rounded-xl font-mono text-foreground outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors [color-scheme:dark] ${sizeClass}`;
    const select = `${field} ${selectWidth} px-2 text-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`;

    return (
        <div className="flex w-full items-center gap-2">
            <div className="relative flex-1 min-w-0">
                {/* Custom placeholder overlay, shown while no date is set. pointer-events-none lets
                    clicks fall through to the input; the native "mm/dd/yyyy" text is made
                    transparent meanwhile so only our label shows. */}
                {isEmpty && (
                    <span
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-0 flex items-center px-3 font-mono uppercase tracking-wider text-muted-foreground/70 whitespace-nowrap overflow-hidden ${isLarge ? 'text-sm' : 'text-xs'}`}
                    >
                        {placeholderDate}
                    </span>
                )}
                <input
                    id={id}
                    aria-label={ariaLabel}
                    type="date"
                    value={date}
                    onChange={(e) => onChange(withPickedDate(value, e.target.value, defaultTime))}
                    className={`${field} w-full px-3 cursor-pointer ${isEmpty ? 'text-transparent dt-empty' : ''}`}
                />
            </div>
            <select
                aria-label={`${name}: hour (24-hour clock)`}
                title="Hour (00-23)"
                value={shown.hh}
                disabled={isEmpty}
                onChange={(e) => onChange(withPickedTime(value, e.target.value, undefined))}
                className={select}
            >
                {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <span aria-hidden="true" className={`font-mono text-muted-foreground ${isLarge ? 'text-lg' : 'text-base'}`}>:</span>
            <select
                aria-label={`${name}: minute`}
                title="Minute (00-59)"
                value={shown.mm}
                disabled={isEmpty}
                onChange={(e) => onChange(withPickedTime(value, undefined, e.target.value))}
                className={select}
            >
                {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {!isEmpty && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    title="Clear date"
                    aria-label={`Clear ${name.toLowerCase()}`}
                    className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors text-base rounded px-1"
                >
                    ✕
                </button>
            )}
        </div>
    );
};

export default DateTimePicker24h;

'use client';

import React from 'react';

/**
 * DateTimePicker24h
 * ------------------
 * A themed date + time picker that always works in 24-hour time.
 *
 * It wraps the native `<input type="datetime-local">` whose value is ALWAYS the
 * 24-hour, locale-independent string `YYYY-MM-DDTHH:mm`. That is exactly the
 * format every caller expects:
 *   - DevicePlaylistModal / BatchAssignModal feed the value straight into
 *     `new Date(value).toISOString()` to convert local time -> UTC.
 *   - An empty value ('') maps cleanly to "no date" (callers guard with `value ? ... : undefined`).
 *
 * Props are kept compatible with all existing call sites:
 *   value           - current 24h local datetime string ('' when unset)
 *   onChange        - called with the new 24h local datetime string ('' when cleared)
 *   isLarge         - taller / roomier variant used inside the schedule table
 *   placeholderDate - hint label shown while the field is empty
 */
interface DateTimePicker24hProps {
    value: string;
    onChange: (val: string) => void;
    isLarge?: boolean;
    placeholderDate?: string;
}

export const DateTimePicker24h: React.FC<DateTimePicker24hProps> = ({
    value,
    onChange,
    isLarge = false,
    placeholderDate = 'Select date & time',
}) => {
    const heightClass = isLarge ? 'h-[46px] text-sm' : 'h-[38px] text-xs';
    const isEmpty = !value;

    return (
        <div className="relative w-full">
            {/* Hint overlay: native datetime-local has no usable placeholder, so we
                render our own label while the field is empty. pointer-events-none
                keeps clicks flowing through to the input / its calendar button. */}
            {isEmpty && (
                <span
                    className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono uppercase tracking-wider text-muted-foreground/60 ${
                        isLarge ? 'text-sm' : 'text-xs'
                    }`}
                >
                    {placeholderDate}
                </span>
            )}
            <input
                type="datetime-local"
                value={value}
                step={60}
                onChange={(e) => onChange(e.target.value)}
                className={`w-full bg-black/40 border border-white/10 rounded-xl px-3 font-mono text-white outline-none focus:border-accent-cyan focus:shadow-[0_0_15px_rgba(34,211,238,0.15)] focus:bg-black/60 cursor-pointer transition-all [color-scheme:dark] ${heightClass} ${
                    isEmpty ? 'text-transparent' : ''
                }`}
            />
            {!isEmpty && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    title="Clear"
                    className="absolute right-9 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-red-400 transition-colors text-sm outline-none"
                >
                    ✕
                </button>
            )}
        </div>
    );
};

export default DateTimePicker24h;

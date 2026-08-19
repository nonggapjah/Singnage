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
    placeholderDate = '- SELECT DATE & TIME -',
}) => {
    const heightClass = isLarge ? 'h-[46px] text-sm' : 'h-[38px] text-xs';
    const isEmpty = !value;

    return (
        <div className="relative w-full">
            {/* Custom placeholder overlay — shown when input is empty.
                pointer-events-none lets clicks fall through to the input.
                We hide the native "mm/dd/yyyy --:-- --" text by making the
                input text transparent while empty, so only our label shows. */}
            {isEmpty && (
                <span
                    className={`pointer-events-none absolute inset-0 flex items-center px-3 font-mono uppercase tracking-wider text-muted-foreground/50 whitespace-nowrap overflow-hidden ${
                        isLarge ? 'text-xs' : 'text-[10px]'
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
                className={`w-full bg-black/40 border border-white/10 rounded-xl px-3 font-mono text-white outline-none focus:border-accent-cyan focus:shadow-[0_0_15px_rgba(34,211,238,0.15)] focus:bg-black/60 cursor-pointer transition-all [color-scheme:dark] ${heightClass} ${isEmpty ? 'text-transparent dt-empty' : ''}`}
            />
            {!isEmpty && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    title="Clear date"
                    className="absolute right-9 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-red-400 transition-colors text-sm outline-none z-10"
                >
                    ✕
                </button>
            )}
        </div>
    );
};

export default DateTimePicker24h;

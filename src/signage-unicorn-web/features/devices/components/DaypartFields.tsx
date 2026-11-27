'use client';

import React from 'react';
import { HOURS, MINUTES, splitTime } from '@/lib/datetime-local';
import { Daypart, DAY_NUMBERS, DAY_SHORT, parseDays, toggleDay } from '@/lib/daypart';

interface DaypartFieldsProps {
    value: Daypart;
    onChange: (next: Daypart) => void;
    idPrefix: string;
    /** Tighter spacing for a table cell. */
    compact?: boolean;
    /** Show the "repeat every N min" field (audio players). Default true. */
    showRepeat?: boolean;
}

/**
 * Daily time window (24 h), days of the week and the audio-player repeat interval of one
 * assignment. Everything optional: empty means "no restriction", exactly what every existing
 * assignment has.
 */
export const DaypartFields: React.FC<DaypartFieldsProps> = ({ value, onChange, idPrefix, compact, showRepeat = true }) => {
    const size = compact ? 'h-[36px] text-sm' : 'h-[44px] text-sm';
    const field = `bg-muted/20 border border-border rounded-lg font-mono text-foreground outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors [color-scheme:dark] ${size}`;
    const select = `${field} min-w-[3.6rem] px-1 text-center cursor-pointer`;
    const label = 'text-[11px] font-bold uppercase tracking-wider text-muted-foreground';

    const setTime = (key: 'startTime' | 'endTime', hh?: string, mm?: string) => {
        const current = splitTime(value[key]);
        const nextHh = hh ?? (value[key] ? current.hh : '');
        const nextMm = mm ?? (value[key] ? current.mm : '00');
        onChange({ ...value, [key]: nextHh === '' ? undefined : `${nextHh}:${nextMm || '00'}` });
    };

    const TimePair: React.FC<{ keyName: 'startTime' | 'endTime'; text: string }> = ({ keyName, text }) => {
        const v = value[keyName];
        const { hh, mm } = splitTime(v);
        return (
            <div className="flex items-center gap-1">
                <label htmlFor={`${idPrefix}-${keyName}-h`} className={`${label} w-10`}>{text}</label>
                <select id={`${idPrefix}-${keyName}-h`} value={v ? hh : ''} onChange={e => setTime(keyName, e.target.value, undefined)} className={select} aria-label={`${text} hour`}>
                    <option value="">--</option>
                    {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <span aria-hidden="true" className="font-mono text-muted-foreground">:</span>
                <select id={`${idPrefix}-${keyName}-m`} value={v ? mm : '00'} onChange={e => setTime(keyName, undefined, e.target.value)} disabled={!v} className={`${select} disabled:opacity-40`} aria-label={`${text} minute`}>
                    {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
            </div>
        );
    };

    const selectedDays = parseDays(value.daysOfWeek);
    // Empty = every day. The buttons all read as "on" then, so a click on one must EXCLUDE that
    // day (what the eye expects), not turn it into the only allowed day.
    const clickDay = (d: number) => {
        const next = selectedDays.size === 0 ? DAY_NUMBERS.filter(x => x !== d).join(',') : toggleDay(value.daysOfWeek, d);
        onChange({ ...value, daysOfWeek: next || undefined });
    };

    return (
        <div className={compact ? 'flex flex-wrap items-center gap-x-5 gap-y-1.5' : 'flex flex-col gap-3'}>
            <div className={`flex flex-wrap items-center ${compact ? 'gap-2' : 'gap-4'}`}>
                <TimePair keyName="startTime" text="From" />
                <TimePair keyName="endTime" text="To" />
                {(value.startTime || value.endTime) && (
                    <button type="button" onClick={() => onChange({ ...value, startTime: undefined, endTime: undefined })} className="text-xs text-muted-foreground hover:text-red-500" title="All day">✕ all day</button>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Days of week">
                {DAY_NUMBERS.map(d => {
                    const on = selectedDays.size === 0 || selectedDays.has(d);
                    return (
                        <button
                            key={d}
                            type="button"
                            aria-pressed={on}
                            onClick={() => clickDay(d)}
                            className={`${compact ? 'h-7 w-9 text-[11px]' : 'h-9 w-11 text-xs'} rounded-md border font-bold uppercase tracking-wider transition-colors ${
                                selectedDays.has(d)
                                    ? 'bg-accent-cyan/15 border-accent-cyan/50 text-accent-cyan'
                                    : on ? 'bg-muted/10 border-border text-foreground/80 hover:bg-muted/30' : 'bg-transparent border-border/60 text-muted-foreground line-through decoration-border hover:bg-muted/20'
                            }`}
                            title={selectedDays.size === 0 ? 'Every day (click to exclude this day)' : (selectedDays.has(d) ? 'Allowed (click to exclude)' : 'Not on this day (click to allow)')}
                        >
                            {DAY_SHORT[d]}
                        </button>
                    );
                })}
                <span className="ml-1 text-[11px] text-muted-foreground">{selectedDays.size === 0 ? 'every day' : ''}</span>
            </div>
            {showRepeat && (
                <div className="flex items-center gap-2">
                    <label htmlFor={`${idPrefix}-repeat`} className={label}>Repeat every</label>
                    <input
                        id={`${idPrefix}-repeat`}
                        type="number"
                        min={1}
                        max={1440}
                        value={value.repeatEveryMinutes && value.repeatEveryMinutes > 0 ? value.repeatEveryMinutes : ''}
                        placeholder="off"
                        onChange={e => {
                            const n = parseInt(e.target.value, 10);
                            onChange({ ...value, repeatEveryMinutes: Number.isFinite(n) && n > 0 ? Math.min(1440, n) : null });
                        }}
                        className={`${field} w-20 px-2 text-center placeholder:text-muted-foreground/60`}
                    />
                    <span className={label}>min</span>
                    <span className="text-[11px] text-muted-foreground" title="Audio players play this playlist once every N minutes between the regular tracks (announcements). Screens play it in their loop as usual.">audio players only · plays between tracks</span>
                </div>
            )}
        </div>
    );
};

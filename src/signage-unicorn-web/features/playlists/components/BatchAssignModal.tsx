'use client';

import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import { Search, ChevronDown, Volume2, X } from 'lucide-react';
import { deviceApi } from '@/features/devices/api/device-api';
import { Device } from '@/features/devices/types';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { useUI } from '@/features/ui/context/UIContext';
import { DateTimePicker24h } from '@/components/ui/DateTimePicker24h';
import { DaypartFields } from '@/features/devices/components/DaypartFields';
import { Daypart, describeDaypart, hasDaypart } from '@/lib/daypart';
import { Modal } from '@/components/ui/Modal';

/**
 * Deploy one playlist to many screens (Playlists page -> "Deploy").
 *
 * web 2.4.20 redesign. The first cut listed 354 screens as two columns of cards under a strip of
 * 50+ bare branch-code buttons, with the schedule in a column that scrolled away with the list.
 * Operators could not find a branch, read a truncated name, or see which screens already had the
 * playlist. Now:
 *   - the list is a dense table grouped by branch; the group header selects the whole branch
 *   - branch is a dropdown with counts, plus search and an "online only" filter
 *   - screens that already have this playlist assigned are marked, so nothing is assigned twice
 *   - the schedule stays put beside the list and reads back as one sentence
 *     ("All day, every day · starts now · no end date"); hours/days are tucked behind a disclosure
 *     because nearly every assignment has none
 * The request is unchanged: POST /devices/batch-add-playlist with the same body as before.
 */
interface BatchAssignModalProps {
    playlistId: string;
    playlistName: string;
    onClose: () => void;
    onSuccess: () => void;
}

const ONLINE_STATES = ['ONLINE', 'PLAYING', 'IDLE'];
const isOnline = (d: Device) => ONLINE_STATES.includes((d.status || '').toUpperCase());
const isAudio = (d: Device) => (d.playbackMode || 'screen') === 'audio';

/** "24 Nov 2026 09:00" from the picker's local 'YYYY-MM-DDTHH:mm'; '' when unset or unparsable. */
const fmtLocal = (value: string): string => {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${date} ${hh}:${mm}`;
};

const noun = (devices: Device[]): string => {
    if (devices.length === 0) return 'screens';
    const audio = devices.filter(isAudio).length;
    if (audio === 0) return devices.length === 1 ? 'screen' : 'screens';
    if (audio === devices.length) return devices.length === 1 ? 'player' : 'players';
    return 'devices';
};

/** Native checkbox that can show the mixed (indeterminate) state. */
const TriCheckbox: React.FC<{
    checked: boolean;
    indeterminate: boolean;
    onChange: () => void;
    ariaLabel: string;
    className?: string;
}> = ({ checked, indeterminate, onChange, ariaLabel, className = '' }) => {
    const ref = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = indeterminate && !checked;
    }, [indeterminate, checked]);
    return (
        <input
            ref={ref}
            type="checkbox"
            checked={checked}
            onChange={onChange}
            aria-label={ariaLabel}
            className={`h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-border bg-muted/20 accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 ${className}`}
        />
    );
};

export const BatchAssignModal: React.FC<BatchAssignModalProps> = ({ playlistId, playlistName, onClose, onSuccess }) => {
    const { showNotify } = useUI();
    const uid = useId();
    const [devices, setDevices] = useState<Device[]>([]);
    const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [filterBranch, setFilterBranch] = useState('ALL');
    const [onlineOnly, setOnlineOnly] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [daypart, setDaypart] = useState<Daypart>({});
    const [limitsOpen, setLimitsOpen] = useState(false);
    const searchRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        let cancelled = false;
        // The two loads are independent: the screen list must not wait for the advisory "already
        // assigned" lookup (Codex 2.4.20: a stalled /playlists/{id}/devices would have hidden the
        // list for the whole API timeout). If that lookup fails the picker simply has no marks.
        (async () => {
            try {
                const res = await deviceApi.getAll();
                if (cancelled) return;
                if (res.success && res.data) setDevices(res.data);
                else setLoadError(true);
            } catch (error) {
                console.error('Failed to fetch devices', error);
                if (!cancelled) setLoadError(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        (async () => {
            try {
                const res = await playlistApi.getDevices(playlistId);
                if (cancelled || !res.success || !res.data) return;
                setAssignedIds(new Set(res.data.filter(d => d.isAssigned).map(d => String(d.deviceId))));
            } catch {
                /* advisory only */
            }
        })();
        return () => { cancelled = true; };
    }, [playlistId]);

    // Branch codes with their screen counts, sorted naturally (1003 < 1021 < MUSIC).
    const branches = useMemo(() => {
        const counts = new Map<string, number>();
        for (const d of devices) {
            const code = (d.branchCode || '').trim() || 'UNASSIGNED';
            counts.set(code, (counts.get(code) || 0) + 1);
        }
        return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
    }, [devices]);

    const filtered = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return devices.filter(d => {
            const code = (d.branchCode || '').trim() || 'UNASSIGNED';
            if (filterBranch !== 'ALL' && code !== filterBranch) return false;
            if (onlineOnly && !isOnline(d)) return false;
            if (!q) return true;
            return (d.deviceName || '').toLowerCase().includes(q)
                || code.toLowerCase().includes(q)
                || (d.deviceUuid || '').toLowerCase().includes(q)
                || (d.ipAddress || '').toLowerCase().includes(q);
        });
    }, [devices, filterBranch, onlineOnly, searchTerm]);

    // Visible rows grouped by branch, in branch order, names sorted inside each group.
    const groups = useMemo(() => {
        const map = new Map<string, Device[]>();
        for (const d of filtered) {
            const code = (d.branchCode || '').trim() || 'UNASSIGNED';
            const list = map.get(code);
            if (list) list.push(d); else map.set(code, [d]);
        }
        return Array.from(map.entries())
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
            .map(([code, list]) => [code, list.sort((a, b) => (a.deviceName || '').localeCompare(b.deviceName || '', undefined, { numeric: true }))] as const);
    }, [filtered]);

    const selectedDevices = useMemo(() => devices.filter(d => selected.has(d.deviceId)), [devices, selected]);
    const selectedAlreadyAssigned = selectedDevices.filter(d => assignedIds.has(String(d.deviceId))).length;
    const selectedHasAudio = selectedDevices.some(isAudio);
    const shownSelected = filtered.filter(d => selected.has(d.deviceId)).length;
    const allShownSelected = filtered.length > 0 && shownSelected === filtered.length;
    const filtersActive = filterBranch !== 'ALL' || onlineOnly || searchTerm.trim() !== '';

    const setMany = (ids: string[], on: boolean) => {
        setSelected(prev => {
            const next = new Set(prev);
            for (const id of ids) { if (on) next.add(id); else next.delete(id); }
            return next;
        });
    };
    const toggleOne = (id: string) => setMany([id], !selected.has(id));
    const toggleShown = () => setMany(filtered.map(d => d.deviceId), !allShownSelected);
    const clearFilters = () => { setFilterBranch('ALL'); setOnlineOnly(false); setSearchTerm(''); searchRef.current?.focus(); };

    // Schedule read-back and validation.
    const startMs = startDate ? new Date(startDate).getTime() : NaN;
    const endMs = endDate ? new Date(endDate).getTime() : NaN;
    const endBeforeStart = !isNaN(startMs) && !isNaN(endMs) && endMs <= startMs;
    const summary = useMemo(() => {
        const when = hasDaypart(daypart) ? describeDaypart(daypart) : 'All day, every day';
        const from = fmtLocal(startDate);
        const to = fmtLocal(endDate);
        const period = from && to ? `${from} → ${to}` : from ? `from ${from}` : to ? `starts now, until ${to}` : 'starts now, no end date';
        return `${when} · ${period}`;
    }, [daypart, startDate, endDate]);
    const limitsSummary = hasDaypart(daypart) ? describeDaypart(daypart) : 'none';

    const canDeploy = selected.size > 0 && !submitting && !endBeforeStart;

    const handleAssign = async () => {
        if (!canDeploy) return;
        setSubmitting(true);
        try {
            const ids = Array.from(selected);
            const st = startDate ? new Date(startDate).toISOString() : undefined;
            const ed = endDate ? new Date(endDate).toISOString() : undefined;
            const res = await deviceApi.batchAddSchedule(ids, playlistId, st, ed, daypart);
            if (res.success) {
                onSuccess();
            } else {
                showNotify('Deploy failed', `The server did not accept the schedule for ${ids.length} ${noun(selectedDevices)}. Some of them may still have received it: reopen this dialog to see which are marked assigned, then deploy to the rest.`, 'ERROR');
            }
        } catch {
            showNotify('Deploy failed', 'The server could not be reached, or the request timed out. Some screens may still have received the schedule: reopen this dialog to see which are marked assigned, then deploy to the rest.', 'ERROR');
        } finally {
            setSubmitting(false);
        }
    };

    const labelCls = 'block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5';
    const fieldCls = 'bg-muted/20 border border-border rounded-xl text-foreground outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors';
    const chip = 'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider leading-none';

    return (
        <Modal
            isOpen
            onClose={onClose}
            size="none"
            scroll={false}
            closeDisabled={submitting}
            labelledBy={`${uid}-title`}
            zIndexClass="z-[1000]"
            initialFocusRef={searchRef}
            className="max-w-5xl w-full h-[min(90vh,56rem)] flex flex-col overflow-hidden"
        >
            {/* Header */}
            <div className="px-5 sm:px-7 pt-5 pb-4 border-b border-border flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h3 id={`${uid}-title`} className="text-xl sm:text-2xl font-black neon-text uppercase tracking-tight leading-none">Deploy playlist</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground truncate">
                        <span className="text-foreground font-bold">{playlistName}</span>
                        <span className="mx-2 text-border" aria-hidden="true">|</span>
                        {loading ? 'Loading screens…' : `${devices.length} ${noun(devices)} in ${branches.length} branches`}
                    </p>
                </div>
                <button type="button" onClick={onClose} disabled={submitting} aria-label="Close dialog" className="shrink-0 -mr-2 -mt-1 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50">
                    <X className="h-5 w-5" aria-hidden="true" />
                </button>
            </div>

            {/* Body: picker | schedule. Phone: one scrolling column; desktop: each pane scrolls on its own. */}
            <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden custom-scrollbar md:grid md:grid-cols-[minmax(0,1fr)_22rem]">
                {/* Device picker */}
                <section aria-labelledby={`${uid}-pick`} className="flex flex-col min-h-0 md:border-r border-border">
                    <h4 id={`${uid}-pick`} className="sr-only">Choose screens</h4>
                    <div className="px-5 sm:px-7 pt-4 pb-3 flex flex-col gap-3 border-b border-border/60">
                        <div className="flex flex-wrap gap-2">
                            <div className="relative flex-1 min-w-[12rem]">
                                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                <input
                                    ref={searchRef}
                                    type="search"
                                    aria-label="Search screens by name, branch or ID"
                                    placeholder="Search name, branch or ID"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className={`${fieldCls} w-full h-11 pl-9 pr-3 text-sm placeholder:text-muted-foreground/70`}
                                />
                            </div>
                            <div className="relative">
                                <select
                                    aria-label="Branch"
                                    value={filterBranch}
                                    onChange={(e) => setFilterBranch(e.target.value)}
                                    className={`${fieldCls} h-11 pl-3 pr-9 text-sm font-mono appearance-none cursor-pointer min-w-[11rem] [color-scheme:dark]`}
                                >
                                    <option value="ALL">All branches ({devices.length})</option>
                                    {branches.map(([code, n]) => (
                                        <option key={code} value={code}>{code} ({n})</option>
                                    ))}
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            </div>
                            <label className={`${fieldCls} h-11 px-3 inline-flex items-center gap-2 text-sm cursor-pointer select-none has-[:checked]:border-accent-cyan/60`}>
                                <input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} className="h-[18px] w-[18px] rounded accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50" />
                                Online only
                            </label>
                        </div>
                        <div className="flex items-center gap-3 text-sm min-h-[1.75rem]">
                            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none text-foreground">
                                <TriCheckbox
                                    checked={allShownSelected}
                                    indeterminate={shownSelected > 0 && !allShownSelected}
                                    onChange={toggleShown}
                                    ariaLabel={allShownSelected ? `Deselect all ${filtered.length} shown` : `Select all ${filtered.length} shown`}
                                />
                                <span>{allShownSelected ? 'Deselect' : 'Select'} all {filtered.length} shown</span>
                            </label>
                            {filtersActive && !loading && (
                                <button type="button" onClick={clearFilters} className="ml-auto text-xs font-bold uppercase tracking-wider text-accent-cyan hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 rounded">
                                    Clear filters
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="max-h-[46vh] md:max-h-none md:flex-1 md:min-h-0 overflow-y-auto custom-scrollbar" role="group" aria-label="Screens">
                        {loading ? (
                            <ul className="px-5 sm:px-7 py-3 space-y-2" aria-hidden="true">
                                {Array.from({ length: 8 }).map((_, i) => (
                                    <li key={i} className="h-10 rounded-lg bg-muted/20 animate-pulse" style={{ width: `${88 - (i % 3) * 9}%` }} />
                                ))}
                            </ul>
                        ) : loadError ? (
                            <div className="px-7 py-16 text-center text-sm text-muted-foreground" role="alert">
                                The screen list could not be loaded. Close this dialog and try again.
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="px-7 py-16 text-center text-sm text-muted-foreground" role="status">
                                No screens match {searchTerm.trim() ? <>“{searchTerm.trim()}”</> : 'these filters'}.
                                <div className="mt-3">
                                    <button type="button" onClick={clearFilters} className="text-xs font-bold uppercase tracking-wider text-accent-cyan hover:underline underline-offset-4">Clear filters</button>
                                </div>
                            </div>
                        ) : (
                            groups.map(([code, list]) => {
                                const inGroup = list.filter(d => selected.has(d.deviceId)).length;
                                const allGroup = inGroup === list.length;
                                return (
                                    <div key={code}>
                                        <div className="sticky top-0 z-[1] flex items-center gap-2.5 px-5 sm:px-7 h-10 bg-card border-y border-border/60 text-sm">
                                            <TriCheckbox
                                                checked={allGroup}
                                                indeterminate={inGroup > 0 && !allGroup}
                                                onChange={() => setMany(list.map(d => d.deviceId), !allGroup)}
                                                ariaLabel={`${allGroup ? 'Deselect' : 'Select'} all ${list.length} in branch ${code}`}
                                            />
                                            <span className="font-mono font-bold tracking-wide text-foreground">{code}</span>
                                            <span className="text-muted-foreground">
                                                {list.length} {list.length === 1 ? 'screen' : 'screens'}
                                                {inGroup > 0 && <> · <span className="text-accent-cyan font-bold">{inGroup} selected</span></>}
                                            </span>
                                        </div>
                                        <ul className="divide-y divide-border/40">
                                            {list.map(device => {
                                                const on = selected.has(device.deviceId);
                                                const online = isOnline(device);
                                                const already = assignedIds.has(String(device.deviceId));
                                                return (
                                                    <li key={device.deviceId}>
                                                        <label className={`flex items-center gap-2.5 px-5 sm:px-7 min-h-[2.75rem] py-1.5 cursor-pointer select-none transition-colors ${on ? 'bg-primary/10' : 'hover:bg-muted/20'}`}>
                                                            <input
                                                                type="checkbox"
                                                                checked={on}
                                                                onChange={() => toggleOne(device.deviceId)}
                                                                className="h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-border bg-muted/20 accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50"
                                                            />
                                                            <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${online ? 'bg-green-500' : 'bg-red-700'}`} aria-hidden="true" />
                                                            <span className={`flex-1 min-w-0 text-sm truncate ${online ? 'text-foreground' : 'text-muted-foreground'}`} title={device.deviceName}>
                                                                {device.deviceName || device.deviceUuid || device.deviceId}
                                                            </span>
                                                            {isAudio(device) && (
                                                                <span className={`${chip} border-accent-purple/40 text-accent-purple gap-1`}>
                                                                    <Volume2 className="h-3 w-3" aria-hidden="true" />audio
                                                                </span>
                                                            )}
                                                            {already && <span className={`${chip} border-green-500/40 text-green-600 dark:text-green-400`} title="This screen already has this playlist assigned">assigned</span>}
                                                            <span className={`w-14 text-right text-xs ${online ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>{online ? 'online' : 'offline'}</span>
                                                        </label>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </section>

                {/* Schedule */}
                <section aria-labelledby={`${uid}-sched`} className="md:overflow-y-auto custom-scrollbar px-5 sm:px-7 py-5 space-y-5 border-t md:border-t-0 border-border bg-muted/10">
                    <div>
                        <h4 id={`${uid}-sched`} className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Schedule</h4>
                        <p className="mt-1.5 text-sm text-foreground leading-snug" aria-live="polite">{summary}</p>
                    </div>
                    <div>
                        <label htmlFor={`${uid}-start`} className={labelCls}>Start <span className="font-normal normal-case tracking-normal">(optional)</span></label>
                        <DateTimePicker24h id={`${uid}-start`} value={startDate} onChange={setStartDate} placeholderDate="Now" />
                    </div>
                    <div>
                        <label htmlFor={`${uid}-end`} className={labelCls}>End <span className="font-normal normal-case tracking-normal">(optional)</span></label>
                        <DateTimePicker24h id={`${uid}-end`} value={endDate} onChange={setEndDate} placeholderDate="No end date" defaultTime="23:59" />
                        {endBeforeStart && (
                            <p className="mt-1.5 text-xs text-red-500 dark:text-red-400" role="alert">End must be after start.</p>
                        )}
                    </div>
                    <div className="border-t border-border/60 pt-4">
                        <button
                            type="button"
                            onClick={() => setLimitsOpen(o => !o)}
                            aria-expanded={limitsOpen}
                            aria-controls={`${uid}-limits`}
                            className="w-full flex items-center justify-between gap-3 text-left rounded-lg -mx-1 px-1 py-1 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50"
                        >
                            <span className="text-sm font-bold text-foreground">Limit hours or days</span>
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className={hasDaypart(daypart) ? 'text-accent-cyan font-bold' : ''}>{limitsSummary}</span>
                                <ChevronDown className={`h-4 w-4 transition-transform ${limitsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                            </span>
                        </button>
                        {limitsOpen && (
                            <div id={`${uid}-limits`} className="mt-3">
                                <DaypartFields idPrefix={`${uid}-dp`} value={daypart} onChange={setDaypart} compact showRepeat={selectedHasAudio || !!daypart.repeatEveryMinutes} />
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-7 py-4 border-t border-border flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="text-sm min-w-0 flex items-center gap-3" aria-live="polite">
                    <span>
                        <span className={`font-bold ${selected.size > 0 ? 'text-accent-cyan' : 'text-foreground'}`}>{selected.size}</span>
                        <span className="text-muted-foreground"> of {devices.length} selected</span>
                        {selectedAlreadyAssigned > 0 && (
                            <span className="text-muted-foreground"> · {selectedAlreadyAssigned} already {selectedAlreadyAssigned === 1 ? 'has' : 'have'} this playlist</span>
                        )}
                    </span>
                    {selected.size > 0 && (
                        <button type="button" onClick={() => setSelected(new Set())} disabled={submitting} className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground underline-offset-4 hover:underline disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 rounded">Clear</button>
                    )}
                </div>
                <div className="flex gap-2 sm:ml-auto">
                    <button type="button" onClick={onClose} disabled={submitting} className="px-5 h-11 rounded-xl hover:bg-muted/30 font-bold text-xs uppercase tracking-widest text-foreground transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50">Cancel</button>
                    <button
                        type="button"
                        disabled={!canDeploy}
                        onClick={handleAssign}
                        className="px-6 h-11 rounded-xl bg-primary text-primary-foreground font-black text-xs uppercase tracking-[0.15em] transition-colors hover:brightness-110 disabled:opacity-30 disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                    >
                        {submitting ? 'Deploying…' : selected.size === 0 ? 'Deploy' : `Deploy to ${selected.size} ${noun(selectedDevices)}`}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

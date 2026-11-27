'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, X, Clock } from 'lucide-react';
import { rolloutApi, Rollout } from '@/features/playlists/api/rollout-api';
import { useUI } from '@/features/ui/context/UIContext';

const POLL_MS = 15_000;

const fmtTime = (iso?: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const sameDay = d.toDateString() === new Date().toDateString();
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return sameDay ? hhmm : `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${hhmm}`;
};

const statusChip: Record<Rollout['status'], string> = {
    active: 'border-accent-cyan/50 text-accent-cyan',
    paused: 'border-amber-500/50 text-amber-600 dark:text-amber-400',
    done: 'border-green-500/40 text-green-600 dark:text-green-400',
    cancelled: 'border-border text-muted-foreground',
};

/** What is happening right now, in one sentence. */
const describe = (r: Rollout): string => {
    const released = r.waves.filter(w => w.started).length;
    if (r.status === 'done') return `Finished: ${r.appliedDevices} of ${r.totalDevices} screens assigned${r.failedDevices ? `, ${r.failedDevices} failed` : ''}.`;
    if (r.status === 'cancelled') return `Cancelled after ${released} of ${r.waveCount} branches; ${r.appliedDevices} screens keep the playlist.`;
    const next = r.nextBranch ? `${r.nextBranch} at ${fmtTime(r.nextWaveUtc)}` : 'none left';
    if (r.status === 'paused') return `Paused after ${released} of ${r.waveCount} branches. Next when resumed: ${r.nextBranch || 'none'}.`;
    if (r.holdNote) return `${released} of ${r.waveCount} branches released. ${r.holdNote}`;
    return `${released} of ${r.waveCount} branches released · next: ${next}.`;
};

/**
 * Branch-by-branch rollouts in flight (API 2.8.14). Hidden when there are none and when the API is
 * older than 2.8.14. Polls every 15 s while a rollout is active or paused.
 */
export const RolloutsPanel: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
    const { showNotify, showConfirm } = useUI();
    const [rollouts, setRollouts] = useState<Rollout[]>([]);
    const [supported, setSupported] = useState(true);
    const [failed, setFailed] = useState(false);   // last load failed for a transient reason: keep polling
    const [busyId, setBusyId] = useState<number | null>(null);
    const seq = useRef(0);   // the newest request wins; a slow older answer is dropped

    const load = useCallback(async () => {
        const mine = ++seq.current;
        try {
            const res = await rolloutApi.list();
            if (mine !== seq.current) return;                 // superseded by a later load (or unmounted)
            if (res.success && Array.isArray(res.data)) { setRollouts(res.data); setFailed(false); }
            else if (res.code === 404) setSupported(false);   // older API: no /rollouts route
            else setFailed(true);                             // 5xx / timeout: keep the last list, retry
        } catch {
            if (mine === seq.current) setFailed(true);
        }
    }, []);
    useEffect(() => () => { seq.current++; }, []);   // unmount: no state writes from in-flight loads

    useEffect(() => { void load(); }, [load, refreshKey]);

    const live = rollouts.some(r => r.status === 'active' || r.status === 'paused');
    useEffect(() => {
        if (!supported || (!live && !failed)) return;
        const t = setInterval(() => { void load(); }, POLL_MS);
        return () => clearInterval(t);
    }, [supported, live, failed, load]);

    if (!supported || rollouts.length === 0) return null;

    const act = async (r: Rollout, action: 'pause' | 'resume' | 'cancel') => {
        setBusyId(r.rolloutId);
        try {
            const res = await rolloutApi[action](r.rolloutId);
            if (!res.success) showNotify('Rollout', res.message || `Could not ${action} the rollout.`, 'ERROR');
            await load();
        } catch {
            showNotify('Rollout', `The server could not be reached; the rollout was not ${action}d.`, 'ERROR');
        } finally {
            setBusyId(null);
        }
    };

    const confirmCancel = (r: Rollout) => showConfirm(
        'Cancel rollout?',
        `${r.appliedDevices} screens already have "${r.playlistName || 'this playlist'}" and keep it. The remaining ${r.totalDevices - r.appliedDevices - r.failedDevices} screens will not get it. To take it off the released screens, clear their schedule afterwards.`,
        () => { void act(r, 'cancel'); },
        'ERROR'
    );

    const btn = 'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-xs font-bold uppercase tracking-wider text-foreground hover:bg-muted/30 disabled:opacity-40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50';

    return (
        <section aria-labelledby="rollouts-heading" className="mb-6 rounded-2xl border border-border bg-card/60 overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-3">
                <Clock className="h-4 w-4 text-accent-cyan" aria-hidden="true" />
                <h2 id="rollouts-heading" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Rollouts <span className="font-normal normal-case tracking-normal">· branch by branch, last 24 h</span>
                </h2>
            </div>
            <ul className="divide-y divide-border/60">
                {rollouts.map(r => {
                    const pct = r.totalDevices ? Math.round(((r.appliedDevices + r.failedDevices) / r.totalDevices) * 100) : 0;
                    const busy = busyId === r.rolloutId;
                    return (
                        <li key={r.rolloutId} className="px-5 py-4 flex flex-col gap-3">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="font-bold text-foreground truncate">{r.playlistName || `Playlist ${r.playlistId}`}</span>
                                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider leading-none ${statusChip[r.status]}`}>{r.status}</span>
                                <span className="text-xs text-muted-foreground">every {r.waveMinutes} min · started {fmtTime(r.createdUtc)}</span>
                                <span className="ml-auto text-sm tabular-nums"><span className="font-bold text-foreground">{r.appliedDevices}</span><span className="text-muted-foreground"> / {r.totalDevices} screens</span>{r.failedDevices > 0 && <span className="text-red-500 dark:text-red-400"> · {r.failedDevices} failed</span>}</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}% of screens processed`}>
                                <div className={`h-full rounded-full transition-[width] ${r.status === 'cancelled' ? 'bg-muted-foreground/50' : 'bg-accent-cyan'}`} style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-sm text-foreground leading-snug" aria-live="polite">{describe(r)}</p>
                            <div className="flex flex-wrap items-center gap-2">
                                <ul className="flex flex-wrap gap-1.5 min-w-0" aria-label="Branches">
                                    {r.waves.map(w => (
                                        <li key={w.waveNo} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-none tabular-nums ${w.done ? 'border-green-500/40 text-green-600 dark:text-green-400' : w.started ? 'border-accent-cyan/50 text-accent-cyan' : 'border-border text-muted-foreground'}`} title={w.done ? 'done' : w.started ? 'releasing' : `waits until ${fmtTime(w.notBeforeUtc)}`}>
                                            <span className="font-bold">{w.branchCode}</span>
                                            <span>{w.applied}/{w.devices}</span>
                                        </li>
                                    ))}
                                </ul>
                                {(r.status === 'active' || r.status === 'paused') && (
                                    <div className="flex gap-2 sm:ml-auto">
                                        {r.status === 'active' ? (
                                            <button type="button" className={btn} disabled={busy} onClick={() => { void act(r, 'pause'); }}><Pause className="h-3.5 w-3.5" aria-hidden="true" />Pause</button>
                                        ) : (
                                            <button type="button" className={btn} disabled={busy} onClick={() => { void act(r, 'resume'); }}><Play className="h-3.5 w-3.5" aria-hidden="true" />Resume</button>
                                        )}
                                        <button type="button" className={`${btn} hover:border-red-500/50 hover:text-red-500`} disabled={busy} onClick={() => confirmCancel(r)}><X className="h-3.5 w-3.5" aria-hidden="true" />Cancel</button>
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

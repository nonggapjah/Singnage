'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { statisticsApi } from '@/features/statistics/api/statistics-api';
import { PlaybackSummary, BranchSummary, PlaybackLogExport } from '@/features/statistics/types';
import { useVisibleInterval } from '@/features/ui/hooks/useVisibleInterval';
import { localInputToApiFilter } from '@/features/ui/utils/datetime';
import { getCapabilities } from '@/lib/api-capabilities';

export default function StatisticsPage() {
    // Date Helpers
    const getLocalISOString = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
        return localISOTime;
    };

    const getTodayStart = () => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return getLocalISOString(d);
    };

    const getTodayEnd = () => {
        const d = new Date();
        d.setHours(23, 59, 0, 0);
        return getLocalISOString(d);
    };

    const [startDate, setStartDate] = useState(getTodayStart().split('T')[0]);
    const [startTime, setStartTime] = useState('00:00');
    const [endDate, setEndDate] = useState(getTodayEnd().split('T')[0]);
    const [endTime, setEndTime] = useState('23:59');

    const setQuickRange = (range: 'today' | 'yesterday' | 'week') => {
        const start = new Date();
        const end = new Date();

        if (range === 'today') {
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 0, 0);
        } else if (range === 'yesterday') {
            start.setDate(start.getDate() - 1);
            start.setHours(0, 0, 0, 0);
            end.setDate(end.getDate() - 1);
            end.setHours(23, 59, 0, 0);
        } else if (range === 'week') {
            start.setDate(start.getDate() - 7);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 0, 0);
        }

        const isoStart = getLocalISOString(start);
        const isoEnd = getLocalISOString(end);

        setStartDate(isoStart.split('T')[0]);
        setStartTime(isoStart.split('T')[1]);
        setEndDate(isoEnd.split('T')[0]);
        setEndTime(isoEnd.split('T')[1]);
    };

    const [mediaSummary, setMediaSummary] = useState<PlaybackSummary[]>([]);
    const [branchSummary, setBranchSummary] = useState<BranchSummary[]>([]);
    const [recentLogs, setRecentLogs] = useState<PlaybackLogExport[]>([]);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [playlistMap, setPlaylistMap] = useState<Record<string, string>>({});
    const [exporting, setExporting] = useState(false);

    const fetchData = useCallback(async (silent: boolean = false) => {
        if (!silent) setLoading(true);
        try {
            // Local wall-clock inputs. A 2.8+ API compares UTC (send "Z"); a 2.7.x API subtracts
            // 7 h itself and gets the bare local string (Codex round-3 #18).
            const { utcFilters } = await getCapabilities();
            const startISO = localInputToApiFilter(`${startDate}T${startTime}:00`, utcFilters);
            const endISO = localInputToApiFilter(`${endDate}T${endTime}:59`, utcFilters);

            const [mediaRes, branchRes, logsRes] = await Promise.all([
                statisticsApi.getMediaSummary(startISO, endISO),
                statisticsApi.getBranchSummary(startISO, endISO),
                statisticsApi.getExportData(startISO, endISO)
            ]);

            if (mediaRes.success) setMediaSummary(mediaRes.data || []);
            if (branchRes.success) setBranchSummary(branchRes.data || []);
            if (logsRes.success && logsRes.data) {
                setRecentLogs(logsRes.data.slice(0, 50));
            }
        } catch (error) {
            console.error('Failed to fetch statistics', error);
        } finally {
            setLoading(false);
        }
    }, [startDate, startTime, endDate, endTime]);

    const handleExport = async () => {
        setExporting(true);
        try {
            // Local wall-clock inputs. A 2.8+ API compares UTC (send "Z"); a 2.7.x API subtracts
            // 7 h itself and gets the bare local string (Codex round-3 #18).
            const { utcFilters } = await getCapabilities();
            const startISO = localInputToApiFilter(`${startDate}T${startTime}:00`, utcFilters);
            const endISO = localInputToApiFilter(`${endDate}T${endTime}:59`, utcFilters);
            const res = await statisticsApi.getExportData(startISO, endISO);

            if (res.success && res.data) {
                // One encoder for every cell: quote the field, double any embedded quote, and prefix a
                // single quote to anything starting with a formula character so a media name like
                // Sale "October" or =cmd() can neither break the CSV nor run in a spreadsheet.
                const csvCell = (v: unknown) => {
                    let s = v === null || v === undefined ? '' : String(v);
                    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
                    return `"${s.replace(/"/g, '""')}"`;
                };
                const header = ['Played At', 'Device ID', 'Device Name', 'Branch Code', 'Supplier', 'Playlist ID', 'Playlist Name', 'Media ID', 'Media Name', 'File Name', 'Duration (s)', 'Result'];
                const rows = res.data.map(d => [
                    csvCell(d.playedAt),
                    csvCell(d.deviceId || ''),
                    csvCell(d.deviceName || ''),
                    csvCell(d.branchCode || ''),
                    csvCell(d.supplierCode || ''),
                    csvCell(d.playlistId || ''),
                    csvCell(d.playlistName || (d.playlistId ? (playlistMap[d.playlistId] || '') : '')),
                    csvCell(d.mediaId || ''),
                    csvCell(d.mediaName || ''),
                    csvCell(d.fileName || ''),
                    csvCell(d.durationSec),
                    csvCell(d.result || '')
                ]);

                const csvContent = [header.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\r\n');
                const blob = new Blob(["﻿" + csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.setAttribute('href', url);
                link.setAttribute('download', `playback_logs_${new Date().toISOString().slice(0, 10)}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
                alert('Failed to fetch export data');
            }
        } catch (error) {
            console.error('Export failed', error);
            alert('Export failed');
        } finally {
            setExporting(false);
        }
    };

    const fetchReferenceData = async () => {
        try {
            const playlistRes = await import('@/features/playlists/api/playlist-api').then(m => m.playlistApi.getAll());
            const pMap: Record<string, string> = {};
            if (playlistRes.success && playlistRes.data) {
                playlistRes.data.forEach(p => {
                    pMap[p.playlistId] = p.playlistName;
                });
            }
            setPlaylistMap(pMap);
        } catch (e) { console.error("Ref load failed", e); }
    };

    const isMounted = useRef(false);

    useEffect(() => {
        if (!isMounted.current) {
            isMounted.current = true;
            fetchReferenceData();
            fetchData(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Live mode polls every 15s while the tab is visible.
    const silentRefresh = useCallback(() => fetchData(true), [fetchData]);
    useVisibleInterval(silentRefresh, autoRefresh ? 15000 : null);

    const totalPlays = mediaSummary.reduce((acc, curr) => acc + curr.playCount, 0);

    const fieldClass = 'bg-muted/20 border border-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors dark:[color-scheme:dark]';
    const labelClass = 'text-xs font-black text-muted-foreground uppercase tracking-widest ml-1';

    return (
        <div className="p-8 space-y-8 min-h-screen">
            <div className="flex flex-col md:flex-row justify-between items-end gap-6">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter neon-text mb-2">Playback statistics</h1>
                    <p className="text-sm font-bold text-muted-foreground">
                        Proof of play and content performance
                    </p>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="flex gap-2 justify-end mb-1" role="group" aria-label="Quick date ranges">
                        {(['today', 'yesterday', 'week'] as const).map((r) => (
                            <button
                                type="button"
                                key={r}
                                onClick={() => setQuickRange(r)}
                                className="px-3 py-1 text-xs font-black uppercase tracking-widest bg-muted/10 border border-border hover:border-accent-cyan rounded-full text-muted-foreground hover:text-accent-cyan transition-colors"
                            >
                                {r === 'week' ? 'Last 7 days' : r}
                            </button>
                        ))}
                    </div>

                    <div className="glass-panel p-2 rounded-xl flex flex-col md:flex-row gap-2 items-end">
                        <div className="flex flex-col gap-1">
                            <label htmlFor="stats-start-date" className={labelClass}>Range start (24h)</label>
                            <div className="flex gap-1">
                                <input
                                    id="stats-start-date"
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className={fieldClass}
                                />
                                <input
                                    id="stats-start-time"
                                    aria-label="Range start time"
                                    type="time"
                                    step="60"
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                    className={`${fieldClass} w-24`}
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="stats-end-date" className={labelClass}>Range end (24h)</label>
                            <div className="flex gap-1">
                                <input
                                    id="stats-end-date"
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className={fieldClass}
                                />
                                <input
                                    id="stats-end-time"
                                    aria-label="Range end time"
                                    type="time"
                                    step="60"
                                    value={endTime}
                                    onChange={(e) => setEndTime(e.target.value)}
                                    className={`${fieldClass} w-24`}
                                />
                            </div>
                        </div>

                        <div className="w-px h-8 bg-border mx-2 hidden md:block" aria-hidden="true"></div>

                        <button
                            type="button"
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            aria-pressed={autoRefresh}
                            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-colors border ${autoRefresh
                                ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan'
                                : 'bg-muted/20 border-border text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            {autoRefresh ? 'Live: on' : 'Live: off'}
                        </button>

                        <button
                            type="button"
                            onClick={() => fetchData(false)}
                            className="px-6 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest hover:brightness-110 transition-colors"
                        >
                            Apply
                        </button>
                        <button
                            type="button"
                            onClick={handleExport}
                            disabled={exporting}
                            className="px-4 py-2 rounded-lg bg-muted/20 border border-border text-foreground hover:bg-muted/40 text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                        >
                            {exporting ? 'Exporting…' : 'Export CSV'}
                        </button>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="p-10 text-center text-accent-cyan tracking-widest" role="status">Loading…</div>
            )}

            {!loading && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in">
                        <div className="glass-panel p-6 rounded-2xl bg-gradient-to-br from-accent-cyan/10 to-transparent">
                            <span className="text-xs font-bold text-accent-cyan uppercase tracking-widest">Total plays</span>
                            <div className="text-4xl font-black mt-2 text-foreground">{totalPlays.toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground mt-1 uppercase font-mono">Across all screens</div>
                        </div>
                        <div className="glass-panel p-6 rounded-2xl bg-gradient-to-br from-accent-purple/10 to-transparent">
                            <span className="text-xs font-bold text-accent-purple uppercase tracking-widest">Active branches</span>
                            <div className="text-4xl font-black mt-2 text-foreground">{branchSummary.length}</div>
                            <div className="text-xs text-muted-foreground mt-1 uppercase font-mono">Branches with playback activity</div>
                        </div>
                        <div className="glass-panel p-6 rounded-2xl bg-gradient-to-br from-green-500/10 to-transparent">
                            <span className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-widest">Media items played</span>
                            <div className="text-4xl font-black mt-2 text-foreground">{mediaSummary.length}</div>
                            <div className="text-xs text-muted-foreground mt-1 uppercase font-mono">Unique content files</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 animate-in stagger-1">
                        <section className="glass-panel p-8 rounded-3xl" aria-labelledby="stats-ranking-title">
                            <h3 id="stats-ranking-title" className="text-xl font-black mb-6 flex items-center gap-3 text-foreground">
                                <span className="text-accent-cyan" aria-hidden="true">▍</span> Content ranking
                            </h3>
                            <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                                {mediaSummary.map((m, i) => {
                                    const percentage = totalPlays > 0 ? (m.playCount / totalPlays) * 100 : 0;
                                    return (
                                        <div key={i} className="group">
                                            <div className="flex justify-between items-end mb-2 gap-4">
                                                <div className="min-w-0">
                                                    <div className="text-sm font-bold text-foreground group-hover:text-accent-cyan transition-colors truncate">{m.displayName || m.fileName}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">Last played: {new Date(m.lastPlayed).toLocaleString()}</div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <div className="text-sm font-black text-accent-cyan">{m.playCount.toLocaleString()} plays</div>
                                                    <div className="text-xs text-muted-foreground font-bold uppercase">{Math.round(m.totalDurationSec / 60)} min total</div>
                                                </div>
                                            </div>
                                            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)} aria-label={`${m.displayName || m.fileName} share of plays`}>
                                                <div
                                                    className="h-full bg-gradient-to-r from-accent-cyan to-accent-purple"
                                                    style={{ width: `${Math.max(percentage, 2)}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                                {mediaSummary.length === 0 && (
                                    <div className="text-center py-20 text-muted-foreground uppercase tracking-widest font-mono text-xs">No playback data in this period</div>
                                )}
                            </div>
                        </section>

                        <section className="glass-panel p-8 rounded-3xl" aria-labelledby="stats-branch-title">
                            <h3 id="stats-branch-title" className="text-xl font-black mb-6 flex items-center gap-3 text-foreground">
                                <span className="text-accent-purple" aria-hidden="true">▍</span> Activity by branch
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                                {branchSummary.map((b, i) => (
                                    <div key={i} className="p-4 rounded-2xl bg-card border border-border hover:border-accent-purple/30 transition-colors flex justify-between items-center group">
                                        <div>
                                            <div className="text-xs font-bold text-muted-foreground uppercase tracking-tighter mb-1">Branch</div>
                                            <div className="text-lg font-black text-foreground group-hover:text-accent-purple transition-colors">{b.branchCode}</div>
                                            <div className="text-xs text-muted-foreground font-mono mt-1">{b.deviceCount} active screens</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-2xl font-black text-foreground/80">{b.playCount}</div>
                                            <div className="text-xs font-bold text-accent-purple uppercase tracking-widest">plays</div>
                                        </div>
                                    </div>
                                ))}
                                {branchSummary.length === 0 && (
                                    <div className="col-span-full text-center py-20 text-muted-foreground uppercase tracking-widest font-mono text-xs">No branch activity in this period</div>
                                )}
                            </div>
                        </section>
                    </div>

                    <section className="glass-panel p-8 rounded-3xl animate-in stagger-2" aria-labelledby="stats-recent-title">
                        <h3 id="stats-recent-title" className="text-xl font-black mb-6 flex items-center justify-between text-foreground">
                            <span className="flex items-center gap-3">
                                <span className="text-accent-cyan" aria-hidden="true">▍</span> Recent proof of play (latest 50)
                            </span>
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-border/50 bg-muted/10">
                                        <th scope="col" className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Timestamp</th>
                                        <th scope="col" className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Device / branch</th>
                                        <th scope="col" className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Content</th>
                                        <th scope="col" className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Playlist</th>
                                        <th scope="col" className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Dur.</th>
                                        <th scope="col" className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30">
                                    {recentLogs.map((log, i) => (
                                        <tr key={`stat-log-${i}`} className="hover:bg-muted/20 transition-colors group">
                                            <td className="p-4 text-xs font-mono text-muted-foreground group-hover:text-foreground whitespace-nowrap">
                                                {new Date(log.playedAt).toLocaleString()}
                                            </td>
                                            <td className="p-4">
                                                <div className="text-xs font-bold text-foreground">{log.deviceName || 'Unknown'}</div>
                                                <div className="text-xs text-muted-foreground uppercase">{log.branchCode || 'No branch'}</div>
                                            </td>
                                            <td className="p-4">
                                                <div className="text-xs font-bold text-accent-cyan">{log.mediaName || log.fileName}</div>
                                                <div className="text-xs text-muted-foreground font-mono">{log.fileName}</div>
                                            </td>
                                            <td className="p-4 text-xs font-mono text-muted-foreground">
                                                {log.playlistId ? (
                                                    <span className="text-accent-purple font-bold">
                                                        {log.playlistName || (log.playlistId ? (playlistMap[log.playlistId] || log.playlistId.substring(0, 8) + '…') : '')}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td className="p-4 text-right text-xs font-bold text-foreground">
                                                {log.durationSec}s
                                            </td>
                                            <td className="p-4 text-right">
                                                <span className={`px-2 py-0.5 rounded-[4px] text-xs font-black uppercase tracking-tighter border ${log.result === 'COMPLETED' || log.result === 'success'
                                                    ? 'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20'
                                                    : 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20'
                                                    }`}>
                                                    {log.result}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {recentLogs.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="p-20 text-center text-muted-foreground text-xs uppercase tracking-widest">
                                                No playback logs in this period
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}

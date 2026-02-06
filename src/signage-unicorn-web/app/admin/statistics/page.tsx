'use client';

import React, { useState, useEffect } from 'react';
import { statisticsApi } from '@/features/statistics/api/statistics-api';
import { PlaybackSummary, BranchSummary, PlaybackLogExport } from '@/features/statistics/types';
import { useUI } from '@/features/ui/context/UIContext';

export default function StatisticsPage() {
    const { theme } = useUI();

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
        d.setHours(23, 59, 59, 999);
        return getLocalISOString(d);
    };

    const [startDate, setStartDate] = useState(getTodayStart());
    const [endDate, setEndDate] = useState(getTodayEnd());

    const [mediaSummary, setMediaSummary] = useState<PlaybackSummary[]>([]);
    const [branchSummary, setBranchSummary] = useState<BranchSummary[]>([]);
    const [recentLogs, setRecentLogs] = useState<PlaybackLogExport[]>([]);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(false);

    const [playlistMap, setPlaylistMap] = useState<Record<string, string>>({});

    const fetchData = async (silent: boolean = false) => {
        if (!silent) setLoading(true);
        try {
            // Fix: Send Local Time to Backend (avoid UTC shift)
            const startISO = startDate.length === 16 ? startDate + ':00' : startDate;
            const endISO = endDate.length === 16 ? endDate + ':59' : endDate;

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
    };

    const [exporting, setExporting] = useState(false);

    const handleExport = async () => {
        setExporting(true);
        try {
            // Fix: Send Local Time to Backend because DB stores in Local Time (GETDATE())
            // If we use .toISOString(), it converts to UTC, shifting time back by 7 hours (in TH),
            // causing previous day's data to appear.
            const startISO = startDate.length === 16 ? startDate + ':00' : startDate;
            const endISO = endDate.length === 16 ? endDate + ':59' : endDate;
            const res = await statisticsApi.getExportData(startISO, endISO);

            if (res.success && res.data) {
                // Convert to CSV
                const header = ['Played At', 'Device ID', 'Device Name', 'Branch Code', 'Playlist ID', 'Media Name', 'File Name', 'Duration (s)', 'Result'];
                const rows = res.data.map(d => [
                    `"${d.playedAt}"`,
                    `"${d.deviceId || ''}"`,
                    `"${d.deviceName || ''}"`,
                    `"${d.branchCode || ''}"`,
                    `"${d.playlistId || ''}"`,
                    `"${d.mediaName || ''}"`,
                    `"${d.fileName || ''}"`,
                    d.durationSec,
                    d.result
                ]);

                const csvContent = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
                // Add BOM for Excel UTF-8 compatibility
                const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.setAttribute('href', url);
                link.setAttribute('download', `playback_logs_${new Date().toISOString().slice(0, 10)}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
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

    // Initial Data Load
    const isMounted = React.useRef(false);

    useEffect(() => {
        if (!isMounted.current) {
            isMounted.current = true;
            fetchReferenceData();
            fetchData(false);
        }
    }, [startDate, endDate]); // Re-fetch on manual date change? Previous code didn't. 
    // Wait, previous code had [] for initial load, and NO dependency for date change unless autoRefresh was on.
    // That means manual date change didn't trigger fetch unless user clicked "Filter".
    // I will keep the behavior: Only fetch on mount (once) and when button clicked or auto-refresh.

    // Auto Refresh Logic
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (autoRefresh) {
            interval = setInterval(() => fetchData(true), 15000);
        }
        return () => clearInterval(interval);
    }, [autoRefresh, startDate, endDate]);

    const totalPlays = mediaSummary.reduce((acc, curr) => acc + curr.playCount, 0);

    return (
        <div className="p-8 space-y-8 min-h-screen">
            {/* Header & Controls */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-6">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter neon-text mb-2">Playback Analytics</h1>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-[0.3em]">
                        Proof of Play & Content Performance
                    </p>
                </div>

                {/* Date Filter Controls */}
                <div className="glass-panel p-2 rounded-xl border border-border flex flex-col md:flex-row gap-2 items-center">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">Start Time</label>
                        <input
                            type="datetime-local"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-muted/20 border border-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-accent-cyan transition-colors dark:[color-scheme:dark]"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">End Time</label>
                        <input
                            type="datetime-local"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-muted/20 border border-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-accent-cyan transition-colors dark:[color-scheme:dark]"
                        />
                    </div>

                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`h-full px-4 py-2 mt-auto rounded-lg text-xs font-black uppercase tracking-widest transition-all border ${autoRefresh
                            ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                            : 'bg-muted/20 border-border text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        {autoRefresh ? 'Live On' : 'Live Off'}
                    </button>

                    <button
                        onClick={() => fetchData(false)}
                        className="h-full px-6 py-2 mt-auto rounded-lg bg-accent-cyan text-black text-xs font-black uppercase tracking-widest hover:bg-cyan-300 transition-all shadow-[0_0_15px_rgba(34,211,238,0.3)]"
                    >
                        Filter
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={exporting}
                        className="h-full px-4 py-2 mt-auto rounded-lg bg-muted/20 border border-border text-foreground hover:bg-muted/40 text-xs font-black uppercase tracking-widest transition-all"
                    >
                        {exporting ? '...' : 'Export'}
                    </button>
                </div>
            </div>

            {loading && (
                <div className="p-10 text-center animate-pulse text-accent-cyan tracking-widest">CALCULATING ANALYTICS...</div>
            )}

            {!loading && (
                <>
                    {/* Top Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="glass-panel p-6 rounded-2xl border border-border/50 bg-gradient-to-br from-accent-cyan/10 to-transparent">
                            <span className="text-xs font-bold text-accent-cyan uppercase tracking-widest">Total Playbacks</span>
                            <div className="text-4xl font-black mt-2 text-foreground">{totalPlays.toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground mt-1 uppercase font-mono">Aggregated across all nodes</div>
                        </div>
                        <div className="glass-panel p-6 rounded-2xl border border-border/50 bg-gradient-to-br from-accent-purple/10 to-transparent">
                            <span className="text-xs font-bold text-accent-purple uppercase tracking-widest">Active Branches</span>
                            <div className="text-4xl font-black mt-2 text-foreground">{branchSummary.length}</div>
                            <div className="text-xs text-muted-foreground mt-1 uppercase font-mono">Branches with playback activity</div>
                        </div>
                        <div className="glass-panel p-6 rounded-2xl border border-border/50 bg-gradient-to-br from-green-500/10 to-transparent">
                            <span className="text-xs font-bold text-green-400 uppercase tracking-widest">Total Media Items</span>
                            <div className="text-4xl font-black mt-2 text-foreground">{mediaSummary.length}</div>
                            <div className="text-xs text-muted-foreground mt-1 uppercase font-mono">Unique content files played</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        {/* Media Performance */}
                        <div className="glass-panel p-8 rounded-3xl border border-border/50">
                            <h3 className="text-xl font-black mb-6 flex items-center gap-3 italic text-foreground">
                                <span className="text-accent-cyan">▍</span> Content Performance Ranking
                            </h3>
                            <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                                {mediaSummary.map((m, i) => {
                                    const percentage = totalPlays > 0 ? (m.playCount / totalPlays) * 100 : 0;
                                    return (
                                        <div key={i} className="group">
                                            <div className="flex justify-between items-end mb-2">
                                                <div>
                                                    <div className="text-sm font-bold text-foreground group-hover:text-accent-cyan transition-colors">{m.displayName || m.fileName}</div>
                                                    <div className="text-xs text-muted-foreground font-mono italic">Last Played: {new Date(m.lastPlayed).toLocaleString()}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-sm font-black text-accent-cyan">{m.playCount.toLocaleString()} Plays</div>
                                                    <div className="text-xs text-muted-foreground font-bold uppercase">{Math.round(m.totalDurationSec / 60)} MIN TOTAL</div>
                                                </div>
                                            </div>
                                            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-accent-cyan to-accent-purple transition-all duration-1000"
                                                    style={{ width: `${Math.max(percentage, 2)}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                                {mediaSummary.length === 0 && (
                                    <div className="text-center py-20 text-muted-foreground uppercase tracking-widest font-mono text-xs">No playback data detected within this period</div>
                                )}
                            </div>
                        </div>

                        {/* Branch Distribution */}
                        <div className="glass-panel p-8 rounded-3xl border border-border/50">
                            <h3 className="text-xl font-black mb-6 flex items-center gap-3 italic text-foreground">
                                <span className="text-accent-purple">▍</span> Regional Activity
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                                {branchSummary.map((b, i) => (
                                    <div key={i} className="p-4 rounded-2xl bg-card border border-border hover:border-accent-purple/30 transition-all flex justify-between items-center group">
                                        <div>
                                            <div className="text-xs font-bold text-muted-foreground uppercase tracking-tighter mb-1">Store / Location</div>
                                            <div className="text-lg font-black text-foreground group-hover:text-accent-purple transition-colors">{b.branchCode}</div>
                                            <div className="text-xs text-muted-foreground font-mono mt-1">{b.deviceCount} ACTIVE SCREENS</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-2xl font-black text-foreground/80">{b.playCount}</div>
                                            <div className="text-xs font-bold text-accent-purple uppercase tracking-widest">TOTAL LOGS</div>
                                        </div>
                                    </div>
                                ))}
                                {branchSummary.length === 0 && (
                                    <div className="col-span-full text-center py-20 text-muted-foreground uppercase tracking-widest font-mono text-xs">Waiting for regional transmission incoming...</div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Detailed Proof of Play */}
                    <div className="glass-panel p-8 rounded-3xl border border-border/50 animate-in fade-in slide-in-from-bottom-12 duration-1000">
                        <h3 className="text-xl font-black mb-6 flex items-center justify-between italic text-foreground">
                            <span className="flex items-center gap-3">
                                <span className="text-accent-cyan">▍</span> Live Proof-of-Play (Recent 50)
                            </span>
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-border/50 bg-muted/10">
                                        <th className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Timestamp</th>
                                        <th className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Device / Branch</th>
                                        <th className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Content</th>
                                        <th className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Playlist Context</th>
                                        <th className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Dur.</th>
                                        <th className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest text-right">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30">
                                    {recentLogs.map((log, i) => (
                                        <tr key={`stat-log-${i}`} className="hover:bg-muted/20 transition-colors group">
                                            <td className="p-4 text-xs font-mono text-muted-foreground group-hover:text-foreground">
                                                {new Date(log.playedAt).toLocaleString()}
                                            </td>
                                            <td className="p-4">
                                                <div className="text-xs font-bold text-foreground">{log.deviceName || 'Unknown'}</div>
                                                <div className="text-xs text-muted-foreground uppercase">{log.branchCode || 'No Branch'}</div>
                                            </td>
                                            <td className="p-4">
                                                <div className="text-xs font-bold text-accent-cyan">{log.mediaName || log.fileName}</div>
                                                <div className="text-xs text-muted-foreground font-mono">{log.fileName}</div>
                                            </td>
                                            <td className="p-4 text-xs font-mono text-muted-foreground">
                                                {log.playlistId ? (
                                                    <span className="text-accent-purple font-bold">
                                                        {playlistMap[log.playlistId] || log.playlistId.substring(0, 8) + '...'}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td className="p-4 text-right text-xs font-bold text-foreground">
                                                {log.durationSec}s
                                            </td>
                                            <td className="p-4 text-right">
                                                <span className={`px-2 py-0.5 rounded-[4px] text-xs font-black uppercase tracking-tighter border ${log.result === 'COMPLETED' || log.result === 'success'
                                                    ? 'text-green-400 bg-green-500/10 border-green-500/20'
                                                    : 'text-red-400 bg-red-500/10 border-red-500/20'
                                                    }`}>
                                                    {log.result}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {recentLogs.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="p-20 text-center text-muted-foreground text-xs uppercase tracking-widest">
                                                Zero transmission logs detected in current viewport
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

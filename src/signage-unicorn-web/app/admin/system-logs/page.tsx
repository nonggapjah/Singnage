'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { useUI } from '@/features/ui/context/UIContext';
import { useVisibleInterval } from '@/features/ui/hooks/useVisibleInterval';
import { localInputToApiFilter } from '@/features/ui/utils/datetime';
import { getCapabilities } from '@/lib/api-capabilities';

interface SystemLog {
    logId: string;
    deviceId: string | null;
    logType: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';
    message: string;
    source: string;
    createdAt: string;
}

export default function SystemLogsPage() {
    // Helper
    const getLocalISOString = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        return (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
    };

    // Filter State
    const [startDate, setStartDate] = useState(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return getLocalISOString(d).split('T')[0];
    });
    const [startTime, setStartTime] = useState('00:00');

    const [endDate, setEndDate] = useState(() => {
        const d = new Date();
        d.setHours(23, 59, 0, 0);
        return getLocalISOString(d).split('T')[0];
    });
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
        setPage(1);
    };

    const [filterType, setFilterType] = useState<string>('CRITICAL');
    const [page, setPage] = useState(1);
    const pageSize = 50;

    const logLevels = [
        { value: 'ALL', label: 'All levels' },
        { value: 'INFO', label: 'Info' },
        { value: 'WARNING', label: 'Warning' },
        { value: 'ERROR', label: 'Error' },
        { value: 'DEBUG', label: 'Debug' },
    ];

    // Data State
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            // Local wall-clock inputs -> UTC "Z" on a 2.8+ API, bare local string on 2.7.x (#18).
            const { utcFilters } = await getCapabilities();
            const query = new URLSearchParams({
                startDate: localInputToApiFilter(`${startDate}T${startTime}:00`, utcFilters),
                endDate: localInputToApiFilter(`${endDate}T${endTime}:59`, utcFilters),
                page: page.toString(),
                pageSize: pageSize.toString()
            });

            if (filterType === 'CRITICAL') {
                query.append('logType', 'ERROR,WARNING');
            } else if (filterType === 'ERROR_ONLY') {
                query.append('logType', 'ERROR');
            } else if (filterType !== 'ALL') {
                query.append('logType', filterType);
            }

            const res = await apiFetch(`/logs?${query.toString()}`);
            if (res.success && res.data) {
                setLogs(res.data);
            } else {
                setLogs([]);
            }
        } catch (error) {
            console.error('Failed to fetch logs', error);
        } finally {
            setLoading(false);
        }
    }, [startDate, startTime, endDate, endTime, filterType, page]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    // Live mode polls every 5s while the tab is visible.
    useVisibleInterval(fetchLogs, autoRefresh ? 5000 : null);

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'ERROR': return 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20';
            case 'WARNING': return 'text-yellow-700 dark:text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
            case 'DEBUG': return 'text-muted-foreground bg-muted/20 border-border';
            default: return 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/20';
        }
    };

    const { showConfirm, showNotify } = useUI();

    const handleCleanup = () => {
        showConfirm(
            'Delete old logs',
            'Remove all system logs older than the configured retention period? This cannot be undone.',
            async () => {
                try {
                    const res = await apiFetch('/logs', { method: 'DELETE' });
                    if (res.success) {
                        showNotify('Cleanup complete', 'Old system logs have been deleted.', 'SUCCESS');
                        fetchLogs();
                    } else {
                        showNotify('Cleanup failed', res.message || 'Delete failed', 'ERROR');
                    }
                } catch {
                    showNotify('Error', 'Could not reach the API.', 'ERROR');
                }
            },
            'DANGER'
        );
    };

    const fieldClass = 'bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 transition-colors dark:[color-scheme:dark]';
    const labelClass = 'text-xs font-black text-muted-foreground uppercase tracking-widest ml-1';

    return (
        <div className="p-8 space-y-8 min-h-screen">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-6">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter neon-text mb-2">System logs</h1>
                    <p className="text-sm font-bold text-muted-foreground">
                        Events reported by the API and the screens
                    </p>
                </div>

                {/* Filters */}
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

                    <div className="glass-panel p-2 rounded-xl flex flex-wrap gap-2 items-end">
                        <div className="flex flex-col gap-1">
                            <label htmlFor="logs-start-date" className={labelClass}>Start (24h)</label>
                            <div className="flex gap-1">
                                <input
                                    id="logs-start-date"
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className={fieldClass}
                                />
                                <input
                                    id="logs-start-time"
                                    aria-label="Start time"
                                    type="time"
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                    className={`${fieldClass} w-24`}
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label htmlFor="logs-end-date" className={labelClass}>End (24h)</label>
                            <div className="flex gap-1">
                                <input
                                    id="logs-end-date"
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className={fieldClass}
                                />
                                <input
                                    id="logs-end-time"
                                    aria-label="End time"
                                    type="time"
                                    value={endTime}
                                    onChange={(e) => setEndTime(e.target.value)}
                                    className={`${fieldClass} w-24`}
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-1 relative">
                            <label htmlFor="logs-level" className={labelClass}>Level</label>
                            <select
                                id="logs-level"
                                value={filterType}
                                onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
                                className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground font-bold uppercase focus:outline-none focus:border-accent-cyan transition-colors h-[34px] min-w-[160px]"
                            >
                                <option value="CRITICAL">Warnings + errors</option>
                                <option value="ERROR_ONLY">Errors only</option>
                                {logLevels.map((level) => (
                                    <option key={level.value} value={level.value}>
                                        {level.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="w-px h-8 bg-border mx-2 hidden sm:block" aria-hidden="true"></div>

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
                            onClick={handleCleanup}
                            className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-colors"
                            title="Delete logs older than the retention period"
                        >
                            Cleanup
                        </button>

                        <button
                            type="button"
                            onClick={() => fetchLogs()}
                            className="px-6 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest hover:brightness-110 transition-colors"
                        >
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="glass-panel p-1 rounded-2xl overflow-hidden min-h-[600px] flex flex-col" aria-busy={loading}>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-border/50 bg-muted/10">
                                <th scope="col" className="p-4 w-48 text-xs font-black text-muted-foreground uppercase tracking-widest">Timestamp</th>
                                <th scope="col" className="p-4 w-24 text-xs font-black text-muted-foreground uppercase tracking-widest">Level</th>
                                <th scope="col" className="p-4 w-32 text-xs font-black text-muted-foreground uppercase tracking-widest">Source</th>
                                <th scope="col" className="p-4 w-48 text-xs font-black text-muted-foreground uppercase tracking-widest">Device ID</th>
                                <th scope="col" className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Message</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {loading && logs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-20 text-center">
                                        <div className="text-accent-cyan tracking-widest text-xs uppercase font-bold" role="status">Loading…</div>
                                    </td>
                                </tr>
                            ) : logs.map((log, index) => (
                                <tr key={`log-${index}-${log.logId || 'unknown'}`} className="hover:bg-muted/20 transition-colors group">
                                    <td className="p-4 text-xs font-mono text-muted-foreground whitespace-nowrap group-hover:text-foreground">
                                        {new Date(log.createdAt).toLocaleString()}
                                    </td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded text-xs font-black uppercase tracking-wider border ${getTypeColor(log.logType)}`}>
                                            {log.logType}
                                        </span>
                                    </td>
                                    <td className="p-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                        {log.source || 'API'}
                                    </td>
                                    <td className="p-4 text-xs font-mono text-muted-foreground">
                                        {log.deviceId ? (
                                            <span className="text-accent-purple bg-accent-purple/5 px-2 py-0.5 rounded" title={log.deviceId}>{log.deviceId.substring(0, 8)}…</span>
                                        ) : (
                                            <span className="opacity-40">-</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-xs text-foreground/90 break-all font-medium leading-relaxed">
                                        {log.message}
                                    </td>
                                </tr>
                            ))}
                            {!loading && logs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-20 text-center text-muted-foreground text-xs uppercase tracking-widest">
                                        No logs match the current filters
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <nav className="mt-auto p-4 border-t border-border/50 flex justify-between items-center bg-muted/5" aria-label="Pagination">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Page {page}
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="px-4 py-2 rounded-lg bg-muted/20 border border-border text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-foreground"
                        >
                            Previous
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage(p => p + 1)}
                            disabled={logs.length < pageSize}
                            className="px-4 py-2 rounded-lg bg-muted/20 border border-border text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-foreground"
                        >
                            Next
                        </button>
                    </div>
                </nav>
            </div>
        </div>
    );
}

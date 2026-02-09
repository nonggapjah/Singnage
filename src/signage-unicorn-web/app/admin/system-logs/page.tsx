'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { useUI } from '@/features/ui/context/UIContext';

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

    const [filterType, setFilterType] = useState<string>('ALL');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [page, setPage] = useState(1);
    const pageSize = 50;

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const logLevels = [
        { value: 'ALL', label: 'ALL LEVELS' },
        { value: 'INFO', label: 'INFO' },
        { value: 'WARNING', label: 'WARNING' },
        { value: 'ERROR', label: 'ERROR' },
        { value: 'DEBUG', label: 'DEBUG' },
    ];

    // Data State
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams({
                startDate: `${startDate}T${startTime}:00`,
                endDate: `${endDate}T${endTime}:59`,
                page: page.toString(),
                pageSize: pageSize.toString()
            });

            if (filterType !== 'ALL') {
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

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (autoRefresh) {
            interval = setInterval(fetchLogs, 5000);
        }
        return () => clearInterval(interval);
    }, [autoRefresh, fetchLogs]);

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'ERROR': return 'text-red-500 bg-red-500/10 border-red-500/20';
            case 'WARNING': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
            case 'DEBUG': return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
            default: return 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/20';
        }
    };

    return (
        <div className="p-8 space-y-8 min-h-screen">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-end gap-6">
                <div>
                    <h1 className="text-4xl font-black uppercase tracking-tighter neon-text mb-2">System Logs</h1>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-[0.3em]">
                        Real-time Activity & Diagnostics
                    </p>
                </div>

                {/* Filters */}
                <div className="flex flex-col gap-4">
                    <div className="flex gap-2 justify-end mb-1">
                        {['today', 'yesterday', 'week'].map((r) => (
                            <button
                                key={r}
                                onClick={() => setQuickRange(r as any)}
                                className="px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-muted/10 border border-border hover:border-accent-cyan rounded-full text-muted-foreground hover:text-accent-cyan transition-all"
                            >
                                {r}
                            </button>
                        ))}
                    </div>

                    <div className="glass-panel p-2 rounded-xl border border-border flex flex-wrap gap-2 items-center">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">Start (24H)</label>
                            <div className="flex gap-1">
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-accent-cyan transition-colors dark:[color-scheme:dark]"
                                />
                                <input
                                    type="time"
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                    className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-accent-cyan transition-colors dark:[color-scheme:dark] w-20"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">End (24H)</label>
                            <div className="flex gap-1">
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-accent-cyan transition-colors dark:[color-scheme:dark]"
                                />
                                <input
                                    type="time"
                                    value={endTime}
                                    onChange={(e) => setEndTime(e.target.value)}
                                    className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:border-accent-cyan transition-colors dark:[color-scheme:dark] w-20"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-1 relative z-50">
                            <label className="text-[10px] font-black text-muted-foreground uppercase tracking-widest ml-1">Level</label>
                            <div ref={dropdownRef} className="relative">
                                <button
                                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                    className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs text-foreground font-bold uppercase focus:outline-none focus:border-accent-cyan transition-colors h-[34px] min-w-[120px] text-left flex justify-between items-center"
                                >
                                    <span>{logLevels.find(l => l.value === filterType)?.label}</span>
                                    <span className="opacity-50 ml-2">▼</span>
                                </button>

                                {isDropdownOpen && (
                                    <div className="absolute top-full mt-1 left-0 w-full min-w-[120px] bg-card border border-border rounded-lg shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100">
                                        {logLevels.map((level) => (
                                            <button
                                                key={level.value}
                                                onClick={() => {
                                                    setFilterType(level.value);
                                                    setIsDropdownOpen(false);
                                                }}
                                                className={`px-3 py-2 text-xs font-bold text-left uppercase transition-colors hover:bg-muted ${filterType === level.value ? 'bg-accent-cyan/10 text-accent-cyan' : 'text-foreground'
                                                    }`}
                                            >
                                                {level.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="w-px h-8 bg-border mx-2"></div>

                        <button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all border ${autoRefresh
                                ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan shadow-[0_0_10px_rgba(34,211,238,0.2)]'
                                : 'bg-muted/20 border-border text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            {autoRefresh ? 'Live On' : 'Live Off'}
                        </button>

                        <button
                            onClick={() => fetchLogs()}
                            className="px-6 py-2 rounded-lg bg-accent-cyan text-black text-xs font-black uppercase tracking-widest hover:bg-cyan-300 transition-all shadow-[0_0_15px_rgba(34,211,238,0.3)]"
                        >
                            Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="glass-panel p-1 rounded-2xl overflow-hidden border border-border/50 min-h-[600px] flex flex-col">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-border/50 bg-muted/10">
                                <th className="p-4 w-48 text-xs font-black text-muted-foreground uppercase tracking-widest">Timestamp</th>
                                <th className="p-4 w-24 text-xs font-black text-muted-foreground uppercase tracking-widest">Level</th>
                                <th className="p-4 w-32 text-xs font-black text-muted-foreground uppercase tracking-widest">Source</th>
                                <th className="p-4 w-48 text-xs font-black text-muted-foreground uppercase tracking-widest">Device ID</th>
                                <th className="p-4 text-xs font-black text-muted-foreground uppercase tracking-widest">Message</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {loading && logs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-20 text-center">
                                        <div className="animate-pulse text-accent-cyan tracking-widest text-xs uppercase font-bold">Retrieving System Events...</div>
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
                                    <td className="p-4 text-xs font-bold text-muted-foreground/70 uppercase tracking-widest">
                                        {log.source || 'API'}
                                    </td>
                                    <td className="p-4 text-xs font-mono text-muted-foreground">
                                        {log.deviceId ? (
                                            <span className="text-accent-purple bg-accent-purple/5 px-2 py-0.5 rounded">{log.deviceId.substring(0, 8)}...</span>
                                        ) : (
                                            <span className="opacity-30">-</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-xs text-foreground/80 break-all font-medium leading-relaxed">
                                        {log.message}
                                    </td>
                                </tr>
                            ))}
                            {!loading && logs.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="p-20 text-center text-muted-foreground text-xs uppercase tracking-widest">
                                        No logs found matching criteria
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="mt-auto p-4 border-t border-border/50 flex justify-between items-center bg-muted/5">
                    <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Showing Page {page}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="px-4 py-2 rounded-lg bg-muted/20 border border-border text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            Previous
                        </button>
                        <button
                            onClick={() => setPage(p => p + 1)}
                            disabled={logs.length < pageSize}
                            className="px-4 py-2 rounded-lg bg-muted/20 border border-border text-xs font-black uppercase tracking-widest hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

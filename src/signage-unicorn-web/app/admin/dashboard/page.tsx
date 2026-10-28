'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { dashboardApi, DashboardStats } from '@/features/dashboard/api/dashboard-api';
import { SystemConfigModal } from '@/features/system/components/SystemConfigModal';
import { useVisibleInterval } from '@/features/ui/hooks/useVisibleInterval';
import { SYSTEM_VERSION } from '@/lib/constants';
import { Monitor, MonitorOff, FolderOpen, ListVideo, ScrollText, BarChart2, Settings } from 'lucide-react';

export default function DashboardPage() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isConfigOpen, setIsConfigOpen] = useState(false);

    const loadDashboard = useCallback(async () => {
        const res = await dashboardApi.getStats();
        if (res.success && res.data) {
            setStats(res.data);
            setLastUpdated(new Date());
        }
        setLoading(false);
    }, []);

    // Load on mount, then auto-refresh every 15s while the tab is visible.
    useVisibleInterval(loadDashboard, 15000, { runOnMount: true });

    const total = stats?.totalDevices ?? 0;
    const online = stats?.onlineDevices ?? 0;
    const offline = stats?.offlineDevices ?? Math.max(0, total - online);

    const tiles = [
        { label: 'Screens online', value: online, hint: `of ${total} registered`, icon: Monitor, href: '/admin/devices?status=ONLINE', tone: 'text-green-600 dark:text-green-400' },
        { label: 'Screens offline', value: offline, hint: offline > 0 ? 'needs attention' : 'all screens reporting', icon: MonitorOff, href: '/admin/devices?status=OFFLINE', tone: offline > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground' },
        { label: 'Media files', value: stats?.totalMedia ?? 0, hint: 'in the library', icon: FolderOpen, href: '/admin/media', tone: 'text-foreground' },
        { label: 'Playlists', value: stats?.totalPlaylists ?? 0, hint: 'configured', icon: ListVideo, href: '/admin/playlists', tone: 'text-foreground' },
    ];

    const alerts = stats?.recentAlerts ?? [];

    return (
        <div className="p-6 lg:p-10 space-y-10 max-w-[1800px] mx-auto page-transition">
            {/* --- Header --- */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8 animate-in">
                <div className="space-y-3 max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-cyan/10 border border-accent-cyan/20 text-accent-cyan text-xs font-black uppercase tracking-widest" role="status">
                        <span className={`w-1.5 h-1.5 rounded-full ${stats ? 'bg-accent-cyan' : 'bg-muted-foreground'}`} aria-hidden="true"></span>
                        {loading ? 'Loading…' : `${online} of ${total} screens online`}
                    </div>
                    <h1 className="text-5xl font-black tracking-tighter uppercase neon-text leading-none">
                        Dashboard
                    </h1>
                    <p className="text-muted-foreground text-base font-medium leading-relaxed">
                        {stats?.totalMedia ?? 0} media files across {stats?.totalPlaylists ?? 0} playlists.
                        {lastUpdated && <span className="ml-1 text-xs">Updated {lastUpdated.toLocaleTimeString()}.</span>}
                    </p>
                </div>

                <div className="flex gap-3 flex-wrap">
                    <button
                        type="button"
                        onClick={() => setIsConfigOpen(true)}
                        className="w-12 h-12 flex items-center justify-center rounded-2xl bg-muted/20 border border-border hover:bg-muted/40 transition-colors text-foreground"
                        title="Server address settings"
                        aria-label="Server address settings"
                    >
                        <Settings size={20} aria-hidden="true" />
                    </button>
                    <Link href="/admin/statistics" className="px-6 py-3 rounded-2xl bg-muted/20 border border-border text-xs font-black uppercase tracking-widest hover:bg-muted/40 transition-colors text-foreground inline-flex items-center gap-2">
                        <BarChart2 size={16} aria-hidden="true" /> Playback stats
                    </Link>
                    <Link href="/admin/devices" className="btn-primary">
                        Manage devices
                    </Link>
                </div>
            </div>

            <SystemConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} />

            {/* --- Main Dashboard Grid --- */}
            <div className="dashboard-grid">

                {/* Stat tiles */}
                <div className="col-span-12 grid grid-cols-2 lg:grid-cols-4 gap-4 animate-in stagger-1">
                    {tiles.map((tile) => (
                        <Link
                            key={tile.label}
                            href={tile.href}
                            className="glass-card p-6 rounded-3xl flex flex-col justify-between min-h-[160px] group bg-card"
                        >
                            <div className="flex justify-between items-start">
                                <tile.icon size={22} className="text-muted-foreground group-hover:text-accent-cyan transition-colors" aria-hidden="true" />
                            </div>
                            <div className="mt-auto">
                                <p className="text-xs text-muted-foreground uppercase font-black tracking-widest">{tile.label}</p>
                                <div className={`text-3xl font-black flex items-baseline gap-2 ${tile.tone}`}>
                                    {loading ? '–' : tile.value}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">{tile.hint}</p>
                            </div>
                        </Link>
                    ))}
                </div>

                {/* Recent alerts */}
                <section className="col-span-12 lg:col-span-8 glass-panel rounded-[2rem] p-6 sm:p-8 relative overflow-hidden animate-in stagger-2 bg-card" aria-labelledby="dash-alerts-title">
                    <div className="flex justify-between items-start gap-4 mb-6">
                        <div>
                            <h2 id="dash-alerts-title" className="text-2xl font-black text-foreground uppercase tracking-tight">Recent alerts</h2>
                            <p className="text-sm text-muted-foreground mt-1">Warnings and errors reported by the API and the screens</p>
                        </div>
                        <Link href="/admin/system-logs" className="text-xs font-black uppercase tracking-widest text-primary hover:underline inline-flex items-center gap-1 shrink-0">
                            <ScrollText size={14} aria-hidden="true" /> All logs
                        </Link>
                    </div>

                    {loading ? (
                        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
                    ) : alerts.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-10 text-center border border-dashed border-border rounded-2xl">No warnings or errors in the latest log entries.</p>
                    ) : (
                        <ul className="divide-y divide-border/50">
                            {alerts.map((log) => (
                                <li key={log.logId} className="py-3 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                                    <span className={`text-xs font-black uppercase px-1.5 py-0.5 rounded shrink-0 ${log.logType === 'ERROR' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
                                        {log.logType}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-foreground leading-snug break-words">{log.message}</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {log.deviceId ? `Device ${log.deviceId}` : log.source || 'System'} · {new Date(log.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {/* Quick links */}
                <nav className="col-span-12 lg:col-span-4 glass-panel rounded-[2rem] p-6 sm:p-8 animate-in stagger-3 bg-card" aria-label="Quick links">
                    <h2 className="text-2xl font-black text-foreground uppercase tracking-tight mb-6">Go to</h2>
                    <ul className="space-y-2">
                        {[
                            { href: '/admin/devices', label: 'Devices', desc: 'Screens, schedules and remote commands', icon: Monitor },
                            { href: '/admin/media', label: 'Media library', desc: 'Upload and replace files', icon: FolderOpen },
                            { href: '/admin/playlists', label: 'Playlists', desc: 'Sequence and timing', icon: ListVideo },
                            { href: '/admin/statistics', label: 'Playback stats', desc: 'Proof of play by file and branch', icon: BarChart2 },
                        ].map((item) => (
                            <li key={item.href}>
                                <Link href={item.href} className="flex items-center gap-4 p-3 rounded-2xl border border-transparent hover:border-border hover:bg-muted/20 transition-colors group">
                                    <span className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center text-muted-foreground group-hover:text-accent-cyan transition-colors shrink-0" aria-hidden="true">
                                        <item.icon size={18} />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-sm font-black text-foreground">{item.label}</span>
                                        <span className="block text-xs text-muted-foreground truncate">{item.desc}</span>
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            </div>

            {/* Footer Info */}
            <footer className="pt-6 flex flex-col sm:flex-row justify-between gap-2 text-xs text-muted-foreground animate-in stagger-4">
                <span>Signage Unicorn v{stats?.systemVersion || SYSTEM_VERSION}</span>
                <span>Unicorn Tech Integration Co., Ltd.</span>
            </footer>
        </div>
    );
}

'use client';

import React, { useEffect, useState } from 'react';
import { dashboardApi, DashboardStats } from '@/features/dashboard/api/dashboard-api';
import { SystemConfigModal } from '@/features/system/components/SystemConfigModal';
import { SYSTEM_VERSION } from '@/lib/constants';

export default function DashboardPage() {
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [isConfigOpen, setIsConfigOpen] = useState(false);

    useEffect(() => {
        loadDashboard();
        const interval = setInterval(loadDashboard, 15000); // Auto-refresh every 15s
        return () => clearInterval(interval);
    }, []);

    const loadDashboard = async () => {
        const res = await dashboardApi.getStats();
        if (res.success && res.data) {
            setStats(res.data);
        }
        setLoading(false);
    };

    const dashboardStats = [
        { label: 'System Health', value: '100', unit: '%', trend: 'STABLE', trendUp: true, icon: '⚡', color: 'cyan' },
        { label: 'Live Displays', value: stats?.onlineDevices?.toString() || '0', unit: 'nodes', trend: `${stats?.totalDevices || 0} total`, trendUp: true, icon: '🖥️', color: 'purple' },
        { label: 'Media Library', value: stats?.totalMedia?.toString() || '0', unit: 'assets', trend: `${stats?.totalPlaylists || 0} lists`, trendUp: true, icon: '🎞️', color: 'yellow' },
        { label: 'Network Sync', value: stats && stats.totalDevices > 0 ? ((stats.onlineDevices / stats.totalDevices) * 100).toFixed(0) : '0', unit: '%', trend: 'LIVE', trendUp: true, icon: '📡', color: 'green' },
    ];

    const alerts = (stats?.recentAlerts || []).map(log => ({
        id: log.logId,
        title: log.message,
        location: log.deviceId || 'System Hub',
        time: new Date(log.createdAt).toLocaleTimeString(),
        severity: log.logType === 'ERROR' ? 'high' : log.logType === 'WARNING' ? 'med' : 'low'
    }));

    return (
        <div className="p-6 lg:p-10 space-y-10 max-w-[1800px] mx-auto page-transition overflow-hidden">
            {/* --- Hero Header Section --- */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-8 animate-in">
                <div className="space-y-4 max-w-2xl">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-cyan/10 border border-accent-cyan/20 text-accent-cyan text-xs font-black uppercase tracking-widest">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-cyan animate-pulse"></span>
                        {stats?.onlineDevices || 0} Nodes Transmitting
                    </div>
                    <h1 className="text-6xl font-black tracking-tighter uppercase neon-text leading-none">
                        Command Center
                    </h1>
                    <p className="text-gray-400 text-lg font-medium leading-relaxed">
                        Orchestrating <span className="text-white">{stats?.totalMedia || 0} assets</span> across <span className="text-white">{stats?.totalDevices || 0} smart displays</span> with real-time analytics.
                    </p>
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={() => setIsConfigOpen(true)}
                        className="w-12 h-12 flex items-center justify-center rounded-2xl bg-muted/20 border border-border text-xl hover:bg-muted/40 transition-all text-foreground"
                        title="System Protocol Config"
                    >
                        ⚙️
                    </button>
                    <button onClick={() => window.location.href = '/admin/statistics'} className="px-6 py-3 rounded-2xl bg-muted/20 border border-border text-xs font-black uppercase tracking-widest hover:bg-muted/40 transition-all text-foreground">
                        Playback Stats
                    </button>
                    <button onClick={() => window.location.href = '/admin/devices'} className="btn-primary shadow-[0_0_30px_rgba(157,0,255,0.3)]">
                        Devices Node
                    </button>
                </div>
            </div>

            <SystemConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} />

            {/* --- Main Dashboard Grid --- */}
            <div className="dashboard-grid">

                {/* Visual Visualization (Hero Graphic) - 8/12 Columns */}
                <div className="col-span-12 lg:col-span-8 glass-panel rounded-[2.5rem] p-10 border border-border relative overflow-hidden h-[500px] flex flex-col justify-between animate-in stagger-1 bg-card">
                    <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-accent-cyan/5 blur-[120px] -translate-y-1/2 translate-x-1/2"></div>

                    <div className="relative z-10 flex justify-between items-start">
                        <div>
                            <h3 className="text-2xl font-black text-foreground uppercase tracking-tight">Active Node Topology</h3>
                            <p className="text-sm text-muted-foreground uppercase tracking-widest font-bold mt-1">Real-time data distribution matrix</p>
                        </div>
                        <div className="flex gap-4 text-right">
                            <div>
                                <p className="text-xs text-muted-foreground uppercase font-black">Sync Health</p>
                                <p className="text-xl font-bold text-accent-cyan">{stats && stats.totalDevices > 0 ? ((stats.onlineDevices / stats.totalDevices) * 100).toFixed(1) : '0.0'}%</p>
                            </div>
                            <div className="w-px h-8 bg-border"></div>
                            <div>
                                <p className="text-xs text-muted-foreground uppercase font-black">Total Assets</p>
                                <p className="text-xl font-bold text-accent-purple">{stats?.totalMedia || 0}</p>
                            </div>
                        </div>
                    </div>

                    {/* SVG Visualization Mockup */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
                        <svg width="100%" height="100%" viewBox="0 0 800 400" className="max-w-3xl translate-y-10">
                            {/* Connection Lines */}
                            <path d="M100 200 Q 400 50 700 200" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-accent-cyan/20 animate-[dash_5s_linear_infinite]" />
                            <path d="M100 200 Q 400 350 700 200" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-accent-purple/20 animate-[dash_7s_linear_infinite_reverse]" />
                            <path d="M150 100 L 650 300" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-muted-foreground/10" />
                            <path d="M150 300 L 650 100" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-muted-foreground/10" />

                            {/* Nodes */}
                            <circle cx="100" cy="200" r="4" fill="#00f2ff" className="glow-point" />
                            <circle cx="700" cy="200" r="4" fill="#9d00ff" className="glow-point" />
                            <circle cx="400" cy="100" r="3" fill="currentColor" className="text-foreground" opacity="0.5" />
                            <circle cx="400" cy="300" r="3" fill="currentColor" className="text-foreground" opacity="0.5" />
                            <circle cx="250" cy="180" r="2" fill="#00f2ff" opacity="0.3" />
                            <circle cx="550" cy="220" r="2" fill="#9d00ff" opacity="0.3" />
                        </svg>
                    </div>

                    <div className="relative z-10 flex gap-10 mt-auto">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground uppercase font-black">Online Consistency</span>
                            <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-accent-cyan shadow-[0_0_10px_#00f2ff] transition-all duration-1000"
                                    style={{ width: stats && stats.totalDevices > 0 ? `${(stats.onlineDevices / stats.totalDevices) * 100}%` : '0%' }}
                                ></div>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground uppercase font-black">Content Saturation</span>
                            <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
                                <div className="w-1/3 h-full bg-accent-purple shadow-[0_0_10px_#9d00ff]"></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Sidebar Area - Stats - 4/12 Columns */}
                <div className="col-span-12 lg:col-span-4">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-4 animate-in stagger-2 h-full">
                        {dashboardStats.map((stat, i) => (
                            <div key={i} className="glass-card p-6 rounded-3xl border border-border flex flex-col justify-between h-[242px] relative group bg-card hover:bg-muted/50 transition-colors">
                                <div className="flex justify-between items-start">
                                    <span className="text-2xl opacity-50 group-hover:opacity-100 transition-opacity">{stat.icon}</span>
                                    <span className={`text-xs font-bold ${stat.trendUp ? 'text-green-500' : 'text-red-500'}`}>
                                        {stat.trend}
                                    </span>
                                </div>
                                <div className="mt-auto">
                                    <p className="text-xs text-muted-foreground uppercase font-black tracking-widest">{stat.label}</p>
                                    <div className="text-2xl font-black flex items-baseline gap-1">
                                        {stat.value}
                                        <span className="text-sm font-medium text-muted-foreground">{stat.unit}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* --- Bottom Row: Active Resources (Feature Cards) --- */}
                <div className="col-span-12 grid grid-cols-1 md:grid-cols-3 gap-6 animate-in stagger-4 mt-4">
                    {[
                        { title: 'Global Sync', desc: 'Sync nodes across regions', progress: 85, color: 'from-accent-cyan to-blue-500', link: '/admin/devices' },
                        { title: 'Cache Health', desc: 'Optimizing media buffer', progress: 42, color: 'from-accent-purple to-pink-500', link: '/admin/media' },
                        { title: 'Security Scan', desc: 'Vault integrity check', progress: 100, color: 'from-green-500 to-emerald-600', link: '/admin/settings' },
                    ].map((item, i) => (
                        <div
                            key={i}
                            onClick={() => window.location.href = item.link}
                            className="glass-panel p-8 rounded-[2rem] border border-border hover:border-accent-cyan/30 transition-all cursor-pointer flex flex-col gap-6 bg-card hover:translate-y-[-2px] hover:shadow-lg"
                        >
                            <div className="flex justify-between items-center">
                                <h4 className="text-lg font-black text-foreground tracking-tight leading-tight">{item.title}</h4>
                                <span className="text-xs font-mono text-muted-foreground">{item.progress}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                    className={`h-full bg-gradient-to-r ${item.color} transition-all duration-1000`}
                                    style={{ width: `${item.progress}%` }}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground uppercase font-black tracking-widest">{item.desc}</p>
                        </div>
                    ))}
                </div>

            </div>

            {/* Footer Info */}
            <div className="pt-10 flex justify-between items-center opacity-30 animate-in stagger-5">
                <div className="text-[10px] font-mono tracking-widest uppercase">
                    System Protocol v{stats?.systemVersion || SYSTEM_VERSION} // Auth verified // Node Cluster Active
                </div>
                <div className="text-[10px] font-mono tracking-widest uppercase">
                    Unicorn Tech Integration Co.,Ltd.
                </div>
            </div>
        </div >
    );
}

// Add these to globals.css for the SVG animation
// @keyframes dash {
//   to {
//     stroke-dashoffset: 0;
//   }
// }
// (Added keyframes in globals.css for completeness)

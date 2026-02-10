'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useUI } from '@/features/ui/context/UIContext';
import { dashboardApi, DashboardStats } from '@/features/dashboard/api/dashboard-api';
import {
    LayoutDashboard,
    FolderOpen,
    ListVideo,
    Monitor,
    BarChart2,
    ScrollText,
    Settings,
    BookOpen,
    ChevronLeft,
    ChevronRight,
    Bell,
    Users,
    Menu,
    X
} from 'lucide-react';

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const { theme, fontSize, toggleTheme, toggleFontSize } = useUI();

    // Sidebar States
    const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

    // Business Data States
    const [user, setUser] = React.useState<{ fullName: string, role: string } | null>(null);
    const [stats, setStats] = React.useState<DashboardStats | null>(null);
    const [isNotificationsOpen, setIsNotificationsOpen] = React.useState(false);
    const [hasUnread, setHasUnread] = React.useState(false);
    const [lastLogId, setLastLogId] = React.useState<string | null>(null);

    const allowStatsLoad = React.useRef(true);

    const menuItems = [
        { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
        { name: 'Media Library', href: '/admin/media', icon: FolderOpen },
        { name: 'Playlists', href: '/admin/playlists', icon: ListVideo },
        { name: 'Devices', href: '/admin/devices', icon: Monitor },
        { name: 'Playback Stats', href: '/admin/statistics', icon: BarChart2 },
        { name: 'System Logs', href: '/admin/system-logs', icon: ScrollText },
        { name: 'User Management', href: '/admin/users', icon: Users },
        { name: 'Settings', href: '/admin/settings', icon: Settings },
        { name: 'User Guide', href: '/admin/guide', icon: BookOpen },
    ];

    // Responsive Logic - Auto-collapse but STAY VISIBLE down to 768px
    React.useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth < 1280) {
                setSidebarCollapsed(true);
            } else {
                setSidebarCollapsed(false);
            }
        };

        handleResize(); // Initial check
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Load User & Fetch Stats
    React.useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            try {
                setUser(JSON.parse(storedUser));
            } catch (e) {
                console.error("Failed to parse user data", e);
            }
        }

        const storedCollapsed = localStorage.getItem('sidebar_collapsed');
        if (storedCollapsed === 'true') {
            setSidebarCollapsed(true);
        }

        const fetchStats = async () => {
            try {
                const res = await dashboardApi.getStats();
                if (res.success && res.data) {
                    setStats(res.data);
                    if (res.data.recentAlerts && res.data.recentAlerts.length > 0) {
                        const latestId = res.data.recentAlerts[0].logId;
                        if (latestId !== lastLogId) {
                            setHasUnread(true);
                            setLastLogId(latestId);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to fetch header stats", e);
            }
        };

        let interval: NodeJS.Timeout;
        if (allowStatsLoad.current) {
            allowStatsLoad.current = false;
            fetchStats();
            interval = setInterval(fetchStats, 5000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [lastLogId]);

    const toggleSidebar = () => {
        const newState = !sidebarCollapsed;
        setSidebarCollapsed(newState);
        localStorage.setItem('sidebar_collapsed', newState.toString());
    };

    const roleLabel = (role: string) => {
        const r = role?.toLowerCase();
        if (r === 'admin') return 'Network Authority';
        if (r === 'editor') return 'Content Manager';
        return 'System Viewer';
    };

    return (
        <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)] font-sans transition-colors duration-300">

            {/* Mobile Overlay (Only for screens < 768px / md) */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[90] md:hidden"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* --- Slim Premium Sidebar --- */}
            <aside className={`
                ${sidebarCollapsed ? 'w-24' : 'w-72'}
                ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                fixed md:relative h-full glass-panel border-r border-white-[0.05] flex flex-col z-40 overflow-hidden transition-all duration-500 ease-in-out
            `}>
                <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-accent-purple/5 to-transparent pointer-events-none"></div>

                <div className={`p-8 pb-4 flex items-center ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between'}`}>
                    <Link href="/" className="flex items-center gap-3 group">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-purple to-accent-cyan flex items-center justify-center text-xl shadow-[0_0_20px_rgba(0,242,255,0.3)] group-hover:scale-110 transition-transform flex-shrink-0">
                            🦄
                        </div>
                        {!sidebarCollapsed && (
                            <div className="flex flex-col animate-in fade-in slide-in-from-left-2 duration-500">
                                <span className="font-black text-xl tracking-tighter neon-text uppercase">UNICORN</span>
                                <span className="text-xs text-muted-foreground font-bold uppercase tracking-[0.3em] -mt-1">OS v{stats?.systemVersion || '2.2.0'}</span>
                            </div>
                        )}
                    </Link>

                    {!sidebarCollapsed && (
                        <button
                            onClick={toggleSidebar}
                            className="hidden lg:flex w-6 h-6 rounded-full bg-muted/20 border border-border items-center justify-center hover:bg-muted/40 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-all hover:text-accent-cyan animate-in fade-in duration-300"
                        >
                            <ChevronLeft size={16} />
                        </button>
                    )}
                </div>

                {sidebarCollapsed && (
                    <div className="flex justify-center -mt-2 mb-4">
                        <button
                            onClick={toggleSidebar}
                            className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 text-xs text-accent-cyan transition-all"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}

                <nav className={`flex-1 ${sidebarCollapsed ? 'px-3' : 'px-4'} space-y-1 mt-6 overflow-y-auto custom-scrollbar relative z-10`}>
                    {menuItems.map((item) => {
                        const isActive = pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`flex items-center ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-5'} py-2.5 rounded-2xl transition-all duration-300 group relative ${isActive
                                    ? 'nav-active'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                                    }`}
                                title={sidebarCollapsed ? item.name : ''}
                            >
                                <span className={`text-xl transition-transform duration-500 ${isActive ? 'scale-110' : 'group-hover:translate-x-1'}`}>
                                    <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                                </span>
                                {!sidebarCollapsed && (
                                    <span className="font-bold text-sm tracking-wide ml-4 animate-in fade-in slide-in-from-left-2 duration-300">
                                        {item.name}
                                    </span>
                                )}
                                {isActive && !sidebarCollapsed && (
                                    <div className="ml-auto w-1 h-4 rounded-full bg-accent-cyan shadow-[0_0_10px_#00f2ff]" />
                                )}
                                {isActive && sidebarCollapsed && (
                                    <div className="absolute right-1 w-1 h-4 rounded-full bg-accent-cyan shadow-[0_0_10px_#00f2ff]" />
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className={`${sidebarCollapsed ? 'p-2' : 'p-6'} mt-auto relative z-10`}>
                    <Link href="/admin/users" className={`glass-card ${sidebarCollapsed ? 'p-3' : 'p-4'} rounded-2xl border border-border/50 hover:border-border flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-4'} group cursor-pointer transition-all`}>
                        <div className="w-10 h-10 rounded-full bg-accent-purple/10 border border-border flex items-center justify-center text-lg group-hover:border-accent-cyan/50 transition-colors flex-shrink-0 font-bold text-accent-purple">
                            {user?.fullName?.charAt(0) || '👤'}
                        </div>
                        {!sidebarCollapsed && (
                            <div className="flex-1 min-w-0 animate-in fade-in slide-in-from-left-2 duration-500">
                                <p className="text-sm font-black truncate uppercase tracking-tighter">
                                    {user?.fullName || 'IDENTIFYING...'}
                                </p>
                                <p className="text-xs text-accent-cyan font-bold uppercase tracking-widest">
                                    {roleLabel(user?.role || '')}
                                </p>
                            </div>
                        )}
                    </Link>
                </div>
            </aside>

            {/* --- Main Area --- */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">

                {/* Visual Header */}
                <header className="h-20 border-b border-border/30 flex items-center justify-between px-4 sm:px-10 bg-background/80 backdrop-blur-xl z-[80] transition-colors duration-300">
                    <div className="flex items-center gap-4 sm:gap-6">
                        {/* Mobile Toggle */}
                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className="lg:hidden w-10 h-10 flex items-center justify-center hover:bg-white/5 rounded-xl transition-all"
                        >
                            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                        </button>

                        <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-lg bg-green-500/5 border border-green-500/20 text-green-400 text-xs font-black tracking-widest uppercase">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
                            {stats ? `${stats.onlineDevices}/${stats.totalDevices} Devices Online` : 'System Operational'}
                        </div>

                        <div className="text-xs text-muted-foreground hidden lg:flex gap-4 uppercase font-bold tracking-widest">
                            <span>{stats?.totalPlaylists ?? '--'} Playlists</span>
                            <span>{stats?.totalMedia ?? '--'} Media Files</span>
                            <span className="text-accent-cyan/60">TX: {stats?.dynamicTxSpeedMbps ?? '0.0'} MBPS</span>
                            <span className="text-accent-purple/80 font-mono">LATENCY: {stats?.averageLatencyMs ?? '--'} ms</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 sm:gap-8">
                        <div className="flex items-center gap-2 sm:gap-3">
                            <div className="text-right hidden md:block">
                                <p className="text-xs font-black text-foreground">
                                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </p>
                                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">
                                    {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </p>
                            </div>

                            {/* Font Size Toggle Button */}
                            <button
                                onClick={toggleFontSize}
                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-muted/20 border border-border/50 flex items-center justify-center hover:bg-muted/40 transition-colors relative group"
                                title={`Current Size: ${fontSize.toUpperCase()}`}
                            >
                                <div className="flex items-end gap-0.5 pointer-events-none">
                                    <span className={`font-bold transition-all ${fontSize === 'small' ? 'text-accent-cyan text-sm' : 'text-muted-foreground text-[10px]'}`}>A</span>
                                    <span className={`font-bold transition-all ${fontSize === 'medium' ? 'text-accent-cyan text-base' : 'text-muted-foreground text-[10px]'}`}>A</span>
                                    <span className={`font-bold transition-all ${fontSize === 'large' ? 'text-accent-cyan text-xl' : 'text-muted-foreground text-[10px]'}`}>A</span>
                                </div>
                            </button>

                            {/* Theme Toggle Button */}
                            <button
                                onClick={toggleTheme}
                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-muted/20 border border-border/50 flex items-center justify-center text-base hover:bg-muted/40 transition-colors"
                            >
                                {theme === 'dark' ? '🌙' : '☀️'}
                            </button>

                            {/* Notifications Dropdown */}
                            <div className="relative">
                                <button
                                    onClick={() => {
                                        setIsNotificationsOpen(!isNotificationsOpen);
                                        setHasUnread(false);
                                    }}
                                    className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-muted/20 border border-border/50 flex items-center justify-center text-xl transition-all ${stats?.recentAlerts?.length ? 'hover:bg-accent-cyan/10 hover:border-accent-cyan' : 'opacity-50 cursor-not-allowed'}`}
                                >
                                    <Bell size={18} />
                                    {hasUnread && stats?.recentAlerts && stats.recentAlerts.length > 0 && (
                                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-background animate-pulse"></span>
                                    )}
                                </button>

                                {isNotificationsOpen && stats?.recentAlerts && (
                                    <div className="absolute top-14 right-0 w-72 sm:w-80 bg-card-solid rounded-2xl border border-border shadow-2xl z-[150] animate-in fade-in slide-in-from-top-2 duration-300 overflow-hidden">
                                        <div className="p-4 border-b border-border flex justify-between items-center bg-muted">
                                            <span className="text-xs font-black uppercase tracking-widest text-foreground">Recent Activity</span>
                                        </div>
                                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2 space-y-1">
                                            {stats.recentAlerts.map((log, idx) => (
                                                <div key={idx} className="p-3 hover:bg-muted/30 rounded-xl transition-colors group">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className={`text-[10px] font-black uppercase px-1.5 rounded ${log.logType === 'ERROR' ? 'bg-red-500/10 text-red-400' : 'bg-accent-cyan/10 text-accent-cyan'}`}>{log.logType}</span>
                                                        <span className="text-[10px] text-muted-foreground font-mono">{new Date(log.createdAt).toLocaleTimeString()}</span>
                                                    </div>
                                                    <p className="text-[11px] text-foreground/80 leading-snug">{log.message}</p>
                                                    <div className="text-[10px] text-muted-foreground mt-1 uppercase font-bold tracking-tighter">Source: {log.source}</div>
                                                </div>
                                            ))}
                                            {stats.recentAlerts.length === 0 && (
                                                <div className="py-10 text-center text-muted-foreground text-xs font-bold uppercase">No Active Alerts</div>
                                            )}
                                        </div>
                                        <div className="p-3 border-t border-border bg-muted/30">
                                            <Link href="/admin/system-logs" onClick={() => setIsNotificationsOpen(false)} className="block w-full text-center py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-black uppercase tracking-widest transition-all">View All Logs</Link>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </header>

                {/* --- Scrollable Content --- */}
                <main className="flex-1 overflow-y-auto custom-scrollbar relative page-transition scroll-smooth">
                    {/* Background Visual Artifacts */}
                    <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-accent-cyan/5 blur-[150px] pointer-events-none rounded-full overflow-hidden translate-x-1/2 -translate-y-1/2" />

                    <div className="relative z-10 pb-20">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}

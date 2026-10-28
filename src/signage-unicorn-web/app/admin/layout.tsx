'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SYSTEM_VERSION } from '@/lib/constants';

import { useUI } from '@/features/ui/context/UIContext';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useVisibleInterval } from '@/features/ui/hooks/useVisibleInterval';
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
    X,
    LogOut
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
    // The auth context owns the session (cookie-based since the 27-10-2026 hardening); the
    // localStorage copy below is only a display fallback for the first paint.
    const { user: authUser, logout } = useAuth();
    const [storedUser, setStoredUser] = React.useState<{ fullName: string, role: string } | null>(null);
    const user = authUser ?? storedUser;
    const [stats, setStats] = React.useState<DashboardStats | null>(null);
    const [isNotificationsOpen, setIsNotificationsOpen] = React.useState(false);
    const [hasUnread, setHasUnread] = React.useState(false);
    const lastLogIdRef = React.useRef<string | null>(null);
    const notificationsRef = React.useRef<HTMLDivElement>(null);

    // Live clock — kept null on the server and the first client render so SSR and
    // client markup match (avoids a hydration mismatch from locale/timezone-dependent
    // Date formatting). Populated after mount, then ticked every 30s.
    const [now, setNow] = React.useState<Date | null>(null);
    React.useEffect(() => {
        setNow(new Date());
        const clock = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(clock);
    }, []);

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

    // Load User
    React.useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            try {
                setStoredUser(JSON.parse(storedUser));
            } catch (e) {
                console.error("Failed to parse user data", e);
            }
        }

        const storedCollapsed = localStorage.getItem('sidebar_collapsed');
        if (storedCollapsed === 'true') {
            setSidebarCollapsed(true);
        }
    }, []);

    // Header stats: polled every 5s while the tab is visible, paused in the background.
    const fetchStats = React.useCallback(async () => {
        try {
            const res = await dashboardApi.getStats();
            if (res.success && res.data) {
                setStats(res.data);
                if (res.data.recentAlerts && res.data.recentAlerts.length > 0) {
                    const latestId = res.data.recentAlerts[0].logId;
                    if (latestId !== lastLogIdRef.current) {
                        if (lastLogIdRef.current !== null) setHasUnread(true);
                        lastLogIdRef.current = latestId;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to fetch header stats", e);
        }
    }, []);

    React.useEffect(() => {
        fetchStats();
    }, [fetchStats]);
    useVisibleInterval(fetchStats, 5000);

    // Notifications popover: close on outside click or Escape.
    React.useEffect(() => {
        if (!isNotificationsOpen) return;
        const onPointerDown = (e: MouseEvent) => {
            if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
                setIsNotificationsOpen(false);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsNotificationsOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isNotificationsOpen]);

    const toggleSidebar = () => {
        const newState = !sidebarCollapsed;
        setSidebarCollapsed(newState);
        localStorage.setItem('sidebar_collapsed', newState.toString());
    };

    const roleLabel = (role: string) => {
        const r = role?.toLowerCase();
        if (r === 'admin') return 'Administrator';
        if (r === 'editor') return 'Editor';
        return 'Viewer';
    };

    const alertCount = stats?.recentAlerts?.length ?? 0;
    const offlineDevices = stats ? Math.max(0, stats.totalDevices - stats.onlineDevices) : null;

    return (
        <div className="flex h-screen overflow-hidden bg-background text-foreground font-sans transition-colors duration-300">

            {/* Mobile Overlay (Only for screens < 768px / md) */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-[90] md:hidden"
                    aria-hidden="true"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* --- Sidebar --- */}
            <aside
                id="admin-sidebar"
                aria-label="Main navigation"
                className={`
                ${sidebarCollapsed ? 'w-24' : 'w-72'}
                ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                fixed md:relative h-full glass-panel border-r border-border/50 flex flex-col z-40 overflow-hidden transition-[width,transform] duration-300 ease-in-out
            `}>
                <div className={`p-8 pb-4 flex items-center ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between'}`}>
                    <Link href="/" className="flex items-center gap-3 group rounded-xl" aria-label="Signage Unicorn home">
                        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-xl group-hover:scale-105 transition-transform flex-shrink-0 shadow-sm" aria-hidden="true">
                            🦄
                        </div>
                        {!sidebarCollapsed && (
                            <div className="flex flex-col">
                                <span className="font-black text-xl tracking-tighter neon-text uppercase">Unicorn</span>
                                <span className="text-xs text-muted-foreground font-bold uppercase tracking-[0.3em] -mt-1">v{stats?.systemVersion || SYSTEM_VERSION}</span>
                            </div>
                        )}
                    </Link>

                    {!sidebarCollapsed && (
                        <button
                            type="button"
                            onClick={toggleSidebar}
                            aria-label="Collapse sidebar"
                            className="hidden lg:flex w-8 h-8 rounded-full bg-muted/20 border border-border items-center justify-center hover:bg-muted/40 text-muted-foreground hover:text-accent-cyan transition-colors"
                        >
                            <ChevronLeft size={16} aria-hidden="true" />
                        </button>
                    )}
                </div>

                {sidebarCollapsed && (
                    <div className="flex justify-center -mt-2 mb-4">
                        <button
                            type="button"
                            onClick={toggleSidebar}
                            aria-label="Expand sidebar"
                            className="w-8 h-8 rounded-xl bg-muted/20 border border-border flex items-center justify-center hover:bg-muted/40 text-accent-cyan transition-colors"
                        >
                            <ChevronRight size={16} aria-hidden="true" />
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
                                aria-current={isActive ? 'page' : undefined}
                                aria-label={sidebarCollapsed ? item.name : undefined}
                                className={`flex items-center ${sidebarCollapsed ? 'justify-center px-0' : 'justify-between px-5'} py-2.5 rounded-2xl transition-colors duration-200 group relative ${isActive
                                    ? 'bg-accent-cyan/10 text-accent-cyan'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                                    }`}
                                title={sidebarCollapsed ? item.name : undefined}
                            >
                                <span className={`text-xl transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:translate-x-1'}`} aria-hidden="true">
                                    <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                                </span>
                                {!sidebarCollapsed && (
                                    <span className="font-bold text-sm tracking-wide ml-4">
                                        {item.name}
                                    </span>
                                )}
                                {isActive && !sidebarCollapsed && (
                                    <div className="ml-auto w-1 h-4 rounded-full bg-accent-cyan" aria-hidden="true" />
                                )}
                                {isActive && sidebarCollapsed && (
                                    <div className="absolute right-1 w-1 h-4 rounded-full bg-accent-cyan" aria-hidden="true" />
                                )}
                            </Link>
                        );
                    })}
                </nav>

                <div className={`${sidebarCollapsed ? 'p-2' : 'p-6'} mt-auto relative z-10`}>
                    <Link
                        href="/admin/users"
                        aria-label={`Signed in as ${user?.fullName || 'unknown user'}, ${roleLabel(user?.role || '')}. Open user management`}
                        className={`glass-card ${sidebarCollapsed ? 'p-3' : 'p-4'} rounded-2xl border border-border/50 hover:border-border flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-4'} group cursor-pointer`}
                    >
                        <div className="w-10 h-10 rounded-full bg-accent-purple/10 border border-border flex items-center justify-center text-lg group-hover:border-accent-cyan/50 transition-colors flex-shrink-0 font-bold text-accent-purple" aria-hidden="true">
                            {user?.fullName?.charAt(0) || '👤'}
                        </div>
                        {!sidebarCollapsed && (
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-black truncate uppercase tracking-tighter">
                                    {user?.fullName || 'Loading…'}
                                </p>
                                <p className="text-xs text-accent-cyan font-bold uppercase tracking-widest">
                                    {roleLabel(user?.role || '')}
                                </p>
                            </div>
                        )}
                    </Link>
                    <button
                        type="button"
                        onClick={logout}
                        aria-label="Sign out"
                        title="Sign out"
                        className={`mt-2 w-full flex items-center ${sidebarCollapsed ? 'justify-center px-0' : 'justify-start gap-3 px-4'} py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors`}
                    >
                        <LogOut size={16} aria-hidden="true" />
                        {!sidebarCollapsed && <span>Sign out</span>}
                    </button>
                </div>
            </aside>

            {/* --- Main Area --- */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">

                {/* Header */}
                <header className="h-20 border-b border-border/30 flex items-center justify-between px-4 sm:px-10 bg-background/80 backdrop-blur-xl z-[80] transition-colors duration-300">
                    <div className="flex items-center gap-4 sm:gap-6">
                        {/* Mobile Toggle */}
                        <button
                            type="button"
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                            aria-expanded={isMobileMenuOpen}
                            aria-controls="admin-sidebar"
                            className="lg:hidden w-10 h-10 flex items-center justify-center hover:bg-muted/30 rounded-xl transition-colors"
                        >
                            {isMobileMenuOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
                        </button>

                        <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-lg bg-green-500/5 border border-green-500/20 text-green-600 dark:text-green-400 text-xs font-black tracking-widest uppercase" role="status">
                            <span className={`w-1.5 h-1.5 rounded-full ${stats ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} aria-hidden="true" />
                            {stats ? `${stats.onlineDevices}/${stats.totalDevices} screens online` : 'Connecting…'}
                        </div>

                        <div className="text-xs text-muted-foreground hidden lg:flex gap-4 uppercase font-bold tracking-widest">
                            <span>{stats?.totalPlaylists ?? '--'} Playlists</span>
                            <span>{stats?.totalMedia ?? '--'} Media Files</span>
                            {offlineDevices !== null && offlineDevices > 0 && (
                                <span className="text-red-500">{offlineDevices} Offline</span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-4 sm:gap-8">
                        <div className="flex items-center gap-2 sm:gap-3">
                            <div className="text-right hidden md:block">
                                <p className="text-xs font-black text-foreground" suppressHydrationWarning>
                                    {now ? now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                </p>
                                <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mt-0.5" suppressHydrationWarning>
                                    {now ? now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '--'}
                                </p>
                            </div>

                            {/* Font Size Toggle Button */}
                            <button
                                type="button"
                                onClick={toggleFontSize}
                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-muted/20 border border-border/50 flex items-center justify-center hover:bg-muted/40 transition-colors relative"
                                title={`Text size: ${fontSize}`}
                                aria-label={`Change text size (current: ${fontSize})`}
                            >
                                <div className="flex items-end gap-0.5 pointer-events-none" aria-hidden="true">
                                    <span className={`font-bold ${fontSize === 'small' ? 'text-accent-cyan text-sm' : 'text-muted-foreground text-xs'}`}>A</span>
                                    <span className={`font-bold ${fontSize === 'medium' ? 'text-accent-cyan text-base' : 'text-muted-foreground text-xs'}`}>A</span>
                                    <span className={`font-bold ${fontSize === 'large' ? 'text-accent-cyan text-xl' : 'text-muted-foreground text-xs'}`}>A</span>
                                </div>
                            </button>

                            {/* Theme Toggle Button */}
                            <button
                                type="button"
                                onClick={toggleTheme}
                                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-muted/20 border border-border/50 flex items-center justify-center text-base hover:bg-muted/40 transition-colors"
                            >
                                <span aria-hidden="true">{theme === 'dark' ? '🌙' : '☀️'}</span>
                            </button>

                            {/* Notifications Dropdown */}
                            <div className="relative" ref={notificationsRef}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsNotificationsOpen(!isNotificationsOpen);
                                        setHasUnread(false);
                                    }}
                                    disabled={alertCount === 0}
                                    aria-label={alertCount > 0 ? `Recent alerts (${alertCount})${hasUnread ? ', new' : ''}` : 'No recent alerts'}
                                    aria-haspopup="dialog"
                                    aria-expanded={isNotificationsOpen}
                                    className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-muted/20 border border-border/50 flex items-center justify-center text-xl transition-colors ${alertCount > 0 ? 'hover:bg-accent-cyan/10 hover:border-accent-cyan' : 'opacity-50 cursor-not-allowed'}`}
                                >
                                    <Bell size={18} aria-hidden="true" />
                                    {hasUnread && alertCount > 0 && (
                                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-background" aria-hidden="true"></span>
                                    )}
                                </button>

                                {isNotificationsOpen && stats?.recentAlerts && (
                                    <div
                                        role="dialog"
                                        aria-label="Recent alerts"
                                        className="absolute top-14 right-0 w-72 sm:w-80 bg-card-solid rounded-2xl border border-border shadow-2xl z-[150] animate-in overflow-hidden"
                                    >
                                        <div className="p-4 border-b border-border flex justify-between items-center bg-muted">
                                            <span className="text-xs font-black uppercase tracking-widest text-foreground">Recent activity</span>
                                        </div>
                                        <ul className="max-h-[300px] overflow-y-auto custom-scrollbar p-2 space-y-1">
                                            {stats.recentAlerts.map((log, idx) => (
                                                <li key={idx} className="p-3 hover:bg-muted/30 rounded-xl transition-colors">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className={`text-xs font-black uppercase px-1.5 rounded ${log.logType === 'ERROR' ? 'bg-red-500/10 text-red-500' : 'bg-accent-cyan/10 text-accent-cyan'}`}>{log.logType}</span>
                                                        <span className="text-xs text-muted-foreground font-mono">{new Date(log.createdAt).toLocaleTimeString()}</span>
                                                    </div>
                                                    <p className="text-xs text-foreground/80 leading-snug">{log.message}</p>
                                                    <div className="text-xs text-muted-foreground mt-1 uppercase font-bold">Source: {log.source}</div>
                                                </li>
                                            ))}
                                            {stats.recentAlerts.length === 0 && (
                                                <li className="py-10 text-center text-muted-foreground text-xs font-bold uppercase">No active alerts</li>
                                            )}
                                        </ul>
                                        <div className="p-3 border-t border-border bg-muted/30">
                                            <Link href="/admin/system-logs" onClick={() => setIsNotificationsOpen(false)} className="block w-full text-center py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-black uppercase tracking-widest transition-colors">View all logs</Link>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </header>

                {/* --- Scrollable Content --- */}
                <main className="flex-1 overflow-y-auto custom-scrollbar relative page-transition scroll-smooth">
                    <div className="relative z-10 pb-20">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}

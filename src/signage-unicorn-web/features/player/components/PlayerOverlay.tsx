'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { playlistApi } from '@/features/playlists/api/playlist-api';
import { Playlist } from '@/features/playlists/types/playlist';

interface PlayerOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    isOnline?: boolean;
    deviceId: string | null;
    deviceName: string;
    branchCode?: string;
    ipAddress?: string;
    currentPlaylistId: string | null;
    currentPlaylistName?: string;
    currentMediaName?: string;
    currentPositionSec?: number;
    currentDurationSec?: number;
    playlistTotalDurationSec?: number;
    currentItemIndex?: number;
    totalItems?: number;
    cacheProgress?: number;
    cachedCount?: number;
    hasSyncError?: boolean;
    limitLogs?: string[];
    onPlayPlaylist: (playlistId: string) => void;
    onForceSync: () => void;
    onClearCache: () => void;
    onVolumeDown: () => void;
    onVolumeUp: () => void;
    onRefresh: () => void;
    onReset: () => void;
    onHelp: () => void;
    onScreenTest: () => void;
}

export const PlayerOverlay: React.FC<PlayerOverlayProps> = ({
    isOpen, onClose, isOnline = true, deviceId, deviceName, branchCode = 'N/A', ipAddress = '127.0.0.1',
    currentPlaylistId, currentPlaylistName, currentMediaName,
    currentPositionSec = 0, currentDurationSec = 0,
    playlistTotalDurationSec = 0, currentItemIndex = 0, totalItems = 0,
    cacheProgress = 0, cachedCount = 0, hasSyncError = false,
    limitLogs = [],
    onPlayPlaylist, onForceSync, onClearCache,
    onVolumeDown, onVolumeUp, onRefresh, onReset, onHelp, onScreenTest
}) => {
    const router = useRouter();
    const [view, setView] = useState<'DASHBOARD' | 'PLAYLIST_SELECT'>('DASHBOARD');
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [loading, setLoading] = useState(false);

    // Settings State
    const [localJingleId, setLocalJingleId] = useState('');

    // Initial Focus
    const focusRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (isOpen) {
            setView('DASHBOARD');
            // Load current settings
            const savedJingle = localStorage.getItem('signage_safety_jingle_id') || '';
            setLocalJingleId(savedJingle);
            setTimeout(() => focusRef.current?.focus(), 50);
        }
    }, [isOpen]);

    // Handle body scroll lock
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    // Handle ESC
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen) return;
            if (e.key === 'Escape') {
                if (view !== 'DASHBOARD') setView('DASHBOARD');
                else onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, view, onClose]);

    // Fetch Playlists
    const loadPlaylists = async () => {
        setLoading(true);
        try {
            const res = await playlistApi.getActive(); // Dedicated endpoint for Active only
            if (res.success && res.data) {
                setPlaylists(res.data);
            }
        } catch (error) {
            console.error('Failed to load playlists', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSwitchView = (v: 'PLAYLIST_SELECT') => {
        setView(v);
        loadPlaylists();
    };

    const handleSelectPlaylist = (pId: string) => {
        if (confirm('Confirm manual playback override? This will stop the current schedule.')) {
            onPlayPlaylist(pId);
            onClose();
        }
    };


    const formatTime = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md animate-in fade-in duration-200 font-sans">
            <div className="w-full max-w-4xl p-4">
                <div className="glass-panel rounded-2xl border border-accent-cyan/30 shadow-[0_0_80px_rgba(0,242,255,0.1)] relative overflow-hidden flex flex-col max-h-[80vh]">

                    {/* Header */}
                    <div className="p-8 border-b border-white/10 flex justify-between items-center bg-white/5">
                        <div>
                            <h2 className="text-3xl font-black text-white uppercase tracking-widest flex items-center gap-4">
                                <span className={`w-4 h-4 rounded-full ${view === 'DASHBOARD' ? 'bg-accent-cyan animate-pulse' : 'bg-purple-500'}`}></span>
                                {view === 'DASHBOARD' ? 'Device Dashboard' : 'Select Playlist'}
                            </h2>
                            <p className="text-xs text-accent-cyan/60 font-mono mt-2 tracking-wider">
                                {view === 'DASHBOARD' ? 'LOCAL DIAGNOSTICS & CONTROL' : 'MANUAL OVERRIDE MODE'}
                            </p>
                        </div>
                        <div className="text-right font-mono text-gray-500 text-xs">
                            <div className="mb-1 text-white text-sm font-bold uppercase">{deviceName || 'UNNAMED DEVICE'}</div>
                            <div className="mb-1">ID: <span className="text-gray-400">{deviceId || 'UNKNOWN'}</span></div>
                            <div>BRANCH: <span className="text-accent-pink">{branchCode}</span></div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-8 overflow-y-auto min-h-[400px]">

                        {/* VIEW: DASHBOARD */}
                        {view === 'DASHBOARD' && (
                            <div className="space-y-8">
                                {/* Stats Grid */}
                                <div className="grid grid-cols-5 gap-4">
                                    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Network Status</div>
                                        <div className={`${isOnline ? 'text-green-400' : 'text-rose-500'} font-bold flex items-center gap-2 transition-colors duration-500`}>
                                            ● {isOnline ? 'ONLINE' : 'OFFLINE'}
                                        </div>
                                        <div className="text-xs text-gray-600 font-mono mt-1">{ipAddress}</div>
                                    </div>

                                    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Storage</div>
                                        <div className="text-white font-bold text-sm">42.5 GB / 128 GB</div>
                                        <div className="w-full h-1 bg-white/5 mt-2 rounded-full overflow-hidden">
                                            <div className="w-[30%] h-full bg-accent-cyan shadow-[0_0_8px_rgba(0,242,255,0.4)]"></div>
                                        </div>
                                    </div>

                                    <div className="bg-white/5 rounded-xl p-4 border border-white/10 flex flex-col justify-between">
                                        <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Offline Readiness</div>

                                        <div className="flex justify-between items-end">
                                            <div className={`text-sm font-bold ${hasSyncError ? 'text-yellow-500' : cacheProgress === 100 ? 'text-accent-cyan' : 'text-yellow-500'}`}>
                                                {hasSyncError ? (
                                                    <span className="flex items-center gap-1">⚠️ INCOMPLETE</span>
                                                ) : cacheProgress === 100 ? (
                                                    <span className="flex items-center gap-1">✅ READY</span>
                                                ) : (
                                                    <span className="animate-pulse">⏳ SYNCING...</span>
                                                )}
                                            </div>
                                            <div className="text-[10px] font-mono text-gray-400">
                                                {cachedCount} / {totalItems} CLIPS
                                            </div>
                                        </div>

                                        <div className="w-full h-1.5 bg-white/5 mt-2 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-1000 ${hasSyncError ? 'bg-yellow-600' : cacheProgress === 100 ? 'bg-accent-cyan shadow-[0_0_8px_rgba(0,242,255,0.5)]' : 'bg-yellow-500'}`}
                                                style={{ width: `${cacheProgress}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="bg-white/5 rounded-xl p-5 border border-white/10 col-span-2 flex flex-col gap-4">
                                        {/* Row 1: Playlist Info */}
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Active Playlist</div>
                                                <div className="text-white font-bold truncate text-xl text-shadow-glow">
                                                    {currentPlaylistName || 'No Active Schedule'}
                                                </div>
                                            </div>
                                            <div className="text-right pl-4">
                                                <div className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Playlist Loop</div>
                                                <div className="text-sm font-bold text-gray-400 font-mono">
                                                    {totalItems > 0 ? `ITEM ${currentItemIndex + 1} / ${totalItems}` : '--'}
                                                    <span className="ml-2 px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-accent-cyan">
                                                        {formatTime(playlistTotalDurationSec)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Row 2: Media Info & Progress Bar */}
                                        <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-2 text-xs font-bold text-accent-cyan truncate">
                                                    <span className="animate-pulse">▶</span>
                                                    {currentMediaName || 'IDLE / WAITING'}
                                                </div>
                                                <div className="text-xs font-mono text-white">
                                                    {formatTime(currentPositionSec)} <span className="text-gray-500">/ {formatTime(currentDurationSec)}</span>
                                                </div>
                                            </div>
                                            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-accent-cyan to-blue-500 transition-all duration-300"
                                                    style={{ width: `${(currentPositionSec / (currentDurationSec || 1)) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Menu Grid */}
                                <div className="grid grid-cols-2 gap-6">
                                    {/* Left: Actions */}
                                    <div className="space-y-3">
                                        <label className="text-xs text-gray-500 font-bold uppercase tracking-widest block mb-2">Maintenance Actions</label>

                                        <button
                                            ref={focusRef}
                                            onClick={() => handleSwitchView('PLAYLIST_SELECT')}
                                            className="w-full h-16 bg-gradient-to-r from-accent-cyan/20 to-transparent hover:from-accent-cyan/30 border border-accent-cyan/30 text-white font-bold uppercase tracking-widest text-sm rounded-xl flex items-center px-6 transition-all group focus:ring-2 focus:ring-accent-cyan outline-none"
                                        >
                                            <span className="text-2xl mr-4">📂</span>
                                            <div className="text-left">
                                                <div>Manual Playlist Select</div>
                                                <div className="text-[10px] text-cyan-300/60 font-mono font-normal">Browse & Force Play</div>
                                            </div>
                                            <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                                        </button>

                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={onForceSync}
                                                className="w-full h-14 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 font-bold uppercase tracking-widest text-[10px] rounded-xl flex items-center justify-center transition-all focus:ring-2 focus:ring-emerald-500 outline-none"
                                            >
                                                Force Sync
                                            </button>
                                            <button
                                                onClick={onClearCache}
                                                className="w-full h-14 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 font-bold uppercase tracking-widest text-[10px] rounded-xl flex items-center justify-center transition-all focus:ring-2 focus:ring-rose-500 outline-none"
                                            >
                                                Clear Cache
                                            </button>

                                            {/* New Actions to fill space */}
                                            <button
                                                onClick={() => window.location.reload()}
                                                className="w-full h-14 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold uppercase tracking-widest text-[10px] rounded-xl flex items-center justify-center transition-all focus:ring-1 focus:ring-white outline-none"
                                            >
                                                Refresh App
                                            </button>

                                            <div className="flex gap-2">
                                                <button
                                                    onClick={onVolumeDown}
                                                    className="flex-1 h-14 bg-white/5 hover:bg-white/20 border border-white/10 text-white font-black uppercase tracking-tighter text-xs rounded-xl flex items-center justify-center transition-all focus:ring-1 focus:ring-accent-pink outline-none group"
                                                >
                                                    <span className="text-gray-500 group-hover:text-accent-pink mr-1 font-normal">-</span> VOL
                                                </button>
                                                <button
                                                    onClick={onVolumeUp}
                                                    className="flex-1 h-14 bg-white/5 hover:bg-white/20 border border-white/10 text-white font-black uppercase tracking-tighter text-xs rounded-xl flex items-center justify-center transition-all focus:ring-1 focus:ring-accent-cyan outline-none group"
                                                >
                                                    <span className="text-gray-500 group-hover:text-accent-cyan mr-1 font-normal">+</span> VOL
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right: Info/Logs */}
                                    <div className="bg-black/40 rounded-xl p-4 border border-white/5 font-mono text-[10px] text-gray-400 h-full overflow-y-auto">
                                        <div className="mb-2 text-gray-500 font-bold border-b border-white/5 pb-1 flex justify-between">
                                            <span>RECENT SYSTEM LOGS</span>
                                            <span className="text-accent-cyan">{limitLogs.length} events</span>
                                        </div>
                                        <div className="space-y-1">
                                            {limitLogs.length > 0 ? (
                                                limitLogs.map((log, idx) => (
                                                    <div key={idx} className={idx === 0 ? "text-white animate-pulse" : "text-gray-500"}>
                                                        {log}
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="text-gray-700 italic">No logs recorded yet...</div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Shortcut Reference - Premium KBD Style */}
                                <div className="pt-8 border-t border-white/5">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                                        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black">Quick Control Shortcuts</p>
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                                        {[
                                            { key: 'F1', label: 'HELP', action: onHelp },
                                            { key: 'F2', label: 'VOL -', action: onVolumeDown },
                                            { key: 'F3', label: 'VOL +', action: onVolumeUp },
                                            { key: 'F5', label: 'REFRESH', action: onRefresh },
                                            { key: 'F6', label: 'SYNC', action: onForceSync },
                                            { key: 'F7', label: 'ADMIN', action: onClose }, // F7 Toggles Admin
                                            { key: 'F8', label: 'RESET', action: onReset },
                                        ].map((item) => (
                                            <button
                                                key={item.key}
                                                onClick={item.action}
                                                className="flex flex-col items-center gap-2 group outline-none"
                                            >
                                                <kbd className="min-w-[45px] h-9 px-2 flex items-center justify-center bg-white/10 border-b-4 border-white/20 rounded-lg text-white text-[11px] font-black group-hover:bg-accent-cyan group-hover:text-black group-hover:border-accent-cyan/50 group-active:translate-y-1 group-active:border-b-0 transition-all cursor-pointer shadow-lg">
                                                    {item.key}
                                                </kbd>
                                                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-widest group-hover:text-white transition-colors">
                                                    {item.label}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}



                        {/* VIEW: PLAYLIST SELECTOR */}
                        {view === 'PLAYLIST_SELECT' && (
                            <div className="animate-in slide-in-from-right duration-300 h-full flex flex-col">
                                {loading ? (
                                    <div className="flex items-center justify-center h-40 text-accent-cyan font-mono animate-pulse">LOADING PLAYLISTS...</div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-2">
                                        {playlists.map((pl) => (
                                            <button
                                                key={pl.playlistId}
                                                onClick={() => handleSelectPlaylist(pl.playlistId)}
                                                className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-accent-cyan/20 border border-white/10 hover:border-accent-cyan/50 rounded-lg group transition-all text-left focus:ring-2 focus:ring-accent-cyan outline-none"
                                            >
                                                <div>
                                                    <div className="font-bold text-white group-hover:text-accent-cyan">{pl.playlistName}</div>
                                                    <div className="text-xs text-gray-500 font-mono">{pl.playlistId} • {pl.items?.length || 0} Items</div>
                                                </div>
                                                <div className="text-xs font-mono px-3 py-1 rounded bg-black/50 text-gray-400 group-hover:bg-accent-cyan group-hover:text-black transition-colors">
                                                    SELECT
                                                </div>
                                            </button>
                                        ))}
                                        {playlists.length === 0 && <div className="text-center text-gray-500 py-10">No checklists found</div>}
                                    </div>
                                )}

                                <button
                                    onClick={() => setView('DASHBOARD')}
                                    className="mt-6 mx-auto py-2 px-8 bg-white/10 hover:bg-white/20 rounded-full text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white transition-all"
                                >
                                    Back to Dashboard
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-white/5 bg-black/20 text-center">
                        <p className="text-[10px] text-gray-600 font-mono">
                            SIGNAGE UNICORN DEVICE OS v1.2 • PRESS <span className="text-white font-bold">ESC</span> TO CLOSE
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

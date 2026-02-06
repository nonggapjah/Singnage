'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-fetch';

function SystemConfigPanel() {
    const [config, setConfig] = useState<{ currentBaseUrl: string, detectedIp: string, suggestedBaseUrl: string } | null>(null);
    const [newIp, setNewIp] = useState('');
    const [newPort, setNewPort] = useState(5018);
    const [newFrontendPort, setNewFrontendPort] = useState(3000);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(true); // Start refreshing true

    const loadConfig = async () => {
        setRefreshing(true);
        try {
            const res = await apiFetch('/server/config');
            if (res.success && res.data) {
                setConfig(res.data);
                if (res.data.detectedIp) setNewIp(res.data.detectedIp);
                if (res.data.currentBaseUrl) {
                    try {
                        const url = new URL(res.data.currentBaseUrl);
                        setNewPort(parseInt(url.port) || 80);
                    } catch (e) { }
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            setRefreshing(false);
        }
    };

    const allowLoad = React.useRef(true);

    useEffect(() => {
        if (allowLoad.current) {
            allowLoad.current = false;
            loadConfig();
        }
    }, []);

    const handleExecute = async () => {
        const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        if (!ipRegex.test(newIp)) {
            alert("Invalid IP Address format");
            return;
        }

        if (!confirm(`WARNING: This will update the Backend Config, SQL Database, and attempts to update Frontend .env to use IP: ${newIp}.\n\nThe system might restart.\n\nProceed?`)) return;

        setLoading(true);
        try {
            const res = await apiFetch('/server/config', {
                method: 'POST',
                body: JSON.stringify({
                    ipAddress: newIp,
                    port: newPort,
                    frontendPort: newFrontendPort
                })
            });

            if (res.success) {
                alert("Success: " + res.message);
                window.location.reload();
            } else {
                alert("Error: " + res.message);
            }
        } catch (e: any) {
            alert("Execution Failed: " + (e.message || "Unknown error"));
        } finally {
            setLoading(false);
        }
    };

    const handleSyncMedia = async () => {
        if (!confirm("This will scan all media files and update their URLs to match the current Server Configuration. Continue?")) return;
        setLoading(true);
        try {
            const res = await apiFetch('/server/sync-media', { method: 'POST' });
            if (res.success) alert("Media Paths Synchronized!");
            else alert("Failed: " + res.message);
        } catch (e: any) {
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4 font-mono text-sm border border-accent-cyan/20 p-6 rounded-2xl bg-accent-cyan/5 relative min-h-[400px]">
            {(refreshing && !config) && (
                <div className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-2xl">
                    <div className="text-accent-cyan animate-pulse font-bold tracking-widest">CONNECTING TO SYSTEM...</div>
                </div>
            )}

            {!config && !refreshing && (
                <div className="absolute inset-0 z-10 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-2xl space-y-4">
                    <div className="text-red-500 font-bold uppercase tracking-widest">Connection Failed</div>
                    <button onClick={loadConfig} className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white font-bold">RETRY CONNECTION</button>
                </div>
            )}

            <div className="flex justify-between items-start">
                <div>
                    <h3 className="font-bold text-accent-cyan text-lg mb-1">Network Configuration</h3>
                    <p className="text-gray-400 text-xs">Update system IP to allow LAN access</p>
                </div>
                <div className="text-right">
                    <span className="text-xs uppercase text-gray-500 block">Detected Local IP</span>
                    <span className="text-green-400 font-bold text-lg">{config?.detectedIp || '---'}</span>
                </div>
            </div>

            <div className="bg-black/40 p-4 rounded-xl space-y-2 border border-white/5">
                <p className="text-xs uppercase text-gray-500">Current API Base URL</p>
                <div className="flex items-center gap-2">
                    <code className="text-white/80">{config?.currentBaseUrl || 'Thinking...'}</code>
                    {config?.currentBaseUrl?.includes("localhost") && (
                        <span className="text-xs bg-yellow-500/20 text-yellow-500 px-2 py-0.5 rounded">LOCALHOST (Restricted)</span>
                    )}
                </div>
            </div>

            {/* Sync Button */}
            <div className="bg-black/40 p-4 rounded-xl flex justify-between items-center border border-white/5">
                <div>
                    <p className="text-xs uppercase text-gray-500 font-bold">Media Database Sync</p>
                    <p className="text-xs text-gray-400">Fix broken media links if IP changed manually</p>
                </div>
                <button
                    onClick={handleSyncMedia}
                    disabled={loading}
                    className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg text-xs font-bold border border-white/10 transition-all hover:text-accent-cyan hover:border-accent-cyan/50"
                >
                    SYNC DB PATHS
                </button>
            </div>

            <div className="pt-4 border-t border-white/10 space-y-4">
                <div className="space-y-2">
                    <label className="text-xs uppercase text-gray-500 font-bold block">New Host IP Address</label>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newIp}
                            onChange={(e) => setNewIp(e.target.value)}
                            className="flex-[3] bg-black/60 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-accent-cyan text-base"
                            placeholder="e.g. 192.168.1.10"
                        />
                        <input
                            type="number"
                            value={newPort}
                            onChange={(e) => setNewPort(parseInt(e.target.value))}
                            className="flex-1 bg-black/60 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-accent-cyan text-base text-center"
                            placeholder="Port"
                        />
                        <button
                            onClick={() => setNewIp(config?.detectedIp || '')}
                            className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs uppercase font-bold text-gray-400 border border-white/5"
                            title="Use Detected IP"
                        >
                            Auto
                        </button>
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-xs uppercase text-gray-500 font-bold block">Frontend Port (Dashboard)</label>
                    <input
                        type="number"
                        value={newFrontendPort}
                        onChange={(e) => setNewFrontendPort(parseInt(e.target.value))}
                        className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-accent-cyan text-base"
                        placeholder="Default 3000"
                    />
                    <p className="text-xs text-gray-500">
                        Entering <b>{newIp || '...'}</b> will set API to <b>http://{newIp || '...'}:{newPort}</b> and Frontend to <b>:{newFrontendPort}</b>
                    </p>
                </div>

                <button
                    onClick={handleExecute}
                    disabled={loading}
                    className="w-full py-4 bg-accent-cyan text-black font-black uppercase tracking-widest rounded-xl hover:shadow-[0_0_20px_rgba(0,242,255,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? 'EXECUTING UPDATES...' : 'SAVE & EXECUTE CHANGES'}
                </button>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    return (
        <div className="p-8 space-y-8 max-w-5xl mx-auto">
            <header>
                <h1 className="text-4xl font-black neon-text uppercase tracking-tighter mb-2">Settings</h1>
                <p className="text-gray-400">Manage system-wide configurations and infrastructure</p>
            </header>

            <div className="space-y-6">
                <h2 className="text-xl font-bold border-b border-white/10 pb-4">System Infrastructure</h2>

                <SystemConfigPanel />

                <div className="p-4 bg-black/40 rounded-xl border border-white/5 font-mono text-sm max-w-2xl">
                    <p className="text-gray-500 text-xs uppercase mb-1">Storage Provider</p>
                    <p className="text-accent-purple font-bold">Unicorn Local Storage (wwwroot/media)</p>
                </div>
            </div>
        </div>
    );
}

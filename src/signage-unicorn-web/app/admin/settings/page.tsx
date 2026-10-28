'use client';

import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-fetch';

function SystemConfigPanel() {
    const [config, setConfig] = useState<{ currentBaseUrl: string, detectedIp: string, suggestedBaseUrl: string } | null>(null);
    const [newIp, setNewIp] = useState('');
    const [newPort, setNewPort] = useState(8862); // API port. Was 8865 -- that is the WEB port, and this field sets the API's.
    const [newFrontendPort, setNewFrontendPort] = useState(8865); // Web port. Was 3000, Next.js's dev default, never this deployment's.
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(true); // Start refreshing true

    const loadConfig = async () => {
        setRefreshing(true);
        try {
            const res = await apiFetch('/server/config');
            if (res.success && res.data) {
                setConfig(res.data);
                if (res.data.detectedIp) setNewIp(res.data.detectedIp);

                // Prefer the ports the server reports. Parsing them out of the base URL is a
                // fallback; leaving either at its useState default is the dangerous case, because
                // submitting this form writes both into the frontend .env and the API base URL.
                if (typeof res.data.apiPort === 'number' && res.data.apiPort > 0) {
                    setNewPort(res.data.apiPort);
                } else if (res.data.currentBaseUrl) {
                    try {
                        const url = new URL(res.data.currentBaseUrl);
                        setNewPort(parseInt(url.port) || 80);
                    } catch {
                        // Swallowing this left the field showing a default the user could then
                        // save over the real value, for every device in the fleet.
                        console.warn(`[settings] Could not parse currentBaseUrl "${res.data.currentBaseUrl}". `
                            + `The API port shown is a default, not the server's actual value -- do not save without checking it.`);
                    }
                }

                if (typeof res.data.frontendPort === 'number' && res.data.frontendPort > 0) {
                    setNewFrontendPort(res.data.frontendPort);
                } else {
                    console.warn('[settings] The server did not report a frontend port. The value shown is a default; '
                        + 'saving it would rewrite PORT= in the frontend .env.');
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
        } catch (e) {
            alert("Execution Failed: " + (e instanceof Error ? e.message : "Unknown error"));
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
        } catch (e) {
            alert("Error: " + (e instanceof Error ? e.message : "Unknown error"));
        } finally {
            setLoading(false);
        }
    };

    const inputClass = 'bg-muted/20 border border-border rounded-xl px-4 py-3 outline-none focus:border-accent-cyan focus:ring-1 focus:ring-accent-cyan/30 text-base text-foreground placeholder:text-muted-foreground/70 transition-colors';

    return (
        <section className="space-y-4 font-mono text-sm border border-accent-cyan/20 p-6 rounded-2xl bg-accent-cyan/5 relative min-h-[400px]" aria-labelledby="network-config-title" aria-busy={refreshing && !config}>
            {(refreshing && !config) && (
                <div className="absolute inset-0 z-10 bg-background/80 flex items-center justify-center rounded-2xl" role="status">
                    <div className="text-accent-cyan font-bold tracking-widest">Loading…</div>
                </div>
            )}

            {!config && !refreshing && (
                <div className="absolute inset-0 z-10 bg-background/90 flex flex-col items-center justify-center rounded-2xl space-y-4" role="alert">
                    <div className="text-red-500 font-bold uppercase tracking-widest">Connection failed</div>
                    <button type="button" onClick={loadConfig} className="px-6 py-2 bg-muted/30 hover:bg-muted/50 rounded-lg text-foreground font-bold">Retry</button>
                </div>
            )}

            <div className="flex justify-between items-start gap-4">
                <div>
                    <h3 id="network-config-title" className="font-bold text-accent-cyan text-lg mb-1">Network configuration</h3>
                    <p className="text-muted-foreground text-xs">Update the server IP to allow LAN access</p>
                </div>
                <div className="text-right">
                    <span className="text-xs uppercase text-muted-foreground block">Detected local IP</span>
                    <span className="text-green-600 dark:text-green-400 font-bold text-lg">{config?.detectedIp || '---'}</span>
                </div>
            </div>

            <div className="bg-muted/20 p-4 rounded-xl space-y-2 border border-border/50">
                <p className="text-xs uppercase text-muted-foreground">Current API base URL</p>
                <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-foreground/90 break-all">{config?.currentBaseUrl || '…'}</code>
                    {config?.currentBaseUrl?.includes("localhost") && (
                        <span className="text-xs bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded">localhost (restricted)</span>
                    )}
                </div>
            </div>

            {/* Sync Button */}
            <div className="bg-muted/20 p-4 rounded-xl flex justify-between items-center gap-4 border border-border/50">
                <div>
                    <p className="text-xs uppercase text-muted-foreground font-bold">Media database sync</p>
                    <p className="text-xs text-muted-foreground">Fix broken media links if the IP changed manually</p>
                </div>
                <button
                    type="button"
                    onClick={handleSyncMedia}
                    disabled={loading}
                    className="bg-muted/30 hover:bg-muted/50 px-4 py-2 rounded-lg text-xs font-bold border border-border transition-colors hover:text-accent-cyan hover:border-accent-cyan/50 text-foreground disabled:opacity-50 shrink-0"
                >
                    Sync DB paths
                </button>
            </div>

            <div className="pt-4 border-t border-border space-y-4">
                <div className="space-y-2">
                    <label htmlFor="settings-ip" className="text-xs uppercase text-muted-foreground font-bold block">New host IP address</label>
                    <div className="flex gap-2">
                        <input
                            id="settings-ip"
                            type="text"
                            inputMode="decimal"
                            value={newIp}
                            onChange={(e) => setNewIp(e.target.value)}
                            className={`flex-[3] min-w-0 ${inputClass}`}
                            placeholder="e.g. 192.168.1.10"
                        />
                        <input
                            id="settings-api-port"
                            type="number"
                            aria-label="API port"
                            value={newPort}
                            onChange={(e) => setNewPort(parseInt(e.target.value))}
                            className={`flex-1 min-w-0 text-center ${inputClass}`}
                            placeholder="Port"
                        />
                        <button
                            type="button"
                            onClick={() => setNewIp(config?.detectedIp || '')}
                            className="px-4 py-2 bg-muted/20 hover:bg-muted/40 rounded-xl text-xs uppercase font-bold text-muted-foreground border border-border transition-colors"
                            title="Use detected IP"
                        >
                            Auto
                        </button>
                    </div>
                </div>

                <div className="space-y-2">
                    <label htmlFor="settings-web-port" className="text-xs uppercase text-muted-foreground font-bold block">Dashboard (web) port</label>
                    <input
                        id="settings-web-port"
                        type="number"
                        value={newFrontendPort}
                        onChange={(e) => setNewFrontendPort(parseInt(e.target.value))}
                        className={`w-full ${inputClass}`}
                        placeholder="8865"
                    />
                    <p className="text-xs text-muted-foreground">
                        Entering <b>{newIp || '...'}</b> will set the API to <b>http://{newIp || '...'}:{newPort}</b> and the dashboard to <b>:{newFrontendPort}</b>
                    </p>
                </div>

                <button
                    type="button"
                    onClick={handleExecute}
                    disabled={loading}
                    className="w-full py-4 bg-primary text-primary-foreground font-black uppercase tracking-widest rounded-xl hover:brightness-110 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? 'Applying…' : 'Save & apply changes'}
                </button>
            </div>
        </section>
    );
}

export default function SettingsPage() {
    return (
        <div className="p-8 space-y-8 max-w-5xl mx-auto">
            <header>
                <h1 className="text-4xl font-black neon-text uppercase tracking-tighter mb-2">Settings</h1>
                <p className="text-muted-foreground">Manage system-wide configuration and infrastructure</p>
            </header>

            <div className="space-y-6">
                <h2 className="text-xl font-bold border-b border-border pb-4">System infrastructure</h2>

                <SystemConfigPanel />

                <div className="p-4 bg-muted/20 rounded-xl border border-border/50 font-mono text-sm max-w-2xl">
                    <p className="text-muted-foreground text-xs uppercase mb-1">Storage provider</p>
                    <p className="text-accent-purple font-bold">Local storage (wwwroot/media)</p>
                </div>
            </div>
        </div>
    );
}
